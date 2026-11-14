// Nothing steps a fire. A lit one is a record with a `fire` and one deadline, the tick its fuel runs out, and
// shared/sim/station.ts advances it when someone opens it or the deadline comes. Lit and out are the row's kind.

import { RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { burn, type Hearth } from "../shared/sim/station.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

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
  /** Ticks one of each item burns. It is the registry's table, except while refuel() runs with the old one. */
  private fuelTicks: Uint32Array;
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
    const first = (of: Uint16Array | Uint32Array): number => {
      const inv = this.rec!.inv!;
      for (let s = 0; s < inv.bag; s++) if (inv.count[s]! > 0 && of[inv.item[s]!] !== 0) return s;
      return -1;
    };
    this.hearth = {
      settle: (t) => items.spoilTo(this.rec!, t),
      feed: () => {
        const s = first(this.fuelTicks);
        if (s < 0) return 0;
        const ticks = this.fuelTicks[this.rec!.inv!.item[s]!]!;
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
  refuel(old: Uint32Array, was: number, is: number): void {
    this.fuelTicks = old;
    for (const rec of this.records.byPid.values()) if (rec.fire && rec.at >= 0) this.tend(rec);
    this.fuelTicks = this.world.reg.fuelTicks;
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

  /** Ticks of fuel in the fire's inventory, not counting the piece now burning. */
  private pile(rec: EntityRecord): number {
    const inv = rec.inv;
    const fuel = this.fuelTicks;
    let ticks = 0;
    for (let s = 0; inv && s < inv.bag; s++) ticks += inv.count[s]! * fuel[inv.item[s]!]!;
    return ticks;
  }

  private schedule(rec: EntityRecord): void {
    const fire = rec.fire!;
    const out = fire.at + fire.fuel + this.pile(rec);
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
        this.quench(rec);
        return;
      }
    }
    this.schedule(rec);
  }

  private quench(rec: EntityRecord): void {
    rec.fire = null;
    this.records.dirty.add(rec.pid);
    const reg = this.world.reg;
    const t = this.world.structs.chunks[Math.floor(rec.at / 65536)];
    const kind = t ? t.kind[rec.at & 0xffff]! : 0;
    if (rec.at >= 0 && reg.burning[kind] === 1) {
      this.world.structs.swap(rec.at, reg.lights[kind]!);
      rec.kind = reg.lights[kind]!;
    }
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
      this.quench(rec);
      return RESULT_OK;
    }
    if (this.pile(rec) === 0) return RESULT_SHORT;
    void inv;
    rec.fire = { at: this.world.tick, fuel: 0, cook: 0, due: 0 };
    this.world.structs.swap(ref, other);
    rec.kind = other;
    this.lit++;
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
