import type { CreatureAsset } from "../../../../../tools/art/spec.ts";
import rig from "../../../../../content/vehicles/concept003-rig.json" with { type: "json" };

const order = Object.keys(rig.pivots);
export default {
  kind: "creature", source: { scripts: ["model.py"] }, scale: 1,
  modelCredit: "Unity Fan · CC0",
  skeleton: { id: "core:concept003", root: "chassis", bones: order.length, order },
  zones: [], clips: [], feet: [], gaits: {},
  sockets: Object.entries(rig.anchors).map(([name, p]) => ({ name, bone: "chassis", offset: [p[0]!, p[1]!, p[2]!] })),
  regions: [{ name: "Paint", sample: 1 }],
  materials: { coachwork: { base: "base.png", normal: "normal.png", packed: "finish.png", regions: "regions.png" } },
  preserveBones: order.slice(1), flat: 2,
  budgets: { triangles: [38000, 12000, 5800, 2800, 1500, 900], texture: { top: 512, megabytes: 4 } },
} satisfies CreatureAsset;
