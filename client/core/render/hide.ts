// What a frame leaves out because something drawn in it wholly hides it (scene.ts). A small picture of the view holds,
// for each of its pixels, the nearest depth at which something sure to be drawn opaque and whole this frame covers all
// of the pixel: a box wholly inside the pieces a chunk of the near store draws as one mesh (nearcity.ts), and under each
// tile of ground drawn, a box wholly under it. A draw, a tile, a body or a caster's shadow is left out where every pixel
// its box can reach holds something nearer than the box's nearest point. Nothing is decided on a frame before or after,
// so nothing comes in late when the camera turns or flies.
//
// - A kind's plates: boxes wholly inside what it draws as its form (its look's boxes, or its one box), found once.
// - A chunk's occluders: its pieces' plates, those of one turn short of a quarter in one frame, merged where they meet
//   face to face with the same cross-section (a facade's bays, a storey's floor plates), the small ones left out and the
//   rest shrunk by more than the mesh's lattice and the merge's centimetre move a face.
// - The picture: each occluder's faces turned to the camera, clipped at the near plane, a pixel taken only where the
//   face covers all of it, at the face's farthest depth over the pixel. A test finds the pixels a box's corners span.

import { YAW_UNITS } from "../../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../../shared/math/scalar.ts";
import { sortF64 } from "../../../shared/sort.ts";
import type { CityStatics } from "../../../shared/world/city.ts";
import type { Camera } from "./camera.ts";

const QUARTER = YAW_UNITS / 4;
const QUARTER_COS = [1, 0, -1, 0];
const QUARTER_SIN = [0, 1, 0, -1];

/** A kind's plates: at most this many, each this many square metres across at least. */
const PLATES = 3;
const PLATE_LEAST = 0.5;
/** An occluder is kept where its largest face is this many square metres, and each is shrunk this many metres a side. */
const FACE_LEAST = 4;
const SHRINK = 0.03;
/**
 * Floats an occluder takes: its middle in the world, its half extents along its frame's axes, its frame's cosine and
 * sine, the radius of a sphere round it, and the middle of its three extents.
 */
export const OCCLUDER = 10;
/**
 * The picture's height in pixels; its width follows the view's aspect. Chosen on the census's Miami street on high:
 * 72 rows hid 0.44 M of 1.03 M triangles at 0.13 to 0.23 ms of Bun's time a frame, 96 rows 0.46 M at 0.22 to 0.31.
 */
export const HIDE_ROWS = 72;
/** The fewest pixels across an occluder's face may be on the picture, at its nearest, for it to be put in. */
export const HIDE_PIXELS = 2;
/** Pixels a side of the blocks whose farthest depth a test reads first. */
const BLOCK = 8;
/**
 * A box is hidden where what covers it is nearer than its nearest point by this many metres and this share of that
 * point's depth: more than a mesh's lattice moves a face (nearcity.ts store, 2^-7 m at the coarsest).
 */
const SLACK = 0.02;
const MARGIN = 1e-4;

/** The plates of each kind of a city, found when first asked for: six numbers each, least then most, in the piece's own frame. */
export class KindPlates {
  readonly city: CityStatics;
  private readonly found = new Map<number, Float64Array>();

  constructor(city: CityStatics) {
    this.city = city;
  }

  of(k: number): Float64Array {
    let p = this.found.get(k);
    if (p) return p;
    const c = this.city;
    if (c.plain[k] === 1) p = Float64Array.of(-c.halfX[k]!, -c.halfY[k]!, -c.halfZ[k]!, c.halfX[k]!, c.halfY[k]!, c.halfZ[k]!);
    else {
      // A look's boxes are stored to a float's precision: faces meant to meet are taken to meet to the tenth of a millimetre.
      const B = c.look.box, snap = (v: number): number => Math.round(v * 1e4) / 1e4;
      const boxes: number[] = [];
      for (let b = c.look.start[k]! * 6; b < c.look.start[k + 1]! * 6; b += 6) for (const sign of [-1, 1]) for (let a = 0; a < 3; a++) boxes.push(snap(B[b + a]! + sign * B[b + 3 + a]!));
      p = Float64Array.from(plates(boxes));
    }
    this.found.set(k, p);
    return p;
  }
}

/**
 * Boxes wholly inside the union of `boxes` (six numbers each, least then most), as large across as can be found, across
 * the axis the union is thinnest along: on the grid every box's faces cut, each the largest rectangle of cells filled in
 * a slice a cell thick, or in the plane between two such slices, of no thickness, which every box touching it fills; the
 * next where those before it do not already cover. A facade's module is closed in such a plane where its recessed panes
 * meet its piers.
 */
export function plates(boxes: readonly number[]): number[] {
  const n = boxes.length / 6;
  if (n === 0) return [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, boxes[b * 6 + a]!);
      hi[a] = Math.max(hi[a]!, boxes[b * 6 + 3 + a]!);
    }
  }
  let t = 0;
  for (let a = 1; a < 3; a++) if (hi[a]! - lo[a]! < hi[t]! - lo[t]!) t = a;
  const u = (t + 1) % 3, v = (t + 2) % 3;
  const cuts = [t, u, v].map((a) => [...new Set(boxes.filter((_, i) => i % 3 === a))].sort((p, q) => p - q));
  const [ct, cu, cv] = cuts as [number[], number[], number[]];
  const nt = ct.length - 1, nu = cu.length - 1, nv = cv.length - 1;
  const filled = new Uint8Array(nt * nu * nv);
  for (let b = 0; b < n; b++) {
    const t0 = ct.indexOf(boxes[b * 6 + t]!), t1 = ct.indexOf(boxes[b * 6 + 3 + t]!);
    const u0 = cu.indexOf(boxes[b * 6 + u]!), u1 = cu.indexOf(boxes[b * 6 + 3 + u]!);
    const v0 = cv.indexOf(boxes[b * 6 + v]!), v1 = cv.indexOf(boxes[b * 6 + 3 + v]!);
    for (let k = t0; k < t1; k++) for (let i = u0; i < u1; i++) filled.fill(1, (k * nu + i) * nv + v0, (k * nu + i) * nv + v1);
  }
  // Slice 2k is the plane at cut k, and 2k + 1 the cells between cuts k and k + 1.
  const sliced = new Uint8Array((2 * nt + 1) * nu * nv);
  for (let k = 0; k < nt; k++) {
    const cells = filled.subarray(k * nu * nv, (k + 1) * nu * nv);
    sliced.set(cells, (2 * k + 1) * nu * nv);
    for (const plane of [2 * k, 2 * k + 2]) for (let i = 0; i < nu * nv; i++) sliced[plane * nu * nv + i]! |= cells[i]!;
  }
  const used = new Uint8Array(nu * nv);
  const col = new Uint8Array(nv);
  const out: number[] = [];
  for (let p = 0; p < PLATES; p++) {
    let best = PLATE_LEAST, at = -1, i0 = 0, i1 = 0, j0 = 0, j1 = 0;
    for (let k = 0; k < 2 * nt + 1; k++) {
      for (let a = 0; a < nu; a++) {
        col.fill(1);
        let width = 0;
        for (let b = a; b < nu; b++) {
          width += cu[b + 1]! - cu[b]!;
          let run = 0, from = 0;
          for (let j = 0; j < nv; j++) {
            col[j] = col[j]! & sliced[(k * nu + b) * nv + j]! & (1 - used[b * nv + j]!);
            if (col[j] === 0) {
              run = 0;
              from = j + 1;
              continue;
            }
            run += cv[j + 1]! - cv[j]!;
            if (width * run <= best) continue;
            best = width * run;
            at = k;
            i0 = a;
            i1 = b;
            j0 = from;
            j1 = j;
          }
        }
      }
    }
    if (at < 0) break;
    const box = [0, 0, 0, 0, 0, 0];
    box[t] = ct[at >> 1]!;
    box[t + 3] = ct[(at + 1) >> 1]!;
    box[u] = cu[i0]!;
    box[u + 3] = cu[i1 + 1]!;
    box[v] = cv[j0]!;
    box[v + 3] = cv[j1 + 1]!;
    out.push(...box);
    for (let i = i0; i <= i1; i++) used.fill(1, i * nv + j0, i * nv + j1 + 1);
  }
  return out;
}

/**
 * The picture of what hides what this frame: per pixel the inverse of the nearest view depth at which an occluder covers
 * all of the pixel, 0 for none; and per block of BLOCK pixels a side the least of its pixels'.
 */
export class Hiding {
  /** Whether the picture holds anything this frame; a test of an empty one hides nothing. */
  on = false;
  /** Occluders and boxes tested this frame, and of those boxes the hidden. */
  readonly stats = { occluders: 0, tested: 0, hidden: 0 };
  /**
   * Where the ground hides what is under it this frame (`hidesOver`): the lowest the ground drawn may stand over a
   * camera-relative rectangle of x and z, -Infinity where it does not say; and how far off a box may reach and still be
   * under ground drawn. Null for nowhere.
   */
  under: ((x0: number, z0: number, x1: number, z1: number) => number) | null = null;
  underReach = 0;
  width = 0;
  readonly height = HIDE_ROWS;
  private near = new Float32Array(0);
  private blocks = new Float32Array(0);
  private across = 0;
  /** The view's rows: x and y on the screen, and the view depth, of a camera-relative point; the near plane. */
  private readonly m = new Float64Array(12);
  private clip = 0.25;
  /** Pixels a metre across covers at a view depth of one metre. */
  private focal = 1;
  /** The camera-relative point at view depth 1 at a pixel's corner (0, 0), and how it moves a pixel right and a pixel up. */
  private readonly at = new Float64Array(9);
  /** Scratch: a face's corners, camera-relative, then clipped, each x, y, z; and on the screen, each x, y. */
  private readonly face = new Float64Array(12);
  private readonly poly = new Float64Array(24);
  private readonly cut = new Float64Array(24);
  private readonly screen = new Float64Array(16);

  /** Starts an empty picture for the view `cam` has, which `cam.update()` has set. */
  begin(cam: Camera): void {
    const width = Math.max(1, Math.round(HIDE_ROWS * cam.aspect));
    if (width !== this.width) {
      this.width = width;
      this.near = new Float32Array(width * HIDE_ROWS);
      this.across = Math.ceil(width / BLOCK);
      this.blocks = new Float32Array(this.across * Math.ceil(HIDE_ROWS / BLOCK));
    }
    this.near.fill(0);
    this.on = false;
    this.under = null;
    this.stats.occluders = this.stats.tested = this.stats.hidden = 0;
    const v = cam.viewProj, m = this.m;
    for (let c = 0; c < 3; c++) {
      m[c] = v[c * 4]!;
      m[4 + c] = v[c * 4 + 1]!;
      m[8 + c] = v[c * 4 + 3]!;
    }
    this.clip = cam.near;
    this.focal = HIDE_ROWS / (2 * Math.tan(cam.fovY / 2));
    // The inverse of the rows x, y and depth, by cofactors: a pixel's corner (i, j) is (2i / W - 1, 2j / H - 1) on the
    // screen, and the camera-relative point at depth 1 there is the inverse times (that, 1).
    const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, k = m[10]!;
    const inv = [e * k - f * h, c * h - b * k, b * f - c * e, f * g - d * k, a * k - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
    const det = a * inv[0]! + b * inv[3]! + c * inv[6]!;
    const W = this.width, H = HIDE_ROWS;
    for (let r = 0; r < 3; r++) {
      const cx = inv[r * 3]! / det, cy = inv[r * 3 + 1]! / det, cw = inv[r * 3 + 2]! / det;
      this.at[r] = cw - cx - cy;
      this.at[3 + r] = (2 / W) * cx;
      this.at[6 + r] = (2 / H) * cy;
    }
  }

  /**
   * Puts in the picture a box at camera-relative (x, y, z), of half extents (hx, hy, hz) along the axes its frame's (c,
   * s) turns: each face turned to the camera that may cover a pixel whole, wider than a pixel across at its nearest.
   */
  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, c: number, s: number): void {
    this.stats.occluders++;
    const m = this.m;
    // The frame's axes in the world: x is (c, 0, -s) and z is (s, 0, c). The camera in the frame.
    const lx = -(c * x - s * z), ly = -y, lz = -(s * x + c * z);
    const middle = m[8]! * x + m[9]! * y + m[10]! * z, nearest = middle - hx - hy - hz;
    const least = nearest > this.clip ? nearest / (2 * this.focal) : 0;
    const fx = lx > hx ? 1 : lx < -hx ? -1 : 0, fy = ly > hy ? 1 : ly < -hy ? -1 : 0, fz = lz > hz ? 1 : lz < -hz ? -1 : 0;
    const showX = fx !== 0 && Math.min(hy, hz) > least, showY = fy !== 0 && Math.min(hx, hz) > least, showZ = fz !== 0 && Math.min(hx, hy) > least;
    if (!showX && !showY && !showZ) return;
    if (nearest <= this.clip) {
      // Past the near plane in part: each face clipped by itself.
      if (showX) this.side(x, y, z, fx * c, 0, -fx * s, hx, 0, 1, 0, hy, s, 0, c, hz);
      if (showY) this.side(x, y, z, 0, fy, 0, hy, s, 0, c, hz, c, 0, -s, hx);
      if (showZ) this.side(x, y, z, fx === 0 ? fz * s : fz * s, 0, fz * c, hz, c, 0, -s, hx, 0, 1, 0, hy);
      return;
    }
    // Wholly past it: the eight corners on the picture once, corner k at +x where k & 1, +y where k & 2, +z where k & 4.
    const W = this.width, H = HIDE_ROWS, cx = this.cornerX, cy = this.cornerY;
    for (let k = 0; k < 8; k++) {
      const a = k & 1 ? hx : -hx, b = k & 2 ? hy : -hy, e = k & 4 ? hz : -hz;
      const px = x + c * a + s * e, py = y + b, pz = z - s * a + c * e;
      const w = m[8]! * px + m[9]! * py + m[10]! * pz;
      cx[k] = ((m[0]! * px + m[1]! * py + m[2]! * pz) / w + 1) * 0.5 * W;
      cy[k] = ((m[4]! * px + m[5]! * py + m[6]! * pz) / w + 1) * 0.5 * H;
    }
    if (showX) this.quad(fx > 0 ? 1 : 0, fx > 0 ? 3 : 2, fx > 0 ? 7 : 6, fx > 0 ? 5 : 4, fx * c, 0, -fx * s, fx * c * (x + fx * c * hx) - fx * s * (z - fx * s * hx));
    if (showY) this.quad(fy > 0 ? 2 : 0, fy > 0 ? 6 : 4, fy > 0 ? 7 : 5, fy > 0 ? 3 : 1, 0, fy, 0, fy * (y + fy * hy));
    if (showZ) this.quad(fz > 0 ? 4 : 0, fz > 0 ? 5 : 1, fz > 0 ? 7 : 3, fz > 0 ? 6 : 2, fz * s, 0, fz * c, fz * s * (x + fz * s * hz) + fz * c * (z + fz * c * hz));
  }

  /** Corners of the box being put in, on the picture. */
  private readonly cornerX = new Float64Array(8);
  private readonly cornerY = new Float64Array(8);

  /** A face of four of the box's corners on the picture, in turn round it, on the plane n . p = d. */
  private quad(a: number, b: number, c: number, e: number, nx: number, ny: number, nz: number, d: number): void {
    const sc = this.screen, cx = this.cornerX, cy = this.cornerY;
    sc[0] = cx[a]!;
    sc[1] = cy[a]!;
    sc[2] = cx[b]!;
    sc[3] = cy[b]!;
    sc[4] = cx[c]!;
    sc[5] = cy[c]!;
    sc[6] = cx[e]!;
    sc[7] = cy[e]!;
    this.fill(4, nx, ny, nz, d);
  }

  /**
   * One face of a box about (x, y, z): its outward axis (nx, ny, nz) at `out` from the middle, spanned by axes (ax, ay,
   * az) and (bx, by, bz) to `ha` and `hb` either way, wound so that (a, b, n) turn as (x, y, z) do.
   */
  private side(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: number, ax: number, ay: number, az: number, ha: number, bx: number, by: number, bz: number, hb: number): void {
    const cx = x + nx * out, cy = y + ny * out, cz = z + nz * out;
    const f = this.face;
    for (let k = 0; k < 4; k++) {
      const sa = k === 0 || k === 3 ? -ha : ha, sb = k < 2 ? -hb : hb;
      f[k * 3] = cx + ax * sa + bx * sb;
      f[k * 3 + 1] = cy + ay * sa + by * sb;
      f[k * 3 + 2] = cz + az * sa + bz * sb;
    }
    this.polygon(f, 4, nx, ny, nz, nx * cx + ny * cy + nz * cz);
  }

  /**
   * Puts in the picture a convex polygon of `count` camera-relative corners in `src` on the plane n . p = d, which the
   * camera is on the outer side of (d < 0): clipped at the near plane, and each pixel it covers whole at the plane's
   * farthest depth over the pixel.
   */
  private polygon(src: Float64Array, count: number, nx: number, ny: number, nz: number, d: number): void {
    const m = this.m, poly = this.poly;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = i * 3, b = ((i + 1) % count) * 3;
      const w0 = m[8]! * src[a]! + m[9]! * src[a + 1]! + m[10]! * src[a + 2]! - this.clip;
      const w1 = m[8]! * src[b]! + m[9]! * src[b + 1]! + m[10]! * src[b + 2]! - this.clip;
      if (w0 >= 0) {
        poly[n * 3] = src[a]!;
        poly[n * 3 + 1] = src[a + 1]!;
        poly[n * 3 + 2] = src[a + 2]!;
        n++;
      }
      if (w0 >= 0 !== w1 >= 0) {
        const t = w0 / (w0 - w1);
        for (let e = 0; e < 3; e++) poly[n * 3 + e] = src[a + e]! + (src[b + e]! - src[a + e]!) * t;
        n++;
      }
    }
    if (n < 3) return;
    const W = this.width, H = HIDE_ROWS, sc = this.screen;
    for (let i = 0; i < n; i++) {
      const px = poly[i * 3]!, py = poly[i * 3 + 1]!, pz = poly[i * 3 + 2]!;
      const w = m[8]! * px + m[9]! * py + m[10]! * pz;
      sc[i * 2] = ((m[0]! * px + m[1]! * py + m[2]! * pz) / w + 1) * 0.5 * W;
      sc[i * 2 + 1] = ((m[4]! * px + m[5]! * py + m[6]! * pz) / w + 1) * 0.5 * H;
    }
    this.fill(n, nx, ny, nz, d);
  }

  /**
   * Puts in the picture the convex polygon of `n` corners on the picture in `screen`, on the plane n . p = d, which the
   * camera is on the outer side of: each pixel it covers whole, at the plane's farthest depth over the pixel.
   */
  private fill(n: number, nx: number, ny: number, nz: number, d: number): void {
    const W = this.width, H = HIDE_ROWS, sc = this.screen;
    let y0 = Infinity, y1 = -Infinity, area = 0;
    for (let i = 0; i < n; i++) {
      y0 = Math.min(y0, sc[i * 2 + 1]!);
      y1 = Math.max(y1, sc[i * 2 + 1]!);
    }
    if (Math.ceil(y1) - Math.floor(y0) < 1) return;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += sc[i * 2]! * sc[j * 2 + 1]! - sc[j * 2]! * sc[i * 2 + 1]!;
    }
    if (area === 0) return;
    // Each edge as A x + B y + C, at least 0 inside.
    const sign = area > 0 ? 1 : -1, edges = this.cut;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = sc[i * 2]!, ay = sc[i * 2 + 1]!, bx = sc[j * 2]!, by = sc[j * 2 + 1]!;
      edges[i * 3] = sign * (ay - by);
      edges[i * 3 + 1] = sign * (bx - ax);
      edges[i * 3 + 2] = sign * (ax * by - bx * ay);
    }
    // The inverse depth at a pixel's corner (i, j) on the plane: (n . at(i, j)) / d.
    const at = this.at;
    const pc = (nx * at[0]! + ny * at[1]! + nz * at[2]!) / d;
    const pi = (nx * at[3]! + ny * at[4]! + nz * at[5]!) / d;
    const pj = (nx * at[6]! + ny * at[7]! + nz * at[8]!) / d;
    const near = this.near;
    let any = false;
    for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(H - 1, Math.ceil(y1) - 1); j++) {
      let lo = 0, hi = W - 1;
      for (let e = 0; e < n && lo <= hi; e++) {
        const A = edges[e * 3]!, B = edges[e * 3 + 1]!, C = edges[e * 3 + 2]!;
        // The pixel's corner where the edge's function is least, a hair inside for rounding.
        const R = -(C + B * (B < 0 ? j + 1 : j) + Math.min(A, 0)) + 1e-6 * (Math.abs(A) + Math.abs(B));
        if (A > 0) lo = Math.max(lo, Math.ceil(R / A));
        else if (A < 0) hi = Math.min(hi, Math.floor(R / A));
        else if (R > 0) hi = -1;
      }
      const row = j * W;
      const fj = pc + pj * (pj < 0 ? j + 1 : j) + (pi < 0 ? pi : 0);
      for (let i = lo; i <= hi; i++) {
        const iw = fj + pi * i;
        if (iw > near[row + i]!) near[row + i] = iw;
        any = true;
      }
    }
    if (any) this.on = true;
  }

  /** Once every occluder is in: each block's least. */
  end(): void {
    const W = this.width, H = HIDE_ROWS, near = this.near, blocks = this.blocks.fill(Infinity), across = this.across;
    for (let j = 0; j < H; j++) {
      const row = Math.floor(j / BLOCK) * across;
      for (let i = 0; i < W; i++) {
        const b = row + Math.floor(i / BLOCK), v = near[j * W + i]!;
        if (v < blocks[b]!) blocks[b] = v;
      }
    }
  }

  /**
   * As `hides`, what of the box lies under the ground drawn, by the depth slack, hidden by it. A face level with the
   * ground is not under it: which of the two is drawn there is the order's to say.
   */
  hidesOver(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    if (!this.on) return false;
    const far = Math.hypot(Math.max(-minX, maxX), Math.max(-minY, maxY), Math.max(-minZ, maxZ));
    if (this.under && far <= this.underReach) {
      const ground = this.under(minX, minZ, maxX, maxZ) - SLACK - MARGIN * far;
      if (ground > maxY) {
        this.stats.tested++;
        this.stats.hidden++;
        return true;
      }
      minY = Math.max(minY, ground);
    }
    return this.hides(minX, minY, minZ, maxX, maxY, maxZ);
  }

  /**
   * Whether the picture hides all of a camera-relative box: every pixel its corners span holds an occluder nearer than
   * its nearest corner. A box reaching the near plane, or off the screen, is not hidden.
   */
  hides(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    if (!this.on) return false;
    this.stats.tested++;
    if (!this.span(minX, minY, minZ, maxX, maxY, maxZ)) return false;
    const W = this.width, near = this.near, blocks = this.blocks, need = this.need;
    const i0 = this.i0, i1 = this.i1, j0 = this.j0, j1 = this.j1;
    for (let bj = Math.floor(j0 / BLOCK); bj <= Math.floor(j1 / BLOCK); bj++) {
      for (let bi = Math.floor(i0 / BLOCK); bi <= Math.floor(i1 / BLOCK); bi++) {
        if (blocks[bj * this.across + bi]! > need) continue;
        for (let j = Math.max(j0, bj * BLOCK); j <= Math.min(j1, bj * BLOCK + BLOCK - 1); j++) {
          for (let i = Math.max(i0, bi * BLOCK); i <= Math.min(i1, bi * BLOCK + BLOCK - 1); i++) if (near[j * W + i]! <= need) return false;
        }
      }
    }
    this.stats.hidden++;
    return true;
  }

  /**
   * About how much of a camera-relative box the picture hides, 0 to 1: of SAMPLES by SAMPLES pixels spread over those
   * its corners span, the share holding an occluder nearer than its nearest corner. For whether its parts are worth
   * testing one by one; only `hides` says a box is hidden.
   */
  share(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    if (!this.on || !this.span(minX, minY, minZ, maxX, maxY, maxZ)) return 0;
    const W = this.width, near = this.near, need = this.need;
    let n = 0;
    for (let a = 0; a < SAMPLES; a++) {
      const j = this.j0 + Math.floor(((this.j1 - this.j0) * (a + 0.5)) / SAMPLES);
      for (let b = 0; b < SAMPLES; b++) if (near[j * W + this.i0 + Math.floor(((this.i1 - this.i0) * (b + 0.5)) / SAMPLES)]! > need) n++;
    }
    return n / (SAMPLES * SAMPLES);
  }

  /** The pixels a box's corners span, i0 to i1 and j0 to j1, and the inverse depth an occluder must pass: false for none. */
  private i0 = 0;
  private i1 = 0;
  private j0 = 0;
  private j1 = 0;
  private need = 0;

  private span(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const m = this.m, W = this.width, H = HIDE_ROWS;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, wNear = Infinity;
    for (let k = 0; k < 8; k++) {
      const px = k & 1 ? maxX : minX, py = k & 2 ? maxY : minY, pz = k & 4 ? maxZ : minZ;
      const w = m[8]! * px + m[9]! * py + m[10]! * pz;
      if (w <= this.clip) return false;
      const sx = ((m[0]! * px + m[1]! * py + m[2]! * pz) / w + 1) * 0.5 * W;
      const sy = ((m[4]! * px + m[5]! * py + m[6]! * pz) / w + 1) * 0.5 * H;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
      if (w < wNear) wNear = w;
    }
    this.i0 = Math.max(0, Math.floor(x0));
    this.i1 = Math.min(W - 1, Math.floor(x1));
    this.j0 = Math.max(0, Math.floor(y0));
    this.j1 = Math.min(H - 1, Math.floor(y1));
    if (this.i0 > this.i1 || this.j0 > this.j1 || wNear - SLACK <= this.clip) return false;
    this.need = (1 + MARGIN) / (wNear - SLACK);
    return true;
  }
}

/** Samples a side `Hiding.share` reads; and the share of them a far tile's must show hidden for its parts to be tested one by one. */
const SAMPLES = 4;
export const WORTH = 0.5;

/** What the far layers ask of the picture of what hides what (Hiding). */
export interface Hider {
  hides(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean;
  share(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number;
}

/** Scratch for a chunk's boxes: seven numbers each, least then most and the frame they are in; their places to the centimetre; keys. */
let framed = new Float64Array(7 * 1024);
let spare = new Float64Array(7 * 1024);
let cms = new Int32Array(6 * 1024);
let keys = new Float64Array(1024);

/**
 * Where a chunk's mesh stores its vertices (nearcity.ts store): the chunk's corner, x and z, and per axis the middle of
 * its lattice from that corner (y from 0) and the lattice's step, in metres.
 */
export interface Lattice {
  readonly x0: number;
  readonly z0: number;
  readonly center: readonly number[];
  readonly step: readonly number[];
}

/**
 * The occluders of the pieces of `chunk` that `mine` marks, a byte a piece in the city's order: their plates in their
 * frames, merged where they meet face to face across the same cross-section, the small ones left out and the rest
 * shrunk (OCCLUDER floats each). Pieces meet where their faces meet or overlap; in a frame of no turn, where the mesh's
 * `lattice` puts the faces' vertices together or past each other, which its rounding keeps where they meet or overlap.
 */
export function chunkOccluders(city: CityStatics, chunk: number, mine: Uint8Array, kinds: KindPlates, lattice?: Lattice): Float32Array {
  const { first, kind, yaw, x, y, z } = city;
  const from = first[chunk]!;
  let n = 0;
  for (let i = from; i < first[chunk + 1]!; i++) {
    if (mine[i - from] !== 1) continue;
    const f = yaw[i]! % QUARTER;
    const a = (f / YAW_UNITS) * TAU;
    const c = detCos(a), s = detSin(a);
    const lx = c * x[i]! - s * z[i]!, lz = s * x[i]! + c * z[i]!;
    const quarter = Math.floor(yaw[i]! / QUARTER) % 4;
    const odd = quarter % 2 === 1;
    const qc = QUARTER_COS[quarter]!, qs = QUARTER_SIN[quarter]!;
    const p = kinds.of(kind[i]!);
    for (let b = 0; b < p.length; b += 6) {
      const mx = (p[b]! + p[b + 3]!) / 2, my = (p[b + 1]! + p[b + 4]!) / 2, mz = (p[b + 2]! + p[b + 5]!) / 2;
      const hx = (p[b + 3]! - p[b]!) / 2, hy = (p[b + 4]! - p[b + 1]!) / 2, hz = (p[b + 5]! - p[b + 2]!) / 2;
      const fx = lx + qc * mx + qs * mz, fy = y[i]! + my, fz = lz + qc * mz - qs * mx;
      const ex = odd ? hz : hx, ez = odd ? hx : hz;
      if ((n + 1) * 7 > framed.length) {
        const grown = new Float64Array(framed.length * 2);
        grown.set(framed);
        framed = grown;
        spare = new Float64Array(grown.length);
      }
      const o = n * 7;
      framed[o] = fx - ex;
      framed[o + 1] = fy - hy;
      framed[o + 2] = fz - ez;
      framed[o + 3] = fx + ex;
      framed[o + 4] = fy + hy;
      framed[o + 5] = fz + ez;
      framed[o + 6] = f;
      n++;
    }
  }
  n = merge(n, lattice);
  const out: number[] = [];
  for (let b = 0; b < n; b++) {
    const o = b * 7;
    const dx = framed[o + 3]! - framed[o]!, dy = framed[o + 4]! - framed[o + 1]!, dz = framed[o + 5]! - framed[o + 2]!;
    if (Math.max(dx * dy, dy * dz, dx * dz) < FACE_LEAST) continue;
    // A plate of no thickness is shrunk across alone.
    const hx = dx > 0 ? dx / 2 - SHRINK : 0, hy = dy > 0 ? dy / 2 - SHRINK : 0, hz = dz > 0 ? dz / 2 - SHRINK : 0;
    if (hx < 0 || hy < 0 || hz < 0 || (hx === 0 ? 1 : 0) + (hy === 0 ? 1 : 0) + (hz === 0 ? 1 : 0) > 1) continue;
    const a = (framed[o + 6]! / YAW_UNITS) * TAU;
    const c = detCos(a), s = detSin(a);
    const fx = framed[o]! + dx / 2, fy = framed[o + 1]! + dy / 2, fz = framed[o + 2]! + dz / 2;
    out.push(c * fx + s * fz, fy, c * fz - s * fx, hx, hy, hz, c, s, Math.hypot(hx, hy, hz), 2 * (hx + hy + hz - Math.max(hx, hy, hz) - Math.min(hx, hy, hz)));
  }
  return Float32Array.from(out);
}

/**
 * Merges the first `n` boxes of `framed` along y, x, z and y again: two boxes of one frame and one cross-section across
 * the axis, to the centimetre, become one where they meet or overlap along it (`chunkOccluders`). Returns how many are left.
 */
function merge(n: number, lattice: Lattice | undefined): number {
  if (n === 0) return 0;
  if (keys.length < n) {
    keys = new Float64Array(n * 2);
    cms = new Int32Array(n * 12);
  }
  // Places from the first box's corner, so a key holds them to the centimetre.
  const origin = [Math.round(framed[0]!), Math.round(framed[1]!), Math.round(framed[2]!)];
  const corner = lattice ? [lattice.x0, 0, lattice.z0] : [0, 0, 0];
  for (const ax of [1, 0, 2, 1]) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    for (let b = 0; b < n; b++) for (let e = 0; e < 6; e++) cms[b * 6 + e] = Math.round((framed[b * 7 + e]! - origin[e % 3]!) * 100);
    for (let b = 0; b < n; b++) {
      const c = b * 6;
      let h = Math.imul(cms[c + u]! ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(cms[c + u + 3]!, 0xc2b2ae35) ^ Math.imul(cms[c + v]! + 0x165667b1, 0x27d4eb2f) ^ Math.imul(cms[c + v + 3]!, 0x9e3779b1) ^ Math.imul(framed[b * 7 + 6]! + 1, 0x7feb352d);
      h = (h ^ (h >>> 16)) & 0xffff;
      keys[b] = (h * 131072 + Math.max(0, Math.min(131071, cms[c + ax]! + 65536))) * 65536 + b;
    }
    sortF64(keys, 0, n);
    const step = lattice?.step[ax] ?? 0, mid = lattice ? corner[ax]! + lattice.center[ax]! : 0;
    let kept = 0, last = -1;
    for (let e = 0; e < n; e++) {
      const b = keys[e]! % 65536, cb = b * 6, cl = last * 6;
      if (last >= 0 && framed[b * 7 + 6] === framed[last * 7 + 6] && cms[cb + u] === cms[cl + u] && cms[cb + u + 3] === cms[cl + u + 3] && cms[cb + v] === cms[cl + v] && cms[cb + v + 3] === cms[cl + v + 3]) {
        const l = (kept - 1) * 7, lo = framed[b * 7 + ax]!, hi = spare[l + 3 + ax]!;
        if (lo <= hi || (step > 0 && framed[b * 7 + 6] === 0 && Math.round((lo - mid) / step) <= Math.round((hi - mid) / step))) {
          spare[l + 3 + ax] = Math.max(hi, framed[b * 7 + 3 + ax]!);
          last = b;
          continue;
        }
      }
      spare.set(framed.subarray(b * 7, b * 7 + 7), kept * 7);
      kept++;
      last = b;
    }
    const swap = framed;
    framed = spare;
    spare = swap;
    n = kept;
  }
  return n;
}
