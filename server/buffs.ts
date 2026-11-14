// Nothing here is stepped. A buff's end is a deadline, and its health and torpor per second are folded into the rates Survival keeps.
// Instances are not saved, so a restart ends them.

import type { BuffDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_BUFF = 5;
/** Instances one record may carry. One more drops the oldest. */
export const MAX_BUFFS = 16;

export interface BuffOn {
  /** Content index. */
  buff: number;
  /** The tick it ends, or 0 if it lasts until taken away. */
  until: number;
  /** Pid of the giver, or 0. The giver gets the kill if the buff kills. */
  by: number;
  /** Torpor per second this instance adds on top of its definition's. A dose carries its strength this way. */
  torpor: number;
}

export class Buffs {
  /** Called when a record's buffs change. Its speed and what clients see of it may have changed. */
  onChange: ((rec: EntityRecord) => void) | null = null;

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly survival: Survival;
  private readonly deadlines: DeadlineHeap;
  /** Pids in survival.gods because of a buff, not put there directly. */
  private readonly immune = new Set<number>();

  constructor(world: ServerWorld, records: Records, survival: Survival, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.survival = survival;
    this.deadlines = deadlines;
  }

  private def(buff: number): BuffDef | null {
    const d = this.world.reg.defs[buff];
    return d?.type === "buff" ? d : null;
  }

  /**
   * `by` is the giver's pid. `seconds` overrides the buff's own time, and 0 or less means until taken away.
   * `torpor` is torpor per second this instance adds. A buff already on is restarted unless it stacks.
   */
  give(rec: EntityRecord, buff: number, by = 0, seconds?: number, torpor = 0): boolean {
    const def = this.def(buff);
    if (!def) return false;
    const lasts = seconds ?? def.seconds ?? 0;
    const until = lasts > 0 ? this.world.tick + Math.max(1, Math.round(lasts * TICK_RATE)) : 0;
    const on = rec.buffs;
    const old = def.again === "stack" ? undefined : on.find((b) => b.buff === buff);
    if (old) {
      old.until = until;
      old.by = by;
      old.torpor = torpor;
    } else {
      if (on.length >= MAX_BUFFS) on.shift();
      on.push({ buff, until, by, torpor });
    }
    if (until > 0) this.deadlines.push(until, DEADLINE_BUFF, rec.pid, until);
    this.apply(rec);
    return true;
  }

  /** Takes off every instance. False if there was none. */
  take(rec: EntityRecord, buff: number): boolean {
    const on = rec.buffs;
    let kept = 0;
    for (const b of on) if (b.buff !== buff) on[kept++] = b;
    if (kept === on.length) return false;
    on.length = kept;
    this.apply(rec);
    return true;
  }

  has(rec: EntityRecord, buff: number): boolean {
    return rec.buffs.some((b) => b.buff === buff);
  }

  clear(rec: EntityRecord): void {
    if (rec.buffs.length === 0) return;
    rec.buffs.length = 0;
    this.apply(rec);
  }

  /** A DEADLINE_BUFF entry came due. */
  due(pid: number, _stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (!rec) return;
    const now = this.world.tick;
    const on = rec.buffs;
    let kept = 0;
    for (const b of on) if (b.until === 0 || b.until > now) on[kept++] = b;
    if (kept === on.length) return;
    on.length = kept;
    this.apply(rec);
  }

  /** The combined multiplier of the record's buffs on its speed. dealtOf and takenOf do the same for damage dealt and taken. */
  speedOf(rec: EntityRecord): number {
    let m = 1;
    for (const b of rec.buffs) m *= this.def(b.buff)?.speed ?? 1;
    return m;
  }

  dealtOf(rec: EntityRecord): number {
    let m = 1;
    for (const b of rec.buffs) m *= this.def(b.buff)?.dealt ?? 1;
    return m;
  }

  takenOf(rec: EntityRecord): number {
    let m = 1;
    for (const b of rec.buffs) m *= this.def(b.buff)?.taken ?? 1;
    return m;
  }

  rooted(rec: EntityRecord): boolean {
    return rec.buffs.some((b) => this.def(b.buff)?.root === true);
  }

  /**
   * The body died: every buff ends, and so does what each was doing to its vitals. Does not touch the vitals themselves,
   * which death is in the middle of settling.
   */
  died(rec: EntityRecord): void {
    rec.buffs.length = 0;
    rec.buffsVersion++;
    if (this.immune.delete(rec.pid)) this.survival.gods.delete(rec.pid);
    this.survival.dropExtra(rec.pid);
  }

  /** Recomputes the record's rates and immunity after its buffs change, then calls onChange. */
  private apply(rec: EntityRecord): void {
    let health = 0;
    let torpor = 0;
    let by = 0;
    let immune = false;
    for (const b of rec.buffs) {
      const def = this.def(b.buff);
      if (!def) continue;
      const h = def.health ?? 0;
      health += h;
      torpor += (def.torpor ?? 0) + b.torpor;
      // The giver of a harmful buff gets the kill if the record dies of it.
      if (h < 0 && b.by !== 0) by = b.by;
      if (def.immune) immune = true;
    }
    const gods = this.survival.gods;
    if (immune) {
      this.immune.add(rec.pid);
      gods.add(rec.pid);
    } else if (this.immune.delete(rec.pid)) gods.delete(rec.pid);
    rec.buffsVersion++;
    this.survival.setExtra(rec, health, torpor, by);
    this.onChange?.(rec);
  }
}
