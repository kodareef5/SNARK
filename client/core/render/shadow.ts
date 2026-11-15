// Sun shadows as plain numbers: cascades over the near view, and which casters each cascade takes at which level.
//
// A cascade's square is fitted round the bounding sphere of its slice of the view. The sphere's size depends on the
// lens and the splits alone, so turning the camera never changes a texel's size. The square moves only in whole texels
// of a light space fixed to the world, so a world point keeps its place in its texel however the camera moves. All of
// it is worked in double precision, and the matrices are made camera-relative at the end, as every other position is.

export const MAX_CASCADES = 4;
/** Metres along the light that the box a cascade takes casters from is stretched toward the sun, at most. */
export const MAX_REACH = 192;
/** A caster whose radius is under this many of a cascade's texels is left out of that cascade. */
export const SMALLEST_CASTER = 1.5;
/** The sine of 2 degrees under the horizon. A sun lower than this casts nothing. */
export const NIGHT_SUN = Math.sin((-2 * Math.PI) / 180);
/** The share of its radius the farthest cascade's square grows by when it is drawn every other frame. */
export const KEPT_MARGIN = 1 / 16;
/** Steps of a 16-bit depth map. */
export const DEPTH_STEPS = 65535;

/** The camera the cascades are fitted to: world position, turn as `Camera` has it, and lens. A `Camera` is one. */
export interface ShadowView {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly fovY: number;
  readonly aspect: number;
  readonly near: number;
}

/** A tier's shadows. A Tier's `shadows` is one. */
export interface ShadowSetup {
  readonly cascades: number;
  /** Texels a side of each cascade's map. */
  readonly size: number;
  /** The view depth at which the farthest cascade ends, in metres. */
  readonly distance: number;
  /** The practical split's blend of logarithmic against even spacing. */
  readonly blend: number;
  /** The farthest cascade is drawn every other frame. */
  readonly everyOther: boolean;
}

/** View depths of `count` slices from `near` to `far`: out[0] is `near` and out[count] is `far`. */
export function splitDepths(near: number, far: number, count: number, blend: number, out: Float64Array): void {
  out[0] = near;
  for (let i = 1; i < count; i++) {
    const k = i / count;
    out[i] = blend * near * Math.pow(far / near, k) + (1 - blend) * (near + (far - near) * k);
  }
  out[count] = far;
}

/**
 * The smallest sphere holding the slice of a view between depths d0 and d1: out[0] is how far along the view its centre
 * is and out[1] its radius. `tanY` is the tangent of half the vertical field of view.
 */
export function sliceSphere(d0: number, d1: number, tanY: number, aspect: number, out: Float64Array): void {
  // The slice's corners are k times their depth off its axis.
  const k2 = tanY * tanY * (1 + aspect * aspect);
  const c = 0.5 * (d0 + d1) * (1 + k2);
  if (c >= d1) {
    out[0] = d1;
    out[1] = d1 * Math.sqrt(k2);
  } else {
    out[0] = c;
    out[1] = Math.sqrt((d1 - c) * (d1 - c) + k2 * d1 * d1);
  }
}

/**
 * Axes of the light space for a unit vector toward the sun: x in out[0..2], y in out[3..5], and the sun in out[6..8].
 * They depend on the sun alone. x lies across world z, so they turn smoothly everywhere but with the sun due north or
 * south on the horizon, where it never is.
 */
export function lightBasis(sx: number, sy: number, sz: number, out: Float64Array): void {
  let ax = -sy;
  let ay = sx;
  let az = 0;
  let l = Math.hypot(ax, ay);
  if (l < 1e-6) {
    ax = 0;
    ay = -sz;
    az = sy;
    l = Math.hypot(ay, az);
  }
  ax /= l;
  ay /= l;
  az /= l;
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  out[3] = sy * az - sz * ay;
  out[4] = sz * ax - sx * az;
  out[5] = sx * ay - sy * ax;
  out[6] = sx;
  out[7] = sy;
  out[8] = sz;
}

/** Whether a sun whose unit vector climbs `sunY` casts at all. */
export function sunCasts(sunY: number): boolean {
  return sunY > NIGHT_SUN;
}

/**
 * How far along the light a caster `height` metres over the ground can be from the ground it shades, under a sun whose
 * unit vector climbs `sunY`: its height over the sine of the sun's elevation, at most MAX_REACH.
 */
export function reach(height: number, sunY: number): number {
  return sunY * MAX_REACH > height ? height / sunY : MAX_REACH;
}

/**
 * The level a caster is drawn at in a cascade whose texel is `texel` metres, for a mesh whose levels lie `errors` metres
 * from its finest: the coarsest the card holds whose error is within a texel, else the finest it holds, else -1. Bit l
 * of `held` says the card holds level l. It does not depend on distance, so a caster keeps its level as the camera moves.
 */
export function casterLevel(errors: readonly number[], texel: number, held: number): number {
  let finest = -1;
  for (let l = errors.length - 1; l >= 0; l--) {
    if (((held >>> l) & 1) === 0) continue;
    if (errors[l]! <= texel) return l;
    finest = l;
  }
  return finest;
}

export class Cascades {
  /** Cascades fitted this frame. 0 while the sun casts nothing, and then every mask is 0. */
  count = 0;
  /** Bit i: cascade i is drawn this frame. A cascade not drawn keeps its map and its square from the frame it was. */
  drawn = 0;
  /** View depths of the slices, count + 1 of them. */
  readonly splits = new Float64Array(MAX_CASCADES + 1);
  /** The light space's axes, as lightBasis gives them. */
  readonly basis = new Float64Array(9);
  /** Per cascade: half its square's side, which is also half its depth range, and its texel, in metres. */
  readonly half = new Float64Array(MAX_CASCADES);
  readonly texel = new Float64Array(MAX_CASCADES);
  /** Per cascade: the centre of its square and depth range in the light space, whole texels and depth steps from the world's origin. */
  readonly centre = new Float64Array(MAX_CASCADES * 3);
  /** Per cascade: the sphere round its slice, camera-relative x, y, z and radius. A pixel takes the finest cascade whose sphere holds it. */
  readonly sphere = new Float64Array(MAX_CASCADES * 4);
  /** Per cascade: column-major, from camera-relative metres to the cascade's clip space, depth -1 nearest the sun. */
  readonly matrix = new Float64Array(MAX_CASCADES * 16);
  /** Per cascade: the centre less the camera, in the light space. */
  private readonly rel = new Float64Array(MAX_CASCADES * 3);
  private readonly sun = new Float64Array(3);
  private readonly slice = new Float64Array(2);

  /**
   * Fits the cascades to the view for a unit vector toward the sun. `frame` counts frames: when the farthest cascade is
   * drawn every other frame, on odd frames it keeps its square if that still holds its slice under the same sun.
   */
  fit(view: ShadowView, sx: number, sy: number, sz: number, setup: ShadowSetup, frame: number): void {
    const n = Math.min(setup.cascades, MAX_CASCADES);
    const sl = Math.hypot(sx, sy, sz);
    sx /= sl;
    sy /= sl;
    sz /= sl;
    this.drawn = 0;
    if (n <= 0 || !sunCasts(sy)) {
      this.count = 0;
      this.half.fill(0);
      return;
    }
    const b = this.basis;
    const turned = sx !== this.sun[0] || sy !== this.sun[1] || sz !== this.sun[2];
    if (turned) {
      lightBasis(sx, sy, sz, b);
      this.sun[0] = sx;
      this.sun[1] = sy;
      this.sun[2] = sz;
    }
    this.count = n;
    splitDepths(view.near, setup.distance, n, setup.blend, this.splits);
    const cp = Math.cos(view.pitch);
    const fx = Math.sin(view.yaw) * cp;
    const fy = Math.sin(view.pitch);
    const fz = Math.cos(view.yaw) * cp;
    const cu = view.x * b[0]! + view.y * b[1]! + view.z * b[2]!;
    const cv = view.x * b[3]! + view.y * b[4]! + view.z * b[5]!;
    const cw = view.x * b[6]! + view.y * b[7]! + view.z * b[8]!;
    const fu = fx * b[0]! + fy * b[1]! + fz * b[2]!;
    const fv = fx * b[3]! + fy * b[4]! + fz * b[5]!;
    const fw = fx * b[6]! + fy * b[7]! + fz * b[8]!;
    const tanY = Math.tan(view.fovY / 2);
    const size = setup.size;
    for (let i = 0; i < n; i++) {
      sliceSphere(this.splits[i]!, this.splits[i + 1]!, tanY, view.aspect, this.slice);
      const c = this.slice[0]!;
      const r = this.slice[1]!;
      const s = i * 4;
      this.sphere[s] = fx * c;
      this.sphere[s + 1] = fy * c;
      this.sphere[s + 2] = fz * c;
      this.sphere[s + 3] = r;
      // Snapping moves the centre half a texel at most, so the square is that much wider than the sphere.
      const last = i === n - 1 && setup.everyOther;
      const h = (r * (last ? 1 + KEPT_MARGIN : 1) * size) / (size - 1);
      const su = cu + fu * c;
      const sv = cv + fv * c;
      const sw = cw + fw * c;
      const o = i * 3;
      const at = this.centre;
      const keep = last && (frame & 1) === 1 && !turned && this.half[i] === h && Math.abs(su - at[o]!) + r <= h && Math.abs(sv - at[o + 1]!) + r <= h && Math.abs(sw - at[o + 2]!) + r <= h;
      if (!keep) {
        const t = (2 * h) / size;
        const d = (2 * h) / DEPTH_STEPS;
        at[o] = Math.round(su / t) * t;
        at[o + 1] = Math.round(sv / t) * t;
        at[o + 2] = Math.round(sw / d) * d;
        this.drawn |= 1 << i;
      }
      this.half[i] = h;
      this.texel[i] = (2 * h) / size;
      const ru = (this.rel[o] = at[o]! - cu);
      const rv = (this.rel[o + 1] = at[o + 1]! - cv);
      const rw = (this.rel[o + 2] = at[o + 2]! - cw);
      const m = this.matrix;
      const k = i * 16;
      const inv = 1 / h;
      m[k] = b[0]! * inv;
      m[k + 4] = b[1]! * inv;
      m[k + 8] = b[2]! * inv;
      m[k + 12] = -ru * inv;
      m[k + 1] = b[3]! * inv;
      m[k + 5] = b[4]! * inv;
      m[k + 9] = b[5]! * inv;
      m[k + 13] = -rv * inv;
      m[k + 2] = -b[6]! * inv;
      m[k + 6] = -b[7]! * inv;
      m[k + 10] = -b[8]! * inv;
      m[k + 14] = rw * inv;
      m[k + 3] = 0;
      m[k + 7] = 0;
      m[k + 11] = 0;
      m[k + 15] = 1;
    }
    for (let i = n; i < MAX_CASCADES; i++) this.half[i] = 0;
  }

  /**
   * The cascades drawn this frame that a caster takes, bit i for cascade i. The caster lies in a camera-relative box,
   * and `radius` is its own size, a mesh's radius, which leaves it out of cascades whose texels are too coarse for it.
   * `stretch` is how far toward the sun past a cascade's depth range a caster can still shade it, as `reach` gives it.
   */
  mask(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, radius: number, stretch: number): number {
    if (this.drawn === 0) return 0;
    const b = this.basis;
    const x = (minX + maxX) / 2, y = (minY + maxY) / 2, z = (minZ + maxZ) / 2;
    const ex = (maxX - minX) / 2, ey = (maxY - minY) / 2, ez = (maxZ - minZ) / 2;
    return this.test(
      x * b[0]! + y * b[1]! + z * b[2]!,
      x * b[3]! + y * b[4]! + z * b[5]!,
      x * b[6]! + y * b[7]! + z * b[8]!,
      Math.abs(b[0]!) * ex + Math.abs(b[1]!) * ey + Math.abs(b[2]!) * ez,
      Math.abs(b[3]!) * ex + Math.abs(b[4]!) * ey + Math.abs(b[5]!) * ez,
      Math.abs(b[6]!) * ex + Math.abs(b[7]!) * ey + Math.abs(b[8]!) * ez,
      radius,
      stretch,
    );
  }

  /** As `mask`, for a caster within `radius` of a camera-relative point, such as a body. */
  sphereMask(x: number, y: number, z: number, radius: number, stretch: number): number {
    if (this.drawn === 0) return 0;
    const b = this.basis;
    return this.test(x * b[0]! + y * b[1]! + z * b[2]!, x * b[3]! + y * b[4]! + z * b[5]!, x * b[6]! + y * b[7]! + z * b[8]!, radius, radius, radius, radius, stretch);
  }

  /**
   * The caster entries a mesh needs in the cascades of `mask`: one per level, at the level `casterLevel` gives for each
   * cascade's texel, with the cascades that take it. Writes level and mask pairs to `out` and returns how many.
   */
  entries(mask: number, errors: readonly number[], held: number, out: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const bit = 1 << i;
      if ((mask & bit) === 0) continue;
      const level = casterLevel(errors, this.texel[i]!, held);
      if (level < 0) continue;
      let k = 0;
      while (k < n && out[k * 2] !== level) k++;
      if (k === n) {
        out[n * 2] = level;
        out[n * 2 + 1] = 0;
        n++;
      }
      out[k * 2 + 1]! |= bit;
    }
    return n;
  }

  /** Writes each cascade's matrix, 16 floats, and its sphere, 4, for the packet. */
  write(matrices: Float32Array, spheres: Float32Array): void {
    matrices.set(this.matrix.subarray(0, this.count * 16));
    spheres.set(this.sphere.subarray(0, this.count * 4));
  }

  private test(u: number, v: number, w: number, eu: number, ev: number, ew: number, radius: number, stretch: number): number {
    let mask = 0;
    for (let i = 0; i < this.count; i++) {
      const bit = 1 << i;
      if ((this.drawn & bit) === 0 || radius < SMALLEST_CASTER * this.texel[i]!) continue;
      const h = this.half[i]!;
      const o = i * 3;
      if (Math.abs(u - this.rel[o]!) > eu + h || Math.abs(v - this.rel[o + 1]!) > ev + h) continue;
      const dw = w - this.rel[o + 2]!;
      if (dw + ew < -h || dw - ew > h + stretch) continue;
      mask |= bit;
    }
    return mask;
  }
}
