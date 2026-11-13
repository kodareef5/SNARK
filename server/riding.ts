// Riding: a survivor on a creature of its tribe.
//
// Nothing new moves a mount. The session's inputs drive the creature's body
// in place of its own (GameServer.take, D73): the same movement, the same
// action step, so its look turns the mount as fast as the mount turns and its
// primary button is the mount's bite. The rider stays its own entity (D74):
// not stepped, pinned each tick to the seat on the mount's back, where the
// mount's pose has it, and it can be shot there.
//
// Getting on needs a saddle on the creature. Getting off puts the rider on
// the ground beside it. A mount that goes under or dies puts its rider off.

import { creaturePose } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel, solve } from "../shared/anim/skeleton.ts";
import { TAU } from "../shared/math/scalar.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { Body, STANCE_CROUCH, STANCE_STAND } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** How far from a creature a survivor may be to get on it: metres from its middle, besides its own size. */
const MOUNT_REACH = 3.5;
/** How far a rider's feet hang below where it sits. */
const SEAT_DROP = 0.55;

export interface RidingContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly tribes: Tribes;
  /** Recompute what follows from a record: here, a mount's load with and without its rider. */
  refresh(rec: EntityRecord): void;
}

export class Riding {
  /** Times a survivor got on, and got or was put off. */
  mounted = 0;
  dismounted = 0;
  private readonly ctx: RidingContext;
  /** Who rides what: the rider's session, by the mount's entity index. */
  private readonly riders = new Map<number, Client>();
  private readonly st = new AnimState();
  private readonly body = new Body();
  private readonly seat = [0, 0, 0];

  constructor(ctx: RidingContext) {
    this.ctx = ctx;
  }

  /** The record of whoever rides the creature at entity `e`, or null. */
  riderOf(e: number): EntityRecord | null {
    const c = this.riders.get(e);
    return c ? (this.ctx.records.byPid.get(c.pid) ?? null) : null;
  }

  /** Whether a session is riding. */
  riding(c: Client): boolean {
    return c.drive >= 0 && this.riders.get(c.drive) === c;
  }

  /** A survivor asks to get on the creature at entity `e`. Returns a result code. */
  mount(c: Client, e: number): number {
    const { world, game, records, tribes } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.state !== SESSION_ALIVE || c.ent < 0 || me.out || c.drive >= 0) return RESULT_DENIED;
    const rec = e >= 0 && (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || rec.keyHash !== null || world.reg.defs[rec.kind]?.type !== "species") return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    // Not without a saddle; not while it lies unconscious; not while someone else is on it.
    if (rec.saddle === 0) return RESULT_SHORT;
    if (rec.out) return RESULT_DENIED;
    if (this.riders.has(e)) return RESULT_BUSY;
    const far = Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
    if (far > MOUNT_REACH + world.reg.bodyRadius[rec.kind]!) return RESULT_FAR;
    if (!game.take(c, e)) return RESULT_DENIED;
    this.riders.set(e, c);
    ents.setSeat(c.ent, e);
    // Seated: its body is still, and drawn and hit as one that is sitting low.
    ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    ents.stance[c.ent] = STANCE_CROUCH;
    this.pin(c);
    this.mounted++;
    c.open = 0;
    c.ownDirty = true;
    this.ctx.refresh(rec);
    return RESULT_OK;
  }

  /** The session gets off what it rides, or is put off: it stands on the ground beside it. */
  dismount(c: Client): void {
    const { world, game, records } = this.ctx;
    const e = c.drive;
    if (e < 0 || this.riders.get(e) !== c) return;
    const ents = world.ents;
    this.riders.delete(e);
    game.release(c);
    if (c.ent >= 0) {
      ents.setSeat(c.ent, -1);
      ents.stance[c.ent] = STANCE_STAND;
      // Beside it, to its left or its right or behind it, wherever there is room; failing all, where it sat.
      const p = world.reg.move[ents.kind[c.ent]!]!;
      const a = (ents.yaw[e]! / 65536) * TAU;
      const off = world.reg.bodyRadius[ents.kind[e]!]! + p.radius + 0.4;
      const b = this.body;
      ents.loadBody(c.ent, b);
      for (const [fx, fz] of [[Math.cos(a), -Math.sin(a)], [-Math.cos(a), Math.sin(a)], [-Math.sin(a), -Math.cos(a)]] as const) {
        const x = ents.x[e]! + fx * off;
        const z = ents.z[e]! + fz * off;
        const y = Math.max(world.hf.heightAt(x, z), ents.y[e]!);
        if (!capsuleFree(world, x, y, z, p.radius, p.height)) continue;
        b.x = x;
        b.y = y;
        b.z = z;
        break;
      }
      b.vx = b.vy = b.vz = 0;
      ents.storeBody(c.ent, b);
      ents.pose(c.ent, world.tick);
    }
    this.dismounted++;
    c.ownDirty = true;
    const rec = (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (rec) this.ctx.refresh(rec);
  }

  /** Put the rider's body where the seat on its mount's back is now, facing as the mount faces. */
  private pin(c: Client): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const e = c.drive;
    const kind = ents.kind[e]!;
    const def = world.reg.defs[kind];
    const rig = def?.type === "species" ? world.rigs.get(def.mesh) : undefined;
    const seat = this.seat;
    const socket = rig?.sockets.get("seat");
    if (rig && socket) {
      // Where the mount's pose has it, as the clients that draw it will.
      const st = this.st;
      st.unpack(ents.anim[e]!);
      st.seed = bodySeed(e);
      creaturePose(rig, st, world.tick, world.reg.runAt[kind]!, rig.a);
      solve(rig, rig.a, rig.solved);
      boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, seat);
    } else {
      seat[0] = 0;
      seat[1] = world.reg.bodyHeight[kind]!;
      seat[2] = 0;
    }
    const a = (ents.yaw[e]! / 65536) * TAU;
    const s = Math.sin(a);
    const co = Math.cos(a);
    const b = this.body;
    ents.loadBody(c.ent, b);
    b.x = ents.x[e]! + co * seat[0]! + s * seat[2]!;
    b.y = ents.y[e]! + seat[1]! - SEAT_DROP;
    b.z = ents.z[e]! + co * seat[2]! - s * seat[0]!;
    b.yaw = ents.yaw[e]!;
    b.vx = ents.vx[e]!;
    b.vy = ents.vy[e]!;
    b.vz = ents.vz[e]!;
    ents.storeBody(c.ent, b);
    ents.pose(c.ent, world.tick);
  }

  /** Once a tick, after every body has moved: each rider goes where its mount has gone; one whose mount is no more, or has gone under, is put off. */
  step(): void {
    if (this.riders.size === 0) return;
    const { world, records } = this.ctx;
    const ents = world.ents;
    for (const [e, c] of this.riders) {
      const rec = (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
      if (c.drive !== e || !c.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE || !rec || rec.out) {
        if (c.drive === e) this.dismount(c);
        else this.riders.delete(e);
        continue;
      }
      this.pin(c);
    }
  }
}
