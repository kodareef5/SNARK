// A chunk the near store holds whole draws its standing statics drawn flat as their form, a box or a shape's boxes and
// convex parts (content/ruins.ts), from one mesh made for it, in place of an instance each: its every-box form
// (shared/world/city.ts mergedPart, touching boxes of one colour merged), which is the far city's nearest level, so the
// hand-over between the two shows nothing. Its faces go in the order the near store lays a chunk's 16 m cells (scene.ts),
// so that a run of cells in view is one draw.
//
// A face is held by the pieces round it that stand drawn as their form, its chunk's and its neighbours'. A busy chunk is
// made in bands along z, a band a step, its chunk's other pieces holding its faces as its neighbours' do, so that no step
// takes much of a frame. Its vertices are stored within bounds of the chunk on a lattice of a power of two metres an axis,
// so that two chunks on the same lattice put a corner at the same place.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { mergedPart, type CityPart, type CityStatics, type Gone, type Ground } from "../../../shared/world/city.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";
import { LAKE_SLOTS, LAKE_SLOT_SPAN } from "./lakes.ts";
import { quadBytes, type FramePacket } from "./packet.ts";

/** Strips of a chunk along z, 4 m wide, that bands are made of: a band is 1, 2, 4, 8 or 16 of them in a row. */
const STRIPS = 16;
/**
 * A band holds at most this many of the pieces of its chunk's mesh, but where one strip holds more. A piece of a shape
 * counts as SHAPE_PIECES, as a ruin's flight or pitched roof took about that many boxes' making in the Miami slice.
 */
export const BAND_PIECES = 400;
export const SHAPE_PIECES = 24;
/** The finest step a vertex is stored to, in metres. */
const FINEST = 2 ** -12;
/**
 * Metres a mesh is made as if the ground stood lower: mergedPart leaves out a face whose corners all stand less than this
 * over the ground, and the near store draws such a face where the ground does not hide it, a paving slab's top among them.
 */
const BURIED = 0.05;

/** A chunk's mesh as made. */
export interface NearMade {
  /** Four vertices a face, drawn with the quads' indices (packet.ts quadIndices). */
  readonly data: Uint8Array;
  readonly faces: number;
  readonly indexBytes: 2 | 4;
  /** What the vertices are stored within: x and z from the chunk's corner, y in the world. */
  readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
  /** Per cell in the near store's order (cellOrder), its first face, and the end of the last. */
  readonly cellFirst: Uint32Array;
  /** Per cell, the box its faces lie in, as `bounds` measures, least then most; empty where it has none. */
  readonly cellBox: Float32Array;
}

/** The cell of `side` a side holding (x, z) from a chunk's corner, in the near store's order: a row, then the next back the other way. */
export function cellOrder(side: number, x: number, z: number): number {
  const i = Math.min(side - 1, Math.max(0, Math.floor((x * side) / CHUNK_SIZE)));
  const j = Math.min(side - 1, Math.max(0, Math.floor((z * side) / CHUNK_SIZE)));
  return j * side + (j & 1 ? side - 1 - i : i);
}

/**
 * The making of chunk `chunk`'s mesh, a band at a time. `mine` marks the chunk's pieces the mesh draws, in the city's
 * order; `holds(c)` marks a neighbour's pieces that stand drawn as their form, which hold faces, or is null for none.
 */
export class NearMaking {
  readonly chunk: number;
  /** How many bands it is made in. */
  readonly bands: number;
  private readonly city: CityStatics;
  private readonly ground: Ground;
  private readonly side: number;
  /** Rows of the city: the chunk's pieces in the mesh by band, and by chunk round it the pieces that hold faces. */
  private readonly own: number[][];
  /** Per band, its pieces as counted against BAND_PIECES. */
  private readonly weights: Uint32Array;
  private readonly around = new Map<number, number[]>();
  /** The chunk whose list carries the chunk's pieces of other bands, which hold faces as a neighbour's do. */
  private readonly beside: number;
  private readonly parts: CityPart[] = [];

  constructor(city: CityStatics, chunk: number, ground: Ground, mine: Uint8Array, holds: (c: number) => Uint8Array | null, side: number) {
    this.city = city;
    this.chunk = chunk;
    this.ground = { heightAt: (x, z) => ground.heightAt(x, z) - BURIED };
    this.side = side;
    const dims = city.dims;
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    const z0 = cz * CHUNK_SIZE;
    const from = city.first[chunk]!;
    const strip = (i: number): number => Math.min(STRIPS - 1, Math.max(0, Math.floor(((city.z[from + i]! - z0) * STRIPS) / CHUNK_SIZE)));
    const counts = new Uint32Array(STRIPS);
    const weight = (i: number): number => (city.plain[city.kind[from + i]!] === 1 ? 1 : SHAPE_PIECES);
    for (let i = 0; i < mine.length; i++) if (mine[i] === 1) counts[strip(i)]! += weight(i);
    this.beside = cx + 1 < dims.chunksX ? chunk + 1 : cx > 0 ? chunk - 1 : cz + 1 < dims.chunksZ ? chunk + dims.chunksX : cz > 0 ? chunk - dims.chunksX : -1;
    // The fewest bands of which none holds more than BAND_PIECES.
    let bands = 1;
    for (; this.beside >= 0 && bands < STRIPS; bands *= 2) {
      let most = 0;
      for (let b = 0; b < bands; b++) most = Math.max(most, counts.subarray((b * STRIPS) / bands, ((b + 1) * STRIPS) / bands).reduce((n, v) => n + v, 0));
      if (most <= BAND_PIECES) break;
    }
    this.bands = bands;
    this.own = Array.from({ length: bands }, () => []);
    this.weights = new Uint32Array(bands);
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] !== 1) continue;
      const b = Math.floor((strip(i) * bands) / STRIPS);
      this.own[b]!.push(from + i);
      this.weights[b]! += weight(i);
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || cx + dx < 0 || cz + dz < 0 || cx + dx >= dims.chunksX || cz + dz >= dims.chunksZ) continue;
        const c = (cz + dz) * dims.chunksX + cx + dx;
        const h = holds(c);
        const rows: number[] = [];
        if (h) for (let i = 0; i < h.length; i++) if (h[i] === 1) rows.push(city.first[c]! + i);
        if (rows.length > 0) this.around.set(c, rows);
      }
    }
  }

  get done(): boolean {
    return this.parts.length === this.bands;
  }

  /** Pieces the next step makes the faces of, a shape's counted as SHAPE_PIECES. */
  get next(): number {
    return this.weights[this.parts.length] ?? 0;
  }

  /** Makes the faces of the next band. */
  step(): void {
    const b = this.parts.length;
    const others: number[] = [];
    for (let k = 0; k < this.bands; k++) if (k !== b) others.push(...this.own[k]!);
    this.parts.push(mergedPart(view(this.city, this.chunk, this.own[b]!, this.beside, others, this.around), this.chunk, this.ground, none, 0.01, 0));
  }

  /** The mesh, once every band is made: its faces in cell order, stored on the lattice. */
  finish(): NearMade {
    let faces = 0;
    for (const part of this.parts) faces += part.faces;
    // Every band's faces in one list, then each axis's box.
    const pos = new Float32Array(faces * 12), colour = new Uint8Array(faces);
    let n = 0;
    for (const part of this.parts) {
      pos.set(part.pos.subarray(0, part.faces * 12), n * 12);
      colour.set(part.color.subarray(0, part.faces), n);
      n += part.faces;
    }
    const box = boxOf(pos, faces * 4);
    const lo = box.subarray(0, 3), hi = box.subarray(3, 6);
    const center = [0, 0, 0], half = [1, 1, 1], step = [1, 1, 1];
    for (let a = 0; a < 3 && faces > 0; a++) {
      // The finest power of two that holds the box, its middle on the lattice.
      let s = FINEST;
      while (32767 * s < Math.max(hi[a]! - Math.round((lo[a]! + hi[a]!) / 2 / s) * s, Math.round((lo[a]! + hi[a]!) / 2 / s) * s - lo[a]!)) s *= 2;
      step[a] = s;
      center[a] = Math.round((lo[a]! + hi[a]!) / 2 / s) * s;
      half[a] = 32767 * s;
    }
    const cells = this.side * this.side;
    const cellOf = new Uint8Array(faces);
    const cellFirst = cellsOf(pos, faces, this.side, cellOf);
    const cellBox = new Float32Array(cells * 6);
    for (let c = 0; c < cells; c++) cellBox.fill(Infinity, c * 6, c * 6 + 3).fill(-Infinity, c * 6 + 3, c * 6 + 6);
    const data = store(pos, colour, faces, cellOf, cellFirst, center, step, cellBox);
    return { data, faces, indexBytes: quadBytes(faces), bounds: { center, half }, cellFirst, cellBox };
  }
}

const none = (): null => null;

/** The box round the first `n` points of `pos`, least then most. */
function boxOf(pos: Float32Array, n: number): Float64Array {
  const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
  for (let v = 0; v < n * 3; v += 3) {
    const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
    if (x < box[0]!) box[0] = x;
    if (y < box[1]!) box[1] = y;
    if (z < box[2]!) box[2] = z;
    if (x > box[3]!) box[3] = x;
    if (y > box[4]!) box[4] = y;
    if (z > box[5]!) box[5] = z;
  }
  return box;
}

/** Puts in `cellOf` the cell of `side` a side each face of `pos` lies in by its middle, and returns where each cell's faces begin. */
function cellsOf(pos: Float32Array, faces: number, side: number, cellOf: Uint8Array): Uint32Array {
  const first = new Uint32Array(side * side + 1);
  for (let f = 0; f < faces; f++) {
    const o = f * 12;
    const c = cellOrder(side, (pos[o]! + pos[o + 3]! + pos[o + 6]! + pos[o + 9]!) / 4, (pos[o + 2]! + pos[o + 5]! + pos[o + 8]! + pos[o + 11]!) / 4);
    cellOf[f] = c;
    first[c + 1]!++;
  }
  for (let c = 0; c < side * side; c++) first[c + 1]! += first[c]!;
  return first;
}

/**
 * Faces `pos` of `colour`, stored on the lattice of `step` from `center` in the order of their cells `cellOf`, which begin
 * at `cellFirst`, each cell's box of what is stored grown in `cellBox`. Its own function, short, for the compiler's sake.
 */
function store(pos: Float32Array, colour: Uint8Array, faces: number, cellOf: Uint8Array, cellFirst: Uint32Array, center: readonly number[], step: readonly number[], cellBox: Float32Array): Uint8Array {
  const data = new Uint8Array(faces * 4 * VERTEX_BYTES);
  const view = new DataView(data.buffer);
  const at = cellFirst.slice(0, cellFirst.length - 1);
  const c0 = center[0]!, c1 = center[1]!, c2 = center[2]!, s0 = step[0]!, s1 = step[1]!, s2 = step[2]!;
  for (let f = 0; f < faces; f++) {
    const c = cellOf[f]!, to = at[c]!++, b = c * 6;
    for (let e = 0; e < 4; e++) {
      const o = (to * 4 + e) * VERTEX_BYTES, v = (f * 4 + e) * 3;
      const qx = Math.round((pos[v]! - c0) / s0), qy = Math.round((pos[v + 1]! - c1) / s1), qz = Math.round((pos[v + 2]! - c2) / s2);
      view.setInt16(o, qx, true);
      view.setInt16(o + 2, qy, true);
      view.setInt16(o + 4, qz, true);
      data[o + 6] = colour[f]!;
      // The box of what is stored, which is what is drawn.
      const x = c0 + qx * s0, y = c1 + qy * s1, z = c2 + qz * s2;
      if (x < cellBox[b]!) cellBox[b] = x;
      if (y < cellBox[b + 1]!) cellBox[b + 1] = y;
      if (z < cellBox[b + 2]!) cellBox[b + 2] = z;
      if (x > cellBox[b + 3]!) cellBox[b + 3] = x;
      if (y > cellBox[b + 4]!) cellBox[b + 4] = y;
      if (z > cellBox[b + 5]!) cellBox[b + 5] = z;
    }
  }
  return data;
}

/**
 * The city as one step of a making sees it: `chunk` holding the rows `own`, the chunk `beside` holding `others` and its
 * share of `around`, and every other chunk round it its share of `around`.
 */
function view(city: CityStatics, chunk: number, own: readonly number[], beside: number, others: readonly number[], around: ReadonlyMap<number, readonly number[]>): CityStatics {
  const dims: MapDims = city.dims;
  const lists = new Map<number, readonly number[]>(around);
  lists.set(chunk, own);
  if (others.length > 0) lists.set(beside, [...(around.get(beside) ?? []), ...others]);
  const order = [...lists.keys()].sort((a, b) => a - b);
  const n = order.reduce((s, c) => s + lists.get(c)!.length, 0);
  const first = new Uint32Array(chunkCount(dims) + 1);
  const kind = new Uint16Array(n), yaw = new Uint16Array(n), x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  let at = 0, c = 0;
  for (const k of order) {
    for (; c <= k; c++) first[c] = at;
    for (const i of lists.get(k)!) {
      kind[at] = city.kind[i]!;
      yaw[at] = city.yaw[i]!;
      x[at] = city.x[i]!;
      y[at] = city.y[i]!;
      z[at] = city.z[i]!;
      at++;
    }
  }
  first.fill(at, c);
  const { halfX, halfY, halfZ, color, plain, walked, look } = city;
  return { dims, first, kind, yaw, x, y, z, halfX, halfY, halfZ, color, plain, walked, look, count: n, in: (k: number) => first[k + 1]! - first[k]! } as CityStatics;
}

/** Slots of meshes on the card start here, past the lakes' (lakes.ts). */
export const NEAR_SLOTS = LAKE_SLOTS + LAKE_SLOT_SPAN;
const NEAR_SLOT_SPAN = 2 ** 29;
/** A slot of a chunk's instances that no piece takes: the one instance at its corner its mesh is drawn with. */
export const MESH_SLOT = 0xffff;
/**
 * Pieces a frame makes the faces of. A piece laid out as an instance that frame takes a LAID_SHARE of one: a band of 400
 * took about 0.5 ms on the Mac (M5) and laying a chunk's 1,815 out 0.1 ms. A frame that lays nothing out makes a band
 * whatever it holds.
 */
export const FRAME_PIECES = BAND_PIECES;
export const LAID_SHARE = 1 / 16;
const RESERVE = "near city";

/** What stands of the map's pieces round a chunk, as the far city follows it (farcity.ts goneOf, goneVersion). */
export interface Standing {
  goneOf(chunk: number): Gone;
  readonly goneVersion: Uint32Array;
}

/** A chunk's mesh on the card, and what it was made from. */
export interface NearMesh extends Omit<NearMade, "data"> {
  /** Its slot, or -1 for one with no faces, which is never on the card; and its bytes there. */
  readonly slot: number;
  readonly bytes: number;
  /** Its chunk's `version` and its neighbours' counts of changes to what stands, and its cells a side, when it was asked for. */
  readonly version: number;
  readonly around: Uint32Array;
  readonly side: number;
}

/** A chunk of the near store as the near city follows it. */
export interface NearChunk {
  /** Per slot of its table, 1 for a piece of the map standing as set down whose kind a mesh draws: a slot holds piece `first + slot` of the map's chunk. */
  readonly mine: Uint8Array;
  /** The mesh to draw them with, or null while there is none, or none made of what stands now. */
  mesh: NearMesh | null;
  /** The table's `shape` when `mine` was last found, and a count of its changes. */
  shape: number;
  version: number;
  /** The frame it was last drawn near in, and how far its middle was from the camera then. */
  frame: number;
  far: number;
}

/**
 * The near city: which of a chunk's pieces its mesh draws, its mesh while that is made of what stands, and the making of
 * meshes, nearest first, a band at a time within a frame's pieces. A chunk not drawn near in a frame lets go of its own.
 */
export class NearCity {
  /**
   * Per content index, 1 for a kind a mesh draws: a static drawn flat as its form, one box of its half extents or its
   * shape's boxes and convex parts (shared/world/city.ts), that turns into nothing, moves, or is a landmark's.
   */
  readonly kinds: Uint8Array;
  /** Pieces a frame makes the faces of (FRAME_PIECES); Infinity makes every mesh wanted in the frame it is. */
  pieces = FRAME_PIECES;
  /**
   * Last frame: pieces laid out as instances, bands made and the pieces whose faces they made, meshes put on the card, and
   * chunks drawn near with no mesh of what stands.
   */
  readonly stats = { laid: 0, steps: 0, made: 0, taken: 0, waiting: 0 };
  /** Bytes of meshes on the card. */
  bytes = 0;
  /** The pack mesh a draw of a mesh names, whose bounds its own stand in for. */
  readonly mesh: number;
  private readonly chunks = new Map<number, NearChunk>();
  private making: { m: NearMaking; version: number; around: Uint32Array } | null = null;
  private frame = 0;
  private next = 0;

  /** `flat(k)` says whether kind k's mesh is drawn flat in its colour, with no material. */
  constructor(reg: Registry, mesh: number, landmark: Uint8Array, flat: (kind: number) => boolean) {
    this.mesh = mesh;
    const turns = new Set<number>();
    for (let k = 1; k < reg.defs.length; k++) for (const other of [reg.opens[k]!, reg.lights[k]!]) if (other !== 0) turns.add(k).add(other);
    this.kinds = Uint8Array.from(reg.defs, (d, k) => (d?.type === "structure" && d.class === "static" && (d.mesh === "box" || d.mesh === "shape") && !turns.has(k) && reg.motion[k] === null && landmark[k] !== 1 && reg.halfX[k]! > 0 && flat(k) ? 1 : 0));
  }

  /** Chunk `chunk` as followed here, while it is drawn near. */
  chunk(chunk: number): NearChunk | undefined {
    return this.chunks.get(chunk);
  }

  /** Before the near store's chunks are drawn. */
  begin(): void {
    this.frame++;
  }

  /**
   * Chunk `chunk` of the near store, with table `t`, is drawn near this frame, `far` metres from the camera: which of its
   * pieces a mesh draws and the mesh, which is let go here if what stands has changed since it was asked for.
   */
  of(chunk: number, t: ChunkTable, city: CityStatics, standing: Standing, side: number, far: number, p: FramePacket): NearChunk {
    let c = this.chunks.get(chunk);
    if (!c) this.chunks.set(chunk, (c = { mine: new Uint8Array(city.in(chunk)), mesh: null, shape: -1, version: 0, frame: 0, far: 0 }));
    c.frame = this.frame;
    c.far = far;
    if (t.shape !== c.shape) {
      c.shape = t.shape;
      if (this.find(chunk, t, city, c.mine)) c.version++;
    }
    const m = c.mesh;
    if (m && (m.version !== c.version || m.side !== side || !this.same(m.around, chunk, city.dims, standing))) this.letGo(p, c);
    return c;
  }

  /**
   * After the near store's chunks are drawn, `laid` pieces of them laid out as instances: lets go of the meshes of chunks
   * not drawn near this frame, and makes meshes, the nearest chunk's first, a band at a time while the frame's pieces
   * last, putting each on the card as it is done.
   */
  end(p: FramePacket, budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, city: CityStatics, standing: Standing, ground: Ground, side: number, laid: number): void {
    const stats = this.stats;
    stats.steps = stats.made = stats.taken = stats.waiting = 0;
    stats.laid = laid;
    let bytes = 0;
    for (const chunk of this.chunks.keys()) {
      const c = this.chunks.get(chunk)!;
      if (c.frame !== this.frame) {
        this.letGo(p, c);
        this.chunks.delete(chunk);
        continue;
      }
      if (c.mesh) bytes += c.mesh.bytes;
      else stats.waiting++;
    }
    const mk = this.making;
    if (mk) {
      const c = this.chunks.get(mk.m.chunk);
      if (!c || c.mesh || mk.version !== c.version || !this.same(mk.around, mk.m.chunk, city.dims, standing)) this.making = null;
    }
    let made = 0;
    while (true) {
      if (!this.making) {
        let best = -1, far = Infinity;
        for (const chunk of this.chunks.keys()) {
          const c = this.chunks.get(chunk)!;
          if (c.mesh || c.far >= far) continue;
          best = chunk;
          far = c.far;
        }
        if (best < 0) break;
        const c = this.chunks.get(best)!;
        const holds = (n: number): Uint8Array | null => {
          const gone = standing.goneOf(n), first = city.first[n]!;
          return Uint8Array.from({ length: city.in(n) }, (_, i) => (this.kinds[city.kind[first + i]!] === 1 && gone?.[i] !== 1 ? 1 : 0));
        };
        this.making = { m: new NearMaking(city, best, ground, c.mine, holds, side), version: c.version, around: this.stamps(best, city.dims, standing) };
      }
      const mk = this.making;
      if ((made > 0 || laid > 0) && made + mk.m.next + laid * LAID_SHARE > this.pieces) break;
      made += mk.m.next;
      mk.m.step();
      stats.steps++;
      if (!mk.m.done) continue;
      this.making = null;
      const c = this.chunks.get(mk.m.chunk)!;
      const done = mk.m.finish();
      let slot = -1;
      if (done.faces > 0) {
        slot = NEAR_SLOTS + this.next;
        this.next = (this.next + 1) % NEAR_SLOT_SPAN;
        p.assetUploads.push({ slot, mesh: this.mesh, level: 0, data: done.data, indexCount: done.faces * 6, indexBytes: done.indexBytes, quads: true, bounds: done.bounds });
        budget.spend(done.data.length);
      }
      c.mesh = { faces: done.faces, indexBytes: done.indexBytes, bounds: done.bounds, cellFirst: done.cellFirst, cellBox: done.cellBox, slot, bytes: done.data.length, version: mk.version, around: mk.around, side };
      bytes += done.data.length;
      stats.taken++;
      stats.waiting--;
    }
    stats.made = made;
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /** Lets go of every mesh, where none is to be drawn. */
  clear(p: FramePacket, budget: { reserve(name: string, bytes: number): void }): void {
    for (const c of this.chunks.values()) this.letGo(p, c);
    this.chunks.clear();
    this.making = null;
    if (this.bytes !== 0) budget.reserve(RESERVE, (this.bytes = 0));
  }

  /** After a lost context: no mesh is on the card, and each is made again. */
  reset(): void {
    for (const c of this.chunks.values()) c.mesh = null;
    this.making = null;
  }

  /** Lets go of `c`'s mesh. */
  private letGo(p: FramePacket, c: NearChunk): void {
    if (c.mesh && c.mesh.slot >= 0) p.assetDrops.push(c.mesh.slot);
    c.mesh = null;
  }

  /** Marks in `mine` the pieces of `chunk` a mesh draws, which `t` holds as the map set them down. Whether that changed it. */
  private find(chunk: number, t: ChunkTable, city: CityStatics, mine: Uint8Array): boolean {
    const first = city.first[chunk]!;
    let changed = false;
    for (let s = 0; s < mine.length; s++) {
      const i = first + s, k = city.kind[i]!;
      const is = s < t.high && t.kind[s] === k && this.kinds[k] === 1 && t.x[s] === city.x[i] && t.y[s] === city.y[i] && t.z[s] === city.z[i] && t.yaw[s] === city.yaw[i] ? 1 : 0;
      if (is !== mine[s]) changed = true;
      mine[s] = is;
    }
    return changed;
  }

  /** The counts of changes to what stands in the chunks round `chunk`, which hold its faces. */
  private stamps(chunk: number, dims: MapDims, standing: Standing): Uint32Array {
    const out = new Uint32Array(9);
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    for (let k = 0; k < 9; k++) {
      const x = cx + (k % 3) - 1, z = cz + Math.floor(k / 3) - 1;
      if (k !== 4 && x >= 0 && z >= 0 && x < dims.chunksX && z < dims.chunksZ) out[k] = standing.goneVersion[z * dims.chunksX + x]!;
    }
    return out;
  }

  /** Whether what stands round `chunk` is as the counts `around` were taken (`stamps`). */
  private same(around: Uint32Array, chunk: number, dims: MapDims, standing: Standing): boolean {
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    for (let k = 0; k < 9; k++) {
      const x = cx + (k % 3) - 1, z = cz + Math.floor(k / 3) - 1;
      const now = k !== 4 && x >= 0 && z >= 0 && x < dims.chunksX && z < dims.chunksZ ? standing.goneVersion[z * dims.chunksX + x]! : 0;
      if (now !== around[k]) return false;
    }
    return true;
  }
}
