// The pteranodon's block-out with every clip, its zones and its ragdoll, for look.ts to build outside assets/source and
// draw in the game's renderer: the animal's own asset without the model, the saddle and their pictures.

import asset from "../../asset.ts";
import type { CreatureAsset } from "../../../../../../../tools/art/spec.ts";

const { materials: _materials, worn: _worn, ...bare } = asset;

export default {
  ...bare,
  source: { scripts: ["rig.py", "clips_move.py", "clips_act.py", "clips_life.py"] },
  budgets: { triangles: asset.budgets.triangles },
} satisfies CreatureAsset;
