// The pictures the sky's dome draws: the moon's face and the two cloud layers, as the art director accepted them.

import type { SkyAsset } from "../../../../tools/art/spec.ts";

export default {
  kind: "sky",
  moon: "moon/moon.png",
  low: "clouds/low.png",
  high: "clouds/high.png",
} satisfies SkyAsset;
