// What every tier's building pieces are built from: closed solids gathered face by face, each face with a material and
// texture coordinates, cut where a piece gives way to a joint, and written as one level of a pack mesh.
//
// A recipe works in the frame the Python tiers used, so their numbers port unchanged: x along the piece, z up, and the
// front at -y. A level is turned to the engine's +Y up and +Z out as it is written.
//
// Texture coordinates are metres over the tile, measured from the corner of the piece's 3 m cell, so a tiling material
// runs on unbroken into the next piece and round a corner. v grows upward here and is turned to the picture's rows at the end.

import type { SourceLod } from "../write.ts";
import { tangentsOf } from "../surface.ts";

export type Vec = readonly [number, number, number];
export type Uv = readonly [number, number];
/** For a face of a block by its label ("-x", "+z"), its material and how a point of it becomes texture coordinates. */
export type FaceMap = (label: string, lo: Vec, hi: Vec) => readonly [string, (p: Vec) => Uv];

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec): Vec => scale(a, 1 / (length(a) || 1));

/** Python's round: a half goes to the even number. */
export function roundEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** A flat polygon of a solid, or triangles of one where `tris` lists them. */
interface Face {
  points: Vec[];
  uvs: Uv[];
  mat: string;
  tris?: number[];
  /** The axis it is a prism along, where it may run through a yield ring uncut: pulled back, it is truly shorter. */
  along?: number;
}

const AXIS: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2 };
const NAME = "xyz";
/** Faces of a block by the axis and side their normal points along, corners as (x, y, z) bits, wound outward. */
const FACES: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  "-x": [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  "+x": [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  "-y": [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  "+y": [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  "-z": [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  "+z": [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
};

/** The triangles of a simple polygon in the plane, as indices into it: ears cut one by one. */
export function earcut(poly: readonly (readonly [number, number])[]): number[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1];
  const turn = area >= 0 ? 1 : -1;
  const left = Array.from({ length: n }, (_, i) => i);
  const side = (a: number, b: number, c: number): number => turn * ((poly[b]![0] - poly[a]![0]) * (poly[c]![1] - poly[a]![1]) - (poly[b]![1] - poly[a]![1]) * (poly[c]![0] - poly[a]![0]));
  const out: number[] = [];
  let guard = n * n;
  for (let i = 0; left.length > 3 && guard-- > 0; i++) {
    const m = left.length;
    const [a, b, c] = [left[(i + m - 1) % m]!, left[i % m]!, left[(i + 1) % m]!];
    if (side(a, b, c) <= 1e-14) continue;
    // An ear holds no other corner of the polygon.
    if (left.some((p) => p !== a && p !== b && p !== c && side(a, b, p) > 1e-12 && side(b, c, p) > 1e-12 && side(c, a, p) > 1e-12)) continue;
    out.push(a, b, c);
    left.splice(i % m, 1);
    i = -1;
  }
  // Corners left in a line are closed as a fan, so every point keeps its edges.
  for (let k = 1; k + 1 < left.length; k++) out.push(left[0]!, left[k]!, left[k + 1]!);
  return out;
}

/** One level of one piece, gathered as closed solids. */
export class Shape {
  readonly faces: Face[] = [];
  /** Metres it lies from the finest level, where its recipe says other than its level's usual. */
  error?: number;

  /** Takes the faces of one closed solid, turned so that they look outward. */
  private solid(faces: Face[]): this {
    let volume = 0;
    for (const f of faces) {
      const list = f.tris ?? f.points.flatMap((_, k) => (k >= 2 ? [0, k - 1, k] : []));
      for (let t = 0; t < list.length; t += 3) volume += dot(f.points[list[t]!]!, cross(f.points[list[t + 1]!]!, f.points[list[t + 2]!]!));
    }
    if (volume < 0) {
      for (const f of faces) {
        if (f.tris) for (let t = 0; t < f.tris.length; t += 3) [f.tris[t + 1], f.tris[t + 2]] = [f.tris[t + 2]!, f.tris[t + 1]!];
        else {
          f.points.reverse();
          f.uvs.reverse();
        }
      }
    }
    this.faces.push(...faces);
    return this;
  }

  /** A block of eight corners, `corners[i][j][k]` being the one at the low or high x, y and z. */
  block(corners: readonly (readonly (readonly Vec[])[])[], mapping: FaceMap): this {
    const all = corners.flat(2);
    const lo = [0, 1, 2].map((a) => Math.min(...all.map((c) => c[a]!))) as unknown as Vec;
    const hi = [0, 1, 2].map((a) => Math.max(...all.map((c) => c[a]!))) as unknown as Vec;
    return this.solid(Object.entries(FACES).map(([label, keys]) => {
      const [mat, uv] = mapping(label, lo, hi);
      const points = keys.map(([i, j, k]) => corners[i]![j]![k]!);
      return { points, uvs: points.map(uv), mat };
    }));
  }

  box(lo: Vec, hi: Vec, mapping: FaceMap): this {
    const pick = (i: number, j: number, k: number): Vec => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
    return this.block([0, 1].map((i) => [0, 1].map((j) => [0, 1].map((k) => pick(i, j, k)))), mapping);
  }

  /**
   * A solid whose section is the polygon `outline`, running along `axis` from a0 to a1. The outline is in the plane of
   * the two axes after it, in order (y, z for x; z, x for y; x, y for z). `holes` are cut through it.
   */
  extrude(outline: readonly (readonly [number, number])[], axis: string, a0: number, a1: number, mapping: FaceMap, holes: readonly (readonly (readonly [number, number])[])[] = []): this {
    const a = AXIS[axis]!;
    const [s, t] = [(a + 1) % 3, (a + 2) % 3];
    const point = (st: readonly [number, number], w: number): Vec => {
      const p = [0, 0, 0];
      [p[a], p[s], p[t]] = [w, st[0], st[1]];
      return p as unknown as Vec;
    };
    const rings = [outline, ...holes];
    const all = rings.flat().flatMap((q) => [point(q, a0), point(q, a1)]);
    const lo = [0, 1, 2].map((k) => Math.min(...all.map((c) => c[k]!))) as unknown as Vec;
    const hi = [0, 1, 2].map((k) => Math.max(...all.map((c) => c[k]!))) as unknown as Vec;
    const faces: Face[] = [];
    const face = (points: Vec[], label: string, tris?: number[]): void => {
      const [mat, uv] = mapping(label, lo, hi);
      faces.push({ points, uvs: points.map(uv), mat, ...(tris ? { tris } : {}) });
    };
    const signed = (ring: readonly (readonly [number, number])[]): number => ring.reduce((sum, q, i) => sum + q[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * q[1], 0);
    const way = Math.sign(signed(outline)) || 1;
    rings.forEach((ring, r) => {
      // A hole goes round against the outline, so its walls look into it.
      const loop = (Math.sign(signed(ring)) || 1) === (r === 0 ? way : -way) ? ring : [...ring].reverse();
      loop.forEach((q, i) => {
        const next = loop[(i + 1) % loop.length]!;
        const [ns, nt] = [(next[1] - q[1]) * way, -(next[0] - q[0]) * way];
        const label = Math.abs(ns) >= Math.abs(nt) ? (ns > 0 ? "+" : "-") + NAME[s] : (nt > 0 ? "+" : "-") + NAME[t];
        face(way > 0 ? [point(q, a0), point(next, a0), point(next, a1), point(q, a1)] : [point(q, a1), point(next, a1), point(next, a0), point(q, a0)], label);
      });
    });
    // The two ends: the outline with its holes joined in by a cut to the nearest corner each can see.
    const joined = bridged(outline, holes);
    const tris = earcut(joined);
    const turned = way > 0 ? tris : tris.flatMap((_, i) => (i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : []));
    face(joined.map((q) => point(q, a1)), "+" + NAME[a], turned);
    face(joined.map((q) => point(q, a0)), "-" + NAME[a], turned.flatMap((_, i) => (i % 3 === 0 ? [turned[i]!, turned[i + 2]!, turned[i + 1]!] : [])));
    return this.solid(faces);
  }

  /**
   * A solid through `rings`, each a closed loop of points with the same count. side(k, i, j) gives the material and
   * texture coordinates of point j of ring i on the strip from point k to k + 1; cap(i, j) those of point j of an end ring.
   * With `along`, it is a straight prism along that axis and `cut` leaves it whole across it.
   */
  loft(rings: readonly (readonly Vec[])[], side: (k: number, i: number, j: number) => readonly [string, Uv], cap: (i: number, j: number) => readonly [string, Uv], along?: number): this {
    const n = rings[0]!.length;
    const faces: Face[] = [];
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const at = [[i, k], [i, j], [i + 1, j], [i + 1, k]] as const;
        const got = at.map(([r, c]) => side(k, r, c));
        faces.push({ points: at.map(([r, c]) => rings[r]![c]!), uvs: got.map((g) => g[1]), mat: got[0]![0] });
      }
    }
    for (const [i, order] of [[0, Array.from({ length: n }, (_, k) => n - 1 - k)], [rings.length - 1, Array.from({ length: n }, (_, k) => k)]] as const) {
      const got = order.map((j) => cap(i, j));
      faces.push({ points: order.map((j) => rings[i]![j]!), uvs: got.map((g) => g[1]), mat: got[0]![0] });
    }
    if (along !== undefined) for (const f of faces) f.along = along;
    return this.solid(faces);
  }

  /**
   * A box from `lo` to `hi` whose two faces across y are a frame of four mitred bands round a panel from (x0, z0) to
   * (x1, z1): a wall far off, its posts and plates one colour and its boards another, in 28 triangles.
   */
  framed(lo: Vec, hi: Vec, inner: readonly [number, number, number, number], frame: FaceMap, panel: FaceMap): this {
    const [x0, z0, x1, z1] = inner;
    const faces: Face[] = [];
    const face = (mapping: FaceMap, label: string, points: Vec[]): void => {
      const [mat, uv] = mapping(label, lo, hi);
      faces.push({ points, uvs: points.map(uv), mat });
    };
    for (const [label, y] of [["-y", lo[1]], ["+y", hi[1]]] as const) {
      const outer: Vec[] = [[lo[0], y, lo[2]], [hi[0], y, lo[2]], [hi[0], y, hi[2]], [lo[0], y, hi[2]]];
      const within: Vec[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
      for (let k = 0; k < 4; k++) face(frame, label, [outer[k]!, outer[(k + 1) % 4]!, within[(k + 1) % 4]!, within[k]!]);
      face(panel, label, within);
    }
    const corner = (i: number, j: number, k: number): Vec => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
    for (const label of ["-x", "+x", "-z", "+z"]) face(frame, label, FACES[label]!.map(([i, j, k]) => corner(i, j, k)));
    // The two faces across y were listed the same way round, so one of them is turned to look out.
    for (const f of faces.slice(5, 10)) {
      f.points.reverse();
      f.uvs.reverse();
    }
    return this.solid(faces);
  }

  /** A ring lying in the XZ plane: a door's pull. */
  ring(centre: Vec, radius: number, tube: number, mapping: FaceMap, segments = 8, sides = 4): this {
    const rows = Array.from({ length: segments }, (_, s) => {
      const t = (2 * Math.PI * s) / segments;
      return Array.from({ length: sides }, (_, k): Vec => {
        const q = (2 * Math.PI * (k + 0.5)) / sides;
        const r = radius + tube * Math.cos(q);
        return [centre[0] + Math.cos(t) * r, centre[1] + tube * Math.sin(q), centre[2] + Math.sin(t) * r];
      });
    });
    const [mat, uv] = mapping("-y", centre, centre);
    const faces: Face[] = [];
    for (let s = 0; s < segments; s++) {
      for (let k = 0; k < sides; k++) {
        const points = [rows[s]![k]!, rows[(s + 1) % segments]![k]!, rows[(s + 1) % segments]![(k + 1) % sides]!, rows[s]![(k + 1) % sides]!];
        faces.push({ points, uvs: points.map(uv), mat });
      }
    }
    return this.solid(faces);
  }

  /**
   * Cuts every face where it crosses the plane `axis` = `at`, so the level has a ring of vertices there: what lies
   * past it can be drawn pulled back onto it and the rest keeps its texture coordinates.
   */
  cut(axis: number, at: number): this {
    const EPS = 1e-7;
    const out: Face[] = [];
    for (const f of this.faces) {
      if (f.along === axis) {
        out.push(f);
        continue;
      }
      const polys = f.tris ? f.tris.flatMap((_, i) => (i % 3 === 0 ? [[f.tris![i]!, f.tris![i + 1]!, f.tris![i + 2]!]] : [])) : [f.points.map((_, k) => k)];
      const half = (): Face => ({ points: [], uvs: [], mat: f.mat, ...(f.along === undefined ? {} : { along: f.along }) });
      for (const poly of polys) {
        const d = poly.map((v) => f.points[v]![axis]! - at);
        if (d.every((v) => v >= -EPS) || d.every((v) => v <= EPS)) {
          out.push(f.tris ? { ...half(), points: poly.map((v) => f.points[v]!), uvs: poly.map((v) => f.uvs[v]!) } : f);
          continue;
        }
        const halves: [Face, Face] = [half(), half()];
        poly.forEach((v, k) => {
          const w = poly[(k + 1) % poly.length]!;
          const [dv, dw] = [d[k]!, d[(k + 1) % poly.length]!];
          for (const [h, keep] of [[halves[0], dv >= -EPS], [halves[1], dv <= EPS]] as const) {
            if (!keep) continue;
            h.points.push(f.points[v]!);
            h.uvs.push(f.uvs[v]!);
          }
          if ((dv > EPS && dw < -EPS) || (dv < -EPS && dw > EPS)) {
            // From the lesser corner, so both faces at an edge make the same point.
            const less = [f.points[v]!, f.points[w]!].map((p) => p.join()).sort()[0] === f.points[v]!.join();
            const [p, q, pu, qu, dp, dq] = less ? [f.points[v]!, f.points[w]!, f.uvs[v]!, f.uvs[w]!, dv, dw] : [f.points[w]!, f.points[v]!, f.uvs[w]!, f.uvs[v]!, dw, dv];
            const t = dp / (dp - dq);
            const point = [0, 1, 2].map((a) => (a === axis ? at : p[a]! + (q[a]! - p[a]!) * t)) as unknown as Vec;
            const uv: Uv = [pu[0] + (qu[0] - pu[0]) * t, pu[1] + (qu[1] - pu[1]) * t];
            for (const h of halves) {
              h.points.push(point);
              h.uvs.push(uv);
            }
          }
        });
        out.push(...halves.filter((h) => h.points.length >= 3));
      }
    }
    this.faces.length = 0;
    this.faces.push(...out);
    return this;
  }

  /** Gives every face whose middle `where` holds the material `mat`: a flat level's band of another colour. */
  paint(mat: string, where: (middle: Vec) => boolean): this {
    for (const f of this.faces) {
      const middle = scale(f.points.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec), 1 / f.points.length);
      if (where(middle)) f.mat = mat;
    }
    return this;
  }

  /** Moves every point: an open door is the shut one turned on its hinge. */
  move(to: (p: Vec) => Vec): this {
    for (const f of this.faces) f.points = f.points.map(to);
    return this;
  }

  get triangles(): number {
    return this.faces.reduce((n, f) => n + (f.tris ? f.tris.length / 3 : f.points.length - 2), 0);
  }

  /** Every triangle's three corners, in the recipe's frame. */
  corners(): Vec[] {
    return this.faces.flatMap((f) => triangles(f).map((v) => f.points[v]!));
  }

  /**
   * The level as a pack takes it. `materials` are the names its sections count in, and a face of a material not among
   * them, as every face of a flat level, is only coloured. `colour` gives a material's palette colour.
   */
  lod(materials: readonly string[] | null, colour: (mat: string) => number): SourceLod & { sections?: Uint8Array } {
    const positions: number[] = [], uvs: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [], sections: number[] = [];
    for (const f of this.faces) {
      const list = triangles(f);
      // Newell's sum, which a corner in a line with its neighbours does not spoil.
      let n: Vec = [0, 0, 0];
      const ring = f.tris ? null : f.points;
      if (ring) ring.forEach((p, k) => {
        const q = ring[(k + 1) % ring.length]!;
        n = add(n, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
      });
      else for (let t = 0; t < list.length; t += 3) n = add(n, cross(sub(f.points[list[t + 1]!]!, f.points[list[t]!]!), sub(f.points[list[t + 2]!]!, f.points[list[t]!]!)));
      n = unit(n);
      const first = positions.length / 3;
      f.points.forEach((p, k) => {
        positions.push(p[0], p[2], -p[1]);
        normals.push(n[0], n[2], -n[1]);
        uvs.push(f.uvs[k]![0], 1 - f.uvs[k]![1]);
        colors.push(colour(f.mat));
      });
      for (let t = 0; t < list.length; t += 3) {
        indices.push(first + list[t]!, first + list[t + 1]!, first + list[t + 2]!);
        sections.push(materials ? Math.max(0, materials.indexOf(f.mat)) : 0);
      }
    }
    const out: SourceLod = { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
    if (!materials) return out;
    Object.assign(out, { uvs: Float32Array.from(uvs), normals: Float32Array.from(normals), sections: Uint8Array.from(sections) });
    out.tangents = tangentsOf({ positions: out.positions, indices: out.indices, uvs: out.uvs!, normals: out.normals! });
    return out;
  }
}

/** A face's triangles as indices into its points. A four-cornered face is cut along its shorter diagonal. */
function triangles(f: Face): number[] {
  if (f.tris) return f.tris;
  const p = f.points;
  if (p.length === 3) return [0, 1, 2];
  if (p.length === 4) return length(sub(p[0]!, p[2]!)) <= length(sub(p[1]!, p[3]!)) ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
  // Laid flat along its two widest axes.
  let n: Vec = [0, 0, 0];
  p.forEach((a, k) => {
    const b = p[(k + 1) % p.length]!;
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  });
  const drop = [0, 1, 2].reduce((best, a) => (Math.abs(n[a]!) > Math.abs(n[best]!) ? a : best), 0);
  const [s, t] = [(drop + 1) % 3, (drop + 2) % 3];
  const flat = p.map((q) => [q[s]!, q[t]!] as const);
  const tris = earcut(flat);
  // earcut winds as the polygon goes round, and the polygon already looks outward.
  return tris;
}

/** An outline with each hole joined in along a cut to a corner of what is already joined, as one closed loop. */
function bridged(outline: readonly (readonly [number, number])[], holes: readonly (readonly (readonly [number, number])[])[]): (readonly [number, number])[] {
  let loop = [...outline];
  const signed = (ring: readonly (readonly [number, number])[]): number => ring.reduce((sum, q, i) => sum + q[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * q[1], 0);
  const way = Math.sign(signed(outline)) || 1;
  const crosses = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean => {
    const o = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < -1e-12 && o(c, d, a) * o(c, d, b) < -1e-12;
  };
  const pending = holes.map((h) => ((Math.sign(signed(h)) || 1) === way ? [...h].reverse() : [...h]));
  while (pending.length > 0) {
    let best: [number, number, number, number] | null = null;
    pending.forEach((hole, h) => hole.forEach((q, j) => loop.forEach((p, i) => {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (best && d >= best[3]) return;
      const walls = [loop, ...pending];
      if (walls.some((ring) => ring.some((a, k) => crosses(p, q, a, ring[(k + 1) % ring.length]!)))) return;
      best = [h, j, i, d];
    })));
    if (!best) throw new Error("a hole cannot be joined to its outline");
    const [h, j, i] = best as [number, number, number, number];
    const hole = pending.splice(h, 1)[0]!;
    loop = [...loop.slice(0, i + 1), ...hole.slice(j), ...hole.slice(0, j + 1), ...loop.slice(i)];
  }
  return loop;
}

/** `count` widths that sum to `total`, each within `spread` of the mean: boards, courses, panels. */
export function widths(rng: { uniform(a: number, b: number): number }, total: number, count: number, spread: number): number[] {
  const raw = Array.from({ length: count }, () => 1 + rng.uniform(-spread, spread));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w * total) / sum);
}

export interface BeamRings {
  rings: Vec[][];
  /** The section each ring is, as (across, up) pairs. */
  base: (readonly [number, number])[];
  length: number;
  /** How many lengths it is in. */
  n: number;
  /** The bevel taken off each arris. */
  c: number;
  hw: number;
  hh: number;
}

/**
 * The rings of a squared beam from a to b: `w` across (a x up) and `h` along up, its arrises bevelled by `chamfer`.
 * With `rough`, each section along it is a little out of true and the whole bows, by up to `rough` metres; its ends
 * stay true so its joints close.
 */
export function beamRings(rng: { uniform(a: number, b: number): number }, a: Vec, b: Vec, w: number, h: number, up: Vec, chamfer: number, rough: number, segs?: number): BeamRings {
  const len = length(sub(b, a));
  const d = unit(sub(b, a));
  const across = unit(cross(d, up));
  const upv = unit(cross(across, d));
  const n = segs || (rough ? Math.max(1, roundEven(len / 1.0)) : 1);
  const [hw, hh] = [w / 2, h / 2];
  const c = Math.min(chamfer, w / 3, h / 3);
  const base: (readonly [number, number])[] = c > 0 ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]] : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const bow = [rng.uniform(-1, 1) * rough, rng.uniform(-1, 1) * rough];
  const rings: Vec[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const free = Math.sin(Math.PI * t);
    const centre = add(add(add(a, scale(sub(b, a), t)), scale(across, bow[0]! * free)), scale(upv, bow[1]! * free));
    rings.push(base.map(([s, q]) => {
      const js = rng.uniform(-1, 1) * rough * 0.6 * free;
      const jq = rng.uniform(-1, 1) * rough * 0.6 * free;
      return add(add(centre, scale(across, s + js)), scale(upv, q + jq));
    }));
  }
  return { rings, base, length: len, n, c, hw, hh };
}

/** The triangles of a level's solids in the recipe's frame, nine numbers each, and each one's normal times twice its area. */
function soup(shape: Shape): { at: Float64Array; normal: Float64Array } {
  const corners = shape.corners(), n = corners.length / 3;
  const at = new Float64Array(n * 9), normal = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [corners[t * 3]!, corners[t * 3 + 1]!, corners[t * 3 + 2]!];
    at.set([...a, ...b, ...c], t * 9);
    normal.set(cross(sub(b, a), sub(c, a)), t * 3);
  }
  return { at, normal };
}

/** How many of the solids hold `p`: the faces a ray from it leaves by, less those it enters by. */
function holds(tris: { at: Float64Array; normal: Float64Array }, p: Vec): number {
  // A way no face of a piece lies along.
  const d: Vec = [0.5377, 0.6719, 0.5093];
  let count = 0;
  for (let t = 0; t < tris.normal.length / 3; t++) {
    const o = t * 9, a = tris.at;
    const e1: Vec = [a[o + 3]! - a[o]!, a[o + 4]! - a[o + 1]!, a[o + 5]! - a[o + 2]!], e2: Vec = [a[o + 6]! - a[o]!, a[o + 7]! - a[o + 1]!, a[o + 8]! - a[o + 2]!];
    const h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-14) continue;
    const s: Vec = [p[0] - a[o]!, p[1] - a[o + 1]!, p[2] - a[o + 2]!], u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) / det;
    if (v < 0 || u + v > 1 || dot(e2, q) / det <= 0) continue;
    count += d[0] * tris.normal[t * 3]! + d[1] * tris.normal[t * 3 + 1]! + d[2] * tris.normal[t * 3 + 2]! > 0 ? 1 : -1;
  }
  return count;
}

/**
 * A level with no materials, each face in the palette colour or colour region `colour` gives its material, as a pack
 * takes a flat level. With `edges`, each four-cornered face at least `least` metres across also says its corners and
 * which of its borders are outer edges, in the byte a body's bone has (shared/world/city.ts cornerByte), so the flat
 * program wears them as it wears a static's: a border is outer unless the level's solids go on past it, or it is the
 * foot of an upright face on the level's lowest plane, where the piece stands on what is under it.
 */
export function flatLod(shape: Shape, colour: (mat: string) => number, edges = false, least = 0.04): SourceLod {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], bones: number[] = [];
  const tris = edges ? soup(shape) : null;
  const lowest = Math.min(...shape.faces.flatMap((f) => f.points.map((q) => q[2])));
  for (const f of shape.faces) {
    const first = positions.length / 3, list = triangles(f), tone = colour(f.mat);
    let outer = 0;
    const q = f.points;
    if (tris && !f.tris && q.length === 4) {
      const n = unit(cross(sub(q[1]!, q[0]!), sub(q[3]!, q[0]!)));
      const middle = scale(q.reduce((sum, c) => add(sum, c), [0, 0, 0] as Vec), 0.25);
      // Borders in cornerByte's order: across at 0 and at 1, up at 0 and at 1.
      ([[3, 0], [1, 2], [0, 1], [2, 3]] as const).forEach(([a, b], k) => {
        const mid = scale(add(q[a]!, q[b]!), 0.5), away = sub(mid, middle), reach = length(away);
        if (reach * 2 < least || length(sub(q[a]!, q[b]!)) < least) return;
        if (Math.abs(n[2]) < 0.5 && Math.max(q[a]![2], q[b]![2]) <= lowest + 1e-6) return;
        // A point just past the border and just under the face: in a solid, the surface goes on there.
        if (holds(tris, sub(add(mid, scale(away, 0.006 / reach)), scale(n, 0.003))) <= 0) outer |= 1 << k;
      });
    }
    q.forEach((c, k) => {
      positions.push(c[0], c[2], -c[1]);
      colors.push(tone);
      bones.push(outer ? [0, 1, 3, 2][k]! | (outer << 2) : 0);
    });
    for (const v of list) indices.push(first + v);
  }
  const out: SourceLod = { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
  if (edges) out.bones = Uint8Array.from(bones);
  return out;
}

/** A face a recipe gives whole and already looking outward, with a normal at each corner where it is shaded round. */
export interface Facet {
  points: Vec[];
  uvs: Uv[];
  mat: string;
  normals?: Vec[];
  along?: number;
}

/** The triangles of a flat convex polygon that has corners in a line along its sides, none of them empty. */
export function cornerTriangles(points: readonly Vec[]): number[] {
  const left = points.map((_, i) => i);
  const bend = (a: number, b: number, c: number): number => length(cross(sub(points[b]!, points[a]!), sub(points[c]!, points[b]!)));
  const size = Math.max(...points.map((p) => length(sub(p, points[0]!)))) ** 2 * 1e-9;
  const out: number[] = [];
  while (left.length > 3) {
    const m = left.length;
    // An ear is a true corner, and what is left when it is cut must still turn somewhere else.
    const at = left.findIndex((_, i) => bend(left[(i + m - 1) % m]!, left[i]!, left[(i + 1) % m]!) > size && left.some((_, k) => {
      const rest = left.filter((__, j) => j !== i);
      return bend(rest[(k + rest.length - 1) % rest.length]!, rest[k % rest.length]!, rest[(k + 1) % rest.length]!) > size;
    }));
    if (at < 0) break;
    out.push(left[(at + m - 1) % m]!, left[at]!, left[(at + 1) % m]!);
    left.splice(at, 1);
  }
  for (let k = 1; k + 1 < left.length; k++) out.push(left[0]!, left[k]!, left[k + 1]!);
  return out;
}

/**
 * A shape that also takes faces one by one, some shaded round: a stone's crown drawn as normals on a flat face. A round
 * face keeps its normals only whole, so it must lie clear of every yield ring or run along it.
 */
export class Carved extends Shape {
  private readonly round = new Map<object, Vec[]>();

  face(f: Facet): this {
    const made = { points: f.points, uvs: f.uvs, mat: f.mat, ...(f.along === undefined ? {} : { along: f.along }) };
    this.faces.push(made);
    if (f.normals) this.round.set(made, f.normals);
    return this;
  }

  /**
   * Closes the faces from `from` on where one's corner lies along another's side: each takes the corners of the others
   * that lie along its sides, and a face so given is cut into triangles. Faces tiled apart then make one closed solid.
   */
  weld(from: number): this {
    const EPS = 1e-7;
    const faces = this.faces.splice(from);
    const seen = new Map<string, Vec>();
    for (const f of faces) for (const p of f.points) seen.set(p.map((c) => Math.round(c / EPS)).join(), p);
    const corners = [...seen.values()];
    for (const f of faces) {
      const normals = this.round.get(f);
      const points: Vec[] = [], uvs: Uv[] = [], bent: Vec[] = [];
      f.points.forEach((a, i) => {
        const j = (i + 1) % f.points.length;
        const b = f.points[j]!;
        const d = sub(b, a);
        const l2 = dot(d, d);
        points.push(a);
        uvs.push(f.uvs[i]!);
        if (normals) bent.push(normals[i]!);
        const on: number[] = [];
        for (const c of corners) {
          const t = dot(sub(c, a), d) / l2;
          if (t > 1e-6 && t < 1 - 1e-6 && length(sub(add(a, scale(d, t)), c)) < EPS) on.push(t);
        }
        for (const t of on.sort((x, y) => x - y)) {
          points.push(add(a, scale(d, t)));
          uvs.push([f.uvs[i]![0] + (f.uvs[j]![0] - f.uvs[i]![0]) * t, f.uvs[i]![1] + (f.uvs[j]![1] - f.uvs[i]![1]) * t]);
          if (normals) bent.push(unit(add(scale(normals[i]!, 1 - t), scale(normals[j]!, t))));
        }
      });
      if (points.length === f.points.length) {
        this.faces.push(f);
        continue;
      }
      this.round.delete(f);
      const tris = cornerTriangles(points);
      for (let t = 0; t < tris.length; t += 3) {
        const of = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
        this.face({ points: of.map((k) => points[k]!), uvs: of.map((k) => uvs[k]!), mat: f.mat, ...(normals ? { normals: of.map((k) => bent[k]!) } : {}), ...(f.along === undefined ? {} : { along: f.along }) });
      }
    }
    return this;
  }

  override lod(materials: readonly string[] | null, colour: (mat: string) => number): SourceLod & { sections?: Uint8Array } {
    const out = super.lod(materials, colour);
    if (!out.normals || this.round.size === 0) return out;
    let first = 0;
    for (const f of this.faces) {
      // As the level is turned: +Y up and +Z out.
      this.round.get(f)?.forEach((n, k) => out.normals!.set([n[0], n[2], -n[1]], (first + k) * 3));
      first += f.points.length;
    }
    out.tangents = tangentsOf({ positions: out.positions, indices: out.indices, uvs: out.uvs!, normals: out.normals });
    return out;
  }
}


// Round and cut-out work, added for thatch: poles shaded round, sheets seen from both sides, and solids of any faces.

/** One polygon of a solid as a recipe hands it over, a texture coordinate to a corner. */
export interface Patch {
  points: Vec[];
  uvs: Uv[];
  mat: string;
  /** Faces of one group are shaded as one round surface where they meet: a pole's side, a bundle's belly. */
  group?: number;
  /** As a face's: the axis it is a prism along and may cross a yield ring uncut. */
  along?: number;
}

const GROUP_MARK = "\u0000";

/**
 * A shape with round parts. Faces of one group share a normal at each point they share, and a level drawn with
 * materials has one vertex wherever position, normal, texture coordinate and material agree.
 */
export class RoundShape extends Shape {
  private readonly groups = new WeakMap<object, number>();
  private last = 0;

  /** A group no faces have yet. */
  group(): number {
    return ++this.last;
  }

  private take(patches: readonly Patch[]): this {
    for (const f of patches) {
      const face = { points: [...f.points], uvs: [...f.uvs], mat: f.mat, ...(f.along === undefined ? {} : { along: f.along }) };
      if (f.group !== undefined) this.groups.set(face, f.group);
      this.faces.push(face);
    }
    return this;
  }

  /** Closed solids of `patches`, which may go round either way: each is turned to go round as its neighbours do, and to look outward. */
  skin(patches: readonly Patch[]): this {
    return this.take(aligned(patches, true));
  }

  /** A sheet with no thickness that is seen from both sides: each patch, and its back turned the other way. */
  card(patches: readonly Patch[]): this {
    const front = aligned(patches, false);
    return this.take([...front, ...front.map((f) => ({ ...f, points: [...f.points].reverse(), uvs: [...f.uvs].reverse(), ...(f.group === undefined ? {} : { group: -f.group }) }))]);
  }

  /** A cut makes faces anew, so each carries its group through it in its material's name. */
  override cut(axis: number, at: number): this {
    for (const f of this.faces) {
      const g = this.groups.get(f);
      if (g !== undefined) f.mat = `${f.mat}${GROUP_MARK}${g}`;
    }
    super.cut(axis, at);
    for (const f of this.faces) {
      const mark = f.mat.indexOf(GROUP_MARK);
      if (mark < 0) continue;
      this.groups.set(f, Number(f.mat.slice(mark + 1)));
      f.mat = f.mat.slice(0, mark);
    }
    return this;
  }

  override lod(materials: readonly string[] | null, colour: (mat: string) => number): SourceLod & { sections?: Uint8Array } {
    const flat = super.lod(materials, colour);
    if (!materials) return flat;
    const [p, n, uv] = [flat.positions, flat.normals!, flat.uvs!];
    // A group's normal at a point: its faces' normals there, each by the angle it has at that corner.
    const sums = new Map<string, [number, number, number]>();
    const keys: (string | undefined)[] = [];
    const mats: number[] = [];
    let v = 0;
    for (const f of this.faces) {
      const g = this.groups.get(f);
      const count = f.points.length;
      for (let k = 0; k < count; k++, v++) {
        mats.push(materials.indexOf(f.mat));
        if (g === undefined) {
          keys.push(undefined);
          continue;
        }
        const key = `${g}|${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
        keys.push(key);
        const [a, b] = [unit(sub(f.points[(k + 1) % count]!, f.points[k]!)), unit(sub(f.points[(k + count - 1) % count]!, f.points[k]!))];
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
        const sum = sums.get(key) ?? [0, 0, 0];
        for (let c = 0; c < 3; c++) sum[c]! += n[v * 3 + c]! * angle;
        sums.set(key, sum);
      }
    }
    keys.forEach((key, at) => {
      if (key === undefined) return;
      const sum = unit(sums.get(key)!);
      if (length(sum) > 0.5) n.set(sum, at * 3);
    });
    // One vertex where all of a corner's values agree.
    const ids = new Map<string, number>();
    const place = new Uint32Array(keys.length);
    const kept: number[] = [];
    for (let at = 0; at < keys.length; at++) {
      const key = `${mats[at]},${flat.colors[at]},${p[at * 3]},${p[at * 3 + 1]},${p[at * 3 + 2]},${n[at * 3]},${n[at * 3 + 1]},${n[at * 3 + 2]},${uv[at * 2]},${uv[at * 2 + 1]}`;
      let id = ids.get(key);
      if (id === undefined) {
        ids.set(key, (id = kept.length));
        kept.push(at);
      }
      place[at] = id;
    }
    const pick = (from: ArrayLike<number>, size: number): number[] => kept.flatMap((at) => Array.from({ length: size }, (_, c) => from[at * size + c]!));
    const out: SourceLod & { sections?: Uint8Array } = {
      positions: Float32Array.from(pick(p, 3)), colors: Uint8Array.from(pick(flat.colors, 1)), indices: flat.indices.map((at) => place[at]!),
      uvs: Float32Array.from(pick(uv, 2)), normals: Float32Array.from(pick(n, 3)), sections: flat.sections!,
    };
    out.tangents = tangentsOf({ positions: out.positions, indices: out.indices, uvs: out.uvs!, normals: out.normals! });
    return out;
  }
}

/**
 * `patches` with each turned to go round the way those it shares an edge with do. With `outward`, every joined set is a
 * closed solid and is turned to look out of itself.
 */
function aligned(patches: readonly Patch[], outward: boolean): Patch[] {
  const out = patches.map((f) => ({ ...f, points: [...f.points], uvs: [...f.uvs] }));
  const name = (p: Vec): string => `${p[0]},${p[1]},${p[2]}`;
  // Per edge, the patches along it and the way each runs it.
  const edges = new Map<string, [number, boolean][]>();
  out.forEach((f, at) => f.points.forEach((p, k) => {
    const [a, b] = [name(p), name(f.points[(k + 1) % f.points.length]!)];
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(key, [...(edges.get(key) ?? []), [at, a < b]]);
  }));
  const turned = new Array<boolean | undefined>(out.length);
  const sets: number[][] = [];
  out.forEach((_, first) => {
    if (turned[first] !== undefined) return;
    turned[first] = false;
    const set = [first];
    for (let q = 0; q < set.length; q++) {
      const f = out[set[q]!]!;
      f.points.forEach((p, k) => {
        const [a, b] = [name(p), name(f.points[(k + 1) % f.points.length]!)];
        if (a === b) return;
        const way = (a < b) !== turned[set[q]!];
        for (const [other, theirs] of edges.get(a < b ? `${a}|${b}` : `${b}|${a}`)!) {
          if (turned[other] !== undefined) continue;
          // Two faces at an edge go round alike when they run it opposite ways.
          turned[other] = theirs === way;
          set.push(other);
        }
      });
    }
    sets.push(set);
  });
  for (const set of sets) {
    let volume = 0;
    for (const at of set) {
      const f = out[at]!;
      const sign = turned[at] ? -1 : 1;
      for (let k = 2; k < f.points.length; k++) volume += sign * dot(f.points[0]!, cross(f.points[k - 1]!, f.points[k]!));
    }
    for (const at of set) {
      if (turned[at] === (outward && volume < 0)) continue;
      out[at]!.points.reverse();
      out[at]!.uvs.reverse();
    }
  }
  return out;
}

/**
 * A direction and two axes square to it at each point of a path, the first carried along so the frame does not twist.
 * `up` sets the first where the path does not run along it.
 */
export function pathFrames(path: readonly Vec[], up: Vec = [0, 1, 0]): [Vec, Vec, Vec][] {
  const out: [Vec, Vec, Vec][] = [];
  let prev: Vec | null = null;
  path.forEach((_, i) => {
    const d = unit(sub(path[Math.min(i + 1, path.length - 1)]!, path[Math.max(i - 1, 0)]!));
    const e1: Vec = prev ? unit(sub(prev, scale(d, dot(prev, d)))) : unit(cross(d, Math.abs(dot(d, up)) < 0.9 ? up : [1, 0, 0]));
    out.push([d, e1, cross(d, e1)]);
    prev = e1;
  });
  return out;
}

/** The rings of a round pole along `path`: `sides` points at each, `radius(i, j)` from the path, turned by `twist`. */
export function poleRings(path: readonly Vec[], sides: number, twist: number, radius: (i: number, j: number) => number, up?: Vec): Vec[][] {
  return pathFrames(path, up).map(([, e1, e2], i) => Array.from({ length: sides }, (_, j): Vec => {
    const th = twist + (2 * Math.PI * j) / sides;
    const r = radius(i, j);
    return add(path[i]!, add(scale(e1, r * Math.cos(th)), scale(e2, r * Math.sin(th))));
  }));
}
