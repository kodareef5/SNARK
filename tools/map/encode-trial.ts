// Statics parts coded other ways, to see what each would save before any is built (planning/workstreams/maps-v3.md, phase 4):
//
//   bun tools/map/encode-trial.ts <file.snmap> [--parts 40] [--quality 11]
//
// Each statics part is taken apart where the reader takes it (shared/world/mapfile.ts readStatics: its own kinds' table,
// its count, its columns, its bent pieces) and its columns coded again as today, which must give the part's bytes back
// exactly, then:
//   steps   x, y and z as the change in the step from the piece before, so a row of bays at any turn repeats exactly;
//   turned  the step in the frame of the turn of the piece before, rounded, and a byte a piece that makes it exact;
//   kinds   each chunk's pieces in order of kind, then place: what an order by kind could save at most, since a building
//           keeps its pieces by storey and the buildings part names their runs.
// A bent piece after a bent piece is coded against where the one before's line puts it, as today, in every way but kinds,
// and the bent pieces' own numbers are kept as they are. Every way is decoded again and must give the same kinds, turns
// and places in the same order (kinds: in its own order); the trial stops where one does not. It prints the Brotli bytes
// of each way over the parts tried.

import { brotliCompressSync, constants } from "node:zlib";
import { readFileSync } from "node:fs";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../shared/coords.ts";
import { detCos, detSin } from "../../shared/math/scalar.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { bentNext } from "../../shared/world/bends.ts";
import { partsOf, readHead, readPart, squareOf, type StaticsPiece } from "../../shared/world/mapfile.ts";

/** Bytes of a row of a part's columns: kind, turn, x, y and z, as planes. */
const ROW = 13;

/** A part's rows as its columns code them: its own kind, turn, and place in 1/512 m from its square's corner. */
interface Rows { id: Uint16Array; yaw: Uint16Array; x: Int32Array; y: Int32Array; z: Int32Array }
type Way = "today" | "steps" | "turned";
/** For a bent piece after a bent piece, the two pieces' bends; null for any other. */
type Pair = (i: number) => readonly [ArrayLike<number>, ArrayLike<number>] | null;

/** A difference modulo 2^24, zigzagged, as the map writes it. */
const zigzag = (v: number): number => ((v = (v << 8) >> 8), (v << 1) ^ (v >> 31));
const unzig = (v: number): number => (v >>> 1) ^ -(v & 1);
const next = [0, 0, 0, 0];

/** Where a v15 statics part's own kinds, count, columns and what follows them are, as readStatics reads it. */
function layout(raw: Uint8Array): { names: string[]; n: number; cols: number; rest: number } {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const names: string[] = [];
  let at = 2;
  for (let k = view.getUint16(0, true); k > 0; k--) {
    const r = new BitReader(raw.subarray(at));
    names.push(r.string(255));
    if (r.overflow) throw new Error("a statics part's kinds run past its end");
    at += r.pos >>> 3;
  }
  const n = view.getUint32(at, true);
  return { names, n, cols: at + 4, rest: at + 4 + n * ROW };
}

/** Each turn's cosine and sine, made as first asked for. */
const COS = new Float64Array(65536).fill(NaN), SIN = new Float64Array(65536).fill(NaN);
function turnOf(w: number): [number, number] {
  if (Number.isNaN(COS[w]!)) [COS[w], SIN[w]] = [detCos((w / 65536) * 2 * Math.PI), detSin((w / 65536) * 2 * Math.PI)];
  return [COS[w]!, SIN[w]!];
}

/** The rows' columns coded `way`, and for turned a byte a row that makes its turned step exact. */
function encode(r: Rows, way: Way, pair: Pair): { cols: Uint8Array; fix: Uint8Array } {
  const n = r.id.length, b = new Uint8Array(n * ROW), fix = new Uint8Array(way === "turned" ? n : 0);
  const plane = (column: number, i: number, v: number, bytes: number): void => {
    for (let k = 0; k < bytes; k++) b[(column + k) * n + i] = v >>> (8 * k);
  };
  for (let i = 0; i < n; i++) {
    const p = i - 1;
    let [gx, gy, gz, gyaw] = p >= 0 ? [r.x[p]!, r.y[p]!, r.z[p]!, r.yaw[p]!] : [0, 0, 0, 0];
    const bent = pair(i);
    let [dx, dz] = [0, 0];
    if (bent) {
      bentNext(gx, gy, gz, gyaw, bent[0], bent[1], next);
      [gx, gy, gz, gyaw] = next as [number, number, number, number];
    } else if (way === "steps" && i > 1) {
      [gx, gy, gz] = [2 * gx - r.x[p - 1]!, 2 * gy - r.y[p - 1]!, 2 * gz - r.z[p - 1]!];
    } else if (way === "turned" && i > 0) {
      const [c, sn] = turnOf(r.yaw[p]!), sx = r.x[i]! - gx, sz = r.z[i]! - gz;
      [dx, dz] = [Math.round(sx * c - sz * sn), Math.round(sx * sn + sz * c)];
      const ex = sx - Math.round(dx * c + dz * sn), ez = sz - Math.round(-dx * sn + dz * c);
      if (Math.abs(ex) > 7 || Math.abs(ez) > 7) throw new Error(`a turned step needs a correction of ${ex}, ${ez}, more than a byte holds`);
      fix[i] = zigzag(ex) | (zigzag(ez) << 4);
    }
    const turned = way === "turned" && i > 0 && !bent;
    plane(0, i, r.id[i]!, 2);
    plane(2, i, r.yaw[i]! - gyaw, 2);
    plane(4, i, zigzag(turned ? dx : r.x[i]! - gx), 3);
    plane(7, i, zigzag(r.y[i]! - gy), 3);
    plane(10, i, zigzag(turned ? dz : r.z[i]! - gz), 3);
  }
  return { cols: b, fix };
}

/** The rows `encode` coded `way` into `b`, read back as a reader would. */
function decode(b: Uint8Array, n: number, way: Way, pair: Pair, fix: Uint8Array): Rows {
  const r: Rows = { id: new Uint16Array(n), yaw: new Uint16Array(n), x: new Int32Array(n), y: new Int32Array(n), z: new Int32Array(n) };
  const three = (column: number, i: number): number => unzig(b[column * n + i]! | (b[(column + 1) * n + i]! << 8) | (b[(column + 2) * n + i]! << 16));
  for (let i = 0; i < n; i++) {
    const p = i - 1;
    let [gx, gy, gz, gyaw] = p >= 0 ? [r.x[p]!, r.y[p]!, r.z[p]!, r.yaw[p]!] : [0, 0, 0, 0];
    const bent = pair(i);
    let [dx, dz] = [three(4, i), three(10, i)];
    if (bent) {
      bentNext(gx, gy, gz, gyaw, bent[0], bent[1], next);
      [gx, gy, gz, gyaw] = next as [number, number, number, number];
    } else if (way === "steps" && i > 1) {
      [gx, gy, gz] = [2 * gx - r.x[p - 1]!, 2 * gy - r.y[p - 1]!, 2 * gz - r.z[p - 1]!];
    } else if (way === "turned" && i > 0) {
      const [c, sn] = turnOf(r.yaw[p]!), f = fix[i]!;
      [dx, dz] = [Math.round(dx * c + dz * sn) + unzig(f & 15), Math.round(-dx * sn + dz * c) + unzig(f >> 4)];
    }
    r.id[i] = b[i]! | (b[n + i]! << 8);
    r.yaw[i] = (gyaw + (b[2 * n + i]! | (b[3 * n + i]! << 8))) & 0xffff;
    r.x[i] = (gx + dx) & 0xffffff;
    r.y[i] = ((gy + three(7, i)) << 8) >> 8;
    r.z[i] = (gz + dz) & 0xffffff;
  }
  return r;
}

/** Throws, naming the part, the way and the first row, where two sets of rows differ. */
function same(a: Rows, b: Rows, what: string): void {
  for (const f of ["id", "yaw", "x", "y", "z"] as const) {
    const i = a[f].findIndex((v, k) => v !== b[f][k]);
    if (i >= 0) throw new Error(`${what}: row ${i}'s ${f} decodes as ${b[f][i]}, not ${a[f][i]}`);
  }
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
const kindOf = new Map(head.kinds.map((k, i) => [k, i]));

const statics = partsOf(bytes).filter((p) => p.part?.kind === "statics").sort((a, b) => b.bytes.length - a.bytes.length).slice(0, most);
const sum = { parts: 0, pieces: 0, bent: 0, today: 0, steps: 0, kinds: 0, turned: 0 };
let decodeMs = 0, readToday = 0, readSteps = 0, readTurned = 0;
for (const { name, part, bytes: raw } of statics) {
  const t0 = performance.now();
  const piece = readPart(head, part!, raw, false) as StaticsPiece;
  decodeMs += performance.now() - t0;
  const { names, n, cols, rest } = layout(raw);
  const local = new Map(names.map((k, i) => [kindOf.get(k)!, i]));
  const sq = squareOf(head.dims, 16, part!.col, part!.row)!;
  const [x0, z0] = [sq.ox * CHUNK_SIZE * STRUCT_UNITS, sq.oz * CHUNK_SIZE * STRUCT_UNITS];
  // The reader's own pieces come first, before the collision pieces it makes under bent ones.
  const rows: Rows = {
    id: Uint16Array.from({ length: n }, (_, i) => local.get(piece.id[i]!)!),
    yaw: piece.yaw.slice(0, n),
    x: Int32Array.from({ length: n }, (_, i) => Math.round(piece.x[i]! * STRUCT_UNITS) - x0),
    y: Int32Array.from({ length: n }, (_, i) => Math.round(piece.y[i]! * STRUCT_UNITS)),
    z: Int32Array.from({ length: n }, (_, i) => Math.round(piece.z[i]! * STRUCT_UNITS) - z0),
  };
  const bendOf = new Int32Array(n).fill(-1);
  piece.bendAt.forEach((i, q) => { bendOf[i] = q; });
  const bend = (q: number): Int16Array => piece.bend.subarray(q * 8, q * 8 + 8);
  const pair: Pair = (i) => (i > 0 && bendOf[i]! > 0 && bendOf[i - 1]! === bendOf[i]! - 1 ? [bend(bendOf[i - 1]!), bend(bendOf[i]!)] : null);
  const whole = (c: Uint8Array, extra: Uint8Array = new Uint8Array(0)): Uint8Array => {
    const out = new Uint8Array(cols + c.length + extra.length + raw.length - rest);
    out.set(raw.subarray(0, cols));
    out.set(c, cols);
    out.set(extra, cols + c.length);
    out.set(raw.subarray(rest), cols + c.length + extra.length);
    return out;
  };
  const trial = (r: Rows, way: Way, p: Pair, what: string): { coded: Uint8Array; ms: number } => {
    const { cols: c, fix } = encode(r, way, p);
    const t1 = performance.now();
    const back = decode(c, n, way, p, fix);
    const ms = performance.now() - t1;
    same(r, back, `${name}, ${what}`);
    return { coded: whole(c, fix), ms };
  };

  const today = trial(rows, "today", pair, "today");
  const k = today.coded.findIndex((v, i) => v !== raw[i]);
  if (k >= 0 || today.coded.length !== raw.length) throw new Error(`${name}: today's coding does not give the part's bytes back (first at byte ${k}, ${today.coded.length} bytes for ${raw.length})`);
  readToday += today.ms;
  same(rows, decode(raw.subarray(cols, rest), n, "today", pair, new Uint8Array(0)), `${name}, the part's own columns`);
  const steps = trial(rows, "steps", pair, "steps");
  readSteps += steps.ms;
  const turned = trial(rows, "turned", pair, "turned");
  readTurned += turned.ms;
  const byKind = Array.from({ length: n }, (_, i) => i).sort((a, b) => piece.chunk[a]! - piece.chunk[b]! || rows.id[a]! - rows.id[b]! || rows.y[a]! - rows.y[b]! || rows.x[a]! - rows.x[b]! || rows.z[a]! - rows.z[b]! || a - b);
  const sorted: Rows = { id: Uint16Array.from(byKind, (i) => rows.id[i]!), yaw: Uint16Array.from(byKind, (i) => rows.yaw[i]!), x: Int32Array.from(byKind, (i) => rows.x[i]!), y: Int32Array.from(byKind, (i) => rows.y[i]!), z: Int32Array.from(byKind, (i) => rows.z[i]!) };
  const kinds = trial(sorted, "today", () => null, "kinds");

  sum.parts++;
  sum.pieces += n;
  sum.bent += piece.bendAt.length;
  sum.today += br(raw);
  sum.steps += br(steps.coded);
  sum.turned += br(turned.coded);
  sum.kinds += br(kinds.coded);
}
const pct = (v: number): string => `${((v / sum.today - 1) * 100).toFixed(1)}%`;
console.log(`${sum.parts} statics parts of ${head.id}, ${sum.pieces} pieces (${sum.bent} bent), Brotli ${quality}; each part's bytes coded again as today, and every way decoded back to its rows`);
console.log(`reading the columns back: today ${readToday.toFixed(0)} ms, steps ${readSteps.toFixed(0)} ms, turned ${readTurned.toFixed(0)} ms; the parts' whole decode ${decodeMs.toFixed(0)} ms`);
console.log(`today     ${(sum.today / 1e6).toFixed(2)} MB`);
console.log(`steps     ${(sum.steps / 1e6).toFixed(2)} MB ${pct(sum.steps)}`);
console.log(`turned    ${(sum.turned / 1e6).toFixed(2)} MB ${pct(sum.turned)} (with a byte a piece that makes it exact)`);
console.log(`kinds     ${(sum.kinds / 1e6).toFixed(2)} MB ${pct(sum.kinds)} (at most: an order by kind within a storey keeps less)`);
