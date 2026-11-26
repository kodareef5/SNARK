// Face modifiers as the client gets them: for each of a look's 32 face bytes, a sparse delta on the head's vertices at
// -1 and at +1. A face is the head's vertices plus each modifier's delta scaled by its byte (blendFace). The table is
// cooked by tools/makehuman/faces.ts, which holds every summed face inside the hit head.
//
// Bytes, little-endian: "FACE", a version byte, the modifier count, two zero bytes, the vertex count (u32); then for each
// modifier its minus side and its plus side, each a step in metres (f32), an entry count (u32), the vertex indices as
// gaps (each the index less the last one less 1, the first the index itself) in base-128 varints, and three signed
// bytes an entry: the delta in steps.

import { FACE_COUNT, LOOK_FACE } from "../anim/look.ts";

export const FACES_VERSION = 1;
const MAGIC = [0x46, 0x41, 0x43, 0x45];
/** The most steps a delta component holds. */
const STEPS = 127;

/** One side of a modifier: the vertices it moves, in increasing order, and how far each, x, y, z in metres. */
export interface FaceSide {
  readonly vertices: Uint32Array;
  readonly deltas: Float32Array;
}

export interface FaceModifierDeltas {
  readonly minus: FaceSide;
  readonly plus: FaceSide;
}

export interface FaceTable {
  /** The vertices of the mesh the indices name. */
  readonly vertexCount: number;
  readonly modifiers: readonly FaceModifierDeltas[];
}

/** The step a side is stored at: its largest component over STEPS, as an f32. */
export function sideStep(side: FaceSide): number {
  let most = 0;
  for (let i = 0; i < side.deltas.length; i++) {
    const d = side.deltas[i]!;
    if (d > most) most = d;
    else if (-d > most) most = -d;
  }
  return Math.fround(most / STEPS);
}

const quantise = (d: number, step: number): number => {
  const q = Math.round(d / step);
  return q > STEPS ? STEPS : q < -STEPS ? -STEPS : q;
};

/** The table as bytes. Entries whose delta rounds to zero steps are left out, so decoding returns only what moves. */
export function encodeFaces(table: FaceTable): Uint8Array {
  const out: number[] = [...MAGIC, FACES_VERSION, table.modifiers.length, 0, 0];
  const u32 = (v: number): void => {
    out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  };
  const f32 = new DataView(new ArrayBuffer(4));
  u32(table.vertexCount);
  for (const m of table.modifiers) {
    for (const side of [m.minus, m.plus]) {
      const step = sideStep(side);
      f32.setFloat32(0, step, true);
      out.push(f32.getUint8(0), f32.getUint8(1), f32.getUint8(2), f32.getUint8(3));
      const kept: number[] = [];
      const n = side.vertices.length;
      for (let i = 0; i < n; i++) {
        if (i > 0 && side.vertices[i]! <= side.vertices[i - 1]!) throw new Error("a face side's vertices must increase");
        if (side.vertices[i]! >= table.vertexCount) throw new Error(`a face side names vertex ${side.vertices[i]} of ${table.vertexCount}`);
        if (step > 0 && (quantise(side.deltas[i * 3]!, step) !== 0 || quantise(side.deltas[i * 3 + 1]!, step) !== 0 || quantise(side.deltas[i * 3 + 2]!, step) !== 0)) kept.push(i);
      }
      u32(kept.length);
      let last = -1;
      for (const i of kept) {
        let gap = side.vertices[i]! - last - 1;
        last = side.vertices[i]!;
        while (gap >= 128) {
          out.push((gap & 127) | 128);
          gap = Math.floor(gap / 128);
        }
        out.push(gap);
      }
      for (const i of kept) for (let k = 0; k < 3; k++) out.push(quantise(side.deltas[i * 3 + k]!, step) & 255);
    }
  }
  return Uint8Array.from(out);
}

export function decodeFaces(bytes: Uint8Array): FaceTable {
  if (bytes.length < 12 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("not a face table");
  if (bytes[4] !== FACES_VERSION) throw new Error(`face table version ${bytes[4]}, not ${FACES_VERSION}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes[5]!;
  const vertexCount = view.getUint32(8, true);
  let at = 12;
  const need = (n: number): void => {
    if (at + n > bytes.length) throw new Error("the face table is cut short");
  };
  const side = (): FaceSide => {
    need(8);
    const step = view.getFloat32(at, true);
    const n = view.getUint32(at + 4, true);
    at += 8;
    const vertices = new Uint32Array(n);
    let last = -1;
    for (let i = 0; i < n; i++) {
      let gap = 0;
      let scale = 1;
      for (;;) {
        need(1);
        const b = bytes[at++]!;
        gap += (b & 127) * scale;
        if (b < 128) break;
        scale *= 128;
      }
      last += gap + 1;
      if (last >= vertexCount) throw new Error(`a face side names vertex ${last} of ${vertexCount}`);
      vertices[i] = last;
    }
    need(n * 3);
    const deltas = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) deltas[i] = view.getInt8(at + i) * step;
    at += n * 3;
    return { vertices, deltas };
  };
  const modifiers: FaceModifierDeltas[] = [];
  for (let m = 0; m < count; m++) modifiers.push({ minus: side(), plus: side() });
  if (at !== bytes.length) throw new Error("the face table runs on past its modifiers");
  return { vertexCount, modifiers };
}

/** The face bytes of a look as modifier values in -1..1, as look.ts reads them. */
export function faceValues(look: Uint8Array, out: Float32Array = new Float32Array(FACE_COUNT)): Float32Array {
  for (let f = 0; f < FACE_COUNT; f++) {
    const v = look[LOOK_FACE + f]!;
    out[f] = (v > 127 ? v - 256 : v) / 127;
  }
  return out;
}

/** Writes `base` (x, y, z a vertex) plus each modifier's side at its value's size to `out`, which may be `base`. */
export function blendFace(table: FaceTable, values: ArrayLike<number>, base: ArrayLike<number>, out: Float32Array): Float32Array {
  if (out !== base) for (let i = 0; i < table.vertexCount * 3; i++) out[i] = base[i]!;
  for (let m = 0; m < table.modifiers.length; m++) {
    const v = values[m] ?? 0;
    if (v === 0) continue;
    const side = v > 0 ? table.modifiers[m]!.plus : table.modifiers[m]!.minus;
    const w = v > 0 ? v : -v;
    const { vertices, deltas } = side;
    for (let i = 0; i < vertices.length; i++) {
      const at = vertices[i]! * 3;
      out[at] += w * deltas[i * 3]!;
      out[at + 1] += w * deltas[i * 3 + 1]!;
      out[at + 2] += w * deltas[i * 3 + 2]!;
    }
  }
  return out;
}

/**
 * The table on another mesh, whose vertex `v` was made from the table's vertex `sourceOf[v]`, or from none where it is -1.
 * A vertex split in two (at a UV seam, say) moves as its source did.
 */
export function remapFaces(table: FaceTable, sourceOf: Int32Array): FaceTable {
  const entry = new Int32Array(table.vertexCount);
  const side = (s: FaceSide): FaceSide => {
    entry.fill(-1);
    for (let i = 0; i < s.vertices.length; i++) entry[s.vertices[i]!] = i;
    const vertices: number[] = [];
    const deltas: number[] = [];
    for (let v = 0; v < sourceOf.length; v++) {
      const from = sourceOf[v]!;
      const i = from >= 0 && from < table.vertexCount ? entry[from]! : -1;
      if (i < 0) continue;
      vertices.push(v);
      deltas.push(s.deltas[i * 3]!, s.deltas[i * 3 + 1]!, s.deltas[i * 3 + 2]!);
    }
    return { vertices: Uint32Array.from(vertices), deltas: Float32Array.from(deltas) };
  };
  return { vertexCount: sourceOf.length, modifiers: table.modifiers.map((m) => ({ minus: side(m.minus), plus: side(m.plus) })) };
}
