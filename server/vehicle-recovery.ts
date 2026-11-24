// Explicit recovery actions validate the same convex hulls as driving, including the whole rotation path.
import { CHUNK_SIZE } from "../shared/coords.ts";
import { quatNlerp, quatRotate } from "../shared/math/quat.ts";
import { stanceHeight } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import type { WheelVehicleDefinition } from "../shared/sim/vehicle.ts";
import { vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import { carShapes } from "../shared/world/vehicle-shapes.ts";
import { bounds, makeSolid, solidContact, StaticVehicleSolids, sweep, tube, type ContactGeometry, type SolidFrame, type Swept } from "../shared/world/vehicle-solid.ts";
import type { ServerWorld } from "./world.ts";
import { familyOf } from "../shared/sim/families.ts";

export function recoveryFrame(world: ServerWorld, e: number): SolidFrame {
  const a = world.ents, v = a.vrow[e]!;
  return { x: a.x[e]!, y: a.y[e]!, z: a.z[e]!, qx: a.vehicleQx[v]!, qy: a.vehicleQy[v]!, qz: a.vehicleQz[v]!, qw: a.vehicleQw[v]! };
}

/** A rolled hull rests on its side/roof, so wheel-grounded alone cannot authorize recovery. */
export function supportedCar(world: ServerWorld, e: number, def: WheelVehicleDefinition): boolean {
  const at = recoveryFrame(world, e), solids = new StaticVehicleSolids(world);
  const hit = solids.blocked(at, { ...at, y: at.y - .15 }, carShapes(def.spec));
  return !!hit && hit.ny > .55;
}

/** Returns an upright pose only when a bounded, ground-supported righting arc clears static and live bodies. */
export function uprightCar(world: ServerWorld, e: number, def: WheelVehicleDefinition): SolidFrame | null {
  const a = world.ents, v = a.vrow[e]!, start = recoveryFrame(world, e), shapes = carShapes(def.spec);
  if (!supportedCar(world, e, def)) return null;
  const source = [start.qx, start.qy, start.qz, start.qw], target = [0, Math.sin(a.vehicleYaw[v]! / 2), 0, Math.cos(a.vehicleYaw[v]! / 2)];
  const q = new Float64Array(4), point = new Float64Array(3);
  quatRotate(source, 0, 0, 1, 0, point, 0);
  if (point[1]! > .7) return null;
  const centre = (def.spec.clearance + def.spec.height) / 2;
  quatRotate(source, 0, 0, centre, 0, point, 0);
  const cx = start.x + point[0]!, cy = start.y + point[1]!, cz = start.z + point[2]!;
  const solids = new StaticVehicleSolids(world);
  const swept: Swept = { ...shapes[0]!, solid: makeSolid(), pad: 0, bounds: bounds() };
  const other: Swept = { ...shapes[0]!, solid: makeSolid(), pad: 0, bounds: bounds() };
  const hit: ContactGeometry = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, depth: 0 };
  let reach = 0;
  for (let kind = 0; kind < world.reg.defs.length; kind++) {
    const vehicle = world.reg.vehicle[kind];
    reach = Math.max(reach, world.reg.bodyRadius[kind] ?? 0, vehicle ? Math.hypot(vehicle.spec.halfLength, vehicle.spec.halfWidth, vehicle.spec.height) : 0);
  }
  const radius = Math.hypot(def.spec.halfLength, def.spec.halfWidth, def.spec.height) + reach;
  const x0 = Math.max(0, Math.floor((cx - radius) / CHUNK_SIZE)), x1 = Math.min(world.dims.chunksX - 1, Math.floor((cx + radius) / CHUNK_SIZE));
  const z0 = Math.max(0, Math.floor((cz - radius) / CHUNK_SIZE)), z1 = Math.min(world.dims.chunksZ - 1, Math.floor((cz + radius) / CHUNK_SIZE));
  const clearBodies = (from: SolidFrame, to: SolidFrame): boolean => {
    sweep(shapes[0]!, from, to, swept);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let actor = a.chunkHead[z * world.dims.chunksX + x]!; actor >= 0; actor = a.next[actor]!) {
        if (actor === e || (a.flags[actor]! & F_ALIVE) === 0) continue;
        const vehicle = world.reg.vehicle[a.kind[actor]!];
        if (vehicle) {
          const row = a.vrow[actor]!, at = recoveryFrame(world, actor);
          const family = familyOf(vehicle)!;
          const frame = { ...at, yaw: a.vehicleYaw[row]!, pitch: a.vehiclePitch[row]!, roll: a.vehicleRoll[row]!, steering: a.steering[row]! };
          const mounts = family.mounts(vehicle, frame);
          for (const part of family.parts(vehicle)) {
            const pose = part.joint === undefined || !mounts ? at : mounts[part.joint]!; sweep(part, pose, pose, other);
            if (solidContact(swept.solid, other.solid, hit, -swept.pad)) return false;
          }
        } else {
          const move = world.reg.move[a.kind[actor]!], r = world.reg.bodyRadius[a.kind[actor]!]!;
          const height = move ? stanceHeight(move, a.stance[actor]!) : world.reg.bodyHeight[a.kind[actor]!]!;
          const capsule = tube([a.x[actor]!, a.y[actor]!, a.z[actor]!], [a.x[actor]!, a.y[actor]! + Math.max(height, r * 2), a.z[actor]!], [1, 0, 0], [0, 0, 1], r, r, 12);
          if (solidContact(swept.solid, capsule, hit, -swept.pad)) return false;
        }
      }
    }
    return true;
  };
  let previous = start;
  for (let step = 1; step <= 48; step++) {
    quatNlerp(q, 0, source, 0, target, 0, step / 48);
    quatRotate(q, 0, 0, centre, 0, point, 0);
    const candidate = { x: cx - point[0]!, y: cy - point[1]!, z: cz - point[2]!, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
    // Lift only off an upward support face, never through a wall/ceiling. Each short arc is swept again afterward.
    for (let attempt = 0; attempt < 8; attempt++) {
      const overlap = solids.blocked(candidate, candidate, shapes, undefined, false, 0);
      if (!overlap) break;
      if (overlap.ny < .55) return null;
      candidate.y += Math.max(.015, overlap.depth / overlap.ny + .015);
    }
    if (candidate.y - start.y > def.spec.height + def.spec.halfWidth || solids.blocked(candidate, candidate, shapes, undefined, false, 0)) return null;
    // Allow separation from the existing supporting face; no new obstacle may be crossed.
    if (solids.blocked(previous, candidate, shapes, undefined, true) || !clearBodies(previous, candidate)) return null;
    previous = candidate;
  }
  // Keep the resulting wheels close to support. Normal suspension settles the last few centimetres.
  const wheels = [[-def.spec.track / 2, -def.spec.wheelbase / 2], [def.spec.track / 2, -def.spec.wheelbase / 2],
    [-def.spec.track / 2, def.spec.wheelbase / 2], [def.spec.track / 2, def.spec.wheelbase / 2]];
  const upright = { ...previous, yaw: a.vehicleYaw[v]!, pitch: 0, roll: 0 };
  vehicleRotation(upright, q);
  let floor = -Infinity;
  for (const [x, z] of wheels) {
    quatRotate(q, 0, x!, 0, z!, point, 0);
    const top = previous.y + def.spec.height / 2;
    const found = castWorld(world, previous.x + point[0]!, top, previous.z + point[2]!, 0, -1, 0, def.spec.height + def.spec.halfWidth + .2, true);
    if (found !== HIT_NONE && rayHit.ny > .55) floor = Math.max(floor, top - rayHit.t);
  }
  if (!Number.isFinite(floor)) return null;
  if (previous.y < floor + .04) {
    const raised = { ...previous, y: floor + .04 };
    if (solids.blocked(previous, raised, shapes, undefined, true) || !clearBodies(previous, raised)) return null;
    previous = raised;
  }
  // Do not lower through a deck: find the first clear supported placement by short swept descents.
  for (let down = 0; down < 120 && previous.y > floor + .04; down++) {
    const next = { ...previous, y: Math.max(floor + .04, previous.y - .025) };
    if (solids.blocked(previous, next, shapes) || !clearBodies(previous, next)) break;
    previous = next;
  }
  return previous;
}
