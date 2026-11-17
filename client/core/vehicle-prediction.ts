// Driver-local replicas of authority-selected contact bodies. Damage, ownership and death stay authoritative.
import type { Registry } from '../../shared/content/registry.ts';
import { TICK_DT } from '../../shared/coords.ts';
import { makeHandle } from '../../shared/ids.ts';
import { quatNlerp } from '../../shared/math/quat.ts';
import { contactBody, contactProxy, type ContactProxy, type ContactSnapshot } from '../../shared/net/contact.ts';
import { Body, stepBody } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { dynamicState, DynamicScratch, resolveDynamicContact, type DynamicBody, type DynamicResult, type DynamicState } from '../../shared/sim/vehicle-dynamic.ts';
import { integrateVehiclePose, vehicleMassProperties } from '../../shared/sim/vehicle-rigid.ts';
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
}
const dynamicBody = (): DynamicBody => ({ prior: dynamicState(), state: dynamicState(), spec: null, mass: 1, response: 'dynamic' });
function rounded(s: DynamicState): void {
  s.x = Math.fround(s.x); s.y = Math.fround(s.y); s.z = Math.fround(s.z);
  s.vx = Math.fround(s.vx); s.vy = Math.fround(s.vy); s.vz = Math.fround(s.vz);
  s.pitchRate = Math.fround(s.pitchRate); s.yawRate = Math.fround(s.yawRate); s.rollRate = Math.fround(s.rollRate);
}
export class VehiclePrediction {
  readonly stats = { contacts: 0, lastTick: 0, lastTarget: 0, proxies: 0, truncated: false };
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
  private readonly used = new Set<number>();
  /** Replacing or withdrawing target facts can change already predicted inputs, even if the driver's baseline matches. */
  needsReplay = false;
  private snapshotTick = 0;
  private owner = 0;
  private epoch = 0;

  private readonly world: CollisionWorld;
  private readonly registry: Registry;

  constructor(world: CollisionWorld, registry: Registry) {
    this.world = world;
    this.registry = registry;
    this.pair = new VehiclePairQueries(world);
  }

  /** Returns true for a qualified own-body discontinuity, including a teleport smaller than the fade limit. */
  accept(snapshot: ContactSnapshot): boolean {
    const hadTargets = this.proxies.size > 0;
    const discontinuity = snapshot.owner !== this.owner || snapshot.epoch !== this.epoch;
    if (discontinuity) this.proxies.clear();
    this.owner = snapshot.owner;
    this.epoch = snapshot.epoch;
    this.snapshotTick = snapshot.tick;
    this.stats.truncated = snapshot.truncated;
    for (let i = 0; i < snapshot.count; i++) {
      const fact = snapshot.rows[i]!;
      if (!this.registry.move[fact.kind] || fact.vehicle !== !!this.registry.vehicle[fact.kind]) continue;
      let p = this.proxies.get(fact.handle);
      if (!p) {
        p = {
          fact: contactProxy(), body: dynamicBody(), native: new Body(), tick: 0, seen: 0,
          visual: false, fadeIn: true, sx: 0, sy: 0, sz: 0, oldX: 0, oldY: 0, oldZ: 0,
          correction: new VehicleCorrection(),
        };
        this.proxies.set(fact.handle, p);
      } else if (p.fact.epoch !== fact.epoch) {
        // A target teleport must not animate back through the old contact location.
        p.visual = false;
        p.fadeIn = false;
        p.sx = p.sy = p.sz = 0;
        p.correction.reset();
        Object.assign(p.body.state, fact.state);
      }
      const before = p.body.state;
      p.oldX = before.x; p.oldY = before.y; p.oldZ = before.z;
      p.correction.captureQuaternion(before.qx, before.qy, before.qz, before.qw);
      const state = p.fact.state, full = p.fact.body;
      Object.assign(p.fact, fact);
      p.fact.state = state; p.fact.body = full;
      Object.assign(state, fact.state);
      full.copy(fact.body);
      p.native.copy(full);
      Object.assign(p.body.state, state);
      Object.assign(p.body.prior, state);
      p.body.response = fact.response;
      p.body.mass = fact.mass;
      p.body.spec = this.registry.vehicle[fact.kind]?.spec ?? null;
      p.tick = p.seen = snapshot.tick;
    }
    for (const [handle, p] of this.proxies) {
      if (p.seen !== snapshot.tick) this.proxies.delete(handle);
    }
    this.stats.proxies = this.proxies.size;
    this.needsReplay = discontinuity || hadTargets || this.proxies.size > 0;
    return discontinuity;
  }

  /** Called once after own-body replay. Only new raw error, not an existing clock fade, can trigger a snap. */
  finishReplay(): void {
    for (const p of this.proxies.values()) {
      if (!p.visual) continue;
      const s = p.body.state, dx = p.oldX - s.x, dy = p.oldY - s.y, dz = p.oldZ - s.z;
      const continuous = dx * dx + dy * dy + dz * dz < 9;
      if (continuous) { p.sx += dx; p.sy += dy; p.sz += dz; }
      else p.sx = p.sy = p.sz = 0;
      p.correction.reconcileQuaternion(s.qx, s.qy, s.qz, s.qw, continuous);
    }
  }

  update(dtMs: number): void {
    const keep = Math.exp(-dtMs / 90);
    for (const p of this.proxies.values()) {
      p.sx *= keep; p.sy *= keep; p.sz *= keep;
      p.correction.update(dtMs);
    }
  }

  step(tick: number, before: Body, body: Body, def: VehicleDefinition): void {
    // Hold the last observed controls for at most 400ms. Beyond that, fall back to authority.
    if (!this.proxies.size || tick - this.snapshotTick > 12) return;
    const handle = this.owner, own = this.own;
    contactBody(before, own.prior);
    contactBody(body, own.state);
    own.spec = def.spec;
    own.mass = vehicleMassProperties(def.spec, own.state).mass;
    for (const p of this.proxies.values()) {
      const other = this.registry.vehicle[p.fact.kind] ?? undefined;
      this.pair.configure(own, p.body, def, other, p.fact.radius, p.fact.height);
      while (p.tick < tick) { this.advance(p, other); p.tick++; }
    }
    this.used.clear();
    for (let iteration = 0; iteration < 4; iteration++) {
      let first: Proxy | undefined, firstTime = Infinity;
      for (const [target, p] of this.proxies) {
        if (target === handle || this.used.has(target)) continue;
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
      this.used.add(target);
      this.stats.contacts++;
      this.stats.lastTick = tick;
      this.stats.lastTarget = target;
    }
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
    if (p.fact.native) {
      const native = p.native, input = p.fact;
      native.x = s.x; native.y = s.y; native.z = s.z;
      native.vx = s.vx; native.vy = s.vy; native.vz = s.vz;
      native.vehiclePitchRate = s.pitchRate; native.vehicleYawRate = s.yawRate; native.vehicleRollRate = s.rollRate;
      if (s.vy > .01) native.grounded = false;
      if (def) stepVehicleBody(this.world, native, input.moveX, input.moveZ, input.buttons, def, TICK_DT, input.yaw, input.pilot);
      else stepBody(this.world, native, input.moveX, input.moveZ, input.yaw, input.pitch, input.buttons,
        (input.tamed ? this.registry.tamedMove[input.kind] : this.registry.move[input.kind])!, TICK_DT);
      contactBody(native, s);
      return;
    }
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

  /** Near-driver targets share the driving clock, instead of colliding against a target drawn 100ms in the past. */
  draw(out: RemoteSample, index: number, alpha: number, tick: number): void {
    if (tick - this.snapshotTick > 12) return;
    const p = this.proxies.get(makeHandle(out.id[index]!, out.gen[index]!));
    if (!p) return;
    const a = p.body.prior, b = p.body.state;
    const x = a.x + (b.x - a.x) * alpha, y = a.y + (b.y - a.y) * alpha, z = a.z + (b.z - a.z) * alpha;
    if (!p.visual) {
      p.visual = true;
      if (p.fadeIn) {
        p.sx = out.x[index]! - x; p.sy = out.y[index]! - y; p.sz = out.z[index]! - z;
      }
      p.correction.captureQuaternion(out.vehicleQx[index]!, out.vehicleQy[index]!, out.vehicleQz[index]!, out.vehicleQw[index]!);
      p.correction.reconcileQuaternion(b.qx, b.qy, b.qz, b.qw, p.fadeIn);
      p.fadeIn = true;
    }
    out.x[index] = x + p.sx; out.y[index] = y + p.sy; out.z[index] = z + p.sz;
    if (p.fact.vehicle) {
      this.qa[0] = a.qx; this.qa[1] = a.qy; this.qa[2] = a.qz; this.qa[3] = a.qw;
      this.qb[0] = b.qx; this.qb[1] = b.qy; this.qb[2] = b.qz; this.qb[3] = b.qw;
      quatNlerp(this.drawQ, 0, this.qa, 0, this.qb, 0, alpha);
      p.correction.apply(this.drawQ);
      const qx = this.drawQ[0]!, qy = this.drawQ[1]!, qz = this.drawQ[2]!, qw = this.drawQ[3]!;
      out.vehicleQx[index] = qx!; out.vehicleQy[index] = qy!; out.vehicleQz[index] = qz!; out.vehicleQw[index] = qw!;
      out.yaw[index] = Math.atan2(2 * (qx! * qz! + qw! * qy!), 1 - 2 * (qx! * qx! + qy! * qy!));
    }
  }
}
