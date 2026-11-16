// Native terrain, structure and node collision for the boat's actual rigid parts and propeller.
import { detCos, detSin, len3 } from "../math/scalar.ts";
import { boatRestY, createBoat, type BoatContact, type BoatState, type BoatWorld } from "../sim/boat.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import type { BoatVehicleDefinition, VehicleDefinition } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, solidsCross, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import { helicopterMeetsVehicle } from "./helicopter.ts";
import type { PartTable } from "./structures.ts";
import { StaticVehicleSolids, bounds, box, makeSolid, shape, sweep, tube, type Shape, type Swept } from "./vehicle-solid.ts";

const definitions = new WeakMap<BoatVehicleDefinition, Shape[]>();
export function boatShapes(def: BoatVehicleDefinition): readonly Shape[] {
  let parts = definitions.get(def);
  if (!parts) {
    const p = def.spec.propeller, at = p.at;
    parts = [shape(tube([at[0], at[1], at[2] - .06], [at[0], at[1], at[2] + .06], [1, 0, 0], [0, 1, 0], p.radius, p.radius, 12), true),
      ...def.spec.hullBoxes.map(b => box(b.at, b.half))];
    definitions.set(def, parts);
  }
  return parts;
}
export class StaticBoatWorld implements BoatWorld {
  readonly world: CollisionWorld;
  private readonly collision: StaticVehicleSolids;
  private readonly hit: BoatContact = { reason: "", propeller: false, nx: 0, ny: 1, nz: 0 };
  constructor(world: CollisionWorld) { this.world = world; this.collision = new StaticVehicleSolids(world); }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }
  groundAt(x: number, z: number): number { return this.world.hf.heightAt(x, z); }
  blocked(from: Readonly<BoatState>, to: Readonly<BoatState>, def: BoatVehicleDefinition): BoatContact | null {
    const hit = this.collision.blocked(from, to, boatShapes(def));
    if (!hit) return null;
    this.hit.reason = hit.reason; this.hit.propeller = hit.hazard;
    this.hit.nx = hit.nx; this.hit.ny = hit.ny; this.hit.nz = hit.nz; return this.hit;
  }
}
const adapters = new WeakMap<CollisionWorld, StaticBoatWorld>();
export function boatWorld(world: CollisionWorld): StaticBoatWorld {
  let adapter = adapters.get(world); if (!adapter) { adapter = new StaticBoatWorld(world); adapters.set(world, adapter); } return adapter;
}

/** Authored or deployed keel position must already be afloat, with the complete footprint in one navigable water body. */
export function boatPlacement(world: CollisionWorld, x: number, y: number, z: number, yaw: number, def: BoatVehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  const w = boatWorld(world), p = def.spec, water = w.waterAt(x, z), rest = boatRestY(p, water);
  if (!Number.isFinite(rest) || Math.abs(y - rest) > .08) return false;
  const sn = detSin(yaw), cs = detCos(yaw);
  // Include the extremities and outboard, not merely the centre; narrow ponds and the lake/sea seam cannot spawn boats.
  for (const at of [[0, 0, 0], ...p.buoyancyPoints.map(b => b.at), ...p.hullBoxes.flatMap(b => [
    [b.at[0] - b.half[0], b.at[1] - b.half[1], b.at[2] - b.half[2]],
    [b.at[0] + b.half[0], b.at[1] - b.half[1], b.at[2] + b.half[2]],
  ]), p.propeller.at]) {
    const px = x + cs * at[0]! + sn * at[2]!, pz = z - sn * at[0]! + cs * at[2]!;
    if (px < 0 || pz < 0 || px >= world.hf.sizeX || pz >= world.hf.sizeZ || Math.abs(w.waterAt(px, pz) - water) > .02 || w.groundAt(px, pz) > y - .35) return false;
  }
  const s = createBoat(p, x, y, z, yaw);
  return w.blocked(s, s, def) === null;
}

const q = new Float64Array(4), center = new Float64Array(3);
const swept: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const otherSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const obstacle = makeSolid(), contact: BoatContact = { reason: "vehicle", propeller: false, nx: 0, ny: 0, nz: 0 };
function stateAt(def: BoatVehicleDefinition, frame: VehicleFrame): BoatState {
  const s = createBoat(def.spec, frame.x, frame.y, frame.z, frame.yaw);
  vehicleRotation(frame, q); s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!; return s;
}
function interaction(def: BoatVehicleDefinition, s: BoatState, target: Solid, slack: number): BoatContact | null {
  for (const part of boatShapes(def)) {
    sweep(part, s, s, swept);
    if (!solidsCross(swept.solid, slack, slack, target, 0, 0, 0)) continue;
    center.fill(0);
    for (let i = 0; i < target.corners * 3; i += 3) for (let axis = 0; axis < 3; axis++) center[axis] = center[axis]! + target.at[i + axis]! / target.corners;
    const x = s.x - center[0]!, y = s.y + def.spec.centerOfMass[1] - center[1]!, z = s.z - center[2]!, length = len3(x, y, z) || 1;
    contact.propeller = part.hazard; contact.nx = x / length; contact.ny = y / length; contact.nz = z / length; return contact;
  }
  return null;
}
export function boatMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, def: BoatVehicleDefinition, at: VehicleFrame, slack = 0): boolean {
  const s = stateAt(def, at), boxes = parts.box;
  frameOf(syaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, obstacle);
    if (interaction(def, s, obstacle, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, sx, sy, sz, obstacle); if (interaction(def, s, obstacle, slack)) return true;
  }
  return false;
}
export function boatMeetsCapsule(def: BoatVehicleDefinition, frame: VehicleFrame, x: number, y: number, z: number, radius: number, height: number): BoatContact | null {
  return interaction(def, stateAt(def, frame), tube([x, y, z], [x, y + Math.max(height, radius * 2), z], [1, 0, 0], [0, 0, 1], radius, radius, 12), 0);
}
export function boatMeetsVehicle(def: BoatVehicleDefinition, frame: VehicleFrame, other: VehicleDefinition, otherFrame: VehicleFrame): BoatContact | null {
  if (other.movement === "rotor") {
    const hit = helicopterMeetsVehicle(other, otherFrame, def, frame);
    if (!hit) return null;
    contact.propeller = false; contact.nx = -hit.nx; contact.ny = -hit.ny; contact.nz = -hit.nz; return contact;
  }
  const s = stateAt(def, frame), target = stateAt(def, otherFrame), p = other.spec;
  const shapes = other.movement === "boat" ? boatShapes(other) : [box([0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength])];
  for (const part of shapes) { sweep(part, target, target, otherSweep); const hit = interaction(def, s, otherSweep.solid, 0); if (hit) return hit; }
  return null;
}
