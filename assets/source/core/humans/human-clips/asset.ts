// The clips of the humanoid skeleton that the game plays (shared/anim/pose.ts names them). Neither library has bow, rifle
// or prone clips: those are written as code in shared/anim. The libraries hold more than is taken here, among them a death,
// hits to the chest and head, a knockback, eating, using, picking up, chopping, a hook and a pistol's idle, aim, shot and
// reload: a clip joins this list with the code that plays it.

import type { HumanClipsAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "human-clips",
  libraries: [
    {
      raw: "quaternius/animation-library/UAL1_Standard.glb",
      clips: [
        { source: "Idle_Loop", id: "human/idle" },
        { source: "Walk_Loop", id: "human/walk", gait: true },
        { source: "Jog_Fwd_Loop", id: "human/jog", gait: true },
        { source: "Sprint_Loop", id: "human/sprint", gait: true },
        { source: "Jump_Loop", id: "human/fall" },
        { source: "Swim_Idle_Loop", id: "human/swim_idle" },
        { source: "Swim_Fwd_Loop", id: "human/swim" },
        { source: "Crouch_Idle_Loop", id: "human/crouch_idle" },
        { source: "Crouch_Fwd_Loop", id: "human/crouch_walk", gait: true },
        { source: "Punch_Jab", id: "human/punch" },
        { source: "Punch_Cross", id: "human/punch_cross" },
        { source: "Sword_Attack", id: "human/tool_swing" },
      ],
    },
    {
      raw: "quaternius/animation-library-2/UAL2_Standard.glb",
      clips: [{ source: "OverhandThrow", id: "human/throw" }],
    },
  ],
} satisfies HumanClipsAsset;
