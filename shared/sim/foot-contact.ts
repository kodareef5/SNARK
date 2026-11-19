// A body on foot that a session drives meets each vehicle as its snapshots show it: a fixed solid at the position and
// attitude the view carries (shared/net/view.ts), never the server's unrounded pose. The server, right after the body's
// step, and the page predicting it, after its own, so meet the same solid to the bit: a vehicle that stands costs no
// correction. What a vehicle does in its own step this tick is the server's sweep (server/vehicle-contacts.ts), which
// the page learns of from the next snapshot.
import { len3 } from "../math/scalar.ts";
import type { Registry } from "../content/registry.ts";
import { CAPSULE_EXTENT, VehiclePairQueries } from "../world/vehicle-pair.ts";
import { vehicleSolidRadius } from "../world/vehicle-shapes.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { Body, MODE_GHOST, MODE_NONE, stanceHeight, type MoveParams } from "./character.ts";
import { unpackVehicleSteering } from "./vehicle-body.ts";
import { dynamicState, DynamicScratch, resolveDynamicContact, type DynamicBody, type DynamicResult, type DynamicState } from "./vehicle-dynamic.ts";
import { unpackVehicleQuaternion } from "./vehicle-presentation.ts";

/**
 * Metres the body is met early, past the vehicle's hull: more than the view's rounding of a pose (1/512 m an axis, and
 * its attitude to 1/32767), so the server's sweep of a vehicle that stands finds the body clear of its true hull.
 */
export const FOOT_SKIN = 0.01;

const wider = (a: Uint32Array): Uint32Array => { const b = new Uint32Array(a.length * 2); b.set(a); return b; };
const widerFloat = (a: Float64Array): Float64Array => { const b = new Float64Array(a.length * 2); b.set(a); return b; };

/**
 * Vehicles round a body, in ascending entity index, the order both ends meet them in: where each stands in metres, as
 * the view rounds it (`dequantX(quantX(x))`), and its pose and attitude words as the view packs them.
 */
export class FootVehicles {
  count = 0;
  index = new Uint32Array(16);
  kind = new Uint32Array(16);
  x = new Float64Array(16);
  y = new Float64Array(16);
  z = new Float64Array(16);
  pose = new Uint32Array(16);
  attitudeA = new Uint32Array(16);
  attitudeB = new Uint32Array(16);

  push(index: number, kind: number, x: number, y: number, z: number, pose: number, attitudeA: number, attitudeB: number): void {
    const n = this.count;
    if (n === this.index.length) {
      this.index = wider(this.index); this.kind = wider(this.kind); this.x = widerFloat(this.x); this.y = widerFloat(this.y); this.z = widerFloat(this.z);
      this.pose = wider(this.pose); this.attitudeA = wider(this.attitudeA); this.attitudeB = wider(this.attitudeB);
    }
    this.index[n] = index; this.kind[n] = kind; this.x[n] = x; this.y[n] = y; this.z[n] = z;
    this.pose[n] = pose; this.attitudeA[n] = attitudeA; this.attitudeB[n] = attitudeB;
    this.count = n + 1;
  }
}

const body = (response: DynamicBody["response"]): DynamicBody => ({ prior: dynamicState(), state: dynamicState(), spec: null, mass: 1, response });
function upright(s: DynamicState, x: number, y: number, z: number): void {
  s.x = x; s.y = y; s.z = z; s.qx = s.qy = s.qz = 0; s.qw = 1;
  s.pitchRate = s.yawRate = s.rollRate = 0; s.yaw = s.pitch = s.roll = 0; s.payloadMass = s.flooding = s.steering = 0;
}

export class FootContacts {
  /** The farthest any vehicle's solid reaches from its origin. */
  readonly reach: number;
  private readonly reg: Registry;
  private readonly pair: VehiclePairQueries;
  private readonly vehicle = body("fixed");
  private readonly walker = body("protected");
  private readonly scratch = new DynamicScratch();
  private readonly result: DynamicResult = { signedClosingSpeed: 0, pointSpeedA: 0, pointSpeedB: 0, impulse: 0, deltaSpeedA: 0, deltaSpeedB: 0, unresolved: false };
  private readonly q = new Float64Array(4);

  constructor(world: CollisionWorld, reg: Registry) {
    this.reg = reg;
    this.pair = new VehiclePairQueries(world);
    let reach = 0;
    for (const def of reg.vehicle) if (def) reach = Math.max(reach, vehicleSolidRadius(def));
    this.reach = reach;
  }

  /**
   * Meets `b`, stepped this tick from `before` with `p`, with the vehicles listed: each stops what of its motion goes into
   * it, as a protected body is stopped (shared/sim/vehicle-dynamic.ts), and is not moved by it. Whether it met any.
   */
  meet(before: Body, b: Body, p: MoveParams, list: FootVehicles): boolean {
    if (list.count === 0 || b.mode === MODE_GHOST || b.mode === MODE_NONE) return false;
    const w = this.walker, from = w.prior, to = w.state, r = p.radius, h = stanceHeight(p, b.stance);
    upright(from, before.x, before.y, before.z);
    upright(to, b.x, b.y, b.z);
    to.vx = b.vx; to.vy = b.vy; to.vz = b.vz;
    // A body moved farther than a step can is placed, not walking: what it was placed among is the server's to settle.
    if (len3(to.x - from.x, to.y - from.y, to.z - from.z) > r * 8 + .05) return false;
    const v = this.vehicle, q = this.q;
    let met = false;
    for (let i = 0; i < list.count; i++) {
      const def = this.reg.vehicle[list.kind[i]!];
      if (!def) continue;
      const x = list.x[i]!, y = list.y[i]!, z = list.z[i]!;
      const reach = vehicleSolidRadius(def) + (r + FOOT_SKIN) * CAPSULE_EXTENT + .05;
      if (x + reach < Math.min(from.x, to.x) || x - reach > Math.max(from.x, to.x) || z + reach < Math.min(from.z, to.z) || z - reach > Math.max(from.z, to.z) ||
          y + reach < Math.min(from.y, to.y) || y - reach > Math.max(from.y, to.y) + h) continue;
      const s = v.state;
      upright(s, x, y, z);
      unpackVehicleQuaternion(list.attitudeA[i]!, list.attitudeB[i]!, q);
      s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
      s.steering = unpackVehicleSteering(list.pose[i]!);
      s.vx = s.vy = s.vz = 0;
      Object.assign(v.prior, s);
      v.spec = def.spec;
      this.pair.configure(v, w, def, undefined, r, h, FOOT_SKIN);
      const hit = this.pair.sweep();
      if (!hit) continue;
      resolveDynamicContact(v, w, hit, this.pair, this.scratch, this.result);
      met = true;
    }
    if (!met) return false;
    b.x = Math.fround(to.x); b.y = Math.fround(to.y); b.z = Math.fround(to.z);
    b.vx = Math.fround(to.vx); b.vy = Math.fround(to.vy); b.vz = Math.fround(to.vz);
    if (b.vy > .01) b.grounded = false;
    return true;
  }
}
