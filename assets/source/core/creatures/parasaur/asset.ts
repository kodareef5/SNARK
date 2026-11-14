import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { DINO, dinoClips } from "../dino.ts";

export default {
  kind: "creature",
  source: { raw: "quaternius/dinosaurs/Parasaurolophus.fbx" },
  scale: 0.6,
  ...DINO,
  regions: [
    { name: "back", material: "Green", sample: 9 },
    { name: "sides", material: "LightGreen", sample: 16 },
    { name: "belly", material: "LightYellow", sample: 13 },
    { name: "crest", material: "Red", sample: 8 },
  ],
  clips: dinoClips("Parasaurolophus"),
  gaits: {
    walk: { stride: 3.55, stated: "its feet speed up while they are down, so they slide a third of a metre at any stride; this is the stride they slide least at" },
    run: { stride: 6.83 },
  },
} satisfies CreatureAsset;
