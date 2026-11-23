import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  modelCredit: "Innerscene · CC0 1.0",
  skeleton: { id: "core:skateboard", root: "deck", bones: 1 },
  zones: [], sockets: [], regions: [], clips: [], feet: [], gaits: {},
  materials: { deck: { base: "base.png", normal: "normal.png", packed: "mro.png", tops: { normal: 512, mro: 256 } } },
  flat: 3,
  budgets: { triangles: [10440, 5000, 2000, 700, 220], texture: { top: 1024, megabytes: 7 } },
} satisfies CreatureAsset;
