// The dodo. Its design is ref/DESIGN.md, drawn in ref/concept/. rig.py holds the skeleton and the shared helpers;
// the numbers here that rig.py also uses are checked against it by ref/blockout/preview.py.

import { DODO_DYES } from "../../../../../content/creatures/dodo.ts";
import type { CreatureAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "creature",
  // Run in this order in one Blender session. rig.py makes the armature "dodo" and a block-out mesh; model.py drops
  // the block-out for the real mesh, in the two materials below; each clips file adds the actions it owns.
  // `bun run art -- core:dodo` builds it.
  source: { scripts: ["rig.py", "model.py", "clips_move.py", "clips_act.py", "clips_life.py"] },
  scale: 1,
  // 29 deforming bones. The five ctl_* bones are Blender controls whose effect is baked into the others.
  skeleton: { id: "dodo", root: "pelvis", drop: /^ctl_/, bones: 32 },
  // ARK's dodo takes three times the damage to its head and the top bone of its neck, and once everywhere else
  // (content: SpeciesDef.zones). Each capsule is fitted to the vertices of the bones it covers when the asset is built,
  // leaving out the feather cards, so it holds the body under the plumage; the tail, which is all quills, is fitted to
  // its cards. The body, the tail, the skull and the toes run along their vertices' own longest axis, since no two
  // joints lie along them. The folded wing lies flush with the flank, as far out as the body, so it has no capsule and a
  // hit there is the body's, as ARK counts it. `bun tools/fit-zones.ts core:dodo` measures where each zone is hit against where it is drawn.
  zones: [
    { zone: "head", on: "skull", covers: ["skull", "jaw", "throat", "lid_l", "lid_r", "hood"] },
    { zone: "head", on: "neck_4", from: "neck_4", to: "skull", covers: ["neck_4"] },
    { zone: "torso", on: "neck_2", from: "neck_1", to: "neck_4", covers: ["neck_1", "neck_2", "neck_3"] },
    { zone: "torso", on: "pelvis", covers: ["pelvis", "belly", "chest"] },
    { zone: "torso", on: "tail_1", covers: ["tail_1", "tail_2"] },
    { zone: "legL", on: "shank_l", from: "shank_l", to: "toes_l", covers: ["shank_l"] },
    { zone: "legR", on: "shank_r", from: "shank_r", to: "toes_r", covers: ["shank_r"] },
    { zone: "footL", on: "toes_l", covers: ["toes_l"] },
    { zone: "footR", on: "toes_r", covers: ["toes_r"] },
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
  // The model's two materials (rig.py: MATERIALS says which parts are on which). Their pictures are painted onto the
  // layout in tex/paint/ and put together by tex/paint/compose.py.
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
    // The peck is its one attack, under the name the engine plays an attack by (shared/anim/rigs.ts).
    { name: "attack", source: "peck", loop: false },
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
  // Metres a turn of the clip: walk 16 frames at 0.65 m/s, run 12 frames at the wild 1.365 m/s (ARK's 65 and 136.5
  // units a second). `--check` finds the feet hold best at these. The swim has no ground: its 20 frames at the 3 m/s it
  // swims at.
  gaits: {
    walk: { stride: 0.35 },
    run: { stride: 0.55 },
    swim: { stride: 2, stated: "it paddles in water, with no ground to hold a foot to; played at its swimming speed, 3 m/s" },
  },
  budgets: {
    // Only level 0 is the model's; the build makes the rest. Estimated to be first drawn about 84, 46, 19, 8, 3 and
    // 1 pixels tall on medium. Level 6 is the triangle bird: round body, neck at the front, big head and beak.
    triangles: [8500, 3500, 2000, 900, 400, 160, 72],
    // dodo at 2,048 and dodo_cards at 512: 27.0 MB in the rgba variant, 15.6 MB in bc and astc.
    texture: { top: 2048, megabytes: 28 },
  },
  // The first level drawn under about 48 pixels tall: on medium `--check` has level 1 first drawn 50 px tall and level 2
  // 22 px.
  flat: 2,
  // The death clip has it down on its side by frame 27 and still from 30, so it goes limp at 27, as it comes to rest,
  // and the ragdoll lays it on whatever ground is there. The body and the head are its bodies, as the sample dinosaurs'
  // are without their neck: the neck, wings, legs and tail stay as the clip left them against the body. Measured on
  // tests/unit/ragdoll.test.ts's slope and floor from 64 yaws: like this it sleeps within 1.2 seconds on the slope, nine
  // in ten within 0.9, and within 1 on the floor. With the neck or the tail as a body too it sleeps within 2.3; with the
  // legs it can shiver past 10.
  ragdoll: {
    limp: 27,
    bodies: [
      { bone: "pelvis", mass: 0.86 },
      { bone: "skull", mass: 0.08, swing: 100, twist: 50 },
    ],
  },
} satisfies CreatureAsset;
