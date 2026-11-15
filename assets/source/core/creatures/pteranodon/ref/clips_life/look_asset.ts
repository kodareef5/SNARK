// The block-out pteranodon of tests/fixtures/flyer with clips_life.py's clips and a ragdoll, for look.ts to build
// outside assets/source and draw in the game's renderer. It is not the animal's asset (PA5 writes that); the ragdoll
// here is the one the death clips were posed for.

import fixture from "../../../../../../../tests/fixtures/flyer/asset.ts";
import type { CreatureAsset } from "../../../../../../../tools/art/spec.ts";

export default {
  ...fixture,
  source: { scripts: ["rig.py", "clips_move.py", "clips_life.py"] },
  clips: [
    ...fixture.clips,
    { name: "torpor_in", source: "torpor_in", loop: false },
    { name: "torpor_fall", source: "torpor_fall", loop: true },
    { name: "torpor_idle", source: "torpor_idle", loop: true },
    { name: "torpor_eat", source: "torpor_eat", loop: false },
    { name: "torpor_out", source: "torpor_out", loop: false },
    { name: "death", source: "death", loop: false },
    { name: "death_air", source: "death_air", loop: false },
  ],
  // clips_life.py: LIMP. The body, the neck, the head and the two upper arms, on the bones the fixture's capsules are
  // on, so the wings splay as it falls (ref/FUNCTIONS.md, section 20); the rest of each wing stays as the clip left
  // it against its upper arm.
  ragdoll: {
    limp: 24,
    bodies: [
      { bone: "spine", mass: 0.7 },
      { bone: "neck_2", mass: 0.06, swing: 60, twist: 40 },
      { bone: "skull", mass: 0.09, swing: 90, twist: 70 },
      { bone: "upper_arm_l", mass: 0.075, swing: 75, twist: 40 },
      { bone: "upper_arm_r", mass: 0.075, swing: 75, twist: 40 },
    ],
  },
} satisfies CreatureAsset;
