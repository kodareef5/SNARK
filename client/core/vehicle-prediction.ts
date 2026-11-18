// Driver-local replicas of authority-selected contact bodies. Damage, ownership and death stay authoritative.
import type { Registry } from '../../shared/content/registry.ts';
import { TICK_DT } from '../../shared/coords.ts';
import { makeHandle } from '../../shared/ids.ts';
import { quatNlerp } from '../../shared/math/quat.ts';
import { contactBody, contactProxy, contactRelevant, contactHorizon, contactReach, type ContactProxy, type ContactSnapshot } from '../../shared/net/contact.ts';
import { Body, BTN_JUMP } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { dynamicState, DynamicScratch, resolveDynamicContact, type DynamicBody, type DynamicResult, type DynamicState } from '../../shared/sim/vehicle-dynamic.ts';
import { integrateVehiclePose, vehicleMassProperties } from '../../shared/sim/vehicle-rigid.ts';
import type { PredictedTrees } from './vehicle-trees.ts';
import type { VehicleDefinition } from '../../shared/sim/vehicle.ts';
import { groundUnder, type CollisionWorld } from '../../shared/world/collide.ts';
import { VehiclePairQueries } from '../../shared/world/vehicle-pair.ts';
import type { RemoteSample } from './session.ts';
import { VehicleCorrection } from './vehicle-correction.ts';

interface Proxy {
  fact: ContactProxy;
  body: DynamicBody;
  native: Body;
  tick: number;
  seen: number;
  visual: boolean;
  fadeIn: boolean;
  sx: number; sy: number; sz: number;
  oldX: number; oldY: number; oldZ: number;
  correction: VehicleCorrection;
  active: boolean; physical: boolean; prepared: boolean; withdrawing: boolean; exit: number; lastContact: number;
  dx: number; dy: number; dz: number; dq: Float64Array; exitQ: Float64Array;
  history: DynamicState[]; historyTick: Int32Array;
  trees?: PredictedTrees;
}
const dynamicBody = (): DynamicBody => ({ prior: dynamicState(), state: dynamicState(), spec: null, mass: 1, response: 'dynamic' });
function rounded(s: DynamicState): void {
  s.x = Math.fround(s.x); s.y = Math.fround(s.y); s.z = Math.fround(s.z);
  s.vx = Math.fround(s.vx); s.vy = Math.fround(s.vy); s.vz = Math.fround(s.vz);
  s.pitchRate = Math.fround(s.pitchRate); s.yawRate = Math.fround(s.yawRate); s.rollRate = Math.fround(s.rollRate);
}
export class VehiclePrediction {
  readonly stats = { contacts: 0, lastTick: 0, lastTarget: 0, proxies: 0, truncated: false, steps: 0, replays: 0 };
  private readonly proxies = new Map<number, Proxy>();
  private readonly own = dynamicBody();
  private readonly pair: VehiclePairQueries;
  private readonly scratch = new DynamicScratch();
  private readonly result: DynamicResult = {
    signedClosingSpeed: 0, pointSpeedA: 0, pointSpeedB: 0, impulse: 0,
    deltaSpeedA: 0, deltaSpeedB: 0, unresolved: false,
  };
  private readonly blocker = new Float64Array(6);
  private readonly qa = new Float64Array(4);
  private readonly qb = new Float64Array(4);
  private readonly drawQ = new Float64Array(4);
  private readonly presentation = dynamicState();
  private readonly used = new Set<number>();
  /** Replacing or withdrawing target facts can change already predicted inputs, even if the driver's baseline matches. */
  needsReplay = false;
  private snapshotTick = 0;
  // Keep traffic on the ordinary interpolation clock when fresh facts routinely arrive with too little
  // time left for the next snapshot. The lower re-entry threshold prevents oscillation with tick jitter.
  private trafficLead = true;
  private owner = 0;
  private epoch = 0;
  private replaying = false;
  private readonly treeBodies = new WeakMap<DynamicBody, PredictedTrees>();
  private readonly treeFactory?: () => PredictedTrees;

  private readonly world: CollisionWorld;
  private readonly registry: Registry;

  constructor(world: CollisionWorld, registry: Registry, treeFactory?: () => PredictedTrees, ownTrees?: PredictedTrees) {
    this.world = world;
    this.treeFactory = treeFactory;
    this.registry = registry;
    if (ownTrees) this.treeBodies.set(this.own, ownTrees);
    this.pair = new VehiclePairQueries(world, (body, ref) => this.treeBodies.get(body)?.omits(ref) ?? false);
  }

  /** Returns true for a qualified own-body discontinuity, including a teleport smaller than the fade limit. */
  accept(snapshot: ContactSnapshot, own?: Body, tick = snapshot.tick, alpha = 1): boolean {
    const discontinuity = snapshot.owner !== this.owner || snapshot.epoch !== this.epoch;
    if (discontinuity) { this.proxies.clear(); this.trafficLead = true; }
    const age = tick - snapshot.tick;
    if (age >= 9) this.trafficLead = false;
    else if (age <= 6) this.trafficLead = true;
    this.owner = snapshot.owner; this.epoch = snapshot.epoch; this.snapshotTick = snapshot.tick;
    this.stats.truncated = snapshot.truncated; this.needsReplay = false;
    const def = own && this.registry.vehicle[own.kind];
    for (let i = 0; i < snapshot.count; i++) {
      const fact = snapshot.rows[i]!;
      if (!this.registry.move[fact.kind] || fact.vehicle !== !!this.registry.vehicle[fact.kind] ||
          def && !contactRelevant(own!, fact, contactReach(def), fact.vehicle ? 1.5 : .5)) continue;
      const physical = !def || contactRelevant(own!, fact, contactReach(def));
      let p = this.proxies.get(fact.handle);
      const fresh = !p, teleport = !!p && p.fact.epoch !== fact.epoch;
      if (!p) {
        // Visual withdrawal rows are retained briefly, but cannot grow without a bound as neighbours rotate.
        if (this.proxies.size >= 32) {
          for (const [handle, old] of this.proxies) if (!old.active) { this.proxies.delete(handle); break; }
          if (this.proxies.size >= 32) continue;
        }
        p = {
          fact: contactProxy(), body: dynamicBody(), native: new Body(), tick: 0, seen: 0,
          visual: false, fadeIn: true, sx: 0, sy: 0, sz: 0, oldX: 0, oldY: 0, oldZ: 0,
          correction: new VehicleCorrection(), active: true, physical, prepared: false, withdrawing: false, exit: 0, lastContact: 0,
          dx: 0, dy: 0, dz: 0, dq: new Float64Array([0, 0, 0, 1]), exitQ: new Float64Array(4),
          history: Array.from({ length: 16 }, dynamicState), historyTick: new Int32Array(16),
          trees: fact.vehicle ? this.treeFactory?.() : undefined,
        };
        this.proxies.set(fact.handle, p);
        if (p.trees) this.treeBodies.set(p.body, p.trees);
      }
      const wasPhysical = p.physical;
      if (p.visual && !p.withdrawing && (!physical || !wasPhysical)) {
        this.capturePresentation(p, alpha, tick); p.prepared = physical;
      }
      const index = snapshot.tick & 15, known = p.historyTick[index] === snapshot.tick ? p.history[index]! : p.fact.state;
      const changed = fresh || teleport || !p.active || physical !== wasPhysical || p.fact.parkingBrake !== fact.parkingBrake || p.fact.grounded !== fact.grounded || p.fact.kind !== fact.kind || p.fact.response !== fact.response || p.fact.radius !== fact.radius || p.fact.height !== fact.height ||
        p.fact.mass !== fact.mass || p.fact.body.vehicleGroundPitch !== fact.body.vehicleGroundPitch ||
        p.fact.body.vehicleGroundRoll !== fact.body.vehicleGroundRoll || p.fact.body.vehicleRideOffset !== fact.body.vehicleRideOffset ||
        p.fact.body.vehicleRideVelocity !== fact.body.vehicleRideVelocity || !sameMotion(known, fact.state);
      if (physical && changed || !physical && wasPhysical && p.lastContact > snapshot.tick) this.needsReplay = true;
      if (teleport) {
        p.visual = false; p.withdrawing = false; p.fadeIn = false; p.sx = p.sy = p.sz = 0; p.correction.reset(); p.historyTick.fill(0);
      }
      const state = p.fact.state, full = p.fact.body;
      Object.assign(p.fact, fact); p.fact.state = state; p.fact.body = full;
      Object.assign(state, fact.state); full.copy(fact.body);
      p.body.response = fact.response; p.body.mass = fact.mass; p.body.spec = this.registry.vehicle[fact.kind]?.spec ?? null;
      p.seen = snapshot.tick; p.active = true; p.physical = physical;
      if (fresh || teleport || !physical || !changed && p.tick < snapshot.tick) this.resetProxy(p);
      if (p.visual && !p.withdrawing && !physical) this.reconcilePresentation(p, alpha, tick);
    }
    for (const p of this.proxies.values()) if (p.active && p.seen !== snapshot.tick) {
      // Only a withdrawn body that already caused a future impact can change an otherwise exact own replay.
      if (p.lastContact > snapshot.tick) this.needsReplay = true;
      p.active = false;
    }
    this.stats.proxies = 0;
    for (const p of this.proxies.values()) if (p.active) this.stats.proxies++;
    return discontinuity;
  }

  /** Accepting a packet does not throw away a matching future. Reset only when the owner really rewinds. */
  beginReplay(alpha = 1): void {
    this.replaying = true; this.stats.replays++;
    for (const p of this.proxies.values()) {
      if (!p.active || !p.physical) continue;
      if (p.prepared || p.withdrawing) { p.prepared = false; this.resetProxy(p); continue; }
      const s = p.body.state, a = p.body.prior;
      p.oldX = a.x + (s.x - a.x) * alpha; p.oldY = a.y + (s.y - a.y) * alpha; p.oldZ = a.z + (s.z - a.z) * alpha;
      this.interpolateQ(p, alpha);
      p.correction.captureQuaternion(this.drawQ[0]!, this.drawQ[1]!, this.drawQ[2]!, this.drawQ[3]!);
      this.resetProxy(p);
    }
  }
  private resetProxy(p: Proxy): void {
    p.native.copy(p.fact.body);
    Object.assign(p.body.state, p.fact.state); Object.assign(p.body.prior, p.fact.state);
    p.tick = p.seen;
    p.trees?.acknowledge(p.seen);
  }

  /** Called once after own-body replay. Only new raw error, not an existing clock fade, can trigger a snap. */
  finishReplay(alpha = 1): void {
    if (!this.replaying) return;
    this.replaying = false;
    for (const p of this.proxies.values()) {
      if (!p.visual || !p.active || !p.physical || p.withdrawing) continue;
      const s = p.body.state, a = p.body.prior;
      const dx = p.oldX - (a.x + (s.x - a.x) * alpha), dy = p.oldY - (a.y + (s.y - a.y) * alpha), dz = p.oldZ - (a.z + (s.z - a.z) * alpha);
      const continuous = dx * dx + dy * dy + dz * dz < 144;
      if (continuous) { p.sx += dx; p.sy += dy; p.sz += dz; }
      else p.sx = p.sy = p.sz = 0;
      this.interpolateQ(p, alpha);
      p.correction.reconcileQuaternion(this.drawQ[0]!, this.drawQ[1]!, this.drawQ[2]!, this.drawQ[3]!, continuous);
    }
  }

  update(dtMs: number): void {
    const keep = Math.exp(-dtMs / 90);
    for (const p of this.proxies.values()) {
      // Bound the extra visual speed of a large correction; small corrections keep the ordinary 90ms decay.
      const offset = Math.sqrt(p.sx * p.sx + p.sy * p.sy + p.sz * p.sz);
      const bounded = Math.max(keep, 1 - dtMs * .008 / Math.max(.001, offset));
      p.sx *= bounded; p.sy *= bounded; p.sz *= bounded;
      p.correction.update(dtMs);
      if (p.withdrawing) p.exit *= keep;
    }
  }

  step(tick: number, before: Body, body: Body, def: VehicleDefinition): void {
    // Slow actors have 200ms of observed motion; standing bodies and vehicles have at most 400ms. No private intent is guessed.
    if (!this.proxies.size || tick - this.snapshotTick > 12) return;
    const handle = this.owner, own = this.own;
    contactBody(before, own.prior);
    contactBody(body, own.state);
    own.spec = def.spec;
    own.mass = vehicleMassProperties(def.spec, own.state).mass;
    for (const p of this.proxies.values()) {
      if (!p.physical || !this.live(p, tick)) continue;
      const other = this.registry.vehicle[p.fact.kind] ?? undefined;
      this.pair.configure(own, p.body, def, other, p.fact.radius, p.fact.height);
      while (p.tick < tick) { this.advance(p, other); p.tick++; }
    }
    this.used.clear();
    for (let iteration = 0; iteration < 4; iteration++) {
      let first: Proxy | undefined, firstTime = Infinity;
      for (const [target, p] of this.proxies) {
        if (target === handle || this.used.has(target) || !p.physical || !this.live(p, tick)) continue;
        const other = this.registry.vehicle[p.fact.kind] ?? undefined;
        this.pair.configure(own, p.body, def, other, p.fact.radius, p.fact.height);
        const hit = this.pair.sweep();
        if (hit && (hit.t < firstTime || hit.t === firstTime && target < (first?.fact.handle ?? Infinity))) {
          first = p;
          firstTime = hit.t;
        }
      }
      if (!first) break;
      const target = first.fact.handle, other = this.registry.vehicle[first.fact.kind] ?? undefined;
      // Vehicle pairs share the host's canonical handle ordering; actors always follow their vehicle.
      const reverse = !!other && target < handle;
      if (reverse) this.pair.configure(first.body, own, other!, def, this.registry.move[body.kind]!.radius, def.spec.height);
      else this.pair.configure(own, first.body, def, other, first.fact.radius, first.fact.height);
      const hit = this.pair.sweep();
      if (!hit) break;
      if (reverse) resolveDynamicContact(first.body, own, hit, this.pair, this.scratch, this.result);
      else resolveDynamicContact(own, first.body, hit, this.pair, this.scratch, this.result);
      rounded(own.state);
      rounded(first.body.state);
      if (first.body.state.vy > .01) first.native.grounded = false;
      this.used.add(target);
      first.lastContact = tick;
      this.stats.contacts++;
      this.stats.lastTick = tick;
      this.stats.lastTarget = target;
    }
    for (const p of this.proxies.values()) if (p.physical && this.live(p, tick)) {
      const i = tick & 15; Object.assign(p.history[i]!, p.body.state); p.historyTick[i] = tick;
    }
    // Presence alone must never alter a kerb/ramp controller's grounded state.
    if (!this.used.size) return;
    const s = own.state;
    body.x = s.x; body.y = s.y; body.z = s.z;
    body.vx = s.vx; body.vy = s.vy; body.vz = s.vz;
    body.vehiclePitchRate = s.pitchRate; body.vehicleYawRate = s.yawRate; body.vehicleRollRate = s.rollRate;
    if (body.vy > .01) body.grounded = false;
  }

  private advance(p: Proxy, def: VehicleDefinition | undefined): void {
    const b = p.body, s = b.state, prior = b.prior;
    Object.assign(prior, s);
    if (b.response === 'fixed') return;
    if (def && def.movement !== 'rotor' && def.movement !== 'boat') {
      // Stationary support needs no repeated suspension solve until a contact changes its motion.
      if (p.native.grounded && Math.abs(s.vx) + Math.abs(s.vy) + Math.abs(s.vz) + Math.abs(s.pitchRate) + Math.abs(s.yawRate) + Math.abs(s.rollRate) < .001) return;
      const native = p.native;
      native.x = s.x; native.y = s.y; native.z = s.z; native.vx = s.vx; native.vy = s.vy; native.vz = s.vz;
      native.vehiclePitchRate = s.pitchRate; native.vehicleYawRate = s.yawRate; native.vehicleRollRate = s.rollRate;
      native.vehicleQx = s.qx; native.vehicleQy = s.qy; native.vehicleQz = s.qz; native.vehicleQw = s.qw;
      p.trees?.begin(p.tick + 1, p.fact.handle);
      this.stats.steps++;
      stepVehicleBody(this.world, native, 0, 0, p.fact.parkingBrake ? BTN_JUMP : 0, def, TICK_DT, 0, false, p.trees);
      contactBody(native, s);
      return;
    }
    this.stats.steps++;
    if (def) integrateVehiclePose(s, def.spec, TICK_DT);
    else { s.x += s.vx * TICK_DT; s.y += s.vy * TICK_DT; s.z += s.vz * TICK_DT; }
    if (!def && p.fact.grounded) s.y = Math.max(s.y, groundUnder(this.world.hf, s.x, s.z, p.fact.radius));
    this.blocker.fill(0);
    if (!this.pair.free(b, prior, this.blocker)) {
      const nx = this.blocker[0]!, ny = this.blocker[1]!, nz = this.blocker[2]!;
      const into = Math.min(0, s.vx * nx + s.vy * ny + s.vz * nz);
      s.vx -= into * nx; s.vy -= into * ny; s.vz -= into * nz;
      s.x = prior.x + s.vx * TICK_DT; s.y = prior.y + s.vy * TICK_DT; s.z = prior.z + s.vz * TICK_DT;
      s.qx = prior.qx; s.qy = prior.qy; s.qz = prior.qz; s.qw = prior.qw;
      if (!this.pair.free(b, prior, this.blocker)) { s.x = prior.x; s.y = prior.y; s.z = prior.z; }
    }
    rounded(s);
  }

  /** Far approaching vehicles share public-motion presentation before they are physical collision candidates. */
  private presentationAt(p: Proxy, alpha: number, tick: number): DynamicState {
    const out = this.presentation;
    if (p.physical) {
      const a = p.body.prior, b = p.body.state;
      Object.assign(out, b);
      out.x = a.x + (b.x - a.x) * alpha; out.y = a.y + (b.y - a.y) * alpha; out.z = a.z + (b.z - a.z) * alpha;
      this.interpolateQ(p, alpha); out.qx = this.drawQ[0]!; out.qy = this.drawQ[1]!; out.qz = this.drawQ[2]!; out.qw = this.drawQ[3]!;
    } else {
      Object.assign(out, p.fact.state);
      const dt = Math.max(0, Math.min(12, tick - 1 + alpha - p.seen)) * TICK_DT;
      integrateVehiclePose(out, this.registry.vehicle[p.fact.kind]!.spec, dt);
    }
    return out;
  }
  private capturePresentation(p: Proxy, alpha: number, tick: number): void {
    const s = this.presentationAt(p, alpha, tick);
    p.oldX = s.x; p.oldY = s.y; p.oldZ = s.z;
    p.correction.captureQuaternion(s.qx, s.qy, s.qz, s.qw);
  }
  private reconcilePresentation(p: Proxy, alpha: number, tick: number): void {
    const s = this.presentationAt(p, alpha, tick);
    p.sx += p.oldX - s.x; p.sy += p.oldY - s.y; p.sz += p.oldZ - s.z;
    p.correction.reconcileQuaternion(s.qx, s.qy, s.qz, s.qw, true);
  }
  private interpolateQ(p: Proxy, alpha: number): void {
    const a = p.body.prior, b = p.body.state;
    this.qa[0] = a.qx; this.qa[1] = a.qy; this.qa[2] = a.qz; this.qa[3] = a.qw;
    this.qb[0] = b.qx; this.qb[1] = b.qy; this.qb[2] = b.qz; this.qb[3] = b.qw;
    quatNlerp(this.drawQ, 0, this.qa, 0, this.qb, 0, alpha);
  }
  private live(p: Proxy, tick: number): boolean {
    return p.active && contactHorizon(p.fact) > 0 && tick - p.seen <= contactHorizon(p.fact);
  }

  /** Vehicles cross between current driving and delayed view clocks in both directions. Actors stay on their view clock. */
  draw(out: RemoteSample, index: number, alpha: number, tick: number): void {
    const handle = makeHandle(out.id[index]!, out.gen[index]!), p = this.proxies.get(handle);
    if (!p || !p.fact.vehicle) return;
    if (!this.trafficLead || !this.live(p, tick)) {
      if (!p.visual) { if (!p.active) this.proxies.delete(handle); return; }
      if (!p.withdrawing) {
        p.withdrawing = true; p.exit = 1; p.exitQ.set(p.dq);
        p.sx = p.dx - out.x[index]!; p.sy = p.dy - out.y[index]!; p.sz = p.dz - out.z[index]!;
      }
      // Keep travelling with the interpolated body as its clock takes over. The same bounded
      // correction decay handles exits and entries, including a lengthy gap between updates.
      if (p.exit < .001 && Math.hypot(p.sx, p.sy, p.sz) < .001) { p.visual = false; if (!p.active) this.proxies.delete(handle); return; }
      out.x[index]! += p.sx; out.y[index]! += p.sy; out.z[index]! += p.sz;
      this.qa[0] = out.vehicleQx[index]!; this.qa[1] = out.vehicleQy[index]!; this.qa[2] = out.vehicleQz[index]!; this.qa[3] = out.vehicleQw[index]!;
      quatNlerp(this.drawQ, 0, this.qa, 0, p.exitQ, 0, p.exit);
    } else {
      const b = this.presentationAt(p, alpha, tick), x = b.x, y = b.y, z = b.z;
      if (p.withdrawing) {
        // The withdrawal offset belongs to the ordinary view. Rebase once at the actual last displayed pose,
        // even if fresh physical facts were accepted/replayed several times before this frame.
        p.withdrawing = false; p.exit = 0;
        p.sx = p.dx - x; p.sy = p.dy - y; p.sz = p.dz - z;
        p.correction.reset(); p.correction.captureQuaternion(p.dq[0]!, p.dq[1]!, p.dq[2]!, p.dq[3]!);
        p.correction.reconcileQuaternion(b.qx, b.qy, b.qz, b.qw, true);
      }
      if (!p.visual) {
        p.visual = true;
        if (p.fadeIn) { p.sx = out.x[index]! - x; p.sy = out.y[index]! - y; p.sz = out.z[index]! - z; }
        p.correction.captureQuaternion(out.vehicleQx[index]!, out.vehicleQy[index]!, out.vehicleQz[index]!, out.vehicleQw[index]!);
        p.correction.reconcileQuaternion(b.qx, b.qy, b.qz, b.qw, p.fadeIn); p.fadeIn = true;
      }
      out.x[index] = x + p.sx; out.y[index] = y + p.sy; out.z[index] = z + p.sz;
      this.drawQ[0] = b.qx; this.drawQ[1] = b.qy; this.drawQ[2] = b.qz; this.drawQ[3] = b.qw; p.correction.apply(this.drawQ);
    }
    p.dx = out.x[index]!; p.dy = out.y[index]!; p.dz = out.z[index]!; p.dq.set(this.drawQ);
    const qx = this.drawQ[0]!, qy = this.drawQ[1]!, qz = this.drawQ[2]!, qw = this.drawQ[3]!;
    out.vehicleQx[index] = qx; out.vehicleQy[index] = qy; out.vehicleQz[index] = qz; out.vehicleQw[index] = qw;
    out.yaw[index] = Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));
  }
}

function sameMotion(a: DynamicState, b: DynamicState): boolean {
  return Math.abs((a.steering ?? 0) - (b.steering ?? 0)) < .001 && Math.abs(a.x - b.x) < .005 && Math.abs(a.y - b.y) < .005 && Math.abs(a.z - b.z) < .005 &&
    Math.abs(a.vx - b.vx) < .01 && Math.abs(a.vy - b.vy) < .01 && Math.abs(a.vz - b.vz) < .01 &&
    Math.abs(a.qx - b.qx) < .0001 && Math.abs(a.qy - b.qy) < .0001 && Math.abs(a.qz - b.qz) < .0001 && Math.abs(a.qw - b.qw) < .0001 &&
    Math.abs(a.pitchRate - b.pitchRate) < .001 && Math.abs(a.yawRate - b.yawRate) < .001 && Math.abs(a.rollRate - b.rollRate) < .001;
}
