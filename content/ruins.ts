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
const up = (y: number, parts: readonly Part[]): Part[] => parts.map(([a, b, c, d, e, f, g]) => [a, b, c + y, d + y, e, f, g]);
const wall = (top: number, out = 0.25): Part => [-4, 4, 0, top, -0.25, out];
/**
 * Two flats' balconies across the bay, 2 m deep behind a solid front, a divider between them; behind, a coral wall with a
 * door and a window to each flat, jambs at the columns and a band from the head down to the slab above.
 */
const BALCONY: Part[] = [
  [-4, 4, -0.25, 0, 0, 2], [-4, 4, 0, 1.05, 1.82, 2], [-0.1, 0.1, 0, 2.7, 0.25, 1.82], [-4, 4, 2.7, 4, -0.25, 0.25],
  [-4, -3.6, 0, 2.7, -0.25, 0.25], [3.6, 4, 0, 2.7, -0.25, 0.25], [-3.6, 3.6, 0, 2.7, -0.35, -0.25, CORAL],
  ...[-2, 2].flatMap((c): Part[] => [[c - 1.5, c - 0.6, 0, 2.2, -0.25, -0.2, DARK], [c, c + 1.4, 0.9, 2.3, -0.25, -0.2, DARK]]),
];
const BALCONY_WALKED: Part[] = [[-4, 4, -0.25, 0, 0, 2], [-4, 4, 0, 1.05, 1.82, 2], wall(4)];
/** The top flats' balconies roofed, and a guard standing above the roof at the roof's edge. */
const BALCONY_CAP: Part[] = [[-4, 4, 3.6, 4, 0.25, 2], [-4, 4, 4, 4.8, 1.82, 2]];
/** A window to each 4 m room, sills standing out, a band from the head down to the slab above. */
const WINDOWS: Part[] = [[-4, 4, 0, 1, -0.25, 0.25], [-4, 4, 3, 4, -0.25, 0.25], [-4, -2.6, 1, 3, -0.25, 0.25], [-1.2, 1.2, 1, 3, -0.25, 0.25], [2.6, 4, 1, 3, -0.25, 0.25], [-2.6, -1.2, 1, 3, -0.3, -0.15, DARK], [1.2, 2.6, 1, 3, -0.3, -0.15, DARK], [-2.75, -1.05, 0.88, 1, 0.25, 0.42], [1.05, 2.75, 0.88, 1, 0.25, 0.42]];
/** A parapet over the roof's edge and its coping. */
const PARAPET: Part[] = [[-4, 4, 4, 4.8, -0.25, 0.25], [-4, 4, 4.8, 4.95, -0.3, 0.35]];
/** Spandrel over the slab's edge, a pane a storey and mullions at 2 m. */
const CURTAIN: Part[] = [[-4, 4, -0.4, 1, -0.15, 0.25], [-4, 4, 1, 3.6, -0.2, -0.05, PANE], ...[-4, -2, 0, 2, 4].map((x): Part => [Math.max(-4, x - 0.05), Math.min(4, x + 0.05), 1, 3.6, -0.05, 0.15, METAL])];
const CROWN: Part[] = [[-4, 4, 3.6, 5.2, -0.15, 0.25]];
/** A shop's front: half piers, a sign band standing proud of them, a dark display on a low riser and a 2 m door set back. */
const SHOP: Part[] = [[-4, -3.6, 0, 4, -0.3, 0.3], [3.6, 4, 0, 4, -0.3, 0.3], [-3.6, 3.6, 2.9, 3.8, -0.25, 0.4, SIGN], [-3.6, 3.6, 3.8, 4, -0.25, 0.25], [-3.6, 1.4, 0, 0.5, -0.25, 0.05], [-3.6, 1.4, 0.5, 2.9, -0.25, -0.15, DARK], [1.4, 1.6, 0, 2.9, -1.2, 0.05]];
const SHOP_WALKED: Part[] = [[-4, -3.6, 0, 4, -0.3, 0.3], [3.6, 4, 0, 4, -0.3, 0.3], [-3.6, 3.6, 2.9, 4, -0.25, 0.4], [-3.6, 1.6, 0, 2.9, -0.25, 0.05]];
/** The same front with a blue-grey shutter down over display and door. */
const SHUTTER: Part[] = [[-4, -3.6, 0, 4, -0.3, 0.3], [3.6, 4, 0, 4, -0.3, 0.3], [-3.6, 3.6, 2.9, 3.8, -0.25, 0.4, SIGN], [-3.6, 3.6, 3.8, 4, -0.25, 0.25], [-3.6, 3.6, 0, 2.9, 0, 0.1, STEEL]];
/** A garage's open deck: columns at the bay's ends and a weathered spandrel over the slab's edge. */
const DECK: Part[] = [[-4, -3.65, 0, 3.6, -0.35, 0.35], [3.65, 4, 0, 3.6, -0.35, 0.35], [-3.65, 3.65, -0.4, 1.05, 0, 0.25, SPANDREL]];
/** The deck above's edge beam, a lip under its slab. */
const DECK_LIP: Part = [-3.65, 3.65, 3.4, 3.6, -0.1, 0.25];
const DECK_CAP: Part[] = [[-4, 4, 3.6, 4.6, -0.1, 0.25, SPANDREL], [-0.08, 0.08, 4.6, 9.4, 0.05, 0.2, STEEL], [-0.7, 0.1, 9.25, 9.45, 0.05, 0.4, STEEL]];
const MODULES = {
  zbalc: { look: BALCONY, walked: BALCONY_WALKED },
  zbalctop: { look: [...BALCONY, ...BALCONY_CAP], walked: [...BALCONY_WALKED, ...BALCONY_CAP] },
  zbalc4: { look: [0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), walked: [[-4, 4, -0.25, 16, -0.25, 0.25], ...[0, 4, 8, 12].flatMap((y) => up(y, BALCONY_WALKED.slice(0, 2)))] },
  zbalc4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), ...up(12, BALCONY_CAP)], walked: [[-4, 4, -0.25, 16, -0.25, 0.25], ...[0, 4, 8, 12].flatMap((y) => up(y, BALCONY_WALKED.slice(0, 2))), ...up(12, BALCONY_CAP)] },
  /** A ground floor of flats: a solid darker base, a high window, the head band in the building's finish. */
  zlobby: { look: [[-4, 4, 0, 2.3, -0.25, 0.25, BASE], [-4, -3.4, 2.3, 3.1, -0.25, 0.25, BASE], [3.4, 4, 2.3, 3.1, -0.25, 0.25, BASE], [-3.4, 3.4, 2.3, 3.1, -0.3, -0.2, DARK], [-4, 4, 3.1, 4, -0.25, 0.25]], walked: [wall(4)] },
  zstore: { look: SHOP, walked: SHOP_WALKED },
  zshutter: { look: SHUTTER, walked: [...SHOP_WALKED.slice(0, 2), [-3.6, 3.6, 2.9, 4, -0.25, 0.3], [-3.6, 3.6, 0, 2.9, 0, 0.1]] },
  zwin: { look: WINDOWS, walked: [wall(4)] },
  zwintop: { look: [...WINDOWS, ...PARAPET], walked: [wall(4), ...PARAPET] },
  zwin4: { look: [0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), walked: [[-4, 4, 0, 16, -0.4, 0.4]] },
  zwin4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), ...up(12, PARAPET)], walked: [[-4, 4, 0, 16, -0.4, 0.4], ...up(12, PARAPET)] },
  zcurt: { look: CURTAIN, walked: [[-4, 4, -0.4, 3.6, -0.2, 0.25]] },
  zcurttop: { look: [...CURTAIN, ...CROWN], walked: [[-4, 4, -0.4, 5.2, -0.2, 0.25]] },
  zcurt4: { look: [0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), walked: [[-4, 4, -0.4, 15.6, -0.4, 0.4]] },
  zcurt4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), ...up(12, CROWN)], walked: [[-4, 4, -0.4, 17.2, -0.4, 0.4]] },
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
  const shape: ShapeDef = { type: "shape", id: shaped(name), role: "wall", boxes: m.walked.map((p) => boxOf([p[0], p[1], p[2], p[3], p[4], p[5]], at)), look: { boxes: m.look.map((p) => boxOf(p, at)) } };
  return [name, shape];
})) as Record<FacadeModule, ShapeDef>;
type Corner = readonly [number, number, number];
const RUST = 179, AGGREGATE = 15;
/** A prism along x from x0 to x1 of the profile `yz`, corners round it in (y, z). */
const prism = (x0: number, x1: number, yz: readonly (readonly [number, number])[]): Corner[] => [x0, x1].flatMap((x) => yz.map(([y, z]): Corner => [x, y, z]));
/** Teeth of a break across a width: each its from and to along x and how far its point stands out, with its point's height. */
type Tooth = readonly [number, number, number, number];
/** A slab's end broken off along x at z = 0, its top at y = 0: teeth of the slab's thickness standing out into the gap. */
const slabTeeth = (teeth: readonly Tooth[]): HullDef[] => teeth.map(([a, b, out, y]) => ({ corners: [[a, -0.4, 0], [a, 0, 0], [b, -0.4, 0], [b, 0, 0], [(a + b) / 2, y - 0.12, out], [(a + b) / 2, y + 0.04, out]] }));
/** Bent bars out of a break: each its place along x, its height, how far it runs out, and how far it then hangs down. */
const bars = (list: readonly (readonly [number, number, number, number])[]): ShapeBox[] => list.flatMap(([x, y, out, drop]): ShapeBox[] => [
  { at: [x, y, out / 2], half: [0.025, 0.025, out / 2], color: RUST },
  ...(drop > 0 ? [{ at: [x, y - drop / 2, out] as const, half: [0.025, drop / 2, 0.025] as const, color: RUST }] : []),
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
  zendwhole: centred(shaped("zendwhole"), { boxes: [{ at: [0, -0.2, 0.03], half: [4, 0.2, 0.03] }] }, { hulls: [{ corners: prism(-4, 4, [[-0.4, 0], [-0.4, 0.07], [-0.05, 0.07], [0, 0.02], [0, 0]]) }] }),
  zendspall: centred(shaped("zendspall"), { boxes: [{ at: [0, -0.2, 0.015], half: [4, 0.2, 0.015] }] }, {
    boxes: [[-3.1, 1.4, -0.22, 0.14], [-0.2, 1.1, -0.27, 0.11], [2.4, 1.6, -0.18, 0.16]].map(([x, w, y, h]): ShapeBox => ({ at: [x!, y!, 0.015], half: [w! / 2, h!, 0.015], color: AGGREGATE })),
    hulls: [{ corners: prism(-4, 4, [[-0.4, 0], [-0.4, 0.01], [0, 0.01], [0, 0]]) }],
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
} satisfies Record<string, ShapeDef>;
export type BreakPiece = keyof typeof RUIN_BREAKS;
const slopeSizes = Object.fromEntries(Object.entries({ ...RUIN_SLOPES, ...RUIN_FACADES, ...RUIN_BREAKS }).map(([name, shape]) => {
  const [x, y, z] = shapeHalf(shape.boxes, shape.hulls, shape.look); return [name, [x * 2, y * 2, z * 2] as const];
})) as Record<keyof typeof RUIN_SLOPES | FacadeModule | BreakPiece, readonly [number, number, number]>;

// Dimensions are full metres. Plants reuse the game's meshes; shaped entries use their convex parts, the rest are boxes.
export const RUIN_SHAPES = {
  ...slopeSizes,
  zshrub: [2.2, 1.24, 1.22], zrooftree: [.8, 3.4, .8],
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
  clay: { color: 183, under: 181, material: "core:mat_stone", hp: 9000 },
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
  zendwhole: ["concrete"], zendspall: ["fracture"], zendsnap: ["fracture"], zstub: ["fracture"], zfallen: ["concrete"],
};
/** Whether a shape comes in that finish: a pitched roof in its own few; otherwise concrete always, the facade pieces and the z kit in every finish. */
export const finished = (name: RuinShape, finish: RuinFinish): boolean => ONLY_FINISHES[name]?.includes(finish) ?? (finish === "concrete" || (finish !== "fracture" && name !== "zshrub" && name !== "zrooftree" && (PAINTED.has(name) || name.startsWith("z"))));
const BLOCKS: readonly StructureDef[] = Object.entries(RUIN_SHAPES).flatMap(([name, size]) =>
  (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((finish) => finished(name as RuinShape, finish)).map((finish) => ({
    type: "structure", class: "static", id: ruinKind(name as RuinShape, finish), mesh: name === "zshrub" ? "core:creeper_3" : name === "zrooftree" ? "core:tree_1" : "box",
    half: [size[0] / 2, size[1] / 2, size[2] / 2] as const,
    ...RUIN_FINISHES[finish],
    ...(name in RUIN_SLOPES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_SLOPES[name as keyof typeof RUIN_SLOPES], RUIN_FINISHES[finish]) : {}),
    ...(name in RUIN_FACADES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_FACADES[name as FacadeModule], RUIN_FINISHES[finish]) : {}),
    ...(name in RUIN_BREAKS ? staticOf(ruinKind(name as RuinShape, finish), RUIN_BREAKS[name as BreakPiece], RUIN_FINISHES[finish]) : {}),
    // Far-feed colours average every static sharing a palette entry. Keep foliage separate from built wood.
    ...(name === "zshrub" || name === "zrooftree" ? { color: 196, material: "core:mat_wood", hp: 500 } : {}),
  })),
);
export const RUIN_BLOCKS: readonly Def[] = [...BLOCKS, ...Object.values(RUIN_SLOPES), ...Object.values(RUIN_FACADES), ...Object.values(RUIN_BREAKS)];
