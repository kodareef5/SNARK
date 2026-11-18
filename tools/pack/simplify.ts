// Makes coarser levels of a mesh: edges are collapsed, cheapest first, by the quadric error of Garland and Heckbert.
// A collapse moves one end of an edge onto the other, so no new point is made and every vertex keeps the one bone it
// follows. A triangle keeps its colour. Edges where the surface ends or its colour changes are held by planes through
// them, so a colour region keeps its outline.
//
// A level drawn with materials keeps its surface as well. A vertex is then a wedge: a point with its texture
// coordinate, normal, tangent and material. The wedge that survives a collapse keeps all of its own, so nothing is
// interpolated. A point with more than one wedge lies on a seam, a crease or a border between materials, and moves
// only along it.

import { len3 } from "../../shared/math/scalar.ts";
import { baker, flatOf, painted, placed } from "./bake.ts";
import { surfaceError } from "./error.ts";
import { fourHeaviest, tangentsOf } from "./surface.ts";
import type { MaterialMaps } from "./texture.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** A level is not made with fewer triangles than this. */
export const FEWEST = 48;
/** Each level has this share of the triangles of the one before it, and a mesh has no more levels than this. */
export const STEP = 0.5;
export const MOST_LEVELS = 5;
/** How much more a plane that holds a border weighs than a plane of the surface. */
const BORDER = 8;
/** A triangle may come to hold this many times the picture it held for its size, or one part in this many, and no more. */
const STRETCH = 2;
/** What the picture sliding a distance over the surface weighs, against the surface moving as far: it shows less. */
const SLIDE = 0.25;
/**
 * What an edge that reaches across changing bone weights weighs. Its length times the share of the weight that changes
 * along it, squared, is about eight times the square of how far its middle cuts inside a joint bent a quarter turn,
 * and a point's quadric counts a distance about four times over.
 */
const BEND = 0.5;

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
  /**
   * The square root of the dearest collapse made so far: about how far, in metres, a point has been moved. With a
   * surface it also counts how far the picture has slid and how far a bent joint would cut in.
   */
  moved: number;
}

/**
 * `fine` with fewer triangles: one level for each of `targets`, which fall. A level stops short of its target where
 * nothing more can be collapsed without turning a triangle over. The levels are flat: what `fine` has of a surface is
 * left behind.
 */
export function simplify(fine: SourceLod, targets: readonly number[], preserveBones: readonly number[] = []): Simplified[] {
  return collapsed(fine, targets, false, preserveBones);
}

/**
 * As simplify(), for a level drawn with materials, whose levels keep their surface. A collapse is not made where it
 * would carry a wedge across a seam, turn a triangle over in the picture, or stretch the picture over it by more
 * than STRETCH. It costs more the further it slides the picture over the surface, and the further its new edges reach
 * across changing bone weights, so the loops of edges at a joint are the last to go.
 */
export function simplifySurface(fine: SourceLod, targets: readonly number[], preserveBones: readonly number[] = []): Simplified[] {
  if (!fine.uvs || !fine.normals) throw new Error("a level keeps its surface only if it has texture coordinates and normals");
  return collapsed(fine, targets, true, preserveBones);
}

function collapsed(fine: SourceLod, targets: readonly number[], textured: boolean, preserveBones: readonly number[]): Simplified[] {
  const { joints, weights, tangents } = fine;
  const uvs = fine.uvs ?? new Float32Array(0);
  const normals = fine.normals ?? new Float32Array(0);
  // Vertices that are one point on one bone are one vertex here. The copies exist only to carry colours.
  const ids = new Map<string, number>();
  const pos: number[] = [];
  const bone: number[] = [];
  /** A vertex of `fine` at each point. */
  const origin: number[] = [];
  const place = textured ? placed(fine) : null;
  const weld = (v: number): number => {
    // With a surface, the two sides of a seam are one point however little apart, and two vertices that are weighted
    // differently are two, since they would part when a bone turns.
    const key = place
      ? `${place[v]},${fine.bones ? fine.bones[v] : 0},${joints && weights ? `${joints.subarray(v * 4, v * 4 + 4)},${weights.subarray(v * 4, v * 4 + 4)}` : ""}`
      : `${fine.positions[v * 3]},${fine.positions[v * 3 + 1]},${fine.positions[v * 3 + 2]},${fine.bones ? fine.bones[v] : 0}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = bone.length;
      ids.set(key, id);
      pos.push(fine.positions[v * 3]!, fine.positions[v * 3 + 1]!, fine.positions[v * 3 + 2]!);
      bone.push(fine.bones ? fine.bones[v]! : 0);
      origin.push(v);
    }
    return id;
  };
  /** With a surface: the wedge at each corner, and a vertex of `fine` that has what each wedge has. */
  const wedges: number[] = [];
  const source: number[] = [];
  const wedgeIds = new Map<string, number>();
  const wedge = (v: number, point: number, section: number): number => {
    const key = `${point},${section},${uvs.subarray(v * 2, v * 2 + 2)},${normals.subarray(v * 3, v * 3 + 3)},${tangents ? tangents.subarray(v * 4, v * 4 + 4) : ""}`;
    let id = wedgeIds.get(key);
    if (id === undefined) {
      id = source.length;
      wedgeIds.set(key, id);
      source.push(v);
    }
    return id;
  };
  const corners: number[] = [];
  const colors: number[] = [];
  const sections: number[] = [];
  for (let t = 0; t + 2 < fine.indices.length; t += 3) {
    const [a, b, c] = [weld(fine.indices[t]!), weld(fine.indices[t + 1]!), weld(fine.indices[t + 2]!)];
    if (a === b || b === c || a === c) continue;
    corners.push(a, b, c);
    // A triangle is drawn in the colour of its last vertex.
    colors.push(fine.colors[fine.indices[t + 2]!]!);
    if (!textured) continue;
    const section = fine.sections?.[t / 3] ?? 0;
    sections.push(section);
    wedges.push(wedge(fine.indices[t]!, a, section), wedge(fine.indices[t + 1]!, b, section), wedge(fine.indices[t + 2]!, c, section));
  }
  const faces = colors.length;
  const alive = new Uint8Array(faces).fill(1);
  let left = faces;
  const around: number[][] = Array.from({ length: bone.length }, () => []);
  for (let f = 0; f < faces; f++) for (let k = 0; k < 3; k++) around[corners[f * 3 + k]!]!.push(f);

  // A succession of locally gentle collapses can still turn an entire small closed part inside out. Keep each
  // original connected component's signed volume, measured near the component for numerical stability. Open
  // sheets have no enclosed volume and are left to the ordinary face-turn check below.
  const component = bone.map((_, i) => i);
  const componentOf = (v: number): number => {
    while (component[v] !== v) v = component[v] = component[component[v]!]!;
    return v;
  };
  for (let f = 0; f < faces; f++) {
    const [a, b, c] = corners.slice(f * 3, f * 3 + 3) as [number, number, number];
    component[componentOf(a)] = componentOf(b);
    component[componentOf(b)] = componentOf(c);
  }
  for (let v = 0; v < component.length; v++) component[v] = componentOf(v);
  // Some thin moving parts define the silhouette even when their surface area is small (rotor blades). Preserve
  // each of their closed islands' axis extremes explicitly; this is opt-in, so existing assets keep their levels.
  const locked = new Uint8Array(bone.length);
  const extremes = new Map<number, number[]>();
  for (let v = 0; v < bone.length; v++) {
    if (!preserveBones.includes(bone[v]!)) continue;
    const part = component[v]!;
    let ends = extremes.get(part);
    if (!ends) extremes.set(part, (ends = [v, v, v, v, v, v]));
    for (let axis = 0; axis < 3; axis++) {
      if (pos[v * 3 + axis]! < pos[ends[axis * 2]! * 3 + axis]!) ends[axis * 2] = v;
      if (pos[v * 3 + axis]! > pos[ends[axis * 2 + 1]! * 3 + axis]!) ends[axis * 2 + 1] = v;
    }
  }
  for (const ends of extremes.values()) for (const v of ends) locked[v] = 1;
  const closed = new Uint8Array(bone.length).fill(1);
  const edgeUse = new Map<number, number>();
  for (let f = 0; f < faces; f++) for (let k = 0; k < 3; k++) {
    const a = corners[f * 3 + k]!, b = corners[f * 3 + (k + 1) % 3]!;
    const key = Math.min(a, b) * bone.length + Math.max(a, b);
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + (a < b ? 1 : -1));
  }
  for (const [key, balance] of edgeUse) if (balance !== 0) closed[component[Math.floor(key / bone.length)]!] = 0;
  const volume = new Float64Array(bone.length);
  const volumeOf = (f: number, swap = -1, to = -1): number => {
    const centre = component[corners[f * 3]!]! * 3;
    const at = (k: number): number => (corners[f * 3 + k] === swap ? to : corners[f * 3 + k]!) * 3;
    const [a, b, c] = [at(0), at(1), at(2)];
    const ax = pos[a]! - pos[centre]!, ay = pos[a + 1]! - pos[centre + 1]!, az = pos[a + 2]! - pos[centre + 2]!;
    const bx = pos[b]! - pos[centre]!, by = pos[b + 1]! - pos[centre + 1]!, bz = pos[b + 2]! - pos[centre + 2]!;
    const cx = pos[c]! - pos[centre]!, cy = pos[c + 1]! - pos[centre + 1]!, cz = pos[c + 2]! - pos[centre + 2]!;
    return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  };
  for (let f = 0; f < faces; f++) volume[component[corners[f * 3]!]!]! += volumeOf(f);
  const initialVolume = volume.slice();
  const volumeChange = (from: number, to: number): number => {
    let delta = 0;
    for (const f of around[from]!) if (alive[f]) delta += volumeOf(f, from, to) - volumeOf(f);
    return delta;
  };

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
  /** Which corner of face `f` is at `point`, or -1. */
  const cornerAt = (f: number, point: number): number => (corners[f * 3] === point ? 0 : corners[f * 3 + 1] === point ? 1 : corners[f * 3 + 2] === point ? 2 : -1);

  const quadrics: Quadric[] = Array.from({ length: bone.length }, () => new Float64Array(10));
  const n = [0, 0, 0];
  let area = 0;
  for (let f = 0; f < faces; f++) {
    normal(f, n);
    area += len3(n[0]!, n[1]!, n[2]!);
  }
  const mean = area / Math.max(faces, 1) || 1;
  /** The faces on each edge, to find the edges where the surface ends or changes colour. */
  const onEdge = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) {
    normal(f, n);
    const len = len3(n[0]!, n[1]!, n[2]!);
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
  /** Whether faces `f` and `g` are one piece across the edge they share at `point`: one colour, or with a surface one wedge. */
  const joined = (f: number, g: number, point: number): boolean => (textured ? wedges[f * 3 + cornerAt(f, point)] === wedges[g * 3 + cornerAt(g, point)] : colors[f] === colors[g]);
  for (const [key, list] of onEdge) {
    const [u, v] = [Math.floor(key / bone.length), key % bone.length];
    if (list.length === 2 && joined(list[0]!, list[1]!, u) && joined(list[0]!, list[1]!, v)) continue;
    const ex = pos[v * 3]! - pos[u * 3]!, ey = pos[v * 3 + 1]! - pos[u * 3 + 1]!, ez = pos[v * 3 + 2]! - pos[u * 3 + 2]!;
    for (const f of list) {
      // The plane through the edge that stands square to the face.
      normal(f, n);
      let a = ey * n[2]! - ez * n[1]!, b = ez * n[0]! - ex * n[2]!, c = ex * n[1]! - ey * n[0]!;
      const len = len3(a, b, c);
      if (len === 0) continue;
      a /= len;
      b /= len;
      c /= len;
      const d = -(a * pos[u * 3]! + b * pos[u * 3 + 1]! + c * pos[u * 3 + 2]!);
      addPlane(quadrics[u]!, a, b, c, d, BORDER);
      addPlane(quadrics[v]!, a, b, c, d, BORDER);
    }
  }

  const before = [0, 0, 0];
  const after = [0, 0, 0];
  /** Twice the area face `f` has in the picture, signed, with the wedge at corner `swap` made `to` if given. */
  const spread = (f: number, swap = -1, to = -1): number => {
    const at = (k: number): number => source[k === swap ? to : wedges[f * 3 + k]!]! * 2;
    const [a, b, c] = [at(0), at(1), at(2)];
    return (uvs[b]! - uvs[a]!) * (uvs[c + 1]! - uvs[a + 1]!) - (uvs[c]! - uvs[a]!) * (uvs[b + 1]! - uvs[a + 1]!);
  };
  /** How much of the picture each face holds for its size, as `fine` has it. 0 where it holds none. */
  const dense = new Float64Array(textured ? faces : 0);
  for (let f = 0; f < dense.length; f++) {
    normal(f, n);
    dense[f] = Math.abs(spread(f)) / (len3(n[0]!, n[1]!, n[2]!) || 1);
  }
  /** The bones each point is weighted to, with weights that sum to 1. */
  const skins = !textured || !fine.bones ? null : origin.map((v) => {
    const four = joints && weights ? fourHeaviest(joints.subarray(v * 4, v * 4 + 4), weights.subarray(v * 4, v * 4 + 4)) : null;
    return four && four.bones.length > 0 ? four : { bones: [fine.bones![v]!], weights: [1] };
  });
  /** The share of the weight of point `a` that is on other bones at point `b`, 0 to 1, times the distance between them, squared. */
  const reach = (a: number, b: number): number => {
    const [p, q] = [skins![a]!, skins![b]!];
    let shared = 0;
    p.bones.forEach((joint, k) => (shared += Math.min(p.weights[k]!, q.weights[q.bones.indexOf(joint)] ?? 0)));
    const dx = pos[a * 3]! - pos[b * 3]!, dy = pos[a * 3 + 1]! - pos[b * 3 + 1]!, dz = pos[a * 3 + 2]! - pos[b * 3 + 2]!;
    return (1 - shared) * (1 - shared) * (dx * dx + dy * dy + dz * dz);
  };
  /**
   * The wedge of `to` that wedge `w` of `from` would become: the one it shares a triangle with. -1 where it shares
   * none, being across a seam from the edge between them, or shares triangles with two.
   */
  const becomes = (w: number, from: number, to: number): number => {
    let out = -1;
    for (const f of around[from]!) {
      const j = alive[f] ? cornerAt(f, to) : -1;
      if (j < 0 || wedges[f * 3 + cornerAt(f, from)] !== w) continue;
      if (out >= 0 && out !== wedges[f * 3 + j]) return -1;
      out = wedges[f * 3 + j]!;
    }
    return out;
  };
  /**
   * What moving `from` onto `to` costs the surface beyond the quadric, counted as the quadric counts, or Infinity
   * where it is not to be done.
   */
  const strain = (from: number, to: number): number => {
    let slide = 0;
    let bend = 0;
    for (const f of around[from]!) {
      if (!alive[f] || cornerAt(f, to) >= 0) continue;
      const k = cornerAt(f, from);
      const next = becomes(wedges[f * 3 + k]!, from, to);
      if (next < 0) return Infinity;
      const [kb, kc] = [(k + 1) % 3, (k + 2) % 3];
      // An edge that reaches across changing weights cuts inside its joint when the joint bends.
      if (skins) bend = Math.max(bend, reach(to, corners[f * 3 + kb]!), reach(to, corners[f * 3 + kc]!));
      const was = spread(f);
      if (dense[f] === 0 || was === 0) continue;
      const now = spread(f, k, next);
      normal(f, before);
      normal(f, after, from, to);
      const size = before[0]! * before[0]! + before[1]! * before[1]! + before[2]! * before[2]!;
      const held = Math.abs(now) / len3(after[0]!, after[1]!, after[2]!) / dense[f]!;
      if (was * now <= 0 || !(held <= STRETCH && held >= 1 / STRETCH)) return Infinity;
      // Where `to` lies in the triangle as it is now: how much of it each corner has, `from` first. The triangle
      // with a corner moved to `to` has that corner's share of the size.
      const own = (before[0]! * after[0]! + before[1]! * after[1]! + before[2]! * after[2]!) / size;
      normal(f, after, corners[f * 3 + kb]!, to);
      const second = (before[0]! * after[0]! + before[1]! * after[1]! + before[2]! * after[2]!) / size;
      // The picture has `to` there now, and will have it where the wedge it becomes is: the distance between is how far it slides.
      const [w0, w1, w2, w3] = [source[wedges[f * 3 + k]!]! * 2, source[wedges[f * 3 + kb]!]! * 2, source[wedges[f * 3 + kc]!]! * 2, source[next]! * 2];
      const du = own * uvs[w0]! + second * uvs[w1]! + (1 - own - second) * uvs[w2]! - uvs[w3]!;
      const dv = own * uvs[w0 + 1]! + second * uvs[w1 + 1]! + (1 - own - second) * uvs[w2 + 1]! - uvs[w3 + 1]!;
      // In square metres, by the triangle's own scale, and weighed by its size as its plane is.
      slide += (du * du + dv * dv) * (size / Math.abs(was) / mean);
    }
    return SLIDE * slide + BEND * bend;
  };

  const version = new Uint32Array(bone.length);
  const heap = new Heap();
  const price = (from: number, to: number): void => {
    if (locked[from]) return;
    let cost = Math.max(0, errorAt(quadrics[from]!, quadrics[to]!, pos[to * 3]!, pos[to * 3 + 1]!, pos[to * 3 + 2]!));
    if (textured) cost += strain(from, to);
    if (cost < Infinity) heap.push({ cost, from, to, stamp: version[from]! + version[to]! });
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

  /** Whether moving `from` onto `to` would turn a triangle over, or flatten one that is not on the edge between them. */
  const turns = (from: number, to: number): boolean => {
    for (const f of around[from]!) {
      if (!alive[f] || corners[f * 3] === to || corners[f * 3 + 1] === to || corners[f * 3 + 2] === to) continue;
      normal(f, before);
      normal(f, after, from, to);
      const dot = before[0]! * after[0]! + before[1]! * after[1]! + before[2]! * after[2]!;
      if (dot <= 0.2 * len3(before[0]!, before[1]!, before[2]!) * len3(after[0]!, after[1]!, after[2]!)) return true;
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
  /** With a surface, a vertex is a wedge that is still in use, with all that its vertex of `fine` has. */
  const emitSurface = (): SourceLod => {
    const place = new Map<number, number>();
    const kept: number[] = [];
    const indices: number[] = [];
    const drawn: number[] = [];
    for (let f = 0; f < faces; f++) {
      if (!alive[f]) continue;
      for (let k = 0; k < 3; k++) {
        const w = wedges[f * 3 + k]!;
        let at = place.get(w);
        if (at === undefined) place.set(w, (at = kept.push(source[w]!) - 1));
        indices.push(at);
      }
      drawn.push(sections[f]!);
    }
    const floats = (all: Float32Array, each: number): Float32Array => Float32Array.from({ length: kept.length * each }, (_, i) => all[kept[Math.floor(i / each)]! * each + (i % each)]!);
    const bytes = (all: Uint8Array, each: number): Uint8Array => Uint8Array.from({ length: kept.length * each }, (_, i) => all[kept[Math.floor(i / each)]! * each + (i % each)]!);
    const lod: SourceLod = { positions: floats(fine.positions, 3), colors: bytes(fine.colors, 1), indices: Uint32Array.from(indices), uvs: floats(uvs, 2), normals: floats(normals, 3) };
    if (fine.bones) lod.bones = bytes(fine.bones, 1);
    if (tangents) lod.tangents = floats(tangents, 4);
    if (joints) lod.joints = bytes(joints, 4);
    if (weights) lod.weights = floats(weights, 4);
    if (fine.sections) lod.sections = Uint8Array.from(drawn);
    return lod;
  };

  const out: Simplified[] = [];
  let dearest = 0;
  for (const target of targets) {
    while (left > target) {
      const m = heap.pop();
      if (!m) break;
      if (m.stamp !== version[m.from]! + version[m.to]! || turns(m.from, m.to)) continue;
      const part = component[m.from]!;
      const delta = closed[part] && initialVolume[part] !== 0 ? volumeChange(m.from, m.to) : 0;
      if (closed[part] && (volume[part]! + delta) * Math.sign(initialVolume[part]!) < -Math.abs(initialVolume[part]!) * 1e-12) continue;
      volume[part]! += delta;
      // With a surface, a move is priced by the triangles around its `from`, which this changes for every point beside either end.
      const near = textured ? new Set([...neighbours(m.from), ...neighbours(m.to)]) : new Set([m.to]);
      for (const f of textured ? around[m.from]! : []) {
        const k = alive[f] && cornerAt(f, m.to) < 0 ? f * 3 + cornerAt(f, m.from) : -1;
        if (k >= 0) wedges[k] = becomes(wedges[k]!, m.from, m.to);
      }
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
      near.add(m.from);
      for (const v of near) version[v]!++;
      if (m.cost > dearest) dearest = m.cost;
      for (const v of near) {
        for (const w of neighbours(v)) {
          price(v, w);
          if (!near.has(w)) price(w, v);
        }
      }
    }
    out.push({ lod: textured ? emitSurface() : emit(), moved: Math.sqrt(dearest) });
  }
  return out;
}

/**
 * `mesh` with coarser levels after its finest, each half the one before, where it has only the one level and enough
 * triangles for a coarser one to be worth having. Each level says how far it lies from the finest, as measured.
 * The levels are flat, in the colours the finest came with.
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

/** The levels a mesh drawn with materials is to have, and what its flat colours are read from. */
export interface LevelPlan {
  /** How many triangles each level after the finest may have. They fall. */
  budgets: readonly number[];
  /** Which level is the first flat one, the finest being level 0: 1 or more. The levels before it keep their surface. */
  flat: number;
  /** The pictures of each of the mesh's materials, in the order of `materials`. The base colour and the regions are read. */
  maps: readonly MaterialMaps[];
  palette: Uint8Array;
  /** Rigid bones whose small closed parts must retain their axis extremes at every level. */
  preserveBones?: readonly number[];
  distanceLods?: readonly SourceLod[];
}

/**
 * `mesh` with the levels of `plan`, all made from its finest, whatever others it came with. The finest and the levels
 * before `plan.flat` keep their surface, and get the flat colours their pictures give them, for where they are drawn
 * flat. The flat levels are made by simplify() from the coarsest of those, with every triangle in the colour the
 * pictures give it (see bake.ts). Each level says how far it lies from the finest, as measured. A level that could
 * not get much smaller than the one before it is left out, and with it those of its kind that would follow, so `flat`
 * comes back lower where that was a level with a surface.
 */
export function withSurfaceLevels(mesh: SourceMesh, plan: LevelPlan): SourceMesh {
  const first = mesh.lods[0]!;
  if (plan.flat < 1 || !first.uvs || !first.normals) throw new Error(`${mesh.id}: the finest level must have a surface and keep it, so the first flat level is 1 or later`);
  // A vertex has one tangent at every level, so where the mesh came without them they are worked out here, on the finest.
  const fine: SourceLod = first.tangents ? first : { ...first, tangents: tangentsOf({ ...first, uvs: first.uvs, normals: first.normals }) };
  const colours = baker(fine, mesh.materials ?? [], plan.maps, plan.palette);
  const worth = (made: SourceLod, last: SourceLod): boolean => made.indices.length <= last.indices.length * 0.8;
  const surface = [fine];
  for (const made of simplifySurface(fine, plan.budgets.slice(0, plan.flat - 1), plan.preserveBones)) {
    if (!worth(made.lod, surface[surface.length - 1]!)) break;
    surface.push(made.lod);
  }
  const flat = surface.map(colours);
  const lods = surface.map((lod, level) => painted(lod, flat[level]!));
  const budgets = plan.budgets.slice(plan.flat - 1);
  const authored = plan.distanceLods ?? [];
  const generated = budgets.length - authored.length;
  if (generated < 0) throw new Error(`${mesh.id}: more authored flat levels than distance budgets`);
  if (generated > 0) {
    for (const made of simplify(flatOf(surface[surface.length - 1]!, flat[flat.length - 1]!), budgets.slice(0, generated), plan.preserveBones)) {
      if (!worth(made.lod, lods[lods.length - 1]!)) break;
      lods.push(made.lod);
    }
  }
  for (const [i, lod] of authored.entries()) {
    if (!lod.indices.length || lod.indices.length / 3 > budgets[generated + i]! || !worth(lod, lods[lods.length - 1]!)) {
      throw new Error(`${mesh.id}: authored distance level ${i} is empty or exceeds its triangle budget or reduction target`);
    }
    lods.push(lod);
  }
  return { ...mesh, flat: surface.length, lods: lods.map((lod, level) => (level === 0 ? lod : { ...lod, error: surfaceError(fine, lod) })) };
}
