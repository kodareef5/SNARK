// Converts third-party art in assets/raw into what the pack build reads in
// assets/source. Run it when the raw files or the conversion change, and
// commit what it writes; building the game does not need it.
//
//   bun run art

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BODY_SCALES, HAIR_STYLES, BEARD_STYLES, REGION_CLOTH, REGION_EYE, REGION_HAIR, REGION_SKIN, SEX_IDS } from "../shared/anim/look.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import { convertHumanClips, type ClipSpec } from "./pack/anim.ts";
import { readGltf, type Gltf } from "./pack/gltf.ts";
import { readPng } from "./pack/png-read.ts";
import { convertBody, type ColorRule, type MaterialRule } from "./pack/skin.ts";
import { buildPack, type SourceMesh } from "./pack/write.ts";

const ROOT = resolve(import.meta.dir, "..");
const RAW = join(ROOT, "assets/raw/quaternius");
export const HUMAN_CLIPS_FILE = join(ROOT, "assets/source/core/human-clips.snpk");
export const HUMAN_BODIES_FILE = join(ROOT, "assets/source/core/human-bodies.snpk");

/** Triangles a whole body, a head of hair and a beard get at each level of detail. */
const BODY_TRIANGLES = "4400,1500,420";
const HAIR_TRIANGLES = "420,150,48";

// Colour rules: what a texture's colour means in the game's palette.
const WHITE = 10;
const BLACK = 11;
/** Skin, unless it is the grey of what the model wears under everything else. */
const skin: ColorRule = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 0 && (max - min) / max < 0.22 ? REGION_CLOTH : REGION_SKIN;
};
/** The white of an eye, its pupil, and between them the iris. */
const eye: ColorRule = (r, g, b) => {
  const light = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  if (light > 150 && (max - Math.min(r, g, b)) / max < 0.3) return WHITE;
  return light < 40 ? BLACK : REGION_EYE;
};
const hair: MaterialRule = { image: null, color: () => REGION_HAIR };

/** Run Blender over a source file and read what it wrote. */
function reduce(dir: string, source: string, triangles: string): Gltf {
  const out = join(dir, `${source.replace(/[^a-z0-9]+/gi, "_")}.glb`);
  const run = Bun.spawnSync(["blender", "--background", "--factory-startup", "--python", join(ROOT, "tools/blender/reduce.py"), "--", join(RAW, source), out, triangles], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0 || !run.stdout.toString().includes("reduce: wrote")) {
    throw new Error(`Blender did not convert ${source}. Is it installed (brew install --cask blender)?\n${run.stdout.toString().slice(-600)}${run.stderr.toString().slice(-600)}`);
  }
  return readGltf(out);
}

/** Both bodies cut into slots, and every hair and beard fitted to each. */
function convertBodies(): { meshes: SourceMesh[]; rigs: PackRig[] } {
  const dir = mkdtempSync(join(tmpdir(), "snark-art-"));
  const meshes: SourceMesh[] = [];
  const rigs: PackRig[] = [];
  const warn = (what: string, list: string[]): void => list.forEach((w) => console.warn(`${what}: ${w}`));
  const eyes: MaterialRule = { image: readPng(join(RAW, "base-characters/T_Eye_Brown.png")), color: eye };
  try {
    const bodies = [
      { sex: SEX_IDS[0]!, file: "base-characters/Superhero_Male_FullBody.gltf", material: "MI_Superhero_Male", texture: "base-characters/T_Superhero_Male_Ligh.png" },
      { sex: SEX_IDS[1]!, file: "base-characters/Superhero_Female_FullBody.gltf", material: "MI_Superhero_Female", texture: "base-characters/T_Superhero_Female_Light_BaseColor.png" },
    ];
    for (const b of bodies) {
      const scale = BODY_SCALES[SEX_IDS.indexOf(b.sex)]!;
      const id = `core:human_${b.sex}`;
      const rig = `human_${b.sex}`;
      const body = convertBody(reduce(dir, b.file, BODY_TRIANGLES), {
        id,
        rig,
        scale,
        materials: { [b.material]: { image: readPng(join(RAW, b.texture)), color: skin }, MI_Eyes: eyes, MI_Hair_1: hair, MI_Hair_2: hair },
      });
      warn(id, body.warnings);
      meshes.push(...body.meshes);
      rigs.push(body.rig);
      // Hair and beards are modelled on one head or the other; each is fitted to this one.
      for (const [kind, styles] of [["hair", HAIR_STYLES], ["beard", BEARD_STYLES]] as const) {
        for (const style of styles) {
          if (style.source === null) continue;
          const source = (b.sex === SEX_IDS[1] && style.female) || style.source;
          const piece = convertBody(reduce(dir, `base-characters/hair/${source}.gltf`, HAIR_TRIANGLES), {
            id,
            rig,
            scale,
            materials: { MI_Hair_1: hair, MI_Hair_2: hair },
            whole: { id: `${id}/${kind}/${style.id}`, onto: body.rig.rest },
          });
          warn(`${id}/${kind}/${style.id}`, piece.warnings);
          meshes.push(...piece.meshes);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { meshes, rigs };
}

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

  const t1 = performance.now();
  const bodies = convertBodies();
  const bodyPack = buildPack(bodies.meshes, defaultPalette(), [], bodies.rigs);
  writeFileSync(HUMAN_BODIES_FILE, bodyPack);
  for (const m of bodies.meshes) console.log(`  ${m.id.padEnd(34)} ${m.lods.map((l) => String(l.indices.length / 3).padStart(5)).join(" ")} triangles`);
  console.log(`${HUMAN_BODIES_FILE}\n${bodies.meshes.length} meshes, ${bodyPack.length} bytes, ${((performance.now() - t1) / 1000).toFixed(1)} s`);
}
