// The surface and skin entries of a level (laid out in shared/pack/pack.ts), written and read back, and what a source
// may leave to be worked out: its tangents, and how much surface a texture spans.

import { SKIN_BYTES, SURFACE_BYTES } from "../../shared/pack/pack.ts";
import type { SourceLod } from "./write.ts";

/** A direction in 10 bits a part, as INT_2_10_10_10_REV has it, with `top` in the two bits above. */
function pack10(x: number, y: number, z: number, top: number): number {
  const length = Math.hypot(x, y, z) || 1;
  const q = (c: number): number => Math.round((c / length) * 511) & 1023;
  return (q(x) | (q(y) << 10) | (q(z) << 20) | (top << 30)) >>> 0;
}

function unpack10(word: number, shift: number): number {
  return Math.max((((word >>> shift) & 1023) ^ 512) - 512, -511) / 511;
}


/** A mesh whose texture coordinates all lie on one texture. */
const UNIT: readonly number[] = [0, 0, 1, 1];

/**
 * What the texture coordinates of a mesh's levels span, as PackMesh.uv has it, or undefined when they lie on one
 * texture. Whole textures either side, so that two meshes cut from one wall store the same coordinate for a shared corner.
 */
export function uvRange(levels: readonly (Float32Array | undefined)[]): [number, number, number, number] | undefined {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const uvs of levels) {
    if (!uvs) continue;
    for (let i = 0; i < uvs.length; i++) {
      if (uvs[i]! < lo[i & 1]!) lo[i & 1] = uvs[i]!;
      if (uvs[i]! > hi[i & 1]!) hi[i & 1] = uvs[i]!;
    }
  }
  if (!(lo[0]! >= -1e-6 && lo[1]! >= -1e-6 && hi[0]! <= 1 + 1e-6 && hi[1]! <= 1 + 1e-6) && hi[0]! >= lo[0]!) {
    const from = [Math.floor(lo[0]! + 1e-6), Math.floor(lo[1]! + 1e-6)];
    return [from[0]!, from[1]!, Math.max(1, Math.ceil(hi[0]! - 1e-6) - from[0]!), Math.max(1, Math.ceil(hi[1]! - 1e-6) - from[1]!)];
  }
  return undefined;
}

/** Texture coordinates outside the picture are held at its edge. */
export function encodeSurface(uvs: Float32Array, normals: Float32Array, tangents: Float32Array, range: readonly number[] = UNIT): Uint8Array {
  const n = normals.length / 3;
  const out = new Uint8Array(n * SURFACE_BYTES);
  const view = new DataView(out.buffer);
  for (let v = 0; v < n; v++) {
    const at = v * SURFACE_BYTES;
    for (let k = 0; k < 2; k++) view.setUint16(at + k * 2, Math.round(Math.min(Math.max((uvs[v * 2 + k]! - range[k]!) / range[k + 2]!, 0), 1) * 65535), true);
    view.setUint32(at + 4, pack10(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!, 0), true);
    // The sign of the bitangent as two bits: 1 is 01 and -1 is 11.
    view.setUint32(at + 8, pack10(tangents[v * 4]!, tangents[v * 4 + 1]!, tangents[v * 4 + 2]!, tangents[v * 4 + 3]! < 0 ? 3 : 1), true);
  }
  return out;
}

export function decodeSurface(bytes: Uint8Array, range: readonly number[] = UNIT): { uvs: Float32Array; normals: Float32Array; tangents: Float32Array } {
  const n = bytes.length / SURFACE_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uvs = new Float32Array(n * 2);
  const normals = new Float32Array(n * 3);
  const tangents = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const at = v * SURFACE_BYTES;
    uvs[v * 2] = range[0]! + (view.getUint16(at, true) / 65535) * range[2]!;
    uvs[v * 2 + 1] = range[1]! + (view.getUint16(at + 2, true) / 65535) * range[3]!;
    const [normal, tangent] = [view.getUint32(at + 4, true), view.getUint32(at + 8, true)];
    for (let k = 0; k < 3; k++) {
      normals[v * 3 + k] = unpack10(normal, k * 10);
      tangents[v * 4 + k] = unpack10(tangent, k * 10);
    }
    tangents[v * 4 + 3] = tangent >>> 30 === 3 ? -1 : 1;
  }
  return { uvs, normals, tangents };
}

/**
 * The four heaviest of the bones a vertex is weighted to, heaviest first, with weights that sum to 1. A bone named
 * twice counts once, with both weights. `dropped` says whether a bone with weight was left out. A vertex with no
 * weight at all comes back with none.
 */
export function fourHeaviest(bones: ArrayLike<number>, weights: ArrayLike<number>): { bones: number[]; weights: number[]; dropped: boolean } {
  const sum = new Map<number, number>();
  for (let k = 0; k < bones.length; k++) if (weights[k]! > 0) sum.set(bones[k]!, (sum.get(bones[k]!) ?? 0) + weights[k]!);
  const all = [...sum].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const kept = all.slice(0, 4);
  const total = kept.reduce((t, [, w]) => t + w, 0);
  return { bones: kept.map(([b]) => b), weights: kept.map(([, w]) => w / total), dropped: all.length > 4 };
}

/**
 * A skin entry for each vertex from its four `joints` and their `weights`. The first bone written is `own[v]`, the
 * bone the vertex follows where it is drawn flat, which must be one of the four. The others follow, heaviest first.
 * The weights are shares of 255 that sum to exactly that, and a place with no share names bone 0.
 */
export function encodeSkin(joints: Uint8Array, weights: Float32Array, own: Uint8Array, id: string): Uint8Array {
  const n = own.length;
  const out = new Uint8Array(n * SKIN_BYTES);
  for (let v = 0; v < n; v++) {
    const four = fourHeaviest(joints.subarray(v * 4, v * 4 + 4), weights.subarray(v * 4, v * 4 + 4));
    if (four.bones.length === 0) four.weights.push(1);
    else if (!four.bones.includes(own[v]!)) throw new Error(`${id}: vertex ${v} follows bone ${own[v]}, which is not one of the bones it is weighted to`);
    const first = Math.max(four.bones.indexOf(own[v]!), 0);
    const order = [first, ...four.weights.keys()].filter((k, i) => i === 0 || k !== first);
    // Each share is rounded down, and the places that lost most by it get what is left over.
    const exact = order.map((k) => four.weights[k]! * 255);
    const share = exact.map(Math.floor);
    const short = [...order.keys()].sort((a, b) => exact[b]! - share[b]! - (exact[a]! - share[a]!) || a - b);
    for (let left = 255 - share.reduce((t, s) => t + s, 0), k = 0; left > 0; left--, k++) share[short[k % short.length]!]!++;
    out[v * SKIN_BYTES] = own[v]!;
    order.forEach((k, place) => {
      if (place > 0 && share[place]! > 0) out[v * SKIN_BYTES + place] = four.bones[k]!;
      out[v * SKIN_BYTES + 4 + place] = share[place]!;
    });
  }
  return out;
}

export function decodeSkin(bytes: Uint8Array): { joints: Uint8Array; weights: Float32Array } {
  const n = bytes.length / SKIN_BYTES;
  const joints = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = bytes[v * SKIN_BYTES + k]!;
      weights[v * 4 + k] = bytes[v * SKIN_BYTES + 4 + k]! / 255;
    }
  }
  return { joints, weights };
}

type Textured = Pick<SourceLod, "positions" | "indices"> & { uvs: Float32Array };

/** Calls `each` with every triangle's two edges from its first corner, in space and across the picture. */
function edges(lod: Textured, each: (t: number, e1: number[], e2: number[], du1: number, dv1: number, du2: number, dv2: number) => void): void {
  const { positions: p, uvs, indices } = lod;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const e1 = [p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!];
    const e2 = [p[c * 3]! - p[a * 3]!, p[c * 3 + 1]! - p[a * 3 + 1]!, p[c * 3 + 2]! - p[a * 3 + 2]!];
    each(t / 3, e1, e2, uvs[b * 2]! - uvs[a * 2]!, uvs[b * 2 + 1]! - uvs[a * 2 + 1]!, uvs[c * 2]! - uvs[a * 2]!, uvs[c * 2 + 1]! - uvs[a * 2 + 1]!);
  }
}

const cross = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

/**
 * A tangent for every vertex: x, y, z and the sign of the bitangent, as glTF has them. The tangent runs across the
 * surface the way u grows, square to the normal. The bitangent is the normal crossed with the tangent, times the sign,
 * and runs the way v falls, toward the picture's first row. Vertices that are one point with one normal and one
 * texture coordinate share a tangent, so a border between materials does not show in the lighting.
 */
export function tangentsOf(lod: Textured & { normals: Float32Array }): Float32Array {
  const { positions: p, normals, uvs, indices } = lod;
  const n = p.length / 3;
  const group = new Uint32Array(n);
  const ids = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]},${normals[v * 3]},${normals[v * 3 + 1]},${normals[v * 3 + 2]},${uvs[v * 2]},${uvs[v * 2 + 1]}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    group[v] = id;
  }
  // Per group: how the surface runs as u grows, and as v grows. Each triangle counts by its area.
  const alongU = new Float64Array(ids.size * 3);
  const alongV = new Float64Array(ids.size * 3);
  edges(lod, (t, e1, e2, du1, dv1, du2, dv2) => {
    const det = du1 * dv2 - du2 * dv1;
    const area = Math.hypot(...cross(e1, e2));
    if (det === 0 || area === 0) return;
    const u = e1.map((e, k) => (e * dv2 - e2[k]! * dv1) / det);
    const w = e2.map((e, k) => (e * du1 - e1[k]! * du2) / det);
    const [lu, lw] = [Math.hypot(...u) || 1, Math.hypot(...w) || 1];
    for (let c = 0; c < 3; c++) {
      const g = group[indices[t * 3 + c]!]! * 3;
      for (let k = 0; k < 3; k++) {
        alongU[g + k]! += (u[k]! / lu) * area;
        alongV[g + k]! += (w[k]! / lw) * area;
      }
    }
  });
  const out = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const g = group[v]! * 3;
    const normal = normals.subarray(v * 3, v * 3 + 3);
    const dot = normal[0]! * alongU[g]! + normal[1]! * alongU[g + 1]! + normal[2]! * alongU[g + 2]!;
    let tangent = [alongU[g]! - normal[0]! * dot, alongU[g + 1]! - normal[1]! * dot, alongU[g + 2]! - normal[2]! * dot];
    // With nothing to go by, any direction square to the normal will do.
    if (Math.hypot(...tangent) < 1e-9) tangent = cross(normal, Math.abs(normal[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const length = Math.hypot(...tangent) || 1;
    const bitangent = cross(normal, tangent);
    for (let k = 0; k < 3; k++) out[v * 4 + k] = tangent[k]! / length;
    out[v * 4 + 3] = bitangent[0]! * alongV[g]! + bitangent[1]! * alongV[g + 1]! + bitangent[2]! * alongV[g + 2]! > 0 ? -1 : 1;
  }
  return out;
}

/**
 * Metres of surface across one whole texture (PackMaterial.span), measured on the triangles of a level that are drawn
 * with `material`: the square root of their area over the area of the picture they cover. 1 where they cover none.
 */
export function spanOf(lod: SourceLod, material: number): number {
  let surface = 0;
  let picture = 0;
  edges({ ...lod, uvs: lod.uvs ?? new Float32Array((lod.positions.length / 3) * 2) }, (t, e1, e2, du1, dv1, du2, dv2) => {
    if ((lod.sections?.[t] ?? 0) !== material) return;
    surface += Math.hypot(...cross(e1, e2));
    picture += Math.abs(du1 * dv2 - du2 * dv1);
  });
  return picture > 0 ? Math.round(Math.sqrt(surface / picture) * 1e4) / 1e4 : 1;
}
