// One building that uses the forms past the first nine together, each piece posed from its key as the game would
// place it (shared/world/lattice/frames.ts poseOf): a house two cells square with a bay of three triangles at its west
// end and hips at its east, a lean-to along its north side whose roof runs on down from the house's, a terrace to the
// east with a ramp up to a deck on pillars, a hatch and a ladder, and a fence line with a gateway beyond it.

import { plainYaw } from "../../client/core/render/piece-fit.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { FORM_LAYERS, makeFormTable, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { Frame, poseOf, rotsOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { levelY, worldOf, yawOf } from "../../shared/world/lattice/basis.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, canon, canonical, key0, key1, tupleStep } from "../../shared/world/lattice/module.ts";
import type { SourceMesh } from "../pack/write.ts";
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

/** A wall's end at a corner, as the client's trims see it: the corner, the level, the way the wall leaves it by, in twelfths of a turn, and the quarter storeys it stands. */
interface End {
  at: Tuple;
  lvl: number;
  way: number;
  reach: number;
}

/** Sets pieces down in a base at the origin as the game would, each posed from its key, and keeps what a trim is laid from. */
function builder(tier: string) {
  const forms = makeFormTable(NAMES.length + 1);
  NAMES.forEach((name, k) => setForm(forms, k + 1, ALL[name]!));
  const frame = new Frame(1, 0, Math.round(FLOOR * STRUCT_UNITS), 0, 0, 0);
  const out: Placed[] = [];
  const ends: End[] = [];
  const posts = new Set<string>();
  const floors: { x: number; z: number }[][] = [];
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
    const placed: Placed = { id: `core:${name}_${tier}`, x: pose.x / STRUCT_UNITS, y: pose.y / STRUCT_UNITS, z: pose.z / STRUCT_UNITS, yaw: plainYaw(pose.yaw, pose.tw) };
    out.push(placed);
    const form = ALL[name]!;
    if (cls === CLS_VERTEX) posts.add(`${a.join()},${lvl}`);
    if (form.layer === "wall") {
      // Its two outer ends, at each storey it stands through.
      const wide = new Set((form.cells ?? [[0, 0]]).map((c) => c[0])).size;
      for (let up = 0; up < Math.max(1, form.span); up += 4) for (const [at, way] of [[a, d], [step(a, d, wide), (d + 6) % 12]] as const) ends.push({ at, lvl: lvl + up, way, reach: Math.min(4, Math.max(1, form.span) - up) });
    }
    if (form.root === "always" && (form.size ?? 2) === 2) {
      // Its outline on the ground, turned as it is drawn.
      const turn = (placed.yaw / 65536) * 2 * Math.PI, [c, sn] = [Math.cos(turn), Math.sin(turn)];
      floors.push(form.outline.map(([u, v]) => ({ x: placed.x + c * (u - form.at[0]) + sn * (v - form.at[2]), z: placed.z - sn * (u - form.at[0]) + c * (v - form.at[2]) })));
    }
  };
  const square = (name: string, i: number, j: number, lvl: number, own = 0): void => put(name, CLS_SQUARE, at(i, j), 0, lvl, own);
  /** On the edge from `a` along `d`, its front to the left of that way, or to the right with `flip`. */
  const edge = (name: string, a: Tuple, d: number, lvl: number, flip = false): void => put(name, CLS_EDGE, a, d, lvl, flip ? (d + 6) % 12 : d);
  const tri = (name: string, a: Tuple, d: number, lvl: number, corner = 0): void => put(name, CLS_TRIANGLE, a, d, lvl, (d + 4 * corner) % 12);
  const post = (name: string, a: Tuple, lvl: number): void => put(name, CLS_VERTEX, a, 0, lvl, 0);
  /**
   * The joints and skirts the client would lay round what was set down (client/core/render/trims.ts), by its rule: a
   * joint where walls end, none in a straight run of two alike nor at a pillar nor where a wall comes up from under,
   * square where its walls lie along one square's ways and round where they do not, cut to its tallest wall; a skirt
   * under each side of a foundation that no other foundation lies against.
   */
  const trims = (): void => {
    const corners = new Map<string, End[]>();
    for (const e of ends) corners.set(`${e.at.join()},${e.lvl}`, [...(corners.get(`${e.at.join()},${e.lvl}`) ?? []), e]);
    const world = new Int32Array(2);
    for (const [key, here] of corners) {
      const { at: a, lvl } = here[0]!;
      if (posts.has(key)) continue;
      const mask = here.reduce((bits, e) => bits | (1 << e.way), 0);
      const lowest = 31 - Math.clz32(mask & -mask);
      const alike = here.every((e) => e.reach === here[0]!.reach);
      if (here.length > 1 && mask === ((1 << lowest) | (1 << (lowest + 6))) && alike) continue;
      const tall = Math.max(...here.map((e) => e.reach));
      const fold = (mask | (mask >> 3) | (mask >> 6) | (mask >> 9)) & 7;
      let [name, dir] = ["joint_sq", fold >> 1];
      if ((fold & (fold - 1)) !== 0) {
        let gap = 12;
        for (let d = lowest + 1, before = lowest; d <= lowest + 12; d++) {
          if ((mask & (1 << (d % 12))) === 0) continue;
          gap = Math.min(gap, d - before);
          before = d;
        }
        [name, dir] = [gap >= 3 ? "joint_r15" : "joint_r21", lowest];
      }
      m.set(a);
      worldOf(frame.basis, frame.ox, frame.oz, m, 0, world, 0);
      out.push({ id: cutId(`core:${name}_${tier}`, tall), x: world[0]! / STRUCT_UNITS, y: levelY(frame.oy, lvl) / STRUCT_UNITS, z: world[1]! / STRUCT_UNITS, yaw: plainYaw(yawOf(frame.yaw, dir), dir % 3) });
    }
    const sides = floors.flatMap((poly) => poly.map((q, k) => {
      const r = poly[(k + 1) % poly.length]!;
      const mid = { x: poly.reduce((sum, c) => sum + c.x, 0) / poly.length, z: poly.reduce((sum, c) => sum + c.z, 0) / poly.length };
      return { x: (q.x + r.x) / 2, z: (q.z + r.z) / 2, ox: (q.x + r.x) / 2 - mid.x, oz: (q.z + r.z) / 2 - mid.z };
    }));
    for (const side of sides) {
      if (sides.some((other) => other !== side && Math.hypot(other.x - side.x, other.z - side.z) < 0.02)) continue;
      // Its +Z out of the foundation, which a yaw turns to (sin, cos).
      const yaw = Math.round((Math.atan2(side.ox, side.oz) / (2 * Math.PI)) * 65536) & 65535;
      out.push({ id: `core:skirt_${tier}`, x: side.x, y: FLOOR, z: side.z, yaw });
    }
  };
  return { out, put, square, edge, tri, post, trims };
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

/** The quarter storeys a joint may be cut to, and the id its mesh is drawn under in a picture when it is. */
export const cutId = (id: string, cut: number): string => (cut > 0 && cut < 4 ? `${id}_cut${cut}` : id);

/**
 * A tier's joints as the client's clamp leaves them when it cuts one to a lower wall (client/core/render/piece-fit.ts):
 * every point over n quarter storeys and a centimetre is set down onto that height. A picture has no clamp, so each is
 * a mesh of its own.
 */
export function cutJoints(meshes: readonly SourceMesh[]): SourceMesh[] {
  return meshes.filter((m) => /:joint_/.test(m.id)).flatMap((m) => [1, 2, 3].map((cut): SourceMesh => ({
    ...m,
    id: cutId(m.id, cut),
    lods: m.lods.map((lod) => {
      const positions = Float32Array.from(lod.positions);
      for (let v = 1; v < positions.length; v += 3) positions[v] = Math.min(positions[v]!, cut * 0.75 + 0.01);
      return { ...lod, positions };
    }),
  })));
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
 * A keep of the forms past the first nine, with its joints and skirts laid as the client lays them: a hall two cells
 * by two under a pitched roof, gabled at its west end and hipped at its east; against its west side a six-sided tower
 * two storeys high with battlements; a terrace to the north-east with a ramp, a balustrade and a hatch; and to the
 * east a curtain wall with a gatehouse and its gate.
 */
export function keep(tier: string): Placed[] {
  const { out, put, square, edge, tri, post, trims } = builder(tier);
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
  out.push({ id: `core:ridge_${tier}`, x: 1.5, y: FLOOR + 3 + 1.5, z: 3, yaw: 0 });
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

/** Walls of `tier` that leave one corner by `ways`, on `storeys` storeys, with the joints the client would lay; with -1 storeys, the second wall is a half wall. */
export function corner(tier: string, ways: readonly number[], storeys = 1): Placed[] {
  const { out, edge, trims } = builder(tier);
  for (let storey = 0; storey < Math.max(1, storeys); storey++) ways.forEach((way, k) => edge(storeys < 0 && k > 0 ? "half_wall" : "wall", at(0, 0), way, storey * 4, k % 2 === 1));
  trims();
  return out;
}

