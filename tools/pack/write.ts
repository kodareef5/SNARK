// Builds pack files from meshes in authoring form.

import type { Clip } from "../../shared/anim/clip.ts";
import { CLIP_ROOT_BYTES, PACK_MAGIC, PACK_VERSION, VERTEX_BYTES, clipRotBytes, lodVertices, readIndices, type Pack, type PackHeader, type PackMesh, type PackRig } from "../../shared/pack/pack.ts";
import { surfaceError } from "./error.ts";

/** One level of detail before quantization. */
export interface SourceLod {
  /** x, y, z per vertex, metres, model space. */
  positions: Float32Array;
  /** Palette index or colour region per vertex. */
  colors: Uint8Array;
  indices: Uint32Array;
  /** The bone each vertex follows, in a mesh with a skeleton. */
  bones?: Uint8Array;
  /** How far, in metres, its surface lies from the finest level's, where what made it knows. Measured where it is not given. */
  error?: number;
}

export interface SourceMesh {
  id: string;
  lods: SourceLod[];
  collider?: [number, number, number];
  /** Skeleton the vertices follow, and optionally the rig (by id) the mesh was made on. */
  skeleton?: string;
  rig?: string;
}

/** The blob of a pack as it is put together: runs of bytes, each padded to a multiple of 4. */
export class PackBlob {
  readonly parts: Uint8Array[] = [];
  size = 0;

  /** Returns where the bytes start in the blob. */
  append(bytes: Uint8Array): number {
    const at = this.size;
    this.parts.push(bytes);
    this.size += bytes.length;
    const pad = (4 - (this.size & 3)) & 3;
    if (pad > 0) {
      this.parts.push(new Uint8Array(pad));
      this.size += pad;
    }
    return at;
  }

  /** The pack file: the header as JSON, then the blob. */
  file(header: PackHeader): Uint8Array {
    let json = new TextEncoder().encode(JSON.stringify(header));
    const pad = (4 - (json.length & 3)) & 3;
    if (pad > 0) {
      const padded = new Uint8Array(json.length + pad).fill(0x20);
      padded.set(json);
      json = padded;
    }
    const file = new Uint8Array(12 + json.length + this.size);
    const view = new DataView(file.buffer);
    view.setUint32(0, PACK_MAGIC, true);
    view.setUint16(4, PACK_VERSION, true);
    view.setUint32(8, json.length, true);
    file.set(json, 12);
    let at = 12 + json.length;
    for (const p of this.parts) {
      file.set(p, at);
      at += p.length;
    }
    return file;
  }
}

export function buildPack(meshes: SourceMesh[], palette: Uint8Array, clips: readonly Clip[] = [], rigs: readonly PackRig[] = []): Uint8Array {
  const blob = new PackBlob();
  const append = (bytes: Uint8Array): number => blob.append(bytes);

  const header: PackHeader = { paletteOffset: append(palette), meshes: [], rigs: [...rigs].sort((a, b) => (a.id < b.id ? -1 : 1)), clips: [] };
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
    if (mesh.skeleton) out.skeleton = mesh.skeleton;
    if (mesh.rig) {
      out.rig = header.rigs.findIndex((r) => r.id === mesh.rig);
      if (out.rig < 0) throw new Error(`${mesh.id}: rig "${mesh.rig}" is not in the pack`);
    }
    for (const lod of mesh.lods) {
      const n = lod.positions.length / 3;
      const verts = new Uint8Array(n * VERTEX_BYTES);
      const view = new DataView(verts.buffer);
      for (let v = 0; v < n; v++) {
        for (let a = 0; a < 3; a++) {
          const q = Math.round(((lod.positions[v * 3 + a]! - center[a]!) / half[a]!) * 32767);
          view.setInt16(v * VERTEX_BYTES + a * 2, q, true);
        }
        verts[v * VERTEX_BYTES + 6] = lod.colors[v]!;
        if (lod.bones) verts[v * VERTEX_BYTES + 7] = lod.bones[v]!;
      }
      if (mesh.skeleton && !lod.bones) throw new Error(`${mesh.id}: a mesh with a skeleton needs a bone for every vertex`);
      const indexBytes = n > 65535 ? 4 : 2;
      const idx = new Uint8Array(lod.indices.length * indexBytes);
      const iview = new DataView(idx.buffer);
      lod.indices.forEach((i, k) => (indexBytes === 4 ? iview.setUint32(k * 4, i, true) : iview.setUint16(k * 2, i, true)));
      const error = lod === mesh.lods[0] ? 0 : Math.round((lod.error ?? surfaceError(mesh.lods[0]!, lod)) * 1e5) / 1e5;
      // Indices and then vertices, so the level is one run of bytes.
      const indexOffset = append(idx);
      out.lods.push({ vertexOffset: append(verts), vertexCount: n, indexOffset, indexCount: lod.indices.length, indexBytes, error });
    }
    header.meshes.push(out);
  }

  for (const clip of [...clips].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const rot = new Uint8Array(clip.frames * clipRotBytes(clip.bones));
    const rv = new DataView(rot.buffer);
    for (let k = 0; k < clip.frames * clip.bones; k++) {
      // Stored with w >= 0, so three numbers are enough.
      const sign = clip.rot[k * 4 + 3]! < 0 ? -1 : 1;
      for (let a = 0; a < 3; a++) rv.setInt16(k * 6 + a * 2, Math.round(clip.rot[k * 4 + a]! * sign * 32767), true);
    }
    const root = new Uint8Array(clip.frames * CLIP_ROOT_BYTES);
    const tv = new DataView(root.buffer);
    for (let k = 0; k < clip.frames * 3; k++) tv.setFloat32(k * 4, clip.root[k]!, true);
    header.clips.push({ id: clip.id, bones: clip.bones, frames: clip.frames, loop: clip.loop, rotOffset: append(rot), rootOffset: append(root) });
  }

  return blob.file(header);
}

/** The meshes of a pack back in authoring form, to put them into another pack. */
export function unpackMeshes(pack: Pack): SourceMesh[] {
  return pack.header.meshes.map((m) => {
    const lods = m.lods.map((lod, level): SourceLod => {
      const verts = lodVertices(pack, lod);
      const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
      const positions = new Float32Array(lod.vertexCount * 3);
      const colors = new Uint8Array(lod.vertexCount);
      const bones = new Uint8Array(lod.vertexCount);
      for (let v = 0; v < lod.vertexCount; v++) {
        for (let a = 0; a < 3; a++) positions[v * 3 + a] = m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
        colors[v] = verts[v * VERTEX_BYTES + 6]!;
        bones[v] = verts[v * VERTEX_BYTES + 7]!;
      }
      const out: SourceLod = { positions, colors, indices: readIndices(pack, lod) };
      if (m.skeleton) out.bones = bones;
      if (level > 0 && !Number.isNaN(lod.error)) out.error = lod.error;
      return out;
    });
    const out: SourceMesh = { id: m.id, lods };
    if (m.collider) out.collider = m.collider;
    if (m.skeleton) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = pack.header.rigs[m.rig]!.id;
    return out;
  });
}

/** One colour, outward-facing triangles. */
export function boxMesh(half: readonly [number, number, number], color: number): SourceLod {
  const [hx, hy, hz] = half;
  const positions: number[] = [];
  const indices: number[] = [];
  // Each face is a corner and two edge vectors whose cross product points outward.
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
