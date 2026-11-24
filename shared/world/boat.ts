// Native terrain, structure and node collision for the boat's actual rigid parts and propeller.
import { quatRotate } from "../math/quat.ts";
import { vehicleMassProperties } from "../sim/vehicle-rigid.ts";
import { detCos, detSin, len3 } from "../math/scalar.ts";
import { boatRestY, createBoat, type BoatContact, type BoatState, type BoatWorld } from "../sim/boat.ts";
import { vehicleRotation } from "../sim/vehicle-frame.ts";
import { boatDrives, type BoatVehicleDefinition, type VehicleDefinition } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import type { PartTable } from "./structures.ts";
import { StaticVehicleSolids, bounds, makeSolid, solidContact, sweep, tube, type ContactGeometry, type SolidFrame, type Swept } from "./vehicle-solid.ts";

import { boatMounts, boatJoints, boatShapes, carShapes, helicopterShapes, type BoatFrame } from "./vehicle-shapes.ts";
export { boatShapes, type BoatFrame } from "./vehicle-shapes.ts";

export class StaticBoatWorld implements BoatWorld {
  readonly world: CollisionWorld;
  private readonly collision: StaticVehicleSolids;
  private readonly hit: BoatContact = { reason: "", propeller: false, nx: 0, ny: 1, nz: 0, x: 0, y: 0, z: 0, depth: 0 };
  private readonly rotation = new Float64Array(4);
  private readonly center = new Float64Array(3);
  constructor(world: CollisionWorld) { this.world = world; this.collision = new StaticVehicleSolids(world); }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }
  groundAt(x: number, z: number): number { return this.world.hf.heightAt(x, z); }
  blocked(from: Readonly<BoatState>, to: Readonly<BoatState>, def: BoatVehicleDefinition): BoatContact | null {
    const hit = this.collision.blocked(from, to, boatShapes(def), boatJoints(from, to, def.spec), true);
    if (!hit) return null;
    Object.assign(this.hit, hit); this.hit.propeller = hit.hazard; this.bank(to, def); return this.hit;
  }
  penetration(at: Readonly<BoatState>, def: BoatVehicleDefinition): BoatContact | null {
    const hit = this.collision.blocked(at, at, boatShapes(def), boatJoints(at, at, def.spec), false, 0);
    if (!hit) return null;
    Object.assign(this.hit, hit); this.hit.propeller = hit.hazard; this.bank(at, def); return this.hit;
  }
  private bank(at: Readonly<BoatState>, def: BoatVehicleDefinition): void {
    const hit = this.hit; hit.geometryNx = hit.geometryNy = hit.geometryNz = undefined;
    if (hit.reason !== "terrain" || hit.ny <= 0 || hit.ny >= .8660254) return;
    // A bank steeper than thirty degrees is a wall to a hull. Its vertical response face rejects the boat
    // without converting forward thrust into a climbing force or using a submerged keel point as a launch lever.
    hit.geometryNx = hit.nx; hit.geometryNy = hit.ny; hit.geometryNz = hit.nz;
    const horizontal = len3(hit.nx, 0, hit.nz); hit.nx /= horizontal; hit.nz /= horizontal; hit.ny = 0;
    hit.depth = (hit.depth ?? 0) / horizontal;
    const { comX, comY, comZ } = vehicleMassProperties(def.spec, at);
    vehicleRotation(at, this.rotation); quatRotate(this.rotation, 0, comX, comY, comZ, this.center, 0);
    hit.y = at.y + this.center[1]!;
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
  const sn = detSin(yaw), cs = detCos(yaw), drives = boatDrives(p);
  // Include the extremities and outboard, not merely the centre; narrow ponds and the lake/sea seam cannot spawn boats.
  for (const at of [[0, 0, 0], ...p.buoyancyPoints.map(b => b.at), ...[...p.hullBoxes, ...drives.flatMap(d => d.outboard?.boxes ?? [])].flatMap(b => [-1, 1].flatMap(sx => [-1, 1].map(sz =>
    [b.at[0] + sx * b.half[0], b.at[1] - b.half[1], b.at[2] + sz * b.half[2]],
  ))), ...drives.map(d => d.propeller.at)]) {
    const px = x + cs * at[0]! + sn * at[2]!, pz = z - sn * at[0]! + cs * at[2]!;
    if (px < 0 || pz < 0 || px >= world.hf.sizeX || pz >= world.hf.sizeZ || Math.abs(w.waterAt(px, pz) - water) > .02 || w.groundAt(px, pz) > y - .35) return false;
  }
  const s = createBoat(p, x, y, z, yaw);
  return w.blocked(s, s, def) === null;
}

const q = new Float64Array(4);
const swept: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const otherSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
type BoatInteraction = BoatContact & ContactGeometry & { otherRotor: boolean; otherPropeller: boolean };
const obstacle = makeSolid(), contact: BoatInteraction = { reason: "vehicle", propeller: false, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0, depth: 0, otherRotor: false, otherPropeller: false };
function collisionFrame(frame: BoatFrame): BoatFrame & SolidFrame {
  vehicleRotation(frame, q);
  return { ...frame, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
}
function interaction(def: BoatVehicleDefinition, s: BoatFrame & SolidFrame, target: Solid, slack: number): BoatInteraction | null {
  contact.otherRotor = contact.otherPropeller = false;
  const mounts = boatMounts(s, def.spec);
  for (const part of boatShapes(def)) {
    const pose = part.joint === undefined ? s : mounts[part.joint]!;
    sweep(part, pose, pose, swept);
    if (!solidContact(swept.solid, target, contact, slack)) continue;
    contact.propeller = part.hazard; return contact;
  }
  return null;
}
export function boatMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, stw: number, def: BoatVehicleDefinition, at: BoatFrame, slack = 0): boolean {
  const s = collisionFrame(at), boxes = parts.box;
  frameOf(syaw, stw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, obstacle);
    if (interaction(def, s, obstacle, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, stw, sx, sy, sz, obstacle); if (interaction(def, s, obstacle, slack)) return true;
  }
  return false;
}
export function boatMeetsCapsule(def: BoatVehicleDefinition, frame: BoatFrame, x: number, y: number, z: number, radius: number, height: number): (BoatContact & ContactGeometry) | null {
  return interaction(def, collisionFrame(frame), tube([x, y, z], [x, y + Math.max(height, radius * 2), z], [1, 0, 0], [0, 0, 1], radius, radius, 12), 0);
}
export function boatMeetsVehicle(def: BoatVehicleDefinition, frame: BoatFrame, other: VehicleDefinition, otherFrame: BoatFrame): BoatInteraction | null {
  const s = collisionFrame(frame), target = collisionFrame(otherFrame);
  const shapes = other.movement === "boat" ? boatShapes(other) : other.movement === "rotor" ? helicopterShapes(other) : carShapes(other.spec);
  const mounts = other.movement === "boat" ? boatMounts(otherFrame, other.spec) : null;
  for (const part of shapes) {
    const pose = part.joint === undefined || !mounts ? target : mounts[part.joint]!; sweep(part, pose, pose, otherSweep);
    const hit = interaction(def, s, otherSweep.solid, 0);
    if (hit) { hit.otherRotor = other.movement === "rotor" && part.hazard; hit.otherPropeller = other.movement === "boat" && part.hazard; return hit; }
  }
  return null;
}
