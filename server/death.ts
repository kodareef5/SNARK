// A death marks everything it changes in one tick, so it lands in one commit. After a crash the survivor is alive with its
// things or dead with a cache that holds them. A client never names what it opens. The server casts a ray from the body's eye.

import { BitWriter } from "../shared/net/codec.ts";
import { CHOOSE_DIED, MARKER_DEATH, RESULT_INVALID, RESULT_OK, SESSION_DEAD, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../shared/sim/character.ts";
import { leftAtPeriod, youngScale } from "../shared/sim/breeding.ts";
import { useVehicle } from "../shared/sim/vehicle-frame.ts";
import { F_PROP, GEAR_COUNT, GEAR_HELD } from "../shared/sim/entities.ts";
import { Inventory, stackOf } from "../shared/sim/items.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { TICK_RATE, chunkCx, chunkCz } from "../shared/coords.ts";
import { castWorld, lookDirection, rayBox, rayHit, HIT_NONE, HIT_STRUCTURE } from "../shared/world/ray.ts";
import type { Corpses } from "./corpses.ts";
import type { Creatures } from "./creatures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { EntityRecord, Records } from "./records.ts";
import { CAUSE_NAMES, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";
import type { Rules } from "./settings/rules.ts";
import { event, type Bus } from "./events/bus.ts";

export const DEADLINE_DESPAWN = 2;
/** Journal op: survivor pid, cause, cache pid (0 if it carried nothing). */
export const OP_DEATH = 3;
export const CACHE_TICKS = 15 * 60 * TICK_RATE;
export const BAG_TICKS = 2 * 60 * TICK_RATE;
/** Places in the entity store a dropped bag may not take. */
const STORE_RESERVE = 256;
/** Bags and spill caches one survivor may have lying at once. */
const LYING_MOST = 12;
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
  readonly bus: Bus;
}

const DEATH_CACHE = event("death.cache");

export class Death {
  count = 0;
  /** Shared current posed eye for seated interactions; absent on small standalone fixtures. */
  eye: ((entity: number, out: Float64Array) => void) | null = null;
  private readonly eyeAt = new Float64Array(3);
  /** The use button found nothing here to act on. Another system may want it (a bush to pick). */
  onUse: ((c: Client) => void) | null = null;
  /** The use button was pressed looking at a structure (`ref`) with nothing nearer. Returns a result code, or -1 if it has no use. */
  onUseBuilt: ((c: Client, ref: number) => number) | null = null;
  /** Whether a session may open a creature that is awake (one of its tribe's). */
  canOpen: ((c: Client, rec: EntityRecord) => boolean) | null = null;
  /** Whether a session that has the built container at `ref` open may go on using it. */
  keepsBuilt: ((c: Client, ref: number) => boolean) | null = null;
  /** Reach and authorization for a live hull or a salvage hull opened at its stern. */
  keepsBoatCargo: ((c: Client, e: number) => boolean) | null = null;
  /** Riding hooks. onRide gets the entity the use button was pressed on and returns a result code, or -1 if it does not take the press. */
  riding: ((c: Client) => boolean) | null = null;
  offMount: ((c: Client) => void) | null = null;
  onRide: ((c: Client, e: number) => number) | null = null;
  onShut: ((rec: EntityRecord) => void) | null = null;
  /** Where a creature's body goes when it dies. Without it the creature leaves a cache of what it carried. */
  corpses: Corpses | null = null;
  /** Ref of the structure the last target() call hit, or -1. */
  private struck = -1;
  private readonly ctx: DeathContext;
  private readonly survivor: number;
  private readonly cache: number;
  private readonly bag: number;
  /** The record kind of a creature's body, or -1. */
  private readonly corpse: number;
  private readonly dir = [0, 0, 0];
  private readonly w = new BitWriter(64);
  /** Per lying bag's pid, the inventory, and its version, that its gear was last set from (show). */
  private readonly shown = new Map<number, { inv: Inventory | null; version: number }>();
  private readonly gear = new Uint16Array(GEAR_COUNT);

  constructor(ctx: DeathContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.survivor = reg.index.get("core:survivor")!;
    this.cache = reg.index.get("core:cache")!;
    this.bag = reg.index.get("core:bag") ?? this.cache;
    this.corpse = reg.index.get("core:corpse") ?? -1;
  }

  /** Per survivor pid, the pids of the bags and spill caches it has lying, oldest first. */
  private readonly lyingOf = new Map<number, number[]>();

  /** The newest container of `kind` that `owner` has lying within `reach` metres of a point, or null. */
  private lying(owner: number, kind: number, x: number, y: number, z: number, reach: number): EntityRecord | null {
    const list = this.lyingOf.get(owner);
    if (!list) return null;
    const records = this.ctx.records;
    for (let k = list.length - 1; k >= 0; k--) {
      const rec = records.byPid.get(list[k]!);
      if (!rec || rec.kind !== kind || !records.entOf.has(rec.pid)) continue;
      if ((rec.x - x) * (rec.x - x) + (rec.y - y) * (rec.y - y) + (rec.z - z) * (rec.z - z) < reach * reach) return rec;
    }
    return null;
  }

  /** Counts a new bag or spill cache as `owner`'s. One survivor has LYING_MOST at most: the oldest goes, with what is in it. */
  private lie(owner: number, made: EntityRecord): void {
    const records = this.ctx.records;
    let list = this.lyingOf.get(owner);
    if (!list) this.lyingOf.set(owner, (list = []));
    let kept = 0;
    for (const pid of list) if (records.byPid.has(pid)) list[kept++] = pid;
    list.length = kept;
    while (list.length >= LYING_MOST) {
      const old = records.byPid.get(list.shift()!);
      if (old) this.remove(old);
    }
    list.push(made.pid);
  }

  /**
   * A bag that holds one stack shows it: the item in hand of its gear is that stack's item, and a client draws the item
   * lying in place of the bag (client/core/render/dropped.ts). Gear already replicates, so nothing new is sent. A bag of
   * more stacks, or of none, shows nothing and is drawn as a bag. Shown again whenever its inventory changes (step).
   */
  private show(bag: EntityRecord): void {
    const e = this.ctx.records.entOf.get(bag.pid);
    if (e === undefined) {
      this.shown.delete(bag.pid);
      return;
    }
    const inv = bag.inv;
    this.shown.set(bag.pid, { inv, version: inv ? inv.version : -1 });
    let item = 0;
    if (inv && inv.used() === 1) for (let s = 0; s < inv.cap && item === 0; s++) item = inv.item[s]!;
    const ents = this.ctx.world.ents;
    // A bag that never showed a stack has no gear to send.
    if (item === 0 && !ents.gears.has(e)) return;
    this.gear[GEAR_HELD] = item;
    ents.setGear(e, this.gear);
  }

  /** Starts a lying container's time again, so that what was just put in it lies as long as anything else. */
  private renew(rec: EntityRecord): void {
    rec.expiresAt = this.ctx.world.tick + this.lifetime(rec.kind);
    this.ctx.deadlines.push(rec.expiresAt, DEADLINE_DESPAWN, rec.pid, rec.expiresAt);
    this.ctx.records.dirty.add(rec.pid);
  }

  /** Removes one lying bag or spill cache with a body, anyone's, to make room in the entity store. False if there is none. */
  private evict(): boolean {
    const records = this.ctx.records;
    for (const list of this.lyingOf.values()) {
      for (const pid of list) {
        const rec = records.byPid.get(pid);
        if (!rec || !records.entOf.has(pid)) continue;
        this.remove(rec);
        return true;
      }
    }
    return false;
  }

  /** Drops `n` of the stack in `slot` (0 for all) in a bag ahead of the body. False, changing nothing, if nothing moved or it has no body. */
  drop(rec: EntityRecord, slot: number, n: number): boolean {
    const { world, records, items } = this.ctx;
    const e = records.entOf.get(rec.pid);
    if (e === undefined) return false;
    const ents = world.ents;
    lookDirection(ents.yaw[e]!, 0, this.dir);
    const x = ents.x[e]! + this.dir[0]! * 0.8;
    const z = ents.z[e]! + this.dir[2]! * 0.8;
    // A bag this survivor dropped takes the next thing too, while it lies within reach of the body and has room. Each drop
    // used to make a bag, and one survivor dropping single items filled the entity store in half a minute.
    const last = this.lying(rec.pid, this.bag, ents.x[e]!, ents.y[e]!, ents.z[e]!, 2);
    if (last) {
      const inv = items.inv(last);
      const src = items.inv(rec);
      const what = src.item[slot]!;
      let to = -1;
      // Only onto a stack it joins: the same item at the same quality and flags. Put on another, the move would swap.
      for (let s = 0; s < inv.bag && to < 0; s++) if (inv.item[s] === what && inv.quality[s] === src.quality[slot] && inv.flags[s] === src.flags[slot] && inv.count[s]! < stackOf(what, inv.flags[s]!, items.table)) to = s;
      if (to < 0) to = inv.free();
      if (to >= 0 && items.move(rec, slot, last, to, n) > 0) {
        this.renew(last);
        this.show(last);
        return true;
      }
    }
    // The last places in the store are kept for bodies, and for what the dead leave.
    if (ents.room < STORE_RESERVE) return false;
    const bag = records.create(this.bag, "bag");
    if (items.move(rec, slot, bag, 0, n) === 0) {
      records.delete(bag.pid);
      return false;
    }
    this.lie(rec.pid, bag);
    bag.x = x;
    bag.z = z;
    const ground = world.hf.heightAt(bag.x, bag.z);
    bag.y = ground > ents.y[e]! ? ground : ents.y[e]!;
    bag.expiresAt = world.tick + this.lifetime(this.bag);
    records.dirty.add(bag.pid);
    this.place(bag);
    return true;
  }

  /**
   * Leaves everything `rec` carries, worn things too, in one bag at a point: what a survivor that travels from a bed drops
   * there. The bag takes the inventory object, so nothing is copied. The suit it was issued is not left: it goes, and a new
   * one is issued where it rises (server/suit.ts). Null if it carried nothing else.
   */
  dropAll(rec: EntityRecord, x: number, y: number, z: number): EntityRecord | null {
    const { records, items } = this.ctx;
    const inv = items.inv(rec);
    items.burnIssued(rec);
    if (inv.used() === 0) return null;
    const bag = records.create(this.bag, "bag");
    bag.inv = inv;
    rec.inv = null;
    rec.held = -1;
    bag.x = x;
    bag.y = y;
    bag.z = z;
    bag.expiresAt = this.ctx.world.tick + this.lifetime(this.bag);
    this.lie(rec.pid, bag);
    records.dirty.add(bag.pid);
    records.dirty.add(rec.pid);
    this.place(bag);
    return bag;
  }

  /**
   * Mints `n` of `item` into a bag at the feet of `rec`, whose harvest gave more than it could hold: the bag it last left
   * there while that has room, else new ones. Returns how many went in.
   */
  overflow(rec: EntityRecord, item: number, n: number): number {
    const { world, records, items } = this.ctx;
    const e = records.entOf.get(rec.pid);
    if (e === undefined) return 0;
    const ents = world.ents;
    const x = ents.x[e]!;
    const y = ents.y[e]!;
    const z = ents.z[e]!;
    let given = 0;
    const last = this.lying(rec.pid, this.bag, x, y, z, 2);
    if (last) {
      given += items.mint(last, item, n, 0, 0, -1, "harvest");
      if (given > 0) {
        this.renew(last);
        this.show(last);
      }
    }
    // A bag of ten stacks holds a 50x server's blow: four new ones are more than enough.
    for (let k = 0; k < 4 && given < n; k++) {
      const bag = records.create(this.bag, "bag");
      bag.x = x;
      bag.z = z;
      const ground = world.hf.heightAt(x, z);
      bag.y = ground > y ? ground : y;
      bag.expiresAt = world.tick + this.lifetime(this.bag);
      const got = items.mint(bag, item, n - given, 0, 0, -1, "harvest");
      if (got === 0) {
        records.delete(bag.pid);
        break;
      }
      given += got;
      this.lie(rec.pid, bag);
      records.dirty.add(bag.pid);
      this.place(bag);
    }
    return given;
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
    // Each client's view then says the body died, not that it left (shared/net/view.ts).
    if (e !== undefined) ents.died[e] = ents.gen[e]!;
    if (rec.kind !== this.survivor) {
      if (e !== undefined) {
        rec.x = ents.x[e]!;
        rec.y = ents.y[e]!;
        rec.z = ents.z[e]!;
      }
      // Its body took what it carried, if Corpses gave it one (fell). Else a cache does.
      this.leave(rec);
      // Anything that could not be left is burned through the ledger.
      if (rec.inv) items.burnAll(rec);
      if (e !== undefined) {
        persistence?.detach(rec.pid);
        this.ctx.creatures.remove(e);
      }
      this.corpses?.raise(rec.pid);
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

    // The cache takes the survivor's inventory object. Nothing is copied. The suit it was issued goes with its life, so the
    // cache holds none of it, and a new one is issued as it rises (server/suit.ts).
    let cachePid = 0;
    const inv = items.inv(rec);
    items.burnIssued(rec);
    // A module may have the dead keep what they carried, by refusing the cache or saying so.
    const asked = { pid: rec.pid, keep: false };
    const kept = this.ctx.bus.before(DEATH_CACHE, asked) !== "" || asked.keep === true;
    if (inv.used() > 0 && !kept) {
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
      c.why = CHOOSE_DIED;
      c.sentPlaces = -1;
      this.ctx.game.sendText(c, TEXT_NOTICE, `You ${CAUSE_NAMES[cause] ?? "died"}.`);
    }
  }

  /**
   * A dead creature's body keeps what it carried and its saddle, for anyone to take, as in the reference (server/corpses.ts).
   * One that has no body leaves a cache of them where it fell instead, which lies as long as a survivor's.
   */
  private leave(rec: EntityRecord): void {
    const { world, records, items } = this.ctx;
    const inv = rec.inv ? items.inv(rec) : null;
    if ((!inv || inv.used() === 0) && rec.saddle === 0) return;
    const kind = world.reg.ids[rec.kind]!;
    const cache = records.create(this.cache, `${rec.name !== "" ? rec.name : kind.slice(kind.indexOf(":") + 1)}'s cache`);
    // A slot for each of the creature's and one for its saddle. Items.move sets each stack's spoil clock for where it now lies:
    // food keeps longer inside a creature than in a cache.
    cache.inv = new Inventory((inv ? inv.cap : 0) + 1);
    for (let s = 0; inv && s < inv.cap; s++) if (inv.item[s] !== 0) items.move(rec, s, cache, s, 0);
    // A saddle was taken out of the ledger when it was put on, and comes back as it does when it is taken off.
    if (rec.saddle !== 0 && items.mint(cache, rec.saddle, 1) === 1) rec.saddle = 0;
    cache.x = rec.x;
    cache.y = rec.y;
    cache.z = rec.z;
    cache.expiresAt = world.tick + this.lifetime(this.cache);
    records.dirty.add(cache.pid);
    this.place(cache);
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
  spill(x: number, y: number, z: number, name: string, owner = 0): EntityRecord {
    const { world, records } = this.ctx;
    if (owner !== 0) {
      // A cache this survivor's last refund went into takes the next one too, while it has a slot free.
      const last = this.lying(owner, this.cache, x, y, z, 3);
      if (last && this.ctx.items.inv(last).free() >= 0) {
        this.renew(last);
        return last;
      }
    }
    const cache = records.create(this.cache, name);
    const ground = world.hf.heightAt(x, z);
    cache.x = x;
    cache.y = ground > y ? ground : y;
    cache.z = z;
    cache.expiresAt = world.tick + this.lifetime(this.cache);
    records.dirty.add(cache.pid);
    this.place(cache);
    if (owner !== 0) this.lie(owner, cache);
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
    this.corpses?.retime(cacheWas, cacheIs);
  }

  /** Called when the record is made and again when a save is loaded. A creature's body is Corpses' to place. */
  place(cache: EntityRecord): void {
    const { world, records, deadlines } = this.ctx;
    if (cache.kind === this.corpse && this.corpses) {
      this.corpses.restore(cache);
      return;
    }
    const ents = world.ents;
    // Its time runs whether or not it gets a body, or a record made with the store full would never go.
    if (cache.expiresAt > 0) deadlines.push(cache.expiresAt, DEADLINE_DESPAWN, cache.pid, cache.expiresAt);
    let e = ents.create(cache.kind, cache.x, cache.y, cache.z, F_PROP);
    // The store is full. What the dead leave matters more than a bag someone dropped.
    if (e < 0 && this.evict()) e = ents.create(cache.kind, cache.x, cache.y, cache.z, F_PROP);
    if (e < 0) return;
    ents.pid[e] = cache.pid;
    ents.setLook(e, 0, null, cache.name);
    records.entOf.set(cache.pid, e);
    if (cache.kind === this.bag && this.bag !== this.cache) this.show(cache);
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
    this.shown.delete(cache.pid);
  }

  /**
   * What the session has open, or null. Whether it still may is asked here, at every use, because its tribe, the lock or the
   * PIN may have changed since it opened it. One it may not is shut.
   */
  openOf(c: Client): EntityRecord | null {
    const box = c.open === 0 ? undefined : this.ctx.records.byPid.get(c.open);
    if (!box) return null;
    if (!this.allowed(c, box)) {
      this.close(c);
      return null;
    }
    return box;
  }

  /** A built container asks keepsBuilt. A creature that is awake asks canOpen. Anything else lying open is anyone's. */
  private allowed(c: Client, box: EntityRecord): boolean {
    if (box.at >= 0) return this.keepsBuilt?.(c, box.at) ?? true;
    const e = this.ctx.records.entOf.get(box.pid);
    if (e !== undefined && this.isBoat(e)) return this.keepsBoatCargo?.(c, e) ?? false;
    if (e === undefined || (this.ctx.world.ents.flags[e]! & F_PROP) !== 0 || box.out) return true;
    return this.canOpen?.(c, box) ?? false;
  }

  private isBoat(e: number): boolean {
    const { world } = this.ctx;
    return world.reg.vehicle[world.ents.kind[e]!]?.movement === "boat";
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
          // A built container has no entity. It stays open, empty or not, while it stands, its user is near and may use it.
          const dx = box.x - ents.x[c.ent]!;
          const dy = box.y - ents.y[c.ent]!;
          const dz = box.z - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 2.5) * (REACH + 2.5) || !this.allowed(c, box)) this.close(c);
        } else if (!box || e === undefined || c.ent < 0) this.close(c);
        else if ((ents.flags[e]! & F_PROP) !== 0 && box.kind !== this.corpse && items.inv(box).used() === 0) this.remove(box);
        // A creature that woke up closes unless canOpen allows it.
        else if (!this.allowed(c, box)) this.close(c);
        else if (!this.isBoat(e)) {
          const dx = ents.x[e]! - ents.x[c.ent]!;
          const dy = ents.y[e]! - ents.y[c.ent]!;
          const dz = ents.z[e]! - ents.z[c.ent]!;
          if (dx * dx + dy * dy + dz * dz > (REACH + 1.5) * (REACH + 1.5)) this.close(c);
        }
      }
      if (c.ent >= 0 && (c.pressed & BTN_USE) !== 0 && !records.byPid.get(c.pid)?.out) this.use(c);
    }
    // A bag taken from, put into or emptied shows what it now holds.
    for (const [pid, was] of this.shown) {
      const bag = records.byPid.get(pid);
      if (!bag || !records.entOf.has(pid)) this.shown.delete(pid);
      else if (bag.inv !== was.inv || (bag.inv ? bag.inv.version : -1) !== was.version) this.show(bag);
    }
  }

  /** Index of the entity the body looks at within `reach`, or -1. World geometry nearer than the entity hides it. */
  target(c: Client, reach: number): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    this.eyeAt[0] = ents.x[e]!; this.eyeAt[1] = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!); this.eyeAt[2] = ents.z[e]!;
    this.eye?.(e, this.eyeAt);
    const ox = this.eyeAt[0]!, oy = this.eyeAt[1]!, oz = this.eyeAt[2]!;
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
          // A creature's body is met where it lies, as a blow meets it.
          const body = this.corpses?.at(i);
          const car = reg.vehicle[ents.kind[i]!], v = ents.vrow[i]!;
          // A vehicle is looked at by its hull, nose to tail and up to its roof; a boat's open cockpit too.
          const t = car && !body ? useVehicle(car, ents.x[i]!, ents.y[i]!, ents.z[i]!, ents.vehicleYaw[v]!, ox, oy, oz, d[0]!, d[1]!, d[2]!, {
            pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!, steering: ents.steering[v]!,
            qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!,
          }) : body ? this.corpses!.hit(i, ox, oy, oz, d[0]!, d[1]!, d[2]!, best) : rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, ents.x[i]! - r, ents.y[i]!, ents.z[i]! - r, ents.x[i]! + r, ents.y[i]! + reg.bodyHeight[ents.kind[i]!]! * size, ents.z[i]! + r);
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
      if (this.ctx.game.mayOpen(c, pid)) c.open = pid;
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
