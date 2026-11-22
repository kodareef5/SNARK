// Cold-gas thrusters on a road car (the Zephyr): a forward boost, and a hop that rolls or flips the car and catches it upright.
// The whole state is two integers on the body, so prediction replays a burst exactly as authority steps it. Only a vehicle whose
// spec has `thrusters` reads or writes them; every other car steps as it always has.
import { TICK_RATE } from "../coords.ts";
import { quatUnrotate } from "../math/quat.ts";
import { clamp, detAtan2 } from "../math/scalar.ts";
import type { VehicleDefinition, VehicleSpec, VehicleState, VehicleWorld } from "./vehicle.ts";

export interface VehicleThrusterSpec {
  /** Forward push along the body, m/s², for `boostTicks` once fired. */
  readonly boostAccel: number;
  readonly boostTicks: number;
  /** Ticks after a boost ends before another fires. 0 is none: held, the boost runs on. */
  readonly boostCooldownTicks: number;
  /** Upward speed the lift nozzles add over `liftTicks`, in m/s. */
  readonly hopSpeed: number;
  readonly liftTicks: number;
  /** The spin a flip is kicked to, rad/s, and how fast the nozzles may change any body rate, rad/s². */
  readonly spinRate: number;
  readonly spinAccel: number;
  /** Most angular acceleration the catch may use to bring the car level, rad/s². */
  readonly catchAccel: number;
  /** Most upward acceleration the cushion may use above the ground, m/s². */
  readonly cushionAccel: number;
  /** Ticks from a flip's press before another may start. 0 is none. */
  readonly flipCooldownTicks: number;
  /** Ticks after the wheels leave the ground that a flip may still start. */
  readonly graceTicks: number;
}

export const ZEPHYR_THRUSTERS: VehicleThrusterSpec = {
  boostAccel: 40, boostTicks: 22, boostCooldownTicks: 4 * TICK_RATE,
  hopSpeed: 11, liftTicks: 3, spinRate: 7.5, spinAccel: 75, catchAccel: 32, cushionAccel: 30,
  flipCooldownTicks: 3 * TICK_RATE, graceTicks: 6,
};

/** A flip's axis, chosen once at the press. Neutral is the kickflip: a roll to the right. */
export const FLIP_NONE = 0, FLIP_ROLL_LEFT = 1, FLIP_ROLL_RIGHT = 2, FLIP_FRONT = 3, FLIP_BACK = 4;

// vehicleThrust: boost ticks left (6), burst tick from 1 (7), axis (3), held keys (2), inverted seen (1), air ticks (5),
// then what fired on the last tick, for presentation: lift, spin, catch, cushion, boost.
const BOOST_LEFT = 0x3f, BURST_SHIFT = 6, BURST_MASK = 0x7f, AXIS_SHIFT = 13, AXIS_MASK = 7;
const HELD_BOOST = 1 << 16, HELD_BURST = 1 << 17, INVERTED = 1 << 18, AIR_SHIFT = 19, AIR_MASK = 31;
export const FIRED_LIFT = 1 << 24, FIRED_SPIN = 1 << 25, FIRED_CATCH = 1 << 26, FIRED_CUSHION = 1 << 27, FIRED_BOOST = 1 << 28;
const FIRED = FIRED_LIFT | FIRED_SPIN | FIRED_CATCH | FIRED_CUSHION | FIRED_BOOST;
/** A burst ends at the latest after this many ticks. */
const BURST_MOST = 96;
/** The catch begins once the car has been over and its roof is past the horizon again, or this late in any case. */
const CATCH_LATE = 30;

export const thrustBoostLeft = (t: number): number => t & BOOST_LEFT;
export const thrustBurstTick = (t: number): number => (t >>> BURST_SHIFT) & BURST_MASK;
export const thrustAxis = (t: number): number => (t >>> AXIS_SHIFT) & AXIS_MASK;
/** A boost or a flip is under way: the car may not sleep. */
export const thrustActive = (t: number): boolean => (t & BOOST_LEFT) !== 0 || thrustAxis(t) !== FLIP_NONE;
export const thrustFired = (t: number): number => t & FIRED;
export const boostCooling = (c: number): number => c & 0xffff;
export const flipCooling = (c: number): number => c >>> 16;

export interface ThrusterInput { boost?: boolean; burst?: boolean; throttle: number; steer: number }

const q = new Float64Array(4), u = new Float64Array(3);

/** Once a tick, before the substeps: cooldowns, presses and the start of a boost or a flip. */
export function beginThrusterTick(s: VehicleState, input: ThrusterInput, t: VehicleThrusterSpec): void {
  let thrust = (s.thrust ?? 0) & ~FIRED, boostCool = boostCooling(s.thrustCool ?? 0), flipCool = flipCooling(s.thrustCool ?? 0);
  if (boostCool > 0) boostCool--;
  if (flipCool > 0) flipCool--;
  const air = s.grounded ? 0 : Math.min(AIR_MASK, ((thrust >>> AIR_SHIFT) & AIR_MASK) + 1);
  thrust = (thrust & ~(AIR_MASK << AIR_SHIFT)) | (air << AIR_SHIFT);
  const boost = input.boost === true, burst = input.burst === true;
  if (boost && (thrust & BOOST_LEFT) === 0 && boostCool === 0) thrust |= Math.min(BOOST_LEFT, t.boostTicks);
  if (burst && (thrust & HELD_BURST) === 0 && flipCool === 0 && thrustBurstTick(thrust) === 0 && air <= t.graceTicks) {
    const axis = input.throttle > .3 ? FLIP_FRONT : input.throttle < -.3 ? FLIP_BACK : input.steer > .3 ? FLIP_ROLL_LEFT : FLIP_ROLL_RIGHT;
    thrust = (thrust & ~((BURST_MASK << BURST_SHIFT) | (AXIS_MASK << AXIS_SHIFT) | INVERTED)) | (axis << AXIS_SHIFT);
    flipCool = t.flipCooldownTicks;
  }
  thrust = (thrust & ~(HELD_BOOST | HELD_BURST)) | (boost ? HELD_BOOST : 0) | (burst ? HELD_BURST : 0);
  if (thrust & (AXIS_MASK << AXIS_SHIFT)) {
    const tick = thrustBurstTick(thrust) + 1;
    thrust = (thrust & ~(BURST_MASK << BURST_SHIFT)) | (Math.min(tick, BURST_MASK) << BURST_SHIFT);
  }
  s.thrust = thrust >>> 0; s.thrustCool = ((flipCool << 16) | boostCool) >>> 0;
}

/**
 * Once a substep, after gravity: the boost along the body, the lift, the kick to a spin, the catch that brings the roof back
 * up, and the cushion over the ground. `ahead` is the body's nose in the world. Rates are body-local, as the chassis keeps them.
 */
export function applyThrusters(s: VehicleState, p: VehicleSpec, t: VehicleThrusterSpec, ahead: ArrayLike<number>, w: VehicleWorld, dt: number): void {
  let thrust = s.thrust ?? 0;
  if (thrust & BOOST_LEFT) {
    s.vx += ahead[0]! * t.boostAccel * dt; s.vy += ahead[1]! * t.boostAccel * dt; s.vz += ahead[2]! * t.boostAccel * dt;
    thrust |= FIRED_BOOST;
  }
  const axis = thrustAxis(thrust), tick = thrustBurstTick(thrust);
  if (axis !== FLIP_NONE) {
    q[0] = s.qx ?? 0; q[1] = s.qy ?? 0; q[2] = s.qz ?? 0; q[3] = s.qw ?? 1;
    // World up in the body: (0,1,0) when level.
    quatUnrotate(q, 0, 0, 1, 0, u, 0);
    if (u[1]! < 0) thrust |= INVERTED;
    if (tick <= t.liftTicks) { s.vy += t.hopSpeed / (t.liftTicks * 4); thrust |= FIRED_LIFT; }
    const step = t.spinAccel * dt;
    const catching = tick > t.liftTicks && ((thrust & INVERTED) !== 0 && u[1]! > 0 || tick > CATCH_LATE);
    if (!catching && tick > t.liftTicks && tick <= t.liftTicks + 4) {
      // A positive roll rate turns the roof to the right; a positive pitch rate lifts the nose.
      const sign = axis === FLIP_ROLL_RIGHT || axis === FLIP_BACK ? 1 : -1;
      if (axis <= FLIP_ROLL_RIGHT) s.rollRate = approach(s.rollRate, sign * t.spinRate, step);
      else s.pitchRate = approach(s.pitchRate, sign * t.spinRate, step);
      thrust |= FIRED_SPIN;
    } else if (catching) {
      // Turn the body's up toward the world's: body omega along (uz, 0, -ux), at the speed that still stops in the angle left.
      const sine = Math.sqrt(u[0]! * u[0]! + u[2]! * u[2]!), angle = detAtan2(sine, u[1]!);
      const speed = Math.min(Math.sqrt(2 * t.catchAccel * .8 * angle), angle * 6);
      const wantPitch = sine > 1e-6 ? -speed * u[2]! / sine : 0, wantRoll = sine > 1e-6 ? -speed * u[0]! / sine : 0;
      const by = t.catchAccel * dt;
      s.pitchRate = approach(s.pitchRate, wantPitch, by); s.rollRate = approach(s.rollRate, wantRoll, by);
      if (angle > .05 || Math.abs(s.pitchRate) + Math.abs(s.rollRate) > .2) thrust |= FIRED_CATCH;
      // The cushion: from low over the ground, the lift nozzles hold the fall to a landing the springs take.
      if (!s.grounded && u[1]! > .5 && s.vy < -7) {
        const below = w.wheelRay(s.x, s.y + p.clearance, s.z, 0, -1, 0, 3, p);
        if (below) {
          const room = Math.max(.2, below.distance - p.clearance);
          s.vy += Math.min(t.cushionAccel, (s.vy * s.vy - 49) / (2 * room)) * dt;
          thrust |= FIRED_CUSHION;
        }
      }
    }
  }
  s.thrust = thrust >>> 0;
}

/** Once a tick, after the substeps: a boost counts down, and a flip ends on its wheels or when it has run its course. */
export function endThrusterTick(s: VehicleState, t: VehicleThrusterSpec): void {
  let thrust = s.thrust ?? 0, boostCool = boostCooling(s.thrustCool ?? 0);
  const left = thrust & BOOST_LEFT;
  if (left > 0) {
    thrust = (thrust & ~BOOST_LEFT) | (left - 1);
    if (left === 1) boostCool = t.boostCooldownTicks;
  }
  const tick = thrustBurstTick(thrust);
  if (thrustAxis(thrust) !== FLIP_NONE && (tick >= BURST_MOST || (s.grounded && tick > t.liftTicks + 6 && (thrust & FIRED_CATCH) === 0))) {
    thrust &= ~((BURST_MASK << BURST_SHIFT) | (AXIS_MASK << AXIS_SHIFT) | INVERTED);
  }
  s.thrust = thrust >>> 0; s.thrustCool = ((s.thrustCool ?? 0) & 0xffff0000 | Math.min(0xffff, boostCool)) >>> 0;
}

const approach = (n: number, target: number, by: number): number => n < target ? Math.min(n + by, target) : Math.max(n - by, target);

/** Seconds of a server setting as a cooldown in ticks, 0 for none, within what the state carries. */
export const cooldownTicks = (seconds: number): number => Number.isFinite(seconds) && seconds > 0 ? clamp(Math.round(seconds * TICK_RATE), 0, 0xffff) : 0;

export function validateThrusterSpec(t: VehicleThrusterSpec): void {
  if (!t || typeof t !== "object") throw new Error("invalid vehicle thrusters");
  for (const key of ["boostAccel", "hopSpeed", "spinRate", "spinAccel", "catchAccel", "cushionAccel"] as const)
    if (!Number.isFinite(t[key]) || t[key] <= 0 || t[key] > 200) throw new Error(`invalid vehicle thrusters ${key}`);
  if (!Number.isInteger(t.boostTicks) || t.boostTicks < 1 || t.boostTicks > BOOST_LEFT) throw new Error("invalid vehicle thrusters boostTicks");
  if (!Number.isInteger(t.liftTicks) || t.liftTicks < 1 || t.liftTicks > 8) throw new Error("invalid vehicle thrusters liftTicks");
  if (!Number.isInteger(t.graceTicks) || t.graceTicks < 0 || t.graceTicks > AIR_MASK) throw new Error("invalid vehicle thrusters graceTicks");
  for (const key of ["boostCooldownTicks", "flipCooldownTicks"] as const)
    if (!Number.isInteger(t[key]) || t[key] < 0 || t[key] > 0xffff) throw new Error(`invalid vehicle thrusters ${key}`);
  if (t.spinRate >= 12) throw new Error("vehicle thrusters spin past the chassis rate limit");
}

/** A vehicle's thrusters, if it is a road car that has them. */
export function thrustersOf(def: VehicleDefinition | null | undefined): VehicleThrusterSpec | undefined {
  return def && def.movement !== "rotor" && def.movement !== "boat" ? def.spec.thrusters : undefined;
}

/** A nozzle as the art places it (content/vehicles/sports-art.ts ZEPHYR_NOZZLES): its socket's name, chassis point and the way its gas leaves. */
export interface ThrusterNozzle {
  readonly name: string;
  readonly at: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
}

// The nozzles each move fires, by the end of their socket names. A roll to the right lifts the left side and blows from
// the left sill; a front flip lifts the tail and blows from the deck lip. A catch fires the set opposite its spin.
const SPIN_SETS: Readonly<Record<number, readonly string[]>> = {
  [FLIP_ROLL_RIGHT]: ["lift_fl", "lift_rl", "roll_l"],
  [FLIP_ROLL_LEFT]: ["lift_fr", "lift_rr", "roll_r"],
  [FLIP_FRONT]: ["lift_rl", "lift_rr", "pitch_r"],
  [FLIP_BACK]: ["lift_fl", "lift_fr", "pitch_f"],
};
const OPPOSITE: Readonly<Record<number, number>> = { [FLIP_ROLL_RIGHT]: FLIP_ROLL_LEFT, [FLIP_ROLL_LEFT]: FLIP_ROLL_RIGHT, [FLIP_FRONT]: FLIP_BACK, [FLIP_BACK]: FLIP_FRONT };

/** How hard nozzle `name` blows for packed state `thrust`, 0 to 1: what fired on the car's last tick. Presentation only. */
export function nozzleStrength(thrust: number, name: string): number {
  const fired = thrustFired(thrust);
  if (fired === 0) return 0;
  const axis = thrustAxis(thrust);
  const is = (set: readonly string[] | undefined): boolean => set !== undefined && set.some((end) => name.endsWith(end));
  let most = 0;
  if (fired & FIRED_BOOST && name.includes("boost")) most = 1;
  if (fired & FIRED_LIFT && name.includes("lift")) most = 1;
  if (fired & FIRED_CUSHION && name.includes("lift")) most = Math.max(most, .75);
  if (fired & FIRED_SPIN && is(SPIN_SETS[axis])) most = Math.max(most, .9);
  if (fired & FIRED_CATCH && is(SPIN_SETS[OPPOSITE[axis] ?? -1])) most = Math.max(most, .6);
  return most;
}
