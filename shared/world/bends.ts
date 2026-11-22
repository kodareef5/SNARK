// Bent street sections (planning/workstreams/bent-sections.md): a few modelled lengths of kerb, gutter and walk, each a
// static of a bent kind (content/bends.ts) whose instance carries a bend, by which the vertex texts lay the piece along
// the street (client/core/render/bend.ts), so one piece fits any angle, curve and corner. A piece is modelled along x
// from -MODEL_HALF to MODEL_HALF, y up from the road, z across from the kerb's face (z = 0) to the walk's back; its
// static stands at the middle of the chord between its two ends, at the road's height there, turned along the chord.
// Its bend says how long the chord is, which way the street runs at each end (so the piece follows a straight, an arc
// or an S between them), how far its end rises over its start, where it starts along its kerb line, how wide its walk
// is, its panels' length, and a seed and a wear, which its variety reads (client/core/render/bend.ts bentWear).
//
// The map's build lays the pieces (placeKerb, from a kerb line with stations and a section) and, under them, collision
// pieces of plain boxes and ramps drawn as nothing (underPiece, content/bends.ts), which servers, vehicles and the walk
// proofs meet as they meet any static: a bent kind itself is walked as nothing (StructureDef.bent). A map does not store
// the collision pieces: each reader makes them from the bends as a part is read (madeHits, mapfile.ts), the same to the
// bit on a server and a page.
//
// Only + - * / Math.floor Math.sqrt Math.abs and the det functions are used here, so a build is the same everywhere.

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { PI, TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";

/** A bend's bytes on the card and in a map: eight 16-bit numbers (packBend). */
export const BEND_BYTES = 16;
export const BEND_SHORTS = 8;
/** A piece is modelled this far either side of its middle along x. */
export const MODEL_HALF = 2;
/** The across, from the kerb's face, past which a walk is drawn wider or narrower than modelled: the kerb's top's back. */
export const KERB_BACK = 0.3;
/** Where a modelled walk's back is, from the kerb's face. */
export const MODEL_WALK = 2;
/** The kerb's height over the road. */
export const KERB_HEIGHT = 0.15;
/**
 * Metres along a kerb line after which its stations start again: a whole number of every panel length, of the strip's
 * 4 m and of the sag's waves (`sag`), so that nothing drawn by the station jumps where it wraps.
 */
export const STATION_WRAP = 600;
/** Steps a radian of a bend's turns. */
const ANGLE = 8192;

/** A piece's bend, decoded. */
export interface Bend {
  /** Half the chord from its start to its end, in metres. */
  readonly half: number;
  /** How far the street's way at its start and at its end is turned from the chord, in radians, toward the walk (+z) positive. */
  readonly turn0: number;
  readonly turn1: number;
  /** How far along its kerb line its start is, in metres, within STATION_WRAP. */
  readonly station: number;
  /** Half how far its end stands over its start, in metres. */
  readonly rise: number;
  /** Its walk's panels' length in metres, 0 for none. */
  readonly panel: number;
  /** Its walk's back, in metres from the kerb's face. */
  readonly walk: number;
  /** 0 to 255, the same along a kerb line, and 0 to 1, how worn. */
  readonly seed: number;
  readonly wear: number;
  /**
   * Its walk let down to the ground along it, toward its end (1) or its start (-1), where a walk ends and the kerb runs
   * on alone or stops: the walk's top falls by the kerb's height from one end to the other, the kerb stays as it is.
   */
  readonly sink?: -1 | 0 | 1;
  /** A crossing's ramp: its walk's apron dimpled, as a flush kerb's is where people cross (bentWear). */
  readonly tactile?: boolean;
}

const round = (v: number): number => Math.floor(v + 0.5);
const short = (v: number): number => clamp(round(v), -32768, 32767);

/** `b` as eight 16-bit numbers at `at` of `out`, as the card reads them (attributes 13 and 14, BENT_VERTEX). */
export function packBend(out: Int16Array, at: number, b: Bend): void {
  out[at] = short(b.half * 1000);
  out[at + 1] = short(b.turn0 * ANGLE);
  out[at + 2] = short(b.turn1 * ANGLE);
  const cm = round(wrapped(b.station) * 100) % (STATION_WRAP * 100);
  out[at + 3] = cm > 32767 ? cm - 65536 : cm;
  out[at + 4] = short(b.rise * 1000);
  // The panel in the low 14 bits and a crossing's ramp in the next; the walk in the low 14 bits (to 16.38 m) and its sink in
  // the top two.
  out[at + 5] = clamp(round(b.panel * 1000), 0, FLAG - 1) | (b.tactile ? FLAG : 0);
  const walk = clamp(round(b.walk * 1000), 0, FLAG - 1) | (b.sink === 1 ? FLAG : 0) | (b.sink === -1 ? 2 * FLAG : 0);
  out[at + 6] = walk > 32767 ? walk - 65536 : walk;
  out[at + 7] = (round(clamp(b.wear, 0, 1) * 127) << 8) | (round(b.seed) & 255);
}

/** A bend from its eight numbers at `at`, as the card takes them. */
export function unpackBend(r: ArrayLike<number>, at = 0): Bend {
  const station = r[at + 3]!;
  return {
    half: r[at]! / 1000, turn0: r[at + 1]! / ANGLE, turn1: r[at + 2]! / ANGLE, station: (station < 0 ? station + 65536 : station) / 100,
    rise: r[at + 4]! / 1000, panel: (r[at + 5]! & (FLAG - 1)) / 1000, walk: (r[at + 6]! & (FLAG - 1)) / 1000, seed: r[at + 7]! & 255, wear: (r[at + 7]! >> 8) / 127,
    sink: r[at + 6]! & (2 * FLAG) ? -1 : r[at + 6]! & FLAG ? 1 : 0, tactile: (r[at + 5]! & FLAG) !== 0,
  };
}
/** The first of a bend's flag bits in its panel's and its walk's numbers. */
const FLAG = 1 << 14;

export function wrapped(station: number): number {
  return station - Math.floor(station / STATION_WRAP) * STATION_WRAP;
}

const tan = (x: number): number => detSin(x) / detCos(x);

/**
 * How long a Hermite curve's end tangents are, over its chord, to follow an arc turning `phi` radians: 4 tan(phi / 4) R
 * over a chord of 2 R sin(phi / 2), within 0.03% of the arc's radius up to a quarter turn; 1 on a straight or an S.
 */
export function handle(phi: number): number {
  const a = Math.abs(phi);
  return a < 1e-3 ? 1 + (a * a) / 16 : (2 * tan(a / 4)) / detSin(a / 2);
}

/** The length of a piece's kerb line: the arc's, chord 2 `half` turning `phi`. */
export function arcLength(half: number, phi: number): number {
  const a = Math.abs(phi);
  return a < 1e-3 ? 2 * half * (1 + (a * a) / 24) : (2 * half * (a / 2)) / detSin(a / 2);
}

/**
 * The kerb line of a piece at `u` (0 at its start, 1 at its end) in its chord's frame, x along the chord from its middle
 * and z across toward the walk, into `out`: its point, then the way it runs, of length 1. A Hermite curve between its two
 * ends and the ways the street runs at each.
 */
export function curveAt(out: Float64Array | number[], half: number, turn0: number, turn1: number, u: number): void {
  const m = 2 * half * handle(turn1 - turn0);
  const t0x = m * detCos(turn0), t0z = m * detSin(turn0), t1x = m * detCos(turn1), t1z = m * detSin(turn1);
  const u2 = u * u, u3 = u2 * u;
  const h10 = u3 - 2 * u2 + u, h11 = u3 - u2;
  out[0] = half * (6 * u2 - 4 * u3 - 1) + h10 * t0x + h11 * t1x;
  out[1] = h10 * t0z + h11 * t1z;
  const d10 = 3 * u2 - 4 * u + 1, d11 = 3 * u2 - 2 * u;
  const dx = half * (12 * u - 12 * u2) + d10 * t0x + d11 * t1x, dz = d10 * t0z + d11 * t1z;
  const l = Math.sqrt(dx * dx + dz * dz) || 1;
  out[2] = dx / l;
  out[3] = dz / l;
}

/**
 * How far a walk stands over where it is laid, at `station` along its kerb line, all of it at the walk's back and none at
 * the kerb: a slab sunk or heaved by up to 0.6 to 2.8 cm by `wear` and `seed`, in two waves whose lengths divide
 * STATION_WRAP. The same along a kerb line on every piece of it, as its seed and wear are.
 */
export function sag(station: number, seed: number, wear: number): number {
  const amount = (0.006 + 0.022 * wear) * (0.4 + (0.6 * seed) / 255);
  return amount * (0.6 * detSin((TAU * station) / 40 + seed * 0.37) + 0.4 * detSin((TAU * station) / 24 + seed * 1.3));
}

/** How much of the sag a point `across` from the kerb's face takes, its walk's back `walk` from it. */
export function sagShare(across: number, walk: number): number {
  return walk <= KERB_BACK + 0.01 ? 0 : clamp((across - KERB_BACK) / (walk - KERB_BACK), 0, 1);
}

/** The modelled across `z` as a walk of `walk` lays it: as it is up to the kerb's back, stretched past it. */
export function across(z: number, walk: number): number {
  return z <= KERB_BACK ? z : KERB_BACK + ((z - KERB_BACK) * (walk - KERB_BACK)) / (MODEL_WALK - KERB_BACK);
}

const at4 = [0, 0, 0, 0];
/** Past this across from the kerb's face a modelled point is the walk's, not the kerb's. */
export const SINK_FROM = KERB_BACK + 0.01;

/**
 * How much of a sinking walk's fall a vertex modelled at (ly, lz) takes: its height over the road as a share of the
 * kerb's, none on the kerb nor under the road. It falls by that times the kerb's height times how far along toward the
 * sink's end it is, so the walk's top comes down to the road there and nothing goes under it. The twin of BEND_GLSL's.
 */
export function sinkWeight(ly: number, lz: number): number {
  return lz <= SINK_FROM ? 0 : clamp(ly / KERB_HEIGHT, 0, 1);
}

/**
 * A vertex of a bent piece, modelled at (lx, ly, lz) with its normal and its tangent, laid along its bend as the vertex
 * texts lay it (client/core/render/bend.ts BEND_GLSL), in the piece's own frame, which its static's turn and place then
 * take to the world as any piece's: into `out` its point, its normal and its tangent (each of length 1), then how far
 * along its kerb line it is and how far across from the kerb's face.
 */
export function bendVertex(out: Float64Array | number[], b: Bend, lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, tx: number, ty: number, tz: number): void {
  const u = lx / (2 * MODEL_HALF) + 0.5;
  curveAt(at4, b.half, b.turn0, b.turn1, u);
  const [px, pz, wx, wz] = at4 as [number, number, number, number];
  const z = across(lz, b.walk);
  const length = arcLength(b.half, b.turn1 - b.turn0);
  const station = b.station + u * length;
  const lift = sag(station, b.seed, b.wear) * sagShare(z, b.walk);
  // A walk let down to the ground: its points over the walk's foot fall by up to the kerb's height, toward the sink's end.
  const sink = b.sink ?? 0, weight = sink === 0 ? 0 : sinkWeight(ly, lz), fall = weight * (sink > 0 ? u : sink < 0 ? 1 - u : 0);
  out[0] = px - wz * z;
  out[1] = ly + b.rise * (2 * u - 1) + lift - KERB_HEIGHT * fall;
  out[2] = pz + wx * z;
  // Stretched along, risen along and its walk stretched across, a piece takes its tangent through those and its normal
  // through their inverse, transposed: along by `stretch`, up by `grade` along, across by `k`.
  const stretch = length / (2 * MODEL_HALF), k = lz > KERB_BACK ? (b.walk - KERB_BACK) / (MODEL_WALK - KERB_BACK) : 1;
  const grade = (2 * b.rise - KERB_HEIGHT * sink * weight) / length;
  const na = nx / stretch - grade * ny, nc = nz / k;
  const n0 = wx * na - wz * nc, n2 = wz * na + wx * nc, nl = Math.sqrt(n0 * n0 + ny * ny + n2 * n2) || 1;
  out[3] = n0 / nl;
  out[4] = ny / nl;
  out[5] = n2 / nl;
  const ta = tx * stretch, tc = tz * k;
  const t0 = wx * ta - wz * tc, t1 = ty + grade * ta, t2 = wz * ta + wx * tc, tl = Math.sqrt(t0 * t0 + t1 * t1 + t2 * t2) || 1;
  out[6] = t0 / tl;
  out[7] = t1 / tl;
  out[8] = t2 / tl;
  out[9] = wrapped(station);
  out[10] = z;
}

// ---------------------------------------------------------------------------------------------------------------------
// Placing: a kerb line and a section give pieces.

/** What a kerb is, as the street model says (shared/world/streets.ts): raised, worn, or flush with the road (lowered, for a drive or a crossing). */
export type Kerb = "raised" | "worn" | "flush";

/**
 * A stretch of kerb as drawn: its kerb, its walk's back in metres from the kerb's face (0 for a kerb alone, a median's),
 * its panels' length, and its seed and wear. The street model's stretch and side give it (kerb, walk in eighths of a
 * metre); today the build's rules do.
 */
export interface Section {
  readonly kerb: Kerb;
  readonly walk: number;
  readonly panel: number;
  readonly seed: number;
  readonly wear: number;
}

/** Points of a kerb line on the kerb's face at the road's height, each with the way it runs there (unit) and how far along the line it is. */
export interface KerbLine {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly number[];
  /** The way it runs at each point; where left out, between its neighbours. */
  readonly dx?: readonly number[];
  readonly dz?: readonly number[];
  /** Metres along it at each point; where left out, its length from its first point, from `from`. */
  readonly stations?: readonly number[];
}

/** A bent piece as a map's static takes it: its kind, the middle of its chord at the road's height, its turn in degrees (StaticPiece's), and its bend. */
export interface BentPiece {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly bend: Bend;
  /** Its kerb, which its collision follows (underPiece): a flare to or from a flush kerb is walked as flush. */
  readonly kerb: Kerb | "median";
}

/** The pieces' kinds: a straight of one length of rings and a curve of eight, of each kerb. */
export const BENT_KERBS = ["raised", "worn", "flush", "median"] as const;
export type BentKerb = (typeof BENT_KERBS)[number];
export const bentKind = (kerb: BentKerb, curved: boolean): string => `core:zzzzzbend_${kerb}_${curved ? "c" : "s"}`;
/** The pieces that join two kerbs along their length, each way round: raised or worn and flush, raised and worn. */
export const bentJoin = (from: BentKerb, to: BentKerb): string => `core:zzzzzbend_${from}_${to}`;
/** Segments along a curved piece, and the most a piece of each runs. */
export const CURVE_SEGMENTS = 8;
const STRAIGHT_MOST = 32, CURVE_MOST = 8, LEAST = 0.4;
/** A straight runs this far where the line's heights keep within HEIGHT_MISS of its rise, and on to STRAIGHT_MOST where they keep within RISE_MISS (evenRise). */
const STRAIGHT_EVEN = 16;
/**
 * The most a straight piece's end may stand turned from its chord, as a mitre to the next, how far its chord or a curve
 * may miss the line, how far a straight's even rise past STRAIGHT_EVEN may miss the heights of the line's points along
 * it, and how far any piece's may.
 */
const MITRE = 0.035, MISS = 0.004, RISE_MISS = 0.02, HEIGHT_MISS = 0.05;

/**
 * The pieces of a kerb line, its walk on its left as `side` 1 has it (a piece's +z, a quarter counter-clockwise from the
 * way the line runs in x and z) or with `side` -1 on its right, of `section`. A piece runs between two of the
 * line's points; where the line runs straight it goes on over them, up to 16 m, and where it bends it is a curve of up to
 * 8 m, split until each of its eight segments' chords misses the curve by under 4 mm; either ends short of a point
 * whose height its rise misses by more than 5 cm. A piece's static stands at its
 * chord's middle at the road's height.
 */
export function placeKerb(line: KerbLine, side: 1 | -1, section: Section, from = 0): BentPiece[] {
  const n = line.x.length;
  if (n < 2) return [];
  // In the order that puts the walk on the left.
  const order = side === 1 ? (i: number): number => i : (i: number): number => n - 1 - i;
  const px: number[] = [], py: number[] = [], pz: number[] = [], wx: number[] = [], wz: number[] = [], st: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = order(k);
    px.push(line.x[i]!);
    py.push(line.y[i]!);
    pz.push(line.z[i]!);
  }
  let s = from;
  for (let k = 0; k < n; k++) {
    if (k > 0) s += Math.sqrt((px[k]! - px[k - 1]!) * (px[k]! - px[k - 1]!) + (pz[k]! - pz[k - 1]!) * (pz[k]! - pz[k - 1]!));
    st.push(line.stations ? (side === 1 ? line.stations[order(k)]! : line.stations[0]! + line.stations[n - 1]! - line.stations[order(k)]!) : s);
  }
  for (let k = 0; k < n; k++) {
    let dx: number, dz: number;
    if (line.dx && line.dz) [dx, dz] = [line.dx[order(k)]! * side, line.dz[order(k)]! * side];
    else {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      const ex0 = px[k]! - px[a]!, ez0 = pz[k]! - pz[a]!, ex1 = px[b]! - px[k]!, ez1 = pz[b]! - pz[k]!;
      const l0 = Math.sqrt(ex0 * ex0 + ez0 * ez0) || 1, l1 = Math.sqrt(ex1 * ex1 + ez1 * ez1) || 1;
      [dx, dz] = [(a < k ? ex0 / l0 : 0) + (b > k ? ex1 / l1 : 0), (a < k ? ez0 / l0 : 0) + (b > k ? ez1 / l1 : 0)];
    }
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    wx.push(dx / l);
    wz.push(dz / l);
  }
  const out: BentPiece[] = [];
  const kerb: BentKerb = section.walk <= KERB_BACK + 0.01 ? "median" : section.kerb;
  const frame = (i: number): Frame => ({ x: px[i]!, y: py[i]!, z: pz[i]!, dx: wx[i]!, dz: wz[i]!, s: st[i]! });
  let i = 0;
  while (i < n - 1) {
    // As far on as a straight reaches, else as far as a curve does.
    let j = i + 1;
    // A stretch too short to stand alone is taken with the next.
    while (j < n - 1 && st[j]! - st[i]! < LEAST) j++;
    // A curve where the line bends, and where a straight would run on only a little way and a curve twice as far: a
    // gentle bend is then one curve of eight segments, not straights of a metre or so.
    let straight = straightFits(px, pz, frame(i), frame(j), i, j) ? j : i;
    if (straight > i) while (straight + 1 < n && st[straight + 1]! - st[i]! <= STRAIGHT_MOST && straightFits(px, pz, frame(i), frame(straight + 1), i, straight + 1) && (st[straight + 1]! - st[i]! <= STRAIGHT_EVEN || evenRise(py, st, i, straight + 1))) straight++;
    let curve = j;
    while (curve + 1 < n && st[curve + 1]! - st[i]! <= CURVE_MOST && curveFits(px, pz, frame(i), frame(curve + 1), i, curve + 1)) curve++;
    const curved = straight === i || st[curve]! - st[i]! > 2 * (st[straight]! - st[i]!);
    j = curved ? curve : straight;
    // Short of a point whose height the piece's rise would miss: a dip, or a way in graded below the street, is followed,
    // not bridged by a kerb in the air.
    while (j > i + 1 && !evenRise(py, st, i, j, HEIGHT_MISS)) j--;
    lay(out, frame(i), frame(j), curved, kerb, section);
    i = j;
  }
  return out;
}

interface Frame { x: number; y: number; z: number; dx: number; dz: number; s: number }

/** Whether the line's heights from point i to point j keep within `miss` of an even rise between them, as a piece rises. */
function evenRise(py: readonly number[], st: readonly number[], i: number, j: number, miss = RISE_MISS): boolean {
  const span = st[j]! - st[i]! || 1e-6;
  for (let k = i + 1; k < j; k++) if (Math.abs(py[k]! - (py[i]! + ((py[j]! - py[i]!) * (st[k]! - st[i]!)) / span)) > miss) return false;
  return true;
}

/** The chord from a to b and the turns of their ways from it. */
function chordOf(a: Frame, b: Frame): { half: number; cx: number; cz: number; turn0: number; turn1: number } {
  const ex = b.x - a.x, ez = b.z - a.z, l = Math.sqrt(ex * ex + ez * ez) || 1e-6;
  const cx = ex / l, cz = ez / l;
  // +z of a piece is its chord's way turned a quarter counter-clockwise: (-cz, cx). A turn toward it is positive.
  const turn = (dx: number, dz: number): number => detAtan2(dx * -cz + dz * cx, dx * cx + dz * cz);
  return { half: l / 2, cx, cz, turn0: turn(a.dx, a.dz), turn1: turn(b.dx, b.dz) };
}

/** Whether one straight piece from a to b, its ends mitred to their ways, keeps within MISS of the line's points between them. */
function straightFits(px: readonly number[], pz: readonly number[], a: Frame, b: Frame, i: number, j: number): boolean {
  const c = chordOf(a, b);
  if (Math.abs(c.turn0) > MITRE || Math.abs(c.turn1) > MITRE) return false;
  for (let k = i + 1; k < j; k++) if (Math.abs((px[k]! - a.x) * -c.cz + (pz[k]! - a.z) * c.cx) > MISS) return false;
  return true;
}

const probe = [0, 0, 0, 0];

/** Whether one curve from a to b passes within MISS of the line's points between them and its eight segments' chords miss it by under MISS. */
function curveFits(px: readonly number[], pz: readonly number[], a: Frame, b: Frame, i: number, j: number): boolean {
  const c = chordOf(a, b);
  const phi = Math.abs(c.turn1 - c.turn0) + Math.abs(c.turn0 + c.turn1) / 2;
  if (phi > PI / 3 || segmentMiss(c.half, c.turn0, c.turn1) > MISS) return false;
  // The curve as 32 chords, in the world.
  const cx: number[] = [], cz: number[] = [];
  for (let q = 0; q <= 32; q++) {
    curveAt(probe, c.half, c.turn0, c.turn1, q / 32);
    cx.push(a.x + c.half * c.cx + probe[0]! * c.cx - probe[1]! * c.cz);
    cz.push(a.z + c.half * c.cz + probe[0]! * c.cz + probe[1]! * c.cx);
  }
  for (let k = i + 1; k < j; k++) {
    let best = Infinity;
    for (let q = 0; q < 32; q++) {
      const ex = cx[q + 1]! - cx[q]!, ez = cz[q + 1]! - cz[q]!, l2 = ex * ex + ez * ez || 1e-12;
      const t = clamp(((px[k]! - cx[q]!) * ex + (pz[k]! - cz[q]!) * ez) / l2, 0, 1);
      const dx = cx[q]! + ex * t - px[k]!, dz = cz[q]! + ez * t - pz[k]!;
      best = Math.min(best, dx * dx + dz * dz);
    }
    if (Math.sqrt(best) > MISS) return false;
  }
  return true;
}

/** How far the middle of a curved piece's segments' chords misses its curve, at its kerb's face. */
function segmentMiss(half: number, turn0: number, turn1: number): number {
  let most = 0;
  const p = [0, 0, 0, 0], q = [0, 0, 0, 0], m = [0, 0, 0, 0];
  for (let k = 0; k < CURVE_SEGMENTS; k++) {
    curveAt(p, half, turn0, turn1, k / CURVE_SEGMENTS);
    curveAt(q, half, turn0, turn1, (k + 1) / CURVE_SEGMENTS);
    curveAt(m, half, turn0, turn1, (k + 0.5) / CURVE_SEGMENTS);
    const mx = (p[0]! + q[0]!) / 2, mz = (p[1]! + q[1]!) / 2;
    most = Math.max(most, Math.sqrt((m[0]! - mx) * (m[0]! - mx) + (m[1]! - mz) * (m[1]! - mz)));
  }
  return most;
}

/** Sets down the piece from a to b, a curve split in two at its middle while its segments miss it by more than MISS. */
function lay(out: BentPiece[], a: Frame, b: Frame, curved: boolean, kerb: BentKerb, section: Section): void {
  const c = chordOf(a, b);
  if (c.half < 0.001) return;
  // A straight longer than the most a piece runs is as many pieces end to end.
  if (!curved && c.half * 2 > STRAIGHT_MOST) {
    const n = Math.ceil((c.half * 2) / STRAIGHT_MOST);
    let from = a;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const to: Frame = k === n ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, dx: c.cx, dz: c.cz, s: a.s + (b.s - a.s) * t };
      lay(out, from, to, false, kerb, section);
      from = to;
    }
    return;
  }
  if (curved && c.half * 2 > 1 && (c.half * 2 > CURVE_MOST || segmentMiss(c.half, c.turn0, c.turn1) > MISS)) {
    curveAt(probe, c.half, c.turn0, c.turn1, 0.5);
    const mx = a.x + c.half * c.cx + probe[0]! * c.cx - probe[1]! * c.cz, mz = a.z + c.half * c.cz + probe[0]! * c.cz + probe[1]! * c.cx;
    const dx = probe[2]! * c.cx - probe[3]! * c.cz, dz = probe[2]! * c.cz + probe[3]! * c.cx;
    const m: Frame = { x: mx, y: (a.y + b.y) / 2, z: mz, dx, dz, s: (a.s + b.s) / 2 };
    lay(out, a, m, true, kerb, section);
    lay(out, m, b, true, kerb, section);
    return;
  }
  const yaw = (detAtan2(-c.cz, c.cx) * 180) / PI;
  out.push({
    kind: bentKind(kerb, curved),
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, yaw: (yaw + 360) % 360,
    bend: { half: c.half, turn0: c.turn0, turn1: c.turn1, station: wrapped(a.s), rise: (b.y - a.y) / 2, panel: kerb === "median" ? 0 : section.panel, walk: kerb === "median" ? KERB_BACK : section.walk, seed: section.seed, wear: section.wear },
    kerb,
  });
}

/**
 * Where a bent piece with bend `b` stands were it the next along the kerb line of the piece before, at (x, y, z) on the
 * map's lattice (its middle in 1/512 m, from any corner, the same on both sides) turned `yaw` (1/65,536 turns) with bend
 * `a`: its start at that one's end, its chord turned from that one's way there by its own start's turn, its middle half
 * its chord on and its own rise over. Into `out` as x, y, z and yaw on the same lattice. A map's statics code a bent piece
 * after a bent piece against it (mapfile.ts), so only what it misses by is written, which along a line is next to nothing.
 */
export function bentNext(x: number, y: number, z: number, yaw: number, a: ArrayLike<number>, b: ArrayLike<number>, out: number[] | Float64Array): void {
  const turn = (yaw * TAU) / YAW_UNITS, cs = detCos(turn), sn = detSin(turn);
  // Its end: half its chord on along it, and its rise over its middle.
  const ha = (a[0]! / 1000) * STRUCT_UNITS, hb = (b[0]! / 1000) * STRUCT_UNITS;
  const ex = x + cs * ha, ez = z - sn * ha, ey = y + (a[4]! / 1000) * STRUCT_UNITS;
  // The next chord turned from this one by this one's end's turn less the next's start's, a turn toward +z positive.
  const next = turn - a[2]! / ANGLE + b[1]! / ANGLE, nc = detCos(next), ns = detSin(next);
  out[0] = round(ex + nc * hb);
  out[1] = round(ey + (b[4]! / 1000) * STRUCT_UNITS);
  out[2] = round(ez - ns * hb);
  out[3] = round((next * YAW_UNITS) / TAU) & 0xffff;
}

// ---------------------------------------------------------------------------------------------------------------------
// Collision: plain pieces under each bent one.

/** Lengths and widths the collision pieces come in (content/bends.ts), in metres. */
export const HIT_LENGTHS = [0.5, 1, 2, 4, 8] as const;
export const HIT_WIDTHS = [0.3, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5] as const;
/** A flush kerb's ramp: from the road at its face to the walk's height this far behind it. */
export const FLUSH_FACE = 0.03, FLUSH_APRON = 0.75;
/** The most a collision box's end stands off a sloping walk. */
const SLOPE_MISS = 0.04;
export const hitKind = (ramp: boolean, width: number, length: number): string => `core:zzzzzbendhit_${ramp ? "ramp" : "box"}_${Math.round(width * 100)}_${Math.round(length * 100)}`;

/** The nearest width the collision pieces come in to `walk`. */
export function hitWidth(walk: number): number {
  let best: number = HIT_WIDTHS[0];
  for (const w of HIT_WIDTHS) if (Math.abs(w - walk) < Math.abs(best - walk)) best = w;
  return best;
}

/** A collision piece: its kind, its middle (its box's, at half the kerb's height over the road), its turn in degrees. */
export interface HitPiece { readonly kind: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }

/**
 * The collision pieces under a bent piece: boxes from the kerb's face to its walk's back at the kerb's height, or under a
 * flush kerb a ramp up from the road at the face to the walk behind it, and a walk wider than the widest box in bands of
 * boxes side by side, the first the kerb's; along a straight the longest length that fits,
 * end to end and overlapping within it, short enough on a slope that a box's ends stand within 4 cm of it, and along a
 * curve on chords short enough that each misses the curve by no more than 2 cm at the face, so a wheel meets the kerb within that of where it is drawn. None reaches past the piece's ends.
 */
export function underPiece(p: BentPiece): HitPiece[] {
  const out: HitPiece[] = [];
  hitsUnder(p.x, p.y, p.z, p.yaw, p.bend, p.kerb === "flush", (kind, x, y, z, yaw) => out.push({ kind, x, y, z, yaw }));
  return out;
}

/** The start of every collision piece's kind (hitKind): a map holds none of them, but makes them from its bends (madeHits). */
export const HIT_PREFIX = "core:zzzzzbendhit_";
/** Whether a bent kind is walked as a flush kerb's ramp: a flush kerb, or a flare to or from one (bent-walks.ts join). */
export const walkedFlush = (kind: string): boolean => kind.includes("_flush");

/**
 * The collision pieces under a bent piece as a map holds it, on the file's lattice: its middle in 1/512 m, its turn in
 * 1/65,536 turns, its bend's eight numbers (packBend) and whether it is walked flush. Each comes to `each` as its kind and
 * its middle and turn on the same lattice. A map stores none of them: a server, a page, the walk proofs and the map's
 * writer all make them here from the same numbers (mapfile.ts), so every one of them holds the same boxes to the bit.
 */
export function madeHits(ux: number, uy: number, uz: number, yaw: number, bend: ArrayLike<number>, flush: boolean, each: (kind: string, ux: number, uy: number, uz: number, yaw: number) => void): void {
  hitsUnder(ux / STRUCT_UNITS, uy / STRUCT_UNITS, uz / STRUCT_UNITS, (yaw * 360) / YAW_UNITS, unpackBend(bend), flush, (kind, x, y, z, turn) =>
    each(kind, round(x * STRUCT_UNITS), round(y * STRUCT_UNITS), round(z * STRUCT_UNITS), round((turn * YAW_UNITS) / 360) & 0xffff));
}

/** underPiece's work, each piece to `each` as its kind, its middle and its turn in degrees. */
function hitsUnder(px: number, py: number, pz: number, pyaw: number, b: Bend, flush: boolean, each: (kind: string, x: number, y: number, z: number, yaw: number) => void): void {
  const phi = b.turn1 - b.turn0, length = arcLength(b.half, phi);
  // A walk let down to the ground: the kerb's boxes alone, and over the walk behind it slopes falling as it does.
  if (b.sink) slopesUnder(px, py, pz, pyaw, b, each);
  const walk = b.sink ? KERB_BACK : b.walk;
  // Bands across, as few as the widest box allows, each as wide as the walk needs, rounded up, the first at the face and
  // the last at the walk's back.
  const most = HIT_WIDTHS[HIT_WIDTHS.length - 1], bands = Math.max(1, Math.ceil(walk / most - 1e-6));
  const width = bands === 1 ? hitWidth(walk) : HIT_WIDTHS.find((w) => w >= walk / bands - 1e-6) ?? most;
  const widthAt = (HIT_WIDTHS as readonly number[]).indexOf(width);
  const across = (j: number): number => (bands === 1 ? width / 2 : width / 2 + ((walk - width) * j) / (bands - 1));
  // Chords of the curve, each missing it by under 2 cm.
  const radius = Math.abs(phi) > 1e-4 ? length / Math.abs(phi) : Infinity;
  const longest = radius === Infinity ? STRAIGHT_MOST : Math.min(STRAIGHT_MOST, Math.sqrt(8 * radius * 0.02));
  const chords = Math.max(1, Math.ceil(length / longest - 1e-9));
  // A box is level along its length: on a slope none is so long that its ends stand more than 4 cm off the walk.
  const grade = Math.abs((2 * b.rise) / Math.max(length, 1e-6)), level = grade > 1e-4 ? (2 * SLOPE_MISS) / grade : Infinity;
  const a = (pyaw * PI) / 180, cs = detCos(a), sn = detSin(a);
  const pa = hitA, pb = hitB;
  for (let k = 0; k < chords; k++) {
    curveAt(pa, b.half, b.turn0, b.turn1, k / chords);
    curveAt(pb, b.half, b.turn0, b.turn1, (k + 1) / chords);
    const ex = pb[0]! - pa[0]!, ez = pb[1]! - pa[1]!, chord = Math.sqrt(ex * ex + ez * ez);
    const ux = ex / chord, uz = ez / chord;
    // The longest length that fits the chord, and as many as cover it.
    let sizeAt = 0;
    for (let i = 0; i < HIT_LENGTHS.length; i++) if (HIT_LENGTHS[i]! <= chord + 1e-6 && HIT_LENGTHS[i]! <= level + 1e-6) sizeAt = i;
    const size: number = HIT_LENGTHS[sizeAt]!;
    const count = Math.max(1, Math.ceil(chord / size - 1e-6));
    for (let q = 0; q < count; q++) for (let j = 0; j < bands; j++) {
      const along = count === 1 ? chord / 2 : size / 2 + ((chord - size) * q) / (count - 1);
      // In the piece's frame: along the chord, then across to the middle of the box's width.
      const lx = pa[0]! + ux * along - uz * across(j), lz = pa[1]! + uz * along + ux * across(j);
      const t = (k + along / chord) / chords;
      const y = py + b.rise * (2 * t - 1) + KERB_HEIGHT / 2;
      // The world: x along (cs, -sn), z across (sn, cs).
      const yaw = pyaw + (detAtan2(-uz, ux) * 180) / PI;
      each(kinds[(flush && j === 0 ? 1 : 0) * KINDS_RAMP + widthAt * HIT_LENGTHS.length + sizeAt]!, px + cs * lx + sn * lz, y, pz - sn * lx + cs * lz, ((yaw % 360) + 360) % 360);
    }
  }
}
const hitA = [0, 0, 0, 0], hitB = [0, 0, 0, 0];
/** Every collision piece's kind, boxes then ramps, by width then length, as hitKind names them: made once, not a piece at a time. */
const KINDS_RAMP = HIT_WIDTHS.length * HIT_LENGTHS.length;
const kinds: readonly string[] = [false, true].flatMap((ramp) => HIT_WIDTHS.flatMap((w) => HIT_LENGTHS.map((l) => hitKind(ramp, w, l))));

/** How long a walk's fall to the ground is where it ends (bent-walks.ts), and the lengths its slopes come in. */
export const SINK_LENGTH = 1.5;
export const SLOPE_LENGTHS = [0.75, SINK_LENGTH] as const;
/** A sinking walk's slope (content/bends.ts): its width and length, falling the kerb's height along its +x. */
export const slopeKind = (width: number, length: number): string => `core:zzzzzbendhit_slope_${Math.round(width * 100)}_${Math.round(length * 100)}`;
const slopes: readonly string[] = HIT_WIDTHS.flatMap((w) => SLOPE_LENGTHS.map((l) => slopeKind(w, l)));

/**
 * The slopes under a sinking walk, behind its kerb: one a band across, as wide as the walk's band, as long as the piece
 * (the nearer of the lengths they come in), its middle at the chord's and falling toward the sink's end.
 */
function slopesUnder(px: number, py: number, pz: number, pyaw: number, b: Bend, each: (kind: string, x: number, y: number, z: number, yaw: number) => void): void {
  const behind = b.walk - KERB_BACK, most = HIT_WIDTHS[HIT_WIDTHS.length - 1];
  if (behind < HIT_WIDTHS[0] / 2) return;
  const bands = Math.max(1, Math.ceil(behind / most - 1e-6));
  const width = bands === 1 ? hitWidth(behind) : HIT_WIDTHS.find((w) => w >= behind / bands - 1e-6) ?? most;
  const lengthAt = Math.abs(2 * b.half - SLOPE_LENGTHS[0]) < Math.abs(2 * b.half - SLOPE_LENGTHS[1]) ? 0 : 1;
  const a = (pyaw * PI) / 180, cs = detCos(a), sn = detSin(a);
  const yaw = (((pyaw + (b.sink! < 0 ? 180 : 0)) % 360) + 360) % 360;
  for (let j = 0; j < bands; j++) {
    const lz = KERB_BACK + (bands === 1 ? width / 2 : width / 2 + ((behind - width) * j) / (bands - 1));
    each(slopes[(HIT_WIDTHS as readonly number[]).indexOf(width) * SLOPE_LENGTHS.length + lengthAt]!, px + sn * lz, py + KERB_HEIGHT / 2, pz + cs * lz, yaw);
  }
}
