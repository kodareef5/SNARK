// Statics parts coded other ways, to see what each would save before any is built (planning/workstreams/maps-v3.md, phase 4):
//
//   bun tools/map/encode-trial.ts <file.snmap> [--parts 40] [--quality 11]
//
// Each statics part's own pieces are decoded and coded again as today (which must give its bytes back), then:
//   steps   x, y and z as the change in the step from the piece before, so a row of bays at any turn repeats exactly;
//   turned  the step in the frame of the turn of the piece before, rounded, and a byte a piece that makes it exact;
//   kinds   each chunk's pieces in order of kind, then place: what an order by kind could save at most, since a building
//           keeps its pieces by storey and the buildings part names their runs.
// Bent pieces' extra numbers are kept as they are in every way. It prints the Brotli bytes of each way over the parts tried.

import { brotliCompressSync, constants } from "node:zlib";
import { readFileSync } from "node:fs";
import { CHUNK_SIZE, STRUCT_UNITS, chunkAt } from "../../shared/coords.ts";
import { detCos, detSin } from "../../shared/math/scalar.ts";
import { partsOf, readHead, readPart, squareOf, type StaticsPiece } from "../../shared/world/mapfile.ts";

/** Bytes of a part's columns: `n` rows of 13 bytes as planes. */
const ROW = 13;

/** A difference modulo 2^24, zigzagged, as the map writes it. */
const zigzag = (v: number): number => ((v = (v << 8) >> 8), (v << 1) ^ (v >> 31));

/** The columns of `n` pieces as planes, the place columns given by `place(i, axis)` as already-made 24-bit numbers. */
function columns(n: number, id: ArrayLike<number>, yawDelta: (i: number) => number, place: (i: number, axis: number) => number): Uint8Array {
  const b = new Uint8Array(n * ROW);
  const plane = (column: number, i: number, v: number, bytes: number): void => {
    for (let k = 0; k < bytes; k++) b[(column + k) * n + i] = v >>> (8 * k);
  };
  for (let i = 0; i < n; i++) {
    plane(0, i, id[i]!, 2);
    plane(2, i, yawDelta(i), 2);
    plane(4, i, place(i, 0), 3);
    plane(7, i, place(i, 1), 3);
    plane(10, i, place(i, 2), 3);
  }
  return b;
}

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".snmap"));
if (!file) {
  console.error("bun tools/map/encode-trial.ts <file.snmap> [--parts 40] [--quality 11]");
  process.exit(2);
}
const most = args.includes("--parts") ? Number(args[args.indexOf("--parts") + 1]) : Infinity;
const quality = args.includes("--quality") ? Number(args[args.indexOf("--quality") + 1]) : 11;
const bytes = new Uint8Array(readFileSync(file));
const head = readHead(bytes, false);
const br = (b: Uint8Array): number => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

const statics = partsOf(bytes).filter((p) => p.part?.kind === "statics").sort((a, b) => b.bytes.length - a.bytes.length).slice(0, most);
const sum = { parts: 0, pieces: 0, today: 0, again: 0, steps: 0, kinds: 0, turned: 0, columns: 0, mismatched: 0 };
/** Each turn's cosine and sine, made as first asked for. */
const COS = new Float64Array(65536).fill(NaN), SIN = new Float64Array(65536).fill(NaN);
let decodeMs = 0, readToday = 0, readTurned = 0;
for (const { part, bytes: raw } of statics) {
  const t0 = performance.now();
  const piece = readPart(head, part!, raw, false) as StaticsPiece;
  decodeMs += performance.now() - t0;
  const n = new DataView(raw.buffer, raw.byteOffset).getUint32(0, true);
  const rest = raw.subarray(4 + n * ROW);
  const sq = squareOf(head.dims, 16, part!.col, part!.row)!;
  const [x0, z0] = [sq.ox * CHUNK_SIZE * STRUCT_UNITS, sq.oz * CHUNK_SIZE * STRUCT_UNITS];
  const ux = Int32Array.from({ length: n }, (_, i) => Math.round(piece.x[i]! * STRUCT_UNITS) - x0);
  const uy = Int32Array.from({ length: n }, (_, i) => Math.round(piece.y[i]! * STRUCT_UNITS));
  const uz = Int32Array.from({ length: n }, (_, i) => Math.round(piece.z[i]! * STRUCT_UNITS) - z0);
  const axis = [ux, uy, uz];
  const yawDelta = (order: ArrayLike<number>) => (i: number): number => (piece.yaw[order[i]!]! - (i > 0 ? piece.yaw[order[i - 1]!]! : 0)) & 0xffff;
  const identity = Uint32Array.from({ length: n }, (_, i) => i);
  const bent = new Set(Array.from(piece.bendAt));
  // Today: the change from the piece before (a bent piece after a bent piece is coded otherwise; its bytes are kept).
  const today = columns(n, piece.id, yawDelta(identity), (i, a) => zigzag(axis[a]![i]! - (i > 0 ? axis[a]![i - 1]! : 0)));
  const original = raw.subarray(4, 4 + n * ROW);
  let mismatch = 0;
  for (let k = 0; k < today.length; k++) if (today[k] !== original[k]) mismatch++;
  const kept = (made: Uint8Array): Uint8Array => {
    // Where today's coding of a bent piece differs from the plain one, the trial keeps the part's own bytes for it.
    if (bent.size === 0) return made;
    const out = made.slice();
    for (const i of bent) for (let c = 0; c < ROW; c++) out[c * n + i] = original[c * n + i]!;
    return out;
  };
  const steps = columns(n, piece.id, yawDelta(identity), (i, a) => {
    const v = axis[a]!;
    const guess = i > 1 ? 2 * v[i - 1]! - v[i - 2]! : i > 0 ? v[i - 1]! : 0;
    return zigzag(v[i]! - guess);
  });
  // The step turned into the frame of the turn of the piece before, and the exact correction that makes it whole again.
  const fix = new Uint8Array(n);
  const turnedAt = (i: number, a: number): number => {
    if (i === 0 || a === 1) return zigzag(axis[a]![i]! - (i > 0 ? axis[a]![i - 1]! : 0));
    const t = (piece.yaw[i - 1]! / 65536) * 2 * Math.PI, c = detCos(t), sn = detSin(t);
    const dx = ux[i]! - ux[i - 1]!, dz = uz[i]! - uz[i - 1]!;
    const rx = Math.round(dx * c - dz * sn), rz = Math.round(dx * sn + dz * c);
    if (a === 0) {
      const ex = dx - Math.round(rx * c + rz * sn), ez = dz - Math.round(-rx * sn + rz * c);
      if (Math.abs(ex) > 7 || Math.abs(ez) > 7) throw new Error(`a correction of ${ex}, ${ez}`);
      fix[i] = zigzag(ex) | (zigzag(ez) << 4);
    }
    return zigzag(a === 0 ? rx : rz);
  };
  const turned = columns(n, piece.id, yawDelta(identity), turnedAt);
  // What reading each way back costs, both from their planes: today's sums of steps, and the turned steps turned back and corrected.
  const sx = new Int32Array(n), sz = new Int32Array(n);
  const unzig = (v: number): number => (v >>> 1) ^ -(v & 1);
  const three = (b: Uint8Array, column: number, i: number): number => unzig(b[column * n + i]! | (b[(column + 1) * n + i]! << 8) | (b[(column + 2) * n + i]! << 16));
  let t1 = performance.now();
  for (let i = 1; i < n; i++) {
    sx[i] = (sx[i - 1]! + three(today, 4, i)) & 0xffffff;
    sz[i] = (sz[i - 1]! + three(today, 10, i)) & 0xffffff;
  }
  readToday += performance.now() - t1;
  t1 = performance.now();
  for (let i = 1; i < n; i++) {
    const w = piece.yaw[i - 1]!;
    if (Number.isNaN(COS[w]!)) [COS[w], SIN[w]] = [detCos((w / 65536) * 2 * Math.PI), detSin((w / 65536) * 2 * Math.PI)];
    const c = COS[w]!, sn = SIN[w]!, rx = three(turned, 4, i), rz = three(turned, 10, i), f = fix[i]!;
    sx[i] = (sx[i - 1]! + Math.round(rx * c + rz * sn) + unzig(f & 15)) & 0xffffff;
    sz[i] = (sz[i - 1]! + Math.round(-rx * sn + rz * c) + unzig(f >> 4)) & 0xffffff;
  }
  readTurned += performance.now() - t1;
  const chunk = Uint32Array.from({ length: n }, (_, i) => chunkAt(head.dims, piece.x[i]!, piece.z[i]!));
  const byKind = Array.from(identity).sort((a, b) => chunk[a]! - chunk[b]! || piece.id[a]! - piece.id[b]! || uy[a]! - uy[b]! || ux[a]! - ux[b]! || uz[a]! - uz[b]! || a - b);
  const kinds = columns(n, Uint16Array.from(byKind, (k) => piece.id[k]!), yawDelta(byKind), (i, a) => zigzag(axis[a]![byKind[i]!]! - (i > 0 ? axis[a]![byKind[i - 1]!]! : 0)));
  const whole = (cols: Uint8Array, extra: Uint8Array = new Uint8Array(0)): Uint8Array => {
    const out = new Uint8Array(4 + cols.length + extra.length + rest.length);
    out.set(raw.subarray(0, 4));
    out.set(cols, 4);
    out.set(extra, 4 + cols.length);
    out.set(rest, 4 + cols.length + extra.length);
    return out;
  };
  sum.parts++;
  sum.pieces += n;
  sum.today += br(raw);
  sum.again += br(whole(kept(today)));
  sum.steps += br(whole(kept(steps)));
  sum.kinds += br(whole(kinds));
  sum.turned += br(whole(kept(turned), fix));
  sum.columns += n * ROW;
  sum.mismatched += mismatch;
}
const pct = (v: number): string => `${((v / sum.today - 1) * 100).toFixed(1)}%`;
console.log(`${sum.parts} statics parts of ${head.id}, ${sum.pieces} pieces, Brotli ${quality}; decode ${decodeMs.toFixed(0)} ms`);
console.log(`reading the steps back: today ${readToday.toFixed(0)} ms, turned ${readTurned.toFixed(0)} ms, of a part's whole decode ${decodeMs.toFixed(0)} ms`);
console.log(`today     ${(sum.today / 1e6).toFixed(2)} MB`);
console.log(`again     ${(sum.again / 1e6).toFixed(2)} MB ${pct(sum.again)} (${sum.mismatched} column bytes differ from the part's: bent pieces)`);
console.log(`steps     ${(sum.steps / 1e6).toFixed(2)} MB ${pct(sum.steps)}`);
console.log(`turned    ${(sum.turned / 1e6).toFixed(2)} MB ${pct(sum.turned)} (with a byte a piece that makes it exact)`);
console.log(`kinds     ${(sum.kinds / 1e6).toFixed(2)} MB ${pct(sum.kinds)} (at most: an order by kind within a storey keeps less)`);
