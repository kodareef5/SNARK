// Nothing steps a fire. A lit one is a record with a `fire` and one deadline, the tick its fuel runs out, and
// shared/sim/station.ts advances it when someone opens it or the deadline comes. Lit and out are the row's kind.
//
// Crafting at a station is a job on the station's record (Progression.craftAt): its ingredients come from the station's
// slots and its product lands there. A session that has a station open is told its queue (sendStation).
//
// A station that names its own fuel (StructureDef.burns, Registry.stationFuel) burns only that, at its own times; any other
// burns every item's own fuel. Whatever must happen when a station is lit or goes out registers on onSwap.

import { OWN_STATION, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import type { Client, GameServer } from "./game.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { burn, type Hearth } from "../shared/sim/station.ts";
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

export class Stations {
  /** Counters. `wentOut` counts only fires that ran out of fuel. */
  lit = 0;
  wentOut = 0;
  cooked = 0;
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
    const first = (of: Uint16Array | Uint32Array): number => {
      const inv = this.rec!.inv!;
      for (let s = 0; s < inv.bag; s++) if (inv.count[s]! > 0 && of[inv.item[s]!] !== 0) return s;
      return -1;
    };
    this.hearth = {
      settle: (t) => items.spoilTo(this.rec!, t),
      feed: () => {
        const fuel = this.fuelOf(this.rec!);
        const s = first(fuel);
        if (s < 0) return 0;
        const ticks = fuel[this.rec!.inv!.item[s]!]!;
        items.burn(this.rec!, s, 1, true);
        return ticks;
      },
      waiting: () => {
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

  /** Ticks of fuel in the fire's inventory, not counting the piece now burning. */
  private pile(rec: EntityRecord): number {
    const inv = rec.inv;
    const fuel = this.fuelOf(rec);
    let ticks = 0;
    for (let s = 0; inv && s < inv.bag; s++) ticks += inv.count[s]! * fuel[inv.item[s]!]!;
    return ticks;
  }

  private schedule(rec: EntityRecord): void {
    const fire = rec.fire!;
    const out = fire.at + fire.fuel + this.pile(rec);
    fire.out = out;
    if (out === fire.due) return;
    fire.due = out;
    this.deadlines.push(out, DEADLINE_FIRE, rec.pid, out);
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

  /** Lighting needs fuel on the fire. Returns a RESULT code. */
  toggle(ref: number): number {
    const reg = this.world.reg;
    const t = this.world.structs.chunks[Math.floor(ref / 65536)];
    const kind = t ? t.kind[ref & 0xffff]! : 0;
    const other = reg.lights[kind]!;
    if (other === 0) return RESULT_INVALID;
    const rec = this.fixtures.ensure(ref);
    const inv = this.items.inv(rec);
    if (rec.fire) {
      // Putting it out loses the burning piece and any cooking progress.
      this.quench(rec, this.world.tick);
      return RESULT_OK;
    }
    if (this.pile(rec) === 0) return RESULT_SHORT;
    void inv;
    rec.fire = { at: this.world.tick, fuel: 0, cook: 0, due: 0, out: 0 };
    this.world.structs.swap(ref, other);
    rec.kind = other;
    this.lit++;
    this.swap(rec, this.world.tick, kind, other);
    this.tend(rec);
    return RESULT_OK;
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
  const lanes = fire?.lanes ?? [];
  const now = station ? `${station.pid}:${station.progVersion}:${fire ? fire.out : 0}:${lanes.map((l) => `${l.item}/${l.ticks}`).join(",")}` : "";
  if (now === (told.get(c) ?? "")) return;
  told.set(c, now);
  const w = game.beginOwn(OWN_STATION);
  w.u16(station ? station.kind : 0);
  w.u32(station ? station.at : 0);
  w.u32(fire ? fire.out : 0);
  // The tick each lane's unit is done is the forge's to work out (planning/reference/stations-plan.md, S1); 0 says it waits.
  const shown = lanes.slice(0, 255);
  w.u8(shown.length);
  for (const l of shown) {
    w.u16(l.item);
    w.u32(0);
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
