// The three passes of `nav.ring` (nav.ts) over a ring of headings in the world's frame, each kept by pool slot and
// refreshed at its own rate. Far: where each heading leads (the goal, the way, the prey's path, the trail back). Mid: what
// the next seconds along it hold (free run at knee and chest, drops, climbs, water, bodies). Near: what is within reach
// of the body (solid ahead, bodies, the wall it presses on). A cached pass is kept in 127ths, so a filled ring and one
// read back are the same numbers.

import { MID_SECONDS, MID_SPANS, NEAR_SPANS, RING_FAR, RING_MID, RING_NEAR } from "../../shared/decide/profiles.ts";
import { span, unit } from "../../shared/decide/units.ts";
import type { MoveParams } from "../../shared/sim/character.ts";
import { GROUND_OFF, GROUND_SOLID, groundAt } from "../../shared/world/path.ts";
import { castWorld, rayHit } from "../../shared/world/ray.ts";
import { WAY_ON, type Behavior } from "../behavior.ts";
import type { BodyBlocking } from "../blocking.ts";
import type { ServerWorld } from "../world.ts";
import { TICK_RATE } from "../../shared/coords.ts";

export const FAR_W = RING_FAR.columns.length;
export const MID_W = RING_MID.columns.length;
export const NEAR_W = RING_NEAR.columns.length;
export const NEVER = -(2 ** 30);

/** The columns a pass keeps; the rest (`held`, `tried`, `pressed`) are found each time. */
const FAR_KEPT = ["goal", "way", "threat", "prey", "home", "trail", "pull"] as const;
const MID_KEPT = ["run", "runHigh", "drop", "rise", "wet", "hurt", "crowd"] as const;
const FAR_AT = FAR_KEPT.map((n) => RING_FAR.c[n]);
const MID_AT = MID_KEPT.map((n) => RING_MID.c[n]);
const NEAR_OPEN = RING_NEAR.c.open, NEAR_BODY = RING_NEAR.c.body, NEAR_PRESSED = RING_NEAR.c.pressed;
const FK = FAR_KEPT.length, MK = MID_KEPT.length;
/** Metres of the world's grain: the path cell. */
const GRAIN = 1;
/** Seconds between refreshes of the near pass, which a span is measured by. */
const REACT = 5 / TICK_RATE;
/** Of the body's height, where the knee and the chest rays run. */
const KNEE = 0.3;
const CHEST = 0.75;
/** Metres the mid pass looks at most, however fast the mover. */
const MID_MOST = 20;
/** Points along a heading where the mid pass reads the ground and the water, and the depth that counts as wet. */
const MID_SAMPLES = 8;
const WET = 0.1;
/** Metres the near pass's capsule is tried ahead of the body, at least, and the share of its radius tried where it touches. */
const CONTACT = 0.3;
const CONTACT_RADIUS = 0.8;
/** Points of the trail kept, one a think, and metres from where it stands that a point must be to be the way back. */
const TRAIL = 8;
const TRAIL_AWAY = 2;
/** Seconds of the prey's run that a hunter leads it by, at most. */
const LEAD_MOST = 2;

const q = (v: number): number => Math.round((v < -1 ? -1 : v > 1 ? 1 : v) * 127);

export class Rings {
  readonly farAt: Int32Array;
  readonly midAt: Int32Array;
  readonly nearAt: Int32Array;
  /** Where the goal was when the far ring was filled. */
  readonly farGX: Float32Array;
  readonly farGZ: Float32Array;
  /** 1 while something was within reach at the last near pass. */
  readonly close: Uint8Array;
  private readonly farC: Int8Array;
  private readonly midC: Int8Array;
  private readonly nearC: Int8Array;
  private readonly nearMask: Uint8Array;
  private readonly trailX: Float32Array;
  private readonly trailZ: Float32Array;
  private readonly trailAt: Int32Array;
  private readonly trailN: Uint8Array;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly blocking: BodyBlocking;
  private readonly k: number;
  private readonly dx: Float64Array;
  private readonly dz: Float64Array;
  // The mover being asked about (`begin`).
  private e = 0;
  private p: MoveParams | null = null;
  private x = 0;
  private z = 0;
  private pace = 0;
  private sp = 1;
  private mode = 0;
  private deep = 0;

  constructor(world: ServerWorld, mind: Behavior, blocking: BodyBlocking, n: number, k: number, dx: Float64Array, dz: Float64Array) {
    this.world = world;
    this.mind = mind;
    this.blocking = blocking;
    this.k = k;
    this.dx = dx;
    this.dz = dz;
    this.farAt = new Int32Array(n).fill(NEVER);
    this.midAt = new Int32Array(n).fill(NEVER);
    this.nearAt = new Int32Array(n).fill(NEVER);
    this.farGX = new Float32Array(n);
    this.farGZ = new Float32Array(n);
    this.close = new Uint8Array(n);
    this.farC = new Int8Array(n * k * FK);
    this.midC = new Int8Array(n * k * MK);
    this.nearC = new Int8Array(n * k * 2);
    this.nearMask = new Uint8Array(n * k);
    this.trailX = new Float32Array(n * TRAIL);
    this.trailZ = new Float32Array(n * TRAIL);
    this.trailAt = new Int32Array(n).fill(NEVER);
    this.trailN = new Uint8Array(n);
  }

  /** Empties slot `s` for a mover standing at (x, z). */
  clear(s: number, x: number, z: number): void {
    this.farAt[s] = this.midAt[s] = this.nearAt[s] = NEVER;
    this.close[s] = 0;
    this.trailN[s] = 0;
    this.trailAt[s] = NEVER;
    this.trace(s, x, z, NEVER + 1);
  }

  /** Copies what slot `from` holds into slot `to`. */
  copy(from: number, to: number): void {
    const k = this.k;
    this.farAt[to] = this.farAt[from]!;
    this.midAt[to] = this.midAt[from]!;
    this.nearAt[to] = this.nearAt[from]!;
    this.farGX[to] = this.farGX[from]!;
    this.farGZ[to] = this.farGZ[from]!;
    this.close[to] = this.close[from]!;
    this.farC.copyWithin(to * k * FK, from * k * FK, (from + 1) * k * FK);
    this.midC.copyWithin(to * k * MK, from * k * MK, (from + 1) * k * MK);
    this.nearC.copyWithin(to * k * 2, from * k * 2, (from + 1) * k * 2);
    this.nearMask.copyWithin(to * k, from * k, (from + 1) * k);
  }

  /** Adds where it stands to its trail, once a think; the oldest point goes. */
  trace(s: number, x: number, z: number, tick: number): void {
    if (tick - this.trailAt[s]! < 15) return;
    this.trailAt[s] = tick;
    const at = s * TRAIL;
    this.trailX.copyWithin(at + 1, at, at + TRAIL - 1);
    this.trailZ.copyWithin(at + 1, at, at + TRAIL - 1);
    this.trailX[at] = x;
    this.trailZ[at] = z;
    if (this.trailN[s]! < TRAIL) this.trailN[s]!++;
  }

  /** Sets the mover the next fills are for: `p` its body, `pace` the speed it means to go, `mode` and `deep` (its rung). */
  begin(e: number, p: MoveParams, pace: number, mode: number, deep: number): void {
    const ents = this.world.ents;
    this.e = e;
    this.p = p;
    this.x = ents.x[e]!;
    this.z = ents.z[e]!;
    this.pace = pace;
    this.sp = span(p.radius, GRAIN, pace, REACT);
    this.mode = mode;
    this.deep = deep;
  }

  /** The far pass: the cosine of each heading with the goal, the way, the prey's path and, deep in trouble, the trail back. */
  fillFar(s: number, tick: number): void {
    const want = this.mind.want, ents = this.world.ents, k = this.k, x = this.x, z = this.z;
    let gx = want.x - x, gz = want.z - z;
    let gd = Math.hypot(gx, gz);
    if (this.mode === 0 || gd < 0.5) gd = 0;
    let wx = 0, wz = 0, wd = 0;
    if (want.way === WAY_ON) {
      wx = want.wx - x;
      wz = want.wz - z;
      wd = Math.hypot(wx, wz);
    }
    // Where the prey will be when the hunter gets there, as far as LEAD_MOST ahead.
    let px = 0, pz = 0, pd = 0;
    if (this.mode === 3 && want.prey >= 0 && gd > 0) {
      const lead = Math.min(LEAD_MOST, gd / this.pace);
      px = gx + ents.vx[want.prey]! * lead;
      pz = gz + ents.vz[want.prey]! * lead;
      pd = Math.hypot(px, pz);
    }
    // Back the way it came: the oldest point of its trail far enough off.
    let tx = 0, tz = 0, td = 0;
    if (this.deep >= 3) {
      for (let i = this.trailN[s]! - 1; i >= 0 && td === 0; i--) {
        tx = this.trailX[s * TRAIL + i]! - x;
        tz = this.trailZ[s * TRAIL + i]! - z;
        const d = Math.hypot(tx, tz);
        if (d >= TRAIL_AWAY) td = d;
      }
    }
    if (gd > 0) {
      gx /= gd;
      gz /= gd;
    }
    for (let i = 0; i < k; i++) {
      const at = (s * k + i) * FK, dx = this.dx[i]!, dz = this.dz[i]!;
      this.farC[at] = gd > 0 ? q(gx * dx + gz * dz) : 0;
      this.farC[at + 1] = wd > 0.1 ? q((wx * dx + wz * dz) / wd) : 0;
      this.farC[at + 2] = 0;
      this.farC[at + 3] = pd > 0.1 ? q((px * dx + pz * dz) / pd) : 0;
      this.farC[at + 4] = 0;
      this.farC[at + 5] = td > 0 ? q((tx * dx + tz * dz) / td) : 0;
      this.farC[at + 6] = 0;
    }
    this.farAt[s] = tick;
    this.farGX[s] = want.x;
    this.farGZ[s] = want.z;
  }

  /** The mid pass: the free run at knee and chest from the body's edge, the ground and water along it, and bodies in it. */
  fillMid(s: number, tick: number): void {
    const world = this.world, hf = world.hf, ents = world.ents, k = this.k, p = this.p!, e = this.e, x = this.x, z = this.z, sp = this.sp;
    const r = p.radius, run = Math.min(this.pace * MID_SECONDS, MID_MOST);
    const ground = hf.heightAt(x, z), knee = ground + KNEE * p.height, chest = ground + CHEST * p.height;
    const spans = MID_SPANS * sp;
    const bodies = this.blocking.around(e, x, ents.y[e]!, z, run, ents.team[e]!, true, this.mind.targetOf(e));
    for (let i = 0; i < k; i++) {
      const at = (s * k + i) * MK, dx = this.dx[i]!, dz = this.dz[i]!, ox = x + dx * r, oz = z + dz * r;
      castWorld(world, ox, knee, oz, dx, 0, dz, run, true);
      const low = rayHit.t;
      castWorld(world, ox, chest, oz, dx, 0, dz, run, true);
      const high = rayHit.t;
      // The ground and the water as far as its knee runs free, and a span at least.
      const look = r + (low > sp ? low : sp), step = look / MID_SAMPLES;
      let drop = 0, rise = 0, wet = 0;
      for (let j = 1; j <= MID_SAMPLES; j++) {
        const px = x + dx * step * j, pz = z + dz * step * j, g = hf.heightAt(px, pz);
        if (ground - g > drop) drop = ground - g;
        if (g - ground > rise) rise = g - ground;
        if (hf.waterAt(px, pz) - g > WET) wet += step;
      }
      let crowd = 0;
      for (let b = 0; bodies !== null && b < bodies.count; b++) {
        const bx = (bodies.ax[b]! + bodies.bx[b]!) / 2 - x, bz = (bodies.az[b]! + bodies.bz[b]!) / 2 - z;
        const along = bx * dx + bz * dz, side = bx * dz - bz * dx;
        const wide = r + bodies.r[b]! + Math.hypot(bodies.ax[b]! - bodies.bx[b]!, bodies.az[b]! - bodies.bz[b]!) / 2;
        if (along > 0 && along <= run + wide && (side < 0 ? -side : side) < wide) crowd++;
      }
      this.midC[at] = q(unit(low, run));
      this.midC[at + 1] = q(unit(high, run));
      this.midC[at + 2] = q(unit(drop, spans));
      this.midC[at + 3] = q(unit(rise, spans));
      this.midC[at + 4] = q(unit(wet, spans));
      // No ground in the game harms a walker yet.
      this.midC[at + 5] = 0;
      this.midC[at + 6] = q(unit(crowd, 4));
    }
    this.midAt[s] = tick;
  }

  /** The near pass: a heading solid within contact reach is masked; how open each is within NEAR_SPANS, and bodies in it. */
  fillNear(s: number, tick: number): void {
    const world = this.world, hf = world.hf, ents = world.ents, k = this.k, p = this.p!, e = this.e, x = this.x, z = this.z;
    const r = p.radius, reach = NEAR_SPANS * this.sp, contact = r * 0.5 > CONTACT ? r * 0.5 : CONTACT;
    const knee = hf.heightAt(x, z) + KNEE * p.height;
    const bodies = this.blocking.around(e, x, ents.y[e]!, z, r + reach, ents.team[e]!, true, this.mind.targetOf(e));
    // Its whole body is tried ahead, unless it already touches something where it stands: then a little less of it.
    const tight = groundAt(world, p, x, z) === GROUND_SOLID ? r * CONTACT_RADIUS : r;
    let close = 0;
    for (let i = 0; i < k; i++) {
      const at = (s * k + i) * 2, dx = this.dx[i]!, dz = this.dz[i]!;
      const ground = groundAt(world, p, x + dx * contact, z + dz * contact, tight);
      const mask = ground === GROUND_SOLID || ground === GROUND_OFF ? 1 : 0;
      castWorld(world, x, knee, z, dx, 0, dz, r + reach, true);
      const open = unit(rayHit.t - r, reach);
      let body = 0;
      for (let b = 0; bodies !== null && b < bodies.count && body === 0; b++) {
        const bx = (bodies.ax[b]! + bodies.bx[b]!) / 2 - x, bz = (bodies.az[b]! + bodies.bz[b]!) / 2 - z;
        const along = bx * dx + bz * dz, side = bx * dz - bz * dx;
        const wide = r + bodies.r[b]! + Math.hypot(bodies.ax[b]! - bodies.bx[b]!, bodies.az[b]! - bodies.bz[b]!) / 2;
        if (along > 0 && along <= reach + wide && (side < 0 ? -side : side) < wide) body = 1;
      }
      this.nearC[at] = q(open);
      this.nearC[at + 1] = body * 127;
      this.nearMask[s * k + i] = mask;
      if (mask !== 0 || open < 1 || body !== 0) close = 1;
    }
    this.close[s] = close;
    this.nearAt[s] = tick;
  }

  farRow(s: number, i: number, rows: Float32Array, at: number): void {
    const from = (s * this.k + i) * FK;
    for (let j = 0; j < FK; j++) rows[at + FAR_AT[j]!] = this.farC[from + j]! / 127;
  }

  midRow(s: number, i: number, rows: Float32Array, at: number): void {
    const from = (s * this.k + i) * MK;
    for (let j = 0; j < MK; j++) rows[at + MID_AT[j]!] = this.midC[from + j]! / 127;
  }

  /** The near pass's row for heading `i`, with how squarely it faces the wall the mover is pressed on; returns its mask. */
  nearRow(s: number, i: number, rows: Float32Array, at: number): number {
    const from = (s * this.k + i) * 2, mind = this.mind, e = this.e;
    rows[at + NEAR_OPEN] = this.nearC[from]! / 127;
    rows[at + NEAR_BODY] = this.nearC[from + 1]! / 127;
    let pressed = 0;
    if (mind.pinned[e] !== 0) {
      const out = (mind.wallYaw[e]! / 65536) * Math.PI * 2;
      pressed = -(Math.sin(out) * this.dx[i]! + Math.cos(out) * this.dz[i]!);
    }
    rows[at + NEAR_PRESSED] = pressed > 0 ? pressed : 0;
    return this.nearMask[s * this.k + i]!;
  }
}
