// Character movement: one fixed step for one upright capsule.
//
// The server runs this for every controlled body. The client runs the same code
// to predict its own body. Given the same state and input, both produce the same
// bits, so a disagreement always means the world differed, never the maths.
//
// The no-clipping guarantee does not rest on the solver being clever:
//   1. A position is committed only if `capsuleFree` accepts it. Otherwise the
//      body stays where it was.
//   2. One substep never moves a body further than its radius sideways.
// Crossing a wall needs two free positions at least a diameter apart, so no
// input sequence can produce one. tests/unit/character.test.ts fuzzes this.

import { WORLD_MAX_Y, WORLD_MIN_Y, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { SKIN, capsuleBox, capsuleFree, push, restsOnStructure, type CollisionWorld } from "../world/collide.ts";

export const BTN_JUMP = 1;
export const BTN_SPRINT = 2;
/** Swing, harvest, attack. Acted on by the server on the tick the press is consumed. */
export const BTN_PRIMARY = 4;
/** Use, open, pick up. */
export const BTN_USE = 8;

/** No movement at all: a dead survivor waiting to respawn. */
export const MODE_NONE = 0;
export const MODE_WALK = 1;
export const MODE_SWIM = 2;
/** Free flight with no collision. Set only by the server (admins, spectators). */
export const MODE_GHOST = 3;

/** Stamina is stored in thousandths of a point, so it steps in exact integers. */
export const STAMINA_UNITS = 1000;

export interface MoveParams {
  readonly radius: number;
  readonly height: number;
  readonly walkSpeed: number;
  readonly sprintMul: number;
  readonly accelGround: number;
  readonly accelAir: number;
  readonly jumpSpeed: number;
  readonly gravity: number;
  /** Steepest walkable slope, as the cosine of its angle. */
  readonly slopeCos: number;
  /** Tallest terrain rise taken in one substep. */
  readonly stepUp: number;
  /** Largest drop a grounded body follows without leaving the ground. */
  readonly stepDown: number;
}

/**
 * The predicted state of a body: everything the next step depends on that
 * belongs to the individual. The server sends all of it for the client's own
 * body, and the client never derives any of it from stats, so both sides step
 * with the same numbers.
 */
export class Body {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = false;
  mode = MODE_WALK;
  /** Thousandths of a point, 0 .. staminaMax * STAMINA_UNITS. */
  stamina = 100 * STAMINA_UNITS;
  /** Whole points. Set by the server from stat points. */
  staminaMax = 100;
  /** Speed on land and in water, in thousandths of the species value. Set by the server. */
  speedQ = 1000;
  swimQ = 1000;
  /** Server-set restrictions (MF_ bits). */
  mflags = 0;

  copy(o: Body): void {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.vx = o.vx;
    this.vy = o.vy;
    this.vz = o.vz;
    this.grounded = o.grounded;
    this.mode = o.mode;
    this.stamina = o.stamina;
    this.staminaMax = o.staminaMax;
    this.speedQ = o.speedQ;
    this.swimQ = o.swimQ;
    this.mflags = o.mflags;
  }

  /** Same place and motion. */
  samePosition(o: Body): boolean {
    return this.x === o.x && this.y === o.y && this.z === o.z && this.vx === o.vx && this.vy === o.vy && this.vz === o.vz && this.grounded === o.grounded;
  }

  equals(o: Body): boolean {
    return (
      this.samePosition(o) &&
      this.mode === o.mode &&
      this.stamina === o.stamina &&
      this.staminaMax === o.staminaMax &&
      this.speedQ === o.speedQ &&
      this.swimQ === o.swimQ &&
      this.mflags === o.mflags
    );
  }
}

const YAW_TO_RAD = TAU / YAW_UNITS;
const MAX_SUBSTEPS = 16;
const TERMINAL_SPEED = 60;
const GROUND_PROBE = 0.02;
const RESOLVE_ITERATIONS = 4;
const SETTLE_ITERATIONS = 7;
/** Ghost flight, metres per second; sprint multiplies it. */
const GHOST_SPEED = 12;
const GHOST_SPRINT = 5;
const refs = new Uint32Array(256);

/**
 * Advance `b` by one tick. `moveX` (strafe right) and `moveZ` (forward) are
 * -127..127; `yaw` and `pitch` are in 1/65536 turns (pitch 16384 is straight
 * up): the quantized values sent on the wire.
 */
export function stepBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  if (b.mode === MODE_NONE) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    return;
  }
  if (b.mode === MODE_GHOST) {
    stepGhost(w, b, moveX, moveZ, yaw, pitch, buttons, dt);
    return;
  }
  const hf = w.hf;
  const structs = w.structs;
  const r = p.radius;

  // Horizontal velocity moves toward the wished velocity at a bounded rate.
  let mx = moveX / 127;
  let mz = moveZ / 127;
  const m2 = mx * mx + mz * mz;
  if (m2 > 1) {
    const inv = 1 / Math.sqrt(m2);
    mx *= inv;
    mz *= inv;
  }
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const speed = p.walkSpeed * ((buttons & BTN_SPRINT) !== 0 ? p.sprintMul : 1);
  let dvx = (s * mz - c * mx) * speed - b.vx;
  let dvz = (c * mz + s * mx) * speed - b.vz;
  const maxDv = (b.grounded ? p.accelGround : p.accelAir) * dt;
  const dv2 = dvx * dvx + dvz * dvz;
  if (dv2 > maxDv * maxDv) {
    const k = maxDv / Math.sqrt(dv2);
    dvx *= k;
    dvz *= k;
  }
  let vx = b.vx + dvx;
  let vz = b.vz + dvz;
  let vy = b.vy;

  const wasGrounded = b.grounded;
  let jumped = false;
  if (wasGrounded) {
    if ((buttons & BTN_JUMP) !== 0) {
      vy = p.jumpSpeed;
      jumped = true;
    } else vy = 0;
  }
  if (!wasGrounded || jumped) {
    vy -= p.gravity * dt;
    if (vy < -TERMINAL_SPEED) vy = -TERMINAL_SPEED;
  }
  /** On the ground for this whole tick: may step up and follow the ground down. */
  const walking = wasGrounded && !jumped;

  // Split the move so no substep exceeds half a radius.
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
  const maxStep = r * 0.5;
  let n = Math.ceil(dist / maxStep);
  let scale = dt;
  if (n < 1) n = 1;
  else if (n > MAX_SUBSTEPS) {
    scale = (dt * MAX_SUBSTEPS * maxStep) / dist;
    n = MAX_SUBSTEPS;
  }
  const sx = (vx * scale) / n;
  const sy = (vy * scale) / n;
  const sz = (vz * scale) / n;
  const maxX = hf.sizeX - r;
  const maxZ = hf.sizeZ - r;
  const maxSide2 = r * r;
  const maxRise = (p.stepUp > r ? p.stepUp : r) + maxStep;

  let x = b.x;
  let y = b.y;
  let z = b.z;

  for (let i = 0; i < n; i++) {
    let nx = x + sx;
    let ny = y + sy;
    let nz = z + sz;
    if (nx < r) nx = r;
    else if (nx > maxX) nx = maxX;
    if (nz < r) nz = r;
    else if (nz > maxZ) nz = maxZ;

    // Terrain: rise onto walkable ground, slide along or stop at anything else.
    let h = hf.heightAt(nx, nz);
    if (ny < h) {
      if (!(h - ny <= p.stepUp && (hf.slopeCosAt(nx, nz) >= p.slopeCos || h - ny <= SKIN))) {
        const hx = hf.heightAt(nx, z);
        if (ny >= hx || (hx - ny <= p.stepUp && hf.slopeCosAt(nx, z) >= p.slopeCos)) {
          nz = z;
          h = hx;
        } else {
          const hz = hf.heightAt(x, nz);
          if (ny >= hz || (hz - ny <= p.stepUp && hf.slopeCosAt(x, nz) >= p.slopeCos)) {
            nx = x;
            h = hz;
          } else {
            nx = x;
            nz = z;
            h = hf.heightAt(x, z);
          }
        }
      }
      if (ny < h) {
        ny = h;
        if (vy < 0) vy = 0;
      }
    }

    // Structures: push out along the shortest exit, a few rounds.
    let blocked = false;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      const count = structs.query(nx - r, nz - r, nx + r, nz + r, refs);
      let moved = false;
      for (let k = 0; k < count; k++) {
        if (!capsuleBox(structs, refs[k]!, nx, ny, nz, r, p.height, 0)) continue;
        nx += push.x;
        ny += push.y;
        nz += push.z;
        if (push.y > 0.7 * push.depth) {
          if (vy < 0) vy = 0;
        } else {
          blocked = true;
          if (push.y < -0.7 * push.depth && vy > 0) vy = 0;
        }
        moved = true;
      }
      if (!moved) break;
    }
    h = hf.heightAt(nx, nz);
    if (ny < h && h - ny <= p.stepUp) ny = h;

    // Step up: a grounded body blocked by something low climbs onto it.
    if (blocked && walking) {
      let tx = x + sx;
      let tz = z + sz;
      if (tx < r) tx = r;
      else if (tx > maxX) tx = maxX;
      if (tz < r) tz = r;
      else if (tz > maxZ) tz = maxZ;
      const top = y + p.stepUp;
      if (capsuleFree(w, x, top, z, r, p.height) && capsuleFree(w, tx, top, tz, r, p.height)) {
        let lo = y;
        let hi = top;
        for (let k = 0; k < SETTLE_ITERATIONS; k++) {
          const mid = (lo + hi) * 0.5;
          if (capsuleFree(w, tx, mid, tz, r, p.height)) hi = mid;
          else lo = mid;
        }
        nx = tx;
        ny = hi;
        nz = tz;
      }
    }

    // Commit only a legal position reached by a bounded move.
    const ddx = nx - x;
    const ddz = nz - z;
    const ddy = ny - y;
    if (ddx * ddx + ddz * ddz > maxSide2 || ddy > maxRise || ddy < -maxRise || !capsuleFree(w, nx, ny, nz, r, p.height)) {
      vx = 0;
      vz = 0;
      if (vy > 0) vy = 0;
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }

  // Ground state: resting on terrain or a structure, or close enough above
  // support to follow it down (slopes, stairs, kerbs) instead of going airborne.
  let grounded = false;
  if (vy <= 0) {
    if (y - hf.heightAt(x, z) <= GROUND_PROBE || restsOnStructure(w, x, y, z, r, p.height, GROUND_PROBE)) grounded = true;
    else if (walking && !capsuleFree(w, x, y - p.stepDown, z, r, p.height)) {
      let lo = y - p.stepDown;
      let hi = y;
      for (let k = 0; k < SETTLE_ITERATIONS; k++) {
        const mid = (lo + hi) * 0.5;
        if (capsuleFree(w, x, mid, z, r, p.height)) hi = mid;
        else lo = mid;
      }
      y = hi;
      grounded = true;
    }
    if (grounded) vy = 0;
  }

  // Round to float32: the stored and transmitted precision. Both sides do this.
  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
  b.grounded = grounded;
}

/** Free flight along the look direction. No collision; bounded to the map's box. */
function stepGhost(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, dt: number): void {
  let mx = moveX / 127;
  let mz = moveZ / 127;
  const m2 = mx * mx + mz * mz;
  if (m2 > 1) {
    const inv = 1 / Math.sqrt(m2);
    mx *= inv;
    mz *= inv;
  }
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const e = pitch * YAW_TO_RAD;
  const sp = detSin(e);
  const cp = detCos(e);
  const speed = GHOST_SPEED * ((buttons & BTN_SPRINT) !== 0 ? GHOST_SPRINT : 1);
  const vx = (s * cp * mz - c * mx) * speed;
  const vy = (sp * mz + ((buttons & BTN_JUMP) !== 0 ? 1 : 0)) * speed;
  const vz = (c * cp * mz + s * mx) * speed;
  let x = b.x + vx * dt;
  let y = b.y + vy * dt;
  let z = b.z + vz * dt;
  const hf = w.hf;
  if (x < 0) x = 0;
  else if (x > hf.sizeX) x = hf.sizeX;
  if (z < 0) z = 0;
  else if (z > hf.sizeZ) z = hf.sizeZ;
  if (y < WORLD_MIN_Y) y = WORLD_MIN_Y;
  else if (y > WORLD_MAX_Y) y = WORLD_MAX_Y;
  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
  b.grounded = false;
}
