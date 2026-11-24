// Judges every build request. The client names a frame and a slot's key, and the server works out the pose and every check from its own rows (shared/world/lattice/place.ts).
// A door opens by becoming another kind in the same place. Locks, PINs and box contents are a record beside the row (server/fixtures.ts).

import { STRUCT_UNITS } from "../shared/coords.ts";
import type { StructureDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { MAX_NAME_BYTES, TEXT_NOTICE, PLACED_COUNTS, PLACED_METRES, PLACED_NONE, S_PLACED, RESULT_DAMAGED, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_LOCKED, RESULT_NOT_EMPTY, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK, RESULT_PIN, RESULT_RATE, RESULT_SHORT, RESULT_WAIT, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { stanceEye, stanceHeight } from "../shared/sim/character.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { SKIN, capsuleFree, capsuleKind, groundUnder } from "../shared/world/collide.ts";
import { carMeetsKind } from "../shared/world/vehicle.ts";
import { isBoatVehicle, isRotorVehicle } from "../shared/sim/vehicle.ts";
import { helicopterMeetsKind } from "../shared/world/helicopter.ts";
import { boatMeetsKind } from "../shared/world/boat.ts";
import { PLACE_JOIN, PLACE_NEW, PLACE_REST, makePlaceRequest, readPlace, type PlaceRequest } from "../shared/net/place.ts";
import { PLACED_MOST, makePlaced, writePlaced } from "../shared/net/placed.ts";
import { makeVerdict, runKey, startBase, validate, validateFree, type Site, type Verdict } from "../shared/world/lattice/place.ts";
import { ROLE_FOUNDATION, ROLE_PILLAR, enemyGap, enemyGapFound, floorTop, freePose, restPose, units, type Pose } from "../shared/world/snap.ts";
import { Collapse } from "../shared/world/collapse.ts";
import { Found, GONE_FELL, GONE_TAKEN, toldHealth } from "../shared/world/structures.ts";
import { Support } from "../shared/world/support.ts";
import { ACT_REACH, NO_PIN, PIN_TRIES, PIN_WAIT_TICKS, STRUCT_DEMOLISH, STRUCT_LIGHT, STRUCT_LOCK, STRUCT_NAME, STRUCT_PICKUP, STRUCT_PIN, STRUCT_REPAIR, STRUCT_TRAVEL, STRUCT_UNLOCK, STRUCT_USE, cost, refundOf, repairCostOf } from "../shared/world/upkeep.ts";
import type { Fixtures } from "./fixtures.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Decay } from "./decay.ts";
import { Guesses } from "./guesses.ts";
import type { Rules } from "./settings/rules.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event, type Bus } from "./events/bus.ts";

/** In a `build.place` event, the target of a piece that rests on nothing built. */
export const NO_TARGET = 0xffffffff;
/** Pieces a session may set down in a second, and at once. */
export const PLACE_RATE = 64;
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
  /** Throws the moving static at a ref (server/motion.ts). Returns a RESULT code. */
  motion(ref: number): number;
  /** Lights the fire at a ref, or puts it out. Returns a RESULT code. */
  light(ref: number): number;
  /** Names the bed at a ref, or travels from it (STRUCT_NAME, STRUCT_TRAVEL; server/beds.ts). Returns a RESULT code. */
  bed(c: Client, ref: number, action: number, name: string): number;
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
const ACT_WORDS: readonly string[] = ["pickup", "demolish", "repair", "lock", "unlock", "pin", "use", "light", "name", "travel"];
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
  /** Why nothing may be built at a place for a reason of the game's own, or "": a supply drop's site on a PvE server (server/supply.ts). */
  keepClear: ((x: number, z: number) => string) | null = null;
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
  /** The tick this server began at. A harmed piece with no entry in `hurtAt` counts as harmed then, so a restart ends no cooldown. */
  private readonly bootAt: number;
  /** Claims on the running collapse, numbered from 1. `claim` is the number the removal in progress is under, or 0. */
  private readonly claims: Claim[] = [];
  private claim = 0;
  /** Pieces that fell whole and are not yet set down where they land. */
  private readonly landing: { rec: EntityRecord | null; kind: number; x: number; y: number; z: number; yaw: number; owner: number; hp: number }[] = [];
  /**
   * Wrong PINs, counted against the survivor who gave them. Counted against the session's slot, a count went to whoever had
   * the slot next, and it began again after every wait, so a PIN was three guesses every half minute for as long as it took.
   */
  private readonly guesses = new Guesses(PIN_TRIES, PIN_WAIT_TICKS);
  /** By survivor pid: the box it last opened with a PIN, and the PIN it gave. */
  private readonly entered = new Map<number, { box: number; pin: number }>();
  private readonly near = new Found();
  private readonly look = [0, 0, 0];
  private readonly inWay: number[] = [];
  /** What `set` last decided, as its session is told (S_PLACED): the piece placed, or what stood in the way. */
  private readonly answer = makePlaced();
  private readonly request = makePlaceRequest();
  private readonly verdict = makeVerdict();
  private readonly slot = { fr: 0, k0: 0, k1: 0 };
  /** What the shared checks ask of this server about a place. `team` is the builder's while a request is judged. */
  private readonly site: Site;
  private team = 0;
  /** Whether `set` last found no piece in the builder's hand. */
  private bare = false;
  /** Per session, the pieces it may still set down and the tick that was counted at. */
  private readonly budget = new WeakMap<Client, { left: number; tick: number }>();

  constructor(ctx: BuildContext) {
    this.ctx = ctx;
    const world = ctx.world;
    this.bootAt = world.tick;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.support = new Support(structs, world.reg, heightAt);
    this.collapse = new Collapse(structs, world.reg, heightAt);
    this.decay = new Decay(world, ctx.rules);
    this.site = {
      structs,
      tables: world.reg,
      heightAt,
      body: (kind, x, y, z, yaw) => this.bodyIn(kind, x, y, z, yaw),
      enemy: (x, z, out) => this.enemyNear(this.team, x, z) && (this.enemyGap(this.team, x, z, out), true),
      full: (x, z, out) => {
        const cap = ctx.rules.num("TheMaxStructuresInRange");
        const have = cap > 0 ? world.claims.near(x, z) : 0;
        if (!(cap > 0 && have >= cap)) return false;
        [out.detail, out.a, out.b] = [PLACED_COUNTS, have, cap];
        return true;
      },
      stands: (kind, x, y, z, yaw) => this.support.stands(kind, x, y, z, yaw),
    };
    this.decay.lone = (ref) => {
      this.support.forget();
      const node = this.support.node(ref);
      return node !== null && node.root && (node.role === ROLE_FOUNDATION || node.role === ROLE_PILLAR) && node.links.length === 0;
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
    // Finish lazy cooking and spoilage before the cache takes the contents and the station's clock is discarded.
    if (rec.inv) this.ctx.items.inv(rec);
    if (rec.inv && rec.inv.used() > 0) {
      // The cache takes the same inventory object, so nothing is copied or lost.
      const cache = spill(x, y, z, rec.name);
      cache.inv = rec.inv;
      rec.inv = null;
      // A lit preserving bin's clocks run at 10 times; in the cache they run as the cache keeps things (Items.rekeep).
      this.ctx.items.rekeep(cache, this.ctx.world.tick, rec.kind, cache.kind);
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

  /**
   * Where a thing falling at (x, z) from height `below` lands: the top of the highest floor under its middle, sloped or not, or
   * the ground. It stands there (Support), and so is not dropped again.
   */
  private floorUnder(x: number, z: number, below: number): number {
    const { world } = this.ctx;
    const structs = world.structs;
    let top = Math.ceil(world.hf.heightAt(x, z) * STRUCT_UNITS) / STRUCT_UNITS;
    const n = structs.query(x - 2.2, z - 2.2, x + 2.2, z + 2.2, this.near);
    const near = this.near.refs;
    for (let i = 0; i < n; i++) {
      const at = floorTop(structs, world.reg, near[i]!, units(x), units(z)) / STRUCT_UNITS;
      if (at > top && at <= below + 1e-6) top = at;
    }
    return top;
  }

  /**
   * Moves every living body out of the place a piece of `kind` is about to be set down in. A body goes aside by the shortest
   * way that is clear all along, so never through a wall, or else up onto the piece. One with no such place stays where it is.
   */
  private makeWay(kind: number, x: number, y: number, z: number, yaw: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    // Found first and moved after, because a move may take a body from one chunk's list to another's.
    const found = this.inWay;
    found.length = 0;
    const cx = Math.floor(x / 64);
    const cz = Math.floor(z / 64);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (cx + ox < 0 || cz + oz < 0 || cx + ox >= dims.chunksX || cz + oz >= dims.chunksZ) continue;
        for (let i = ents.chunkHead[(cz + oz) * dims.chunksX + cx + ox]!; i >= 0; i = ents.next[i]!) {
          // A rider goes where its mount goes, and a vehicle is not shoved aside: the piece was refused if it met one.
          if ((ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE || ents.seat[i] !== 0) continue;
          const k = ents.kind[i]!;
          if (reg.vehicle[k]) continue;
          if (capsuleKind(reg.parts, kind, x, y, z, yaw, ents.x[i]!, ents.y[i]!, ents.z[i]!, reg.bodyRadius[k]!, reg.bodyHeight[k]!, SKIN)) found.push(i);
        }
      }
    }
    const top = y + reg.halfY[kind]!;
    for (const i of found) {
      const k = ents.kind[i]!;
      const move = reg.move[k];
      const r = reg.bodyRadius[k]!;
      const h = move ? stanceHeight(move, ents.stance[i]!) : reg.bodyHeight[k]!;
      const bx = ents.x[i]!;
      const by = ents.y[i]!;
      const bz = ents.z[i]!;
      let ux = bx - x;
      let uz = bz - z;
      const off = Math.hypot(ux, uz);
      ux = off > 1e-3 ? ux / off : 1;
      uz = off > 1e-3 ? uz / off : 0;
      const step = r * 0.5;
      const most = Math.ceil((2 * (world.structs.spread[kind]! + r)) / step);
      let moved = false;
      // Away from the piece's middle first, then to either side, then back across it.
      for (let turn = 0; turn < 4 && !moved; turn++) {
        const dx = turn === 0 ? ux : turn === 1 ? -uz : turn === 2 ? uz : -ux;
        const dz = turn === 0 ? uz : turn === 1 ? ux : turn === 2 ? -ux : -uz;
        for (let n = 1; n <= most && !moved; n++) {
          const px = bx + dx * step * n;
          const pz = bz + dz * step * n;
          const py = Math.max(groundUnder(world.hf, px, pz, r), by);
          // The piece is not built yet, so this asks only about what stands there already.
          if (!capsuleFree(world, px, py, pz, r, h)) break;
          if (capsuleKind(reg.parts, kind, x, y, z, yaw, px, py, pz, r, h, SKIN)) continue;
          ents.setPosition(i, px, py, pz);
          moved = true;
        }
      }
      if (!moved && capsuleFree(world, bx, top, bz, r, h)) {
        ents.setPosition(i, bx, top, bz);
        moved = true;
      }
      if (moved) ents.vx[i] = ents.vy[i] = ents.vz[i] = 0;
    }
  }

  /** Sets down what fell whole where it lands. Its fixture record, if any, is bound to the new ref. */
  private land(): void {
    const { world, fixtures } = this.ctx;
    for (const l of this.landing) {
      const half = world.reg.halfY[l.kind]!;
      const y = this.floorUnder(l.x, l.z, l.y - half) + half;
      this.makeWay(l.kind, l.x, y, l.z, l.yaw);
      const ref = world.structs.add(l.kind, l.x, y, l.z, l.yaw, l.owner, l.hp);
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
    if (opens === 0 && reg.structSlots[kind] === 0 && !reg.motion[kind]) return -1;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    if (reg.motion[kind]) {
      const done = this.ctx.motion(ref);
      if (done === RESULT_OK) this.used++;
      return done;
    }
    const state = fixtures.find(ref);
    // The owning tribe may always use it. Others may only if it is unlocked or they give its PIN.
    const byPin = !tribes.may(rec, t.owner[slot]!) && fixtures.locked(ref);
    if (byPin) {
      const need = state && !this.ctx.rules.on("PreventOutOfTribePinCodeUse") ? state.pin : -1;
      if (need < 0) return RESULT_LOCKED;
      const who = String(rec.pid);
      if (this.guesses.wait(who, world.tick) > 0) return RESULT_WAIT;
      if (pin === NO_PIN) return RESULT_PIN;
      if (pin !== need) {
        this.guesses.wrong(who, world.tick);
        return RESULT_DENIED;
      }
      this.guesses.right(who);
    }
    if (opens !== 0) {
      // A door swaps to its other kind, unless a body is in the way.
      if (this.bodyIn(opens, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!) >= 0) return RESULT_OBSTRUCTED;
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
      if (byPin && c.open !== 0) this.entered.set(rec.pid, { box: box.pid, pin });
      else this.entered.delete(rec.pid);
    }
    this.used++;
    return RESULT_OK;
  }

  /**
   * Whether a session that has the box at `ref` open may go on using it: it is its tribe's, or unlocked, or it opened it with
   * the PIN the box still has. Asked at every use, so a member put out, a lock set and a PIN changed all shut it.
   */
  keeps(c: Client, ref: number): boolean {
    const { world, records, tribes, fixtures, rules } = this.ctx;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    if (tribes.may(records.byPid.get(c.pid), t.owner[slot]!) || !fixtures.locked(ref)) return true;
    const state = fixtures.find(ref);
    const gave = this.entered.get(c.pid);
    return !!state && !!gave && gave.box === state.pid && state.pin >= 0 && gave.pin === state.pin && !rules.on("PreventOutOfTribePinCodeUse");
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
    const { world } = this.ctx;
    if (this.collapse.busy) {
      const before = this.collapse.fallen;
      this.collapse.step(COLLAPSE_WORK, world.tick);
      this.fallen += this.collapse.fallen - before;
      if (this.landing.length > 0) this.land();
    } else if (this.claims.length > 0) this.claims.length = 0;
    this.decay.step(world.tick, this.visitors);
  }

  /** Tells decay which tribe stands in which chunk: every survivor in the world. Made once, not at each step. */
  private readonly visitors = (visit: (team: number, chunk: number) => void): void => {
    const { game, records } = this.ctx;
    for (const c of game.clients) {
      // The lingering body of a session that has gone visits nothing.
      if (!c?.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE) continue;
      const rec = records.byPid.get(c.pid);
      if (rec) visit(rec.team, c.chunk);
    }
  };

  /** Runs a STRUCT_ action on a built piece. Returns a RESULT code. */
  act(c: Client, r: BitReader): number {
    const ref = r.u32();
    const action = r.u8();
    const code = action === STRUCT_PIN || action === STRUCT_USE ? r.u16() : NO_PIN;
    const name = action === STRUCT_NAME ? r.string(MAX_NAME_BYTES) : "";
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
    if (action === STRUCT_NAME || action === STRUCT_TRAVEL) {
      if (reg.isBed[kind] !== 1) return RESULT_INVALID;
      if (!mine) return RESULT_NOT_YOURS;
      return this.inSight(e, ref, x, y, z) ? this.ctx.bed(c, ref, action, name) : RESULT_FAR;
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
      // Ascended's fix (36.8): a bed is not picked up while it waits, which would set it down again ready.
      if (reg.isBed[kind] === 1 && (fixtures.find(ref)?.readyAt ?? 0) > tick) return RESULT_WAIT;
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
      if (!repairCostOf(reg, kind, toldHealth(t.hp[slot]!, reg.maxHp[kind]!))) return RESULT_INVALID;
      if (tick - (this.hurtAt.get(ref) ?? this.bootAt) < this.repairWait()) return RESULT_WAIT;
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
    return this.ctx.world.claims.enemyNear(team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR);
  }

  /**
   * The nearest of another tribe's foundations or pillars that `enemyNear` refuses a piece at (x, z) for, into `out`:
   * whole metres to it and the metres its kind needs. A scan of its own, made only for a refusal, so `enemyNear` may be
   * answered any other way.
   */
  private enemyGap(team: number, x: number, z: number, out: Verdict): void {
    const world = this.ctx.world;
    if (!enemyGap(world.structs, world.reg.role, team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR)) return;
    [out.detail, out.a, out.b] = [PLACED_METRES, Math.floor(enemyGapFound.metres), enemyGapFound.needs];
  }

  /** Whether the session may set one more piece down now: PLACE_RATE a second, and as many saved up. */
  private spend(c: Client): boolean {
    const tick = this.ctx.world.tick;
    let b = this.budget.get(c);
    if (!b) this.budget.set(c, (b = { left: PLACE_RATE, tick }));
    b.left = Math.min(PLACE_RATE, b.left + ((tick - b.tick) * PLACE_RATE) / TICK_RATE);
    b.tick = tick;
    if (b.left < 1) return false;
    b.left--;
    return true;
  }

  /**
   * Returns a RESULT code. With the command's `seq`, its session is first told what was placed and what stopped it
   * (S_PLACED). A row's pieces are judged in order, each as though sent alone, and the row stops at the first refused.
   */
  place(c: Client, r: BitReader, seq = 0): number {
    const req = this.request;
    const answer = this.answer;
    const sound = readPlace(r, req);
    answer.refs.length = 0;
    answer.detail = PLACED_NONE;
    let code = sound ? RESULT_OK : RESULT_INVALID;
    for (let i = 0; sound && i < req.count && code === RESULT_OK; i++) {
      if (!this.spend(c)) code = RESULT_RATE;
      else if (i > 0 && !runKey(req.k0, req.k1, req.step, i, this.slot)) code = RESULT_NO_SNAP;
      else code = i === 0 ? this.set(c, req) : this.set(c, req, this.slot.k0, this.slot.k1);
      // The row used the last piece in hand.
      if (i > 0 && this.bare) code = RESULT_SHORT;
      if (code === RESULT_OK) {
        this.placed++;
        if (answer.refs.length < PLACED_MOST) answer.refs.push(this.last);
      } else this.refused++;
    }
    if (seq !== 0) {
      answer.seq = seq;
      answer.code = code;
      writePlaced(this.ctx.game.begin(S_PLACED), answer);
      this.ctx.game.endOwn(c);
    }
    return code;
  }

  /**
   * Checks a decoded place request, its key (k0, k1) if it joins a base. If it passes, builds the piece and takes one from
   * the builder's hand. Returns a RESULT code, and leaves what stood in the way in the answer.
   */
  set(c: Client, req: PlaceRequest, k0 = req.k0, k1 = req.k1): number {
    const { world, records, items, tribes } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const answer = this.answer;
    const verdict = this.verdict;
    answer.detail = PLACED_NONE;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    const inv = items.inv(rec);
    const slot = rec.held >= 0 ? inv.hotbar + rec.held : -1;
    const forms = slot >= 0 && inv.count[slot]! > 0 ? reg.places[inv.item[slot]!] : null;
    this.bare = !forms;
    if (!forms || req.variant >= forms.length) return RESULT_INVALID;
    const kind = forms[req.variant]!;
    const structs = world.structs;
    const pose = this.pose;
    // Reach is measured from the server's eye position, not the client's.
    const e = c.ent;
    const ex = ents.x[e]!;
    const ey = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const ez = ents.z[e]!;
    this.team = rec.team;
    let code: number;
    if (req.mode === PLACE_JOIN) code = validate(this.site, kind, rec.team, req.fr, k0, k1, ex, ey, ez, verdict);
    else {
      if (req.mode === PLACE_NEW) {
        // Open ground takes only a piece that stands on the ground by itself, and only inside the map.
        const px = req.x / STRUCT_UNITS;
        const pz = req.z / STRUCT_UNITS;
        if (!(px > 2 && pz > 2 && px < world.hf.sizeX - 2 && pz < world.hf.sizeZ - 2)) return RESULT_INVALID;
        // A bed is set on a foundation or a ceiling, as in ARK. A sleeping bag goes where a campfire does.
        if ((reg.defs[kind] as StructureDef).floor === true) return RESULT_NO_SNAP;
        if (!freePose((gx, gz) => world.hf.heightAt(gx, gz), reg, kind, px, pz, req.yaw, req.lift, pose)) return RESULT_NO_SNAP;
      } else {
        const t = structs.chunks[Math.floor(req.floor / 65536)];
        const ts = req.floor & 0xffff;
        if (!t || ts >= t.high || t.kind[ts] === 0) return RESULT_NO_SNAP;
        // A thing rests on only what the builder's tribe built.
        if (!tribes.may(rec, t.owner[ts]!)) return RESULT_NOT_YOURS;
        if (!restPose(structs, reg, req.floor, kind, req.x / STRUCT_UNITS, req.z / STRUCT_UNITS, req.yaw, pose)) return RESULT_NO_SNAP;
      }
      code = validateFree(this.site, kind, pose, ex, ey, ez, verdict);
    }
    const at = verdict.pose;
    const px = at.x / STRUCT_UNITS;
    const py = at.y / STRUCT_UNITS;
    const pz = at.z / STRUCT_UNITS;
    // ARK's beds cannot be placed under water (Swimming): the sea's or a lake's.
    if (code !== RESULT_FAR && code !== RESULT_INVALID && code !== RESULT_NO_SNAP && code !== RESULT_NOT_YOURS && reg.isBed[kind] === 1 && py < world.hf.waterAt(px, pz)) {
      this.ctx.game.sendText(c, TEXT_NOTICE, "A bed cannot be placed under water.");
      return RESULT_DENIED;
    }
    if (code !== RESULT_OK) {
      [answer.detail, answer.a, answer.b] = [verdict.detail, verdict.a, verdict.b];
      return code;
    }
    const kept = this.keepClear?.(px, pz) ?? "";
    if (kept !== "") {
      this.ctx.game.sendText(c, TEXT_NOTICE, kept);
      return RESULT_DENIED;
    }
    const target = req.mode === PLACE_REST ? req.floor : NO_TARGET;
    const refused = this.ctx.bus.before(BUILD_PLACE, { byPid: rec.pid, team: rec.team, kind: reg.ids[kind]!, x: px, y: py, z: pz, yaw: at.yaw, target });
    if (refused !== "") {
      this.ctx.game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    const def = reg.defs[kind] as StructureDef;
    // A piece of a base goes down by its key; a base's first makes its frame; a thing has only its pose.
    const ref = req.mode === PLACE_JOIN ? structs.place(kind, req.fr, k0, k1, rec.team, def.hp)
      : reg.forms.cls[kind]! >= 0 ? startBase(structs, kind, at, rec.team, def.hp)
      : structs.add(kind, px, py, pz, at.yaw, rec.team, def.hp);
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

  /** The entity index of something alive that stands where a piece of `kind` at this pose would be, or -1. */
  private bodyIn(kind: number, x: number, y: number, z: number, yaw: number): number {
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
          const k = ents.kind[i]!, car = reg.vehicle[k], v = ents.vrow[i]!;
          // A vehicle is its whole hull, nose to boot, not a body of its half width.
          if (car) {
            const frame = {
              x: ents.x[i]!, y: ents.y[i]!, z: ents.z[i]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
              qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!, steering: ents.steering[v]!,
            };
            if (isBoatVehicle(car) ? boatMeetsKind(reg.parts, kind, x, y, z, yaw, car, frame, BODY_SLACK)
              : isRotorVehicle(car) ? helicopterMeetsKind(reg.parts, kind, x, y, z, yaw, car, frame, BODY_SLACK)
              : carMeetsKind(reg.parts, kind, x, y, z, yaw, car.spec, frame, BODY_SLACK)) return i;
            continue;
          }
          if (capsuleKind(reg.parts, kind, x, y, z, yaw, ents.x[i]!, ents.y[i]!, ents.z[i]!, reg.bodyRadius[k]!, reg.bodyHeight[k]!, BODY_SLACK)) return i;
        }
      }
    }
    return -1;
  }
}
