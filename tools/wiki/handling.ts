// How each vehicle drives, measured when the wiki is built by running its own step with one survivor aboard: a road
// vehicle on a flat plane of the ground every city street is to a wheel, a vessel on open water, a helicopter over flat
// ground. Only what drives it (its gears, driven wheels and engine power, a vessel's drives) is read from its definition.
// Speeds are in metres a second, distances in metres, times in seconds, fuel in the tank's own units.

import { TICK_DT } from "../../shared/coords.ts";
import { clamp, TAU } from "../../shared/math/scalar.ts";
import { boatRestY, createBoat, stepBoat, type BoatState, type BoatWorld } from "../../shared/sim/boat.ts";
import { createHelicopter, stepHelicopter, type HelicopterInput, type HelicopterState, type HelicopterWorld } from "../../shared/sim/helicopter.ts";
import { createVehicle, stepVehicle, boatDrives, type BoatVehicleDefinition, type CarState, type RotorVehicleDefinition, type VehicleDefinition, type VehicleSpec, type VehicleWorld, type WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { DEFAULT_DRIVETRAIN, engineTorqueAt, vehicleMass } from "../../shared/sim/vehicle-drivetrain.ts";
import { OFFROAD } from "../../shared/world/vehicle-surface.ts";

export const KMH = 1 / 3.6;
/** A circle 30 m across, the one a road vehicle's cornering speed is held round. */
export const CIRCLE = 30;
/** A vessel has run on once it is down to this. */
export const CRAWL = 1;
/** A vehicle is at its top speed once it rises less than this in ten seconds. */
const STILL = 0.02;
/** A vehicle has come to its top speed within this share of it. */
export const NEAR = 0.02;

export interface RoadHandling {
  movement: "wheeled";
  /** Seconds from rest to 100 km/h, or to its top speed where it does not reach 100. */
  to100: number;
  reaches100: boolean;
  top: number;
  toTop: number;
  /** The gear it is in at its top speed, of `gears`. */
  topGear: number;
  gears: number;
  reverse: number;
  /** Metres from 100 km/h, or from its top speed, to a stop with the reverse key held. */
  braking: number;
  /** The circle its body sweeps at full lock and walking pace, wall to wall. */
  turning: number;
  /** The fastest it holds round a circle CIRCLE m across, within a metre of the line. */
  circle: number;
  /** The share of drive to the front wheels, or null where each wheel drives by the load on it. */
  front: number | null;
  /** Peak engine power in watts, and the rpm it comes at. */
  power: number;
  powerRpm: number;
  mass: number;
  reaches60: boolean;
  /** Metres a tank takes it at a steady 60 km/h or, where it does not reach 60, at its own top speed: its range flat out. */
  rangeSteady: number;
  rangeTop: number;
}

export interface BoatHandling {
  movement: "boat";
  top: number;
  toHalf: number;
  /** Seconds to within NEAR of its top speed. */
  toTop: number;
  /** Across the circle its body sweeps with full helm and full throttle, and its speed round it. */
  turnFast: number;
  turnFastSpeed: number;
  /** The width of water it sweeps turning half round from rest, full helm and full throttle, and the seconds it takes. */
  turnAbout: number;
  turnAboutTime: number;
  /** Metres from its top speed to CRAWL, the throttle cut. */
  runOn: number;
  /** Keel depth at rest with its pilot aboard, and amidships at its top speed. */
  draught: number;
  draughtTop: number;
  drives: number;
  drive: "outboard" | "shaft" | "jet";
  rangeTop: number;
  /** The farthest a tank takes it, at a throttle held in tenths, and the speed it does that at. */
  rangeCruise: number;
  cruise: number;
}

export interface RotorHandling {
  movement: "rotor";
  /** Level flight at full forward cyclic, and the same with the sprint key held. */
  top: number;
  cruise: number;
  climb: number;
  /** Seconds and metres from its top speed to a hover, the brake held. */
  stop: number;
  stopDistance: number;
  /** Seconds a full tank lasts hovering, flat out and at cruise. */
  hover: number;
  enduranceTop: number;
  enduranceCruise: number;
  rangeTop: number;
  rangeCruise: number;
}

export type Handling = RoadHandling | BoatHandling | RotorHandling;

const forwardOf = (s: { vx: number; vz: number; yaw: number }): number => s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
const flatSpeed = (s: { vx: number; vz: number }): number => Math.sqrt(s.vx * s.vx + s.vz * s.vz);
const wrap = (a: number): number => a - Math.floor((a + TAU / 2) / TAU) * TAU;

/** A throttle that holds a speed: proportional with a bounded integral. */
function holder(target: number): (speed: number) => number {
  let sum = 0;
  return (speed) => {
    const e = target - speed;
    sum = clamp(sum + e * TICK_DT, -3, 3);
    return clamp(0.6 * e + 0.5 * sum, -1, 1);
  };
}

/** Steps a tick at a time until `step` says it is done or `seconds` pass; returns the seconds stepped. */
function run(seconds: number, step: () => boolean | void): number {
  const ticks = Math.round(seconds / TICK_DT);
  for (let k = 0; k < ticks; k++) if (step()) return (k + 1) * TICK_DT;
  return seconds;
}

/** A run to its top speed: the speed it settled at, the speed each tick, and fuel used a metre at the top. */
interface TopRun<S> {
  top: number;
  trace: number[];
  fuelPerMetre: number;
  end: S;
  /** The state as it first reached each speed asked for. */
  at: Map<number, S>;
}

/** Seconds a run took to reach `speed`, or null where it never did. */
export const reached = (trace: readonly number[], speed: number): number | null => {
  const k = trace.findIndex((v) => v >= speed);
  return k < 0 ? null : (k + 1) * TICK_DT;
};

/** The throttle held from rest until the speed rises no more, then `burning` seconds more for the fuel it burns. */
function toTopSpeed<S extends { fuel: number; x: number; z: number }>(state: S, step: (s: S) => void, speed: (s: S) => number, marks: readonly number[], longest: number, burning = 30): TopRun<S> {
  const trace: number[] = [], at = new Map<number, S>();
  const window = Math.round(10 / TICK_DT);
  run(longest, () => {
    step(state);
    const v = speed(state);
    trace.push(v);
    for (const m of marks) if (!at.has(m) && v >= m) at.set(m, { ...state });
    return trace.length > window && v - trace[trace.length - 1 - window]! < STILL;
  });
  const fuel = state.fuel, x = state.x, z = state.z;
  run(burning, () => void step(state));
  const metres = Math.sqrt((state.x - x) ** 2 + (state.z - z) ** 2);
  return { top: trace.reduce((a, b) => Math.max(a, b), 0), trace, fuelPerMetre: (fuel - state.fuel) / metres, end: state, at };
}

const corners = (w: number, l: number): readonly (readonly [number, number])[] => [[w, l], [-w, l], [w, -l], [-w, -l]];

/** Across the circle swept by the four corners of a body `halfWidth` by `halfLength`, over one turn after half a turn's settling. */
function sweep<S extends { x: number; z: number; yaw: number }>(state: S, step: (s: S) => void, halfWidth: number, halfLength: number, longest: number): { across: number; speed: number } {
  let turned = 0, last = state.yaw, settled = false;
  const path: [number, number, number][] = [];
  let metres = 0, seconds = 0, px = state.x, pz = state.z;
  run(longest, () => {
    step(state);
    turned += wrap(state.yaw - last);
    last = state.yaw;
    if (!settled) { settled = Math.abs(turned) >= Math.PI; turned = settled ? 0 : turned; px = state.x; pz = state.z; return false; }
    path.push([state.x, state.z, state.yaw]);
    metres += Math.sqrt((state.x - px) ** 2 + (state.z - pz) ** 2); seconds += TICK_DT; px = state.x; pz = state.z;
    return Math.abs(turned) >= TAU;
  });
  if (path.length === 0 || Math.abs(turned) < TAU) return { across: Infinity, speed: 0 };
  const cx = path.reduce((n, p) => n + p[0], 0) / path.length, cz = path.reduce((n, p) => n + p[1], 0) / path.length;
  let far = 0;
  for (const [x, z, yaw] of path) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const [lx, lz] of corners(halfWidth, halfLength)) {
      far = Math.max(far, Math.sqrt((x + lx * c + lz * s - cx) ** 2 + (z - lx * s + lz * c - cz) ** 2));
    }
  }
  return { across: far * 2, speed: metres / seconds };
}

const ground: VehicleWorld = {
  contact: () => null,
  penetration: () => null,
  waterAt: () => -Infinity,
  wheelRay(_x, y, _z, _dx, dy, _dz, reach) {
    if (dy >= 0) return null;
    const distance = -y / dy;
    return distance < 0 || distance > reach ? null : { distance, nx: 0, ny: 1, nz: 0, surface: OFFROAD };
  },
};

export function roadHandling(def: WheelVehicleDefinition, driver: number): RoadHandling {
  const p = def.spec;
  const car = (): CarState => {
    const s = createVehicle(p, 0, 0, 0);
    s.payloadMass = driver;
    return s;
  };
  const drive = (throttle: number, steer = 0) => (s: CarState): void => void stepVehicle(s, { throttle, steer, brake: 0, handbrake: false }, p, ground);
  const hundred = 100 * KMH;
  const flat = toTopSpeed(car(), drive(1), forwardOf, [hundred], 180);
  const toTop = reached(flat.trace, flat.top * (1 - NEAR))!;
  const reaches100 = flat.at.has(hundred);
  const to100 = reached(flat.trace, hundred) ?? toTop;
  // Braking is the reverse key held, as a driver brakes (shared/sim/vehicle-body.ts sends no brake of its own).
  const braked = reaches100 ? flat.at.get(hundred)! : { ...flat.end };
  const bx = braked.x, bz = braked.z;
  run(30, () => (drive(-1)(braked), forwardOf(braked) <= 0.05));
  const braking = Math.sqrt((braked.x - bx) ** 2 + (braked.z - bz) ** 2);
  const back = car();
  let reverse = 0;
  run(20, () => { drive(-1)(back); reverse = Math.max(reverse, -forwardOf(back)); });
  const walk = car(), slow = holder(2);
  const turning = sweep(walk, (s) => drive(slow(forwardOf(s)), 1)(s), p.halfWidth, p.halfLength, 120).across;
  const train = p.drivetrain ?? DEFAULT_DRIVETRAIN;
  // A definition without a drivetrain scales its torque so (shared/sim/vehicle-chassis.ts).
  const scale = p.drivetrain ? 1 : p.acceleration / 8;
  let power = 0, powerRpm = train.idleRpm;
  for (let rpm = train.idleRpm; rpm <= train.redlineRpm; rpm += 10) {
    const watts = engineTorqueAt(train, rpm) * scale * rpm * TAU / 60;
    if (watts > power) { power = watts; powerRpm = rpm; }
  }
  const cruise = car(), hold = holder(60 * KMH);
  run(15, () => drive(hold(forwardOf(cruise)))(cruise));
  const fuel = cruise.fuel, cx = cruise.x, cz = cruise.z;
  run(30, () => drive(hold(forwardOf(cruise)))(cruise));
  const per60 = (fuel - cruise.fuel) / Math.sqrt((cruise.x - cx) ** 2 + (cruise.z - cz) ** 2);
  const reaches60 = flat.top >= 60 * KMH, rangeTop = p.fuelCapacity / flat.fuelPerMetre;
  return {
    movement: "wheeled", to100, reaches100, top: flat.top, toTop, topGear: flat.end.gear, gears: train.forwardRatios.length,
    reverse, braking, turning, circle: circleSpeed(p, car, flat.top), front: p.frontDriveShare ?? null, power, powerRpm,
    mass: vehicleMass(p, { payloadMass: 0 }), reaches60, rangeSteady: reaches60 ? p.fuelCapacity / per60 : rangeTop, rangeTop,
  };
}

/** The fastest speed, to a twentieth of a metre a second, at which it follows the circle a lap within a metre of the line. */
function circleSpeed(p: VehicleSpec, car: () => CarState, top: number): number {
  const radius = CIRCLE / 2;
  const holds = (target: number): boolean => {
    const s = car(), speed = holder(target);
    // The circle's centre is to the right of the start, round which a positive steer turns.
    const cx = radius, cz = 0;
    let angle = Math.atan2(s.z - cz, s.x - cx), swept = 0, worst = 0, metres = 0, seconds = 0;
    const longest = 2.5 * Math.PI * CIRCLE / target + 30;
    const done = run(longest, () => {
      const v = forwardOf(s), look = Math.max(4, v * 0.5);
      const ahead = Math.atan2(s.z - cz, s.x - cx) - look / radius;
      const tx = cx + radius * Math.cos(ahead) - s.x, tz = cz + radius * Math.sin(ahead) - s.z;
      const alpha = wrap(Math.atan2(tx, tz) - s.yaw);
      const wanted = Math.atan(p.wheelbase * 2 * Math.sin(alpha) / Math.sqrt(tx * tx + tz * tz));
      const limit = p.maxSteer / (1 + (Math.abs(v) / (p.steerSpeed ?? 18)) ** 2);
      const x = s.x, z = s.z;
      stepVehicle(s, { throttle: speed(v), steer: clamp(wanted / limit, -1, 1), brake: 0, handbrake: false }, p, ground);
      const now = Math.atan2(s.z - cz, s.x - cx);
      swept += -wrap(now - angle);
      angle = now;
      if (swept < TAU * 1.5) return false;
      worst = Math.max(worst, Math.abs(Math.sqrt((s.x - cx) ** 2 + (s.z - cz) ** 2) - radius));
      metres += Math.sqrt((s.x - x) ** 2 + (s.z - z) ** 2); seconds += TICK_DT;
      return swept >= TAU * 2.5 || worst > 1;
    });
    return done < longest && worst <= 1 && metres / seconds >= target * 0.97;
  };
  let lo = 2, hi = top;
  if (!holds(lo)) return 0;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (holds(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const sea: BoatWorld = { waterAt: () => 0, groundAt: () => -200, blocked: () => null, penetration: () => null };

export function boatHandling(def: BoatVehicleDefinition, driver: number): BoatHandling {
  const p = def.spec;
  const boat = (): BoatState => {
    const s = createBoat(p, 0, boatRestY(p, 0, driver), 0);
    s.payloadMass = driver;
    return s;
  };
  const helm = (throttle: number, steer = 0) => (s: BoatState): void => void stepBoat(s, { throttle, steer, neutral: false, pilot: true }, def, sea);
  const flat = toTopSpeed(boat(), helm(1), flatSpeed, [], 400);
  const coast = { ...flat.end }, x = coast.x, z = coast.z;
  run(1200, () => (helm(0)(coast), flatSpeed(coast) < CRAWL));
  const runOn = Math.sqrt((coast.x - x) ** 2 + (coast.z - z) ** 2);
  const fast = sweep({ ...flat.end }, helm(1, 1), p.halfWidth, p.halfLength, 600);
  const about = boat();
  let turned = 0, last = about.yaw, left = 0, right = 0;
  const turnAboutTime = run(600, () => {
    helm(1, 1)(about);
    turned += wrap(about.yaw - last);
    last = about.yaw;
    for (const [lx, lz] of corners(p.halfWidth, p.halfLength)) {
      const x = about.x + lx * Math.cos(about.yaw) + lz * Math.sin(about.yaw);
      left = Math.min(left, x); right = Math.max(right, x);
    }
    return Math.abs(turned) >= Math.PI;
  });
  // Each tenth of throttle from the speed the last one settled at, as a pilot opens it up.
  let rangeCruise = p.fuelCapacity / flat.fuelPerMetre, cruise = flat.top;
  const opening = boat();
  for (let tenths = 1; tenths < 10; tenths++) {
    opening.fuel = p.fuelCapacity;
    const held = toTopSpeed(opening, helm(tenths / 10), flatSpeed, [], 400, 10);
    const range = p.fuelCapacity / held.fuelPerMetre;
    if (range > rangeCruise) { rangeCruise = range; cruise = held.top; }
  }
  return {
    movement: "boat", top: flat.top, toHalf: reached(flat.trace, flat.top / 2)!, toTop: reached(flat.trace, flat.top * (1 - NEAR))!,
    turnFast: fast.across, turnFastSpeed: fast.speed, turnAbout: Math.abs(turned) >= Math.PI ? right - left : Infinity, turnAboutTime, runOn,
    draught: -boatRestY(p, 0, driver), draughtTop: -flat.end.y, drives: boatDrives(p).length,
    drive: p.propeller.enclosed ? "jet" : p.outboard ? "outboard" : "shaft",
    rangeTop: p.fuelCapacity / flat.fuelPerMetre, rangeCruise, cruise,
  };
}

const air: HelicopterWorld = {
  support: (_x, y, _z, _yaw, reach) => (y - reach <= 0 ? { y: 0, pitch: 0, roll: 0 } : null),
  blocked: () => null,
  waterAt: () => -Infinity,
};
const ALTITUDE = 120;

export function rotorHandling(def: RotorVehicleDefinition, driver: number): RotorHandling {
  const p = def.spec;
  const input = (change: Partial<HelicopterInput>): HelicopterInput => ({ right: 0, forward: 0, yaw: 0, climb: 0, brake: false, cruise: false, direct: false, pilot: true, ...change });
  const fly = (change: Partial<HelicopterInput>) => (s: HelicopterState): void => void stepHelicopter(s, input(change), def, air);
  // Up from the ground to ALTITUDE, then held there until it hovers still.
  const hovering = (): HelicopterState => {
    const s = createHelicopter(p, 0, 0, 0);
    s.payloadMass = driver;
    run(120, () => (fly({ climb: 1 })(s), s.y >= ALTITUDE));
    run(30, () => (fly({})(s), Math.abs(s.vy) < 0.02 && flatSpeed(s) < 0.02));
    return s;
  };
  const still = hovering();
  const rising = { ...still };
  let climb = 0;
  run(10, () => { fly({ climb: 1 })(rising); climb = Math.max(climb, rising.vy); });
  const hoverFuel = still.fuel, hover = { ...still };
  run(30, () => fly({})(hover));
  const hoverBurn = (hoverFuel - hover.fuel) / 30;
  const level = toTopSpeed({ ...still }, fly({ forward: 1 }), flatSpeed, [], 180);
  const fast = toTopSpeed({ ...still }, fly({ forward: 1, cruise: true }), flatSpeed, [], 180);
  const stopping = { ...level.end }, x = stopping.x, z = stopping.z;
  const stop = run(120, () => (fly({ brake: true })(stopping), flatSpeed(stopping) < 0.5));
  const per = (r: TopRun<HelicopterState>): number => r.fuelPerMetre * r.top;
  return {
    movement: "rotor", top: level.top, cruise: fast.top, climb, stop, stopDistance: Math.sqrt((stopping.x - x) ** 2 + (stopping.z - z) ** 2),
    hover: p.fuelCapacity / hoverBurn, enduranceTop: p.fuelCapacity / per(level), enduranceCruise: p.fuelCapacity / per(fast),
    rangeTop: p.fuelCapacity / level.fuelPerMetre, rangeCruise: p.fuelCapacity / fast.fuelPerMetre,
  };
}

const measured = new Map<string, Handling>();

/** How a vehicle drives, measured once a build for each definition; one that differs from another by its id alone shares its figures. */
export function handlingOf(def: VehicleDefinition, driver: number): Handling {
  const key = JSON.stringify([{ ...def, id: "" }, driver]);
  let h = measured.get(key);
  if (!h) {
    h = def.movement === "rotor" ? rotorHandling(def, driver) : def.movement === "boat" ? boatHandling(def, driver) : roadHandling(def, driver);
    measured.set(key, h);
  }
  return h;
}
