// Rendering is camera-relative. The view matrix carries rotation only. The camera position is subtracted from every position in
// double precision before it reaches the GPU, so float32 never has to resolve millimetres eight kilometres from the origin.

import { PASS_FAR, PASS_NEAR } from "./packet.ts";

/** Near and far planes of the pass that draws the viewer's own body. */
export const NEAR_BODY = 0.03;
export const NEAR_BODY_FAR = 12;
/** The far depth range begins this share of `split` from the camera, so the two ranges overlap and no pixel falls between them. */
export const FAR_FROM = 0.98;
/** The far plane for a view ending `view` metres off: half again past it, for the sea's tiles and what stands over its end, and never nearer than 6 km. */
export const farPlane = (view: number): number => Math.max(6000, view * 1.5);

/** Sets the depth rows of a view-projection whose other rows are set, for planes `near` and `far` and the view's forward (fx, fy, fz). */
function depthRows(m: Float32Array, near: number, far: number, fx: number, fy: number, fz: number): void {
  const a = (far + near) / (near - far);
  m[2] = -a * fx;
  m[6] = -a * fy;
  m[10] = -a * fz;
  m[14] = (2 * far * near) / (near - far);
}

export class Camera {
  x = 0;
  y = 0;
  z = 0;
  /** Radians. Yaw 0 faces +Z, and positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  /** Rotation about the view forward axis; zero keeps the horizon level. */
  roll = 0;
  fovY = 1.2217; // 70 degrees
  aspect = 16 / 9;
  private requestedNear = 0.25;
  /** A low overhead passage can bring the world near plane closer while preserving the angular field of view. */
  nearLimit = Infinity;
  get near(): number { return Math.min(this.requestedNear, this.nearLimit); }
  set near(value: number) { this.requestedNear = value; }
  /** The far plane, which a scene sets from its view (farPlane). */
  far = 6000;
  /** Metres from the camera at which the far depth range begins, 0 for one range. */
  split = 0;
  /** How many times the view magnifies the player's own (optics.ts magnification), which a sight narrows it to. */
  zoom = 1;
  /**
   * The part of the view drawn, in its clip space (x0, y0, x1, y1, y up): all of it, or a sight's window (D1077). The
   * projection is the whole view's, so what is drawn is magnified alike; only what lies outside the window is left out,
   * by the frustum's sides, and the shell's scissor keeps its pixels from being shaded.
   */
  readonly window = new Float64Array([-1, -1, 1, 1]);
  /** Whether the window is less than the whole view. */
  get windowed(): boolean { const w = this.window; return w[0]! > -1 || w[1]! > -1 || w[2]! < 1 || w[3]! < 1; }

  /** Column-major view-projection for camera-relative positions, from `near` to `far`. What is culled is culled by it. */
  readonly viewProj = new Float32Array(16);
  /** The same with the NEAR_BODY planes, for the viewer's own body. */
  readonly nearViewProj = new Float32Array(16);
  /** With a split, each depth range's view-projection by its PASS_: `near` to `split`, and FAR_FROM of `split` to `far`. */
  readonly ranges = [new Float32Array(16), new Float32Array(16)] as const;
  /** Six frustum planes (a, b, c, d), inside when a*x + b*y + c*z + d >= 0, camera-relative. */
  readonly planes = new Float32Array(24);

  update(): void {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    // Basis: forward f, right r = f x up, up u = r x f.
    const fx = sy * cp, fy = sp, fz = cy * cp;
    // Keep the usual level view byte-identical, including signed zeros in frame packets.
    let rx = -cy, ry = 0, rz = sy, ux = -sy * sp, uy = cp, uz = -cy * sp;
    if (this.roll !== 0) {
      const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
      rx = -cy * cr + sy * sp * sr; ry = -cp * sr; rz = sy * cr + cy * sp * sr;
      ux = -cy * sr - sy * sp * cr; uy = cp * cr; uz = sy * sr - cy * sp * cr;
    }
    const fl = 1 / Math.tan(this.fovY / 2);
    const m = this.viewProj;
    const sx = fl / this.aspect;
    m[0] = sx * rx; m[4] = sx * ry; m[8] = sx * rz; m[12] = 0;
    m[1] = fl * ux; m[5] = fl * uy; m[9] = fl * uz; m[13] = 0;
    m[3] = fx; m[7] = fy; m[11] = fz; m[15] = 0;
    depthRows(m, this.near, this.far, fx, fy, fz);
    this.nearViewProj.set(m);
    depthRows(this.nearViewProj, NEAR_BODY, NEAR_BODY_FAR, fx, fy, fz);
    if (this.split > 0) {
      for (const r of this.ranges) r.set(m);
      depthRows(this.ranges[PASS_NEAR], this.near, this.split, fx, fy, fz);
      depthRows(this.ranges[PASS_FAR], this.split * FAR_FROM, this.far, fx, fy, fz);
    }

    // Each side is where the clip coordinate meets its bound of the window times w: the lower `row - lo w >= 0`, the
    // upper `hi w - row >= 0`. With the whole view, lo -1 and hi 1, these are the usual w + row and w - row exactly.
    const p = this.planes, win = this.window;
    for (let i = 0; i < 6; i++) {
      const row = i >> 1;
      const lower = (i & 1) === 0;
      const bound = row === 2 ? (lower ? -1 : 1) : win[row + (lower ? 0 : 2)]!;
      let px = lower ? m[row]! - bound * m[3]! : bound * m[3]! - m[row]!;
      let py = lower ? m[4 + row]! - bound * m[7]! : bound * m[7]! - m[4 + row]!;
      let pz = lower ? m[8 + row]! - bound * m[11]! : bound * m[11]! - m[8 + row]!;
      let pd = lower ? m[12 + row]! - bound * m[15]! : bound * m[15]! - m[12 + row]!;
      const inv = 1 / Math.hypot(px, py, pz);
      px *= inv; py *= inv; pz *= inv; pd *= inv;
      p[i * 4] = px; p[i * 4 + 1] = py; p[i * 4 + 2] = pz; p[i * 4 + 3] = pd;
    }
  }

  /** Takes a camera-relative box. Conservative. */
  boxVisible(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i]!, b = p[i + 1]!, c = p[i + 2]!;
      if (a * (a >= 0 ? maxX : minX) + b * (b >= 0 ? maxY : minY) + c * (c >= 0 ? maxZ : minZ) + p[i + 3]! < 0) return false;
    }
    return true;
  }

  /** Whether a camera-relative box is wholly in view. */
  boxInside(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i]!, b = p[i + 1]!, c = p[i + 2]!;
      if (a * (a >= 0 ? minX : maxX) + b * (b >= 0 ? minY : maxY) + c * (c >= 0 ? minZ : maxZ) + p[i + 3]! < 0) return false;
    }
    return true;
  }

  /** The depth ranges, a bit each by PASS_, that something from view depth `from` to `to` is drawn in. With no split, the near one. */
  passesOf(from: number, to: number): number {
    if (this.split <= 0) return 1 << PASS_NEAR;
    return (from < this.split ? 1 << PASS_NEAR : 0) | (to > this.split ? 1 << PASS_FAR : 0) || 1 << PASS_NEAR;
  }

  /** The depth ranges a camera-relative box is drawn in, by how far along the view its nearest and farthest corners are. */
  passes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    const m = this.viewProj;
    const fx = m[3]!, fy = m[7]!, fz = m[11]!;
    const from = fx * (fx >= 0 ? minX : maxX) + fy * (fy >= 0 ? minY : maxY) + fz * (fz >= 0 ? minZ : maxZ);
    const to = fx * (fx >= 0 ? maxX : minX) + fy * (fy >= 0 ? maxY : minY) + fz * (fz >= 0 ? maxZ : minZ);
    return this.passesOf(from, to);
  }

  /** How far along the view a camera-relative point is. */
  depth(x: number, y: number, z: number): number {
    const m = this.viewProj;
    return m[3]! * x + m[7]! * y + m[11]! * z;
  }

  /** (sx, sy) is a screen position in 0..1 with y down. Writes a unit vector to out[0..2]. Does not need update(). */
  ray(sx: number, sy: number, out: Float32Array | Float64Array | number[]): void {
    const syaw = Math.sin(this.yaw);
    const cyaw = Math.cos(this.yaw);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const t = Math.tan(this.fovY / 2);
    const rx = (sx * 2 - 1) * t * this.aspect;
    const ry = (1 - sy * 2) * t;
    // Rotate the screen offset by roll, then use the same basis as `update`.
    let right = rx, up = ry;
    if (this.roll !== 0) {
      const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
      right = rx * cr + ry * sr; up = ry * cr - rx * sr;
    }
    const x = syaw * cp - cyaw * right - syaw * sp * up;
    const y = sp + cp * up;
    const z = cyaw * cp + syaw * right - cyaw * sp * up;
    const l = Math.hypot(x, y, z);
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
  }

  /** Fills out[0..1] with x, y in 0..1 (y down) and out[2] with the distance along the view. False if behind the camera. */
  project(wx: number, wy: number, wz: number, out: Float32Array | number[]): boolean {
    const x = wx - this.x, y = wy - this.y, z = wz - this.z;
    const m = this.viewProj;
    const w = m[3]! * x + m[7]! * y + m[11]! * z;
    if (w <= this.near) return false;
    out[0] = ((m[0]! * x + m[4]! * y + m[8]! * z) / w) * 0.5 + 0.5;
    out[1] = 0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z) / w) * 0.5;
    out[2] = w;
    return true;
  }
}
