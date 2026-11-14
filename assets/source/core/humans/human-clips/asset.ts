// The clips of the humanoid skeleton. Neither library has bow, rifle or prone clips: those are written as code in shared/anim.

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
        { source: "Jump_Start", id: "human/jump" },
        { source: "Jump_Land", id: "human/land" },
        { source: "Swim_Idle_Loop", id: "human/swim_idle" },
        { source: "Swim_Fwd_Loop", id: "human/swim" },
        { source: "Crouch_Idle_Loop", id: "human/crouch_idle" },
        { source: "Crouch_Fwd_Loop", id: "human/crouch_walk", gait: true },
        { source: "Death01", id: "human/death" },
        { source: "Hit_Chest", id: "human/hit_chest" },
        { source: "Hit_Head", id: "human/hit_head" },
        { source: "Punch_Jab", id: "human/punch" },
        { source: "Punch_Cross", id: "human/punch_cross" },
        { source: "Interact", id: "human/use" },
        { source: "PickUp_Table", id: "human/pick" },
        { source: "Pistol_Idle_Loop", id: "human/pistol_idle" },
        { source: "Pistol_Aim_Neutral", id: "human/pistol_aim" },
        { source: "Pistol_Shoot", id: "human/pistol_fire" },
        { source: "Pistol_Reload", id: "human/pistol_reload" },
        { source: "Sword_Idle", id: "human/tool_idle" },
        { source: "Sword_Attack", id: "human/tool_swing" },
      ],
    },
    {
      raw: "quaternius/animation-library-2/UAL2_Standard.glb",
      clips: [
        { source: "TreeChopping_Loop", id: "human/chop" },
        { source: "OverhandThrow", id: "human/throw" },
        { source: "Consume", id: "human/eat" },
        { source: "Hit_Knockback", id: "human/knockback" },
        { source: "LayToIdle", id: "human/rise" },
        { source: "Melee_Hook", id: "human/hook" },
      ],
    },
  ],
} satisfies HumanClipsAsset;
