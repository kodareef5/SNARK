// A death marks everything it changes in one tick, so it lands in one commit. After a crash the survivor is alive with its
// things or dead with a cache that holds them. A client never names what it opens. The server casts a ray from the body's eye.

import { BitWriter } from "../shared/net/codec.ts";
import { MARKER_DEATH, RESULT_INVALID, RESULT_OK, SESSION_DEAD, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../shared/sim/character.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { F_PROP } from "../shared/sim/entities.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { TICK_RATE, chunkCx, chunkCz } from "../shared/coords.ts";
import { castWorld, lookDirection, rayBox, rayHit, HIT_NONE, HIT_STRUCTURE } from "../shared/world/ray.ts";
import type { Creatures } from "./creatures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { EntityRecord, Records } from "./records.ts";
import { CAUSE_NAMES, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import type { Rules } from "./settings/rules.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";

export const DEADLINE_DESPAWN = 2;
/** Journal op: survivor pid, cause, cache pid (0 if it carried nothing). */
export const OP_DEATH = 3;
export const CACHE_TICKS = 15 * 60 * TICK_RATE;
export const BAG_TICKS = 2 * 60 * TICK_RATE;
export const MAX_MARKERS = 5;
/** Metres from the eye. */
export const REACH = 3.5;

export interface DeathContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly creatures: Creatures;
  readonly persistence: Persistence | null;
  readonly deadlines: DeadlineHeap;
  readonly rules: Rules;
}

export class Death {
  count = 0;
  /** The use button found nothing here to act on. Another system may want it (a bush to pick). */
  onUse: ((c: Client) => void) | null = null;
  /** The use button was pressed looking at a structure (`ref`) with nothing nearer. Returns a result code, or -1 if it has no use. */
  onUseBuilt: ((c: Client, ref: number) => number) | null = null;
  /** Whether a session may open a creature that is awake (one of its tribe's). */
  canOpen: ((c: Client, rec: EntityRecord) => boolean) | null = null;
  /** Riding hooks. onRide gets the entity the use button was pressed on and returns a result code, or -1 if it does not take the press. */
  riding: ((c: Client) => boolean) | null = null;
  offMount: ((c: Client) => void) | null = null;
  onRide: ((c: Client, e: number) => number) | null = null;
  onShut: ((rec: EntityRecord) => void) | null = null;
  /** Ref of the structure the last target() call hit, or -1. */
  private struck = -1;
  private readonly ctx: DeathContext;
  private readonly survivor: number;
  private readonly cache: number;
  private readonly bag: number;
  private readonly dir = [0, 0, 0];
  private readonly w = new BitWriter(64);

  constructor(ctx: DeathContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.survivor = reg.index.get("core:survivor")!;
    this.cache = reg.index.get("core:cache")!;
    this.bag = reg.index.get("core:bag") ?? this.cache;
  }

  /** Drops `n` of the stack in `slot` (0 for all) in a bag ahead of the body. False, changing nothing, if nothing moved or it has no body. */
  drop(rec: EntityRecord, slot: number, n: number): boolean {
    const { world, records, items } = this.ctx;
    const e = records.entOf.get(rec.pid);
    if (e === undefined) return false;
    const ents = world.ents;
    const bag = records.create(this.bag, "bag");
    if (items.move(rec, slot, bag, 0, n) === 0) {
      records.delete(bag.pid);
      return false;
    }
    lookDirection(ents.yaw[e]!, 0, this.dir);
    bag.x = ents.x[e]! + this.dir[0]! * 0.8;
    bag.z = ents.z[e]! + this.dir[2]! * 0.8;
    const ground = world.hf.heightAt(bag.x, bag.z);
    bag.y = ground > ents.y[e]! ? ground : ents.y[e]!;
    bag.expiresAt = world.tick + this.lifetime(this.bag);
    records.dirty.add(bag.pid);
    this.place(bag);
    return true;
  }

  private clientOf(pid: number): Client | null {
    for (const c of this.ctx.game.clients) if (c?.active && c.pid === pid) return c;
    return null;
  }

  die(rec: EntityRecord, cause: number): void {
    const { world, records, items, survival, persistence } = this.ctx;
    if (rec.dead) return;
    const ents = world.ents;
    const e = records.entOf.get(rec.pid);
    if (rec.kind !== this.survivor) {
      // A creature leaves no cache. Its items are burned through the ledger.
      if (rec.inv) items.burnAll(rec);
      if (e !== undefined) {
        persistence?.detach(rec.pid);
        this.ctx.creatures.remove(e);
      }
      survival.forget(rec.pid);
      records.delete(rec.pid);
      this.count++;
      return;
    }
    if (e !== undefined) {
      rec.x = ents.x[e]!;
      rec.y = ents.y[e]!;
      rec.z = ents.z[e]!;
    }

    // The cache takes the survivor's inventory object. Nothing is copied.
    let cachePid = 0;
    const inv = items.inv(rec);
    if (inv.used() > 0) {
      const cache = records.create(this.cache, `${rec.name}'s cache`);
      cache.inv = inv;
      rec.inv = null;
      cache.x = rec.x;
      cache.y = rec.y;
      cache.z = rec.z;
      cache.expiresAt = world.tick + this.lifetime(this.cache);
      this.place(cache);
      cachePid = cache.pid;
    }
    rec.markers.push({ kind: MARKER_DEATH, x: rec.x, y: rec.y, z: rec.z, tick: world.tick });
    if (rec.markers.length > MAX_MARKERS) rec.markers.shift();
    rec.markersVersion++;
    rec.dead = true;
    rec.held = -1;
    records.dirty.add(rec.pid);
    this.count++;
    if (persistence) {
      const w = this.w;
      w.reset();
      w.uint53(rec.pid);
      w.u8(cause);
      w.uint53(cachePid);
      persistence.journal(OP_DEATH, w.bytes());
    }
    const c = this.clientOf(rec.pid);
    if (c) {
      this.close(c);
      this.ctx.game.kill(c);
      c.sentInv = -1;
      c.sentRespawn = false;
      this.ctx.game.sendText(c, TEXT_NOTICE, `You ${CAUSE_NAMES[cause] ?? "died"}.`);
    }
  }

  respawn(c: Client, x: number, z: number, yaw: number, y?: number): number {
    const { records, survival, game } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || !rec.dead || c.state !== SESSION_DEAD) return RESULT_INVALID;
    survival.refill(rec);
    rec.dead = false;
    records.dirty.add(rec.pid);
    if (!game.revive(c, x, z, yaw, y)) {
      rec.dead = true;
      return RESULT_INVALID;
    }
    return RESULT_OK;
  }

  /** Places an empty cache for items with nowhere else to go, such as a demolition refund that did not fit. The caller fills it. */
  spill(x: number, y: number, z: number, name: string): EntityRecord {
    const { world, records } = this.ctx;
    const cache = records.create(this.cache, name);
    const ground = world.hf.heightAt(x, z);
    cache.x = x;
    cache.y = ground > y ? ground : y;
    cache.z = z;
    cache.expiresAt = world.tick + this.lifetime(this.cache);
    records.dirty.add(cache.pid);
    this.place(cache);
    return cache;
  }

  /** In ticks. A dropped bag scales by the item decomposition rule, a cache by the product of the two corpse rules. */
  lifetime(kind: number): number {
    const rules = this.ctx.rules;
    const by = kind === this.bag && kind !== this.cache ? rules.num("GlobalItemDecompositionTimeMultiplier") : rules.num("GlobalCorpseDecompositionTimeMultiplier") * rules.num("UseCorpseLifeSpanMultiplier");
    return Math.max(1, Math.round((kind === this.bag && kind !== this.cache ? BAG_TICKS : CACHE_TICKS) * by));
  }

  /** The lifetime multipliers were `bagWas` and `cacheWas`. Rescales the time each bag and cache has left to the current rules. */
  retime(bagWas: number, cacheWas: number): void {
    const { world, records, deadlines, rules } = this.ctx;
    const tick = world.tick;
    const bagIs = rules.num("GlobalItemDecompositionTimeMultiplier");
    const cacheIs = rules.num("GlobalCorpseDecompositionTimeMultiplier") * rules.num("UseCorpseLifeSpanMultiplier");
    for (const rec of records.byPid.values()) {
      if (rec.expiresAt <= tick || (rec.kind !== this.bag && rec.kind !== this.cache)) continue;
      const bag = rec.kind === this.bag && rec.kind !== this.cache;
      const was = bag ? bagWas : cacheWas;
      const is = bag ? bagIs : cacheIs;
      if (was === is || !(was > 0)) continue;
      rec.expiresAt = tick + leftAtPeriod(rec.expiresAt - tick, was, is);
      deadlines.push(rec.expiresAt, DEADLINE_DESPAWN, rec.pid, rec.expiresAt);
      records.dirty.add(rec.pid);
    }
  }

  /** Called when the record is made and again when a save is loaded. */
  place(cache: EntityRecord): void {
    const { world, records, deadlines } = this.ctx;
    const ents = world.ents;
    const e = ents.create(cache.kind, cache.x, cache.y, cache.z, F_PROP);
    if (e < 0) return; // The entity store is full. The record stays, and the next load places it again.
    ents.pid[e] = cache.pid;
    ents.setLook(e, 0, null, cache.name);
    records.entOf.set(cache.pid, e);
    if (cache.expiresAt > 0) deadlines.push(cache.expiresAt, DEADLINE_DESPAWN, cache.pid, cache.expiresAt);
  }

  /** A deadline whose stamp no longer matches expiresAt is stale and is ignored. */
  despawn(pid: number, stamp: number): void {
    const rec = this.ctx.records.byPid.get(pid);
    if (rec && rec.expiresAt === stamp) this.remove(rec);
  }

  /** Anything still in the cache is burned through the ledger. */
  remove(cache: EntityRecord): void {
    const { world, records, items, game } = this.ctx;
    for (const c of game.clients) if (c?.open === cache.pid) this.close(c);
    if (cache.inv) items.burnAll(cache);
    const e = records.entOf.get(cache.pid);
    if (e !== undefined) world.ents.destroy(e);
    records.delete(cache.pid);
  }

  openOf(c: Client): EntityRecord | null {
    return c.open === 0 ? null : (this.ctx.records.byPid.get(c.open) ?? null);
  }

  close(c: Client): void {
    const was = c.open !== 0 ? this.ctx.records.byPid.get(c.open) : undefined;
    c.open = 0;
    if (was) this.onShut?.(was);
  }

  /** Once per tick. Handles the use button, closes a container that is gone or out of reach, and removes an emptied cache or bag. */
  step(): void {
    const { world, records, items, game } = this.ctx;
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active) continue;
      if (c.open !== 0) {
        const box = records.byPid.get(c.open);
        const e = box ? records.entOf.get(box.pid) : undefined;
        if (box && box.at >= 0 && c.ent >= 0) {
          // A built container has no entity. It stays open, empty or not, while it stands and its user is near.
          const dx = box.x - ents.x[c.ent]!;
          const dy = box.y - ents.y[c.ent]!;
          const dz = box.z - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 2.5) * (REACH + 2.5)) this.close(c);
        } else if (!box || e === undefined || c.ent < 0) this.close(c);
        else if ((ents.flags[e]! & F_PROP) !== 0 && items.inv(box).used() === 0) this.remove(box);
        // A creature that woke up closes unless canOpen allows it.
        else if ((ents.flags[e]! & F_PROP) === 0 && !box.out && !(this.canOpen?.(c, box) ?? false)) this.close(c);
        else {
          const dx = ents.x[e]! - ents.x[c.ent]!;
          const dy = ents.y[e]! - ents.y[c.ent]!;
          const dz = ents.z[e]! - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 1.5) * (REACH + 1.5)) this.close(c);
        }
      }
      if (c.ent >= 0 && (c.pressed & BTN_USE) !== 0) this.use(c);
    }
  }

  /** Index of the entity the body looks at within `reach`, or -1. World geometry nearer than the entity hides it. */
  target(c: Client, reach: number): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    const d = this.dir;
    lookDirection(c.heldYaw, c.heldPitch, d);
    const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    let best = what === HIT_NONE ? reach : rayHit.t;
    this.struck = what === HIT_STRUCTURE ? rayHit.ref : -1;
    let hit = -1;
    const dims = world.dims;
    const ccx = chunkCx(dims, ents.chunk[e]!);
    const ccz = chunkCz(dims, ents.chunk[e]!);
    const span = Math.ceil(reach / 64);
    for (let cz = ccz - span; cz <= ccz + span; cz++) {
      for (let cx = ccx - span; cx <= ccx + span; cx++) {
        if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if (i === e) continue;
          // A young creature's box is scaled as the client draws it.
          const size = ents.grown[i] !== 0 && (ents.flags[i]! & F_PROP) === 0 ? youngScale(reg.birthScale[ents.kind[i]!]!, ents.span[i]!, ents.grown[i]!, world.tick) : 1;
          const r = reg.bodyRadius[ents.kind[i]!]! * size;
          const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, ents.x[i]! - r, ents.y[i]!, ents.z[i]! - r, ents.x[i]! + r, ents.y[i]! + reg.bodyHeight[ents.kind[i]!]! * size, ents.z[i]! + r);
          if (t < best) {
            best = t;
            hit = i;
          }
        }
      }
    }
    return hit;
  }

  private use(c: Client): void {
    const ents = this.ctx.world.ents;
    if (this.riding?.(c)) {
      this.offMount?.(c);
      return;
    }
    const hit = this.target(c, REACH);
    if (hit >= 0 && (ents.flags[hit]! & F_PROP) === 0 && this.onRide) {
      const code = this.onRide(c, hit);
      if (code > 0) this.ctx.game.notify(c, code);
      if (code >= 0) return;
    }
    // A prop (a cache or a bag), an unconscious creature, or one that canOpen allows. Never an egg or a survivor.
    const there = hit >= 0 ? this.ctx.records.byPid.get(ents.pid[hit]!) : undefined;
    const pid = hit >= 0 && there?.egg == null && ((ents.flags[hit]! & F_PROP) !== 0 || (there !== undefined && there.keyHash === null && (there.out || (this.canOpen?.(c, there) ?? false)))) ? ents.pid[hit]! : 0;
    const box = pid !== 0 ? there : undefined;
    if (box && c.open !== pid) {
      c.open = pid;
      return;
    }
    // A structure with nothing in front of it, such as a door or a box. A refusal code is sent to the session.
    if (hit < 0 && this.struck >= 0 && this.onUseBuilt) {
      const code = this.onUseBuilt(c, this.struck);
      if (code > 0) this.ctx.game.notify(c, code);
      if (code >= 0) return;
    }
    const had = c.open !== 0;
    this.close(c);
    if (!had && !box) this.onUse?.(c);
  }
}
