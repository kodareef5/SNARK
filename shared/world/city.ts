// A map's own buildings as drawn past the near rows: its static pieces, known from the map file and never sent, made into
// the faces a far drawing needs. Each form is a pure function of a chunk's standing pieces (and its neighbours', which
// may hide its faces) and the ground, so a client makes the same faces wherever it stands.
//
// - Boxes (boxPart, mergedPart): every standing piece's boxes and sloped parts, less each face another holds whole or the
//   ground hides, boxes of one colour and cross-section in a line along an axis merged into one. With no gap and nothing
//   left out it is the near drawing of the chunk in one mesh; with gaps up to `gap` metres bridged and boxes no longer
//   than `least` left out it is a lighter one with the same frames, floors and broken tops. Sloped parts are never merged.
// - Cells (cellPart): the pieces set into cells in each building's own frame (a chunk's pieces grouped by their turn short
//   of a quarter), the air outside flooded in, and the faces between a filled cell and that air merged into rectangles
//   of one colour: a building's mass, for where its storeys are a pixel or two. A cell under the air is cut down to what
//   its pieces reach, so a roof, a parapet or an overrun keeps its own height and a top its outline.
//
// Most pieces are one box of their kind's half extents. A kind with a shape is its boxes and convex parts (convex.ts), as
// it is walked; nearest, where it looks otherwise (a flight's treads over its ramp), as it looks, since that is how the
// near store draws it.

import type { ShapeLook } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import { TAU, detCos, detSin, len3 } from "../math/scalar.ts";
import { MAX_CORNERS, hullPoint, hullSteps, type HullDef, type HullTable } from "./convex.ts";
import type { Heightfield } from "./heightfield.ts";
import { MapStatics, type ChunkBends, type MapStatic } from "./mapfile.ts";
import { TACTICAL_CELL, farTopByte } from "./tactical.ts";
import { EYE_COLLIDERS } from "./tide-eye.ts";

const QUARTER = YAW_UNITS / 4;

/** The map's static pieces by the chunk their centre is in, as a structure store holds them. */
export class CityStatics {
  readonly dims: MapDims;
  /** Chunk `c` holds pieces `first[c]` up to `first[c + 1]`, in the order the map lists them. */
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  /** Centres in world metres, as float32 like a chunk table, so a bake of them matches the server's. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Per content index: half extents and palette colour. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly color: Uint8Array;
  /** Per content index: the colour of its faces that look down, its soffit's; its colour where none is given. */
  readonly under?: Uint8Array;
  /** Per content index: 1 for a kind that is one box of its half extents, 0 for one with a shape, drawn by `walked` and `look`. */
  readonly plain: Uint8Array;
  /** 1 for a kind drawn near only: left out of the far city's lattice and mass (`StructureDef.near`). */
  readonly near: Uint8Array;
  /** Every kind's boxes and convex parts as walked (the registry's parts), and as drawn near. */
  readonly walked: CityForm;
  readonly look: CityForm;
  /** The map's bent pieces' bends by chunk and slot (mapfile.ts MapStatics.bends), which the near store draws them by. */
  readonly bends: Map<number, ChunkBends>;

  /** `rows`, where given, are what CityStatics.steps made of `statics` with `reg`. */
  constructor(dims: MapDims, statics: MapStatics | readonly MapStatic[], reg: Registry, rows?: CityRows) {
    this.dims = dims;
    const table = MapStatics.of(dims, statics);
    this.bends = table.bends;
    ({ first: this.first, kind: this.kind, yaw: this.yaw, x: this.x, y: this.y, z: this.z } = rows ?? finish(rowSteps(dims, table, reg)));
    this.halfX = reg.halfX;
    this.halfY = reg.halfY;
    this.halfZ = reg.halfZ;
    ({ color: this.color, under: this.under, plain: this.plain, near: this.near, walked: this.walked, look: this.look } = kindTables(reg));
  }

  /**
   * The city of `statics` a slice of SLICE pieces a step, with what chunkReach gives of it with `reg`'s landmark kinds
   * (cityReach), and the look form of `reg`'s kinds HULL_STEP parts a step the first time: so that a page makes a whole
   * map's between its frames.
   */
  static *steps(dims: MapDims, statics: MapStatics, reg: Registry): Generator<void, CityStatics> {
    const { landmark } = known.get(reg) ?? (yield* kindSteps(reg));
    const city = new CityStatics(dims, statics, reg, yield* rowSteps(dims, statics, reg));
    madeReach.set(city, { landmark, ...(yield* chunkReach(city, landmark)) });
    return city;
  }

  get count(): number {
    return this.kind.length;
  }

  /** Pieces of `chunk`. */
  in(chunk: number): number {
    return this.first[chunk + 1]! - this.first[chunk]!;
  }
}

/** Pieces made between two pauses (CityStatics.steps, chunkReach). */
const SLICE = 1 << 15;

/** A city's pieces by chunk. */
interface CityRows {
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
}

/** Per chunk, the box its pieces but a landmark's reach, and its landmark's pieces (chunkReach). */
export interface CityReach {
  readonly reach: Float64Array;
  readonly landmarks: ReadonlyMap<number, Uint8Array>;
}

/** What chunkReach gave of a city CityStatics.steps made, with the landmark kinds it was given. */
const madeReach = new WeakMap<CityStatics, CityReach & { readonly landmark: Uint8Array }>();

/** What chunkReach gives of `city` with `landmark`: as CityStatics.steps made it, where it made it with those kinds. */
export function cityReach(city: CityStatics, landmark: Uint8Array): CityReach {
  const made = madeReach.get(city);
  return made?.landmark === landmark ? made : finish(chunkReach(city, landmark));
}

/** What a city keeps by content index, the same for every city of one registry. */
interface KindTables {
  readonly color: Uint8Array;
  readonly under: Uint8Array;
  readonly plain: Uint8Array;
  readonly near: Uint8Array;
  readonly walked: CityForm;
  readonly look: CityForm;
  readonly landmark: Uint8Array;
}

/** Each registry's kind tables, made once: its look form takes a tenth of a second on a map with landmarks. */
const known = new WeakMap<Registry, KindTables>();

function kindTables(reg: Registry): KindTables {
  return known.get(reg) ?? finish(kindSteps(reg));
}

function* kindSteps(reg: Registry): Generator<void, KindTables> {
  const walked: CityForm = { start: reg.parts.start, box: reg.parts.box, color: null, hulls: reg.parts.hulls ?? null };
  const tables = {
    color: Uint8Array.from(reg.defs, (d) => (d?.type === "structure" ? d.color : 0)),
    under: Uint8Array.from(reg.defs, (d) => (d?.type === "structure" ? d.under ?? d.color : 0)),
    plain: Uint8Array.from(reg.defs, (d) => (d?.type === "structure" && d.shape !== undefined ? 0 : 1)),
    near: Uint8Array.from(reg.defs, (d) => (d?.type === "structure" && d.near ? 1 : 0)),
    walked,
    look: yield* lookForm(reg, walked),
    landmark: landmarkKinds(reg),
  };
  known.set(reg, tables);
  return tables;
}

const landmarksOf = new WeakMap<Registry, Uint8Array>();

/**
 * Per content index, 1 for a kind a landmark brings or a tide eye's collider, which the far drawings leave to a landmark's
 * far mesh: one array a registry, so a city made with them is known by it (cityReach).
 */
export function landmarkKinds(reg: Registry): Uint8Array {
  let kinds = landmarksOf.get(reg);
  if (!kinds) landmarksOf.set(reg, (kinds = Uint8Array.from(reg.defs, (def, k) => (reg.own.has(k) || (def && EYE_COLLIDERS.has(def.id)) ? 1 : 0))));
  return kinds;
}

const floatingOf = new WeakMap<Registry, Uint8Array>();

/**
 * Per content index, 1 for a kind that stands in the air with nothing under it: a tide eye's collider, 270 m and more
 * over its deck. What is made of the city as columns from the ground up, the far shadow's solid heights and the tops
 * the map of what stands overhead lights its ground by, takes such a piece as not there, as the far feed does
 * (tactical.ts pieceShapes): as a column it would be a tower 318 m tall where there is open air.
 */
export function floatingKinds(reg: Registry): Uint8Array {
  let kinds = floatingOf.get(reg);
  if (!kinds) floatingOf.set(reg, (kinds = Uint8Array.from(reg.defs, (def) => (def && EYE_COLLIDERS.has(def.id) ? 1 : 0))));
  return kinds;
}

/** `steps` run to their end. */
function finish<T>(steps: Generator<void, T>): T {
  for (let s = steps.next(); ; s = steps.next()) if (s.done) return s.value;
}

/** The pieces of `t` with a content index each, those of a kind this content lacks or that is not a structure left out. */
function* rowSteps(dims: MapDims, t: MapStatics, reg: Registry): Generator<void, CityRows> {
  // Each of the map's kinds as a content index, or 0 for one this content lacks or that is not a structure.
  const of = Uint16Array.from(t.kinds, (id) => {
    const k = reg.index.get(id);
    return k !== undefined && reg.defs[k]?.type === "structure" ? k : 0;
  });
  const kind = new Uint16Array(t.length);
  let n = 0;
  for (let r = 0; r < kind.length; r++) {
    if ((kind[r] = of[t.kind[r]!]!) !== 0) n++;
    if (r % SLICE === SLICE - 1) yield;
  }
  // Every piece is drawn, so the map's own columns serve and the city is held once.
  if (n === t.length) return { first: t.first, kind, yaw: t.yaw, x: t.x, y: t.y, z: t.z };
  const chunks = chunkCount(dims);
  const rows = { first: new Uint32Array(chunks + 1), kind: new Uint16Array(n), yaw: new Uint16Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
  let i = 0;
  for (let c = 0; c < chunks; c++) {
    for (let r = t.first[c]!; r < t.first[c + 1]!; r++) {
      if (kind[r] === 0) continue;
      rows.kind[i] = kind[r]!;
      rows.yaw[i] = t.yaw[r]!;
      rows.x[i] = t.x[r]!;
      rows.y[i] = t.y[r]!;
      rows.z[i] = t.z[r]!;
      if (++i % SLICE === 0) yield;
    }
    rows.first[c + 1] = i;
  }
  return rows;
}

/**
 * Per chunk of `city`, the box its pieces reach, but those of a kind `landmark` names (by content index), which the far
 * drawings leave to the landmark's far mesh: six numbers a chunk, its least x, y and z and its most, a turned piece
 * reaching no farther across than its half diagonal, and Infinity to -Infinity where it has no other piece. And per chunk
 * with a piece of such a kind, a byte a piece, 1 for those. A pause after every SLICE pieces.
 */
function* chunkReach(city: CityStatics, landmark: Uint8Array): Generator<void, CityReach> {
  const { first, kind, x, y, z, halfY } = city;
  const chunks = chunkCount(city.dims);
  const across = Float64Array.from(city.halfX, (hx, k) => len3(hx, 0, city.halfZ[k]!));
  const reach = new Float64Array(chunks * 6);
  const landmarks = new Map<number, Uint8Array>();
  let since = 0;
  for (let c = 0; c < chunks; c++) {
    const o = c * 6;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = first[c]!; i < first[c + 1]!; i++) {
      const k = kind[i]!;
      if (landmark[k] === 1) {
        let left = landmarks.get(c);
        if (!left) landmarks.set(c, (left = new Uint8Array(first[c + 1]! - first[c]!)));
        left[i - first[c]!] = 1;
        continue;
      }
      const r = across[k]!;
      x0 = Math.min(x0, x[i]! - r);
      y0 = Math.min(y0, y[i]! - halfY[k]!);
      z0 = Math.min(z0, z[i]! - r);
      x1 = Math.max(x1, x[i]! + r);
      y1 = Math.max(y1, y[i]! + halfY[k]!);
      z1 = Math.max(z1, z[i]! + r);
    }
    reach[o] = x0;
    reach[o + 1] = y0;
    reach[o + 2] = z0;
    reach[o + 3] = x1;
    reach[o + 4] = y1;
    reach[o + 5] = z1;
    if ((since += first[c + 1]! - first[c]!) >= SLICE) {
      since = 0;
      yield;
    }
  }
  return { reach, landmarks };
}

/**
 * A form of every kind: kind k's boxes are start[k] up to start[k + 1] of `box`, six numbers each, its middle and half
 * extents in the piece's own frame; and its convex parts those of `hulls`, if any kind has some.
 */
export interface CityForm {
  readonly start: Uint32Array;
  readonly box: Float32Array;
  /** A colour a box, 0 for its piece's; null where every box is its piece's colour. */
  readonly color: Uint8Array | null;
  readonly hulls: HullTable | null;
}

/** Every kind's form as the near store draws it: its shape's look where it has one, else as walked. */
function* lookForm(reg: Registry, walked: CityForm): Generator<void, CityForm> {
  const shapeOf = (k: number): { hulls?: readonly HullDef[]; look?: ShapeLook } | null => {
    const d = reg.defs[k];
    const s = d?.type === "structure" && d.shape !== undefined ? reg.defs[reg.index.get(d.shape) ?? 0] : null;
    return s?.type === "shape" ? s : null;
  };
  const n = reg.defs.length;
  if (!reg.defs.some((_, k) => shapeOf(k)?.look)) return walked;
  const start = new Uint32Array(n + 1);
  const box: number[] = [];
  const color: number[] = [];
  for (let k = 0; k < n; k++) {
    start[k] = box.length / 6;
    const look = shapeOf(k)?.look;
    if (look) for (const b of look.boxes ?? []) box.push(...b.at, ...b.half), color.push(b.color ?? 0);
    else for (let b = walked.start[k]! * 6; b < walked.start[k + 1]! * 6; b += 6) box.push(...walked.box.subarray(b, b + 6)), color.push(0);
  }
  start[n] = box.length / 6;
  const hullsOf = (k: number): readonly HullDef[] => {
    const s = shapeOf(k);
    return (s?.look ? s.look.hulls : s?.hulls) ?? [];
  };
  return { start, box: Float32Array.from(box), color: color.some((c) => c !== 0) ? Uint8Array.from(color) : null, hulls: yield* hullSteps(n, hullsOf) };
}

/**
 * One chunk's form: four corners a face, x and z from the chunk's corner and y in the world, counter-clockwise seen from
 * outside, and a palette colour a face; with the box that holds it, x and z from the chunk's corner. A sloped part's face
 * of more corners is several, and a triangle's last corner is its third again.
 */
export interface CityPart {
  readonly pos: Float32Array;
  readonly color: Uint8Array;
  /**
   * Per face, which of its borders are outer edges, which the near city's material rounds and wears (world-surfaces.ts
   * `edged`): bit 0 the border from its first corner to its last, bit 1 from its second to its third, bit 2 from its
   * first to its second, bit 3 from its last to its third. Bits 4–5 hold the optional two-bit material label.
   * A vertex stores these six bits above its corner (cornerByte).
   */
  readonly edges: Uint8Array;
  /** Per face, the material made from a recipe its kind wears (content/texgen/finishes.ts, from 1), or 0: its label's bits 2 to 6. */
  readonly made: Uint8Array;
  readonly faces: number;
  readonly box: readonly number[];
}

export const EMPTY_PART: CityPart = { pos: new Float32Array(0), color: new Uint8Array(0), edges: new Uint8Array(0), made: new Uint8Array(0), faces: 0, box: [0, 0, 0, 0, 0, 0] };

/** The byte a static's vertex carries where a body's has its bone: its corner `k` of four round a face, across and up, and the face's outer borders (CityPart `edges`). */
export const cornerByte = (k: number, edges: number): number => [0, 1, 3, 2][k]! | (edges << 2);

/** Which pieces of a chunk are gone: a byte a piece in the chunk's order, 1 for gone. Null for none. */
export type Gone = Uint8Array | null;

/** The ground the forms are made on: a heightfield, or the part of one a worker is sent (heightfield.ts HeightWindow). */
export type Ground = Pick<Heightfield, "heightAt">;

/** Faces being made, and the box that holds them. */
class Out {
  pos = new Float32Array(12 * 1024);
  color = new Uint8Array(1024);
  edges = new Uint8Array(1024);
  made = new Uint8Array(1024);
  faces = 0;
  readonly box = new Float64Array(6);
  x0 = 0;
  z0 = 0;

  reset(x0: number, z0: number): void {
    this.faces = 0;
    this.x0 = x0;
    this.z0 = z0;
    this.box.fill(Infinity, 0, 3).fill(-Infinity, 3, 6);
  }

  /** A face of the world corners `c` at `at`, 12 numbers in order round it, with its outer borders (CityPart `edges`). */
  quad(c: ArrayLike<number>, at: number, col: number, edges = 0): void {
    const f = this.faces++;
    if (f === this.color.length) {
      const pos = new Float32Array(this.pos.length * 2);
      pos.set(this.pos);
      this.pos = pos;
      const color = new Uint8Array(this.color.length * 2);
      color.set(this.color);
      this.color = color;
      const grown = new Uint8Array(this.edges.length * 2);
      grown.set(this.edges);
      this.edges = grown;
      const made = new Uint8Array(this.made.length * 2);
      made.set(this.made);
      this.made = made;
    }
    // The internal merge key keeps the palette in its low byte and the label above it: two bits of a street fixture's
    // material, then five of a material made from a recipe, so that faces of two never merge.
    this.edges[f] = edges | (((col >>> 8) & 3) << 4);
    this.made[f] = (col >>> 10) & 31;
    const p = this.pos;
    const b = this.box;
    for (let k = 0; k < 4; k++) {
      const x = c[at + k * 3]! - this.x0;
      const y = c[at + k * 3 + 1]!;
      const z = c[at + k * 3 + 2]! - this.z0;
      p[f * 12 + k * 3] = x;
      p[f * 12 + k * 3 + 1] = y;
      p[f * 12 + k * 3 + 2] = z;
      if (x < b[0]!) b[0] = x;
      if (x > b[3]!) b[3] = x;
      if (y < b[1]!) b[1] = y;
      if (y > b[4]!) b[4] = y;
      if (z < b[2]!) b[2] = z;
      if (z > b[5]!) b[5] = z;
    }
    this.color[f] = col & 255;
  }

  /** A face of `count` world corners in `c`, in order round it, as quads fanned from its first; one left a triangle repeats its last corner. */
  ring(c: Float64Array, count: number, col: number): void {
    const q = this.corners;
    for (let k = 1; k + 1 < count; k += 2) {
      const last = Math.min(k + 2, count - 1);
      for (let a = 0; a < 3; a++) {
        q[a] = c[a]!;
        q[3 + a] = c[k * 3 + a]!;
        q[6 + a] = c[(k + 1) * 3 + a]!;
        q[9 + a] = c[last * 3 + a]!;
      }
      this.quad(q, 0, col);
    }
  }

  private readonly corners = new Float64Array(12);

  part(): CityPart {
    if (this.faces === 0) return EMPTY_PART;
    return { pos: this.pos.slice(0, this.faces * 12), color: this.color.slice(0, this.faces), edges: this.edges.slice(0, this.faces), made: this.made.slice(0, this.faces), faces: this.faces, box: Array.from(this.box) };
  }
}

const out = new Out();

/** How far a corner may stand outside a box and still be held by it, in metres. */
const HELD = 0.02;
/** Cells of the grid boxes are found by when testing what holds a face. */
const GRID = 4;
/** The grid covers the chunk and this much round it, which the widest piece reaches across. */
const MARGIN = 16;
const GRID_SIDE = (CHUNK_SIZE + 2 * MARGIN) / GRID;

/**
 * The corners of each face of a box, as bits of its eight corners (1 for +x, 2 for +y, 4 for +z), in order round it seen
 * from outside. Faces are +x, -x, +y, -y, +z, -z.
 */
const FACE_CORNERS = Uint8Array.from(
  [0, 1, 2, 3, 4, 5].flatMap((f) => {
    const a = f >> 1;
    const plus = (f & 1) === 0;
    // u x v points out: (a + 1, a + 2) for a face looking + along its axis, swapped for one looking -.
    const u = plus ? (a + 1) % 3 : (a + 2) % 3;
    const v = plus ? (a + 2) % 3 : (a + 1) % 3;
    const base = plus ? 1 << a : 0;
    return [base, base | (1 << u), base | (1 << u) | (1 << v), base | (1 << v)];
  }),
);

/** Boxes to make faces of: centre, half extents, the cosine and sine of their turn; a colour; whether its faces are wanted. */
class Boxes {
  n = 0;
  f = new Float64Array(8 * 1024);
  color = new Uint16Array(1024);
  under = new Uint16Array(1024);
  own = new Uint8Array(1024);

  push(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: number, s: number, color: number, own: boolean, under = color): void {
    if (this.n === this.color.length) {
      const f = new Float64Array(this.f.length * 2);
      f.set(this.f);
      this.f = f;
      const col = new Uint16Array(this.color.length * 2);
      col.set(this.color);
      this.color = col;
      const below = new Uint16Array(this.under.length * 2);
      below.set(this.under);
      this.under = below;
      const o = new Uint8Array(this.own.length * 2);
      o.set(this.own);
      this.own = o;
    }
    const o = this.n * 8;
    const f = this.f;
    f[o] = cx;
    f[o + 1] = cy;
    f[o + 2] = cz;
    f[o + 3] = hx;
    f[o + 4] = hy;
    f[o + 5] = hz;
    f[o + 6] = c;
    f[o + 7] = s;
    this.color[this.n] = color;
    this.under[this.n] = under;
    this.own[this.n] = own ? 1 : 0;
    this.n++;
  }
}

const boxes = new Boxes();

/** Most faces a convex part has. */
const PART_FACES = 2 * MAX_CORNERS - 4;
/** Each quarter turn's cosine and sine, exactly. */
const QUARTER_COS = [1, 0, -1, 0];
const QUARTER_SIN = [0, 1, 0, -1];

/**
 * Convex parts to make faces of or fill cells with, placed: their corners and the planes of their faces (an outward unit
 * normal and its distance from the origin), and the box round them; the table and part they are, a colour, and whether
 * their faces are wanted.
 */
class Hulls {
  n = 0;
  at = new Float64Array(3 * MAX_CORNERS * 64);
  planes = new Float64Array(4 * PART_FACES * 64);
  box = new Float64Array(6 * 64);
  table: HullTable[] = [];
  part = new Uint32Array(64);
  color = new Uint16Array(64);
  under = new Uint16Array(64);
  own = new Uint8Array(64);

  /** Part `p` of `t` on a piece whose middle is at (cx, cy, cz), turned by the cosine and sine (c, s) as a box is. */
  push(t: HullTable, p: number, cx: number, cy: number, cz: number, c: number, s: number, color: number, own: boolean, under = color): void {
    if (this.n === this.part.length) {
      const grow = <T extends Float64Array | Uint32Array | Uint16Array | Uint8Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      [this.at, this.planes, this.box] = [grow(this.at), grow(this.planes), grow(this.box)];
      [this.part, this.color, this.under, this.own] = [grow(this.part), grow(this.color), grow(this.under), grow(this.own)];
    }
    const h = this.n++;
    this.table[h] = t;
    this.part[h] = p;
    this.color[h] = color;
    this.under[h] = under;
    this.own[h] = own ? 1 : 0;
    const at = this.at;
    const b = this.box;
    b.fill(Infinity, h * 6, h * 6 + 3).fill(-Infinity, h * 6 + 3, h * 6 + 6);
    const c0 = t.corner[p]!;
    const sixty = t.sixty[p] === 1;
    for (let k = 0, n = t.corner[p + 1]! - c0; k < n; k++) {
      const w = (c0 + k) * 3;
      const [u, y, v] = hullPoint([t.at[w]!, t.at[w + 1]!, t.at[w + 2]!], sixty);
      const o = (h * MAX_CORNERS + k) * 3;
      at[o] = c * u + s * v + cx;
      at[o + 1] = y + cy;
      at[o + 2] = c * v - s * u + cz;
      for (let a = 0; a < 3; a++) {
        if (at[o + a]! < b[h * 6 + a]!) b[h * 6 + a] = at[o + a]!;
        if (at[o + a]! > b[h * 6 + 3 + a]!) b[h * 6 + 3 + a] = at[o + a]!;
      }
    }
    const fc = t.faceCorners;
    for (let f = t.face[p]!, end = t.face[p + 1]!, o = h * PART_FACES * 4; f < end; f++, o += 4) {
      const i = (h * MAX_CORNERS + fc[f * 3]!) * 3;
      const j = (h * MAX_CORNERS + fc[f * 3 + 1]!) * 3;
      const k = (h * MAX_CORNERS + fc[f * 3 + 2]!) * 3;
      const [ux, uy, uz] = [at[j]! - at[i]!, at[j + 1]! - at[i + 1]!, at[j + 2]! - at[i + 2]!];
      const [vx, vy, vz] = [at[k]! - at[i]!, at[k + 1]! - at[i + 1]!, at[k + 2]! - at[i + 2]!];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      this.planes[o] = nx / l;
      this.planes[o + 1] = ny / l;
      this.planes[o + 2] = nz / l;
      this.planes[o + 3] = (nx * at[i]! + ny * at[i + 1]! + nz * at[i + 2]!) / l;
    }
  }

  /** Faces of part `h`. */
  faces(h: number): number {
    const t = this.table[h]!;
    return t.face[this.part[h]! + 1]! - t.face[this.part[h]!]!;
  }

  /** Whether part `h` holds each of the `count` world points in `c`, within HELD of each of its faces. */
  holdsAll(h: number, c: Float64Array, count: number): boolean {
    const P = this.planes;
    const faces = this.faces(h);
    for (let m = 0; m < count; m++) {
      const [x, y, z] = [c[m * 3]!, c[m * 3 + 1]!, c[m * 3 + 2]!];
      for (let f = 0, o = h * PART_FACES * 4; f < faces; f++, o += 4) if (P[o]! * x + P[o + 1]! * y + P[o + 2]! * z - P[o + 3]! > HELD) return false;
    }
    return true;
  }
}

const hulls = new Hulls();

/** The longest side of the box round part `p` of `t` in its piece's own frame, in metres. */
function partLength(t: HullTable, p: number): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let c = t.corner[p]!; c < t.corner[p + 1]!; c++) {
    const q = hullPoint([t.at[c * 3]!, t.at[c * 3 + 1]!, t.at[c * 3 + 2]!], t.sixty[p] === 1);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, q[a]!);
      hi[a] = Math.max(hi[a]!, q[a]!);
    }
  }
  return Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/** Puts kind `k`'s convex parts in `form` longer than `least` on a piece at (cx, cy, cz) turned by (c, s) in `hulls`. */
function pushHulls(form: CityForm, k: number, cx: number, cy: number, cz: number, c: number, s: number, color: number, own: boolean, least: number, under = color): void {
  const t = form.hulls;
  if (!t) return;
  for (let p = t.start[k]!; p < t.start[k + 1]!; p++) if (least <= 0 || partLength(t, p) > least) hulls.push(t, p, cx, cy, cz, c, s, color, own, under);
}

const gridCount = new Uint32Array(GRID_SIDE * GRID_SIDE + 1);
const gridFill = new Uint32Array(GRID_SIDE * GRID_SIDE);
let gridList = new Uint32Array(16384);
/** A box's eight corners in the world, and a face's four, or a part's face's every one. */
const corners = new Float64Array(24);
const face = new Float64Array(12);
const ring = new Float64Array(3 * MAX_CORNERS);

/**
 * Puts the standing pieces of the chunks round `chunk` that reach within MARGIN of it in `boxes` and `hulls`, as `form`
 * has them, and with `own` its own.
 */
function gather(city: CityStatics, chunk: number, gone: (chunk: number) => Gone, own: boolean, form: CityForm, far = false, labels?: Uint8Array): void {
  const { dims, first, kind, yaw, x, y, z, halfX, halfY, halfZ, color, plain } = city;
  const under = city.under ?? color;
  const cx = chunkCx(dims, chunk);
  const cz = chunkCz(dims, chunk);
  const [x0, z0] = [cx * CHUNK_SIZE, cz * CHUNK_SIZE];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncz < 0 || ncx >= dims.chunksX || ncz >= dims.chunksZ || (!own && dx === 0 && dz === 0)) continue;
      const c = ncz * dims.chunksX + ncx;
      const g = gone(c);
      for (let i = first[c]!; i < first[c + 1]!; i++) {
        if (g && g[i - first[c]!] === 1) continue;
        const k = kind[i]!;
        if (far && city.near[k] === 1) continue;
        const r = Math.max(halfX[k]!, halfZ[k]!) * 1.5;
        if (x[i]! + r < x0 - MARGIN || x[i]! - r > x0 + CHUNK_SIZE + MARGIN || z[i]! + r < z0 - MARGIN || z[i]! - r > z0 + CHUNK_SIZE + MARGIN) continue;
        const label = (labels?.[k] ?? 0) << 8;
        const a = (yaw[i]! / YAW_UNITS) * TAU;
        if (plain[k] === 1) boxes.push(x[i]!, y[i]!, z[i]!, halfX[k]!, halfY[k]!, halfZ[k]!, detCos(a), detSin(a), label | color[k]!, c === chunk, label | under[k]!);
        else {
          const [cs, sn] = [detCos(a), detSin(a)];
          const B = form.box;
          for (let b = form.start[k]! * 6; b < form.start[k + 1]! * 6; b += 6) {
            const own = form.color?.[b / 6] ?? 0;
            boxes.push(x[i]! + cs * B[b]! + sn * B[b + 2]!, y[i]! + B[b + 1]!, z[i]! + cs * B[b + 2]! - sn * B[b]!, B[b + 3]!, B[b + 4]!, B[b + 5]!, cs, sn, label | (own || color[k]!), c === chunk, label | (own || under[k]!));
          }
          pushHulls(form, k, x[i]!, y[i]!, z[i]!, cs, sn, label | color[k]!, c === chunk, 0, label | under[k]!);
        }
      }
    }
  }
}

/**
 * The faces of the standing pieces of `chunk`, less those another standing piece holds whole (this chunk's or a
 * neighbour's) and those under the ground: its near drawing as one mesh. `gone(c)` says which pieces of chunk `c` are gone.
 */
export function boxPart(city: CityStatics, chunk: number, hf: Ground, gone: (chunk: number) => Gone): CityPart {
  return mergedPart(city, chunk, hf, gone, -1, 0);
}

/** Whether box `q` holds the world point (wx, wy, wz). */
function holds(q: number, wx: number, wy: number, wz: number): boolean {
  const B = boxes.f;
  const o = q * 8;
  const dx = wx - B[o]!;
  const dz = wz - B[o + 2]!;
  const c = B[o + 6]!;
  const s = B[o + 7]!;
  return Math.abs(c * dx - s * dz) <= B[o + 3]! + HELD && Math.abs(s * dx + c * dz) <= B[o + 5]! + HELD && Math.abs(wy - B[o + 1]!) <= B[o + 4]! + HELD;
}

/**
 * The faces of `boxes` and `hulls` marked own, less those another box or part holds whole and those under the ground. In
 * the grid, entries from boxes.n on are parts.
 */
function faces(dims: MapDims, chunk: number, hf: Ground): CityPart {
  const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
  out.reset(x0, z0);
  const n = boxes.n;
  const B = boxes.f;
  const H = hulls.box;
  const gx0 = x0 - MARGIN;
  const gz0 = z0 - MARGIN;
  // Each box and part in every grid cell its turned box reaches, counted and then listed.
  gridCount.fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < n + hulls.n; q++) {
      let i0: number, i1: number, j0: number, j1: number;
      if (q < n) {
        const o = q * 8;
        const c = Math.abs(B[o + 6]!);
        const s = Math.abs(B[o + 7]!);
        const ex = c * B[o + 3]! + s * B[o + 5]! + HELD;
        const ez = s * B[o + 3]! + c * B[o + 5]! + HELD;
        i0 = Math.max(0, Math.floor((B[o]! - ex - gx0) / GRID));
        i1 = Math.min(GRID_SIDE - 1, Math.floor((B[o]! + ex - gx0) / GRID));
        j0 = Math.max(0, Math.floor((B[o + 2]! - ez - gz0) / GRID));
        j1 = Math.min(GRID_SIDE - 1, Math.floor((B[o + 2]! + ez - gz0) / GRID));
      } else {
        const o = (q - n) * 6;
        i0 = Math.max(0, Math.floor((H[o]! - HELD - gx0) / GRID));
        i1 = Math.min(GRID_SIDE - 1, Math.floor((H[o + 3]! + HELD - gx0) / GRID));
        j0 = Math.max(0, Math.floor((H[o + 2]! - HELD - gz0) / GRID));
        j1 = Math.min(GRID_SIDE - 1, Math.floor((H[o + 5]! + HELD - gz0) / GRID));
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = j * GRID_SIDE + i;
          if (pass === 0) gridCount[cell + 1]!++;
          else gridList[gridFill[cell]!++] = q;
        }
      }
    }
    if (pass === 0) {
      for (let c = 0; c < GRID_SIDE * GRID_SIDE; c++) gridCount[c + 1]! += gridCount[c]!;
      if (gridList.length < gridCount[GRID_SIDE * GRID_SIDE]!) gridList = new Uint32Array(gridCount[GRID_SIDE * GRID_SIDE]! * 2);
      gridFill.set(gridCount.subarray(0, GRID_SIDE * GRID_SIDE));
    }
  }
  for (let q = 0; q < n; q++) {
    if (boxes.own[q] !== 1) continue;
    const o = q * 8;
    const [bx, by, bz, hx, hy, hz, c, s] = [B[o]!, B[o + 1]!, B[o + 2]!, B[o + 3]!, B[o + 4]!, B[o + 5]!, B[o + 6]!, B[o + 7]!];
    for (let k = 0; k < 8; k++) {
      const lx = k & 1 ? hx : -hx;
      const lz = k & 4 ? hz : -hz;
      corners[k * 3] = c * lx + s * lz + bx;
      corners[k * 3 + 1] = (k & 2 ? hy : -hy) + by;
      corners[k * 3 + 2] = c * lz - s * lx + bz;
    }
    const ground = hf.heightAt(bx, bz);
    for (let f = 0; f < 6; f++) {
      for (let m = 0; m < 4; m++) {
        const k = FACE_CORNERS[f * 4 + m]!;
        face[m * 3] = corners[k * 3]!;
        face[m * 3 + 1] = corners[k * 3 + 1]!;
        face[m * 3 + 2] = corners[k * 3 + 2]!;
      }
      // Under the ground: a face looking down onto it, or all four corners below it.
      if (f === 3 && face[1]! <= ground + 0.1) continue;
      let above = false;
      for (let m = 0; m < 4 && !above; m++) above = face[m * 3 + 1]! > hf.heightAt(face[m * 3]!, face[m * 3 + 2]!) + 0.05;
      if (!above) continue;
      // Held whole by one other box or part, found in the grid cell of the face's middle.
      const gi = Math.floor(((face[0]! + face[6]!) / 2 - gx0) / GRID);
      const gj = Math.floor(((face[2]! + face[8]!) / 2 - gz0) / GRID);
      let held = false;
      if (gi >= 0 && gj >= 0 && gi < GRID_SIDE && gj < GRID_SIDE) {
        const cell = gj * GRID_SIDE + gi;
        for (let e = gridCount[cell]!; e < gridCount[cell + 1]! && !held; e++) {
          const h = gridList[e]!;
          held = h !== q && (h < n ? holds(h, face[0]!, face[1]!, face[2]!) && holds(h, face[3]!, face[4]!, face[5]!) && holds(h, face[6]!, face[7]!, face[8]!) && holds(h, face[9]!, face[10]!, face[11]!) : hulls.holdsAll(h - n, face, 4));
        }
      }
      if (!held) out.quad(face, 0, f === 3 ? boxes.under[q]! : boxes.color[q]!, outerEdges(q, face, ground, gx0, gz0));
    }
  }
  for (let q = 0; q < hulls.n; q++) {
    if (hulls.own[q] !== 1) continue;
    const t = hulls.table[q]!;
    const p = hulls.part[q]!;
    const first = q * MAX_CORNERS * 3;
    for (let f = t.face[p]!, end = t.face[p + 1]!, o = q * PART_FACES * 4; f < end; f++, o += 4) {
      // Its corners, less any on the line between the two either side of it, as a flight's bend is.
      const all = t.ring[f + 1]! - t.ring[f]!;
      let count = 0;
      for (let m = 0; m < all; m++) {
        const corner = (d: number): number => first + t.ringCorners[t.ring[f]! + ((m + d + all) % all)]! * 3;
        const [b, c, d] = [corner(-1), corner(0), corner(1)];
        const A = hulls.at;
        const [ux, uy, uz] = [A[c]! - A[b]!, A[c + 1]! - A[b + 1]!, A[c + 2]! - A[b + 2]!];
        const [vx, vy, vz] = [A[d]! - A[c]!, A[d + 1]! - A[c + 1]!, A[d + 2]! - A[c + 2]!];
        const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        if (nx * nx + ny * ny + nz * nz <= 1e-16) continue;
        for (let a = 0; a < 3; a++) ring[count * 3 + a] = A[c + a]!;
        count++;
      }
      let [mx, mz, top, above] = [0, 0, -Infinity, false];
      for (let m = 0; m < count; m++) {
        mx += ring[m * 3]! / count;
        mz += ring[m * 3 + 2]! / count;
        top = Math.max(top, ring[m * 3 + 1]!);
        above ||= ring[m * 3 + 1]! > hf.heightAt(ring[m * 3]!, ring[m * 3 + 2]!) + 0.05;
      }
      // Under the ground, as a box's: a face looking straight down onto it, or every corner below it.
      if (!above || (hulls.planes[o + 1]! < -0.9999 && top <= hf.heightAt(mx, mz) + 0.1)) continue;
      // A face looking more down than across is a soffit.
      if (!heldWhole(n + q, ring, count, mx, mz, gx0, gz0)) out.ring(ring, count, hulls.planes[o + 1]! < -0.7 ? hulls.under[q]! : hulls.color[q]!);
    }
  }
  return out.part();
}

/**
 * Whether a face of `count` world corners in `c`, its middle at (mx, mz), is held whole by one box or part other than
 * grid entry `q`, among those in the grid cell of its middle.
 */
function heldWhole(q: number, c: Float64Array, count: number, mx: number, mz: number, gx0: number, gz0: number): boolean {
  const gi = Math.floor((mx - gx0) / GRID);
  const gj = Math.floor((mz - gz0) / GRID);
  if (gi < 0 || gj < 0 || gi >= GRID_SIDE || gj >= GRID_SIDE) return false;
  const cell = gj * GRID_SIDE + gi;
  const n = boxes.n;
  for (let e = gridCount[cell]!; e < gridCount[cell + 1]!; e++) {
    const h = gridList[e]!;
    if (h === q) continue;
    if (h >= n ? hulls.holdsAll(h - n, c, count) : holdsAll(h, c, count)) return true;
  }
  return false;
}

const beyond = new Float64Array(3);
/**
 * Which borders of box `q`'s face of four world corners in `face` are outer edges (CityPart `edges`): not where a point
 * 2 cm past the border's middle, across the face's plane, is held by another box or part, as a join or an inside corner
 * is, nor a wall's foot on the `ground`.
 */
function outerEdges(q: number, face: Float64Array, ground: number, gx0: number, gz0: number): number {
  let edges = 0;
  const mx = (face[0]! + face[6]!) / 2, my = (face[1]! + face[7]!) / 2, mz = (face[2]! + face[8]!) / 2;
  const n = boxes.n;
  for (let k = 0; k < 4; k++) {
    const [a, b] = [[0, 3], [1, 2], [0, 1], [3, 2]][k]!;
    const bx = (face[a * 3]! + face[b * 3]!) / 2, by = (face[a * 3 + 1]! + face[b * 3 + 1]!) / 2, bz = (face[a * 3 + 2]! + face[b * 3 + 2]!) / 2;
    const l = len3(bx - mx, by - my, bz - mz);
    if (l <= 0) continue;
    if (Math.max(face[a * 3 + 1]!, face[b * 3 + 1]!) <= ground + 0.1 && Math.abs(by - my) > 0.5 * l) continue;
    beyond[0] = bx + ((bx - mx) / l) * 0.02;
    beyond[1] = by + ((by - my) / l) * 0.02;
    beyond[2] = bz + ((bz - mz) / l) * 0.02;
    const gi = Math.floor((beyond[0] - gx0) / GRID), gj = Math.floor((beyond[2] - gz0) / GRID);
    let held = false;
    if (gi >= 0 && gj >= 0 && gi < GRID_SIDE && gj < GRID_SIDE) {
      const cell = gj * GRID_SIDE + gi;
      for (let e = gridCount[cell]!; e < gridCount[cell + 1]! && !held; e++) {
        const h = gridList[e]!;
        held = h !== q && (h < n ? holds(h, beyond[0], beyond[1], beyond[2]) : hulls.holdsAll(h - n, beyond, 1));
      }
    }
    if (!held) edges |= 1 << k;
  }
  return edges;
}

/** Whether box `q` holds each of the `count` world points in `c`. */
function holdsAll(q: number, c: Float64Array, count: number): boolean {
  for (let m = 0; m < count; m++) if (!holds(q, c[m * 3]!, c[m * 3 + 1]!, c[m * 3 + 2]!)) return false;
  return true;
}

// Scratch for a frame's boxes: least and most corners in the frame and a colour, seven numbers a box.
let framed = new Float64Array(7 * 1024);
let spare = new Float64Array(7 * 1024);
let keys = new Int32Array(5 * 1024);
let order: number[] = [];

/** The frames of the standing pieces of chunk `c`: their turns short of a quarter, in the order first met. */
function framesOf(city: CityStatics, chunk: number, g: Gone): number[] {
  const frames: number[] = [];
  const from = city.first[chunk]!;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (g && g[i - from] === 1) continue;
    const f = city.yaw[i]! % QUARTER;
    if (!frames.includes(f)) frames.push(f);
  }
  return frames;
}

/**
 * Puts the standing pieces of `chunk` turned by `f` short of a quarter in `framed`, in the frame turned by (c, s), by their
 * boxes as `form` has them; with `parts`, their convex parts in `hulls` too, placed in the frame. Returns how many boxes.
 */
function frameBoxes(city: CityStatics, chunk: number, g: Gone, f: number, c: number, s: number, form: CityForm, parts: boolean, far = false, labels?: Uint8Array): number {
  const { first, kind, yaw, x, y, z, halfX, halfY, halfZ, color, plain } = city;
  const from = first[chunk]!;
  let nb = 0;
  for (let i = from; i < first[chunk + 1]!; i++) {
    if ((g && g[i - from] === 1) || yaw[i]! % QUARTER !== f) continue;
    const k = kind[i]!;
    if (far && city.near[k] === 1) continue;
    const label = (labels?.[k] ?? 0) << 8;
    const quarter = Math.floor(yaw[i]! / QUARTER) % 4;
    const odd = quarter % 2 === 1;
    // The world to the frame: the inverse of the turn a piece's vertices are given.
    const lx = c * x[i]! - s * z[i]!;
    const lz = s * x[i]! + c * z[i]!;
    if (plain[k] === 1) {
      nb = frameBox(nb, lx, y[i]!, lz, odd ? halfZ[k]! : halfX[k]!, halfY[k]!, odd ? halfX[k]! : halfZ[k]!, label | color[k]!);
      continue;
    }
    // In the frame a shape's boxes and parts are turned by whole quarters.
    const [qc, qs] = [QUARTER_COS[quarter]!, QUARTER_SIN[quarter]!];
    const B = form.box;
    for (let b = form.start[k]! * 6; b < form.start[k + 1]! * 6; b += 6) {
      nb = frameBox(nb, lx + qc * B[b]! + qs * B[b + 2]!, y[i]! + B[b + 1]!, lz + qc * B[b + 2]! - qs * B[b]!, odd ? B[b + 5]! : B[b + 3]!, B[b + 4]!, odd ? B[b + 3]! : B[b + 5]!, label | (form.color?.[b / 6] || color[k]!));
    }
    if (parts) pushHulls(form, k, lx, y[i]!, lz, qc, qs, color[k]!, true, 0);
  }
  return nb;
}

/** Puts the box of half extents (hx, hy, hz) at (fx, fy, fz) in the frame in `framed` as box `nb`. Returns how many there are. */
function frameBox(nb: number, fx: number, fy: number, fz: number, hx: number, hy: number, hz: number, colour: number): number {
  if ((nb + 1) * 7 > framed.length) {
    const grown = new Float64Array(framed.length * 2);
    grown.set(framed);
    framed = grown;
  }
  const o = nb * 7;
  framed[o] = fx - hx;
  framed[o + 1] = fy - hy;
  framed[o + 2] = fz - hz;
  framed[o + 3] = fx + hx;
  framed[o + 4] = fy + hy;
  framed[o + 5] = fz + hz;
  framed[o + 6] = colour;
  return nb + 1;
}

/**
 * The standing pieces of `chunk` with fewer boxes: in each frame, boxes of one colour and one cross-section in a line
 * along an axis, no more than `gap` metres apart, become one box (a row of floor plates, a beam along them), and boxes no
 * longer than `least` metres are left out. Sloped parts are kept whole, and left out only for being as short. Faces held by
 * another box or part or under the ground go, the neighbouring chunks' pieces holding faces as they stand. A gap below 0
 * merges nothing. With nothing left out pieces are as the near store draws them (a flight's treads), else as walked.
 * Optional labels by content kind distinguish otherwise identical colours during merging: two bits of a street fixture's
 * material, and above them five of a material made from a recipe (CityPart `made`).
 */
export function mergedPart(city: CityStatics, chunk: number, hf: Ground, gone: (chunk: number) => Gone, gap: number, least: number, labels?: Uint8Array): CityPart {
  if (city.in(chunk) === 0) return EMPTY_PART;
  const form = least > 0 ? city.walked : city.look;
  boxes.n = 0;
  hulls.n = 0;
  gather(city, chunk, gone, gap < 0 && least <= 0, form, least > 0, labels);
  if (gap >= 0 || least > 0) {
    const g = gone(chunk);
    for (const f of framesOf(city, chunk, g)) {
      const a = (f / YAW_UNITS) * TAU;
      const c = detCos(a);
      const s = detSin(a);
      let nb = frameBoxes(city, chunk, g, f, c, s, form, false, least > 0, labels);
      if (gap >= 0) nb = merge(nb, gap);
      for (let b = 0; b < nb; b++) {
        const o = b * 7;
        const [hx, hy, hz] = [(framed[o + 3]! - framed[o]!) / 2, (framed[o + 4]! - framed[o + 1]!) / 2, (framed[o + 5]! - framed[o + 2]!) / 2];
        if (Math.max(hx, hy, hz) * 2 <= least) continue;
        const [fx, fy, fz] = [framed[o]! + hx, framed[o + 1]! + hy, framed[o + 2]! + hz];
        // Back to the world from the frame, as a piece's vertices are turned.
        boxes.push(c * fx + s * fz, fy, c * fz - s * fx, hx, hy, hz, c, s, framed[o + 6]!, true);
      }
    }
    const { first, kind, yaw, x, y, z, color, plain } = city;
    for (let i = first[chunk]!; i < first[chunk + 1]!; i++) {
      if ((g && g[i - first[chunk]!] === 1) || plain[kind[i]!] === 1) continue;
      const a = (yaw[i]! / YAW_UNITS) * TAU;
      const k = kind[i]!;
      const label = (labels?.[k] ?? 0) << 8;
      pushHulls(form, k, x[i]!, y[i]!, z[i]!, detCos(a), detSin(a), label | color[k]!, true, least);
    }
  }
  return faces(city.dims, chunk, hf);
}

/** Merges the `nb` boxes in `framed` along y, x, z and y again, as mergedPart says. Returns how many are left. */
function merge(nb: number, gap: number): number {
  if (keys.length < nb * 5) keys = new Int32Array(nb * 10);
  for (const ax of [1, 0, 2, 1]) {
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    // What must match, to the centimetre: the colour and the box across the axis.
    for (let b = 0; b < nb; b++) {
      keys[b * 5] = framed[b * 7 + 6]!;
      keys[b * 5 + 1] = Math.round(framed[b * 7 + u]! * 100);
      keys[b * 5 + 2] = Math.round(framed[b * 7 + 3 + u]! * 100);
      keys[b * 5 + 3] = Math.round(framed[b * 7 + v]! * 100);
      keys[b * 5 + 4] = Math.round(framed[b * 7 + 3 + v]! * 100);
    }
    order.length = nb;
    for (let b = 0; b < nb; b++) order[b] = b;
    order.sort((p, q) => {
      for (let e = 0; e < 5; e++) if (keys[p * 5 + e] !== keys[q * 5 + e]) return keys[p * 5 + e]! - keys[q * 5 + e]!;
      return framed[p * 7 + ax]! - framed[q * 7 + ax]!;
    });
    if (spare.length < framed.length) spare = new Float64Array(framed.length);
    let kept = 0;
    let lastKey = -1;
    for (let e = 0; e < nb; e++) {
      const b = order[e]!;
      if (kept > 0) {
        let same = true;
        for (let k = 0; k < 5 && same; k++) same = keys[lastKey * 5 + k] === keys[b * 5 + k];
        const l = (kept - 1) * 7;
        if (same && framed[b * 7 + ax]! <= spare[l + 3 + ax]! + gap) {
          spare[l + 3 + ax] = Math.max(spare[l + 3 + ax]!, framed[b * 7 + 3 + ax]!);
          continue;
        }
      }
      spare.set(framed.subarray(b * 7, b * 7 + 7), kept * 7);
      lastKey = b;
      kept++;
    }
    [framed, spare] = [spare, framed];
    nb = kept;
  }
  return nb;
}

/** Cells of the far feed along a chunk's side (tactical.ts), and how wide a piece may be and still fill only its centre's. */
const FAR_SIDE = CHUNK_SIZE / TACTICAL_CELL;
const SMALL_HALF = TACTICAL_CELL / 2;

/**
 * Calls `each` with each far feed cell of its chunk piece `i` fills and the top byte it gives that cell, by
 * tactical.ts bakeChunk's rule: a narrow piece its centre's cell, a wide one every cell whose centre its turned box,
 * grown by half a cell, reaches. A sloped piece is the box that holds it, as the feed has it.
 */
function pieceCells(city: CityStatics, i: number, x0: number, z0: number, hf: Heightfield, each: (cell: number, top: number) => void): void {
  const k = city.kind[i]!;
  // A float32, as the bake keeps a cell's top.
  const h = Math.fround(city.y[i]! + city.halfY[k]!);
  const hx = city.halfX[k]!;
  const hz = city.halfZ[k]!;
  const px = city.x[i]! - x0;
  const pz = city.z[i]! - z0;
  const top = (c: number): number => farTopByte(h - hf.heightAt(x0 + ((c % FAR_SIDE) + 0.5) * TACTICAL_CELL, z0 + (Math.floor(c / FAR_SIDE) + 0.5) * TACTICAL_CELL));
  if (hx <= SMALL_HALF && hz <= SMALL_HALF) {
    const cx = Math.min(FAR_SIDE - 1, Math.max(0, (px / TACTICAL_CELL) | 0));
    const cz = Math.min(FAR_SIDE - 1, Math.max(0, (pz / TACTICAL_CELL) | 0));
    each(cz * FAR_SIDE + cx, top(cz * FAR_SIDE + cx));
    return;
  }
  const a = city.yaw[i]! * (TAU / YAW_UNITS);
  const sn = detSin(a);
  const cs = detCos(a);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  const cx0 = Math.max(0, Math.floor((px - ex) / TACTICAL_CELL));
  const cx1 = Math.min(FAR_SIDE - 1, Math.floor((px + ex) / TACTICAL_CELL));
  const cz0 = Math.max(0, Math.floor((pz - ez) / TACTICAL_CELL));
  const cz1 = Math.min(FAR_SIDE - 1, Math.floor((pz + ez) / TACTICAL_CELL));
  for (let cz = cz0; cz <= cz1; cz++) {
    const dz = (cz + 0.5) * TACTICAL_CELL - pz;
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = (cx + 0.5) * TACTICAL_CELL - px;
      if (Math.abs(dx * cs - dz * sn) >= hx + SMALL_HALF || Math.abs(dx * sn + dz * cs) >= hz + SMALL_HALF) continue;
      each(cz * FAR_SIDE + cx, top(cz * FAR_SIDE + cx));
    }
  }
}

/** The far feed's top byte of each cell of `chunk` as its standing pieces alone would give it (tactical.ts FarCells.top). */
export function cityTops(city: CityStatics, chunk: number, hf: Heightfield, gone: Gone): Uint8Array {
  const tops = new Uint8Array(FAR_SIDE * FAR_SIDE);
  const from = city.first[chunk]!;
  const [x0, z0] = [chunkCx(city.dims, chunk) * CHUNK_SIZE, chunkCz(city.dims, chunk) * CHUNK_SIZE];
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (gone && gone[i - from] === 1) continue;
    pieceCells(city, i, x0, z0, hf, (c, t) => void (tops[c] = Math.max(tops[c]!, t)));
  }
  return tops;
}

/**
 * Marks in `gone` (a byte a piece of `chunk`) each piece the far feed's tops show cannot stand: one whose top byte in a
 * cell it fills is over the top the feed sent for that cell, since standing it would have made that cell at least as
 * tall. `tops` is the cells' top bytes as sent, all 0 for a chunk sent empty. Returns how many it marked.
 */
export function goneByCells(city: CityStatics, chunk: number, hf: Heightfield, tops: Uint8Array, gone: Uint8Array): number {
  const from = city.first[chunk]!;
  const [x0, z0] = [chunkCx(city.dims, chunk) * CHUNK_SIZE, chunkCz(city.dims, chunk) * CHUNK_SIZE];
  let marked = 0;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    if (gone[i - from] === 1) continue;
    let over = false;
    pieceCells(city, i, x0, z0, hf, (c, t) => void (over ||= t > tops[c]!));
    if (over) {
      gone[i - from] = 1;
      marked++;
    }
  }
  return marked;
}

/**
 * Marks in `gone` (a byte a piece of `chunk`) each piece of the map the near store's table of that chunk does not hold
 * as it was set down: same kind, centre and turn. Returns how many it marked.
 */
export function goneByRows(city: CityStatics, chunk: number, rows: { readonly high: number; readonly kind: Uint16Array; readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array; readonly yaw: Uint16Array }, gone: Uint8Array): number {
  const held = new Set<string>();
  for (let s = 0; s < rows.high; s++) if (rows.kind[s] !== 0) held.add(`${rows.kind[s]},${rows.x[s]},${rows.y[s]},${rows.z[s]},${rows.yaw[s]}`);
  const from = city.first[chunk]!;
  let marked = 0;
  for (let i = from; i < city.first[chunk + 1]!; i++) {
    const there = held.has(`${city.kind[i]},${city.x[i]},${city.y[i]},${city.z[i]},${city.yaw[i]}`);
    gone[i - from] = there ? 0 : 1;
    if (!there) marked++;
  }
  return marked;
}

// Scratch for cells: whether each is filled, and for each of its six faces (+x, -x, +y, -y, +z, -z) how far out a box
// reaches that way, the area the box it is coloured by shows that way, and its colour; which empty cells the air outside
// reaches, with a stack for flooding it and a mask for a slice of faces.
let cellColour = new Uint8Array(1 << 16);
let faceReach = new Float32Array(6 << 16);
let faceArea = new Float32Array(6 << 16);
let faceColour = new Uint8Array(6 << 16);
let outside = new Uint8Array(1 << 16);
/** A face takes the colour of the box showing it most area among those reaching within this many metres of the outermost. */
const FACE_DEPTH = 1;
let stack = new Int32Array(1 << 16);
let mask = new Int16Array(4096);
/** A box takes a cell it covers at least this share of, along each axis; or, along an axis it takes none of, the one it covers most. */
const TAKES = 0.3;
/** A slanted part narrower than this share of a mass cell across, and two cells long or more, is a rod. */
const THIN = 0.25;
const ROD_CELLS = 2;
const rodCorners = new Float64Array(MAX_CORNERS * 3);
const rodAt = new Float64Array(24);
const rodAxes = new Float64Array(9);

/**
 * Whether a hull's `n` corners in the frame (turned by `c` and `s`) are a rod: all within `wide` across of the line through
 * the two farthest apart, which are `long` apart at least. If so its faces are put out as the box along that line that holds
 * them. Cells along a slanted line make a staircase that fills the plane it crosses (a stay across a rig); a box lies along
 * the lattice and a row of cells holds it.
 */
function rod(p: Float64Array, n: number, wide: number, long: number, c: number, s: number, colour: number): boolean {
  let a = 0, b = 0, far = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ex = p[i * 3]! - p[j * 3]!, ey = p[i * 3 + 1]! - p[j * 3 + 1]!, ez = p[i * 3 + 2]! - p[j * 3 + 2]!;
      const d = ex * ex + ey * ey + ez * ez;
      if (d > far) {
        far = d;
        a = i;
        b = j;
      }
    }
  }
  const len = Math.sqrt(far);
  if (len < long) return false;
  const dx = (p[b * 3]! - p[a * 3]!) / len, dy = (p[b * 3 + 1]! - p[a * 3 + 1]!) / len, dz = (p[b * 3 + 2]! - p[a * 3 + 2]!) / len;
  // Two directions across the line: level, and the other.
  let ux = dz, uy = 0, uz = -dx;
  if (ux * ux + uz * uz < 1e-6) {
    ux = 1;
    uz = 0;
  }
  const ul = Math.sqrt(ux * ux + uz * uz);
  ux /= ul;
  uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  // How far the corners reach across, either way, measured from the line through the first corner.
  let lo0 = 0, hi0 = 0, lo1 = 0, hi1 = 0, lo2 = 0, hi2 = len;
  for (let i = 0; i < n; i++) {
    const qx = p[i * 3]! - p[a * 3]!, qy = p[i * 3 + 1]! - p[a * 3 + 1]!, qz = p[i * 3 + 2]! - p[a * 3 + 2]!;
    const u = qx * ux + qy * uy + qz * uz, v = qx * vx + qy * vy + qz * vz, along = qx * dx + qy * dy + qz * dz;
    lo0 = Math.min(lo0, u); hi0 = Math.max(hi0, u);
    lo1 = Math.min(lo1, v); hi1 = Math.max(hi1, v);
    lo2 = Math.min(lo2, along); hi2 = Math.max(hi2, along);
  }
  if (hi0 - lo0 > wide || hi1 - lo1 > wide) return false;
  const mu = (lo0 + hi0) / 2, mv = (lo1 + hi1) / 2, hu = (hi0 - lo0) / 2, hv = (hi1 - lo1) / 2;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < 8; k++) {
    const u = mu + (k & 1 ? hu : -hu), v = mv + (k & 2 ? hv : -hv), w = k & 4 ? hi2 : lo2;
    const x = p[a * 3]! + ux * u + vx * v + dx * w, y = p[a * 3 + 1]! + uy * u + vy * v + dy * w, z = p[a * 3 + 2]! + uz * u + vz * v + dz * w;
    rodAt[k * 3] = c * x + s * z;
    rodAt[k * 3 + 1] = y;
    rodAt[k * 3 + 2] = c * z - s * x;
    cx += rodAt[k * 3]! / 8;
    cy += y / 8;
    cz += rodAt[k * 3 + 2]! / 8;
  }
  for (const face of ROD_FACES) {
    for (let k = 0; k < 4; k++) for (let ax = 0; ax < 3; ax++) rect[k * 3 + ax] = rodAt[face[k]! * 3 + ax]!;
    // Turned to face out of the rod.
    for (let ax = 0; ax < 3; ax++) {
      rodAxes[ax] = rect[3 + ax]! - rect[ax]!;
      rodAxes[3 + ax] = rect[6 + ax]! - rect[ax]!;
      rodAxes[6 + ax] = rect[ax]! - (ax === 0 ? cx : ax === 1 ? cy : cz);
    }
    const nx = rodAxes[1]! * rodAxes[5]! - rodAxes[2]! * rodAxes[4]!, ny = rodAxes[2]! * rodAxes[3]! - rodAxes[0]! * rodAxes[5]!, nz = rodAxes[0]! * rodAxes[4]! - rodAxes[1]! * rodAxes[3]!;
    if (nx * rodAxes[6]! + ny * rodAxes[7]! + nz * rodAxes[8]! < 0) {
      for (let ax = 0; ax < 3; ax++) {
        const t = rect[3 + ax]!;
        rect[3 + ax] = rect[9 + ax]!;
        rect[9 + ax] = t;
      }
    }
    out.quad(rect, 0, colour);
  }
  return true;
}

/** The faces of a rod's box, by its corners' numbers: bit 0 one side, bit 1 the other, bit 2 the far end. */
const ROD_FACES: readonly (readonly number[])[] = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
const rect = new Float64Array(12);

/** Fills `cell` with a box from (lx, ly, lz) to (hx, hy, hz) in the frame: how far out it reaches each way. */
function reaches(cell: number, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number): void {
  const e = cell * 6;
  cellColour[cell] = 1;
  if (hx > faceReach[e]!) faceReach[e] = hx;
  if (-lx > faceReach[e + 1]!) faceReach[e + 1] = -lx;
  if (hy > faceReach[e + 2]!) faceReach[e + 2] = hy;
  if (-ly > faceReach[e + 3]!) faceReach[e + 3] = -ly;
  if (hz > faceReach[e + 4]!) faceReach[e + 4] = hz;
  if (-lz > faceReach[e + 5]!) faceReach[e + 5] = -lz;
}

/** What each face of `cell` sees of a box from (lx, ly, lz) to (hx, hy, hz) whose extents within the cell are (sx, sy, sz). */
function shows(cell: number, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, sx: number, sy: number, sz: number, colour: number): void {
  const e = cell * 6;
  const show = (d: number, reach: number, area: number): void => {
    if (reach < faceReach[e + d]! - FACE_DEPTH || area <= faceArea[e + d]!) return;
    faceArea[e + d] = area;
    faceColour[e + d] = colour;
  };
  show(0, hx, sy * sz);
  show(1, -lx, sy * sz);
  show(2, hy, sx * sz);
  show(3, -ly, sx * sz);
  show(4, hz, sx * sy);
  show(5, -lz, sx * sy);
}

// Scratch for the cells a part takes: per cell of the range round it, how much of the cell it covers along each axis, or
// -1 first for one it does not cross, and the axes along which it takes it; and every cell taken, with the part's index and
// the extents of the box round what it fills of the cell.
let covers = new Float64Array(3 * 512);
let along = new Uint8Array(512);
let taken = new Int32Array(2 * 1024);
let takenSpan = new Float64Array(3 * 1024);
const span = new Float64Array(6);
const cellLo = [0, 0, 0];
const cellHi = [0, 0, 0];
const edge = [0, 0, 0];

/**
 * Appends to `taken`, from `nt`, the cells part `h` of `hulls` takes of the grid from `o`, `step` metres a cell along each
 * axis and `n` cells, as a box takes them: those it covers TAKES of along each axis, measured by the box round what it
 * fills of the cell; and, along an axis no cell of a line of them takes, the one of that line it covers most. A leaning
 * slab so takes a band of cells and not its whole box. Returns the new count.
 */
function hullCells(h: number, o: readonly number[], step: readonly number[], n: readonly number[], nt: number): number {
  const H = hulls.box;
  const r0 = [0, 0, 0];
  const r = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    r0[a] = Math.max(0, Math.floor((H[h * 6 + a]! - o[a]!) / step[a]!));
    r[a] = Math.min(n[a]! - 1, Math.ceil((H[h * 6 + 3 + a]! - o[a]!) / step[a]!) - 1) - r0[a]! + 1;
    if (r[a]! <= 0) return nt;
  }
  const stride = [1, r[0]!, r[0]! * r[1]!];
  const m = stride[2]! * r[2]!;
  if (along.length < m) {
    covers = new Float64Array(m * 6);
    along = new Uint8Array(m * 2);
  }
  for (let k = 0; k < r[2]!; k++) {
    for (let j = 0; j < r[1]!; j++) {
      for (let i = 0; i < r[0]!; i++) {
        const at = i + j * stride[1]! + k * stride[2]!;
        const idx = [i, j, k];
        for (let a = 0; a < 3; a++) {
          cellLo[a] = o[a]! + (r0[a]! + idx[a]!) * step[a]!;
          cellHi[a] = cellLo[a]! + step[a]!;
        }
        along[at] = 0;
        if (!clipSpan(h)) covers[at * 3] = -1;
        else for (let a = 0; a < 3; a++) covers[at * 3 + a] = (span[3 + a]! - span[a]!) / step[a]!;      }
    }
  }
  for (let a = 0; a < 3; a++) {
    const [u, v] = [(a + 1) % 3, (a + 2) % 3];
    for (let iv = 0; iv < r[v]!; iv++) {
      for (let iu = 0; iu < r[u]!; iu++) {
        const base = iu * stride[u]! + iv * stride[v]!;
        let best = -1;
        let most = -1;
        let any = false;
        for (let ia = 0; ia < r[a]!; ia++) {
          const at = base + ia * stride[a]!;
          if (covers[at * 3]! < 0) continue;
          const cover = covers[at * 3 + a]!;
          if (cover >= TAKES) {
            along[at]! |= 1 << a;
            any = true;
          } else if (cover > most) {
            most = cover;
            best = at;
          }
        }
        if (!any && best >= 0) along[best]! |= 1 << a;
      }
    }
  }
  for (let k = 0; k < r[2]!; k++) {
    for (let j = 0; j < r[1]!; j++) {
      for (let i = 0; i < r[0]!; i++) {
        const at = i + j * stride[1]! + k * stride[2]!;
        if (covers[at * 3]! < 0 || along[at] !== 7) continue;
        if ((nt + 1) * 3 > takenSpan.length) {
          const t = new Int32Array(taken.length * 2);
          t.set(taken);
          taken = t;
          const s = new Float64Array(takenSpan.length * 2);
          s.set(takenSpan);
          takenSpan = s;
        }
        taken[nt * 2] = ((r0[2]! + k) * n[1]! + r0[1]! + j) * n[0]! + r0[0]! + i;
        taken[nt * 2 + 1] = h;
        for (let a = 0; a < 3; a++) takenSpan[nt * 3 + a] = covers[at * 3 + a]! * step[a]!;
        nt++;
      }
    }
  }
  return nt;
}

/**
 * The box round where part `h` of `hulls` and the cell from cellLo to cellHi meet, in `span`; false if they do not or only
 * touch. Each corner of what they share is an end of one of the part's edges cut to the cell, or of one of the cell's
 * edges cut to the part.
 */
function clipSpan(h: number): boolean {
  span.fill(Infinity, 0, 3).fill(-Infinity, 3, 6);
  const at = hulls.at;
  const t = hulls.table[h]!;
  const p = hulls.part[h]!;
  const first = h * MAX_CORNERS * 3;
  const put = (x: number, y: number, z: number): void => {
    if (x < span[0]!) span[0] = x;
    if (x > span[3]!) span[3] = x;
    if (y < span[1]!) span[1] = y;
    if (y > span[4]!) span[4] = y;
    if (z < span[2]!) span[2] = z;
    if (z > span[5]!) span[5] = z;
  };
  const ec = t.edgeCorners;
  for (let e = t.edge[p]!; e < t.edge[p + 1]!; e++) {
    const i = first + ec[e * 2]! * 3;
    const j = first + ec[e * 2 + 1]! * 3;
    let t0 = 0;
    let t1 = 1;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      const from = at[i + a]!;
      const d = at[j + a]! - from;
      if (d === 0) {
        if (from < cellLo[a]! || from > cellHi[a]!) t1 = -1;
        continue;
      }
      const ta = (cellLo[a]! - from) / d;
      const tb = (cellHi[a]! - from) / d;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 > t1) continue;
    for (const s of [t0, t1]) put(at[i]! + s * (at[j]! - at[i]!), at[i + 1]! + s * (at[j + 1]! - at[i + 1]!), at[i + 2]! + s * (at[j + 2]! - at[i + 2]!));
  }
  const P = hulls.planes;
  const faces = hulls.faces(h);
  for (let a = 0; a < 3; a++) {
    const [u, v] = [(a + 1) % 3, (a + 2) % 3];
    const length = cellHi[a]! - cellLo[a]!;
    for (let m = 0; m < 4; m++) {
      edge[a] = cellLo[a]!;
      edge[u] = m & 1 ? cellHi[u]! : cellLo[u]!;
      edge[v] = m & 2 ? cellHi[v]! : cellLo[v]!;
      let t0 = 0;
      let t1 = 1;
      for (let f = 0, o = h * PART_FACES * 4; f < faces && t0 <= t1; f++, o += 4) {
        const room = P[o + 3]! - P[o]! * edge[0]! - P[o + 1]! * edge[1]! - P[o + 2]! * edge[2]!;
        const rate = P[o + a]! * length;
        if (rate === 0) {
          if (room < 0) t1 = -1;
        } else if (rate > 0) t1 = Math.min(t1, room / rate);
        else t0 = Math.max(t0, room / rate);
      }
      if (t0 > t1) continue;
      for (const s of [t0, t1]) {
        const w = edge[a]!;
        edge[a] = w + s * length;
        put(edge[0]!, edge[1]!, edge[2]!);
        edge[a] = w;
      }
    }
  }
  for (let a = 0; a < 3; a++) {
    span[a] = Math.max(span[a]!, cellLo[a]!);
    span[3 + a] = Math.min(span[3 + a]!, cellHi[a]!);
    if (!(span[3 + a]! - span[a]! > 1e-6)) return false;
  }
  return true;
}

/**
 * The standing pieces of `chunk` in cells `size` metres wide and `tall` tall in each frame, with only the faces between a
 * filled cell and the air outside, merged into rectangles of one colour. A face looking down onto the ground goes.
 */
export function cellPart(city: CityStatics, chunk: number, hf: Ground, gone: Gone, size: number, tall: number): CityPart {
  const x0 = chunkCx(city.dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(city.dims, chunk) * CHUNK_SIZE;
  out.reset(x0, z0);
  const step = [size, tall, size];
  for (const f of framesOf(city, chunk, gone)) {
    const a = (f / YAW_UNITS) * TAU;
    const c = detCos(a);
    const s = detSin(a);
    hulls.n = 0;
    const nb = frameBoxes(city, chunk, gone, f, c, s, city.walked, true, true);
    // A turn whose pieces are all drawn near only has no mass.
    if (nb === 0 && hulls.n === 0) continue;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let b = 0; b < nb; b++) {
      for (let ax = 0; ax < 3; ax++) {
        lo[ax] = Math.min(lo[ax]!, framed[b * 7 + ax]!);
        hi[ax] = Math.max(hi[ax]!, framed[b * 7 + 3 + ax]!);
      }
    }
    for (let h = 0; h < hulls.n; h++) {
      for (let ax = 0; ax < 3; ax++) {
        lo[ax] = Math.min(lo[ax]!, hulls.box[h * 6 + ax]!);
        hi[ax] = Math.max(hi[ax]!, hulls.box[h * 6 + 3 + ax]!);
      }
    }
    // The grid starts a cell short of the lowest corner, so the outside air wraps it.
    const o = [lo[0]! - size, lo[1]! - tall, lo[2]! - size];
    const n = [Math.ceil((hi[0]! - o[0]!) / size) + 1, Math.ceil((hi[1]! - o[1]!) / tall) + 1, Math.ceil((hi[2]! - o[2]!) / size) + 1];
    const [nx, ny, nz] = n as [number, number, number];
    const N = nx * ny * nz;
    if (cellColour.length < N) {
      cellColour = new Uint8Array(N * 2);
      faceReach = new Float32Array(N * 12);
      faceArea = new Float32Array(N * 12);
      faceColour = new Uint8Array(N * 12);
      outside = new Uint8Array(N * 2);
      stack = new Int32Array(N * 2);
    }
    cellColour.fill(0, 0, N);
    faceReach.fill(-Infinity, 0, N * 6);
    faceArea.fill(-1, 0, N * 6);
    // The cells each box takes: those it covers TAKES of along each axis, or along an axis it takes none of, the one it covers most.
    const spans = new Int32Array(nb * 6);
    for (let b = 0; b < nb; b++) {
      for (let ax = 0; ax < 3; ax++) {
        const l = (framed[b * 7 + ax]! - o[ax]!) / step[ax]!;
        const h = (framed[b * 7 + 3 + ax]! - o[ax]!) / step[ax]!;
        const cover = (i: number): number => Math.min(h, i + 1) - Math.max(l, i);
        let i0 = Math.floor(l);
        let i1 = Math.ceil(h) - 1;
        const best = cover(i0) >= cover(i1) ? i0 : i1;
        while (i0 <= i1 && cover(i0) < TAKES) i0++;
        while (i1 >= i0 && cover(i1) < TAKES) i1--;
        if (i0 > i1) i0 = i1 = best;
        spans[b * 6 + ax] = i0;
        spans[b * 6 + ax + 3] = i1;
      }
    }
    let nt = 0;
    // A rod (a stay, a shroud, a slanted pole) takes none and is drawn as itself.
    for (let h = 0; h < hulls.n; h++) {
      const t = hulls.table[h]!, count = t.corner[hulls.part[h]! + 1]! - t.corner[hulls.part[h]!]!;
      for (let k = 0; k < count * 3; k++) rodCorners[k] = hulls.at[h * MAX_CORNERS * 3 + k]!;
      if (!rod(rodCorners, count, size * THIN, size * ROD_CELLS, c, s, hulls.color[h]!)) nt = hullCells(h, o, step, n, nt);
    }
    // A face of a cell is coloured as that side of the pieces in it shows: first how far out the outermost reaches, then
    // the colour of the box showing most area that way among those within FACE_DEPTH of it, so a wall gives a front its
    // colour over the slab edge before it. A part reaches as far as the box round it, and shows what it fills of the cell.
    const [ox, oy, oz] = [o[0]!, o[1]!, o[2]!];
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < nb; b++) {
        const B = b * 7;
        const [lx, ly, lz, hx, hy, hz] = [framed[B]!, framed[B + 1]!, framed[B + 2]!, framed[B + 3]!, framed[B + 4]!, framed[B + 5]!];
        const colour = framed[B + 6]!;
        for (let k = spans[b * 6 + 2]!; k <= spans[b * 6 + 5]!; k++) {
          const z0 = oz + k * size;
          const sz = Math.max(0, Math.min(hz, z0 + size) - Math.max(lz, z0));
          for (let j = spans[b * 6 + 1]!; j <= spans[b * 6 + 4]!; j++) {
            const y0 = oy + j * tall;
            const sy = Math.max(0, Math.min(hy, y0 + tall) - Math.max(ly, y0));
            for (let i = spans[b * 6]!; i <= spans[b * 6 + 3]!; i++) {
              const cell = (k * ny + j) * nx + i;
              const e = cell * 6;
              if (pass === 0) {
                cellColour[cell] = 1;
                if (hx > faceReach[e]!) faceReach[e] = hx;
                if (-lx > faceReach[e + 1]!) faceReach[e + 1] = -lx;
                if (hy > faceReach[e + 2]!) faceReach[e + 2] = hy;
                if (-ly > faceReach[e + 3]!) faceReach[e + 3] = -ly;
                if (hz > faceReach[e + 4]!) faceReach[e + 4] = hz;
                if (-lz > faceReach[e + 5]!) faceReach[e + 5] = -lz;
                continue;
              }
              const x0 = ox + i * size;
              const sx = Math.max(0, Math.min(hx, x0 + size) - Math.max(lx, x0));
              // What each face of the cell sees of the box: its extent across that face within the cell.
              const show = (d: number, reach: number, area: number): void => {
                if (reach < faceReach[e + d]! - FACE_DEPTH || area <= faceArea[e + d]!) return;
                faceArea[e + d] = area;
                faceColour[e + d] = colour;
              };
              show(0, hx, sy * sz);
              show(1, -lx, sy * sz);
              show(2, hy, sx * sz);
              show(3, -ly, sx * sz);
              show(4, hz, sx * sy);
              show(5, -lz, sx * sy);
            }
          }
        }
      }
      for (let t = 0; t < nt; t++) {
        const cell = taken[t * 2]!;
        const h = taken[t * 2 + 1]!;
        const H = hulls.box;
        if (pass === 0) reaches(cell, H[h * 6]!, H[h * 6 + 1]!, H[h * 6 + 2]!, H[h * 6 + 3]!, H[h * 6 + 4]!, H[h * 6 + 5]!);
        else shows(cell, H[h * 6]!, H[h * 6 + 1]!, H[h * 6 + 2]!, H[h * 6 + 3]!, H[h * 6 + 4]!, H[h * 6 + 5]!, takenSpan[t * 3]!, takenSpan[t * 3 + 1]!, takenSpan[t * 3 + 2]!, hulls.color[h]!);
      }
    }
    // The air outside, flooded in from the grid's sides.
    outside.fill(0, 0, N);
    let sp = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (i !== 0 && j !== 0 && k !== 0 && i !== nx - 1 && j !== ny - 1 && k !== nz - 1) continue;
          const cell = (k * ny + j) * nx + i;
          if (cellColour[cell] === 0 && outside[cell] === 0) {
            outside[cell] = 1;
            stack[sp++] = cell;
          }
        }
      }
    }
    const nxy = nx * ny;
    const visit = (m: number): void => {
      if (cellColour[m] !== 0 || outside[m] !== 0) return;
      outside[m] = 1;
      stack[sp++] = m;
    };
    while (sp > 0) {
      const cell = stack[--sp]!;
      const i = cell % nx;
      const j = Math.floor(cell / nx) % ny;
      const k = Math.floor(cell / nxy);
      if (i > 0) visit(cell - 1);
      if (i < nx - 1) visit(cell + 1);
      if (j > 0) visit(cell - nx);
      if (j < ny - 1) visit(cell + nx);
      if (k > 0) visit(cell - nxy);
      if (k < nz - 1) visit(cell + nxy);
    }
    // A filled cell under the air outside is a cap, its top cut to the highest its pieces reach, in CUT steps: so a parapet,
    // an overrun or a stepped top keeps its own height and not its cell's. A cap beside air shut inside is not cut.
    const stride = [1, nx, nxy];
    const whole = Math.round(tall / CUT);
    if (capQ.length < N) capQ = new Uint8Array(N * 2);
    capQ.fill(0, 0, N);
    for (let cell = 0; cell < N; cell++) {
      if (cellColour[cell] === 0 || outside[cell + nx] !== 1) continue;
      const i = cell % nx;
      const k = Math.floor(cell / nxy);
      const shut = (m: number): boolean => cellColour[m] === 0 && outside[m] === 0;
      const sealed = (i > 0 && shut(cell - 1)) || (i < nx - 1 && shut(cell + 1)) || (k > 0 && shut(cell - nxy)) || (k < nz - 1 && shut(cell + nxy));
      const bottom = o[1]! + (Math.floor(cell / nx) % ny) * tall;
      // A piece reaches less than TAKES into the row above, or it would fill it. A cap cut to its row's top is a whole cell.
      const q = sealed ? whole : Math.max(1, Math.min(Math.ceil(whole * (1 + TAKES)), Math.ceil((faceReach[cell * 6 + 2]! - bottom) / CUT - 0.05)));
      capQ[cell] = q === whole ? 0 : q;
    }
    // Faces between a filled cell and the air outside, a slice at a time along each axis, merged greedily; a cap's sides
    // are made row by row after.
    for (let ax = 0; ax < 3; ax++) {
      for (const sign of [1, -1]) {
        const u = sign > 0 ? (ax + 1) % 3 : (ax + 2) % 3;
        const v = sign > 0 ? (ax + 2) % 3 : (ax + 1) % 3;
        const nu = n[u]!;
        const nv = n[v]!;
        const na = n[ax]!;
        const [sa, su, sv] = [stride[ax]!, stride[u]!, stride[v]!];
        const across = sign * sa;
        const way = ax * 2 + (sign > 0 ? 0 : 1);
        const roof = ax === 1 && sign > 0;
        if (mask.length < nu * nv) mask = new Int16Array(nu * nv * 2);
        for (let d = 0; d < na; d++) {
          const e = d + sign;
          if (e < 0 || e >= na) continue;
          let any = false;
          for (let jv = 0; jv < nv; jv++) {
            let cell = d * sa + jv * sv;
            const row = jv * nu;
            for (let iu = 0; iu < nu; iu++, cell += su) {
              if (cellColour[cell] !== 0 && outside[cell + across] === 1 && (ax === 1 || capQ[cell] === 0)) {
                // A roof's key holds its cut too, so only roofs of one height merge.
                mask[row + iu] = faceColour[cell * 6 + way]! + 1 + (roof ? 257 * capQ[cell]! : 0);
                any = true;
              } else mask[row + iu] = 0;
            }
          }
          if (!any) continue;
          for (let jv = 0; jv < nv; jv++) {
            for (let iu = 0; iu < nu; ) {
              const m = mask[jv * nu + iu]!;
              if (m === 0) {
                iu++;
                continue;
              }
              let w = 1;
              while (iu + w < nu && mask[jv * nu + iu + w] === m) w++;
              let h = 1;
              grow: while (jv + h < nv) {
                for (let q = 0; q < w; q++) if (mask[(jv + h) * nu + iu + q] !== m) break grow;
                h++;
              }
              for (let q = 0; q < h; q++) mask.fill(0, (jv + q) * nu + iu, (jv + q) * nu + iu + w);
              const cut = roof ? Math.floor(m / 257) : 0;
              const plane = cut > 0 ? o[1]! + d * tall + cut * CUT : o[ax]! + (sign > 0 ? d + 1 : d) * step[ax]!;
              span[u] = o[u]! + iu * step[u]!;
              span[3 + u] = span[u]! + w * step[u]!;
              span[v] = o[v]! + jv * step[v]!;
              span[3 + v] = span[v]! + h * step[v]!;
              iu += w;
              if (ax === 1 && sign < 0 && plane <= hf.heightAt(...groundAt(c, s, span, u, v)) + tall / 2) continue;
              cellFace(ax, u, v, plane, c, s, (m % 257) - 1);
            }
          }
        }
        if (ax === 1) continue;
        // A cap's side, row by row along the level axis it `runs`: from its row's floor to its cut where the air outside is
        // beside it, and from a lower cap's cut beside it to its own; a whole cell's side from a lower cap's cut beside it to
        // its row's top.
        const runs = ax === 0 ? 2 : 0;
        for (let d = 0; d < na; d++) {
          const e = d + sign;
          if (e < 0 || e >= na) continue;
          for (let j = 0; j < ny; j++) {
            for (let ih = 0; ih < n[runs]!; ) {
              const cell = d * sa + j * nx + ih * stride[runs]!;
              const side = capSide(cell, cell + across, whole, nx);
              if (side === 0) {
                ih++;
                continue;
              }
              const colour = faceColour[cell * 6 + way]!;
              let w = 1;
              while (ih + w < n[runs]! && capSide(cell + w * stride[runs]!, cell + w * stride[runs]! + across, whole, nx) === side && faceColour[(cell + w * stride[runs]!) * 6 + way] === colour) w++;
              const [from, to] = [side >> 8, side & 255];
              span[runs] = o[runs]! + ih * step[runs]!;
              span[3 + runs] = span[runs]! + w * step[runs]!;
              span[1] = o[1]! + j * tall + from * CUT;
              span[4] = o[1]! + j * tall + to * CUT;
              ih += w;
              cellFace(ax, u, v, o[ax]! + (sign > 0 ? d + 1 : d) * step[ax]!, c, s, colour);
            }
          }
        }
      }
    }
  }
  return out.part();
}

/** Metres a cap's cut is made in. */
const CUT = 0.5;
let capQ = new Uint8Array(1 << 16);

/**
 * The CUT steps up its row between which a side of filled `cell` shows toward `beside`, a cell `up` cells below the one
 * over it, as from * 256 + to: a cut cap's side from the air or a lower top beside it to its cut, and a cell's side from
 * a cut cap's top beside it to its row's top. 0 for none, and for any side the greedy merge makes.
 */
function capSide(cell: number, beside: number, whole: number, up: number): number {
  if (cellColour[cell] === 0) return 0;
  const own = capQ[cell]!;
  const filled = cellColour[beside] !== 0;
  if (own > 0) {
    if (!filled && outside[beside] === 1) return own;
    const other = !filled ? 255 : capQ[beside] || (outside[beside + up] === 1 ? whole : 255);
    return other < own ? other * 256 + own : 0;
  }
  return filled && capQ[beside]! > 0 && capQ[beside]! < whole ? capQ[beside]! * 256 + whole : 0;
}

/** The middle of the face in `span` across axes u and v, in the world, for the ground under it. */
function groundAt(c: number, s: number, sp: Float64Array, u: number, v: number): [number, number] {
  const p = [0, 0, 0];
  p[u] = (sp[u]! + sp[3 + u]!) / 2;
  p[v] = (sp[v]! + sp[3 + v]!) / 2;
  return [c * p[0]! + s * p[2]!, c * p[2]! - s * p[0]!];
}

/** Puts out the face on the plane across `ax` at `plane` spanning `span` along u and v, round it from its least corner. */
function cellFace(ax: number, u: number, v: number, plane: number, c: number, s: number, colour: number): void {
  const p = [0, 0, 0];
  p[ax] = plane;
  const us = [span[u]!, span[3 + u]!, span[3 + u]!, span[u]!];
  const vs = [span[v]!, span[v]!, span[3 + v]!, span[3 + v]!];
  for (let k = 0; k < 4; k++) {
    p[u] = us[k]!;
    p[v] = vs[k]!;
    rect[k * 3] = c * p[0]! + s * p[2]!;
    rect[k * 3 + 1] = p[1]!;
    rect[k * 3 + 2] = c * p[2]! - s * p[0]!;
  }
  out.quad(rect, 0, colour);
}
