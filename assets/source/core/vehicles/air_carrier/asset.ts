import { AIR_CARRIER_ART as A } from "../../../../../content/vehicles/air-freight-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { airMaterials } from "../air_freight/materials.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: A.id, root: "chassis", bones: A.bones.length, order: A.bones },
  zones: [], sockets: Object.entries(A.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  regions: [], clips: [], feet: [], gaits: {},
  materials: airMaterials(2048),
  flat: 1, holdParts: true, preserveBones: ["rotor_front", "rotor_rear"],
  budgets: { triangles: [40000, 9000, 4000, 1600, 700, 320], texture: { top: 2048, megabytes: 40 } },
} satisfies CreatureAsset;
