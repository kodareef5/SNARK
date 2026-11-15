// The pteranodon's block-out with its blocked movement clips, built through the art pipeline as an asset of its own so
// that flight in the pose can be tested and drawn before the model lands (planning/reference/flyers-plan.md, FL4). It is
// not under assets/source, so the game has none of it: the content's pteranodon stays a grey box. `bun
// tests/fixtures/flyer/build.ts` builds pteranodon.snpk beside this from rig.py and clips_move.py in the pteranodon's
// own folder. The zones and sockets are given outright from rig.py's joints, the zones as capsules along the wing's
// bones only, the membrane between them uncovered.

import type { CreatureAsset, ZoneSpec } from "../../../tools/art/spec.ts";

/** A capsule on `bone` from its joint along (x, y, z), and its mirror on the right. */
function pair(zone: "arm" | "hand" | "leg" | "foot", bone: string, x: number, y: number, z: number, radius: number): ZoneSpec[] {
  return [
    { zone: `${zone}L`, on: `${bone}_l`, a: [0, 0, 0], b: [x, y, z], radius },
    { zone: `${zone}R`, on: `${bone}_r`, a: [0, 0, 0], b: [-x, y, z], radius },
  ];
}

export default {
  kind: "creature",
  source: { scripts: ["rig.py", "clips_move.py"] },
  scale: 1,
  skeleton: { id: "pteranodon", root: "pelvis", drop: /^ctl_/, bones: 42 },
  zones: [
    { zone: "head", on: "skull", a: [0, 0, 0], b: [0, 0.01, 0.997], radius: 0.09 },
    { zone: "torso", on: "neck_2", a: [0, -0.09, -0.12], b: [0, 0.34, 0.29], radius: 0.09 },
    { zone: "torso", on: "spine", a: [0, -0.04, -0.24], b: [0, 0.1, 0.46], radius: 0.19 },
    ...pair("arm", "upper_arm", 0.304, 0.077, 0.065, 0.07),
    ...pair("arm", "forearm", 0.512, 0.081, -0.036, 0.06),
    ...pair("hand", "hand", 0.558, 0.049, 0.019, 0.05),
    ...pair("hand", "wing_1", 0.68, -0.085, -0.144, 0.04),
    ...pair("hand", "wing_2", 0.56, -0.094, -0.193, 0.035),
    ...pair("hand", "wing_3", 0.439, -0.087, -0.224, 0.03),
    ...pair("leg", "shin", 0.06, -0.15, -0.25, 0.04),
    ...pair("foot", "foot", 0.022, -0.075, -0.21, 0.03),
  ],
  // rig.py: SOCKETS, each less its bone's joint.
  sockets: [
    { name: "beak_tip", bone: "skull", offset: [0, 0.01, 0.997] },
    { name: "head", bone: "skull", offset: [0, 0.07, 0.15] },
    { name: "overhead", bone: "skull", offset: [0, 0.91, -0.03] },
    { name: "seat", bone: "chest", offset: [0, 0.2, -0.08] },
    { name: "grip_l", bone: "chest", offset: [0.17, 0.26, 0.27] },
    { name: "grip_r", bone: "chest", offset: [-0.17, 0.26, 0.27] },
    { name: "grab", bone: "pelvis", offset: [0, -0.42, 0.18] },
    { name: "foot_l", bone: "toes_l", offset: [0, 0.027, -0.011] },
    { name: "foot_r", bone: "toes_r", offset: [0, 0.027, -0.011] },
  ],
  // rig.py: REGIONS and REGION_MATERIALS, drawn in the palette colours nearest REGION_DISPLAY.
  regions: [
    { name: "Patterning", material: "patterning", sample: 83 },
    { name: "Wing Base", material: "wing_base", sample: 100 },
    { name: "Face, Crest and Hands", material: "face_crest_hands", sample: 205 },
    { name: "Inner Crest", material: "inner_crest", sample: 94 },
    { name: "Wing Membrane", material: "wing_membrane", sample: 4 },
    { name: "Body", material: "body", sample: 105 },
  ],
  // Every clip clips_move.py makes, by rig.py's CLIPS.
  clips: [
    { name: "idle", source: "idle", loop: true },
    { name: "idle_look", source: "idle_look", loop: false },
    { name: "idle_stretch", source: "idle_stretch", loop: false },
    { name: "walk", source: "walk", loop: true },
    { name: "turn", source: "turn", loop: false },
    { name: "take_off", source: "take_off", loop: false },
    { name: "hover", source: "hover", loop: true },
    { name: "fly", source: "fly", loop: true },
    { name: "fly_fast", source: "fly_fast", loop: true },
    { name: "glide", source: "glide", loop: true },
    { name: "dive", source: "dive", loop: true },
    { name: "land", source: "land", loop: false },
    { name: "swim_idle", source: "swim_idle", loop: true },
    { name: "swim", source: "swim", loop: true },
    { name: "fall", source: "fall", loop: true },
  ],
  // It walks on its feet and on the hands of its folded wings.
  feet: ["toes_l", "toes_r", "fingers_l", "fingers_r"],
  gaits: {
    walk: { stride: 1.5 },
    swim: { stride: 3, stated: "it paddles in water, with no ground to hold a foot to; played at its swimming speed, 3 m/s" },
  },
  budgets: { triangles: [16000, 7000, 3200, 1400, 600, 240, 64] },
} satisfies CreatureAsset;
