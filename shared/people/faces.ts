// Face modifiers as the client gets them: for each of a look's 32 face bytes, a sparse delta on the head's vertices at
// -1 and at +1. A face is the head's vertices plus each modifier's delta scaled by its byte (blendFace), each vertex then
// held inside the hit head (clampFace). The table is cooked by tools/makehuman/faces.ts, which cuts a modifier only where
// it alone would leave that bound.
//
// Bytes, little-endian: "FACE", a version byte, the modifier count, a flags byte, a zero byte, the vertex count (u32);
// then for each modifier its minus side and its plus side, each a step in metres (f32), an entry count (u32), the vertex
// indices as gaps (each the index less the last one less 1, the first the index itself) in base-128 varints, and three
// signed bytes an entry: the delta in steps. With FLAG_ROWS, then the face rows: an entry count (u32), the vertices as
// gaps, a row byte an entry and a share byte an entry (0 to 255); then the pivots, FACE_PIVOTS x, y, z (f32); then for
// each side of each modifier, minus then plus, how far it moves each pivot (f32).

import { B_HEAD, B_HIPS, HUMAN } from "../anim/human.ts";
import { FACE_COUNT, LOOK_FACE } from "../anim/look.ts";
import { len3 } from "../math/scalar.ts";

export const FACES_VERSION = 1;
const MAGIC = [0x46, 0x41, 0x43, 0x45];
/** The most steps a delta component holds. */
const STEPS = 127;
/** The table carries face rows and pivots. */
const FLAG_ROWS = 1;

/**
 * The bone rows a body drawn at its finest level takes past its skeleton's: the jaw, each eye's upper lid, each eye.
 * Row r is the body's first bone plus HUMAN_BONES plus r. The server never sees them.
 */
export const FACE_JAW = 0;
export const FACE_LID_L = 1;
export const FACE_LID_R = 2;
export const FACE_EYE_L = 3;
export const FACE_EYE_R = 4;
export const FACE_ROWS = 5;
/** The points face rows turn about, in the head's rest: the jaw's joint, the left eye's middle, the right eye's. */
export const FACE_PIVOTS = 3;
export const PIVOT_JAW = 0;
export const PIVOT_EYE_L = 1;
export const PIVOT_EYE_R = 2;

/** Vertices that follow a face row: for each, in increasing order, its row and the share of its head weight the row takes. */
export interface FaceRows {
  readonly vertices: Uint32Array;
  readonly row: Uint8Array;
  readonly share: Float32Array;
}

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
  /** The face rows, the pivots at neutral (FACE_PIVOTS x, y, z), and each side's move of them, minus then plus a modifier. */
  readonly rows?: FaceRows;
  readonly pivots?: Float32Array;
  readonly pivotMoves?: Float32Array;
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
  const withRows = table.rows !== undefined && table.pivots !== undefined && table.pivotMoves !== undefined;
  const out: number[] = [...MAGIC, FACES_VERSION, table.modifiers.length, withRows ? FLAG_ROWS : 0, 0];
  const u32 = (v: number): void => {
    out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  };
  const f32 = new DataView(new ArrayBuffer(4));
  const float = (v: number): void => {
    f32.setFloat32(0, v, true);
    out.push(f32.getUint8(0), f32.getUint8(1), f32.getUint8(2), f32.getUint8(3));
  };
  const gaps = (vertices: ArrayLike<number>, kept: readonly number[]): void => {
    let last = -1;
    for (const i of kept) {
      let gap = vertices[i]! - last - 1;
      last = vertices[i]!;
      while (gap >= 128) {
        out.push((gap & 127) | 128);
        gap = Math.floor(gap / 128);
      }
      out.push(gap);
    }
  };
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
      gaps(side.vertices, kept);
      for (const i of kept) for (let k = 0; k < 3; k++) out.push(quantise(side.deltas[i * 3 + k]!, step) & 255);
    }
  }
  if (withRows) {
    const rows = table.rows!;
    const kept: number[] = [];
    for (let i = 0; i < rows.vertices.length; i++) {
      if (i > 0 && rows.vertices[i]! <= rows.vertices[i - 1]!) throw new Error("a face row's vertices must increase");
      if (rows.vertices[i]! >= table.vertexCount || rows.row[i]! >= FACE_ROWS) throw new Error(`a face row names vertex ${rows.vertices[i]} or row ${rows.row[i]}`);
      if (Math.round(rows.share[i]! * 255) > 0) kept.push(i);
    }
    u32(kept.length);
    gaps(rows.vertices, kept);
    for (const i of kept) out.push(rows.row[i]!);
    for (const i of kept) out.push(Math.min(255, Math.round(rows.share[i]! * 255)));
    if (table.pivots!.length !== FACE_PIVOTS * 3 || table.pivotMoves!.length !== table.modifiers.length * 2 * FACE_PIVOTS * 3) throw new Error("a face table's pivots do not fit its modifiers");
    for (const v of table.pivots!) float(v);
    for (const v of table.pivotMoves!) float(v);
  }
  return Uint8Array.from(out);
}

export function decodeFaces(bytes: Uint8Array): FaceTable {
  if (bytes.length < 12 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("not a face table");
  if (bytes[4] !== FACES_VERSION) throw new Error(`face table version ${bytes[4]}, not ${FACES_VERSION}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes[5]!;
  const flags = bytes[6]!;
  if ((flags & ~FLAG_ROWS) !== 0 || bytes[7] !== 0) throw new Error("a face table has flags this client does not know");
  const vertexCount = view.getUint32(8, true);
  let at = 12;
  const need = (n: number): void => {
    if (at + n > bytes.length) throw new Error("the face table is cut short");
  };
  const indices = (n: number): Uint32Array => {
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
    return vertices;
  };
  const floats = (n: number): Float32Array => {
    need(n * 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(at + i * 4, true);
    at += n * 4;
    return out;
  };
  const side = (): FaceSide => {
    need(8);
    const step = view.getFloat32(at, true);
    const n = view.getUint32(at + 4, true);
    at += 8;
    const vertices = indices(n);
    need(n * 3);
    const deltas = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) deltas[i] = view.getInt8(at + i) * step;
    at += n * 3;
    return { vertices, deltas };
  };
  const modifiers: FaceModifierDeltas[] = [];
  for (let m = 0; m < count; m++) modifiers.push({ minus: side(), plus: side() });
  if ((flags & FLAG_ROWS) === 0) {
    if (at !== bytes.length) throw new Error("the face table runs on past its modifiers");
    return { vertexCount, modifiers };
  }
  need(4);
  const n = view.getUint32(at, true);
  at += 4;
  const vertices = indices(n);
  need(n * 2);
  const row = bytes.slice(at, at + n);
  if (row.some((r) => r >= FACE_ROWS)) throw new Error("a face row is past the rows a body takes");
  const share = Float32Array.from(bytes.subarray(at + n, at + n * 2), (b) => b / 255);
  at += n * 2;
  const pivots = floats(FACE_PIVOTS * 3);
  const pivotMoves = floats(count * 2 * FACE_PIVOTS * 3);
  if (at !== bytes.length) throw new Error("the face table runs on past its pivots");
  return { vertexCount, modifiers, rows: { vertices, row, share }, pivots, pivotMoves };
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
  const out: FaceTable = { vertexCount: sourceOf.length, modifiers: table.modifiers.map((m) => ({ minus: side(m.minus), plus: side(m.plus) })) };
  if (!table.rows || !table.pivots || !table.pivotMoves) return out;
  const rows = table.rows;
  entry.fill(-1);
  for (let i = 0; i < rows.vertices.length; i++) entry[rows.vertices[i]!] = i;
  const vertices: number[] = [], row: number[] = [], share: number[] = [];
  for (let v = 0; v < sourceOf.length; v++) {
    const from = sourceOf[v]!;
    const i = from >= 0 && from < table.vertexCount ? entry[from]! : -1;
    if (i < 0) continue;
    vertices.push(v);
    row.push(rows.row[i]!);
    share.push(rows.share[i]!);
  }
  return { ...out, rows: { vertices: Uint32Array.from(vertices), row: Uint8Array.from(row), share: Float32Array.from(share) }, pivots: table.pivots, pivotMoves: table.pivotMoves };
}

/** The pivots of the face of `values`: each at neutral plus every side's move of it by its value's size. */
export function facePivots(table: FaceTable, values: ArrayLike<number>, out: Float32Array): Float32Array {
  const p = table.pivots, moves = table.pivotMoves;
  for (let k = 0; k < FACE_PIVOTS * 3; k++) out[k] = p ? p[k]! : 0;
  if (!moves) return out;
  for (let m = 0; m < table.modifiers.length; m++) {
    const v = values[m] ?? 0;
    if (v === 0) continue;
    const at = (m * 2 + (v > 0 ? 1 : 0)) * FACE_PIVOTS * 3, w = v > 0 ? v : -v;
    for (let k = 0; k < FACE_PIVOTS * 3; k++) out[k] += w * moves[at + k]!;
  }
  return out;
}

// ---- The bound ----------------------------------------------------------------------------------------------------

/** How much farther out than the neutral head a face may put a vertex the neutral head already has outside the bound. */
export const OUTSIDE_TOLERANCE = 0.001;

/**
 * How far past the hit head's capsule a face may reach, in metres: half of look.ts HEAD_SLACK, which is the room for
 * where the head is across poses. With all of it, his face with every slider at +1 drew 94.9% of its pixels as head.
 */
export const FACE_SLACK = 0.01;

/** The hit head as the drawn head meets it at rest: its capsule's ends and radius grown by FACE_SLACK, in model space. */
export interface HeadBound {
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly r: number;
  /** Where the drawn head's joint is, on foot at rest (look.ts lookJoints), and where it rests on the body's own rig. */
  readonly drawn: readonly number[];
  readonly rig: readonly number[];
}

/** The bound for a body cooked on `rig`, a rest of HUMAN's bones. */
export function headBound(rig: ArrayLike<number>): HeadBound {
  const j = (arr: ArrayLike<number>, b: number): number[] => [arr[b * 3]!, arr[b * 3 + 1]!, arr[b * 3 + 2]!];
  const hit = j(HUMAN.rest, B_HEAD);
  // lookJoints keeps the hit body's lengths over the hips, so the drawn head is the rig's hips plus the hit body's reach.
  const drawn = [0, 1, 2].map((k) => rig[B_HIPS * 3 + k]! + hit[k]! - HUMAN.rest[B_HIPS * 3 + k]!);
  return {
    a: [0, 1, 2].map((k) => hit[k]! + HUMAN.capA[B_HEAD * 3 + k]!),
    b: [0, 1, 2].map((k) => hit[k]! + HUMAN.capB[B_HEAD * 3 + k]!),
    r: HUMAN.capR[B_HEAD]! + FACE_SLACK,
    drawn,
    rig: j(rig, B_HEAD),
  };
}

/** The most a vertex may be from the axis: the bound, or a little past where the neutral head already puts it. */
export const allowed = (bound: HeadBound, neutral: number): number => Math.max(bound.r, neutral + OUTSIDE_TOLERANCE);

/** Where the point (x, y, z) of the head's rest is drawn on foot at rest, the head stretched by `grow`, written to `out` at `o`. */
export function drawnAt(bound: HeadBound, grow: ArrayLike<number>, x: number, y: number, z: number, out: { [k: number]: number }, o = 0): void {
  out[o] = bound.drawn[0]! + grow[0]! * (x - bound.rig[0]!);
  out[o + 1] = bound.drawn[1]! + grow[1]! * (y - bound.rig[1]!);
  out[o + 2] = bound.drawn[2]! + grow[2]! * (z - bound.rig[2]!);
}

/** The share along the capsule's axis of its nearest point to (x, y, z), 0 at `a` and 1 at `b`. */
function along(bound: HeadBound, x: number, y: number, z: number): number {
  const sx = bound.b[0]! - bound.a[0]!, sy = bound.b[1]! - bound.a[1]!, sz = bound.b[2]! - bound.a[2]!;
  const l2 = sx * sx + sy * sy + sz * sz;
  return l2 > 0 ? Math.min(1, Math.max(0, ((x - bound.a[0]!) * sx + (y - bound.a[1]!) * sy + (z - bound.a[2]!) * sz) / l2)) : 0;
}

/** How far the drawn point (x, y, z) is from the capsule's axis. */
export function axisDistanceAt(bound: HeadBound, x: number, y: number, z: number): number {
  const t = along(bound, x, y, z);
  return len3(x - bound.a[0]! - t * (bound.b[0]! - bound.a[0]!), y - bound.a[1]! - t * (bound.b[1]! - bound.a[1]!), z - bound.a[2]! - t * (bound.b[2]! - bound.a[2]!));
}

/**
 * Holds each listed vertex of `face` (x, y, z a vertex, the head's rest) inside the bound, its head stretched by `grow`:
 * one farther from the capsule's axis than it may be (allowed, from where `neutral` puts it) is drawn in toward the axis
 * until it is not. `only` lists the vertices to hold, increasing. Returns how many it moved.
 */
export function clampFace(bound: HeadBound, grow: ArrayLike<number>, neutral: ArrayLike<number>, face: Float32Array, only: ArrayLike<number>): number {
  let moved = 0;
  const ax = bound.a[0]!, ay = bound.a[1]!, az = bound.a[2]!;
  const sx = bound.b[0]! - ax, sy = bound.b[1]! - ay, sz = bound.b[2]! - az;
  for (let i = 0; i < only.length; i++) {
    const v = only[i]! * 3;
    const qx = bound.drawn[0]! + grow[0]! * (face[v]! - bound.rig[0]!);
    const qy = bound.drawn[1]! + grow[1]! * (face[v + 1]! - bound.rig[1]!);
    const qz = bound.drawn[2]! + grow[2]! * (face[v + 2]! - bound.rig[2]!);
    const t = along(bound, qx, qy, qz);
    const cx = ax + t * sx, cy = ay + t * sy, cz = az + t * sz;
    const d = len3(qx - cx, qy - cy, qz - cz);
    if (d <= bound.r) continue;
    const nx = bound.drawn[0]! + grow[0]! * (neutral[v]! - bound.rig[0]!);
    const ny = bound.drawn[1]! + grow[1]! * (neutral[v + 1]! - bound.rig[1]!);
    const nz = bound.drawn[2]! + grow[2]! * (neutral[v + 2]! - bound.rig[2]!);
    const limit = allowed(bound, axisDistanceAt(bound, nx, ny, nz));
    if (d <= limit) continue;
    // Drawn in along the line to its nearest point of the axis, then back into the head's rest.
    const k = limit / d;
    face[v] = bound.rig[0]! + (cx + (qx - cx) * k - bound.drawn[0]!) / grow[0]!;
    face[v + 1] = bound.rig[1]! + (cy + (qy - cy) * k - bound.drawn[1]!) / grow[1]!;
    face[v + 2] = bound.rig[2]! + (cz + (qz - cz) * k - bound.drawn[2]!) / grow[2]!;
    moved++;
  }
  return moved;
}
