// A wreck changes shape only when every occupant can reach free space before its door opens.
import { CHUNK_SIZE } from "../shared/coords.ts";
import { stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import type { VehicleDefinition } from "../shared/sim/vehicle.ts";
import type { VehicleFrame } from "../shared/sim/vehicle-frame.ts";
import { boatMeetsCapsule, boatMeetsKind } from "../shared/world/boat.ts";
import { capsuleKind, SKIN } from "../shared/world/collide.ts";
import { helicopterMeetsCapsule, helicopterMeetsKind } from "../shared/world/helicopter.ts";
import { carMeetsCapsule, carMeetsKind } from "../shared/world/vehicle.ts";
import { placeFree } from "./place.ts";
import type { ServerWorld } from "./world.ts";

const REACH = 3;

interface Occupant {
  e: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  vehicle?: { def: VehicleDefinition; pose: VehicleFrame };
}

export class WreckClearance {
  private readonly world: ServerWorld;
  private readonly widest: number;

  constructor(world: ServerWorld) {
    this.world = world;
    let widest = 0;
    for (let k = 0; k < world.reg.defs.length; k++) {
      const spec = world.reg.vehicle[k]?.spec;
      widest = Math.max(widest, world.reg.bodyRadius[k]!, spec ? Math.hypot(spec.halfWidth, spec.halfLength, spec.height) : 0);
    }
    this.widest = widest;
  }

  private nearby(x: number, z: number, reach: number): Occupant[] {
    const { dims, ents, reg } = this.world;
    const pad = reach + this.widest;
    const x0 = Math.max(0, Math.floor((x - pad) / CHUNK_SIZE)), x1 = Math.min(dims.chunksX - 1, Math.floor((x + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((z - pad) / CHUNK_SIZE)), z1 = Math.min(dims.chunksZ - 1, Math.floor((z + pad) / CHUNK_SIZE));
    const bodies: Occupant[] = [];
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (let e = ents.chunkHead[cz * dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
        if ((ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE || ents.seat[e] !== 0) continue;
        const k = ents.kind[e]!, move = reg.move[k], def = reg.vehicle[k];
        const radius = reg.bodyRadius[k]!;
        if (!(radius > 0) && !def) continue;
        const sx = ents.x[e]!, sy = ents.y[e]!, sz = ents.z[e]!;
        const extent = def ? Math.hypot(def.spec.halfWidth, def.spec.halfLength, def.spec.height) : radius;
        if (Math.hypot(sx - x, sz - z) > reach + extent) continue;
        const height = move ? stanceHeight(move, ents.stance[e]!) : reg.bodyHeight[k]!;
        const body: Occupant = { e, x: sx, y: sy, z: sz, radius, height };
        if (def) {
          const v = ents.vrow[e]!;
          body.vehicle = { def, pose: { x: sx, y: sy, z: sz, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
            qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!, steering: ents.steering[v]! } };
        }
        bodies.push(body);
      }
    }
    return bodies;
  }

  /** Occupants hold both their places and the routes that reach them until the whole swap can go ahead. */
  clear(ref: number, kind: number): boolean {
    const { structs, ents } = this.world;
    const row = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535;
    const x = row.x[slot]!, y = row.y[slot]!, z = row.z[slot]!, yaw = row.yaw[slot]!;
    const bodies = this.nearby(x, z, structs.spread[kind]! + REACH + this.widest);
    for (const body of bodies) {
      const vehicle = body.vehicle;
      if (vehicle) {
        const { def, pose } = vehicle;
        const meets = def.movement === "boat" ? boatMeetsKind(structs.parts, kind, x, y, z, yaw, def, pose) :
          def.movement === "rotor" ? helicopterMeetsKind(structs.parts, kind, x, y, z, yaw, def, pose) :
          carMeetsKind(structs.parts, kind, x, y, z, yaw, def.spec, pose, SKIN);
        if (meets) return false;
        continue;
      }
      const meets = (px: number, pz: number) => capsuleKind(structs.parts, kind, x, y, z, yaw, px, body.y, pz, body.radius, body.height, SKIN);
      if (!meets(body.x, body.z)) continue;
      const dx = body.x - x, dz = body.z - z, far = Math.hypot(dx, dz);
      if (far === 0) return false;
      const step = Math.min(0.1, body.radius / 2);
      let d = step;
      for (; d <= REACH; d += step) {
        const px = Math.fround(body.x + dx / far * d), pz = Math.fround(body.z + dz / far * d);
        if (!placeFree(this.world, px, body.y, pz, body.radius, body.height) || bodies.some(other => other !== body && touches(body, px, pz, other))) return false;
        if (meets(px, pz)) continue;
        body.x = px;
        body.z = pz;
        break;
      }
      if (d > REACH) return false;
    }
    for (const b of bodies) if (ents.x[b.e] !== b.x || ents.z[b.e] !== b.z) ents.setPosition(b.e, b.x, b.y, b.z);
    return true;
  }
}

function touches(body: Occupant, x: number, z: number, other: Occupant): boolean {
  if (other.vehicle) {
    const { def, pose } = other.vehicle;
    if (def.movement === "rotor") return !!helicopterMeetsCapsule(def, pose, x, body.y, z, body.radius, body.height);
    if (def.movement === "boat") return !!boatMeetsCapsule(def, pose, x, body.y, z, body.radius, body.height);
    return !!carMeetsCapsule(def.spec, pose, x, body.y, z, body.radius, body.height);
  }
  return body.y < other.y + other.height && other.y < body.y + body.height &&
    Math.hypot(x - other.x, z - other.z) < body.radius + other.radius;
}
