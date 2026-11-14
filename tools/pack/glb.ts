// Imports a .glb as one pack mesh. Nodes ending in _LOD<n> are lower levels of detail, and a node named COL, COL_* or
// UCX_* is the undrawn collision box. Materials named region0 to region5 are colour regions. Others match the nearest palette colour.

import { decodeUtf8 } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { SourceLod, SourceMesh } from "./write.ts";
import { withLevels } from "./simplify.ts";

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}

export interface ImportReport {
  mesh: SourceMesh;
  /** Largest distance (0..441) between an authored colour and the palette entry used for it. */
  worstColorError: number;
  warnings: string[];
}

export function importGlb(file: Uint8Array, id: string, palette: Uint8Array): ImportReport {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error(`${id}: not a .glb file`);
  if (view.getUint32(4, true) !== 2) throw new Error(`${id}: only glTF 2 is supported`);
  let gltf: Gltf | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= file.length; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) gltf = JSON.parse(decodeUtf8(data)) as Gltf;
    else if (type === 0x004e4942) bin = data;
    at += 8 + length;
  }
  if (!gltf) throw new Error(`${id}: no JSON chunk`);
  const g = gltf;
  const warnings: string[] = [];
  let worstColorError = 0;

  const accessor = (index: number, components: number): Float64Array => {
    const a = g.accessors![index]!;
    if (a.sparse || a.bufferView === undefined || !bin) throw new Error(`${id}: sparse or external accessors are not supported`);
    const bv = g.bufferViews![a.bufferView]!;
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[a.componentType];
    if (!size) throw new Error(`${id}: unsupported component type ${a.componentType}`);
    const stride = bv.byteStride ?? size * components;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    const out = new Float64Array(a.count * components);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < components; c++) {
        const at = i * stride + c * size;
        out[i * components + c] =
          a.componentType === 5126 ? dv.getFloat32(at, true)
          : a.componentType === 5125 ? dv.getUint32(at, true)
          : a.componentType === 5123 ? dv.getUint16(at, true)
          : a.componentType === 5122 ? dv.getInt16(at, true)
          : a.componentType === 5121 ? dv.getUint8(at)
          : dv.getInt8(at);
      }
    }
    return out;
  };

  const colorOf = (material: number | undefined): number => {
    const m = material === undefined ? undefined : g.materials?.[material];
    const region = /^region([0-5])$/i.exec(m?.name ?? "");
    if (region) return REGION_BASE + Number(region[1]);
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

  const lods = new Map<number, { positions: number[]; colors: number[]; indices: number[] }>();
  let collider: [number, number, number] | undefined;

  const visit = (nodeIndex: number, parent: Float64Array): void => {
    const node = g.nodes![nodeIndex]!;
    const world = multiply(parent, localMatrix(node));
    const name = node.name ?? "";
    if (node.mesh !== undefined) {
      const isCollider = /^(COL|UCX)(_|$)/i.test(name);
      const level = Number(/_LOD(\d)$/i.exec(name)?.[1] ?? 0);
      const flip = determinant3(world) < 0;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const prim of g.meshes![node.mesh]!.primitives) {
        if ((prim.mode ?? 4) !== 4) {
          warnings.push(`node "${name}": non-triangle primitive skipped`);
          continue;
        }
        const pos = accessor(prim.attributes.POSITION!, 3);
        const count = pos.length / 3;
        const idx = prim.indices === undefined ? Float64Array.from({ length: count }, (_, i) => i) : accessor(prim.indices, 1);
        const lod = lods.get(level) ?? { positions: [], colors: [], indices: [] };
        if (!isCollider) lods.set(level, lod);
        const base = lod.positions.length / 3;
        const color = isCollider ? 0 : colorOf(prim.material);
        for (let v = 0; v < count; v++) {
          const x = pos[v * 3]!;
          const y = pos[v * 3 + 1]!;
          const z = pos[v * 3 + 2]!;
          const p = [world[0]! * x + world[4]! * y + world[8]! * z + world[12]!, world[1]! * x + world[5]! * y + world[9]! * z + world[13]!, world[2]! * x + world[6]! * y + world[10]! * z + world[14]!];
          for (let a = 0; a < 3; a++) {
            if (p[a]! < min[a]!) min[a] = p[a]!;
            if (p[a]! > max[a]!) max[a] = p[a]!;
          }
          if (!isCollider) {
            lod.positions.push(p[0]!, p[1]!, p[2]!);
            lod.colors.push(color);
          }
        }
        if (!isCollider) {
          for (let t = 0; t + 2 < idx.length; t += 3) {
            // A mirrored transform reverses winding, so restore it.
            if (flip) lod.indices.push(base + idx[t]!, base + idx[t + 2]!, base + idx[t + 1]!);
            else lod.indices.push(base + idx[t]!, base + idx[t + 1]!, base + idx[t + 2]!);
          }
        }
      }
      if (isCollider) collider = [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2];
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const identity = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const root of g.scenes?.[g.scene ?? 0]?.nodes ?? []) visit(root, identity);

  const levels = [...lods.keys()].sort((a, b) => a - b);
  if (levels.length === 0 || levels[0] !== 0) throw new Error(`${id}: no level 0 geometry`);
  levels.forEach((level, i) => {
    if (level !== i) throw new Error(`${id}: levels of detail must be consecutive; found ${levels.join(", ")}`);
  });
  const out: SourceLod[] = levels.map((level) => {
    const l = lods.get(level)!;
    return { positions: Float32Array.from(l.positions), colors: Uint8Array.from(l.colors), indices: Uint32Array.from(l.indices) };
  });
  // An export with no levels of its own gets ours.
  const mesh: SourceMesh = withLevels({ id, lods: out });
  if (collider) mesh.collider = collider;
  return { mesh, worstColorError, warnings };
}

function localMatrix(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Float64Array {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x = qx!, y = qy!, z = qz!, w = qw!;
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * sx!, 2 * (x * y + z * w) * sx!, 2 * (x * z - y * w) * sx!, 0,
    2 * (x * y - z * w) * sy!, (1 - 2 * (x * x + z * z)) * sy!, 2 * (y * z + x * w) * sy!, 0,
    2 * (x * z + y * w) * sz!, 2 * (y * z - x * w) * sz!, (1 - 2 * (x * x + y * y)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ]);
}

/** Column-major 4x4 product a * b. */
function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return out;
}

function determinant3(m: Float64Array): number {
  return m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
}
