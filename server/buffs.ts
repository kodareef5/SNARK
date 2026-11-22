// Nothing here is stepped. A buff's end is a deadline, and its health and torpor per second are folded into the rates Survival keeps.
// Instances are saved with their record, because those rates are: a restart leaves each buff to end when it would have.

import type { BuffDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { DAMAGE_TYPES } from "../shared/sim/damage.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { EntityRecord, Records } from "./records.ts";
import { saved } from "./saved.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

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
  /** Health per second this instance adds on top of its definition's. What an item mends over time is carried this way (server/use.ts). */
  health: number;
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
  /** Its kind in the deadline heap. */
  private readonly deadline: number;

  constructor(world: ServerWorld, records: Records, survival: Survival, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.survival = survival;
    this.deadlines = deadlines;
    this.deadline = deadlines.kind("buff", (a, stamp) => this.due(a, stamp));
  }

  private def(buff: number): BuffDef | null {
    const d = this.world.reg.defs[buff];
    return d?.type === "buff" ? d : null;
  }

  /**
   * `by` is the giver's pid. `seconds` overrides the buff's own time, and 0 or less means until taken away.
   * `torpor` and `health` are torpor and health per second this instance adds. A buff already on is restarted unless it stacks.
   */
  give(rec: EntityRecord, buff: number, by = 0, seconds?: number, torpor = 0, health = 0): boolean {
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
      old.health = health;
    } else {
      if (on.length >= MAX_BUFFS) on.shift();
      on.push({ buff, until, by, torpor, health });
    }
    if (until > 0) this.deadlines.push(until, this.deadline, rec.pid, until);
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

  /**
   * For a record loaded from a save, once it is in the world: its buffs get their deadlines back and act on it again.
   * `unrated` is a record whose saved rates may hold what a buff gave with no buff to end it (WorldStore.unrated),
   * so they are worked out again from the buffs it has.
   */
  restore(rec: EntityRecord, unrated: boolean): void {
    // A tame kept in a soul ball has its buffs as they stood, and none ends while it is kept (server/balls.ts).
    if (rec.stored !== 0) return;
    if (rec.buffs.length === 0 && !unrated) return;
    for (const b of rec.buffs) if (b.until > 0) this.deadlines.push(b.until, this.deadline, rec.pid, b.until);
    this.apply(rec);
  }

  /** A deadline of its kind came due. */
  due(pid: number, _stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (!rec || rec.stored !== 0) return;
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
    this.records.dirty.add(rec.pid);
    if (this.immune.delete(rec.pid)) this.survival.gods.delete(rec.pid);
    this.survival.dropExtra(rec.pid);
  }

  /** Recomputes the record's rates and immunity after its buffs change, then calls onChange. */
  private apply(rec: EntityRecord): void {
    let health = 0;
    let torpor = 0;
    let by = 0;
    let immune = false;
    const takes = this.world.reg.takes[rec.kind];
    for (const b of rec.buffs) {
      const def = this.def(b.buff);
      if (!def) continue;
      // Harm of a kind is what the body takes of it, as a blow of that kind is: a herbivore burns for three eighths.
      const h = (def.health ?? 0) * (def.damage !== undefined && (def.health ?? 0) < 0 && takes ? takes[DAMAGE_TYPES.indexOf(def.damage)]! : 1) + b.health;
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
    this.records.dirty.add(rec.pid);
    this.survival.setExtra(rec, health, torpor, by);
    this.onChange?.(rec);
  }
}

/** Each buff's content, the tick it ends, who gave it and the torpor a second it adds, then, if any adds health, the health a second each adds. */
saved({
  name: "buffs",
  id: 19,
  has: (rec) => rec.buffs.length > 0,
  write(rec, w, to) {
    const buffs = rec.buffs;
    let heals = false;
    w.varint(buffs.length);
    for (let i = 0; i < buffs.length; i++) {
      const b = buffs[i]!;
      w.varint(to.toSaved[b.buff]!);
      w.uint53(b.until);
      w.uint53(b.by);
      w.f64(b.torpor);
      if (b.health !== 0) heals = true;
    }
    // The health a second each adds follows them all, and only when one adds some.
    if (heals) for (let i = 0; i < buffs.length; i++) w.f64(buffs[i]!.health);
  },
  read(rec, r, from) {
    const read: BuffOn[] = [];
    for (let k = r.varint(); k > 0 && !r.overflow; k--) read.push({ buff: from.toRuntime[r.varint()] ?? 0, until: r.uint53(), by: r.uint53(), torpor: r.f64(), health: 0 });
    // The healths follow only when one is not 0.
    if (64 * read.length <= r.remainingBits) for (const on of read) on.health = r.f64();
    for (const on of read) {
      // A buff whose content is gone is dropped, and what it gave the vitals with it.
      if (on.buff !== 0) rec.buffs.push(on);
      else from.stale = true;
    }
  },
});
