// A jet against terrain, structures and resource nodes: its wheels on the ground, and its swept parts against the rest.
// The same parts meet a survivor, another vehicle and a structure being placed.
import { detAtan2, detCos, detSin } from "../math/scalar.ts";
import { createJet, type JetContact, type JetState, type JetSupport, type JetWorld } from "../sim/jet.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import type { JetSpec, JetVehicleDefinition, VehicleDefinition } from "../sim/vehicle.ts";
import type { CollisionWorld } from "./collide.ts";
import { boxSolid, partSolid, type Solid } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import { castWorld, HIT_NONE, rayHit } from "./ray.ts";
import type { PartTable } from "./structures.ts";
import { meetOther } from "./vehicle-meet.ts";
import { bounds, makeSolid, solidContact, StaticVehicleSolids, sweep, tube, type ContactGeometry, type Swept } from "./vehicle-solid.ts";
import { jetShapes } from "./vehicle-shapes.ts";

const q = new Float64Array(4);
export class StaticJetWorld implements JetWorld {
  private readonly supportWorld: CollisionWorld;
  private readonly collision: StaticVehicleSolids;
  private readonly hit: JetContact = { reason: "", nx: 0, ny: 1, nz: 0 };
  private readonly supportHit: JetSupport = { y: 0, pitch: 0, roll: 0 };
  private readonly heights = new Float64Array(3);
  readonly world: CollisionWorld;
  constructor(world: CollisionWorld) { this.world = world; this.collision = new StaticVehicleSolids(world); this.supportWorld = { hf: world.hf, structs: world.structs }; }
  waterAt(x: number, z: number): number { return this.world.hf.waterAt(x, z); }
  /** The nose wheel and the two main wheels each find ground within `reach`; the plane through them is the support. */
  support(x: number, y: number, z: number, yaw: number, reach: number, p: JetSpec): JetSupport | null {
    const sn = detSin(yaw), cs = detCos(yaw), hf = this.world.hf, heights = this.heights;
    for (let wheel = 0; wheel < 3; wheel++) {
      const localX = wheel === 0 ? 0 : wheel === 1 ? p.gearTrack : -p.gearTrack, localZ = wheel === 0 ? p.noseGear : p.mainGear;
      const px = x + cs * localX + sn * localZ, pz = z - sn * localX + cs * localZ;
      if (px < 0 || pz < 0 || px >= hf.sizeX || pz >= hf.sizeZ) return null;
      if (castWorld(this.supportWorld, px, y, pz, 0, -1, 0, reach, true) === HIT_NONE || rayHit.ny < p.minGroundNormal) return null;
      heights[wheel] = y - rayHit.t;
    }
    const main = (heights[1]! + heights[2]!) / 2, base = p.noseGear - p.mainGear;
    const pitch = detAtan2(heights[0]! - main, base);
    const roll = detAtan2(heights[1]! - heights[2]!, p.gearTrack * 2);
    if (detCos(pitch) * detCos(roll) < p.minGroundNormal) return null;
    // The ground under the origin, on the plane through the three wheels.
    this.supportHit.y = main + (heights[0]! - main) * (-p.mainGear / base);
    this.supportHit.pitch = pitch; this.supportHit.roll = roll; return this.supportHit;
  }
  blocked(from: Readonly<JetState>, to: Readonly<JetState>, def: JetVehicleDefinition): JetContact | null {
    const contact = this.collision.blocked(from, to, jetShapes(def));
    if (!contact) return null;
    this.hit.reason = contact.reason;
    this.hit.nx = contact.nx; this.hit.ny = contact.ny; this.hit.nz = contact.nz; return this.hit;
  }
}
const adapters = new WeakMap<CollisionWorld, StaticJetWorld>();
export function jetWorld(world: CollisionWorld): StaticJetWorld {
  let adapter = adapters.get(world); if (!adapter) { adapter = new StaticJetWorld(world); adapters.set(world, adapter); } return adapter;
}
/** Exact placement check used by map parking and the admin's summon: the wheels on ground, and no part in anything. */
export function jetPlacement(world: CollisionWorld, x: number, y: number, z: number, yaw: number, def: JetVehicleDefinition): boolean {
  if (![x, y, z, yaw].every(Number.isFinite)) return false;
  const adapter = jetWorld(world), p = def.spec;
  const support = adapter.support(x, y + .08, z, yaw, .16, p);
  if (!support || Math.abs(support.y - y) > .06 || y + p.clearance < adapter.waterAt(x, z)) return false;
  const state = createJet(p, x, support.y, z, yaw);
  vehicleRotation({ x, y, z, yaw, pitch: support.pitch, roll: support.roll }, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return adapter.blocked(state, state, def) === null;
}
/** The height a jet stands at with its wheels on the ground under (x, z), searching `reach` below `top`, or NaN. */
export function jetRestY(world: CollisionWorld, x: number, z: number, yaw: number, top: number, reach: number, def: JetVehicleDefinition): number {
  return jetWorld(world).support(x, top, z, yaw, reach, def.spec)?.y ?? NaN;
}

interface JetInteraction extends ContactGeometry { otherRotor: boolean; otherPropeller: boolean }
const interactionSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const otherSweep: Swept = { solid: makeSolid(), hazard: false, radius: 0, pad: 0, bounds: bounds() };
const interactionSolid = makeSolid();
const interactionHit: JetInteraction = { nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0, depth: 0, otherRotor: false, otherPropeller: false };
/** Two poses a query may hold at once: a jet's own, and what it meets. */
const poses = [poseState(), poseState()] as const;
function poseState(): JetState {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, grounded: true, yawRate: 0, pitchRate: 0, rollRate: 0,
    groundPitch: 0, groundRoll: 0, rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel: 0, gear: 1, engineRpm: 0, shiftTime: 0, payloadMass: 0,
    engineCondition: 1, engineOn: false, throttle: 0, spool: 0, nozzle: 0 };
}
/** A frame's pose as a state the shapes are swept by, in scratch pose `slot`: nothing is made or checked for a query. */
function frameState(at: VehicleFrame, slot: 0 | 1 = 0): JetState {
  const state = poses[slot];
  state.x = at.x; state.y = at.y; state.z = at.z;
  state.yaw = at.yaw; state.pitch = at.pitch; state.roll = at.roll;
  vehicleRotation(at, q);
  state.qx = q[0]!; state.qy = q[1]!; state.qz = q[2]!; state.qw = q[3]!;
  return state;
}
function interaction(def: JetVehicleDefinition, state: JetState, obstacle: Solid, slack: number): JetInteraction | null {
  interactionHit.otherRotor = interactionHit.otherPropeller = false;
  for (const part of jetShapes(def)) {
    sweep(part, state, state, interactionSweep);
    if (solidContact(interactionSweep.solid, obstacle, interactionHit, slack)) return interactionHit;
  }
  return null;
}
/** The jet at `at` against an upright capsule standing at (x, y, z): its exact parts, so a survivor may stand under a wing. */
export function jetMeetsCapsule(def: JetVehicleDefinition, at: VehicleFrame, x: number, y: number, z: number, radius: number, height: number): ContactGeometry | null {
  const capsule = tube([x, y, z], [x, y + Math.max(height, radius * 2), z], [1, 0, 0], [0, 0, 1], radius, radius, 12);
  return interaction(def, frameState(at), capsule, 0);
}
/** The same parts against another vehicle's. The answer is scratch: copy it before the next query. */
export function jetMeetsVehicle(def: JetVehicleDefinition, at: VehicleFrame, other: VehicleDefinition, otherFrame: VehicleFrame): JetInteraction | null {
  const source = frameState(at), target = frameState(otherFrame, 1);
  return meetOther(other, otherFrame, target, otherSweep, (solid) => interaction(def, source, solid, 0));
}
/** The jet at `at` against a would-be structure of `kind`, so nothing is built through a wing or a fin. */
export function jetMeetsKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, stw: number, def: JetVehicleDefinition, at: VehicleFrame, slack = 0): boolean {
  const state = frameState(at), boxes = parts.box;
  frameOf(syaw, stw); const cs = frame.cos, sn = frame.sin, stretch = frame.stretch;
  for (let i = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; i < end; i += 6) {
    boxSolid(sx + (cs * boxes[i]! + sn * boxes[i + 2]!) * stretch, sy + boxes[i + 1]!, sz + (cs * boxes[i + 2]! - sn * boxes[i]!) * stretch,
      cs, sn, boxes[i + 3]! * stretch, boxes[i + 4]!, boxes[i + 5]! * stretch, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  if (parts.hulls) for (let i = parts.hulls.start[kind]!, end = parts.hulls.start[kind + 1]!; i < end; i++) {
    partSolid(parts.hulls, i, syaw, stw, sx, sy, sz, interactionSolid);
    if (interaction(def, state, interactionSolid, slack)) return true;
  }
  return false;
}
