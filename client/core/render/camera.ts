// Camera maths. Rendering is camera-relative: the view matrix carries rotation
// only and every position handed to the GPU has the camera position subtracted
// in double precision first, so float32 never has to resolve millimetres at
// eight kilometres from the origin.

/** Near and far planes of the pass that draws the viewer's own body. */
export const NEAR_BODY = 0.03;
export const NEAR_BODY_FAR = 12;

export class Camera {
  x = 0;
  y = 0;
  z = 0;
  /** Radians. Yaw 0 faces +Z; positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  fovY = 1.2217; // 70 degrees
  aspect = 16 / 9;
  near = 0.25;
  far = 6000;

  /** Column-major view-projection for camera-relative positions. */
  readonly viewProj = new Float32Array(16);
  /** The same with a near plane of NEAR_BODY, for drawing the viewer's own body. */
  readonly nearViewProj = new Float32Array(16);
  /** Six frustum planes (a, b, c, d), inside when a*x + b*y + c*z + d >= 0, camera-relative. */
  readonly planes = new Float32Array(24);

  update(): void {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    // Basis: forward f, right r = f x up, up u = r x f.
    const fx = sy * cp, fy = sp, fz = cy * cp;
    const rx = -cy, rz = sy;
    const ux = -sy * sp, uy = cp, uz = -cy * sp;
    const fl = 1 / Math.tan(this.fovY / 2);
    const a = (this.far + this.near) / (this.near - this.far);
    const b = (2 * this.far * this.near) / (this.near - this.far);
    const m = this.viewProj;
    const sx = fl / this.aspect;
    m[0] = sx * rx; m[4] = 0; m[8] = sx * rz; m[12] = 0;
    m[1] = fl * ux; m[5] = fl * uy; m[9] = fl * uz; m[13] = 0;
    m[2] = -a * fx; m[6] = -a * fy; m[10] = -a * fz; m[14] = b;
    m[3] = fx; m[7] = fy; m[11] = fz; m[15] = 0;
    const nm = this.nearViewProj;
    nm.set(m);
    const na = (NEAR_BODY_FAR + NEAR_BODY) / (NEAR_BODY - NEAR_BODY_FAR);
    nm[2] = -na * fx; nm[6] = -na * fy; nm[10] = -na * fz;
    nm[14] = (2 * NEAR_BODY_FAR * NEAR_BODY) / (NEAR_BODY - NEAR_BODY_FAR);

    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const row = i >> 1;
      const sign = (i & 1) === 0 ? 1 : -1;
      let px = m[3]! + sign * m[row]!;
      let py = m[7]! + sign * m[4 + row]!;
      let pz = m[11]! + sign * m[8 + row]!;
      let pd = m[15]! + sign * m[12 + row]!;
      const inv = 1 / Math.hypot(px, py, pz);
      px *= inv; py *= inv; pz *= inv; pd *= inv;
      p[i * 4] = px; p[i * 4 + 1] = py; p[i * 4 + 2] = pz; p[i * 4 + 3] = pd;
    }
  }

  /** Whether a camera-relative box touches the frustum. Conservative. */
  boxVisible(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i]!, b = p[i + 1]!, c = p[i + 2]!;
      if (a * (a >= 0 ? maxX : minX) + b * (b >= 0 ? maxY : minY) + c * (c >= 0 ? maxZ : minZ) + p[i + 3]! < 0) return false;
    }
    return true;
  }

  /**
   * The direction, from the camera, of the point at screen position (sx, sy)
   * in 0..1 with y down: a unit vector into out[0..2]. Uses yaw, pitch, fovY
   * and aspect as they stand; it does not need `update`.
   */
  ray(sx: number, sy: number, out: Float32Array | Float64Array | number[]): void {
    const syaw = Math.sin(this.yaw);
    const cyaw = Math.cos(this.yaw);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const t = Math.tan(this.fovY / 2);
    const rx = (sx * 2 - 1) * t * this.aspect;
    const ry = (1 - sy * 2) * t;
    // forward + right * rx + up * ry, with the basis `update` builds.
    const x = syaw * cp - cyaw * rx - syaw * sp * ry;
    const y = sp + cp * ry;
    const z = cyaw * cp + syaw * rx - cyaw * sp * ry;
    const l = Math.hypot(x, y, z);
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
  }

  /**
   * Project a world position to the screen. Fills out[0..1] with x, y in 0..1
   * (y down) and out[2] with distance along the view; false if behind the camera.
   */
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
