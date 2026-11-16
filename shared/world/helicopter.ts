// Aircraft parts use the common native full-quaternion convex sweep.
import { detAtan2, detCos, detSin, len3 } from "../math/scalar.ts";
import { createHelicopter, type HelicopterContact, type HelicopterState, type HelicopterSupport, type HelicopterWorld } from "../sim/helicopter.ts";
import { vehicleRotation } from "../sim/vehicle-frame.ts";
import type { HelicopterSpec, RotorVehicleDefinition, VehicleDefinition } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, solidsCross, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import type { PartTable } from "./structures.ts";
import { StaticVehicleSolids, bounds, box, makeSolid, sweep, tube, type Shape, type Swept } from "./vehicle-solid.ts";
import { boatOutboardFrame, boatShapes, helicopterShapes as localShapes, type BoatFrame } from "./vehicle-shapes.ts";
const q = new Float64Array(4);
export class StaticHelicopterWorld implements HelicopterWorld {
  private readonly supportWorld: CollisionWorld;
  private readonly definitions = new WeakMap<RotorVehicleDefinition, Shape[]>();
  private readonly collision: StaticVehicleSolids;
  private readonly hit: HelicopterContact = { reason: "", rotor: false, nx: 0, ny: 1, nz: 0 };
  private readonly supportHit: HelicopterSupport = { y: 0, pitch: 0, roll: 0 };
  readonly world: CollisionWorld;
  constructor(world: CollisionWorld) { this.world = world; this.collision = new StaticVehicleSolids(world); this.supportWorld = { hf: world.hf, structs: world.structs }; }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }
  support(x: number, y: number, z: number, yaw: number, reach: number, p: HelicopterSpec): HelicopterSupport | null {
    const heights: number[] = [], sn = detSin(yaw), cs = detCos(yaw), hf = this.world.hf;
    for (const localZ of [-p.skidHalfLength, p.skidHalfLength]) for (const localX of [-p.skidHalfWidth, p.skidHalfWidth]) {
      const px = x + cs * localX + sn * localZ, pz = z - sn * localX + cs * localZ;
      if (px < 0 || pz < 0 || px >= hf.sizeX || pz >= hf.sizeZ) return null;
      if (castWorld(this.supportWorld, px, y, pz, 0, -1, 0, reach, true) === HIT_NONE || rayHit.ny < p.minGroundNormal) return null;
      heights.push(y - rayHit.t);
    }
    const pitch = detAtan2((heights[2]! + heights[3]! - heights[0]! - heights[1]!) / 2, p.skidHalfLength * 2);
    const roll = detAtan2((heights[1]! + heights[3]! - heights[0]! - heights[2]!) / 2, p.skidHalfWidth * 2);
    if (detCos(pitch) * detCos(roll) < p.minGroundNormal || Math.abs(heights[0]! + heights[3]! - heights[1]! - heights[2]!) > 0.12) return null;
    this.supportHit.y = (heights[0]! + heights[1]! + heights[2]! + heights[3]!) / 4;
    this.supportHit.pitch = pitch; this.supportHit.roll = roll; return this.supportHit;
  }
  blocked(from: Readonly<HelicopterState>, to: Readonly<HelicopterState>, def: RotorVehicleDefinition): HelicopterContact | null {
    let shapes = this.definitions.get(def);
    if (!shapes) { shapes = localShapes(def); this.definitions.set(def, shapes); }
    const contact = this.collision.blocked(from, to, shapes);
    if (!contact) return null;
    this.hit.reason = contact.reason; this.hit.rotor = contact.hazard;
    this.hit.nx = contact.nx; this.hit.ny = contact.ny; this.hit.nz = contact.nz; return this.hit;
  }
}
const adapters = new WeakMap<CollisionWorld, StaticHelicopterWorld>();
export function helicopterWorld(world: CollisionWorld): StaticHelicopterWorld {
  let adapter = adapters.get(world); if (!adapter) { adapter = new StaticHelicopterWorld(world); adapters.set(world, adapter); } return adapter;
}
/** Exact placement check used by map parking and item deployment. It never snaps an authored roof position to terrain. */
export function helicopterPlacement(world: CollisionWorld, x: number, y: number, z: number, yaw: number, def: RotorVehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  const adapter = helicopterWorld(world), p = def.spec;
  const support = adapter.support(x, y + 0.08, z, yaw, 0.16, p);
  if (!support || Math.abs(support.y - y) > 0.06 || y + p.clearance < adapter.waterAt(x, z)) return false;
  const state = createHelicopter(p, x, support.y, z, yaw);
  state.pitch = support.pitch; state.roll = support.roll;
  vehicleRotation({ x, y, z, yaw, pitch: support.pitch, roll: support.roll }, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return adapter.blocked(state, state, def) === null;
}


export interface HelicopterFrame {
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number;
  readonly pitch: number; readonly roll: number;
  readonly qx?: number; readonly qy?: number; readonly qz?: number; readonly qw?: number;
}
const interactionShapes = new WeakMap<RotorVehicleDefinition, Shape[]>();
const interactionSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const interactionSolid = makeSolid();
const interactionHit = { rotor: false, nx: 0, ny: 0, nz: 0 };
function frameState(def: RotorVehicleDefinition, frame: HelicopterFrame): HelicopterState {
  const state = createHelicopter(def.spec, frame.x, frame.y, frame.z, frame.yaw);
  state.pitch = frame.pitch; state.roll = frame.roll;
  vehicleRotation({ ...frame }, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return state;
}
function interaction(def: RotorVehicleDefinition, state: HelicopterState, obstacle: Solid, slack: number): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  let shapes = interactionShapes.get(def); if (!shapes) { shapes = localShapes(def); interactionShapes.set(def, shapes); }
  for (const part of shapes) {
    sweep(part, state, state, interactionSweep);
    if (!solidsCross(interactionSweep.solid, slack, slack, obstacle, 0, 0, 0)) continue;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < obstacle.corners * 3; i += 3) { x += obstacle.at[i]!; y += obstacle.at[i + 1]!; z += obstacle.at[i + 2]!; }
    // Contact normal points from the other body toward the aircraft, as the static collision adapter does.
    x = state.x - x / obstacle.corners; y = state.y + def.spec.height / 2 - y / obstacle.corners; z = state.z - z / obstacle.corners;
    const length = len3(x, y, z) || 1;
    interactionHit.rotor = part.hazard; interactionHit.nx = x / length; interactionHit.ny = y / length; interactionHit.nz = z / length; return interactionHit;
  }
  return null;
}
/** Full oriented vehicle envelope against a would-be structure, so building cannot intersect a tilted rotor or tail. */
export function helicopterMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, def: RotorVehicleDefinition, frameAt: HelicopterFrame, slack = 0): boolean {
  const state = frameState(def, frameAt), boxes = parts.box;
  frameOf(syaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, sx, sy, sz, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  return false;
}
/** Conservative circumscribed capsule cylinder. Server sweeps this query between authoritative frames; no particle decides a hit. */
export function helicopterMeetsCapsule(def: RotorVehicleDefinition, frame: HelicopterFrame, x: number, y: number, z: number, radius: number, height: number): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  const capsule = tube([x, y, z], [x, y + Math.max(height, radius * 2), z], [1, 0, 0], [0, 0, 1], radius, radius, 12);
  return interaction(def, frameState(def, frame), capsule, 0);
}

const otherSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
/** The same shapes against another vehicle. Callers sweep relative motion and own authority, impulses and damage. */
export function helicopterMeetsVehicle(def: RotorVehicleDefinition, frame: HelicopterFrame, other: VehicleDefinition, otherFrame: BoatFrame): {rotor:boolean;nx:number;ny:number;nz:number}|null {
  const source = frameState(def, frame), target = frameState(def, otherFrame);
  let parts: readonly Shape[];
  if (other.movement === "rotor") {
    const rotorParts = interactionShapes.get(other) ?? localShapes(other); interactionShapes.set(other, rotorParts); parts = rotorParts;
  } else if (other.movement === "boat") parts = boatShapes(other);
  else {
    const p = other.spec;
    parts = [box([0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength])];
  }
  const mount = other.movement === "boat" ? boatOutboardFrame(otherFrame, other.spec) : target;
  for (const part of parts) {
    const pose = part.joint === undefined ? target : mount;
    sweep(part, pose, pose, otherSweep);
    const hit = interaction(def, source, otherSweep.solid, 0);
    if (hit) return hit;
  }
  return null;
}
