import type { PackHitSurface } from "../../shared/pack/pack.ts";
import { ZONES, type HitSurfaceSpec } from "../art/spec.ts";

type Skin = { bones: ArrayLike<number>; positions: ArrayLike<number>; indices: ArrayLike<number>; joints: ArrayLike<number>; weights: ArrayLike<number> };
type Point = readonly [number, number, number];
const directions: Point[] = Array.from({ length: 66 }, (_, i) => {
  const z = (i + .5) * 2 / 66 - 1, r = Math.sqrt(1 - z * z), angle = i * Math.PI * (3 - Math.sqrt(5));
  return [r * Math.cos(angle), r * Math.sin(angle), z];
});
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Fit planes through the convex envelope of a small set of support points.
 * Each resulting plane is moved out to contain every original skin vertex.
 * This keeps horn tips and thin frill edges without storing a render mesh. */
function fitPiece(points: Point[], padding: number) {
  const extremes = [...new Set(directions.map(axis => {
    let best = points[0]!, far = dot(best, axis);
    for (const p of points) {
      const d = dot(p, axis);
      if (d > far) { far = d; best = p; }
    }
    return best;
  }))];
  const box: number[] = [], planes: number[] = [];
  for (let a = 0; a < 3; a++) {
    let low = Infinity, high = -Infinity;
    for (const p of points) { low = Math.min(low, p[a]!); high = Math.max(high, p[a]!); }
    box.push(Math.floor((low - padding) * 1000) / 1000, Math.ceil((high + padding) * 1000) / 1000);
  }
  const seen = new Set<string>();
  function support(x: number, y: number, z: number) {
    const scale = Math.hypot(x, y, z);
    if (scale < 1e-10) return;
    const quantize = (v: number) => Math.round(v / scale * 10000) / 10000;
    const n: Point = [quantize(x), quantize(y), quantize(z)];
    const key = n.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    let far = -Infinity;
    for (const p of points) far = Math.max(far, dot(p, n));
    planes.push(...n, Math.ceil((far + padding) * 1000) / 1000);
  }
  for (let i = 0; i < extremes.length; i++) for (let j = i + 1; j < extremes.length; j++) for (let k = j + 1; k < extremes.length; k++) {
    const a = extremes[i]!, b = extremes[j]!, c = extremes[k]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n: Point = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const epsilon = 1e-7 * Math.hypot(...n);
    if (epsilon < 1e-16) continue;
    const plane = dot(n, a);
    let front = false, back = false;
    for (const e of extremes) {
      const d = dot(n, e) - plane;
      if (d > epsilon) front = true;
      if (d < -epsilon) back = true;
      if (front && back) break;
    }
    if (!front) support(...n);
    if (!back) support(-n[0], -n[1], -n[2]);
    // A single triangle has no volumetric hull. Its three edge planes keep
    // the thin piece triangular when its box falls obliquely in joint space.
    if (!front && !back) {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const x = q[0] - p[0], y = q[1] - p[1], z = q[2] - p[2];
        support(y * n[2] - z * n[1], z * n[0] - x * n[2], x * n[1] - y * n[0]);
      }
    }
  }
  return { box, planes };
}

export function fitHitSurface(spec: HitSurfaceSpec, skin: Skin, names: readonly string[], parent: readonly number[], rest: readonly number[], caps: readonly number[]): PackHitSurface {
  const root = names.indexOf(spec.root), zone = ZONES[spec.zone], zones = new Uint8Array(names.length);
  for (let i = 0; i < caps.length; i += 9) zones[caps[i]!] = caps[i + 1]!;
  if (root < 0 || zones[root] !== zone || !spec.cells[spec.root]) throw new Error(`hit surface requires its "${spec.root}" zone and cell size`);
  const owner = names.map((_, b) => {
    let carrier = -1;
    for (let i = b; i >= 0; i = parent[i]!) {
      if (zones[i] && zones[i] !== zone) return -1;
      if (carrier < 0 && spec.cells[names[i]!]) carrier = i;
      if (i === root) return carrier;
    }
    return -1;
  });
  for (const [name, cell] of Object.entries(spec.cells)) {
    const b = names.indexOf(name);
    if (b < 0 || owner[b] !== b || cell.length !== 3 || cell.some(v => !Number.isFinite(v) || v <= 0)) throw new Error(`invalid hit surface cell on "${name}"`);
  }
  for (const [name, padding] of Object.entries(spec.padding ?? {})) {
    if (!Object.hasOwn(spec.cells, name) || !Number.isFinite(padding) || padding < 0 || padding > .1) {
      throw new Error(`invalid hit surface padding on "${name}"`);
    }
  }
  const weights = new Float64Array(names.length), bins = new Map<number, Map<string, Set<number>>>();
  for (let i = 0; i < skin.indices.length; i += 3) {
    weights.fill(0);
    const vertices = [skin.indices[i]!, skin.indices[i + 1]!, skin.indices[i + 2]!];
    for (const v of vertices) {
      if (skin.weights.length) for (let k = 0; k < 4; k++) weights[skin.joints[v * 4 + k]!] += skin.weights[v * 4 + k]!;
      else weights[skin.bones[v]!] += 1;
    }
    let dominant = 0;
    for (let b = 1; b < weights.length; b++) if (weights[b]! > weights[dominant]!) dominant = b;
    const bone = owner[dominant]!;
    if (bone < 0) continue;
    const cell = spec.cells[names[bone]!]!;
    const key = [0, 1, 2].map(a => Math.floor(vertices.reduce((sum, v) => sum + skin.positions[v * 3 + a]!, 0) / (3 * cell[a]!))).join(",");
    let group = bins.get(bone);
    if (!group) { group = new Map(); bins.set(bone, group); }
    let ids = group.get(key);
    if (!ids) { ids = new Set(); group.set(key, ids); }
    for (const v of vertices) ids.add(v);
  }
  if (!bins.size) throw new Error(`hit surface "${spec.root}" has no skin`);
  return { root, zone, bones: [...bins].map(([bone, cells]) => ({
    bone, pieces: [...cells.values()].map(ids => fitPiece([...ids].map(v => [
      skin.positions[v * 3]! - rest[bone * 3]!, skin.positions[v * 3 + 1]! - rest[bone * 3 + 1]!, skin.positions[v * 3 + 2]! - rest[bone * 3 + 2]!,
    ]), spec.padding?.[names[bone]!] ?? 0)),
  })) };
}
