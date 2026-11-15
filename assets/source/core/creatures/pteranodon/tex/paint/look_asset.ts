// The pteranodon as far as its painted maps need it, for look.sh to build outside the repository and look at in the
// game's renderer: the model, its two materials and its regions, with no clips. It is not the animal's asset (PA5
// writes that); look.sh copies it into its own tree as asset.ts. Paths to the repository are filled in by look.sh.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultPalette, nearestColour } from "../../../../../../../shared/pack/palette.ts";
import type { CreatureAsset } from "../../../../../../../tools/art/spec.ts";

// rig.py: REGION_DISPLAY, the concept's colours.
const DISPLAY = ["2E3134", "9C8B78", "C8662E", "2A2C2F", "56677A", "E9E4D8"];
const NAMES = ["Patterning", "Wing Base", "Face, Crest and Hands", "Inner Crest", "Wing Membrane", "Body"];
const MATERIALS = ["patterning", "wing_base", "face_crest_hands", "inner_crest", "wing_membrane", "body"];
const palette = defaultPalette();
// The hurt and decay layers, where look.sh found them beside the maps.
const layers = (m: string): { hurt?: string; decay?: string } =>
  existsSync(join(import.meta.dir, "tex", `${m}_hurt.png`)) ? { hurt: `tex/${m}_hurt.png`, decay: `tex/${m}_decay.png` } : {};
const sample = (h: string): number => nearestColour(palette, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "model.py"] },
  scale: 1,
  skeleton: { id: "pteranodon", root: "pelvis", drop: /^ctl_/, bones: 42 },
  zones: [],
  sockets: [],
  regions: NAMES.map((name, k) => ({ name, material: MATERIALS[k]!, sample: sample(DISPLAY[k]!) })),
  materials: {
    pteranodon: {
      base: "tex/pteranodon_base.png",
      normal: "tex/pteranodon_normal.png",
      packed: "tex/pteranodon_packed.png",
      regions: "tex/pteranodon_regions.png",
      height: "tex/pteranodon_height.png",
      ...layers("pteranodon"),
    },
    pteranodon_wing: {
      base: "tex/pteranodon_wing_base.png",
      normal: "tex/pteranodon_wing_normal.png",
      packed: "tex/pteranodon_wing_packed.png",
      regions: { mask: "tex/pteranodon_wing_mask.png", mask2: "tex/pteranodon_wing_mask2.png" },
      height: "tex/pteranodon_wing_height.png",
      ...layers("pteranodon_wing"),
    },
  },
  clips: [],
  feet: [],
  gaits: {},
  budgets: { triangles: [16000, 7000, 3200, 1400, 600, 240, 64], texture: { top: 2048, megabytes: 60, layer: 256 } },
  flat: 3,
} satisfies CreatureAsset;
