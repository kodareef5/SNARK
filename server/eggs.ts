// An egg is a thing, as in ARK. Where it lies it is a prop. Taken up (CMD_TAKE) it is an item, and set down (a drop of
// that item) it is a prop again, keeping what it is. An unfertilised egg lies holding its item, decomposes on the ground
// and is food. A fertilised one lies as its record alone; taken up, its item stands for that record (Inventory.ref),
// which keeps the young's genome and the time it has left and does not hatch while held (server/breeding.ts). Nothing of
// the genome is ever sent: an egg is seen by its kind, its name and when it will hatch.

import { CHUNK_SIZE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_OK } from "../shared/net/protocol.ts";
import { EGG_LIMIT, EGG_LIMIT_RANGE } from "../shared/sim/breeding.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_PROP } from "../shared/sim/entities.ts";
import { Inventory } from "../shared/sim/items.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection } from "../shared/world/ray.ts";
import { fertile, held, type Breeding } from "./breeding.ts";
import type { Creatures } from "./creatures.ts";
import { BAG_TICKS, REACH } from "./death.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** Metres past the reach of the use button that a take is still allowed, for the time the press took to arrive. */
const LATE = 1;
/**
 * ARK angers the wild of an egg's species near where a wild egg is taken, and names who but not how near. Chosen: within
 * this many metres. Species that flee are not angered, which keeps ARK's exceptions (dodo, moschops, parasaur), unless they
 * defend their egg as the pteranodon does (D492).
 */
export const ANGER_RANGE = 30;
/** Places in the entity store an egg or feces lying may not take. The same as a dropped bag (server/death.ts). */
const STORE_RESERVE = 256;
/** Metres ahead of the body that an egg is set down. */
const AHEAD = 0.8;
const TEMPER_FLEES = 0;

export interface EggsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly rules: Rules;
  readonly deadlines: DeadlineHeap;
  readonly creatures: Creatures;
  readonly breeding: Breeding;
  /** Puts a prop's body in the world at its record's position, and starts its time if it has one (Death.place). */
  place(rec: EntityRecord): void;
}

export class Eggs {
  /** Counters. */
  taken = 0;
  setDown = 0;
  laid = 0;
  angered = 0;
  /** Things a load found that did not agree, and put right: a slot standing for no egg, or an egg held in no slot. */
  mended = 0;
  readonly ctx: EggsContext;
  /** Per item, the egg prop it lies as, 0 for an item that is no egg. */
  private readonly propOf: Uint16Array;
  /** Per egg prop, the species that lays it. */
  private readonly speciesOf: Uint16Array;
  private readonly dir = [0, 0, 0];

  constructor(ctx: EggsContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    const n = reg.defs.length;
    this.propOf = new Uint16Array(n);
    this.speciesOf = new Uint16Array(n);
    for (let i = 1; i < n; i++) {
      if (reg.propItem[i] !== 0) this.propOf[reg.propItem[i]!] = i;
      if (reg.propFertile[i] !== 0) this.propOf[reg.propFertile[i]!] = i;
      const egg = reg.breedEgg[i]!;
      if (egg !== 0xffff && egg !== 0) this.speciesOf[egg] = i;
    }
    ctx.items.onRefGone = (ref) => this.gone(ref);
  }

  /** The egg prop an item lies as, or 0 if it is no egg. */
  propOfItem(item: number): number {
    return this.propOf[item] ?? 0;
  }

  /** CMD_TAKE: an egg the session looks at, into its bag. */
  take(c: Client, r: BitReader): number {
    const which = r.u32();
    if (r.overflow) return RESULT_INVALID;
    const { world, records } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.ent < 0 || me.dead || me.out) return RESULT_DENIED;
    const e = which < ents.cap && (ents.flags[which]! & (F_ALIVE | F_PROP)) === (F_ALIVE | F_PROP) ? which : -1;
    const egg = e >= 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!egg || egg.egg === null || held(egg) || records.entOf.get(egg.pid) !== e) return RESULT_INVALID;
    // From the eye to the middle of the egg, within reach and with nothing of the world between.
    const reg = world.reg;
    const ox = ents.x[c.ent]!;
    const oy = ents.y[c.ent]! + stanceEye(reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
    const oz = ents.z[c.ent]!;
    const dx = ents.x[e]! - ox;
    const dy = ents.y[e]! + reg.bodyHeight[egg.kind]! / 2 - oy;
    const dz = ents.z[e]! - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > REACH + LATE) return RESULT_FAR;
    const clear = d - reg.bodyRadius[egg.kind]!;
    if (clear > 0 && castWorld(world, ox, oy, oz, dx / d, dy / d, dz / d, clear) !== HIT_NONE) return RESULT_FAR;
    return this.takeUp(me, egg, c.ent);
  }

  /** `me` takes up the egg lying as `egg`, by the entity `by` (-1 for none). Returns a RESULT code. Reach is the caller's. */
  takeUp(me: EntityRecord, egg: EntityRecord, by = -1): number {
    const e = this.ctx.records.entOf.get(egg.pid);
    if (e === undefined || egg.egg === null || held(egg)) return RESULT_INVALID;
    return fertile(egg) ? this.takeFertile(me, egg, e) : this.takeLaid(me, egg, e, by);
  }

  /** An unfertilised egg, or a stack set down, goes whole into the bag. */
  private takeLaid(me: EntityRecord, egg: EntityRecord, e: number, by: number): number {
    const { world, records, items } = this.ctx;
    const inv = egg.inv ? items.inv(egg) : null;
    const item = inv ? inv.item[0]! : 0;
    if (!inv || item === 0) return RESULT_INVALID;
    if (!items.give(egg, me, item, inv.total(item))) return RESULT_FULL;
    const x = egg.x;
    const z = egg.z;
    world.ents.destroy(e);
    records.delete(egg.pid);
    this.taken++;
    // A wild egg angers the wild of its species near it. One laid by a tribe's creature, or set down, angers none.
    if (egg.team === 0) this.anger(egg.egg!.species, x, z, by);
    return RESULT_OK;
  }

  /** A fertilised egg becomes its item, standing for its record, and stops incubating with the time it has left. */
  private takeFertile(me: EntityRecord, egg: EntityRecord, e: number): number {
    const { world, records, items, breeding } = this.ctx;
    const item = world.reg.propFertile[egg.kind]!;
    if (item === 0) return RESULT_INVALID;
    if (items.mintRef(me, item, egg.pid) < 0) return RESULT_FULL;
    egg.x = world.ents.x[e]!;
    egg.y = world.ents.y[e]!;
    egg.z = world.ents.z[e]!;
    world.ents.destroy(e);
    records.entOf.delete(egg.pid);
    breeding.takenUp(egg);
    this.taken++;
    return RESULT_OK;
  }

  /**
   * Sets down `n` (0 for all) of the egg in `slot` of `rec`'s inventory ahead of its body, as an egg where it lies. Null if
   * the slot holds no egg, for the caller to drop it as anything else; false if it could not be set down.
   */
  put(rec: EntityRecord, slot: number, n: number): boolean | null {
    const { world, records, items, breeding } = this.ctx;
    const inv = items.inv(rec);
    const item = slot < inv.cap ? inv.item[slot]! : 0;
    const prop = item !== 0 ? this.propOfItem(item) : 0;
    if (prop === 0) return null;
    const e = records.entOf.get(rec.pid);
    const ents = world.ents;
    if (e === undefined || ents.room < STORE_RESERVE) return false;
    const ref = inv.refOf(slot);
    const egg = ref !== 0 ? records.byPid.get(ref) : undefined;
    if (ref !== 0 && (!egg || !held(egg))) return false;
    lookDirection(ents.yaw[e]!, 0, this.dir);
    const at = this.ground(prop, ents.x[e]! + this.dir[0]! * AHEAD, ents.z[e]! + this.dir[2]! * AHEAD, ents.x[e]!, ents.y[e]!, ents.z[e]!);
    if (egg) {
      // The item goes, and the egg it stood for lies there again and incubates from where it stopped.
      inv.setRef(slot, 0);
      items.burn(rec, slot, 1);
      egg.x = at[0]!;
      egg.y = at[1]!;
      egg.z = at[2]!;
      egg.yaw = ents.yaw[e]!;
      this.ctx.place(egg);
      breeding.setDown(egg);
      this.setDown++;
      return true;
    }
    const lies = this.lie(prop, this.speciesOf[prop]!, rec.team, at[0]!, at[1]!, at[2]!, ents.yaw[e]!);
    if (items.move(rec, slot, lies, 0, n) === 0) {
      records.delete(lies.pid);
      return false;
    }
    this.start(lies, item);
    this.setDown++;
    return true;
  }

  /**
   * A female of `species` lays an unfertilised egg on the ground at (x, z), no lower than `y`, or where she stands at
   * (bx, y, bz) if that place is shut in; or none if EGG_LIMIT of them already lie near or there is no room. `team` is
   * hers, 0 for a wild one. Returns the egg's record, or null.
   */
  lay(species: number, team: number, x: number, y: number, z: number, yaw: number, bx = x, bz = z): EntityRecord | null {
    const { world, items } = this.ctx;
    const reg = world.reg;
    const prop = reg.breedEgg[species]!;
    const item = prop !== 0xffff && prop !== 0 ? reg.propItem[prop]! : 0;
    if (item === 0 || world.ents.room < STORE_RESERVE || this.near(prop, x, z) >= EGG_LIMIT) return null;
    const at = this.ground(prop, x, z, bx, y, bz);
    const egg = this.lie(prop, species, team, at[0]!, at[1]!, at[2]!, yaw);
    if (items.mint(egg, item, 1, 0, 0, -1, "laid") !== 1) {
      this.ctx.records.delete(egg.pid);
      return null;
    }
    this.start(egg, item);
    this.laid++;
    return egg;
  }

  /** Unfertilised eggs of prop `prop` lying within EGG_LIMIT_RANGE of (x, z). */
  near(prop: number, x: number, z: number): number {
    const { world, records } = this.ctx;
    const ents = world.ents;
    let n = 0;
    this.each(x, z, EGG_LIMIT_RANGE, (e) => {
      if (ents.kind[e] !== prop) return;
      const rec = records.byPid.get(ents.pid[e]!);
      if (rec && rec.egg !== null && !fertile(rec)) n++;
    });
    return n;
  }

  /**
   * Where a prop of kind `prop` put down at (x, z) by a body standing at (bx, by, bz) lies: on the ground there, or no lower
   * than the body's feet, as on a floor; or where the body stands if the place is shut in.
   */
  ground(prop: number, x: number, z: number, bx: number, by: number, bz: number): [number, number, number] {
    const world = this.ctx.world;
    const reg = world.reg;
    const g = groundUnder(world.hf, x, z, reg.bodyRadius[prop]!);
    const y = g > by ? g : by;
    if (!capsuleFree(world, x, y, z, reg.bodyRadius[prop]!, reg.bodyHeight[prop]!)) return [bx, by, bz];
    return [x, y, z];
  }

  /** A record for an unfertilised egg lying, with room for its item and no body yet. */
  private lie(prop: number, species: number, team: number, x: number, y: number, z: number, yaw: number): EntityRecord {
    const reg = this.ctx.world.reg;
    const egg = this.ctx.records.create(prop, (reg.defs[reg.propItem[prop]!] as { label?: string } | null)?.label ?? "egg");
    egg.egg = { species, span: 0, hatchAt: 0, carrier: 0 };
    egg.team = team;
    egg.inv = new Inventory(1);
    egg.x = x;
    egg.y = y;
    egg.z = z;
    egg.yaw = yaw;
    return egg;
  }

  /** It lies as long as its item lies on the ground, by the item decomposition rule, and then is gone with what it holds. */
  private start(egg: EntityRecord, item: number): void {
    const { world, rules } = this.ctx;
    const ticks = world.reg.decomposeTicks[item] || BAG_TICKS;
    egg.expiresAt = world.tick + Math.max(1, Math.round(ticks * rules.num("GlobalItemDecompositionTimeMultiplier")));
    this.ctx.records.dirty.add(egg.pid);
    this.ctx.place(egg);
  }

  /** The wild of `species` within ANGER_RANGE of (x, z) go for `by`, unless the species flees and does not defend its egg. */
  private anger(species: number, x: number, z: number, by: number): void {
    const { world, creatures } = this.ctx;
    const flees = world.reg.temper[species] === TEMPER_FLEES;
    if (by < 0 || (flees && world.reg.defendsEgg[species] === 0)) return;
    const ents = world.ents;
    this.each(x, z, ANGER_RANGE, (e) => {
      if (ents.kind[e] !== species || ents.team[e] !== 0 || (ents.flags[e]! & (F_PROP | F_AWAKE)) !== F_AWAKE) return;
      if (flees) creatures.mind.defend(e, by);
      else creatures.mind.provoke(e, x, z, by);
      this.angered++;
    });
  }

  /** Calls `fn` with each entity within `range` metres of (x, z), across the chunks there. */
  private each(x: number, z: number, range: number, fn: (e: number) => void): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const dims = world.dims;
    const x0 = Math.max(0, Math.floor((x - range) / CHUNK_SIZE));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((x + range) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((z - range) / CHUNK_SIZE));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((z + range) / CHUNK_SIZE));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          const dx = ents.x[i]! - x;
          const dz = ents.z[i]! - z;
          if (dx * dx + dz * dz <= range * range) fn(i);
        }
      }
    }
  }

  /** A held egg's item was eaten, spoiled or burned with what held it, so its young is gone with it. */
  gone(ref: number): void {
    const rec = this.ctx.records.byPid.get(ref);
    if (rec && held(rec)) this.ctx.records.delete(ref);
  }

  /**
   * Call after a load, once breeding has resumed. Each slot that stands for an egg must name one held egg that no other
   * slot names, and each held egg must be named by a slot: what is not is put right and counted in `mended`.
   */
  resume(): void {
    const { world, records, items } = this.ctx;
    const named = new Set<number>();
    for (const rec of [...records.byPid.values()]) {
      const inv = rec.inv;
      if (!inv?.ref) continue;
      for (let s = 0; s < inv.cap; s++) {
        const ref = inv.ref[s]!;
        if (ref === 0 || inv.item[s] === 0) continue;
        const egg = records.byPid.get(ref);
        if (egg && held(egg) && !named.has(ref) && world.reg.propFertile[egg.kind] === inv.item[s]) {
          named.add(ref);
          continue;
        }
        inv.setRef(s, 0);
        items.burn(rec, s, inv.count[s]!, true);
        this.mended++;
      }
    }
    for (const rec of [...records.byPid.values()]) {
      if (!held(rec) || named.has(rec.pid)) continue;
      records.delete(rec.pid);
      this.mended++;
    }
  }
}
