import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  meat: { around: 0.32, above: 1.00, roll: 0.24 },
  meat_cooked: { around: 0.32, above: 1.00, roll: 0.24 },
  meat_prime: { around: 0.22, above: 1.13, roll: -0.18 },
  meat_prime_cooked: { around: 0.22, above: 1.13, roll: -0.18 },
  spoiled_meat: { around: -0.42, above: 0.95, roll: -0.17 },
  jerky: { around: 0.70, above: 1.12, roll: 0.35 },
  jerky_prime: { around: -0.27, above: 1.09, roll: -0.16 },
};

const steaks = ["meat", "meat_cooked", "meat_prime", "meat_prime_cooked"] as const;
const materials = Object.fromEntries(["spoiled", "dry", ...steaks].map((name) => [name, {
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_orm.png`,
  height: `tex/${name}_height.png`,
  ...(name === "spoiled" || name === "dry" ? { tiles: 0.18 } : {
    tops: { normal: 128, mro: 128 },
    flat: name.endsWith("_cooked") ? [112, 57, 36] as const : [157, 44, 47] as const,
  }),
} satisfies MaterialSpec]));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials,
  budgets: { triangles: [550, 180, 60], texture: { top: 256, megabytes: 2.25 } },
} satisfies PiecesAsset;
