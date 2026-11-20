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
        // Emotes (shared/anim/emotes.ts LIBRARY_EMOTES).
        { source: "Dance_Loop", id: "human/emote/groove", loop: true },
        { source: "Idle_Talking_Loop", id: "human/emote/talk", loop: true },
        { source: "Fixing_Kneeling", id: "human/emote/fix", loop: true },
        { source: "Spell_Simple_Idle_Loop", id: "human/emote/magic", loop: true },
        { source: "Spell_Simple_Shoot", id: "human/emote/cast" },
        { source: "Hit_Chest", id: "human/emote/flinch" },
      ],
    },
    {
      raw: "quaternius/animation-library-2/UAL2_Standard.glb",
      clips: [
        { source: "OverhandThrow", id: "human/throw" },
        // Emotes (shared/anim/emotes.ts LIBRARY_EMOTES).
        { source: "Idle_TalkingPhone_Loop", id: "human/emote/phone", loop: true },
        { source: "Idle_FoldArms_Loop", id: "human/emote/fold_arms", loop: true },
        { source: "Zombie_Idle_Loop", id: "human/emote/zombie_idle", loop: true },
        { source: "Yes", id: "human/emote/yes" },
        { source: "Idle_No_Loop", id: "human/emote/no", loop: false },
        { source: "Consume", id: "human/emote/eat" },
        { source: "Zombie_Scratch", id: "human/emote/zombie_scratch" },
        { source: "Farm_PlantSeed", id: "human/emote/plant" },
        { source: "Farm_Watering", id: "human/emote/water_plants" },
      ],
    },
  ],
} satisfies HumanClipsAsset;
