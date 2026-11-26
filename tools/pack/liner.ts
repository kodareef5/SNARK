// A worn piece made for another body stands in for its slot's skin, but its own skin, where it had any, and its edges
// were cut for that body. Lining it puts the cooked body's own skin of that slot into the piece wherever the piece does
// not cover it at rest, and a margin under its edges: the body's triangles at each level, with their bones and weights,
// so the piece's seams with the bare slots beside it are the bare body's own, and its edges lie over skin that moves as
// the skin beside it does.

import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { setTexture, textureOf } from "../../shared/pack/pack.ts";
import { smoothNormals, TriangleGrid, welded } from "./refit.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** How far out along its normal a point of skin looks for the piece over it, in metres. */
const OVER = 0.05;
/** Skin this far apart at rest is another part of the body, not the same surface. */
const FOLD_APART = 0.015;
/**
 * How far inside the skin a piece may lie and still count as over it, in metres: a boot kept as it was calibrated, which
 * the new foot's toes come through, hides them rather than drawing them.
 */
const SKIN_SLACK = 0.03;
/** How far under the piece's edges the lining reaches, in metres. */
export const LINER_MARGIN = 0.02;
/** How far the lining under the piece sinks into the body, at the far side of its margin: a hem's facing. */
const LINER_INSET = 0.006;

/** Whether `mesh`'s section `s` is drawn with skin. */
const skinSection = (mesh: SourceMesh, s: number): boolean => /skin/.test(mesh.materials?.[s]?.id ?? "skin");

/** The first hit within `reach` of the ray from p along unit d on `grid`'s triangles, or -1. */
function ray(grid: TriangleGrid, p: readonly number[], d: readonly number[], reach: number, keep: (t: number) => boolean = () => true): number {
  const q = grid.positions, idx = grid.indices;
  let best = -1;
  grid.along(p[0]!, p[1]!, p[2]!, d, reach, (tri) => {
    const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
    const e1 = [q[b]! - q[a]!, q[b + 1]! - q[a + 1]!, q[b + 2]! - q[a + 2]!], e2 = [q[c]! - q[a]!, q[c + 1]! - q[a + 1]!, q[c + 2]! - q[a + 2]!];
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-14) return;
    const s = [p[0]! - q[a]!, p[1]! - q[a + 1]!, p[2]! - q[a + 2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) return;
    const r = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!) / det;
    if (v < 0 || u + v > 1) return;
    const t = (e2[0]! * r[0]! + e2[1]! * r[1]! + e2[2]! * r[2]!) / det;
    if (t >= 0 && t <= reach && (best < 0 || t < best) && keep(tri)) best = t;
  });
  return best;
}

/** Of the body's skin at its finest level, the points the piece, not yet lined, leaves showing at rest: no part of it over them. */
export function showing(piece: SourceMesh, body: SourceMesh): Float64Array {
  const lod = piece.lods[0]!;
  const grid = new TriangleGrid(lod.positions, lod.indices, 0.02);
  const skin = body.lods[0]!;
  const w = welded({ positions: skin.positions, indices: skin.indices });
  const own = new TriangleGrid(w.positions, w.indices, 0.02);
  const mid = (t: number, a: number): number => (w.positions[w.indices[t * 3]! * 3 + a]! + w.positions[w.indices[t * 3 + 1]! * 3 + a]! + w.positions[w.indices[t * 3 + 2]! * 3 + a]!) / 3;
  const out: number[] = [];
  for (let i = 0; i < w.positions.length / 3; i++) {
    const p = [w.positions[i * 3]!, w.positions[i * 3 + 1]!, w.positions[i * 3 + 2]!], n = [w.normals[i * 3]!, w.normals[i * 3 + 1]!, w.normals[i * 3 + 2]!];
    // From a little inside, so cloth pressed onto the skin counts as over it.
    if (ray(grid, p.map((x, a) => x - n[a]! * SKIN_SLACK), n, OVER + SKIN_SLACK) >= 0) continue;
    // Skin in a fold, other skin of the slot close over it, as between the thighs, shows only where that skin does.
    const apart = (t: number): boolean => (mid(t, 0) - p[0]!) ** 2 + (mid(t, 1) - p[1]!) ** 2 + (mid(t, 2) - p[2]!) ** 2 > FOLD_APART * FOLD_APART;
    if (ray(own, p.map((x, a) => x + n[a]! * 0.001), n, OVER, apart) >= 0) continue;
    out.push(...p);
  }
  return Float64Array.from(out);
}

/** Points filed by cells of `cell` metres, to ask whether any lies within that of a place. */
class PointCells {
  private readonly cells = new Map<string, number[]>();
  private readonly p: ArrayLike<number>;
  private readonly cell: number;
  constructor(p: ArrayLike<number>, cell: number) {
    this.p = p;
    this.cell = cell;
    for (let i = 0; i < p.length / 3; i++) {
      const k = this.key(Math.floor(p[i * 3]! / cell), Math.floor(p[i * 3 + 1]! / cell), Math.floor(p[i * 3 + 2]! / cell));
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
    }
  }
  private key(i: number, j: number, k: number): string {
    return `${i},${j},${k}`;
  }
  /** The distance to the nearest point, where one is within a cell; Infinity where none is. */
  distance(x: number, y: number, z: number): number {
    const c = this.cell, [i, j, k] = [Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)];
    let best = c * c;
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) for (let d = k - 1; d <= k + 1; d++) {
      for (const n of this.cells.get(this.key(a, b, d)) ?? []) best = Math.min(best, (this.p[n * 3]! - x) ** 2 + (this.p[n * 3 + 1]! - y) ** 2 + (this.p[n * 3 + 2]! - z) ** 2);
    }
    return best < c * c ? Math.sqrt(best) : Infinity;
  }
  near(x: number, y: number, z: number): boolean {
    return this.distance(x, y, z) < Infinity;
  }
}

/**
 * Puts into `piece`, at each of its levels, the triangles of `body`'s same level that lie within `margin` of skin the
 * piece leaves showing (`showing`), drawn with the body's skin material where both levels are drawn with materials.
 * Returns how many triangles each level gained.
 */
/**
 * For a point of `body`'s skin at rest, how far under it the lining of the piece, not yet lined, will lie there: -1 where
 * there is none, more than `margin` from skin the piece leaves showing.
 */
export function liningOf(piece: SourceMesh, body: SourceMesh, margin = LINER_MARGIN): (x: number, y: number, z: number) => number {
  const shown = new PointCells(showing(piece, body), margin);
  return (x, y, z) => {
    const d = shown.distance(x, y, z);
    return d === Infinity ? -1 : sinkAt(d, margin);
  };
}

/** How far the lining sinks `d` metres in from the skin a piece leaves showing. */
function sinkAt(d: number, margin: number): number {
  const t = Math.min(1, d / margin);
  return LINER_INSET * t * t * (3 - 2 * t);
}

export function line(piece: SourceMesh, body: SourceMesh, margin = LINER_MARGIN): number[] {
  const shown = new PointCells(showing(piece, body), margin);
  // The body's skin material in the piece's list, its textures after the piece's own.
  const skinAt = (body.materials ?? []).findIndex((m) => /skin/.test(m.id));
  let section = -1;
  if (skinAt >= 0 && piece.materials) {
    section = piece.materials.findIndex((m) => m.id === body.materials![skinAt]!.id);
    if (section < 0) {
      const m = { ...body.materials![skinAt]! };
      piece.textures ??= [];
      for (const role of TEXTURE_ROLES) {
        const t = textureOf(m, role);
        if (t < 0) continue;
        const tex = body.textures![t]!;
        let at = piece.textures.findIndex((x) => x.id === tex.id && x.role === tex.role);
        if (at < 0) at = piece.textures.push(tex) - 1;
        setTexture(m, role, at);
      }
      section = piece.materials.push(m) - 1;
    }
  }
  return piece.lods.map((lod, level) => {
    const from = body.lods[Math.min(level, body.lods.length - 1)]!;
    const keep: number[] = [];
    for (let t = 0; t < from.indices.length / 3; t++) {
      if (!skinSection(body, from.sections?.[t] ?? 0)) continue;
      const c = [0, 1, 2].map((a) => (from.positions[from.indices[t * 3]! * 3 + a]! + from.positions[from.indices[t * 3 + 1]! * 3 + a]! + from.positions[from.indices[t * 3 + 2]! * 3 + a]!) / 3);
      if (shown.near(c[0]!, c[1]!, c[2]!)) keep.push(t);
    }
    if (keep.length === 0) return 0;
    const joined = joinLods(lod, from, keep, section);
    // Under the piece the lining sinks in as it nears its edge, so the piece's edge stays over it as the body bends.
    const normals = from.normals ?? (() => {
      const n = new Float64Array(from.positions.length);
      smoothNormals(from.positions, from.indices, n);
      return n;
    })();
    const p = joined.positions;
    for (let v = lod.positions.length / 3, k = 0; v < p.length / 3; v++, k++) {
      const d = shown.distance(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
      const sink = sinkAt(d === Infinity ? margin : d, margin);
      const src = joined.from![k]!;
      for (let a = 0; a < 3; a++) p[v * 3 + a]! -= normals[src * 3 + a]! * sink;
    }
    delete joined.from;
    piece.lods[level] = joined;
    return keep.length;
  });
}

/** `a` with triangles `keep` of `b` after its own, their vertices taken with them; fields `a` has and `b` lacks are made up. */
function joinLods(a: SourceLod, b: SourceLod, keep: readonly number[], section: number): SourceLod & { from?: number[] } {
  const na = a.positions.length / 3;
  const map = new Map<number, number>();
  const taken: number[] = [];
  const indices = Array.from(a.indices);
  for (const t of keep) for (let k = 0; k < 3; k++) {
    const v = b.indices[t * 3 + k]!;
    let i = map.get(v);
    if (i === undefined) map.set(v, (i = na + taken.push(v) - 1));
    indices.push(i);
  }
  const per = <T extends Float32Array | Uint8Array>(x: T | undefined, y: T | undefined, size: number, make: (n: number) => T, fill: (v: number, out: T, at: number) => void): T | undefined => {
    if (!x) return undefined;
    const out = make((na + taken.length) * size);
    out.set(x);
    taken.forEach((v, i) => (y ? out.set(y.subarray(v * size, v * size + size), (na + i) * size) : fill(v, out, (na + i) * size)));
    return out;
  };
  const out: SourceLod = {
    positions: per(a.positions, b.positions, 3, (n) => new Float32Array(n), () => {})!,
    colors: per(a.colors, b.colors, 1, (n) => new Uint8Array(n), () => {})!,
    indices: Uint32Array.from(indices),
  };
  if (a.bones) out.bones = per(a.bones, b.bones, 1, (n) => new Uint8Array(n), () => {});
  out.uvs = per(a.uvs, b.uvs, 2, (n) => new Float32Array(n), () => {});
  out.joints = per(a.joints, b.joints, 4, (n) => new Uint8Array(n), (v, o, at) => o.set([b.bones![v]!, b.bones![v]!, b.bones![v]!, b.bones![v]!], at));
  out.weights = per(a.weights, b.weights, 4, (n) => new Float32Array(n), (_, o, at) => o.set([1, 0, 0, 0], at));
  if (a.normals) {
    if (b.normals) out.normals = per(a.normals, b.normals, 3, (n) => new Float32Array(n), () => {});
    else {
      const n = new Float64Array(b.positions.length);
      smoothNormals(b.positions, b.indices, n);
      out.normals = per(a.normals, Float32Array.from(n), 3, (k) => new Float32Array(k), () => {});
    }
  }
  if (a.sections || (a.uvs && section > 0)) out.sections = Uint8Array.from([...(a.sections ?? new Uint8Array(a.indices.length / 3)), ...keep.map(() => Math.max(0, section))]);
  if (a.error !== undefined) out.error = a.error;
  for (const k of Object.keys(out) as (keyof SourceLod)[]) if (out[k] === undefined) delete out[k];
  return { ...out, from: taken };
}

/** The skin of a body's slot meshes at one level, welded: what a piece is kept clear of. */
export function skinLevel(body: readonly SourceMesh[], level: number): { grid: TriangleGrid; normals: Float64Array; indices: Uint32Array } {
  const positions: number[] = [], indices: number[] = [];
  for (const mesh of body) {
    const lod = mesh.lods[Math.min(level, mesh.lods.length - 1)]!;
    const base = positions.length / 3;
    positions.push(...lod.positions);
    for (let t = 0; t < lod.indices.length / 3; t++) if (skinSection(mesh, lod.sections?.[t] ?? 0)) indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
  }
  const w = welded({ positions, indices });
  return { grid: new TriangleGrid(w.positions, w.indices, 0.02), normals: w.normals, indices: w.indices };
}

/** How far into the skin a vertex is looked for, in metres. */
const INSIDE = 0.06;

/**
 * Moves each vertex of `lod` that lies inside `skin`, or nearer it than `clear`, out along the skin's normal to `clear`,
 * but for those `still` keeps where they are. Its levels are made after the piece is fitted, and a level may sag into the
 * skin. Returns how many moved.
 */
export function clearOf(lod: SourceLod, skin: ReturnType<typeof skinLevel>, clear: number, still: (v: number) => boolean): number {
  const hit = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  let moved = 0;
  const p = lod.positions;
  for (let v = 0; v < p.length / 3; v++) {
    if (still(v) || !skin.grid.nearest(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!, INSIDE, hit)) continue;
    const c = [0, 1, 2].map((k) => skin.indices[hit.triangle * 3 + k]!);
    const share = [hit.u, hit.v, hit.w];
    const n = [0, 1, 2].map((a) => share.reduce((s, w, k) => s + w * skin.normals[c[k]! * 3 + a]!, 0));
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const out = ((p[v * 3]! - hit.x) * n[0]! + (p[v * 3 + 1]! - hit.y) * n[1]! + (p[v * 3 + 2]! - hit.z) * n[2]!) / l;
    if (out >= clear) continue;
    for (let a = 0; a < 3; a++) p[v * 3 + a] = [hit.x, hit.y, hit.z][a]! + (n[a]! / l) * clear;
    moved++;
  }
  return moved;
}
