// Reads glTF 2 files, binary (.glb) or JSON with buffers beside it. Only what the art conversion needs.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } }[];
  textures?: { source?: number }[];
  images?: { uri?: string; name?: string }[];
  skins?: { name?: string; joints: number[]; inverseBindMatrices?: number }[];
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string; sparse?: unknown; min?: number[]; max?: number[] }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
}

export interface Gltf {
  readonly path: string;
  readonly json: GltfJson;
  readonly buffers: readonly Uint8Array[];
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGltf(path: string): Gltf {
  const file = new Uint8Array(readFileSync(path));
  if (path.endsWith(".glb")) {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    if (file.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not a .glb file`);
    let json: GltfJson | null = null;
    let bin = new Uint8Array(0);
    for (let at = 12; at + 8 <= file.length; ) {
      const length = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      const data = file.subarray(at + 8, at + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
      else if (type === 0x004e4942) bin = data;
      at += 8 + length;
    }
    if (!json) throw new Error(`${path}: no JSON chunk`);
    return { path, json, buffers: [bin] };
  }
  const json = JSON.parse(new TextDecoder().decode(file)) as GltfJson;
  const buffers = (json.buffers ?? []).map((b) => {
    if (!b.uri || b.uri.startsWith("data:")) throw new Error(`${path}: embedded buffers are not supported`);
    return new Uint8Array(readFileSync(join(dirname(path), decodeURIComponent(b.uri))));
  });
  return { path, json, buffers };
}

/** Normalized integers are scaled to -1..1 or 0..1. */
export function readAccessor(g: Gltf, index: number): { data: Float64Array; size: number; count: number } {
  const a = g.json.accessors![index]!;
  if (a.sparse || a.bufferView === undefined) throw new Error(`${g.path}: sparse accessors are not supported`);
  const bv = g.json.bufferViews![a.bufferView]!;
  const bytes = COMPONENT_BYTES[a.componentType];
  const size = TYPE_SIZE[a.type];
  if (!bytes || !size) throw new Error(`${g.path}: unsupported accessor ${a.componentType} ${a.type}`);
  const buffer = g.buffers[bv.buffer]!;
  const stride = bv.byteStride ?? bytes * size;
  const dv = new DataView(buffer.buffer, buffer.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
  const data = new Float64Array(a.count * size);
  const norm = a.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[a.componentType] ?? 1 : 1;
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < size; c++) {
      const at = i * stride + c * bytes;
      const v =
        a.componentType === 5126 ? dv.getFloat32(at, true)
        : a.componentType === 5125 ? dv.getUint32(at, true)
        : a.componentType === 5123 ? dv.getUint16(at, true)
        : a.componentType === 5122 ? dv.getInt16(at, true)
        : a.componentType === 5121 ? dv.getUint8(at)
        : dv.getInt8(at);
      data[i * size + c] = norm === 1 ? v : Math.max(v / norm, -1);
    }
  }
  return { data, size, count: a.count };
}

/** -1 for roots. */
export function nodeParents(g: Gltf): Int32Array {
  const parent = new Int32Array(g.json.nodes?.length ?? 0).fill(-1);
  g.json.nodes?.forEach((n, i) => n.children?.forEach((c) => (parent[c] = i)));
  return parent;
}

export function nodeByName(g: Gltf, name: string): number {
  return g.json.nodes?.findIndex((n) => n.name === name) ?? -1;
}

/** Column-major 4 x 4 world matrix of every node at rest. */
export function restMatrices(g: Gltf): Float64Array[] {
  const nodes = g.json.nodes ?? [];
  const parent = nodeParents(g);
  const out: Float64Array[] = new Array<Float64Array>(nodes.length);
  const local = (n: GltfNode): Float64Array => {
    if (n.matrix) return Float64Array.from(n.matrix);
    const [tx, ty, tz] = n.translation ?? [0, 0, 0];
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    return Float64Array.from([
      (1 - 2 * (y! * y! + z! * z!)) * sx!, 2 * (x! * y! + z! * w!) * sx!, 2 * (x! * z! - y! * w!) * sx!, 0,
      2 * (x! * y! - z! * w!) * sy!, (1 - 2 * (x! * x! + z! * z!)) * sy!, 2 * (y! * z! + x! * w!) * sy!, 0,
      2 * (x! * z! + y! * w!) * sz!, 2 * (y! * z! - x! * w!) * sz!, (1 - 2 * (x! * x! + y! * y!)) * sz!, 0,
      tx!, ty!, tz!, 1,
    ]);
  };
  const solve = (i: number): Float64Array => {
    if (out[i]) return out[i]!;
    const m = local(nodes[i]!);
    out[i] = parent[i]! < 0 ? m : multiply4(solve(parent[i]!), m);
    return out[i]!;
  };
  for (let i = 0; i < nodes.length; i++) solve(i);
  return out;
}

/** Column-major 4 x 4 product a * b. */
export function multiply4(a: Float64Array, b: Float64Array | ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return out;
}
