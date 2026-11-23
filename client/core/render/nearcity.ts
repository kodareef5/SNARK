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
//
// A piece that goes, or takes another kind, leaves its chunk's mesh by its state (pieces.ts): the mesh says of each face
// its piece and the piece that hid it, and keeps after the faces it shows those a piece going would show, by cell, drawn
// only for the cells where one has gone. No mesh is let go for it. A mesh is made again of what stands only to tidy up:
// once its chunk has stood unchanged a while, or it draws too much of what it keeps, one chunk at a time, while the old
// mesh is drawn.
//
// A slot that holds a broken form of its map piece (shared/content/breaks.ts) is an instance until its chunk's mesh is
// made again, and then the mesh's: the form's shape in the colour and material of the kind the map placed, what a cut
// bared in the core's colour. Its faces are a group's of its slot alone, so its slot's own state still says whether the
// whole piece stands, which is what the faces it hid when whole are held by.
//
// A city piece's wear, its stage and whether its panes are out (shared/world/breaking.ts), is read from its row's health
// into its state, where its faces read it (pieces.ts PIECE_WEAR). A merged box's faces read their group's state, which
// is no one piece's: a worn member breaks its box, so its own faces show its wear, and is made apart at the next making.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { NEIGHBOUR_HOLDER, PIECE_KEY_BITS, PIECE_SLOTS, cornerByte, mergedPart, type CityPart, type CityStatics, type Gone, type Ground, type PartPaint } from "../../../shared/world/city.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";
import { KindPlates, OCCLUDER, chunkOccluders } from "./hide.ts";
import { LAKE_SLOTS, LAKE_SLOT_SPAN } from "./lakes.ts";
import { fixtureKind } from "./street-finish.ts";
import { materialIndex } from "../texgen/layers.ts";
import { FramePacket, quadBytes } from "./packet.ts";
import { FORM_HEAP } from "../../../shared/content/breaks.ts";
import { paned, stageOf } from "../../../shared/world/breaking.ts";
import { PIECE_IN_MESH, PIECE_KEYED, PIECE_KEYS, PIECE_MADE, PIECE_ROWS, PIECE_WEAR, PIECE_WEAR_SHIFT, WEAR_PANES_OUT } from "./pieces.ts";

/** Strips of a chunk along z, 4 m wide, that bands are made of: a band is 1, 2, 4, 8 or 16 of them in a row. */
const STRIPS = 16;
/**
 * A band holds at most this many of the pieces of its chunk's mesh, but where one strip holds more. A piece of a shape
 * counts as its look's boxes and HULL_PIECES a convex part (pieceWeight): a ruin's flight, ten treads and a part, or its
 * pitched roof, two parts, took about 24 boxes' making in the Miami slice.
 */
export const BAND_PIECES = 400;
export const HULL_PIECES = 12;
/** What making kind k's faces counts as among a band's pieces. */
export function pieceWeight(city: Pick<CityStatics, "plain" | "look">, k: number): number {
  if (city.plain[k] === 1) return 1;
  const { start, hulls } = city.look;
  return Math.max(1, start[k + 1]! - start[k]! + HULL_PIECES * (hulls ? hulls.start[k + 1]! - hulls.start[k]! : 0));
}
/** The finest step a vertex is stored to, in metres. */
const FINEST = 2 ** -12;
/**
 * Metres a mesh is made as if the ground stood lower: mergedPart leaves out a face whose corners all stand less than this
 * over the ground, and the near store draws such a face where the ground does not hide it, a paving slab's top among them.
 */
const BURIED = 0.05;

/** A chunk's mesh as made. */
export interface NearMade {
  /** Four vertices a face, drawn with the quads' indices (packet.ts quadIndices): the faces shown, then those kept. */
  readonly data: Uint8Array;
  /** Beside them a word a vertex, four bytes, its face's piece and holder (pieces.ts); all 0 for a mesh made without keys. */
  readonly piece: Uint8Array;
  readonly faces: number;
  /** Faces before this are drawn while every piece stands. The rest are kept for when one goes (city.ts KeyedFaces). */
  readonly shown: number;
  readonly indexBytes: 2 | 4;
  /** What the vertices are stored within: x and z from the chunk's corner, y in the world. */
  readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
  /** Per cell in the near store's order (cellOrder), its first face of those shown, and the end of the last. */
  readonly cellFirst: Uint32Array;
  /** Per cell, the box its faces shown lie in, as `bounds` measures, least then most; empty where it has none. */
  readonly cellBox: Float32Array;
  /** The same of the faces kept: per cell its first, from `shown` on, and their box. */
  readonly keptFirst: Uint32Array;
  readonly keptBox: Float32Array;
  /** Merge groups: group g's member slots are `groupSlots` from `groupFirst[g]` up to `groupFirst[g + 1]`. */
  readonly groupFirst: Uint32Array;
  readonly groupSlots: Uint16Array;
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
  private readonly labels?: Uint8Array;
  private readonly side: number;
  /** Rows of the city: the chunk's pieces in the mesh by band, and by chunk round it the pieces that hold faces. */
  private readonly own: number[][];
  /** Per band, its pieces as counted against BAND_PIECES. */
  private readonly weights: Uint32Array;
  private readonly around = new Map<number, number[]>();
  /** The chunk whose list carries the chunk's pieces of other bands, which hold faces as a neighbour's do. */
  private readonly beside: number;
  private readonly parts: CityPart[] = [];
  /** Whether each face is made with its piece and its holder, and the faces a piece going would show are kept (city.ts KeyedFaces). */
  private readonly keyed: boolean;
  /** Per piece of the chunk, the broken form its slot holds, which it is made as, or 0; and how a form's parts are painted. */
  private readonly forms: Uint16Array | null;
  private readonly paint?: (kind: number) => PartPaint | null;
  /** Per piece of the chunk, 1 for one whose boxes merge with no other piece's. */
  private readonly apart: Uint8Array | null;

  constructor(city: CityStatics, chunk: number, ground: Ground, mine: Uint8Array, holds: (c: number) => Uint8Array | null, side: number, labels?: Uint8Array, keyed = false, forms: Uint16Array | null = null, paint?: (kind: number) => PartPaint | null, apart: Uint8Array | null = null) {
    this.labels = labels;
    this.keyed = keyed;
    this.forms = forms;
    this.paint = paint;
    this.apart = apart;
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
    const weight = (i: number): number => pieceWeight(city, forms?.[i] || city.kind[from + i]!);
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

  /** Pieces the next step makes the faces of, a shape's counted by pieceWeight. */
  get next(): number {
    return this.weights[this.parts.length] ?? 0;
  }

  /** Makes the faces of the next band. */
  step(): void {
    const b = this.parts.length;
    const others: number[] = [];
    for (let k = 0; k < this.bands; k++) if (k !== b) others.push(...this.own[k]!);
    const seen = view(this.city, this.chunk, this.own[b]!, this.beside, others, this.around, this.keyed, this.forms, this.paint, this.apart);
    this.parts.push(mergedPart(seen.city, this.chunk, this.ground, none, 0.01, 0, this.labels, seen.keys));
  }

  /**
   * What the bands made hold, made with keys: faces drawn while every piece stands, those of them a merged box's, the
   * merged boxes and the pieces they are made of, and the faces kept: hidden by another piece, and a merged box's members'.
   */
  census(): { shown: number; merged: number; groups: number; members: number; hidden: number; fallback: number; own: number; buried: number } {
    const c = { shown: 0, merged: 0, groups: 0, members: 0, hidden: 0, fallback: 0, own: 0, buried: 0 };
    for (const part of this.parts) {
      const k = part.keyed;
      if (!k) continue;
      c.shown += k.shown;
      for (let f = 0; f < k.shown; f++) if ((k.piece[f]! & (2 * PIECE_SLOTS - 1)) >= PIECE_SLOTS) c.merged++;
      c.groups += k.first.length - 1;
      c.members += k.slots.length;
      c.hidden += part.faces - k.shown - k.fallback;
      c.fallback += k.fallback;
      c.own += k.own;
      c.buried += k.buried;
    }
    return c;
  }

  /** The mesh, once every band is made: its faces in cell order, those shown and then those kept, stored on the lattice. */
  finish(): NearMade {
    const shownOf = (part: CityPart): number => part.keyed?.shown ?? part.faces;
    let shown = 0, faces = 0;
    for (const part of this.parts) {
      shown += shownOf(part);
      faces += part.faces;
    }
    // Every band's faces in one list, the shown before the kept, and its groups numbered after the bands' before it.
    const pos = new Float32Array(faces * 12), colour = new Uint8Array(faces), edges = new Uint8Array(faces), word = new Uint32Array(faces);
    const groupFirst: number[] = [0], groupSlots: number[] = [];
    let n = 0, k = shown;
    for (const part of this.parts) {
      const a = shownOf(part), rest = part.faces - a, keyed = part.keyed, base = groupFirst.length - 1;
      pos.set(part.pos.subarray(0, a * 12), n * 12);
      pos.set(part.pos.subarray(a * 12, part.faces * 12), k * 12);
      colour.set(part.color.subarray(0, a), n);
      colour.set(part.color.subarray(a, part.faces), k);
      edges.set(part.edges.subarray(0, a), n);
      edges.set(part.edges.subarray(a, part.faces), k);
      for (let f = 0; keyed && f < part.faces; f++) word[f < a ? n + f : k + f - a] = rekeyed(keyed.piece[f]!, base);
      for (let g = 0; keyed && g + 1 < keyed.first.length; g++) {
        for (let e = keyed.first[g]!; e < keyed.first[g + 1]!; e++) groupSlots.push(keyed.slots[e]!);
        groupFirst.push(groupSlots.length);
      }
      n += a;
      k += rest;
    }
    // Groups past the keys a row has share the last key: one of their members going breaks them all.
    if (groupFirst.length > PIECE_SLOTS + 1) {
      groupFirst.length = PIECE_SLOTS + 1;
      groupFirst[PIECE_SLOTS] = groupSlots.length;
    }
    // The lattice is the faces shown's, as a mesh that kept nothing has it.
    const box = boxOf(pos, (shown || faces) * 4);
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
    const cellFirst = cellsOf(pos, 0, shown, this.side, cellOf), keptFirst = cellsOf(pos, shown, faces, this.side, cellOf);
    const cellBox = new Float32Array(cells * 6), keptBox = new Float32Array(cells * 6);
    for (let c = 0; c < cells; c++) {
      cellBox.fill(Infinity, c * 6, c * 6 + 3).fill(-Infinity, c * 6 + 3, c * 6 + 6);
      keptBox.fill(Infinity, c * 6, c * 6 + 3).fill(-Infinity, c * 6 + 3, c * 6 + 6);
    }
    const piece = new Uint32Array(faces * 4);
    const data = store(pos, colour, edges, word, piece, 0, shown, cellOf, cellFirst, center, step, cellBox);
    store(pos, colour, edges, word, piece, shown, faces, cellOf, keptFirst, center, step, keptBox, data);
    return { data, piece: new Uint8Array(piece.buffer), faces, shown, indexBytes: quadBytes(faces), bounds: { center, half }, cellFirst, cellBox, keptFirst, keptBox, groupFirst: Uint32Array.from(groupFirst), groupSlots: Uint16Array.from(groupSlots) };
  }
}

/** A face's word as its band made it (city.ts KeyedFaces), its groups numbered from `base` on, marked as a keyed mesh's. */
function rekeyed(word: number, base: number): number {
  const group = (g: number): number => Math.min(g + base, PIECE_SLOTS - 1);
  let own = word & (PIECE_KEYS - 1), holder = word >>> PIECE_KEY_BITS;
  if (own >= PIECE_SLOTS) own = PIECE_SLOTS + group(own - PIECE_SLOTS);
  if (holder > PIECE_SLOTS && holder < NEIGHBOUR_HOLDER) holder = PIECE_SLOTS + 1 + group(holder - PIECE_SLOTS - 1);
  return (own | (holder << PIECE_KEY_BITS) | PIECE_KEYED) >>> 0;
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

/**
 * Puts in `cellOf` the cell of `side` a side each face of `pos` from `from` up to `to` lies in by its middle, and returns
 * where each cell's faces begin, the first cell's at `from`.
 */
function cellsOf(pos: Float32Array, from: number, to: number, side: number, cellOf: Uint8Array): Uint32Array {
  const first = new Uint32Array(side * side + 1);
  for (let f = from; f < to; f++) {
    const o = f * 12;
    const c = cellOrder(side, (pos[o]! + pos[o + 3]! + pos[o + 6]! + pos[o + 9]!) / 4, (pos[o + 2]! + pos[o + 5]! + pos[o + 8]! + pos[o + 11]!) / 4);
    cellOf[f] = c;
    first[c + 1]!++;
  }
  first[0] = from;
  for (let c = 0; c < side * side; c++) first[c + 1]! += first[c]!;
  return first;
}

/**
 * Faces `from` up to `to` of `pos`, of `colour`, stored on the lattice of `step` from `center` in the order of their
 * cells `cellOf`, which begin at `cellFirst`, each cell's box of what is stored grown in `cellBox`; and each vertex's word
 * (`word` a face) into `piece`, in the same order. Into `data` where given. Its own function, short, for the compiler's sake.
 */
function store(pos: Float32Array, colour: Uint8Array, edges: Uint8Array, word: Uint32Array, piece: Uint32Array, from: number, to: number, cellOf: Uint8Array, cellFirst: Uint32Array, center: readonly number[], step: readonly number[], cellBox: Float32Array, data: Uint8Array = new Uint8Array(word.length * 4 * VERTEX_BYTES)): Uint8Array {
  const view = new DataView(data.buffer);
  const at = cellFirst.slice(0, cellFirst.length - 1);
  const c0 = center[0]!, c1 = center[1]!, c2 = center[2]!, s0 = step[0]!, s1 = step[1]!, s2 = step[2]!;
  // A face kept may reach past the faces shown, whose lattice this is: it is held at the lattice's end.
  const held = (q: number): number => (q > 32767 ? 32767 : q < -32767 ? -32767 : q);
  for (let f = from; f < to; f++) {
    const c = cellOf[f]!, into = at[c]!++, b = c * 6;
    for (let e = 0; e < 4; e++) {
      const o = (into * 4 + e) * VERTEX_BYTES, v = (f * 4 + e) * 3;
      const qx = held(Math.round((pos[v]! - c0) / s0)), qy = held(Math.round((pos[v + 1]! - c1) / s1)), qz = held(Math.round((pos[v + 2]! - c2) / s2));
      view.setInt16(o, qx, true);
      view.setInt16(o + 2, qy, true);
      view.setInt16(o + 4, qz, true);
      data[o + 6] = colour[f]!;
      data[o + 7] = cornerByte(e, edges[f]!);
      piece[into * 4 + e] = word[f]!;
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

/** A neighbour's number among the eight round a chunk, by its place (dx, dz) from it, each -1 to 1: a row, then the next. */
export const neighbourOf = (dx: number, dz: number): number => ((dz + 1) * 3 + dx + 1 > 4 ? (dz + 1) * 3 + dx : (dz + 1) * 3 + dx + 1);

/**
 * Row `i` of the city as a holder of `chunk`'s faces (city.ts KeyedFaces): a piece of `chunk` itself, or else of `from`, a
 * chunk round it. 0 for one past the slots a key may name.
 */
function holderKey(city: CityStatics, chunk: number, from: number, i: number): number {
  const own = i >= city.first[chunk]! && i < city.first[chunk + 1]!;
  const slot = i - city.first[own ? chunk : from]!;
  if (slot >= PIECE_SLOTS) return 0;
  if (own) return slot + 1;
  const dims = city.dims;
  return NEIGHBOUR_HOLDER + neighbourOf(chunkCx(dims, from) - chunkCx(dims, chunk), chunkCz(dims, from) - chunkCz(dims, chunk)) * PIECE_SLOTS + slot;
}

/**
 * The city as one step of a making sees it: `chunk` holding the rows `own`, the chunk `beside` holding `others` and its
 * share of `around`, and every other chunk round it its share of `around`. With `keyed`, each of its rows' key as a holder.
 */
function view(city: CityStatics, chunk: number, own: readonly number[], beside: number, others: readonly number[], around: ReadonlyMap<number, readonly number[]>, keyed = false, forms: Uint16Array | null = null, paint?: (kind: number) => PartPaint | null, apart: Uint8Array | null = null): { city: CityStatics; keys?: Uint32Array } {
  const dims: MapDims = city.dims;
  const lists = new Map<number, readonly number[]>(around);
  lists.set(chunk, own);
  if (others.length > 0) lists.set(beside, [...(around.get(beside) ?? []), ...others]);
  const order = [...lists.keys()].sort((a, b) => a - b);
  const n = order.reduce((s, c) => s + lists.get(c)!.length, 0);
  const first = new Uint32Array(chunkCount(dims) + 1);
  const kind = new Uint16Array(n), yaw = new Uint16Array(n), x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const keys = keyed ? new Uint32Array(n) : undefined;
  const from = city.first[chunk]!, to = city.first[chunk + 1]!;
  const dye = forms?.some((f) => f !== 0) ? new Uint16Array(n) : undefined;
  const alone = apart?.some((v) => v !== 0) ? new Uint8Array(n) : undefined;
  let at = 0, c = 0;
  for (const k of order) {
    for (; c <= k; c++) first[c] = at;
    for (const i of lists.get(k)!) {
      if (keys) keys[at] = holderKey(city, chunk, k, i);
      // A slot of the chunk that holds a broken form is made as the form, in the finish of the kind the map placed.
      const form = dye && i >= from && i < to ? forms![i - from]! : 0;
      if (form !== 0) dye![at] = city.kind[i]!;
      if (alone && i >= from && i < to) alone[at] = apart![i - from]!;
      kind[at] = form || city.kind[i]!;
      yaw[at] = city.yaw[i]!;
      x[at] = city.x[i]!;
      y[at] = city.y[i]!;
      z[at] = city.z[i]!;
      at++;
    }
  }
  first.fill(at, c);
  const { halfX, halfY, halfZ, color, under, plain, walked, look } = city;
  return { city: { dims, first, kind, yaw, x, y, z, halfX, halfY, halfZ, color, under, plain, walked, look, dye, paint, apart: alone, count: n, in: (k: number) => first[k + 1]! - first[k]! } as CityStatics, keys };
}

/** Slots of meshes on the card start here, past the lakes' (lakes.ts). */
export const NEAR_SLOTS = LAKE_SLOTS + LAKE_SLOT_SPAN;
const NEAR_SLOT_SPAN = 2 ** 29;
/** These generated meshes carry each source fixture's finish in bits 6–7 of the static vertex. */
export const nearMeshSlot = (slot: number): boolean => slot >= NEAR_SLOTS && slot < NEAR_SLOTS + NEAR_SLOT_SPAN;
/** A slot of a chunk's instances that no piece takes: the one instance at its corner its mesh is drawn with. */
export const MESH_SLOT = 0xffff;
/**
 * Pieces a frame makes the faces of. A piece laid out as an instance that frame takes a LAID_SHARE of one: a band of 400
 * took about 0.5 ms on the Mac (M5) and laying a chunk's 1,815 out 0.1 ms. A frame that lays nothing out makes a band
 * whatever it holds.
 */
export const FRAME_PIECES = BAND_PIECES;
export const LAID_SHARE = 1 / 16;
/**
 * A mesh that draws other than one made of what stands would is made again once its chunk has stood unchanged QUIET_MS,
 * or sooner where the faces it keeps and draws pass KEPT_SHARE of those it shows or the kinds standing in for pieces it
 * lacks pass STAND_INS; never within REMAKE_MS of its chunk's last.
 */
export const QUIET_MS = 5000;
export const REMAKE_MS = 10000;
export const KEPT_SHARE = 0.25;
export const STAND_INS = 24;
const RESERVE = "near city";

/** What stands of the map's pieces round a chunk, as the far city follows it (farcity.ts goneOf, goneVersion). */
export interface Standing {
  goneOf(chunk: number): Gone;
  readonly goneVersion: Uint32Array;
}

/** A chunk's mesh on the card, and what it was made from. */
export interface NearMesh extends Omit<NearMade, "data" | "piece"> {
  /** Its slot, or -1 for one with no faces, which is never on the card; and its bytes there. */
  readonly slot: number;
  readonly bytes: number;
  /** Its cells a side when it was asked for. */
  readonly side: number;
  /** Per slot of its chunk, 1 for a piece it was made with as the map set it down; and the broken form it was made with there, or 0. */
  readonly has: Uint8Array;
  readonly forms: Uint16Array;
  /** Per slot, the merge groups it is a member of: `slotGroups` from `slotFirst[s]` up to `slotFirst[s + 1]`. */
  readonly slotFirst: Uint32Array;
  readonly slotGroups: Uint16Array;
  /** Boxes wholly inside what it draws, which hide what is behind them where it is drawn (hide.ts OCCLUDER floats each); one a piece that left was of is zeroed. */
  occluders: Float32Array;
  /** Per cell, the occluders that reach into it: `occluderList` from `occluderFirst[c]` up to `occluderFirst[c + 1]`, each its place in `occluders`. */
  occluderFirst: Uint32Array;
  occluderList: Uint32Array;
  /** Per cell, 1 once a piece that hid or merged faces there has left: its faces kept are drawn with those shown. */
  readonly open: Uint8Array;
  /** The faces kept of the cells so opened, and a count of the openings. */
  opened: number;
  opens: number;
}

/** A chunk of the near store as the near city follows it. */
export interface NearChunk {
  /** Per slot of its table, 1 for a piece of the map standing as set down whose kind a mesh draws: a slot holds piece `first + slot` of the map's chunk. */
  readonly mine: Uint8Array;
  /** Per slot, the broken form of its map piece it holds where a mesh draws that kind, else 0. */
  readonly form: Uint16Array;
  /** Per slot, 1 for a piece its mesh draws: one of `mine` the mesh was made with, or a form it was made with. Any other standing piece is an instance. */
  readonly drawn: Uint8Array;
  /** Per slot, the wear of its piece or its form (pieces.ts PIECE_WEAR), 0 for a heap or none; and its table's version when they were read. */
  readonly worn: Uint8Array;
  seen: number;
  /** The mesh to draw them with, or null while there is none. */
  mesh: NearMesh | null;
  /** The table's `shape` when `mine` was last found, and a count of its changes. */
  shape: number;
  version: number;
  /** The frame it was last drawn near in, and how far its middle was from the camera then. */
  frame: number;
  far: number;
  /** Its row of the pieces' states (pieces.ts), or 0 while none is free: it has no mesh then. */
  row: number;
  /** Whether its mesh draws other than one made of what stands now would. */
  stale: boolean;
  /** When what stands in it last changed, and when its mesh was last made, in the scene's milliseconds. */
  changed: number;
  made: number;
  /** Kinds of its pieces standing as set down that its mesh was made without. */
  standIns: number;
  /** A mesh made for it and put on the card last frame, which is its mesh from this one on; and which pieces round it held faces when its making began. */
  next: { readonly mesh: NearMesh; readonly held: Map<number, Uint8Array> } | null;
}

/** A chunk round one drawn near that is not itself: which of its pieces stand, as the far city follows them, for the faces they hold. */
interface Ring {
  row: number;
  readonly bits: Uint8Array;
  stamp: number;
  frame: number;
}

/** A ring chunk's `stamp` before it is first filled, and one's that was drawn near until now. No count of changes is either. */
const NEVER = -1;
const LET_GO = -2;

/** A mesh being made: its chunk and its `mine` and `form` when the making began, and which pieces of the chunks round it held faces then. */
interface Making {
  readonly m: NearMaking;
  readonly chunk: number;
  readonly of: NearChunk;
  readonly has: Uint8Array;
  readonly forms: Uint16Array;
  readonly held: Map<number, Uint8Array>;
  readonly side: number;
}

/**
 * The rows of the pieces' states in a packet (pieces.ts): which chunk has which, and what of them is to go on the card.
 * A row's slots and its merge groups are followed apart, so that a slot and its group changing put two texels there.
 */
export class PieceStates {
  /** Bytes put in the packet for the card this frame. */
  bytes = 0;
  private readonly p: FramePacket;
  private readonly free: number[] = [];
  /** Per row and half of it, slots then groups: the texels that changed since the last frame's, and the last ever written. */
  private readonly lo = new Int32Array(PIECE_ROWS * 2).fill(PIECE_KEYS);
  private readonly hi = new Int32Array(PIECE_ROWS * 2).fill(-1);
  private readonly top = new Int32Array(PIECE_ROWS * 2).fill(-1);

  constructor(p: FramePacket) {
    this.p = p;
    for (let r = PIECE_ROWS - 1; r > 0; r--) this.free.push(r);
    // Row 0 is of no chunk: every piece of it stands.
    for (let k = 0; k < PIECE_KEYS; k++) p.pieces[k * 4] = PIECE_IN_MESH;
    for (const key of [0, PIECE_SLOTS - 1, PIECE_SLOTS, PIECE_KEYS - 1]) this.touch(0, key);
  }

  /** The row of `chunk`, or 0. */
  row(chunk: number): number {
    return this.p.pieceRowOf.get(chunk) ?? 0;
  }

  /** The row of `chunk`, a new one where it has none and one is free: 0 where none is. */
  take(chunk: number): number {
    let row = this.p.pieceRowOf.get(chunk);
    if (row === undefined && this.free.length > 0) this.p.pieceRowOf.set(chunk, (row = this.free.pop()!));
    return row ?? 0;
  }

  /** Gives up the row of `chunk`, emptied for the next to take it. */
  release(chunk: number): void {
    const row = this.p.pieceRowOf.get(chunk);
    if (row === undefined) return;
    this.clear(row);
    this.p.pieceRowOf.delete(chunk);
    this.free.push(row);
  }

  /** Whether key `key` of `row` is in its mesh, 1 or 0. */
  bit(row: number, key: number): number {
    return this.p.pieces[(row * PIECE_KEYS + key) * 4]! & PIECE_IN_MESH;
  }

  /** Says whether key `key` of `row` is in its mesh. */
  set(row: number, key: number, on: number): void {
    const at = (row * PIECE_KEYS + key) * 4, pieces = this.p.pieces;
    pieces[at] = (pieces[at]! & ~PIECE_IN_MESH) | on;
    this.touch(row, key);
  }

  /** Says whether key `key` of `row` is in its mesh, and the material made from a recipe it wears: its other bits stay. */
  put(row: number, key: number, on: number, made: number): void {
    const at = (row * PIECE_KEYS + key) * 4, pieces = this.p.pieces;
    pieces[at] = (pieces[at]! & ~PIECE_IN_MESH) | on;
    pieces[at + 3] = (pieces[at + 3]! & ~PIECE_MADE) | (made & PIECE_MADE);
    this.touch(row, key);
  }

  /**
   * Writes what key `key` of `row` holds beside whether it is in its mesh and its material (pieces.ts): the bits of `r`
   * over the first, `g`, `b`, and the bits of `a` over the material's.
   */
  mark(row: number, key: number, r: number, g: number, b: number, a: number): void {
    const at = (row * PIECE_KEYS + key) * 4, pieces = this.p.pieces;
    pieces[at] = (pieces[at]! & PIECE_IN_MESH) | (r & ~PIECE_IN_MESH);
    pieces[at + 1] = g;
    pieces[at + 2] = b;
    pieces[at + 3] = (pieces[at + 3]! & PIECE_MADE) | (a & ~PIECE_MADE);
    this.touch(row, key);
  }

  /** Says the wear of key `key` of `row`: its other bits stay. */
  wear(row: number, key: number, wear: number): void {
    const at = (row * PIECE_KEYS + key) * 4, pieces = this.p.pieces;
    const now = (pieces[at]! & ~(PIECE_WEAR << PIECE_WEAR_SHIFT)) | ((wear & PIECE_WEAR) << PIECE_WEAR_SHIFT);
    if (now === pieces[at]) return;
    pieces[at] = now;
    this.touch(row, key);
  }

  /** Empties `row`, or with `from` its merge groups alone: none of those keys is in a mesh. */
  clear(row: number, from = 0): void {
    for (let half = from; half < 2; half++) {
      const k = row * 2 + half, from = half * PIECE_SLOTS, to = this.top[k]!;
      if (to < from) continue;
      this.p.pieces.fill(0, (row * PIECE_KEYS + from) * 4, (row * PIECE_KEYS + to + 1) * 4);
      this.touch(row, from);
      this.touch(row, to);
    }
  }

  /** Texel `key` of `row` changed, and goes on the card with the next frame. */
  private touch(row: number, key: number): void {
    const k = row * 2 + (key < PIECE_SLOTS ? 0 : 1);
    if (key < this.lo[k]!) this.lo[k] = key;
    if (key > this.hi[k]!) this.hi[k] = key;
    if (key > this.top[k]!) this.top[k] = key;
  }

  /** After a lost context: the card holds nothing, and every row in use goes on it again. */
  reset(): void {
    for (let k = 0; k < PIECE_ROWS * 2; k++) {
      if (this.top[k]! < 0) continue;
      this.lo[k] = (k & 1) * PIECE_SLOTS;
      this.hi[k] = this.top[k]!;
    }
  }

  /** Lists in the packet the texels that changed since the last frame's. */
  flush(): void {
    const p = this.p;
    this.bytes = 0;
    for (let k = 0; k < PIECE_ROWS * 2; k++) {
      if (this.hi[k]! < this.lo[k]!) continue;
      const run = p.pieceUploads++ * 3;
      p.pieceRuns[run] = k >> 1;
      p.pieceRuns[run + 1] = this.lo[k]!;
      p.pieceRuns[run + 2] = this.hi[k]! - this.lo[k]! + 1;
      this.bytes += p.pieceRuns[run + 2]! * 4;
      this.lo[k] = PIECE_KEYS;
      this.hi[k] = -1;
    }
  }
}

/**
 * The near city: which of a chunk's pieces its mesh draws, its mesh, the states of its pieces, and the making of meshes,
 * nearest first, a band at a time within a frame's pieces. A chunk not drawn near in a frame lets go of its own.
 */
export class NearCity {
  /**
   * Per content index, 1 for a kind a mesh draws: a static drawn flat as its form, one box of its half extents or its
   * shape's boxes and convex parts (shared/world/city.ts), that turns into nothing, moves, or is a landmark's.
   */
  readonly kinds: Uint8Array;
  private readonly labels: Uint8Array;
  /** Per kind, its break set and its form in it, by which a slot's form of its map piece is known. */
  private readonly breakSet: Uint16Array;
  private readonly breakForm: Uint8Array;
  private readonly reg: Registry;
  /** How a form kind's convex parts are painted (shared/world/city.ts PartPaint), where the scene says: without it a form's every face is its piece's colour. */
  paint?: (kind: number) => PartPaint | null;
  /** Pieces a frame makes the faces of (FRAME_PIECES); Infinity makes every mesh wanted in the frame it is. */
  pieces = FRAME_PIECES;
  /**
   * Last frame: pieces laid out as instances, bands made and the pieces whose faces they made, meshes put on the card and
   * those of them made again of a chunk that had one, chunks drawn near with no mesh, and bytes of states put on the card.
   */
  readonly stats = { laid: 0, steps: 0, made: 0, taken: 0, remade: 0, waiting: 0, states: 0 };
  /** Bytes of meshes on the card. */
  bytes = 0;
  /** The pack mesh a draw of a mesh names, whose bounds its own stand in for. */
  readonly mesh: number;
  readonly states: PieceStates;
  private readonly p: FramePacket;
  private readonly chunks = new Map<number, NearChunk>();
  private readonly ring = new Map<number, Ring>();
  private making: Making | null = null;
  private plates: KindPlates | null = null;
  private frame = 0;
  private next = 0;
  private now = 0;
  /** Slots whose `mine` the last `find` changed. */
  private readonly flipped: number[] = [];
  private readonly standing: number[] = [];

  /** `flat(k)` says whether kind k's mesh is drawn flat in its colour, with no material. `packet` holds the pieces' states. */
  constructor(reg: Registry, mesh: number, landmark: Uint8Array, flat: (kind: number) => boolean, packet = new FramePacket()) {
    this.mesh = mesh;
    this.p = packet;
    this.states = new PieceStates(packet);
    this.breakSet = reg.breakSet;
    this.breakForm = reg.breakForm;
    this.reg = reg;
    // A street fixture's material in two bits, and above them a material made from a recipe (shared/world/city.ts mergedPart).
    this.labels = Uint8Array.from(reg.defs, (d) => (d ? fixtureKind(d.id) | (d.type === "structure" ? materialIndex(d.made) << 2 : 0) : 0));
    const turns = new Set<number>();
    for (let k = 1; k < reg.defs.length; k++) for (const other of [reg.opens[k]!, reg.lights[k]!]) if (other !== 0) turns.add(k).add(other);
    this.kinds = Uint8Array.from(reg.defs, (d, k) => (d?.type === "structure" && d.class === "static" && (d.mesh === "box" || d.mesh === "shape") && !turns.has(k) && reg.motion[k] === null && landmark[k] !== 1 && reg.halfX[k]! > 0 && (d ? fixtureKind(d.id) : 0) <= 3 && flat(k) ? 1 : 0));
  }

  /**
   * What the mesh of `chunk` holds with every piece of the map standing, and what it keeps (NearMaking.census): its
   * pieces, and its bytes on the card.
   */
  census(city: CityStatics, chunk: number, ground: Ground, side: number): ReturnType<NearMaking["census"]> & { pieces: number; bytes: number } {
    const standing = (c: number): Uint8Array => Uint8Array.from({ length: city.in(c) }, (_, i) => (i < PIECE_SLOTS && this.kinds[city.kind[city.first[c]! + i]!] === 1 ? 1 : 0));
    const mine = standing(chunk);
    const m = new NearMaking(city, chunk, ground, mine, standing, side, this.labels, true);
    while (!m.done) m.step();
    const made = m.finish();
    return { ...m.census(), pieces: mine.reduce((n, v) => n + v, 0), bytes: made.data.length + made.piece.length };
  }

  /** Chunk `chunk` as followed here, while it is drawn near. */
  chunk(chunk: number): NearChunk | undefined {
    return this.chunks.get(chunk);
  }

  /**
   * Writes what the texel of `slot` of `chunk` holds beside whether its mesh draws it and its material (pieces.ts): its
   * damage stage, scorch and cause in `r` over bit 0, its damage in `g`, where it was hit in `b`, the face hit in `a`
   * over the material. It goes on the card with this frame and stays through a mesh made again. False for a chunk with no row,
   * which is neither drawn near nor round one that is.
   */
  mark(chunk: number, slot: number, r: number, g: number, b: number, a: number): boolean {
    const row = this.states.row(chunk);
    if (row === 0 || slot >= PIECE_SLOTS) return false;
    this.states.mark(row, slot, r, g, b, a);
    return true;
  }

  /** Before the near store's chunks are drawn, at `now` of the scene's milliseconds. */
  begin(now = 0): void {
    this.frame++;
    this.now = now;
  }

  /**
   * Chunk `chunk` of the near store, with table `t`, is drawn near this frame, `far` metres from the camera: which of its
   * pieces a mesh draws and the mesh. A piece that left or came since the last frame changes its state here, and no mesh.
   */
  of(chunk: number, t: ChunkTable, city: CityStatics, side: number, far: number): NearChunk {
    let c = this.chunks.get(chunk);
    // The map's statics were handed over again with other pieces in this chunk (session.ts staticsArrived): found anew.
    if (c && c.mine.length !== city.in(chunk)) {
      this.letGo(c);
      this.chunks.delete(chunk);
      c = undefined;
    }
    if (!c) {
      const n = city.in(chunk);
      c = { mine: new Uint8Array(n), form: new Uint16Array(n), drawn: new Uint8Array(n), worn: new Uint8Array(n), seen: -1, mesh: null, shape: -1, version: 0, frame: 0, far: 0, row: 0, stale: false, changed: this.now, made: -Infinity, standIns: 0, next: null };
      this.chunks.set(chunk, c);
      this.ring.delete(chunk);
    }
    c.frame = this.frame;
    c.far = far;
    if (c.row === 0 && (c.row = this.row(chunk)) !== 0) this.write(chunk, c, city);
    if (c.next) this.install(chunk, c, city);
    const shaped = t.shape !== c.shape;
    if (shaped) {
      c.shape = t.shape;
      if (this.find(chunk, t, city, c.mine, c.form) > 0) {
        c.version++;
        this.changed(chunk, c, city);
      }
    }
    // A row of health alone moves its table's version and not its shape.
    if (shaped || t.version !== c.seen) {
      c.seen = t.version;
      this.wear(chunk, t, city, c);
    }
    if (c.mesh && c.mesh.side !== side) {
      this.letGo(c);
      this.write(chunk, c, city);
    }
    return c;
  }

  /**
   * After the near store's chunks are drawn, `laid` pieces of them laid out as instances: lets go of the meshes of chunks
   * not drawn near this frame, follows what stands in the chunks round those drawn, and makes meshes, a band at a time
   * while the frame's pieces last: first the nearest chunk's that has none, then the nearest's that is due one of what
   * stands now (`due`). A mesh made again takes the old one's place as it goes on the card.
   */
  end(budget: { spend(bytes: number): void; reserve(name: string, bytes: number): void }, city: CityStatics, standing: Standing, ground: Ground, side: number, laid: number): void {
    const stats = this.stats;
    stats.steps = stats.made = stats.taken = stats.remade = stats.waiting = 0;
    stats.laid = laid;
    let bytes = 0;
    for (const chunk of this.chunks.keys()) {
      const c = this.chunks.get(chunk)!;
      if (c.frame !== this.frame) {
        // Round a chunk still drawn near, it is followed on from what its row said: a piece gone since shows what it hid.
        this.ring.set(chunk, { row: 0, bits: whole(c), stamp: LET_GO, frame: 0 });
        this.letGo(c);
        this.states.release(chunk);
        this.chunks.delete(chunk);
        continue;
      }
      if (c.mesh) bytes += c.mesh.bytes;
      else stats.waiting++;
      if (c.next) bytes += c.next.mesh.bytes;
    }
    this.around(city, standing);
    const mk = this.making;
    if (mk && (this.chunks.get(mk.chunk) !== mk.of || mk.of.row === 0 || mk.side !== side)) this.making = null;
    let made = 0;
    while (true) {
      if (!this.making) {
        const best = this.wanted();
        if (best < 0) break;
        const c = this.chunks.get(best)!;
        const held = new Map<number, Uint8Array>();
        const holds = (n: number): Uint8Array | null => {
          const bits = this.bits(n);
          if (bits) held.set(n, bits);
          return bits;
        };
        const has = c.mine.slice(), forms = c.form.slice();
        // The making takes each slot with a piece or a form of one: the map's kind, or the form in its place.
        const all = has.map((v, s) => v | (forms[s] !== 0 ? 1 : 0));
        // A form, and a piece whose wear its own faces must show, is made apart from the boxes it would merge with.
        const apart = c.worn.map((w, s) => (w !== 0 || forms[s] !== 0 ? 1 : 0));
        this.making = { m: new NearMaking(city, best, ground, all, holds, side, this.labels, true, forms, this.paint, apart), chunk: best, of: c, has, forms, held, side };
      }
      const mk = this.making;
      // A chunk with a mesh waits for nothing: its new one is made a band a frame.
      if ((made > 0 || laid > 0) && (made + mk.m.next + laid * LAID_SHARE > this.pieces || (made > 0 && mk.of.mesh !== null && this.pieces !== Infinity))) break;
      made += mk.m.next;
      mk.m.step();
      stats.steps++;
      if (!mk.m.done) continue;
      this.making = null;
      if (mk.of.mesh) stats.remade++;
      else stats.waiting--;
      bytes += this.take(mk, budget);
      stats.taken++;
    }
    stats.made = made;
    this.rows(city.dims);
    this.states.flush();
    stats.states = this.states.bytes;
    if (stats.states > 0) budget.spend(stats.states);
    if (bytes !== this.bytes) budget.reserve(RESERVE, bytes);
    this.bytes = bytes;
  }

  /** Lets go of every mesh and every row, where none is to be drawn. */
  clear(budget: { reserve(name: string, bytes: number): void }): void {
    for (const chunk of this.chunks.keys()) {
      this.letGo(this.chunks.get(chunk)!);
      this.states.release(chunk);
    }
    for (const chunk of this.ring.keys()) this.states.release(chunk);
    this.chunks.clear();
    this.ring.clear();
    this.making = null;
    if (this.bytes !== 0) budget.reserve(RESERVE, (this.bytes = 0));
  }

  /** After a lost context: no mesh and no state is on the card, and each is put there again. */
  reset(city: CityStatics | undefined): void {
    for (const chunk of this.chunks.keys()) {
      const c = this.chunks.get(chunk)!;
      c.mesh = c.next = null;
      c.drawn.fill(0);
      if (city && c.row !== 0 && c.mine.length === city.in(chunk)) this.write(chunk, c, city);
    }
    this.making = null;
    this.states.reset();
  }

  /** A row for `chunk`, drawn near: a free one, else one taken from a chunk that is only round those drawn; 0 where none is. */
  private row(chunk: number): number {
    const row = this.states.take(chunk);
    if (row !== 0) return row;
    for (const n of this.ring.keys()) {
      const r = this.ring.get(n)!;
      if (r.row === 0) continue;
      this.states.release(n);
      r.row = 0;
      return this.states.take(chunk);
    }
    return 0;
  }

  /** Lets go of `c`'s mesh, and of one made to take its place: its pieces are instances until it has one again. */
  private letGo(c: NearChunk): void {
    if (c.mesh && c.mesh.slot >= 0) this.p.assetDrops.push(c.mesh.slot);
    if (c.next && c.next.mesh.slot >= 0) this.p.assetDrops.push(c.next.mesh.slot);
    c.mesh = c.next = null;
    c.drawn.fill(0);
    c.stale = false;
    c.standIns = 0;
  }

  /**
   * Marks in `mine` the pieces of `chunk` a mesh draws, which `t` holds as the map set them down, a slot a key may name;
   * and says in `form` the broken form of its map piece a slot holds instead, nobody's, where a mesh draws both kinds.
   * Lists the slots it changed in `flipped`; how many.
   */
  private find(chunk: number, t: ChunkTable, city: CityStatics, mine: Uint8Array, form: Uint16Array): number {
    const first = city.first[chunk]!, flipped = this.flipped, kinds = this.kinds;
    flipped.length = 0;
    for (let s = 0; s < mine.length; s++) {
      const i = first + s, k = city.kind[i]!, now = s < t.high ? t.kind[s]! : 0;
      const placed = s < PIECE_SLOTS && now !== 0 && kinds[k] === 1 && t.x[s] === city.x[i] && t.y[s] === city.y[i] && t.z[s] === city.z[i] && t.yaw[s] === city.yaw[i];
      const is = placed && now === k ? 1 : 0;
      const as = placed && now !== k && kinds[now] === 1 && t.owner[s] === 0 && this.breakForm[now] !== 0 && this.breakSet[now] === this.breakSet[k] ? now : 0;
      if (is !== mine[s] || as !== form[s]) flipped.push(s);
      mine[s] = is;
      form[s] = as;
    }
    return flipped.length;
  }

  /**
   * The slots `find` listed changed in chunk `chunk`: each one's state says so. One that left shows what it hid, here and
   * in the chunks round it, breaks its merged boxes, and takes its occluders with it; one that came back shows as before.
   */
  private changed(chunk: number, c: NearChunk, city: CityStatics): void {
    const m = c.mesh, first = city.first[chunk]!;
    c.changed = this.now;
    for (let k = 0; k < this.flipped.length; k++) {
      // Its slot's state says whether the whole piece stands; a form its mesh was made with is drawn by its group's.
      const s = this.flipped[k]!, on = m ? c.mine[s]! & m.has[s]! : c.mine[s]!;
      const was = c.drawn[s]!, now = m ? on | (c.form[s] !== 0 && c.form[s] === m.forms[s] ? 1 : 0) : 0;
      if (m) c.drawn[s] = now;
      if (c.row === 0) continue;
      if (this.states.bit(c.row, s) !== on) {
        this.states.set(c.row, s, on);
        if (on === 0) this.left(chunk, city, first + s);
      }
      if (!m || was === now) continue;
      if (now === 0) {
        hideNoMore(m, chunk, city, first + s);
        this.broke(chunk, c, m, city, s, true);
      } else this.mended(c, m, s);
    }
    if (!m) return;
    c.stale = true;
    c.standIns = this.standIns(chunk, c, m, city);
  }

  /**
   * Slot `s` of `c` is no longer drawn by its mesh `m`: its cells draw the faces kept, and so do those of the other
   * members of each merged box it was in, which is broken, as its state says where `tell` is set.
   */
  private broke(chunk: number, c: NearChunk, m: NearMesh, city: CityStatics, s: number, tell: boolean): void {
    const first = city.first[chunk]!;
    open(m, chunk, city, first + s);
    for (let k = m.slotFirst[s]!; k < m.slotFirst[s + 1]!; k++) {
      const g = m.slotGroups[k]!;
      if (tell) {
        if (this.states.bit(c.row, PIECE_SLOTS + g) === 0) continue;
        this.states.set(c.row, PIECE_SLOTS + g, 0);
      }
      for (let e = m.groupFirst[g]!; e < m.groupFirst[g + 1]!; e++) open(m, chunk, city, first + m.groupSlots[e]!);
    }
  }

  /** Slot `s` of `c` is drawn by its mesh `m` again: each merged box it is in whose every member is drawn is whole again. */
  private mended(c: NearChunk, m: NearMesh, s: number): void {
    for (let k = m.slotFirst[s]!; k < m.slotFirst[s + 1]!; k++) {
      const g = m.slotGroups[k]!;
      if (intact(c, m, g) === 1) this.states.set(c.row, PIECE_SLOTS + g, 1);
    }
  }

  /**
   * Reads the wear of each piece of `c` from its row's health in `t`, and says each that changed in its state. A piece
   * that came to wear breaks each merged box it is in, whose faces read the box's state and not its own; a form's faces
   * are its group's, which is told its wear too.
   */
  private wear(chunk: number, t: ChunkTable, city: CityStatics, c: NearChunk): void {
    const first = city.first[chunk]!, reg = this.reg, m = c.mesh, worn = c.worn;
    for (let s = 0; s < worn.length && s < PIECE_SLOTS; s++) {
      let w = 0;
      if (c.mine[s] === 1 || (c.form[s] !== 0 && this.breakForm[c.form[s]!] !== FORM_HEAP)) {
        const k = city.kind[first + s]!, hp = t.hp[s]!;
        w = stageOf(reg, k, hp) | (reg.glassHp[k]! > 0 && !paned(reg, k, hp) ? WEAR_PANES_OUT : 0);
      }
      const was = worn[s]!;
      if (w === was) continue;
      worn[s] = w;
      if (c.row === 0) continue;
      this.states.wear(c.row, s, w);
      for (let k = m ? m.slotFirst[s]! : 0, end = m ? m.slotFirst[s + 1]! : 0; k < end; k++) {
        const g = m!.slotGroups[k]!;
        if (m!.forms[s] !== 0) this.states.wear(c.row, PIECE_SLOTS + g, w);
        else if (w === 0) this.mended(c, m!, s);
        else if (was === 0 && this.states.bit(c.row, PIECE_SLOTS + g) === 1) {
          this.states.set(c.row, PIECE_SLOTS + g, 0);
          for (let e = m!.groupFirst[g]!; e < m!.groupFirst[g + 1]!; e++) open(m!, chunk, city, first + m!.groupSlots[e]!);
          c.stale = true;
          c.changed = this.now;
        }
      }
    }
  }

  /**
   * Piece `i` of the city no longer holds faces: the meshes of the chunks round its own draw what they kept where it
   * stood. A chunk's pieces reach no farther than REACH past it, so one farther than that from the piece holds none.
   */
  private left(chunk: number, city: CityStatics, i: number): void {
    const dims = city.dims, cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    reachOf(city, i);
    const x0 = Math.floor((reach[0]! - REACH) / CHUNK_SIZE), x1 = Math.floor((reach[2]! + REACH) / CHUNK_SIZE);
    const z0 = Math.floor((reach[1]! - REACH) / CHUNK_SIZE), z1 = Math.floor((reach[3]! + REACH) / CHUNK_SIZE);
    for (let z = Math.max(0, cz - 1, z0); z <= Math.min(dims.chunksZ - 1, cz + 1, z1); z++) {
      for (let x = Math.max(0, cx - 1, x0); x <= Math.min(dims.chunksX - 1, cx + 1, x1); x++) {
        const n = z * dims.chunksX + x, m = n === chunk ? null : this.chunks.get(n)?.mesh;
        if (m) open(m, n, city, i);
      }
    }
  }

  /** How many kinds the pieces of `c` standing as set down that its mesh `m` was made without are of. */
  private standIns(chunk: number, c: NearChunk, m: NearMesh, city: CityStatics): number {
    const kinds = this.standing, first = city.first[chunk]!;
    kinds.length = 0;
    for (let s = 0; s < c.mine.length; s++) {
      const kind = c.mine[s] === 1 && m.has[s] === 0 ? city.kind[first + s]! : c.form[s] !== m.forms[s] ? c.form[s]! : 0;
      if (kind !== 0 && !kinds.includes(kind)) kinds.push(kind);
    }
    return kinds.length;
  }

  /**
   * Writes the row of `c` anew: of each slot whether its mesh draws it, or with no mesh whether it stands as set down,
   * and its material; of each merged box of its mesh whether every member is drawn, and its members' material.
   */
  private write(chunk: number, c: NearChunk, city: CityStatics): void {
    if (c.row === 0) return;
    const states = this.states, m = c.mesh, first = city.first[chunk]!, labels = this.labels;
    // A slot keeps what else its texel says. A group is another mesh's number: its texel starts again.
    states.clear(c.row, 1);
    for (let s = 0; s < c.mine.length && s < PIECE_SLOTS; s++) {
      states.put(c.row, s, m ? c.mine[s]! & m.has[s]! : c.mine[s]!, labels[city.kind[first + s]!]! >> 2);
      if (c.worn[s] !== 0) states.wear(c.row, s, c.worn[s]!);
    }
    for (let g = 0; m && g + 1 < m.groupFirst.length; g++) {
      const head = m.groupSlots[m.groupFirst[g]!]!;
      states.put(c.row, PIECE_SLOTS + g, intact(c, m, g), labels[city.kind[first + head]!]! >> 2);
      // A form's faces are its group's: its wear is theirs.
      if (m.forms[head] !== 0) states.wear(c.row, PIECE_SLOTS + g, c.worn[head]!);
    }
  }

  /**
   * Follows the chunks round those drawn near that are not drawn near themselves: each has a row while one is free, which
   * says which of its pieces stand, as the far city knows, so that a face one of them holds shows when it goes.
   */
  private around(city: CityStatics, standing: Standing): void {
    const dims = city.dims, ring = this.ring;
    for (const chunk of this.chunks.keys()) {
      const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
      for (let k = 0; k < 9; k++) {
        const x = cx + (k % 3) - 1, z = cz + Math.floor(k / 3) - 1;
        if (k === 4 || x < 0 || z < 0 || x >= dims.chunksX || z >= dims.chunksZ) continue;
        const n = z * dims.chunksX + x;
        if (this.chunks.has(n)) continue;
        let r = ring.get(n);
        if (!r) ring.set(n, (r = { row: 0, bits: new Uint8Array(city.in(n)), stamp: NEVER, frame: 0 }));
        r.frame = this.frame;
      }
    }
    for (const n of ring.keys()) {
      const r = ring.get(n)!;
      if (r.frame !== this.frame || r.bits.length !== city.in(n)) {
        this.states.release(n);
        ring.delete(n);
        continue;
      }
      const fresh = r.row === 0 && (r.row = this.states.take(n)) !== 0;
      if (fresh) this.states.clear(r.row);
      if (!fresh && r.stamp === standing.goneVersion[n]) continue;
      const first = city.first[n]!, gone = standing.goneOf(n), began = r.stamp === NEVER;
      r.stamp = standing.goneVersion[n]!;
      for (let s = 0; s < r.bits.length && s < PIECE_SLOTS; s++) {
        const on = this.kinds[city.kind[first + s]!] === 1 && gone?.[s] !== 1 ? 1 : 0;
        if (fresh) this.states.put(r.row, s, on, 0);
        if (on === r.bits[s]) continue;
        r.bits[s] = on;
        if (!fresh && r.row !== 0) this.states.set(r.row, s, on);
        if (on === 0 && !began) this.left(n, city, first + s);
      }
    }
  }

  /** Which pieces of chunk `n` hold faces now, as its row says or would: a copy, or null for a chunk neither drawn near nor round one that is. */
  private bits(n: number): Uint8Array | null {
    const c = this.chunks.get(n);
    if (c) return whole(c);
    return this.ring.get(n)?.bits.slice() ?? null;
  }

  /** The chunk to make a mesh for next, or -1: the nearest with a row and no mesh, else the nearest due one of what stands. */
  private wanted(): number {
    let best = -1, far = Infinity, first = false;
    for (const chunk of this.chunks.keys()) {
      const c = this.chunks.get(chunk)!;
      if (c.row === 0 || c.next || (c.mesh && !this.due(c))) continue;
      const none = !c.mesh;
      if (none === first ? c.far >= far : !none) continue;
      best = chunk;
      far = c.far;
      first = none;
    }
    return best;
  }

  /** Whether `c`'s mesh is to be made again of what stands now (QUIET_MS). */
  private due(c: NearChunk): boolean {
    const m = c.mesh!;
    if (!c.stale || this.now - c.made < REMAKE_MS) return false;
    return this.now - c.changed >= QUIET_MS || m.opened > m.shown * KEPT_SHARE || c.standIns > STAND_INS;
  }

  /**
   * Puts the mesh `mk` made on the card, to be its chunk's from the next frame on: this frame's draws are of the mesh the
   * chunk had, by the states that mesh was made for. Its bytes on the card.
   */
  private take(mk: Making, budget: { spend(bytes: number): void }): number {
    const c = mk.of, done = mk.m.finish();
    let slot = -1;
    const kept = done.faces > 0 ? done.data.length + done.piece.length : 0;
    if (done.faces > 0) {
      slot = NEAR_SLOTS + this.next;
      this.next = (this.next + 1) % NEAR_SLOT_SPAN;
      this.p.assetUploads.push({ slot, mesh: this.mesh, level: 0, data: done.data, indexCount: done.faces * 6, indexBytes: done.indexBytes, quads: true, bounds: done.bounds, piece: done.piece });
      budget.spend(kept);
    }
    // Each slot's merged boxes, from each box's members.
    const has = mk.has, forms = mk.forms, slots = has.length, cells = mk.side * mk.side;
    const slotFirst = new Uint32Array(slots + 1), groups = done.groupFirst.length - 1;
    for (let e = 0; e < done.groupSlots.length; e++) slotFirst[done.groupSlots[e]! + 1]!++;
    for (let s = 0; s < slots; s++) slotFirst[s + 1]! += slotFirst[s]!;
    const slotGroups = new Uint16Array(done.groupSlots.length), at = slotFirst.slice(0, slots);
    for (let g = 0; g < groups; g++) for (let e = done.groupFirst[g]!; e < done.groupFirst[g + 1]!; e++) slotGroups[at[done.groupSlots[e]!]!++] = g;
    const mesh: NearMesh = { faces: done.faces, shown: done.shown, indexBytes: done.indexBytes, bounds: done.bounds, cellFirst: done.cellFirst, cellBox: done.cellBox, keptFirst: done.keptFirst, keptBox: done.keptBox, groupFirst: done.groupFirst, groupSlots: done.groupSlots, slot, bytes: kept, side: mk.side, has, forms, slotFirst, slotGroups, occluders: NO_OCCLUDERS, occluderFirst: new Uint32Array(cells + 1), occluderList: new Uint32Array(0), open: new Uint8Array(cells), opened: 0, opens: 0 };
    c.next = { mesh, held: mk.held };
    return kept;
  }

  /**
   * The mesh put on the card for `c` last frame is its mesh now, in place of any it had, which comes off the card: its
   * row says what of it stands now, and it draws what it kept where a piece left since its making began.
   */
  private install(chunk: number, c: NearChunk, city: CityStatics): void {
    const { mesh: m, held } = c.next!, has = m.has;
    if (c.mesh && c.mesh.slot >= 0) this.p.assetDrops.push(c.mesh.slot);
    c.next = null;
    c.mesh = m;
    c.made = this.now;
    let stale = false;
    for (let s = 0; s < has.length; s++) {
      c.drawn[s] = (c.mine[s]! & has[s]!) | (c.form[s] !== 0 && c.form[s] === m.forms[s] ? 1 : 0);
      if (c.mine[s] !== has[s] || c.form[s] !== m.forms[s]) stale = true;
    }
    if (this.plates?.city !== city) this.plates = new KindPlates(city);
    const step = m.bounds.half.map((h) => h / 32767);
    // Only a piece drawn whole hides what is behind it: a form is seen through.
    m.occluders = chunkOccluders(city, chunk, whole(c), this.plates, { x0: chunkCx(city.dims, chunk) * CHUNK_SIZE, z0: chunkCz(city.dims, chunk) * CHUNK_SIZE, center: m.bounds.center, step });
    byCell(m, chunk, city.dims);
    this.write(chunk, c, city);
    // What left while it was made shows what it hid: its own pieces, and those of the chunks round it that held faces.
    for (let s = 0; s < has.length; s++) if ((has[s] === 1 || m.forms[s] !== 0) && c.drawn[s] === 0) this.broke(chunk, c, m, city, s, false);
    // And a merged box one of whose members came to wear since is broken, and its members' own faces are drawn.
    for (let g = 0; g + 1 < m.groupFirst.length; g++) {
      if (intact(c, m, g) === 1) continue;
      for (let e = m.groupFirst[g]!; e < m.groupFirst[g + 1]!; e++) open(m, chunk, city, city.first[chunk]! + m.groupSlots[e]!);
      stale = true;
    }
    for (const n of held.keys()) {
      const then = held.get(n)!, now = this.bits(n);
      for (let s = 0; s < then.length; s++) {
        if (then[s] !== 1 || now?.[s] === 1) continue;
        open(m, chunk, city, city.first[n]! + s);
        stale = true;
      }
    }
    c.stale = stale;
    c.standIns = this.standIns(chunk, c, m, city);
  }

  /** Says in the packet, of each chunk drawn near with a row, the nine rows its mesh is drawn with: its own and those round it. */
  private rows(dims: MapDims): void {
    const p = this.p;
    for (const chunk of this.chunks.keys()) {
      const row = this.chunks.get(chunk)!.row;
      if (row === 0) continue;
      const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
      let moved = false;
      for (let k = 0; k < 9; k++) {
        const x = cx + (k % 3) - 1, z = cz + Math.floor(k / 3) - 1;
        const of = x < 0 || z < 0 || x >= dims.chunksX || z >= dims.chunksZ ? 0 : this.states.row(z * dims.chunksX + x);
        if (p.pieceRows[row * 9 + k] !== of) moved = true;
        p.pieceRows[row * 9 + k] = of;
      }
      if (moved) p.pieceStamp[row]!++;
    }
  }
}

const NO_OCCLUDERS = new Float32Array(0);

/** Whether merged box `g` of mesh `m` of `c` is drawn as one, 1 or 0: each member is drawn, and none is worn but a form, whose group is its own. */
function intact(c: NearChunk, m: NearMesh, g: number): number {
  for (let e = m.groupFirst[g]!; e < m.groupFirst[g + 1]!; e++) {
    const s = m.groupSlots[e]!;
    if (c.drawn[s] === 0 || (c.worn[s] !== 0 && m.forms[s] === 0)) return 0;
  }
  return 1;
}

/** Per slot of `c`, 1 for a piece that stands whole as its row says or would: one its mesh draws as the map set it down, or with no mesh one that stands so. */
function whole(c: NearChunk): Uint8Array {
  const m = c.mesh, bits = c.mine.slice();
  for (let s = 0; m && s < bits.length; s++) bits[s]! &= m.has[s]!;
  return bits;
}

/** The box round piece `i` of the city across the ground, grown by what a face may stand outside its holder: least x and z, then most. */
const reach = new Float64Array(4);
function reachOf(city: CityStatics, i: number): void {
  const k = city.kind[i]!, a = (city.yaw[i]! / YAW_UNITS) * Math.PI * 2;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const ex = c * city.halfX[k]! + s * city.halfZ[k]! + 0.02, ez = s * city.halfX[k]! + c * city.halfZ[k]! + 0.02;
  reach[0] = city.x[i]! - ex;
  reach[1] = city.z[i]! - ez;
  reach[2] = city.x[i]! + ex;
  reach[3] = city.z[i]! + ez;
}

/**
 * Has mesh `m` of chunk `chunk` draw the faces it kept in each cell piece `i` of the city reaches: a face it holds, or
 * one of its own, has its middle within it.
 */
function open(m: NearMesh, chunk: number, city: CityStatics, i: number): void {
  reachOf(city, i);
  const side = m.side, x0 = chunkCx(city.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(city.dims, chunk) * CHUNK_SIZE;
  const cell = (v: number): number => Math.min(side - 1, Math.max(0, Math.floor((v * side) / CHUNK_SIZE)));
  for (let j = cell(reach[1]! - z0); j <= cell(reach[3]! - z0); j++) {
    for (let k = cell(reach[0]! - x0); k <= cell(reach[2]! - x0); k++) {
      const c = j * side + (j & 1 ? side - 1 - k : k);
      if (m.open[c] === 1) continue;
      m.open[c] = 1;
      m.opened += m.keptFirst[c + 1]! - m.keptFirst[c]!;
      m.opens++;
    }
  }
}

/** Metres a piece reaches from its middle at most (shared/content/kinds/shapes.ts). */
const REACH = 16;

/** Lists per cell of mesh `m` of chunk `chunk` the occluders that reach into it, as `hideNoMore` finds them. */
function byCell(m: NearMesh, chunk: number, dims: MapDims): void {
  const side = m.side, o = m.occluders, first = m.occluderFirst.fill(0);
  const x0 = chunkCx(dims, chunk) * CHUNK_SIZE, z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
  const cell = (v: number): number => Math.min(side - 1, Math.max(0, Math.floor((v * side) / CHUNK_SIZE)));
  let list = m.occluderList;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < o.length; k += OCCLUDER) {
      const r = o[k + 8]!;
      for (let j = cell(o[k + 2]! - r - z0); j <= cell(o[k + 2]! + r - z0); j++) {
        for (let i = cell(o[k]! - r - x0); i <= cell(o[k]! + r - x0); i++) {
          const c = j * side + (j & 1 ? side - 1 - i : i);
          if (pass === 0) first[c + 1]!++;
          else list[first[c]!++] = k;
        }
      }
    }
    if (pass === 1) break;
    for (let c = 0; c < side * side; c++) first[c + 1]! += first[c]!;
    list = m.occluderList = new Uint32Array(first[side * side]!);
  }
  // Filled from each cell's start, which the filling moved on to its end: the starts are put back.
  first.copyWithin(1, 0, side * side);
  first[0] = 0;
}

/**
 * Zeroes each occluder of mesh `m` of chunk `chunk` (hide.ts OCCLUDER floats each) that reaches into the box of piece `i`
 * of the city, which may be made of its plates: the piece is no longer drawn, and hides nothing.
 */
function hideNoMore(m: NearMesh, chunk: number, city: CityStatics, i: number): void {
  const occluders = m.occluders, side = m.side;
  const k = city.kind[i]!, a = (city.yaw[i]! / YAW_UNITS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  const hx = city.halfX[k]! + 0.01, hy = city.halfY[k]! + 0.01, hz = city.halfZ[k]! + 0.01;
  reachOf(city, i);
  const x0 = chunkCx(city.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(city.dims, chunk) * CHUNK_SIZE;
  const cell = (v: number): number => Math.min(side - 1, Math.max(0, Math.floor((v * side) / CHUNK_SIZE)));
  for (let j = cell(reach[1]! - z0); j <= cell(reach[3]! - z0); j++) {
    for (let e = cell(reach[0]! - x0); e <= cell(reach[2]! - x0); e++) {
      const at = j * side + (j & 1 ? side - 1 - e : e);
      for (let n = m.occluderFirst[at]!; n < m.occluderFirst[at + 1]!; n++) {
        const o = m.occluderList[n]!;
        if (occluders[o + 8] === 0) continue;
        const dx = occluders[o]! - city.x[i]!, dy = occluders[o + 1]! - city.y[i]!, dz = occluders[o + 2]! - city.z[i]!;
        if (Math.abs(dy) > hy + occluders[o + 4]!) continue;
        // The occluder's box as the piece's frame holds it: its middle there, and its half extents turned into it.
        const oc = occluders[o + 6]!, os = occluders[o + 7]!, tc = Math.abs(c * oc + s * os), ts = Math.abs(s * oc - c * os);
        const ex = tc * occluders[o + 3]! + ts * occluders[o + 5]!, ez = ts * occluders[o + 3]! + tc * occluders[o + 5]!;
        if (Math.abs(c * dx - s * dz) > hx + ex || Math.abs(s * dx + c * dz) > hz + ez) continue;
        occluders.fill(0, o + 3, o + 6);
        occluders[o + 8] = occluders[o + 9] = 0;
      }
    }
  }
}
