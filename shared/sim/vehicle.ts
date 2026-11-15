// Grounded wheel controller. Both authority and prediction can call this fixed-tick solver.
// Occupancy grants control; this module does not grant ownership or spend inventory items.
import { TICK_DT } from "../coords.ts";
import { clamp, detAtan2, detCos, detSin, TAU } from "../math/scalar.ts";
import { DEFAULT_DRIVETRAIN, stepDrivetrain, validateDrivetrainSpec, vehicleMass, type VehicleDrivetrainSpec, type VehicleDrivetrainState } from "./vehicle-drivetrain.ts";

export interface VehicleSpec {
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
  readonly clearance: number;
  readonly wheelbase: number;
  readonly track: number;
  readonly wheelRadius: number;
  /** Legacy nominal acceleration, used only by definitions without a drivetrain component. */
  readonly acceleration: number;
  /** Curb mass in kilograms. Cargo and occupants live in VehicleState.payloadMass. */
  readonly mass?: number;
  readonly drivetrain?: VehicleDrivetrainSpec;
  readonly brake: number;
  readonly maxForward: number;
  readonly maxReverse: number;
  readonly maxSteer: number;
  readonly steerRate: number;
  readonly maxRise: number;
  readonly maxDrop: number;
  readonly minGroundNormal: number;
  readonly fuelCapacity: number;
  readonly fuelPerSecond: number;
  /** Tire and chassis tuning; omitted values use the deterministic arcade defaults. */
  readonly frontGrip?: number;
  readonly rearGrip?: number;
  readonly corneringStiffness?: number;
  readonly yawInertia?: number;
  readonly yawDamping?: number;
  readonly steerSpeed?: number;
  readonly handbrakeGrip?: number;
  readonly suspensionFrequency?: number;
  readonly suspensionDamping?: number;
  readonly suspensionTravel?: number;
  readonly pitchResponse?: number;
  readonly rollResponse?: number;
  readonly gravity?: number;
  readonly airDrag?: number;
  /** Multiplier on the surface speed-squared resistance (body/tire drag). */
  readonly dragScale?: number;
}

/** Points are in the chassis frame: metres, +X the driver's left, +Y up, +Z forward, the origin on the ground. */
export interface VehicleSeat {
  /** Saved and sent by name: `driver`, `passenger`, `rear_left`... */
  readonly id: string;
  /** The one seat whose occupant drives. */
  readonly driver?: boolean;
  /** Where the occupant's pelvis sits: the server pins it there and every client draws it there. */
  readonly anchor: readonly [number, number, number];
  /** Where a body stands to take or leave the seat. Its side (the sign of x) is the side it gets out on. */
  readonly entry: readonly [number, number, number];
  /** The door (an index into `doors`) that opens while someone takes or leaves this seat, or none. */
  readonly door?: number;
}

/** A hinged part of the rig. `open` is radians about `axis` (in the bone's frame) when it is fully open. */
export interface VehicleDoor {
  readonly bone: string;
  readonly axis: readonly [number, number, number];
  readonly open: number;
  /** Ticks it takes to swing fully open, and to swing shut. */
  readonly openTicks: number;
  readonly closeTicks: number;
}

/** A wheel bone rolls about the chassis X axis with the wheel angle; one that steers turns about Y first. */
export interface VehicleWheel {
  readonly bone: string;
  readonly steers?: boolean;
}

/** At most this many doors a vehicle: their open fractions travel in four bits each (shared/sim/vehicle-body.ts). */
export const MAX_VEHICLE_DOORS = 4;
/** At most this many seats a vehicle (server/occupancy.ts holds the same). */
export const MAX_VEHICLE_SEATS = 16;

/** One kind of vehicle: its mechanics, its seats and the parts of its rig that move. Content, never code, says each. */
export interface VehicleDefinition {
  readonly id: string;
  readonly spec: VehicleSpec;
  readonly seats: readonly VehicleSeat[];
  readonly doors: readonly VehicleDoor[];
  readonly wheels: readonly VehicleWheel[];
  /** The bone the driver's hands turn, about `axis`, `ratio` times the road wheels' steering angle. */
  readonly steeringWheel?: { readonly bone: string; readonly axis: readonly [number, number, number]; readonly ratio: number };
  /** Ticks a door action takes: getting in, getting out, pulling a driver out. */
  readonly actionTicks: number;
}

/** Content checks beyond the spec's, so a definition that compiles always registers and draws. Throws on the first fault. */
export function validateVehicleDefinition(d: VehicleDefinition): void {
  validateVehicleSpec(d.spec);
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const bone = (n: unknown): boolean => typeof n === "string" && n.length > 0 && n.length <= 64;
  if (!Array.isArray(d.seats) || d.seats.length < 1 || d.seats.length > MAX_VEHICLE_SEATS) throw new Error("a vehicle has 1 to 16 seats");
  if (!Array.isArray(d.doors) || d.doors.length > MAX_VEHICLE_DOORS) throw new Error("a vehicle has at most 4 doors");
  if (!Array.isArray(d.wheels) || d.wheels.length > 16 || !d.wheels.every((w) => bone(w.bone))) throw new Error("invalid vehicle wheels");
  for (const door of d.doors) {
    if (!bone(door.bone) || !vec(door.axis) || !Number.isFinite(door.open) || Math.abs(door.open) > Math.PI ||
      !Number.isInteger(door.openTicks) || door.openTicks < 1 || door.openTicks > 255 ||
      !Number.isInteger(door.closeTicks) || door.closeTicks < 1 || door.closeTicks > 255) throw new Error("invalid vehicle door");
  }
  const s = d.steeringWheel;
  if (s !== undefined && (!bone(s.bone) || !vec(s.axis) || !Number.isFinite(s.ratio) || Math.abs(s.ratio) > 50)) throw new Error("invalid steering wheel");
  if (!Number.isInteger(d.actionTicks) || d.actionTicks < 1 || d.actionTicks > 300) throw new Error("invalid vehicle action ticks");
  const names = new Set<string>();
  let drivers = 0;
  for (const seat of d.seats) {
    // The same names server/occupancy.ts accepts, so content that compiles always registers.
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(seat.id) || names.has(seat.id) || !vec(seat.anchor) || !vec(seat.entry) ||
      (seat.door !== undefined && !(Number.isInteger(seat.door) && seat.door >= 0 && seat.door < d.doors.length))) throw new Error("invalid vehicle seat");
    names.add(seat.id);
    if (seat.driver) drivers++;
  }
  if (drivers !== 1) throw new Error("a vehicle must have one driver seat");
}

/** Physical surface values, independent of terrain palette or art material names. */
export interface VehicleSurface {
  readonly id: string;
  readonly grip: number;
  readonly rolling: number;
  readonly drag: number;
}

export interface WheelContact {
  y: number;
  normalY: number;
  surface: VehicleSurface;
}

export interface VehicleState extends VehicleDrivetrainState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Presentation attitude from wheel support; the collision provider may be conservative. */
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  groundPitch: number;
  groundRoll: number;
  /** y already includes this displacement above the wheel-support plane. */
  rideOffset: number;
  rideVelocity: number;
  steering: number;
  wheelAngle: number;
  fuel: number;
}

export interface VehicleInput {
  /** Signed throttle; changing direction first brakes to zero. */
  throttle: number;
  steer: number;
  brake: number;
  handbrake: boolean;
  /** Disengages the transmission for coasting/free revving; an optional future input binding. */
  neutral?: boolean;
}

export interface VehicleWorld {
  support(x: number, y: number, z: number, spec: VehicleSpec): WheelContact | null;
  /** Swept chassis check. Return a stable reason; null means clear. */
  blocked(from: Readonly<VehicleState>, to: Readonly<VehicleState>, spec: VehicleSpec): string | null;
}

export interface VehicleStep {
  blocked: string | null;
  impactSpeed: number;
  fuelUsed: number;
  surface: string;
}

export function validateVehicleSpec(s: VehicleSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid vehicle specification");
  for (const key of ["halfWidth", "halfLength", "height", "clearance", "wheelbase", "track", "wheelRadius", "acceleration", "brake", "maxForward", "maxReverse", "maxSteer", "steerRate", "maxRise", "maxDrop", "minGroundNormal", "fuelCapacity", "fuelPerSecond"] as const) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`missing or invalid vehicle ${key}`);
  }
  const zero = new Set(["yawDamping", "pitchResponse", "rollResponse", "airDrag", "dragScale"]);
  for (const [key, value] of Object.entries(s)) if (key !== "drivetrain" && value !== undefined &&
    (!Number.isFinite(value) || (zero.has(key) ? value < 0 : value <= 0))) throw new Error("invalid vehicle specification");
  if (s.mass !== undefined && (s.mass < 50 || s.mass > 1000000)) throw new Error("invalid vehicle mass");
  if (s.drivetrain !== undefined) validateDrivetrainSpec(s.drivetrain);
  if (s.clearance >= s.height || s.track > 2 * s.halfWidth || s.wheelbase > 2 * s.halfLength || s.maxSteer >= 1.2 || s.minGroundNormal > 1 ||
    (s.handbrakeGrip ?? 0.18) > 1 || (s.suspensionDamping ?? 0.85) > 2 || (s.suspensionFrequency ?? 10) > 24 ||
    (s.suspensionTravel ?? 0.18) > 1) throw new Error("inconsistent vehicle geometry or steering limits");
}

export function createVehicle(s: VehicleSpec, x: number, y: number, z: number, yaw = 0, fuel = s.fuelCapacity): VehicleState {
  validateVehicleSpec(s);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > s.fuelCapacity) throw new Error("invalid vehicle state");
  return { x, y, z, yaw, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, grounded: true,
    yawRate: 0, pitchRate: 0, rollRate: 0, groundPitch: 0, groundRoll: 0,
    rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel,
    gear: 0, engineRpm: fuel > 0 ? (s.drivetrain ?? DEFAULT_DRIVETRAIN).idleRpm : 0, shiftTime: 0, payloadMass: 0 };
}

function approach(n: number, target: number, by: number): number {
  return n < target ? Math.min(n + by, target) : Math.max(n - by, target);
}
function command(n: number, lo: number, hi: number): number { return Number.isFinite(n) ? clamp(n, lo, hi) : 0; }
function tangent(a: number): number { return detSin(a) / Math.max(0.2, detCos(a)); }
function length2(x: number, z: number): number { return Math.sqrt(x * x + z * z); }
function length3(x: number, y: number, z: number): number { return Math.sqrt(x * x + y * y + z * z); }
function square(n: number): number { return n * n; }
function wrap(a: number): number { return a - Math.floor((a + TAU / 2) / TAU) * TAU; }

interface Support { y: number; pitch: number; roll: number; front: VehicleSurface; rear: VehicleSurface }

/** Rays follow the last wheel plane, independently of body dive/roll. Three contacts
 * can bridge one small pothole; a last supported axle can roll off a ledge before flight.
 */
function support(w: VehicleWorld, s: Readonly<VehicleState>, p: VehicleSpec): Support | null {
  const sn = detSin(s.yaw), cs = detCos(s.yaw), base = s.y - s.rideOffset;
  const heights = [NaN, NaN, NaN, NaN];
  let front: VehicleSurface | null = null, rear: VehicleSurface | null = null, count = 0;
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 === 0 ? 1 : -1) * p.track / 2, z = (i < 2 ? 1 : -1) * p.wheelbase / 2;
    const expected = base + tangent(s.groundPitch) * z + tangent(s.groundRoll) * x;
    const c = w.support(s.x + cs * x + sn * z, expected, s.z - sn * x + cs * z, p);
    if (!c || !Number.isFinite(c.y) || !Number.isFinite(c.normalY) || c.normalY < p.minGroundNormal ||
      !Number.isFinite(c.surface.grip) || c.surface.grip <= 0 || !Number.isFinite(c.surface.rolling) || c.surface.rolling < 0 ||
      !Number.isFinite(c.surface.drag) || c.surface.drag < 0) continue;
    const slopeReach = Math.sqrt(p.wheelbase * p.wheelbase + p.track * p.track) * 0.5 * Math.sqrt(Math.max(0, 1 / (c.normalY * c.normalY) - 1));
    if (s.grounded && (c.y < expected - p.maxDrop - slopeReach || c.y > expected + p.maxRise + slopeReach)) continue;
    heights[i] = c.y; count++;
    if (i < 2) { if (!front || c.surface.grip < front.grip) front = c.surface; }
    else if (!rear || c.surface.grip < rear.grip) rear = c.surface;
  }
  if (count < 2) return null;
  if (count === 2) {
    // Let the last axle roll off a ledge before gravity drops the chassis through
    // the platform behind it. Missing wheels extend the previous support plane.
    if (Number.isFinite(heights[0]) && Number.isFinite(heights[1])) {
      heights[2] = heights[0]! - tangent(s.groundPitch) * p.wheelbase;
      heights[3] = heights[1]! - tangent(s.groundPitch) * p.wheelbase;
      rear = front;
    } else if (Number.isFinite(heights[2]) && Number.isFinite(heights[3])) {
      heights[0] = heights[2]! + tangent(s.groundPitch) * p.wheelbase;
      heights[1] = heights[3]! + tangent(s.groundPitch) * p.wheelbase;
      front = rear;
    } else return null;
  }
  if (!front || !rear) return null;
  // A fourth corner of a plane is determined by the other three.
  for (let i = 0; i < 4; i++) if (!Number.isFinite(heights[i])) heights[i] = heights[i ^ 1]! + heights[i ^ 2]! - heights[i ^ 3]!;
  const nose = (heights[0]! + heights[1]!) / 2, tail = (heights[2]! + heights[3]!) / 2;
  const left = (heights[0]! + heights[2]!) / 2, right = (heights[1]! + heights[3]!) / 2;
  const pitch = detAtan2(nose - tail, p.wheelbase), roll = detAtan2(left - right, p.track);
  if (detCos(pitch) * detCos(roll) < p.minGroundNormal) return null;
  // A twisted surface beyond wheel travel cannot support a rigid chassis as one plane.
  if (Math.abs(heights[0]! + heights[3]! - heights[1]! - heights[2]!) > (p.suspensionTravel ?? 0.18) * 4 + p.maxRise * 2) return null;
  return { y: (nose + tail) / 2, pitch, roll, front, rear };
}

function attitude(s: VehicleState, pitch: number, roll: number, frequency: number, damping: number, dt: number): void {
  s.pitchRate += ((pitch - s.pitch) * frequency * frequency - 2 * damping * frequency * s.pitchRate) * dt;
  s.rollRate += ((roll - s.roll) * frequency * frequency - 2 * damping * frequency * s.rollRate) * dt;
  s.pitch += s.pitchRate * dt;
  s.roll += s.rollRate * dt;
}

/** Four fixed substeps. Tire forces turn velocity and yaw separately: losing rear grip
 * produces real sideslip, and restoring grip/countersteering recovers it. All persistent
 * rates and spring state are explicit for prediction, replay and save adapters.
 */
export function stepVehicle(s: VehicleState, input: VehicleInput, p: VehicleSpec, w: VehicleWorld): VehicleStep {
  const result: VehicleStep = { blocked: null, impactSpeed: 0, fuelUsed: 0, surface: "air" };
  const throttle = command(input.throttle, -1, 1), steer = command(input.steer, -1, 1), brake = command(input.brake, 0, 1);
  const dt = TICK_DT / 4, beforeFuel = s.fuel;
  const drivetrain = p.drivetrain ?? DEFAULT_DRIVETRAIN, curbMass = p.mass ?? 1100, mass = vehicleMass(p, s), massRatio = curbMass / mass;
  const frequency = (p.suspensionFrequency ?? 10) * Math.sqrt(massRatio), damping = p.suspensionDamping ?? 0.85, travel = p.suspensionTravel ?? 0.18;
  const gravity = p.gravity ?? 18, frontLever = p.wheelbase * 0.45, rearLever = p.wheelbase * 0.55;
  const inertia = (p.wheelbase * p.wheelbase + p.track * p.track) / 12 * (p.yawInertia ?? 1.2);
  for (let i = 0; i < 4; i++) {
    const prior = { ...s };
    const ground = support(w, s, p);
    if (s.grounded && (!ground || ground.y < s.y - s.rideOffset - p.maxDrop)) s.grounded = false;
    if (s.grounded && ground) {
      // Establish the physical wheel plane before sweeping from a freshly spawned
      // or restored car. The body attitude still springs toward it over time.
      prior.groundPitch = s.groundPitch = ground.pitch;
      prior.groundRoll = s.groundRoll = ground.roll;
    }
    const sn = detSin(s.yaw), cs = detCos(s.yaw);
    const forward = s.vx * sn + s.vz * cs, lateral = s.vx * cs - s.vz * sn;
    const speed = length2(s.vx, s.vz), steeringLimit = p.maxSteer / (1 + square(Math.abs(forward) / (p.steerSpeed ?? 18)));
    s.steering = approach(s.steering, steer * steeringLimit, p.steerRate * (steer === 0 ? 1.35 : 1) * dt);
    const mechanical = stepDrivetrain(s, { throttle, forward, wheelRadius: p.wheelRadius, running: s.fuel > 0,
      disengaged: brake > 0 || input.handbrake || !s.grounded, neutral: input.neutral === true }, drivetrain, dt);
    // A running engine spends fuel while revving in neutral/air or during a gear change too.
    const demand = s.fuel > 0 ? Math.abs(throttle) * p.fuelPerSecond * dt : 0;
    const spent = Math.min(s.fuel, demand); s.fuel -= spent;
    let longitudinal = 0, sideways = 0;
    if (s.grounded && ground) {
      result.surface = ground.front.grip <= ground.rear.grip ? ground.front.id : ground.rear.id;
      const grip = (ground.front.grip * (p.frontGrip ?? 1.08) + ground.rear.grip * (p.rearGrip ?? 1.05)) / 2;
      const rolling = (ground.front.rolling + ground.rear.rolling) / 2;
      const drag = (ground.front.drag + ground.rear.drag) / 2 * (p.dragScale ?? 1);
      const resistance = rolling + drag * forward * forward * massRatio + mechanical.engineDrag / mass;
      const legacyScale = p.drivetrain ? 1 : p.acceleration / 8;
      let drive = demand > 0 ? mechanical.drive / mass * legacyScale * spent / demand : 0;
      drive = clamp(drive, -grip * 0.95, grip * 0.95);
      // A speed governor only removes available torque; it never invents thrust to cancel drag.
      // Overspeed still coasts down, and axle friction sees the reduced force actually transmitted.
      if (drive > 0) drive = Math.min(drive, Math.max(0, resistance + (p.maxForward - forward) / dt));
      else if (drive < 0) drive = Math.max(drive, Math.min(0, -resistance + (-p.maxReverse - forward) / dt));
      const pedal = brake * (0.25 + 0.75 * brake);
      const braking = Math.min(grip * 1.5, p.brake * massRatio * Math.max(pedal, mechanical.opposingBrake, input.handbrake ? 0.55 : 0));
      // Brake and rolling forces stop at zero; no oscillating backwards creep at rest.
      const slowed = approach(forward, 0, (braking + resistance) * dt);
      longitudinal = drive + (slowed - forward) / dt;
      const frontLoad = clamp(0.55 - longitudinal * 0.012, 0.36, 0.7);
      const frontMax = ground.front.grip * (p.frontGrip ?? 1.08) * frontLoad;
      const rearMax = ground.rear.grip * (p.rearGrip ?? 1.05) * (1 - frontLoad) * (input.handbrake ? p.handbrakeGrip ?? 0.18 : 1);
      const frontUse = clamp(Math.abs(drive) * 0.45 / Math.max(frontMax, 0.01) + braking / (grip * 1.7), 0, 0.98);
      const rearUse = clamp(Math.abs(drive) * 0.55 / Math.max(rearMax, 0.01) + (input.handbrake ? 0 : braking / (grip * 2)), 0, 0.98);
      const frontBudget = frontMax * Math.sqrt(1 - frontUse * frontUse), rearBudget = rearMax * Math.sqrt(1 - rearUse * rearUse);
      const stiffness = p.corneringStiffness ?? 7;
      const frontSlip = lateral + s.yawRate * frontLever - forward * tangent(s.steering);
      const rearSlip = lateral - s.yawRate * rearLever;
      const frontForce = clamp(-frontSlip * stiffness * 0.55, -frontBudget, frontBudget);
      const rearForce = clamp(-rearSlip * stiffness * 0.45, -rearBudget, rearBudget);
      sideways = frontForce * detCos(s.steering) + rearForce;
      longitudinal -= frontForce * detSin(s.steering);
      s.yawRate += ((frontForce * detCos(s.steering) * frontLever - rearForce * rearLever) / inertia - s.yawRate * (p.yawDamping ?? 0.8)) * dt;
      s.yawRate = clamp(s.yawRate, -3, 3);
      s.vx += (sn * longitudinal + cs * sideways) * dt;
      s.vz += (cs * longitudinal - sn * sideways) * dt;
      // A parked car converges fully to rest, rather than accumulating tire-force rounding noise.
      if (length2(s.vx, s.vz) < 0.025 && Math.abs(throttle) < 0.01) { s.vx = s.vz = 0; s.yawRate = approach(s.yawRate, 0, dt * 3); }
    } else {
      const drag = Math.max(0, 1 - (p.airDrag ?? 0.04) * dt);
      s.vx *= drag; s.vz *= drag; s.yawRate *= Math.max(0, 1 - dt * 0.35);
    }
    const next = { ...s };
    next.yaw = wrap(s.yaw + s.yawRate * dt);
    next.x += s.vx * dt; next.z += s.vz * dt;
    const target = support(w, next, p);
    const base = prior.y - prior.rideOffset;
    const rise = target ? target.y - base : 0;
    const allowedRise = p.maxRise + length2(next.x - prior.x, next.z - prior.z) * Math.sqrt(1 / (p.minGroundNormal * p.minGroundNormal) - 1);
    let blocked: string | null = s.grounded && target && rise > allowedRise ? "step-too-high" : null;
    if (s.grounded && target && !blocked && rise >= -p.maxDrop) {
      const gradeVelocity = speed * Math.sqrt(1 / (p.minGroundNormal * p.minGroundNormal) - 1) + 1;
      const baseVelocity = clamp((target.y - base) / dt, -gradeVelocity, gradeVelocity);
      let relative = prior.vy - baseVelocity;
      relative += (-frequency * frequency * prior.rideOffset - 2 * damping * frequency * relative) * dt;
      const offset = prior.rideOffset + relative * dt;
      if (offset > travel && prior.vy > 0.8) {
        next.grounded = false;
      } else {
        next.grounded = true;
        next.groundPitch = target.pitch; next.groundRoll = target.roll;
        next.rideOffset = clamp(offset, -Math.min(travel * 0.65, p.clearance * 0.65), travel);
        next.rideVelocity = next.rideOffset !== offset ? Math.max(0, relative) : relative;
        next.y = target.y + next.rideOffset;
        next.vy = baseVelocity + next.rideVelocity;
        attitude(next, target.pitch + clamp(longitudinal * (p.pitchResponse ?? 0.012), -0.11, 0.11),
          target.roll - clamp(sideways * (p.rollResponse ?? 0.018), -0.15, 0.15), frequency, damping, dt);
      }
    } else next.grounded = false;
    if (!next.grounded && !blocked) {
      next.vy = Math.max(-60, prior.vy - gravity * dt);
      next.y = prior.y + (prior.vy + next.vy) * 0.5 * dt;
      next.rideOffset = approach(prior.rideOffset, 0, dt * travel * 3); next.rideVelocity = 0;
      attitude(next, clamp(detAtan2(next.vy, Math.max(speed, 4)), -0.55, 0.55), 0, 1.8, 0.9, dt);
      if (target && next.y - next.rideOffset <= target.y + 0.015 && prior.y - prior.rideOffset >= target.y - p.maxRise && next.vy <= 1) {
        result.impactSpeed = Math.max(result.impactSpeed, Math.max(0, -next.vy));
        next.grounded = true; next.groundPitch = target.pitch; next.groundRoll = target.roll;
        next.rideOffset = -Math.min(travel * 0.65, p.clearance * 0.65, Math.max(0, -next.vy) * 0.015);
        next.rideVelocity = Math.max(-3, next.vy * 0.35);
        next.y = target.y + next.rideOffset; next.vy = next.rideVelocity;
      }
    }
    if (!blocked) blocked = w.blocked(prior, next, p);
    if (blocked) {
      result.blocked ??= blocked;
      result.impactSpeed = Math.max(result.impactSpeed, length3(s.vx, s.vz, s.vy));
      s.vx = s.vz = s.yawRate = 0;
      if (!prior.grounded) {
        // Preserve the last clear attitude while sliding down a wall. Rejecting the
        // proposed nose rotation must not also reject gravity forever.
        const fall = { ...next, x: prior.x, z: prior.z, yaw: prior.yaw, pitch: prior.pitch, roll: prior.roll,
          pitchRate: 0, rollRate: 0, yawRate: 0, vx: 0, vz: 0, grounded: false, rideOffset: 0, rideVelocity: 0 };
        fall.vy = Math.max(-60, prior.vy - gravity * dt);
        fall.y = prior.y + (prior.vy + fall.vy) * 0.5 * dt;
        const floor = support(w, fall, p);
        if (floor && fall.y <= floor.y + 0.015 && prior.y >= floor.y - p.maxRise) {
          fall.grounded = true; fall.groundPitch = floor.pitch; fall.groundRoll = floor.roll;
          fall.rideOffset = -Math.min(travel * 0.65, p.clearance * 0.65);
          fall.y = floor.y + fall.rideOffset; fall.vy = 0;
        }
        let settled = false;
        // A grounded hull may be slightly wider than its nose-up airborne pose.
        // A bounded, swept contact correction makes room to settle; it never crosses a wall.
        const offsets = fall.grounded ? [[0, 0], [-sn * 0.25, -cs * 0.25], [sn * 0.25, cs * 0.25], [-cs * 0.25, sn * 0.25], [cs * 0.25, -sn * 0.25]] : [[0, 0]];
        for (const offset of offsets) {
          fall.x = prior.x + offset[0]!; fall.z = prior.z + offset[1]!;
          if (w.blocked(prior, fall, p) !== null) continue;
          Object.assign(s, fall); settled = true; break;
        }
        if (!settled) { s.grounded = false; s.vy = fall.vy; }
      }
      continue;
    }
    next.wheelAngle = wrap(s.wheelAngle + forward * dt / p.wheelRadius);
    Object.assign(s, next);
  }
  result.fuelUsed = beforeFuel - s.fuel;
  return result;
}
