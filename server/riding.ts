// The rider's inputs drive the mount's body in place of its own (GameServer.take, D73). The rider stays its own
// entity (D74), unstepped and pinned each tick to the seat on the mount's back, and it can be shot there.

import { creaturePose } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel, solve } from "../shared/anim/skeleton.ts";
import { TAU } from "../shared/math/scalar.ts";
import { TEXT_NOTICE, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { Body, STANCE_CROUCH, STANCE_STAND } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { capsuleFree } from "../shared/world/collide.ts";
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
}

export class Riding {
  mounted = 0;
  dismounted = 0;
  private readonly ctx: RidingContext;
  /** The rider's session, by the mount's entity index. */
  private readonly riders = new Map<number, Client>();
  private readonly st = new AnimState();
  private readonly body = new Body();
  private readonly seat = [0, 0, 0];

  constructor(ctx: RidingContext) {
    this.ctx = ctx;
  }

  riderOf(e: number): EntityRecord | null {
    const c = this.riders.get(e);
    return c ? (this.ctx.records.byPid.get(c.pid) ?? null) : null;
  }

  riding(c: Client): boolean {
    return c.drive >= 0 && this.riders.get(c.drive) === c;
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
    if (rec.out) return RESULT_DENIED;
    if (this.riders.has(e)) return RESULT_BUSY;
    const far = Math.hypot(ents.x[e]! - ents.x[c.ent]!, ents.z[e]! - ents.z[c.ent]!);
    if (far > MOUNT_REACH + world.reg.bodyRadius[rec.kind]!) return RESULT_FAR;
    const refused = game.bus.before(RIDE_MOUNT, { pid: me.pid, mount: rec.pid });
    if (refused !== "") {
      game.sendText(c, TEXT_NOTICE, refused);
      return RESULT_DENIED;
    }
    if (!game.take(c, e)) return RESULT_DENIED;
    this.riders.set(e, c);
    ents.setSeat(c.ent, e);
    // A seated body is still. The crouch stance makes it drawn and hit as sitting low.
    ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0;
    ents.stance[c.ent] = STANCE_CROUCH;
    this.pin(c);
    this.mounted++;
    c.open = 0;
    c.ownDirty = true;
    this.ctx.refresh(rec);
    return RESULT_OK;
  }

  dismount(c: Client): void {
    const { world, game, records } = this.ctx;
    const e = c.drive;
    if (e < 0 || this.riders.get(e) !== c) return;
    const ents = world.ents;
    this.riders.delete(e);
    game.release(c);
    game.bus.after(RIDE_DISMOUNT, { pid: c.pid, mount: ents.pid[e]! });
    if (c.ent >= 0) {
      ents.setSeat(c.ent, -1);
      ents.stance[c.ent] = STANCE_STAND;
      // It lands beside the mount or behind it, wherever there is room. With no room it stays where it sat.
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
        // The body must fit all the way from the mount to the spot, or a mount beside a wall would set its rider down inside the base.
        let clear = true;
        for (let k = 1, steps = Math.ceil(off / (p.radius * 0.5)); k < steps && clear; k++) {
          const sx = ents.x[e]! + (fx * off * k) / steps;
          const sz = ents.z[e]! + (fz * off * k) / steps;
          clear = capsuleFree(world, sx, Math.max(world.hf.heightAt(sx, sz), ents.y[e]!), sz, p.radius, p.height);
        }
        if (!clear) continue;
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

  /** Moves the rider's body to the seat on its mount, facing as the mount faces. */
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
      // Pose the mount as the clients do, so the seat is where they draw it.
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

  /** Call once a tick, after every body has moved. A rider whose mount died or fell unconscious, or is no longer its tribe's, is put off. */
  step(): void {
    if (this.riders.size === 0) return;
    const { world, records, tribes } = this.ctx;
    const ents = world.ents;
    for (const [e, c] of this.riders) {
      const rec = (ents.flags[e]! & F_ALIVE) !== 0 ? records.byPid.get(ents.pid[e]!) : undefined;
      const me = records.byPid.get(c.pid);
      // A rider who is knocked out falls off, as one whose mount is. One put out of the tribe has no mount there.
      if (c.drive !== e || !c.active || c.closed || c.ent < 0 || c.state !== SESSION_ALIVE || !rec || rec.out || me?.out || !tribes.may(me, rec.team)) {
        if (c.drive === e) this.dismount(c);
        else {
          // The game let go of the mount first (the connection dropped, or the mount died). The body must not stay marked as seated,
          // or others would draw it on the mount while it stands somewhere else.
          this.riders.delete(e);
          if (c.ent >= 0 && c.drive < 0 && ents.seat[c.ent] === e + 1) {
            ents.setSeat(c.ent, -1);
            ents.stance[c.ent] = STANCE_STAND;
            ents.pose(c.ent, world.tick);
          }
        }
        continue;
      }
      this.pin(c);
    }
  }
}
