// What the sample dinosaurs share: one skeleton and one set of clip names (assets/raw/quaternius/dinosaurs).
// They are stand-ins, so nothing in the game depends on these bones.

import type { CreatureAsset, CreatureClip } from "../../../../tools/art/spec.ts";

const TRUNK = ["Body", "Back", "Hips", "Torso", "Shoulders"];

/**
 * The model's root never moves and its chain ends carry nothing, so both are dropped. The model hangs the hind feet on
 * that root, and here they hang on the lower legs.
 */
export const DINO = {
  skeleton: {
    id: "dino",
    root: "Body",
    drop: /^root$|_end$/,
    reparent: { "BackFoot.L": "BackLowLeg.L", "BackFoot.R": "BackLowLeg.R" },
  },
  zones: [
    { zone: "head", on: "Head", from: "Head", to: "Head_end", covers: ["Head"] },
    { zone: "torso", on: "Neck", from: "Neck", to: "Head", covers: ["Neck"] },
    { zone: "torso", on: "Body", from: "Tail1", to: "Shoulders", covers: [...TRUNK, "BackLeg.L", "BackLeg.R", "FrontLeg.L", "FrontLeg.R"] },
    { zone: "torso", on: "Tail1", from: "Tail1", to: "Tail3", covers: ["Tail1", "Tail2"] },
    { zone: "torso", on: "Tail3", from: "Tail3", to: "Tail5_end", covers: ["Tail3", "Tail4", "Tail5"] },
    { zone: "legL", on: "BackUpLeg.L", from: "BackUpLeg.L", to: "BackFoot.L", covers: ["BackUpLeg.L", "BackLowLeg.L", "BackFoot.L"] },
    { zone: "legR", on: "BackUpLeg.R", from: "BackUpLeg.R", to: "BackFoot.R", covers: ["BackUpLeg.R", "BackLowLeg.R", "BackFoot.R"] },
    { zone: "armL", on: "FrontUpLeg.L", from: "FrontUpLeg.L", to: "FrontFoot.L_end", covers: ["FrontUpLeg.L", "FrontLowLeg.L", "FrontFoot.L"] },
    { zone: "armR", on: "FrontUpLeg.R", from: "FrontUpLeg.R", to: "FrontFoot.R_end", covers: ["FrontUpLeg.R", "FrontLowLeg.R", "FrontFoot.R"] },
  ],
  sockets: [
    { name: "seat", bone: "Torso", of: TRUNK, at: "top" },
    { name: "mouth", bone: "Head", of: ["Head"], at: "front" },
  ],
  feet: ["BackFoot.L", "BackFoot.R"],
  budgets: { triangles: [1500, 750, 375, 190, 95] },
  // Limp as the death clip begins to fall. The neck and the small arms stay as they were: as bodies of their own they are
  // light beside the trunk and shiver against the ground. Each limit is a little past what the clips bend the joint.
  ragdoll: {
    limp: 16,
    bodies: [
      { bone: "Body", mass: 0.55 },
      { bone: "Head", mass: 0.06, swing: 95, twist: 45 },
      { bone: "Tail1", mass: 0.08, swing: 30, twist: 10 },
      { bone: "Tail3", mass: 0.04, swing: 60, twist: 35 },
      { bone: "BackUpLeg.L", mass: 0.08, swing: 90, twist: 40 },
      { bone: "BackUpLeg.R", mass: 0.08, swing: 90, twist: 40 },
    ],
  },
} satisfies Partial<CreatureAsset>;

/** The pack names each action "<model>_<Clip>". */
export const dinoClips = (model: string): CreatureClip[] => [
  { name: "idle", source: `${model}_Idle`, loop: true },
  { name: "walk", source: `${model}_Walk`, loop: true },
  { name: "run", source: `${model}_Run`, loop: true },
  { name: "attack", source: `${model}_Attack`, loop: false },
  { name: "jump", source: `${model}_Jump`, loop: false },
  { name: "death", source: `${model}_Death`, loop: false },
];
