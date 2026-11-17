// A moving pair's normal constraint. Ownership, harm and controller decisions are supplied by its caller.
import { len3 } from "../math/scalar.ts";
import { quatNlerp, quatRotate, quatUnrotate } from "../math/quat.ts";
import { applyVehicleImpulse, vehiclePointInverseMass, vehiclePointVelocity, type VehicleRigidSpec, type VehicleRigidState } from "./vehicle-rigid.ts";

export interface DynamicState extends VehicleRigidState { qx: number; qy: number; qz: number; qw: number }
export type DynamicResponse = "dynamic" | "protected" | "fixed";
export interface DynamicBody {
  readonly prior: DynamicState;
  readonly state: DynamicState;
  spec: VehicleRigidSpec | null;
  mass: number;
  /** Protected controllers may walk tangentially, but cannot prescribe motion through the other body. */
  response: DynamicResponse;
}
export interface DynamicContact { t: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; depth: number }
export interface DynamicQueries {
  /** Correction sweep; proposed state is in body.state. On rejection, fills outward normal then world point (six floats). */
  free(body: DynamicBody, from: Readonly<DynamicState>, blocker: Float64Array): boolean;
  /** Current pair overlap, normal A to B. Scratch is consumed before another query. */
  overlap(a: DynamicBody, b: DynamicBody): DynamicContact | null;
}
export interface DynamicResult { signedClosingSpeed: number; pointSpeedA: number; pointSpeedB: number; impulse: number; deltaSpeedA: number; deltaSpeedB: number; unresolved: boolean }
export function dynamicState(): DynamicState {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    vx: 0, vy: 0, vz: 0, pitchRate: 0, yawRate: 0, rollRate: 0, payloadMass: 0, flooding: 0 };
}
/** One scratch owner per contact runner; no temporary vectors or closures per candidate. */
export class DynamicScratch {
  readonly a = dynamicState(); readonly b = dynamicState(); readonly before = dynamicState(); readonly response = dynamicState();
  readonly wallA = new Float64Array(6); readonly wallB = new Float64Array(6); readonly blocked = new Float64Array(6);
  readonly constraintA = new Float64Array(4); readonly constraintB = new Float64Array(4);
  readonly qa = new Float64Array(4); readonly qb = new Float64Array(4); readonly q = new Float64Array(4);
  readonly va = new Float64Array(3); readonly vb = new Float64Array(3); readonly arm = new Float64Array(3); readonly point = new Float64Array(3);
}
function at(body: DynamicBody, t: number, out: DynamicState, scratch: DynamicScratch): void {
  const a = body.prior, b = body.state;
  Object.assign(out, b);
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  scratch.qa[0] = a.qx; scratch.qa[1] = a.qy; scratch.qa[2] = a.qz; scratch.qa[3] = a.qw;
  scratch.qb[0] = b.qx; scratch.qb[1] = b.qy; scratch.qb[2] = b.qz; scratch.qb[3] = b.qw;
  quatNlerp(scratch.q, 0, scratch.qa, 0, scratch.qb, 0, t);
  out.qx = scratch.q[0]!; out.qy = scratch.q[1]!; out.qz = scratch.q[2]!; out.qw = scratch.q[3]!;
}
function velocity(body: DynamicBody, state: DynamicState, hit: DynamicContact, out: Float64Array): void {
  if (body.response === "fixed") { out.fill(0); return; }
  if (body.spec) vehiclePointVelocity(state, body.spec, hit.x, hit.y, hit.z, out);
  else { out[0] = state.vx; out[1] = state.vy; out[2] = state.vz; }
}
function inverse(body: DynamicBody, state: DynamicState, hit: DynamicContact): number {
  return body.response !== "dynamic" ? 0 : body.spec
    ? vehiclePointInverseMass(state, body.spec, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz) : 1 / body.mass;
}
function impulse(body: DynamicBody, state: DynamicState, hit: DynamicContact, amount: number): void {
  if (body.response !== "dynamic") return;
  if (body.spec) applyVehicleImpulse(state, body.spec, hit.x, hit.y, hit.z, hit.nx * amount, hit.ny * amount, hit.nz * amount);
  else { state.vx += hit.nx * amount / body.mass; state.vy += hit.ny * amount / body.mass; state.vz += hit.nz * amount / body.mass; }
  const b = body.state;
  b.vx = state.vx; b.vy = state.vy; b.vz = state.vz;
  b.pitchRate = state.pitchRate; b.yawRate = state.yawRate; b.rollRate = state.rollRate;
}
function move(body: DynamicBody, nx: number, ny: number, nz: number, amount: number, world: DynamicQueries, scratch: DynamicScratch): boolean {
  if (Math.abs(amount) < 1e-8) return true;
  const s = body.state, before = scratch.before;
  Object.assign(before, s);
  s.x += nx * amount; s.y += ny * amount; s.z += nz * amount;
  scratch.blocked.fill(0);
  if (world.free(body, before, scratch.blocked)) return true;
  if (len3(scratch.blocked[0]!, scratch.blocked[1]!, scratch.blocked[2]!) < 1e-8) {
    const sign = amount > 0 ? -1 : 1;
    scratch.blocked[0] = nx * sign; scratch.blocked[1] = ny * sign; scratch.blocked[2] = nz * sign;
    scratch.blocked[3] = s.x; scratch.blocked[4] = s.y; scratch.blocked[5] = s.z;
  }
  s.x = before.x; s.y = before.y; s.z = before.z;
  return false;
}
function blockController(body: DynamicBody, contact: DynamicContact, sign: number, world: DynamicQueries, scratch: DynamicScratch): void {
  if (body.response !== "protected") return;
  const s = body.state, p = body.prior, nx = contact.nx * sign, ny = contact.ny * sign, nz = contact.nz * sign;
  const incoming = Math.max(0, (s.x - p.x) * nx + (s.y - p.y) * ny + (s.z - p.z) * nz);
  move(body, nx, ny, nz, -Math.min(incoming, incoming * (1 - contact.t) + .002), world, scratch);
  const speed = Math.max(0, s.vx * nx + s.vy * ny + s.vz * nz);
  s.vx -= nx * speed; s.vy -= ny * speed; s.vz -= nz * speed;
}
/** The contact's material point, carried from TOI to the proposed endpoint; angular motion keeps its sign. */
function advance(body: DynamicBody, contactState: DynamicState, hit: DynamicContact, scratch: DynamicScratch): number {
  const s = body.state, q = scratch.q;
  q[0] = contactState.qx; q[1] = contactState.qy; q[2] = contactState.qz; q[3] = contactState.qw;
  quatUnrotate(q, 0, hit.x - contactState.x, hit.y - contactState.y, hit.z - contactState.z, scratch.arm, 0);
  q[0] = s.qx; q[1] = s.qy; q[2] = s.qz; q[3] = s.qw;
  quatRotate(q, 0, scratch.arm[0]!, scratch.arm[1]!, scratch.arm[2]!, scratch.point, 0);
  return (s.x + scratch.point[0]! - hit.x) * hit.nx + (s.y + scratch.point[1]! - hit.y) * hit.ny + (s.z + scratch.point[2]! - hit.z) * hit.nz;
}
function rememberWall(out: Float64Array, normal: DynamicContact, scratch: DynamicScratch): void {
  const b = scratch.blocked;
  const old = Math.abs(out[0]! * normal.nx + out[1]! * normal.ny + out[2]! * normal.nz);
  const next = Math.abs(b[0]! * normal.nx + b[1]! * normal.ny + b[2]! * normal.nz);
  if (next >= old) out.set(b);
}
function separate(a: DynamicBody, b: DynamicBody, hit: DynamicContact, depth: number, world: DynamicQueries, scratch: DynamicScratch, normal: DynamicContact): boolean {
  const wa = a.response === "dynamic" ? 1 / a.mass : 0, wb = b.response === "dynamic" ? 1 / b.mass : 0, sum = wa + wb;
  if (sum === 0 || depth <= 0) return depth <= 0;
  const da = depth * wa / sum, db = depth * wb / sum;
  const movedA = move(a, hit.nx, hit.ny, hit.nz, -da, world, scratch);
  if (!movedA) rememberWall(scratch.wallA, normal, scratch);
  const movedB = move(b, hit.nx, hit.ny, hit.nz, db, world, scratch);
  if (!movedB) rememberWall(scratch.wallB, normal, scratch);
  if (!movedA && wb > 0) {
    const moved = move(b, hit.nx, hit.ny, hit.nz, da, world, scratch);
    if (!moved) rememberWall(scratch.wallB, normal, scratch); return moved;
  }
  if (!movedB && wa > 0) {
    const moved = move(a, hit.nx, hit.ny, hit.nz, -db, world, scratch);
    if (!moved) rememberWall(scratch.wallA, normal, scratch); return moved;
  }
  return movedA && movedB;
}
function separation(a: DynamicBody, b: DynamicBody, hit: DynamicContact, world: DynamicQueries, scratch: DynamicScratch, out: DynamicResult): void {
  const inward = advance(a, scratch.a, hit, scratch) - advance(b, scratch.b, hit, scratch) + hit.depth;
  out.unresolved = !separate(a, b, hit, Math.max(0, inward + .002), world, scratch, hit);
  for (let i = 0; i < 4; i++) {
    const overlap = world.overlap(a, b);
    if (!overlap || overlap.depth < .002) { out.unresolved = false; return; }
    if (!separate(a, b, overlap, overlap.depth + .002, world, scratch, hit)) { out.unresolved = true; return; }
  }
  const overlap = world.overlap(a, b); out.unresolved = !!overlap && overlap.depth >= .002;
}

function wallImpulse(body: DynamicBody, state: DynamicState, wall: Float64Array, amount: number): void {
  if (body.spec) applyVehicleImpulse(state, body.spec, wall[3]!, wall[4]!, wall[5]!, wall[0]! * amount, wall[1]! * amount, wall[2]! * amount);
  else { state.vx += wall[0]! * amount / body.mass; state.vy += wall[1]! * amount / body.mass; state.vz += wall[2]! * amount / body.mass; }
  const s = body.state;
  s.vx = state.vx; s.vy = state.vy; s.vz = state.vz;
  s.pitchRate = state.pitchRate; s.yawRate = state.yawRate; s.rollRate = state.rollRate;
}
/** Point compliance along the pair/world normals, including their coupling through the body's inertia. */
function constraint(body: DynamicBody, state: DynamicState, hit: DynamicContact, wall: Float64Array, sign: number, scratch: DynamicScratch, out: Float64Array): void {
  const nn = inverse(body, state, hit);
  out[0] = nn; out[1] = out[2] = out[3] = 0;
  if (nn === 0 || wall[0] === 0 && wall[1] === 0 && wall[2] === 0) return;
  const wx = wall[0]!, wy = wall[1]!, wz = wall[2]!, x = wall[3]!, y = wall[4]!, z = wall[5]!;
  const ww = body.spec ? vehiclePointInverseMass(state, body.spec, x, y, z, wx, wy, wz) : 1 / body.mass;
  const v = scratch.va;
  if (body.spec) vehiclePointVelocity(state, body.spec, x, y, z, v);
  else { v[0] = state.vx; v[1] = state.vy; v[2] = state.vz; }
  const inward = v[0]! * wx + v[1]! * wy + v[2]! * wz;
  if (inward < 0) wallImpulse(body, state, wall, -inward / ww);
  let nw: number;
  if (body.spec) {
    const response = scratch.response;
    Object.assign(response, state); response.vx = response.vy = response.vz = response.pitchRate = response.yawRate = response.rollRate = 0;
    applyVehicleImpulse(response, body.spec, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
    vehiclePointVelocity(response, body.spec, x, y, z, v);
    nw = v[0]! * wx + v[1]! * wy + v[2]! * wz;
  } else nw = (hit.nx * wx + hit.ny * wy + hit.nz * wz) / body.mass;
  // A contact impulse pulling away from the world needs no reaction there.
  if (nw * sign >= 0) return;
  out[1] = nw; out[2] = ww; out[3] = Math.max(0, inward);
}
/** Pure pair response: no forces are stepped twice, and correction distance never becomes kinetic energy. */
export function resolveDynamicContact(a: DynamicBody, b: DynamicBody, hit: DynamicContact, world: DynamicQueries, scratch: DynamicScratch, out: DynamicResult): void {
  scratch.wallA.fill(0); scratch.wallB.fill(0);
  at(a, hit.t, scratch.a, scratch); at(b, hit.t, scratch.b, scratch);
  blockController(a, hit, 1, world, scratch); blockController(b, hit, -1, world, scratch);
  // A protected walker's stopped inward input cannot act as an infinite-mass motor pushing a car.
  if (a.response === "protected") { scratch.a.vx = a.state.vx; scratch.a.vy = a.state.vy; scratch.a.vz = a.state.vz; }
  if (b.response === "protected") { scratch.b.vx = b.state.vx; scratch.b.vy = b.state.vy; scratch.b.vz = b.state.vz; }
  // Discover unavailable motion before choosing effective mass. Otherwise a light body pressed into a wall
  // keeps a car's forward speed while every positional correction puts the car back in the same place.
  separation(a, b, hit, world, scratch, out);
  constraint(a, scratch.a, hit, scratch.wallA, -1, scratch, scratch.constraintA);
  constraint(b, scratch.b, hit, scratch.wallB, 1, scratch, scratch.constraintB);
  velocity(a, scratch.a, hit, scratch.va); velocity(b, scratch.b, hit, scratch.vb);
  const closing = (scratch.va[0]! - scratch.vb[0]!) * hit.nx + (scratch.va[1]! - scratch.vb[1]!) * hit.ny + (scratch.va[2]! - scratch.vb[2]!) * hit.nz;
  out.pointSpeedA = scratch.va[0]! * hit.nx + scratch.va[1]! * hit.ny + scratch.va[2]! * hit.nz;
  out.pointSpeedB = -(scratch.vb[0]! * hit.nx + scratch.vb[1]! * hit.ny + scratch.vb[2]! * hit.nz);
  const ca = scratch.constraintA, cb = scratch.constraintB, inv = ca[0]! + cb[0]!;
  const desired = Math.max(0, closing) * (closing > 2 ? 1.12 : 1);
  let j = inv > 0 ? desired / inv : 0, wallA = false, wallB = false;
  // At most two unilateral world reactions. A body already retreating from its wall must first lose that
  // outward speed; treating it as a prescribed moving wall would inject energy into the other body.
  for (let i = 0; i < 2; i++) {
    const nextA: boolean = wallA || ca[2]! > 0 && ca[3]! - j * ca[1]! < 0;
    const nextB: boolean = wallB || cb[2]! > 0 && cb[3]! + j * cb[1]! < 0;
    if (nextA === wallA && nextB === wallB) break;
    wallA = nextA; wallB = nextB;
    const effective = inv - (wallA ? ca[1]! * ca[1]! / ca[2]! : 0) - (wallB ? cb[1]! * cb[1]! / cb[2]! : 0);
    const bias = (wallA ? -ca[1]! * ca[3]! / ca[2]! : 0) + (wallB ? cb[1]! * cb[3]! / cb[2]! : 0);
    j = effective > inv * 1e-10 ? Math.max(0, desired + bias) / effective
      : Math.max(wallA ? ca[3]! / ca[1]! : 0, wallB ? -cb[3]! / cb[1]! : 0);
  }
  out.signedClosingSpeed = closing; out.impulse = j;
  const ax = scratch.a.vx, ay = scratch.a.vy, az = scratch.a.vz, bx = scratch.b.vx, by = scratch.b.vy, bz = scratch.b.vz;
  impulse(a, scratch.a, hit, -j); impulse(b, scratch.b, hit, j);
  if (wallA) wallImpulse(a, scratch.a, scratch.wallA, Math.max(0, j * ca[1]! - ca[3]!) / ca[2]!);
  if (wallB) wallImpulse(b, scratch.b, scratch.wallB, Math.max(0, -j * cb[1]! - cb[3]!) / cb[2]!);
  out.deltaSpeedA = len3(scratch.a.vx - ax, scratch.a.vy - ay, scratch.a.vz - az);
  out.deltaSpeedB = len3(scratch.b.vx - bx, scratch.b.vy - by, scratch.b.vz - bz);
}
