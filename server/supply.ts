// Supply drops (planning/workstreams/supply.md): a drop is called at a place, its cast leaves the nearest obelisk at
// the height of that obelisk's next ignition, and it lands as a capsule holding what its tier's and class's table in
// the drop book rolled, which anyone at the tier's level may take from until it is empty or its time is up.
//
// A drop is one small record here with two states, pending and landed. Everything between is worked out from its ticks
// (shared/sim/supply.ts). It lands in one tick: the capsule's record, what it holds and the drop's own state change
// together, and the save commits them together, so a process killed at any moment leaves a drop wholly pending or
// wholly landed. Its loot is rolled as it lands, from a seed fixed when it was called, so a server stopped while it was
// in the air lands the same loot on the same tick.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import type { LootDef } from "../shared/content/defs.ts";
import { hashString } from "../shared/hash.ts";
import { fitBytes } from "../shared/net/codec.ts";
import { MAX_OPEN_NAME_BYTES, S_SUPPLY, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import { rollLoot, type LootDrop } from "../shared/sim/loot.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { ANNOUNCES, LEAVE_SECONDS, POSE_NAMES, SENDER_ZENITH, SUPPLY_MOST, SUPPLY_NAME_BYTES, SUPPLY_ROWS, newPose, quantise, supplyName, supplyPose, supplyTimes, writeSupply, type SupplyList, type SupplyRow } from "../shared/sim/supply.ts";
import { tableKey, type CircuitDoc, type SiteDoc, type SupplyBook } from "../shared/supply/book.ts";
import { catalogOf, type Catalog } from "../shared/supply/catalog.ts";
import { cellsOf, compileBook, rollTable, type Compiled } from "../shared/supply/compile.ts";
import { HIT_NONE, castWorld, rayHit } from "../shared/world/ray.ts";
import { EYE_KNOT, eyeKnot } from "../shared/world/tide-eye.ts";
import type { Death } from "./death.ts";
import { event, type Bus } from "./events/bus.ts";
import type { Connection } from "../shared/net/transport.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Progression } from "./progression.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ArkTables } from "./supply/ark.ts";
import { siteFault, type FitOptions } from "./supply/ground.ts";
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
/** A circuit's deadline carries this and its place in the order the circuits were first met, where a drop's carries its id. */
const CIRCUIT_BASE = 0x10000;
/** Seconds before a circuit that found nobody to call a drop for, or no place for one, looks again. */
export const RETRY_SECONDS = 60;
/** Metres from a survivor within which a circuit calls a drop, where the book does not say (BookRules.reach). */
export const REACH = 2500;
/** Metres from a live drop within which a circuit calls no other. */
export const APART = 60;
/** Metres from a site of the book within which nothing is built on a PvE server, unless PvEAllowStructuresAtSupplyDrops. */
export const SITE_CLEAR = 30;
/** Places a circuit tries before it gives up until its next look. */
const SITE_DRAWS = 8;
const OPEN_DRAWS = 16;

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
  /** The chance it is ringed where `ringed` is left out, in place of the book's: a circuit's own. */
  chance?: number;
}

/** A circuit as it runs: the tick it next looks, how many times it has, and why it last called nothing ("" if it called one). */
export interface CircuitState {
  due: number;
  n: number;
  stamp: number;
  why: string;
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
  /** ARK's settings for drops are read as they stand, so a change from the console takes effect at the next call. */
  rules: Rules;
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
  /** What the drops have lately done, newest last, for an admin to read: landed, first opened and by whom, gone and why. */
  readonly log: { tick: number; what: string }[] = [];
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
  /** What ConfigOverrideSupplyCrateItems gives, by tier key: it wins over the book's tables (server/supply/ark.ts). */
  overrides: ReadonlyMap<string, ArkTables> = new Map();
  /** The circuits of the book that are on, by key. */
  readonly circuits = new Map<string, CircuitState>();
  /** Every circuit key a deadline was ever pushed for, in the order met: a deadline names one by its place here. */
  private readonly order: string[] = [];
  private stamps = 0;
  /** The book the circuits and the sites below were last taken from. */
  private planned: SupplyBook | null = null;
  private readonly siteByKey = new Map<string, SiteDoc>();
  /** The book's sites by the chunk each is in. */
  private readonly siteGrid = new Map<number, SiteDoc[]>();
  private readonly scaled = new WeakMap<LootDef, { quality: number; def: LootDef }>();
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
    const quality = this.ctx.rules.num("SupplyCrateLootQualityMultiplier");
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
    const drawn = rng.float() < (o.chance ?? rules.ringedChance);
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
    const knot = eye === SENDER_ZENITH ? null : eyeKnot(world.tideEyes[eye]!);
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
      // From the knot of storm over the sender's emitter, where it has a display; from over a plain obelisk; or from overhead.
      ox: quantise(knot ? knot.x : from ? from.x : x),
      oy: quantise(EYE_KNOT),
      oz: quantise(knot ? knot.z : from ? from.z : z),
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
    if (rules.announce === "chat") this.tell(d);
    return d;
  }

  /** A DEADLINE_SUPPLY came due: a pending drop lands, and one that left is forgotten. A stamp that is no longer its tick is stale. */
  due(id: number, stamp: number): void {
    if (id >= CIRCUIT_BASE) {
      const key = this.order[id - CIRCUIT_BASE];
      if (key !== undefined) this.look(key, stamp);
      return;
    }
    const d = this.get(id);
    if (!d) return;
    if (d.left > 0) {
      if (stamp === d.left + LEAVE_SECONDS * TICK_RATE) this.forget(d);
    } else if (!d.landed && stamp === d.land) this.land(d);
  }

  /** Tells every survivor in the world of a drop just called, each how far off it is and which way: the book's "chat". */
  private tell(d: Drop): void {
    const { game, world } = this.ctx;
    const what = `A ${d.ringed ? "ringed " : ""}${d.tierName} ${d.clsName} drop`;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      if (c.ent < 0) {
        game.sendText(c, TEXT_NOTICE, `${what} is coming down.`);
        continue;
      }
      // The map's x runs west and its z north (shared/world/coords.ts).
      const east = world.ents.x[c.ent]! - d.x;
      const north = d.z - world.ents.z[c.ent]!;
      const far = Math.hypot(east, north);
      // The eight winds, by which of the two is the greater and whether the lesser is more than its tangent of 22.5 degrees.
      const ns = north >= 0 ? "north" : "south";
      const ew = east >= 0 ? "east" : "west";
      const a = Math.abs(north);
      const b = Math.abs(east);
      const way = a > b * 2.414 ? ns : b > a * 2.414 ? ew : `${ns}-${ew}`;
      game.sendText(c, TEXT_NOTICE, far < 50 ? `${what} is coming down here.` : `${what} is coming down ${far < 950 ? `${Math.round(far / 10) * 10} m` : `${(far / 1000).toFixed(1)} km`} to the ${way}.`);
    }
  }

  /** The survivors in the world now, where each stands. */
  private survivors(): { x: number; z: number }[] {
    const { game, world } = this.ctx;
    const out: { x: number; z: number }[] = [];
    for (const c of game.clients) if (c?.active && !c.closed && c.ent >= 0) out.push({ x: world.ents.x[c.ent]!, z: world.ents.z[c.ent]! });
    return out;
  }

  /**
   * Takes the book's circuits and sites up again: a circuit new to it waits its first delay, one that is gone or off
   * is forgotten, and the rest keep the tick they were due at.
   */
  private plan(): void {
    const { world } = this.ctx;
    const book = this.ctx.book.book;
    this.planned = book;
    this.siteByKey.clear();
    this.siteGrid.clear();
    // The ground kept clear is where drops land: the sites a circuit names, switched on or not for now. A site no
    // circuit names is in the book and nowhere else: nothing lands at it, and it holds nobody's ground.
    const named = new Set<string>();
    for (const c of book.circuits) for (const key of c.sites) named.add(key);
    for (const s of book.sites) {
      this.siteByKey.set(s.key, s);
      if (!named.has(s.key)) continue;
      const cell = Math.floor(s.z / CHUNK_SIZE) * 65536 + Math.floor(s.x / CHUNK_SIZE);
      const list = this.siteGrid.get(cell);
      if (list) list.push(s);
      else this.siteGrid.set(cell, [s]);
    }
    for (const key of [...this.circuits.keys()]) if (!book.circuits.some((c) => c.key === key && c.on)) this.circuits.delete(key);
    for (const c of book.circuits) {
      if (!c.on) continue;
      let st = this.circuits.get(c.key);
      if (!st) {
        const rng = new Rng(hashString(`${c.key}#first`, (this.ctx.seed + SEED) >>> 0));
        st = { due: world.tick + Math.round(rng.range(c.firstDelay[0], c.firstDelay[1]) * TICK_RATE), n: 0, stamp: 0, why: "" };
        this.circuits.set(c.key, st);
      }
      this.arm(c.key, st);
    }
    this.saved.dirty = true;
  }

  private arm(key: string, st: CircuitState): void {
    let at = this.order.indexOf(key);
    if (at < 0) at = this.order.push(key) - 1;
    st.stamp = ++this.stamps;
    this.ctx.deadlines.push(Math.max(st.due, this.ctx.world.tick + 1), DEADLINE_SUPPLY, CIRCUIT_BASE + at, st.stamp);
  }

  /**
   * A circuit's look: it calls a drop of a tier and class drawn by its weights at one of its sites, or on open ground,
   * unless drops are off, nobody is in the world, the map or the circuit has all it may, or no place is fit. What it
   * draws comes from the world's seed, its key and how many looks it has had, so a world run again looks alike.
   */
  private look(key: string, stamp: number): void {
    const st = this.circuits.get(key);
    if (!st || st.stamp !== stamp) return;
    const { world, rules } = this.ctx;
    const book = this.ctx.book.book;
    const c = book.circuits.find((v) => v.key === key);
    if (!c || !c.on) {
      this.circuits.delete(key);
      return;
    }
    const rng = new Rng(hashString(`${key}#${st.n}`, (this.ctx.seed + SEED) >>> 0));
    st.n++;
    const eyes = this.survivors();
    let mine = 0;
    for (const d of this.drops) if (d.left === 0 && d.circuit === key) mine++;
    let why = "";
    if (rules.on("bDisableLootCrates")) why = "drops are off (bDisableLootCrates)";
    else if (eyes.length < book.rules.minPlayers) why = "nobody is in the world";
    else if (this.live() >= Math.min(book.rules.maxLive, SUPPLY_MOST)) why = "the map has all the drops it may";
    else if (mine >= c.maxLive) why = "the circuit has all the drops it may";
    else {
      const cells = cellsOf(this.compiled(), c);
      let total = 0;
      for (const cell of cells) total += cell.weight;
      let pick = rng.float() * total;
      const cell = cells.find((v) => (pick -= v.weight) < 0) ?? cells[cells.length - 1];
      const at = cell ? this.place(c, rng, eyes) : null;
      if (!cell) why = "none of its tiers has a table to call";
      else if (!at) why = "no fit place";
      else {
        const made = this.call({ x: at.x, z: at.z, tier: book.tiers[cell.table.tier]!.key, cls: book.classes[cell.table.cls]!.key, source: "circuit", circuit: key, site: at.site, chance: c.ringedChance });
        if (typeof made === "string") why = made;
      }
    }
    st.why = why;
    const wait = why === "nobody is in the world" || why === "no fit place" || why.startsWith("drops are off") ? RETRY_SECONDS : rng.range(c.interval[0], c.interval[1]);
    st.due = world.tick + Math.max(1, Math.round(wait * TICK_RATE));
    this.arm(key, st);
    this.saved.dirty = true;
  }

  /** Why nothing lands at (x, z) for a circuit, or "": the place itself (server/supply/ground.ts), or a live drop too near. */
  siteFault(x: number, z: number): string {
    const { world, rules } = this.ctx;
    for (const d of this.drops) if (d.left === 0 && Math.hypot(d.x - x, d.z - z) < APART) return "taken";
    const fit: FitOptions = { onBuilt: rules.on("AllowCrateSpawnsOnTopOfStructures"), baseExclusion: this.ctx.book.book.rules.baseExclusion };
    return siteFault(world, x, z, fit);
  }

  /**
   * A place for a circuit's drop: one of its sites drawn by weight among those within the book's reach of a survivor,
   * or, for a circuit with no sites and under RandomSupplyCratePoints, open ground within that reach (and within the
   * circuit's area, where it has one). Null if none tried is fit.
   */
  private place(c: CircuitDoc, rng: Rng, eyes: readonly { x: number; z: number }[]): { x: number; z: number; site: string } | null {
    const { world, rules } = this.ctx;
    const reach = this.ctx.book.book.rules.reach ?? REACH;
    // With nobody in the world there is nobody to be near: a book that calls drops for nobody calls them anywhere.
    const near = (x: number, z: number): boolean => reach <= 0 || eyes.length === 0 || eyes.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= reach * reach);
    if (c.sites.length > 0 && !rules.on("RandomSupplyCratePoints")) {
      const pool: SiteDoc[] = [];
      for (const k of c.sites) {
        const s = this.siteByKey.get(k);
        if (s && near(s.x, s.z)) pool.push(s);
      }
      for (let t = 0; t < SITE_DRAWS && pool.length > 0; t++) {
        let total = 0;
        for (const s of pool) total += s.weight ?? 1;
        let pick = rng.float() * total;
        let at = pool.findIndex((s) => (pick -= s.weight ?? 1) < 0);
        if (at < 0) at = pool.length - 1;
        const [s] = pool.splice(at, 1);
        if (this.siteFault(s!.x, s!.z) === "") return { x: s!.x, z: s!.z, site: s!.key };
      }
      return null;
    }
    for (let t = 0; t < OPEN_DRAWS; t++) {
      // A point in a disc, with no sine: drawn in its square until it falls inside.
      let dx = 0;
      let dz = 0;
      do {
        dx = rng.range(-1, 1);
        dz = rng.range(-1, 1);
      } while (dx * dx + dz * dz > 1);
      let x: number;
      let z: number;
      if (c.area) {
        x = c.area.at[0] + dx * c.area.radius;
        z = c.area.at[1] + dz * c.area.radius;
      } else if (reach > 0 && eyes.length > 0) {
        const eye = eyes[rng.int(eyes.length)]!;
        x = eye.x + dx * reach;
        z = eye.z + dz * reach;
      } else {
        x = (dx * 0.5 + 0.5) * world.hf.sizeX;
        z = (dz * 0.5 + 0.5) * world.hf.sizeZ;
      }
      x = Math.round(x);
      z = Math.round(z);
      if (near(x, z) && this.siteFault(x, z) === "") return { x, z, site: "" };
    }
    return null;
  }

  /**
   * Why nothing may be built at (x, z), or "": on a PvE server nothing is built near a place drops land at, as on
   * ARK's, unless PvEAllowStructuresAtSupplyDrops. A place drops land at is a site some circuit names (plan).
   */
  buildFault(x: number, z: number): string {
    const { rules } = this.ctx;
    if (!rules.on("serverPVE") || rules.on("PvEAllowStructuresAtSupplyDrops")) return "";
    if (this.planned !== this.ctx.book.book) this.plan();
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const s of this.siteGrid.get(j * 65536 + i) ?? []) if (Math.hypot(s.x - x, s.z - z) < SITE_CLEAR) return `Supply drops land here: nothing can be built within ${SITE_CLEAR} m of the place.`;
      }
    }
    return "";
  }

  /**
   * Once a tick. A capsule emptied by a hand that shut it in the same tick, or by anything that is not a session, would
   * lie empty until its time was up (Death removes an emptied prop only while somebody has it open): it leaves now.
   */
  step(): void {
    const { records, death } = this.ctx;
    // A book saved since the last tick: its circuits and sites are taken up.
    if (this.planned !== this.ctx.book.book) this.plan();
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
    // In a world younger than a flight it left at the world's first tick, and flies the faster.
    d.release = Math.max(0, land - flight);
    d.brake = Math.max(1, Math.min(d.brake, land - d.release - 1));
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
    this.note(`drop ${d.id} gone: ${why}`);
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
    // ARK's override for the tier wins. A table the book no longer has gives nothing, and a drop of nothing does not land.
    const over = this.overrides.get(d.tierKey)?.[d.ringed ? "ringed" : "plain"];
    const rolled = over ? this.rollArk(over, rng) : table ? rollTable(table, d.ringed, rng, this.catalog, table.dormant) : [];
    const box = records.create(this.capsule, fitBytes(supplyName(d.tierName, d.clsName, d.ringed), MAX_OPEN_NAME_BYTES));
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
      this.note(`drop ${d.id} gone: it had nothing to hold`);
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
    this.note(`drop ${d.id} landed: ${d.ringed ? "ringed " : ""}${d.tierKey} ${d.clsKey} at ${d.x.toFixed(0)} ${d.z.toFixed(0)}, ${items.inv(box).used()} stacks`);
  }

  /** A line for the log, which keeps its last two hundred. */
  private note(what: string): void {
    this.log.push({ tick: this.ctx.world.tick, what });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  /** A roll of one of ARK's tables, its quality multiplied as the book's is, and left off what quality does nothing for. */
  private rollArk(def: LootDef, rng: Rng): LootDrop[] {
    const quality = this.ctx.rules.num("SupplyCrateLootQualityMultiplier");
    let use = def;
    if (quality !== 1) {
      const have = this.scaled.get(def);
      if (have?.quality === quality) use = have.def;
      else {
        use = { ...def, from: def.from.map((s) => ({ ...s, entries: s.entries.map((e) => (e.quality ? { ...e, quality: [e.quality[0] * quality, e.quality[1] * quality] as const } : e)) })) };
        this.scaled.set(def, { quality, def: use });
      }
    }
    const { catalog } = this;
    return rollLoot(use, rng, (id) => catalog.byId.get(id)?.index ?? 0, catalog.blueprints).map((r) => (catalog.byIndex[r.item]?.quality ? r : { ...r, quality: 0, rating: 0 }));
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
    this.note(`drop ${d.id} first opened by ${c.name}`);
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
    this.note(`drop ${d.id} gone: ${why}`);
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

  /**
   * The drops as a session is told of them, with what each tier and class among them shows. A message carries
   * SUPPLY_ROWS rows, which is every drop that is live and nearly as many again that are leaving; where there are more
   * than that leaving (an admin clearing the map over and over), those longest gone are left out, whose going has been
   * seen the longest. A live drop is never left out.
   */
  list(): SupplyList {
    let told: readonly Drop[] = this.drops;
    if (told.length > SUPPLY_ROWS) {
      const going = told.filter((d) => d.left > 0).sort((a, b) => b.left - a.left || b.id - a.id);
      const kept = new Set(going.slice(0, Math.max(0, SUPPLY_ROWS - (told.length - going.length))));
      told = told.filter((d) => d.left === 0 || kept.has(d)).slice(0, SUPPLY_ROWS);
    }
    const list: SupplyList = { tiers: [], classes: [], rows: [] };
    for (const d of told) {
      // Names as the wire carries them, so that two a message would write alike are one line of its legend.
      const [tierName, clsName] = [fitBytes(d.tierName, SUPPLY_NAME_BYTES), fitBytes(d.clsName, SUPPLY_NAME_BYTES)];
      let tier = list.tiers.findIndex((t) => t.name === tierName && t.rgb === d.rgb && t.level === d.level && t.count === d.count);
      if (tier < 0) tier = list.tiers.push({ name: tierName, rgb: d.rgb, level: d.level, count: d.count }) - 1;
      let cls = list.classes.findIndex((k) => k.name === clsName && k.mark === d.mark);
      if (cls < 0) cls = list.classes.push({ name: clsName, mark: d.mark }) - 1;
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
    const circuits: Record<string, [number, number]> = {};
    for (const [key, st] of this.circuits) circuits[key] = [st.due, st.n];
    return JSON.stringify({ n: this.n, next: this.nextId, drops, circuits });
  }

  /**
   * Call once, after the world's records are in and placed. Takes up the saved drops and checks them against the
   * capsules, both ways: a save that was committed has a capsule for each landed drop and a drop for each capsule.
   */
  begin(saved: string | null): void {
    const { world, records, death, deadlines } = this.ctx;
    const was = JSON.parse(saved ?? "{}") as { n?: number; next?: number; drops?: Saved[]; circuits?: Record<string, [number, number]> };
    for (const [key, [due, n]] of Object.entries(was.circuits ?? {})) this.circuits.set(key, { due, n, stamp: 0, why: "" });
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
    this.plan();
    this.saved.dirty = this.mended > 0;
    this.version++;
  }

  private tagged(rec: EntityRecord | undefined, id: number): boolean {
    const tag = rec?.kind === this.capsule ? rec.extra.get(SUPPLY_TAG) : undefined;
    return !!tag && tag.length === 2 && (tag[0]! | (tag[1]! << 8)) === id;
  }
}
