import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const sizes = ["xs", "s", "m", "l", "xl"];
const shell: MaterialSpec = {
  base: "tex/shell_base.png",
  normal: "tex/shell_normal.png",
  packed: "tex/shell_packed.png",
  height: "tex/shell_height.png",
  tiles: 0.22,
  tops: { base: 128 },
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: sizes.map(size => ({
    id: `core:egg_${size}`, object: `egg_${size}`,
    icon: { around: 0.73, above: 0.52 },
  })),
  materials: {
    shell: { ...shell, regions: { mask: "tex/shell_mask.png", mask2: "tex/shell_mask2.png" } },
    shell_band: { ...shell, regions: { mask: "tex/shell_band_mask.png", mask2: "tex/shell_band_mask2.png" } },
  },
  budgets: { triangles: [1320, 640, 310, 150], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
