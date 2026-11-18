import { shapeHalf, type Def, type ShapeBox, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { leaning, pitchedRoof, slopeShape, slopedSlab, stairFlight, staticOf, wedge } from "../shared/content/slopes.ts";

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
const DECK_CAP: Part[] = [[-4, 4, 3.6, 4.6, -0.1, 0.25, SPANDREL], [-0.08, 0.08, 4.6, 9.4, 0.05, 0.2, STEEL], [-0.7, 0.1, 9.25, 9.45, 0.05, 0.4, STEEL]];
const MODULES = {
  zbalc: { look: BALCONY, walked: BALCONY_WALKED },
  zbalctop: { look: [...BALCONY, ...BALCONY_CAP], walked: [...BALCONY_WALKED, ...BALCONY_CAP] },
  zbalc4: { look: [0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), walked: [[-4, 4, -0.25, 16, -0.4, 0.4]] },
  zbalc4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, BALCONY)), ...up(12, BALCONY_CAP)], walked: [[-4, 4, -0.25, 16, -0.4, 0.4], ...up(12, BALCONY_CAP)] },
  /** A ground floor of flats: a solid darker base, a high window, the head band in the building's finish. */
  zlobby: { look: [[-4, 4, 0, 2.3, -0.25, 0.25, BASE], [-4, -3.4, 2.3, 3.1, -0.25, 0.25, BASE], [3.4, 4, 2.3, 3.1, -0.25, 0.25, BASE], [-3.4, 3.4, 2.3, 3.1, -0.3, -0.2, DARK], [-4, 4, 3.1, 4, -0.25, 0.25]], walked: [wall(4)] },
  zstore: { look: SHOP, walked: SHOP_WALKED },
  zshutter: { look: SHUTTER, walked: [...SHOP_WALKED.slice(0, 3), [-3.6, 3.6, 0, 2.9, 0, 0.1]] },
  zwin: { look: WINDOWS, walked: [wall(4)] },
  zwintop: { look: [...WINDOWS, ...PARAPET], walked: [wall(4), ...PARAPET] },
  zwin4: { look: [0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), walked: [[-4, 4, 0, 16, -0.4, 0.4]] },
  zwin4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, WINDOWS)), ...up(12, PARAPET)], walked: [[-4, 4, 0, 16, -0.4, 0.4], ...up(12, PARAPET)] },
  zcurt: { look: CURTAIN, walked: [[-4, 4, -0.4, 3.6, -0.2, 0.25]] },
  zcurttop: { look: [...CURTAIN, ...CROWN], walked: [[-4, 4, -0.4, 5.2, -0.2, 0.25]] },
  zcurt4: { look: [0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), walked: [[-4, 4, -0.4, 15.6, -0.4, 0.4]] },
  zcurt4top: { look: [...[0, 4, 8, 12].flatMap((y) => up(y, CURTAIN)), ...up(12, CROWN)], walked: [[-4, 4, -0.4, 17.2, -0.4, 0.4]] },
  zdeck: { look: DECK, walked: DECK },
  zdecktop: { look: [...DECK, ...DECK_CAP], walked: [...DECK, DECK_CAP[0]!] },
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
const slopeSizes = Object.fromEntries(Object.entries({ ...RUIN_SLOPES, ...RUIN_FACADES }).map(([name, shape]) => {
  const [x, y, z] = shapeHalf(shape.boxes, shape.hulls, shape.look); return [name, [x * 2, y * 2, z * 2] as const];
})) as Record<keyof typeof RUIN_SLOPES | FacadeModule, readonly [number, number, number]>;

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

export const RUIN_FINISHES = {
  concrete: { color: 100, material: "core:mat_stone", hp: 16000 },
  limestone: { color: 10, material: "core:mat_stone", hp: 12000 },
  rose: { color: 81, material: "core:mat_stone", hp: 10000 },
  mint: { color: 75, material: "core:mat_stone", hp: 10000 },
  clay: { color: 183, material: "core:mat_stone", hp: 9000 },
  steel: { color: 89, material: "core:mat_metal", hp: 20000 },
  rust: { color: 179, material: "core:mat_metal", hp: 8000 },
  blue: { color: 5, material: "core:mat_metal", hp: 9000 },
} as const;

export type RuinShape = keyof typeof RUIN_SHAPES;
export type RuinFinish = keyof typeof RUIN_FINISHES;
// New road pieces sort after all existing definitions, including ztype, preserving every prior numeric index.
export const ruinKind = (shape: RuinShape, finish: RuinFinish = "concrete"): string => `core:${shape.startsWith("floorroad") ? "zzruin" : "zruin"}_${shape}_${finish}`;

// Keep structural meshes shared across districts. Only the facade and salvage pieces vary in finish.
const PAINTED = new Set<RuinShape>(["wall4", "wall8", "sill4", "sill8", "fin4", "fin8", "fin16", "trim4", "trim8", "container", "crown"]);
const ONLY_FINISHES: Partial<Record<RuinShape, readonly RuinFinish[]>> = {
  zpitch4: ["clay"], zpitch8: ["clay", "rust"], zpitch16: ["clay"], zdeckramp: ["concrete"],
};
/** Whether a shape comes in that finish: a pitched roof in its own few; otherwise concrete always, the facade pieces and the z kit in every finish. */
export const finished = (name: RuinShape, finish: RuinFinish): boolean => ONLY_FINISHES[name]?.includes(finish) ?? (finish === "concrete" || (name !== "zshrub" && name !== "zrooftree" && (PAINTED.has(name) || name.startsWith("z"))));
const BLOCKS: readonly StructureDef[] = Object.entries(RUIN_SHAPES).flatMap(([name, size]) =>
  (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((finish) => finished(name as RuinShape, finish)).map((finish) => ({
    type: "structure", class: "static", id: ruinKind(name as RuinShape, finish), mesh: name === "zshrub" ? "core:creeper_3" : name === "zrooftree" ? "core:tree_1" : "box",
    half: [size[0] / 2, size[1] / 2, size[2] / 2] as const,
    ...RUIN_FINISHES[finish],
    ...(name in RUIN_SLOPES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_SLOPES[name as keyof typeof RUIN_SLOPES], RUIN_FINISHES[finish]) : {}),
    ...(name in RUIN_FACADES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_FACADES[name as FacadeModule], RUIN_FINISHES[finish]) : {}),
    // Far-feed colours average every static sharing a palette entry. Keep foliage separate from built wood.
    ...(name === "zshrub" || name === "zrooftree" ? { color: 196, material: "core:mat_wood", hp: 500 } : {}),
  })),
);
export const RUIN_BLOCKS: readonly Def[] = [...BLOCKS, ...Object.values(RUIN_SLOPES), ...Object.values(RUIN_FACADES)];
