// Imports a .glb as one pack mesh. Nodes ending in _LOD<n> are lower levels of detail, and a node named COL, COL_* or
// UCX_* is the undrawn collision box. Materials named region0 to region5 are colour regions. Others match the nearest palette colour.
//
// A level whose every primitive has texture coordinates and normals is drawn with materials: each primitive is a
// section drawn with its material, and its tangents are kept where every primitive has them. Where the caller names
// a skeleton, a vertex keeps the four bones that weigh most on it. What had to be dropped or put right is reported.

import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, decodeUtf8, type PackMaterial } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { multiply4, nodeParents, readAccessor, restMatrices, type Gltf, type GltfJson } from "./gltf.ts";
import { withLevels } from "./simplify.ts";
import { fourHeaviest, spanOf } from "./surface.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

type Material = NonNullable<GltfJson["materials"]>[number] & { doubleSided?: boolean; alphaMode?: string; alphaCutoff?: number };

export interface ImportOptions {
  /** The skeleton the mesh follows, and the rig it was made on. Bone weights are read only where a skeleton is named. */
  skeleton?: string;
  rig?: string;
  /**
   * The rig's bones, by name. A joint of the model is the bone of its name, or of the nearest joint above it that has
   * one. Where this is not given, a joint's bone is its place in the model's own skin.
   */
  bones?: readonly string[];
  /**
   * The palette colour or region a material is drawn flat in, by its name, where whoever has its pictures knows
   * better than its one colour in the model. Undefined for a material to be matched by that colour.
   */
  flat?: (material: string) => number | undefined;
}

export interface ImportReport {
  mesh: SourceMesh;
  /** Largest distance (0..441) between an authored colour and the palette entry used for it. */
  worstColorError: number;
  warnings: string[];
}

/** One level as it is gathered. `surface` holds while every primitive has had texture coordinates and normals. */
interface Level {
  positions: number[];
  colors: number[];
  indices: number[];
  bones: number[];
  uvs: number[];
  normals: number[];
  tangents: number[];
  joints: number[];
  weights: number[];
  sections: number[];
  surface: boolean;
}

const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

export function importGlb(file: Uint8Array, id: string, palette: Uint8Array, opts: ImportOptions = {}): ImportReport {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error(`${id}: not a .glb file`);
  if (view.getUint32(4, true) !== 2) throw new Error(`${id}: only glTF 2 is supported`);
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= file.length; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(decodeUtf8(data)) as GltfJson;
    else if (type === 0x004e4942) bin = data;
    at += 8 + length;
  }
  if (!json) throw new Error(`${id}: no JSON chunk`);
  if (!bin) throw new Error(`${id}: sparse or external accessors are not supported`);
  const g: Gltf = { path: id, json, buffers: [bin] };
  const nodes = json.nodes ?? [];
  const world = restMatrices(g);
  const parent = nodeParents(g);
  const read = (index: number): Float64Array => readAccessor(g, index).data;
  const warnings: string[] = [];
  let worstColorError = 0;

  const colorOf = (material: number | undefined): number => {
    const m = material === undefined ? undefined : json.materials?.[material];
    const region = /^region([0-5])$/i.exec(m?.name ?? "");
    if (region) return REGION_BASE + Number(region[1]);
    const given = opts.flat?.(m?.name ?? "");
    if (given !== undefined) return given;
    const base = m?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
    // Base colour is linear and the palette is sRGB.
    const srgb = base.slice(0, 3).map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
    let best = 0;
    let bestD = Infinity;
    for (let i = 1; i < REGION_BASE; i++) {
      const d = Math.hypot(palette[i * 4]! - srgb[0]!, palette[i * 4 + 1]! - srgb[1]!, palette[i * 4 + 2]! - srgb[2]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > worstColorError) worstColorError = bestD;
    if (bestD > 24) warnings.push(`material "${m?.name ?? "?"}" is far from any palette colour (distance ${bestD.toFixed(0)})`);
    return best;
  };

  /** The mesh's materials, and which of them each of the model's is. The textures are for whoever has the pictures to name. */
  const materials: PackMaterial[] = [];
  const places = new Map<number, number>();
  const sectionOf = (material: number | undefined): number => {
    let place = places.get(material ?? -1);
    if (place !== undefined) return place;
    const m: Material | undefined = material === undefined ? undefined : json.materials?.[material];
    const cutout = m?.alphaMode === "MASK";
    if (m?.alphaMode === "BLEND") warnings.push(`material "${m.name ?? "?"}" blends, which is not drawn: read as solid`);
    const tint = (m?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1]).slice(0, 3) as [number, number, number];
    place = materials.push({ id: `${id}/${m?.name ?? "plain"}`, base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint, grey: 1, emissive: 0, flags: (m?.doubleSided ? MATERIAL_TWO_SIDED : 0) | (cutout ? MATERIAL_CUTOUT : 0), cutoff: cutout ? (m.alphaCutoff ?? 0.5) : 0, span: 1 }) - 1;
    places.set(material ?? -1, place);
    return place;
  };

  /** Per skin of the model: each joint's bone, and the matrix that carries a vertex bound to that joint to where it rests. */
  const skins = new Map<number, { bone: number[]; bind: Float64Array[] }>();
  const skinOf = (index: number): { bone: number[]; bind: Float64Array[] } => {
    let skin = skins.get(index);
    if (skin) return skin;
    const s = json.skins![index]!;
    const inverse = s.inverseBindMatrices === undefined ? null : read(s.inverseBindMatrices);
    const bone = s.joints.map((joint, k) => {
      if (!opts.bones) return k;
      for (let at = joint; at >= 0; at = parent[at]!) {
        const b = opts.bones.indexOf(nodes[at]!.name ?? "");
        if (b >= 0) return b;
      }
      return 0;
    });
    if (bone.some((b) => b > 255)) throw new Error(`${id}: more bones than a vertex can name`);
    skin = { bone, bind: s.joints.map((joint, k) => (inverse ? multiply4(world[joint]!, inverse.subarray(k * 16, k * 16 + 16)) : world[joint]!)) };
    skins.set(index, skin);
    return skin;
  };

  const lods = new Map<number, Level>();
  let collider: [number, number, number] | undefined;
  const count = { dropped: 0, unweighted: 0 };
  if (!opts.skeleton && json.skins?.length) warnings.push("it has a skin, which is not read without a skeleton to follow");

  const visit = (nodeIndex: number): void => {
    const node = nodes[nodeIndex]!;
    const name = node.name ?? "";
    const own = world[nodeIndex]!;
    const primitives = (node.mesh === undefined ? [] : json.meshes![node.mesh]!.primitives).filter((prim) => {
      if ((prim.mode ?? 4) === 4) return true;
      warnings.push(`node "${name}": non-triangle primitive skipped`);
      return false;
    });
    if (node.mesh !== undefined && /^(COL|UCX)(_|$)/i.test(name)) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const prim of primitives) {
        const pos = read(prim.attributes.POSITION!);
        for (let v = 0; v < pos.length; v += 3) {
          for (let k = 0; k < 3; k++) {
            const c = own[k]! * pos[v]! + own[4 + k]! * pos[v + 1]! + own[8 + k]! * pos[v + 2]! + own[12 + k]!;
            if (c < min[k]!) min[k] = c;
            if (c > max[k]!) max[k] = c;
          }
        }
      }
      collider = [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2];
    } else if (node.mesh !== undefined) {
      const level = Number(/_LOD(\d)$/i.exec(name)?.[1] ?? 0);
      const lod = lods.get(level) ?? { positions: [], colors: [], indices: [], bones: [], uvs: [], normals: [], tangents: [], joints: [], weights: [], sections: [], surface: true };
      if (primitives.length > 0) lods.set(level, lod);
      const skin = opts.skeleton && node.skin !== undefined ? skinOf(node.skin) : null;
      if (opts.skeleton && !skin) warnings.push(`node "${name}" has no skin: it follows the first bone`);
      for (const prim of primitives) {
        const a = prim.attributes;
        const pos = read(a.POSITION!);
        const verts = pos.length / 3;
        const idx = prim.indices === undefined ? Float64Array.from({ length: verts }, (_, i) => i) : read(prim.indices);
        const base = lod.positions.length / 3;
        const color = colorOf(prim.material);
        const uv = a.TEXCOORD_0 === undefined ? null : read(a.TEXCOORD_0);
        const normal = a.NORMAL === undefined ? null : read(a.NORMAL);
        const tangent = a.TANGENT === undefined ? null : read(a.TANGENT);
        if (!uv || !normal) lod.surface = false;
        // Every set of joints and weights the primitive has: a vertex may be weighted to more than four.
        const joints: Float64Array[] = [];
        const weights: Float64Array[] = [];
        for (let s = 0; skin && a[`JOINTS_${s}`] !== undefined && a[`WEIGHTS_${s}`] !== undefined; s++) {
          joints.push(read(a[`JOINTS_${s}`]!));
          weights.push(read(a[`WEIGHTS_${s}`]!));
        }
        let m = own;
        for (let v = 0; v < verts; v++) {
          if (skin) {
            const on = joints.flatMap((set) => [...set.subarray(v * 4, v * 4 + 4)]);
            const by = weights.flatMap((set) => [...set.subarray(v * 4, v * 4 + 4)].map((w) => Math.max(w, 0)));
            const total = by.reduce((t, w) => t + w, 0);
            // A skinned vertex rests where its joints put it, whatever its own node says.
            m = total > 0 ? new Float64Array(16) : skin.bind[0]!;
            for (let k = 0; k < on.length && total > 0; k++) for (let i = 0; i < 16; i++) m[i]! += (skin.bind[on[k]!]![i]! * by[k]!) / total;
            const four = fourHeaviest(on.map((joint) => skin.bone[joint]!), by);
            if (four.dropped) count.dropped++;
            if (four.bones.length === 0) count.unweighted++;
            lod.bones.push(four.bones[0] ?? 0);
            for (let k = 0; k < 4; k++) lod.joints.push(four.bones[k] ?? 0);
            for (let k = 0; k < 4; k++) lod.weights.push(four.weights[k] ?? (k === 0 && total === 0 ? 1 : 0));
          } else if (opts.skeleton) {
            lod.bones.push(0);
            lod.joints.push(0, 0, 0, 0);
            lod.weights.push(1, 0, 0, 0);
          }
          const x = pos[v * 3]!;
          const y = pos[v * 3 + 1]!;
          const z = pos[v * 3 + 2]!;
          lod.positions.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
          lod.colors.push(color);
          if (!uv || !normal) continue;
          for (let k = 0; k < 2; k++) {
            const c = uv[v * 2 + k]!;
            lod.uvs.push(c);
          }
          // A normal goes through the inverse of the matrix, transposed, which its columns crossed in pairs give.
          const columns = [[m[0]!, m[1]!, m[2]!], [m[4]!, m[5]!, m[6]!], [m[8]!, m[9]!, m[10]!]];
          const through = [cross(columns[1]!, columns[2]!), cross(columns[2]!, columns[0]!), cross(columns[0]!, columns[1]!)];
          const mirrored = determinant3(m) < 0;
          const n = [0, 1, 2].map((k) => (normal[v * 3]! * through[0]![k]! + normal[v * 3 + 1]! * through[1]![k]! + normal[v * 3 + 2]! * through[2]![k]!) * (mirrored ? -1 : 1));
          const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
          lod.normals.push(n[0]! / length, n[1]! / length, n[2]! / length);
          if (!tangent) continue;
          const t = [0, 1, 2].map((k) => tangent[v * 4]! * columns[0]![k]! + tangent[v * 4 + 1]! * columns[1]![k]! + tangent[v * 4 + 2]! * columns[2]![k]!);
          const tl = Math.hypot(t[0]!, t[1]!, t[2]!) || 1;
          // A mirrored surface has its bitangent on the other side.
          lod.tangents.push(t[0]! / tl, t[1]! / tl, t[2]! / tl, (tangent[v * 4 + 3]! < 0) !== mirrored ? -1 : 1);
        }
        const section = uv && normal ? sectionOf(prim.material) : -1;
        const flip = determinant3(m) < 0;
        for (let t = 0; t + 2 < idx.length; t += 3) {
          // A mirrored transform reverses winding, so restore it.
          if (flip) lod.indices.push(base + idx[t]!, base + idx[t + 2]!, base + idx[t + 1]!);
          else lod.indices.push(base + idx[t]!, base + idx[t + 1]!, base + idx[t + 2]!);
          if (section >= 0) lod.sections.push(section);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(root);
  if (count.dropped > 0) warnings.push(`${count.dropped} vertices were weighted to more than four bones: the lightest were dropped`);
  if (count.unweighted > 0) warnings.push(`${count.unweighted} vertices had no weights: they follow the first bone`);

  const levels = [...lods.keys()].sort((a, b) => a - b);
  if (levels.length === 0 || levels[0] !== 0) throw new Error(`${id}: no level 0 geometry`);
  levels.forEach((level, i) => {
    if (level !== i) throw new Error(`${id}: levels of detail must be consecutive; found ${levels.join(", ")}`);
  });
  const out: SourceLod[] = levels.map((level) => {
    const l = lods.get(level)!;
    const lod: SourceLod = { positions: Float32Array.from(l.positions), colors: Uint8Array.from(l.colors), indices: Uint32Array.from(l.indices) };
    if (opts.skeleton) lod.bones = Uint8Array.from(l.bones);
    if (!l.surface) {
      if (l.sections.length > 0) warnings.push(`level ${level}: only some of it has texture coordinates and normals, so it is drawn flat`);
      return lod;
    }
    lod.uvs = Float32Array.from(l.uvs);
    lod.normals = Float32Array.from(l.normals);
    lod.sections = Uint8Array.from(l.sections);
    if (l.tangents.length === l.colors.length * 4) lod.tangents = Float32Array.from(l.tangents);
    else if (l.tangents.length > 0) warnings.push(`level ${level}: only some of it has tangents, so all of them are worked out`);
    if (opts.skeleton) {
      lod.joints = Uint8Array.from(l.joints);
      lod.weights = Float32Array.from(l.weights);
    }
    return lod;
  });
  const mesh: SourceMesh = { id, lods: out };
  if (collider) mesh.collider = collider;
  if (opts.skeleton) mesh.skeleton = opts.skeleton;
  if (opts.rig) mesh.rig = opts.rig;
  // The levels drawn with materials are the finest ones. A level with a surface below one without is drawn flat too.
  const flat = out.findIndex((lod) => !lod.uvs);
  if (flat !== 0) {
    mesh.flat = flat < 0 ? out.length : flat;
    materials.forEach((m, k) => (m.span = spanOf(out[0]!, k)));
    mesh.materials = materials;
  }
  // An export with no levels of its own gets ours.
  return { mesh: withLevels(mesh), worstColorError, warnings };
}

function determinant3(m: Float64Array): number {
  return m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
}
