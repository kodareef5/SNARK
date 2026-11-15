// The rider's inputs drive the mount's body in place of its own (GameServer.take, D73). The rider stays its own
// entity (D74), unstepped and pinned each tick to the seat on the mount's back, and it can be shot there.

import { creaturePose } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel, solve } from "../shared/anim/skeleton.ts";
import { TAU } from "../shared/math/scalar.ts";
import { TEXT_NOTICE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { Body, MODE_FLYER, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";

/** Metres from the creature's centre, on top of its body radius. */
const MOUNT_REACH = 3.5;
/** A rider's feet hang this many metres below the seat. */
const SEAT_DROP = 0.55;

const RIDE_MOUNT = event("ride.mount");
const RIDE_DISMOUNT = event("ride.dismount");

export interface RidingContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly tribes: Tribes;
  /** Recomputes what derives from a record. Riding calls it for a mount's load when a rider gets on or off. */
  refresh(rec: EntityRecord): void;
  /** Whether a bola holds the body (server/entangle.ts): "creatures cannot be mounted while immobilized by the Bola" (Bola), nor does a held survivor get on. */
  tangled?(rec: EntityRecord): boolean;
}

/** A rider's session, and its mount as it stood when the rider was last pinned to it: the place it gets off at, though the mount be gone by then. */
interface Ride {
  readonly c: Client;
  /** The mount's record id and body radius. */
  readonly pid: number;
  readonly r: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class Riding {
  mounted = 0;
  dismounted = 0;
  private readonly ctx: RidingContext;
  /** By the mount's entity index. */
  private readonly riders = new Map<number, Ride>();
  private readonly st = new AnimState();
  private readonly body = new Body();
  private readonly seat = [0, 0, 0];

  constructor(ctx: RidingContext) {
    this.ctx = ctx;
  }

  riderOf(e: number): EntityRecord | null {
    const ride = this.riders.get(e);
    return ride ? (this.ctx.records.byPid.get(ride.c.pid) ?? null) : null;
  }

  riding(c: Client): boolean {
    return c.drive >= 0 && this.riders.get(c.drive)?.c === c;
  }

  /** Returns a RESULT code. */
  mount(c: Client, e: number): number {
    const { world, game, records, tribes } = this.ctx;
    const ents = world.ents;
    const me = records.byPid.get(c.pid);
    if (!me || c.state !== SESSION_ALIVE || c.ent < 0 || me.out || c.drive >= 0) return RESULT_DENIED;
    const rec = e >= 0 && (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || rec.keyHash !== null || world.reg.defs[rec.kind]?.type !== "species") return RESULT_INVALID;
    if (rec.team === 0 || !tribes.may(me, rec.team)) return RESULT_NOT_YOURS;
    if (rec.saddle === 0) return RESULT_SHORT;
    if (rec.out || this.ctx.tangled?.(rec) || this.ctx.tangled?.(me)) return RESULT_DENIED;
    if (this.riders.has(e)) return RESULT_BUSY;
    const far = Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
    if (far > MOUNT_REACH + world.reg.bodyRadius[rec.kind]!) return RESULT_FAR;
    const refused = game.bus.before(RIDE_MOUNT, { pid: me.pid, mount: rec.pid });
    if (refused !== "") {
      game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    if (!game.take(c, e)) return RESULT_DENIED;
    const ride: Ride = { c, pid: rec.pid, r: world.reg.bodyRadius[rec.kind]!, x: 0, y: 0, z: 0, yaw: 0 };
    this.riders.set(e, ride);
    ents.setSeat(c.ent, e);
    // A seated body is still. The crouch stance makes it drawn and hit as sitting low.
    ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    ents.stance[c.ent] = STANCE_CROUCH;
    this.pin(ride);
    this.mounted++;
    c.open = 0;
    c.ownDirty = true;
    this.ctx.refresh(rec);
    return RESULT_OK;
  }

  dismount(c: Client): void {
    const { game } = this.ctx;
    const e = c.drive;
    const ride = e >= 0 ? this.riders.get(e) : undefined;
    if (!ride || ride.c !== c) return;
    game.release(c);
    game.bus.after(RIDE_DISMOUNT, { pid: c.pid, mount: ride.pid });
    const rec = this.removeRider(e, ride);
    // A flyer let go of in the air stops flying and falls, hurt once as any fall is (ASE 203.1).
    const ents = this.ctx.world.ents;
    if (rec?.pid === ride.pid && ents.mode[e] === MODE_FLYER) ents.mode[e] = MODE_WALK;
    if (c.ent >= 0) {
      // The mount has moved this tick since its rider was pinned.
      if (rec?.pid === ride.pid) this.note(ride, e);
      this.setDown(ride);
    }
    this.dismounted++;
    c.ownDirty = true;
  }

  /** Both a dismount and a connection already released by the game remove the rider's load from its original mount. */
  private removeRider(e: number, ride: Ride): EntityRecord | undefined {
    this.riders.delete(e);
    const { world, records } = this.ctx;
    const ents = world.ents;
    const rec = (ents.flags[e]! & F_ALIVE) !== 0 && ents.pid[e] === ride.pid ? records.byPid.get(ride.pid) : undefined;
    if (rec) this.ctx.refresh(rec);
    return rec;
  }

  private note(ride: Ride, e: number): void {
    const ents = this.ctx.world.ents;
    ride.x = ents.x[e]!;
    ride.y = ents.y[e]!;
    ride.z = ents.z[e]!;
    ride.yaw = ents.yaw[e]!;
  }

  /**
   * Sets a rider down beside where its mount stood or behind it, wherever there is room and a clear way there. With no room it
   * is set where the mount itself stood, as low as it must be to fit. It is never left at the seat, which may be inside a ceiling.
   */
  private setDown(ride: Ride): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const body = ride.c.ent;
    ents.setSeat(body, -1);
    const p = world.reg.move[ents.kind[body]!]!;
    const a = (ride.yaw / 65536) * TAU;
    const off = ride.r + p.radius + 0.4;
    const b = this.body;
    ents.loadBody(body, b);
    let beside = false;
    for (const [fx, fz] of [[Math.cos(a), -Math.sin(a)], [-Math.cos(a), Math.sin(a)], [-Math.sin(a), -Math.cos(a)]] as const) {
      const x = ride.x + fx * off;
      const z = ride.z + fz * off;
      const y = Math.max(groundUnder(world.hf, x, z, p.radius), ride.y);
      if (!capsuleFree(world, x, y, z, p.radius, p.height)) continue;
      // The body must fit all the way from the mount to the spot, or a mount beside a wall would set its rider down inside the base.
      let clear = true;
      for (let k = 1, steps = Math.ceil(off / (p.radius * 0.5)); k < steps && clear; k++) {
        const sx = ride.x + (fx * off * k) / steps;
        const sz = ride.z + (fz * off * k) / steps;
        clear = capsuleFree(world, sx, Math.max(groundUnder(world.hf, sx, sz, p.radius), ride.y), sz, p.radius, p.height);
      }
      if (!clear) continue;
      b.x = x;
      b.y = y;
      b.z = z;
      beside = true;
      break;
    }
    b.stance = STANCE_STAND;
    if (!beside) {
      // Where the mount stood is clear of everything but the mount, which is wider than its rider though it may be lower.
      b.x = ride.x;
      b.y = ride.y;
      b.z = ride.z;
      if (!capsuleFree(world, b.x, b.y, b.z, p.radius, p.height)) b.stance = capsuleFree(world, b.x, b.y, b.z, p.radius, p.crouchHeight) ? STANCE_CROUCH : STANCE_PRONE;
    }
    b.vx = b.vy = b.vz = 0;
    ents.storeBody(body, b);
    ents.pose(body, world.tick);
  }

  /** Moves the rider's body to the seat on its mount, facing as the mount faces. */
  private pin(ride: Ride): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const c = ride.c;
    const e = c.drive;
    this.note(ride, e);
    const kind = ents.kind[e]!;
    const anim = world.anims[kind];
    const rig = anim?.rig;
    const seat = this.seat;
    const socket = rig?.sockets.get("seat");
    if (anim && rig && socket) {
      // Pose the mount as the clients do, so the seat is where they draw it.
      const st = this.st;
      st.unpack(ents.anim[e]!, ents.cue[e]!);
      st.seed = bodySeed(e);
      creaturePose(anim, st, world.tick, rig.a);
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

  /** Call once a tick, after every body has moved. A rider whose mount died or fell unconscious, or is no longer its tribe's, is put off. */
  step(): void {
    if (this.riders.size === 0) return;
    const { world, records, tribes } = this.ctx;
    const ents = world.ents;
    for (const [e, ride] of this.riders) {
      const c = ride.c;
      const rec = (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
      const me = records.byPid.get(c.pid);
      // A rider who is knocked out falls off, as one whose mount is. One put out of the tribe has no mount there.
      if (c.drive !== e || !c.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE || !rec || rec.out || me?.out || !tribes.may(me, rec.team)) {
        if (c.drive === e) this.dismount(c);
        else {
          // The game let go of the mount first (the connection dropped, or the mount died). Its rider is set down as one who
          // got off, and no longer marked as seated, or others would draw it on the mount while it stands somewhere else.
          this.removeRider(e, ride);
          if (c.ent >= 0 && c.drive < 0 && ents.seat[c.ent] === e + 1) this.setDown(ride);
        }
        continue;
      }
      this.pin(ride);
    }
  }
}
