// The dodo. Its design is ref/DESIGN.md, drawn in ref/concept/. rig.py holds the skeleton and the shared helpers;
// the numbers here that rig.py also uses are checked against it by ref/blockout/preview.py.

import { DODO_DYES } from "../../../../../content/creatures/dodo.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature",
  // Run in this order in one Blender session. rig.py makes the armature "dodo" and a block-out mesh; model.py drops
  // the block-out for the real mesh, in the two materials below; each clips file adds the actions it owns. The asset
  // builds once all five scripts and the pictures exist. Until then a maker runs tools/blender/build.py with a job
  // that names the scripts so far and no "out" (nothing is written), and rig.py's own checks (rig.find().finish).
  source: { scripts: ["rig.py", "model.py", "clips_move.py", "clips_act.py", "clips_life.py"] },
  scale: 1,
  // 29 deforming bones. The five ctl_* bones are Blender controls whose effect is baked into the others.
  skeleton: { id: "dodo", root: "pelvis", drop: /^ctl_/, bones: 32 },
  // Head and the top of the neck take three times the damage (content: SpeciesDef.zones). The content author fits
  // the rest of the damage and the ragdoll from these.
  zones: [
    { zone: "head", on: "skull", from: "skull", to: "jaw", covers: ["skull", "jaw", "throat", "lid_l", "lid_r", "hood"] },
    { zone: "head", on: "neck_4", from: "neck_4", to: "skull", covers: ["neck_4"] },
    { zone: "torso", on: "neck_2", from: "neck_1", to: "neck_4", covers: ["neck_1", "neck_2", "neck_3"] },
    { zone: "torso", on: "pelvis", from: "tail_1", to: "chest", covers: ["pelvis", "belly", "chest", "tail_1", "tail_2", "thigh_l", "thigh_r", "shin_l", "shin_r"] },
    { zone: "armL", on: "wing_upper_l", from: "wing_upper_l", to: "wing_hand_l", covers: ["wing_upper_l", "wing_lower_l", "wing_hand_l"] },
    { zone: "armR", on: "wing_upper_r", from: "wing_upper_r", to: "wing_hand_r", covers: ["wing_upper_r", "wing_lower_r", "wing_hand_r"] },
    { zone: "legL", on: "shank_l", from: "shank_l", to: "toes_l", covers: ["shank_l", "toes_l"] },
    { zone: "legR", on: "shank_r", from: "shank_r", to: "toes_r", covers: ["shank_r", "toes_r"] },
  ],
  // Measured from each bone's joint at rest (rig.py: SOCKETS gives the same points in the bird's frame). What each is
  // for is ref/FUNCTIONS.md's; no system reads one yet.
  sockets: [
    // Where a peck lands and where it eats.
    { name: "beak_tip", bone: "skull", offset: [0, -0.05, 0.182] },
    // The middle of the skull: where a look at it aims, and the middle of the head's hit zone.
    { name: "head", bone: "skull", offset: [0, 0.04, 0.005] },
    // The mating heart, its name and its state.
    { name: "overhead", bone: "skull", offset: [0, 0.17, 0] },
    // Where a creature that carries it takes hold: talons, jaws, a pouch.
    { name: "carry_point", bone: "belly", offset: [0, 0.1, -0.025] },
    // Where a survivor's arms hold it.
    { name: "hold_point", bone: "chest", offset: [0, -0.205, -0.01] },
    // Where its eggs and droppings come out.
    { name: "vent", bone: "pelvis", offset: [0, -0.11, -0.15] },
    // Footsteps.
    { name: "foot_l", bone: "toes_l", offset: [0, -0.02, 0.022] },
    { name: "foot_r", bone: "toes_r", offset: [0, -0.02, 0.022] },
  ],
  // The six regions under ARK's names, in its order, painted in the region maps below. Where each lies is in
  // ref/DESIGN.md. `sample` is the default bird's dye, the first colour of each region's set in the content;
  // `material` is the block-out's own material for the region, read only if `materials` is taken away to build the
  // block-out alone.
  regions: [
    { name: "Body", material: "body", sample: DODO_DYES[0]! },
    { name: "Face", material: "face", sample: DODO_DYES[1]! },
    { name: "Beak", material: "beak", sample: DODO_DYES[2]! },
    { name: "Forehead, Neck and Feet", material: "forehead_neck_feet", sample: DODO_DYES[3]! },
    { name: "Head", material: "head", sample: DODO_DYES[4]! },
    { name: "Wings and Patterning", material: "wings_patterning", sample: DODO_DYES[5]! },
  ],
  // The model's two materials (rig.py: MATERIALS says which parts are on which). The pictures are D4's, in tex/.
  materials: {
    dodo: {
      base: "tex/dodo_base.png",
      normal: "tex/dodo_normal.png",
      packed: "tex/dodo_packed.png",
      regions: "tex/dodo_regions.png",
      height: "tex/dodo_height.png",
    },
    dodo_cards: {
      base: "tex/dodo_cards_base.png",
      normal: "tex/dodo_cards_normal.png",
      packed: "tex/dodo_cards_packed.png",
      regions: "tex/dodo_cards_regions.png",
      height: "tex/dodo_cards_height.png",
      twoSided: true,
      cutout: true,
    },
  },
  // The function list's clips, each made from the action of its name. rig.py: CLIPS says who makes each.
  // turn and land are optional; add them here if they are made.
  clips: [
    { name: "idle", source: "idle", loop: true },
    { name: "idle_look", source: "idle_look", loop: false },
    { name: "idle_peck", source: "idle_peck", loop: false },
    { name: "walk", source: "walk", loop: true },
    { name: "run", source: "run", loop: true },
    { name: "turn", source: "turn", loop: false },
    { name: "swim", source: "swim", loop: true },
    { name: "swim_idle", source: "swim_idle", loop: true },
    { name: "fall", source: "fall", loop: true },
    { name: "land", source: "land", loop: false },
    { name: "peck", source: "peck", loop: false },
    { name: "flinch", source: "flinch", loop: false },
    { name: "held", source: "held", loop: true },
    { name: "carried", source: "carried", loop: true },
    { name: "torpor_eat", source: "torpor_eat", loop: false },
    { name: "call", source: "call", loop: false },
    { name: "startled", source: "startled", loop: false },
    { name: "torpor_in", source: "torpor_in", loop: false },
    { name: "torpor_idle", source: "torpor_idle", loop: true },
    { name: "torpor_out", source: "torpor_out", loop: false },
    { name: "death", source: "death", loop: false },
  ],
  // The ball of each foot: the joint that stays put on the ground.
  feet: ["toes_l", "toes_r"],
  // Metres a turn of the clip: walk 16 frames at 0.65 m/s, run 12 frames at the wild 1.365 m/s.
  gaits: { walk: { stride: 0.35 }, run: { stride: 0.55 } },
  budgets: {
    // Only level 0 is the model's; the build makes the rest. Estimated to be first drawn about 84, 46, 19, 8, 3 and
    // 1 pixels tall on medium. Level 6 is the triangle bird: round body, neck at the front, big head and beak.
    triangles: [8500, 3500, 2000, 900, 400, 160, 72],
    // dodo at 2,048 and dodo_cards at 512: 27.0 MB in the rgba variant, 15.6 MB in bc and astc.
    texture: { top: 2048, megabytes: 28 },
  },
  // The first level drawn under about 48 pixels tall. `--check` prints where each level of the real mesh is first
  // drawn; move this to the first one under 48 px once model.py exists.
  flat: 2,
  // Goes limp at the last frame of the death clip until `limp` names the frame it begins to fall. `--check` prints how far
  // the clips bend each joint, which each limit should be a little past.
  ragdoll: {
    bodies: [
      { bone: "pelvis", mass: 0.7 },
      { bone: "neck_2", mass: 0.06, swing: 35, twist: 20 },
      { bone: "neck_4", mass: 0.04, swing: 35, twist: 20 },
      { bone: "skull", mass: 0.08, swing: 40, twist: 25 },
      { bone: "wing_upper_l", mass: 0.02, swing: 80, twist: 30 },
      { bone: "wing_upper_r", mass: 0.02, swing: 80, twist: 30 },
      { bone: "shank_l", mass: 0.03, swing: 70, twist: 10 },
      { bone: "shank_r", mass: 0.03, swing: 70, twist: 10 },
    ],
  },
} satisfies CreatureAsset;
