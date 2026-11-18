import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { DINO, dinoClips } from "../dino.ts";

export default {
  kind: "creature",
  source: { scripts: ["refit.py"] },
  scale: 0.28,
  ...DINO,
  regions: [
    { name: "back", sample: 5 },
    { name: "belly", sample: 15 },
    { name: "claws", sample: 11 },
  ],
  materials: {
    raptor_plumage: {
      base: "tex/base.png", normal: "tex/normal.png", packed: "tex/packed.png",
      regions: { mask: "tex/mask.png" },
    },
  },
  budgets: { triangles: [11000, 5800, 1800, 680, 240, 88], texture: { top: 2048, megabytes: 24 } },
  flat: 2,
  clips: dinoClips("Velociraptor"),
  gaits: { run: { stride: 3.18 } },
} satisfies CreatureAsset;
