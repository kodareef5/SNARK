// A built piece's instance, and how its vertices are placed: by the whole-number vectors collision places its boxes by
// (shared/world/frame.ts), so what is drawn is what is hit, at any base yaw and for pieces 30 and 60 degrees round in a
// base. The same rule is here as text for the three rigid vertex programs and as a class for the software rasterizer.
//
// A draw flagged DRAW_PIECE reads its 20 bytes so:
//   0-11   x, y, z, as any instance.
//   12-13  framed (PIECE_FRAMED in the state byte): bits 4 to 6 a slot of the draw's frame table, bits 0 to 3 the
//          piece's direction in that slot's basis, 0 to 11. Not framed: its yaw, as any instance.
//   14-16  colour regions 0 to 2.
//   17     bits 0 to 4: the recipe material it wears (content/texgen/materials.ts), 0 for none.
//   18     state: bits 0 and 1 its damage stage (shared/world/breaking.ts), bit 2 scorched, bits 3 to 6 the turn at a
//          trim's +X end, bit 7 framed.
//   19     fit: bits 6 and 7 its class (FIT_), bits 4 and 5 its size, bits 0 to 3 what yields.
// Fit by class. A wall: bit 0 its -X end yields, bit 1 its +X end; size is the edges it is long, less one. A square:
// bits 0 to 3 its sides north (+Z), east, south, west; size 1 is half a side across, from its low corner. A triangle:
// bits 0 to 2 the sides of its outline (forms.ts): from its first corner along its second axis, back down to the far
// end of its first, and along its first; size 1 is half a side. No class and no size: bits 0 to 3 the quarter storeys
// a trim is cut off at, 0 for its full height. No class and size 1 (FIT_ENDS), a trim that lies along a side, its +Z
// the way out: bits 0 to 3 the turn at its -X end, and the state byte has its +X end's. A turn is the twelfths of a
// turn the corner there is past straight, 1 to 5, with PIECE_END_IN where it is an inside corner, or PIECE_END_RUN in a
// straight run: the end is laid on the plane that halves the corner, so two trims meet on it. 0 leaves the end as the
// mesh has it.

import { YAW_UNITS } from "../../../shared/coords.ts";
import { HALF_SIDE } from "../../../shared/world/frame.ts";
import { basisOf } from "../../../shared/world/lattice/basis.ts";
import { HALF_SIDE_M, LEVEL_M, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { WEAR_SHADE, WEAR_STAGE } from "./pieces.ts";

/** Frames a draw's table holds: three bits of an instance. */
export const PIECE_FRAMES = 8;
/** The table as a uniform: a vec4 holds two of a frame's three axes. */
export const FRAME_VECTORS = (PIECE_FRAMES * 3) / 2;
/** Metres a yielding end or side gives way by: the forms' yield band. */
export const PIECE_YIELD = 0.1;
/** Metres a cut trim stands over the height it is cut to, so its top lies in no piece's top. */
export const TRIM_CAP = 0.01;

export const PIECE_MADE_AT = 17;
export const PIECE_STATE_AT = 18;
export const PIECE_FIT_AT = 19;
export const PIECE_STAGE = WEAR_STAGE;
export const PIECE_SCORCHED = 4;
export const PIECE_FRAMED = 128;
export const PIECE_MADE_BITS = 31;
/**
 * In the spare byte of a vertex of a piece's flat mesh, over its corner and edges (shared/world/city.ts cornerByte):
 * its face wears the piece's recipe material in the mesh's own colour, and keeps clear of the material's joints and rivets.
 */
export const FACE_WEARS = 64, FACE_PLAIN = 128;

export const FIT_NONE = 0;
export const FIT_WALL = 1;
export const FIT_SQUARE = 2;
export const FIT_TRIANGLE = 3;
export const FIT_CLASS_SHIFT = 6;
export const FIT_SIZE_SHIFT = 4;
export const FIT_YIELD = 15;
/** A trim along a side whose ends are turned: its fit byte's size. */
export const FIT_ENDS = 1 << FIT_SIZE_SHIFT;
/** Where a trim's +X end's turn is in its state byte, and the bit of a turn that says the corner is an inside one. */
export const PIECE_END_SHIFT = 3;
export const PIECE_END_IN = 8;
/** The turn of an end that meets the next trim in a straight run: it is laid square on the side's own end. */
export const PIECE_END_RUN = 6;
/** Metres from a side's end within which a trim's point is its end's, and is laid on the corner's plane. */
export const END_SNAP = 0.005;
/** A point this far inside a triangle's ring, or nearer its side, keeps its place by that side when another side gives way. */
const RING_HOLD = 0.01;
/** The tangent of each turn's half: how far along a trim's end runs for each metre out. */
const END_RUNS = [0, 1, 2, 3, 4, 5].map((n) => Math.tan((n * Math.PI) / 12));

const QUARTER = YAW_UNITS / 4;
const ROOT3_2 = 0.8660254037844386;
const basis = new Int32Array(8);
let stamps = 0;

/** The class and size bits of a form's fit byte. */
export function fitOfForm(f: FormDef): number {
  if (f.cls === "edge" && f.plane === "upright") {
    const wide = new Set((f.cells ?? [[0, 0]]).map((c) => c[0])).size;
    return (FIT_WALL << FIT_CLASS_SHIFT) | (Math.min(3, wide - 1) << FIT_SIZE_SHIFT);
  }
  if (f.plane !== "flat" || (f.cls !== "square" && f.cls !== "triangle")) return 0;
  return ((f.cls === "square" ? FIT_SQUARE : FIT_TRIANGLE) << FIT_CLASS_SHIFT) | ((f.size === 1 ? 1 : 0) << FIT_SIZE_SHIFT);
}

/** Whether a form's mesh may be clamped at its ends or sides: it says the band the clamp is made for. */
export function yields(f: FormDef): boolean {
  return Math.abs(f.yieldBand - PIECE_YIELD) < 1e-9 && fitOfForm(f) !== 0;
}

/**
 * The bases a draw's pieces stand in: for each, the three axes of its lattice, as collision has them, in metres a
 * metre. A slot is a yaw less its quarter turns, so bases a quarter turn apart share one, and so does a free row.
 */
export class FrameTable {
  readonly axes = new Float32Array(FRAME_VECTORS * 4);
  readonly within = new Int32Array(PIECE_FRAMES);
  count = 0;
  /** Changes whenever the axes do, and is no other table's: what a shell knows the uniform by. */
  stamp = ++stamps;

  clear(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.stamp = ++stamps;
  }

  /** The slot of the basis a piece turned `yaw` stands in, or -1. */
  slotOf(yaw: number): number {
    const w = yaw & (QUARTER - 1);
    for (let k = 0; k < this.count; k++) if (this.within[k] === w) return k;
    return -1;
  }

  /** The same, made if there is room for it. */
  add(yaw: number): number {
    const had = this.slotOf(yaw);
    if (had >= 0 || this.count === PIECE_FRAMES) return had;
    const k = this.count++;
    this.within[k] = yaw & (QUARTER - 1);
    basisOf(this.within[k]!, basis);
    for (let i = 0; i < 6; i++) this.axes[k * 6 + i] = basis[i]! / HALF_SIDE;
    this.stamp = ++stamps;
    return k;
  }
}

/** What a framed instance holds where another holds its yaw: its slot, and its direction in the slot's basis. */
export function pieceWord(slot: number, yaw: number, tw: number): number {
  return (slot << 4) | (((4 - (yaw >>> 14)) & 3) * 3 + tw);
}

/** The yaw nearest a piece's turn, for one whose basis the table has no room for: its class is a twelfth of a turn each. */
export function plainYaw(yaw: number, tw: number): number {
  return (yaw - Math.round((tw * YAW_UNITS) / 12)) & (YAW_UNITS - 1);
}

/** The cosine and sine a framed piece of `yaw` and class `tw` is turned by, as a table's slot gives them, to `out[0]` and `out[1]`. */
export function pieceTurn(yaw: number, tw: number, out: number[]): void {
  basisOf(yaw & (QUARTER - 1), basis);
  const d = pieceWord(0, yaw, tw);
  for (let i = 0; i < 6; i++) turnAxes[i] = basis[i]! / HALF_SIDE;
  axis(turnAxes, 0, d, out);
  out[1] = -out[1]!;
}

const turnAxes = new Float32Array(6);

/** How far along and across its first axis a framed triangle's second axis runs, for its length, as PieceFit lays one: 0.5 and 0.866 on a true lattice. */
export function pieceSkew(yaw: number, tw: number, out: number[]): void {
  basisOf(yaw & (QUARTER - 1), basis);
  const d = pieceWord(0, yaw, tw);
  for (let i = 0; i < 6; i++) turnAxes[i] = basis[i]! / HALF_SIDE;
  axis(turnAxes, 0, d, X);
  axis(turnAxes, 0, d > 9 ? d - 10 : d + 2, Y);
  const n = X[0]! * X[0]! + X[1]! * X[1]!;
  out[0] = (Y[0]! * X[0]! + Y[1]! * X[1]!) / n;
  out[1] = (Y[1]! * X[0]! - Y[0]! * X[1]!) / n;
}

/** Writes instance `i`'s piece bytes: its word or yaw, the material it wears, its state and its fit. */
export function writePiece(bytes: Uint8Array, i: number, word: number, made: number, state: number, fit: number): void {
  const at = i * INSTANCE_BYTES;
  bytes[at + 12] = word & 255;
  bytes[at + 13] = word >>> 8;
  bytes[at + PIECE_MADE_AT] = made & PIECE_MADE_BITS;
  bytes[at + PIECE_STATE_AT] = state;
  bytes[at + PIECE_FIT_AT] = fit;
}

const half = HALF_SIDE_M.toFixed(1);
const band = PIECE_YIELD.toFixed(1);
const hold = (PIECE_YIELD + RING_HOLD).toFixed(2);

/** What a rigid vertex text declares after its attributes: the draw's table, and the rule. */
export const PIECE_FIT_GLSL = `uniform float uPiece;
uniform vec4 uFrames[${FRAME_VECTORS}];
vec2 pieceAxis(int k, int d) {
  int a = k + d % 3, q = d / 3;
  vec4 f = uFrames[a >> 1];
  vec2 v = (a & 1) == 0 ? f.xy : f.zw;
  return q == 0 ? v : q == 1 ? vec2(-v.y, v.x) : q == 2 ? -v : vec2(v.y, -v.x);
}
float pieceEnd(uint turn) {
  uint n = turn & 7u;
  float run = n == 1u ? ${END_RUNS[1]!.toFixed(5)} : n == 2u ? ${END_RUNS[2]!.toFixed(5)} : n == 3u ? 1.0 : n == 4u ? ${END_RUNS[4]!.toFixed(5)} : n == 5u ? ${END_RUNS[5]!.toFixed(5)} : 0.0;
  return (turn & ${PIECE_END_IN}u) != 0u ? -run : run;
}
void pieceFit(inout vec3 l, inout float s, inout float c) {
  uint fit = iRegB.y, cls = fit >> ${FIT_CLASS_SHIFT}u;
  float size = float((fit >> ${FIT_SIZE_SHIFT}u) & 3u);
  if (cls == ${FIT_NONE}u) {
    if (size < 0.5) {
      if ((fit & ${FIT_YIELD}u) != 0u) l.y = min(l.y, float(fit & ${FIT_YIELD}u) * ${LEVEL_M} + ${TRIM_CAP});
    } else {
      // A trim along a side: each turned end lies on the plane that halves its corner, further along the further out.
      uint low = fit & ${FIT_YIELD}u, high = (iRegB.x >> ${PIECE_END_SHIFT}u) & ${FIT_YIELD}u;
      if (low != 0u) {
        float e = -${half} - pieceEnd(low) * l.z;
        l.x = l.x < ${(END_SNAP - HALF_SIDE_M).toFixed(3)} ? e : max(l.x, e);
      }
      if (high != 0u) {
        float e = ${half} + pieceEnd(high) * l.z;
        l.x = l.x > ${(HALF_SIDE_M - END_SNAP).toFixed(3)} ? e : min(l.x, e);
      }
    }
  } else if (cls == ${FIT_WALL}u) {
    float end = ${half} * (size + 1.0) - ${band};
    if ((fit & 1u) != 0u) l.x = max(l.x, -end);
    if ((fit & 2u) != 0u) l.x = min(l.x, end);
  } else if (cls == ${FIT_SQUARE}u) {
    float lo = size > 0.5 ? ${band} : ${band} - ${half}, hi = ${half} - ${band};
    if ((fit & 1u) != 0u) l.z = min(l.z, hi);
    if ((fit & 2u) != 0u) l.x = min(l.x, hi);
    if ((fit & 4u) != 0u) l.z = max(l.z, lo);
    if ((fit & 8u) != 0u) l.x = max(l.x, lo);
  } else if ((fit & 7u) != 0u) {
    // How far inside each side the vertex is: the three add up to the triangle's height.
    float h = (size > 0.5 ? ${half} : 2.0 * ${half}) * ${ROOT3_2};
    vec3 e = vec3(${ROOT3_2} * l.x - 0.5 * l.z, 0.0, l.z);
    e.y = h - e.x - e.z;
    // Only a side that gives way moves a point, and only one short of its ring: a point past a side that stands is left.
    vec3 up = vec3(fit & 1u, (fit >> 1u) & 1u, (fit >> 2u) & 1u) * max(${band} - e, 0.0);
    float over = up.x + up.y + up.z;
    if (over > 0.00001) {
      // What it moved in by is taken from the sides it is clear of, so it moves straight in, or along a side it is on;
      // and from neither past that side's own ring, so near a corner it stops where the two rings meet.
      vec3 room = max(e - ${hold}, 0.0);
      vec3 give = min(room, over / max(dot(step(0.000001, room), vec3(1.0)), 1.0));
      vec3 left = room - give;
      give += left * min(1.0, max(over - give.x - give.y - give.z, 0.0) / max(left.x + left.y + left.z, 0.000001));
      vec3 m = e + up - give;
      l.z = m.z;
      l.x = (m.x + 0.5 * m.z) / ${ROOT3_2};
    }
  }
  if ((iRegB.x & ${PIECE_FRAMED}u) == 0u) return;
  int w = int(iYaw * 65535.0 + 0.5), d = w & 15, k = ((w >> 4) & ${PIECE_FRAMES - 1}) * 3;
  vec2 x = pieceAxis(k, d);
  c = x.x;
  s = -x.y;
  if (cls == ${FIT_TRIANGLE}u) {
    // Its second axis is the lattice's own, two directions on: a point along it is laid on that, not on a 60 degree turn.
    vec2 y = pieceAxis(k, d > 9 ? d - 10 : d + 2);
    float b = l.z / ${ROOT3_2}, n = dot(x, x);
    l.x = l.x - 0.5 * b + b * dot(y, x) / n;
    l.z = b * (y.y * x.x - y.x * x.y) / n;
  }
}
`;
/** In a rigid vertex's branch, once `l`, `s` and `c` are its own place and its yaw's sine and cosine. */
export const PIECE_FIT_PLACE = "    if (uPiece > 0.5) pieceFit(l, s, c);\n";
/** After the vertex's colour is read into `vColor`: a built piece is darker by its stage, as a city piece is. */
export const PIECE_FIT_SHADE = `  if (uPiece > 0.5) vColor *= 1.0 - ${WEAR_SHADE} * float(iRegB.x & ${PIECE_STAGE}u);
`;

/** The rule as the rasterizer runs it: `begin` for an instance, then `vertex` for each of its mesh's points. */
export class PieceFit {
  /** The cosine and sine the instance's vertices are turned by: its basis's +X, which is not a metre long. */
  c = 1;
  s = 0;
  /** The last vertex, clamped and laid on its basis, in the piece's own frame. */
  x = 0;
  y = 0;
  z = 0;
  private fit = 0;
  private ends = 0;
  private skew = false;
  private along = 0;
  private across = 0;

  /** Instance `at` of `data`, of a draw whose table is `table`. */
  begin(table: FrameTable | undefined, data: Uint8Array, at: number): void {
    const word = data[at + 12]! | (data[at + 13]! << 8);
    this.fit = data[at + PIECE_FIT_AT]!;
    this.ends = (data[at + PIECE_STATE_AT]! >> PIECE_END_SHIFT) & FIT_YIELD;
    this.skew = false;
    if ((data[at + PIECE_STATE_AT]! & PIECE_FRAMED) === 0 || !table) {
      const yaw = (word / YAW_UNITS) * Math.PI * 2;
      this.c = Math.cos(yaw);
      this.s = Math.sin(yaw);
      return;
    }
    const d = word & 15, k = ((word >> 4) & (PIECE_FRAMES - 1)) * 3;
    axis(table.axes, k, d, X);
    this.c = X[0]!;
    this.s = -X[1]!;
    if (this.fit >> FIT_CLASS_SHIFT !== FIT_TRIANGLE) return;
    axis(table.axes, k, d > 9 ? d - 10 : d + 2, Y);
    const n = X[0]! * X[0]! + X[1]! * X[1]!;
    this.skew = true;
    this.along = (Y[0]! * X[0]! + Y[1]! * X[1]!) / n;
    this.across = (Y[1]! * X[0]! - Y[0]! * X[1]!) / n;
  }

  vertex(x: number, y: number, z: number): void {
    const fit = this.fit, cls = fit >> FIT_CLASS_SHIFT, size = (fit >> FIT_SIZE_SHIFT) & 3;
    if (cls === FIT_NONE) {
      if (size === 0) {
        if ((fit & FIT_YIELD) !== 0) y = Math.min(y, (fit & FIT_YIELD) * LEVEL_M + TRIM_CAP);
      } else {
        const low = fit & FIT_YIELD, high = this.ends;
        if (low !== 0) {
          const e = -HALF_SIDE_M - endRun(low) * z;
          x = x < END_SNAP - HALF_SIDE_M ? e : Math.max(x, e);
        }
        if (high !== 0) {
          const e = HALF_SIDE_M + endRun(high) * z;
          x = x > HALF_SIDE_M - END_SNAP ? e : Math.min(x, e);
        }
      }
    } else if (cls === FIT_WALL) {
      const end = HALF_SIDE_M * (size + 1) - PIECE_YIELD;
      if ((fit & 1) !== 0) x = Math.max(x, -end);
      if ((fit & 2) !== 0) x = Math.min(x, end);
    } else if (cls === FIT_SQUARE) {
      const lo = size > 0 ? PIECE_YIELD : PIECE_YIELD - HALF_SIDE_M, hi = HALF_SIDE_M - PIECE_YIELD;
      if ((fit & 1) !== 0) z = Math.min(z, hi);
      if ((fit & 2) !== 0) x = Math.min(x, hi);
      if ((fit & 4) !== 0) z = Math.max(z, lo);
      if ((fit & 8) !== 0) x = Math.max(x, lo);
    } else if ((fit & 7) !== 0) {
      const h = (size > 0 ? HALF_SIDE_M : 2 * HALF_SIDE_M) * ROOT3_2;
      const e0 = ROOT3_2 * x - 0.5 * z, e2 = z, e1 = h - e0 - e2;
      const u0 = (fit & 1) * Math.max(PIECE_YIELD - e0, 0), u1 = ((fit >> 1) & 1) * Math.max(PIECE_YIELD - e1, 0), u2 = ((fit >> 2) & 1) * Math.max(PIECE_YIELD - e2, 0);
      const over = u0 + u1 + u2;
      if (over > 0.00001) {
        const held = PIECE_YIELD + RING_HOLD;
        const r0 = Math.max(e0 - held, 0), r1 = Math.max(e1 - held, 0), r2 = Math.max(e2 - held, 0);
        const each = over / Math.max((r0 > 0.000001 ? 1 : 0) + (r1 > 0.000001 ? 1 : 0) + (r2 > 0.000001 ? 1 : 0), 1);
        const g0 = Math.min(r0, each), g1 = Math.min(r1, each), g2 = Math.min(r2, each);
        const l0 = r0 - g0, l2 = r2 - g2;
        const more = Math.min(1, Math.max(over - g0 - g1 - g2, 0) / Math.max(l0 + r1 - g1 + l2, 0.000001));
        z = e2 + u2 - g2 - l2 * more;
        x = (e0 + u0 - g0 - l0 * more + 0.5 * z) / ROOT3_2;
      }
    }
    if (this.skew) {
      const b = z / ROOT3_2;
      x = x - 0.5 * b + b * this.along;
      z = b * this.across;
    }
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

const X = [0, 0];
const Y = [0, 0];

/** `pieceEnd` of the text: how far along a turned end runs for each metre out, back toward the trim's middle for an inside corner. */
function endRun(turn: number): number {
  const n = turn & 7, run = n >= 1 && n <= 5 ? END_RUNS[n]! : 0;
  return (turn & PIECE_END_IN) !== 0 ? -run : run;
}

/** `pieceAxis` of the text: the axis of direction `d` in the basis whose first axis is `k` of `axes`. */
function axis(axes: Float32Array, k: number, d: number, out: number[]): void {
  const a = (k + (d % 3)) * 2, q = Math.floor(d / 3);
  const x = axes[a]!, z = axes[a + 1]!;
  out[0] = q === 0 ? x : q === 1 ? -z : q === 2 ? -x : z;
  out[1] = q === 0 ? z : q === 1 ? x : q === 2 ? -z : -x;
}
