// Ground controllers meet other upright capsules without pushing them. Only their own inward travel/velocity is clipped.
// The caller supplies current qualified bodies and still checks every resulting position against static geometry.
import { BTN_JUMP, MF_OUT, MODE_WALK, stanceHeight, type Body, type MoveParams } from "./character.ts";
import { capsuleFree, type CollisionWorld } from "../world/collide.ts";
const STRIDE = 6, SKIN = .002, PASSES = 3;
export function groundBlockingActive(body: Body, moveX: number, moveZ: number, buttons: number): boolean {
  return body.mode === MODE_WALK && body.grounded && (body.mflags & MF_OUT) === 0 && (buttons & BTN_JUMP) === 0 &&
    (moveX !== 0 || moveZ !== 0 || body.vx !== 0 || body.vz !== 0);
}
export function groundBodyTeamBlocks(own: number, other: number, pve: boolean): boolean {
  return other === 0 || other !== own && !pve;
}
/** Native walking commits at most one radius per substep, including static separation, in at most sixteen substeps. */
export function groundContactReach(body: Body, params: MoveParams, dt: number): number {
  const vx = body.vx, vz = body.vz, wish = params.walkSpeed * params.sprintMul * body.speedQ / 1000;
  const horizontal2 = Math.max(vx * vx + vz * vz, wish * wish), vertical = Math.max(Math.abs(body.vy), params.jumpSpeed) + params.gravity * dt;
  const steps = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(horizontal2 + vertical * vertical) * dt / (params.radius * .5))));
  return steps * params.radius + .004;
}
export class GroundBodies {
  count = 0;
  private rows = new Float64Array(STRIDE * 32);
  readonly result = { x: 0, z: 0, vx: 0, vz: 0, hit: false };
  reset(): void { this.count = 0; }
  add(handle: number, x: number, y: number, z: number, radius: number, height: number): void {
    if (this.count * STRIDE === this.rows.length) { const rows = new Float64Array(this.rows.length * 2); rows.set(this.rows); this.rows = rows; }
    const at = this.count++ * STRIDE, rows = this.rows;
    rows[at] = handle; rows[at + 1] = x; rows[at + 2] = y; rows[at + 3] = z; rows[at + 4] = radius; rows[at + 5] = height;
  }
  /** Normal controls must escape a crowded body gap or a doorway. Only bodies yield; static collision remains mandatory. */
  allowEscape(world: CollisionWorld, body: Body, params: MoveParams): boolean {
    let close = 0, near = -1;
    const rows = this.rows, height = stanceHeight(params, body.stance);
    for (let i = 0; i < this.count * STRIDE; i += STRIDE) {
      const dx = body.x - rows[i + 1]!, dz = body.z - rows[i + 3]!, radius = params.radius + rows[i + 4]!;
      const low = rows[i + 2]! + rows[i + 4]! - Math.max(params.radius, height - params.radius);
      const high = rows[i + 2]! + Math.max(rows[i + 4]!, rows[i + 5]! - rows[i + 4]!) - params.radius;
      const dy = body.y < low ? body.y - low : body.y > high ? body.y - high : 0;
      const distance2 = dx * dx + dy * dy + dz * dz;
      // Landing, dismounting or a newly visible body can begin overlapped. It must never become an inescapable cage.
      if (distance2 < (radius - .01) * (radius - .01)) { this.count = 0; return false; }
      if (distance2 < (radius + .6) * (radius + .6)) { near = i; if (++close > 1) { this.count = 0; return false; } }
    }
    if (near >= 0) {
      const x = rows[near + 1]!, z = rows[near + 3]!, dx = x - body.x, dz = z - body.z, length = Math.sqrt(dx * dx + dz * dz);
      if (length > 1e-8) {
        const reach = params.radius + rows[near + 4]! + .05, sx = -dz / length * reach, sz = dx / length * reach;
        if (!capsuleFree(world, x + sx, body.y, z + sz, params.radius, height) &&
          !capsuleFree(world, x - sx, body.y, z - sz, params.radius, height)) { this.count = 0; return false; }
      }
    }
    return this.count > 0;
  }
  clip(x: number, y: number, z: number, toX: number, toY: number, toZ: number, radius: number, height: number, vx: number, vz: number): void {
    const out = this.result; out.hit = false;
    let dx = toX - x, dz = toZ - z, dy = toY - y;
    for (let pass = 0; pass < PASSES && dx * dx + dz * dz > 1e-18; pass++) {
      let first = 2, picked = Infinity, nx = 0, nz = 0;
      const rows = this.rows;
      for (let i = 0; i < this.count * STRIDE; i += STRIDE) {
        const ox = rows[i + 1]!, oz = rows[i + 3]!, otherR = rows[i + 4]!, r = radius + otherR - SKIN;
        const low = rows[i + 2]! + otherR - Math.max(radius, height - radius), high = rows[i + 2]! + Math.max(otherR, rows[i + 5]! - otherR) - radius;
        const px = x - ox, pz = z - oz, py = y < low ? y - low : y > high ? y - high : 0;
        let t = 2;
        if (px * px + pz * pz + py * py < r * r + 1e-10) {
          // Existing overlap (spawn, growth or a correction) cannot generate a shove. Any non-deepening escape remains legal.
          if (px * dx + pz * dz < -1e-10) t = 0;
        } else {
          const a = dx * dx + dz * dz, b = px * dx + pz * dz, c = px * px + pz * pz - r * r, disc = b * b - a * c;
          if (a > 1e-18 && b < 0 && disc >= 0) {
            const at = (-b - Math.sqrt(disc)) / a, hitY = y + dy * at;
            if (at >= 0 && at <= 1 && hitY >= low && hitY <= high) t = at;
          }
          for (let end = 0; end < 2; end++) {
            const ey = y - (end === 0 ? low : high), a3 = a + dy * dy, b3 = b + ey * dy, c3 = c + ey * ey, disc3 = b3 * b3 - a3 * c3;
            if (a3 <= 1e-18 || b3 >= 0 || disc3 < 0) continue;
            const at = (-b3 - Math.sqrt(disc3)) / a3, hitY = y + dy * at;
            if (at >= 0 && at <= 1 && (end === 0 ? hitY <= low : hitY >= high)) t = Math.min(t, at);
          }
        }
        if (t > 1 || t > first || t === first && rows[i]! >= picked) continue;
        const hx = px + dx * t, hz = pz + dz * t, length = Math.sqrt(hx * hx + hz * hz);
        // Bodies are not platforms in this ground-controller slice. A vertical crossing alone cannot add a side impulse.
        if (length < 1e-9 || hx * dx + hz * dz >= -1e-12) continue;
        first = t; picked = rows[i]!; nx = hx / length; nz = hz / length;
      }
      if (first > 1) { x += dx; z += dz; dx = dz = 0; break; }
      out.hit = true;
      x += dx * first; z += dz * first; y += dy * first;
      dx *= 1 - first; dz *= 1 - first; dy *= 1 - first;
      const into = Math.min(0, dx * nx + dz * nz); dx -= into * nx; dz -= into * nz;
      const speed = Math.min(0, vx * nx + vz * nz); vx -= speed * nx; vz -= speed * nz;
    }
    // An exhausted corner stays at the last tested position; no untested remainder is committed.
    out.x = x; out.z = z; out.vx = vx; out.vz = vz;
  }
}
