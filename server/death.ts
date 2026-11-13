// Death, the cache it leaves, and coming back.
//
// A death is one synchronous function. Everything it changes (the survivor's
// record, the new cache record, the ledger, the journal) is marked in the same
// tick and so lands in the same commit: after a crash the survivor is either
// alive with its things or dead with a cache that holds them, never both and
// never neither. The inventory is not copied to the cache; the cache takes the
// same object and the survivor is left with none.
//
// Also here: looking at a cache and opening it. The server finds what a body
// is looking at by casting a ray from its own eye. A client never names what
// it wants to open.

import { BitWriter } from "../shared/net/codec.ts";
import { MARKER_DEATH, RESULT_INVALID, RESULT_OK, SESSION_DEAD, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../shared/sim/character.ts";
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

export const DEADLINE_DESPAWN = 2;
/** Journal op: survivor pid, cause, cache pid (0 if it carried nothing). */
export const OP_DEATH = 3;
/** How long a cache waits to be collected: fifteen minutes. */
export const CACHE_TICKS = 15 * 60 * TICK_RATE;
/** A bag of dropped things lasts two minutes. */
export const BAG_TICKS = 2 * 60 * TICK_RATE;
export const MAX_MARKERS = 5;
/** How far a body can reach to use something, metres from its eye. */
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
}

export class Death {
  /** Deaths so far, for tests and measurement. */
  count = 0;
  /** The use key was pressed with no container in front: something else may want it (a bush to pick). */
  onUse: ((c: Client) => void) | null = null;
  /**
   * Called when the use button is pressed with the look on something built
   * (its ref) and nothing nearer. Returns a result code if that was a thing
   * to use, or -1 if it was not.
   */
  onUseBuilt: ((c: Client, ref: number) => number) | null = null;
  /** The structure the last look met, or -1: set by `target`. */
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

  /**
   * Put `n` of what is in `slot` (0 for all of it) on the ground just ahead
   * of the body, in a bag anyone can open, which is gone with what is left in
   * it after two minutes. False, changing nothing, if the body is not in the
   * world or nothing moved.
   */
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
    bag.expiresAt = world.tick + BAG_TICKS;
    records.dirty.add(bag.pid);
    this.place(bag);
    return true;
  }

  private clientOf(pid: number): Client | null {
    for (const c of this.ctx.game.clients) if (c?.active && c.pid === pid) return c;
    return null;
  }

  /** A body's health reached zero. */
  die(rec: EntityRecord, cause: number): void {
    const { world, records, items, survival, persistence } = this.ctx;
    if (rec.dead) return;
    const ents = world.ents;
    const e = records.entOf.get(rec.pid);
    if (rec.kind !== this.survivor) {
      // A creature: it is simply gone. What it carried goes with it, on the books.
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

    // 1. Everything it carried becomes a cache where it fell. The same inventory object, handed over.
    let cachePid = 0;
    const inv = items.inv(rec);
    if (inv.used() > 0) {
      const cache = records.create(this.cache, `${rec.name}'s cache`);
      cache.inv = inv;
      rec.inv = null;
      cache.x = rec.x;
      cache.y = rec.y;
      cache.z = rec.z;
      cache.expiresAt = world.tick + CACHE_TICKS;
      this.place(cache);
      cachePid = cache.pid;
    }
    // 2. A marker, so the place can be found again.
    rec.markers.push({ kind: MARKER_DEATH, x: rec.x, y: rec.y, z: rec.z, tick: world.tick });
    if (rec.markers.length > MAX_MARKERS) rec.markers.shift();
    rec.markersVersion++;
    // 3. The survivor is dead until it chooses where to return, with nothing in its hands.
    rec.dead = true;
    rec.held = -1;
    records.dirty.add(rec.pid);
    this.count++;
    // 4. The record of it, in the same commit.
    if (persistence) {
      const w = this.w;
      w.reset();
      w.uint53(rec.pid);
      w.u8(cause);
      w.uint53(cachePid);
      persistence.journal(OP_DEATH, w.bytes());
    }
    // 5. The body leaves the world.
    const c = this.clientOf(rec.pid);
    if (c) {
      this.close(c);
      this.ctx.game.kill(c);
      c.sentInv = -1;
      c.sentRespawn = false;
      this.ctx.game.sendText(c, TEXT_NOTICE, `You ${CAUSE_NAMES[cause] ?? "died"}.`);
    }
  }

  /** Return a dead survivor to life at one of the map's spawn points. */
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

  /**
   * An empty cache set down at a place, for things that have nowhere else to
   * go: what came back from something taken down and did not fit in the
   * hands. It waits as long as any cache. Whoever asks for it fills it.
   */
  spill(x: number, y: number, z: number, name: string): EntityRecord {
    const { world, records } = this.ctx;
    const cache = records.create(this.cache, name);
    const ground = world.hf.heightAt(x, z);
    cache.x = x;
    cache.y = ground > y ? ground : y;
    cache.z = z;
    cache.expiresAt = world.tick + CACHE_TICKS;
    records.dirty.add(cache.pid);
    this.place(cache);
    return cache;
  }

  /** Put a cache's body in the world (when it is made, and when a save is loaded) and set its clock. */
  place(cache: EntityRecord): void {
    const { world, records, deadlines } = this.ctx;
    const ents = world.ents;
    const e = ents.create(cache.kind, cache.x, cache.y, cache.z, F_PROP);
    if (e < 0) return; // no room for a body: it still exists, still expires, and can be found again after a restart
    ents.pid[e] = cache.pid;
    ents.setLook(e, 0, null, cache.name);
    records.entOf.set(cache.pid, e);
    if (cache.expiresAt > 0) deadlines.push(cache.expiresAt, DEADLINE_DESPAWN, cache.pid, cache.expiresAt);
  }

  /** A DEADLINE_DESPAWN entry came due. */
  despawn(pid: number, stamp: number): void {
    const rec = this.ctx.records.byPid.get(pid);
    if (rec && rec.expiresAt === stamp) this.remove(rec);
  }

  /** Take a cache out of the world. Anything still in it is destroyed, on the books. */
  remove(cache: EntityRecord): void {
    const { world, records, items, game } = this.ctx;
    for (const c of game.clients) if (c?.open === cache.pid) this.close(c);
    if (cache.inv) items.burnAll(cache);
    const e = records.entOf.get(cache.pid);
    if (e !== undefined) world.ents.destroy(e);
    records.delete(cache.pid);
  }

  /** The record of the container a session has open, or null. */
  openOf(c: Client): EntityRecord | null {
    return c.open === 0 ? null : (this.ctx.records.byPid.get(c.open) ?? null);
  }

  close(c: Client): void {
    c.open = 0;
  }

  /**
   * Once per tick, for every body: act on a press of the use button, and keep
   * open containers honest (still there, still in reach, not yet empty).
   */
  step(): void {
    const { world, records, items, game } = this.ctx;
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active) continue;
      if (c.open !== 0) {
        const box = records.byPid.get(c.open);
        const e = box ? records.entOf.get(box.pid) : undefined;
        if (box && box.at >= 0 && c.ent >= 0) {
          // Something built: it has no body. It stays open while it stands and its user stays by it, empty or not.
          const dx = box.x - ents.x[c.ent]!;
          const dy = box.y - ents.y[c.ent]!;
          const dz = box.z - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 2.5) * (REACH + 2.5)) this.close(c);
        } else if (!box || e === undefined || c.ent < 0) this.close(c);
        else if (items.inv(box).used() === 0) this.remove(box);
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

  /** What a body is looking at within reach: an entity index, or -1. The world in the way hides it. */
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
          const r = reg.bodyRadius[ents.kind[i]!]!;
          const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, ents.x[i]! - r, ents.y[i]!, ents.z[i]! - r, ents.x[i]! + r, ents.y[i]! + reg.bodyHeight[ents.kind[i]!]!, ents.z[i]! + r);
          if (t < best) {
            best = t;
            hit = i;
          }
        }
      }
    }
    return hit;
  }

  /** The use button: open the container looked at, or close the one that is open. */
  private use(c: Client): void {
    const ents = this.ctx.world.ents;
    const hit = this.target(c, REACH);
    const pid = hit >= 0 && (ents.flags[hit]! & F_PROP) !== 0 ? ents.pid[hit]! : 0;
    const box = pid !== 0 ? this.ctx.records.byPid.get(pid) : undefined;
    if (box && c.open !== pid) {
      c.open = pid;
      return;
    }
    // Something built, and nothing in front of it: a door, a box. What it says of the attempt, if it refused, the session is told.
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
