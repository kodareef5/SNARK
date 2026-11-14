// Judges every build request. The client names a piece and a socket, and the server works out the pose from its own rows (shared/world/snap.ts).
// A door opens by becoming another kind in the same place. Locks, PINs and box contents are a record beside the row (server/fixtures.ts).

import { STRUCT_UNITS } from "../shared/coords.ts";
import type { StructureDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { TEXT_NOTICE, RESULT_DAMAGED, RESULT_DENIED, RESULT_ENEMY_NEAR, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_LOCKED, RESULT_NOT_EMPTY, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_PIN, RESULT_SHORT, RESULT_TOO_HIGH, RESULT_WAIT, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { capsuleKind } from "../shared/world/collide.ts";
import { BUILD_REACH, ON_TOP, ROLE_CEILING, ROLE_FOUNDATION, ROLE_PILLAR, freePose, obstructed, overPiece, poseAt, restPose, tooHigh, units, type Pose } from "../shared/world/snap.ts";
import { Collapse } from "../shared/world/collapse.ts";
import { Found, GONE_FELL, GONE_TAKEN } from "../shared/world/structures.ts";
import { Support } from "../shared/world/support.ts";
import { ACT_REACH, NO_PIN, PIN_TRIES, PIN_WAIT_TICKS, STRUCT_DEMOLISH, STRUCT_LIGHT, STRUCT_LOCK, STRUCT_PICKUP, STRUCT_PIN, STRUCT_REPAIR, STRUCT_UNLOCK, STRUCT_USE, cost, refundOf, repairCostOf } from "../shared/world/upkeep.ts";
import type { Fixtures } from "./fixtures.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Decay } from "./decay.ts";
import type { Rules } from "./settings/rules.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event, type Bus } from "./events/bus.ts";

/** A place command with this target means open ground. */
export const NO_TARGET = 0xffffffff;
/** Metres from the builder's eye to the piece's middle. The 3 allows for the piece's own size. */
const REACH = BUILD_REACH + 3;
/** Metres. A body this far into a piece's place is in its way. */
const BODY_SLACK = 0.1;
/** Metres. Nothing is built this near another tribe's foundation, or this near its pillar. */
export const ENEMY_FOUNDATION = 50;
export const ENEMY_PILLAR = 10;
/** Work a collapse may do in one tick, in the units shared/world/collapse.ts counts. About a millisecond. A larger collapse takes more ticks. */
const COLLAPSE_WORK = 16000;

export interface BuildContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly tribes: Tribes;
  readonly rules: Rules;
  readonly fixtures: Fixtures;
  /** Lights the fire at a ref, or puts it out. Returns a RESULT code. */
  light(ref: number): number;
  /** Returns a new empty cache at that place. */
  /** `owner` is the survivor a refund is for, so that its refunds share a cache and are counted as its own. */
  spill(x: number, y: number, z: number, name: string, owner?: number): EntityRecord;
  readonly bus: Bus;
}

const BUILD_PLACE = event("build.place");
const BUILD_PLACED = event("build.placed");
const STRUCTURE_ACT = event("structure.act");
const STRUCTURE_GONE = event("structure.gone");
/** What is done to a piece, as a module is told it, by STRUCT_ action. And why one is gone, by GONE_ cause. */
const ACT_WORDS: readonly string[] = ["pickup", "demolish", "repair", "lock", "unlock", "pin", "use", "light"];
const GONE_WORDS: readonly string[] = ["taken", "destroyed", "fell"];

/** A survivor who picked up or demolished a piece is owed what stood on it. `action` says which. `cache` takes what does not fit. */
interface Claim {
  pid: number;
  action: number;
  cache: EntityRecord | null;
}

export class Build {
  /** Counters. `fallen` counts pieces that fell when their support went. */
  placed = 0;
  refused = 0;
  fallen = 0;
  /** `returned` counts pieces that came down with a picked-up or demolished one and were given back. */
  pickedUp = 0;
  demolished = 0;
  repaired = 0;
  returned = 0;
  /** `used` counts uses of doors and boxes, `spilled` boxes emptied into a cache, `landed` pieces that fell whole and were set down again. */
  used = 0;
  spilled = 0;
  landed = 0;
  readonly decay: Decay;
  /** Ref of the last piece set down, or -1. */
  last = -1;
  /** Checks whether a piece about to be built would stand. */
  readonly support: Support;
  readonly collapse: Collapse;
  private readonly ctx: BuildContext;
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Ticks, by ref. Entries are dropped once they no longer matter. */
  private readonly hurtAt = new Map<number, number>();
  private readonly placedAt = new Map<number, number>();
  /** Claims on the running collapse, numbered from 1. `claim` is the number the removal in progress is under, or 0. */
  private readonly claims: Claim[] = [];
  private claim = 0;
  /** Pieces that fell whole and are not yet set down where they land. */
  private readonly landing: { rec: EntityRecord | null; kind: number; x: number; y: number; z: number; yaw: number; owner: number; hp: number }[] = [];
  /** Wrong PINs by client id: how many in a row, and the tick until which it must wait. */
  private readonly strikes = new Map<number, { n: number; until: number }>();
  private readonly near = new Found();
  private readonly look = [0, 0, 0];

  constructor(ctx: BuildContext) {
    this.ctx = ctx;
    const world = ctx.world;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.support = new Support(structs, world.reg, heightAt);
    this.collapse = new Collapse(structs, world.reg, heightAt);
    this.decay = new Decay(world, ctx.rules);
    this.decay.lone = (ref) => {
      this.support.forget();
      const node = this.support.node(ref);
      return node !== null && node.root && node.links.length === 0;
    };
    // Any removal may leave what the piece held unsupported. The collapse already knows about the pieces it fells itself.
    structs.onRemove = (ref, cause) => {
      this.hurtAt.delete(ref);
      this.placedAt.delete(ref);
      this.leaving(ref, cause);
      if (cause !== GONE_FELL) this.collapse.gone(ref, this.claim);
    };
    this.collapse.onClaim = (ref, claim) => {
      const of = this.claims[claim - 1];
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      // The claimant gets back only its own tribe's pieces. Anything else that comes down falls.
      if (!of || !ctx.tribes.may(ctx.records.byPid.get(of.pid), t.owner[ref & 0xffff]!)) return false;
      this.giveBack(of, t.kind[ref & 0xffff]!, t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!, this.whole(ref));
      this.returned++;
      return true;
    };
  }

  /** The survivor taking a piece up or down, while it does. 0 for a piece that goes any other way. */
  private taker = 0;

  /** A structure is about to go. One that falls whole is queued to land. Otherwise its fixture record goes too, and its contents go to a cache. */
  private leaving(ref: number, cause: number): void {
    const { world, fixtures } = this.ctx;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    const kind = t.kind[slot]!;
    this.ctx.bus.after(STRUCTURE_GONE, { ref, kind: world.reg.ids[kind]!, team: t.owner[slot]!, cause: GONE_WORDS[cause] ?? "", byPid: this.taker });
    const rec = fixtures.release(ref);
    if (cause === GONE_FELL && world.reg.fallsWhole[kind] === 1) {
      this.landing.push({ rec, kind, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, yaw: t.yaw[slot]!, owner: t.owner[slot]!, hp: t.hp[slot]! });
      return;
    }
    if (rec) this.empty(rec, t.x[slot]!, t.y[slot]!, t.z[slot]!);
  }

  /** Deletes the record of a removed fixture. Sessions that had it open no longer do, and its contents go to a cache. */
  private empty(rec: EntityRecord, x: number, y: number, z: number): void {
    const { game, records, spill } = this.ctx;
    for (const c of game.clients) if (c?.open === rec.pid) c.open = 0;
    if (rec.inv && rec.inv.used() > 0) {
      // The cache takes the same inventory object, so nothing is copied or lost.
      const cache = spill(x, y, z, rec.name);
      cache.inv = rec.inv;
      rec.inv = null;
      records.dirty.add(cache.pid);
      this.spilled++;
    }
    records.delete(rec.pid);
  }

  /** Whether nothing stands between the eye of body `e` and piece `ref`, along the line to the piece's middle or along where the body looks. */
  private inSight(e: number, ref: number, x: number, y: number, z: number): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const ex = ents.x[e]!;
    const ey = ents.y[e]! + stanceEye(world.reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const ez = ents.z[e]!;
    const far = Math.hypot(x - ex, y - ey, z - ez);
    if (far < 1e-6) return true;
    const hit = castWorld(world, ex, ey, ez, (x - ex) / far, (y - ey) / far, (z - ez) / far, far);
    if (hit === HIT_NONE || (hit === HIT_STRUCTURE && rayHit.ref === ref)) return true;
    const d = this.look;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    return castWorld(world, ex, ey, ez, d[0]!, d[1]!, d[2]!, far + 2) === HIT_STRUCTURE && rayHit.ref === ref;
  }

  /** Where a thing falling at (x, z) from height `below` lands: the top of the highest floor under it, or the ground. */
  private floorUnder(x: number, z: number, below: number): number {
    const { world } = this.ctx;
    const reg = world.reg;
    const structs = world.structs;
    let top = Math.ceil(world.hf.heightAt(x, z) * STRUCT_UNITS) / STRUCT_UNITS;
    const n = structs.query(x - 2.2, z - 2.2, x + 2.2, z + 2.2, this.near);
    const near = this.near.refs;
    for (let i = 0; i < n; i++) {
      const t = structs.chunks[Math.floor(near[i]! / 65536)]!;
      const s = near[i]! & 0xffff;
      const role = reg.role[t.kind[s]!]!;
      if (role !== ROLE_FOUNDATION && role !== ROLE_CEILING) continue;
      const at = t.y[s]! + reg.halfY[t.kind[s]!]!;
      if (at > top && at <= below + 1e-6 && overPiece(units(t.x[s]!), units(t.z[s]!), t.yaw[s]!, units(x), units(z))) top = at;
    }
    return top;
  }

  /** Sets down what fell whole where it lands. Its fixture record, if any, is bound to the new ref. */
  private land(): void {
    const { world, fixtures } = this.ctx;
    for (const l of this.landing) {
      const half = world.reg.halfY[l.kind]!;
      const ref = world.structs.add(l.kind, l.x, this.floorUnder(l.x, l.z, l.y - half) + half, l.z, l.yaw, l.owner, l.hp);
      if (ref >= 0) {
        if (l.rec) fixtures.bind(l.rec, ref);
        this.landed++;
      } else if (l.rec) this.empty(l.rec, l.x, l.y, l.z);
    }
    this.landing.length = 0;
    this.collapse.built();
  }

  /**
   * `pin` is NO_PIN for the use button. A door opens or shuts. A box opens, or shuts if this session had it open.
   * Returns a RESULT code, or -1 if the thing cannot be used.
   */
  use(c: Client, ref: number, pin = NO_PIN): number {
    const { world, records, tribes, fixtures } = this.ctx;
    const reg = world.reg;
    const structs = world.structs;
    const t = structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return -1;
    const kind = t.kind[slot]!;
    const opens = reg.opens[kind]!;
    if (opens === 0 && reg.structSlots[kind] === 0) return -1;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    const state = fixtures.find(ref);
    // The owning tribe may always use it. Others may only if it is unlocked or they give its PIN.
    if (!tribes.may(rec, t.owner[slot]!) && fixtures.locked(ref)) {
      const need = state && !this.ctx.rules.on("PreventOutOfTribePinCodeUse") ? state.pin : -1;
      if (need < 0) return RESULT_LOCKED;
      const tick = world.tick;
      let strike = this.strikes.get(c.id);
      if (strike && strike.until > tick) return RESULT_WAIT;
      if (pin === NO_PIN) return RESULT_PIN;
      if (pin !== need) {
        if (!strike) this.strikes.set(c.id, (strike = { n: 0, until: 0 }));
        if (++strike.n >= PIN_TRIES) {
          strike.n = 0;
          strike.until = tick + PIN_WAIT_TICKS;
        }
        return RESULT_DENIED;
      }
      this.strikes.delete(c.id);
    }
    if (opens !== 0) {
      // A door swaps to its other kind, unless a body is in the way.
      if (this.bodyIn(opens, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!)) return RESULT_OBSTRUCTED;
      structs.swap(ref, opens);
      if (state) {
        state.kind = opens;
        records.dirty.add(state.pid);
      }
      if (this.collapse.busy) this.collapse.built();
    } else {
      const box = fixtures.ensure(ref);
      if (c.open !== box.pid && !this.ctx.game.mayOpen(c, box.pid)) return RESULT_DENIED;
      c.open = c.open === box.pid ? 0 : box.pid;
    }
    this.used++;
    return RESULT_OK;
  }

  /** Records harm at tick `at`, which starts the repair cooldown. */
  hurt(ref: number, at = this.ctx.world.tick): void {
    this.hurtAt.set(ref, at);
    if (this.hurtAt.size > 8192) this.forget(this.hurtAt, this.repairWait());
  }

  /** In ticks. */
  private repairWait(): number {
    return Math.round(this.ctx.rules.num("StructureDamageRepairCooldown") * TICK_RATE);
  }

  private forget(times: Map<number, number>, after: number): void {
    const tick = this.ctx.world.tick;
    for (const [ref, at] of times) if (tick - at >= after) times.delete(ref);
  }

  /** Pieces whose support is still to be checked. */
  get pending(): number {
    return this.collapse.pending;
  }

  /** Call once a tick. */
  step(): void {
    const { world, game, records } = this.ctx;
    if (this.collapse.busy) {
      const before = this.collapse.fallen;
      this.collapse.step(COLLAPSE_WORK, world.tick);
      this.fallen += this.collapse.fallen - before;
      if (this.landing.length > 0) this.land();
    } else if (this.claims.length > 0) this.claims.length = 0;
    this.decay.step(world.tick, (visit) => {
      for (const c of game.clients) {
        // The lingering body of a session that has gone visits nothing.
        if (!c?.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE) continue;
        const rec = records.byPid.get(c.pid);
        if (rec) visit(rec.team, c.chunk);
      }
    });
  }

  /** Runs a STRUCT_ action on a built piece. Returns a RESULT code. */
  act(c: Client, r: BitReader): number {
    const ref = r.u32();
    const action = r.u8();
    const code = action === STRUCT_PIN || action === STRUCT_USE ? r.u16() : NO_PIN;
    if (r.overflow) return RESULT_INVALID;
    const { world, records, items, tribes, rules, fixtures } = this.ctx;
    const reg = world.reg;
    const structs = world.structs;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    const t = structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return RESULT_INVALID;
    const kind = t.kind[slot]!;
    const x = t.x[slot]!;
    const y = t.y[slot]!;
    const z = t.z[slot]!;
    // Reach is from the server's eye position for this survivor to the piece's middle, less the piece's size.
    const e = c.ent;
    const ents = world.ents;
    const far = Math.hypot(ents.x[e]! - x, ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!) - y, ents.z[e]! - z);
    if (far > ACT_REACH + Math.hypot(reg.halfX[kind]!, reg.halfY[kind]!, reg.halfZ[kind]!)) return RESULT_FAR;
    const refused = this.ctx.bus.before(STRUCTURE_ACT, { byPid: rec.pid, ref, action: ACT_WORDS[action] ?? "" });
    if (refused !== "") {
      this.ctx.game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    const mine = tribes.may(rec, t.owner[slot]!);
    const item = reg.pieceItem[kind]!;
    const tick = world.tick;
    if (action === STRUCT_USE) {
      // Every client is sent the ref and place of every piece near it, so reach alone would open a box through a wall.
      if (!this.inSight(e, ref, x, y, z)) return RESULT_FAR;
      const done = this.use(c, ref, code);
      return done < 0 ? RESULT_INVALID : done;
    }
    if (action === STRUCT_LIGHT) {
      if (reg.lights[kind] === 0) return RESULT_INVALID;
      return mine ? this.ctx.light(ref) : RESULT_NOT_YOURS;
    }
    if (action === STRUCT_LOCK || action === STRUCT_UNLOCK || action === STRUCT_PIN) {
      if (reg.opens[kind] === 0 && reg.structSlots[kind] === 0) return RESULT_INVALID;
      if (!mine) return RESULT_NOT_YOURS;
      if (action === STRUCT_PIN && code !== NO_PIN && code > 9999) return RESULT_INVALID;
      const state = fixtures.ensure(ref);
      // Setting a PIN locks the thing. Removing the PIN leaves the lock unchanged.
      const was = fixtures.locked(ref);
      if (action === STRUCT_UNLOCK) state.lock = 2;
      else if (action === STRUCT_PIN && code === NO_PIN) state.lock = was ? 1 : 2;
      else state.lock = 1;
      if (action === STRUCT_PIN) state.pin = code === NO_PIN ? -1 : code;
      records.dirty.add(state.pid);
      return RESULT_OK;
    }
    if (action === STRUCT_PICKUP) {
      if (!mine) return RESULT_NOT_YOURS;
      if (item === 0) return RESULT_INVALID;
      if (t.hp[slot]! < reg.maxHp[kind]!) return RESULT_DAMAGED;
      if ((fixtures.find(ref)?.inv?.used() ?? 0) > 0) return RESULT_NOT_EMPTY;
      const window = rules.on("AlwaysAllowStructurePickup") ? 0 : rules.num("StructurePickupTimeAfterPlacement") * TICK_RATE;
      if (window > 0 && !(tick - (this.placedAt.get(ref) ?? -Infinity) <= window)) return RESULT_WAIT;
      if (items.mint(rec, item, 1) === 0) return RESULT_FULL;
      this.take(ref, rec, STRUCT_PICKUP);
      this.pickedUp++;
      return RESULT_OK;
    }
    if (action === STRUCT_DEMOLISH) {
      // Anyone may demolish a piece that has decayed.
      if (!mine && !this.decay.expired(ref, tick)) return RESULT_NOT_YOURS;
      const of = this.take(ref, rec, STRUCT_DEMOLISH);
      this.giveBack(of, kind, x, y, z);
      this.demolished++;
      return RESULT_OK;
    }
    if (action === STRUCT_REPAIR) {
      if (!mine) return RESULT_NOT_YOURS;
      if (!repairCostOf(reg, kind, t.hp[slot]!)) return RESULT_INVALID;
      if (tick - (this.hurtAt.get(ref) ?? -Infinity) < this.repairWait()) return RESULT_WAIT;
      const inv = items.inv(rec);
      for (let k = 0; k < cost.n; k++) if (inv.total(cost.item[k]!) < cost.count[k]!) return RESULT_SHORT;
      for (let k = 0; k < cost.n; k++) if (!items.burnItem(rec, cost.item[k]!, cost.count[k]!)) throw new Error("the ingredients were counted");
      structs.mend(ref, reg.maxHp[kind]!);
      this.hurtAt.delete(ref);
      this.repaired++;
      return RESULT_OK;
    }
    return RESULT_INVALID;
  }

  /** Removes a piece for `rec`, who is then owed what comes down because of it. Returns the claim. */
  private take(ref: number, rec: EntityRecord, action: number): Claim {
    let n = this.claims.findIndex((q) => q.pid === rec.pid && q.action === action);
    if (n < 0 && this.claims.length < 65535) n = this.claims.push({ pid: rec.pid, action, cache: null }) - 1;
    this.claim = n + 1;
    this.taker = rec.pid;
    this.ctx.world.structs.remove(ref, GONE_TAKEN, this.ctx.world.tick);
    this.taker = 0;
    this.claim = 0;
    return this.claims[n] ?? { pid: rec.pid, action, cache: null };
  }

  /** Whether a piece could be picked up as it stands: undamaged, empty, and inside its window. One that could not comes back as materials. */
  private whole(ref: number): boolean {
    const { world, rules, fixtures } = this.ctx;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    if (t.hp[slot]! < world.reg.maxHp[t.kind[slot]!]! || (fixtures.find(ref)?.inv?.used() ?? 0) > 0) return false;
    const window = rules.on("AlwaysAllowStructurePickup") ? 0 : rules.num("StructurePickupTimeAfterPlacement") * TICK_RATE;
    return !(window > 0 && !(world.tick - (this.placedAt.get(ref) ?? -Infinity) <= window));
  }

  /**
   * Gives the claimant what a piece comes back as: the piece itself after a pickup it could have had by itself, or half its
   * materials. What the claimant cannot take lies in a cache where the piece stood.
   */
  private giveBack(of: Claim, kind: number, x: number, y: number, z: number, whole = true): void {
    const reg = this.ctx.world.reg;
    const item = reg.pieceItem[kind]!;
    if (item === 0) return;
    if (of.action === STRUCT_PICKUP && whole) this.hand(of, item, 1, x, y, z);
    else if (refundOf(reg, kind)) {
      // `hand` may compute another cost before this one is used up, so the loop works on a copy.
      const n = cost.n;
      const items = Array.from(cost.item.subarray(0, n));
      const counts = Array.from(cost.count.subarray(0, n));
      for (let k = 0; k < n; k++) this.hand(of, items[k]!, counts[k]!, x, y, z);
    }
  }

  private hand(of: Claim, item: number, n: number, x: number, y: number, z: number): void {
    const { records, items, spill } = this.ctx;
    const rec = records.byPid.get(of.pid);
    let left = n;
    if (rec && !rec.dead && !rec.out && records.entOf.has(rec.pid)) left -= items.mint(rec, item, left);
    // The rest goes into the claim's cache, and into a new one when that is full.
    for (let tries = 0; left > 0 && tries < 4; tries++) {
      if (!of.cache || records.byPid.get(of.cache.pid) !== of.cache) of.cache = spill(x, y, z, "building materials", of.pid);
      left -= items.mint(of.cache, item, left);
      if (left > 0) of.cache = null;
    }
  }

  private enemyNear(team: number, x: number, z: number): boolean {
    const world = this.ctx.world;
    const structs = world.structs;
    const role = world.reg.role;
    const dims = world.dims;
    const cx0 = Math.max(0, Math.floor((x - ENEMY_FOUNDATION) / 64));
    const cx1 = Math.min(dims.chunksX - 1, Math.floor((x + ENEMY_FOUNDATION) / 64));
    const cz0 = Math.max(0, Math.floor((z - ENEMY_FOUNDATION) / 64));
    const cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + ENEMY_FOUNDATION) / 64));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const t = structs.chunks[cz * dims.chunksX + cx];
        if (!t) continue;
        for (let s = 0; s < t.high; s++) {
          const owner = t.owner[s]!;
          if (owner === 0 || owner === team) continue;
          const r = role[t.kind[s]!]!;
          if (r !== ROLE_FOUNDATION && r !== ROLE_PILLAR) continue;
          const reach = r === ROLE_FOUNDATION ? ENEMY_FOUNDATION : ENEMY_PILLAR;
          const dx = t.x[s]! - x;
          const dz = t.z[s]! - z;
          if (dx * dx + dz * dz < reach * reach) return true;
        }
      }
    }
    return false;
  }

  /** Returns a RESULT code. */
  place(c: Client, r: BitReader): number {
    const variant = r.u8();
    const target = r.u32();
    let socket = 0;
    let x = 0;
    let z = 0;
    let yaw = 0;
    let lift = 0;
    if (target === NO_TARGET) {
      x = r.sbits(32);
      z = r.sbits(32);
      yaw = r.u16();
      lift = r.sbits(8);
    } else {
      socket = r.u8();
      if (socket === ON_TOP) {
        x = r.sbits(32);
        z = r.sbits(32);
        yaw = r.u16();
      }
    }
    const turn = r.u8();
    if (r.overflow) return RESULT_INVALID;
    const code = this.set(c, variant, target, socket, turn, x, z, yaw, lift);
    if (code === RESULT_OK) this.placed++;
    else this.refused++;
    return code;
  }

  /** Checks a decoded place request. If it passes, builds the piece and takes one from the builder's hand. Returns a RESULT code. */
  set(c: Client, variant: number, target: number, socket: number, turn: number, x: number, z: number, yaw: number, lift: number): number {
    const { world, records, items, tribes } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    const inv = items.inv(rec);
    const slot = rec.held >= 0 ? inv.hotbar + rec.held : -1;
    const forms = slot >= 0 && inv.count[slot]! > 0 ? reg.places[inv.item[slot]!] : null;
    if (!forms || variant >= forms.length) return RESULT_INVALID;
    const kind = forms[variant]!;
    const structs = world.structs;
    const pose = this.pose;
    if (target === NO_TARGET) {
      // Open ground takes only a piece that stands on the ground by itself, and only inside the map.
      const px = x / STRUCT_UNITS;
      const pz = z / STRUCT_UNITS;
      if (!(px > 2 && pz > 2 && px < world.hf.sizeX - 2 && pz < world.hf.sizeZ - 2)) return RESULT_INVALID;
      if (!freePose((gx, gz) => world.hf.heightAt(gx, gz), reg, kind, px, pz, yaw, lift, pose)) return RESULT_NO_SNAP;
    } else {
      const t = structs.chunks[Math.floor(target / 65536)];
      const ts = target & 0xffff;
      if (!t || ts >= t.high || t.kind[ts] === 0) return RESULT_NO_SNAP;
      // A piece joins or rests on only what the builder's tribe built.
      if (!tribes.may(rec, t.owner[ts]!)) return RESULT_NOT_YOURS;
      if (socket === ON_TOP ? !restPose(structs, reg, target, kind, x / STRUCT_UNITS, z / STRUCT_UNITS, yaw, pose) : !poseAt(structs, reg, target, kind, socket, turn, pose)) return RESULT_NO_SNAP;
    }
    const px = pose.x / STRUCT_UNITS;
    const py = pose.y / STRUCT_UNITS;
    const pz = pose.z / STRUCT_UNITS;
    // Reach is measured from the server's eye position, not the client's.
    const e = c.ent;
    const ex = ents.x[e]! - px;
    const ey = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!) - py;
    const ez = ents.z[e]! - pz;
    if (ex * ex + ey * ey + ez * ez > REACH * REACH) return RESULT_FAR;
    if (tooHigh((gx, gz) => world.hf.heightAt(gx, gz), reg, kind, pose)) return RESULT_TOO_HIGH;
    if (obstructed(structs, reg.parts, kind, px, py, pz, pose.yaw) || this.bodyIn(kind, px, py, pz, pose.yaw)) return RESULT_OBSTRUCTED;
    if (this.enemyNear(rec.team, px, pz)) return RESULT_ENEMY_NEAR;
    if (!this.support.stands(kind, pose.x, pose.y, pose.z, pose.yaw)) return RESULT_NO_SUPPORT;
    const refused = this.ctx.bus.before(BUILD_PLACE, { byPid: rec.pid, team: rec.team, kind: reg.ids[kind]!, x: px, y: py, z: pz, yaw: pose.yaw, target });
    if (refused !== "") {
      this.ctx.game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    const def = reg.defs[kind] as StructureDef;
    const ref = structs.add(kind, px, py, pz, pose.yaw, rec.team, def.hp);
    if (ref < 0) return RESULT_FULL;
    items.burn(rec, slot, 1);
    this.last = ref;
    // A bed gets its fixture record at once, so it is found among the fixtures.
    if (reg.isBed[kind] === 1) this.ctx.fixtures.ensure(ref);
    // Placing counts as a visit for decay. placedAt matters only when pickup is time-limited.
    this.decay.visit(rec.team, Math.floor(ref / 65536), world.tick);
    if (!this.ctx.rules.on("AlwaysAllowStructurePickup")) {
      this.placedAt.set(ref, world.tick);
      if (this.placedAt.size > 8192) this.forget(this.placedAt, 100 * TICK_RATE);
    }
    this.collapse.built();
    this.onPlaced?.(rec, ref);
    this.ctx.bus.after(BUILD_PLACED, { byPid: rec.pid, ref, kind: reg.ids[kind]! });
    return RESULT_OK;
  }

  onPlaced: ((by: EntityRecord, ref: number) => void) | null = null;

  /** Whether anything alive stands where a piece of `kind` at this pose would be. */
  private bodyIn(kind: number, x: number, y: number, z: number, yaw: number): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    const cx = Math.floor(x / 64);
    const cz = Math.floor(z / 64);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (cx + ox < 0 || cz + oz < 0 || cx + ox >= dims.chunksX || cz + oz >= dims.chunksZ) continue;
        for (let i = ents.chunkHead[(cz + oz) * dims.chunksX + cx + ox]!; i >= 0; i = ents.next[i]!) {
          if ((ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
          const k = ents.kind[i]!;
          if (capsuleKind(reg.parts, kind, x, y, z, yaw, ents.x[i]!, ents.y[i]!, ents.z[i]!, reg.bodyRadius[k]!, reg.bodyHeight[k]!, BODY_SLACK)) return true;
        }
      }
    }
    return false;
  }
}
