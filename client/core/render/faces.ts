// Faces drawn on the client. A head mesh whose pack carries a face table (shared/people/faces.ts) is drawn at its finest
// level as a mesh made here from that level's bytes: the shared head, the pack's own with its face rows (jaw, lids, eyes)
// in its skin, and up to the tier's count of unique heads, each a look's face bytes summed onto it and held inside the hit
// head (clampFace). One head is made a frame, the nearest body's that lacks one first; the head least lately drawn makes
// way. A body without one draws the shared head.

import { B_HEAD, HUMAN_BONES } from "../../../shared/anim/human.ts";
import { FACE_COUNT, LOOK_FACE } from "../../../shared/anim/look.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { blendFace, clampFace, decodeFaces, facePivots, headBound, FACE_PIVOTS, type FaceTable, type HeadBound } from "../../../shared/people/faces.ts";
import type { Tier } from "../assets/tiers.ts";
import type { AssetUpload } from "../assets/residency.ts";
import { FRAGMENT_SLOTS, FRAGMENT_SLOT_SPAN } from "./fragment-meshes.ts";

/** Slots of made heads on the card, two a head (its level and its surface): the end of the far span, after the fragments'. */
export const FACE_SLOTS = FRAGMENT_SLOTS + FRAGMENT_SLOT_SPAN;
/** Unique heads a tier keeps on the card. A guess, to be cut where a frame's measured cost misses. */
export const FACE_HEADS: Readonly<Record<Tier["name"], number>> = { lowpoly: 0, medium: 8, high: 16, ultra: 32 };
const RESERVE = "faces";
/** A head stretch is told apart from another to this share. */
const GROW_STEPS = 4096;

/** What faces.ts needs of the asset library (client/core/assets). */
export interface FaceAssets {
  facesOf(mesh: number): boolean;
  wantFaces(mesh: number): void;
  faces(mesh: number): Uint8Array | null;
  keepBytes(mesh: number, level: number): void;
  keptBytes(mesh: number, level: number): { level: Uint8Array; surface: Uint8Array; indexCount: number; indexBytes: 2 | 4; skinAt: number } | null;
  /** The bounds a mesh's vertices are stored within. */
  bounds(mesh: number): { readonly center: readonly number[]; readonly half: readonly number[] };
  spend(bytes: number): void;
  reserve(name: string, bytes: number): void;
}

/** A head on the card: its slot (its surface's is the next), and the points its face rows turn about. */
export interface MadeHead {
  readonly slot: number;
  /** FACE_PIVOTS x, y, z in the head's rest. */
  readonly pivots: Float32Array;
}

interface Made extends MadeHead {
  readonly slot: number;
  readonly pivots: Float32Array;
  mesh: number;
  key: number;
  readonly face: Int8Array;
  readonly grow: Int32Array;
  used: number;
  bytes: number;
  level: Uint8Array | null;
  surface: Uint8Array | null;
}

/** A head mesh's finest level as it came, its face table, and what making a head of it needs. */
interface Source {
  readonly mesh: number;
  readonly table: FaceTable;
  readonly bound: HeadBound;
  readonly vertices: number;
  readonly indexCount: number;
  readonly indexBytes: 2 | 4;
  /** Where the vertices start in `level`. */
  readonly vertexAt: number;
  readonly level: Uint8Array;
  /** Surface entries alone, and skin entries with the face rows in them. */
  readonly surface: Uint8Array;
  readonly skin: Uint8Array;
  readonly center: readonly number[];
  readonly half: readonly number[];
  /** The rest positions as the pack holds them, and the vertices a face may move that follow the head, which are held. */
  readonly base: Float32Array;
  readonly held: Uint32Array;
  /** Per vertex, the area-weighted normal of its triangles at neutral, and its stored normal and tangent. */
  readonly sum0: Float32Array;
  readonly normal: Float32Array;
  readonly tangent: Float32Array;
  readonly indices: Uint32Array;
  /** Scratch for a face's positions and normal sums. */
  readonly at: Float32Array;
  readonly sum: Float32Array;
  /** Scratch for a face's bounds. */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  shared: Made | null;
}

const NO_PIVOTS = new Float32Array(FACE_PIVOTS * 3);

export class Faces {
  private readonly assets: FaceAssets;
  /** Head meshes faces are drawn on, with the rest of the rig each was made on. */
  private readonly heads = new Map<number, Float32Array>();
  private readonly sources = new Map<number, Source>();
  /** Head meshes a body wanted at its finest level this frame. */
  private readonly wanted = new Set<number>();
  private readonly made: Made[] = [];
  private readonly byKey = new Map<number, Made>();
  private frame = 0;
  private cap = 0;
  /** The nearest body's face that wants a head of its own: its mesh, face bytes, stretch and rank; mesh -1 for none. */
  private wantMesh = -1;
  private wantRank = Infinity;
  private readonly wantFace = new Int8Array(FACE_COUNT);
  private readonly wantGrow = new Int32Array(3);
  private readonly values = new Float32Array(FACE_COUNT);
  private readonly grow = new Float32Array(3);
  private readonly scratchFace = new Int8Array(FACE_COUNT);
  private readonly scratchGrow = new Int32Array(3);
  /** Heads made and bytes on the card, as the bench reads them. */
  makes = 0;
  bytes = 0;
  private reserved = 0;

  constructor(assets: FaceAssets) {
    this.assets = assets;
  }

  /** Says `mesh` is a head drawn with faces where its pack has a table, its rig at rest `rest`. */
  register(mesh: number, rest: Float32Array): void {
    if (mesh < 0 || this.heads.has(mesh) || !this.assets.facesOf(mesh)) return;
    this.heads.set(mesh, rest);
    this.assets.keepBytes(mesh, 0);
  }

  /** Unique heads kept, made this frame or before, and on the card. */
  get count(): number {
    return this.byKey.size;
  }

  /**
   * Before a frame's bodies: the head wanted most last frame is made, or a shared head whose bytes have come, one at most,
   * into `uploads` and `drops`.
   */
  begin(tier: Tier, uploads: AssetUpload[], drops: number[]): void {
    this.frame++;
    this.cap = FACE_HEADS[tier.name] ?? 0;
    for (const mesh of this.wanted) this.assets.wantFaces(mesh);
    let made = false;
    for (const mesh of this.wanted) {
      if (made) break;
      if (!this.sources.has(mesh)) made = this.prepare(mesh);
      const s = this.sources.get(mesh);
      if (!made && s && !s.shared) {
        s.shared = this.makeShared(s, uploads);
        made = true;
      }
    }
    this.wanted.clear();
    while (this.byKey.size > this.cap) this.evict(drops, -1);
    if (!made && this.wantMesh >= 0) {
      const s = this.sources.get(this.wantMesh);
      if (s?.shared && this.room(drops)) this.makeUnique(s, uploads);
    }
    this.wantMesh = -1;
    this.wantRank = Infinity;
    if (this.bytes !== this.reserved) this.assets.reserve(RESERVE, (this.reserved = this.bytes));
  }

  /** Whether a body drawing `mesh` at its finest level may take face rows: its shared head is on the card. Asks for it. */
  ready(mesh: number): boolean {
    if (!this.heads.has(mesh)) return false;
    this.wanted.add(mesh);
    return this.sources.get(mesh)?.shared != null;
  }

  /**
   * The head a body draws this frame for `look` at `lookAt`, its head stretched by `grow` at `growAt` (three axes): its
   * own where one is made, else the shared head, and it is asked for. `rank` is the body's place by nearness, 0 nearest.
   */
  head(mesh: number, look: Uint8Array, lookAt: number, grow: ArrayLike<number>, growAt: number, rank: number): MadeHead {
    const s = this.sources.get(mesh)!;
    const shared = s.shared!;
    const face = this.scratchFace, g = this.scratchGrow;
    let any = false;
    for (let f = 0; f < FACE_COUNT; f++) {
      face[f] = (look[lookAt + LOOK_FACE + f]! << 24) >> 24;
      if (face[f] !== 0) any = true;
    }
    if (!any || this.cap === 0) return shared;
    for (let a = 0; a < 3; a++) g[a] = Math.round(grow[growAt + a]! * GROW_STEPS);
    const key = keyOf(mesh, face, g);
    const h = this.byKey.get(key);
    if (h && h.mesh === mesh && same(h.face, face) && h.grow[0] === g[0] && h.grow[1] === g[1] && h.grow[2] === g[2]) {
      h.used = this.frame;
      return h;
    }
    if (rank < this.wantRank) {
      this.wantRank = rank;
      this.wantMesh = mesh;
      this.wantFace.set(face);
      this.wantGrow.set(g);
    }
    return shared;
  }

  /** After a lost context the card holds no head: each is made again as it is wanted. */
  reset(): void {
    for (const s of this.sources.values()) s.shared = null;
    for (const h of this.made) h.key = -1;
    this.byKey.clear();
    this.bytes = 0;
  }

  /** Reads a head's face table and finest level once both have come. False while either has not. */
  private prepare(mesh: number): boolean {
    const blob = this.assets.faces(mesh), kept = this.assets.keptBytes(mesh, 0);
    if (!blob || !kept) return false;
    const table = decodeFaces(blob);
    const n = table.vertexCount;
    const vertexAt = (kept.indexCount * kept.indexBytes + 3) & ~3;
    if (kept.level.length !== vertexAt + n * VERTEX_BYTES || kept.skinAt !== n * SURFACE_BYTES) throw new Error(`a face table for ${n} vertices does not fit its head's finest level`);
    const { center, half } = this.assets.bounds(mesh);
    const view = new DataView(kept.level.buffer, kept.level.byteOffset, kept.level.byteLength);
    const base = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) base[v * 3 + a] = center[a]! + (view.getInt16(vertexAt + v * VERTEX_BYTES + a * 2, true) / 32767) * half[a]!;
    const indices = new Uint32Array(kept.indexCount);
    for (let i = 0; i < kept.indexCount; i++) indices[i] = kept.indexBytes === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
    // A copy, whatever kind of array the bytes came in: a Buffer's slice is a view.
    const surface = new Uint8Array(kept.surface.subarray(0, n * SURFACE_BYTES));
    const sview = new DataView(surface.buffer, surface.byteOffset, surface.byteLength);
    const normal = new Float32Array(n * 3), tangent = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      unpack(sview.getUint32(v * SURFACE_BYTES + 4, true), normal, v * 3, null, 0);
      unpack(sview.getUint32(v * SURFACE_BYTES + 8, true), tangent, v * 4, tangent, v * 4 + 3);
    }
    const skin = rowsSkin(table, kept.surface.length > n * SURFACE_BYTES ? kept.surface.subarray(n * SURFACE_BYTES) : null, kept.level, vertexAt, n);
    const moved = new Uint8Array(n);
    for (const m of table.modifiers) for (const side of [m.minus, m.plus]) for (const v of side.vertices) moved[v] = 1;
    const held: number[] = [];
    for (let v = 0; v < n; v++) if (moved[v] === 1 && kept.level[vertexAt + v * VERTEX_BYTES + 7] === B_HEAD) held.push(v);
    const sum0 = new Float32Array(n * 3);
    normalSums(base, indices, sum0);
    this.sources.set(mesh, {
      mesh, table, bound: headBound(this.heads.get(mesh)!), vertices: n, indexCount: kept.indexCount, indexBytes: kept.indexBytes, vertexAt, level: kept.level, surface, skin,
      center, half, base, held: Uint32Array.from(held), sum0, normal, tangent, indices, at: new Float32Array(n * 3), sum: new Float32Array(n * 3), lo: new Float64Array(3), hi: new Float64Array(3), shared: null,
    });
    return true;
  }

  /** The pack's own head with the face rows in its skin. */
  private makeShared(s: Source, uploads: AssetUpload[]): Made {
    const slot = FACE_SLOTS;
    const h: Made = { slot: slot + 2 * this.sharedIndex(s.mesh), pivots: s.table.pivots ?? NO_PIVOTS, mesh: s.mesh, key: -1, face: new Int8Array(FACE_COUNT), grow: new Int32Array(3), used: 0, bytes: 0, level: s.level, surface: null };
    const surface = new Uint8Array(s.vertices * (SURFACE_BYTES + SKIN_BYTES));
    surface.set(s.surface);
    surface.set(s.skin, s.surface.length);
    h.surface = surface;
    this.upload(h, s, null, uploads);
    return h;
  }

  /** Shared heads take the first slots, one pair a head mesh in the order they were registered. */
  private sharedIndex(mesh: number): number {
    let k = 0;
    for (const m of this.heads.keys()) {
      if (m === mesh) return k;
      k++;
    }
    return k;
  }

  /** Whether a unique head may be made: under the cap, or one not drawn last frame lets go of its place. */
  private room(drops: number[]): boolean {
    if (this.cap === 0) return false;
    if (this.byKey.size < this.cap) return true;
    return this.evict(drops, this.frame - 1);
  }

  /** Lets go of the head least lately drawn, if it was drawn before frame `before` (any where -1). */
  private evict(drops: number[], before: number): boolean {
    let old: Made | null = null;
    for (const h of this.byKey.values()) if (!old || h.used < old.used) old = h;
    if (!old || (before >= 0 && old.used >= before)) return false;
    this.byKey.delete(old.key);
    old.key = -1;
    drops.push(old.slot + 1, old.slot);
    this.bytes -= old.bytes;
    return true;
  }

  private makeUnique(s: Source, uploads: AssetUpload[]): void {
    let h = this.made.find((m) => m.key < 0) ?? null;
    if (!h) {
      if (this.made.length >= FACE_HEADS.ultra) return;
      const slot = FACE_SLOTS + 2 * (this.heads.size + this.made.length);
      h = { slot, pivots: new Float32Array(FACE_PIVOTS * 3), mesh: -1, key: -1, face: new Int8Array(FACE_COUNT), grow: new Int32Array(3), used: 0, bytes: 0, level: null, surface: null };
      this.made.push(h);
    }
    h.mesh = s.mesh;
    h.face.set(this.wantFace);
    h.grow.set(this.wantGrow);
    h.key = keyOf(s.mesh, h.face, h.grow);
    h.used = this.frame;
    for (let f = 0; f < FACE_COUNT; f++) this.values[f] = h.face[f]! / 127;
    for (let a = 0; a < 3; a++) this.grow[a] = h.grow[a]! / GROW_STEPS;
    const at = blendFace(s.table, this.values, s.base, s.at);
    clampFace(s.bound, this.grow, s.base, at, s.held);
    facePivots(s.table, this.values, h.pivots);
    if (!h.level || h.level.length !== s.level.length) h.level = new Uint8Array(s.level.length);
    if (!h.surface || h.surface.length !== s.vertices * (SURFACE_BYTES + SKIN_BYTES)) h.surface = new Uint8Array(s.vertices * (SURFACE_BYTES + SKIN_BYTES));
    const bounds = headVertices(s, at, h.level);
    headSurface(s, at, h.surface);
    this.byKey.set(h.key, h);
    this.upload(h, s, bounds, uploads);
  }

  private upload(h: Made, s: Source, bounds: { center: readonly number[]; half: readonly number[] } | null, uploads: AssetUpload[]): void {
    const level: AssetUpload = { slot: h.slot, mesh: s.mesh, level: 0, data: h.level!, indexCount: s.indexCount, indexBytes: s.indexBytes };
    if (bounds) level.bounds = bounds;
    uploads.push(level, { slot: h.slot + 1, mesh: s.mesh, level: 0, data: h.surface!, indexCount: 0, indexBytes: s.indexBytes, of: h.slot, skinAt: s.vertices * SURFACE_BYTES });
    h.bytes = h.level!.length + h.surface!.length;
    this.bytes += h.bytes;
    this.assets.spend(h.bytes);
    this.makes++;
  }
}

/** A head's key: its mesh, face bytes and stretch hashed. Kept heads are compared whole, so a clash only costs a make. */
function keyOf(mesh: number, face: Int8Array, grow: Int32Array): number {
  let h = Math.imul(mesh + 1, 0x9e3779b1);
  for (let f = 0; f < FACE_COUNT; f++) h = Math.imul(h ^ (face[f]! & 255), 0x01000193);
  for (let a = 0; a < 3; a++) h = Math.imul(h ^ grow[a]!, 0x85ebca6b);
  return h >>> 0;
}

function same(a: Int8Array, b: Int8Array): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/** Reads a 10-10-10-2 word: x, y, z into `out` at `at`, and its top two bits as 1 or -1 into `sign` at `signAt`. */
function unpack(w: number, out: Float32Array, at: number, sign: Float32Array | null, signAt: number): void {
  out[at] = Math.max(-1, ((w << 22) >> 22) / 511);
  out[at + 1] = Math.max(-1, ((w << 12) >> 22) / 511);
  out[at + 2] = Math.max(-1, ((w << 2) >> 22) / 511);
  if (sign) sign[signAt] = w >>> 30 === 3 ? -1 : 1;
}

const q10 = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 511) & 1023;

/** A 10-10-10-2 word of x, y, z and its top two bits, as tools/pack/surface.ts writes one. */
function pack10(x: number, y: number, z: number, top: number): number {
  return (q10(x) | (q10(y) << 10) | (q10(z) << 20) | (top << 30)) >>> 0;
}

/** Adds each triangle's area-weighted normal to its corners' sums. */
function normalSums(p: Float32Array, indices: Uint32Array, out: Float32Array): void {
  out.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a]! += nx; out[a + 1]! += ny; out[a + 2]! += nz;
    out[b]! += nx; out[b + 1]! += ny; out[b + 2]! += nz;
    out[c]! += nx; out[c + 1]! += ny; out[c + 2]! += nz;
  }
}

/**
 * The skin of a head's finest level with its face rows: each listed vertex gives that share of its head weight to its
 * row, which is bone HUMAN_BONES plus the row. `skin` is the pack's, or null where every vertex is wholly on its own bone.
 */
export function rowsSkin(table: FaceTable, skin: Uint8Array | null, level: Uint8Array, vertexAt: number, n: number): Uint8Array {
  const out = new Uint8Array(n * SKIN_BYTES);
  if (skin) out.set(skin.subarray(0, n * SKIN_BYTES));
  else for (let v = 0; v < n; v++) {
    const own = level[vertexAt + v * VERTEX_BYTES + 7]!;
    out.fill(own, v * SKIN_BYTES, v * SKIN_BYTES + 4);
    out[v * SKIN_BYTES + 4] = 255;
  }
  const rows = table.rows;
  if (!rows) return out;
  for (let i = 0; i < rows.vertices.length; i++) {
    const at = rows.vertices[i]! * SKIN_BYTES;
    let k = -1;
    for (let j = 0; j < 4; j++) if (out[at + j] === B_HEAD && out[at + 4 + j]! > 0) { k = j; break; }
    if (k < 0) continue;
    const h = out[at + 4 + k]!, m = Math.min(h, Math.round(h * rows.share[i]!));
    if (m === 0) continue;
    // A place of no weight takes the row, else the lightest other bone is folded into the head's.
    let j = -1;
    for (let q = 1; q < 4; q++) if (q !== k && out[at + 4 + q] === 0) { j = q; break; }
    if (j < 0) {
      for (let q = 1; q < 4; q++) if (q !== k && (j < 0 || out[at + 4 + q]! < out[at + 4 + j]!)) j = q;
      out[at + 4 + k]! += out[at + 4 + j]!;
    }
    out[at + j] = HUMAN_BONES + rows.row[i]!;
    out[at + 4 + j] = m;
    out[at + 4 + k]! -= m;
  }
  return out;
}

/**
 * Writes a face's level, indices then vertices, into `out`: the pack's bytes with each vertex at `at`. Returns the
 * bounds its vertices are stored within where they no longer fit the mesh's, else null.
 */
function headVertices(s: Source, at: Float32Array, out: Uint8Array): { center: readonly number[]; half: readonly number[] } | null {
  out.set(s.level);
  const lo = s.lo, hi = s.hi;
  for (let a = 0; a < 3; a++) {
    lo[a] = s.center[a]! - s.half[a]!;
    hi[a] = s.center[a]! + s.half[a]!;
  }
  let grew = false;
  for (let v = 0; v < s.vertices; v++) for (let a = 0; a < 3; a++) {
    const x = at[v * 3 + a]!;
    if (x < lo[a]!) { lo[a] = x; grew = true; }
    if (x > hi[a]!) { hi[a] = x; grew = true; }
  }
  // A head that grew past the mesh's bounds is stored in bounds of its own, which go with its upload.
  const center = grew ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : s.center;
  const half = grew ? [Math.max((hi[0]! - lo[0]!) / 2, 1e-4), Math.max((hi[1]! - lo[1]!) / 2, 1e-4), Math.max((hi[2]! - lo[2]!) / 2, 1e-4)] : s.half;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let v = 0; v < s.vertices; v++) {
    const o = s.vertexAt + v * VERTEX_BYTES;
    // A vertex the face leaves where it was keeps its bytes, so the head meets the neck as the pack's does.
    if (!grew && at[v * 3] === s.base[v * 3] && at[v * 3 + 1] === s.base[v * 3 + 1] && at[v * 3 + 2] === s.base[v * 3 + 2]) continue;
    for (let a = 0; a < 3; a++) view.setInt16(o + a * 2, Math.round(((at[v * 3 + a]! - center[a]!) / half[a]!) * 32767), true);
  }
  return grew ? { center, half } : null;
}

/**
 * Writes a face's surface then skin into `out`: each vertex whose triangles moved turns its stored normal by as much as
 * their summed normal turned, and its tangent is squared to it; any other keeps the pack's bytes.
 */
function headSurface(s: Source, at: Float32Array, out: Uint8Array): void {
  out.set(s.surface);
  out.set(s.skin, s.surface.length);
  normalSums(at, s.indices, s.sum);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const sum = s.sum, sum0 = s.sum0, n = s.normal, t = s.tangent;
  for (let v = 0; v < s.vertices; v++) {
    const k = v * 3;
    if (sum[k] === sum0[k] && sum[k + 1] === sum0[k + 1] && sum[k + 2] === sum0[k + 2]) continue;
    const l = Math.hypot(sum[k]!, sum[k + 1]!, sum[k + 2]!) || 1, l0 = Math.hypot(sum0[k]!, sum0[k + 1]!, sum0[k + 2]!) || 1;
    let nx = n[k]! + sum[k]! / l - sum0[k]! / l0, ny = n[k + 1]! + sum[k + 1]! / l - sum0[k + 1]! / l0, nz = n[k + 2]! + sum[k + 2]! / l - sum0[k + 2]! / l0;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const j = v * 4, d = t[j]! * nx + t[j + 1]! * ny + t[j + 2]! * nz;
    let tx = t[j]! - nx * d, ty = t[j + 1]! - ny * d, tz = t[j + 2]! - nz * d;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    view.setUint32(v * SURFACE_BYTES + 4, pack10(nx, ny, nz, 0), true);
    // The sign of the bitangent as two bits: 1 is 01 and -1 is 11.
    view.setUint32(v * SURFACE_BYTES + 8, pack10(tx, ty, tz, t[j + 3]! < 0 ? 3 : 1), true);
  }
}
