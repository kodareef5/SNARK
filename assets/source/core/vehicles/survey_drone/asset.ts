import { SURVEY_DRONE_ART as D } from "../../../../../content/vehicles/air-freight-art.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import { airMaterials } from "../air_freight/materials.ts";

export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  skeleton: { id: D.id, root: "chassis", bones: D.bones.length, order: D.bones },
  zones: [], sockets: Object.entries(D.anchors).map(([name, offset]) => ({ name, bone: "chassis", offset })),
  regions: [], clips: [], feet: [], gaits: {},
  materials: airMaterials(1024),
  flat: 1, preserveBones: ["impeller_1", "impeller_2", "impeller_3", "impeller_4"],
  budgets: { triangles: [8000, 2400, 900, 360, 160], texture: { top: 1024, megabytes: 12 } },
} satisfies CreatureAsset;
