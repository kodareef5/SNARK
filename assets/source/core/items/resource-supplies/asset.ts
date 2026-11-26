import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const surfaces = [
  "mortar", "kraft", "board", "brass", "red", "rubber", "powder", "canvas",
  "tar", "enamel", "ivory", "spark", "gel", "shell", "paper", "strap",
] as const;

const materials = Object.fromEntries(surfaces.map((name) => [
  name, {
    base: `tex/${name}_base.png`,
    normal: `tex/${name}_normal.png`,
    packed: `tex/${name}_orm.png`,
    tiles: 0.22,
    ...(name === "gel" ? { emissive: 0.15 } : {}),
  } satisfies MaterialSpec,
]));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:paste/dropped", object: "paste", icon: { around: 0.36, above: 1.03, roll: -0.18 } },
    { id: "core:electronics/dropped", object: "electronics", icon: { around: 0.42, above: 1.24, roll: -0.20 } },
    { id: "core:gasoline/dropped", object: "gasoline", icon: { around: 0.38, above: 0.31, roll: 0.05 } },
    { id: "core:gunpowder/dropped", object: "gunpowder", icon: { around: 0.32, above: 0.50, roll: 0 } },
    { id: "core:oil/dropped", object: "oil", icon: { around: -0.22, above: 0.31, roll: 0.04 } },
    { id: "core:polymer/dropped", object: "polymer", icon: { around: 0.36, above: 0.83, roll: -0.24 } },
    { id: "core:sparkpowder/dropped", object: "sparkpowder", icon: { around: 0.52, above: 0.90, roll: 0.09 } },
    { id: "core:angler_gel/dropped", object: "angler_gel", icon: { around: -0.30, above: 0.58, roll: 0 } },
    { id: "core:freight_order/dropped", object: "freight_order", icon: { around: 0.18, above: 1.39, roll: 0.14 } },
  ],
  materials,
  budgets: { triangles: [650, 365, 160], texture: { top: 128, megabytes: 4 } },
} satisfies PiecesAsset;
