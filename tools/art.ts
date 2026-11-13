// Converts third-party art in assets/raw into what the pack build reads in
// assets/source. Run it when the raw files or the conversion change, and
// commit what it writes; building the game does not need it.
//
//   bun run art

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultPalette } from "../shared/pack/palette.ts";
import { convertHumanClips, type ClipSpec } from "./pack/anim.ts";
import { readGltf } from "./pack/gltf.ts";
import { buildPack } from "./pack/write.ts";

const ROOT = resolve(import.meta.dir, "..");
const RAW = join(ROOT, "assets/raw/quaternius");
export const HUMAN_CLIPS_FILE = join(ROOT, "assets/source/core/human-clips.snpk");

/** Clips taken from each animation library, and the ids they get. */
const LIBRARY_1: readonly ClipSpec[] = [
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
];
const LIBRARY_2: readonly ClipSpec[] = [
  { source: "TreeChopping_Loop", id: "human/chop" },
  { source: "OverhandThrow", id: "human/throw" },
  { source: "Consume", id: "human/eat" },
  { source: "Hit_Knockback", id: "human/knockback" },
  { source: "LayToIdle", id: "human/rise" },
  { source: "Melee_Hook", id: "human/hook" },
];

if (import.meta.main) {
  const t0 = performance.now();
  const clips = [];
  for (const [file, specs] of [["animation-library/UAL1_Standard.glb", LIBRARY_1], ["animation-library-2/UAL2_Standard.glb", LIBRARY_2]] as const) {
    const report = convertHumanClips(readGltf(join(RAW, file)), specs);
    for (const w of report.warnings) console.warn(`${file}: ${w}`);
    clips.push(...report.clips);
  }
  const pack = buildPack([], defaultPalette(), clips);
  mkdirSync(dirname(HUMAN_CLIPS_FILE), { recursive: true });
  writeFileSync(HUMAN_CLIPS_FILE, pack);
  for (const c of clips) console.log(`  ${c.id.padEnd(22)} ${String(c.frames).padStart(4)} frames${c.loop ? "  loop" : ""}`);
  console.log(`${HUMAN_CLIPS_FILE}\n${clips.length} clips, ${pack.length} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
}
