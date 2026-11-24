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

/** The pieces of the village in the frame of a base at the origin, of `tier`. A trim is set down by hand, as the client would lay it. */
export function village(tier: string): Placed[] {
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

export const KEEP_SHOTS: readonly VillageShot[] = [];
export function keep(tier: string): Placed[] {
  return village(tier);
}
