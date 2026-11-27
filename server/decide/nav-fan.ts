// Many level rays from about one point, as castWorld (shared/world/ray.ts) casts them with `solidOnly`, for less. castWorld
// asks the grids of pieces and of nodes again for every ray; a fan asks once for all of them (`gather`), keeps each
// piece's frame, and gives each ray only the pieces whose circle it passes through. Its distances are castWorld's to the
// bit (tests/creatures/decide-fan.test.ts).

import { PAD, type CollisionWorld } from "../../shared/world/collide.ts";
import { rayHull } from "../../shared/world/convex.ts";
import { CLASS_STRETCH_MOST, frame, frameOf } from "../../shared/world/frame.ts";
import { rayBox, rayGround } from "../../shared/world/ray.ts";
import { Found, type StructureStore } from "../../shared/world/structures.ts";

/** castWorld's own growth of a box's sides and a hull's planes. */
const SEAL = 1e-6;
/** Metres added to a piece's circle, against rounding. */
const SLACK = 0.01;

export class Fan {
  private readonly world: CollisionWorld;
  private readonly found = new Found(256);
  /** The pieces gathered: which store, the piece's centre, its frame, its kind, and the radius of a circle round it. */
  private n = 0;
  private pass = new Uint8Array(256);
  private px = new Float64Array(256);
  private py = new Float64Array(256);
  private pz = new Float64Array(256);
  private sin = new Float64Array(256);
  private cos = new Float64Array(256);
  private shrink = new Float64Array(256);
  private yaw = new Uint16Array(256);
  private tw = new Uint8Array(256);
  private kind = new Uint16Array(256);
  private rad = new Float64Array(256);
  /** The highest the ground stands under all that was gathered: a ray above it meets no ground. */
  private groundTop = Infinity;
  /** By store, each kind's circle in its own lengths (-1 not yet known), and the box table it was found from. */
  private readonly kindRad: [Float32Array, Float32Array] = [new Float32Array(0), new Float32Array(0)];
  private readonly kindOf: [Float32Array | null, Float32Array | null] = [null, null];

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  /** Gathers what a level ray from within `reach` metres of (x, z), between heights `y0` and `y1`, may meet. */
  gather(x: number, z: number, reach: number, y0: number, y1: number): void {
    this.n = 0;
    this.groundTop = this.topIn(x - reach, z - reach, x + reach, z + reach);
    for (let pass = 0; pass < 2; pass++) {
      const store = pass === 0 ? this.world.structs : this.world.nodes;
      if (!store) continue;
      const count = store.query(x - reach, z - reach, x + reach, z + reach, this.found, y0 - PAD, y1 + PAD);
      for (let i = 0; i < count; i++) {
        const r = this.found.refs[i]!;
        const t = store.chunks[Math.floor(r / 65536)]!, slot = r & 0xffff, k = t.kind[slot]!;
        if (store.isSoft(k)) continue;
        if (this.n === this.pass.length) this.grow();
        const at = this.n++, yaw = t.yaw[slot]!, tw = t.twAt(slot);
        frameOf(yaw, tw);
        this.pass[at] = pass;
        this.px[at] = t.x[slot]!;
        this.py[at] = t.y[slot]!;
        this.pz[at] = t.z[slot]!;
        this.sin[at] = frame.sin;
        this.cos[at] = frame.cos;
        this.shrink[at] = 1 / frame.stretch;
        this.yaw[at] = yaw;
        this.tw[at] = tw;
        this.kind[at] = k;
        this.rad[at] = this.radiusOf(store, pass, k) * CLASS_STRETCH_MOST + SLACK;
      }
    }
  }

  /** The free run of a level ray from (ox, oy, oz) along (dx, dz), a unit, as castWorld gives it in `rayHit.t`. */
  cast(ox: number, oy: number, oz: number, dx: number, dz: number, maxT: number): number {
    const ground = oy > this.groundTop ? Infinity : rayGround(this.world.hf, ox, oy, oz, dx, 0, dz, maxT);
    let best = ground <= maxT ? ground : maxT;
    for (let c = 0; c < this.n; c++) {
      const px = ox - this.px[c]!, pz = oz - this.pz[c]!, rad = this.rad[c]!;
      // The piece's circle lies off the ray's first `best` metres.
      const along = -(px * dx + pz * dz), side = px * dz - pz * dx;
      if (side > rad || side < -rad || along < -rad || along > best + rad) continue;
      const store = this.pass[c] === 0 ? this.world.structs : this.world.nodes!;
      const s = this.sin[c]!, co = this.cos[c]!, shrink = this.shrink[c]!, k = this.kind[c]!;
      const lx = (co * px - s * pz) * shrink, ly = oy - this.py[c]!, lz = (s * px + co * pz) * shrink;
      const ldx = (co * dx - s * dz) * shrink, ldz = (s * dx + co * dz) * shrink;
      const box = store.parts.box, l2 = ldx * ldx + ldz * ldz, l = Math.sqrt(l2);
      for (let p = store.parts.start[k]! * 6, end = store.parts.start[k + 1]! * 6; p < end; p += 6) {
        const bx = box[p]!, by = box[p + 1]!, bz = box[p + 2]!, hx = box[p + 3]! + SEAL, hy = box[p + 4]!, hz = box[p + 5]! + SEAL;
        // A level ray misses a box it passes over or under, or whose circle it passes beside, before, or beyond `best`.
        if (ly < by - hy || ly > by + hy) continue;
        const ox2 = bx - lx, oz2 = bz - lz, half = Math.sqrt(hx * hx + hz * hz) + SLACK;
        const off = ox2 * ldz - oz2 * ldx, near = (ox2 * ldx + oz2 * ldz) / l2;
        if (off > half * l || off < -half * l || near + half / l < 0 || near - half / l > best) continue;
        const hit = rayBox(lx, ly, lz, ldx, 0, ldz, bx - hx, by - hy, bz - hz, bx + hx, by + hy, bz + hz);
        if (hit < best) best = hit;
      }
      const hulls = store.parts.hulls;
      for (let p = hulls ? hulls.start[k]! : 0, end = hulls ? hulls.start[k + 1]! : 0; p < end; p++) {
        const hit = rayHull(hulls!, p, this.yaw[c]!, this.tw[c]!, px, ly, pz, dx, 0, dz, SEAL);
        if (hit < best) best = hit;
      }
    }
    return best;
  }

  /** Pieces gathered last. */
  count(): number {
    return this.n;
  }

  /** The highest sample of the ground under the rectangle, in metres. */
  private topIn(x0: number, z0: number, x1: number, z1: number): number {
    const hf = this.world.hf, cell = hf.cell;
    const i0 = Math.max(0, Math.floor(x0 / cell)), j0 = Math.max(0, Math.floor(z0 / cell));
    const i1 = Math.min(hf.nx - 1, Math.floor(x1 / cell) + 1), j1 = Math.min(hf.nz - 1, Math.floor(z1 / cell) + 1);
    if (i1 < i0 || j1 < j0) return -Infinity;
    const view = hf.view(i0, j0, i1, j1), hts = view.heights, stride = view.stride;
    let top = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0, k = view.off + j * stride + i0; i <= i1; i++, k++) if (hts[k]! > top) top = hts[k]!;
    return hf.minY + top * hf.stepY;
  }

  /** The radius in its own lengths of a circle about a kind's centre that holds all its boxes and hulls. */
  private radiusOf(store: StructureStore, pass: number, k: number): number {
    const parts = store.parts;
    if (this.kindOf[pass] !== parts.box || this.kindRad[pass]!.length < parts.start.length) {
      this.kindOf[pass] = parts.box;
      this.kindRad[pass] = new Float32Array(parts.start.length).fill(-1);
    }
    const kept = this.kindRad[pass]!;
    if (kept[k]! >= 0) return kept[k]!;
    let r = 0;
    const box = parts.box;
    for (let p = parts.start[k]! * 6, end = parts.start[k + 1]! * 6; p < end; p += 6) {
      const ax = Math.abs(box[p]!) + box[p + 3]! + SEAL, az = Math.abs(box[p + 2]!) + box[p + 5]! + SEAL;
      const d = Math.sqrt(ax * ax + az * az);
      if (d > r) r = d;
    }
    const hulls = parts.hulls;
    if (hulls) {
      for (let p = hulls.start[k]!, end = hulls.start[k + 1]!; p < end; p++) {
        // A corner written (a, y, b) is placed along two axes of the frame, each at most this stretched: |a| + |b| bounds it.
        for (let c = hulls.corner[p]!, last = hulls.corner[p + 1]!; c < last; c++) {
          const d = Math.abs(hulls.at[c * 3]!) + Math.abs(hulls.at[c * 3 + 2]!) + SEAL;
          if (d > r) r = d;
        }
      }
    }
    kept[k] = r;
    return r;
  }

  private grow(): void {
    const n = this.pass.length * 2;
    const more = <T extends Uint8Array | Uint16Array | Float64Array>(a: T, b: T): T => (b.set(a), b);
    this.pass = more(this.pass, new Uint8Array(n));
    this.px = more(this.px, new Float64Array(n));
    this.py = more(this.py, new Float64Array(n));
    this.pz = more(this.pz, new Float64Array(n));
    this.sin = more(this.sin, new Float64Array(n));
    this.cos = more(this.cos, new Float64Array(n));
    this.shrink = more(this.shrink, new Float64Array(n));
    this.yaw = more(this.yaw, new Uint16Array(n));
    this.tw = more(this.tw, new Uint8Array(n));
    this.kind = more(this.kind, new Uint16Array(n));
    this.rad = more(this.rad, new Float64Array(n));
  }
}
