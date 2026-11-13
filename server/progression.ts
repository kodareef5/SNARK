// Experience, levels, stat points, engrams and crafting.
//
// The rules are content: the level table, what each engram costs and unlocks,
// what each recipe needs. Nothing here names an item. A level is a function of
// experience; points to spend are a function of level and of what has been
// spent, so neither is stored and neither can drift.
//
// Crafting is a job on the record: ingredients are destroyed when a unit is
// started, the product is created when it is done, and the moment it is done
// is a deadline. A job that cannot go on (no room, no ingredients) simply
// stops; nothing is refunded, because nothing was taken that was not used.

import type { EngramDef, ItemDef, LevelsDef, RecipeDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import { STAT_COUNT, STAT_NAMES, spendPoint } from "../shared/sim/genome.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_CRAFT = 4;
const MAX_JOBS = 8;

/** How experience was come by: given outright (a cheat), or earned by a kill, by harvesting, by making something. */
export const XP_GIVEN = 0;
export const XP_KILL = 1;
export const XP_HARVEST = 2;
export const XP_CRAFT = 3;
/** The server's rule for each way of earning it. */
const XP_RULES = ["", "KillXPMultiplier", "HarvestXPMultiplier", "CraftXPMultiplier"];

export class Progression {
  /** The server's rules, given by whoever assembles the world: experience earned is multiplied by them. */
  rules: Rules | null = null;
  /** Called after anything that changes a record's stat points or level. */
  onChange: ((rec: EntityRecord) => void) | null = null;
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly deadlines: DeadlineHeap;
  private readonly levels: LevelsDef | null;
  /** Per recipe content index: the engram that unlocks it, or 0. */
  private readonly engramOf: Uint16Array;

  constructor(world: ServerWorld, records: Records, items: Items, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.items = items;
    this.deadlines = deadlines;
    const reg = world.reg;
    this.levels = (reg.defs.find((d) => d?.type === "levels") as LevelsDef | undefined) ?? null;
    this.engramOf = new Uint16Array(reg.defs.length);
    reg.defs.forEach((d, k) => {
      if (d?.type === "engram") for (const r of d.unlocks) this.engramOf[reg.index.get(r)!] = k;
    });
  }

  /** The level a given experience has reached. */
  levelOf(xp: number): number {
    const table = this.levels?.xp;
    if (!table) return 1;
    let level = 1;
    while (level < table.length && xp >= table[level]!) level++;
    return level;
  }

  /** Stat points not yet placed: one per level gained, less those spent. */
  statPoints(rec: EntityRecord): number {
    let spent = 0;
    if (rec.genome) for (let i = 0; i < STAT_COUNT; i++) spent += rec.genome.tamed[i]!;
    return Math.max(0, this.levelOf(rec.xp) - 1 - spent);
  }

  /** Engram points not yet spent. */
  engramPoints(rec: EntityRecord): number {
    const table = this.levels?.engramPoints ?? [];
    let have = 0;
    for (let l = 0; l < this.levelOf(rec.xp); l++) have += table[l] ?? 0;
    for (const e of rec.engrams) have -= (this.world.reg.defs[e] as EngramDef).cost;
    return Math.max(0, have);
  }

  /**
   * Give experience. What is earned (`source` a kill, a harvest, a thing
   * made) is multiplied by the server's rule for all experience and by its
   * rule for that way of earning it; what is given outright is given as it
   * is. Returns what was added.
   */
  addXp(rec: EntityRecord, amount: number, source = XP_GIVEN): number {
    if (!(amount > 0)) return 0;
    if (source !== XP_GIVEN && this.rules) amount *= this.rules.num("XPMultiplier") * this.rules.num(XP_RULES[source]!);
    if (!(amount > 0)) return 0;
    const before = this.levelOf(rec.xp);
    rec.xp += amount;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (this.levelOf(rec.xp) !== before) this.onChange?.(rec);
    return amount;
  }

  /** Put one unspent point into a stat. */
  spend(rec: EntityRecord, stat: number): number {
    if (!rec.genome || stat >= STAT_COUNT) return RESULT_INVALID;
    // A stat that a point would not raise (torpidity, which is the body's own) takes none.
    const def = this.world.reg.defs[rec.kind];
    const curve = def?.type === "species" ? def.stats?.[STAT_NAMES[stat]!] : undefined;
    if (!curve || !(curve[2] > 0)) return RESULT_INVALID;
    if (this.statPoints(rec) < 1) return RESULT_SHORT;
    if (!spendPoint(rec.genome, stat)) return RESULT_INVALID;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    this.onChange?.(rec);
    return RESULT_OK;
  }

  learn(rec: EntityRecord, engram: number): number {
    const def = this.world.reg.defs[engram];
    if (def?.type !== "engram" || rec.engrams.includes(engram)) return RESULT_INVALID;
    if (this.levelOf(rec.xp) < def.level || this.engramPoints(rec) < def.cost) return RESULT_SHORT;
    rec.engrams.push(engram);
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    return RESULT_OK;
  }

  /** Queue `count` of a recipe. The first unit starts at once if nothing else is being made. */
  craft(rec: EntityRecord, recipe: number, count: number): number {
    const def = this.world.reg.defs[recipe];
    if (def?.type !== "recipe" || !(count >= 1 && count <= 100)) return RESULT_INVALID;
    if (!rec.engrams.includes(this.engramOf[recipe]!)) return RESULT_DENIED;
    if (rec.jobs.length >= MAX_JOBS) return RESULT_FULL;
    if (rec.jobs.length === 0 && !this.canStart(rec, def)) return RESULT_SHORT;
    rec.jobs.push({ recipe, left: count, doneAt: 0 });
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (rec.jobs.length === 1) this.start(rec);
    return RESULT_OK;
  }

  /** A DEADLINE_CRAFT entry came due: the unit being made is finished. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    const job = rec?.jobs[0];
    if (!rec || !job || job.doneAt !== stamp) return;
    const def = this.world.reg.defs[job.recipe] as RecipeDef;
    const reg = this.world.reg;
    const product = reg.index.get(def.makes)!;
    const tool = (reg.defs[product] as ItemDef).tool;
    // Made in full or, with no room for all of it, not yet: try again in a second.
    if (this.items.inv(rec).room(product, 0, this.items.table) < def.count) {
      job.doneAt = this.world.tick + TICK_RATE;
      this.deadlines.push(job.doneAt, DEADLINE_CRAFT, pid, job.doneAt);
      return;
    }
    this.items.mint(rec, product, def.count, 0, tool ? tool.uses : 0);
    job.left--;
    job.doneAt = 0;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (job.left <= 0) rec.jobs.shift();
    this.addXp(rec, def.xp, XP_CRAFT);
    this.start(rec);
  }

  /** Put back the deadline of whatever a loaded record was making. */
  resume(rec: EntityRecord): void {
    const job = rec.jobs[0];
    if (!job) return;
    if (job.doneAt === 0) this.start(rec);
    else this.deadlines.push(job.doneAt, DEADLINE_CRAFT, rec.pid, job.doneAt);
  }

  private canStart(rec: EntityRecord, def: RecipeDef): boolean {
    const inv = this.items.inv(rec);
    return def.needs.every((n) => inv.total(this.world.reg.index.get(n.item)!) >= n.count);
  }

  /** Begin the next unit of the first job: destroy its ingredients and set the deadline. Drops jobs that cannot go on. */
  private start(rec: EntityRecord): void {
    while (rec.jobs.length > 0) {
      const job = rec.jobs[0]!;
      const def = this.world.reg.defs[job.recipe] as RecipeDef;
      if (this.canStart(rec, def)) {
        for (const n of def.needs) this.items.burnItem(rec, this.world.reg.index.get(n.item)!, n.count);
        job.doneAt = this.world.tick + Math.max(1, Math.round(def.seconds * TICK_RATE));
        this.deadlines.push(job.doneAt, DEADLINE_CRAFT, rec.pid, job.doneAt);
        rec.progVersion++;
        this.records.dirty.add(rec.pid);
        return;
      }
      rec.jobs.shift();
      rec.progVersion++;
      this.records.dirty.add(rec.pid);
    }
  }
}
