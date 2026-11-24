// The exact lattice a base is built on. With ζ a turn of 30°, a point is m0 + m1ζ + m2ζ² + m3ζ³: four whole numbers, in
// half-sides (1.5 m). 1, ζ, ζ², ζ³ are independent over the rationals, so equal tuples are equal points and every loop closes.
// Twice a point's ideal coordinates are 2x = (2m0 + m2) + m1√3 and 2y = (m1 + 2m3) + m2√3, and the sign of a + b√3 is exact.
// +y is the frame's +Z: directions and corners run from +X toward +Z. Nothing here knows a frame's yaw.

/** A tuple is four whole numbers in an Int32Array at an offset. `out` may be an input: every input is read before a write. */
export type Tuples = Int32Array;

export const DIRECTIONS = 12;
/** Half-sides along the side of a whole square, triangle or edge. */
export const SIDE = 2;
/** The most a canonical anchor's coordinates may be, either side of zero. */
export const M_MOST = 511;
/** The most a level may be, either side of zero, in quarter storeys (0.75 m). */
export const LVL_MOST = 255;
/**
 * The predicates are exact for tuples whose coordinates are within this of zero. Differences then stay within 2·768, their
 * doubled coordinates within 6·768 and 2·768, a product a + b√3 within a = 96·768² and b = 48·768², and a² within 3.3e15 < 2^53.
 */
export const EXACT_MOST = 768;

export const CLS_VERTEX = 0;
export const CLS_EDGE = 1;
export const CLS_SQUARE = 2;
export const CLS_TRIANGLE = 3;

/** Direction steps between one corner's name for an element and the next corner's, by class. */
export const CLS_STEP: readonly number[] = [0, 6, 3, 4];
/** Canonical directions are 0 up to this, by class. */
export const CLS_DIRS: readonly number[] = [1, 6, 3, 4];
/** Corners, by class. */
export const CLS_CORNERS: readonly number[] = [1, 2, 4, 3];

/** The twelve unit directions: ζ^d is the tuple at 4·d. */
export const DIRS = new Int32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 1, 0, 0, -1, 0, 1,
  -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 1, 0, -1, 0, 0, 1, 0, -1,
]);

/** Direction `d` turned `k` steps of 30°, toward +Z for a positive k. */
export function dirTurn(d: number, k: number): number {
  return (((d + k) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

/** Direction `d` mirrored across the +X axis. */
export function dirMirror(d: number): number {
  return (DIRECTIONS - d) % DIRECTIONS;
}

export function tupleSet(out: Tuples, o: number, m0: number, m1: number, m2: number, m3: number): void {
  out[o] = m0;
  out[o + 1] = m1;
  out[o + 2] = m2;
  out[o + 3] = m3;
}

export function tupleAdd(a: Tuples, ai: number, b: Tuples, bi: number, out: Tuples, o: number): void {
  tupleSet(out, o, a[ai]! + b[bi]!, a[ai + 1]! + b[bi + 1]!, a[ai + 2]! + b[bi + 2]!, a[ai + 3]! + b[bi + 3]!);
}

export function tupleSub(a: Tuples, ai: number, b: Tuples, bi: number, out: Tuples, o: number): void {
  tupleSet(out, o, a[ai]! - b[bi]!, a[ai + 1]! - b[bi + 1]!, a[ai + 2]! - b[bi + 2]!, a[ai + 3]! - b[bi + 3]!);
}

export function tupleScale(a: Tuples, ai: number, k: number, out: Tuples, o: number): void {
  tupleSet(out, o, a[ai]! * k, a[ai + 1]! * k, a[ai + 2]! * k, a[ai + 3]! * k);
}

/** `a` moved `n` half-sides along direction `d`. */
export function tupleStep(a: Tuples, ai: number, d: number, n: number, out: Tuples, o: number): void {
  const e = d * 4;
  tupleSet(out, o, a[ai]! + n * DIRS[e]!, a[ai + 1]! + n * DIRS[e + 1]!, a[ai + 2]! + n * DIRS[e + 2]!, a[ai + 3]! + n * DIRS[e + 3]!);
}

/** `a` turned `k` steps of 30° about the origin, toward +Z for a positive k. */
export function tupleTurn(a: Tuples, ai: number, k: number, out: Tuples, o: number): void {
  let steps = dirTurn(0, k);
  let m0 = a[ai]!;
  let m1 = a[ai + 1]!;
  let m2 = a[ai + 2]!;
  let m3 = a[ai + 3]!;
  if (steps >= 6) {
    // Six steps is half a turn.
    steps -= 6;
    m0 = -m0;
    m1 = -m1;
    m2 = -m2;
    m3 = -m3;
  }
  for (; steps > 0; steps--) {
    // ζ⁴ = ζ² − 1.
    const t = m3;
    m3 = m2;
    m2 = m1 + t;
    m1 = m0;
    m0 = -t;
  }
  tupleSet(out, o, m0, m1, m2, m3);
}

/** `a` mirrored across the +X axis. */
export function tupleMirror(a: Tuples, ai: number, out: Tuples, o: number): void {
  tupleSet(out, o, a[ai]! + a[ai + 2]!, a[ai + 1]!, -a[ai + 2]!, -a[ai + 1]! - a[ai + 3]!);
}

export function tupleEqual(a: Tuples, ai: number, b: Tuples, bi: number): boolean {
  return a[ai] === b[bi] && a[ai + 1] === b[bi + 1] && a[ai + 2] === b[bi + 2] && a[ai + 3] === b[bi + 3];
}

/** Whether every coordinate is within `most` of zero. */
export function tupleWithin(a: Tuples, ai: number, most: number): boolean {
  return Math.abs(a[ai]!) <= most && Math.abs(a[ai + 1]!) <= most && Math.abs(a[ai + 2]!) <= most && Math.abs(a[ai + 3]!) <= most;
}

/** Twice the ideal coordinates, to `out` as [xa, xb, ya, yb]: 2x = xa + xb√3 and 2y = ya + yb√3. */
export function ideal2(a: Tuples, ai: number, out: Tuples, o: number): void {
  tupleSet(out, o, 2 * a[ai]! + a[ai + 2]!, a[ai + 1]!, a[ai + 1]! + 2 * a[ai + 3]!, a[ai + 2]!);
}

const ROOT3 = 1.7320508075688772;

/** The ideal x in half-sides, rounded to a float: for drawing and for choosing, never for deciding. */
export function idealX(a: Tuples, ai: number): number {
  return a[ai]! + 0.5 * a[ai + 2]! + 0.5 * ROOT3 * a[ai + 1]!;
}

/** The ideal y (the frame's +Z) in half-sides, rounded to a float. */
export function idealY(a: Tuples, ai: number): number {
  return a[ai + 3]! + 0.5 * a[ai + 1]! + 0.5 * ROOT3 * a[ai + 2]!;
}

/** The sign of a + b√3: -1, 0 or 1. Exact for whole a and b while a² and 3b² are below 2^53. */
export function signRoot3(a: number, b: number): number {
  if (b === 0) return a > 0 ? 1 : a < 0 ? -1 : 0;
  if (a === 0) return b > 0 ? 1 : -1;
  if (a > 0 === b > 0) return a > 0 ? 1 : -1;
  // √3 is irrational, so the two are never equal.
  return a * a > 3 * b * b === a > 0 ? 1 : -1;
}

/** The value a + b√3 of the last `orient` or `dotSign`. */
export const exact = { a: 0, b: 0 };

/**
 * The sign of (b − a) × (c − a): 1 when c is to the left of a → b, which is toward +Z when a → b runs along +X; 0 when the
 * three are in line. Four times the product is left in `exact`.
 */
export function orient(a: Tuples, ai: number, b: Tuples, bi: number, c: Tuples, ci: number): number {
  const a0 = a[ai]!;
  const a1 = a[ai + 1]!;
  const a2 = a[ai + 2]!;
  const a3 = a[ai + 3]!;
  const ub = b[bi + 1]! - a1;
  const ud = b[bi + 2]! - a2;
  const ua = 2 * (b[bi]! - a0) + ud;
  const uc = ub + 2 * (b[bi + 3]! - a3);
  const vb = c[ci + 1]! - a1;
  const vd = c[ci + 2]! - a2;
  const va = 2 * (c[ci]! - a0) + vd;
  const vc = vb + 2 * (c[ci + 3]! - a3);
  // Adding 0 makes a negative zero plain zero.
  exact.a = ua * vc + 3 * ub * vd - uc * va - 3 * ud * vb + 0;
  exact.b = ua * vd + ub * vc - uc * vb - ud * va + 0;
  return signRoot3(exact.a, exact.b);
}

/** The sign of (b − a) · (c − a). Four times the product is left in `exact`: with c = b, four times the squared length. */
export function dotSign(a: Tuples, ai: number, b: Tuples, bi: number, c: Tuples, ci: number): number {
  const a0 = a[ai]!;
  const a1 = a[ai + 1]!;
  const a2 = a[ai + 2]!;
  const a3 = a[ai + 3]!;
  const ub = b[bi + 1]! - a1;
  const ud = b[bi + 2]! - a2;
  const ua = 2 * (b[bi]! - a0) + ud;
  const uc = ub + 2 * (b[bi + 3]! - a3);
  const vb = c[ci + 1]! - a1;
  const vd = c[ci + 2]! - a2;
  const va = 2 * (c[ci]! - a0) + vd;
  const vc = vb + 2 * (c[ci + 3]! - a3);
  exact.a = ua * va + 3 * ub * vb + uc * vc + 3 * ud * vd + 0;
  exact.b = ua * vb + ub * va + uc * vd + ud * vc + 0;
  return signRoot3(exact.a, exact.b);
}

/** Whether p is on the segment whose two ends are the tuples at `si` and `si + 4`, the ends included. */
export function onSegment(p: Tuples, pi: number, s: Tuples, si: number): boolean {
  return orient(s, si, s, si + 4, p, pi) === 0 && dotSign(p, pi, s, si, s, si + 4) <= 0;
}

/** Whether some side of the first face has all of the second on it or outside it. */
function separates(a: Tuples, ai: number, na: number, b: Tuples, bi: number, nb: number): boolean {
  for (let i = 0; i < na; i++) {
    const p = ai + 4 * i;
    const q = ai + 4 * (i + 1 === na ? 0 : i + 1);
    let j = 0;
    while (j < nb && orient(a, p, a, q, b, bi + 4 * j) <= 0) j++;
    if (j === nb) return true;
  }
  return false;
}

/**
 * Whether two convex faces share any area. Each is `n` corners in a row, in order from +X toward +Z, as squareCorners and
 * triangleCorners write them. Faces that touch along a side or at a corner do not overlap.
 */
export function facesOverlap(a: Tuples, ai: number, na: number, b: Tuples, bi: number, nb: number): boolean {
  return !separates(a, ai, na, b, bi, nb) && !separates(b, bi, nb, a, ai, na);
}

/**
 * Whether two edges lie on one line and share more than a point. Each is two ends in a row, as edgeEnds writes them.
 * Edges that meet end to end, or cross, do not overlap.
 */
export function edgesOverlap(a: Tuples, ai: number, b: Tuples, bi: number): boolean {
  if (orient(a, ai, a, ai + 4, b, bi) !== 0 || orient(a, ai, a, ai + 4, b, bi + 4) !== 0) return false;
  // Some of b is past a's first end, and some is short of its second.
  const past = dotSign(a, ai, a, ai + 4, b, bi) > 0 || dotSign(a, ai, a, ai + 4, b, bi + 4) > 0;
  return past && (dotSign(a, ai + 4, a, ai, b, bi) > 0 || dotSign(a, ai + 4, a, ai, b, bi + 4) > 0);
}

/** The two ends of the edge from `a` along `d`, to `out`: 8 numbers. */
export function edgeEnds(a: Tuples, ai: number, d: number, out: Tuples, o: number, side: number = SIDE): void {
  const m0 = a[ai]!;
  const m1 = a[ai + 1]!;
  const m2 = a[ai + 2]!;
  const m3 = a[ai + 3]!;
  tupleSet(out, o, m0, m1, m2, m3);
  tupleStep(out, o, d, side, out, o + 4);
}

/** The middle of the whole edge from `a` along `d`. */
export function edgeMid(a: Tuples, ai: number, d: number, out: Tuples, o: number): void {
  tupleStep(a, ai, d, SIDE / 2, out, o);
}

/**
 * The corners of the square with a corner at `a` and sides from it along `d` and a quarter turn on, to `out`: 16 numbers,
 * in order from +X toward +Z, the first at `a`.
 */
export function squareCorners(a: Tuples, ai: number, d: number, out: Tuples, o: number, side: number = SIDE): void {
  const across = dirTurn(d, 3);
  edgeEnds(a, ai, d, out, o, side);
  tupleStep(out, o + 4, across, side, out, o + 8);
  tupleStep(out, o, across, side, out, o + 12);
}

/** The middle of the whole square at `a` along `d`: a lattice point, because the unit is half a side. */
export function squareCentre(a: Tuples, ai: number, d: number, out: Tuples, o: number): void {
  tupleStep(a, ai, d, SIDE / 2, out, o);
  tupleStep(out, o, dirTurn(d, 3), SIDE / 2, out, o);
}

/**
 * The corners of the triangle with a corner at `a` and sides from it along `d` and 60° on, to `out`: 12 numbers, in order
 * from +X toward +Z, the first at `a`.
 */
export function triangleCorners(a: Tuples, ai: number, d: number, out: Tuples, o: number, side: number = SIDE): void {
  edgeEnds(a, ai, d, out, o, side);
  tupleStep(out, o, dirTurn(d, 2), side, out, o + 8);
}

/** The corners of an element of class `cls`, as the three functions above write them. Returns how many. */
export function elementCorners(cls: number, a: Tuples, ai: number, d: number, out: Tuples, o: number, side: number = SIDE): number {
  if (cls === CLS_SQUARE) squareCorners(a, ai, d, out, o, side);
  else if (cls === CLS_TRIANGLE) triangleCorners(a, ai, d, out, o, side);
  else if (cls === CLS_EDGE) edgeEnds(a, ai, d, out, o, side);
  else tupleSet(out, o, a[ai]!, a[ai + 1]!, a[ai + 2]!, a[ai + 3]!);
  return CLS_CORNERS[cls]!;
}

/**
 * Filled by `canonical`. `dir` is the canonical direction. `turn` says which corner the element was named from: its
 * anchor was corner `turn` of the canonical element, and its direction was dir + turn·CLS_STEP[cls].
 */
export const canon = { dir: 0, turn: 0 };

/**
 * The one name of the element of class `cls` named from corner `a` along `d`: its anchor to `out`, the rest to `canon`.
 * The canonical anchor is the one corner from which the direction is in the class's range: an edge 0–5, a square 0–2,
 * a triangle 0–3. A vertex is its own anchor with direction 0.
 */
export function canonical(cls: number, a: Tuples, ai: number, d: number, out: Tuples, o: number, side: number = SIDE): void {
  const step = CLS_STEP[cls]!;
  const turn = step === 0 ? 0 : Math.floor(d / step);
  canon.dir = step === 0 ? 0 : d - turn * step;
  canon.turn = turn;
  if (turn === 0) {
    tupleSet(out, o, a[ai]!, a[ai + 1]!, a[ai + 2]!, a[ai + 3]!);
  } else if (cls === CLS_SQUARE && turn < 3) {
    // From the second corner the first is a quarter turn on from `d`; from the third it is along both.
    tupleStep(a, ai, dirTurn(d, 3), side, out, o);
    if (turn === 2) tupleStep(out, o, d, side, out, o);
  } else if (cls === CLS_TRIANGLE && turn === 1) {
    tupleStep(a, ai, dirTurn(d, 2), side, out, o);
  } else {
    // From the last corner, and from an edge's far end, the first corner is straight along `d`.
    tupleStep(a, ai, d, side, out, o);
  }
}

const BIAS = M_MOST + 1;
const LVL_BIAS = LVL_MOST + 1;
const ROT_FLIP = (3 << 26) | (1 << 28);

/**
 * The first word of a key: m0, m1 and m2 in ten bits each from the low end, each biased by 512, and the class above them.
 * Nothing is checked here: an anchor must be within M_MOST (tupleWithin) before it is packed.
 */
export function key0(cls: number, m0: number, m1: number, m2: number): number {
  return ((m0 + BIAS) | ((m1 + BIAS) << 10) | ((m2 + BIAS) << 20) | (cls << 30)) >>> 0;
}

/**
 * The second word of a key, from the low end: m3 in ten bits biased by 512, the level in nine biased by 256, the direction
 * in four, the layer in three, the turn within the cell in two, the flip in one. The top three bits are spare and zero.
 */
export function key1(m3: number, lvl: number, dir: number, layer: number, rot: number, flip: number): number {
  return ((m3 + BIAS) | ((lvl + LVL_BIAS) << 10) | (dir << 19) | (layer << 23) | (rot << 26) | (flip << 28)) >>> 0;
}

export function keyCls(k0: number): number {
  return k0 >>> 30;
}

export function keyM0(k0: number): number {
  return (k0 & 1023) - BIAS;
}

export function keyM1(k0: number): number {
  return ((k0 >>> 10) & 1023) - BIAS;
}

export function keyM2(k0: number): number {
  return ((k0 >>> 20) & 1023) - BIAS;
}

export function keyM3(k1: number): number {
  return (k1 & 1023) - BIAS;
}

export function keyLvl(k1: number): number {
  return ((k1 >>> 10) & 511) - LVL_BIAS;
}

export function keyDir(k1: number): number {
  return (k1 >>> 19) & 15;
}

export function keyLayer(k1: number): number {
  return (k1 >>> 23) & 7;
}

export function keyRot(k1: number): number {
  return (k1 >>> 26) & 3;
}

export function keyFlip(k1: number): number {
  return (k1 >>> 28) & 1;
}

/** A key's anchor, to `out`. */
export function keyAnchor(k0: number, k1: number, out: Tuples, o: number): void {
  tupleSet(out, o, keyM0(k0), keyM1(k0), keyM2(k0), keyM3(k1));
}

/** The second word with turn and flip cleared. With the first word unchanged, that is the cell: what occupancy is keyed by. */
export function cellOf(k1: number): number {
  return (k1 & ~ROT_FLIP) >>> 0;
}

/** Whether a key's anchor and level are in range, its direction is canonical for its class, and its spare bits are zero. */
export function keyValid(k0: number, k1: number): boolean {
  if ((k0 & 1023) === 0 || ((k0 >>> 10) & 1023) === 0 || ((k0 >>> 20) & 1023) === 0 || (k1 & 1023) === 0) return false;
  return ((k1 >>> 10) & 511) !== 0 && k1 >>> 29 === 0 && keyDir(k1) < CLS_DIRS[k0 >>> 30]!;
}
