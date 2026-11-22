import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

const MARKS = ["bar", "saltire", "buckler", "hourglass", "cross", "cone_down", "cone_up"] as const;

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    // What stands still, and what the client poses with a bone each: a leg, a slat of a louvre, the hatch, the hoop.
    { id: "core:supply_capsule/hull", object: "hull", errors: [0.006, 0.02, 0.07], budget: [[0, 2600], [40, 900], [140, 320], [450, 96]] },
    { id: "core:supply_capsule/leg", object: "leg", errors: [0.004, 0.012, 0.04] },
    { id: "core:supply_capsule/shutter", object: "shutter", errors: [0.002, 0.004, 0.008] },
    { id: "core:supply_capsule/hatch", object: "hatch", errors: [0.004, 0.01, 0.02] },
    { id: "core:supply_capsule/collar", object: "collar", errors: [0.004, 0.008, 0.03] },
    { id: "core:supply_capsule/hoop", object: "hoop", errors: [0.006, 0.015, 0.05] },
    ...MARKS.map((mark) => ({ id: `core:supply_capsule/mark_${mark}`, object: `mark_${mark}`, errors: [0.004, 0.008, 0.02] })),
    // Its lit strips, and its light with no surface: drawn from the band and the point on it, with no picture.
    { id: "core:supply_capsule/lights", object: "lights", errors: [0.004, 0.01, 0.03] },
    { id: "core:supply_capsule/shaft", object: "shaft", errors: [0.02, 0.05, 0.1] },
    { id: "core:supply_capsule/sheath", object: "sheath", errors: [0.02, 0.05, 0.1] },
    { id: "core:supply_capsule/halo", object: "halo", errors: [0.01, 0.02, 0.05] },
    ...MARKS.map((mark) => ({ id: `core:supply_capsule/figure_${mark}`, object: `figure_${mark}`, errors: [0.04, 0.08, 0.2] })),
    { id: "core:supply_capsule/jet", object: "jet", errors: [0.004, 0.01, 0.02] },
    { id: "core:supply_capsule/foot", object: "foot", errors: [0.01, 0.02, 0.04] },
  ],
  // One trim atlas of eight strips, each 2 m of a course 0.25 m tall (paint.py). The two lights have no picture: the
  // client works each out from the strip's row (client/core/render/supply-light.ts), and draws the second blended.
  materials: {
    capsule: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/orm.png", height: "tex/height.png", regions: "tex/regions.png", tiles: 2 },
    light: { flat: [120, 155, 225] },
    glow: { flat: [120, 155, 225], blend: true },
  },
  budgets: { triangles: [2600, 900, 320, 96], texture: { top: 2048, megabytes: 24 } },
} satisfies PiecesAsset;
