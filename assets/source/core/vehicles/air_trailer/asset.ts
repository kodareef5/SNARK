import { AIR_TRAILER_ART as A } from "../../../../../content/vehicles/air-freight-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { airMaterials } from "../air_freight/materials.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: A.id, root: "chassis", bones: A.bones.length, order: A.bones },
  zones: [], sockets: Object.entries(A.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  regions: [], clips: [], feet: [], gaits: {},
  materials: airMaterials(2048),
  flat: 1, holdParts: true,
  budgets: { triangles: [40000, 12000, 5000, 2000, 800, 360], texture: { top: 2048, megabytes: 40 } },
} satisfies CreatureAsset;
