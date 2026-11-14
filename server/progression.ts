// Levels and unspent points are functions of experience and of what was spent, so neither is stored and neither can drift.
// A craft job burns its ingredients when a unit starts and mints the product when its deadline comes due.

import type { CraftFacet, EngramDef, ItemDef, LevelsDef } from "../shared/content/defs.ts";
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

/** Sources of experience. XP_GIVEN (a cheat) is not multiplied by any rule. */
export const XP_GIVEN = 0;
export const XP_KILL = 1;
export const XP_HARVEST = 2;
export const XP_CRAFT = 3;
/** Indexed by source. */
const XP_RULES = ["", "KillXPMultiplier", "HarvestXPMultiplier", "CraftXPMultiplier"];

export class Progression {
  rules: Rules | null = null;
  /** Called after anything that changes a record's stat points or level. */
  onChange: ((rec: EntityRecord) => void) | null = null;
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly deadlines: DeadlineHeap;
  private readonly levels: LevelsDef | null;
  /** Per item, the engram that unlocks the making of it, or 0. */
  private readonly engramOf: Uint16Array;
  /** Content indices of the engrams learned automatically. */
  private readonly autos: number[] = [];
  private readonly survivor: number;

  constructor(world: ServerWorld, records: Records, items: Items, deadlines: DeadlineHeap) {
    this.world = world;
    this.records = records;
    this.items = items;
    this.deadlines = deadlines;
    const reg = world.reg;
    this.levels = (reg.defs.find((d) => d?.type === "levels") as LevelsDef | undefined) ?? null;
    this.engramOf = new Uint16Array(reg.defs.length);
    reg.defs.forEach((d, k) => {
      if (d?.type !== "engram") return;
      for (const r of d.unlocks) this.engramOf[reg.index.get(r)!] = k;
      if (d.auto !== undefined) this.autos.push(k);
    });
    this.survivor = reg.index.get("core:survivor") ?? 0;
  }

  /** `tame` uses the tames' level table if content has one. */
  levelOf(xp: number, tame = false): number {
    const table = (tame ? this.levels?.tame?.xp : undefined) ?? this.levels?.xp;
    if (!table) return 1;
    let level = 1;
    while (level < table.length && xp >= table[level]!) level++;
    return level;
  }

  /** Levels gained since it was made or tamed, plus one. */
  level(rec: EntityRecord): number {
    return this.levelOf(rec.xp, rec.kind !== this.survivor);
  }

  /** The experience cap. Content's `most` if set, else what the last level takes. */
  most(rec: EntityRecord): number {
    const l = this.levels;
    if (!l) return Infinity;
    const tame = rec.kind !== this.survivor;
    const table = (tame ? l.tame?.xp : undefined) ?? l.xp;
    return (tame ? l.tame?.most : l.most) ?? table[table.length - 1]!;
  }

  /** One per level gained, less those spent. */
  statPoints(rec: EntityRecord): number {
    let spent = 0;
    if (rec.genome) for (let i = 0; i < STAT_COUNT; i++) spent += rec.genome.tamed[i]!;
    return Math.max(0, this.level(rec) - 1 - spent);
  }

  /** Unspent engram points. Automatically learned engrams cost nothing. */
  engramPoints(rec: EntityRecord): number {
    const table = this.levels?.engramPoints ?? [];
    let have = 0;
    for (let l = 0; l < this.level(rec); l++) have += table[l] ?? 0;
    for (const e of rec.engrams) {
      const def = this.world.reg.defs[e] as EngramDef;
      if (def.auto === undefined) have -= def.cost;
    }
    return Math.max(0, have);
  }

  /** An automatic engram is known from its level on. */
  knows(rec: EntityRecord, engram: number): boolean {
    if (rec.engrams.includes(engram)) return true;
    const def = this.world.reg.defs[engram];
    return def?.type === "engram" && def.auto !== undefined && this.level(rec) >= def.auto;
  }

  /** The engrams it learned, then the automatic ones it has reached. The automatic ones are not stored, so they cannot drift. */
  known(rec: EntityRecord): readonly number[] {
    if (this.autos.length === 0) return rec.engrams;
    const out = [...rec.engrams];
    for (const e of this.autos) if (!rec.engrams.includes(e) && this.knows(rec, e)) out.push(e);
    return out;
  }

  /** Earned experience is multiplied by XPMultiplier and the rule for its `source`. Capped by `most`. Returns the amount added. */
  addXp(rec: EntityRecord, amount: number, source = XP_GIVEN): number {
    if (!(amount > 0)) return 0;
    if (source !== XP_GIVEN && this.rules) amount *= this.rules.num("XPMultiplier") * this.rules.num(XP_RULES[source]!);
    const room = this.most(rec) - rec.xp;
    if (amount > room) amount = room;
    if (!(amount > 0)) return 0;
    const before = this.level(rec);
    rec.xp += amount;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (this.level(rec) !== before) this.onChange?.(rec);
    return amount;
  }

  spend(rec: EntityRecord, stat: number): number {
    if (!rec.genome || stat >= STAT_COUNT) return RESULT_INVALID;
    // A stat that a point would not raise, such as torpidity, takes none.
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
    if (def?.type !== "engram" || this.knows(rec, engram)) return RESULT_INVALID;
    // A hidden engram is one the server does not offer.
    if (def.hidden) return RESULT_DENIED;
    if (this.level(rec) < def.level || this.engramPoints(rec) < def.cost) return RESULT_SHORT;
    rec.engrams.push(engram);
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    return RESULT_OK;
  }

  /** The first unit starts at once if nothing else is being made. */
  craft(rec: EntityRecord, item: number, count: number): number {
    const craft = this.craftOf(item);
    if (!craft || !(count >= 1 && count <= 100)) return RESULT_INVALID;
    if (!this.knows(rec, this.engramOf[item]!)) return RESULT_DENIED;
    if (rec.jobs.length >= MAX_JOBS) return RESULT_FULL;
    if (rec.jobs.length === 0 && !this.canStart(rec, craft)) return RESULT_SHORT;
    rec.jobs.push({ item, left: count, doneAt: 0 });
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (rec.jobs.length === 1) this.start(rec);
    return RESULT_OK;
  }

  /** A DEADLINE_CRAFT entry came due. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    const job = rec?.jobs[0];
    if (!rec || !job || job.doneAt !== stamp) return;
    const product = job.item;
    const def = this.world.reg.defs[product] as ItemDef;
    const craft = def.craft!;
    const made = craft.count ?? 1;
    const tool = def.tool;
    // With no room for the whole product, retry in a second.
    if (this.items.inv(rec).room(product, 0, this.items.table) < made) {
      job.doneAt = this.world.tick + TICK_RATE;
      this.deadlines.push(job.doneAt, DEADLINE_CRAFT, pid, job.doneAt);
      return;
    }
    this.items.mint(rec, product, made, 0, tool ? tool.uses : 0);
    job.left--;
    job.doneAt = 0;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (job.left <= 0) rec.jobs.shift();
    this.addXp(rec, craft.xp, XP_CRAFT);
    this.start(rec);
  }

  /** Restores the craft deadline of a loaded record. */
  resume(rec: EntityRecord): void {
    const job = rec.jobs[0];
    if (!job) return;
    if (job.doneAt === 0) this.start(rec);
    else this.deadlines.push(job.doneAt, DEADLINE_CRAFT, rec.pid, job.doneAt);
  }

  /** How `item` is made, or null if it is not. */
  private craftOf(item: number): CraftFacet | null {
    const def = this.world.reg.defs[item];
    return def?.type === "item" && def.craft ? def.craft : null;
  }

  private canStart(rec: EntityRecord, craft: CraftFacet): boolean {
    const inv = this.items.inv(rec);
    return craft.needs.every((n) => inv.total(this.world.reg.index.get(n.item)!) >= n.count);
  }

  /** Starts the next unit of the first job. Drops jobs that cannot start. */
  private start(rec: EntityRecord): void {
    while (rec.jobs.length > 0) {
      const job = rec.jobs[0]!;
      const craft = this.craftOf(job.item);
      if (craft && this.canStart(rec, craft)) {
        for (const n of craft.needs) this.items.burnItem(rec, this.world.reg.index.get(n.item)!, n.count);
        job.doneAt = this.world.tick + Math.max(1, Math.round(craft.seconds * TICK_RATE));
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
