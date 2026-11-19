import { PATROL_SEDAN_ART as sedan } from "../../../../../content/vehicles/patrol-sedan-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: sedan.id, root: "chassis", bones: sedan.bones.length, order: sedan.bones },
  zones: [], sockets: Object.entries(sedan.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  regions: [{ name: "Paint", sample: 10 }, { name: "Upholstery", sample: 97 }, { name: "Wheels", sample: 91 }],
  materials: {
    cruiser: {
      base: "tex/base.png", normal: "tex/normal.png", packed: "tex/packed.png", height: "tex/height.png",
      regions: { mask: "tex/mask.png" }, hurt: "tex/hurt.png", decay: "tex/decay.png",
    },
  },
  clips: [], feet: [], gaits: {}, flat: 2, preserveBones: ["steering_wheel"], holdParts: true,
  budgets: { triangles: [32000, 12000, 5600, 2700, 1300, 620], texture: { top: 512, megabytes: 5, layer: 512 } },
} satisfies CreatureAsset;
