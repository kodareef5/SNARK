// Levels and unspent points are functions of experience and of what was spent, so neither is stored and neither can drift.
// A craft job burns its ingredients when a unit starts and mints the product when its deadline comes due. A job lives on
// the record whose inventory gives its ingredients and takes its product: a survivor's own, for what is made in the hands,
// or a station's, for what is made at one (craftAt). Its crafter, who must know the engram and gets the experience, is the
// survivor who queued it. Made from the engram it is primitive. Made from a blueprint in that inventory (craftBlueprint) it
// needs no engram, costs its quality's ingredients, and is of the blueprint's quality or above by the crafter's Crafting Skill.

import type { CraftFacet, EngramDef, ItemDef, LevelsDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../shared/net/protocol.ts";
import { STAT_COUNT, STAT_NAMES, spendPoint } from "../shared/sim/genome.ts";
import { FLAG_BLUEPRINT, QUALITY_CRAFT_XP, QUALITY_MUL, blueprintCost, craftedQuality } from "../shared/sim/items.ts";
import { Rng } from "../shared/rng.ts";
import { statOf } from "./survival.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Job, Records } from "./records.ts";
import { moved, saved } from "./saved.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";

const MAX_JOBS = 8;
const STAT_CRAFTING = STAT_NAMES.indexOf("crafting");

/** Sources of experience. XP_GIVEN (a cheat) is not multiplied by any rule. */
export const XP_GIVEN = 0;
export const XP_KILL = 1;
export const XP_HARVEST = 2;
export const XP_CRAFT = 3;
/** Indexed by source. */
const XP_RULES = ["", "KillXPMultiplier", "HarvestXPMultiplier", "CraftXPMultiplier"];

const XP_GAIN = event("xp.gain");
const LEVEL_UP = event("level.up");
const STAT_SPEND = event("stat.spend");
const ENGRAM_LEARN = event("engram.learn");
const CRAFT_START = event("craft.start");
const CRAFT_DONE = event("craft.done");
/** Where experience came from, as a module is told it, by XP_ source. */
const XP_WORDS: readonly string[] = ["given", "kill", "harvest", "craft"];

export class Progression {
  rules: Rules | null = null;
  bus: Bus = NO_BUS;
  /** Called after anything that changes a record's stat points or level. */
  onChange: ((rec: EntityRecord) => void) | null = null;
  /** Tells a survivor why what it asked for was refused (a powered station that is out). */
  onNotice: ((pid: number, text: string) => void) | null = null;
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
  /** Draws the crafted skill bonus of what a blueprint makes. */
  private readonly rng: Rng;
  /** Its kind in the deadline heap. */
  private readonly deadline: number;

  constructor(world: ServerWorld, records: Records, items: Items, deadlines: DeadlineHeap, seed = 113) {
    this.rng = new Rng(seed);
    this.world = world;
    this.records = records;
    this.items = items;
    this.deadlines = deadlines;
    this.deadline = deadlines.kind("craft", (a, stamp) => this.due(a, stamp));
    const reg = world.reg;
    this.levels = (reg.defs.find((d) => d?.type === "levels") as LevelsDef | undefined) ?? null;
    this.engramOf = new Uint16Array(reg.defs.length);
    reg.defs.forEach((d, k) => {
      if (d?.type !== "engram") return;
      this.engramOf[reg.index.get(d.item)!] = k;
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
    // A module may change the amount, or refuse it.
    const asked = { pid: rec.pid, source: XP_WORDS[source] ?? "", amount };
    if (this.bus.before(XP_GAIN, asked) !== "") return 0;
    amount = Number(asked.amount);
    const room = this.most(rec) - rec.xp;
    if (amount > room) amount = room;
    if (!(amount > 0)) return 0;
    const before = this.level(rec);
    rec.xp += amount;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    const now = this.level(rec);
    if (now !== before) {
      this.onChange?.(rec);
      this.bus.after(LEVEL_UP, { pid: rec.pid, from: before, to: now });
    }
    return amount;
  }

  spend(rec: EntityRecord, stat: number): number {
    if (!rec.genome || stat >= STAT_COUNT) return RESULT_INVALID;
    // A stat that a point would not raise, such as torpidity, takes none.
    const def = this.world.reg.defs[rec.kind];
    const curve = def?.type === "species" ? def.stats?.[STAT_NAMES[stat]!] : undefined;
    if (!curve || !(curve[2] > 0)) return RESULT_INVALID;
    if (this.statPoints(rec) < 1) return RESULT_SHORT;
    if (this.bus.before(STAT_SPEND, { pid: rec.pid, stat: STAT_NAMES[stat]! }) !== "") return RESULT_DENIED;
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
    if (this.bus.before(ENGRAM_LEARN, { pid: rec.pid, engram: def.id }) !== "") return RESULT_DENIED;
    rec.engrams.push(engram);
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    return RESULT_OK;
  }

  /** Made in the hands, from the survivor's own inventory. An item made at a station is refused. The first unit starts at once if nothing else is being made. */
  craft(rec: EntityRecord, item: number, count: number): number {
    const craft = this.craftOf(item);
    if (!craft || !(count >= 1 && count <= 100)) return RESULT_INVALID;
    if (this.world.reg.craftAt[item] !== 0) return RESULT_DENIED;
    return this.queue(rec, rec, craft, item, count);
  }

  /**
   * Made at `station` (a structure's record) for the survivor `by`: queued on the station's record, from what lies in it,
   * and landing in it. Only an item whose craft names the station's kind is made there; a lit station and the same station
   * out are one kind to it (Registry.stationBase).
   */
  craftAt(by: EntityRecord, station: EntityRecord, item: number, count: number): number {
    const craft = this.craftOf(item);
    if (!craft || !(count >= 1 && count <= 100)) return RESULT_INVALID;
    const at = this.world.reg.craftAt[item]!;
    if (station.at < 0 || station === by || at === 0 || at !== this.world.reg.stationBase[station.kind]) return RESULT_INVALID;
    return this.queue(station, by, craft, item, count);
  }

  /**
   * Made from the blueprint in `slot` of `on`, the inventory the item is made from: the survivor's own (`on` is `by`) for
   * an item made in the hands, the station's for one made at a station. A blueprint needs no engram and no level
   * (ark.wiki.gg Blueprint, 2026-11-15); its ingredients are its quality's (blueprintCost), and it must still lie there
   * as each unit starts. The product's quality comes of the blueprint's and the crafter's skill (`due`).
   */
  craftBlueprint(by: EntityRecord, on: EntityRecord, slot: number, count: number): number {
    if (!(count >= 1 && count <= 100)) return RESULT_INVALID;
    const inv = this.items.inv(on);
    if (slot >= inv.cap || inv.item[slot] === 0 || (inv.flags[slot]! & FLAG_BLUEPRINT) === 0) return RESULT_INVALID;
    const item = inv.item[slot]!;
    const craft = this.craftOf(item);
    if (!craft) return RESULT_INVALID;
    // Made where its craft says: in the hands from the survivor's own, or at a station of the right kind from the station's.
    const at = this.world.reg.craftAt[item]!;
    if (at === 0 ? on !== by : on === by || on.at < 0 || this.world.reg.stationBase[on.kind] !== at) return RESULT_INVALID;
    return this.queue(on, by, craft, item, count, inv.quality[slot]!);
  }

  /** Queues a job on `on` for the crafter `by`, who may be `on` itself. `bp` is the quality of the blueprint it is made from, or -1 for the engram. */
  private queue(on: EntityRecord, by: EntityRecord, craft: CraftFacet, item: number, count: number, bp = -1): number {
    if (bp < 0 && !this.knows(by, this.engramOf[item]!)) return RESULT_DENIED;
    if (bp < 0 && craft.level !== undefined && this.level(by) < craft.level) return RESULT_SHORT;
    // A powered station takes no job while it is out, from the engram or a blueprint (planning/reference/stations-plan.md, M5).
    if (on !== by && this.unpowered(on)) {
      this.onNotice?.(by.pid, "It needs fuel and must be on.");
      return RESULT_SHORT;
    }
    if (on.jobs.length >= MAX_JOBS) return RESULT_FULL;
    if (on.jobs.length === 0 && !this.canStart(on, craft, item, bp)) return RESULT_SHORT;
    // A module may refuse the job, or change how many are made.
    const asked = { pid: by.pid, item: this.world.reg.ids[item]!, count };
    if (this.bus.before(CRAFT_START, asked) !== "") return RESULT_DENIED;
    count = Math.floor(Number(asked.count));
    if (!(count >= 1 && count <= 100)) return RESULT_DENIED;
    const job: Job = on === by ? { item, left: count, doneAt: 0 } : { item, left: count, doneAt: 0, by: by.pid };
    if (bp >= 0) job.bp = bp;
    on.jobs.push(job);
    on.progVersion++;
    this.records.dirty.add(on.pid);
    if (on.jobs.length === 1) this.start(on);
    return RESULT_OK;
  }

  /**
   * Who makes the job on `rec`: the survivor who queued it at a station, or `rec` itself for one made in the hands. It gets
   * the experience. Null if that survivor's record is gone, and then nobody does.
   */
  crafter(rec: EntityRecord, job: Job): EntityRecord | null {
    return job.by === undefined ? rec : (this.records.byPid.get(job.by) ?? null);
  }

  /** A deadline of its kind came due. */
  due(pid: number, stamp: number): void {
    const rec = this.records.byPid.get(pid);
    if (!rec) return;
    // A powered station's fire is advanced first (Items.inv tends it): if its fuel ran out before this tick, it went out
    // then, and pause() has stopped the unit under way, so no unit finishes past the tick its station went out.
    if (this.world.reg.powered[rec.kind] === 1) this.items.inv(rec);
    const job = rec.jobs[0];
    if (!job || job.doneAt !== stamp) return;
    const product = job.item;
    const def = this.world.reg.defs[product] as ItemDef;
    const craft = def.craft!;
    const made = craft.count ?? 1;
    const tool = def.tool;
    const crafter = this.crafter(rec, job);
    // Made from the engram it is primitive; from a blueprint, of the blueprint's quality or above, by the crafter's skill.
    const quality = job.bp === undefined ? 0 : craftedQuality(job.bp, this.craftingSkill(crafter), this.rng.float());
    // With no room for the whole product, retry in a second.
    if (this.items.inv(rec).room(product, quality, this.items.table) < made) {
      job.doneAt = this.world.tick + TICK_RATE;
      this.deadlines.push(job.doneAt, this.deadline, pid, job.doneAt);
      return;
    }
    const got = this.items.mint(rec, product, made, quality, tool ? Math.round(tool.uses * (QUALITY_MUL[quality] ?? 1)) : 0, -1, "craft");
    this.bus.after(CRAFT_DONE, { pid: job.by ?? rec.pid, item: def.id, n: got });
    job.left--;
    job.doneAt = 0;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
    if (job.left <= 0) rec.jobs.shift();
    // ARK multiplies the experience by the quality made (ark.wiki.gg Item_Quality, 2026-11-15).
    if (crafter) this.addXp(crafter, craft.xp * (QUALITY_CRAFT_XP[quality] ?? 1), XP_CRAFT);
    this.start(rec);
  }

  /**
   * A survivor's Crafting Skill, 1 for 100%: the species' crafting stat, or 1 where it has none. Null, for a crafter who is
   * gone, is 1.
   */
  craftingSkill(rec: EntityRecord | null): number {
    const def = rec ? this.world.reg.defs[rec.kind] : null;
    return def?.type === "species" ? statOf(def, rec!.genome, STAT_CRAFTING, 1) : 1;
  }

  /**
   * A powered station went out at tick `t` (server/power.ts, on Stations.onSwap): the unit under way waits with the ticks it
   * had left then (Job.rest), its ingredients spent, and its queue is kept. A unit that was done by `t` is left for due().
   * Whether ARK keeps the progress is not on its pages; keeping it is the owner's (stations-plan.md, Decided 3).
   */
  pause(rec: EntityRecord, t: number): void {
    const job = rec.jobs[0];
    if (!job || job.doneAt === 0 || job.doneAt <= t) return;
    job.rest = job.doneAt - t;
    // The deadline already pushed finds its stamp gone and does nothing.
    job.doneAt = 0;
    rec.progVersion++;
    this.records.dirty.add(rec.pid);
  }

  /**
   * Restores the craft deadline of a loaded record, and starts a powered station's queue when it is lit (server/power.ts):
   * a paused unit goes on from its ticks left and spends nothing more.
   */
  resume(rec: EntityRecord): void {
    // A job of something not made here by a job is dropped, as a job whose content is gone is when read.
    const made = rec.jobs.filter((j) => this.craftOf(j.item) !== null);
    if (made.length !== rec.jobs.length) {
      rec.jobs.splice(0, rec.jobs.length, ...made);
      rec.progVersion++;
      this.records.dirty.add(rec.pid);
    }
    const job = rec.jobs[0];
    if (!job) return;
    if (job.doneAt === 0) this.start(rec);
    else this.deadlines.push(job.doneAt, this.deadline, rec.pid, job.doneAt);
  }

  /**
   * How `item` is made by a job, or null if it is not. What a fire makes by itself (`craft.fired`, the forge's ingots) is
   * made by no job: refused in the hand, at the station and from a blueprint, and a loaded job of it is dropped
   * (planning/reference/stations-plan.md, S1).
   */
  private craftOf(item: number): CraftFacet | null {
    const def = this.world.reg.defs[item];
    return def?.type === "item" && def.craft && !def.craft.fired ? def.craft : null;
  }

  /** Whether a unit can start: the ingredients are there, and for one from a blueprint of quality `bp`, that blueprint. */
  private canStart(rec: EntityRecord, craft: CraftFacet, item: number, bp: number): boolean {
    const inv = this.items.inv(rec);
    if (bp >= 0 && inv.blueprint(item, bp) < 0) return false;
    return craft.needs.every((n) => inv.total(this.world.reg.index.get(n.item)!) >= (bp >= 0 ? blueprintCost(n.count, bp) : n.count));
  }

  /** A powered station that is out: it starts nothing and takes no job (M5). */
  private unpowered(rec: EntityRecord): boolean {
    const reg = this.world.reg;
    return reg.powered[rec.kind] === 1 && (reg.burning[rec.kind] !== 1 || !rec.fire);
  }

  /**
   * Starts the next unit of the first job. Drops jobs that cannot start. A powered station that is out starts nothing and
   * keeps its queue; lit, a unit it paused goes on from its ticks left, its ingredients already spent.
   */
  private start(rec: EntityRecord): void {
    if (this.unpowered(rec)) return;
    while (rec.jobs.length > 0) {
      const job = rec.jobs[0]!;
      if (job.rest !== undefined) {
        job.doneAt = this.world.tick + Math.max(1, job.rest);
        delete job.rest;
        this.deadlines.push(job.doneAt, this.deadline, rec.pid, job.doneAt);
        rec.progVersion++;
        this.records.dirty.add(rec.pid);
        return;
      }
      const craft = this.craftOf(job.item);
      const bp = job.bp ?? -1;
      if (craft && this.canStart(rec, craft, job.item, bp)) {
        for (const n of craft.needs) this.items.burnItem(rec, this.world.reg.index.get(n.item)!, bp >= 0 ? blueprintCost(n.count, bp) : n.count);
        job.doneAt = this.world.tick + Math.max(1, Math.round(craft.seconds * TICK_RATE));
        this.deadlines.push(job.doneAt, this.deadline, rec.pid, job.doneAt);
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

/** Experience, learned engrams, crafting jobs. */
saved({
  name: "progression",
  has: (rec) => rec.xp > 0 || rec.engrams.length > 0 || rec.jobs.length > 0,
  write(rec, w, to) {
    const jobs = rec.jobs;
    let queued = false;
    let fromBlueprint = false;
    let resting = false;
    w.f64(rec.xp);
    w.varint(rec.engrams.length);
    for (let i = 0; i < rec.engrams.length; i++) w.varint(to.toSaved[rec.engrams[i]!]!);
    w.varint(jobs.length);
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i]!;
      w.varint(to.toSaved[j.item]!);
      w.varint(j.left);
      w.uint53(j.doneAt);
      if (j.by !== undefined) queued = true;
      if (j.bp !== undefined) fromBlueprint = true;
      if (j.rest !== undefined) resting = true;
    }
    // Then who queued each job at a station. A job made in the hands has none.
    w.bool(queued);
    if (queued) for (let i = 0; i < jobs.length; i++) w.uint53(jobs[i]!.by ?? 0);
    // Then, as a bit and a byte each, the quality plus one of the blueprint each job is made from, 0 for the engram.
    w.bool(fromBlueprint);
    if (fromBlueprint) for (let i = 0; i < jobs.length; i++) w.u8((jobs[i]!.bp ?? -1) + 1);
    // Then a bit and the ticks plus one each job's unit has left while its station is out, 0 for none.
    w.bool(resting);
    if (resting) for (let i = 0; i < jobs.length; i++) w.varint((jobs[i]!.rest ?? -1) + 1);
  },
  read(rec, r, from) {
    rec.xp = r.f64();
    // Engrams and jobs whose content is gone are dropped. Nothing of value is lost with them.
    for (let k = r.varint(); k > 0 && !r.overflow; k--) {
      const saved = r.varint();
      // An engram that became several is known as all of them.
      for (const e of from.split.get(saved) ?? [from.toRuntime[saved] ?? 0]) if (e !== 0 && !rec.engrams.includes(e)) rec.engrams.push(e);
    }
    const jobs: Job[] = [];
    for (let k = r.varint(); k > 0 && !r.overflow; k--) {
      const item = from.toRuntime[r.varint()] ?? 0;
      const left = r.varint();
      const doneAt = r.uint53();
      jobs.push({ item, left, doneAt });
    }
    if (r.bool()) {
      for (const j of jobs) {
        const by = r.uint53();
        if (by !== 0) j.by = by;
      }
    }
    if (r.bool()) {
      for (const j of jobs) {
        const bp = r.u8();
        if (bp !== 0) j.bp = bp - 1;
      }
    }
    if (r.bool()) {
      for (const j of jobs) {
        const rest = r.varint();
        if (rest !== 0) j.rest = rest - 1;
      }
    }
    for (const j of jobs) if (j.item !== 0) rec.jobs.push(j);
  },
  rebase(rec, delta) {
    for (const j of rec.jobs) j.doneAt = moved(j.doneAt, delta);
  },
});
