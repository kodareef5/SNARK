import { GRATE, UTILITY_ENAMEL as BOX } from "./colours.ts";
import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { leaning, pitchedRoof, slopeShape, slopedSlab, stairFlight, staticOf, wedge } from "../shared/content/slopes.ts";
import type { HullDef } from "../shared/world/convex.ts";

const shaped = (name: string): string => `core:${name.startsWith("floorroad") ? "zzruinshape" : "zruinshape"}_${name}`;
const fallenFrame = [[0, -3.5, 4, .5], [0, 3.5, 4, .5], [-3.5, 0, .5, 3], [3.5, 0, .5, 3]].map(([x, z, w, d]) => ({
  corners: leaning([w!, .25, d!], 60).corners.map(([u, y, v]) => [u + x!, y + z! * Math.sin(Math.PI / 3), v + z! * .5] as const),
}));
export const RUIN_SLOPES = {
  flight: stairFlight(shaped("flight"), 2, 5.5, 4, { steps: 11, slab: .8 }),
  zpitch8: slopeShape(shaped("pitch8"), "ceiling", pitchedRoof(8, 8, 2.5, .3)),
  zpitch16: slopeShape(shaped("pitch16"), "ceiling", pitchedRoof(16, 16, 4, .3)),
  zpitch4: slopeShape(shaped("pitch4"), "ceiling", pitchedRoof(4, 4, 1.25, .3)),
  plate15: slopeShape(shaped("plate15"), "thing", [leaning([4, .2, 4], 15)]),
  plate30: slopeShape(shaped("plate30"), "thing", [leaning([4, .2, 4], 30)]),
  plate4: slopeShape(shaped("plate4"), "thing", [leaning([2, .25, 2], 24)]),
  front60: slopeShape(shaped("front60"), "thing", fallenFrame),
  mound: slopeShape(shaped("mound"), "thing", [wedge(4, 6, 2)]),
  // A garage's ramp seen through its open deck, rising half a storey over a bay.
  zdeckramp: slopeShape(shaped("zdeckramp"), "stairs", [slopedSlab(3, 8, 2, .3)]),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`ramp${i + 1}`, slopeShape(shaped(`ramp${i + 1}`), "stairs", [slopedSlab(2, 4, (i + 1) / 4, .4)])])) as Record<`ramp${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`, ReturnType<typeof slopeShape>>,
  ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`floorroad${i + 1}`, slopeShape(shaped(`floorroad${i + 1}`), "ceiling", [slopedSlab(4, 4, (i + 1) / 8, .4)])])) as Record<`floorroad${1 | 2 | 3 | 4}`, ReturnType<typeof slopeShape>>,
};
/**
 * A box of a facade module in the facade's metres: from and to along it (an 8 m bay from -4 to 4), up from the storey's floor
 * (a storey is 4 m, its floor slab's top at 0), and out from the wall line (+ outside); then its own colour, if any.
 */
type Part = readonly [number, number, number, number, number, number, number?];
// Fixed colours of a module's parts: a dark opening, a pane, a rail, a pole or a shutter in painted steel, the faded coral of a
// flat's recessed wall, a shop's pale sign band, a garage's weathered spandrel, a ground floor's base, a clearance bar.
const DARK = 83, PANE = 92, METAL = 89, STEEL = 5, CORAL = 113, SIGN = 135, SPANDREL = 87, BASE = 88, MARK = 6;
/** A balcony's front in pale render whatever the building's finish, so the coral wall behind it shows. */
const FRONT = 104;
// A curb's pale top, a walk's paving, a gutter's dark, a grate, a utility box's grey green, a downpipe's stain, rust.
const CURB = 102, WALK = 1, GUTTER = 84, STAIN = 96, RUST = 179;
// Growth: a vine's leaves, moss, and weeds in soil.
const LEAF = 138, MOSS = 150, WEED = 196;
type Corner = readonly [number, number, number];
/**
 * A module's parts drawn with their edges cut, each as the convex part that stands in for its box in the look: an edge that
 * meets the sky or sits at eye height catches the light along a face of its own. Walked, the box stays.
 */
const BEVEL = new Map<Part, Corner[]>();
/** A box along x with `c` cut off the edges named: up and out ("uo"), down and out ("do"), up and in ("ui"). */
const bevelX = (p: Part, c: number, cut: string): Part => {
  const [x0, x1, y0, y1, z0, z1] = p;
  const round: (readonly [number, number])[] = [[y0, z0], ...(cut.includes("do") ? [[y0, z1 - c], [y0 + c, z1]] as const : [[y0, z1]] as const), ...(cut.includes("uo") ? [[y1 - c, z1], [y1, z1 - c]] as const : [[y1, z1]] as const), ...(cut.includes("ui") ? [[y1, z0 + c], [y1 - c, z0]] as const : [[y1, z0]] as const)];
  BEVEL.set(p, [x0, x1].flatMap((x) => round.map(([y, z]): Corner => [x, y, z])));
  return p;
};
/** An upright box with `c` cut off its outer vertical edges named: at its low x ("-") or its high x ("+"). */
const bevelY = (p: Part, c: number, cut: string): Part => {
  const [x0, x1, y0, y1, z0, z1] = p;
  const round: (readonly [number, number])[] = [[x0, z0], [x1, z0], ...(cut.includes("+") ? [[x1, z1 - c], [x1 - c, z1]] as const : [[x1, z1]] as const), ...(cut.includes("-") ? [[x0 + c, z1], [x0, z1 - c]] as const : [[x0, z1]] as const)];
  BEVEL.set(p, [y0, y1].flatMap((y) => round.map(([x, z]): Corner => [x, y, z])));
  return p;
};
const up = (y: number, parts: readonly Part[]): Part[] => parts.map((p) => {
  const [a, b, c, d, e, f, g] = p; const q: Part = [a, b, c + y, d + y, e, f, g];
  const cut = BEVEL.get(p); if (cut) BEVEL.set(q, cut.map(([u, w, z]): Corner => [u, w + y, z]));
  return q;
});
const wall = (top: number, out = 0.25): Part => [-4, 4, 0, top, -0.25, out];
/** Parts turned end for end along the bay, their cut edges with them. */
const mirror = (parts: readonly Part[]): Part[] => parts.map((p) => {
  const [a, b, c, d, e, f, g] = p; const q: Part = [-b, -a, c, d, e, f, g];
  const cut = BEVEL.get(p); if (cut) BEVEL.set(q, cut.map(([x, y, z]): Corner => [-x, y, z]));
  return q;
});
/**
 * Two flats' balconies across the bay, 2 m deep behind a solid front, a divider between them; behind, a coral wall with a
 * door and a window to each flat, jambs at the columns and a band from the head down to the slab above.
 */
/**
 * A flat's recessed wall: jambs at the columns and the wall between them in faded coral, so a district's blue does not
 * make them read as glass left blank, and a door and a window to each flat.
 */
const RECESS: Part[] = [
  [-4, -3.6, 0, 2.7, -0.25, 0.25, CORAL], [3.6, 4, 0, 2.7, -0.25, 0.25, CORAL], [-3.6, 3.6, 0, 2.7, -0.35, -0.25, CORAL],
  ...[-2, 2].flatMap((c): Part[] => [[c - 1.5, c - 0.6, 0, 2.2, -0.25, -0.2, DARK], [c, c + 1.4, 0.9, 2.3, -0.25, -0.2, DARK]]),
];
const RETURNS: Part[] = [[-4, -3.9, 0, 1.05, 0.25, 1.82, FRONT], [3.9, 4, 0, 1.05, 0.25, 1.82, FRONT]];
const BALCONY: Part[] = [
  bevelX([-4, 4, -0.25, 0, 0, 2], 0.12, "do"), [-4, 4, 0, 1.05, 1.82, 2, FRONT], ...RETURNS, [-0.1, 0.1, 0, 2.7, 0.25, 1.82, CORAL], [-4, 4, 2.7, 4, -0.25, 0.25],
  ...RECESS,
];
/** Walked, a balcony's front returns at the bay's ends, so it is reached only from the flat behind it. */
const BALCONY_WALKED: Part[] = [[-4, 4, -0.25, 0, 0, 2], [-4, 4, 0, 1.05, 1.82, 2], ...RETURNS, wall(4)];
/** The top flats' balconies roofed, and a guard standing above the roof at the roof's edge. */
const BALCONY_CAP: Part[] = [[-4, 4, 3.6, 4, 0.25, 2], [-4, 4, 4, 4.8, 1.82, 2, FRONT]];
/** A window to each 4 m room, sills standing out, a band from the head down to the slab above. */
const WINDOWS: Part[] = [[-4, 4, 0, 1, -0.25, 0.25], [-4, 4, 3, 4, -0.25, 0.25], [-4, -2.6, 1, 3, -0.25, 0.25], [-1.2, 1.2, 1, 3, -0.25, 0.25], [2.6, 4, 1, 3, -0.25, 0.25], [-2.6, -1.2, 1, 3, -0.3, -0.15, DARK], [1.2, 2.6, 1, 3, -0.3, -0.15, DARK], [-2.75, -1.05, 0.88, 1, 0.25, 0.42], [1.05, 2.75, 0.88, 1, 0.25, 0.42]];
/** A parapet over the roof's edge and its coping. */
const PARAPET: Part[] = [[-4, 4, 4, 4.8, -0.25, 0.25], bevelX([-4, 4, 4.8, 4.95, -0.3, 0.35], 0.06, "uoui")];
/** Spandrel over the slab's edge, a pane a storey and mullions at 2 m. */
const CURTAIN: Part[] = [[-4, 4, -0.4, 1, -0.15, 0.25], [-4, 4, 1, 3.6, -0.2, -0.05, PANE], ...[-4, -2, 0, 2, 4].map((x): Part => [Math.max(-4, x - 0.05), Math.min(4, x + 0.05), 1, 3.6, -0.05, 0.15, METAL])];
const CROWN: Part[] = [bevelX([-4, 4, 3.6, 5.2, -0.15, 0.25], 0.1, "uo")];
/** A tower's plant floor: louvres in a dark recess between piers, under a band and a parapet. */
const LOUVRE = 84;
const PLANT: Part[] = [[-4, -3.6, 0, 4, -0.25, 0.25], [3.6, 4, 0, 4, -0.25, 0.25], [-3.6, 3.6, 0, 0.4, -0.25, 0.25], [-3.6, 3.6, 3.25, 4, -0.25, 0.25], [-3.6, 3.6, 0.4, 3.25, -0.35, -0.25, LOUVRE],
  ...[0.7, 1.15, 1.6, 2.05, 2.5, 2.95].map((y): Part => [-3.6, 3.6, y, y + 0.12, -0.25, 0.08, METAL])];
/**
 * A tall building's wall where it has no facade of its own: precast panels a storey high over a band at the slab's edge, a
 * pair of slot windows to each bay; a plant floor's louvres; the stair of a service core read from outside as a slot the
 * height of the storey with its landing across it. All within the wall's thickness, walked as the wall.
 */
const CLAD_BAND: Part = [-4, 4, 0, 0.4, -0.3, 0.25, SPANDREL];
const CLAD: Part[] = [CLAD_BAND, [-4, 4, 0.4, 1.2, -0.3, 0.25], [-4, 4, 2.9, 4, -0.3, 0.25], [-4, -2.6, 1.2, 2.9, -0.3, 0.25], [-1.4, 1.4, 1.2, 2.9, -0.3, 0.25],
  [2.6, 4, 1.2, 2.9, -0.3, 0.25], [-2.6, -1.4, 1.2, 2.9, -0.3, 0.1, DARK], [1.4, 2.6, 1.2, 2.9, -0.3, 0.1, DARK]];
const CLAD_LOUVRE: Part[] = [CLAD_BAND, [-4, 4, 0.4, 0.8, -0.3, 0.25], [-4, 4, 3.4, 4, -0.3, 0.25], [-4, -3.6, 0.8, 3.4, -0.3, 0.25], [3.6, 4, 0.8, 3.4, -0.3, 0.25],
  [-3.6, 3.6, 0.8, 3.4, -0.3, 0.05, LOUVRE], ...[1.2, 1.8, 2.4, 3].map((y): Part => [-3.6, 3.6, y, y + 0.1, 0.05, 0.2, METAL])];
const CLAD_CORE: Part[] = [CLAD_BAND, [-4, -0.5, 0.4, 4, -0.3, 0.25], [0.5, 4, 0.4, 4, -0.3, 0.25], [-0.5, 0.5, 0.4, 4, -0.3, 0.1, DARK], [-0.5, 0.5, 2, 2.2, 0.1, 0.25]];
const CLAD_WALL = (storeys: number): Part[] => [[-4, 4, 0, storeys * 4, -0.3, 0.25]];
/** Four storeys of a clad wall, the last of them one of `last`. */
const clad4 = (last: readonly Part[], every: readonly Part[] = CLAD): Part[] => [...[0, 4, 8].flatMap((y) => up(y, every)), ...up(12, last)];
/** A screen standing on a tower's roof at its edge, a storey tall, hiding its plant, with a coping. */
// A low building's raised parapet over its way in, and along its front. Walked as it looks, with a square coping in pale
// render: on low poly the near city's mesh draws a piece as walked and its instance as it looks, and a bevel or a coping
// walked as its wall showed along every edge of a front of them.
const ATTIC: Part[] = up(-0.05, [[-4, 4, 0, 2.4, -0.32, 0.37], [-4, 4, 2.4, 2.55, -0.36, 0.42, FRONT]]);
const STEP_UP: Part[] = up(-0.05, [[-4, 4, 0, 1.25, -0.32, 0.37], [-4, 4, 1.25, 1.4, -0.36, 0.42, FRONT]]);
const SCREEN: Part[] = [[-4, 4, 0, 3.6, -0.3, 0.3], bevelX([-4, 4, 3.6, 3.75, -0.35, 0.4], 0.06, "uoui")];
/**
 * What gives a shop's front its depth, drawn only and all within the bounds its parts had, so that its middle
 * (FACADE_AT), and with it every map that set one down, stays where it was: a steel frame round the display, 8 cm a
 * member, standing 5 to 7 cm off its glass with a mullion at a third; a pale sill under the glass standing 12 cm out
 * past the riser; and a drip under the sign band's front, its lower edge cut, which shades the head of the recess. The
 * frame's members and the sill are no facade part's size (facade.ts KINDS), so the display is still painted whole
 * behind them.
 */
const SHOP_FRAME: Part[] = [
  [-3.6, 1.4, 2.82, 2.9, -0.15, -0.08, METAL], [-3.6, -3.52, 0.6, 2.82, -0.15, -0.08, METAL], [1.32, 1.4, 0.6, 2.82, -0.15, -0.08, METAL],
  [-1.97, -1.89, 0.6, 2.82, -0.15, -0.1, METAL], [-3.6, 1.4, 0.52, 0.6, -0.15, -0.08, METAL], [-3.6, 1.4, 0.44, 0.52, -0.15, 0.17, FRONT],
];
const drip = (to: number): Part => bevelX([-3.6, to, 2.76, 2.9, 0.25, 0.4], 0.06, "do");
/** A shop's front: half piers, a sign band standing proud of them, a dark display on a low riser and a 2 m door set back. */
const SHOP: Part[] = [bevelY([-4, -3.6, 0, 4, -0.3, 0.3], 0.1, "+"), bevelY([3.6, 4, 0, 4, -0.3, 0.3], 0.1, "-"), [-3.6, 3.6, 2.9, 3.8, -0.25, 0.4, SIGN], [-3.6, 3.6, 3.8, 4, -0.25, 0.25], [-3.6, 1.4, 0, 0.5, -0.25, 0.05], [-3.6, 1.4, 0.5, 2.9, -0.25, -0.15, DARK], [1.4, 1.6, 0, 2.9, -1.2, 0.05], ...SHOP_FRAME, drip(3.6)];
/** Beside a failure: the sign band and its head cut back different lengths and the pier at the break broken off. */
const SHOP_CUT: Part[] = [SHOP[0]!, [3.6, 4, 0, 2.4, -0.3, 0.3], [-3.6, 0.9, 2.9, 3.8, -0.25, 0.4, SIGN], [-3.6, 2.2, 3.8, 4, -0.25, 0.25], SHOP[4]!, SHOP[5]!, SHOP[6]!, ...SHOP_FRAME, drip(0.9)];
const SHOP_CUT_WALKED: Part[] = [[-4, -3.6, 0, 4, -0.3, 0.3], [3.6, 4, 0, 2.4, -0.3, 0.3], [-3.6, 0.9, 2.9, 3.8, -0.25, 0.4], [-3.6, 2.2, 3.8, 4, -0.25, 0.25], [-3.6, 1.6, 0, 2.9, -0.25, 0.05]];
const SHOP_WALKED: Part[] = [[-4, -3.6, 0, 4, -0.3, 0.3], [3.6, 4, 0, 4, -0.3, 0.3], [-3.6, 3.6, 2.9, 4, -0.25, 0.4], [-3.6, 1.6, 0, 2.9, -0.25, 0.05]];
/** The same front with a blue-grey shutter down over display and door. */
const SHUTTER: Part[] = [SHOP[0]!, SHOP[1]!, [-3.6, 3.6, 2.9, 3.8, -0.25, 0.4, SIGN], [-3.6, 3.6, 3.8, 4, -0.25, 0.25], [-3.6, 3.6, 0, 2.9, 0, 0.1, STEEL], drip(3.6)];
/** A garage's open deck: columns at the bay's ends and a weathered spandrel over the slab's edge. */
const DECK: Part[] = [[-4, -3.65, 0, 3.6, -0.35, 0.35], [3.65, 4, 0, 3.6, -0.35, 0.35], [-3.65, 3.65, -0.4, 1.05, 0, 0.25, SPANDREL]];
/** The deck above's edge beam, a lip under its slab. */
const DECK_LIP: Part = [-3.65, 3.65, 3.4, 3.6, -0.1, 0.25];
const DECK_CAP: Part[] = [[-4, 4, 3.6, 4.6, -0.1, 0.25, SPANDREL], [-0.08, 0.08, 4.6, 9.4, 0.05, 0.2, STEEL], [-0.7, 0.1, 9.25, 9.45, 0.05, 0.4, STEEL]];
/** Where a balcony's solid front fell beside a failure: steel posts at 1.93 m and a top rail, the middle post a rusted stub. */
const RAIL: Part[] = [[-4, 4, 0.96, 1.05, 1.85, 2, METAL], [-0.05, 0.05, 0, 0.45, 1.88, 1.97, RUST], ...[-3.86, -1.93, 1.93, 3.86].map((x): Part => [x - 0.045, x + 0.045, 0, 0.96, 1.88, 1.97, METAL])];
const RAIL_ENDS: Part[] = [[-4, -3.94, 0, 1.05, 0.25, 1.94, METAL], [3.94, 4, 0, 1.05, 0.25, 1.94, METAL]];
const RAILED: Part[] = [...BALCONY.filter((p) => p !== BALCONY[1] && !RETURNS.includes(p)), ...RAIL, ...RAIL_ENDS];
/**
 * A lobby's way in: a steel head across the open bay from column to column and a concrete canopy over it. Nothing of it
 * stands below the head, so it is no obstacle to the way through the door.
 */
const ENTRY: Part[] = [[-4, 4, 2.82, 3, -0.09, 0.09, METAL], [-3.2, 3.2, 3, 3.25, 0.09, 2.1], [-3.2, 3.2, 3.25, 3.45, 1.95, 2.1]];
const MODULES = {
  zbalc: { look: BALCONY, walked: BALCONY_WALKED },
  zbalctop: { look: [...BALCONY, ...BALCONY_CAP], walked: [...BALCONY_WALKED, ...BALCONY_CAP] },
  /** Beside a failure a flat's balcony has fallen: its wall bare to the slab's broken end. */
  zbalcbare: { look: [[-4, 4, 2.7, 4, -0.25, 0.25], ...RECESS], walked: [wall(4)] },
  zbalcrail: { look: RAILED, walked: [BALCONY_WALKED[0]!, [-4, 4, 0, 1.05, 1.85, 2], ...RAIL_ENDS, wall(4)] },
  zentry: { look: ENTRY, walked: [[-4, 4, 2.82, 3.45, -0.09, 2.1]] },
  /** A downpipe a storey long on a wall's face, with its clips, and its foot: a shoe and the stain the water left. */
  zpipe4: { look: [[-0.075, 0.075, 0, 4, 0.25, 0.4, METAL], [-0.11, 0.11, 1, 1.12, 0.25, 0.43, METAL], [-0.11, 0.11, 3, 3.12, 0.25, 0.43, METAL]], walked: [[-0.075, 0.075, 0, 4, 0.25, 0.4]] },
  zpipefoot: { look: [[-0.075, 0.075, 0.25, 4, 0.25, 0.4, METAL], [-0.075, 0.075, 0, 0.25, 0.25, 0.6, RUST], [-0.35, 0.35, 0, 1.9, 0.25, 0.28, STAIN]], walked: [[-0.075, 0.075, 0, 4, 0.25, 0.6]] },
  /** Its head under the roof's edge, the hopper the roof drains into. */
  zpipetop: { look: [[-0.075, 0.075, 0, 3.45, 0.25, 0.4, METAL], [-0.11, 0.11, 1, 1.12, 0.25, 0.43, METAL], [-0.2, 0.2, 3.45, 3.96, 0.25, 0.55, METAL]], walked: [[-0.075, 0.075, 0, 3.45, 0.25, 0.4], [-0.2, 0.2, 3.45, 3.96, 0.25, 0.55]] },
  zbalc4: { look: [0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), walked: [[-4, 4, -0.25, 16, -0.25, 0.25], ...BALCONY_WALKED.slice(0, 4), ...[4, 8, 12].flatMap((y) => up(y, BALCONY_WALKED.slice(0, 2)))] },
  zbalc4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), ...up(12, BALCONY_CAP)], walked: [[-4, 4, -0.25, 16, -0.25, 0.25], ...BALCONY_WALKED.slice(0, 4), ...[4, 8, 12].flatMap((y) => up(y, BALCONY_WALKED.slice(0, 2))), ...up(12, BALCONY_CAP)] },
  /**
   * A ground floor of flats: a solid darker base with a door 1 m by 2.2 m standing proud of it (drawn as a block's door
   * by the facade's material), a high window, the head band in the building's finish.
   */
  zlobby: { look: [[-4, 4, 0, 2.3, -0.25, 0.25, BASE], [-0.5, 0.5, 0, 2.2, 0.25, 0.275, DARK], [-4, -3.4, 2.3, 3.1, -0.25, 0.25, BASE], [3.4, 4, 2.3, 3.1, -0.25, 0.25, BASE], [-3.4, 3.4, 2.3, 3.1, -0.3, -0.2, DARK], [-4, 4, 3.1, 4, -0.25, 0.25]], walked: [wall(4)] },
  zstore: { look: SHOP, walked: SHOP_WALKED },
  // Its break toward +x, and toward -x.
  zstorecut: { look: SHOP_CUT, walked: SHOP_CUT_WALKED },
  zstorecutl: { look: mirror(SHOP_CUT), walked: mirror(SHOP_CUT_WALKED) },
  zshutter: { look: SHUTTER, walked: [...SHOP_WALKED.slice(0, 2), [-3.6, 3.6, 2.9, 4, -0.25, 0.3], [-3.6, 3.6, 0, 2.9, 0, 0.1]] },
  zwin: { look: WINDOWS, walked: [wall(4)] },
  zwintop: { look: [...WINDOWS, ...PARAPET], walked: [wall(4), ...PARAPET] },
  zwin4: { look: [0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), walked: [[-4, 4, 0, 16, -0.4, 0.4]] },
  zwin4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), ...up(12, PARAPET)], walked: [[-4, 4, 0, 16, -0.4, 0.4], ...up(12, PARAPET)] },
  zcurt: { look: CURTAIN, walked: [[-4, 4, -0.4, 3.6, -0.2, 0.25]] },
  zcurttop: { look: [...CURTAIN, ...CROWN], walked: [[-4, 4, -0.4, 5.2, -0.2, 0.25]] },
  zcurt4: { look: [0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), walked: [[-4, 4, -0.4, 15.6, -0.4, 0.4]] },
  zcurt4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), ...up(12, CROWN)], walked: [[-4, 4, -0.4, 17.2, -0.4, 0.4]] },
  zplanttop: { look: [...PLANT, ...PARAPET], walked: [wall(4), ...PARAPET] },
  /** A plant room's louvred storey on a tower's roof, between piers, under a band. */
  zplant: { look: PLANT, walked: [wall(4)] },
  zclad: { look: CLAD, walked: CLAD_WALL(1) },
  zcladl: { look: CLAD_LOUVRE, walked: CLAD_WALL(1) },
  zcladc: { look: CLAD_CORE, walked: CLAD_WALL(1) },
  zclad4: { look: clad4(CLAD), walked: CLAD_WALL(4) },
  zclad4l: { look: clad4(CLAD_LOUVRE), walked: CLAD_WALL(4) },
  zclad4c: { look: clad4(CLAD_CORE, CLAD_CORE), walked: CLAD_WALL(4) },
  zclad4top: { look: [...clad4(CLAD), ...up(12, PARAPET)], walked: [...CLAD_WALL(4), ...up(12, PARAPET)] },
  zscreen: { look: SCREEN, walked: [[-4, 4, 0, 3.75, -0.3, 0.3]] },
  // A low building's roofline: an attic over a lobby's bay, and a parapet raised along a run of a long front's bays.
  zattic: { look: ATTIC, walked: ATTIC },
  zstepup: { look: STEP_UP, walked: STEP_UP },
  /** The shade of an open storey's inside, set back from a torn edge: what is seen between its slabs from afar. */
  zgloom: { look: [[-3.6, 3.6, 0.05, 3.55, -0.1, 0.1, LOUVRE]], walked: [[-3.6, 3.6, 0.05, 3.55, -0.1, 0.1]] },
  // Walked, its spandrel stands a little thicker than drawn, so its coarsest level is its look's within a hand.
  zdeck: { look: [...DECK, DECK_LIP], walked: [DECK[0]!, DECK[1]!, [-3.65, 3.65, -0.4, 1.05, 0, 0.3], DECK_LIP] },
  zdecktop: { look: [...DECK, DECK_LIP, ...DECK_CAP], walked: [DECK[0]!, DECK[1]!, [-3.65, 3.65, -0.4, 1.05, 0, 0.3], DECK_LIP, DECK_CAP[0]!, DECK_CAP[1]!] },
  /** A garage's way in: its columns and a head with a clearance bar under it. */
  zgate: { look: [DECK[0]!, DECK[1]!, [-3.65, 3.65, 3, 3.6, -0.1, 0.25, SPANDREL], [-3.4, 3.4, 2.75, 3, 0, 0.3, MARK]], walked: [DECK[0]!, DECK[1]!, [-3.65, 3.65, 2.75, 3.6, -0.1, 0.3]] },
} satisfies Record<string, { look: readonly Part[]; walked: readonly Part[] }>;
export type FacadeModule = keyof typeof MODULES;
const boxOf = ([a, b, c, d, e, f, g]: Part, at: readonly number[]): ShapeBox => ({ at: [(a + b) / 2 - at[0]!, (c + d) / 2 - at[1]!, (e + f) / 2 - at[2]!], half: [(b - a) / 2, (d - c) / 2, (f - e) / 2], ...(g ? { color: g } : {}) });
/**
 * Each module's middle in the facade's metres, which is its piece's origin: placed on a wall line, a piece of it stands
 * that far up from the storey's floor and out from the line (ruin-layouts.ts facade).
 */
export const FACADE_AT = Object.fromEntries(Object.entries(MODULES).map(([name, m]) => {
  const all = [...m.look, ...m.walked];
  const lo = [0, 2, 4].map((k) => Math.min(...all.map((p) => p[k]!))); const hi = [1, 3, 5].map((k) => Math.max(...all.map((p) => p[k]!)));
  return [name, lo.map((l, a) => (l + hi[a]!) / 2) as readonly number[]];
})) as Partial<Record<string, readonly number[]>> as Record<FacadeModule, readonly number[]>;
export const RUIN_FACADES = Object.fromEntries(Object.entries(MODULES).map(([name, m]) => {
  const at = FACADE_AT[name as FacadeModule];
  const cut = m.look.filter((p) => BEVEL.has(p)).map((p) => ({ corners: BEVEL.get(p)!.map(([x, y, z]): Corner => [x - at[0]!, y - at[1]!, z - at[2]!]) }));
  const shape: ShapeDef = { type: "shape", id: shaped(name), role: "wall", boxes: m.walked.map((p) => boxOf([p[0], p[1], p[2], p[3], p[4], p[5]], at)), look: { boxes: m.look.filter((p) => !BEVEL.has(p)).map((p) => boxOf(p, at)), ...(cut.length ? { hulls: cut } : {}) } };
  return [name, shape];
})) as Record<FacadeModule, ShapeDef>;
// A spalled face's darker pockets of aggregate.
const POCKET = 97;
/** A prism along x from x0 to x1 of the profile `yz`, corners round it in (y, z). */
const prism = (x0: number, x1: number, yz: readonly (readonly [number, number])[]): Corner[] => [x0, x1].flatMap((x) => yz.map(([y, z]): Corner => [x, y, z]));
/** Teeth of a break across a width: each its from and to along x and how far its point stands out, with its point's height. */
type Tooth = readonly [number, number, number, number];
/** A slab's end broken off along x at z = 0, its top at y = 0: teeth of the slab's thickness standing out into the gap. */
const slabTeeth = (teeth: readonly Tooth[]): HullDef[] => teeth.map(([a, b, out, y]) => ({ corners: [[a, -0.4, 0], [a, 0, 0], [b, -0.4, 0], [b, 0, 0], [(a + b) / 2, y - 0.12, out], [(a + b) / 2, y + 0.04, out]] }));
/** Bent bars out of a break: each its place along x, its height, how far it runs out, and how far it then hangs down. */
const bars = (list: readonly (readonly [number, number, number, number])[]): ShapeBox[] => list.flatMap(([x, y, out, drop]): ShapeBox[] => [
  { at: [x, y, out / 2], half: [0.035, 0.035, out / 2], color: RUST },
  ...(drop > 0 ? [{ at: [x, y - drop / 2, out] as const, half: [0.035, drop / 2, 0.035] as const, color: RUST }] : []),
]);
/** Turns a corner about x by `degrees`, its +z end rising, as `leaning` turns a box. */
const lean = (degrees: number) => ([x, y, z]: Corner): Corner => { const a = (degrees * Math.PI) / 180; return [x, y * Math.cos(a) + z * Math.sin(a), z * Math.cos(a) - y * Math.sin(a)]; };
/** Each break piece's middle in the metres it was laid out in, which is its piece's origin, as FACADE_AT is a module's. */
export const BREAK_AT: Partial<Record<string, readonly number[]>> = {};
/** A shape of walked boxes and a look of boxes and convex parts, moved so the box that holds it all is centred on its origin. */
function centred(id: string, walked: { boxes?: ShapeBox[]; hulls?: HullDef[] }, look: { boxes?: ShapeBox[]; hulls?: HullDef[] }): ShapeDef {
  const points: Corner[] = [...[walked, look].flatMap((f) => (f.boxes ?? []).flatMap((b) => [[b.at[0] - b.half[0], b.at[1] - b.half[1], b.at[2] - b.half[2]], [b.at[0] + b.half[0], b.at[1] + b.half[1], b.at[2] + b.half[2]]] as Corner[])), ...[walked, look].flatMap((f) => (f.hulls ?? []).flatMap((h) => h.corners))];
  const mid = [0, 1, 2].map((a) => (Math.min(...points.map((p) => p[a]!)) + Math.max(...points.map((p) => p[a]!))) / 2);
  BREAK_AT[id.slice(id.indexOf("_") + 1)] = mid;
  const box = (b: ShapeBox): ShapeBox => ({ ...b, at: [b.at[0] - mid[0]!, b.at[1] - mid[1]!, b.at[2] - mid[2]!] });
  const hull = (h: HullDef): HullDef => ({ corners: h.corners.map((c) => [c[0] - mid[0]!, c[1] - mid[1]!, c[2] - mid[2]!] as const) });
  return { type: "shape", id, role: "thing", boxes: (walked.boxes ?? []).map(box), hulls: (walked.hulls ?? []).map(hull), look: { boxes: (look.boxes ?? []).map(box), hulls: (look.hulls ?? []).map(hull) } };
}
/**
 * The street's edge, 8 m along a road (x along it, z away from it, the curb's face at 0, the ground at 0): a 2.4 m walk at
 * curb height, 0.15 m, its curb's 0.3 m top pale, and with a gutter, a dark strip 0.45 m wide on the road's edge. A body
 * steps up it and a wheel rolls over it (tests/vehicles/vehicle-chassis-course.test.ts crosses such a kerb); the gutter is
 * drawn only.
 */
function street(): Record<"zwalk8" | "zwalk8g" | "zcurbramp" | "zcurbrampl" | "zdrain" | "zutility", ShapeDef> {
  const walked = { boxes: [{ at: [0, 0.075, 1.2], half: [4, 0.075, 1.2] }] as ShapeBox[] };
  const walk: ShapeBox[] = [{ at: [0, 0.075, 0.15], half: [4, 0.075, 0.15], color: CURB }, { at: [0, 0.075, 1.35], half: [4, 0.075, 1.05], color: WALK }];
  // A curb ramp 1.8 m along the curb (1 in 12), down from the walk to the road where it stops: rising to +x, or with `l` to -x.
  const ramp = (l: boolean): HullDef => ({ corners: [0, 2.4].flatMap((z): Corner[] => [[-0.9, 0, z], [0.9, 0, z], [l ? -0.9 : 0.9, 0.15, z]]) });
  return {
    zwalk8: centred(shaped("zwalk8"), walked, { boxes: walk }),
    zwalk8g: centred(shaped("zwalk8g"), walked, { boxes: [...walk, { at: [0, 0.015, -0.225], half: [4, 0.015, 0.225], color: GUTTER }] }),
    zcurbramp: centred(shaped("zcurbramp"), { hulls: [ramp(false)] }, { hulls: [ramp(false)], boxes: [{ at: [0.85, 0.07, 1.2], half: [0.05, 0.07, 1.2], color: CURB }] }),
    zcurbrampl: centred(shaped("zcurbrampl"), { hulls: [ramp(true)] }, { hulls: [ramp(true)], boxes: [{ at: [-0.85, 0.07, 1.2], half: [0.05, 0.07, 1.2], color: CURB }] }),
    // A storm drain at a gutter's low point: its grate in the gutter and its inlet a dark mouth in the curb's face.
    zdrain: centred(shaped("zdrain"), { boxes: [{ at: [0, 0.055, -0.25], half: [0.6, 0.055, 0.25] }] }, { boxes: [{ at: [0, 0.035, -0.225], half: [0.45, 0.005, 0.225], color: GRATE }, { at: [0, 0.07, -0.01], half: [0.6, 0.04, 0.01], color: GRATE }, { at: [0, 0.02, -0.225], half: [0.5, 0.015, 0.25], color: GUTTER }] }),
    // A utility box at the back of a walk, on its plinth.
    zutility: centred(shaped("zutility"), { boxes: [{ at: [0, 0.7, 0], half: [0.45, 0.55, 0.25] }] }, { boxes: [{ at: [0, 0.2, 0], half: [0.5, 0.05, 0.3], color: CURB }, { at: [0, 0.75, 0], half: [0.45, 0.5, 0.25], color: BOX }, { at: [0, 1.27, 0], half: [0.48, 0.02, 0.28], color: BOX }] }),
  };
}
/** A prism through a wall's thickness, z from z0 to z1, of the profile `xy`, corners round it in (x, y). */
const through = (z0: number, z1: number, xy: readonly (readonly [number, number])[]): Corner[] => [z0, z1].flatMap((z) => xy.map(([x, y]): Corner => [x, y, z]));
/**
 * A wall's top where the storey above it broke away, along its 8 m: runs of what is left, each from and to along it with its
 * height at either end, stepping, sloping and notched down to the slab between them; a bar or two standing out of it.
 */
const CROWNS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [[-4, -1.6, 1.2, 1.2], [-1.6, 0.4, 0.65, 0.65], [0.4, 2.5, 0.4, 0.15], [3.2, 4, 0.2, 0.2]],
  [[-4, -1.8, 1.5, 1.05], [-1.8, 1.2, 0.95, 0.3], [1.2, 4, 0.15, 0.15]],
  [[-4, -2.3, 1, 1], [-2.3, -0.6, 0.25, 0.25], [-0.6, 1.9, 1.35, 0.95], [1.9, 4, 0.55, 0.55]],
  [[-4, -0.2, 0.45, 0.45], [-0.2, 2.2, 0.6, 0.18], [3, 4, 0.25, 0.25]],
  // A parapet's height, where a whole building's parapet lost a stretch.
  [[-4, -2.2, 0.95, 0.95], [-2.2, -0.8, 0.6, 0.6], [0.6, 4, 0.95, 0.95]],
  [[-4, 0.9, 0.95, 0.95], [0.9, 2.6, 0.6, 0.6], [3.1, 4, 0.95, 0.95]],
];
const crown = (name: string, runs: readonly (readonly [number, number, number, number])[]): ShapeDef => {
  // A level run is a box; a sloping one a convex part.
  const level = runs.filter(([, , ya, yb]) => ya === yb).map(([a, b, y]): ShapeBox => ({ at: [(a + b) / 2, y / 2, 0], half: [(b - a) / 2, y / 2, 0.25] }));
  const hulls = runs.filter(([, , ya, yb]) => ya !== yb).map(([a, b, ya, yb]): HullDef => ({ corners: through(-0.25, 0.25, [[a, 0], [b, 0], [b, yb], [a, ya]]) }));
  const [a, , ya] = runs[0]!;
  return centred(shaped(name), { boxes: level, hulls }, { hulls, boxes: [...level, { at: [a + 0.5, ya + 0.2, 0.1], half: [0.025, 0.25, 0.025], color: RUST }, { at: [a + 1.4, ya + 0.1, -0.1], half: [0.025, 0.2, 0.025], color: RUST }] });
};
/** A lump of rubble along a wall's foot from a to b, h high against the wall and reaching `out` from it on the ground. */
const lump = (a: number, b: number, h: number, out: number): HullDef => ({ corners: [[a, 0, 0.2], [b, 0, 0.2], [a + 0.3, 0, out * 0.85], [b - 0.2, 0, out], [a + 0.2, h, 0.2], [b - 0.3, h * 0.75, 0.2]] });
/** What fell along a wall's foot: lumps of it against the wall, blocks loose on its slope and soil with weeds at its toe. */
const skirt = (name: string, lumps: readonly (readonly [number, number, number, number])[], blocks: readonly (readonly [number, number, number, number])[], toe: number, more: readonly HullDef[] = []): ShapeDef => {
  const hulls = [...lumps.map(([a, b, h, out]) => lump(a, b, h, out)), ...more];
  const loose = blocks.map(([x, z, size, colour]): ShapeBox => ({ at: [x, size * 0.4, z], half: [size, size * 0.5, size * 0.8], color: colour }));
  return centred(shaped(name), { hulls }, { hulls, boxes: [...loose, { at: [0, 0.02, toe], half: [3.6, 0.02, 0.2], color: WEED }] });
};
/** A wall panel 3.8 m by 2.8 m hanging from one fixing at a slab's edge, its far end dropped 34 degrees, standing off the edge. */
const HANG = 34 * Math.PI / 180;
// Its corners on a 1/4096 m grid: an engine's sine and cosine may differ in the last place, and content must not.
const grid = (v: number): number => Math.round(v * 4096) / 4096;
const hanging = (): Corner[] => [0.35, 0.55].flatMap((z) => ([[0, 0], [3.8, 0], [3.8, -2.8], [0, -2.8]] as const).map(([x, y]): Corner => [grid(x * Math.cos(HANG) + y * Math.sin(HANG) - 1.45), grid(-x * Math.sin(HANG) + y * Math.cos(HANG) - 0.45), z]));
/**
 * A slab 6 m wide torn from its bay and hanging from its top edge on the slab line (z = 0, y = 0), nearly sheer, out to
 * 1.3 m at one end of its foot and 2 m at the other and 1 m lower there, so it is seen twisted and not as an eave.
 */
const DRAPE: Corner[] = [[-3, 0, 0], [3, 0, 0], [-2.3, -6.6, 1.3], [3.3, -5.6, 2]].flatMap(([x, y, z]): Corner[] => [[x!, y!, z!], [x!, y! - 0.08, z! - 0.34]]);
/** A column out of plumb by 8 degrees, its head broken on a slant. */
const LEAN_COLUMN: Corner[] = [[-0.3, 0, -0.3], [0.3, 0, -0.3], [-0.3, 0, 0.3], [0.3, 0, 0.3], [-0.3, 3.2, 0.15], [0.3, 2.9, 0.12], [-0.3, 3.05, 0.73], [0.3, 2.75, 0.69]];
/** Strands of a vine hanging from a slab's edge, each its place along it, its length and colour, over a line of moss. */
/**
 * Strands of three vines, each its place along the edge, its length, its stem's thickness and its colour: unevenly spaced,
 * long and short, a thick old stem among thin ones, so a row of them is not a comb.
 */
type Strand = readonly [number, number, number, number];
const STRANDS: readonly (readonly Strand[])[] = [
  [[-1.35, 0.7, 0.05, MOSS], [-1.05, 2.9, 0.11, LEAF], [-0.4, 1.6, 0.06, WEED], [0.05, 3.5, 0.09, LEAF], [0.95, 1.1, 0.05, MOSS], [1.3, 2.2, 0.13, LEAF]],
  [[-1.4, 2.4, 0.12, LEAF], [-0.6, 0.8, 0.05, WEED], [-0.35, 1.9, 0.07, MOSS], [0.6, 3.2, 0.1, LEAF], [1.4, 1.3, 0.06, WEED]],
  [[-1.2, 1.2, 0.06, MOSS], [-0.9, 3.4, 0.12, LEAF], [-0.1, 2.1, 0.08, WEED], [0.25, 0.9, 0.05, MOSS], [1.1, 2.7, 0.1, LEAF], [1.45, 1.6, 0.07, WEED]],
];
/** A vine from a slab's edge: moss in runs along the edge, each strand's stem and leaves clumped along it, the most at its tip. */
const vine = (strands: readonly Strand[]): ShapeBox[] => [
  ...[[-1.5, -0.5, 0.05], [-0.2, 0.9, 0.04], [1.1, 1.55, 0.06]].map(([a, b, h]): ShapeBox => ({ at: [(a! + b!) / 2, -h!, 0.03], half: [(b! - a!) / 2, h!, 0.03], color: MOSS })),
  ...strands.flatMap(([x, length, thick, colour], k): ShapeBox[] => [
    { at: [x, -length / 2, 0.04], half: [thick / 2, length / 2, thick / 2], color: colour },
    ...[0.35, 0.65, 1].filter((f) => f * length > 0.5 || f === 1).map((f, n): ShapeBox => {
      const r = (0.08 + thick) * (f === 1 ? 1.4 : 1);
      return { at: [x + ((k + n) % 2 ? r * 0.6 : -r * 0.6), -f * length + r, 0.05], half: [r, r, 0.04], color: colour };
    }),
  ]),
];
// The column's broken head and the slab that fell from it break along the same teeth, so the one is seen to be the other's.
const BREAK: readonly Tooth[] = [[-0.4, -0.1, 0.45, -0.1], [-0.1, 0.15, 0.2, -0.25], [0.15, 0.4, 0.55, -0.05]];
const FALL = 25;
/** The column's head broken along BREAK: a tooth across the column for each, standing up from its stump. */
const headTeeth = (): HullDef[] => BREAK.map(([a, b, h]) => ({ corners: [[a, 2.6, -0.4], [b, 2.6, -0.4], [a, 2.6, 0.4], [b, 2.6, 0.4], [(a + b) / 2, 2.6 + h, -0.3], [(a + b) / 2, 2.6 + h, 0.3]] }));
/**
 * The ends a bay's slab has where the bay beside it fell, laid along its edge (x along it, z out into the gap, its top at 0):
 * whole, with a lip and a bevelled nose; spalled, its cover lost to the aggregate with two bars bared; snapped, teeth of
 * the lost slab standing out and bars bent down out of them. Then a column's stump with its broken head, and the slab it
 * held, fallen at its foot leaning on its low edge, broken along the same teeth.
 */
export const RUIN_BREAKS = {
  // A pale nose standing 0.2 m out with a bevel to the sky, over a charcoal undercut on the slab's lower edge.
  zendwhole: centred(shaped("zendwhole"), { boxes: [{ at: [0, -0.125, 0.1], half: [4, 0.125, 0.1] }] }, {
    hulls: [{ corners: prism(-4, 4, [[-0.25, 0], [-0.25, 0.2], [-0.05, 0.2], [0, 0.15], [0, 0]]) }],
    boxes: [{ at: [0, -0.325, 0.015], half: [4, 0.075, 0.015], color: DARK }],
  }),
  // Its broken face stands 6 cm off the slab's edge and its aggregate 4 cm off that, so neither fights the edge for depth.
  zendspall: centred(shaped("zendspall"), { boxes: [{ at: [0, -0.2, 0.03], half: [4, 0.2, 0.03] }] }, {
    boxes: [[-3.1, 1.4, -0.22, 0.14], [-0.2, 1.1, -0.27, 0.11], [2.4, 1.6, -0.18, 0.16]].map(([x, w, y, h]): ShapeBox => ({ at: [x!, y!, 0.08], half: [w! / 2, h!, 0.02], color: POCKET })),
    hulls: [{ corners: prism(-4, 4, [[-0.4, 0], [-0.4, 0.06], [0, 0.06], [0, 0]]) }],
  }),
  zendsnap: centred(shaped("zendsnap"), { boxes: [{ at: [0, -0.2, 0.15], half: [4, 0.2, 0.15] }] }, {
    hulls: slabTeeth([[-4, -2.7, 0.55, -0.15], [-2.7, -0.9, 0.25, -0.3], [-0.9, 1.4, 0.85, -0.1], [1.4, 4, 0.4, -0.25]]),
    boxes: bars([[-3.3, -0.08, 0.9, 0], [-1.8, -0.32, 0.5, 0.55], [0.1, -0.08, 1.15, 0.35], [2.6, -0.32, 0.6, 0.7]]),
  }),
  zstub: centred(shaped("zstub"), { boxes: [{ at: [0, 1.3, 0], half: [0.4, 1.3, 0.4] }], hulls: headTeeth() }, {
    boxes: [{ at: [0, 1.3, 0], half: [0.4, 1.3, 0.4], color: 100 }, { at: [-0.28, 3.05, 0.28], half: [0.025, 0.45, 0.025], color: RUST }, { at: [0.28, 3.15, -0.28], half: [0.025, 0.55, 0.025], color: RUST }, { at: [0.28, 3.68, -0.05], half: [0.025, 0.025, 0.25], color: RUST }],
    hulls: headTeeth(),
  }),
  zfallen: centred(shaped("zfallen"), { hulls: [leaning([1.6, 0.15, 2], FALL)] }, {
    hulls: [leaning([1.6, 0.15, 2], FALL), ...BREAK.map(([a, b, out]) => ({ corners: ([[a * 4, -0.15, 2], [b * 4, -0.15, 2], [a * 4, 0.15, 2], [b * 4, 0.15, 2], [(a + b) * 2, -0.05, 2 + out], [(a + b) * 2, 0.05, 2 + out]] as const).map(lean(FALL)) }))],
    boxes: bars([[-1.1, 0, 0.7, 0], [0.2, 0.05, 0.5, 0.3], [1.2, -0.05, 0.85, 0]]).map((b) => { const [x, y, z] = lean(FALL)([b.at[0], b.at[1], b.at[2] + 2]); return { ...b, at: [x, y, z] as const }; }),
  }),
  // A slab's end bent down into the gap, 2.2 m out and 0.8 m down at its nose, bars bared at its end.
  zendsag: centred(shaped("zendsag"), { hulls: [{ corners: prism(-4, 4, [[0, 0], [-0.4, 0], [-1.15, 2.1], [-0.78, 2.2]]) }] }, {
    hulls: [{ corners: prism(-4, 4, [[0, 0], [-0.4, 0], [-1.15, 2.1], [-0.78, 2.2]]) }],
    boxes: bars([[-2.5, -0.95, 0.35, 0.4], [-0.4, -0.95, 0.25, 0], [1.8, -0.95, 0.4, 0.55]]).map((b) => ({ ...b, at: [b.at[0], b.at[1], b.at[2] + 2.15] as const })),
  }),
  // The rubble at the foot of a failure, 8 m along the wall it fell from, up to 1.5 m high against it and 2.8 m out.
  // A broad piece of the wall leans on it, its top against the wall 2.4 m up and its foot on the ground 1.8 m out.
  zwedge: skirt("zwedge", [[-3.9, -0.2, 1.3, 2.6], [-0.6, 3.9, 1.5, 2.8]], [[-2.8, 1.9, 0.3, 101], [-0.2, 1.5, 0.22, 99], [0.9, 2.3, 0.35, 102], [2.9, 2.1, 0.25, 101]], 2.75, [{ corners: leaning([1.7, 0.14, 1.4], -58).corners.map(([x, y, z]) => [x - 1.6, y + 1.3, z + 1.05] as const) }]),
  // What fell from a standing wall along its foot, two runs of it.
  zskirt1: skirt("zskirt1", [[-3.7, -0.4, 0.5, 1.0], [-0.8, 3.6, 0.38, 1.1]], [[-2.6, 0.75, 0.2, 101], [1.6, 0.95, 0.24, 99], [-0.4, 0.7, 0.16, 102]], 1.15),
  zskirt2: skirt("zskirt2", [[-3.8, 0.2, 0.36, 0.95], [-0.2, 3.8, 0.55, 1.15]], [[-2.2, 0.8, 0.18, 99], [0.4, 1.0, 0.22, 101], [2.6, 0.7, 0.15, 102]], 1.2),
  // A slab-edge cornice round a whole tall building's roof, two corbelled steps standing 1.1 m out from its wall line.
  zcornice: centred(shaped("zcornice"), { boxes: [{ at: [0, -0.275, 0.675], half: [4, 0.275, 0.425] }] }, { boxes: [{ at: [0, -0.15, 0.675], half: [4, 0.15, 0.425] }, { at: [0, -0.425, 0.5], half: [4, 0.125, 0.25] }] }),
  zcrown1: crown("zcrown1", CROWNS[0]!), zcrown2: crown("zcrown2", CROWNS[1]!), zcrown3: crown("zcrown3", CROWNS[2]!), zcrown4: crown("zcrown4", CROWNS[3]!), zcrown5: crown("zcrown5", CROWNS[4]!), zcrown6: crown("zcrown6", CROWNS[5]!),
  // A floor slab torn from a tower's top, hanging from its edge over the gap, bars at the hinge.
  zdrape: centred(shaped("zdrape"), { hulls: [{ corners: DRAPE }] }, { hulls: [{ corners: DRAPE }], boxes: bars([[-3.4, -0.2, 0.5, 0.6], [-0.6, -0.15, 0.35, 0], [1.7, -0.25, 0.6, 0.8], [3.6, -0.2, 0.4, 0.3]]) }),
  zhang: centred(shaped("zhang"), { hulls: [{ corners: hanging() }] }, { hulls: [{ corners: hanging() }], boxes: [{ at: [-1.45, -0.3, 0.45], half: [0.04, 0.2, 0.04], color: RUST }] }),
  zleancol: centred(shaped("zleancol"), { hulls: [{ corners: LEAN_COLUMN }] }, { hulls: [{ corners: LEAN_COLUMN }], boxes: [{ at: [-0.18, 3.25, 0.55], half: [0.025, 0.3, 0.025], color: RUST }, { at: [0.15, 3.0, 0.3], half: [0.025, 0.25, 0.025], color: RUST }] }),
  // Moss and weeds along a ledge's top, 8 m of it in runs and clumps.
  zmoss: centred(shaped("zmoss"), { boxes: [{ at: [0, 0.07, 0], half: [3.9, 0.07, 0.28] }] }, { boxes: ([[-3.9, -2.6, 0.05, MOSS], [-2.3, -1.9, 0.12, WEED], [-1.2, 0.7, 0.04, MOSS], [0.9, 1.3, 0.1, LEAF], [1.8, 3.3, 0.06, MOSS], [3.4, 3.9, 0.14, WEED]] as const).map(([a, b, h, c]): ShapeBox => ({ at: [(a + b) / 2, h / 2, 0], half: [(b - a) / 2, h / 2, 0.14 + h], color: c })) }),
  zvine: centred(shaped("zvine"), { boxes: [{ at: [0, -0.05, 0.03], half: [0.05, 0.05, 0.03] }] }, { boxes: vine(STRANDS[0]!) }),
  zvine2: centred(shaped("zvine2"), { boxes: [{ at: [0, -0.05, 0.03], half: [0.05, 0.05, 0.03] }] }, { boxes: vine(STRANDS[1]!) }),
  zvine3: centred(shaped("zvine3"), { boxes: [{ at: [0, -0.05, 0.03], half: [0.05, 0.05, 0.03] }] }, { boxes: vine(STRANDS[2]!) }),
  ...street(),
} satisfies Record<string, ShapeDef>;
export type BreakPiece = keyof typeof RUIN_BREAKS;
const slopeSizes = Object.fromEntries(Object.entries({ ...RUIN_SLOPES, ...RUIN_FACADES, ...RUIN_BREAKS }).map(([name, shape]) => {
  const [x, y, z] = shapeHalf(shape.boxes, shape.hulls, shape.look); return [name, [x * 2, y * 2, z * 2] as const];
})) as Record<keyof typeof RUIN_SLOPES | FacadeModule | BreakPiece, readonly [number, number, number]>;

// Dimensions are full metres. Plants reuse the game's meshes; shaped entries use their convex parts, the rest are boxes.
export const RUIN_SHAPES = {
  ...slopeSizes,
  zshrub: [2.2, 1.24, 1.22], zrooftree: [.8, 3.4, .8],
  // Ivy hanging from a broken edge, the plants' leafy vines (assets/source/core/nodes/plants/vine.py), drawn about their box's middle.
  zivy1: [3.2, 2.7, 0.5], zivy2: [2.6, 1.7, 0.4], zivy3: [3.2, 4, 0.6],
  zbalcony: [8, .4, 2],
  zpanel8: [8, 4, .6], zpanel16: [16, 4, .6], zshaft8: [8, 16, .8], zshaft16: [16, 16, .8],
  // A blank end wall's top storey and its parapet, four such storeys, and a parapet by itself.
  zpaneltop: [8, 4.95, .6], zshafttop: [8, 16.95, .8], zparapet8: [8, .95, .5],
  zpartition: [6, 2.8, .3], zdoorpost: [2, 2.8, .3], zheader: [8, 1, .3],
  zroof8: [8, 1, 6], zroof16: [16, 1, 6], zcore: [4, 4, 4],
  zcover: [3, 1.1, 1], zcounter: [4, 1, .8], zbed: [2, .5, 1.4],
  zcar: [4.5, 1, 1.9], zcab: [2.1, .8, 1.7], zbus: [10, 2, 2.5],
  zsign: [2, 1, .25], zpole: [.25, 6, .25], zwreck: [6, .35, 3],
  // A solid for structures mapped in three dimensions, such as a bridge's towers.
  zmass8: [8, 8, 8],
  floor4: [4, 0.4, 4], floor8: [8, 0.4, 8], floor16: [16, 0.4, 16],
  beam4: [4, 0.6, 0.5], beam8: [8, 0.6, 0.5], beam16: [16, 0.8, 0.6],
  pier4: [0.7, 4, 0.7], pier8: [0.9, 8, 0.9], pier16: [1.2, 16, 1.2],
  wall4: [4, 2.8, 0.5], wall8: [8, 2.8, 0.5], sill4: [4, 0.9, 0.5], sill8: [8, 0.9, 0.5],
  fin4: [0.6, 4, 1.2], fin8: [0.8, 8, 1.2], fin16: [1, 16, 1.2],
  trim4: [4, 0.3, 0.9], trim8: [8, 0.3, 0.9],
  step: [2, 0.4, 0.5], landing: [8, 0.4, 1.5],
  rubble: [2, 0.7, 1.5], rubble4: [4, 1.1, 2.5],
  container: [12, 2.6, 2.5], tank: [4, 4, 1],
  seat: [8, 0.4, 1], plinth: [8, 1, 8], crown: [4, 4, 4],
} as const;

// Each finish's soffit, the colour its faces looking down are drawn in, is a darker one of its own. `fracture` is a break's
// bared core and is no building's finish.
export const RUIN_FINISHES = {
  concrete: { color: 100, under: 97, material: "core:mat_stone", hp: 16000 },
  limestone: { color: 10, under: 101, material: "core:mat_stone", hp: 12000 },
  rose: { color: 81, under: 111, material: "core:mat_stone", hp: 10000 },
  mint: { color: 75, under: 142, material: "core:mat_stone", hp: 10000 },
  clay: { color: 183, under: 111, material: "core:mat_stone", hp: 9000 },
  steel: { color: 89, under: 87, material: "core:mat_metal", hp: 20000 },
  rust: { color: 179, under: 178, material: "core:mat_metal", hp: 8000 },
  blue: { color: 5, under: 87, material: "core:mat_metal", hp: 9000 },
  fracture: { color: 102, under: 97, material: "core:mat_stone", hp: 12000 },
} as const;

export type RuinShape = keyof typeof RUIN_SHAPES;
export type RuinFinish = keyof typeof RUIN_FINISHES;
// New road pieces sort after all existing definitions, including ztype, preserving every prior numeric index.
export const ruinKind = (shape: RuinShape, finish: RuinFinish = "concrete"): string => `core:${shape.startsWith("floorroad") ? "zzruin" : "zruin"}_${shape}_${finish}`;

// Keep structural meshes shared across districts. Only the facade and salvage pieces vary in finish.
const PAINTED = new Set<RuinShape>(["wall4", "wall8", "sill4", "sill8", "fin4", "fin8", "fin16", "trim4", "trim8", "container", "crown"]);
const ONLY_FINISHES: Partial<Record<RuinShape, readonly RuinFinish[]>> = {
  zpitch4: ["clay"], zpitch8: ["clay", "rust"], zpitch16: ["clay"], zdeckramp: ["concrete"],
  zwedge: ["concrete"], zskirt1: ["concrete"], zskirt2: ["concrete"], zendsag: ["fracture"], zdrape: ["concrete"], zleancol: ["concrete"], zmoss: ["concrete"], zvine: ["concrete"], zvine2: ["concrete"], zvine3: ["concrete"], zpipe4: ["concrete"], zpipefoot: ["concrete"], zpipetop: ["concrete"], zwalk8: ["concrete"], zwalk8g: ["concrete"], zcurbramp: ["concrete"], zcurbrampl: ["concrete"], zdrain: ["concrete"], zutility: ["concrete"], zendwhole: ["fracture"], zendspall: ["fracture"], zendsnap: ["fracture"], zstub: ["fracture"], zfallen: ["concrete"],
};
/** Whether a shape comes in that finish: a pitched roof in its own few; otherwise concrete always, the facade pieces and the z kit in every finish. */
/** The plants' meshes the ruins grow: a tuft on a roof, a tree in it, ivy from a broken edge. */
const GROWN: Partial<Record<string, string>> = { zshrub: "core:creeper_3", zrooftree: "core:tree_1", zivy1: "core:vine_1", zivy2: "core:vine_2", zivy3: "core:vine_3" };
/**
 * Grown pieces whose plant's mesh has its foot at its origin, as a node's on the ground has: set down at the foot, on what
 * they grow from, their box standing on it as a shape's, which the mesh is drawn at the origin of.
 */
export const FOOTED = new Set<string>(["zshrub", "zrooftree"]);
/** The height of the middle of a piece of `name` set down at `y`. */
export const pieceMiddle = (name: string, y: number): number => (FOOTED.has(name) ? y + RUIN_SHAPES[name as RuinShape][1] / 2 : y);
const FOOTED_SHAPES = new Map([...FOOTED].map((name): [string, ShapeDef] => {
  const [w, h, d] = RUIN_SHAPES[name as RuinShape];
  return [name, { type: "shape", id: shaped(name), role: "thing", boxes: [{ at: [0, h / 2, 0], half: [w / 2, h / 2, d / 2] }] }];
}));
export const finished = (name: RuinShape, finish: RuinFinish): boolean => ONLY_FINISHES[name]?.includes(finish) ?? (finish === "concrete" || (finish !== "fracture" && !GROWN[name] && (PAINTED.has(name) || name.startsWith("z"))));
const NEAR_ONLY = new Set<string>(["zwalk8", "zwalk8g", "zcurbramp", "zcurbrampl", "zdrain", "zutility", "zskirt1", "zskirt2", "zvine", "zvine2", "zvine3", "zpipe4", "zpipefoot", "zpipetop", "zleancol", "zshrub", "zivy1", "zivy2", "zivy3", "zmoss"]);
const BLOCKS: readonly StructureDef[] = Object.entries(RUIN_SHAPES).flatMap(([name, size]) =>
  (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((finish) => finished(name as RuinShape, finish)).map((finish) => ({
    type: "structure", class: "static", id: ruinKind(name as RuinShape, finish), mesh: GROWN[name] ?? "box",
    half: [size[0] / 2, size[1] / 2, size[2] / 2] as const,
    ...RUIN_FINISHES[finish],
    ...(name === "zwalk8" || name === "zwalk8g" ? { grindLine: [[-4, .075, -BREAK_AT[name]![2]!], [4, .075, -BREAK_AT[name]![2]!]] as const } : {}),
    ...(name in RUIN_SLOPES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_SLOPES[name as keyof typeof RUIN_SLOPES], RUIN_FINISHES[finish]) : {}),
    ...(name in RUIN_FACADES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_FACADES[name as FacadeModule], RUIN_FINISHES[finish]) : {}),
    ...(name in RUIN_BREAKS ? staticOf(ruinKind(name as RuinShape, finish), RUIN_BREAKS[name as BreakPiece], RUIN_FINISHES[finish]) : {}),
    // The street's pieces and a building's small kit are drawn near only, left out of the far city's lattice and mass.
    ...(NEAR_ONLY.has(name) ? { near: true as const } : {}),
    ...(FOOTED_SHAPES.has(name) ? { shape: FOOTED_SHAPES.get(name)!.id, half: shapeHalf(FOOTED_SHAPES.get(name)!.boxes) } : {}),
    // Far-feed colours average every static sharing a palette entry. Keep foliage separate from built wood.
    ...(GROWN[name] ? { color: 196, material: "core:mat_wood", hp: 500 } : {}),
  })),
);
export const RUIN_BLOCKS: readonly Def[] = [...BLOCKS, ...Object.values(RUIN_SLOPES), ...Object.values(RUIN_FACADES), ...Object.values(RUIN_BREAKS), ...FOOTED_SHAPES.values()];
