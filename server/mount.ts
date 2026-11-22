// The starter mount every survivor has unless the server says not (StarterMount, D992): a tamed, saddled pteranodon of
// level 240, its own, kept in a soul ball issued to it (FLAG_ISSUED) on its hotbar. The survivor looses it where it
// looks, rides it, and keeps it again, as any ball's tame (server/balls.ts). The ball never leaves its survivor, holds
// its charge, and keeps only that pteranodon; that pteranodon goes into no other ball, keeps its saddle, does not mate,
// and is worth nothing dead. A survivor has one at most. It is made as the survivor is, and found again at each rise
// after: in the ball the survivor held as it died, whose tame waits for it, or out in the world, whence it is called
// back if it carries nothing and is free to go. One that died, or was lost with its ball, is made anew at the next rise.
// It does not travel: it goes as its survivor leaves for another server, and that server issues its own.

import { HOTBAR_SLOTS, type Inventory } from "../shared/sim/items.ts";
import { STAT_NAMES, rollWild, type StatName } from "../shared/sim/genome.ts";
import { Rng } from "../shared/rng.ts";
import type { Balls } from "./balls.ts";
import type { Buffs } from "./buffs.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import { saved } from "./saved.ts";
import type { Rules } from "./settings/rules.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";


/** The species issued, and its level. */
export const STARTER_SPECIES = "core:pteranodon";
export const STARTER_LEVEL = 240;
/**
 * Where its 239 points lie, all wild, as a tame's taming bonus is: a wild level 160 tamed perfectly is 160 + 80 = 240
 * (bonusLevels), as ARK's 50% bonus makes it. Chosen for travel: 150 in stamina, so that it sprints 4 km, across the map,
 * on one bar; 50 in weight, for a rider who carries much; the rest in health.
 */
export const STARTER_POINTS: Readonly<Partial<Record<StatName, number>>> = { stamina: 150, weight: 50, health: 39 };

export interface MountsContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly rules: Rules;
  readonly balls: Balls;
  readonly buffs: Buffs;
  readonly survival: Survival;
}

export class Mounts {
  /** Counters: starters made, and let go. */
  made = 0;
  dropped = 0;
  private readonly ctx: MountsContext;
  private readonly rng: Rng;
  /** The species, its saddle, and the soul ball empty and full; 0 where content lacks them, and none is issued then. */
  private readonly kind: number;
  private readonly saddle: number;
  private readonly empty: number;
  private readonly full: number;

  constructor(ctx: MountsContext, seed: number) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
    const reg = ctx.world.reg;
    this.kind = reg.index.get(STARTER_SPECIES) ?? 0;
    this.saddle = this.kind === 0 ? 0 : Math.max(0, reg.saddleFits.indexOf(this.kind));
    this.empty = reg.index.get("core:soul_ball") ?? 0;
    this.full = this.empty === 0 ? 0 : reg.ballFull[this.empty]!;
  }

  /** The starter mount of the survivor `rec` on this server, kept or in the world, or null. */
  of(rec: EntityRecord): EntityRecord | null {
    const found: EntityRecord[] = [];
    for (const r of this.ctx.records.byPid.values()) if (r.issuedTo === rec.pid) found.push(r);
    // There is never a second; were there one, it would be let go here.
    for (const r of found.slice(1)) this.drop(r);
    return found[0] ?? null;
  }

  /**
   * The survivor `rec` comes to life: as it is made, at each rise after a death or a journey between beds, and as it rises
   * after coming from another server. Call after its suit is issued, which burns what it was issued before. It is given a
   * ball on its hotbar, or in its bag where the hotbar is full, that holds its starter: the one it had, or a new one. One
   * out in the world is called back into it if it carries nothing and may go into a ball now; else the ball is empty, for
   * the survivor to keep it in when it reaches it. With StarterMount off, none is issued, and one it had goes.
   */
  issue(rec: EntityRecord): void {
    const { records, items, rules, balls } = this.ctx;
    if (this.kind === 0 || this.full === 0) return;
    const inv = items.inv(rec);
    if (inv.hotbar < 0) return;
    // What is left of a ball it was issued is burned first, sparing the tame it holds, so it never has two.
    items.burnIssued(rec, (item) => balls.is(item));
    let p = this.of(rec);
    if (!rules.on("StarterMount")) {
      if (p) this.drop(p);
      return;
    }
    // One neither kept nor in the world, where a load found no room for its body, is let go for a new one.
    if (p && p.stored === 0 && !records.entOf.has(p.pid)) {
      this.drop(p);
      p = null;
    }
    const slot = place(inv);
    if (slot < 0) return;
    if (!p) {
      const made = this.make(rec);
      if (!items.issue(rec, slot, this.full, "issued", made.pid)) records.delete(made.pid);
      else this.made++;
      return;
    }
    if (p.stored !== 0) {
      items.issue(rec, slot, this.full, "issued", p.pid);
      return;
    }
    if (!items.issue(rec, slot, this.empty)) return;
    if (!p.inv || items.inv(p).used() === 0) balls.keepIn(rec, slot, records.entOf.get(p.pid)!);
  }

  /** The survivor `rec` has left for another server: its starter here goes, with its life here. */
  left(rec: EntityRecord): void {
    const p = this.of(rec);
    if (p) this.drop(p);
  }

  /** A new starter for `rec`, kept, with no body yet: its vitals are made full as it is first loosed. */
  private make(rec: EntityRecord): EntityRecord {
    const { world, records } = this.ctx;
    const reg = world.reg;
    const p = records.create(this.kind);
    const g = rollWild(this.rng, 1, reg.colorSet[this.kind]!);
    for (const [stat, n] of Object.entries(STARTER_POINTS)) g.wild[STAT_NAMES.indexOf(stat as StatName)] = n;
    p.genome = g;
    p.team = rec.team;
    p.te = 1;
    p.saddle = this.saddle;
    p.issuedTo = rec.pid;
    // Kept where its survivor stands, which is where a load sets it should no ball name it then (Balls.resume).
    const e = records.entOf.get(rec.pid);
    const ents = world.ents;
    p.x = e !== undefined ? ents.x[e]! : rec.x;
    p.y = e !== undefined ? ents.y[e]! : rec.y;
    p.z = e !== undefined ? ents.z[e]! : rec.z;
    p.stored = Math.max(1, world.tick);
    records.dirty.add(p.pid);
    return p;
  }

  /** Lets the starter `p` go: out of the world, as keeping takes it, what it carried left in a bag, and its record deleted. */
  private drop(p: EntityRecord): void {
    const { records, items, balls, buffs, survival } = this.ctx;
    const e = records.entOf.get(p.pid);
    if (e !== undefined) balls.stow(p, e);
    if (p.inv) items.burnAll(p);
    buffs.died(p);
    survival.forget(p.pid);
    records.delete(p.pid);
    this.dropped++;
  }
}

/** The first empty hotbar slot, else the first empty bag slot, or -1. */
function place(inv: Inventory): number {
  for (let s = inv.hotbar; s < inv.hotbar + HOTBAR_SLOTS; s++) if (inv.item[s] === 0) return s;
  return inv.free();
}

/** The survivor a starter was issued to (EntityRecord.issuedTo). Only a starter has it. */
saved({
  name: "issued",
  has: (rec) => rec.issuedTo !== 0,
  write: (rec, w) => w.uint53(rec.issuedTo),
  read(rec, r, from) {
    rec.issuedTo = r.uint53();
    if (rec.issuedTo === 0) from.refused = true;
  },
});
