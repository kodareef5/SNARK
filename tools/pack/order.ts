// Orders the levels of a pack for the vertex cache: triangles by Forsyth's linear-speed method, then a level's vertices
// in the order the triangles first use them. Every score is made of square roots and the four operations, which IEEE 754
// rounds exactly, so the order is the same on any machine.

import { CLIP_ROOT_BYTES, MATERIAL_CUTOUT, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, clipRotBytes, detailsAtlas, lodSkin, lodSurface, lodVertices, parsePack, readIndices, type Pack, type PackLod } from "../../shared/pack/pack.ts";
import { PackBlob } from "./write.ts";

/** The cache Forsyth's scores are made for, and the most triangles a vertex's valence is scored for. */
const CACHE = 32;
const VALENCE = 64;

/** A vertex's score from where it is in the cache: the last triangle's three alike, then falling off. */
const CACHE_SCORE = Float64Array.from({ length: CACHE }, (_, i) => {
  if (i < 3) return 0.75;
  const x = 1 - (i - 3) / (CACHE - 3);
  return x * Math.sqrt(x);
});
/** A vertex with few triangles left is worth finishing: 2 over the square root of how many. */
const VALENCE_SCORE = Float64Array.from({ length: VALENCE + 1 }, (_, v) => (v === 0 ? 0 : 2 / Math.sqrt(v)));

function vertexScore(cachePos: number, live: number): number {
  if (live === 0) return -1;
  return (cachePos < 0 ? 0 : CACHE_SCORE[cachePos]!) + VALENCE_SCORE[live < VALENCE ? live : VALENCE]!;
}

/**
 * The triangles from `first` to `first + count` of `indices` (counted in indices) in the order Forsyth's method takes
 * them, written back in place. Ties go to the triangle that came first.
 */
export function cacheOrder(indices: Uint32Array, first: number, count: number, vertexCount: number): void {
  const tris = count / 3;
  if (tris < 2) return;
  const run = indices.slice(first, first + count);
  // Each vertex's triangles, and how many of them are not yet taken.
  const live = new Uint32Array(vertexCount);
  for (let k = 0; k < count; k++) live[run[k]!]!++;
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v]! + live[v]!;
  const fill = start.slice(0, vertexCount);
  const adj = new Uint32Array(count);
  for (let k = 0; k < count; k++) adj[fill[run[k]!]!++] = (k / 3) | 0;
  const pos = new Int32Array(vertexCount).fill(-1);
  const score = new Float64Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) score[v] = vertexScore(-1, live[v]!);
  const triScore = new Float64Array(tris);
  const taken = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) triScore[t] = score[run[t * 3]!]! + score[run[t * 3 + 1]!]! + score[run[t * 3 + 2]!]!;
  let cache: number[] = [];
  let best = 0;
  for (let t = 1; t < tris; t++) if (triScore[t]! > triScore[best]!) best = t;
  let out = first;
  for (let done = 0; done < tris; done++) {
    if (best < 0) {
      // Nothing in the cache leads anywhere: the best of what is left, by a search of it all.
      for (let t = 0; t < tris; t++) if (taken[t] === 0 && (best < 0 || triScore[t]! > triScore[best]!)) best = t;
    }
    const t = best;
    taken[t] = 1;
    const corner = [run[t * 3]!, run[t * 3 + 1]!, run[t * 3 + 2]!];
    for (const v of corner) {
      indices[out++] = v;
      // The triangle leaves the vertex's list of those not taken.
      const end = start[v]! + live[v]! - 1;
      for (let k = start[v]!; k <= end; k++) {
        if (adj[k] !== t) continue;
        adj[k] = adj[end]!;
        adj[end] = t;
        break;
      }
      live[v]!--;
    }
    const next = [...corner];
    for (const v of cache) if (v !== corner[0] && v !== corner[1] && v !== corner[2]) next.push(v);
    // Those pushed out of the cache, and those in it, are scored again, and so are their triangles.
    for (let i = CACHE; i < next.length; i++) pos[next[i]!] = -1;
    for (let i = 0; i < next.length; i++) {
      const v = next[i]!;
      if (i < CACHE) pos[v] = i;
      score[v] = vertexScore(pos[v]!, live[v]!);
    }
    cache = next.slice(0, CACHE);
    best = -1;
    for (const v of next) {
      for (let k = start[v]!; k < start[v]! + live[v]!; k++) {
        const u = adj[k]!;
        const s = score[run[u * 3]!]! + score[run[u * 3 + 1]!]! + score[run[u * 3 + 2]!]!;
        triScore[u] = s;
      }
    }
    for (const v of cache) {
      for (let k = start[v]!; k < start[v]! + live[v]!; k++) {
        const u = adj[k]!;
        if (best < 0 || triScore[u]! > triScore[best]! || (triScore[u] === triScore[best] && u < best)) best = u;
      }
    }
  }
}

/** Renumbers vertices in the order the indices first use them, in place. Returns, for each new vertex, the old one: those never used last, in their old order. */
export function fetchOrder(indices: Uint32Array, vertexCount: number): Uint32Array {
  const to = new Int32Array(vertexCount).fill(-1);
  const from = new Uint32Array(vertexCount);
  let next = 0;
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k]!;
    if (to[v]! < 0) {
      to[v] = next;
      from[next++] = v;
    }
    indices[k] = to[v]!;
  }
  for (let v = 0; v < vertexCount; v++) if (to[v]! < 0) from[next++] = v;
  return from;
}

/** Vertices fetched again for each triangle drawn, through a first-in first-out cache of `size`: 0.5 at best, 3 at worst. */
export function missRatio(indices: ArrayLike<number>, vertexCount: number, size = 16): number {
  const at = new Int32Array(vertexCount).fill(-1);
  let misses = 0;
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k]!;
    // In the cache if it went in within the last `size` misses.
    if (at[v]! >= 0 && misses - at[v]! < size) continue;
    at[v] = misses++;
  }
  return indices.length === 0 ? 0 : misses / (indices.length / 3);
}

/** Records of `bytes` each, record i from record `from[i]` of `data`. */
function permuted(data: Uint8Array, from: ArrayLike<number>, bytes: number): Uint8Array {
  const out = new Uint8Array(from.length * bytes);
  for (let i = 0; i < from.length; i++) out.set(data.subarray(from[i]! * bytes, from[i]! * bytes + bytes), i * bytes);
  return out;
}

/** A level as the blob holds it. */
interface Level {
  indices: Uint32Array;
  vertices: Uint8Array;
  surface: Uint8Array | null;
  skin: Uint8Array | null;
}

/**
 * A level drawn with materials: triangles for the cache inside each run but a cut-out one, which the writer put best seen
 * first (sprays.ts); then vertices, surfaces and skins in the order those first use them.
 */
function orderRuns(pack: Pack, lod: PackLod, cutout: (material: number) => boolean): Level {
  const indices = readIndices(pack, lod);
  const runs = lod.sections!;
  for (let k = 0; k < runs.length; k += 3) if (!cutout(runs[k]!)) cacheOrder(indices, runs[k + 1]!, runs[k + 2]!, lod.vertexCount);
  const from = fetchOrder(indices, lod.vertexCount);
  const skin = lodSkin(pack, lod);
  return { indices, vertices: permuted(lodVertices(pack, lod), from, VERTEX_BYTES), surface: permuted(lodSurface(pack, lod)!, from, SURFACE_BYTES), skin: skin && permuted(skin, from, SKIN_BYTES) };
}

/** A flat level: vertices of the same bytes made one (with no normals, those a source split for its faces), then ordered as one run. */
function weldFlat(pack: Pack, lod: PackLod): Level {
  const vertices = lodVertices(pack, lod).slice();
  const first = new Map<bigint, number>();
  const kept: number[] = [];
  const to = Uint32Array.from(new BigUint64Array(vertices.buffer), (bytes, v) => {
    let k = first.get(bytes);
    if (k === undefined) first.set(bytes, (k = kept.push(v) - 1));
    return k;
  });
  const indices = readIndices(pack, lod).map((v) => to[v]!);
  cacheOrder(indices, 0, indices.length, kept.length);
  const from = fetchOrder(indices, kept.length);
  return { indices, vertices: permuted(vertices, Array.from(from, (k) => kept[k]!), VERTEX_BYTES), surface: null, skin: null };
}

/**
 * The pack with every level ordered as above and written again in the same layout. Nothing moves between runs, and every
 * triangle keeps its corners in their order, with each corner's bytes as they were.
 */
export function orderPack(file: Uint8Array): Uint8Array {
  const pack = parsePack(file);
  const { header, blob } = pack;
  const cutout = (m: number): boolean => (header.materials![m]!.flags & MATERIAL_CUTOUT) !== 0;
  const out = new PackBlob();
  header.paletteOffset = out.append(pack.palette);
  if (header.details) header.details.atlas.offset = out.append(detailsAtlas(pack));
  for (const mesh of header.meshes) {
    for (const lod of mesh.lods) {
      const level = lod.sections ? orderRuns(pack, lod, cutout) : weldFlat(pack, lod);
      lod.vertexCount = level.vertices.length / VERTEX_BYTES;
      lod.indexBytes = lod.vertexCount > 65535 ? 4 : 2;
      const idx = new Uint8Array(level.indices.length * lod.indexBytes);
      const view = new DataView(idx.buffer);
      level.indices.forEach((v, k) => (lod.indexBytes === 4 ? view.setUint32(k * 4, v, true) : view.setUint16(k * 2, v, true)));
      lod.indexOffset = out.append(idx);
      lod.vertexOffset = out.append(level.vertices);
      if (level.surface) lod.surfaceOffset = out.append(level.surface);
      if (level.skin) lod.skinOffset = out.append(level.skin);
    }
  }
  for (const c of header.clips) {
    c.rotOffset = out.append(blob.subarray(c.rotOffset, c.rotOffset + c.frames * clipRotBytes(c.bones)));
    c.rootOffset = out.append(blob.subarray(c.rootOffset, c.rootOffset + c.frames * CLIP_ROOT_BYTES));
  }
  return out.file(header);
}
