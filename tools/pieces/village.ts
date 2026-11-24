// One building that uses the forms past the first nine together, each piece posed from its key as the game would
// place it (shared/world/lattice/frames.ts poseOf): a house two cells square with a bay of three triangles at its west
// end and hips at its east, a lean-to along its north side whose roof runs on down from the house's, a terrace to the
// east with a ramp up to a deck on pillars, a hatch and a ladder, and a fence line with a gateway beyond it.

import { plainYaw } from "../../client/core/render/piece-fit.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { FORM_LAYERS, makeFormTable, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { Frame, poseOf, rotsOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, canon, canonical, key0, key1, tupleStep } from "../../shared/world/lattice/module.ts";
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

/** What sets pieces of `tier` down in a base at the origin by their slots, and the pieces set down so far. */
function builder(tier: string) {
  const forms = makeFormTable(NAMES.length + 1);
  NAMES.forEach((name, k) => setForm(forms, k + 1, ALL[name]!));
  const frame = new Frame(1, 0, Math.round(FLOOR * STRUCT_UNITS), 0, 0, 0);
  const out: Placed[] = [];
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
    poseOf(frame, key0(cls, m[4]!, m[5]!, m[6]!), key1(m[7]!, lvl, canon.dir, FORM_LAYERS.indexOf(ALL[name]!.layer), rot, 0), forms, kind, pose);
    out.push({ id: `core:${name}_${tier}`, x: pose.x / STRUCT_UNITS, y: pose.y / STRUCT_UNITS, z: pose.z / STRUCT_UNITS, yaw: plainYaw(pose.yaw, pose.tw) });
  };
  const square = (name: string, i: number, j: number, lvl: number, own = 0): void => put(name, CLS_SQUARE, at(i, j), 0, lvl, own);
  /** On the edge from `a` along `d`, its front to the left of that way, or to the right with `flip`. */
  const edge = (name: string, a: Tuple, d: number, lvl: number, flip = false): void => put(name, CLS_EDGE, a, d, lvl, flip ? (d + 6) % 12 : d);
  const tri = (name: string, a: Tuple, d: number, lvl: number, corner = 0): void => put(name, CLS_TRIANGLE, a, d, lvl, (d + 4 * corner) % 12);
  const post = (name: string, a: Tuple, lvl: number): void => put(name, CLS_VERTEX, a, 0, lvl, 0);
  return { out, put, square, edge, tri, post };
}

/** The pieces of the village in the frame of a base at the origin, of `tier`. A trim is set down by hand, as the client would lay it. */
export function village(tier: string): Placed[] {
  const { out, put, square, edge, tri, post } = builder(tier);

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
  out.push({ id: `core:ridge_${tier}`, x: 1.5, y: FLOOR + 3 + 1.5, z: 3, yaw: 0 });
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
  return out;
}

/**
 * A hamlet of the few forms a first tier has: a hut of one room under a pitched roof with a fenced yard before it, a
 * longhouse of three bays with a hipped end, a house in an L whose roofs meet in a valley, a hut of two storeys, and
 * one whose roof is pitched over a flat ceiling. With `joints`, a corner pole stands at each corner where walls end.
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

export function hamlet(tier: string, joints = false): Placed[] {
  const { out, square, edge } = builder(tier);
  const corners = new Set<string>();
  /** A wall-family piece on the edge from (i, j) along +X or +Z, facing out of what it closes, and its two corners. */
  const wall = (name: string, i: number, j: number, d: 0 | 3, lvl: number, flip: boolean): void => {
    edge(name, at(i, j), d, lvl, flip);
    if (/^(wall|doorframe|half_wall)$/.test(name)) for (const end of [0, 1]) corners.add(`${i + (d === 0 ? end : 0)},${j + (d === 3 ? end : 0)},${lvl}`);
  };
  const ridge = (x: number, z: number, lvl: number, along: 0 | 3): void => void out.push({ id: `core:ridge_${tier}`, x, y: FLOOR + lvl * 0.75 + 1.5, z, yaw: along === 0 ? 0 : 16384 });
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
    ridge(i * 3 + 1.5, (j + 1) * 3, lvl, 0);
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
  ridge((o + 1) * 3 + 1.5, 3, 4, 0);
  ridge((o + 1) * 3, -1.5, 4, 3);
  ridge((o + 1) * 3, 1.5, 4, 3);
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

  if (joints) for (const c of corners) {
    const [i, j, lvl] = c.split(",").map(Number) as [number, number, number];
    out.push({ id: `core:joint_sq_${tier}`, x: i * 3, y: FLOOR + lvl * 0.75, z: j * 3, yaw: 0 });
  }
  return out;
}

/** Where a lattice point is in the base's own metres: x, and z. */
function where(a: Tuple): [number, number] {
  let [x, z] = [0, 0];
  a.forEach((n, k) => {
    x += 1.5 * n * Math.cos((k * Math.PI) / 6);
    z += 1.5 * n * Math.sin((k * Math.PI) / 6);
  });
  return [x, z];
}

/**
 * A fort of the end-game tier: a keep three cells by two under a pitched roof, a gable at its west end and two hips
 * at its east; a flat-roofed annex with a parapet, a railing on it, a hatch and its ladder, and a ramp up to it; a
 * porch on thin pillars and beams; a twelve-sided tower of two storeys on six squares round a hexagon of triangles,
 * with a parapet and a lantern under six triangles of roof; and a curtain of large walls with a gateway and its gate.
 * A corner post stands at every corner, as the client would lay it, cut to a low wall's height, and a skirt hangs
 * under the keep's south and west sides. The base is turned `turn` degrees.
 */
export const FORT_SHOTS: readonly VillageShot[] = [
  ["the fort from the south-west", [0, 3, 0], 17, 122, 22],
  ["the keep: its gable, its roof and the porch", [4.5, 2.6, 2], 7.6, 128, 20],
  ["the tower", [-9, 4.6, 3], 8.8, 150, 16],
  ["the gateway, its gate and the curtain", [3, 5.2, -9], 9.2, 100, 8],
  ["the roofs from above", [0, 4, 3], 15, 100, 60],
  ["the annex: its parapet, the railing, the hatch and the ramp", [10.8, 3.2, 1.6], 5.6, 52, 30],
  ["the gate, close", [3, 2.4, -9], 4.2, 110, 4],
  ["a corner post between two walls, and the skirts under them", [0, 1.2, 0], 2.6, 135, 12],
  ["the tower's parapet and lantern", [-9, 8.2, 3], 5.4, 160, 30],
  ["the hips, the gutter and a parapet's cut post", [9.2, 4, 0.6], 3.6, 60, 22],
];

export function fort(tier: string, turn = 17): Placed[] {
  const { out, put, square, edge, tri, post } = builder(tier);
  const yawOf = (d: number): number => (65536 - Math.round((d * 65536) / 12)) & 65535;
  /** A joint on a lattice point at a level: the square post, or a tube `r15` or `r21`, cut to `cut` quarter storeys. */
  const joint = (a: Tuple, lvl: number, kind = "sq", cut = 0): void => {
    const [x, z] = where(a);
    out.push({ id: `core:joint_${kind}_${tier}${cut ? `_cut${cut}` : ""}`, x, y: FLOOR + lvl * 0.75, z, yaw: 0 });
  };
  /** A skirt under the side from `a` along `d`, the way out to its right. */
  const skirt = (a: Tuple, d: number): void => {
    const [x, z] = where(step(a, d, 0.5));
    out.push({ id: `core:skirt_${tier}`, x, y: FLOOR, z, yaw: yawOf((d + 6) % 12) });
  };
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
    out.push({ id: `core:ridge_${tier}`, x: i * 3 + 1.5, y: FLOOR + 3 + (ALL.roof!.corner![0]! - 0), z: 3, yaw: 0 });
  }
  edge("sloped_wall_right", at(0, 0), 3, 4);
  edge("sloped_wall_left", at(0, 1), 3, 4);
  square("roof_hip", 2, 0, 4, 0);
  square("roof_hip", 2, 1, 4, 3);
  for (const [i, j] of [[0, 0], [0, 2], [3, 0], [3, 2]] as const) joint(at(i, j), 0);
  for (let i = 0; i < 3; i++) skirt(at(i + 1, 0), 6);
  for (const j of [0, 1]) skirt(at(0, j), 3);

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
  for (const [i, j] of [[4, 0], [4, 2]] as const) {
    joint(at(i, j), 0);
    joint(at(i, j), 4, "sq", 2);
  }
  joint(at(3, 2), 4, "sq", 2);
  skirt(at(4, 0), 3);
  skirt(at(4, 1), 3);

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
      joint(far, lvl, "r15");
      joint(wing, lvl, "r15");
    }
    edge("half_wall", far, across, 8, true);
    edge("half_wall", wing, (2 * k + 3) % 12, 8, true);
    joint(far, 8, "r15", 2);
    joint(wing, 8, "r15", 2);
    // The lantern: a low wall round the hexagon, and a triangle of roof on each of its sides, high at the middle.
    edge("half_wall", hub, across, 8, true);
    joint(hub, 8, "r15", 2);
    tri("triangle_roof", centre, 2 * k, 10, 1);
  }

  // The curtain south of it: large walls on a kerb, the gateway and its gate, a post at each end and each side of the gateway.
  for (let i = -2; i < 4; i++) edge("fence_foundation", at(i, -3), 0, 0, true);
  for (const i of [-2, -1, 2, 3]) edge("large_wall", at(i, -3), 0, 0, true);
  edge("gateway", at(0, -3), 0, 0, true);
  edge("gate", at(0, -3), 0, 0, true);
  for (const i of [-2, 0, 2, 4]) for (const lvl of [0, 4, 8, 12]) joint(at(i, -3), lvl);

  // The whole base turned, as a base stands at any yaw.
  const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
  return out.map((q) => ({ ...q, x: c * q.x - s * q.z, z: s * q.x + c * q.z, yaw: (q.yaw - Math.round((turn * 65536) / 360)) & 65535 }));
}
