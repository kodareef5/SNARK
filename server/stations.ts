// Fires: burning fuel and cooking, without a step.
//
// A lit campfire is a record with a `fire` on it and one deadline: the tick
// its fuel will run out. Nothing else happens until someone looks into it or
// that deadline comes, and then it is worked out from where it was left, one
// event at a time, by the shared arithmetic (shared/sim/station.ts). What
// lies on it is the record's inventory: fuel is burnt and food cooked through
// the ledger, at the ticks those things happened.
//
// Lit and out are the row's kind, as a door open and shut are.

import { RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { burn, type Hearth } from "../shared/sim/station.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_FIRE = 6;

export class Stations {
  /** Fires lit and fires that went out for want of fuel; things cooked. */
  lit = 0;
  wentOut = 0;
  cooked = 0;
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly fixtures: Fixtures;
  private readonly deadlines: DeadlineHeap;
  /** The fire being worked out, and what lies on it, for `hearth`. */
  private rec: EntityRecord | null = null;
  private readonly hearth: Hearth;

  constructor(world: ServerWorld, records: Records, items: Items, fixtures: Fixtures, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.items = items;
    this.fixtures = fixtures;
    this.deadlines = deadlines;
    const reg = world.reg;
    const first = (of: Uint16Array | Uint32Array): number => {
      const inv = this.rec!.inv!;
      for (let s = 0; s < inv.bag; s++) if (inv.count[s]! > 0 && of[inv.item[s]!] !== 0) return s;
      return -1;
    };
    this.hearth = {
      settle: (t) => items.spoilTo(this.rec!, t),
      feed: () => {
        const s = first(reg.fuelTicks);
        if (s < 0) return 0;
        const ticks = reg.fuelTicks[this.rec!.inv!.item[s]!]!;
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
        // What it becomes first, so that nothing is lost if there is no room for it.
        if (items.mint(this.rec!, reg.cooksInto[this.rec!.inv!.item[s]!]!, 1, 0, 0, t) === 0) return false;
        items.burn(this.rec!, first(reg.cooksInto), 1, true);
        this.cooked++;
        return true;
      },
    };
    items.onFire = (rec) => this.tend(rec);
  }

  /** After a load: every fire that was burning has its deadline again. */
  resume(): void {
    for (const rec of this.records.byPid.values()) if (rec.fire && rec.at >= 0) this.schedule(rec);
  }

  /** Ticks of burning left in what lies on a fire, besides the piece now burning. */
  private pile(rec: EntityRecord): number {
    const inv = rec.inv;
    const fuel = this.world.reg.fuelTicks;
    let ticks = 0;
    for (let s = 0; inv && s < inv.bag; s++) ticks += inv.count[s]! * fuel[inv.item[s]!]!;
    return ticks;
  }

  /** Set the fire's deadline to the tick its fuel runs out, if that is not already when it is due. */
  private schedule(rec: EntityRecord): void {
    const fire = rec.fire!;
    const out = fire.at + fire.fuel + this.pile(rec);
    if (out === fire.due) return;
    fire.due = out;
    this.deadlines.push(out, DEADLINE_FIRE, rec.pid, out);
  }

  /** Work a burning fire out up to now. If its fuel ran out on the way, it is out, as of then. */
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

  /** The fire is out: its record says so, and its row is the kind that does not burn. */
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

  /** Light the fire at `ref`, or put it out if it is burning. Lighting needs fuel on it. Returns a result code. */
  toggle(ref: number): number {
    const reg = this.world.reg;
    const t = this.world.structs.chunks[Math.floor(ref / 65536)];
    const kind = t ? t.kind[ref & 0xffff]! : 0;
    const other = reg.lights[kind]!;
    if (other === 0) return RESULT_INVALID;
    const rec = this.fixtures.ensure(ref);
    const inv = this.items.inv(rec);
    if (rec.fire) {
      // Put out: what was burning is lost, and what was half cooked starts again another time.
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
    // Looked at through the same door everyone uses: it is worked out, and what is on it is then brought up to now.
    rec.fire.due = 0;
    this.items.inv(rec);
  }
}
