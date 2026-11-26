// A fitted MakeHuman body (fit.ts) as the human cook takes it (tools/pack/body.ts ScriptedBody): three materials, the
// teeth and tongue cut hard, the backs of the eyes dropped, and every part's texture coordinates moved onto its sheet.

import { B_HEAD } from "../../shared/anim/human.ts";
import type { ScriptedBody } from "../pack/body.ts";
import { simplifySurface } from "../pack/simplify.ts";
import type { SourceLod } from "../pack/write.ts";
import { join } from "node:path";
import { readPicture } from "../pack/image.ts";
import { PART_NAMES, type FittedBody } from "./fit.ts";
import { MAKEHUMAN } from "./index.ts";

/** The eyes' picture, under the mirror. Its clear texels are the corneas, which the cook leaves out. */
export const EYE_PICTURE = "system-assets/eyes/materials/brown_eye.png";

/** The cook's materials, in order: the skin, the eyes with the mouth, and the brows with the lashes. */
export const SECTION_SKIN = 0;
export const SECTION_EYES = 1;
export const SECTION_BROWS = 2;

/** Where a part's own picture sits on its material's sheet: left, top, width and height, as shares of the sheet. */
export type Place = readonly [u: number, v: number, w: number, h: number];

/** The eyes' sheet: both eyes' picture large, the teeth and the tongue small beside it, each a little in from its neighbours. */
export const EYES_SHEET: Readonly<Record<"eyes" | "teeth" | "tongue", Place>> = {
  eyes: [0.01, 0.01, 0.73, 0.73],
  teeth: [0.76, 0.01, 0.23, 0.23],
  tongue: [0.76, 0.26, 0.23, 0.23],
};
/** The brows' sheet: the brows' picture above, the lashes' below, each squashed to half its height. */
export const BROWS_SHEET: Readonly<Record<"brows" | "lashes", Place>> = {
  brows: [0.005, 0.005, 0.99, 0.49],
  lashes: [0.005, 0.505, 0.99, 0.49],
};

const PART_SECTION: Readonly<Record<(typeof PART_NAMES)[number], number>> = { body: SECTION_SKIN, eyes: SECTION_EYES, teeth: SECTION_EYES, tongue: SECTION_EYES, brows: SECTION_BROWS, lashes: SECTION_BROWS };
const PART_PLACE: Readonly<Record<(typeof PART_NAMES)[number], Place>> = { body: [0, 0, 1, 1], ...EYES_SHEET, ...BROWS_SHEET };

export interface CookPlan {
  /** The most triangles the teeth and the tongue keep. */
  teeth: number;
  tongue: number;
  /** An eye's triangles whose middle lies further back from the eye's centre than this share of its radius are never seen. */
  eyeBack: number;
}

export const COOK_PLAN: CookPlan = { teeth: 240, tongue: 64, eyeBack: 0.2 };

/** What the cook makes of `f`, and how many triangles each part kept. */
export function scriptedBody(f: FittedBody, plan: CookPlan = COOK_PLAN): { body: ScriptedBody; kept: Record<string, number> } {
  const tris = f.indices.length / 3;
  const keep = new Uint8Array(tris).fill(1);
  const eyes = PART_NAMES.indexOf("eyes");
  // The corneas are a clear shell over each eye: drawn opaque they would hide it.
  const eye = readPicture(join(MAKEHUMAN, EYE_PICTURE));
  const alphaAt = (u: number, v: number): number => {
    const x = Math.min(eye.width - 1, Math.max(0, Math.floor(u * eye.width))), y = Math.min(eye.height - 1, Math.max(0, Math.floor((1 - v) * eye.height)));
    return eye.channels === 4 ? eye.data[(y * eye.width + x) * 4 + 3]! / (eye.depth === 8 ? 255 : 65535) : 1;
  };
  for (let t = 0; t < tris; t++) {
    if (f.part[t] !== eyes) continue;
    let u = 0, v = 0;
    for (let k = 0; k < 3; k++) {
      u += f.uvs[f.indices[t * 3 + k]! * 2]! / 3;
      v += f.uvs[f.indices[t * 3 + k]! * 2 + 1]! / 3;
    }
    if (alphaAt(u, v) < 0.5) keep[t] = 0;
  }
  // Each eye's centre and radius, by side, from its own vertices.
  for (const side of [1, -1]) {
    const verts = new Set<number>();
    for (let t = 0; t < tris; t++) if (f.part[t] === eyes) for (let k = 0; k < 3; k++) {
      const v = f.indices[t * 3 + k]!;
      if (Math.sign(f.positions[v * 3]!) === side) verts.add(v);
    }
    if (verts.size === 0) continue;
    const c = [0, 0, 0];
    for (const v of verts) for (let a = 0; a < 3; a++) c[a]! += f.positions[v * 3 + a]! / verts.size;
    let r = 0;
    for (const v of verts) r = Math.max(r, Math.hypot(f.positions[v * 3]! - c[0]!, f.positions[v * 3 + 1]! - c[1]!, f.positions[v * 3 + 2]! - c[2]!));
    for (let t = 0; t < tris; t++) {
      if (f.part[t] !== eyes) continue;
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        x += f.positions[f.indices[t * 3 + k]! * 3]! / 3;
        z += f.positions[f.indices[t * 3 + k]! * 3 + 2]! / 3;
      }
      if (Math.sign(x) === side && (z - c[2]!) / r < -plan.eyeBack) keep[t] = 0;
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  const sections: number[] = [];
  const kept: Record<string, number> = {};
  PART_NAMES.forEach((name, part) => {
    const [pu, pv, pw, ph] = PART_PLACE[name];
    let lod = partLod(f, part, keep);
    if (!lod) return;
    const most = name === "teeth" ? plan.teeth : name === "tongue" ? plan.tongue : Infinity;
    if (lod.indices.length / 3 > most) lod = simplifySurface(lod, [most])[0]!.lod;
    const base = positions.length / 3;
    const n = lod.positions.length / 3;
    for (let v = 0; v < n; v++) {
      for (let a = 0; a < 3; a++) {
        positions.push(lod.positions[v * 3 + a]!);
        normals.push(lod.normals![v * 3 + a]!);
      }
      // MakeHuman's v rises up the picture; the pack's falls from its first row.
      uvs.push(pu + lod.uvs![v * 2]! * pw, pv + (1 - lod.uvs![v * 2 + 1]!) * ph);
      for (let k = 0; k < 4; k++) {
        joints.push(lod.joints![v * 4 + k]!);
        weights.push(lod.weights![v * 4 + k]!);
      }
    }
    for (const i of lod.indices) indices.push(base + i);
    for (let t = 0; t < lod.indices.length / 3; t++) sections.push(PART_SECTION[name]);
    kept[name] = lod.indices.length / 3;
  });
  return {
    body: {
      positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices),
      joints: Uint8Array.from(joints), weights: Float32Array.from(weights), sections: Uint8Array.from(sections),
    },
    kept,
  };
}

/** One part's kept triangles on vertices of their own, with its own texture coordinates. */
function partLod(f: FittedBody, part: number, keep: Uint8Array): SourceLod | null {
  const map = new Map<number, number>();
  const order: number[] = [];
  const indices: number[] = [];
  for (let t = 0; t < f.indices.length / 3; t++) {
    if (f.part[t] !== part || !keep[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = f.indices[t * 3 + k]!;
      let i = map.get(v);
      if (i === undefined) map.set(v, (i = order.push(v) - 1));
      indices.push(i);
    }
  }
  if (indices.length === 0) return null;
  const pick = <T extends Float32Array | Uint8Array>(all: T, size: number, make: (n: number) => T): T => {
    const out = make(order.length * size);
    order.forEach((v, i) => out.set(all.subarray(v * size, v * size + size), i * size));
    return out;
  };
  const bones = pick(f.bone, 1, (n) => new Uint8Array(n));
  // The bound parts all follow the head; simplifying keeps one bone a point.
  if (part !== 0 && bones.some((b) => b !== B_HEAD)) throw new Error(`MakeHuman's ${PART_NAMES[part]} do not all follow the head`);
  return {
    positions: pick(f.positions, 3, (n) => new Float32Array(n)), colors: new Uint8Array(order.length), indices: Uint32Array.from(indices), bones,
    uvs: pick(f.uvs, 2, (n) => new Float32Array(n)), normals: pick(f.normals, 3, (n) => new Float32Array(n)),
    joints: pick(f.joints, 4, (n) => new Uint8Array(n)), weights: pick(f.weights, 4, (n) => new Float32Array(n)),
  };
}

/** How far apart a cooked vertex and its fitted one may be: the pack's grid moves a point by a hundredth of a millimetre or so. */
const SAME_POINT = 5e-5;

/**
 * For each vertex of a cooked level (its positions at rest, three a vertex, as built or as read back from the pack), the
 * fitted body's vertex at the same point, or -1 where none is: a vertex the cook made by collapsing others. Faces are
 * cooked on the fitted body's vertices (shared/people/faces.ts remapFaces takes this). Of several fitted vertices at one
 * point, split by texture seams, the first.
 */
export function fittedSourceOf(positions: ArrayLike<number>, f: FittedBody): Int32Array {
  const cell = (x: number): number => Math.floor(x / (SAME_POINT * 2));
  const grid = new Map<string, number[]>();
  for (let v = 0; v < f.positions.length / 3; v++) {
    const k = `${cell(f.positions[v * 3]!)},${cell(f.positions[v * 3 + 1]!)},${cell(f.positions[v * 3 + 2]!)}`;
    const list = grid.get(k);
    if (list) list.push(v);
    else grid.set(k, [v]);
  }
  return Int32Array.from({ length: positions.length / 3 }, (_, v) => {
    const [x, y, z] = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    let best = -1, near = SAME_POINT;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const u of grid.get(`${cell(x) + dx},${cell(y) + dy},${cell(z) + dz}`) ?? []) {
        const d = Math.hypot(f.positions[u * 3]! - x, f.positions[u * 3 + 1]! - y, f.positions[u * 3 + 2]! - z);
        if (d < near || (d === near && u < best)) [best, near] = [u, d];
      }
    }
    return best;
  });
}
