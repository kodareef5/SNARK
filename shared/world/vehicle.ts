// Adapter to existing terrain, placed structures and resource-node spatial indexes.
import { quatRotate } from "../math/quat.ts";
import { vehicleMassProperties } from "../sim/vehicle-rigid.ts";
import { detCos, detSin } from "../math/scalar.ts";
import type { VehicleContact, VehicleDefinition, VehicleHullSpec, VehicleSpec, VehicleState, VehicleSurface, VehicleWorld, WheelRayContact } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import { type PartTable } from "./structures.ts";
import { capsuleKind } from "./collide.ts";
import { vehicleSurfaceAt } from "./vehicle-surface.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import { boatOutboardFrame, boatShapes, carShapes, helicopterShapes } from "./vehicle-shapes.ts";
import { StaticVehicleSolids, bounds, makeSolid, solidContact, sweep, tube, type ContactGeometry, type SolidFrame, type Swept } from "./vehicle-solid.ts";
import { boxSolid, partSolid, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";

export type VehicleSurfaceAt = (hit: number, ref: number, x: number, z: number) => VehicleSurface;

/**
 * Whether a structure of `kind` set at (sx, sy, sz) turned `syaw` would meet a vehicle's hull at (x, y, z) turned `yaw`
 * radians: the hull as upright capsules of its half width along its length, and small ones in its corners, so a piece
 * through its nose or boot is met as one through its middle.
 */
export function vehicleMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, spec: VehicleHullSpec, x: number, y: number, z: number, yaw: number, slack: number): boolean {
  const sn = detSin(yaw), cs = detCos(yaw), w = spec.halfWidth, l = spec.halfLength, corner = Math.min(0.3, w / 2);
  const along = Math.max(0, l - w), steps = Math.ceil(along / (w / 2));
  // A point on the hull's long axis or in a corner, in the world: +X the left (cos, -sin), +Z forward (sin, cos).
  const at = (lx: number, lz: number, r: number): boolean => capsuleKind(parts, kind, sx, sy, sz, syaw, x + cs * lx + sn * lz, y, z - sn * lx + cs * lz, r, spec.height, slack);
  for (let i = -steps; i <= steps; i++) if (at(0, steps === 0 ? 0 : (along * i) / steps, w)) return true;
  for (const lx of [w - corner, corner - w]) for (const lz of [l - corner, corner - l]) if (at(lx, lz, corner)) return true;
  return false;
}
const contactQ = new Float64Array(4), targetSolid = makeSolid();
const contactFrame = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const otherContactFrame = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
// Upright actor polygons share directions. Only their vertex positions change with radius, height and position.
const capsuleModel = tube([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], 1, 1, 12), capsuleSolid = makeSolid();
capsuleSolid.corners = capsuleModel.corners; capsuleSolid.faces = capsuleModel.faces; capsuleSolid.edges = capsuleModel.edges;
capsuleSolid.face.set(capsuleModel.face); capsuleSolid.edge.set(capsuleModel.edge);
const carSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const targetSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
export interface CarContact extends ContactGeometry { otherRotor: boolean; otherPropeller: boolean }
const carHit: CarContact = { nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0, depth: 0, otherRotor: false, otherPropeller: false };
function solidFrame(at: VehicleFrame, out: typeof contactFrame): void {
  vehicleRotation(at, contactQ);
  out.x = at.x; out.y = at.y; out.z = at.z;
  out.qx = contactQ[0]!; out.qy = contactQ[1]!; out.qz = contactQ[2]!; out.qw = contactQ[3]!;
}
function carContact(p: VehicleSpec, at: VehicleFrame, target: Solid, slack = 0): CarContact | null {
  carHit.otherRotor = carHit.otherPropeller = false;
  solidFrame(at, contactFrame); sweep(carShapes(p)[0]!, contactFrame, contactFrame, carSweep);
  return solidContact(carSweep.solid, target, carHit, slack) ? carHit : null;
}
/** Full-attitude chamfered chassis; scratch normal points from the target toward the car, point is world x/y/z. */
export function carMeetsCapsule(p: VehicleSpec, at: VehicleFrame, x: number, y: number, z: number, radius: number, height: number): ContactGeometry | null {
  const h = Math.max(height, radius * 2);
  for (let i = 0; i < capsuleModel.corners * 3; i += 3) {
    capsuleSolid.at[i] = x + capsuleModel.at[i]! * radius;
    capsuleSolid.at[i + 1] = y + capsuleModel.at[i + 1]! * h;
    capsuleSolid.at[i + 2] = z + capsuleModel.at[i + 2]! * radius;
  }
  return carContact(p, at, capsuleSolid);
}
/** Scratch result includes the struck target part; callers copy it before issuing another interaction query. */
export function carMeetsVehicle(p: VehicleSpec, at: VehicleFrame, other: VehicleDefinition, otherFrame: VehicleFrame): CarContact | null {
  solidFrame(otherFrame, otherContactFrame);
  const target = otherContactFrame, parts = other.movement === "boat" ? boatShapes(other) : other.movement === "rotor" ? helicopterShapes(other) : carShapes(other.spec);
  const mount = other.movement === "boat" ? boatOutboardFrame(otherFrame, other.spec) : target;
  for (const part of parts) {
    const pose = part.joint === undefined ? target : mount; sweep(part, pose, pose, targetSweep);
    const hit = carContact(p, at, targetSweep.solid);
    if (hit) { hit.otherRotor = other.movement === "rotor" && part.hazard; hit.otherPropeller = other.movement === "boat" && part.hazard; return hit; }
  }
  return null;
}
export function carMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, p: VehicleSpec, at: VehicleFrame, slack = 0): boolean {
  frameOf(syaw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch, boxes = parts.box;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, targetSolid);
    if (carContact(p, at, targetSolid, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, sx, sy, sz, targetSolid); if (carContact(p, at, targetSolid, slack)) return true;
  }
  return false;
}
export class StaticVehicleWorld implements VehicleWorld {
  readonly world: CollisionWorld;
  readonly surfaceAt: VehicleSurfaceAt;
  private readonly solids: StaticVehicleSolids;
  private readonly q = new Float64Array(4);
  private readonly center = new Float64Array(3);
  private readonly supportWorld: CollisionWorld;

  constructor(world: CollisionWorld, surfaceAt: VehicleSurfaceAt = (hit, ref) => vehicleSurfaceAt(world, hit, ref)) {
    this.world = world;
    this.solids = new StaticVehicleSolids(world);
    this.surfaceAt = surfaceAt;
    // Resource nodes obstruct the chassis but are not road support. Soft vegetation never becomes an elevated road.
    this.supportWorld = { hf: world.hf, structs: world.structs };
  }

  wheelRay(x: number, y: number, z: number, dx: number, dy: number, dz: number, reach: number, _p: VehicleSpec): WheelRayContact | null {
    const hf = this.world.hf;
    if (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return null;
    const kind = castWorld(this.supportWorld, x, y, z, dx, dy, dz, reach, true);
    return kind === HIT_NONE ? null : { distance: rayHit.t, nx: rayHit.nx, ny: rayHit.ny, nz: rayHit.nz,
      surface: this.surfaceAt(kind, rayHit.ref, x + dx * rayHit.t, z + dz * rayHit.t) };
  }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }

  blocked(from: Readonly<VehicleState>, to: Readonly<VehicleState>, p: VehicleSpec): string | null {
    return this.contact(from, to, p)?.reason ?? null;
  }

  contact(from: Readonly<VehicleState>, to: Readonly<VehicleState>, p: VehicleSpec): VehicleContact | null {
    const a = this.frame(from), b = this.frame(to), { comX, comY, comZ } = vehicleMassProperties(p, to);
    quatRotate(this.q, 0, comX, comY, comZ, this.center, 0);
    this.center[0] += to.x; this.center[1] += to.y; this.center[2] += to.z;
    const rest = 1 - 2 * (b.qx * b.qx + b.qz * b.qz) < .5 && Math.abs(2 * (b.qy * b.qz - b.qw * b.qx)) < .65 && to.vx * to.vx + to.vy * to.vy + to.vz * to.vz < 4;
    return this.solids.blocked(a, b, carShapes(p), undefined, true, .008, rest ? this.center : undefined, rest);
  }
  penetration(at: Readonly<VehicleState>, p: VehicleSpec): VehicleContact | null {
    const pose = this.frame(at); return this.solids.blocked(pose, pose, carShapes(p), undefined, false, 0);
  }

  private frame(s: Readonly<VehicleState>): SolidFrame {
    vehicleRotation(s, this.q);
    return { x: s.x, y: s.y, z: s.z, qx: this.q[0]!, qy: this.q[1]!, qz: this.q[2]!, qw: this.q[3]! };
  }
}
