// A survivor picks a small creature up in both arms, holds it and throws it, as ARK has done since ASE 241.0 for the dodo
// (ark.wiki.gg, Dodo: Carryable By Humans). Only a creature content marks carriable, awake, and a wild one or its tribe's,
// never another tribe's. Held, it
// takes no damage and is not struck at all; it pecks from the arms what it would peck on its feet, if it reaches; its
// inventory weighs half on its carrier, whose hands are full: no tool, no weapon, no blow, and no lying down. It is
// set down, never inside anything and never past a wall, when it is put down, and when its carrier dies, leaves,
// mounts, swims, goes prone, is knocked out or moved far at once. Thrown, it falls as any body does.
//
// Clients see it held by CUE_HELD in its cue word and its carrier by its seat (EntityStore.seat), and draw it at the
// carrier's palms (shared/anim/hold.ts). The server keeps it on the carrier's side of anything the arms reach into.

import { AnimState, CUE_HELD, humanPose, type HumanAnim } from "../shared/anim/pose.ts";
import { handsAt } from "../shared/anim/hold.ts";
import { HUMAN } from "../shared/anim/human.ts";
import { Pose } from "../shared/anim/clip.ts";
import { Solved, solve } from "../shared/anim/skeleton.ts";
import { TAU } from "../shared/math/scalar.ts";
import { CARRY_DROP, CARRY_PICK_UP, CARRY_THROW, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, SESSION_ALIVE } from "../shared/net/protocol.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { Body, BTN_PRIMARY, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_HELD, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { ACT_NONE, HOLD_CARRY, actionOut, stepAction } from "../shared/sim/weapon.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection } from "../shared/world/ray.ts";
import { STANCE_AGGRESSIVE, STANCE_PASSIVE } from "./behavior.ts";
import type { Creatures } from "./creatures.ts";
import { REACH } from "./death.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** What a held creature's inventory weighs on its carrier (ark.wiki.gg, Dodo: "half as much"). */
export const HELD_WEIGHT = 0.5;
/** Metres a second a creature leaves the arms at, along the carrier's look, on top of the carrier's own speed. Chosen: ARK publishes none. */
export const THROW_SPEED = 8;
/** A carrier that moves farther than this in one tick was moved by something other than its legs, and lets go first. */
const TELEPORT = 4;
/** Metres between a carrier's body and a creature set down beside it. */
const BESIDE = 0.15;
/** Radians either side of its carrier's facing within which a held creature can turn its beak on something. Chosen. */
const PECK_ARC = 1.05;

export interface CarryContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly creatures: Creatures;
  readonly tribes: Tribes;
  /** Recomputes what derives from a record: a carrier's load and what is in its hands, a creature's rates. */
  refresh(rec: EntityRecord): void;
}

/** A creature in a survivor's arms, and its carrier as it stood when the creature was last put in them. */
interface Hold {
  readonly c: Client;
  readonly by: number;
  readonly e: number;
  readonly gen: number;
  readonly pid: number;
  /** It was a god before it was picked up, and stays one after. */
  readonly god: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  stance: number;
  /** What it pecks at, an entity index, or -1. */
  target: number;
}

export class Carry {
  picked = 0;
  setDown = 0;
  thrown = 0;
  readonly ctx: CarryContext;
  /** By the creature's entity index, and by its carrier's session. */
  private readonly holds = new Map<number, Hold>();
  private readonly of = new Map<Client, Hold>();
  /** The step's own list of the holds it walks while it ends some: filled anew at each walk. */
  private readonly walk: Hold[] = [];
  /** Bodies thrown and not yet come down, by entity index, with their generation. */
  private readonly flying = new Map<number, number>();
  /** The point between the palms, standing and crouched, from the clips the server poses survivors with. */
  private readonly palms: Float64Array[] = [];
  private palmsFor: HumanAnim | null = null;
  private readonly body = new Body();
  private readonly dir = [0, 0, 0];

  constructor(ctx: CarryContext) {
    this.ctx = ctx;
  }

  /** The entity index of what the session holds, or -1. */
  holding(c: Client): number {
    return this.of.get(c)?.e ?? -1;
  }

  /** The entity index of what the survivor `pid` holds, or -1. */
  heldBy(pid: number): number {
    for (const hold of this.of.values()) if (hold.by === pid) return hold.e;
    return -1;
  }

  /** Whether entity `e` is in someone's arms. */
  held(e: number): boolean {
    return this.holds.has(e);
  }

  /** The record of whoever holds entity `e`, or null. */
  carrierOf(e: number): EntityRecord | null {
    const hold = this.holds.get(e);
    return hold ? (this.ctx.records.byPid.get(hold.by) ?? null) : null;
  }

  /** What the creature a survivor holds adds to its load. */
  load(rec: EntityRecord): number {
    for (const hold of this.of.values()) {
      if (hold.by !== rec.pid) continue;
      const it = this.ctx.records.byPid.get(hold.pid);
      return it?.inv ? this.ctx.items.inv(it).weight(this.ctx.items.table) * HELD_WEIGHT : 0;
    }
    return 0;
  }

  /** CMD_CARRY. */
  command(c: Client, r: BitReader): number {
    const action = r.u8();
    const e = action === CARRY_PICK_UP ? r.u32() : 0;
    if (r.overflow) return RESULT_INVALID;
    if (action === CARRY_PICK_UP) return this.pickUp(c, e, false);
    if (action === CARRY_DROP) return this.drop(c) ? RESULT_OK : RESULT_INVALID;
    if (action === CARRY_THROW) return this.toss(c);
    return RESULT_INVALID;
  }

  /**
   * The use key on entity `e`, which the session looks at with nothing nearer. Returns a RESULT code, or -1 to pass the press
   * on: for anything not carriable, and for a carriable creature of another tribe or knocked out, which it opens as before.
   */
  use(c: Client, e: number): number {
    const { world, records, tribes } = this.ctx;
    const rec = records.byPid.get(world.ents.pid[e]!);
    if (!rec || world.reg.carriable[rec.kind] !== 1 || rec.out || (rec.team !== 0 && !tribes.may(records.byPid.get(c.pid), rec.team))) return -1;
    return this.pickUp(c, e, true);
  }

  /** `seen` is true when the use key's own ray found the creature first, so nothing stands between. Returns a RESULT code. */
  pickUp(c: Client, e: number, seen: boolean): number {
    const { world, records, tribes, survival } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const me = records.byPid.get(c.pid);
    if (!me || me.out || me.dead || c.state !== SESSION_ALIVE || c.ent < 0 || c.drive >= 0) return RESULT_DENIED;
    if (this.of.has(c)) return RESULT_BUSY;
    // ARK lets a body lying down pick one up and hold it through the floor. Here a body must be up, and on its feet.
    const body = c.ent;
    if (ents.stance[body] === STANCE_PRONE || ents.mode[body] !== MODE_WALK) return RESULT_DENIED;
    if (!(e >= 0 && e < ents.cap) || (ents.flags[e]! & (F_ALIVE | F_PROP | F_PLAYER)) !== F_ALIVE) return RESULT_INVALID;
    const rec = records.byPid.get(ents.pid[e]!);
    if (!rec || rec.dead || rec.keyHash !== null || reg.defs[rec.kind]?.type !== "species" || reg.carriable[rec.kind] !== 1) return RESULT_INVALID;
    if (rec.team !== 0 && !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    if (rec.out) return RESULT_DENIED;
    if (this.holds.has(e) || ents.driven[e] !== 0 || ents.seat[e] !== 0) return RESULT_BUSY;
    // Within reach of the eye, and in sight of it, as the use key's ray would find it.
    const p = reg.move[ents.kind[body]!]!;
    const ox = ents.x[body]!;
    const oy = ents.y[body]! + stanceEye(p, ents.stance[body]!);
    const oz = ents.z[body]!;
    const r = reg.bodyRadius[rec.kind]!;
    const h = reg.bodyHeight[rec.kind]!;
    const nx = Math.max(ents.x[e]! - r, Math.min(ox, ents.x[e]! + r));
    const ny = Math.max(ents.y[e]!, Math.min(oy, ents.y[e]! + h));
    const nz = Math.max(ents.z[e]! - r, Math.min(oz, ents.z[e]! + r));
    if (Math.hypot(nx - ox, ny - oy, nz - oz) > REACH) return RESULT_FAR;
    if (!seen && !this.inSight(ox, oy, oz, ents.x[e]!, ents.y[e]! + h * 0.5, ents.z[e]!) && !this.inSight(ox, oy, oz, ents.x[e]!, ents.y[e]! + h * 0.9, ents.z[e]!)) return RESULT_OBSTRUCTED;
    const hold: Hold = { c, by: me.pid, e, gen: ents.gen[e]!, pid: rec.pid, god: survival.gods.has(rec.pid), x: 0, y: 0, z: 0, yaw: 0, stance: STANCE_STAND, target: -1 };
    this.holds.set(e, hold);
    this.of.set(c, hold);
    ents.flags[e] = ents.flags[e]! | F_HELD;
    ents.setSeat(e, body);
    ents.cue[e] = ents.cue[e]! | CUE_HELD;
    world.history.cued(e);
    survival.gods.add(rec.pid);
    // Whatever was in the hands is put away. It stays away while they are full.
    me.held = -1;
    records.dirty.add(me.pid);
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    this.ctx.refresh(me);
    this.pin(hold, world.tick);
    this.picked++;
    return RESULT_OK;
  }

  /** Sets down what the session holds, beside it. False if it holds nothing. */
  drop(c: Client): boolean {
    const hold = this.of.get(c);
    if (!hold) return false;
    this.letGo(hold, false);
    return true;
  }

  /** Sets down what the survivor `pid` holds, or the creature `pid` if it is held: for a body about to leave the world. */
  release(pid: number): void {
    for (const hold of this.holds.values()) if (hold.by === pid || hold.pid === pid) return this.letGo(hold, false);
  }

  /** Sets down everything held, for a server that stops. */
  releaseAll(): void {
    for (const hold of [...this.of.values()]) this.letGo(hold, false);
  }

  /** Throws what the session holds where its body looks. Returns a RESULT code. */
  private toss(c: Client): number {
    const hold = this.of.get(c);
    if (!hold) return RESULT_INVALID;
    if (!this.fit(hold)) {
      // A carrier no longer fit to hold it has it set down, as the next step would.
      this.letGo(hold, false);
      return RESULT_DENIED;
    }
    this.pin(hold, this.ctx.world.tick);
    this.letGo(hold, true);
    return RESULT_OK;
  }

  /** Each tick, after riders move with their mounts and before combat aims. */
  step(tick: number): void {
    const ents = this.ctx.world.ents;
    // A thrown body stops where it comes down, as a bird does, and does not slide on at its speed in the air.
    for (const [e, gen] of this.flying) {
      if (ents.gen[e] !== gen || (ents.flags[e]! & F_ALIVE) === 0 || ents.mode[e] !== MODE_WALK || this.holds.has(e)) this.flying.delete(e);
      else if ((ents.flags[e]! & F_GROUNDED) !== 0) {
        ents.vx[e] = ents.vz[e] = 0;
        ents.pose(e, tick);
        this.flying.delete(e);
      }
    }
    if (this.holds.size === 0) return;
    const holds = this.walk;
    holds.length = 0;
    for (const hold of this.holds.values()) holds.push(hold);
    for (let i = 0, n = holds.length; i < n; i++) {
      const hold = holds[i]!;
      if (!this.whole(hold)) {
        this.forget(hold);
        continue;
      }
      if (!this.fit(hold)) {
        this.letGo(hold, false);
        continue;
      }
      // Hands that are full strike nothing, shoot nothing and load nothing. A client that asks is put right.
      const body = hold.c.ent;
      if (ents.act[body] !== ACT_NONE) {
        ents.act[body] = ACT_NONE;
        ents.actTicks[body] = 0;
        ents.pose(body, tick);
      }
      hold.c.did = 0;
      // A buff that ends can take its godhood away. Held, it has it.
      this.ctx.survival.gods.add(hold.pid);
      this.pin(hold, tick);
      this.peck(hold, tick);
    }
    holds.length = 0;
  }

  /** The creature is still the one picked up, and alive. */
  private whole(hold: Hold): boolean {
    const ents = this.ctx.world.ents;
    const rec = this.ctx.records.byPid.get(hold.pid);
    return (ents.flags[hold.e]! & F_ALIVE) !== 0 && ents.gen[hold.e] === hold.gen && ents.pid[hold.e] === hold.pid && rec !== undefined && !rec.dead;
  }

  /** Whether the carrier may go on holding it: connected, alive, awake, on its feet, out of the water, on no mount, no other tribe's, and where it was a tick ago. */
  private fit(hold: Hold): boolean {
    const { world, records, tribes } = this.ctx;
    const ents = world.ents;
    const c = hold.c;
    const me = records.byPid.get(hold.by);
    const it = records.byPid.get(hold.pid);
    if (!me || !it || me.dead || me.out || it.out || !c.active || c.closed || c.state !== SESSION_ALIVE || c.pid !== hold.by || c.drive >= 0) return false;
    const body = c.ent;
    if (body < 0 || ents.pid[body] !== hold.by || ents.seat[hold.e] !== body + 1) return false;
    if (ents.mode[body] !== MODE_WALK || ents.stance[body] === STANCE_PRONE) return false;
    if (it.team !== 0 && !tribes.may(me, it.team)) return false;
    const moved = Math.hypot(ents.x[body]! - hold.x, ents.y[body]! - hold.y, ents.z[body]! - hold.z);
    return moved <= TELEPORT;
  }

  /** Gone from the world while held: nothing is left to set down. */
  private forget(hold: Hold): void {
    const { records, survival } = this.ctx;
    this.holds.delete(hold.e);
    if (this.of.get(hold.c) === hold) this.of.delete(hold.c);
    if (!hold.god) survival.gods.delete(hold.pid);
    const me = records.byPid.get(hold.by);
    if (me && records.entOf.has(me.pid)) this.ctx.refresh(me);
  }

  /** Puts it down, or with `thrown` sends it off where the carrier looks. */
  private letGo(hold: Hold, thrown: boolean): void {
    const { world, records, survival } = this.ctx;
    const ents = world.ents;
    const e = hold.e;
    this.holds.delete(e);
    if (this.of.get(hold.c) === hold) this.of.delete(hold.c);
    if (!hold.god) survival.gods.delete(hold.pid);
    ents.flags[e] = ents.flags[e]! & ~(F_HELD | F_GROUNDED);
    ents.setSeat(e, -1);
    ents.cue[e] = ents.cue[e]! & ~CUE_HELD;
    world.history.cued(e);
    ents.act[e] = ACT_NONE;
    ents.actTicks[e] = 0;
    ents.pitch[e] = 0;
    if (thrown) {
      // From where the arms have it, which is never past anything the carrier stands beside.
      const d = this.dir;
      const c = hold.c;
      lookDirection(c.heldYaw, c.heldPitch, d);
      const body = c.ent;
      ents.vx[e] = ents.vx[body]! + d[0]! * THROW_SPEED;
      ents.vy[e] = ents.vy[body]! + d[1]! * THROW_SPEED;
      ents.vz[e] = ents.vz[body]! + d[2]! * THROW_SPEED;
      this.flying.set(e, ents.gen[e]!);
      this.thrown++;
    } else {
      this.place(hold);
      ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
      this.setDown++;
    }
    ents.pose(e, world.tick);
    const it = records.byPid.get(hold.pid);
    const me = records.byPid.get(hold.by);
    if (it) {
      records.dirty.add(it.pid);
      this.ctx.refresh(it);
    }
    if (me && records.entOf.has(me.pid)) this.ctx.refresh(me);
  }

  /**
   * Sets it on the ground in front of where its carrier stood, else to a side or behind, wherever it fits and has a clear way
   * there from the carrier; else where the carrier stood, which a body narrower and shorter than the carrier's fits.
   */
  private place(hold: Hold): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const e = hold.e;
    const kind = ents.kind[e]!;
    const r = world.reg.bodyRadius[kind]!;
    const h = world.reg.bodyHeight[kind]!;
    const carrier = world.reg.move[world.reg.index.get("core:survivor")!]!;
    const a = (hold.yaw / 65536) * TAU;
    const off = carrier.radius + r + BESIDE;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    for (const [dx, dz] of [[fx, fz], [fz, -fx], [-fz, fx], [-fx, -fz]] as const) {
      const x = hold.x + dx * off;
      const z = hold.z + dz * off;
      const y = Math.max(groundUnder(world.hf, x, z, r), hold.y);
      if (!capsuleFree(world, x, y, z, r, h)) continue;
      // All the way from the carrier, or a carrier against a wall would set it down on the far side.
      let clear = true;
      for (let k = 1, steps = Math.ceil(off / (r * 0.5)); k < steps && clear; k++) {
        const sx = hold.x + (dx * off * k) / steps;
        const sz = hold.z + (dz * off * k) / steps;
        clear = capsuleFree(world, sx, Math.max(groundUnder(world.hf, sx, sz, r), hold.y), sz, r, h);
      }
      if (!clear) continue;
      ents.setPosition(e, x, y, z);
      return;
    }
    ents.setPosition(e, hold.x, Math.max(groundUnder(world.hf, hold.x, hold.z, r), hold.y), hold.z);
  }

  /** The point between a survivor's palms in the cradle, in its model space, for its stance. */
  private palmsAt(stance: number): Float64Array {
    const anim = this.ctx.world.anim;
    if (this.palmsFor !== anim) {
      this.palmsFor = anim;
      const st = new AnimState();
      const pose = new Pose(HUMAN.bones);
      const solved = new Solved(HUMAN.bones);
      for (const s of [STANCE_STAND, STANCE_CROUCH]) {
        st.stance = s;
        st.setAction(ACT_NONE, HOLD_CARRY, 0);
        humanPose(anim, st, 0, pose);
        solve(HUMAN, pose, solved);
        const out = new Float64Array(3);
        handsAt(solved, out);
        this.palms[s] = out;
      }
    }
    return this.palms[stance === STANCE_CROUCH ? STANCE_CROUCH : STANCE_STAND]!;
  }

  /**
   * Moves the creature to its carrier's arms, facing as the carrier faces. Where the arms reach into something, it is
   * kept back toward the carrier until it fits and the carrier can see it, so it is never past a wall the carrier is at.
   */
  private pin(hold: Hold, tick: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const body = hold.c.ent;
    const e = hold.e;
    const kind = ents.kind[e]!;
    const stance = ents.stance[body]!;
    hold.x = ents.x[body]!;
    hold.y = ents.y[body]!;
    hold.z = ents.z[body]!;
    hold.yaw = ents.yaw[body]!;
    hold.stance = stance;
    const palms = this.palmsAt(stance);
    const h = world.reg.bodyHeight[kind]!;
    const r = world.reg.bodyRadius[kind]!;
    const socket = world.anims[kind]?.holdAt;
    const sy = socket ? socket[1]! : h * 0.34;
    const sz = socket ? socket[2]! : 0;
    const mx = palms[0]! - (socket ? socket[0]! : 0);
    const mz = palms[2]! - sz;
    const a = (hold.yaw / 65536) * TAU;
    const s = Math.sin(a);
    const co = Math.cos(a);
    const tx = hold.x + co * mx + s * mz;
    const ty = hold.y + palms[1]! - sy;
    const tz = hold.z + co * mz - s * mx;
    const eye = hold.y + stanceEye(world.reg.move[ents.kind[body]!]!, stance);
    let x = hold.x;
    let y = ty;
    let z = hold.z;
    for (let k = 4; k > 0; k--) {
      const cx = hold.x + ((tx - hold.x) * k) / 4;
      const cz = hold.z + ((tz - hold.z) * k) / 4;
      if (capsuleFree(world, cx, ty, cz, r, h) && this.inSight(hold.x, eye, hold.z, cx, ty + h * 0.5, cz)) {
        x = cx;
        z = cz;
        break;
      }
    }
    if (x === hold.x && z === hold.z && !capsuleFree(world, x, y, z, r, h)) y = hold.y;
    ents.setPosition(e, x, y, z);
    ents.vx[e] = ents.vx[body]!;
    ents.vy[e] = ents.vy[body]!;
    ents.vz[e] = ents.vz[body]!;
    ents.yaw[e] = hold.yaw;
    ents.mode[e] = MODE_WALK;
    ents.flags[e] = ents.flags[e]! | F_GROUNDED;
    ents.pose(e, tick);
  }

  private inSight(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return far < 1e-6 || castWorld(this.ctx.world, ox, oy, oz, dx / far, dy / far, dz / far, far) === HIT_NONE;
  }

  /**
   * A held creature that would peck something on its feet pecks it from the arms if its beak reaches: what it was set on by
   * a blow to it or its tribe, and when aggressive anything else's within reach. Only in front of its carrier, and only what
   * its carrier could see, so it pecks through no wall the arms are against.
   */
  private peck(hold: Hold, tick: number): void {
    const { world, creatures } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = hold.e;
    const kind = ents.kind[e]!;
    const jaws = reg.weapon[kind];
    if (!jaws) return;
    const b = this.body;
    ents.loadBody(e, b);
    let press = 0;
    if (b.act === ACT_NONE) {
      hold.target = this.prey(hold);
      if (hold.target >= 0) press = BTN_PRIMARY;
    }
    const prey = hold.target;
    if (prey >= 0 && (ents.flags[prey]! & F_ALIVE) !== 0) {
      // It aims at the nearest height of what it pecks, short of the top.
      const dx = ents.x[prey]! - ents.x[e]!;
      const dz = ents.z[prey]! - ents.z[e]!;
      const beak = ents.y[e]! + stanceEye(reg.move[kind]!, ents.stance[e]!);
      const dy = Math.max(ents.y[prey]! + 0.1, Math.min(beak, ents.y[prey]! + reg.bodyHeight[ents.kind[prey]!]! * 0.85)) - beak;
      ents.yaw[e] = Math.round((Math.atan2(dx, dz) / TAU) * 65536) & 0xffff;
      ents.pitch[e] = Math.round((Math.atan2(dy, Math.hypot(dx, dz)) / (Math.PI / 2)) * 16384);
    }
    if (press === 0 && b.act === ACT_NONE) return;
    b.yaw = ents.yaw[e]!;
    stepAction(b, press, press, jaws);
    ents.act[e] = b.act;
    ents.actTicks[e] = b.actTicks;
    ents.pose(e, tick);
    if (actionOut.strike) creatures.onStrike?.(e);
    if (b.act === ACT_NONE) hold.target = -1;
  }

  /** What the held creature would peck now, an entity index, or -1. */
  private prey(hold: Hold): number {
    const { world, creatures } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = hold.e;
    const kind = ents.kind[e]!;
    const team = ents.team[e]!;
    const mind = creatures.mind;
    if (team === 0 || mind.stance[e] === STANCE_PASSIVE) return -1;
    const body = hold.c.ent;
    const eye = hold.y + stanceEye(reg.move[ents.kind[body]!]!, hold.stance);
    const a = (hold.yaw / 65536) * TAU;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const beak = ents.y[e]! + stanceEye(reg.move[kind]!, ents.stance[e]!);
    const reaches = (o: number): boolean => {
      if (o < 0 || o === e || o === body || (ents.flags[o]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE) return false;
      if (ents.team[o] === team || (ents.team[o] === 0 && ents.grown[o] !== 0)) return false;
      // From its eye to the nearest height of the other, which a bird held at the chest finds far above one at her feet.
      const dx = ents.x[o]! - ents.x[e]!;
      const dz = ents.z[o]! - ents.z[e]!;
      const top = ents.y[o]! + reg.bodyHeight[ents.kind[o]!]!;
      const dy = beak < ents.y[o]! ? ents.y[o]! - beak : beak > top ? beak - top : 0;
      if (Math.hypot(dx, dz, dy) > reg.reach[kind]! + reg.bodyRadius[ents.kind[o]!]! * 0.5) return false;
      // In front of the carrier, and in its sight.
      const ox = ents.x[o]! - hold.x;
      const oz = ents.z[o]! - hold.z;
      if (ox * fx + oz * fz < Math.cos(PECK_ARC) * Math.hypot(ox, oz)) return false;
      return this.inSight(hold.x, eye, hold.z, ents.x[o]!, ents.y[o]! + reg.bodyHeight[ents.kind[o]!]! * 0.5, ents.z[o]!) && this.inSight(hold.x, eye, hold.z, ents.x[e]!, ents.y[e]! + reg.bodyHeight[kind]! * 0.5, ents.z[e]!);
    };
    const set = mind.targetOf(e);
    if (reaches(set)) return set;
    if (mind.stance[e] !== STANCE_AGGRESSIVE) return -1;
    // Anything else's near enough: only bodies in the chunks about it can be.
    const dims = world.dims;
    const cx = Math.floor(ents.x[e]! / 64);
    const cz = Math.floor(ents.z[e]! / 64);
    let best = -1;
    let near = Infinity;
    for (let zz = cz - 1; zz <= cz + 1; zz++) {
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (xx < 0 || zz < 0 || xx >= dims.chunksX || zz >= dims.chunksZ) continue;
        for (let o = ents.chunkHead[zz * dims.chunksX + xx]!; o >= 0; o = ents.next[o]!) {
          const d = Math.hypot(ents.x[o]! - ents.x[e]!, ents.z[o]! - ents.z[e]!);
          if (d < near && reaches(o)) {
            near = d;
            best = o;
          }
        }
      }
    }
    return best;
  }
}
