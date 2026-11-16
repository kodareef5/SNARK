// Nothing steps a fire. A lit one is a record with a `fire` and one deadline, the tick its fuel runs out or its next
// lane's unit ends, and shared/sim/station.ts advances it when someone opens it or the deadline comes. Lit and out are
// the row's kind.
//
// Crafting at a station is a job on the station's record (Progression.craftAt): its ingredients come from the station's
// slots and its product lands there. A session that has a station open is told its queue (sendStation).
//
// A station that names its own fuel (StructureDef.burns, Registry.stationFuel) burns only that, at its own times; any other
// burns every item's own fuel. Whatever must happen when a station is lit or goes out registers on onSwap.
//
// A fire also makes by itself what is `fired` at it (the refining forge's ingots and gasoline), each recipe in its own lane
// at once, while it burns and the ingredients lie in it: no job, no engram, no experience. A unit's ingredients are spent
// and its product made when it is done. The fire's deadline is then the earlier of its fuel running out and the next
// lane's unit ending. What a piece of fuel leaves when it burns out (wood's charcoal) is put in it, or lost with no room.
// A fire that does not cook (`cooks: false`) leaves raw meat raw. One that must stay dry is not lit with its foot under water.

import { OWN_STATION, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import type { ItemDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { FLAG_BLUEPRINT } from "../shared/sim/items.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import type { Client, GameServer } from "./game.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { burn, type Hearth, type Lane } from "../shared/sim/station.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Registry } from "../shared/content/registry.ts";
import type { ServerWorld } from "./world.ts";

/**
 * Told when a station is lit or goes out: its record, the tick it happened (the tick its fuel ran out, worked out by the fire,
 * or the tick it was lit or put out), and the structure kinds it was and is.
 */
export type SwapListener = (rec: EntityRecord, t: number, from: number, to: number) => void;

export const DEADLINE_FIRE = 6;

/** A recipe a fire makes by itself: what one unit needs (content indices and counts), the ticks it takes, and how many it makes. */
interface Refined {
  item: number;
  needs: readonly (readonly [item: number, count: number])[];
  ticks: number;
  makes: number;
}

/** Per registry, each station base kind's fired recipes in content order, and each fired item's recipe. */
const refinedOf = new WeakMap<Registry, { byBase: Map<number, Refined[]>; byItem: Map<number, Refined> }>();

function refining(reg: Registry): { byBase: Map<number, Refined[]>; byItem: Map<number, Refined> } {
  let got = refinedOf.get(reg);
  if (got) return got;
  got = { byBase: new Map(), byItem: new Map() };
  for (let i = 0; i < reg.firedAt.length; i++) {
    const base = reg.firedAt[i]!;
    if (base === 0) continue;
    const craft = (reg.defs[i] as ItemDef).craft!;
    const r: Refined = { item: i, needs: craft.needs.map((n) => [reg.index.get(n.item)!, n.count] as const), ticks: Math.max(1, Math.round(craft.seconds * TICK_RATE)), makes: craft.count ?? 1 };
    const list = got.byBase.get(base) ?? [];
    list.push(r);
    got.byBase.set(base, list);
    got.byItem.set(i, r);
  }
  refinedOf.set(reg, got);
  return got;
}

const NONE: readonly number[] = [];

/** A box's middle and its four corners, in halves of its sides along the frame's axes. */
const CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The ticks a unit of `r` takes in `rec`, or 0 if its ingredients are not all there. */
function needOf(rec: EntityRecord, r: Refined): number {
  const inv = rec.inv;
  if (!inv) return 0;
  for (const [item, n] of r.needs) if (inv.total(item) < n) return 0;
  return r.ticks;
}

/** The tick the unit of `lane` in the station `rec` is done, or 0 if it waits: for its ingredients, or for room. */
function laneEnd(reg: Registry, rec: EntityRecord, lane: Lane): number {
  const fire = rec.fire;
  const r = refining(reg).byItem.get(lane.item);
  if (!fire || !r || reg.firedAt[lane.item] !== reg.stationBase[rec.kind]) return 0;
  const need = needOf(rec, r);
  return need > 0 && lane.ticks < need ? fire.at + need - lane.ticks : 0;
}

export class Stations {
  /** Counters. `wentOut` counts only fires that ran out of fuel. */
  lit = 0;
  wentOut = 0;
  cooked = 0;
  /** Units a fire made by itself, and pieces of fuel that left something. */
  refined = 0;
  left = 0;
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly fixtures: Fixtures;
  private readonly deadlines: DeadlineHeap;
  /**
   * Ticks one of each item burns, in any fire and in a station that names its own fuel. They are the registry's tables,
   * except while refuel() runs with the old ones.
   */
  private fuelTicks: Uint32Array;
  private stationFuel: readonly (Uint32Array | null)[];
  private readonly swapped: SwapListener[] = [];
  /** The record `hearth` works on while tend() runs, else null. */
  private rec: EntityRecord | null = null;
  private readonly hearth: Hearth;

  constructor(world: ServerWorld, records: Records, items: Items, fixtures: Fixtures, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.items = items;
    this.fixtures = fixtures;
    this.deadlines = deadlines;
    const reg = world.reg;
    this.fuelTicks = reg.fuelTicks;
    this.stationFuel = reg.stationFuel;
    // A blueprint is never burnt or cooked (D417): the first slot is the first of the items themselves.
    const first = (of: Uint16Array | Uint32Array): number => {
      const inv = this.rec!.inv!;
      for (let s = 0; s < inv.bag; s++) if (inv.count[s]! > 0 && of[inv.item[s]!] !== 0 && (inv.flags[s]! & FLAG_BLUEPRINT) === 0) return s;
      return -1;
    };
    let fed = 0;
    /** The fired recipes of the station `hearth` works on. */
    const lanes = (): Refined[] => refining(this.world.reg).byBase.get(this.world.reg.stationBase[this.rec!.kind]!) ?? [];
    this.hearth = {
      settle: (t) => items.spoilTo(this.rec!, t),
      spoils: () => {
        // Settled to the fire's tick, every clock still set is after it.
        const inv = this.rec!.inv!;
        let next = 0;
        for (let s = 0; s < inv.cap; s++) {
          const at = inv.spoilAt[s]!;
          if (at !== 0 && inv.item[s] !== 0 && (next === 0 || at < next)) next = at;
        }
        return next;
      },
      feed: () => {
        const fuel = this.fuelOf(this.rec!);
        const s = first(fuel);
        fed = 0;
        if (s < 0) return 0;
        fed = this.rec!.inv!.item[s]!;
        const ticks = fuel[fed]!;
        items.burn(this.rec!, s, 1, true);
        return ticks;
      },
      fed: () => fed,
      burnt: (piece, t) => {
        const into = this.world.reg.burnsInto[piece]!;
        if (into !== 0 && items.mint(this.rec!, into, 1, 0, 0, t) > 0) this.left++;
      },
      lanes: () => {
        const list = lanes();
        return list.length === 0 ? NONE : list.map((r) => r.item);
      },
      laneNeed: (k) => needOf(this.rec!, lanes()[k]!),
      laneDone: (k, t) => {
        const r = lanes()[k]!;
        const rec = this.rec!;
        const inv = rec.inv!;
        if (needOf(rec, r) === 0) return true;
        // With no room for what it makes, nothing is spent: the unit waits, done, as cooked meat does.
        if (inv.room(r.item, 0, items.table) < r.makes) return false;
        items.mint(rec, r.item, r.makes, 0, 0, t, "craft");
        for (const [item, n] of r.needs) {
          let want = n;
          for (let s = inv.bag - 1; s >= 0 && want > 0; s--) {
            if (inv.item[s] !== item || (inv.flags[s]! & FLAG_BLUEPRINT) !== 0 || inv.count[s]! === 0) continue;
            const take = Math.min(want, inv.count[s]!);
            items.burn(rec, s, take, true);
            want -= take;
          }
        }
        this.refined++;
        return true;
      },
      waiting: () => {
        // A station that does not cook (`cooks: false`: the forge, the preserving bin) has nothing waiting over it (M1).
        if (this.world.reg.stationCooks[this.rec!.kind] === 0) return 0;
        const s = first(reg.cooksInto);
        return s < 0 ? 0 : reg.cookTicks[this.rec!.inv!.item[s]!]!;
      },
      done: (t) => {
        const s = first(reg.cooksInto);
        if (s < 0) return true;
        // Mint the cooked item first, so nothing is lost if there is no room for it.
        if (items.mint(this.rec!, reg.cooksInto[this.rec!.inv!.item[s]!]!, 1, 0, 0, t) === 0) return false;
        items.burn(this.rec!, first(reg.cooksInto), 1, true);
        this.cooked++;
        return true;
      },
    };
    items.onFire = (rec) => this.tend(rec);
  }

  /**
   * For a save made when fuel burned `was` times its base time, where it now burns `is` times. Every fire is first
   * advanced to this tick by the old table (`old`). Then the time left on each burning piece is scaled by is / was.
   * Call it before Items.respoil.
   */
  refuel(old: Pick<Registry, "fuelTicks" | "stationFuel">, was: number, is: number): void {
    this.fuelTicks = old.fuelTicks;
    this.stationFuel = old.stationFuel;
    for (const rec of this.records.byPid.values()) if (rec.fire && rec.at >= 0) this.tend(rec);
    this.fuelTicks = this.world.reg.fuelTicks;
    this.stationFuel = this.world.reg.stationFuel;
    for (const rec of this.records.byPid.values()) {
      const fire = rec.fire;
      if (!fire || fire.fuel <= 0) continue;
      fire.fuel = leftAtPeriod(fire.fuel, was, is);
      this.records.dirty.add(rec.pid);
    }
  }

  /** Call after a load. Every burning fire gets its deadline again. */
  resume(): void {
    for (const rec of this.records.byPid.values()) if (rec.fire && rec.at >= 0) this.schedule(rec);
  }

  /** Calls `fn` each time a station is lit or goes out, after its kind has changed. */
  onSwap(fn: SwapListener): void {
    this.swapped.push(fn);
  }

  /** The ticks one of each item burns in this record's station: its own fuel table, or every item's own. */
  private fuelOf(rec: EntityRecord): Uint32Array {
    return this.stationFuel[rec.kind] ?? this.fuelTicks;
  }

  /** Ticks of fuel in the fire's inventory, not counting the piece now burning nor a blueprint, which is never burnt. */
  private pile(rec: EntityRecord): number {
    const inv = rec.inv;
    const fuel = this.fuelOf(rec);
    let ticks = 0;
    for (let s = 0; inv && s < inv.bag; s++) if ((inv.flags[s]! & FLAG_BLUEPRINT) === 0) ticks += inv.count[s]! * fuel[inv.item[s]!]!;
    return ticks;
  }

  private schedule(rec: EntityRecord): void {
    const fire = rec.fire!;
    const out = fire.at + fire.fuel + this.pile(rec);
    fire.out = out;
    // A lane's unit ending first comes due first, so a fire nobody opens makes its units and goes out at the right ticks.
    let due = out;
    for (const lane of fire.lanes ?? []) {
      const end = laneEnd(this.world.reg, rec, lane);
      if (end > 0 && end < due) due = end;
    }
    if (due === fire.due) return;
    fire.due = due;
    this.deadlines.push(due, DEADLINE_FIRE, rec.pid, due);
  }

  /** Advances a burning fire to now. If its fuel ran out on the way, it is out as of that tick. */
  tend(rec: EntityRecord): void {
    const fire = rec.fire;
    if (!fire || this.rec !== null || !rec.inv) return;
    const now = this.world.tick;
    if (fire.at < now || fire.fuel === 0) {
      this.rec = rec;
      const out = burn(fire, this.hearth, now);
      this.rec = null;
      this.records.dirty.add(rec.pid);
      if (out >= 0) {
        this.wentOut++;
        this.quench(rec, out);
        return;
      }
    }
    this.schedule(rec);
  }

  /** Puts the fire out as of tick `at`. */
  private quench(rec: EntityRecord, at: number): void {
    rec.fire = null;
    this.records.dirty.add(rec.pid);
    const reg = this.world.reg;
    const t = this.world.structs.chunks[Math.floor(rec.at / 65536)];
    const kind = t ? t.kind[rec.at & 0xffff]! : 0;
    if (rec.at >= 0 && reg.burning[kind] === 1) {
      this.world.structs.swap(rec.at, reg.lights[kind]!);
      rec.kind = reg.lights[kind]!;
      this.swap(rec, at, kind, rec.kind);
    }
  }

  private swap(rec: EntityRecord, t: number, from: number, to: number): void {
    for (const fn of this.swapped) fn(rec, t, from, to);
  }

  /** Lighting needs fuel on the fire, and one that must stay dry needs its foot out of the water. Returns a RESULT code. */
  toggle(ref: number): number {
    const reg = this.world.reg;
    const t = this.world.structs.chunks[Math.floor(ref / 65536)];
    const kind = t ? t.kind[ref & 0xffff]! : 0;
    const other = reg.lights[kind]!;
    if (other === 0) return RESULT_INVALID;
    const rec = this.fixtures.ensure(ref);
    const inv = this.items.inv(rec);
    if (rec.fire) {
      // Putting it out loses the burning piece, any cooking progress and what each lane had under way.
      this.quench(rec, this.world.tick);
      return RESULT_OK;
    }
    // The forge "cannot be sitting on a foundation submerged in water" (ark.wiki.gg Refining Forge): one whose foot is below
    // the water's surface, the sea's or a lake's, is not lit.
    if (reg.dry[kind] === 1 && this.footWet(t!, ref & 0xffff, kind)) return RESULT_DENIED;
    if (this.pile(rec) === 0) return RESULT_SHORT;
    // A fire under water cannot be lit (ARK's Campfire and Swimming), in the sea or a lake.
    const slot = ref & 0xffff;
    if (t!.y[slot]! < this.world.hf.waterAt(t!.x[slot]!, t!.z[slot]!)) return RESULT_INVALID;
    void inv;
    rec.fire = { at: this.world.tick, fuel: 0, cook: 0, due: 0, out: 0 };
    this.world.structs.swap(ref, other);
    rec.kind = other;
    this.lit++;
    this.swap(rec, this.world.tick, kind, other);
    this.tend(rec);
    return RESULT_OK;
  }

  /**
   * Whether the foot of the structure in `slot` of `t` is below the surface of the water at its middle or at a corner of
   * its box: the sea's, or a lake's where the box reaches over the lake's squares (hf.waterAt).
   */
  private footWet(t: ChunkTable, slot: number, kind: number): boolean {
    const reg = this.world.reg;
    const hf = this.world.hf;
    const foot = t.y[slot]! - reg.halfY[kind]!;
    frameOf(t.yaw[slot]!);
    // The frame's +X is (cos, -sin) in the world and its +Z is (sin, cos).
    const hx = reg.halfX[kind]! * frame.stretch;
    const hz = reg.halfZ[kind]! * frame.stretch;
    const [x, z, c, s] = [t.x[slot]!, t.z[slot]!, frame.cos, frame.sin];
    for (const [a, b] of CORNERS) if (foot < hf.waterAt(x + a * hx * c + b * hz * s, z - a * hx * s + b * hz * c)) return true;
    return false;
  }

  /** A DEADLINE_FIRE entry came due. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (!rec?.fire || rec.fire.due !== stamp) return;
    // Items.inv() advances the fire, the same path as a player opening it.
    rec.fire.due = 0;
    this.items.inv(rec);
  }
}

/** What each session was last told of its open station: the station's record id, its progVersion, its out tick and its lanes. */
const told = new WeakMap<Client, string>();

/**
 * Tells the session the station it has open (OWN_STATION) when the station, its queue, the tick its fire is due to go out or
 * what its fire makes by itself changed: the station's kind and ref, that tick (0 when it does not burn), its lanes, then its
 * jobs. Kind 0 once, with ref and tick 0 and no lanes or jobs, when what it has open is no longer a station.
 */
export function sendStation(game: GameServer, c: Client, open: EntityRecord | null): void {
  const def = open ? game.world.reg.defs[open.kind] : null;
  const station = open && open.at >= 0 && def?.type === "structure" && def.class === "station" ? open : null;
  const fire = station?.fire ?? null;
  const lanes = (fire?.lanes ?? []).slice(0, 255);
  // The tick each lane's unit is done, worked out from the fire as it was last advanced; 0 says it waits, for what it needs
  // or for room.
  const ends = lanes.map((l) => laneEnd(game.world.reg, station!, l));
  const now = station ? `${station.pid}:${station.progVersion}:${fire ? fire.out : 0}:${lanes.map((l, k) => `${l.item}/${ends[k]}`).join(",")}` : "";
  if (now === (told.get(c) ?? "")) return;
  told.set(c, now);
  const w = game.beginOwn(OWN_STATION);
  w.u16(station ? station.kind : 0);
  w.u32(station ? station.at : 0);
  w.u32(fire ? fire.out : 0);
  w.u8(lanes.length);
  for (let k = 0; k < lanes.length; k++) {
    w.u16(lanes[k]!.item);
    w.u32(ends[k]!);
  }
  const jobs = station ? station.jobs : [];
  w.u8(jobs.length);
  for (const j of jobs) {
    w.u16(j.item);
    w.u8(j.left > 255 ? 255 : j.left);
    w.u32(j.doneAt);
    w.u32(j.rest ?? 0);
  }
  game.endOwn(c);
}
