// Native moving-pair geometry and world constraints, shared by authority and driver prediction.
import { quatNlerp } from '../math/quat.ts';
import { detAtan2, len3 } from '../math/scalar.ts';
import { dynamicState, type DynamicBody, type DynamicContact, type DynamicQueries, type DynamicState } from '../sim/vehicle-dynamic.ts';
import { isBoatVehicle, isWheelVehicle, isRotorVehicle, type VehicleDefinition } from '../sim/vehicle.ts';
import { carMeetsCapsule, carMeetsVehicle } from './vehicle.ts';
import { boatMeetsCapsule, boatMeetsVehicle } from './boat.ts';
import { helicopterMeetsCapsule, helicopterMeetsVehicle } from './helicopter.ts';
import { capsuleFree, ground, groundUnder, push, SKIN, type CollisionWorld } from './collide.ts';
import { boatOutboardFrame, boatShapes, carShapes, helicopterShapes } from './vehicle-shapes.ts';
import { StaticVehicleSolids } from './vehicle-solid.ts';
/** Twice the shortest quaternion half-angle, with the deterministic atan approximation's error allowed in the sweep. */
function rotationBound(a: DynamicState, b: DynamicState): number {
  const dot = Math.min(1, Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw));
  return dot === 1 ? 0 : 2 * detAtan2(Math.sqrt(1 - dot * dot), dot) + .00004;
}

export interface PairContact extends DynamicContact { rotor: boolean; propeller: boolean; otherRotor: boolean; otherPropeller: boolean }
const contact = (): PairContact => ({ t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, depth: 0, rotor: false, propeller: false, otherRotor: false, otherPropeller: false });
function rotation(s: DynamicState, q: Float64Array): void {
  q[0] = s.qx; q[1] = s.qy; q[2] = s.qz; q[3] = s.qw;
}
export class VehiclePairQueries implements DynamicQueries {
  private a!: DynamicBody; private b!: DynamicBody;
  private defA!: VehicleDefinition; private defB: VehicleDefinition | undefined;
  private radiusB = 0; private heightB = 0;
  private readonly q = new Float64Array(4); private readonly qa = new Float64Array(4); private readonly qb = new Float64Array(4);
  private readonly otherQ = new Float64Array(4); private readonly otherA = new Float64Array(4); private readonly otherB = new Float64Array(4);
  private readonly pose = dynamicState(); private readonly otherPose = dynamicState();
  private readonly hit = contact(); private readonly current = contact();
  private readonly solids: StaticVehicleSolids;
  private readonly world: CollisionWorld;
  constructor(world: CollisionWorld) { this.world = world; this.solids = new StaticVehicleSolids(world); }
  configure(a: DynamicBody, b: DynamicBody, defA: VehicleDefinition, defB: VehicleDefinition | undefined, radius: number, height: number): void {
    this.a = a; this.b = b; this.defA = defA; this.defB = defB; this.radiusB = radius; this.heightB = height;
    rotation(a.prior, this.qa); rotation(a.state, this.qb);
    rotation(b.prior, this.otherA); rotation(b.state, this.otherB);
    Object.assign(this.pose, a.state); Object.assign(this.otherPose, b.state);
  }
  /** Relative translation and both rotations bound samples; a root-finding pass refines the first actual contact. */
  sweep(): PairContact | null {
    const a = this.a.prior, b = this.a.state, c = this.b.prior, d = this.b.state;
    const radius = this.defB
      ? Math.max(len3(this.defB.spec.halfWidth, 0, this.defB.spec.halfLength), isRotorVehicle(this.defB) ? 6 : 0)
      : this.radiusB;
    const dx = b.x - a.x - (d.x - c.x), dy = b.y - a.y - (d.y - c.y), dz = b.z - a.z - (d.z - c.z);
    if (len3(c.x - a.x, 0, c.z - a.z) > 7 + radius + len3(dx, 0, dz)) return null;
    if (Math.max(a.y, b.y) + 7 < Math.min(c.y, d.y) || Math.min(a.y, b.y) - 7 > Math.max(c.y, d.y) + this.heightB) return null;
    const angle = rotationBound(a, b);
    const otherAngle = this.defB
      ? rotationBound(c, d) : 0;
    const n = Math.min(128, Math.max(1, Math.ceil((len3(dx, dy, dz) + angle * 7 + otherAngle * radius) / Math.min(.12, radius / 2))));
    for (let i = 0; i <= n; i++) {
      let t = i / n, hit = this.sample(t);
      if (!hit) continue;
      if (i > 0) {
        let lo = (i - 1) / n, hi = t;
        for (let j = 0; j < 8; j++) {
          const mid = (lo + hi) / 2;
          if (this.sample(mid)) hi = mid;
          else lo = mid;
        }
        t = hi;
        hit = this.sample(t)!;
      }
      const out = this.hit;
      out.t = t;
      out.x = hit.x!; out.y = hit.y!; out.z = hit.z!;
      out.nx = -hit.nx; out.ny = -hit.ny; out.nz = -hit.nz;
      out.depth = hit.depth ?? 0;
      out.rotor = 'rotor' in hit && hit.rotor === true;
      out.propeller = 'propeller' in hit && hit.propeller === true;
      out.otherRotor = 'otherRotor' in hit && hit.otherRotor === true;
      out.otherPropeller = 'otherPropeller' in hit && hit.otherPropeller === true;
      return out;
    }
    return null;
  }
  private sample(t: number) {
    const a = this.a.prior, b = this.a.state, c = this.b.prior, d = this.b.state, p = this.pose, o = this.otherPose;
    quatNlerp(this.q, 0, this.qa, 0, this.qb, 0, t); quatNlerp(this.otherQ, 0, this.otherA, 0, this.otherB, 0, t);
    p.x = a.x + (b.x - a.x) * t; p.y = a.y + (b.y - a.y) * t; p.z = a.z + (b.z - a.z) * t;
    p.qx = this.q[0]!; p.qy = this.q[1]!; p.qz = this.q[2]!; p.qw = this.q[3]!;
    p.steering = (a.steering ?? 0) + ((b.steering ?? 0) - (a.steering ?? 0)) * t;
    o.x = c.x + (d.x - c.x) * t; o.y = c.y + (d.y - c.y) * t; o.z = c.z + (d.z - c.z) * t;
    o.qx = this.otherQ[0]!; o.qy = this.otherQ[1]!; o.qz = this.otherQ[2]!; o.qw = this.otherQ[3]!;
    o.steering = (c.steering ?? 0) + ((d.steering ?? 0) - (c.steering ?? 0)) * t;
    return this.geometry(p, o);
  }

  geometry(a: DynamicState, b: DynamicState) {
    const def = this.defA, other = this.defB;
    return isWheelVehicle(def)
      ? other ? carMeetsVehicle(def.spec, a, other, b) : carMeetsCapsule(def.spec, a, b.x, b.y, b.z, this.radiusB, this.heightB)
      : isBoatVehicle(def)
        ? other ? boatMeetsVehicle(def, a, other, b) : boatMeetsCapsule(def, a, b.x, b.y, b.z, this.radiusB, this.heightB)
        : other ? helicopterMeetsVehicle(def, a, other, b) : helicopterMeetsCapsule(def, a, b.x, b.y, b.z, this.radiusB, this.heightB);
  }

  overlap(a: DynamicBody, b: DynamicBody): DynamicContact | null {
    const hit = this.geometry(a.state, b.state);
    if (!hit) return null;
    const out = this.current;
    out.t = 1; out.x = hit.x!; out.y = hit.y!; out.z = hit.z!; out.nx = -hit.nx; out.ny = -hit.ny; out.nz = -hit.nz; out.depth = hit.depth ?? 0;
    return out;
  }

  free(body: DynamicBody, from: Readonly<DynamicState>, blocker: Float64Array): boolean {
    const to = body.state, def = body === this.a ? this.defA : this.defB;
    if (def) {
      const shapes = isWheelVehicle(def) ? carShapes(def.spec) : isBoatVehicle(def) ? boatShapes(def) : helicopterShapes(def);
      const hit = this.solids.blocked(from, to, shapes, isBoatVehicle(def) ? [{ from: boatOutboardFrame(from, def.spec), to: boatOutboardFrame(to, def.spec) }] : undefined, true);
      if (!hit) return true;
      blocker[0] = hit.nx; blocker[1] = hit.ny; blocker[2] = hit.nz; blocker[3] = hit.x; blocker[4] = hit.y; blocker[5] = hit.z;
      return false;
    }
    const n = Math.max(1, Math.ceil(len3(to.x - from.x, to.y - from.y, to.z - from.z) / (this.radiusB * .5)));
    if (n > 64) return false;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t, world = this.world;
      if (!capsuleFree(world, x, y, z, this.radiusB, this.heightB)) {
        blocker[3] = x; blocker[4] = y; blocker[5] = z;
        if (x < 0 || z < 0 || x > world.hf.sizeX || z > world.hf.sizeZ) {
          blocker[0] = x < 0 ? 1 : x > world.hf.sizeX ? -1 : 0; blocker[2] = z < 0 ? 1 : z > world.hf.sizeZ ? -1 : 0;
          const n = len3(blocker[0]!, 0, blocker[2]!); blocker[0] /= n; blocker[2] /= n;
        } else if (y < groundUnder(world.hf, x, z, this.radiusB) - SKIN) {
          blocker[0] = ground.nx; blocker[1] = ground.ny; blocker[2] = ground.nz;
        } else {
          const n = len3(push.x, push.y, push.z);
          if (n > 0) { blocker[0] = push.x / n; blocker[1] = push.y / n; blocker[2] = push.z / n; }
        }
        return false;
      }
    }
    return true;
  }

}
