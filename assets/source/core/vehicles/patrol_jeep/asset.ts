import { PATROL_JEEP_ART as art } from "../../../../../content/vehicles/patrol-jeep-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: art.id, root: "chassis", bones: art.bones.length, order: art.bones },
  zones: [], sockets: Object.entries(art.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  regions: [{ name: "Paint", sample: 19 }, { name: "Upholstery", sample: 104 }, { name: "Wheels", sample: 91 }],
  materials: {
    patrol: { base: "tex/patrol.png", packed: "tex/surface.png", normal: "tex/normal.png",
      height: "tex/height.png", tops: { normal: 512 }, regions: { mask: "tex/regions.png" },
      hurt: "tex/hurt.png", decay: "tex/decay.png" },
  },
  clips: [], feet: [], gaits: {}, flat: 2, preserveBones: ["steering_wheel"], holdParts: true,
  budgets: { triangles: [45000, 24500, 6400, 2600, 1200, 760], texture: { top: 1024, megabytes: 11, layer: 512 } },
} satisfies CreatureAsset;
