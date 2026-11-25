// Map events (planning/workstreams/map-events.md): things that happen to the whole map now and then, called by the
// schedules of the world's event book, by an admin, or by a module. Modules define the kinds (server/api/event.ts):
// each is a set of handlers, and each event a small saved record the engine runs for it. The engine owns what must be
// fast, saved, or the same on every client: the book, the schedules, the lifecycle, the parts (craft, crates, sites),
// the save and its repair at load, and one feed every session is sent on a change and never per tick.
//
// A handler never runs inside a shot or a blast. What happens to a part happens at once; its kind is told in this
// system's own row of the tick, from a queue.

import type { EventKindDef, EventMap, EventsApi, EventInfo, PartView, Plain, Striker } from "../api/event.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashString } from "../../shared/hash.ts";
import { EVENT_MOST, MAPEVENT_MOST, eventBookFaults, inHours, kindOn, sheetFaults, starterEventBook, type EventBook, type KindSheet, type ScheduleDoc } from "../../shared/mapevent/book.ts";
import { tunedOf, type FieldValue, type Fields } from "../../shared/mapevent/fields.ts";
import { ASSET_ID, DAMAGE_KINDS, PARTS_MOST, craftFault, crateFault, siteFault, type ColumnLook, type CraftSpec, type CrateSpec, type SiteSpec } from "../../shared/mapevent/parts.ts";
import { MAPEVENT_BYTES, MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE, MAPEVENT_ROWS, lookKey, writeMapEvents, type Look, type MapEventFeed, type MapEventRow, type PartRow } from "../../shared/mapevent/wire.ts";
import { BitWriter, fitBytes } from "../../shared/net/codec.ts";
import { MAX_OPEN_NAME_BYTES, S_MAPEVENT, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { MADE_METAL, SURFACE_GROUND, SURFACE_WATER } from "../../shared/net/rockets.ts";
import { Rng } from "../../shared/rng.ts";
import { lowAt, newCraftPose, type PathPoint } from "../../shared/sim/craft.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import type { DeadlineHeap } from "../../shared/sim/schedule.ts";
import { tableKey } from "../../shared/supply/book.ts";
import { catalogOf, type Catalog } from "../../shared/supply/catalog.ts";
import { rollTable } from "../../shared/supply/compile.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Combat, Source } from "../combat.ts";
import type { Death } from "../death.ts";
import { event, type Bus } from "../events/bus.ts";
import type { Client, GameServer } from "../game.ts";
import type { Items } from "../items.ts";
import type { Projectiles } from "../projectiles.ts";
import type { EntityRecord, Records } from "../records.ts";
import type { SkyTaken } from "../sky.ts";
import type { BookKind, Store } from "../supply/store.ts";
import type { Supply } from "../supply.ts";
import { worldHour, type ServerWorld } from "../world.ts";
import { CraftSky, craftPose, craftState, fall, loadCraft, makeCraft, saveCraft, stageOf, strike, type Craft, type SavedCraft } from "./craft.ts";
import { Run, type Preview, type RunHost } from "./run.ts";

/** The key in a crate's record's `extra` under which it carries its event's id (two bytes, low first) and its part's id. */
export const MAPEVENT_TAG = 0x657674;
/** Added to the world's seed for the events' draws, as each system that rolls takes a number of its own. */
const SEED = 113;
/** A schedule's deadline carries this and its place in the order the schedules were first met. */
const SCHEDULE_BASE = 0x10000;
/** Seconds an event that has ended is still told of, so its going is seen. */
export const ENDED_SECONDS = 15;
/** Seconds before a schedule that called nothing because nobody was there, or out of its hours, looks again. */
export const RETRY_SECONDS = 300;
/** The longest an event lasts after it comes where its kind does not say. */
const MAX_SECONDS = 2 * 3600;
/** A kind whose handlers throw this many times running is switched off. */
const THROWS_MOST = 8;
/** A handler longer than this, in milliseconds, is logged. */
const SLOW_MS = 2;
/** Handlers run in one tick at the most, so a kind that calls itself in a ring cannot hold the tick. */
const DRAIN_MOST = 64;
/** Characters of a bag as JSON at the most. */
const BAG_MOST = 16 * 1024;
/** Parts one event makes in its life at the most: ids are a byte. */
const PART_IDS = 255;
/** Ticks at the least between marking the save dirty for blows, which change a craft's health many times a second. */
const DIRTY_EVERY = 5 * TICK_RATE;
/** Places a call may ask to be near. */
const NEAR_MOST = 16;

const CALL = event("mapevent.call");
const CALLED = event("mapevent.called");
const STARTED = event("mapevent.started");
const ENDED = event("mapevent.ended");
const DAMAGE = event("mapevent.damage");
const CRAFT_DOWN = event("mapevent.craftDown");
const CRAFT_REST = event("mapevent.craftRest");
const CRATE = event("mapevent.crate");
const CRATE_EMPTIED = event("mapevent.crateEmptied");

const DAMAGE_NAMES: string[] = [];
for (const [name, index] of Object.entries(DAMAGE_KINDS)) DAMAGE_NAMES[index] = name;

/** A crate of an event: its record, and the tick it goes by its time. */
export interface EventCrate {
  readonly id: number;
  readonly pid: number;
  readonly until: number;
}

/** A site of an event: where, its column, and the ticks it shows from and to (0 for as long as its event). */
export interface EventSite {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  from: number;
  to: number;
  readonly column: ColumnLook;
  readonly lookKey: string;
}

/** An event as the engine keeps it. */
export interface MapEvent {
  id: number;
  readonly kind: string;
  /** The module that defined its kind when it was called, and that kind's version. */
  readonly module: string;
  readonly version: number;
  state: number;
  readonly called: number;
  start: number;
  ended: number;
  /** The tick the server ends it whatever it is doing. */
  until: number;
  readonly schedule: string;
  readonly source: string;
  /** Which call of the world's it is, and its seed. */
  readonly n: number;
  readonly seed: number;
  tuned: Record<string, FieldValue>;
  bag: Record<string, Plain>;
  phases: { name: string; at: number }[];
  /** Handlers of it run so far, which each handler's draws are made from. */
  calls: number;
  /** The id its next part takes. */
  next: number;
  crafts: Craft[];
  crates: EventCrate[];
  sites: EventSite[];
  /** Crates its start asked for, made as it comes. */
  waiting: { id: number; spec: CrateSpec }[];
  /** The places the call asked it to be near, or null for where survivors stand. */
  readonly near: { x: number; z: number }[] | null;
  /** Lines its start asked to tell, told as the call is made. */
  told: string[];
  /** Before the call is made, while its start runs. */
  staging: boolean;
}

export interface CallOptions {
  source: string;
  schedule?: string;
  /** Seconds from now to its coming, in place of its kind's. */
  notice?: number;
  /** Places it is to be near, in place of where survivors stand. */
  near?: readonly { x: number; z: number }[];
  /** A seed in place of the one the world's draws give: a preview, made real. */
  seed?: number;
}

export interface ScheduleState {
  due: number;
  n: number;
  stamp: number;
  why: string;
}

/** A kind as the engine keeps it: its definition, the module that gave it, and how its handlers have fared. */
export interface Kind {
  readonly def: EventKindDef<Fields>;
  readonly module: string;
  readonly sheet: KindSheet;
  throws: number;
  /** Switched off for throwing: its events run out on what they have, and nothing calls it. */
  off: boolean;
  calls: number;
  ms: number;
  worst: number;
}

export interface MapEventContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  items: Items;
  death: Death;
  combat: Combat;
  projectiles: Projectiles;
  supply: Supply;
  deadlines: DeadlineHeap;
  bus: Bus;
  seed: number;
  say: (line: string) => void;
  /** A clock for timing handlers, in milliseconds. Without it nothing is timed. */
  now?: () => number;
}

type SavedEvent = Omit<MapEvent, "crafts" | "told" | "staging"> & { crafts: SavedCraft[] };

const NONE: SkyTaken = { taken: 0, blocked: false, killed: false };

export class MapEvents implements RunHost {
  /** Coming, live, and those that have just ended, oldest first. */
  readonly events: MapEvent[] = [];
  readonly kinds = new Map<string, Kind>();
  readonly schedules = new Map<string, ScheduleState>();
  /** Saved events and crates put right at load. A save that was committed needs none. */
  mended = 0;
  calls = 0;
  downs = 0;
  readonly log: { tick: number; what: string }[] = [];
  readonly saved = { dirty: false, serialize: (): string => this.serialize() };
  readonly map: EventMap;
  /** Whether modules are still being set up: nothing is called then. */
  settingUp = true;
  private readonly ctx: MapEventContext;
  private readonly deadline: number;
  private readonly catalog: Catalog;
  private store: Store<EventBook> | null = null;
  private starter: EventBook | null = null;
  private sheetsCache: Map<string, KindSheet> | null = null;
  private readonly skies = new Map<Craft, CraftSky>();
  private readonly queue: { ev: MapEvent; name: string; fn: (run: Run) => void }[] = [];
  private readonly told = new WeakMap<Connection, number>();
  private readonly order: string[] = [];
  private readonly encoded = new BitWriter(MAPEVENT_BYTES);
  private encodedAt = -1;
  private version = 1;
  private n = 0;
  private nextId = 1;
  private stamps = 0;
  private planned: EventBook | null = null;
  private dirtyAt = -Infinity;

  constructor(ctx: MapEventContext) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("mapevent", (a, b, tick) => this.due(a, b, tick));
    this.catalog = catalogOf(ctx.world.reg);
    const hf = ctx.world.hf;
    const structs = ctx.world.structs;
    const clampX = (x: number): number => (x < 0 ? 0 : x > hf.sizeX ? hf.sizeX : x);
    const clampZ = (z: number): number => (z < 0 ? 0 : z > hf.sizeZ ? hf.sizeZ : z);
    this.map = {
      sizeX: hf.sizeX,
      sizeZ: hf.sizeZ,
      top: (x, z, r) => {
        let top = Math.max(hf.heightAt(clampX(x), clampZ(z)), hf.waterAt(clampX(x), clampZ(z)));
        for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) top = Math.max(top, hf.heightAt(clampX(x + ox), clampZ(z + oz)));
        const built = structs.topIn(x - r, z - r, x + r, z + r);
        return built > top ? built : top;
      },
      ground: (x, z) => hf.heightAt(clampX(x), clampZ(z)),
      water: (x, z) => hf.waterAt(clampX(x), clampZ(z)),
    };
  }

  // ---- Kinds ----

  /** Defines a kind for `module`. Throws, saying every fault, if it cannot be defined. */
  define(module: string, def: EventKindDef<Fields>): void {
    if (!this.settingUp) throw new Error(`${module}: map events are defined in setup, not later`);
    if (typeof def !== "object" || def === null) throw new Error(`${module}: a map event's kind is an object`);
    const sheet: KindSheet = { id: def.id, label: def.label, about: def.about, module, fields: def.tuning ?? {}, schedules: (def.schedules ?? []).map((s) => ({ ...s, kind: def.id }) as ScheduleDoc) };
    const faults = sheetFaults(sheet);
    if (typeof def.on?.start !== "function") faults.push(`${def.id}: on.start is a function`);
    for (const [name, fn] of Object.entries(def.on ?? {})) if (typeof fn !== "function") faults.push(`${def.id}: on.${name} is a function`);
    if (def.version !== undefined && !(Number.isInteger(def.version) && def.version >= 1)) faults.push(`${def.id}: a version is a whole number, 1 or more`);
    if (def.notice !== undefined && typeof def.notice !== "function" && !(typeof def.notice === "number" && def.notice >= 0 && def.notice <= 3600)) faults.push(`${def.id}: a notice is 0 to 3,600 seconds, or a function of the tuning`);
    if (def.maxSeconds !== undefined && !(typeof def.maxSeconds === "number" && def.maxSeconds >= 1 && def.maxSeconds <= 24 * 3600)) faults.push(`${def.id}: the longest is 1 to 86,400 seconds`);
    if (def.sound !== undefined && def.sound !== "" && !ASSET_ID.test(def.sound)) faults.push(`${def.id}: a sound's owner is a content id`);
    if (def.check !== undefined && typeof def.check !== "function") faults.push(`${def.id}: check is a function`);
    const had = this.kinds.get(def.id);
    if (had) faults.push(`${def.id}: module ${had.module} defined it already`);
    if (this.kinds.size >= EVENT_MOST.kinds) faults.push(`${EVENT_MOST.kinds} kinds of map event at the most`);
    if (faults.length > 0) throw new Error(`${module}: ${faults.join("; ")}`);
    this.kinds.set(def.id, { def, module, sheet, throws: 0, off: false, calls: 0, ms: 0, worst: 0 });
    this.sheetsCache = null;
  }

  /** Every kind defined now, as data. */
  sheets(): ReadonlyMap<string, KindSheet> {
    if (!this.sheetsCache) this.sheetsCache = new Map([...this.kinds].map(([id, k]) => [id, k.sheet]));
    return this.sheetsCache;
  }

  /** The event book's kind, for its store: its faults against the kinds now, and each kind's own check at save. */
  bookKind(): BookKind {
    return {
      label: "event book",
      bytes: EVENT_MOST.bytes,
      faults: (book, mode) => {
        const out = eventBookFaults(book, this.sheets(), mode);
        if (mode === "load" || typeof book !== "object" || book === null) return out;
        const tuning = (book as Partial<EventBook>).tuning;
        for (const [id, k] of this.kinds) {
          if (!k.def.check) continue;
          try {
            for (const f of k.def.check(tunedOf(k.sheet.fields, tuning?.[id]))) out.push({ path: `tuning.${id}.${f.key}`, message: f.message });
          } catch (err) {
            out.push({ path: `tuning.${id}`, message: `its check threw: ${why(err)}` });
          }
        }
        return out;
      },
    };
  }

  /** The book a world begins with, from the kinds defined now. */
  starterBook(): EventBook {
    return starterEventBook(this.sheets().values());
  }

  get book(): EventBook {
    return this.store?.book ?? (this.starter ??= this.starterBook());
  }

  get(id: number): MapEvent | null {
    return this.events.find((e) => e.id === id) ?? null;
  }

  /** Events coming or live: those that have ended are no longer anybody's to meet. */
  live(): number {
    let n = 0;
    for (const e of this.events) if (e.state !== MAPEVENT_ENDED) n++;
    return n;
  }

  // ---- Calling ----

  /** The seconds of notice a kind gives with this tuning. */
  private noticeOf(k: Kind, tuned: Record<string, FieldValue>): number {
    const n = k.def.notice;
    const seconds = typeof n === "function" ? n(tuned as never) : (n ?? 0);
    return Number.isFinite(seconds) ? Math.max(0, Math.min(3600, seconds)) : 0;
  }

  /** A new event record, not yet called. */
  private record(k: Kind, kind: string, o: CallOptions, seed: number, n: number): MapEvent {
    const tick = this.ctx.world.tick;
    const tuned = tunedOf(k.sheet.fields, this.book.tuning[kind]) as Record<string, FieldValue>;
    const notice = o.notice !== undefined ? Math.max(0, o.notice) : this.noticeOf(k, tuned);
    const start = tick + Math.max(1, Math.round(notice * TICK_RATE));
    return {
      id: 0,
      kind,
      module: k.module,
      version: k.def.version ?? 1,
      state: MAPEVENT_NOTICE,
      called: tick,
      start,
      ended: 0,
      until: start + Math.round((k.def.maxSeconds ?? MAX_SECONDS) * TICK_RATE),
      schedule: o.schedule ?? "",
      source: o.source,
      n,
      seed,
      tuned,
      bag: {},
      phases: [],
      calls: 0,
      next: 1,
      crafts: [],
      crates: [],
      sites: [],
      waiting: [],
      near: o.near ? o.near.slice(0, NEAR_MOST).map((p) => ({ x: p.x, z: p.z })) : null,
      told: [],
      staging: true,
    };
  }

  /** Calls an event of a kind. Returns it, or why it was not called. */
  call(kind: string, o: CallOptions): MapEvent | string {
    if (this.settingUp) return "map events are not called while modules are set up";
    const k = this.kinds.get(kind);
    if (!k) return `there is no map event "${kind}"`;
    if (k.off) return `${kind} is off: its handlers threw ${THROWS_MOST} times running`;
    if (this.live() >= MAPEVENT_MOST) return `${MAPEVENT_MOST} map events are live already`;
    if (this.ctx.bus.n[CALL] !== 0) {
      const refused = this.ctx.bus.before(CALL, { kind, schedule: o.schedule ?? "", source: o.source });
      if (refused !== "") return refused;
    }
    const n = this.n++;
    const seed = o.seed !== undefined ? o.seed >>> 0 : hashString(`${o.schedule ?? ""}/${n}`, (this.ctx.seed + SEED) >>> 0);
    const ev = this.record(k, kind, o, seed, n);
    ev.id = this.takeId();
    // Its start makes its parts; if it throws, nothing of it is made.
    if (!this.invoke(ev, "start", (run) => k.def.on.start(run))) return `${kind} could not start: its start threw (the server's log says why)`;
    ev.staging = false;
    this.events.push(ev);
    this.calls++;
    const { deadlines } = this.ctx;
    deadlines.push(ev.start, this.deadline, ev.id, 0);
    deadlines.push(ev.until, this.deadline, ev.id, 0);
    for (const p of ev.phases) deadlines.push(p.at, this.deadline, ev.id, 0);
    for (const line of ev.told) this.tellAll(line);
    ev.told = [];
    this.ctx.bus.after(CALLED, { id: ev.id, kind, schedule: ev.schedule, source: ev.source, seed: ev.seed, notice: Math.round((ev.start - ev.called) / TICK_RATE) });
    this.note(`event ${ev.id} called: ${kind}, coming in ${Math.round((ev.start - ev.called) / TICK_RATE)} s with ${ev.crafts.length} craft and ${ev.sites.length} sites (${ev.source}${ev.schedule ? ` ${ev.schedule}` : ""}, seed ${ev.seed})`);
    this.changed();
    return ev;
  }

  /**
   * What an event of `kind` called now with `seed` would make: its start run as a preview, nothing made, told or kept.
   * The events page draws it, and a call with the same seed makes the same.
   */
  preview(kind: string, seed: number, near?: readonly { x: number; z: number }[]): Preview | string {
    const k = this.kinds.get(kind);
    if (!k) return `there is no map event "${kind}"`;
    const ev = this.record(k, kind, { source: "preview", near }, seed >>> 0, this.n);
    const preview: Preview = { crafts: [], crates: [], sites: [], notices: [], phases: [] };
    try {
      k.def.on.start(new Run(this, ev, "start", preview));
    } catch (err) {
      return `${kind}'s start threw: ${why(err)}`;
    }
    for (const c of preview.crafts) {
      const bad = craftFault(c.spec);
      if (bad !== "") return `its craft ${c.id}: ${bad}`;
    }
    return preview;
  }

  /** Brings a coming event in now, or `seconds` from now. "" or why not. */
  hurry(ev: MapEvent, seconds = 0): string {
    if (ev.state !== MAPEVENT_NOTICE) return `event ${ev.id} is not coming`;
    const start = this.ctx.world.tick + 1 + Math.max(0, Math.round(seconds * TICK_RATE));
    if (start >= ev.start) return `event ${ev.id} comes sooner than that already`;
    const by = ev.start - start;
    ev.start = start;
    ev.until -= by;
    for (const s of ev.sites) {
      s.from -= by;
      if (s.to > 0) s.to -= by;
    }
    this.ctx.deadlines.push(ev.start, this.deadline, ev.id, 0);
    this.ctx.deadlines.push(ev.until, this.deadline, ev.id, 0);
    this.changed();
    return "";
  }

  /** Ends an event, if it has not ended. */
  cancel(ev: MapEvent, why = "cancelled"): void {
    this.end(ev, why);
  }

  /** Brings every craft of a live event down where it is. How many went down. */
  downAll(ev: MapEvent): number {
    let n = 0;
    if (ev.state !== MAPEVENT_LIVE) return 0;
    for (const c of ev.crafts) {
      if (craftState(c, ev.start, this.ctx.world.tick) !== "flying") continue;
      c.lastBy = 0;
      this.bringDown(ev, c, null);
      n++;
    }
    return n;
  }

  // ---- What modules may do ----

  /** What module `module` is given: every kind, every event, and calls of its own. */
  api(module: string): EventsApi {
    return {
      kinds: () => [...this.kinds.values()].map((k) => ({ id: k.def.id, label: k.def.label, module: k.module })),
      list: () => this.events.map((e) => this.info(e)),
      call: (kind, o = {}) => {
        const made = this.call(kind, { source: module, notice: o.notice, seed: o.seed, near: o.near });
        return typeof made === "string" ? made : made.id;
      },
      cancel: (id, reason) => {
        if (this.settingUp) return "map events are not ended while modules are set up";
        const ev = this.get(id);
        if (!ev || ev.state === MAPEVENT_ENDED) return `no live event ${id}`;
        this.end(ev, reason ?? `cancelled by ${module}`);
        return "";
      },
    };
  }

  info(ev: MapEvent): EventInfo {
    return { id: ev.id, kind: ev.kind, state: (["notice", "live", "ended"] as const)[ev.state]!, called: ev.called, start: ev.start, seed: ev.seed, source: ev.source, schedule: ev.schedule, parts: this.views(ev) };
  }

  // ---- RunHost: what a handler's acts do ----

  tick(): number {
    return this.ctx.world.tick;
  }

  /** Where each survivor in the world stands. */
  places(): { x: number; z: number }[] {
    const { game, world } = this.ctx;
    const out: { x: number; z: number }[] = [];
    for (const c of game.clients) if (c?.active && !c.closed && c.ent >= 0) out.push({ x: world.ents.x[c.ent]!, z: world.ents.z[c.ent]! });
    return out;
  }

  phase(ev: MapEvent, name: string, at: number): void {
    if (ev.state === MAPEVENT_ENDED) throw new Error("the event has ended");
    ev.phases = ev.phases.filter((p) => p.name !== name);
    ev.phases.push({ name, at });
    if (!ev.staging) {
      this.ctx.deadlines.push(at, this.deadline, ev.id, 0);
      this.dirty();
    }
  }

  cancelPhase(ev: MapEvent, name: string): void {
    ev.phases = ev.phases.filter((p) => p.name !== name);
  }

  notice(ev: MapEvent, text: string): void {
    if (ev.staging) ev.told.push(text);
    else this.tellAll(text);
  }

  end(ev: MapEvent, reason: string): void {
    if (ev.staging) throw new Error("an event cannot end before it is called");
    if (ev.state === MAPEVENT_ENDED) return;
    const { world, records, death, bus, deadlines } = this.ctx;
    for (const c of ev.crafts) this.unsky(c);
    for (const crate of ev.crates) {
      const box = records.byPid.get(crate.pid);
      if (box) death.remove(box);
    }
    ev.crates = [];
    ev.waiting = [];
    ev.phases = [];
    if (ev.state === MAPEVENT_NOTICE) ev.start = Math.min(ev.start, world.tick);
    ev.state = MAPEVENT_ENDED;
    ev.ended = Math.max(world.tick, ev.start);
    deadlines.push(ev.ended + ENDED_SECONDS * TICK_RATE, this.deadline, ev.id, 0);
    bus.after(ENDED, { id: ev.id, kind: ev.kind, why: reason });
    this.later(ev, "end", (run) => this.kinds.get(ev.kind)?.def.on.end?.(run, reason));
    this.note(`event ${ev.id} ended: ${reason}`);
    this.changed();
  }

  craft(ev: MapEvent, spec: CraftSpec): number {
    this.mayMake(ev, true);
    const bad = craftFault(spec);
    if (bad !== "") throw new Error(`a craft: ${bad}`);
    // One made after its event came enters no sooner than now.
    const late = ev.staging ? 0 : Math.max(0, this.ctx.world.tick - ev.start);
    const c = makeCraft(this.partId(ev), { ...spec, after: Math.max(spec.after ?? 0, late) });
    ev.crafts.push(c);
    if (!ev.staging) {
      if (ev.state === MAPEVENT_LIVE) this.sky(ev, c);
      this.ctx.deadlines.push(ev.start + c.after + c.ticks + 1, this.deadline, ev.id, 0);
      this.changed();
    }
    return c.id;
  }

  crate(ev: MapEvent, spec: CrateSpec): number {
    if (ev.state === MAPEVENT_ENDED) throw new Error("the event has ended");
    const bad = crateFault(spec);
    if (bad !== "") throw new Error(`a crate: ${bad}`);
    const prop = this.ctx.world.reg.index.get(spec.prop ?? "core:event_crate");
    if (prop === undefined || this.ctx.world.reg.takeOnly[prop] !== 1) throw new Error(`a crate: "${spec.prop}" is no crate of the content`);
    if (ev.crates.length + ev.waiting.length >= PARTS_MOST) throw new Error(`an event has ${PARTS_MOST} crates at once at the most`);
    const id = this.partId(ev);
    if (ev.staging) {
      ev.waiting.push({ id, spec });
      return id;
    }
    return this.makeCrate(ev, id, spec, prop) ? id : 0;
  }

  site(ev: MapEvent, spec: SiteSpec): number {
    this.mayMake(ev, true);
    const bad = siteFault(spec);
    if (bad !== "") throw new Error(`a site: ${bad}`);
    const from = Math.max(ev.start + (spec.after ?? 0), ev.staging ? 0 : this.ctx.world.tick);
    const y = this.map.top(spec.x, spec.z, 0);
    const s: EventSite = { id: this.partId(ev), x: spec.x, y: Math.round(y * 32) / 32, z: spec.z, from, to: spec.ticks ? from + spec.ticks : 0, column: spec.column, lookKey: lookKey({ type: "column", column: spec.column }) };
    ev.sites.push(s);
    if (!ev.staging) {
      if (s.to > 0) this.ctx.deadlines.push(s.to + 1, this.deadline, ev.id, 0);
      this.changed();
    }
    return s.id;
  }

  down(ev: MapEvent, id: number): void {
    const c = ev.crafts.find((x) => x.id === id);
    if (!c || ev.state !== MAPEVENT_LIVE || craftState(c, ev.start, this.ctx.world.tick) !== "flying") return;
    c.lastBy = 0;
    this.bringDown(ev, c, null);
  }

  remove(ev: MapEvent, id: number): void {
    const c = ev.crafts.find((x) => x.id === id);
    if (c && !c.gone) {
      c.gone = true;
      this.unsky(c);
      this.changed();
      return;
    }
    const crate = ev.crates.find((x) => x.id === id);
    if (crate) {
      ev.crates = ev.crates.filter((x) => x !== crate);
      const box = this.ctx.records.byPid.get(crate.pid);
      if (box) this.ctx.death.remove(box);
      this.dirty();
      return;
    }
    ev.waiting = ev.waiting.filter((x) => x.id !== id);
    if (ev.sites.some((s) => s.id === id)) {
      ev.sites = ev.sites.filter((s) => s.id !== id);
      this.changed();
    }
  }

  view(ev: MapEvent, id: number): PartView | null {
    return this.views(ev).find((p) => p.id === id) ?? null;
  }

  views(ev: MapEvent): PartView[] {
    const tick = this.ctx.world.tick;
    const out: PartView[] = [];
    const pose = newCraftPose();
    for (const c of ev.crafts) {
      const state = craftState(c, ev.start, tick);
      craftPose(c, ev.start, tick, pose);
      const sh = c.spec.shield;
      const low = state === "flying" ? lowAt(c.track, (tick - ev.start - c.after) / TICK_RATE) : 0;
      const shield = !sh ? "none" : tick < c.shieldUntil ? "broken" : sh.openWhenLow && low >= 0.5 ? "open" : "closed";
      out.push({ type: "craft", id: c.id, state, x: pose.x, y: pose.y, z: pose.z, low, health: Math.max(0, c.health), most: c.most, shield });
    }
    for (const crate of ev.crates) {
      const box = this.ctx.records.byPid.get(crate.pid);
      if (box) out.push({ type: "crate", id: crate.id, pid: crate.pid, x: box.x, y: box.y, z: box.z, stacks: box.inv ? box.inv.used() : 0 });
    }
    for (const s of ev.sites) out.push({ type: "site", id: s.id, x: s.x, z: s.z });
    return out;
  }

  // ---- The lifecycle ----

  /** A deadline came due: what is due of the event or the schedule it names. */
  private due(a: number, _b: number, tick: number): void {
    if (a >= SCHEDULE_BASE) {
      const key = this.order[a - SCHEDULE_BASE];
      if (key !== undefined) this.look(key, _b);
      return;
    }
    const ev = this.get(a);
    if (ev) this.wake(ev, tick);
  }

  /** Does whatever of `ev` is due at `tick`. A deadline that finds nothing due is one whose time moved. */
  private wake(ev: MapEvent, tick: number): void {
    if (ev.state === MAPEVENT_NOTICE && tick >= ev.start) this.arrive(ev);
    if (ev.state === MAPEVENT_LIVE) {
      for (const c of ev.crafts) {
        if (c.gone) continue;
        if (c.down === 0 && tick > ev.start + c.after + c.ticks) {
          // It flew its path out.
          c.gone = true;
          this.unsky(c);
          this.later(ev, "craftOut", (run) => this.kinds.get(ev.kind)?.def.on.craftOut?.(run, c.id));
          this.changed();
        } else if (c.down > 0 && !c.rested && tick >= c.impact) this.crash(ev, c);
      }
      for (const s of ev.sites) if (s.to > 0 && tick > s.to && ev.sites.includes(s)) ev.sites = ev.sites.filter((x) => x !== s);
      const due = ev.phases.filter((p) => p.at <= tick).sort((p, q) => p.at - q.at);
      if (due.length > 0) {
        ev.phases = ev.phases.filter((p) => p.at > tick);
        for (const p of due) this.later(ev, `phase/${p.name}`, (run) => this.kinds.get(ev.kind)?.def.on.phase?.(run, p.name));
        this.dirty();
      }
      if (tick >= ev.until) this.end(ev, "expired");
    }
    if (ev.state === MAPEVENT_ENDED && tick >= ev.ended + ENDED_SECONDS * TICK_RATE) this.forget(ev);
  }

  /** It comes: its craft are in the sky's hit tests, its crates are made. */
  private arrive(ev: MapEvent): void {
    ev.state = MAPEVENT_LIVE;
    for (const c of ev.crafts) {
      if (c.gone) continue;
      this.sky(ev, c);
      this.ctx.deadlines.push(ev.start + c.after + c.ticks + 1, this.deadline, ev.id, 0);
    }
    for (const s of ev.sites) if (s.to > 0) this.ctx.deadlines.push(s.to + 1, this.deadline, ev.id, 0);
    const waiting = ev.waiting;
    ev.waiting = [];
    for (const w of waiting) this.makeCrate(ev, w.id, w.spec, this.ctx.world.reg.index.get(w.spec.prop ?? "core:event_crate") ?? -1);
    this.ctx.bus.after(STARTED, { id: ev.id, kind: ev.kind, schedule: ev.schedule, source: ev.source });
    this.later(ev, "live", (run) => this.kinds.get(ev.kind)?.def.on.live?.(run));
    this.note(`event ${ev.id} came`);
    this.changed();
  }

  /** A craft is in the sky's hit tests while it flies. */
  private sky(ev: MapEvent, c: Craft): void {
    if (c.gone || c.down > 0 || this.skies.has(c)) return;
    const s = new CraftSky(c, () => ev.start, (src, share, heavy) => this.take(ev, c, src, share, heavy));
    this.skies.set(c, s);
    this.ctx.combat.sky.add(s);
  }

  private unsky(c: Craft): void {
    const s = this.skies.get(c);
    if (!s) return;
    this.ctx.combat.sky.remove(s);
    this.skies.delete(c);
  }

  /** A blow on a craft, from inside a shot or a blast. Its kind hears of it later. */
  private take(ev: MapEvent, c: Craft, src: Source, share: number, heavy: boolean): SkyTaken {
    const { world, bus } = this.ctx;
    const tick = world.tick;
    if (ev.state !== MAPEVENT_LIVE || c.gone || c.down > 0) return NONE;
    let scale = 1;
    if (bus.n[DAMAGE] !== 0) {
      const raw = src.base * src.quality * (src.far ?? 1) * src.draw * share * (c.takes[src.type] ?? 1);
      const data = { id: ev.id, kind: ev.kind, part: c.id, byPid: src.by ? src.by.pid : 0, type: DAMAGE_NAMES[src.type] ?? "", amount: raw, scale: 1 };
      if (bus.before(DAMAGE, data) !== "") return { taken: 0, blocked: true, killed: false };
      scale = typeof data.scale === "number" && Number.isFinite(data.scale) ? Math.max(0, Math.min(100, data.scale)) : 1;
    }
    const got = strike(c, ev.start, tick, src, share, heavy, scale);
    if (got.broke) {
      this.note(`event ${ev.id}: craft ${c.id}'s shield broke`);
      this.changed();
    }
    if (got.killed) this.bringDown(ev, c, src.by);
    else {
      const stage = stageOf(c.health, c.most);
      if (stage !== c.stage) {
        c.stage = stage;
        this.changed();
      }
    }
    if (tick - this.dirtyAt >= DIRTY_EVERY) this.dirty();
    return got;
  }

  /** A craft is brought down: its fall is traced once, and every client is told where it comes to rest. */
  private bringDown(ev: MapEvent, c: Craft, by: EntityRecord | null): void {
    const { world, bus } = this.ctx;
    this.unsky(c);
    c.health = 0;
    fall(c, ev.start, world.tick, world);
    this.downs++;
    this.ctx.deadlines.push(c.impact, this.deadline, ev.id, 0);
    const striker: Striker | null = by ? { pid: by.pid, name: by.name } : c.lastBy ? this.striker(c.lastBy) : null;
    const pose = newCraftPose();
    craftPose(c, ev.start, c.down, pose);
    bus.after(CRAFT_DOWN, { id: ev.id, kind: ev.kind, part: c.id, byPid: striker?.pid ?? 0, x: pose.x, y: pose.y, z: pose.z });
    this.later(ev, "craftDown", (run) => this.kinds.get(ev.kind)?.def.on.craftDown?.(run, c.id, striker));
    this.note(`event ${ev.id}: craft ${c.id} brought down${striker ? ` by ${striker.name}` : ""}, at rest in ${((c.impact - c.down) / TICK_RATE).toFixed(1)} s`);
    this.changed();
  }

  private striker(pid: number): Striker | null {
    const rec = this.ctx.records.byPid.get(pid);
    return rec ? { pid, name: rec.name } : null;
  }

  /** A craft comes to rest: in a blast if its spec says, credited to whoever brought it down. */
  private crash(ev: MapEvent, c: Craft): void {
    const { records, combat, projectiles, bus, world } = this.ctx;
    c.rested = true;
    const crash = c.spec.crash;
    if (crash && crash.radius > 0) {
      const by = c.lastBy ? (records.byPid.get(c.lastBy) ?? null) : null;
      const src: Source = { by, x: c.rx, z: c.rz, item: 0, base: crash.damage, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
      const wet = c.ry <= world.hf.waterAt(c.rx, c.rz) + 0.05;
      projectiles.boom(c.rx, c.ry + c.half, c.rz, crash.radius, by?.name ?? null, undefined, 0, wet ? SURFACE_WATER : SURFACE_GROUND, MADE_METAL);
      combat.blast(src, c.rx, c.ry + c.half, c.rz, crash.radius);
    }
    const at = { x: c.rx, y: c.ry, z: c.rz, hx: c.hx, hz: c.hz };
    bus.after(CRAFT_REST, { id: ev.id, kind: ev.kind, part: c.id, x: c.rx, y: c.ry, z: c.rz });
    this.later(ev, "craftRest", (run) => this.kinds.get(ev.kind)?.def.on.craftRest?.(run, c.id, at));
    this.note(`event ${ev.id}: craft ${c.id} came to rest at ${c.rx.toFixed(0)} ${c.rz.toFixed(0)}`);
    this.changed();
  }

  /** A crate's record, filled and placed. False if nothing rolled for it. */
  private makeCrate(ev: MapEvent, id: number, spec: CrateSpec, prop: number): boolean {
    const { records, items, death, world, bus } = this.ctx;
    if (prop < 0) return false;
    const box = records.create(prop, fitBytes(spec.name, MAX_OPEN_NAME_BYTES));
    box.extra.set(MAPEVENT_TAG, Uint8Array.of(ev.id & 0xff, ev.id >> 8, id));
    const stacks = this.fill(ev, id, box, spec.loot);
    if (stacks === 0) {
      records.delete(box.pid);
      this.note(`event ${ev.id}: crate ${id} had nothing to hold, and was not made`);
      return false;
    }
    const hf = world.hf;
    const x = Math.max(1, Math.min(hf.sizeX - 1, spec.x));
    const z = Math.max(1, Math.min(hf.sizeZ - 1, spec.z));
    box.x = x;
    box.y = this.restAt(x, z);
    box.z = z;
    const until = world.tick + Math.round(spec.seconds * TICK_RATE);
    box.expiresAt = until;
    records.dirty.add(box.pid);
    death.place(box);
    ev.crates.push({ id, pid: box.pid, until });
    bus.after(CRATE, { id: ev.id, kind: ev.kind, part: id, pid: box.pid, x: box.x, y: box.y, z: box.z, stacks: items.inv(box).used() });
    this.note(`event ${ev.id}: crate ${id} holds ${items.inv(box).used()} stacks at ${x.toFixed(0)} ${z.toFixed(0)}`);
    this.dirty();
    return true;
  }

  /** What a crate holds: rolls of the drop book's tables for the tier and classes asked; the tier's floor if they gave nothing. */
  private fill(ev: MapEvent, id: number, box: EntityRecord, loot: CrateSpec["loot"]): number {
    const { items, supply } = this.ctx;
    const compiled = supply.compiled();
    const rng = new Rng(hashString(`crate/${ev.seed}/${id}`, (this.ctx.seed + SEED) >>> 0));
    // The tier asked for, or the highest the drop book has where it has not that one.
    const tiers = compiled.book.tiers;
    const tier = tiers.some((t) => t.key === loot.tier) ? loot.tier : (tiers[tiers.length - 1]?.key ?? "");
    const mint = (list: ReturnType<typeof rollTable>): number => {
      let n = 0;
      for (const r of list) if (items.mint(box, r.item, r.count, r.quality, 0, -1, "mapevent", r.blueprint ? FLAG_BLUEPRINT : 0) > 0) n++;
      return n;
    };
    let stacks = 0;
    let first = null as ReturnType<typeof compiled.tables.get> | null;
    for (let r = 0; r < loot.rolls; r++) {
      const table = compiled.tables.get(tableKey(tier, loot.classes[rng.int(loot.classes.length)]!));
      if (!table) continue;
      first ??= table;
      stacks += mint(rollTable(table, loot.ringed, rng, this.catalog, table.dormant));
    }
    if (stacks === 0 && first?.floor) stacks = mint(rollTable({ ...first, plain: [], ringed: [], fill: null }, false, rng, this.catalog));
    return stacks;
  }

  /** Where something set down at (x, z) rests: on the ground, on what is built there, or on the water. */
  private restAt(x: number, z: number): number {
    const { world } = this.ctx;
    const ground = world.hf.heightAt(x, z);
    const top = ground + 600;
    const hit = castWorld({ hf: world.hf, structs: world.structs }, x, top, z, 0, -1, 0, 650, true);
    return Math.round(Math.max(hit !== HIT_NONE ? top - rayHit.t : ground, world.hf.waterAt(x, z)) * 32) / 32;
  }

  /** Once a tick: its kinds are told what happened, and its crates are looked at. */
  step(): void {
    if (this.planned !== this.book) this.plan();
    const { records, death, world } = this.ctx;
    for (const ev of this.events) {
      if (ev.state !== MAPEVENT_LIVE) continue;
      for (const crate of ev.crates) {
        const box = records.byPid.get(crate.pid);
        if (box && box.inv && box.inv.used() > 0) continue;
        ev.crates = ev.crates.filter((x) => x !== crate);
        this.dirty();
        if (box) {
          death.remove(box);
          this.later(ev, "crateEmptied", (run) => this.kinds.get(ev.kind)?.def.on.crateEmptied?.(run, crate.id));
          this.ctx.bus.after(CRATE_EMPTIED, { id: ev.id, kind: ev.kind, part: crate.id, pid: crate.pid });
        } else {
          const gone = world.tick >= crate.until ? "expired" : "removed";
          this.later(ev, "crateGone", (run) => this.kinds.get(ev.kind)?.def.on.crateGone?.(run, crate.id, gone));
        }
      }
      // An event no kind runs now ends once nothing of it is in the sky or waiting to be taken.
      const k = this.kinds.get(ev.kind);
      if ((!k || k.off) && ev.crates.length === 0 && ev.crafts.every((c) => c.gone || c.rested)) this.end(ev, k ? "its kind is off" : "its kind is not loaded");
    }
    this.drain();
  }

  /** Runs the handlers queued, in order: those they queue in turn too, up to DRAIN_MOST. */
  private drain(): void {
    let ran = 0;
    while (this.queue.length > 0 && ran < DRAIN_MOST) {
      const q = this.queue.shift()!;
      if (!this.events.includes(q.ev)) continue;
      this.invoke(q.ev, q.name, q.fn);
      ran++;
    }
    if (this.queue.length > 0) this.ctx.say(`map events: ${this.queue.length} handlers wait for the next tick`);
  }

  private later(ev: MapEvent, name: string, fn: (run: Run) => void): void {
    const k = this.kinds.get(ev.kind);
    if (!k || k.off) return;
    this.queue.push({ ev, name, fn });
  }

  /** Runs one handler of `ev`'s kind. False if it threw, which is logged, and counted against the kind. */
  private invoke(ev: MapEvent, name: string, fn: (run: Run) => void): boolean {
    const k = this.kinds.get(ev.kind);
    if (!k || k.off) return false;
    const now = this.ctx.now;
    const t0 = now ? now() : 0;
    let ok = true;
    try {
      fn(new Run(this, ev, name));
      k.throws = 0;
    } catch (err) {
      ok = false;
      this.ctx.say(`map event ${ev.kind} (module ${k.module}) threw in ${name}: ${why(err)}`);
      if (++k.throws >= THROWS_MOST) {
        k.off = true;
        this.ctx.say(`map event ${ev.kind} is off: its handlers threw ${THROWS_MOST} times running`);
      }
    }
    ev.calls++;
    k.calls++;
    if (now) {
      const took = now() - t0;
      k.ms += took;
      if (took > k.worst) k.worst = took;
      if (took > SLOW_MS) this.ctx.say(`map event ${ev.kind} took ${took.toFixed(1)} ms in ${name}`);
    }
    if (JSON.stringify(ev.bag).length > BAG_MOST) this.ctx.say(`map event ${ev.kind}: event ${ev.id}'s bag is over ${BAG_MOST} characters`);
    if (!ev.staging) this.dirty();
    return ok;
  }

  private mayMake(ev: MapEvent, feed: boolean): void {
    if (ev.state === MAPEVENT_ENDED) throw new Error("the event has ended");
    if (feed && ev.crafts.filter((c) => !c.gone).length + ev.sites.length >= PARTS_MOST) throw new Error(`an event has ${PARTS_MOST} craft and sites at once at the most`);
  }

  private partId(ev: MapEvent): number {
    if (ev.next > PART_IDS) throw new Error(`an event makes ${PART_IDS} parts in its life at the most`);
    return ev.next++;
  }

  // ---- Schedules ----

  /** Takes the book's schedules up again: one new to it waits its first delay, one gone or off is forgotten. */
  private plan(): void {
    const { world } = this.ctx;
    const book = this.book;
    this.planned = book;
    for (const key of [...this.schedules.keys()]) if (!book.schedules.some((s) => s.key === key && s.on)) this.schedules.delete(key);
    for (const s of book.schedules) {
      if (!s.on) continue;
      let st = this.schedules.get(s.key);
      if (!st) {
        const rng = new Rng(hashString(`${s.key}#first`, (this.ctx.seed + SEED) >>> 0));
        st = { due: world.tick + Math.round(rng.range(s.firstDelay[0], s.firstDelay[1]) * TICK_RATE), n: 0, stamp: 0, why: "" };
        this.schedules.set(s.key, st);
      }
      this.arm(s.key, st);
    }
    this.dirty();
  }

  private arm(key: string, st: ScheduleState): void {
    let at = this.order.indexOf(key);
    if (at < 0) at = this.order.push(key) - 1;
    st.stamp = ++this.stamps;
    this.ctx.deadlines.push(Math.max(st.due, this.ctx.world.tick + 1), this.deadline, SCHEDULE_BASE + at, st.stamp);
  }

  /** Why a schedule would call nothing now, or "". With `rng`, its chance is drawn too. */
  why(s: ScheduleDoc, rng: Rng | null): string {
    const book = this.book;
    const k = this.kinds.get(s.kind);
    if (!k) return `no module defines ${s.kind}`;
    if (k.off) return `${s.kind} is off: its handlers threw`;
    if (!kindOn(book, s.kind)) return `${s.kind} is switched off in the book`;
    let mine = 0;
    for (const e of this.events) if (e.state !== MAPEVENT_ENDED && e.schedule === s.key) mine++;
    if (this.places().length < book.rules.minPlayers) return "nobody is in the world";
    if (this.live() >= Math.min(book.rules.maxLive, MAPEVENT_MOST)) return "the map has all the events it may";
    if (mine >= s.maxLive) return "the schedule has all the events it may";
    if (!inHours(s.hours, worldHour(this.ctx.world))) return "out of its hours";
    if (rng && rng.float() >= s.chance) return "its chance did not fall";
    return "";
  }

  /** A schedule's look: it calls an event of its kind unless the world, the map, the kind or its hours say no. */
  private look(key: string, stamp: number): void {
    const st = this.schedules.get(key);
    if (!st || st.stamp !== stamp) return;
    const s = this.book.schedules.find((v) => v.key === key);
    if (!s || !s.on) {
      this.schedules.delete(key);
      return;
    }
    const rng = new Rng(hashString(`${key}#${st.n}`, (this.ctx.seed + SEED) >>> 0));
    st.n++;
    let why = this.why(s, rng);
    if (why === "") {
      const made = this.call(s.kind, { source: "schedule", schedule: key });
      if (typeof made === "string") why = made;
    }
    st.why = why;
    const wait = why === "nobody is in the world" || why === "out of its hours" ? RETRY_SECONDS : rng.range(s.interval[0], s.interval[1]);
    st.due = this.ctx.world.tick + Math.max(1, Math.round(wait * TICK_RATE));
    this.arm(key, st);
    this.dirty();
  }

  // ---- Telling ----

  private tellAll(line: string): void {
    if (this.book.announce !== "chat") return;
    const { game } = this.ctx;
    for (const c of game.clients) if (c?.active && !c.closed) game.sendText(c, TEXT_NOTICE, line);
  }

  private note(what: string): void {
    this.log.push({ tick: this.ctx.world.tick, what });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  private forget(ev: MapEvent): void {
    const at = this.events.indexOf(ev);
    if (at >= 0) this.events.splice(at, 1);
    for (const c of ev.crafts) this.unsky(c);
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
    this.dirty();
  }

  private dirty(): void {
    this.saved.dirty = true;
    this.dirtyAt = this.ctx.world.tick;
  }

  /** The feed as it stands: those coming and live first, then those that ended, newest first; their parts on the feed. */
  feed(): MapEventFeed {
    const looks: Look[] = [];
    const keys = new Map<string, number>();
    const lookOf = (key: string, look: Look): number => {
      let at = keys.get(key);
      if (at === undefined) {
        at = looks.length;
        looks.push(look);
        keys.set(key, at);
      }
      return at;
    };
    const order = [...this.events.filter((e) => e.state !== MAPEVENT_ENDED), ...this.events.filter((e) => e.state === MAPEVENT_ENDED).sort((a, b) => b.ended - a.ended)];
    const rows: MapEventRow[] = [];
    for (const ev of order.slice(0, MAPEVENT_ROWS)) {
      const parts: PartRow[] = [];
      for (const c of ev.crafts) {
        if (c.gone) continue;
        const look = lookOf(c.lookKey, { type: "craft", craft: c.look });
        parts.push({ type: "craft", id: c.id, look, after: c.after, radius: c.radius, half: c.half, gravity: c.gravity, bleed: c.bleed, points: c.points as PathPoint[], stage: c.stage, shieldUntil: c.shieldUntil, down: c.down, impact: c.impact, rx: c.rx, ry: c.ry, rz: c.rz });
      }
      for (const s of ev.sites) parts.push({ type: "site", id: s.id, look: lookOf(s.lookKey, { type: "column", column: s.column }), x: s.x, y: s.y, z: s.z, from: s.from, to: s.to });
      rows.push({ id: ev.id, kind: ev.kind, sound: this.kinds.get(ev.kind)?.def.sound ?? "", state: ev.state, called: ev.called, start: ev.start, ended: ev.ended, parts });
    }
    return { looks, rows };
  }

  /** The feed's bytes, written again only after a change. Rows that do not fit are left out from the last. */
  private encode(): BitWriter {
    if (this.encodedAt === this.version) return this.encoded;
    const feed = this.feed();
    const w = this.encoded;
    for (;;) {
      w.reset();
      writeMapEvents(w, feed);
      if (!w.overflow || feed.rows.length === 0) break;
      feed.rows.pop();
    }
    this.encodedAt = this.version;
    return w;
  }

  /** Tells a session the events as they stand, if it has not been told since they changed. */
  sync(c: Client): void {
    const told = this.told.get(c.conn);
    if (told === this.version) return;
    // A session told nothing holds no events: an empty list would tell it nothing.
    if (told === undefined && this.events.length === 0) {
      this.told.set(c.conn, this.version);
      return;
    }
    this.ctx.game.begin(S_MAPEVENT).blobOf(this.encode());
    this.ctx.game.endOwn(c);
    this.told.set(c.conn, this.version);
  }

  // ---- The save ----

  private serialize(): string {
    const events: SavedEvent[] = [];
    for (const ev of this.events) {
      if (ev.state === MAPEVENT_ENDED) continue;
      const { crafts, told: _t, staging: _s, ...rest } = ev;
      events.push({ ...rest, crafts: crafts.map(saveCraft) });
    }
    const schedules: Record<string, [number, number]> = {};
    for (const [key, st] of this.schedules) schedules[key] = [st.due, st.n];
    return JSON.stringify({ v: 1, n: this.n, next: this.nextId, events, schedules });
  }

  /**
   * Call once, after modules have defined their kinds and the world's records are in and placed. Takes up the saved
   * events and checks them against their crates both ways. One saved in flight flies on from where its ticks put it.
   */
  begin(saved: string | null, store: Store<EventBook> | null): void {
    this.settingUp = false;
    this.store = store;
    this.starter = null;
    const { world, records, death, deadlines } = this.ctx;
    let was: { n?: number; next?: number; events?: SavedEvent[]; schedules?: Record<string, [number, number]> } = {};
    try {
      was = JSON.parse(saved ?? "{}");
    } catch {
      this.ctx.say("map events: the saved events were not whole JSON, and are dropped");
      this.mended++;
    }
    for (const [key, [due, n]] of Object.entries(was.schedules ?? {})) this.schedules.set(key, { due, n, stamp: 0, why: "" });
    this.n = was.n ?? 0;
    this.nextId = was.next ?? 1;
    const tick = world.tick;
    const claimed = new Set<number>();
    for (const s of was.events ?? []) {
      let ev: MapEvent;
      try {
        ev = { ...s, crafts: s.crafts.map(loadCraft), told: [], staging: false };
      } catch (err) {
        this.ctx.say(`map events: event ${s.id} could not be taken up (${why(err)}), and is dropped`);
        this.mended++;
        continue;
      }
      const k = this.kinds.get(ev.kind);
      if (k) ev.tuned = tunedOf(k.sheet.fields, ev.tuned) as Record<string, FieldValue>;
      ev.crates = ev.crates.filter((crate) => {
        const tag = records.byPid.get(crate.pid)?.extra.get(MAPEVENT_TAG);
        const mine = !!tag && tag.length === 3 && (tag[0]! | (tag[1]! << 8)) === ev.id && tag[2] === crate.id;
        if (mine) claimed.add(crate.pid);
        else this.mended++;
        return mine;
      });
      this.events.push(ev);
      deadlines.push(Math.max(tick + 1, ev.start), this.deadline, ev.id, 0);
      deadlines.push(Math.max(tick + 1, ev.until), this.deadline, ev.id, 0);
      for (const p of ev.phases) deadlines.push(Math.max(tick + 1, p.at), this.deadline, ev.id, 0);
      for (const c of ev.crafts) {
        if (c.down > 0 && !c.rested) deadlines.push(Math.max(tick + 1, c.impact), this.deadline, ev.id, 0);
        else if (c.down === 0 && !c.gone) deadlines.push(Math.max(tick + 1, ev.start + c.after + c.ticks + 1), this.deadline, ev.id, 0);
        if (ev.state === MAPEVENT_LIVE) this.sky(ev, c);
      }
      if (k && !k.off) this.later(ev, "resume", (run) => k.def.on.resume?.(run, s.version));
    }
    for (const rec of [...records.byPid.values()]) {
      if (claimed.has(rec.pid) || !rec.extra.has(MAPEVENT_TAG)) continue;
      this.mended++;
      death.remove(rec);
    }
    if (this.mended > 0) this.ctx.say(`map events: ${this.mended} put right at load, a crate with no event or an event with no crate`);
    this.plan();
    this.saved.dirty = this.mended > 0;
    this.version++;
  }
}

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
