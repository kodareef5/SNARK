// The compact: an original two-door coupe, the first of the vehicles. Its measured contract (bones, pivots, sockets,
// the closed envelope) is contract.ts, described in ref/DESIGN.md; tests/unit/vehicle-asset.test.ts holds the built
// pack to it. `bun run art -- core:compact` builds it.

import { COMPACT } from "./contract.ts";
import type { CreatureAsset, MaterialSpec } from "../../../../../tools/art/spec.ts";

/** A material's pictures, painted by tex/paint.py onto the layout model.py lays out. */
const painted = (name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` },
  height: `tex/${name}_height.png`,
  hurt: `tex/${name}_hurt.png`,
  decay: `tex/${name}_decay.png`,
  ...extra,
});

export default {
  kind: "creature",
  // rig.py makes the armature "compact" on contract.ts's pivots; model.py builds the car on it, every part closed and
  // rigid on its one bone, and checks the layout is the one tex/ was painted for.
  source: { scripts: ["rig.py", "model.py"] },
  scale: 1,
  skeleton: { id: COMPACT.id, root: "chassis", bones: COMPACT.bones.length },
  // No hit capsules: the server hits a vehicle by the hull its content gives it, up to the belt.
  zones: [],
  // All on the chassis, whose joint is the origin, so each offset is the point itself.
  sockets: Object.entries(COMPACT.anchors).map(([name, at]) => ({ name, bone: "chassis", offset: at })),
  // The paint is region 0, as a creature's body is: the species' colour set is what a car rolls. The upholstery and
  // the wheels' alloy are regions 1 and 2. `sample` is what the review sheet dyes them.
  regions: [
    { name: "Paint", sample: 5 },
    { name: "Upholstery", sample: 128 },
    { name: "Wheels", sample: 15 },
  ],
  // body: the painted panels and the shut lines. trim: tyres, alloys, lamps, grilles, rubber, chrome and black plastic.
  // cabin: the glass, whose inside is cut out so it is seen through from within, and everything inside.
  materials: {
    body: painted("body"),
    trim: painted("trim"),
    cabin: painted("cabin", { cutout: true }),
  },
  // No clips: the client poses the wheels, doors and steering wheel by name (client/core/render/characters.ts).
  clips: [],
  feet: [],
  gaits: {},
  budgets: {
    triangles: [30000, 14000, 6000, 2400, 960, 320],
    texture: { top: 2048, megabytes: 80, layer: 512 },
  },
  flat: 2,
} satisfies CreatureAsset;
