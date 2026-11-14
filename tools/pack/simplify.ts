// Makes coarser levels of a mesh: edges are collapsed, cheapest first, by the quadric error of Garland and Heckbert.
// A collapse moves one end of an edge onto the other, so no new point is made and every vertex keeps the one bone it
// follows. A triangle keeps its colour. Edges where the surface ends or its colour changes are held by planes through
// them, so a colour region keeps its outline.

import { surfaceError } from "./error.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** A level is not made with fewer triangles than this. */
export const FEWEST = 48;
/** Each level has this share of the triangles of the one before it, and a mesh has no more levels than this. */
export const STEP = 0.5;
export const MOST_LEVELS = 5;
/** How much more a plane that holds a border weighs than a plane of the surface. */
const BORDER = 8;

/** Symmetric 4 by 4, as ten numbers: the sum of the squared distances to a set of planes. */
type Quadric = Float64Array;

function addPlane(q: Quadric, a: number, b: number, c: number, d: number, w: number): void {
  q[0]! += w * a * a; q[1]! += w * a * b; q[2]! += w * a * c; q[3]! += w * a * d;
  q[4]! += w * b * b; q[5]! += w * b * c; q[6]! += w * b * d;
  q[7]! += w * c * c; q[8]! += w * c * d;
  q[9]! += w * d * d;
}

function errorAt(a: Quadric, b: Quadric, x: number, y: number, z: number): number {
  const q = (i: number): number => a[i]! + b[i]!;
  return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
}

interface Move {
  cost: number;
  from: number;
  to: number;
  /** The versions of both ends when this was priced. It is stale if either has changed. */
  stamp: number;
}

/** A binary heap, cheapest first. */
class Heap {
  private readonly items: Move[] = [];
  push(m: Move): void {
    const a = this.items;
    let i = a.push(m) - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up]!.cost <= a[i]!.cost) break;
      [a[up], a[i]] = [a[i]!, a[up]!];
      i = up;
    }
  }
  pop(): Move | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let least = i;
        if (l < a.length && a[l]!.cost < a[least]!.cost) least = l;
        if (r < a.length && a[r]!.cost < a[least]!.cost) least = r;
        if (least === i) break;
        [a[least], a[i]] = [a[i]!, a[least]!];
        i = least;
      }
    }
    return top;
  }
}

export interface Simplified {
  lod: SourceLod;
  /** The square root of the dearest collapse made so far: about how far, in metres, a point has been moved. */
  moved: number;
}

/**
 * `fine` with fewer triangles: one level for each of `targets`, which fall. A level stops short of its target where
 * nothing more can be collapsed without turning a triangle over.
 */
export function simplify(fine: SourceLod, targets: readonly number[]): Simplified[] {
  // Vertices that are one point on one bone are one vertex here. The copies exist only to carry colours.
  const ids = new Map<string, number>();
  const pos: number[] = [];
  const bone: number[] = [];
  const weld = (v: number): number => {
    const key = `${fine.positions[v * 3]},${fine.positions[v * 3 + 1]},${fine.positions[v * 3 + 2]},${fine.bones ? fine.bones[v] : 0}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = bone.length;
      ids.set(key, id);
      pos.push(fine.positions[v * 3]!, fine.positions[v * 3 + 1]!, fine.positions[v * 3 + 2]!);
      bone.push(fine.bones ? fine.bones[v]! : 0);
    }
    return id;
  };
  const corners: number[] = [];
  const colors: number[] = [];
  for (let t = 0; t + 2 < fine.indices.length; t += 3) {
    const [a, b, c] = [weld(fine.indices[t]!), weld(fine.indices[t + 1]!), weld(fine.indices[t + 2]!)];
    if (a === b || b === c || a === c) continue;
    corners.push(a, b, c);
    // A triangle is drawn in the colour of its last vertex.
    colors.push(fine.colors[fine.indices[t + 2]!]!);
  }
  const faces = colors.length;
  const alive = new Uint8Array(faces).fill(1);
  let left = faces;
  const around: number[][] = Array.from({ length: bone.length }, () => []);
  for (let f = 0; f < faces; f++) for (let k = 0; k < 3; k++) around[corners[f * 3 + k]!]!.push(f);

  /** The normal of face `f`, its length twice the area, with corner `swap` moved to vertex `to` if given. */
  const normal = (f: number, out: number[], swap = -1, to = -1): void => {
    const at = (k: number): number => (corners[f * 3 + k] === swap ? to : corners[f * 3 + k]!) * 3;
    const [a, b, c] = [at(0), at(1), at(2)];
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
  };

  const quadrics: Quadric[] = Array.from({ length: bone.length }, () => new Float64Array(10));
  const n = [0, 0, 0];
  let area = 0;
  for (let f = 0; f < faces; f++) {
    normal(f, n);
    area += Math.hypot(n[0]!, n[1]!, n[2]!);
  }
  const mean = area / Math.max(faces, 1) || 1;
  /** The faces on each edge, to find the edges where the surface ends or changes colour. */
  const onEdge = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) {
    normal(f, n);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len === 0) continue;
    const [a, b, c] = [n[0]! / len, n[1]! / len, n[2]! / len];
    const p = corners[f * 3]! * 3;
    const d = -(a * pos[p]! + b * pos[p + 1]! + c * pos[p + 2]!);
    for (let k = 0; k < 3; k++) {
      addPlane(quadrics[corners[f * 3 + k]!]!, a, b, c, d, len / mean);
      const [u, v] = [corners[f * 3 + k]!, corners[f * 3 + ((k + 1) % 3)]!];
      const key = u < v ? u * bone.length + v : v * bone.length + u;
      const list = onEdge.get(key);
      if (list) list.push(f);
      else onEdge.set(key, [f]);
    }
  }
  for (const [key, list] of onEdge) {
    if (list.length === 2 && colors[list[0]!] === colors[list[1]!]) continue;
    const [u, v] = [Math.floor(key / bone.length), key % bone.length];
    const ex = pos[v * 3]! - pos[u * 3]!, ey = pos[v * 3 + 1]! - pos[u * 3 + 1]!, ez = pos[v * 3 + 2]! - pos[u * 3 + 2]!;
    for (const f of list) {
      // The plane through the edge that stands square to the face.
      normal(f, n);
      let a = ey * n[2]! - ez * n[1]!, b = ez * n[0]! - ex * n[2]!, c = ex * n[1]! - ey * n[0]!;
      const len = Math.hypot(a, b, c);
      if (len === 0) continue;
      a /= len;
      b /= len;
      c /= len;
      const d = -(a * pos[u * 3]! + b * pos[u * 3 + 1]! + c * pos[u * 3 + 2]!);
      addPlane(quadrics[u]!, a, b, c, d, BORDER);
      addPlane(quadrics[v]!, a, b, c, d, BORDER);
    }
  }

  const version = new Uint32Array(bone.length);
  const heap = new Heap();
  const price = (from: number, to: number): void => {
    const cost = Math.max(0, errorAt(quadrics[from]!, quadrics[to]!, pos[to * 3]!, pos[to * 3 + 1]!, pos[to * 3 + 2]!));
    heap.push({ cost, from, to, stamp: version[from]! + version[to]! });
  };
  const neighbours = (v: number): Set<number> => {
    const out = new Set<number>();
    for (const f of around[v]!) if (alive[f]) for (let k = 0; k < 3; k++) if (corners[f * 3 + k] !== v) out.add(corners[f * 3 + k]!);
    return out;
  };
  for (const key of onEdge.keys()) {
    const [u, v] = [Math.floor(key / bone.length), key % bone.length];
    price(u, v);
    price(v, u);
  }

  const before = [0, 0, 0];
  const after = [0, 0, 0];
  /** Whether moving `from` onto `to` would turn a triangle over, or flatten one that is not on the edge between them. */
  const turns = (from: number, to: number): boolean => {
    for (const f of around[from]!) {
      if (!alive[f] || corners[f * 3] === to || corners[f * 3 + 1] === to || corners[f * 3 + 2] === to) continue;
      normal(f, before);
      normal(f, after, from, to);
      const dot = before[0]! * after[0]! + before[1]! * after[1]! + before[2]! * after[2]!;
      if (dot <= 0.2 * Math.hypot(before[0]!, before[1]!, before[2]!) * Math.hypot(after[0]!, after[1]!, after[2]!)) return true;
    }
    return false;
  };

  const emit = (): SourceLod => {
    const positions: number[] = [];
    const outColors: number[] = [];
    const bones: number[] = [];
    const indices: number[] = [];
    const exact = new Map<number, number>();
    const any = new Map<number, number>();
    // The last corner must have the triangle's colour. The other two take any copy of their vertex.
    const corner = (v: number, color: number): number => {
      let at = exact.get(v * 256 + color);
      if (at === undefined) {
        at = bones.length;
        positions.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
        outColors.push(color);
        bones.push(bone[v]!);
        exact.set(v * 256 + color, at);
        if (!any.has(v)) any.set(v, at);
      }
      return at;
    };
    for (let f = 0; f < faces; f++) {
      if (!alive[f]) continue;
      const [a, b, c] = [corners[f * 3]!, corners[f * 3 + 1]!, corners[f * 3 + 2]!];
      indices.push(any.get(a) ?? corner(a, colors[f]!), any.get(b) ?? corner(b, colors[f]!), corner(c, colors[f]!));
    }
    const lod: SourceLod = { positions: Float32Array.from(positions), colors: Uint8Array.from(outColors), indices: Uint32Array.from(indices) };
    if (fine.bones) lod.bones = Uint8Array.from(bones);
    return lod;
  };

  const out: Simplified[] = [];
  let dearest = 0;
  for (const target of targets) {
    while (left > target) {
      const m = heap.pop();
      if (!m) break;
      if (m.stamp !== version[m.from]! + version[m.to]! || turns(m.from, m.to)) continue;
      for (const f of around[m.from]!) {
        if (!alive[f]) continue;
        const k = corners[f * 3] === m.from ? 0 : corners[f * 3 + 1] === m.from ? 1 : 2;
        if (corners[f * 3] === m.to || corners[f * 3 + 1] === m.to || corners[f * 3 + 2] === m.to) {
          alive[f] = 0;
          left--;
          continue;
        }
        corners[f * 3 + k] = m.to;
        around[m.to]!.push(f);
      }
      around[m.from] = [];
      for (let i = 0; i < 10; i++) quadrics[m.to]![i]! += quadrics[m.from]![i]!;
      // Versions only rise, so a move priced before this one no longer matches the sum of its ends'.
      version[m.from]!++;
      version[m.to]!++;
      if (m.cost > dearest) dearest = m.cost;
      for (const w of neighbours(m.to)) {
        price(m.to, w);
        price(w, m.to);
      }
    }
    out.push({ lod: emit(), moved: Math.sqrt(dearest) });
  }
  return out;
}

/**
 * `mesh` with coarser levels after its finest, each half the one before, where it has only the one level and enough
 * triangles for a coarser one to be worth having. Each level says how far it lies from the finest, as measured.
 */
export function withLevels(mesh: SourceMesh): SourceMesh {
  const fine = mesh.lods[0]!;
  const targets: number[] = [];
  for (let n = (fine.indices.length / 3) * STEP; n >= FEWEST && targets.length < MOST_LEVELS - 1; n *= STEP) targets.push(Math.round(n));
  if (mesh.lods.length !== 1 || targets.length === 0) return mesh;
  const lods = [fine];
  for (const made of simplify(fine, targets)) {
    // A level that could not get much smaller than the last is not worth a switch.
    if (made.lod.indices.length > lods[lods.length - 1]!.indices.length * 0.8) break;
    lods.push({ ...made.lod, error: surfaceError(fine, made.lod) });
  }
  return { ...mesh, lods };
}
