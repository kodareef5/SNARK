import type { StructureDef } from "../shared/content/defs.ts";

// Dimensions are full metres. Every entry is a reusable collider and a generated box mesh.
export const RUIN_SHAPES = {
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
// Sorting after the existing core ids preserves their numeric registry indices.
export const ruinKind = (shape: RuinShape, finish: RuinFinish = "concrete"): string => `core:zruin_${shape}_${finish}`;

// Keep structural meshes shared across districts. Only the facade and salvage pieces vary in finish.
const PAINTED = new Set<RuinShape>(["wall4", "wall8", "sill4", "sill8", "fin4", "fin8", "fin16", "trim4", "trim8", "container", "crown"]);
export const RUIN_BLOCKS: readonly StructureDef[] = Object.entries(RUIN_SHAPES).flatMap(([name, size]) =>
  (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((finish) => finish === "concrete" || PAINTED.has(name as RuinShape)).map((finish) => ({
    type: "structure", class: "static", id: ruinKind(name as RuinShape, finish), mesh: "box",
    half: [size[0] / 2, size[1] / 2, size[2] / 2] as const,
    ...RUIN_FINISHES[finish],
  })),
);
