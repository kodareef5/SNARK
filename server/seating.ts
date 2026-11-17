// What any seat's authority asks of the world: whether a body fits at a point, whether it can go from one point to
// another, and where it can stand when it leaves a seat. A car's (server/urban.ts) and a creature's (server/riding.ts)
// share these, so getting out of either is tested alike.

import { CHUNK_SIZE } from "../shared/coords.ts";
import { STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import { isWheelVehicle } from "../shared/sim/vehicle.ts";
import { carMeetsCapsule } from "../shared/world/vehicle.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export interface Point { x: number; y: number; z: number }

const STANCES = [STANCE_STAND, STANCE_CROUCH, STANCE_PRONE] as const;

export class Seating {
  /** The farthest any body or vehicle reaches from its origin across the ground, for finding what is near a point. */
  readonly reach: number;
  private readonly world: ServerWorld;
  private readonly records: Records;

  constructor(world: ServerWorld, records: Records) {
    this.world = world;
    this.records = records;
    const reg = world.reg;
    let reach = 0;
    for (let k = 0; k < reg.defs.length; k++) {
      const v = reg.vehicle[k];
      reach = Math.max(reach, reg.bodyRadius[k] ?? 0, v ? Math.hypot(v.spec.halfWidth, v.spec.halfLength, v.spec.height) : 0);
    }
    this.reach = reach;
  }

  /** The live entity of record `pid`, or -1. */
  entity(pid: number): number {
    const e = this.records.entOf.get(pid), ents = this.world.ents;
    return e !== undefined && ents.pid[e] === pid && (ents.flags[e]! & F_ALIVE) !== 0 ? e : -1;
  }

  /**
   * Whether `actor`'s body, `height` tall (its standing height when omitted), fits at `p`: clear of the world and of every
   * other live body and car but those `ignored` and `ignoredHost`.
   */
  free(p: Point, actor: number, ignored: readonly number[], ignoredHost = 0, height?: number): boolean {
    const { world, records } = this, ents = world.ents;
    const ae = this.entity(actor), move = ae >= 0 ? world.reg.move[ents.kind[ae]!] : null;
    if (!move || !capsuleFree(world, p.x, p.y, p.z, move.radius, height ?? move.height)) return false;
    const pad = move.radius + this.reach;
    const x0 = Math.max(0, Math.floor((p.x - pad) / CHUNK_SIZE)), x1 = Math.min(world.dims.chunksX - 1, Math.floor((p.x + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((p.z - pad) / CHUNK_SIZE)), z1 = Math.min(world.dims.chunksZ - 1, Math.floor((p.z + pad) / CHUNK_SIZE));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) for (let e = ents.chunkHead[cz * world.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
      const pid = ents.pid[e]!;
      if (pid === 0 || records.entOf.get(pid) !== e || ignored.includes(pid) || pid === ignoredHost || (ents.flags[e]! & F_ALIVE) === 0) continue;
      const vehicle = world.reg.vehicle[ents.kind[e]!];
      const dx = p.x - ents.x[e]!, dz = p.z - ents.z[e]!;
      if (vehicle && !isWheelVehicle(vehicle)) {
        // Boarding corridors intentionally permit stepping over skids/through the stern ladder.
        // Aircraft/boat interaction queries include those parts (and rotor hazards), so retain their boarding proxy.
        if (p.y >= ents.y[e]! + world.reg.bodyHeight[ents.kind[e]!]! || p.y + (height ?? move.height) <= ents.y[e]!) continue;
        const a = ents.vehicleYaw[ents.vrow[e]!]!, co = Math.cos(a), sn = Math.sin(a);
        const x = Math.max(0, Math.abs(co * dx - sn * dz) - vehicle.spec.halfWidth);
        const z = Math.max(0, Math.abs(sn * dx + co * dz) - vehicle.spec.halfLength);
        if (x * x + z * z < move.radius * move.radius) return false;
      } else if (vehicle) {
        const v = ents.vrow[e]!;
        const frame = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
          qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!, steering: ents.steering[v]! };
        const hit = carMeetsCapsule(vehicle.spec, frame, p.x, p.y, p.z, move.radius, height ?? move.height);
        if (hit) return false;
      } else {
        if (p.y >= ents.y[e]! + world.reg.bodyHeight[ents.kind[e]!]! || p.y + (height ?? move.height) <= ents.y[e]!) continue;
        if (dx * dx + dz * dz < (move.radius + world.reg.bodyRadius[ents.kind[e]!]!) ** 2) return false;
      }
    }
    return true;
  }

  /** Whether `actor`'s body fits at every point from `a` to `b`, a tenth of a metre apart, and the way is at most 6.4 m. */
  corridor(a: Point, b: Point, actor: number, ignored: readonly number[], ignoredHost = 0, height?: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
    if (n > 64) return false;
    for (let i = 0; i <= n; i++) if (!this.free({ x: a.x + (b.x - a.x) * i / n,
      y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n }, actor, ignored, ignoredHost, height)) return false;
    return true;
  }

  /**
   * The tallest stance in which body `e` fits at `p`, reached from `from` through nothing but `host`, or -1 where none does.
   * With `onHost`, `p` may be inside the host itself: where a creature stands is the last place its rider is set down.
   */
  stance(e: number, from: Point, p: Point, host: number, onHost = false): number {
    const ents = this.world.ents, actor = ents.pid[e]!, move = this.world.reg.move[ents.kind[e]!]!;
    for (const stance of STANCES) {
      const height = stanceHeight(move, stance);
      if (this.free(p, actor, [actor], onHost ? host : 0, height) && this.corridor(from, p, actor, [actor], host, height)) return stance;
    }
    return -1;
  }

  /**
   * Stands body `e`, which leaves a seat on `host` (a record id), at the first of `spots` it fits at, standing, crouched
   * or lying, reached from `from` through nothing but the host. False when there is nowhere; it then crouches where it is.
   */
  standAt(e: number, from: Point, spots: readonly Point[], host: number): boolean {
    const ents = this.world.ents;
    for (const p of spots) {
      const stance = this.stance(e, from, p, host);
      if (stance < 0) continue;
      ents.setPosition(e, p.x, p.y, p.z);
      ents.stance[e] = stance;
      return true;
    }
    ents.stance[e] = STANCE_CROUCH;
    return false;
  }
}
