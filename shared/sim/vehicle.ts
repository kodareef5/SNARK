// Grounded wheel controller. Both authority and prediction can call this fixed-tick solver.
// Occupancy grants control; this module does not grant ownership or spend inventory items.
import { TICK_DT } from "../coords.ts";
import { clamp, detAtan2, detCos, detSin, TAU } from "../math/scalar.ts";

export interface VehicleSpec {
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly height: number;
  readonly clearance: number;
  readonly wheelbase: number;
  readonly track: number;
  readonly wheelRadius: number;
  readonly acceleration: number;
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
}

export interface VehicleSeat {
  readonly id: string;
  readonly driver?: boolean;
  readonly anchor: readonly [number, number, number];
  readonly entry: readonly [number, number, number];
}

/** Resolved mechanical data. Art and motion may be replaced without changing these seat names. */
export interface VehicleDefinition {
  readonly id: string;
  readonly spec: VehicleSpec;
  readonly seats: readonly VehicleSeat[];
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

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Presentation attitude from wheel support; the collision provider may be conservative. */
  pitch: number;
  roll: number;
  vx: number;
  vz: number;
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
  for (const v of Object.values(s)) if (!Number.isFinite(v) || v <= 0) throw new Error("invalid vehicle specification");
  if (s.clearance >= s.height || s.track > 2 * s.halfWidth || s.wheelbase > 2 * s.halfLength || s.maxSteer >= 1.2 || s.minGroundNormal > 1) {
    throw new Error("inconsistent vehicle geometry or steering limits");
  }
}

export function createVehicle(s: VehicleSpec, x: number, y: number, z: number, yaw = 0, fuel = s.fuelCapacity): VehicleState {
  validateVehicleSpec(s);
  if (![x, y, z, yaw, fuel].every(Number.isFinite) || fuel < 0 || fuel > s.fuelCapacity) throw new Error("invalid vehicle state");
  return { x, y, z, yaw, pitch: 0, roll: 0, vx: 0, vz: 0, steering: 0, wheelAngle: 0, fuel };
}

function approach(n: number, target: number, by: number): number {
  return n < target ? Math.min(n + by, target) : Math.max(n - by, target);
}

function command(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? clamp(n, lo, hi) : 0;
}

interface Support {
  y: number;
  pitch: number;
  roll: number;
  surface: VehicleSurface;
}

function support(w: VehicleWorld, s: VehicleState, p: VehicleSpec): Support | null {
  const sn = detSin(s.yaw), cs = detCos(s.yaw);
  const heights: number[] = [];
  let surface: VehicleSurface | null = null;
  // Front left, front right, rear left, rear right. The least grippy contact governs this v1 axle model.
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 === 0 ? 1 : -1) * p.track / 2;
    const z = (i < 2 ? 1 : -1) * p.wheelbase / 2;
    const c = w.support(s.x + cs * x + sn * z, s.y, s.z - sn * x + cs * z, p);
    if (!c || !Number.isFinite(c.y) || !Number.isFinite(c.normalY) || c.normalY < p.minGroundNormal || c.y - s.y > p.maxRise + 0.001 || s.y - c.y > p.maxDrop + 0.001) return null;
    if (!surface || c.surface.grip < surface.grip) surface = c.surface;
    heights.push(c.y);
  }
  const front = (heights[0]! + heights[1]!) / 2;
  const rear = (heights[2]! + heights[3]!) / 2;
  const left = (heights[0]! + heights[2]!) / 2;
  const right = (heights[1]! + heights[3]!) / 2;
  return { y: (front + rear) / 2, pitch: detAtan2(front - rear, p.wheelbase), roll: detAtan2(left - right, p.track), surface: surface! };
}

/** Four bounded substeps per 30 Hz tick. Unsupported ledges stop the grounded prototype; airborne rigid bodies are a later solver. */
export function stepVehicle(s: VehicleState, input: VehicleInput, p: VehicleSpec, w: VehicleWorld): VehicleStep {
  const result: VehicleStep = { blocked: null, impactSpeed: 0, fuelUsed: 0, surface: "unsupported" };
  const throttle = command(input.throttle, -1, 1);
  const steering = command(input.steer, -1, 1) * p.maxSteer;
  const brake = Math.max(command(input.brake, 0, 1), input.handbrake ? 1 : 0);
  const dt = TICK_DT / 4;
  const beforeFuel = s.fuel;
  for (let i = 0; i < 4; i++) {
    const ground = support(w, s, p);
    if (!ground) { result.blocked = "unsupported"; result.impactSpeed = Math.sqrt(s.vx * s.vx + s.vz * s.vz); s.vx = s.vz = 0; break; }
    s.y = ground.y; s.pitch = ground.pitch; s.roll = ground.roll;
    result.surface = ground.surface.id;
    const sn = detSin(s.yaw), cs = detCos(s.yaw);
    let forward = s.vx * sn + s.vz * cs;
    let lateral = s.vx * cs - s.vz * sn;
    s.steering = approach(s.steering, steering, p.steerRate * dt);
    const opposing = throttle * forward < -0.02;
    const powered = s.fuel > 0 && brake === 0 && !opposing;
    const demand = powered ? Math.abs(throttle) * p.fuelPerSecond * dt : 0;
    const spent = Math.min(s.fuel, demand);
    const thrust = demand > 0 ? throttle * p.acceleration * spent / demand : 0;
    // Fuel remains simulation state for replay. The host persists the committed state once, never one debit per replay.
    s.fuel -= spent;
    forward += thrust * dt;
    forward = approach(forward, 0, (p.brake * Math.max(brake, opposing ? Math.abs(throttle) : 0) + ground.surface.rolling + ground.surface.drag * forward * forward) * dt);
    forward = clamp(forward, -p.maxReverse, p.maxForward);
    lateral = approach(lateral, 0, ground.surface.grip * (input.handbrake ? 0.3 : 1) * dt);
    // Bicycle steering limited by available lateral acceleration; low-grip roads cannot turn at arbitrary speed.
    const turn = forward * (detSin(s.steering) / detCos(s.steering)) / p.wheelbase;
    const limit = ground.surface.grip / Math.max(Math.abs(forward), 0.5);
    const yawDelta = clamp(turn, -limit, limit) * dt;
    const next = { ...s };
    next.yaw = s.yaw + yawDelta;
    next.yaw -= Math.floor((next.yaw + TAU / 2) / TAU) * TAU;
    next.vx = sn * forward + cs * lateral;
    next.vz = cs * forward - sn * lateral;
    next.x += next.vx * dt;
    next.z += next.vz * dt;
    const target = support(w, next, p);
    let blocked: string | null = target ? null : "unsupported";
    if (target) {
      next.y = target.y; next.pitch = target.pitch; next.roll = target.roll;
      blocked = w.blocked(s, next, p);
    }
    if (blocked) {
      result.blocked ??= blocked;
      result.impactSpeed = Math.max(result.impactSpeed, Math.sqrt(next.vx * next.vx + next.vz * next.vz));
      s.vx = s.vz = 0;
      // Engine and steering clocks still advance for the rest of this tick against a wall.
      continue;
    }
    next.wheelAngle = s.wheelAngle + forward * dt / p.wheelRadius;
    next.wheelAngle -= Math.floor(next.wheelAngle / TAU) * TAU;
    Object.assign(s, next);
  }
  result.fuelUsed = beforeFuel - s.fuel;
  return result;
}
