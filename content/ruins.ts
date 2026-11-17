import { shapeHalf, type Def, type StructureDef } from "../shared/content/defs.ts";
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
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`ramp${i + 1}`, slopeShape(shaped(`ramp${i + 1}`), "stairs", [slopedSlab(2, 4, (i + 1) / 4, .4)])])) as Record<`ramp${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`, ReturnType<typeof slopeShape>>,
  ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`floorroad${i + 1}`, slopeShape(shaped(`floorroad${i + 1}`), "ceiling", [slopedSlab(4, 4, (i + 1) / 8, .4)])])) as Record<`floorroad${1 | 2 | 3 | 4}`, ReturnType<typeof slopeShape>>,
};
const slopeSizes = Object.fromEntries(Object.entries(RUIN_SLOPES).map(([name, shape]) => {
  const [x, y, z] = shapeHalf(shape.boxes, shape.hulls, shape.look); return [name, [x * 2, y * 2, z * 2] as const];
})) as Record<keyof typeof RUIN_SLOPES, readonly [number, number, number]>;

// Dimensions are full metres. Plants reuse the game's meshes; shaped entries use their convex parts, the rest are boxes.
export const RUIN_SHAPES = {
  ...slopeSizes,
  zshrub: [2.2, 1.24, 1.22], zrooftree: [.8, 3.4, .8],
  zbalcony: [8, .4, 2],
  zpanel8: [8, 4, .6], zpanel16: [16, 4, .6], zshaft8: [8, 16, .8], zshaft16: [16, 16, .8],
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
const ROOF_FINISHES: Partial<Record<RuinShape, readonly RuinFinish[]>> = { zpitch4: ["clay"], zpitch8: ["clay", "rust"], zpitch16: ["clay"] };
/** Whether a shape comes in that finish: a pitched roof in its own few; otherwise concrete always, the facade pieces and the z kit in every finish. */
export const finished = (name: RuinShape, finish: RuinFinish): boolean => ROOF_FINISHES[name]?.includes(finish) ?? (finish === "concrete" || (name !== "zshrub" && name !== "zrooftree" && (PAINTED.has(name) || name.startsWith("z"))));
const BLOCKS: readonly StructureDef[] = Object.entries(RUIN_SHAPES).flatMap(([name, size]) =>
  (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((finish) => finished(name as RuinShape, finish)).map((finish) => ({
    type: "structure", class: "static", id: ruinKind(name as RuinShape, finish), mesh: name === "zshrub" ? "core:creeper_3" : name === "zrooftree" ? "core:tree_1" : "box",
    half: [size[0] / 2, size[1] / 2, size[2] / 2] as const,
    ...RUIN_FINISHES[finish],
    ...(name in RUIN_SLOPES ? staticOf(ruinKind(name as RuinShape, finish), RUIN_SLOPES[name as keyof typeof RUIN_SLOPES], RUIN_FINISHES[finish]) : {}),
    // Far-feed colours average every static sharing a palette entry. Keep foliage separate from built wood.
    ...(name === "zshrub" || name === "zrooftree" ? { color: 196, material: "core:mat_wood", hp: 500 } : {}),
  })),
);
export const RUIN_BLOCKS: readonly Def[] = [...BLOCKS, ...Object.values(RUIN_SLOPES)];
