// One seated pose for drawing, eyes and hit zones. Callers supply the clock and the carrier frame explicitly.
import { detAtan2, detCos, detSin } from "../math/scalar.ts";
import { quatAxis, quatMul, quatRotate, quatUnrotate } from "../math/quat.ts";
import { vehiclePoint, vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import type { VehicleDefinition } from "../sim/vehicle.ts";
import type { Seat } from "../sim/seats.ts";
import type { PackMesh, PackRig } from "../pack/pack.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../world/ray.ts";
import { Pose } from "./clip.ts";
import { B_HEAD, B_NECK, B_SPINE, HUMAN, HUMAN_BONES, SOCKET_EYE } from "./human.ts";
import { createMountMotion, mountOrigin, mountPose, type MountMotionProfile } from "./mount.ts";
import { AnimState, humanPose, PITCH_STEPS, type HumanAnim } from "./pose.ts";
import { fitRiderControls } from "./rider-controls.ts";
import { fitSeatControls } from "./seat-controls.ts";
import { SEAT_DROP, SEAT_FLOATS } from "./seat.ts";
import { boneToModel, rayZones, Solved, solve } from "./skeleton.ts";

/** Vehicle x/y/z are the world pelvis target, not the chassis origin. */
export interface OccupantSeat extends VehicleFrame {
  driver: boolean;
  steer: number;
  steering: number;
  role?: Seat["pose"];
  definition?: Seat;
  aimYaw?: number;
}

const motion = createMountMotion(), state = new AnimState();
const rotation = new Float64Array(4), turn = new Float64Array(4), direction = new Float64Array(3);

export function createOccupantSeat(): OccupantSeat {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, driver: false, steer: 0, steering: 0 };
}

/** Bind a definition's pelvis target to this carrier pose, independent of whether its art is loaded. */
export function occupantSeat(def: VehicleDefinition, seat: Seat, carrier: VehicleFrame, aimYaw: number | undefined, out: OccupantSeat): void {
  vehiclePoint(carrier, seat.anchor, direction);
  out.x = direction[0]!; out.y = direction[1]!; out.z = direction[2]!;
  out.yaw = carrier.yaw; out.pitch = carrier.pitch; out.roll = carrier.roll;
  out.qx = carrier.qx; out.qy = carrier.qy; out.qz = carrier.qz; out.qw = carrier.qw;
  out.steering = carrier.steering ?? 0;
  out.steer = def.movement === "rotor" ? 0 : out.steering / def.spec.maxSteer;
  out.driver = seat.driver === true; out.role = seat.pose; out.definition = seat; out.aimYaw = aimYaw;
}

/** Riders may clip a roof, but cannot begin a shot beyond it. Entity hulls are handled by the cast's self/seat rules. */
export function clipSeatEye(world: CollisionWorld, anchor: Float64Array, eye: Float64Array): void {
  const dx = eye[0]! - anchor[0]!, dy = eye[1]! - anchor[1]!, dz = eye[2]! - anchor[2]!, length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6 || castWorld(world, anchor[0]!, anchor[1]!, anchor[2]!, dx / length, dy / length, dz / length, length) === HIT_NONE) return;
  const share = Math.max(0, rayHit.t - .01) / length;
  eye[0] = anchor[0]! + dx * share; eye[1] = anchor[1]! + dy * share; eye[2] = anchor[2]! + dz * share;
}

/** Preserves weapon/action pose on open passenger seats; world gaze is turned into the whole seat frame first. */
export function occupantPose(anim: HumanAnim, st: AnimState, tick: number, out: Pose, vehicle: OccupantSeat | undefined,
  saddle: Float64Array | null, offset: number, yaw: number, driver: boolean, profile: MountMotionProfile = motion): void {
  const role = vehicle?.role ?? (vehicle ? vehicle.driver ? "drive" : "passenger" : "ride");
  // Cabins and a personal watercraft's saddle hold the torso still; only the neck and head follow a look.
  const fixedTorso = role === "pilot" || role === "cabin" || role === "pwc", steers = vehicle?.driver ?? driver;
  const aim = vehicle ? vehicle.aimYaw : yaw, looks = !steers || role === "pilot" || !!vehicle?.definition?.controls;
  state.unpack(st.pack(), st.packCue()); state.seed = st.seed;
  let localYaw = 0, localPitch = 0;
  if (looks && aim !== undefined) {
    const pitch = st.pitch / PITCH_STEPS * Math.PI / 2, cp = detCos(pitch);
    const x = detSin(aim) * cp, y = detSin(pitch), z = detCos(aim) * cp;
    if (vehicle) {
      vehicleRotation(vehicle, rotation);
      quatUnrotate(rotation, 0, x, y, z, direction, 0);
    } else if (saddle) {
      const f = saddle, a = offset;
      direction[0] = f[a]! * x + f[a + 3]! * y + f[a + 6]! * z;
      direction[1] = f[a + 1]! * x + f[a + 4]! * y + f[a + 7]! * z;
      direction[2] = f[a + 2]! * x + f[a + 5]! * y + f[a + 8]! * z;
    }
    localYaw = detAtan2(direction[0]!, direction[2]!);
    localPitch = detAtan2(direction[1]!, Math.sqrt(direction[0]! * direction[0]! + direction[2]! * direction[2]!));
    state.pitch = localPitch / (Math.PI / 2) * PITCH_STEPS;
  }
  humanPose(anim, state, tick, out);
  mountPose(profile, { role, tick: vehicle ? tick : 0, startTick: 0, durationTicks: 1,
    steering: vehicle?.steer, upper: !fixedTorso && !steers ? out : undefined }, out);
  if (looks && aim !== undefined) {
    if (fixedTorso) {
      const tilt = Math.max(-.75, Math.min(.75, localPitch));
      quatAxis(turn, 0, 1, 0, 0, -tilt * .35); quatMul(out.rot, B_NECK * 4, turn, 0, out.rot, B_NECK * 4);
      quatAxis(turn, 0, 1, 0, 0, -tilt * .65); quatMul(out.rot, B_HEAD * 4, turn, 0, out.rot, B_HEAD * 4);
    }
    const joint = fixedTorso ? B_HEAD : B_SPINE, limit = fixedTorso ? .8 : 1.2;
    quatAxis(turn, 0, 0, 1, 0, Math.max(-limit, Math.min(limit, localYaw)));
    quatMul(out.rot, joint * 4, turn, 0, out.rot, joint * 4);
  }
}

/** A reusable posed body. Capsules retain HUMAN's radii; their centres follow the actual seated binding. */
export class OccupantBody {
  readonly pose = new Pose(HUMAN_BONES);
  readonly solved = new Solved(HUMAN_BONES);
  readonly frame = new Float64Array(SEAT_FLOATS);
  readonly anchor = new Float64Array(3);
  private readonly rotation = new Float64Array(4);
  private readonly point = new Float64Array(3);
  private readonly origin = new Float64Array(3);
  private readonly rests = new Map<string, Float32Array>();

  constructor(rigs: readonly PackRig[] = [], meshes: readonly PackMesh[] = []) {
    for (const rig of rigs) if (rig.rest.length === HUMAN_BONES * 3) this.rests.set(rig.id, Float32Array.from(rig.rest));
    // Authored parts may explicitly bind to a rig whose id differs from the body's conventional name.
    for (const mesh of meshes) {
      if (mesh.skeleton !== HUMAN.id || mesh.rig === undefined || !mesh.id.endsWith("/head")) continue;
      const rest = this.rests.get(rigs[mesh.rig]?.id ?? "");
      if (rest) this.rests.set(mesh.id.slice(0, -5).replace(/^[^:]*:/, ""), rest);
    }
  }

  rest(mesh: string): Float32Array {
    return this.rests.get(mesh.replace(/^[^:]*:/, "") + "_m") ?? HUMAN.rest;
  }

  vehicle(anim: HumanAnim, st: AnimState, tick: number, seat: OccupantSeat, rest: Float32Array): void {
    occupantPose(anim, st, tick, this.pose, seat, null, 0, seat.aimYaw ?? seat.yaw, seat.driver);
    solve(HUMAN, this.pose, this.solved, rest);
    if (seat.definition) fitSeatControls(this.pose, this.solved, rest, null, seat.definition, seat.steering ?? 0);
    vehicleRotation(seat, this.rotation);
    this.anchor[0] = seat.x; this.anchor[1] = seat.y; this.anchor[2] = seat.z;
    mountOrigin(this.solved, this.anchor, this.rotation, this.origin);
    this.frame.set(this.origin);
    for (let col = 0; col < 3; col++) {
      quatRotate(this.rotation, 0, col === 0 ? 1 : 0, col === 1 ? 1 : 0, col === 2 ? 1 : 0, this.point, 0);
      for (let row = 0; row < 3; row++) this.frame[3 + row * 3 + col] = this.point[row]!;
    }
  }

  /** `targets` are riderTargets' saddle contacts, with `soles` and `grips` the rider's own corrections, or null. */
  saddle(anim: HumanAnim, st: AnimState, tick: number, frame: Float64Array, driver: boolean, yaw: number, rest: Float32Array,
    targets: Float64Array | null = null, soles: Float64Array | null = null, grips: Float64Array | null = null): void {
    this.frame.set(frame);
    occupantPose(anim, st, tick, this.pose, undefined, frame, 3, yaw, driver);
    solve(HUMAN, this.pose, this.solved, rest);
    if (targets && targets[0]) fitRiderControls(this.pose, this.solved, rest, null, targets, driver, undefined, soles, grips);
    for (let axis = 0; axis < 3; axis++) this.anchor[axis] = frame[axis]! + frame[4 + axis * 3]! * SEAT_DROP;
  }

  eye(out: Float64Array): void {
    boneToModel(this.solved, SOCKET_EYE.bone, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, this.point);
    for (let axis = 0; axis < 3; axis++) {
      const row = 3 + axis * 3;
      out[axis] = this.frame[axis]! + this.frame[row]! * this.point[0]! + this.frame[row + 1]! * this.point[1]! + this.frame[row + 2]! * this.point[2]!;
    }
  }

  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, padding = 0): number {
    const f = this.frame, x = ox - f[0]!, y = oy - f[1]!, z = oz - f[2]!;
    return rayZones(HUMAN, this.solved, f[3]! * x + f[6]! * y + f[9]! * z, f[4]! * x + f[7]! * y + f[10]! * z, f[5]! * x + f[8]! * y + f[11]! * z,
      f[3]! * dx + f[6]! * dy + f[9]! * dz, f[4]! * dx + f[7]! * dy + f[10]! * dz, f[5]! * dx + f[8]! * dy + f[11]! * dz, maxT, padding);
  }
}
