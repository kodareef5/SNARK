// One building that uses the forms past the first nine together, each piece posed from its key as the game would
// place it (shared/world/lattice/frames.ts poseOf): a house two cells square with a bay of three triangles at its west
// end and hips at its east, a lean-to along its north side whose roof runs on down from the house's, a terrace to the
// east with a ramp up to a deck on pillars, a hatch and a ladder, and a fence line with a gateway beyond it.

import { PIECE_FIT_AT, PIECE_STATE_AT, PieceFit, fitOfForm, plainYaw, yields } from "../../client/core/render/piece-fit.ts";
import type { PieceLooks } from "../../client/core/render/piece-state.ts";
import { Trims } from "../../client/core/render/trims.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { FORM_LAYERS, makeFormTable, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { poseOf, rotsOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, canon, canonical, key0, key1, tupleStep } from "../../shared/world/lattice/module.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { SourceMesh } from "../pack/write.ts";
import { registry } from "./joints.ts";
import type { Placed } from "./layout.ts";

/**
 * A view of the village: its name, the point looked at, the radius held, degrees round (0 from +X, 90 from -Z) and
 * above, and the pieces drawn where not all are: those whose form's name it matches.
 */
export type VillageShot = readonly [name: string, centre: readonly [number, number, number], radius: number, around: number, above: number, only?: RegExp];
const FLOORS = /foundation|ceiling|trapdoor|ramp|pillar|railing|quarter_wall|beam|ladder/;
export const VILLAGE_SHOTS: readonly VillageShot[] = [
  ["the house from the south-west", [2.2, 2.4, 3.6], 8.4, 135, 24],
  ["the lean-to and the bay from the north-west", [2.2, 2.2, 4.4], 8.4, 232, 26],
  ["the terrace, the ramp and the deck from the south-east", [8, 2, 2.2], 6.6, 40, 26],
  ["the roofs from above", [2.4, 4, 3.8], 8.2, 90, 64],
  ["the fence line and the gateway from the east", [15, 4.2, 3], 9.6, 8, 12],
  ["the floors alone: triangles round squares, the hatch and the deck", [3.4, 0.4, 3.4], 8.6, 110, 58, FLOORS],
  ["the ridge and the bay's three faces, close", [0.6, 4.3, 3], 3.3, 150, 38],
  ["the gable under the lean-to's roof and its eave, close", [0.2, 2.6, 7.6], 3.2, 215, 12],
  ["a hip beside a slope, and its eave over the wall, close", [5.2, 3.6, 0.6], 3.2, 62, 20],
];

const ALL: Readonly<Record<string, FormDef>> = { ...FORMS, ...PLANNED_FORMS };
const NAMES = Object.keys(ALL);
/** Metres the plane of level 0 stands over the ground: a foundation's thickness. */
const FLOOR = 0.375;

type Tuple = readonly [number, number, number, number];
/** The lattice point (x, z) of the square grid, in sides of 3 m: halves are points too. */
const at = (x: number, z: number): Tuple => [2 * x, 0, 0, 2 * z];
/** A point `sides` whole sides from another along direction `d`. */
function step(a: Tuple, d: number, sides = 1): Tuple {
  const m = new Int32Array(8);
  m.set(a);
  tupleStep(m, 0, d, 2 * sides, m, 4);
  return [m[4]!, m[5]!, m[6]!, m[7]!];
}

/** The trims a tier may have, by the names the client finds them under. */
const TRIMS = ["joint_sq", "joint_r15", "joint_r21", "skirt", "eave", "ridge", "hip", "saddle"] as const;
/** Where the base stands in the world the client's trims are laid in: well inside one chunk. */
const BASE = 96;
const DIMS = { chunksX: 4, chunksZ: 4 };

/** The id a piece or a trim is drawn under where the client's rule moves its points: its fit byte, and for a trim with turned ends its state's. */
export const fitId = (id: string, fit: number, state = 0): string => (fit === 0 && state === 0 ? id : `${id}~${fit}~${state}`);

/**
 * The meshes `placed` names that the client's rule moves the points of (client/core/render/piece-fit.ts), each a mesh of
 * its own: a wall whose end gives way, a ceiling whose side does, a joint cut to its wall, a skirt whose ends are turned
 * to their corners. A picture has no such rule, so the rule is run here on each mesh's every level.
 */
export function fitted(meshes: readonly SourceMesh[], placed: readonly Placed[]): SourceMesh[] {
  const by = new Map(meshes.map((m) => [m.id, m] as const));
  const fit = new PieceFit(), data = new Uint8Array(INSTANCE_BYTES);
  return [...new Set(placed.map((p) => p.id).filter((id) => id.includes("~")))].flatMap((id): SourceMesh[] => {
    const [from, byte, state] = id.split("~");
    const mesh = by.get(from!);
    if (!mesh) return [];
    data[PIECE_FIT_AT] = Number(byte);
    data[PIECE_STATE_AT] = Number(state);
    fit.begin(undefined, data, 0);
    return [{ ...mesh, id, lods: mesh.lods.map((lod) => {
      const positions = Float32Array.from(lod.positions);
      for (let v = 0; v < positions.length; v += 3) {
        fit.vertex(positions[v]!, positions[v + 1]!, positions[v + 2]!);
        positions.set([fit.x, fit.y, fit.z], v);
      }
      return { ...lod, positions };
    }) }];
  });
}

/**
 * Sets pieces down in a base as the game would, each by its key, in a store of the game's own; `trims` then lays the
 * joints, skirts, eaves and ridges the client would (client/core/render/trims.ts) from the trims `has` says the tier
 * has, and says what of each piece gives way. A form the game has no piece for is drawn where its key puts it, and the
 * trims do not know it.
 */
function builder(tier: string, has: (id: string) => boolean) {
  const forms = makeFormTable(NAMES.length + 1);
  NAMES.forEach((name, k) => setForm(forms, k + 1, ALL[name]!));
  const reg = registry();
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const frame = structs.frames.make(BASE * STRUCT_UNITS, Math.round(FLOOR * STRUCT_UNITS), BASE * STRUCT_UNITS, 0, 1);
  const out: Placed[] = [];
  /** Per ref of the store, the piece it is among `out`, and its form's fit byte. */
  const drawnAs = new Map<number, { at: number; fit: number }>();
  /** Each piece again by its form's name and its key, for a store to place it by. */
  const keys: { name: string; k0: number; k1: number }[] = [];
  const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  const m = new Int32Array(8);
  /** The piece of form `name` in the slot of class `cls` named from corner `a` along `d`, its own +X along `own`. */
  const put = (name: string, cls: number, a: Tuple, d: number, lvl: number, own = d): void => {
    const kind = NAMES.indexOf(name) + 1;
    const side = forms.size[kind]!;
    m.set(a);
    canonical(cls, m, 0, cls === CLS_VERTEX ? 0 : d, m, 4, side);
    const rots = rotsOf(forms, kind);
    const rot = (((canon.dir - own) % 12) + 12) % 12 / (12 / rots);
    if (!Number.isInteger(rot)) throw new Error(`${name} cannot lie along ${own} in a slot along ${d}`);
    const [k0, k1] = [key0(cls, m[4]!, m[5]!, m[6]!), key1(m[7]!, lvl, canon.dir, FORM_LAYERS.indexOf(ALL[name]!.layer), rot, 0)];
    keys.push({ name, k0, k1 });
    poseOf(frame, k0, k1, forms, kind, pose);
    out.push({ id: `core:${name}_${tier}`, x: pose.x / STRUCT_UNITS - BASE, y: pose.y / STRUCT_UNITS, z: pose.z / STRUCT_UNITS - BASE, yaw: plainYaw(pose.yaw, pose.tw) });
    // A pillar at a square's corner is the game's pillar in that slot.
    const game = reg.index.get(`core:${name === "corner_pillar" ? "pillar" : name}_${tier}`);
    const ref = game === undefined || side !== 2 ? -1 : structs.place(game, frame.gid, k0, k1, 1, reg.maxHp[game]!);
    if (ref >= 0) drawnAs.set(ref, { at: out.length - 1, fit: fitOfForm(ALL[name]!) });
  };
  const square = (name: string, i: number, j: number, lvl: number, own = 0): void => put(name, CLS_SQUARE, at(i, j), 0, lvl, own);
  /** On the edge from `a` along `d`, its front to the left of that way, or to the right with `flip`. */
  const edge = (name: string, a: Tuple, d: number, lvl: number, flip = false): void => put(name, CLS_EDGE, a, d, lvl, flip ? (d + 6) % 12 : d);
  const tri = (name: string, a: Tuple, d: number, lvl: number, corner = 0): void => put(name, CLS_TRIANGLE, a, d, lvl, (d + 4 * corner) % 12);
  const post = (name: string, a: Tuple, lvl: number): void => put(name, CLS_VERTEX, a, 0, lvl, 0);
  /** Lays the client's trims round what was set down, and gives each piece that yields the mesh the rule leaves of it. */
  const trims = (): void => {
    const ids = TRIMS.map((name) => `core:${name}_${tier}`).filter(has);
    const looks = { flag: new Uint32Array(ids.length), yields: Uint8Array.from(reg.defs, (_, k) => (reg.forms.def[k] && yields(reg.forms.def[k]!) ? 1 : 0)) };
    const client = new Trims(reg, (id) => ids.indexOf(id), looks as unknown as PieceLooks);
    for (const chunk of structs.held) {
      const t = structs.chunks[chunk]!;
      const laid = client.lay(structs, chunk, t, chunkCx(DIMS, chunk) * CHUNK_SIZE, chunkCz(DIMS, chunk) * CHUNK_SIZE);
      if (!laid) continue;
      for (let s = 0; s < t.high; s++) {
        const piece = laid.yields[s] !== 0 ? drawnAs.get(chunk * 65536 + s) : undefined;
        if (piece) out[piece.at]!.id = fitId(out[piece.at]!.id, piece.fit | laid.yields[s]!);
      }
      for (let k = 0; k < laid.count; k++) out.push({ id: fitId(ids[laid.mesh[k]!]!, laid.cut[k]!, laid.ends[k]!), x: laid.x[k]! - BASE, y: laid.y[k]!, z: laid.z[k]! - BASE, yaw: plainYaw(laid.yaw[k]!, laid.tw[k]!) });
    }
  };
  return { out, keys, put, square, edge, tri, post, trims };
}

/** The pieces of the village in the frame of a base at the origin, of `tier`, with the trims the client lays of those `has` says the tier has. */
export function village(tier: string, has: (id: string) => boolean): Placed[] {
  const { out, put, square, edge, tri, post, trims } = builder(tier, has);

  // The house: two cells square, a bay of three triangles at its west end.
  const bay = step(at(0, 0), 5);
  const bayNorth = step(bay, 3);
  for (const i of [0, 1]) for (const j of [0, 1, 2]) square("foundation", i, j, 0);
  tri("triangle_foundation", at(0, 0), 3, 0);
  tri("triangle_foundation", at(0, 1), 3, 0);
  tri("triangle_foundation", bay, 1, 0);
  edge("double_doorway", at(1, 0), 0, 0, true);
  edge("windowframe", at(2, 0), 3, 0, true);
  edge("wall", at(2, 1), 3, 0, true);
  edge("doorframe", at(0, 2), 0, 0);
  edge("wall", at(1, 2), 0, 0);
  edge("wall", at(0, 0), 5, 0);
  edge("windowframe", bay, 3, 0);
  edge("wall", bayNorth, 1, 0);
  // Its roof: slopes to a ridge over the west cells, hips over the east ones, and three faces up to the ridge's end over the bay.
  square("roof", 0, 0, 4, 0);
  square("roof", 0, 1, 4, 6);
  square("roof_hip", 1, 0, 4, 0);
  square("roof_hip", 1, 1, 4, 3);
  tri("triangle_roof", at(0, 0), 3, 4, 2);
  tri("triangle_roof", at(0, 1), 3, 4, 1);
  tri("triangle_roof", bay, 1, 4, 2);
  // The lean-to: half walls, the gables over them at its two ends, and a roof half a storey down that runs on from the house's.
  for (const i of [0, 1]) {
    edge("half_wall", at(i, 3), 0, 0);
    square("roof", i, 2, 2, 6);
  }
  edge("half_wall", at(0, 2), 3, 0);
  edge("sloped_wall_left", at(0, 2), 3, 2);
  edge("half_wall", at(2, 2), 3, 0, true);
  edge("sloped_wall_right", at(2, 2), 3, 2, true);
  // The terrace: a ramp up to a deck on pillars, with a hatch in it and a ladder under the hatch.
  for (const j of [0, 1]) square("foundation", 2, j, 0);
  tri("triangle_foundation", at(3, 1), 9, 0);
  put("quarter_foundation", CLS_SQUARE, [4, 0, 0, -1], 0, 0, 0);
  put("quarter_foundation", CLS_SQUARE, [5, 0, 0, -1], 0, 0, 0);
  square("ramp", 2, 0, 0, 0);
  square("trapdoor_frame", 2, 1, 4, 0);
  square("trapdoor", 2, 1, 4, 0);
  edge("ladder", at(2, 1), 3, 0, true);
  post("pillar", at(3, 1), 0);
  post("corner_pillar", at(3, 2), 0);
  post("thin_pillar", at(2.5, 2), 0);
  edge("beam", at(3, 1), 3, 3, true);
  edge("railing", at(3, 1), 3, 4, true);
  edge("railing", at(2, 2), 0, 4);
  edge("quarter_wall", at(3, 1), 11, 0, true);
  edge("railing", at(3, 0), 1, 0, true);
  // The fence line east of it: a strip of foundation, a wall four storeys high, the gateway and its gate, and low walls.
  for (const j of [-1, 0, 1, 2]) edge("fence_foundation", at(5, j), 3, 0, true);
  edge("large_wall", at(5, -1), 3, 0, true);
  edge("gateway", at(5, 1), 3, 0, true);
  edge("gate", at(5, 1), 3, 0, true);
  edge("half_wall", at(5, 2), 3, 0, true);
  trims();
  return out;
}

/**
 * A hamlet of the few forms a first tier has: a hut of one room under a pitched roof with a fenced yard before it, a
 * longhouse of three bays with a hipped end, a house in an L whose roofs meet in a valley, a hut of two storeys, and
 * one whose roof is pitched over a flat ceiling, with the trims the client lays of those `has` says the tier has. The
 * game lets one cell hold a ceiling or a roof at a level and not both, so the last hut's roof is drawn and its trims
 * are laid as if it were not there.
 */
export const HAMLET_SHOTS: readonly VillageShot[] = [
  ["the hut and its yard from before its door", [1.5, 2.4, 1.5], 6.2, 215, 20],
  ["the longhouse and its hipped end", [15, 2.6, 3], 9.6, 150, 22],
  ["the house in an L and the valley its roofs meet in", [31.5, 2.6, 1.5], 8.6, 135, 28],
  ["the roofs of the L from above", [31.5, 4, 1.5], 8.4, 150, 62],
  ["the hut of two storeys, and the roof over a flat ceiling", [45, 3.8, 3], 8.2, 200, 14],
  ["an eave, a gable and the ridge, close", [-0.2, 4, 1.6], 3, 222, 8],
  ["under the roof: rafters, battens and the gable inside", [1.5, 3.6, 3], 3, 100, -32],
  ["the hip's eaves at their corner, close", [20.6, 3.5, 0.4], 3.2, 140, 12],
  ["the valley, close", [33.4, 4.2, 0.4], 3.4, 132, 40],
  ["a flat ceiling's eaves under a storey and under a roof, close", [45, 3.5, -0.2], 4.4, 196, 4],
];

export function hamlet(tier: string, has: (id: string) => boolean): Placed[] {
  const { out, square, edge, trims } = builder(tier, has);
  /** A wall-family piece on the edge from (i, j) along +X or +Z, facing out of what it closes. */
  const wall = (name: string, i: number, j: number, d: 0 | 3, lvl: number, flip: boolean): void => edge(name, at(i, j), d, lvl, flip);
  /** Walls round the cells from (i0, j0) to (i1, j1), one storey from `lvl`, with a doorway in the south side's first cell. */
  const ring = (i0: number, j0: number, i1: number, j1: number, lvl: number, door = true): void => {
    for (let i = i0; i < i1; i++) {
      wall(door && i === i0 ? "doorframe" : "wall", i, j0, 0, lvl, true);
      wall("wall", i, j1, 0, lvl, false);
    }
    for (let j = j0; j < j1; j++) {
      wall("wall", i0, j, 3, lvl, false);
      wall("wall", i1, j, 3, lvl, true);
    }
    if (door) edge("door_open", at(i0, j0), 0, lvl, true);
  };
  /** Two slopes to a ridge along +X over the cells of column i, rows j and j + 1, with a gable at the west end, the east or neither. */
  const span = (i: number, j: number, lvl: number, west: boolean, east: boolean): void => {
    square("roof", i, j, lvl, 0);
    square("roof", i, j + 1, lvl, 6);
    if (west) {
      edge("sloped_wall_right", at(i, j), 3, lvl);
      edge("sloped_wall_left", at(i, j + 1), 3, lvl);
    }
    if (east) {
      edge("sloped_wall_left", at(i + 1, j), 3, lvl, true);
      edge("sloped_wall_right", at(i + 1, j + 1), 3, lvl, true);
    }
  };

  // The hut: one room of two cells under two slopes, a gable at each end, and a yard before its door.
  for (const j of [-1, 0, 1]) square("foundation", 0, j, 0);
  ring(0, 0, 1, 2, 0);
  span(0, 0, 4, true, true);
  wall("half_wall", 0, -1, 3, 0, false);
  wall("railing", 0, -1, 0, 0, true);
  wall("railing", 1, -1, 3, 0, true);

  // The longhouse: three bays to a ridge, a gable at its west end and two hips at its east.
  for (let i = 3; i < 7; i++) for (const j of [0, 1]) square("foundation", i, j, 0);
  ring(3, 0, 7, 2, 0);
  for (let i = 3; i < 6; i++) span(i, 0, 4, i === 3, false);
  square("roof_hip", 6, 0, 4, 0);
  square("roof_hip", 6, 1, 4, 3);

  // The house in an L: a wing to the east and a wing to the south, their ridges meeting over the corner.
  const o = 9;
  const cells: [number, number][] = [[0, -1], [1, -1], [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]];
  for (const [i, j] of cells) square("foundation", o + i, j, 0);
  for (const i of [0, 1]) wall("wall", o + i, -1, 0, 0, true);
  wall("wall", o + 2, -1, 3, 0, true);
  wall("doorframe", o + 2, 0, 0, 0, true);
  edge("door_open", at(o + 2, 0), 0, 0, true);
  for (const j of [0, 1]) wall("wall", o + 3, j, 3, 0, true);
  for (const i of [0, 1, 2]) wall("wall", o + i, 2, 0, 0, false);
  for (const j of [-1, 0, 1]) wall("wall", o, j, 3, 0, false);
  square("roof_valley", o + 1, 0, 4, 0);
  square("roof_hip", o, 1, 4, 6);
  square("roof", o + 1, 1, 4, 6);
  square("roof", o, 0, 4, 9);
  span(o + 2, 0, 4, false, true);
  square("roof", o, -1, 4, 9);
  square("roof", o + 1, -1, 4, 3);
  edge("sloped_wall_left", at(o, -1), 0, 4, true);
  edge("sloped_wall_right", at(o + 1, -1), 0, 4, true);

  // The hut of two storeys: a flat ceiling for the floor between them, and the pitched roof on the upper walls.
  const t = 13.5;
  for (const j of [0, 1]) square("foundation", t, j, 0);
  ring(t, 0, t + 1, 2, 0);
  for (const j of [0, 1]) square("ceiling", t, j, 4);
  ring(t, 0, t + 1, 2, 4, false);
  span(t, 0, 8, true, true);

  // The hut whose roof is pitched over a flat ceiling: both hang from the top of its walls.
  for (const j of [0, 1]) square("foundation", t + 2, j, 0);
  ring(t + 2, 0, t + 3, 2, 0);
  for (const j of [0, 1]) square("ceiling", t + 2, j, 4);
  span(t + 2, 0, 4, true, true);

  trims();
  return out;
}

/**
 * Roofs that meet at hips between pieces, and a ridge's open end: a tower of six triangles round one corner, two slopes
 * to a ridge hipped at its east end by three triangles and closed by a gable at its west, and a house in an L whose
 * ridges meet over a valley and a hip. A tier with no triangle (thatch) has the slopes and the L alone, the ridge ending
 * at two hips.
 */
export const ROOF_SHOTS: readonly VillageShot[] = [
  ["a tower of six triangles round one corner", [3, 4, 3], 4.6, 140, 30],
  ["its apex, close", [3, 5, 3], 1.3, 150, 38],
  ["a ridge hipped at its east end by three triangles", [14.4, 4, 3], 5.2, 120, 30],
  ["the hipped end, close", [15, 4.9, 3], 1.4, 100, 34],
  ["the ridge's open end over its gable, close", [12, 5.1, 3], 1, 165, 25],
  ["a roof turning a corner: an L over a valley and a hip", [25.5, 4, 1.5], 8.4, 135, 28],
];

export function roofs(tier: string, has: (id: string) => boolean): Placed[] {
  const { out, square, edge, tri, trims } = builder(tier, has);
  const triangles = tier !== "thatch";
  const wall = (name: string, i: number, j: number, d: 0 | 3, lvl: number, flip: boolean): void => edge(name, at(i, j), d, lvl, flip);

  // The tower: six triangles of floor round its middle, a wall on each outer side, and six faces up to the middle.
  const v = at(1, 1);
  for (let k = 0; triangles && k < 6; k++) {
    tri("triangle_foundation", v, 2 * k, 0);
    edge(k === 4 ? "doorframe" : "wall", step(v, 2 * k), (2 * k + 4) % 12, 0, true);
    tri("triangle_roof", v, 2 * k, 4, 1);
  }

  // The ridge: two slopes over cells (4, 0) and (4, 1), a gable at the west end, and three faces high at its east end.
  const q = at(5, 1);
  for (const j of [0, 1]) square("foundation", 4, j, 0);
  wall("doorframe", 4, 0, 0, 0, true);
  wall("wall", 4, 2, 0, 0, false);
  for (const j of [0, 1]) wall("wall", 4, j, 3, 0, false);
  square("roof", 4, 0, 4, 0);
  square("roof", 4, 1, 4, 6);
  edge("sloped_wall_right", at(4, 0), 3, 4);
  edge("sloped_wall_left", at(4, 1), 3, 4);
  if (triangles) {
    for (const [d, way] of [[9, 1], [11, 3], [1, 5]] as const) {
      tri("triangle_foundation", q, d, 0);
      edge("wall", step(q, d), way, 0, true);
      tri("triangle_roof", q, d, 4, 1);
    }
  } else {
    for (const j of [0, 1]) square("foundation", 5, j, 0);
    wall("wall", 5, 0, 0, 0, true);
    wall("wall", 5, 2, 0, 0, false);
    for (const j of [0, 1]) wall("wall", 6, j, 3, 0, true);
    square("roof_hip", 5, 0, 4, 0);
    square("roof_hip", 5, 1, 4, 3);
  }

  // The house in an L, as the hamlet's: a wing to the east and a wing to the south, their ridges meeting over the corner.
  const o = 7;
  const cells: [number, number][] = [[0, -1], [1, -1], [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]];
  for (const [i, j] of cells) square("foundation", o + i, j, 0);
  for (const i of [0, 1]) wall("wall", o + i, -1, 0, 0, true);
  wall("wall", o + 2, -1, 3, 0, true);
  wall("doorframe", o + 2, 0, 0, 0, true);
  for (const j of [0, 1]) wall("wall", o + 3, j, 3, 0, true);
  for (const i of [0, 1, 2]) wall("wall", o + i, 2, 0, 0, false);
  for (const j of [-1, 0, 1]) wall("wall", o, j, 3, 0, false);
  square("roof_valley", o + 1, 0, 4, 0);
  square("roof_hip", o, 1, 4, 6);
  square("roof", o + 1, 1, 4, 6);
  square("roof", o, 0, 4, 9);
  square("roof", o + 2, 0, 4, 0);
  square("roof", o + 2, 1, 4, 6);
  edge("sloped_wall_left", at(o + 3, 0), 3, 4, true);
  edge("sloped_wall_right", at(o + 3, 1), 3, 4, true);
  square("roof", o, -1, 4, 9);
  square("roof", o + 1, -1, 4, 3);
  edge("sloped_wall_left", at(o, -1), 0, 4, true);
  edge("sloped_wall_right", at(o + 1, -1), 0, 4, true);
  trims();
  return out;
}

export const KEEP_SHOTS: readonly VillageShot[] = [
  ["the hall, its tower and the gatehouse from the south", [3.5, 3.2, 2], 12.5, 200, 22],
  ["the tower, its piers and its battlements from the south-west", [-3, 4.4, 3], 6.4, 236, 16],
  ["the gatehouse and the curtain wall from the east", [13.5, 3.6, 0.5], 9.4, 52, 16],
  ["the roofs, the tower's floor and the terrace from above", [2.5, 4, 3.5], 11.5, 200, 62],
  ["a quoin at the hall's corner, close", [6, 2, 0], 2.7, 138, 10],
  ["the terrace: the ramp, the balustrade, the hatch and the pillars from the north", [4.5, 2, 7.5], 6.6, 12, 26],
  ["the hall's gables beside the tower from the north-west", [-0.5, 4, 5.2], 5.6, 310, 30],
  ["the gateway's arch and the tall wall's quoins, and the hall's hips beyond", [5.4, 4, 0.6], 3.6, 112, 20],
  ["the floors alone: triangles round a point, the hatch and the terrace", [2.5, 0.4, 3.6], 11.5, 200, 58, FLOORS],
];

/**
 * A keep of the forms past the first nine, with the trims the client lays of those `has` says the tier has: a hall two cells
 * by two under a pitched roof, gabled at its west end and hipped at its east; against its west side a six-sided tower
 * two storeys high with battlements; a terrace to the north-east with a ramp, a balustrade and a hatch; and to the
 * east a curtain wall with a gatehouse and its gate.
 */
export function keep(tier: string, has: (id: string) => boolean): Placed[] {
  const { out, put, square, edge, tri, post, trims } = builder(tier, has);
  // The hall: two cells by two, a doorway two edges wide in its south front.
  for (const i of [0, 1]) for (const j of [0, 1]) square("foundation", i, j, 0);
  edge("double_doorway", at(1, 0), 0, 0, true);
  edge("windowframe", at(2, 0), 3, 0, true);
  edge("wall", at(2, 1), 3, 0, true);
  edge("wall", at(0, 2), 0, 0);
  edge("windowframe", at(1, 2), 0, 0);
  edge("doorframe", at(0, 0), 3, 0);
  edge("wall", at(0, 1), 3, 0);
  // Its roof: slopes to a ridge over the west cells with a gable under each at the west end, and hips over the east ones.
  square("roof", 0, 0, 4, 0);
  square("roof", 0, 1, 4, 6);
  square("roof_hip", 1, 0, 4, 0);
  square("roof_hip", 1, 1, 4, 3);
  edge("sloped_wall_right", at(0, 0), 3, 4);
  edge("sloped_wall_left", at(0, 1), 3, 4);
  // The tower: six triangles round a point west of the hall, walled two storeys high, floored, and battlemented.
  const heart = step(at(0, 1), 6);
  for (let k = 0; k < 6; k++) {
    const from = step(heart, 2 * k);
    tri("triangle_foundation", heart, 2 * k, 0);
    for (const lvl of [4, 8]) tri("triangle_ceiling", heart, 2 * k, lvl);
    // Its outer side runs on from one spoke's end to the next, its front outward.
    const way = (2 * k + 4) % 12;
    for (const lvl of [0, 4]) edge(k === 5 && lvl === 0 ? "doorframe" : lvl === 4 && k % 2 === 0 ? "windowframe" : "wall", from, way, lvl, true);
    edge("half_wall", from, way, 8, true);
  }
  // The terrace north of the hall: a ramp up to a floor on pillars, a hatch in it with a ladder under it, and a balustrade.
  for (const i of [0, 1, 2]) square("foundation", i, 2, 0);
  tri("triangle_foundation", at(3, 2), 3, 0);
  put("quarter_foundation", CLS_SQUARE, [6, 0, 0, 2], 0, 0, 0);
  square("ramp", 2, 2, 0, 0);
  for (const i of [0, 1]) square(i === 0 ? "trapdoor_frame" : "ceiling", i, 2, 4, 0);
  square("trapdoor", 0, 2, 4, 0);
  edge("ladder", at(0, 2), 0, 0);
  post("corner_pillar", at(0, 3), 0);
  post("thin_pillar", at(1, 3), 0);
  post("pillar", at(2, 3), 0);
  edge("beam", at(0, 3), 0, 3);
  edge("railing", at(0, 3), 0, 4);
  edge("railing", at(1, 3), 0, 4);
  edge("railing", at(0, 2), 3, 4);
  edge("quarter_wall", at(3, 2), 3, 0, true);
  // The curtain wall to the east: a strip of foundation, a wall four storeys high, the gatehouse and its gate, a wall with a battlement, and a low wall.
  for (const j of [-2, -1, 0, 1, 2]) edge("fence_foundation", at(4.5, j), 3, 0, true);
  edge("large_wall", at(4.5, -2), 3, 0, true);
  edge("gateway", at(4.5, -1), 3, 0, true);
  edge("gate", at(4.5, -1), 3, 0, true);
  edge("wall", at(4.5, 1), 3, 0, true);
  edge("half_wall", at(4.5, 1), 3, 4, true);
  edge("half_wall", at(4.5, 2), 3, 0, true);
  trims();
  return out;
}

/** Corners to look at with their joints, by the ways their walls leave them, in twelfths of a turn: a straight run has none. */
export const CORNERS: readonly (readonly [name: string, ways: readonly number[], storeys?: number])[] = [["walls 90", [0, 3]], ["tee", [0, 3, 6]], ["cross", [0, 3, 6, 9]], ["two storeys", [0, 3], 2], ["walls 180", [0, 6]], ["walls 60", [0, 2]], ["walls 120", [0, 4]], ["walls 150", [0, 5]], ["a half wall beside a wall", [0, 3], -1]];

/** Walls of `tier` that leave one corner by `ways`, on `storeys` storeys, with the joints the client lays; with -1 storeys, the second wall is a half wall. */
export function corner(tier: string, ways: readonly number[], storeys = 1, has: (id: string) => boolean = () => true): Placed[] {
  const { out, edge, trims } = builder(tier, has);
  for (let storey = 0; storey < Math.max(1, storeys); storey++) ways.forEach((way, k) => edge(storeys < 0 && k > 0 ? "half_wall" : "wall", at(0, 0), way, storey * 4, k % 2 === 1));
  trims();
  return out;
}


/**
 * A fort of the end-game tier: a keep three cells by two under a pitched roof, a gable at its west end and two hips
 * at its east; a flat-roofed annex with a parapet, a railing on it, a hatch and its ladder, and a ramp up to it; a
 * porch on thin pillars and beams; a twelve-sided tower of two storeys on six squares round a hexagon of triangles,
 * with a parapet and a lantern under six triangles of roof; and a gatehouse of four large walls with the gateway and
 * its gate set back between them under two storeys of wall.
 * Its trims are the client's laying of those `has` says the tier has. The base is turned `turn` degrees.
 */
export const FORT_SHOTS: readonly VillageShot[] = [
  ["the fort", [0, 4, -1], 15.5, 60, 26],
  ["the keep: its gable, its roof and the porch", [3.5, 2.6, 1], 8, 118, 18],
  ["the tower", [-9, 5, 3], 8.6, 200, 14],
  ["the gatehouse, the gateway and its gate", [3, 5.6, -7.5], 9.4, 92, 6],
  ["the roofs from above", [0, 4, 3], 15, 100, 60],
  ["the annex: its parapet, the railing, the hatch and the ramp", [10.8, 3.2, 1], 6, 52, 30],
  ["the gate, close", [3, 2.6, -6], 4.4, 96, 3],
  ["a corner post between two walls, and the skirts under them", [0, 1.1, 0], 2.8, 135, 12],
  ["the tower's parapet and lantern", [-9, 8.2, 3], 5.6, 160, 34],
  ["the hips, the gutter and a parapet's cut post", [9.4, 4, 0.4], 3.8, 60, 24],
];

export function fort(tier: string, turn = 17, has: (id: string) => boolean = () => true): Placed[] {
  return fortBuilt(tier, turn, has).placed;
}

/** The fort's pieces by form and key in a base of their own, with no trims: a store that places them lays its own. */
export function fortKeys(tier: string): { name: string; k0: number; k1: number }[] {
  return fortBuilt(tier, 0, () => false).keys;
}

function fortBuilt(tier: string, turn: number, has: (id: string) => boolean): { placed: Placed[]; keys: { name: string; k0: number; k1: number }[] } {
  const { out, keys, put, square, edge, tri, post, trims } = builder(tier, has);
  const wall = (name: string, i: number, j: number, d: 0 | 3, lvl: number, outside: "left" | "right"): void => edge(name, at(i, j), d, lvl, outside === "right");

  // The keep: three cells by two, a doorway two leaves wide to the south, a pitched roof, a gable west and hips east.
  for (let i = 0; i < 3; i++) for (const j of [0, 1]) square("foundation", i, j, 0);
  wall("double_doorway", 0, 0, 0, 0, "right");
  wall("windowframe", 2, 0, 0, 0, "right");
  for (const [i, name] of [[0, "wall"], [1, "windowframe"], [2, "wall"]] as const) wall(name, i, 2, 0, 0, "left");
  for (const j of [0, 1]) wall("wall", 0, j, 3, 0, "left");
  wall("doorframe", 3, 0, 3, 0, "right");
  wall("wall", 3, 1, 3, 0, "right");
  for (const i of [0, 1]) {
    square("roof", i, 0, 4, 0);
    square("roof", i, 1, 4, 6);
  }
  edge("sloped_wall_right", at(0, 0), 3, 4);
  edge("sloped_wall_left", at(0, 1), 3, 4);
  square("roof_hip", 2, 0, 4, 0);
  square("roof_hip", 2, 1, 4, 3);

  // The porch before the doorway: a canopy on two beams and three thin pillars.
  for (const i of [0, 1]) {
    square("foundation", i, -1, 0);
    square("ceiling", i, -1, 4);
    edge("beam", at(i, -1), 0, 3, true);
  }
  for (const i of [0, 1, 2]) post("thin_pillar", at(i, -1), 0);

  // The annex: a flat roof behind a parapet, a railing on the parapet's east side, a hatch with its ladder, and a ramp up from the south.
  for (const j of [-1, 0, 1]) square("foundation", 3, j, 0);
  wall("wall", 3, 2, 0, 0, "left");
  wall("wall", 3, 0, 0, 0, "right");
  wall("windowframe", 4, 0, 3, 0, "right");
  wall("wall", 4, 1, 3, 0, "right");
  square("trapdoor_frame", 3, 1, 4);
  square("trapdoor", 3, 1, 4);
  square("ceiling", 3, 0, 4);
  edge("ladder", at(4, 1), 3, 0, false);
  square("ramp", 3, -1, 0, 0);
  wall("half_wall", 3, 2, 0, 4, "left");
  for (const j of [0, 1]) {
    wall("half_wall", 4, j, 3, 4, "right");
    wall("railing", 4, j, 3, 6, "right");
  }

  // The tower: a hexagon of triangles, a square on each of its sides and a triangle between each two squares.
  const centre = at(-3, 1);
  for (let k = 0; k < 6; k++) {
    const [hub, next] = [step(centre, 2 * k), step(centre, (2 * k + 2) % 12)];
    const [out0, out1, across] = [(2 * k + 1) % 12, (2 * k + 11) % 12, (2 * k + 4) % 12];
    const squared = (name: string, lvl: number): void => put(name, CLS_SQUARE, next, (2 * k + 10) % 12, lvl, (2 * k + 10) % 12);
    for (const [slab, lvl] of [["foundation", 0], ["ceiling", 4], ["ceiling", 8]] as const) {
      tri(`triangle_${slab}`, centre, 2 * k, lvl);
      tri(`triangle_${slab}`, hub, out1, lvl);
      squared(slab, lvl);
    }
    // The outer wall: a square's far side, and a triangle's.
    const [far, wing] = [step(hub, out0), step(hub, out1)];
    for (const lvl of [0, 4]) {
      edge(lvl === 0 && k === 5 ? "doorframe" : lvl === 4 && k % 2 === 0 ? "windowframe" : "wall", far, across, lvl, true);
      edge("wall", wing, (2 * k + 3) % 12, lvl, true);
    }
    edge("half_wall", far, across, 8, true);
    edge("half_wall", wing, (2 * k + 3) % 12, 8, true);
    // The lantern: a low wall round the hexagon, and a triangle of roof on each of its sides, high at the middle.
    edge("half_wall", hub, across, 8, true);
    tri("triangle_roof", centre, 2 * k, 10, 1);
  }

  // The gatehouse south of it: a large wall each side on a kerb, two more turned back from them, and between those
  // the gateway and its gate under two storeys of wall. A corner post stands on every storey of each of its four corners.
  for (const i of [-1, 2]) {
    edge("fence_foundation", at(i, -3), 0, 0, true);
    edge("large_wall", at(i, -3), 0, 0, true);
  }
  for (const [i, flip] of [[0, true], [2, false]] as const) {
    edge("fence_foundation", at(i, -3), 3, 0, flip);
    edge("large_wall", at(i, -3), 3, 0, flip);
  }
  for (const i of [0, 1]) {
    edge("fence_foundation", at(i, -2), 0, 0, true);
    for (const lvl of [8, 12]) edge(lvl === 8 ? "windowframe" : "wall", at(i, -2), 0, lvl, true);
  }
  edge("gateway", at(0, -2), 0, 0, true);
  edge("gate", at(0, -2), 0, 0, true);

  trims();
  // The whole base turned, as a base stands at any yaw.
  const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
  return { placed: out.map((q) => ({ ...q, x: c * q.x - s * q.z, z: s * q.x + c * q.z, yaw: (q.yaw - Math.round((turn * 65536) / 360)) & 65535 })), keys };
}
