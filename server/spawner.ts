// Keeps each spawn region of the map stocked with wild creatures, as ARK's zone managers keep theirs. A region counts the wild
// creatures it made, and those a save gave it, until they die or are tamed. Each region checks itself on a deadline, so a
// stocked world costs nothing between checks. Where each number comes from is in planning/quality/deviations.md, DEV105 on.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import type { Registry } from "../shared/content/registry.ts";
import { Rng } from "../shared/rng.ts";
import { F_PLAYER } from "../shared/sim/entities.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { GROUND_FREE, groundAt } from "../shared/world/path.ts";
import { ROLE_CEILING, ROLE_FOUNDATION } from "../shared/world/snap.ts";
import type { Buffs } from "./buffs.ts";
import type { Creatures } from "./creatures.ts";
import type { GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Entry, SpawnTable } from "./settings/spawns.ts";
import { difficultyOf, wildLevel } from "./settings/tune.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_SPAWN = 9;

/** Seconds between a region's checks. While it holds fewer than it should, each check adds one group. */
export const CHECK_SECONDS = 45;
/** Metres. No group is put down this near a survivor, nor this near a tribe's creature. */
export const PLAYER_RANGE = 60;
export const TAME_RANGE = 40;
/** This many of a tribe's foundations and ceilings within CORE_RANGE metres keep a place clear. */
export const CORE_MOST = 15;
export const CORE_RANGE = 60;
/** ARK's base level steps of a wild creature, as [first, last, weight]. A step within its range is drawn evenly. */
export const LEVEL_WEIGHTS: readonly (readonly [number, number, number])[] = [
  [1, 5, 1],
  [6, 12, 0.5],
  [13, 20, 0.25],
  [21, 30, 0.1],
];
/** Places tried for a group at one check. */
const TRIES = 8;
/** The most creatures made, and places tried, in one tick, over every region. */
export const TICK_MADE = 64;
const TICK_TRIES = 128;

/** A step from 1 to 30, by LEVEL_WEIGHTS. */
export function wildStep(rng: Rng): number {
  let total = 0;
  for (const [, , w] of LEVEL_WEIGHTS) total += w;
  let at = rng.float() * total;
  for (const [lo, hi, w] of LEVEL_WEIGHTS) {
    at -= w;
    if (at < 0) return lo + rng.int(hi - lo + 1);
  }
  return LEVEL_WEIGHTS[LEVEL_WEIGHTS.length - 1]![1];
}

/** Whether a record is a wild creature a region may count: grown, nobody's, and not an egg. */
export function isWild(reg: Registry, rec: EntityRecord): boolean {
  const d = reg.defs[rec.kind];
  return d?.type === "species" && d.class === "creature" && rec.team === 0 && rec.egg === null && rec.grown === 0 && rec.at < 0;
}

export interface SpawnerContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  creatures: Creatures;
  items: Items;
  survival: Survival;
  buffs: Buffs;
  persistence: Persistence | null;
  rules: Rules;
  deadlines: DeadlineHeap;
  /** The spawn tables after the server's settings (server/settings/spawns.ts), by content index. */
  tables: ReadonlyMap<number, SpawnTable>;
}

export interface Region {
  readonly x: number;
  readonly z: number;
  readonly rx: number;
  readonly rz: number;
  readonly round: boolean;
  readonly table: SpawnTable;
  /** What it holds at the server's DinoCountMultiplier. */
  readonly desired: number;
  count: number;
  /** Members of each species. */
  readonly of: Map<number, number>;
  /** Each species its entries can make. */
  readonly makes: ReadonlySet<number>;
  /** The stamp of its one deadline. Any other is stale. */
  due: number;
  /** It takes turns to add a group, many a second, until a turn adds nothing. */
  filling: boolean;
}

export class Spawner {
  /** Creatures made, and checks that found no place, since the server started. */
  made = 0;
  refused = 0;
  readonly regions: Region[] = [];
  /** What the save keeps: the wall-clock second of the last start that replaced every wild creature. */
  readonly saved = { dirty: false, serialize: (): string => JSON.stringify({ forced: this.lastForced }) };
  private lastForced = 0;
  /** The region each counted creature belongs to, by record id. */
  private readonly member = new Map<number, number>();
  private readonly ctx: SpawnerContext;
  private readonly rng: Rng;
  private readonly checkTicks = CHECK_SECONDS * TICK_RATE;
  private readonly creature: Uint8Array;
  private stamps = 0;
  /** Regions filling, each waiting its turn from `turn` on. */
  private readonly turns: number[] = [];
  private turn = 0;
  private budgetAt = -1;
  private madeNow = 0;
  private triesNow = 0;
  /** Per chunk, the x and z of each of a tribe's foundations and ceilings, as of the chunk's version then. */
  private readonly cores: (Float32Array | null)[] = [];
  private readonly coresAt: number[] = [];

  constructor(ctx: SpawnerContext, seed: number) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
    const reg = ctx.world.reg;
    this.creature = Uint8Array.from(reg.defs, (d) => (d?.type === "species" && d.class === "creature" ? 1 : 0));
    const multiplier = ctx.rules.num("DinoCountMultiplier");
    for (const zone of ctx.world.zones) {
      const k = zone.spawns === undefined ? undefined : reg.index.get(zone.spawns);
      const table = k === undefined ? undefined : ctx.tables.get(k);
      if (!table) continue;
      const [rx, rz] = zone.half ?? [zone.radius ?? 0, zone.radius ?? 0];
      const makes = new Set(table.entries.flatMap((e) => e.kinds));
      this.regions.push({ x: zone.at[0], z: zone.at[1], rx, rz, round: !zone.half, table, desired: Math.round((zone.count ?? 0) * multiplier), count: 0, of: new Map(), makes, due: 0, filling: false });
    }
  }

  /** Wild creatures some region counts. */
  get count(): number {
    return this.member.size;
  }

  /**
   * Call once, after a save's bodies are back. Each wild creature the save holds counts for a region that could have made it:
   * the nearest of those over its chunk and the chunks beside it, 0 m off if it stands in one, or else the nearest of all. A
   * new world fills at once; a saved one tops up at the pace of its checks.
   */
  begin(fresh: boolean): void {
    if (fresh) return this.refill();
    // The regions over each chunk, so that a creature standing in one is placed without trying them all.
    const dims = this.ctx.world.dims;
    const over: number[][] = Array.from({ length: dims.chunksX * dims.chunksZ }, () => []);
    this.regions.forEach((r, i) => {
      for (let cz = Math.max(0, Math.floor((r.z - r.rz) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((r.z + r.rz) / CHUNK_SIZE)); cz++) {
        for (let cx = Math.max(0, Math.floor((r.x - r.rx) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((r.x + r.rx) / CHUNK_SIZE)); cx++) over[cz * dims.chunksX + cx]!.push(i);
      }
    });
    const made = new Set(this.regions.flatMap((r) => [...r.makes]));
    for (const rec of this.ctx.records.byPid.values()) this.adopt(rec, over, made);
    const tick = this.ctx.world.tick;
    this.regions.forEach((_, i) => this.schedule(i, tick + 1 + this.rng.int(this.checkTicks)));
  }

  /** Every region takes its turn to add a group, within each tick's budget, until a turn adds nothing. */
  refill(): void {
    this.regions.forEach((r, i) => {
      if (r.filling) return;
      r.filling = true;
      // Its deadline goes stale: it comes back to its checks when it is done filling.
      r.due = ++this.stamps;
      this.turns.push(i);
    });
  }

  /** Call every tick, after the deadlines. Filling regions add a group each in turn while the tick's budget lasts. */
  step(tick: number): void {
    this.budget(tick);
    let waiting = this.turns.length - this.turn;
    while (waiting-- > 0 && this.madeNow < TICK_MADE && this.triesNow < TICK_TRIES) {
      const i = this.turns[this.turn++]!;
      const r = this.regions[i]!;
      if (r.count < r.desired && this.add(i, r)) this.turns.push(i);
      else {
        r.filling = false;
        this.schedule(i, tick + this.checkTicks);
      }
    }
    if (this.turn > 1024 && this.turn * 2 > this.turns.length) {
      this.turns.splice(0, this.turn);
      this.turn = 0;
    }
  }

  private budget(tick: number): void {
    if (this.budgetAt === tick) return;
    this.budgetAt = tick;
    this.madeNow = 0;
    this.triesNow = 0;
  }

  /**
   * Whether this start replaces every wild creature: -ForceRespawnDinos, or ServerAutoForceRespawnWildDinosInterval seconds
   * since the last start that did. `saved` is what the save keeps, and `now` is in seconds of the wall clock. A save from
   * before the spawner starts counting now.
   */
  forced(saved: string | number | null, now: number): boolean {
    let last = NaN;
    try {
      last = Number((JSON.parse(String(saved)) as { forced?: unknown } | null)?.forced);
    } catch {
      // Nothing saved.
    }
    const every = this.ctx.rules.num("ServerAutoForceRespawnWildDinosInterval");
    const due = this.ctx.rules.flag("ForceRespawnDinos") === true || (every > 0 && now - last >= every);
    this.lastForced = due || !Number.isFinite(last) ? now : last;
    this.saved.dirty = true;
    return due;
  }

  /** A counted creature died or was tamed. Its region tops up at a later check. */
  left(rec: EntityRecord): void {
    const i = this.member.get(rec.pid);
    if (i === undefined) return;
    this.member.delete(rec.pid);
    const r = this.regions[i]!;
    r.count--;
    r.of.set(rec.kind, r.of.get(rec.kind)! - 1);
  }

  /** Takes every wild creature out of the world with what it carried, as ARK's DestroyWildDinos does. Returns how many went. */
  wipe(): number {
    const { world, records, creatures, items, survival, buffs, persistence } = this.ctx;
    let n = 0;
    for (const rec of [...records.byPid.values()]) {
      if (!isWild(world.reg, rec)) continue;
      this.left(rec);
      if (rec.inv) items.burnAll(rec);
      buffs.died(rec);
      const e = records.entOf.get(rec.pid);
      if (e !== undefined) {
        persistence?.detach(rec.pid);
        creatures.remove(e);
      }
      survival.forget(rec.pid);
      records.delete(rec.pid);
      n++;
    }
    return n;
  }

  /** A DEADLINE_SPAWN came due for region `i`: its check. Over the tick's budget, it is checked next tick. */
  due(i: number, stamp: number): void {
    const r = this.regions[i];
    if (!r || r.due !== stamp) return;
    const tick = this.ctx.world.tick;
    this.budget(tick);
    if (r.count < r.desired && (this.madeNow >= TICK_MADE || this.triesNow >= TICK_TRIES)) return this.schedule(i, tick + 1);
    if (r.count < r.desired) this.add(i, r);
    this.schedule(i, tick + this.checkTicks);
  }

  private schedule(i: number, tick: number): void {
    const r = this.regions[i]!;
    r.due = ++this.stamps;
    this.ctx.deadlines.push(tick, DEADLINE_SPAWN, i, r.due);
  }

  private adopt(rec: EntityRecord, over: readonly (readonly number[])[], made: ReadonlySet<number>): void {
    if (!made.has(rec.kind) || !isWild(this.ctx.world.reg, rec)) return;
    const dims = this.ctx.world.dims;
    const cx = Math.min(dims.chunksX - 1, Math.max(0, Math.floor(rec.x / CHUNK_SIZE)));
    const cz = Math.min(dims.chunksZ - 1, Math.max(0, Math.floor(rec.z / CHUNK_SIZE)));
    let best = -1;
    let near = Infinity;
    const consider = (i: number): void => {
      const r = this.regions[i]!;
      if (!r.makes.has(rec.kind)) return;
      const d = this.outside(r, rec.x, rec.z);
      if (d < near) {
        near = d;
        best = i;
      }
    };
    // The regions over its chunk and those beside it, and only if none of them could have made it, every region.
    for (let z = Math.max(0, cz - 1); z <= Math.min(dims.chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(dims.chunksX - 1, cx + 1); x++) for (const i of over[z * dims.chunksX + x]!) consider(i);
    }
    if (best < 0) this.regions.forEach((_, i) => consider(i));
    if (best >= 0) this.join(best, rec);
  }

  private join(i: number, rec: EntityRecord): void {
    const r = this.regions[i]!;
    this.member.set(rec.pid, i);
    r.count++;
    r.of.set(rec.kind, (r.of.get(rec.kind) ?? 0) + 1);
  }

  /** Metres from (x, z) to the region, 0 inside it. */
  private outside(r: Region, x: number, z: number): number {
    if (r.round) return Math.max(0, Math.hypot(x - r.x, z - r.z) - r.rx);
    return Math.hypot(Math.max(0, Math.abs(x - r.x) - r.rx), Math.max(0, Math.abs(z - r.z) - r.rz));
  }

  /** Draws an entry and puts its group down. Returns whether any of it was made. */
  private add(i: number, r: Region): boolean {
    const entry = this.draw(r);
    if (!entry) return false;
    const { world, records, creatures, persistence } = this.ctx;
    const lead = world.reg.move[entry.kinds[0]!]!;
    let x = 0;
    let z = 0;
    let found = false;
    for (let t = 0; t < TRIES && !found && this.triesNow < TICK_TRIES; t++) {
      this.triesNow++;
      if (r.round) {
        const a = this.rng.float() * Math.PI * 2;
        const d = r.rx * Math.sqrt(this.rng.float());
        x = r.x + Math.sin(a) * d;
        z = r.z + Math.cos(a) * d;
      } else {
        x = this.rng.range(r.x - r.rx, r.x + r.rx);
        z = this.rng.range(r.z - r.rz, r.z + r.rz);
      }
      found = this.land(lead, x, z) && !this.watched(x, z) && !this.guarded(x, z);
    }
    if (!found) {
      this.refused++;
      return false;
    }
    const difficulty = difficultyOf(this.ctx.rules);
    let made = 0;
    entry.kinds.forEach((kind, m) => {
      if (this.rng.float() >= entry.chances[m]! || this.full(r, kind)) return;
      const [ox, oz] = entry.offsets[m]!;
      if ((m > 0 || ox !== 0 || oz !== 0) && !this.land(world.reg.move[kind]!, x + ox, z + oz)) return;
      const e = creatures.spawn(kind, x + ox, z + oz, wildLevel(wildStep(this.rng), difficulty), "wild");
      if (e < 0) return;
      const rec = records.byPid.get(world.ents.pid[e]!)!;
      persistence?.attach(rec, e);
      this.join(i, rec);
      made++;
    });
    this.made += made;
    this.madeNow += made;
    return made > 0;
  }

  /** An entry by weight, among those whose first species is under its limit. */
  private draw(r: Region): Entry | null {
    let total = 0;
    for (const e of r.table.entries) if (!this.full(r, e.kinds[0]!)) total += e.weight;
    if (total <= 0) return null;
    let at = this.rng.float() * total;
    for (const e of r.table.entries) {
      if (this.full(r, e.kinds[0]!)) continue;
      at -= e.weight;
      if (at < 0) return e;
    }
    return null;
  }

  /** Whether the region holds as many of `kind` as its limit allows. */
  private full(r: Region, kind: number): boolean {
    const share = r.table.limits.get(kind);
    return share !== undefined && (r.of.get(kind) ?? 0) >= share * r.desired;
  }

  /**
   * Whether a body can stand at (x, z) on dry ground, clear of nodes whether or not anyone has loaded them. Against those nobody
   * has, its capsule runs from the ground to its height stepped up, so it covers both places groundAt and Creatures.spawn test.
   */
  private land(p: NonNullable<Registry["move"][number]>, x: number, z: number): boolean {
    const world = this.ctx.world;
    if (world.hf.heightAt(x, z) < world.hf.seaLevel || groundAt(world, p, x, z) !== GROUND_FREE) return false;
    return !world.unloaded?.meets(x, groundUnder(world.hf, x, z, p.radius), z, p.radius, p.height + p.stepUp);
  }

  /** Whether a survivor stands within PLAYER_RANGE, or a tribe's creature within TAME_RANGE. */
  private watched(x: number, z: number): boolean {
    const { game, world } = this.ctx;
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - x;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < PLAYER_RANGE * PLAYER_RANGE) return true;
    }
    const dims = world.dims;
    const cx0 = Math.max(0, Math.floor((x - TAME_RANGE) / CHUNK_SIZE));
    const cx1 = Math.min(dims.chunksX - 1, Math.floor((x + TAME_RANGE) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((z - TAME_RANGE) / CHUNK_SIZE));
    const cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + TAME_RANGE) / CHUNK_SIZE));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let e = ents.chunkHead[cz * dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          if (ents.team[e] === 0 || (ents.flags[e]! & F_PLAYER) !== 0 || this.creature[ents.kind[e]!] === 0) continue;
          const dx = ents.x[e]! - x;
          const dz = ents.z[e]! - z;
          if (dx * dx + dz * dz < TAME_RANGE * TAME_RANGE) return true;
        }
      }
    }
    return false;
  }

  /** Whether CORE_MOST of a tribe's foundations and ceilings stand within CORE_RANGE. */
  private guarded(x: number, z: number): boolean {
    const dims = this.ctx.world.dims;
    const cx0 = Math.max(0, Math.floor((x - CORE_RANGE) / CHUNK_SIZE));
    const cx1 = Math.min(dims.chunksX - 1, Math.floor((x + CORE_RANGE) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((z - CORE_RANGE) / CHUNK_SIZE));
    const cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + CORE_RANGE) / CHUNK_SIZE));
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const at = this.coresOf(cz * dims.chunksX + cx);
        if (!at) continue;
        for (let k = 0; k < at.length; k += 2) {
          const dx = at[k]! - x;
          const dz = at[k + 1]! - z;
          if (dx * dx + dz * dz < CORE_RANGE * CORE_RANGE && ++n >= CORE_MOST) return true;
        }
      }
    }
    return false;
  }

  /** Where a chunk's owned foundations and ceilings stand, or null if it has none. */
  private coresOf(chunk: number): Float32Array | null {
    const t = this.ctx.world.structs.chunks[chunk];
    if (!t || t.live === 0) return null;
    if (this.coresAt[chunk] === t.version) return this.cores[chunk] ?? null;
    const role = this.ctx.world.reg.role;
    const at: number[] = [];
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind !== 0 && t.owner[s] !== 0 && (role[kind] === ROLE_FOUNDATION || role[kind] === ROLE_CEILING)) at.push(t.x[s]!, t.z[s]!);
    }
    const cores = at.length > 0 ? Float32Array.from(at) : null;
    this.cores[chunk] = cores;
    this.coresAt[chunk] = t.version;
    return cores;
  }
}
