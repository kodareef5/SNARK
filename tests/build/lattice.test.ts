// The exact lattice of a base (shared/world/lattice/module.ts) and its whole-number vectors in the world (basis.ts): turns,
// exact signs against a 60-digit reference, loops at every base yaw, today's poses, canonical keys and the overlap predicates.

import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { CLASS_STRETCH_MOST, DRIFT_MOST, LEVEL_UNITS, QUARTER_YAW, basisOf, classAxis, classAxis60, dirOf, dirVector, levelY, turn30, turn60, twOf, worldOf, yawOf } from "../../shared/world/lattice/basis.ts";
import {
  CLS_CORNERS,
  CLS_DIRS,
  CLS_EDGE,
  CLS_SQUARE,
  CLS_STEP,
  CLS_TRIANGLE,
  CLS_VERTEX,
  DIRS,
  EXACT_MOST,
  LVL_MOST,
  M_MOST,
  SIDE,
  canon,
  canonical,
  cellOf,
  dirMirror,
  dirTurn,
  dotSign,
  edgeEnds,
  edgeMid,
  edgesOverlap,
  elementCorners,
  exact,
  facesOverlap,
  ideal2,
  idealX,
  idealY,
  key0,
  key1,
  keyAnchor,
  keyCls,
  keyDir,
  keyFlip,
  keyLayer,
  keyLvl,
  keyM0,
  keyM1,
  keyM2,
  keyM3,
  keyRot,
  keyValid,
  onSegment,
  orient,
  signRoot3,
  squareCentre,
  squareCorners,
  triangleCorners,
  tupleAdd,
  tupleEqual,
  tupleMirror,
  tupleScale,
  tupleSet,
  tupleStep,
  tupleSub,
  tupleTurn,
  tupleWithin,
} from "../../shared/world/lattice/module.ts";
import { HALF_SIDE, ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_PILLAR, ROLE_STAIRS, ROLE_WALL, frameAxes, makeSockets, socketPose, socketsFor, type Pose } from "../../shared/world/snap.ts";

const tup = (...m: number[]): Int32Array => Int32Array.from(m);
const list = (t: Int32Array, o = 0, n = 4): number[] => Array.from(t.subarray(o, o + n));
const ZERO = tup(0, 0, 0, 0);

/** √3 to 60 places, as a whole number. */
const SCALE = 10n ** 60n;
const ROOT3 = ((): bigint => {
  let r = 2n * SCALE;
  for (let i = 0; i < 300; i++) r = (r + (3n * SCALE * SCALE) / r) / 2n;
  return r;
})();
const bigSign = (a: bigint, b: bigint): number => {
  const v = a * SCALE + b * ROOT3;
  return v > 0n ? 1 : v < 0n ? -1 : 0;
};

/** (2x, 2y) of the difference b − a as [xa, xb, ya, yb], in BigInt. */
function bigDelta(a: Int32Array, ai: number, b: Int32Array, bi: number): bigint[] {
  const d = [0, 1, 2, 3].map((i) => BigInt(b[bi + i]! - a[ai + i]!));
  return [2n * d[0]! + d[2]!, d[1]!, d[1]! + 2n * d[3]!, d[2]!];
}

/** The tiny tuple (2 − √3)^n along +X: about 0.268^n half-sides. */
function tiny(n: number): Int32Array {
  let a = 1;
  let b = 0;
  for (let i = 0; i < n; i++) [a, b] = [2 * a - 3 * b, 2 * b - a];
  return tup(a, 2 * b, 0, -b);
}

/** A face as float corners in half-sides. */
function floats(f: Int32Array, n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [idealX(f, 4 * i), idealY(f, 4 * i)]);
}

/** The area two convex faces share, by clipping one to the other in floats. */
function sharedArea(a: number[][], b: number[][]): number {
  let poly = b;
  for (let i = 0; i < a.length && poly.length > 0; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const side = (v: number[]): number => (q[0]! - p[0]!) * (v[1]! - p[1]!) - (q[1]! - p[1]!) * (v[0]! - p[0]!);
    const next: number[][] = [];
    for (let j = 0; j < poly.length; j++) {
      const c = poly[j]!;
      const d = poly[(j + 1) % poly.length]!;
      const sc = side(c);
      const sd = side(d);
      if (sc >= 0) next.push(c);
      if ((sc > 0 && sd < 0) || (sc < 0 && sd > 0)) next.push([c[0]! + (sc / (sc - sd)) * (d[0]! - c[0]!), c[1]! + (sc / (sc - sd)) * (d[1]! - c[1]!)]);
    }
    poly = next;
  }
  let area = 0;
  for (let j = 0; j < poly.length; j++) area += poly[j]![0]! * poly[(j + 1) % poly.length]![1]! - poly[(j + 1) % poly.length]![0]! * poly[j]![1]!;
  return area / 2;
}

interface Face {
  cls: number;
  n: number;
  at: Int32Array;
  key: string;
}

const anchor = new Int32Array(4);

/** The element of class `cls` named from `a` along `d`, with its corners and its canonical key as text. */
function face(cls: number, a: Int32Array, d: number): Face {
  const at = new Int32Array(16);
  const n = elementCorners(cls, a, 0, d, at, 0);
  return { cls, n, at, key: keyOf(cls, a, d) };
}

function keyOf(cls: number, a: Int32Array, d: number): string {
  canonical(cls, a, 0, d, anchor, 0);
  return `${key0(cls, anchor[0]!, anchor[1]!, anchor[2]!)}:${key1(anchor[3]!, 0, canon.dir, 0, 0, 0)}`;
}

/** The canonical keys of a face's sides, and of the element outside each: `outside(i)` names it from the side's far end. */
function sides(f: Face): { keys: string[]; dirs: number[] } {
  const keys: string[] = [];
  const dirs: number[] = [];
  const delta = new Int32Array(4);
  for (let i = 0; i < f.n; i++) {
    tupleSub(f.at, 4 * ((i + 1) % f.n), f.at, 4 * i, delta, 0);
    let d = 0;
    while (d < 12 && !(delta[0] === SIDE * DIRS[4 * d]! && delta[1] === SIDE * DIRS[4 * d + 1]! && delta[2] === SIDE * DIRS[4 * d + 2]! && delta[3] === SIDE * DIRS[4 * d + 3]!)) d++;
    expect(d).toBeLessThan(12);
    dirs.push(d);
    keys.push(keyOf(CLS_EDGE, f.at.slice(4 * i, 4 * i + 4), d));
  }
  return { keys, dirs };
}

/** The face of class `cls` on the far side of side `i` of `f`. */
function across(f: Face, i: number, cls: number): Face {
  return face(cls, f.at.slice(4 * ((i + 1) % f.n), 4 * ((i + 1) % f.n) + 4), dirTurn(sides(f).dirs[i]!, 6));
}

/** Pairs of faces that overlap, by index. */
function overlaps(faces: Face[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      if (facesOverlap(faces[i]!.at, 0, faces[i]!.n, faces[j]!.at, 0, faces[j]!.n)) out.push(`${i}-${j}`);
    }
  }
  return out;
}

/** How many faces have each side, by the side's key. */
function sideCounts(faces: Face[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const f of faces) for (const k of sides(f).keys) count.set(k, (count.get(k) ?? 0) + 1);
  return count;
}

test("twelve turns of 30° are the identity, six negate, and two mirrors undo", () => {
  const rng = new Rng(12);
  const t = new Int32Array(4);
  const u = new Int32Array(4);
  for (let d = 0; d < 12; d++) {
    // Direction d is one half-side turned d times, and lies at d × 30° from +X toward +y.
    tupleTurn(tup(1, 0, 0, 0), 0, d, t, 0);
    expect(list(t)).toEqual(list(DIRS, 4 * d));
    expect(idealX(DIRS, 4 * d)).toBeCloseTo(Math.cos((d * Math.PI) / 6), 12);
    expect(idealY(DIRS, 4 * d)).toBeCloseTo(Math.sin((d * Math.PI) / 6), 12);
    tupleMirror(DIRS, 4 * d, t, 0);
    expect(list(t)).toEqual(list(DIRS, 4 * dirMirror(d)));
    expect(dirTurn(d, -d)).toBe(0);
    expect(dirTurn(d, 12 - d)).toBe(0);
  }
  // ζ⁴ = ζ² − 1 and ζ⁵ = ζ³ − ζ.
  tupleSub(DIRS, 8, DIRS, 0, t, 0);
  expect(list(t)).toEqual(list(DIRS, 16));
  tupleSub(DIRS, 12, DIRS, 4, t, 0);
  expect(list(t)).toEqual(list(DIRS, 20));
  for (let i = 0; i < 2000; i++) {
    const m = tup(rng.int(1023) - 511, rng.int(1023) - 511, rng.int(1023) - 511, rng.int(1023) - 511);
    tupleTurn(m, 0, 1, t, 0);
    expect(list(t)).toEqual([0 - m[3]!, m[0]!, m[1]! + m[3]!, m[2]!]);
    for (let k = 1; k < 12; k++) tupleTurn(t, 0, 1, t, 0);
    expect(list(t)).toEqual(list(m));
    tupleTurn(m, 0, 6, t, 0);
    tupleScale(m, 0, -1, u, 0);
    expect(list(t)).toEqual(list(u));
    // A turn back undoes a turn, and a turn is linear.
    const k = rng.int(25) - 12;
    tupleTurn(m, 0, k, t, 0);
    tupleTurn(t, 0, -k, t, 0);
    expect(list(t)).toEqual(list(m));
    const other = tup(rng.int(99) - 49, rng.int(99) - 49, rng.int(99) - 49, rng.int(99) - 49);
    tupleAdd(m, 0, other, 0, t, 0);
    tupleTurn(t, 0, k, t, 0);
    tupleTurn(m, 0, k, u, 0);
    tupleTurn(other, 0, k, other, 0);
    tupleAdd(u, 0, other, 0, u, 0);
    expect(list(t)).toEqual(list(u));
    tupleMirror(m, 0, t, 0);
    // A mirror keeps x and negates y.
    expect(idealX(t, 0)).toBeCloseTo(idealX(m, 0), 6);
    expect(idealY(t, 0)).toBeCloseTo(-idealY(m, 0), 6);
    tupleMirror(t, 0, t, 0);
    expect(list(t)).toEqual(list(m));
    // A mirror, then a turn, is a turn the other way, then the mirror.
    tupleTurn(m, 0, k, t, 0);
    tupleMirror(t, 0, t, 0);
    tupleMirror(m, 0, u, 0);
    tupleTurn(u, 0, -k, u, 0);
    expect(list(t)).toEqual(list(u));
  }
});

test("corners run from +X toward +Z, a whole side apart, at every direction", () => {
  const at = new Int32Array(16);
  const mid = new Int32Array(4);
  const p = tup(3, -8, 5, 11);
  for (let d = 0; d < 12; d++) {
    for (const n of [4, 3]) {
      if (n === 4) squareCorners(p, 0, d, at, 0);
      else triangleCorners(p, 0, d, at, 0);
      expect(list(at)).toEqual(list(p));
      for (let i = 0; i < n; i++) {
        const j = 4 * ((i + 1) % n);
        const k = 4 * ((i + 2) % n);
        // Each side is the last turned 90° or 120° on, four times its squared length is 16, and each corner turns left.
        tupleStep(at, 4 * i, dirTurn(d, (i * 12) / n), SIDE, mid, 0);
        expect(list(mid)).toEqual(list(at, j));
        expect(dotSign(at, 4 * i, at, j, at, j)).toBe(1);
        expect([exact.a, exact.b]).toEqual([16, 0]);
        expect(orient(at, 4 * i, at, j, at, k)).toBe(1);
        expect(orient(at, 4 * i, at, k, at, j)).toBe(-1);
        expect(orient(at, 4 * i, at, j, at, j)).toBe(0);
        // An edge's middle is on it, half a side from each end.
        edgeMid(at, 4 * i, dirTurn(d, (i * 12) / n), mid, 0);
        expect(dotSign(mid, 0, at, 4 * i, at, 4 * i)).toBe(1);
        expect([exact.a, exact.b]).toEqual([4, 0]);
        dotSign(mid, 0, at, j, at, j);
        expect([exact.a, exact.b]).toEqual([4, 0]);
      }
    }
    // A square's middle is the same distance from all four corners.
    squareCorners(p, 0, d, at, 0);
    squareCentre(p, 0, d, mid, 0);
    for (let i = 0; i < 4; i++) {
      dotSign(mid, 0, at, 4 * i, at, 4 * i);
      expect([exact.a, exact.b]).toEqual([8, 0]);
    }
  }
});

test("the sign of a + b√3 agrees with a 60-digit evaluation, near ties included", () => {
  const most = 2n ** 53n;
  const aMost = 94906265;
  const bMost = 54794158;
  expect(BigInt(aMost) ** 2n < most && BigInt(aMost + 1) ** 2n > most).toBe(true);
  expect(3n * BigInt(bMost) ** 2n < most && 3n * BigInt(bMost + 1) ** 2n > most).toBe(true);
  const pairs: [number, number][] = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [-0, -0], [aMost, -bMost], [-aMost, bMost], [aMost, bMost], [-aMost, -bMost]];
  // p/q runs through the convergents of √3: 2/1, 5/3, 7/4, 19/11, 26/15 …, where p − q√3 is as near zero as whole numbers get.
  let [p0, q0, p1, q1] = [1, 1, 2, 1];
  for (let i = 0; p1 <= aMost && q1 <= bMost; i++) {
    for (const s of [1, -1]) {
      for (const [da, db] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) pairs.push([s * (p1 + da!), -s * (q1 + db!)]);
      if (3 * q1 <= aMost && p1 <= bMost) pairs.push([s * 3 * q1, -s * p1]);
    }
    const step = i % 2 === 0 ? 2 : 1;
    [p0, q0, p1, q1] = [p1, q1, step * p1 + p0, step * q1 + q0];
  }
  expect(pairs.length).toBeGreaterThan(200);
  const rng = new Rng(3);
  for (let i = 0; i < 200000; i++) {
    const scale = [8, 600, 60000, bMost][i % 4]!;
    const b = rng.int(2 * scale + 1) - scale;
    // Half of them have a within a few of −b√3.
    const a = i % 2 === 0 ? rng.int(2 * scale + 1) - scale : Math.round(-b * Math.sqrt(3)) + rng.int(5) - 2;
    pairs.push([a, b]);
  }
  let wrong = 0;
  let ties = 0;
  for (const [a, b] of pairs) {
    if (signRoot3(a, b) !== bigSign(BigInt(a), BigInt(b))) wrong++;
    if (a !== 0 && Math.abs(a + b * Math.sqrt(3)) < 1e-4) ties++;
  }
  expect(wrong).toBe(0);
  // Pairs within 1e-4 of zero, the nearest about 1e-8 from it.
  expect(ties).toBeGreaterThan(20);
});

test("cross and dot products are exact out to the stated range", () => {
  // The bound in module.ts: a ≤ 96·M², b ≤ 48·M², so a² and 3b² stay under 2^53.
  expect(96 * EXACT_MOST ** 2 * (96 * EXACT_MOST ** 2)).toBeLessThan(2 ** 53);
  expect(3 * (48 * EXACT_MOST ** 2) ** 2).toBeLessThan(2 ** 53);
  expect(EXACT_MOST).toBeGreaterThanOrEqual(M_MOST + 4 * SIDE);
  const rng = new Rng(77);
  const pts = new Int32Array(12);
  let wrong = 0;
  let mostA = 0;
  let mostB = 0;
  for (let i = 0; i < 60000; i++) {
    for (let k = 0; k < 12; k++) {
      // A third of the trials sit on the corners of the range, a third are small, where points fall in line.
      pts[k] = i % 3 === 0 ? (rng.int(2) === 0 ? EXACT_MOST : -EXACT_MOST) : i % 3 === 1 ? rng.int(2 * EXACT_MOST + 1) - EXACT_MOST : rng.int(5) - 2;
    }
    const u = bigDelta(pts, 0, pts, 4);
    const v = bigDelta(pts, 0, pts, 8);
    const ca = u[0]! * v[2]! + 3n * u[1]! * v[3]! - u[2]! * v[0]! - 3n * u[3]! * v[1]!;
    const cb = u[0]! * v[3]! + u[1]! * v[2]! - u[2]! * v[1]! - u[3]! * v[0]!;
    if (orient(pts, 0, pts, 4, pts, 8) !== bigSign(ca, cb) || BigInt(exact.a) !== ca || BigInt(exact.b) !== cb) wrong++;
    mostA = Math.max(mostA, Math.abs(exact.a));
    mostB = Math.max(mostB, Math.abs(exact.b));
    const da = u[0]! * v[0]! + 3n * u[1]! * v[1]! + u[2]! * v[2]! + 3n * u[3]! * v[3]!;
    const db = u[0]! * v[1]! + u[1]! * v[0]! + u[2]! * v[3]! + u[3]! * v[2]!;
    if (dotSign(pts, 0, pts, 4, pts, 8) !== bigSign(da, db) || BigInt(exact.a) !== da || BigInt(exact.b) !== db) wrong++;
    mostA = Math.max(mostA, Math.abs(exact.a));
    mostB = Math.max(mostB, Math.abs(exact.b));
  }
  expect(wrong).toBe(0);
  expect(mostA).toBeLessThanOrEqual(96 * EXACT_MOST ** 2);
  expect(mostB).toBeLessThanOrEqual(48 * EXACT_MOST ** 2);
  // The corners of the range do reach most of the bound.
  expect(mostA).toBeGreaterThan(48 * EXACT_MOST ** 2);
});

test("equal tuples are equal points, and different tuples are different points", () => {
  const rng = new Rng(41);
  const n = 60000;
  const pts = new Int32Array(4 * n);
  const smalls = [1, 2, 3, 4, 5].map(tiny);
  expect(list(smalls[4]!)).toEqual([362, -418, 0, 209]);
  expect(idealX(smalls[4]!, 0)).toBeCloseTo(0.00138, 5);
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0 || i < 8) {
      for (let k = 0; k < 4; k++) pts[4 * i + k] = rng.int(9) - 4;
    } else {
      // A point a hair from an earlier one, in any direction, or the same point again.
      const from = 4 * rng.int(i);
      tupleTurn(smalls[rng.int(5)]!, 0, rng.int(12), pts, 4 * i);
      if (rng.int(4) === 0) tupleSet(pts, 4 * i, 0, 0, 0, 0);
      tupleAdd(pts, 4 * i, pts, from, pts, 4 * i);
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => idealX(pts, 4 * i) - idealX(pts, 4 * j));
  const a = new Int32Array(4);
  const b = new Int32Array(4);
  let same = 0;
  let near = 0;
  let wrong = 0;
  for (let s = 0; s < n; s++) {
    const i = order[s]!;
    ideal2(pts, 4 * i, a, 0);
    for (let e = s + 1; e < n && idealX(pts, 4 * order[e]!) - idealX(pts, 4 * i) < 0.02; e++) {
      const j = order[e]!;
      if (Math.abs(idealY(pts, 4 * j) - idealY(pts, 4 * i)) > 0.02) continue;
      ideal2(pts, 4 * j, b, 0);
      const samePoint = signRoot3(a[0]! - b[0]!, a[1]! - b[1]!) === 0 && signRoot3(a[2]! - b[2]!, a[3]! - b[3]!) === 0;
      if (samePoint !== tupleEqual(pts, 4 * i, pts, 4 * j)) wrong++;
      if (samePoint) same++;
      else near++;
    }
  }
  expect(wrong).toBe(0);
  expect(same).toBeGreaterThan(1000);
  // Different points within 3 cm of each other, down to 2 mm apart.
  expect(near).toBeGreaterThan(1000);
});

test("each direction's world vector is its tuple's, at every yaw", () => {
  const basis = new Int32Array(8);
  const next = new Int32Array(8);
  const axes = new Int32Array(4);
  const v = new Int32Array(10);
  let wrong = 0;
  for (let yaw = 0; yaw < 65536; yaw++) {
    basisOf(yaw, basis);
    frameAxes(yaw, axes);
    // a0 and a3 are today's +X and +Z, and a2 is a0 turned as turn60 turns it.
    turn60(basis[0]!, basis[1]!, v, 0);
    if (basis[0] !== axes[0] || basis[1] !== axes[1] || basis[6] !== axes[2] || basis[7] !== axes[3] || v[0] !== basis[4] || v[1] !== basis[5]) wrong++;
    basisOf((yaw + QUARTER_YAW) & 65535, next);
    for (let d = 0; d < 12; d++) {
      dirVector(basis, d, v, 0);
      worldOf(basis, 0, 0, DIRS, 4 * d, v, 2);
      // A piece along d has the yaw and class that give back the same vector; a quarter more yaw is three directions back.
      classAxis(yawOf(yaw, d), twOf(d), v, 4);
      dirVector(next, dirTurn(d, 3), v, 6);
      if (v[0] !== v[2] || v[1] !== v[3] || v[0] !== v[4] || v[1] !== v[5] || v[0] !== v[6] || v[1] !== v[7]) wrong++;
      if (dirOf(yaw, yawOf(yaw, d), twOf(d)) !== d) wrong++;
      // A triangle's second axis is the direction 60° on.
      classAxis60(yawOf(yaw, d), twOf(d), v, 8);
      dirVector(basis, dirTurn(d, 2), v, 6);
      if (v[8] !== v[6] || v[9] !== v[7]) wrong++;
    }
    // D4 = a2 − a0 and D5 = a3 − a1.
    dirVector(basis, 4, v, 0);
    dirVector(basis, 5, v, 2);
    if (v[0] !== basis[4]! - basis[0]! || v[1] !== basis[5]! - basis[1]! || v[2] !== basis[6]! - basis[2]! || v[3] !== basis[7]! - basis[3]!) wrong++;
  }
  // Turning 30° commutes with a quarter turn for any whole-number vector, ties in the rounding included.
  const rng = new Rng(30);
  for (let i = 0; i < 20000; i++) {
    const x = i % 4 === 0 ? 0 : rng.int(2001) - 1000;
    const z = rng.int(2001) - 1000;
    turn30(x, z, v, 0);
    turn30(-z, x, v, 2);
    turn60(x, z, v, 4);
    turn60(-z, x, v, 6);
    if (v[2] !== -v[1]! || v[3] !== v[0] || v[6] !== -v[5]! || v[7] !== v[4]) wrong++;
  }
  expect(wrong).toBe(0);
  basisOf(0, basis);
  expect(list(basis, 0, 8)).toEqual([768, 0, 665, 384, 384, 665, 0, 768]);
  expect(yawOf(100, 3)).toBe(65536 + 100 - 16384);
  expect(levelY(1000, 4)).toBe(1000 + 4 * LEVEL_UNITS);
  expect(LEVEL_UNITS * 4).toBe(HALF_SIDE * 2);
});

test("walks that close as tuples close in the world at all 16,384 base yaws", () => {
  const rng = new Rng(2024);
  // Twice round: six triangles' rim, a dodecagon's, a triangle and a square of each class, a snub-square corner's five faces.
  const walks: number[][] = [[0, 2, 4, 6, 8, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [1, 5, 9], [2, 6, 10], [0, 3, 6, 9], [1, 4, 7, 10], [2, 5, 8, 11], [0, 4, 8, 2, 6, 10, 4, 7, 10, 1, 7, 11, 3, 9, 0, 3, 6]].map((w) => [...w, ...w]);
  const t = new Int32Array(4);
  const c = new Int32Array(4);
  for (let w = 0; w < 12; w++) {
    const walk: number[] = [];
    tupleSet(t, 0, 0, 0, 0, 0);
    for (let s = 0; s < 80; s++) {
      const d = rng.int(12);
      walk.push(d);
      tupleStep(t, 0, d, 1, t, 0);
    }
    // Home along four neighbouring directions, which span the lattice as 1, ζ, ζ², ζ³ do.
    const k = rng.int(12);
    tupleTurn(t, 0, -k, c, 0);
    for (let i = 0; i < 4; i++) for (let s = Math.abs(c[i]!); s > 0; s--) walk.push(dirTurn(k + i, c[i]! > 0 ? 6 : 0));
    walks.push(walk);
  }
  const prefix = walks.map((walk) => {
    const p = new Int32Array(4 * (walk.length + 1));
    walk.forEach((d, s) => tupleStep(p, 4 * s, d, 1, p, 4 * s + 4));
    expect(list(p, 4 * walk.length)).toEqual([0, 0, 0, 0]);
    return p;
  });
  const basis = new Int32Array(8);
  const dirs = new Int32Array(24);
  const at = new Int32Array(2);
  let wrong = 0;
  let steps = 0;
  for (let yaw = 0; yaw < 16384; yaw++) {
    basisOf(yaw, basis);
    for (let d = 0; d < 12; d++) dirVector(basis, d, dirs, 2 * d);
    for (let w = 0; w < walks.length; w++) {
      const walk = walks[w]!;
      let x = 5000;
      let z = -7000;
      for (let s = 0; s < walk.length; s++) {
        // One piece placed off the last, by its direction's vector: the same place as the tuple's.
        x += dirs[2 * walk[s]!]!;
        z += dirs[2 * walk[s]! + 1]!;
        worldOf(basis, 5000, -7000, prefix[w]!, 4 * s + 4, at, 0);
        if (x !== at[0] || z !== at[1]) wrong++;
      }
      if (x !== 5000 || z !== -7000) wrong++;
      steps += walk.length;
    }
  }
  expect(wrong).toBe(0);
  expect(steps).toBeGreaterThan(16384 * 1000);
});

test("six triangles ring a corner and a dodecagon closes, every side shared exactly", () => {
  const p = tup(7, -3, 2, 5);
  const ring = [0, 1, 2, 3, 4, 5].map((k) => face(CLS_TRIANGLE, p, 2 * k));
  for (let k = 0; k < 6; k++) {
    // Each triangle's third corner is the next one's second.
    expect(list(ring[k]!.at, 8)).toEqual(list(ring[(k + 1) % 6]!.at, 4));
  }
  expect(overlaps(ring)).toEqual([]);
  expect(new Set(ring.map((f) => f.key)).size).toBe(6);
  expect([...sideCounts(ring).values()].sort()).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);

  // A square on each side of the hexagon, and a triangle in each gap between squares.
  const squares = ring.map((f) => across(f, 1, CLS_SQUARE));
  const gaps = ring.map((f, k) => face(CLS_TRIANGLE, f.at.slice(4, 8), dirTurn(2 * k, -1)));
  const all = [...ring, ...squares, ...gaps];
  expect(overlaps(all)).toEqual([]);
  expect(new Set(all.map((f) => f.key)).size).toBe(18);
  const counts = [...sideCounts(all).values()];
  expect(counts.filter((c) => c === 2).length).toBe(24);
  expect(counts.filter((c) => c === 1).length).toBe(12);
  // The twelve outer corners are all 2√(2 + √3) half-sides from the middle: four times its square is 32 + 16√3.
  const outer = new Set<string>();
  for (const s of squares) {
    for (const o of [8, 12]) {
      dotSign(p, 0, s.at, o, s.at, o);
      expect([exact.a, exact.b]).toEqual([32, 16]);
      outer.add(list(s.at, o).join());
    }
  }
  expect(outer.size).toBe(12);
  for (const g of gaps) for (const o of [4, 8]) expect(outer.has(list(g.at, o).join())).toBe(true);
});

test("a snub-square patch tiles: five faces at each corner, none overlapping", () => {
  // Square middles are a square grid of step 1 + ζ + ζ², alternately along the frame and 60° round. Triangles fill the rest.
  const u = tup(1, 1, 1, 0);
  const v = new Int32Array(4);
  tupleTurn(u, 0, 3, v, 0);
  const faces: Face[] = [];
  const inner = new Set<Face>();
  const c = new Int32Array(4);
  const t = new Int32Array(4);
  for (let j = -3; j <= 3; j++) {
    for (let k = -3; k <= 3; k++) {
      tupleScale(u, 0, j, c, 0);
      tupleScale(v, 0, k, t, 0);
      tupleAdd(c, 0, t, 0, c, 0);
      const d = (j + k) % 2 === 0 ? 0 : 2;
      tupleStep(c, 0, d, -1, c, 0);
      tupleStep(c, 0, d + 3, -1, c, 0);
      const square = face(CLS_SQUARE, c, d);
      squareCentre(c, 0, d, t, 0);
      tupleStep(c, 0, d, 1, c, 0);
      tupleStep(c, 0, d + 3, 1, c, 0);
      expect(list(t)).toEqual(list(c));
      faces.push(square);
      const within = Math.abs(j) <= 2 && Math.abs(k) <= 2;
      if (within) inner.add(square);
      if (d !== 0) continue;
      for (let i = 0; i < 4; i++) {
        const triangle = across(square, i, CLS_TRIANGLE);
        faces.push(triangle);
        if (within && Math.abs(j) + Math.abs(k) <= 2) inner.add(triangle);
      }
    }
  }
  expect(faces.length).toBe(49 + 4 * 25);
  expect(new Set(faces.map((f) => f.key)).size).toBe(faces.length);
  expect(overlaps(faces)).toEqual([]);
  const counts = sideCounts(faces);
  expect(Math.max(...counts.values())).toBe(2);
  const corners = new Map<string, number[]>();
  for (const f of faces) {
    for (let i = 0; i < f.n; i++) {
      const k = list(f.at, 4 * i).join();
      corners.set(k, [...(corners.get(k) ?? []), f.n]);
    }
  }
  expect(inner.size).toBeGreaterThan(40);
  for (const f of inner) {
    // Well inside the patch every side has a face on both sides, and every corner has two squares and three triangles.
    expect(sides(f).keys.map((k) => counts.get(k))).toEqual(Array(f.n).fill(2));
    for (let i = 0; i < f.n; i++) expect(corners.get(list(f.at, 4 * i).join())!.sort()).toEqual([3, 3, 3, 4, 4]);
  }
});

test("squares stand on a triangle's three sides, and one laid inward crosses it", () => {
  for (let d = 0; d < 12; d++) {
    const triangle = face(CLS_TRIANGLE, tup(-4, 9, 1, d), d);
    const squares = [0, 1, 2].map((i) => across(triangle, i, CLS_SQUARE));
    expect(overlaps([triangle, ...squares])).toEqual([]);
    const own = sides(triangle).keys;
    squares.forEach((s, i) => expect(sides(s).keys.filter((k) => own.includes(k))).toEqual([own[i]!]));
    // Two more triangles fill the 120° between each two squares: ten faces, nine outer sides.
    const fill = squares.flatMap((s) => [across(s, 1, CLS_TRIANGLE), across(s, 3, CLS_TRIANGLE)]);
    const all = [triangle, ...squares, ...fill];
    expect(overlaps(all)).toEqual([]);
    const counts = [...sideCounts(all).values()];
    expect(counts.filter((c) => c === 2).length).toBe(12);
    expect(counts.filter((c) => c === 1).length).toBe(9);
    // The same squares laid on the inside of each side.
    for (let i = 0; i < 3; i++) {
      const inward = face(CLS_SQUARE, triangle.at.slice(4 * i, 4 * i + 4), sides(triangle).dirs[i]!);
      expect(sides(inward).keys).toContain(own[i]!);
      expect(facesOverlap(triangle.at, 0, 3, inward.at, 0, 4)).toBe(true);
      expect(facesOverlap(inward.at, 0, 4, squares[i]!.at, 0, 4)).toBe(false);
    }
  }
});

test("a frame's own pieces land where socketPose puts them, bit for bit", () => {
  const rng = new Rng(608);
  const roles = [ROLE_FOUNDATION, ROLE_WALL, ROLE_CEILING, ROLE_PILLAR, ROLE_DOOR, ROLE_STAIRS];
  const half = [96, 768, 48, 768, 600, 768];
  const sockets = makeSockets();
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const basis = new Int32Array(8);
  const axes = new Int32Array(4);
  const at = new Int32Array(8);
  const t = new Int32Array(4);
  const corners = new Int32Array(16);
  let joined = 0;
  let squares = 0;
  for (let trial = 0; trial < 400; trial++) {
    const frameYaw = trial < 8 ? [0, 1, 16383, 16384, 32767, 32768, 49152, 65535][trial]! : rng.int(65536);
    basisOf(frameYaw, basis);
    // The first foundation's middle. The origin is its corner, a0 + a3 back from the middle.
    const first = { x: rng.int(200000) - 100000, y: 4096, z: rng.int(200000) - 100000, yaw: frameYaw, role: ROLE_FOUNDATION, m: tup(1, 0, 0, 1) };
    const ox = first.x - basis[0]! - basis[6]!;
    const oz = first.z - basis[1]! - basis[7]!;
    const built = [first];
    for (let step = 0; step < 150; step++) {
      // Mostly onto the newest piece, so the building wanders.
      const { x, y, z, yaw, role, m: from } = built[rng.int(3) === 0 ? rng.int(built.length) : built.length - 1]!;
      const m = from.slice();
      const piece = roles[rng.int(roles.length)]!;
      socketsFor(role, piece, half[role]!, half[piece]!, true, sockets);
      if (sockets.n === 0) continue;
      const k = rng.int(sockets.n);
      socketPose(sockets, k, x, y, z, yaw, piece, rng.int(4), pose);
      // The target's +X is direction d: the socket is i half-sides along it and j along the quarter turn on.
      const d = dirOf(frameYaw, yaw, 0);
      tupleStep(m, 0, d, sockets.i[k]!, m, 0);
      tupleStep(m, 0, dirTurn(d, 3), sockets.j[k]!, m, 0);
      worldOf(basis, ox, oz, m, 0, at, 0);
      expect([at[0], at[1]]).toEqual([pose.x, pose.z]);
      const facing = dirOf(frameYaw, pose.yaw, 0);
      expect(yawOf(frameYaw, facing)).toBe(pose.yaw);
      expect(twOf(facing)).toBe(0);
      frameAxes(pose.yaw, axes);
      dirVector(basis, facing, at, 0);
      dirVector(basis, dirTurn(facing, 3), at, 2);
      expect(list(at, 0, 4)).toEqual(list(axes));
      joined++;
      if (piece === ROLE_FOUNDATION || piece === ROLE_CEILING) {
        // Its lattice square, named from the corner behind its middle, then by its one name.
        tupleStep(m, 0, facing, -1, t, 0);
        tupleStep(t, 0, dirTurn(facing, 3), -1, t, 0);
        canonical(CLS_SQUARE, t, 0, facing, t, 0);
        expect(canon.dir).toBe(0);
        squareCentre(t, 0, canon.dir, corners, 0);
        expect(list(corners)).toEqual(list(m));
        squareCorners(t, 0, canon.dir, corners, 0);
        const got: string[] = [];
        const want: string[] = [];
        for (let c = 0; c < 4; c++) {
          worldOf(basis, ox, oz, corners, 4 * c, at, 0);
          got.push(`${at[0]},${at[1]}`);
          const sx = c === 0 || c === 3 ? -1 : 1;
          const sz = c < 2 ? -1 : 1;
          want.push(`${pose.x + sx * axes[0]! + sz * axes[2]!},${pose.z + sx * axes[1]! + sz * axes[3]!}`);
        }
        expect(got.sort()).toEqual(want.sort());
        squares++;
      } else if (piece === ROLE_WALL && (role === ROLE_FOUNDATION || role === ROLE_CEILING)) {
        // A wall on a floor's side is at the middle of one side of the floor's square.
        tupleStep(m, 0, d, -sockets.i[k]! - 1, t, 0);
        tupleStep(t, 0, dirTurn(d, 3), -sockets.j[k]! - 1, t, 0);
        squareCorners(t, 0, d, corners, 0);
        const mids: string[] = [];
        for (let c = 0; c < 4; c++) {
          edgeMid(corners, 4 * c, dirTurn(d, 3 * c), t, 0);
          mids.push(list(t).join());
        }
        expect(mids).toContain(list(m).join());
      }
      expect(tupleWithin(m, 0, M_MOST)).toBe(true);
      built.push({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, role: piece, m });
    }
  }
  expect(joined).toBeGreaterThan(15000);
  expect(squares).toBeGreaterThan(4000);
});

test("the three classes' sides differ by under 0.71 units and skew by under 0.052°", () => {
  const basis = new Int32Array(8);
  let spread = 0;
  let skew = 0;
  let off = 0;
  for (let yaw = 0; yaw < 16384; yaw++) {
    basisOf(yaw, basis);
    const length = [0, 1, 2].map((i) => Math.hypot(basis[2 * i]!, basis[2 * i + 1]!));
    spread = Math.max(spread, Math.max(...length) - Math.min(...length));
    for (const l of length) off = Math.max(off, Math.abs(l - HALF_SIDE));
    for (const [i, j, degrees] of [[0, 1, 30], [1, 2, 30], [0, 2, 60]]) {
      // The angle between two classes, from their cross and dot products.
      const cross = basis[2 * i!]! * basis[2 * j! + 1]! - basis[2 * i! + 1]! * basis[2 * j!]!;
      const dot = basis[2 * i!]! * basis[2 * j!]! + basis[2 * i! + 1]! * basis[2 * j! + 1]!;
      skew = Math.max(skew, Math.abs((Math.atan2(cross, dot) * 180) / Math.PI - degrees!));
    }
  }
  // Measured: 0.7015 units on a half-side of 768, 0.0513°, and 1.213 units from 768 at most.
  expect(spread).toBeLessThan(0.71);
  expect(spread).toBeGreaterThan(0.69);
  expect(skew).toBeLessThan(0.052);
  expect(skew).toBeGreaterThan(0.05);
  expect(off).toBeLessThan(1.22);
  expect(1 + off / HALF_SIDE).toBeLessThan(CLASS_STRETCH_MOST);
});

test("a place strays from its ideal by under 0.71 units per step along ζ or ζ²", () => {
  const rng = new Rng(88);
  const basis = new Int32Array(8);
  const at = new Int32Array(2);
  const m = new Int32Array(4);
  let most = 0;
  for (let yaw = 0; yaw < 16384; yaw++) {
    basisOf(yaw, basis);
    for (let i = 0; i < 8; i++) {
      tupleSet(m, 0, rng.int(1023) - 511, rng.int(1023) - 511, rng.int(1023) - 511, rng.int(1023) - 511);
      worldOf(basis, 0, 0, m, 0, at, 0);
      // The ideal place, in the frame's own +X and +Z.
      const dx = at[0]! - (idealX(m, 0) * basis[0]! + idealY(m, 0) * basis[6]!);
      const dz = at[1]! - (idealX(m, 0) * basis[1]! + idealY(m, 0) * basis[7]!);
      if (m[1] !== 0 || m[2] !== 0) most = Math.max(most, Math.hypot(dx, dz) / Math.hypot(m[1]!, m[2]!));
      else expect(Math.hypot(dx, dz)).toBeLessThan(1e-6);
    }
  }
  // Measured: 0.7015. It is the 0.051° of skew: over 600 m along ζ, half a metre.
  expect(most).toBeLessThan(DRIFT_MOST);
  expect(most).toBeGreaterThan(0.69);
});

test("an edge, a square and a triangle named from any corner have one key", () => {
  const rng = new Rng(909);
  const a = new Int32Array(4);
  const at = new Int32Array(16);
  const named = new Int32Array(4);
  for (let i = 0; i < 20000; i++) {
    const cls = i % 4;
    const d = rng.int(CLS_DIRS[cls]!);
    for (let k = 0; k < 4; k++) a[k] = rng.int(2 * M_MOST + 1) - M_MOST;
    const n = elementCorners(cls, a, 0, d, at, 0);
    expect(n).toBe(CLS_CORNERS[cls]!);
    for (let c = 0; c < n; c++) {
      // Corner c names the element along d + c steps, and comes back to the one anchor, with c as its turn.
      canonical(cls, at, 4 * c, d + c * CLS_STEP[cls]!, named, 0);
      expect([...named, canon.dir, canon.turn]).toEqual([...a, d, c]);
    }
  }
  canonical(CLS_VERTEX, a, 0, 0, named, 0);
  expect([...named, canon.dir, canon.turn]).toEqual([...a, 0, 0]);

  // Every element with its anchor in a small box: as many different sets of corners as keys, and every other name is one of them.
  const byKey = new Map<string, string>();
  const shapes = new Set<string>();
  for (let cls = 0; cls < 4; cls++) {
    for (let d = 0; d < CLS_DIRS[cls]!; d++) {
      for (let m = 0; m < 625; m++) {
        tupleSet(a, 0, (m % 5) - 2, (Math.floor(m / 5) % 5) - 2, (Math.floor(m / 25) % 5) - 2, Math.floor(m / 125) - 2);
        const f = face(cls, a, d);
        const shape = cls + ":" + Array.from({ length: f.n }, (_, c) => list(f.at, 4 * c).join()).sort().join(" ");
        expect(byKey.has(f.key)).toBe(false);
        byKey.set(f.key, shape);
        shapes.add(shape);
      }
    }
  }
  expect(byKey.size).toBe(625 * (1 + 6 + 3 + 4));
  expect(shapes.size).toBe(byKey.size);
  for (let i = 0; i < 20000; i++) {
    const cls = 1 + (i % 3);
    tupleSet(a, 0, rng.int(3) - 1, rng.int(3) - 1, rng.int(3) - 1, rng.int(3) - 1);
    const f = face(cls, a, rng.int(12));
    const shape = cls + ":" + Array.from({ length: f.n }, (_, c) => list(f.at, 4 * c).join()).sort().join(" ");
    if (byKey.has(f.key)) expect(byKey.get(f.key)).toBe(shape);
    else expect(shapes.has(shape)).toBe(false);
  }
});

test("a key packs and unpacks over its whole range, and a cell ignores turn and flip", () => {
  const rng = new Rng(31);
  const words = new Uint32Array(2);
  const a = new Int32Array(4);
  const seen = new Set<string>();
  for (let i = 0; i < 200000; i++) {
    // Each field in turn sweeps its whole range while the others are random.
    const sweep = i % 10;
    const pick = (field: number, lo: number, count: number): number => lo + (sweep === field ? Math.floor(i / 10) % count : rng.int(count));
    const m = [0, 1, 2, 3].map((f) => pick(f, -M_MOST, 2 * M_MOST + 1));
    const lvl = pick(4, -LVL_MOST, 2 * LVL_MOST + 1);
    const cls = pick(5, 0, 4);
    const dir = pick(6, 0, CLS_DIRS[cls]!);
    const layer = pick(7, 0, 8);
    const rot = pick(8, 0, 4);
    const flip = pick(9, 0, 2);
    words[0] = key0(cls, m[0]!, m[1]!, m[2]!);
    words[1] = key1(m[3]!, lvl, dir, layer, rot, flip);
    const k0 = words[0]!;
    const k1 = words[1]!;
    expect([k0, k1]).toEqual([key0(cls, m[0]!, m[1]!, m[2]!), key1(m[3]!, lvl, dir, layer, rot, flip)]);
    expect([keyCls(k0), keyM0(k0), keyM1(k0), keyM2(k0), keyM3(k1), keyLvl(k1), keyDir(k1), keyLayer(k1), keyRot(k1), keyFlip(k1)]).toEqual([cls, ...m, lvl, dir, layer, rot, flip]);
    keyAnchor(k0, k1, a, 0);
    expect(list(a)).toEqual(m);
    expect(keyValid(k0, k1)).toBe(true);
    expect(cellOf(k1)).toBe(key1(m[3]!, lvl, dir, layer, 0, 0));
    seen.add(`${k0}:${cellOf(k1)}`);
    if (i < 2000) {
      // Changing any one field but turn and flip is another cell.
      expect(cellOf(key1(m[3]!, lvl, dir, (layer + 1) % 8, rot, flip))).not.toBe(cellOf(k1));
      expect(cellOf(key1(m[3]!, lvl === LVL_MOST ? 0 : lvl + 1, dir, layer, rot, flip))).not.toBe(cellOf(k1));
      expect(cellOf(key1(m[3]! === M_MOST ? 0 : m[3]! + 1, lvl, dir, layer, rot, flip))).not.toBe(cellOf(k1));
      expect(keyValid(k0, key1(m[3]!, lvl, CLS_DIRS[cls]!, layer, rot, flip))).toBe(false);
      expect(keyValid(k0, (k1 | (1 << (29 + rng.int(3)))) >>> 0)).toBe(false);
      expect(keyValid(k0, key1(m[3]!, -LVL_MOST - 1, dir, layer, rot, flip))).toBe(false);
      expect(keyValid(k0, key1(-M_MOST - 1, lvl, dir, layer, rot, flip))).toBe(false);
      expect(keyValid(key0(cls, m[0]!, -M_MOST - 1, m[2]!), k1)).toBe(false);
    }
  }
  expect(seen.size).toBeGreaterThan(190000);
  expect(keyValid(0, 0)).toBe(false);
});

test("faces that share a side or a corner do not overlap, and faces that cross do", () => {
  const a = face(CLS_SQUARE, ZERO, 0);
  expect(facesOverlap(a.at, 0, 4, a.at, 0, 4)).toBe(true);
  for (let i = 0; i < 4; i++) {
    for (const cls of [CLS_SQUARE, CLS_TRIANGLE]) {
      const beside = across(a, i, cls);
      expect(facesOverlap(a.at, 0, 4, beside.at, 0, beside.n)).toBe(false);
      expect(facesOverlap(beside.at, 0, beside.n, a.at, 0, 4)).toBe(false);
    }
    // A square of another class standing on a corner only, and the same square turned in across the corner.
    const corner = a.at.slice(4 * i, 4 * i + 4);
    for (const d of [1, 2]) {
      const out = face(CLS_SQUARE, corner, dirTurn(3 * i + 6, d));
      expect(facesOverlap(a.at, 0, 4, out.at, 0, 4)).toBe(false);
      const turnedIn = face(CLS_SQUARE, corner, dirTurn(3 * i, d));
      expect(facesOverlap(a.at, 0, 4, turnedIn.at, 0, 4)).toBe(true);
    }
  }
  // A triangle whose tip pokes through a square's side.
  const poke = face(CLS_TRIANGLE, tup(1, 0, 0, -1), 1);
  expect(facesOverlap(a.at, 0, 4, poke.at, 0, 3)).toBe(true);

  // Against areas clipped in floats, with both faces turned and mirrored: the answer is the patch's own, whatever the frame.
  const rng = new Rng(1234);
  const p = new Int32Array(4);
  const draw = (): [number, Int32Array, number] => [rng.int(2) === 0 ? CLS_SQUARE : CLS_TRIANGLE, tup(rng.int(7) - 3, rng.int(7) - 3, rng.int(7) - 3, rng.int(7) - 3), rng.int(12)];
  const moved = (f: [number, Int32Array, number], k: number, mirror: boolean): Face => {
    tupleTurn(f[1], 0, k, p, 0);
    if (!mirror) return face(f[0], p, dirTurn(f[2], k));
    // A mirrored face keeps its corner, and is named along what was its second side.
    tupleMirror(p, 0, p, 0);
    return face(f[0], p, dirMirror(dirTurn(f[2], k + (f[0] === CLS_SQUARE ? 3 : 2))));
  };
  let both = 0;
  let touching = 0;
  let wrong = 0;
  for (let i = 0; i < 30000; i++) {
    const f = draw();
    const g = draw();
    const fa = moved(f, 0, false);
    // Half of the second faces start from a corner of the first, or half a side from one: these touch it or cross it.
    if (i % 2 === 0) tupleStep(fa.at, 4 * rng.int(fa.n), rng.int(12), rng.int(2), g[1], 0);
    const ga = moved(g, 0, false);
    const area = sharedArea(floats(fa.at, fa.n), floats(ga.at, ga.n));
    const hit = facesOverlap(fa.at, 0, fa.n, ga.at, 0, ga.n);
    if (hit !== area > 1e-9 || hit !== facesOverlap(ga.at, 0, ga.n, fa.at, 0, fa.n)) wrong++;
    if (hit) both++;
    else if (floats(fa.at, fa.n).some(([x, y]) => floats(ga.at, ga.n).some(([gx, gy]) => x === gx && y === gy))) touching++;
    const k = rng.int(12);
    const mirror = rng.int(2) === 1;
    const fb = moved(f, k, mirror);
    const gb = moved(g, k, mirror);
    if (facesOverlap(fb.at, 0, fb.n, gb.at, 0, gb.n) !== hit) wrong++;
  }
  expect(wrong).toBe(0);
  expect(both).toBeGreaterThan(3000);
  expect(touching).toBeGreaterThan(3000);
});

test("patches that meet without sharing corners are judged exactly, at any yaw", () => {
  // 2 mm: (2 − √3)⁵ half-sides.
  const hair = tiny(5);
  const a = face(CLS_SQUARE, ZERO, 0);
  const p = new Int32Array(4);
  const shift = new Int32Array(4);
  let judged = 0;
  for (const cls of [CLS_SQUARE, CLS_TRIANGLE]) {
    for (let i = 0; i < 4; i++) {
      const beside = across(a, i, cls);
      // The way out through side i of the square, and along it.
      const out = dirTurn(3 * i, -3);
      for (const along of [0, 1, -1]) {
        for (const sign of [1, -1]) {
          // A hair out leaves a gap; a hair in overlaps; sliding along the side changes neither.
          tupleTurn(hair, 0, out, shift, 0);
          tupleScale(shift, 0, sign, shift, 0);
          tupleAdd(beside.at, 0, shift, 0, p, 0);
          tupleStep(p, 0, 3 * i, along, p, 0);
          tupleTurn(hair, 0, 3 * i, shift, 0);
          tupleScale(shift, 0, along, shift, 0);
          tupleAdd(p, 0, shift, 0, p, 0);
          const f = face(cls, p, dirTurn(3 * i, 6));
          const shared = sides(f).keys.filter((k) => sides(a).keys.includes(k));
          expect(shared).toEqual([]);
          expect(facesOverlap(a.at, 0, 4, f.at, 0, f.n)).toBe(sign === -1);
          expect(facesOverlap(f.at, 0, f.n, a.at, 0, 4)).toBe(sign === -1);
          judged++;
        }
      }
    }
  }
  expect(judged).toBe(48);
  // Corner to corner: a hair apart along the diagonal, and a hair into each other.
  for (const sign of [1, -1]) {
    tupleSet(p, 0, 2 + sign * hair[0]!, sign * hair[1]!, 0, 2 + sign * hair[3]!);
    tupleTurn(hair, 0, 3, shift, 0);
    tupleScale(shift, 0, sign, shift, 0);
    tupleAdd(p, 0, shift, 0, p, 0);
    const f = face(CLS_SQUARE, p, 0);
    expect(facesOverlap(a.at, 0, 4, f.at, 0, 4)).toBe(sign === -1);
  }

  // The predicate is given no yaw. The hair's whole-number vector in the world does change with it, even in sign.
  const basis = new Int32Array(8);
  const at = new Int32Array(2);
  const seen = new Set<string>();
  let most = 0;
  for (let yaw = 0; yaw < 16384; yaw += 7) {
    basisOf(yaw, basis);
    worldOf(basis, 0, 0, hair, 0, at, 0);
    // Along the frame's +X, where the ideal hair is 1.06 units long.
    const along = (at[0]! * basis[0]! + at[1]! * basis[1]!) / HALF_SIDE;
    seen.add(`${Math.sign(Math.round(along))}`);
    most = Math.max(most, Math.hypot(at[0]!, at[1]!));
  }
  expect([...seen].sort()).toEqual(["-1", "0", "1"]);
  // Its 418 half-sides along ζ put it up to 294 units from its ideal 1.06.
  expect(most).toBeLessThan(DRIFT_MOST * 418 + 2);
  expect(most).toBeGreaterThan(250);
});

test("edges overlap only along one line and for more than a point", () => {
  const hair = tiny(5);
  const p = new Int32Array(4);
  const q = new Int32Array(4);
  const a = new Int32Array(8);
  const b = new Int32Array(8);
  const shift = new Int32Array(4);
  const rng = new Rng(55);
  for (let i = 0; i < 600; i++) {
    const d = rng.int(12);
    tupleSet(p, 0, rng.int(21) - 10, rng.int(21) - 10, rng.int(21) - 10, rng.int(21) - 10);
    edgeEnds(p, 0, d, a, 0);
    const hits = (from: Int32Array, dir: number): boolean => {
      edgeEnds(from, 0, dir, b, 0);
      const hit = edgesOverlap(a, 0, b, 0);
      expect(edgesOverlap(b, 0, a, 0)).toBe(hit);
      return hit;
    };
    // Itself from either end, and half a side along, either way.
    expect(hits(p, d)).toBe(true);
    expect(hits(a.subarray(4), dirTurn(d, 6))).toBe(true);
    tupleStep(p, 0, d, 1, q, 0);
    expect(hits(q, d)).toBe(true);
    tupleStep(p, 0, d, -1, q, 0);
    expect(hits(q, d)).toBe(true);
    // End to end, and a hair short of or past that, at both ends.
    tupleTurn(hair, 0, d, shift, 0);
    for (const end of [SIDE, -SIDE]) {
      tupleStep(p, 0, d, end, q, 0);
      expect(hits(q, d)).toBe(false);
      tupleAdd(q, 0, shift, 0, q, 0);
      expect(hits(q, d)).toBe(end < 0);
      tupleSub(q, 0, shift, 0, q, 0);
      tupleSub(q, 0, shift, 0, q, 0);
      expect(hits(q, d)).toBe(end > 0);
    }
    // Beside it by a hair, crossing it at its middle, and leaving its end at every other angle.
    tupleTurn(hair, 0, d + 3, shift, 0);
    tupleAdd(p, 0, shift, 0, q, 0);
    expect(hits(q, d)).toBe(false);
    edgeMid(p, 0, d, q, 0);
    tupleStep(q, 0, dirTurn(d, 3), -1, q, 0);
    expect(hits(q, dirTurn(d, 3))).toBe(false);
    for (let k = 1; k < 12; k++) if (k !== 6) expect(hits(p, dirTurn(d, k))).toBe(false);

    // On the segment: its ends and middle. Off it: past an end by a hair, beside it by a hair.
    edgeMid(p, 0, d, q, 0);
    expect(onSegment(q, 0, a, 0)).toBe(true);
    expect(onSegment(a, 0, a, 0)).toBe(true);
    expect(onSegment(a, 4, a, 0)).toBe(true);
    tupleAdd(q, 0, shift, 0, q, 0);
    expect(onSegment(q, 0, a, 0)).toBe(false);
    tupleTurn(hair, 0, d, shift, 0);
    tupleAdd(a, 4, shift, 0, q, 0);
    expect(onSegment(q, 0, a, 0)).toBe(false);
    tupleSub(a, 4, shift, 0, q, 0);
    expect(onSegment(q, 0, a, 0)).toBe(true);
    tupleSub(a, 0, shift, 0, q, 0);
    expect(onSegment(q, 0, a, 0)).toBe(false);
  }
});
