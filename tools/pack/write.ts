// Builds pack files from meshes in authoring form.

import { PACK_MAGIC, PACK_VERSION, VERTEX_BYTES, type PackHeader, type PackLod, type PackMesh } from "../../shared/pack/pack.ts";

/** One level of detail before quantization. */
export interface SourceLod {
  /** x, y, z per vertex, metres, model space. */
  positions: Float32Array;
  /** Palette index or colour region per vertex. */
  colors: Uint8Array;
  indices: Uint32Array;
}

export interface SourceMesh {
  id: string;
  lods: SourceLod[];
  collider?: [number, number, number];
}

export function buildPack(meshes: SourceMesh[], palette: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let size = 0;
  const append = (bytes: Uint8Array): number => {
    const at = size;
    parts.push(bytes);
    size += bytes.length;
    const pad = (4 - (size & 3)) & 3;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      size += pad;
    }
    return at;
  };

  const header: PackHeader = { paletteOffset: append(palette), meshes: [] };
  for (const mesh of [...meshes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (mesh.lods.length === 0) throw new Error(`${mesh.id}: no geometry`);
    // One set of bounds for all levels, so they overlay exactly.
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const lod of mesh.lods) {
      for (let i = 0; i < lod.positions.length; i++) {
        const v = lod.positions[i]!;
        if (v < min[i % 3]!) min[i % 3] = v;
        if (v > max[i % 3]!) max[i % 3] = v;
      }
    }
    const center = min.map((lo, a) => (lo + max[a]!) / 2) as [number, number, number];
    const half = min.map((lo, a) => Math.max((max[a]! - lo) / 2, 1e-4)) as [number, number, number];
    const out: PackMesh = { id: mesh.id, center, half, lods: [] };
    if (mesh.collider) out.collider = mesh.collider;
    for (const lod of mesh.lods) {
      const n = lod.positions.length / 3;
      if (n > 65535) throw new Error(`${mesh.id}: a level of detail has ${n} vertices; the limit is 65535`);
      const verts = new Uint8Array(n * VERTEX_BYTES);
      const view = new DataView(verts.buffer);
      for (let v = 0; v < n; v++) {
        for (let a = 0; a < 3; a++) {
          const q = Math.round(((lod.positions[v * 3 + a]! - center[a]!) / half[a]!) * 32767);
          view.setInt16(v * VERTEX_BYTES + a * 2, q, true);
        }
        verts[v * VERTEX_BYTES + 6] = lod.colors[v]!;
      }
      const idx = new Uint8Array(lod.indices.length * 2);
      const iview = new DataView(idx.buffer);
      lod.indices.forEach((i, k) => iview.setUint16(k * 2, i, true));
      const packed: PackLod = { vertexOffset: append(verts), vertexCount: n, indexOffset: append(idx), indexCount: lod.indices.length };
      out.lods.push(packed);
    }
    header.meshes.push(out);
  }

  let json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 - (json.length & 3)) & 3;
  if (pad > 0) {
    const padded = new Uint8Array(json.length + pad).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const file = new Uint8Array(12 + json.length + size);
  const view = new DataView(file.buffer);
  view.setUint32(0, PACK_MAGIC, true);
  view.setUint16(4, PACK_VERSION, true);
  view.setUint32(8, json.length, true);
  file.set(json, 12);
  let at = 12 + json.length;
  for (const p of parts) {
    file.set(p, at);
    at += p.length;
  }
  return file;
}

/** A box mesh, one colour, outward-facing triangles. Used for graybox content. */
export function boxMesh(half: readonly [number, number, number], color: number): SourceLod {
  const [hx, hy, hz] = half;
  const positions: number[] = [];
  const indices: number[] = [];
  // Each face: a corner and two edge vectors whose cross product points outward.
  const faces: [number[], number[], number[]][] = [
    [[hx, -hy, -hz], [0, 2 * hy, 0], [0, 0, 2 * hz]], // +X
    [[-hx, -hy, hz], [0, 2 * hy, 0], [0, 0, -2 * hz]], // -X
    [[-hx, hy, -hz], [0, 0, 2 * hz], [2 * hx, 0, 0]], // +Y
    [[-hx, -hy, hz], [0, 0, -2 * hz], [2 * hx, 0, 0]], // -Y
    [[hx, -hy, hz], [0, 2 * hy, 0], [-2 * hx, 0, 0]], // +Z
    [[-hx, -hy, -hz], [0, 2 * hy, 0], [2 * hx, 0, 0]], // -Z
  ];
  for (const [o, u, v] of faces) {
    const base = positions.length / 3;
    positions.push(o[0]!, o[1]!, o[2]!);
    positions.push(o[0]! + u[0]!, o[1]! + u[1]!, o[2]! + u[2]!);
    positions.push(o[0]! + u[0]! + v[0]!, o[1]! + u[1]! + v[1]!, o[2]! + u[2]! + v[2]!);
    positions.push(o[0]! + v[0]!, o[1]! + v[1]!, o[2]! + v[2]!);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(24).fill(color), indices: Uint32Array.from(indices) };
}
