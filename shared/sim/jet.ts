// A fixed-wing jet with a lift fan and a swivel nozzle (planning/workstreams/jet.md). Thrust follows the nose, the wing
// lifts by its angle of attack and stalls past its critical angle, and the flight controls chase the pilot's aim within a
// g limit. Below a slow speed the lift fan and nozzle hold it up, so it can leave a hangar with no runway. One simulation
// for authority and prediction, in the helicopter's deterministic maths: only + - * / sqrt and the det functions, and
// every state value rounds to f32 once a tick.
import { TICK_DT, WORLD_MAX_Y } from "../coords.ts";
import { quatAxis, quatMul, quatNormalize, quatRotate, quatUnrotate } from "../math/quat.ts";
import { clamp, detAtan2, detCos, detSin, len3, TAU } from "../math/scalar.ts";
import { JET_IDLE_RPM, JET_RPM_SPAN } from "./jet-gauge.ts";
import { JET_SPEED_CAP, type JetSpec, type JetVehicleDefinition, type VehicleState } from "./vehicle.ts";

export * from "./jet-gauge.ts";


/** A jet's spec as content gives it, checked once its family's code is here (families/jet.ts). Throws on the first fault. */
export function validateJetSpec(s: JetSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid jet specification");
  for (const key of ["halfWidth", "halfLength", "height", "clearance", "mass", "maxForward", "maxReverse", "fuelCapacity", "fuelPerSecond", "cruiseSpeed", "topSpeed", "thrust", "stallSpeed", "criticalAngle", "inducedDrag", "gLimit", "pitchRate", "rollRate", "yawRate", "turnAcceleration", "aimResponse", "vtolSpeed", "vtolFade", "vtolLift", "climbSpeed", "descendSpeed", "spoolUp", "spoolDown", "gravity", "noseGear", "gearTrack", "rotateSpeed", "brake", "minGroundNormal"] as const) {
    if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error(`missing or invalid jet ${key}`);
  }
  const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!Number.isFinite(s.incidence) || Math.abs(s.incidence) > .2 || !Number.isFinite(s.mainGear) || s.mainGear >= 0 || -s.mainGear > s.halfLength ||
    s.noseGear > s.halfLength || s.gearTrack > s.halfWidth || s.clearance >= s.height || s.mass < 50 || s.mass > 1000000 ||
    s.topSpeed > JET_SPEED_CAP || s.maxForward > JET_SPEED_CAP || s.cruiseSpeed >= s.topSpeed || s.stallSpeed >= s.cruiseSpeed ||
    s.vtolSpeed > s.stallSpeed || s.rotateSpeed > s.cruiseSpeed || s.criticalAngle > .6 || s.gLimit > 12 || s.inducedDrag > 1 ||
    s.pitchRate > 5 || s.rollRate > 8 || s.yawRate > 2 || s.aimResponse > 12 || s.minGroundNormal > 1 || s.vtolLift > s.gravity * 3 ||
    s.climbSpeed > 30 || s.descendSpeed > 30 ||
    !Array.isArray(s.bodyBoxes) || s.bodyBoxes.length < 1 || s.bodyBoxes.length > 12 ||
    !s.bodyBoxes.every(b => !!b && vec(b.at) && vec(b.half) && b.half.every((n: number) => n > 0 && n <= 12) && b.at[1] - b.half[1] >= s.clearance - .0001)) throw new Error("inconsistent jet specification");
}

export interface JetState extends VehicleState {
  qx: number; qy: number; qz: number; qw: number;
  engineCondition: number;
  engineOn: boolean;
  /** The pilot's throttle, 0 to 1 of military thrust. */
  throttle: number;
  /** The thrust the engine makes now, as a share of military: up to the afterburner's ratio. */
  spool: number;
  /** How far the nozzle and lift fan are swung to VTOL, 0 to 1. */
  nozzle: number;
  /** 1 with the wheels down, 0 with them up (VehicleState.gear). The afterburner lit is shiftTime 1. */
}
export interface JetInput {
  /** Throttle up or down, -1 to 1, and roll right, -1 to 1. */
  throttle: number;
  roll: number;
  /** The aim the flight controls chase: yaw and pitch in radians, as the pilot's camera looks. */
  aimYaw: number;
  aimPitch: number;
  /** VTOL climb, -1 to 1. */
  climb: number;
  afterburner: boolean;
  airbrake: boolean;
  vtol: boolean;
  /** No pilot: the controls hold the wings level, the throttle closes and the brakes are set on the ground. */
  pilot: boolean;
}
export interface JetSupport { y: number; pitch: number; roll: number }
export interface JetContact { reason: string; nx?: number; ny?: number; nz?: number }
export interface JetWorld {
  /**
   * Whether nothing the jet could meet is in the box, nor the map's edge: a tick whose whole path is in open air steps
   * with no sweep. Without it every substep is swept.
   */
  open?(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean;
  /** The ground under the three wheels with the jet at (x, y, z) turned `yaw`, within `reach` below y, or null. */
  support(x: number, y: number, z: number, yaw: number, reach: number, p: JetSpec): JetSupport | null;
  blocked(from: Readonly<JetState>, to: Readonly<JetState>, def: JetVehicleDefinition): JetContact | null;
  waterAt(x: number, z: number): number;
}
export interface JetStep {
  blocked: string | null;
  impactSpeed: number;
  water: boolean;
  landSpeed: number;
  fuelUsed: number;
  surface: string;
}

/** Wheels go up above this speed in the air and down below the lower one. */
export const GEAR_UP_SPEED = 70;
export const GEAR_DOWN_SPEED = 60;
/** Sink rate the wheels take without harm, m/s. */
export const JET_GEAR_SINK = 7;

const result: JetStep = { blocked: null, impactSpeed: 0, water: false, landSpeed: 0, fuelUsed: 0, surface: "air" };
const q = new Float64Array(4), turn = new Float64Array(4), wanted = new Float64Array(4), error = new Float64Array(4);
const upright = new Float64Array(3), ahead = new Float64Array(3), local = new Float64Array(3), force = new Float64Array(3);
const approach = (value: number, target: number, amount: number): number => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
const unit = (value: number): number => Number.isFinite(value) ? clamp(value, -1, 1) : 0;
const square = (value: number): number => value * value;
const wrap = (value: number): number => value - Math.floor((value + TAU / 2) / TAU) * TAU;
const box = new Float64Array(6);
/** The box about the origin the jet's boxes and wheels fill at the attitude in `q`, into `box`. */
function partsBox(p: JetSpec): void {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  // The rotation's matrix, and each part's middle turned and its half sizes laid along the world's axes.
  const m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - w * z), m02 = 2 * (x * z + w * y);
  const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - w * x);
  const m20 = 2 * (x * z - w * y), m21 = 2 * (y * z + w * x), m22 = 1 - 2 * (x * x + y * y);
  box[0] = box[1] = box[2] = Infinity; box[3] = box[4] = box[5] = -Infinity;
  const parts = partsOf(p);
  for (let i = 0; i < parts.length; i += 6) {
    const ax = parts[i]!, ay = parts[i + 1]!, az = parts[i + 2]!, hx = parts[i + 3]!, hy = parts[i + 4]!, hz = parts[i + 5]!;
    const cx = m00 * ax + m01 * ay + m02 * az, cy = m10 * ax + m11 * ay + m12 * az, cz = m20 * ax + m21 * ay + m22 * az;
    const ex = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz;
    const ey = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
    const ez = Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz;
    if (cx - ex < box[0]!) box[0] = cx - ex; if (cy - ey < box[1]!) box[1] = cy - ey; if (cz - ez < box[2]!) box[2] = cz - ez;
    if (cx + ex > box[3]!) box[3] = cx + ex; if (cy + ey > box[4]!) box[4] = cy + ey; if (cz + ez > box[5]!) box[5] = cz + ez;
  }
}
const partLists = new WeakMap<JetSpec, Float64Array>();
/** A jet's boxes and its three wheels' (as world/jet.ts's shapes have them, a little wider), six numbers each. */
function partsOf(p: JetSpec): Float64Array {
  let parts = partLists.get(p);
  if (!parts) {
    const rows: number[] = [];
    for (const b of p.bodyBoxes) rows.push(b.at[0], b.at[1], b.at[2], b.half[0], b.half[1], b.half[2]);
    const middle = p.clearance / 2;
    rows.push(0, middle, p.noseGear, .2, middle, .3);
    for (const side of [-1, 1]) rows.push(side * p.gearTrack, middle, p.mainGear, .25, middle, .35);
    parts = Float64Array.from(rows);
    partLists.set(p, parts);
  }
  return parts;
}
const reaches = new WeakMap<JetSpec, number>();
/** The farthest any of a jet's parts is from its origin, whatever its attitude. */
function reachOf(p: JetSpec): number {
  let r = reaches.get(p);
  if (r === undefined) {
    r = len3(p.gearTrack + .15, p.clearance, Math.max(p.noseGear, -p.mainGear) + .25);
    for (const b of p.bodyBoxes) r = Math.max(r, len3(Math.abs(b.at[0]) + b.half[0], Math.abs(b.at[1]) + b.half[1], Math.abs(b.at[2]) + b.half[2]));
    reaches.set(p, r);
  }
  return r;
}
/** The thrust ratio of the afterburner to military: it holds topSpeed where military holds cruiseSpeed. */
export const afterburnerRatio = (p: JetSpec): number => square(p.topSpeed / p.cruiseSpeed);

export function createJet(p: JetSpec, x: number, y: number, z: number, yaw = 0, fuel = p.fuelCapacity): JetState {
  validateJetSpec(p);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > p.fuelCapacity) throw new Error("invalid jet state");
  return { x, y, z, yaw, pitch: 0, roll: 0, qx: 0, qy: detSin(yaw / 2), qz: 0, qw: detCos(yaw / 2),
    vx: 0, vy: 0, vz: 0, grounded: true, yawRate: 0, pitchRate: 0, rollRate: 0,
    groundPitch: 0, groundRoll: 0, rideOffset: 0, rideVelocity: 0, steering: 0, wheelAngle: 0, fuel,
    gear: 1, engineRpm: 0, shiftTime: 0, payloadMass: 0, engineCondition: 1, engineOn: false, throttle: 0, spool: 0, nozzle: 1 };
}

/**
 * The wing's lift at angle of attack `alpha`, as a share of its most: straight up to the critical angle, then falling
 * away to a third as the flow leaves the wing. Negative below the zero-lift angle.
 */
export function jetLift(p: JetSpec, alpha: number): number {
  const a = alpha + p.incidence, critical = p.criticalAngle + p.incidence, size = Math.abs(a), sign = a < 0 ? -1 : 1;
  if (size <= critical) return a / critical;
  return sign * Math.max(.3, 1 - (size - critical) / critical * 1.6);
}


function readRotation(s: Readonly<JetState>): void {
  q[0] = s.qx; q[1] = s.qy; q[2] = s.qz; q[3] = s.qw;
  quatNormalize(q, 0);
}
function writeRotation(s: JetState): void {
  s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
  quatRotate(q, 0, 0, 0, 1, ahead, 0);
  quatRotate(q, 0, 0, 1, 0, upright, 0);
  // Display angles only; physics, seats and hit shapes keep the quaternion through a loop.
  const horizontal = Math.sqrt(square(ahead[0]!) + square(ahead[2]!));
  if (horizontal > 1e-5) s.yaw = detAtan2(ahead[0]!, ahead[2]!);
  s.pitch = detAtan2(ahead[1]!, horizontal);
  s.roll = detAtan2(-(upright[0]! * detCos(s.yaw) - upright[2]! * detSin(s.yaw)), upright[1]!);
}
function targetRotation(yaw: number, pitch: number, roll: number): void {
  quatAxis(wanted, 0, 0, 1, 0, yaw);
  quatAxis(turn, 0, 0, 0, 1, roll); quatMul(wanted, 0, wanted, 0, turn, 0);
  quatAxis(turn, 0, 1, 0, 0, -pitch); quatMul(wanted, 0, wanted, 0, turn, 0);
}
function rotationError(): void {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  turn[0] = -x; turn[1] = -y; turn[2] = -z; turn[3] = w;
  quatMul(error, 0, turn, 0, wanted, 0);
  if (error[3]! < 0) for (let i = 0; i < 4; i++) error[i] = -error[i]!;
}

/**
 * Aerodynamic and engine acceleration in the world frame into `force`, for the attitude in `q`, excluding gravity and the
 * lift fan. Returns the angle of attack. Lift is perpendicular to the airflow in the plane of the body's up, capped at the
 * g limit; drag is parasitic by speed squared, induced by lift squared, and a flat-plate term across the body.
 */
function aero(s: Readonly<JetState>, p: JetSpec, thrust: number, airbrake: boolean): number {
  const speed = len3(s.vx, s.vy, s.vz);
  quatUnrotate(q, 0, s.vx, s.vy, s.vz, local, 0);
  const lx = local[0]!, ly = local[1]!, lz = local[2]!;
  const alpha = lz > 1e-3 ? detAtan2(-ly, lz) : 0;
  const parasitic = p.thrust / square(p.cruiseSpeed) * (airbrake ? 3 : 1);
  // Body-frame forces: thrust along the nose, flat-plate drag across it.
  force[0] = -lx * Math.abs(lx) * .03;
  force[1] = -ly * Math.abs(ly) * .012;
  force[2] = thrust;
  quatRotate(q, 0, force[0]!, force[1]!, force[2]!, force, 0);
  if (speed < 1e-4) return alpha;
  const dx = s.vx / speed, dy = s.vy / speed, dz = s.vz / speed;
  let lift = 0;
  if (lz > 1e-3) {
    const coefficient = jetLift(p, alpha);
    lift = clamp(p.gravity * square(speed / p.stallSpeed) * coefficient, -p.gLimit * p.gravity, p.gLimit * p.gravity);
    // Induced drag grows with the square of the lift asked of the wing; past the critical angle the stalled wing drags more.
    const stalled = Math.abs(alpha + p.incidence) > p.criticalAngle + p.incidence ? 1.5 : 0;
    const drag = parasitic * speed * speed + p.inducedDrag * (square(coefficient) + stalled) * p.gravity * square(speed / p.stallSpeed) * .25;
    force[0] -= dx * drag; force[1] -= dy * drag; force[2] -= dz * drag;
    // The lift's direction: the body's up with its part along the airflow taken out.
    const along = upright[0]! * dx + upright[1]! * dy + upright[2]! * dz;
    let ux = upright[0]! - dx * along, uy = upright[1]! - dy * along, uz = upright[2]! - dz * along;
    const size = len3(ux, uy, uz);
    if (size > 1e-6) {
      ux /= size; uy /= size; uz /= size;
      force[0] += ux * lift; force[1] += uy * lift; force[2] += uz * lift;
    }
  } else {
    const drag = parasitic * speed * speed;
    force[0] -= dx * drag; force[1] -= dy * drag; force[2] -= dz * drag;
  }
  return alpha;
}

/** Reuses its result; consume it before stepping the next vehicle. */
export function stepJet(s: JetState, input: Readonly<JetInput>, def: JetVehicleDefinition, world: JetWorld): JetStep {
  const p = def.spec, beforeFuel = s.fuel;
  result.blocked = null; result.impactSpeed = result.landSpeed = result.fuelUsed = 0;
  result.water = false; result.surface = "air";
  s.engineCondition = clamp(s.engineCondition, 0, 1);
  s.payloadMass = Math.max(0, Math.min(100000, s.payloadMass));
  s.throttle = clamp(Number.isFinite(s.throttle) ? s.throttle : 0, 0, 1);
  s.nozzle = clamp(Number.isFinite(s.nozzle) ? s.nozzle : 0, 0, 1);
  const ab = afterburnerRatio(p);
  s.spool = clamp(Number.isFinite(s.spool) ? s.spool : 0, 0, ab);
  const pilot = input.pilot, climb = pilot ? unit(input.climb) : 0, rollInput = pilot ? unit(input.roll) : 0;
  const usable = s.fuel > 0 && s.engineCondition > .08;
  const water = world.waterAt(s.x, s.z);
  const wet = Number.isFinite(water) && s.y + p.clearance < water;
  if (pilot && usable && !wet && !s.engineOn && (input.throttle > 0 || climb > 0)) s.engineOn = true;
  if (!usable || wet || (!pilot && s.grounded)) s.engineOn = false;
  s.throttle = pilot ? clamp(s.throttle + unit(input.throttle) * .5 * TICK_DT, 0, 1) : approach(s.throttle, 0, .5 * TICK_DT);
  const burning = s.engineOn && pilot && input.afterburner;
  const spoolTarget = s.engineOn ? (burning ? ab : Math.max(.06, s.throttle)) : 0;
  s.spool = approach(s.spool, spoolTarget, (spoolTarget > s.spool ? p.spoolUp : p.spoolDown) * TICK_DT);
  s.shiftTime = burning && s.spool > 1 ? 1 : 0;
  s.engineRpm = s.engineOn ? JET_IDLE_RPM + s.spool * JET_RPM_SPAN : s.spool * JET_RPM_SPAN;
  // The nozzle swings only at its pilot's word: a parked jet keeps it where it was left.
  if (pilot) s.nozzle = approach(s.nozzle, input.vtol ? 1 : 0, .8 * TICK_DT);
  if (wet) { result.water = true; result.surface = "water"; }

  readRotation(s); writeRotation(s);
  const power = s.engineOn ? .3 + .7 * s.engineCondition : 0;
  const speed0 = len3(s.vx, s.vy, s.vz);
  // The lift fan carries the jet below vtolSpeed and fades out over vtolFade more, so the wing takes over unbroken.
  const fade = clamp((p.vtolSpeed + p.vtolFade - speed0) / p.vtolFade, 0, 1), hover = s.nozzle * fade;
  if (s.gear === 0 && (s.grounded || speed0 < GEAR_DOWN_SPEED || hover > .5)) s.gear = 1;
  else if (s.gear !== 0 && !s.grounded && speed0 > GEAR_UP_SPEED && hover < .5) s.gear = 0;
  // The nose lifts about the main wheels, which raises the origin ahead of them: `raised` is how far, at a rotation.
  const raised = (rotation: number): number => -p.mainGear * detSin(Math.max(0, rotation));
  const initialSupport = s.gear !== 0 && upright[1]! > .85 ? world.support(s.x, s.y + .06, s.z, s.yaw, .16 + raised(.3), p) : null;
  let rotation = initialSupport ? clamp(s.pitch - initialSupport.pitch, 0, .3) : 0;
  s.grounded = !!initialSupport && s.y - raised(rotation) <= initialSupport.y + (s.grounded ? .03 : .001) && s.vy <= .01;
  if (!s.grounded) rotation = 0;

  // The aim, in the body frame: +X left, +Y up, +Z ahead.
  const aimYaw = pilot ? input.aimYaw : s.yaw, aimPitch = pilot ? clamp(input.aimPitch, -1.5, 1.5) : 0;
  const cp = detCos(aimPitch);
  quatUnrotate(q, 0, detSin(aimYaw) * cp, detSin(aimPitch), detCos(aimYaw) * cp, local, 0);
  const aimLeft = local[0]!, aimUp = local[1]!, aimAhead = local[2]!;
  const pitchError = detAtan2(aimUp, aimAhead), yawError = detAtan2(aimLeft, aimAhead);
  // Controls bite with airspeed, and the lift fan's reaction jets give them authority in the hover.
  const authority = Math.max(hover, clamp(speed0 / p.stallSpeed, 0, 1));
  let wantedPitch = 0, wantedRoll = 0, wantedYaw = 0;
  if (!s.grounded) {
    // Wing-borne: bank toward the aim and pull toward it, within the g limit and short of the critical angle.
    // The bank is chosen from the heading's error over the ground, so it does not shrink as the wing rolls into the turn.
    const bank = clamp(wrap(aimYaw - s.yaw) * 2.5, -1.3, 1.3);
    const flightRoll = rollInput !== 0 ? rollInput * p.rollRate : clamp(wrap(-bank - s.roll) * p.aimResponse, -p.rollRate, p.rollRate);
    quatUnrotate(q, 0, s.vx, s.vy, s.vz, local, 0);
    const alpha = local[2]! > 1e-3 ? detAtan2(-local[1]!, local[2]!) : 0;
    // Wing-borne, the controls fly the path along the aim, so a level aim holds height and the nose rides its angle of
    // attack above it. Slower, they point the nose.
    const path = clamp((speed0 - p.stallSpeed * .5) / (p.stallSpeed * .5), 0, 1) * (1 - hover);
    const pull = Math.min(p.pitchRate, p.gLimit * p.gravity / Math.max(speed0, 1) + .05);
    let flightPitch = clamp((pitchError + alpha * path) * p.aimResponse, -pull, pull);
    flightPitch = Math.min(flightPitch, (p.criticalAngle * .95 - alpha) * p.aimResponse + .02);
    const flightYaw = clamp(yawError * p.aimResponse * .5, -p.yawRate, p.yawRate);
    // In the hover: hold the nose a little up or down of level, turn to the aim, and lean with A and D.
    targetRotation(aimYaw, clamp(aimPitch, -.12, .25), rollInput * .15); rotationError();
    const hoverPitch = clamp(-2 * error[0]! * p.aimResponse, -p.pitchRate, p.pitchRate);
    const hoverRoll = clamp(2 * error[2]! * p.aimResponse, -p.rollRate, p.rollRate);
    const hoverYaw = clamp(2 * error[1]! * p.aimResponse, -p.yawRate, p.yawRate);
    wantedPitch = (flightPitch + (hoverPitch - flightPitch) * hover) * authority;
    wantedRoll = (flightRoll + (hoverRoll - flightRoll) * hover) * authority;
    wantedYaw = (flightYaw + (hoverYaw - flightYaw) * hover) * authority;
  }
  const acceleration = p.turnAcceleration * Math.max(.2, authority);
  s.pitchRate = approach(s.pitchRate, wantedPitch, acceleration * TICK_DT);
  s.rollRate = approach(s.rollRate, wantedRoll, acceleration * TICK_DT);
  s.yawRate = approach(s.yawRate, wantedYaw, acceleration * TICK_DT);
  if (s.grounded) { s.vy = 0; s.pitchRate = s.rollRate = 0; result.surface = wet ? "water" : "ground"; }
  // Nose-wheel steering toward the aim, tighter the slower it rolls, and the nose lifted from the rotation speed.
  const groundTurn = .6 * clamp(speed0 / 4, 0, 1) * clamp(1 - speed0 / 80, .05, 1);
  const groundYaw = s.grounded ? clamp(yawError * 2, -groundTurn, groundTurn) : 0;
  const rotate = s.grounded && speed0 >= p.rotateSpeed ? clamp(aimPitch, 0, .22) : 0;

  const thrustAcceleration = p.thrust * s.spool * power;
  const lift = p.vtolLift * hover * power;
  const wantVy = climb * (climb > 0 ? p.climbSpeed : p.descendSpeed);
  let used = 0;
  const span = Math.max(p.halfWidth, p.halfLength);
  const travel = speed0 * TICK_DT + len3(s.pitchRate, s.yawRate, s.rollRate) * span * TICK_DT;
  const count = Math.max(2, Math.min(12, Math.ceil(travel / 1.2))), dt = TICK_DT / count;
  // A substep in open air needs no sweep: its parts' box as they stand, widened by twice as far as they may go in it.
  const reach = reachOf(p);
  for (let step = 0; step < count; step++) {
    readRotation(s);
    let clear = false;
    if (!s.grounded && s.gear === 0 && world.open) {
      partsBox(p);
      const go = (len3(s.vx, s.vy, s.vz) + len3(s.pitchRate, s.yawRate, s.rollRate) * reach) * dt * 2 + .3;
      clear = world.open(s.x + box[0]! - go, s.y + box[1]! - go, s.z + box[2]! - go, s.x + box[3]! + go, s.y + box[4]! + go, s.z + box[5]! + go);
    }
    const previous = clear ? s : { ...s }, previousY = s.y;
    if (s.grounded) {
      rotation = approach(rotation, rotate, .5 * dt);
      s.yawRate = approach(s.yawRate, groundYaw, 3 * dt);
      const yaw = s.yaw + s.yawRate * dt;
      const support = world.support(s.x, previousY + .08, s.z, yaw, .16 + raised(.3) + speed0 * dt, p);
      if (!support) { s.grounded = false; writeRotation(s); }
      else {
        targetRotation(yaw, support.pitch + rotation, support.roll); q.set(wanted); writeRotation(s);
        s.y = support.y + raised(rotation); s.groundPitch = support.pitch; s.groundRoll = support.roll;
      }
    } else {
      const rate = len3(s.pitchRate, s.yawRate, s.rollRate);
      if (rate > 1e-9) {
        quatAxis(turn, 0, -s.pitchRate / rate, s.yawRate / rate, s.rollRate / rate, rate * dt);
        quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0);
      }
      writeRotation(s);
    }
    aero(s, p, thrustAcceleration * (1 - hover), pilot && input.airbrake);
    let ax = force[0]!, ay = force[1]! - p.gravity, az = force[2]!;
    // The lift fan and nozzle: as much up thrust as the climb asked for wants, within what they can give, and in the hover
    // a vectored push toward the throttle's crawl speed ahead and the stick's sideways.
    if (lift > 0) {
      const wantAy = clamp((wantVy - s.vy) * 2.2, -8, 8);
      const up = Math.max(.3, upright[1]!);
      const fan = clamp((wantAy - ay) / up, 0, lift);
      ax += upright[0]! * fan; ay += upright[1]! * fan; az += upright[2]! * fan;
      used = Math.max(used, fan / Math.max(p.gravity, 1e-3));
      const sn = detSin(s.yaw), cs = detCos(s.yaw);
      const along = s.vx * sn + s.vz * cs, side = s.vx * cs - s.vz * sn;
      const push = 4 * hover * power;
      // Full throttle asks past the fade, so the main nozzle takes over as the fan lets go and the jet goes on to fly.
      const forward = clamp((s.throttle * (p.vtolSpeed + p.vtolFade) - along) * 1.5, -push, push);
      const sideways = clamp((-rollInput * 8 - side) * 1.5, -push, push);
      ax += sn * forward + cs * sideways; az += cs * forward - sn * sideways;
    }
    if (s.grounded) {
      // On the wheels: rolling drag, the brakes, and tyres that take out sideways slip. The jet lifts off once the wing
      // and the fan carry more than its weight.
      const sn = detSin(s.yaw), cs = detCos(s.yaw);
      let along = s.vx * sn + s.vz * cs, side = s.vx * cs - s.vz * sn;
      const forward = ax * sn + az * cs;
      along += forward * dt;
      const braking = (pilot ? input.airbrake || (s.throttle === 0 && !s.engineOn) : true) ? p.brake : .4;
      along = approach(along, 0, braking * dt);
      side = approach(side, 0, 15 * dt);
      s.vx = sn * along + cs * side; s.vz = cs * along - sn * side;
      s.x += s.vx * dt; s.z += s.vz * dt;
      s.wheelAngle = wrap(s.wheelAngle + along * dt / .4);
      if (ay > .3) { s.grounded = false; s.vy = ay * dt; s.y += s.vy * dt; }
    } else {
      s.vx += ax * dt; s.vy += ay * dt; s.vz += az * dt;
      const speed = len3(s.vx, s.vy, s.vz);
      if (speed > JET_SPEED_CAP) { const k = JET_SPEED_CAP / speed; s.vx *= k; s.vy *= k; s.vz *= k; }
      if (wet) { const k = Math.max(0, 1 - 3 * dt); s.vx *= k; s.vz *= k; s.vy = approach(s.vy * k, -1, 4 * dt); }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y > WORLD_MAX_Y - p.height) { s.y = WORLD_MAX_Y - p.height; s.vy = Math.min(0, s.vy); }
      // The main wheels meet the ground first in a nose-high landing; the nose then comes down as the rotation does.
      const support = s.gear !== 0 && upright[1]! > .85 && s.vy <= 0 ? world.support(s.x, previousY + .04, s.z, s.yaw, Math.max(.12, previousY - s.y + .06) + raised(.3), p) : null;
      const lifted = support ? raised(Math.min(.3, s.pitch - support.pitch)) : 0;
      if (support && s.y - lifted <= support.y + .012 && previousY - lifted >= support.y - .012) {
        const sink = -s.vy;
        result.landSpeed = Math.max(result.landSpeed, sink);
        result.impactSpeed = Math.max(result.impactSpeed, sink);
        rotation = clamp(s.pitch - support.pitch, 0, .3);
        s.y = support.y + raised(rotation); s.vy = 0; s.grounded = true; s.groundPitch = support.pitch; s.groundRoll = support.roll;
        s.pitchRate = s.rollRate = 0;
      }
    }
    const hit = clear ? null : world.blocked(previous, s, def);
    if (hit) {
      const vx = s.vx, vy = s.vy, vz = s.vz;
      const nx = hit.nx ?? 0, ny = hit.ny ?? 0, nz = hit.nz ?? 0;
      const into = Math.min(0, vx * nx + vy * ny + vz * nz);
      result.blocked ??= hit.reason;
      result.impactSpeed = Math.max(result.impactSpeed, len3(nx, ny, nz) > .9 ? -into : len3(vx, vy, vz));
      Object.assign(s, previous); s.yawRate = s.pitchRate = s.rollRate = 0;
      const slide = { ...s, vx: vx - nx * into, vy: vy - ny * into, vz: vz - nz * into, grounded: false };
      slide.x += slide.vx * dt; slide.y += slide.vy * dt; slide.z += slide.vz * dt;
      if (len3(nx, ny, nz) > .9 && !world.blocked(s, slide, def)) Object.assign(s, slide);
      else { s.vx = s.vy = s.vz = 0; }
    }
    if (s.grounded) result.surface = wet ? "water" : "ground";
  }
  // The engine burns by its thrust, and more while it drives the lift fan.
  if (s.engineOn) s.fuel = Math.max(0, s.fuel - p.fuelPerSecond * (.25 + s.spool + used) * TICK_DT);
  if (result.water) { s.engineOn = false; s.engineRpm = 0; }
  if (s.fuel <= 0) s.engineOn = false;
  result.fuelUsed = beforeFuel - s.fuel;
  for (const key of ["x", "y", "z", "yaw", "pitch", "roll", "qx", "qy", "qz", "qw", "vx", "vy", "vz", "yawRate", "pitchRate", "rollRate", "groundPitch", "groundRoll", "fuel", "payloadMass", "engineRpm", "engineCondition", "throttle", "spool", "nozzle", "wheelAngle"] as const) s[key] = Math.fround(s[key]);
  return result;
}
