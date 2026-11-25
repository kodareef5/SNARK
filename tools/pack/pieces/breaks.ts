// A built piece's break as a pack mesh, `<piece>/break`: the chunks content/building/breaks.ts cuts its form into, each
// vertex on the bone of its group, drawn in the material that covers most of the piece. A chunk's face takes its
// texture coordinates and its flat colour from the piece's nearest face that lies in its plane, so a fragment leaves
// wearing the boards or stones it showed; a face cut through the piece is mapped square to its plane at the same scale.

import { TIER_FORMS } from "../../../content/building.ts";
import { pieceBreak } from "../../../content/building/breaks.ts";
import { FORMS } from "../../../content/building/forms.ts";
import { MATERIAL_CUTOUT, setTexture, textureOf, type PackMaterial, type PackTexture } from "../../../shared/pack/pack.ts";
import { TEXTURE_ROLES } from "../../../shared/pack/texture.ts";
import { hullOf } from "../../../shared/world/convex.ts";
import type { FormDef } from "../../../shared/world/lattice/forms.ts";
import { tangentsOf } from "../surface.ts";
import type { SourceLod, SourceMesh } from "../write.ts";

/** A face of a chunk takes a piece's triangle as its own where their normals are this near and their planes this far apart, in metres. */
const SAME_WAY = 0.95, IN_PLANE = 0.03;

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

/** One triangle of the piece in its main material: its corners, texture coordinates, unit normal, middle and colour. */
interface Facet {
  p: [V3, V3, V3];
  uv: [[number, number], [number, number], [number, number]];
  n: V3;
  mid: V3;
  colour: number;
}

/** The material of a piece's finest level that covers most of it, of those not cut out, by its index in the mesh's; or -1. */
export function mainMaterial(mesh: SourceMesh): number {
  const lod = mesh.lods[0]!, mats = mesh.materials ?? [];
  if (!lod.uvs || mats.length === 0) return -1;
  const area = new Float64Array(mats.length);
  for (let t = 0; t < lod.indices.length / 3; t++) {
    const k = lod.sections?.[t] ?? 0;
    const [a, b, c] = [0, 1, 2].map((j) => Array.from(lod.positions.subarray(lod.indices[t * 3 + j]! * 3, lod.indices[t * 3 + j]! * 3 + 3)));
    area[k]! += Math.hypot(...cross(sub(b!, a!), sub(c!, a!))) / 2;
  }
  let best = -1;
  mats.forEach((m, k) => {
    if ((m.flags & MATERIAL_CUTOUT) === 0 && area[k]! > 0 && (best < 0 || area[k]! > area[best]!)) best = k;
  });
  return best;
}

/** The piece's triangles in material `k`, and how many units of texture a metre of them spans. */
function facetsOf(lod: SourceLod, k: number): { facets: Facet[]; perMetre: number; colour: number } {
  const facets: Facet[] = [];
  let uvArea = 0, area = 0;
  const colours = new Map<number, number>();
  for (let t = 0; t < lod.indices.length / 3; t++) {
    if ((lod.sections?.[t] ?? 0) !== k) continue;
    const v = [0, 1, 2].map((j) => lod.indices[t * 3 + j]!);
    const p = v.map((i) => [lod.positions[i * 3]!, lod.positions[i * 3 + 1]!, lod.positions[i * 3 + 2]!] as V3) as [V3, V3, V3];
    const uv = v.map((i) => [lod.uvs![i * 2]!, lod.uvs![i * 2 + 1]!] as [number, number]) as Facet["uv"];
    const c = cross(sub(p[1], p[0]), sub(p[2], p[0])), len = Math.hypot(...c);
    if (len < 1e-9) continue;
    area += len / 2;
    uvArea += Math.abs((uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1])) / 2;
    const colour = lod.colors[v[0]!]!;
    colours.set(colour, (colours.get(colour) ?? 0) + len);
    facets.push({ p, uv, n: [c[0] / len, c[1] / len, c[2] / len], mid: [0, 1, 2].map((a) => (p[0][a]! + p[1][a]! + p[2][a]!) / 3) as V3, colour });
  }
  let colour = 0, most = -1;
  for (const [c, w] of colours) if (w > most) [colour, most] = [c, w];
  return { facets, perMetre: area > 0 ? Math.sqrt(uvArea / area) : 1, colour };
}

/** The texture coordinates at `q` by the plane map of a facet: its corners' coordinates carried along its two sides. */
function mapped(f: Facet, q: readonly number[]): [number, number] {
  const e1 = sub(f.p[1], f.p[0]), e2 = sub(f.p[2], f.p[0]), d = sub(q, f.p[0]);
  const a11 = dot(e1, e1), a12 = dot(e1, e2), a22 = dot(e2, e2), b1 = dot(d, e1), b2 = dot(d, e2), det = a11 * a22 - a12 * a12;
  const s = (b1 * a22 - b2 * a12) / det, t = (a11 * b2 - a12 * b1) / det;
  return [f.uv[0][0] + s * (f.uv[1][0] - f.uv[0][0]) + t * (f.uv[2][0] - f.uv[0][0]), f.uv[0][1] + s * (f.uv[1][1] - f.uv[0][1]) + t * (f.uv[2][1] - f.uv[0][1])];
}

/**
 * The break of piece `mesh`, of form `form` in `tier`, as a mesh of one level drawn with its main material, or null for a
 * piece drawn flat: a flat set is made on the client as cheaply from the same cut (client/core/fragments.ts).
 */
export function breakMesh(mesh: SourceMesh, form: FormDef, tier: string): SourceMesh | null {
  const k = mainMaterial(mesh);
  if (k < 0) return null;
  const { facets, perMetre, colour } = facetsOf(mesh.lods[0]!, k);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], bones: number[] = [], indices: number[] = [];
  pieceBreak(form, tier).forEach((group, g) => {
    for (const corners of group) {
      const hull = hullOf({ corners });
      if (typeof hull === "string") throw new Error(`${mesh.id}: a chunk is no solid: ${hull}`);
      for (const ring of hull.rings) {
        const pts = ring.map((c) => corners[c]!);
        // Newell's sum: the ring goes round counter-clockwise seen from outside.
        let n: V3 = [0, 0, 0];
        pts.forEach((p, i) => {
          const q = pts[(i + 1) % pts.length]!;
          n = [n[0] + (p[1] - q[1]) * (p[2] + q[2]), n[1] + (p[2] - q[2]) * (p[0] + q[0]), n[2] + (p[0] - q[0]) * (p[1] + q[1])];
        });
        const len = Math.hypot(...n);
        n = [n[0] / len, n[1] / len, n[2] / len];
        const mid = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a]!, 0) / pts.length);
        let best: Facet | null = null, nearest = Infinity;
        for (const f of facets) {
          if (dot(f.n, n) < SAME_WAY || Math.abs(dot(sub(mid, f.p[0]), f.n)) > IN_PLANE) continue;
          const d = Math.hypot(...sub(f.mid, mid));
          if (d < nearest) [best, nearest] = [f, d];
        }
        // Cut through the piece: square to the plane's widest axes, v down the picture as the pack has it.
        const drop = [0, 1, 2].reduce((m, a) => (Math.abs(n[a]!) > Math.abs(n[m]!) ? a : m), 0), [s, t] = drop === 1 ? [0, 2] : [drop === 0 ? 2 : 0, 1];
        const first = positions.length / 3;
        for (const p of pts) {
          positions.push(p[0], p[1], p[2]);
          normals.push(n[0], n[1], n[2]);
          const uv = best ? mapped(best, p) : [p[s]! * perMetre, -p[t]! * perMetre];
          uvs.push(uv[0]!, uv[1]!);
          colors.push(best ? best.colour : colour);
          bones.push(g);
        }
        for (let j = 2; j < pts.length; j++) indices.push(first, first + j - 1, first + j);
      }
    }
  });
  const lod: SourceLod = { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), bones: Uint8Array.from(bones), uvs: Float32Array.from(uvs), normals: Float32Array.from(normals) };
  lod.tangents = tangentsOf({ positions: lod.positions, indices: lod.indices, uvs: lod.uvs!, normals: lod.normals! });
  // Its one material, naming only its own textures.
  const from = mesh.materials![k]!, textures: PackTexture[] = [], material: PackMaterial = { ...from, tint: [...from.tint] };
  for (const role of TEXTURE_ROLES) {
    const at = textureOf(from, role);
    if (at < 0) continue;
    setTexture(material, role, textures.length);
    textures.push(mesh.textures![at]!);
  }
  return { id: `${mesh.id}/break`, flat: 1, materials: [material], textures, lods: [lod] };
}

/** `meshes` with the break of each piece `tier` places after them, where its pack draws the piece with materials. */
export function withBreaks(tier: string, meshes: SourceMesh[]): SourceMesh[] {
  const out = [...meshes], forms: Readonly<Record<string, FormDef>> = FORMS;
  for (const name of TIER_FORMS[tier] ?? []) {
    const mesh = meshes.find((m) => m.id === `core:${name}_${tier}`);
    const made = mesh ? breakMesh(mesh, forms[name]!, tier) : null;
    if (made) out.push(made);
  }
  return out;
}
