import { FASTBACK_ART as A } from "../../../../../content/vehicles/fastback-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: A.id, root: "chassis", bones: A.bones.length, order: A.bones },
  zones: [], sockets: Object.entries(A.anchors).map(([name, at]) => ({ name, bone: "chassis", offset: at })),
  regions: [{ name: "Paint", sample: 46 }, { name: "Upholstery", sample: 220 }, { name: "Wheels", sample: 91 }],
  materials: {
    enamel: { base: "tex/enamel.png", packed: "tex/enamel_orm.png", regions: { mask: "tex/enamel_mask.png" },
      hurt: "tex/enamel_hurt.png", decay: "tex/enamel_decay.png" },
    detail: { base: "tex/detail.png", packed: "tex/detail_orm.png", regions: { mask: "tex/detail_mask.png" },
      hurt: "tex/detail_hurt.png", decay: "tex/detail_decay.png", cutout: true },
  },
  clips: [], feet: [], gaits: {}, flat: 2,
  preserveBones: A.bones.slice(1),
  budgets: { triangles: [53000, 14000, 6000, 2400, 1100, 720], texture: { top: 1024, megabytes: 15, layer: 256 } },
} satisfies CreatureAsset;
