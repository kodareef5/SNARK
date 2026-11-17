// A landmark's definitions on the way in: their text read as the platform reads UTF-8, and their content compiled to the
// tables and hash an independent reference gives, with every shape repeated by value and by name. The reference is the hull
// and the hash as they were first written: every three corners tried with each plane an array, and the canonical text built
// whole.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { KORU } from "../../content/landmarks/koru.ts";
import type { Def, ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import { deriveRegistry } from "../../shared/content/tuning.ts";
import { hashString } from "../../shared/hash.ts";
import { decodeUtf8 } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { MAX_CORNERS, hullFault, hullOf, hullPoint, type HullDef, type HullTable } from "../../shared/world/convex.ts";

type Hull = { faces: number[]; edges: number[]; rings: number[][] };

function referenceHull(def: HullDef): Hull | string {
  const n = def.corners.length;
  if (n < 4 || n > MAX_CORNERS) return `a part has 4 to ${MAX_CORNERS} corners`;
  const p = def.corners.map((c) => hullPoint(c, def.sixty === true));
  const planes: number[][] = [];
  const faces: number[] = [];
  const EPS = 1e-9;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = p[i]!, b = p[j]!, c = p[k]!;
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = u[1]! * v[2]! - u[2]! * v[1]!;
        let ny = u[2]! * v[0]! - u[0]! * v[2]!;
        let nz = u[0]! * v[1]! - u[1]! * v[0]!;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (l < EPS) continue;
        nx /= l;
        ny /= l;
        nz /= l;
        const d = nx * a[0] + ny * a[1] + nz * a[2];
        let above = 0;
        let below = 0;
        for (const q of p) {
          const s = nx * q[0] + ny * q[1] + nz * q[2] - d;
          if (s > EPS) above++;
          else if (s < -EPS) below++;
        }
        if (above > 0 && below > 0) continue;
        if (above === 0 && below === 0) return "a part's corners all lie in one plane";
        const flip = above > 0;
        const plane = flip ? [-nx, -ny, -nz, -d] : [nx, ny, nz, d];
        if (planes.some((q) => Math.abs(q[0]! - plane[0]!) < 1e-7 && Math.abs(q[1]! - plane[1]!) < 1e-7 && Math.abs(q[2]! - plane[2]!) < 1e-7 && Math.abs(q[3]! - plane[3]!) < 1e-7)) continue;
        planes.push(plane);
        faces.push(i, flip ? k : j, flip ? j : k);
      }
    }
  }
  if (faces.length / 3 > 2 * MAX_CORNERS - 4) return "a part has too many faces";
  const on = (plane: number[], q: number[]): boolean => Math.abs(plane[0]! * q[0]! + plane[1]! * q[1]! + plane[2]! * q[2]! - plane[3]!) < EPS;
  for (const q of p) if (!planes.some((plane) => on(plane, q))) return "a corner is inside the part, not on it";
  const edges: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (planes.filter((plane) => on(plane, p[i]!) && on(plane, p[j]!)).length >= 2) edges.push(i, j);
  }
  const rings = planes.map((plane, f) => {
    const tri = faces.slice(f * 3, f * 3 + 3);
    const at = p.flatMap((q, i) => (on(plane, q) ? [i] : []));
    const m = [0, 1, 2].map((a) => at.reduce((s, i) => s + p[i]![a]!, 0) / at.length);
    const first = p[tri[0]!]!;
    const u = [first[0]! - m[0]!, first[1]! - m[1]!, first[2]! - m[2]!];
    const w = [plane[1]! * u[2]! - plane[2]! * u[1]!, plane[2]! * u[0]! - plane[0]! * u[2]!, plane[0]! * u[1]! - plane[1]! * u[0]!];
    const along = (i: number): [number, number] => {
      const d = [p[i]![0]! - m[0]!, p[i]![1]! - m[1]!, p[i]![2]! - m[2]!];
      return [d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!, d[0]! * w[0]! + d[1]! * w[1]! + d[2]! * w[2]!];
    };
    const half = (a: number, b: number): number => (b > 1e-12 || (Math.abs(b) <= 1e-12 && a > 0) ? 0 : 1);
    return at.sort((i, j) => {
      if (i === tri[0]) return -1;
      if (j === tri[0]) return 1;
      const [ai, bi] = along(i);
      const [aj, bj] = along(j);
      const h = half(ai, bi) - half(aj, bj);
      return h !== 0 ? h : aj * bi - ai * bj;
    });
  });
  return { faces, edges, rings };
}

/** The table of every kind's collision parts, from referenceHull. */
function referenceTable(reg: Registry): HullTable {
  const shapes = new Map(reg.defs.flatMap((d) => (d?.type === "shape" ? [[d.id, d] as const] : [])));
  const cols = { corner: [] as number[], face: [] as number[], edge: [] as number[], sixty: [] as number[], at: [] as number[], faceCorners: [] as number[], edgeCorners: [] as number[], ring: [] as number[], ringCorners: [] as number[] };
  const start = new Uint32Array(reg.defs.length + 1);
  reg.defs.forEach((d, k) => {
    start[k] = cols.sixty.length;
    for (const h of d?.type === "structure" && d.shape !== undefined ? (shapes.get(d.shape)!.hulls ?? []) : []) {
      const made = referenceHull(h) as Hull;
      cols.corner.push(cols.at.length / 3);
      cols.face.push(cols.faceCorners.length / 3);
      cols.edge.push(cols.edgeCorners.length / 2);
      cols.sixty.push(h.sixty ? 1 : 0);
      for (const c of h.corners) cols.at.push(...c);
      cols.faceCorners.push(...made.faces);
      cols.edgeCorners.push(...made.edges);
      for (const r of made.rings) {
        cols.ring.push(cols.ringCorners.length);
        cols.ringCorners.push(...r);
      }
    }
  });
  start[reg.defs.length] = cols.sixty.length;
  cols.corner.push(cols.at.length / 3);
  cols.face.push(cols.faceCorners.length / 3);
  cols.edge.push(cols.edgeCorners.length / 2);
  cols.ring.push(cols.ringCorners.length);
  return {
    start,
    corner: Uint32Array.from(cols.corner),
    face: Uint32Array.from(cols.face),
    edge: Uint32Array.from(cols.edge),
    sixty: Uint8Array.from(cols.sixty),
    at: Float64Array.from(cols.at),
    faceCorners: Uint8Array.from(cols.faceCorners),
    edgeCorners: Uint8Array.from(cols.edgeCorners),
    ring: Uint32Array.from(cols.ring),
    ringCorners: Uint8Array.from(cols.ringCorners),
  };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/** The content's hash: each definition's canonical text in turn, in the order of their ids. */
const referenceHash = (reg: Registry): number => reg.defs.slice(1).reduce((h, d) => hashString(canonical(d), h), hashString("snark-content-1"));

/** Koru's definitions, then each of its shapes again under another name, and each structure again on its own shape and on the copy. */
function repeated(): Def[] {
  const shapes = KORU.defs.filter((d): d is ShapeDef => d.type === "shape");
  const structures = KORU.defs.filter((d): d is StructureDef => d.type === "structure");
  const again = (id: string): string => id.replace("koru:", "koru:again_");
  return [
    ...KORU.defs,
    // A field written as undefined is in the canonical text as the word.
    ...shapes.map((s, i): ShapeDef => ({ ...structuredClone(s), id: again(s.id), ...(i === 0 ? { doorway: undefined } : {}) })),
    ...structures.map((s): StructureDef => ({ ...s, id: s.id.replace("koru:", "koru:twice_") })),
    ...structures.map((s): StructureDef => ({ ...s, id: again(s.id), shape: again(s.shape!) })),
  ];
}

test("UTF-8 is read as the platform reads it, with characters of one to four bytes at either end and between", () => {
  const texts = ["", "a", "é", "€", "😀", "aé€😀", "😀€éa", `${"x".repeat(70000)}😀${"é".repeat(30000)}€`];
  for (const text of texts) {
    const bytes = new TextEncoder().encode(text);
    expect(decodeUtf8(bytes)).toBe(new TextDecoder().decode(bytes));
    expect(decodeUtf8(bytes)).toBe(text);
  }
  // A run of a larger buffer, as a file's sections are read.
  const file = new TextEncoder().encode("é😀middle€é");
  expect(decodeUtf8(file.subarray(6, 15))).toBe("middle€");
});

test("a part's hull is the one every three corners tried give, or is refused for the same reason", () => {
  const rng = new Rng(7);
  const parts: HullDef[] = KORU.defs.flatMap((d) => (d.type === "shape" ? [...(d.hulls ?? []), ...(d.look?.hulls ?? [])] : []));
  for (let t = 0; t < 4000; t++) {
    const n = 3 + rng.int(11);
    // Corners on a half-metre grid meet on shared planes and edges; some sets are flat, and some on 60 degree frames.
    const corners = Array.from({ length: n }, (): [number, number, number] => [0, 1, 2].map((a) => (t % 17 === 0 && a === 1 ? 0.5 : t % 3 === 0 ? rng.int(5) / 2 : rng.range(-2, 2))) as [number, number, number]);
    parts.push({ corners, ...(t % 5 === 0 ? { sixty: true } : {}) });
  }
  const cube: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  parts.push({ corners: [...cube, [0.5, 0.5, 1]] }, { corners: [...cube, [0.5, 0.5, 0.5]] }, { corners: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1e-12]] });
  const told = { solid: 0, refused: 0, differ: 0 };
  for (const h of parts) {
    const want = referenceHull(h);
    if (JSON.stringify(hullOf(h)) !== JSON.stringify(want) || hullFault(h) !== (typeof want === "string" ? want : "")) told.differ++;
    told[typeof want === "string" ? "refused" : "solid"]++;
  }
  expect(told.differ).toBe(0);
  expect(told.solid).toBeGreaterThan(1000);
  expect(told.refused).toBeGreaterThan(1000);
});

test("content with every shape repeated compiles to the hull table and hash the reference gives, and so does its tuned registry", () => {
  const reg = withContent(compileContent(CORE_CONTENT).registry!, repeated());
  const tuned = deriveRegistry(reg, { stack: 2 });
  expect(tuned.hash).not.toBe(reg.hash);
  for (const r of [reg, tuned]) {
    expect(r.hash).toBe(referenceHash(r));
    expect(r.parts.hulls).toEqual(referenceTable(r));
  }
});
