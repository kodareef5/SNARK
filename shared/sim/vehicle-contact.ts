// Bounded native point contacts shared by freely tilting cars and boats. No damage or propulsion policy lives here.
import { quatNlerp, quatUnrotate } from "../math/quat.ts";
import { len3 } from "../math/scalar.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import { applyVehicleImpulse, integrateVehiclePose, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity, type VehicleRigidSpec } from "./vehicle-rigid.ts";
import type { VehicleContact, VehicleState } from "./vehicle.ts";

export interface VehicleContactQueries<S extends VehicleState, C extends VehicleContact = VehicleContact> {
  contact(from: Readonly<S>, to: Readonly<S>): C | null;
  penetration(at: Readonly<S>): C | null;
  steeringJoint?: boolean;
  onContact?(contact: C): void;
  /** Returns the absorbed equivalent impact speed when the obstacle changed, or null for its ordinary response. */
  breakContact?(state: S, contact: C): number | null;
}
export interface VehicleContactStep { blocked: string | null; impactSpeed: number; landSpeed?: number }
const manifold = new Float64Array(12);
const q = new Float64Array(4), qa = new Float64Array(4), qb = new Float64Array(4), pointV = new Float64Array(3);
const localPoint = new Float64Array(3);

export function separateVehicleOverlap<S extends VehicleState>(s: S, w: VehicleContactQueries<S>): void {
  for (let correction = 0; correction < 3; correction++) {
    const hit = w.penetration(s); if (!hit || (hit.depth ?? 0) < .002) return;
    const amount = Math.min(.04, (hit.depth ?? 0) + .001);
    const at = { ...s, x: s.x + hit.nx * amount, y: s.y + hit.ny * amount, z: s.z + hit.nz * amount };
    // The native query permits only non-deepening escape, checked independently against every obstacle.
    if (w.contact(s, at)) return;
    s.x = at.x; s.y = at.y; s.z = at.z;
  }
}

/** Returns true only when every bounded linear remainder sweep was obstructed. */
export function resolveVehicleContacts<S extends VehicleState, C extends VehicleContact>(s: S, prior: S, p: VehicleRigidSpec, w: VehicleContactQueries<S, C>, dt: number, result: VehicleContactStep): boolean {
  let start = prior, remaining = dt;
  let nx = 0, ny = 0, nz = 0;
  for (let iteration = 0; iteration < 4; iteration++) {
    const raw = w.contact(start, s);
    if (!raw) return false;
    const hit = { ...raw }; let pointCount = 0;
    const savePoints = (contact: VehicleContact): void => {
      pointCount = Math.min(4, contact.points?.length ?? 0);
      for (let i = 0; i < pointCount; i++) {
        const p = contact.points![i]!; manifold[i * 3] = p.x; manifold[i * 3 + 1] = p.y; manifold[i * 3 + 2] = p.z;
      }
    };
    savePoints(raw);
    result.blocked ??= hit.reason;
    const target = { ...s }, at = { ...s };
    vehicleRotation(start, qa); vehicleRotation(target, qb);
    let low = 0, high = 1;
    const touching = p.wheelbase === undefined ? null : w.contact(start, start);
    const atStart = touching && touching.reason === hit.reason && touching.nx * hit.nx + touching.ny * hit.ny + touching.nz * hit.nz > .99;
    if (atStart) { Object.assign(hit, touching); savePoints(touching); }
    let same = 0, opposite = 0;
    for (let i = 0; i < 4; i++) {
      const difference = qa[i]! - qb[i]!, sum = qa[i]! + qb[i]!;
      same += difference * difference; opposite += sum * sum;
    }
    const travel = len3(target.x - start.x, target.y - start.y, target.z - start.z) +
      2 * len3(p.halfWidth, p.height, p.halfLength) * Math.sqrt(Math.min(same, opposite));
    // A resting push whose whole hull moves less than the skin needs no seven-round TOI search. The same
    // signed impulse and checked tangent remainder still apply, so reverse/slide remain real geometry queries.
    for (let search = 0; !atStart && (p.wheelbase === undefined || travel > .004) && search < 7; search++) {
      const t = (low + high) / 2; quatNlerp(q, 0, qa, 0, qb, 0, t);
      at.x = start.x + (target.x - start.x) * t; at.y = start.y + (target.y - start.y) * t; at.z = start.z + (target.z - start.z) * t;
      at.qx = q[0]!; at.qy = q[1]!; at.qz = q[2]!; at.qw = q[3]!;
      if (w.steeringJoint) at.steering = start.steering + (target.steering - start.steering) * t;
      const contact = w.contact(start, at);
      if (contact) { high = t; Object.assign(hit, contact); savePoints(contact); } else low = t;
    }
    quatNlerp(q, 0, qa, 0, qb, 0, low);
    s.x = start.x + (target.x - start.x) * low; s.y = start.y + (target.y - start.y) * low; s.z = start.z + (target.z - start.z) * low;
    s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
    if (w.steeringJoint) s.steering = start.steering + (target.steering - start.steering) * low;
    w.onContact?.(hit);
    const broken = w.breakContact?.(s, hit);
    if (broken !== undefined && broken !== null) {
      if (result.landSpeed !== undefined && hit.ny > .4) result.landSpeed = Math.max(result.landSpeed, broken);
      else result.impactSpeed = Math.max(result.impactSpeed, broken);
      remaining *= 1 - low; start = { ...s };
      // A fractured obstacle may leave a stump. Its replacement and everything beyond it still take the
      // same bounded sweep; exhausting the contact budget keeps the last tested pose.
      integrateVehiclePose(s, p, remaining);
      continue;
    }
    const gx = hit.geometryNx ?? hit.nx, gy = hit.geometryNy ?? hit.ny, gz = hit.geometryNz ?? hit.nz;
    const repeated = iteration > 0 && nx * gx + ny * gy + nz * gz > .999;
    nx = gx; ny = gy; nz = gz;
    if (low < .01 && (!atStart || (hit.depth ?? 0) > .002)) {
      const overlap = w.penetration(s);
      if (overlap && (overlap.depth ?? 0) > .002) {
        const depth = Math.min(.02, (overlap.depth ?? 0) - .002);
        const corrected = { ...s, x: s.x + overlap.nx * depth, y: s.y + overlap.ny * depth, z: s.z + overlap.nz * depth };
        if (!w.contact(s, corrected)) { s.x = corrected.x; s.y = corrected.y; s.z = corrected.z; }
      }
    }
    if (!pointCount) { manifold[0] = hit.x ?? s.x; manifold[1] = hit.y ?? s.y + p.height * .35; manifold[2] = hit.z ?? s.z; }
    const closing = respond(s, p, hit, Math.max(1, pointCount));
    if (closing > .01) {
      // Wheel cars distinguish upward support/underbody contacts from wall crashes. Boats keep their existing impact channel.
      if (result.landSpeed !== undefined && hit.ny > .4) result.landSpeed = Math.max(result.landSpeed, closing);
      else result.impactSpeed = Math.max(result.impactSpeed, closing);
    }
    if (hit.ny > .4) s.grounded = true;
    remaining *= 1 - low;
    start = { ...s };
    // Re-querying the same resting face cannot improve a negligible time fraction. Finish with its velocity
    // constraint instead of spending every bisection round while force grows against an unchanged pose.
    if (repeated && low < .01 && closing < .05) break;
    integrateVehiclePose(s, p, remaining);
  }
  // Exhausting the local contact budget retains the last tested pose and the physically resolved velocities.
  s.x = start.x; s.y = start.y; s.z = start.z; s.qx = start.qx; s.qy = start.qy; s.qz = start.qz; s.qw = start.qw;
  if (w.steeringJoint) s.steering = start.steering;
  const slide = { ...s, x: s.x + s.vx * remaining, y: s.y + s.vy * remaining, z: s.z + s.vz * remaining };
  if (!w.contact(s, slide)) { s.x = slide.x; s.y = slide.y; s.z = slide.z; return false; }
  // The point may separate through rotation while the COM still enters the face. If that rotation was
  // rejected, the stored translation must obey the same constraint as the pose. Each additional face is
  // checked before accepting the tangent remainder; projections can only remove linear kinetic energy.
  for (let face = 0; face < 3; face++) {
    const into = Math.min(0, s.vx * nx + s.vy * ny + s.vz * nz);
    slide.x = s.x + (s.vx - into * nx) * remaining; slide.y = s.y + (s.vy - into * ny) * remaining; slide.z = s.z + (s.vz - into * nz) * remaining;
    s.vx -= into * nx; s.vy -= into * ny; s.vz -= into * nz;
    vehicleRotation(s, q);
    if (into < 0 && ny > .4 && p.wheelbase !== undefined && 1 - 2 * (q[0]! * q[0]! + q[2]! * q[2]!) < .5) {
      // Rejecting an unexecuted rotation can leave a COM support impulse to enforce here. It carries the same
      // finite Coulomb friction as an ordinary contact; a projection without friction lets resting hulls skate.
      const grip = .45;
      const normal = s.vx * nx + s.vy * ny + s.vz * nz;
      const tx = s.vx - normal * nx, ty = s.vy - normal * ny, tz = s.vz - normal * nz, tangent = len3(tx, ty, tz);
      const keep = tangent > 0 ? Math.max(0, 1 + into * grip / tangent) : 0;
      s.vx = normal * nx + tx * keep; s.vy = normal * ny + ty * keep; s.vz = normal * nz + tz * keep;
      slide.x = s.x + s.vx * remaining; slide.y = s.y + s.vy * remaining; slide.z = s.z + s.vz * remaining;
    }
    const next = w.contact(s, slide);
    if (!next) { s.x = slide.x; s.y = slide.y; s.z = slide.z; return false; }
    nx = next.geometryNx ?? next.nx; ny = next.geometryNy ?? next.ny; nz = next.geometryNz ?? next.nz;
  }
  // Every remaining linear direction was rejected by real geometry. Callers may retire that unexecuted
  // translation rather than carrying it as momentum while a resting hull stays at the same pose.
  return true;
}

const rows = new Float64Array(24);
/** Accumulated unilateral impulses over an actual support patch. Friction cannot exceed its normal load. */
function respond<S extends VehicleState>(s: S, p: VehicleRigidSpec, hit: VehicleContact, count: number): number {
  let closing = 0; rows.fill(0);
  vehicleRotation(s, q);
  // Upright cars already receive tyre friction. Their chamfered underbody slides across kerb/deck edges;
  // an overturned chassis and a boat retain hull-on-ground grip for resting support.
  const uprightCar = p.wheelbase !== undefined && 1 - 2 * (q[0]! * q[0]! + q[2]! * q[2]!) > .5;
  quatUnrotate(q, 0, (hit.x ?? s.x) - s.x, (hit.y ?? s.y) - s.y, (hit.z ?? s.z) - s.z, localPoint, 0);
  // Road pitch damping cannot hold a car up on its bumper: outside an ordinary driving attitude,
  // its real off-centre support must remain free to tip the chassis under gravity.
  const pitchPatch = uprightCar && 1 - 2 * (q[0]! * q[0]! + q[2]! * q[2]!) > .8 && hit.ny > .7 &&
    Math.abs(localPoint[0]!) < p.halfWidth * .25 && Math.abs(s.rollRate) < .2;
  const friction = hit.ny > .4 ? uprightCar ? pitchPatch ? .04 : .12 : .45 : .12;
  for (let i = 0; i < count; i++) {
    const x = manifold[i * 3]!, y = manifold[i * 3 + 1]!, z = manifold[i * 3 + 2]!;
    vehiclePointVelocity(s, p, x, y, z, pointV);
    const speed = Math.max(0, -(pointV[0]! * hit.nx + pointV[1]! * hit.ny + pointV[2]! * hit.nz));
    closing = Math.max(closing, speed); rows[i * 6] = speed > 2 ? speed * (hit.restitution ?? .12) : 0;
    rows[i * 6 + 5] = vehiclePointInverseMass(s, p, x, y, z, hit.nx, hit.ny, hit.nz);
  }
  for (let pass = 0; pass < (count > 1 ? 6 : 1); pass++) for (let index = 0; index < count; index++) {
    const i = pass % 2 ? count - index - 1 : index, row = i * 6, x = manifold[i * 3]!, y = manifold[i * 3 + 1]!, z = manifold[i * 3 + 2]!;
    vehiclePointVelocity(s, p, x, y, z, pointV);
    const vn = pointV[0]! * hit.nx + pointV[1]! * hit.ny + pointV[2]! * hit.nz;
    const next = Math.max(0, rows[row + 1]! + (rows[row]! - vn) / rows[row + 5]!), delta = next - rows[row + 1]!;
    rows[row + 1] = next; applyVehicleImpulse(s, p, x, y, z, hit.nx * delta, hit.ny * delta, hit.nz * delta);
    vehiclePointVelocity(s, p, x, y, z, pointV);
    const normal = pointV[0]! * hit.nx + pointV[1]! * hit.ny + pointV[2]! * hit.nz;
    const tx = pointV[0]! - normal * hit.nx, ty = pointV[1]! - normal * hit.ny, tz = pointV[2]! - normal * hit.nz, tangent = len3(tx, ty, tz);
    if (tangent < 1e-8) continue;
    const stop = tangent / vehiclePointInverseMass(s, p, x, y, z, tx / tangent, ty / tangent, tz / tangent);
    let jx = rows[row + 2]! - tx / tangent * stop, jy = rows[row + 3]! - ty / tangent * stop, jz = rows[row + 4]! - tz / tangent * stop;
    const length = len3(jx, jy, jz), limit = next * friction, scale = length > limit ? limit / length : 1;
    jx *= scale; jy *= scale; jz *= scale;
    applyVehicleImpulse(s, p, x, y, z, jx - rows[row + 2]!, jy - rows[row + 3]!, jz - rows[row + 4]!);
    rows[row + 2] = jx; rows[row + 3] = jy; rows[row + 4] = jz;
  }
  if (pitchPatch) {
    let load = 0; for (let i = 0; i < count; i++) load += rows[i * 6 + 1]!;
    // A loaded underbody patch dissipates pitch through deformation rather than behaving as a frictionless
    // pin. Bound that angular impulse by the measured normal impulse; airborne momentum and roll stay free.
    const limit = load * p.halfLength * .6 / vehicleMassProperties(p, s).ix;
    s.pitchRate -= Math.max(-limit, Math.min(limit, s.pitchRate));
  }
  return closing;
}
