// Supply drops (planning/workstreams/supply.md): a drop is called at a place, its cast leaves the nearest obelisk at
// the height of that obelisk's next ignition, and it lands as a capsule holding what its tier's and class's table in
// the drop book rolled, which anyone at the tier's level may take from until it is empty or its time is up.
//
// A drop is one small record here with two states, pending and landed. Everything between is worked out from its ticks
// (shared/sim/supply.ts). It lands in one tick: the capsule's record, what it holds and the drop's own state change
// together, and the save commits them together, so a process killed at any moment leaves a drop wholly pending or
// wholly landed. Its loot is rolled as it lands, from a seed fixed when it was called, so a server stopped while it was
// in the air lands the same loot on the same tick.

import { TICK_RATE } from "../shared/coords.ts";
import { hashString } from "../shared/hash.ts";
import { S_SUPPLY } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { ANNOUNCES, LEAVE_SECONDS, POSE_NAMES, SENDER_ZENITH, SUPPLY_MOST, newPose, quantise, supplyPose, supplyTimes, writeSupply, type SupplyList, type SupplyRow } from "../shared/sim/supply.ts";
import { tableKey, type SupplyBook } from "../shared/supply/book.ts";
import { catalogOf, type Catalog } from "../shared/supply/catalog.ts";
import { compileBook, rollTable, type Compiled } from "../shared/supply/compile.ts";
import { HIT_NONE, castWorld, rayHit } from "../shared/world/ray.ts";
import { EYE_KNOT } from "../shared/world/tide-eye.ts";
import type { Death } from "./death.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Connection } from "../shared/net/transport.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Progression } from "./progression.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { BookStore } from "./supply/store.ts";
import type { ServerWorld } from "./world.ts";

/** One of the two the item program kept (tests/unit/weapons-contracts.test.ts). Its first number is a drop's id. */
export const DEADLINE_SUPPLY = 12;
/** The key in a capsule record's `extra` under which it carries the id of the drop it is: two bytes, low first. */
export const SUPPLY_TAG = 0x647270;
/** Added to the world's seed for the drops' rolls, as each system that rolls takes a number of its own. */
const SEED = 109;
/** Metres over the ground a landing is looked for from: over any roof, under the cast's own height. */
const LAND_FROM = 600;

const CALL = event("supply.call");
const LANDED = event("supply.landed");
const OPENED = event("supply.opened");
const GONE = event("supply.gone");

/** A drop as the server keeps it. Positions are quantised as they are sent, so every party works from the same numbers. */
export interface Drop extends SupplyRow {
  /** The book's keys of its tier and class, and what they showed when it was called: an edit changes no drop already called. */
  tierKey: string;
  clsKey: string;
  tierName: string;
  clsName: string;
  rgb: number;
  level: number;
  count: number;
  mark: number;
  /** The circuit and the site that called it, or "" for one called by hand. */
  circuit: string;
  site: string;
  /** Which call of the world's it is: with the world's seed and its circuit, the seed of its roll. */
  n: number;
  /** Who called it: "circuit", "console", "admin", or a module's name. */
  source: string;
  /** Its capsule's record, 0 until it has landed. */
  pid: number;
}

export interface CallOptions {
  x: number;
  z: number;
  tier: string;
  cls: string;
  /** Left out, it is drawn by the book's chance. */
  ringed?: boolean;
  source: string;
  circuit?: string;
  site?: string;
  /** Seconds from now to the landing at the least, in place of the book's notice. */
  notice?: number;
}

export interface SupplyContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  items: Items;
  death: Death;
  progression: Progression;
  deadlines: DeadlineHeap;
  bus: Bus;
  book: BookStore;
  /** The world's seed. */
  seed: number;
  /** What every quality band is multiplied by: SupplyCrateLootQualityMultiplier. */
  quality: () => number;
  say: (line: string) => void;
}

/** What the save keeps of a drop: everything but what its ticks and the book give again. */
type Saved = Omit<Drop, "tier" | "cls" | "landed" | "opened" | "left"> & { opened: number };

export class Supply {
  /** Pending and landed, and those that have just left, oldest first. */
  readonly drops: Drop[] = [];
  /** Drops and capsules put right at load: a capsule with no drop, or a landed drop with no capsule. A save that was committed needs none. */
  mended = 0;
  /** Since the server started. */
  calls = 0;
  landings = 0;
  readonly saved = { dirty: false, serialize: (): string => this.serialize() };
  private readonly ctx: SupplyContext;
  private readonly capsule: number;
  /** Calls the world has made: the next drop's `n`. */
  private n = 0;
  private nextId = 1;
  /** Raised whenever what a session is told changes. */
  private version = 1;
  private readonly told = new WeakMap<Connection, number>();
  private compiledOf: { book: SupplyBook; quality: number; compiled: Compiled } | null = null;
  private readonly catalog: Catalog;
  private readonly pose = newPose();

  constructor(ctx: SupplyContext) {
    this.ctx = ctx;
    this.capsule = ctx.world.reg.index.get("core:supply_capsule") ?? -1;
    this.catalog = catalogOf(ctx.world.reg);
    ctx.death.gate = (c, box) => this.gate(c, box);
    ctx.death.onOpened = (c, box) => this.opened(c, box);
    ctx.death.onRemoved = (box) => this.removed(box);
  }

  /** The book in force, compiled against the game's items: again whenever the book or the quality setting changes. */
  compiled(): Compiled {
    const book = this.ctx.book.book;
    const quality = this.ctx.quality();
    if (this.compiledOf?.book !== book || this.compiledOf.quality !== quality) this.compiledOf = { book, quality, compiled: compileBook(book, this.catalog, { quality }) };
    return this.compiledOf.compiled;
  }

  get(id: number): Drop | null {
    return this.drops.find((d) => d.id === id) ?? null;
  }

  /** The drop a capsule's record is, or null. */
  of(box: EntityRecord): Drop | null {
    const tag = box.kind === this.capsule ? box.extra.get(SUPPLY_TAG) : undefined;
    return tag && tag.length === 2 ? this.get(tag[0]! | (tag[1]! << 8)) : null;
  }

  /** Drops that are pending or landed: those leaving are no longer anybody's to find. */
  live(): number {
    let n = 0;
    for (const d of this.drops) if (d.left === 0) n++;
    return n;
  }

  /** "coming", "flying", "braking", "landed", "leaving" or "gone", now. */
  state(d: Drop): string {
    return POSE_NAMES[supplyPose(d, this.ctx.world.tick, TICK_RATE, this.pose).state]!;
  }

  /**
   * Calls a drop of a tier and class at a place. Returns it, or why it was not called. Whether the place is a fit one
   * (a base near it, a tree on it) is the caller's to ask: what an admin calls by hand lands where it is called.
   */
  call(o: CallOptions): Drop | string {
    const { world, bus, book } = this.ctx;
    if (this.capsule < 0) return "this content has no supply capsule";
    if (this.live() >= SUPPLY_MOST) return `${SUPPLY_MOST} drops are live already`;
    if (!(o.x >= 0 && o.z >= 0 && o.x <= world.hf.sizeX && o.z <= world.hf.sizeZ)) return "that is off the map";
    const rules = book.book.rules;
    let tier = o.tier;
    let cls = o.cls;
    let ringed = o.ringed;
    const x = quantise(o.x);
    const z = quantise(o.z);
    if (bus.n[CALL] !== 0) {
      const asked = { x, z, tier, class: cls, ringed: ringed === undefined ? -1 : ringed ? 1 : 0, source: o.source, circuit: o.circuit ?? "", site: o.site ?? "" };
      const refused = bus.before(CALL, asked);
      if (refused !== "") return refused;
      tier = String(asked.tier);
      cls = String(asked.class);
      ringed = Number(asked.ringed) < 0 ? undefined : Number(asked.ringed) > 0;
    }
    const t = book.book.tiers.findIndex((v) => v.key === tier);
    const k = book.book.classes.findIndex((v) => v.key === cls);
    if (t < 0) return `the book has no tier "${tier}"`;
    if (k < 0) return `the book has no class "${cls}"`;
    if (!this.compiled().tables.has(tableKey(tier, cls))) return `the book has no table for ${tier} ${cls}`;
    const tierDoc = book.book.tiers[t]!;
    const clsDoc = book.book.classes[k]!;
    const n = this.n++;
    const seed = hashString(`${o.circuit ?? ""}/${n}`, (this.ctx.seed + SEED) >>> 0);
    const rng = new Rng(seed);
    // Drawn whether or not it is asked for, so that asking does not move what the seed gives after it.
    const drawn = rng.float() < rules.ringedChance;
    // The nearest obelisk sends it, from the knot of storm its beam ends in.
    let sender = SENDER_ZENITH;
    let near = Infinity;
    world.obelisks.forEach((ob, i) => {
      const far = Math.hypot(ob.x - x, ob.z - z);
      if (far < near && i < SENDER_ZENITH) {
        near = far;
        sender = i;
      }
    });
    const from = world.obelisks[sender];
    const eye = from && from.eye >= 0 ? from.eye : SENDER_ZENITH;
    const times = supplyTimes(world.tick, eye === SENDER_ZENITH ? null : world.tideEyes[eye]!.color, o.notice ?? rules.noticeSeconds, rules.flightSeconds, rules.brakeSeconds, rules.lifeSeconds, TICK_RATE);
    const d: Drop = {
      ...times,
      id: this.takeId(),
      tier: 0,
      cls: 0,
      ringed: ringed ?? drawn,
      landed: false,
      opened: false,
      announce: Math.max(0, ANNOUNCES.indexOf(rules.announce)),
      sender,
      eye,
      look: seed & 0xff,
      ox: quantise(from ? from.x : x),
      oy: quantise(EYE_KNOT),
      oz: quantise(from ? from.z : z),
      x,
      y: quantise(this.groundAt(x, z)),
      z,
      tierKey: tierDoc.key,
      clsKey: clsDoc.key,
      tierName: tierDoc.name.slice(0, 40),
      clsName: clsDoc.name.slice(0, 40),
      rgb: tierDoc.rgb,
      level: tierDoc.level,
      count: t + 1,
      mark: clsDoc.mark,
      circuit: o.circuit ?? "",
      site: o.site ?? "",
      n,
      source: o.source,
      pid: 0,
    };
    this.drops.push(d);
    this.calls++;
    this.ctx.deadlines.push(d.land, DEADLINE_SUPPLY, d.id, d.land);
    this.changed();
    return d;
  }

  /** A DEADLINE_SUPPLY came due: a pending drop lands, and one that left is forgotten. A stamp that is no longer its tick is stale. */
  due(id: number, stamp: number): void {
    const d = this.get(id);
    if (!d) return;
    if (d.left > 0) {
      if (stamp === d.left + LEAVE_SECONDS * TICK_RATE) this.forget(d);
    } else if (!d.landed && stamp === d.land) this.land(d);
  }

  /**
   * Once a tick. A capsule emptied by a hand that shut it in the same tick, or by anything that is not a session, would
   * lie empty until its time was up (Death removes an emptied prop only while somebody has it open): it leaves now.
   */
  step(): void {
    const { records, death } = this.ctx;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (d.pid === 0) continue;
      const box = records.byPid.get(d.pid);
      if (box && (!box.inv || box.inv.used() === 0)) death.remove(box);
    }
  }

  /** Brings a pending drop's landing to `seconds` from now, the flight shortened to fit: what `supply land` does. */
  hurry(d: Drop, seconds = 0): string {
    if (d.landed || d.left > 0) return `drop ${d.id} has landed`;
    const tick = this.ctx.world.tick;
    const land = tick + 1 + Math.max(0, Math.round(seconds * TICK_RATE));
    if (land >= d.land) return `drop ${d.id} lands sooner than that already`;
    const flight = d.land - d.release;
    d.end = land + (d.end - d.land);
    d.land = land;
    // Its cast has left already where there is no time for it to leave and fly: it is seen part of the way, or arriving.
    d.release = land - flight;
    d.called = Math.min(d.called, d.release);
    this.ctx.deadlines.push(d.land, DEADLINE_SUPPLY, d.id, d.land);
    this.changed();
    return "";
  }

  /** Takes a drop away: a pending one is gone at once, and a landed one's capsule shuts and leaves with what it held. */
  cancel(d: Drop, why = "cancelled"): void {
    if (d.left > 0) return;
    const box = d.pid === 0 ? undefined : this.ctx.records.byPid.get(d.pid);
    if (box) {
      this.leaving.set(d.id, why);
      this.ctx.death.remove(box);
      return;
    }
    this.ctx.bus.after(GONE, { id: d.id, tier: d.tierKey, class: d.clsKey, why, landed: d.landed ? 1 : 0, opened: d.opened ? 1 : 0 });
    this.forget(d);
  }

  /** Why each capsule being removed by this module's own hand goes, by drop id. */
  private readonly leaving = new Map<number, string>();

  /**
   * Where a capsule coming straight down at (x, z) comes to rest: on the ground, on what is built or stands there, or on
   * the water where that is over them.
   */
  groundAt(x: number, z: number): number {
    const { world } = this.ctx;
    const ground = world.hf.heightAt(x, z);
    const top = ground + LAND_FROM;
    // The ground and what stands on it, and not the trees and rocks: a site is not chosen over one, and they come and go.
    const hit = castWorld({ hf: world.hf, structs: world.structs }, x, top, z, 0, -1, 0, LAND_FROM + 50, true);
    const rest = hit !== HIT_NONE ? top - rayHit.t : ground;
    return Math.max(rest, world.hf.waterAt(x, z));
  }

  /** In one tick: the capsule's record, what it holds, and the drop turned to landed. */
  private land(d: Drop): void {
    const { records, items, death, bus } = this.ctx;
    const table = this.compiled().tables.get(tableKey(d.tierKey, d.clsKey)) ?? null;
    const seed = hashString(`${d.circuit}/${d.n}`, (this.ctx.seed + SEED) >>> 0);
    const rng = new Rng(seed);
    rng.float();
    // A table the book no longer has gives nothing, and a drop of nothing does not land.
    const rolled = table ? rollTable(table, d.ringed, rng, this.catalog, table.dormant) : [];
    const box = records.create(this.capsule, `${d.ringed ? "Ringed " : ""}${d.tierName} ${d.clsName} drop`.slice(0, 60));
    box.extra.set(SUPPLY_TAG, Uint8Array.of(d.id & 0xff, d.id >> 8));
    const mint = (list: typeof rolled): number => {
      let stacks = 0;
      for (const r of list) if (items.mint(box, r.item, r.count, r.quality, 0, -1, "supply", r.blueprint ? FLAG_BLUEPRINT : 0) > 0) stacks++;
      return stacks;
    };
    let stacks = mint(rolled);
    // Everything refused by a module, or nothing rolled: the tier's floor, which is plain materials.
    if (stacks === 0 && table?.floor) stacks = mint(rollTable({ ...table, plain: [], ringed: [], fill: null }, false, rng, this.catalog));
    if (stacks === 0) {
      records.delete(box.pid);
      this.ctx.say(`drop ${d.id} (${d.tierKey} ${d.clsKey}) had nothing to hold, and did not land`);
      bus.after(GONE, { id: d.id, tier: d.tierKey, class: d.clsKey, why: "empty", landed: 0, opened: 0 });
      this.forget(d);
      return;
    }
    d.y = quantise(this.groundAt(d.x, d.z));
    box.x = d.x;
    box.y = d.y;
    box.z = d.z;
    box.expiresAt = d.end;
    records.dirty.add(box.pid);
    death.place(box);
    d.pid = box.pid;
    d.landed = true;
    this.landings++;
    this.changed();
    // The slots it fills: one roll of a thing that does not stack is several, and two of one thing that join are one.
    bus.after(LANDED, { id: d.id, pid: box.pid, x: d.x, y: d.y, z: d.z, tier: d.tierKey, class: d.clsKey, ringed: d.ringed ? 1 : 0, stacks: items.inv(box).used(), source: d.source });
  }

  /** Why `c` may not open a capsule, or "": the tier's level, as it stood when the drop was called. */
  private gate(c: Client, box: EntityRecord): string {
    const d = this.of(box);
    if (!d) return "";
    const rec = this.ctx.records.byPid.get(c.pid);
    return rec && this.ctx.progression.level(rec) < d.level ? `A ${d.tierName} drop opens at level ${d.level}.` : "";
  }

  private opened(c: Client, box: EntityRecord): void {
    const d = this.of(box);
    if (!d) return;
    this.ctx.bus.after(OPENED, { id: d.id, pid: box.pid, byPid: c.pid, tier: d.tierKey, class: d.clsKey, first: d.opened ? 0 : 1 });
    if (d.opened) return;
    d.opened = true;
    this.openedBy.set(d.id, c.pid);
    this.changed();
  }

  /** Who first opened each drop, by its id. */
  readonly openedBy = new Map<number, number>();

  /** Its capsule is being removed: emptied, out of time, or taken away. It shuts and leaves. */
  private removed(box: EntityRecord): void {
    const d = this.of(box);
    if (!d || d.left > 0) return;
    const tick = this.ctx.world.tick;
    const why = this.leaving.get(d.id) ?? (box.inv && box.inv.used() > 0 ? (tick >= d.end ? "expired" : "removed") : "emptied");
    this.leaving.delete(d.id);
    d.left = Math.max(tick, d.land + 1);
    d.pid = 0;
    this.ctx.deadlines.push(d.left + LEAVE_SECONDS * TICK_RATE, DEADLINE_SUPPLY, d.id, d.left + LEAVE_SECONDS * TICK_RATE);
    this.ctx.bus.after(GONE, { id: d.id, tier: d.tierKey, class: d.clsKey, why, landed: 1, opened: d.opened ? 1 : 0 });
    this.changed();
  }

  private forget(d: Drop): void {
    const at = this.drops.indexOf(d);
    if (at >= 0) this.drops.splice(at, 1);
    this.openedBy.delete(d.id);
    this.changed();
  }

  private takeId(): number {
    for (;;) {
      const id = this.nextId;
      this.nextId = this.nextId >= 0xffff ? 1 : this.nextId + 1;
      if (!this.get(id)) return id;
    }
  }

  private changed(): void {
    this.version++;
    this.saved.dirty = true;
  }

  /** The drops as a session is told of them, with what each tier and class among them shows. */
  list(): SupplyList {
    const list: SupplyList = { tiers: [], classes: [], rows: [] };
    for (const d of this.drops) {
      let tier = list.tiers.findIndex((t) => t.name === d.tierName && t.rgb === d.rgb && t.level === d.level && t.count === d.count);
      if (tier < 0) tier = list.tiers.push({ name: d.tierName, rgb: d.rgb, level: d.level, count: d.count }) - 1;
      let cls = list.classes.findIndex((k) => k.name === d.clsName && k.mark === d.mark);
      if (cls < 0) cls = list.classes.push({ name: d.clsName, mark: d.mark }) - 1;
      d.tier = tier;
      d.cls = cls;
      list.rows.push(d);
    }
    return list;
  }

  /** Tells a session the drops as they stand, if it has not been told since they changed: all of them after its welcome. */
  sync(c: Client): void {
    if (this.told.get(c.conn) === this.version) return;
    writeSupply(this.ctx.game.begin(S_SUPPLY), this.list());
    this.ctx.game.endOwn(c);
    this.told.set(c.conn, this.version);
  }

  private serialize(): string {
    const drops: Saved[] = [];
    for (const d of this.drops) {
      // One that has left is not kept: its capsule's record is gone with it, and its leaving is only seen.
      if (d.left > 0) continue;
      const { tier: _t, cls: _c, landed: _l, left: _f, opened, ...rest } = d;
      drops.push({ ...rest, opened: opened ? 1 : 0 });
    }
    return JSON.stringify({ n: this.n, next: this.nextId, drops });
  }

  /**
   * Call once, after the world's records are in and placed. Takes up the saved drops and checks them against the
   * capsules, both ways: a save that was committed has a capsule for each landed drop and a drop for each capsule.
   */
  begin(saved: string | null): void {
    const { world, records, death, deadlines } = this.ctx;
    const was = JSON.parse(saved ?? "{}") as { n?: number; next?: number; drops?: Saved[] };
    this.n = was.n ?? 0;
    this.nextId = was.next ?? 1;
    for (const s of was.drops ?? []) {
      const d: Drop = { ...s, tier: 0, cls: 0, landed: s.pid !== 0, opened: s.opened !== 0, left: 0 };
      // A landed drop whose capsule the save does not have: there is nothing to find, so it is forgotten.
      if (d.landed && !this.tagged(records.byPid.get(d.pid), d.id)) {
        this.mended++;
        continue;
      }
      this.drops.push(d);
      // One whose tick came while the server was stopped lands on its first tick.
      if (!d.landed) deadlines.push(Math.max(d.land, world.tick + 1), DEADLINE_SUPPLY, d.id, d.land);
    }
    for (const rec of [...records.byPid.values()]) {
      if (rec.kind !== this.capsule) continue;
      const d = this.of(rec);
      if (d && d.pid === rec.pid) continue;
      // A capsule of no drop: nothing says what it was, so it goes.
      this.mended++;
      death.remove(rec);
    }
    if (this.mended > 0) this.ctx.say(`supply drops: ${this.mended} put right at load, a capsule with no drop or a drop with no capsule`);
    this.saved.dirty = this.mended > 0;
    this.version++;
  }

  private tagged(rec: EntityRecord | undefined, id: number): boolean {
    const tag = rec?.kind === this.capsule ? rec.extra.get(SUPPLY_TAG) : undefined;
    return !!tag && tag.length === 2 && (tag[0]! | (tag[1]! << 8)) === id;
  }
}
