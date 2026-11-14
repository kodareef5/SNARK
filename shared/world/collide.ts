// Bodies are upright capsules and structure boxes turn about Y only, so the closest-point test in a box's frame is exact.
// capsuleFree is the authority on legal space. Movement, spawning, mounting and teleporting must all end in a position it accepts.

import { frame, frameOf } from "./frame.ts";
import type { Heightfield } from "./heightfield.ts";
import { Found, type PartTable, type StructureStore } from "./structures.ts";

/** Penetration below this depth counts as touching, not overlapping. */
export const SKIN = 0.002;

export interface CollisionWorld {
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes near a body, as boxes like structures (shared/world/nodes.ts). */
  readonly nodes?: StructureStore;
}

/** The shortest push out, in world space, from the last capsuleBox call that returned true. */
export const push = { x: 0, y: 0, z: 0, depth: 0 };

const found = new Found();
/** Metres added to a cheap reject, so that rounding never rejects a touch. */
export const PAD = 0.01;

/**
 * The capsule stands with its feet at (x, y, z), radius r and total height h. On an overlap deeper than `slack`, fills `push`
 * with the way out of the box it is deepest in and returns true.
 */
export function capsuleBox(structs: StructureStore, ref: number, x: number, y: number, z: number, r: number, h: number, slack: number): boolean {
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const slot = ref & 0xffff;
  const kind = t.kind[slot]!;
  if (structs.isSoft(kind)) return false;
  // Too far off sideways to touch at any yaw. Most of a grid cell's structures are.
  const dx = x - t.x[slot]!;
  const dz = z - t.z[slot]!;
  const far = structs.spread[kind]! + r + PAD;
  if (dx * dx + dz * dz >= far * far) return false;
  return capsuleKind(structs.parts, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, x, y, z, r, h, slack);
}

/** The same test against a structure of `kind` at (sx, sy, sz) facing `syaw`, built or not, to check a piece before it is built. */
export function capsuleKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, x: number, y: number, z: number, r: number, h: number, slack: number): boolean {
  frameOf(syaw);
  const s = frame.sin;
  const c = frame.cos;
  const wide = frame.stretch;
  // The capsule's axis in the structure's frame.
  const dx = x - sx;
  const dz = z - sz;
  const fx = c * dx - s * dz;
  const fz = s * dx + c * dz;
  const fy0 = y + r - sy;
  const fy1 = h > 2 * r ? y + h - r - sy : fy0;
  const reach = r - slack;
  const box = parts.box;
  let found = false;
  let deepest = 0;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    const hx = box[p + 3]! * wide;
    const hy = box[p + 4]!;
    const hz = box[p + 5]! * wide;
    // The axis relative to this box's centre.
    const lx = fx - box[p]! * wide;
    const lz = fz - box[p + 2]! * wide;
    const y0 = fy0 - box[p + 1]!;
    const y1 = fy1 - box[p + 1]!;

    // Closest points between the axis segment and the box.
    const px = lx < -hx ? -hx : lx > hx ? hx : lx;
    const pz = lz < -hz ? -hz : lz > hz ? hz : lz;
    const ex = lx - px;
    const ez = lz - pz;
    let ey = 0;
    if (y1 < -hy) ey = y1 + hy;
    else if (y0 > hy) ey = y0 - hy;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= reach * reach) continue;

    let ox: number;
    let oy: number;
    let oz: number;
    let depth: number;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      depth = r - d;
      const k = depth / d;
      ox = ex * k;
      oy = ey * k;
      oz = ez * k;
    } else {
      // The axis passes through the box, so leave by the nearest face.
      const xp = hx - lx + r;
      const xn = lx + hx + r;
      const zp = hz - lz + r;
      const zn = lz + hz + r;
      const yp = hy - y0 + r;
      const yn = y1 + hy + r;
      depth = xp;
      ox = xp;
      oy = 0;
      oz = 0;
      if (xn < depth) {
        depth = xn;
        ox = -xn;
      }
      if (zp < depth) {
        depth = zp;
        ox = 0;
        oz = zp;
      }
      if (zn < depth) {
        depth = zn;
        ox = 0;
        oz = -zn;
      }
      if (yp < depth) {
        depth = yp;
        ox = 0;
        oz = 0;
        oy = yp;
      }
      if (yn < depth) {
        depth = yn;
        ox = 0;
        oz = 0;
        oy = -yn;
      }
    }
    if (found && depth <= deepest) continue;
    found = true;
    deepest = depth;
    bx = ox;
    by = oy;
    bz = oz;
  }
  if (!found) return false;
  push.x = c * bx + s * bz;
  push.y = by;
  push.z = -s * bx + c * bz;
  push.depth = deepest;
  return true;
}

/** Filled by groundUnder: the unit normal of the ground where the body touches it. */
export const ground = { nx: 0, ny: 1, nz: 0 };

// The last groundUnder call, which movement asks again at the same place several times a substep.
let lastHf: Heightfield | null = null;
let lastX = NaN;
let lastZ = NaN;
let lastR = NaN;
let lastY = 0;
let lastNx = 0;
let lastNy = 1;
let lastNz = 0;
/** While groundUnder runs, per face under the sphere: the most its plane could hold the centre up, or -Infinity where it misses. */
let faceTop = new Float64Array(32);
/** While groundUnder tries edges: the height the sphere's centre must reach so far, and where it touches, from the centre. */
const held = new Float64Array(4);

/**
 * The lowest the feet of an upright capsule of radius `r` may stand over (x, z) and be clear of the ground, the triangles under
 * it as they are drawn. Its lower sphere then rests on a face, an edge or a corner of them, and `ground` is the normal there.
 */
export function groundUnder(hf: Heightfield, x: number, z: number, r: number): number {
  if (x === lastX && z === lastZ && r === lastR && hf === lastHf) {
    ground.nx = lastNx;
    ground.ny = lastNy;
    ground.nz = lastNz;
    return lastY;
  }
  const cell = hf.cell;
  const nx = hf.nx;
  const hts = hf.heights;
  const minY = hf.minY;
  const stepY = hf.stepY;
  let i0 = Math.floor((x - r) / cell);
  let i1 = Math.floor((x + r) / cell);
  let j0 = Math.floor((z - r) / cell);
  let j1 = Math.floor((z + r) / cell);
  if (i0 < 0) i0 = 0;
  if (j0 < 0) j0 = 0;
  if (i1 > nx - 2) i1 = nx - 2;
  if (j1 > hf.nz - 2) j1 = hf.nz - 2;
  if (i0 > i1) i0 = i1;
  if (j0 > j1) j0 = j1;
  const wide = i1 - i0 + 1;
  const cells = wide * (j1 - j0 + 1);
  if (faceTop.length < 2 * cells) faceTop = new Float64Array(4 * cells);
  const faces = faceTop;
  // The height the sphere's centre must reach so far, and where it touches, measured from the centre.
  let best = -Infinity;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  // The faces, the cell under the axis first. On its plane a face holds the centre highest where the sphere touches it uphill
  // of the axis, and that counts only if the point is on the face. `top` is the most any face's plane could hold it up.
  let top = -Infinity;
  let topOn = false;
  // The slope squared and the root of the last face worked out exactly. The root is concave, so its tangent there bounds the
  // root of any other face from above, and a face that could not beat the best even so is left at that bound.
  let refG2 = -1;
  let refS = 1;
  const perCell = 1 / cell;
  let first = (Math.floor(z * perCell) - j0) * wide + Math.floor(x * perCell) - i0;
  if (first < 0 || first >= cells) first = 0;
  for (let n = 0; n < cells; n++) {
    const slot = n + first < cells ? n + first : n + first - cells;
    const j = j0 + Math.floor(slot / wide);
    const i = i0 + slot - (j - j0) * wide;
    const k = j * nx + i;
    const h00 = minY + hts[k]! * stepY;
    const h10 = minY + hts[k + 1]! * stepY;
    const h01 = minY + hts[k + nx]! * stepY;
    const h11 = minY + hts[k + nx + 1]! * stepY;
    const dx = x - i * cell;
    const dz = z - j * cell;
    // How far the axis is to the lower face's side of the diagonal.
    const across = (dx - dz) * Math.SQRT1_2;
    for (let upper = 0; upper < 2; upper++) {
      const f = 2 * slot + upper;
      if (upper === 1 ? across >= r : across <= -r) {
        faces[f] = -Infinity;
        continue;
      }
      const gx = (upper === 1 ? h11 - h01 : h10 - h00) * perCell;
      const gz = (upper === 1 ? h01 - h00 : h11 - h10) * perCell;
      const g2 = gx * gx + gz * gz;
      const plane = h00 + gx * dx + gz * dz + r;
      if (refG2 >= 0) {
        const most = plane + r * (refS - 1 + (g2 - refG2) / (2 * refS));
        if (most <= best) {
          faces[f] = most;
          continue;
        }
      }
      const s = Math.sqrt(1 + g2);
      refG2 = g2;
      refS = s;
      const at = plane + r * (s - 1);
      faces[f] = at;
      const rs = r / s;
      const ox = gx * rs;
      const oz = gz * rs;
      const u = (dx + ox) * perCell;
      const v = (dz + oz) * perCell;
      const on = upper === 1 ? u >= 0 && u <= v && v <= 1 : v >= 0 && v <= u && u <= 1;
      if (at > top) {
        top = at;
        topOn = on;
      }
      if (!on || at <= best) continue;
      best = at;
      cx = ox;
      cy = -rs;
      cz = oz;
    }
  }
  // No edge holds the centre higher than either face beside it could, so edges are tried only when the face that could hold it
  // highest does not, and only those whose faces both could beat the best so far.
  if (!topOn) {
    if (best === -Infinity) {
      // The ground straight under the axis touches the sphere's lowest point, so the centre is at least that high.
      best = hf.heightAt(x, z) + r;
      cx = 0;
      cy = -r;
      cz = 0;
    }
    held[0] = best;
    held[1] = cx;
    held[2] = cy;
    held[3] = cz;
    const diagonal = cell * Math.SQRT2;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const f = ((j - j0) * wide + i - i0) * 2;
        const lower = faces[f]!;
        const upper = faces[f + 1]!;
        if (lower <= held[0]! && upper <= held[0]!) continue;
        const k = j * nx + i;
        const h00 = minY + hts[k]! * stepY;
        const h10 = minY + hts[k + 1]! * stepY;
        const h01 = minY + hts[k + nx]! * stepY;
        const h11 = minY + hts[k + nx + 1]! * stepY;
        const ax = i * cell - x;
        const az = j * cell - z;
        // The diagonal, then the sides. The side toward -Z is also the upper face's of the cell before in z, and the side toward
        // -X the lower face's of the cell before in x. The sides toward +X and +Z are tried with the last cells.
        if (lower > held[0]! && upper > held[0]!) edgeUnder(h00, h11, ax, az, Math.SQRT1_2, Math.SQRT1_2, diagonal, r);
        if (lower > held[0]! && (j === j0 || faces[f - 2 * wide + 1]! > held[0]!)) edgeUnder(h00, h10, ax, az, 1, 0, cell, r);
        if (upper > held[0]! && (i === i0 || faces[f - 2]! > held[0]!)) edgeUnder(h00, h01, ax, az, 0, 1, cell, r);
        if (i === i1 && lower > held[0]!) edgeUnder(h10, h11, ax + cell, az, 0, 1, cell, r);
        if (j === j1 && upper > held[0]!) edgeUnder(h01, h11, ax, az + cell, 1, 0, cell, r);
      }
    }
    best = held[0]!;
    cx = held[1]!;
    cy = held[2]!;
    cz = held[3]!;
  }
  lastHf = hf;
  lastX = x;
  lastZ = z;
  lastR = r;
  lastY = best - r;
  lastNx = ground.nx = -cx / r;
  lastNy = ground.ny = -cy / r;
  lastNz = ground.nz = -cz / r;
  return lastY;
}

/**
 * An edge from height `ha` at (ax, az) from the axis, `length` along the unit vector (ux, uz), to `hb`. In the upright plane
 * through it the sphere is a circle, and the centre must be highest where the edge's slope meets that circle. Raises `held`.
 */
function edgeUnder(ha: number, hb: number, ax: number, az: number, ux: number, uz: number, length: number, r: number): void {
  const best = held[0]!;
  if ((ha > hb ? ha : hb) + r <= best) return;
  // How far the edge's line passes from the axis, and where the edge starts, measured along it from the point nearest the axis.
  const side = ax * uz - az * ux;
  const rho2 = r * r - side * side;
  if (rho2 <= 0) return;
  const sa = ax * ux + az * uz;
  const rho = Math.sqrt(rho2);
  let lo = sa;
  let hi = sa + length;
  if (lo < -rho) lo = -rho;
  if (hi > rho) hi = rho;
  if (lo > hi) return;
  const m = (hb - ha) / length;
  let s = (rho * m) / Math.sqrt(1 + m * m);
  if (s < lo) s = lo;
  else if (s > hi) s = hi;
  const along = s - sa;
  const h = ha + m * along;
  const at = h + Math.sqrt(rho2 - s * s);
  if (at <= best) return;
  held[0] = at;
  held[1] = ax + ux * along;
  held[2] = h - at;
  held[3] = az + uz * along;
}

/** True when the capsule is inside the map and overlaps no terrain, structure or node. */
export function capsuleFree(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  const hf = w.hf;
  if (x < 0 || z < 0 || x > hf.sizeX || z > hf.sizeZ) return false;
  if (y < groundUnder(hf, x, z, r) - SKIN) return false;
  const top = y + (h > 2 * r ? h : 2 * r) + PAD;
  const n = w.structs.query(x - r, z - r, x + r, z + r, found, y - PAD, top);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, found.refs[i]!, x, y, z, r, h, SKIN)) return false;
  }
  const nodes = w.nodes;
  if (nodes) {
    const m = nodes.query(x - r, z - r, x + r, z + r, found, y - PAD, top);
    for (let i = 0; i < m; i++) {
      if (capsuleBox(nodes, found.refs[i]!, x, y, z, r, h, SKIN)) return false;
    }
  }
  return true;
}

/** True when lowering the capsule by `probe` meets an upward push from a structure or node. */
export function restsOnStructure(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number, probe: number): boolean {
  const low = y - probe - PAD;
  const top = y - probe + (h > 2 * r ? h : 2 * r) + PAD;
  const n = w.structs.query(x - r, z - r, x + r, z + r, found, low, top);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, found.refs[i]!, x, y - probe, z, r, h, 0) && push.y > 0.7 * push.depth) return true;
  }
  const nodes = w.nodes;
  if (nodes) {
    const m = nodes.query(x - r, z - r, x + r, z + r, found, low, top);
    for (let i = 0; i < m; i++) {
      if (capsuleBox(nodes, found.refs[i]!, x, y - probe, z, r, h, 0) && push.y > 0.7 * push.depth) return true;
    }
  }
  return false;
}
