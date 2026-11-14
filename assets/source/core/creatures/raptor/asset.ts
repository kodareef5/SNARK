import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { DINO, dinoClips } from "../dino.ts";

export default {
  kind: "creature",
  source: { raw: "quaternius/dinosaurs/Velociraptor.fbx" },
  scale: 0.28,
  ...DINO,
  regions: [
    { name: "back", material: "Brown", sample: 5 },
    { name: "belly", material: "LightBrown", sample: 15 },
    { name: "claws", material: "Black", sample: 11 },
  ],
  clips: dinoClips("Velociraptor"),
  // The walk has no stride: the model's action stands still from frame 37 on. `to: 36` on the clip would cut that off.
  gaits: { run: { stride: 3.18 } },
} satisfies CreatureAsset;
