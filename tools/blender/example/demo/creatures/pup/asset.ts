// An example of a creature built by scripts. It is not in the game: `bun run art -- --source tools/blender/example demo:pup`.

import type { CreatureAsset } from "../../../../../art/spec.ts";

export default {
  kind: "creature",
  // Run in this order in one Blender session. plan.py is not run: the others import it.
  source: { scripts: ["rig.py", "model.py", "clips.py"] },
  scale: 1,
  skeleton: { id: "pup", root: "Hips" },
  zones: [
    { zone: "head", on: "Head", from: "Head", to: "Chest", covers: ["Head"] },
    { zone: "torso", on: "Hips", from: "Tail", to: "Chest", covers: ["Hips", "Chest", "Tail"] },
    { zone: "legL", on: "Leg.L", from: "Leg.L", to: "Foot.L", covers: ["Leg.L", "Foot.L"] },
    { zone: "legR", on: "Leg.R", from: "Leg.R", to: "Foot.R", covers: ["Leg.R", "Foot.R"] },
  ],
  sockets: [{ name: "mouth", bone: "Head", of: ["Head"], at: "front" }],
  // In the order the region map paints them: red, then green.
  regions: [
    { name: "coat", sample: 3 },
    { name: "legs", sample: 15 },
  ],
  // By the name model.py gives the material. The paths are within this folder, and ../../pictures.ts drew them.
  materials: {
    Hide: { base: "tex/hide_base.png", normal: "tex/hide_normal.png", packed: "tex/hide_packed.png", regions: "tex/hide_regions.png", height: "tex/hide_height.png" },
  },
  clips: [
    { name: "idle", source: "Idle", loop: true },
    { name: "walk", source: "Walk", loop: true },
  ],
  feet: ["Foot.L", "Foot.R"],
  // Two steps of plan.py's STEP to a turn of the clip.
  gaits: { walk: { stride: 0.6 } },
  // The finest level is the model's. The next keeps its surface, and the last is drawn flat.
  budgets: { triangles: [400, 200, 100], texture: { top: 64, megabytes: 1 } },
  flat: 2,
} satisfies CreatureAsset;
