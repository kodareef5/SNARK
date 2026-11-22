// The pteranodon. Its design is ref/DESIGN.md, what it does is ref/FUNCTIONS.md, and rig.py holds the skeleton, the
// sockets and the numbers the clips share.

import { distanceLods } from "./distance.ts";
import { PTERANODON_DYES } from "../../../../../content/creatures/pteranodon.ts";
import type { CreatureAsset, ZoneSpec } from "../../../../../tools/art/spec.ts";

/** A capsule on `bone` from its joint along (x, y, z), and its mirror on the right. */
function pair(zone: "arm" | "hand" | "leg" | "foot", bone: string, x: number, y: number, z: number, radius: number): ZoneSpec[] {
  return [
    { zone: `${zone}L`, on: `${bone}_l`, a: [0, 0, 0], b: [x, y, z], radius },
    { zone: `${zone}R`, on: `${bone}_r`, a: [0, 0, 0], b: [-x, y, z], radius },
  ];
}

export default {
  kind: "creature",
  modelCredit: "Pteranodon (Animated) by Chistodrako._. (https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Skin, materials and distance meshes adapted for SNARK. Rig and animations by SNARK",
  source: { scripts: ["rig.py", "coastal.py", "saddle.py", "clips_move.py", "clips_act.py", "clips_life.py"] },
  scale: 1,
  // 42 deforming bones; the nine ctl_* bones are Blender controls baked into the others.
  skeleton: { id: "pteranodon", root: "pelvis", drop: /^ctl_/, bones: 42 },
  // ARK's pteranodon takes three times to its head and once elsewhere (content: zones). Capsules lie along the bones only,
  // as FUNCTIONS.md section 20 chose: a shot through the membrane between them passes. Given outright from rig.py's joints,
  // as the ragdoll was posed against them; the skull's runs along the beak to its tip, and the crest has none, since a bone
  // carries one capsule and the beak is what the ragdoll lays on the ground.
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
  // rig.py: SOCKETS, each less its bone's joint (rig.socket_offsets()). What each is for is ref/DESIGN.md's.
  sockets: [
    { name: "beak_tip", bone: "skull", offset: [0, 0.01, 0.997] },
    { name: "head", bone: "skull", offset: [0, 0.07, 0.15] },
    { name: "overhead", bone: "skull", offset: [0, 0.91, -0.03] },
    // The rider sits on `seat` in the chest's whole frame, hands on the grips and feet on the rests.
    { name: "seat", bone: "chest", offset: [0, 0.2, -0.08] },
    { name: "grip_l", bone: "chest", offset: [0.17, 0.26, 0.27] },
    { name: "grip_r", bone: "chest", offset: [-0.17, 0.26, 0.27] },
    { name: "rest_l", bone: "chest", offset: [0.27, -0.37, 0.44] },
    { name: "rest_r", bone: "chest", offset: [-0.27, -0.37, 0.44] },
    // Where a grabbed body hangs, between the feet as they close; the talons shut on grab's frame 9.
    { name: "grab", bone: "pelvis", offset: [0, -0.42, 0.18] },
    { name: "carry_point", bone: "spine", offset: [0, 0.14, 0.06] },
    { name: "vent", bone: "pelvis", offset: [0, -0.1, -0.12] },
    { name: "foot_l", bone: "toes_l", offset: [0, 0.027, -0.011] },
    { name: "foot_r", bone: "toes_r", offset: [0, 0.027, -0.011] },
    { name: "hand_l", bone: "fingers_l", offset: [0.03, 0.003, 0.062] },
    { name: "hand_r", bone: "fingers_r", offset: [-0.03, 0.003, 0.062] },
  ],
  // ARK's six regions under its names, in its order, painted in the region maps below (ref/DESIGN.md says where). `sample`
  // is the default animal's dye, the first colour of each region's set in the content; `material` is the block-out's own.
  regions: [
    { name: "Patterning", material: "patterning", sample: PTERANODON_DYES[0]! },
    { name: "Wing Base", material: "wing_base", sample: PTERANODON_DYES[1]! },
    { name: "Face, Crest and Hands", material: "face_crest_hands", sample: PTERANODON_DYES[2]! },
    { name: "Inner Crest", material: "inner_crest", sample: PTERANODON_DYES[3]! },
    { name: "Wing Membrane", material: "wing_membrane", sample: PTERANODON_DYES[4]! },
    { name: "Body", material: "body", sample: PTERANODON_DYES[5]! },
  ],
  // The donor body and membranes share an atlas. ref/refit.py adapts it to the six native dyes.
  materials: {
    pteranodon_coastal: {
      base: "tex/coastal_base.png", normal: "tex/coastal_normal.png", packed: "tex/coastal_packed.png",
      regions: { mask: "tex/coastal_mask.png", mask2: "tex/coastal_mask2.png" },
      hurt: "tex/coastal_hurt.png", decay: "tex/coastal_decay.png",
      tops: { mask: 512, mask2: 512, mro: 512 },
    },
  },
  // Every clip rig.py's CLIPS lists, each from the action of its name.
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
    { name: "call", source: "call", loop: false },
    { name: "startled", source: "startled", loop: false },
    { name: "attack", source: "attack", loop: false },
    { name: "attack_air", source: "attack_air", loop: false },
    // Rolls to its left only (D568).
    { name: "barrel_roll", source: "barrel_roll", loop: false },
    { name: "grab", source: "grab", loop: false },
    { name: "carry", source: "carry", loop: true },
    { name: "release", source: "release", loop: false },
    { name: "flinch", source: "flinch", loop: false },
    { name: "carried", source: "carried", loop: true },
    { name: "torpor_in", source: "torpor_in", loop: false },
    { name: "torpor_fall", source: "torpor_fall", loop: true },
    { name: "torpor_idle", source: "torpor_idle", loop: true },
    { name: "torpor_eat", source: "torpor_eat", loop: false },
    { name: "torpor_out", source: "torpor_out", loop: false },
    { name: "death", source: "death", loop: false },
    { name: "death_air", source: "death_air", loop: false },
  ],
  // It walks on its feet and on the hands of its folded wings.
  feet: ["toes_l", "toes_r", "fingers_l", "fingers_r"],
  // Metres a turn of the clip. The walk's 20 frames at its 2.6 m/s. The rest have no ground under them, so each is stated
  // as the speed it plays alone at (D547): the swim's 30 frames at 3 m/s, fly's 30 at 6 m/s, and fly_fast's 15 at 16 m/s,
  // the wild sprint's 16.5 as the pose word carries it in steps of 2 m/s.
  gaits: {
    walk: { stride: 1.5 },
    swim: { stride: 3, stated: "it paddles in water, with no ground to hold a foot to; played at its swimming speed, 3 m/s" },
    fly: { stride: 6, stated: "it flies, with no ground under it; played alone at its flying speed, 6 m/s" },
    fly_fast: { stride: 8, stated: "it flies, with no ground under it; played alone from its wild sprint as sent, 16 m/s" },
  },
  distanceLods,
  budgets: {
    // Five textured levels preserve the folded wing skinning. The last two use dedicated silhouettes.
    triangles: [14000, 7000, 3200, 1400, 600, 250, 112],
    texture: { top: 2048, megabytes: 26, layer: 256 },
  },
  flat: 5,
  // clips_life.py: LIMP. Both death clips go limp at 24. The body, the head and the two upper arms, so the wings splay as
  // it falls (ref/FUNCTIONS.md, section 20); the neck, and each wing past its upper arm, stay as the clip left them. Each
  // upper arm carries its whole wing's weight. Measured on tests/creatures/ragdoll.test.ts's slope, floor and ramp from 32 yaws,
  // from either death clip: it sleeps within 1.2 to 1.7 s, no joint more than 0.8 degrees past its limit. With the neck
  // as a body too (clips_life.py's proposal) a few yaws in 32 were still moving after 3 s; with light upper arms the wings
  // rest up to 4.7 degrees past their limits.
  ragdoll: {
    limp: 24,
    bodies: [
      { bone: "spine", mass: 0.7 },
      { bone: "skull", mass: 0.09, swing: 100, twist: 70 },
      { bone: "upper_arm_l", mass: 0.15, swing: 75, twist: 40 },
      { bone: "upper_arm_r", mass: 0.15, swing: 75, twist: 40 },
    ],
  },
  // The saddle, a worn mesh of its own on the chest, the neck and the skull (saddle.py), drawn while it wears one.
  worn: [
    {
      item: "core:saddle_pteranodon",
      object: "saddle",
      materials: {
        pteranodon_saddle: {
          base: "tex/pteranodon_saddle_base.png",
          normal: "tex/pteranodon_saddle_normal.png",
          packed: "tex/pteranodon_saddle_packed.png",
          regions: "tex/pteranodon_saddle_regions.png",
          height: "tex/pteranodon_saddle_height.png",
        },
      },
      budgets: { triangles: [2400, 1000, 400, 120] },
    },
  ],
} satisfies CreatureAsset;
