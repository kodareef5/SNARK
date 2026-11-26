import { resolve } from "node:path";
import { shared, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import tools from "../stone-tools/asset.ts";

const TOOL_DIR = resolve(import.meta.dir, "../stone-tools");
const tiles = { stone: 0.21, crystal: 0.19, obsidian: 0.18, ore: 0.23, ingot: 0.24, silica_pearls: 0.18, charcoal: 0.19 };

const mineral = Object.fromEntries(Object.entries(tiles).map(([name, span]) => [name, {
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_orm.png`,
  height: `tex/${name}_height.png`,
  tiles: span,
}]));

const views = {
  stone: { around: 0.55, above: 0.65 },
  flint: { around: 0.46, above: 0.98 },
  crystal: { around: 0.48, above: 0.28 },
  obsidian: { around: 0.80, above: 0.52 },
  ore: { around: 0.60, above: 0.62 },
  ingot: { around: 0.52, above: 0.64 },
  silica_pearls: { around: 0.22, above: 0.94 },
  charcoal: { around: 0.70, above: 0.84 },
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([name, icon]) => ({
    id: `core:${name}/dropped`,
    object: name,
    icon,
  })),
  materials: {
    flint: shared(TOOL_DIR, "core:stone-tools/flint", tools.materials.flint),
    ...mineral,
  },
  // The existing flint set counts against this pack's budget.
  budgets: { triangles: [640, 340, 144], texture: { top: 1024, megabytes: 11 } },
} satisfies PiecesAsset;
