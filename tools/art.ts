// Converts third-party art in assets/raw into what the pack build reads in assets/source. Run `bun run art` when
// the raw files or the conversion change, and commit the output. Building the game does not need it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BODY_SCALES, HAIR_STYLES, BEARD_STYLES, REGION_CLOTH, REGION_EYE, REGION_HAIR, REGION_MAIN, REGION_SECOND, REGION_SKIN, REGION_TRIM, SEX_IDS } from "../shared/anim/look.ts";
import { parsePack, type PackRig } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import { convertHumanClips, type ClipSpec } from "./pack/anim.ts";
import { readGltf, type Gltf } from "./pack/gltf.ts";
import { readPng } from "./pack/png-read.ts";
import { convertBody, type ColorRule, type MaterialRule } from "./pack/skin.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "./pack/write.ts";
import { existsSync } from "node:fs";
import type { Clip } from "../shared/anim/clip.ts";
import { ZONE_ARM_L, ZONE_ARM_R, ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../shared/anim/human.ts";
import { convertCreature, type CreatureSpec, type SkeletonSpec } from "./pack/creature.ts";

const ROOT = resolve(import.meta.dir, "..");
const RAW = join(ROOT, "assets/raw/quaternius");
export const HUMAN_CLIPS_FILE = join(ROOT, "assets/source/core/human-clips.snpk");
export const HUMAN_BODIES_FILE = join(ROOT, "assets/source/core/human-bodies.snpk");
export const CREATURES_FILE = join(ROOT, "assets/source/core/creatures.snpk");

/** Triangle counts at each level of detail. */
const BODY_TRIANGLES = "4400,1500,420";
const HAIR_TRIANGLES = "420,150,48";

// Palette indices.
const WHITE = 10;
const BLACK = 11;
/** Grey is the model's underclothes. Anything else is skin. */
const skin: ColorRule = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 0 && (max - min) / max < 0.22 ? REGION_CLOTH : REGION_SKIN;
};
const eye: ColorRule = (r, g, b) => {
  const light = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  if (light > 150 && (max - Math.min(r, g, b)) / max < 0.3) return WHITE;
  return light < 40 ? BLACK : REGION_EYE;
};
const hair: MaterialRule = { image: null, color: () => REGION_HAIR };
/** Three colour regions by lightness. The worn item supplies the colours. */
const threeTones = (dark: number, light: number): ColorRule => (r, g, b) => {
  const lum = (r + g + b) / 3;
  return lum < dark ? REGION_SECOND : lum < light ? REGION_MAIN : REGION_TRIM;
};
/** Share of an outfit's surface that is its second colour, and the share that is not its trim. */
const SECOND_SHARE = 0.28;
const TRIM_FROM = 0.9;

/** Triangle counts for each part of an outfit, at each level of detail. */
const ARMOR_TRIANGLES = "900,320,100";
const OUTFIT_FILES = [
  "Male_Peasant_Arms", "Male_Peasant_Body", "Male_Peasant_Feet", "Male_Peasant_Legs", "Male_Ranger_Arms", "Male_Ranger_Body", "Male_Ranger_Feet_Boots", "Male_Ranger_Head_Hood", "Male_Ranger_Legs",
  "Female_Peasant_Arms", "Female_Peasant_Body", "Female_Peasant_Feet", "Female_Peasant_Legs", "Female_Ranger_Arms", "Female_Ranger_Body", "Female_Ranger_Feet", "Female_Ranger_Head_Hood", "Female_Ranger_Legs",
];
/** The peasant outfit has no head part, so the cloth set borrows the ranger's hood. */
const ARMOR_SETS = [
  { id: "cloth", parts: ["Peasant_Arms", "Peasant_Body", "Peasant_Feet", "Peasant_Legs", "Ranger_Head_Hood"], texture: "T_Peasant_BaseColor.png" },
  { id: "hide", parts: ["Ranger_Arms", "Ranger_Body", "Ranger_Feet", "Ranger_Legs", "Ranger_Head_Hood"], texture: "T_Ranger_BaseColor.png" },
];

const reduced = new Map<string, Gltf>();
function reduce(dir: string, source: string, triangles: string): Gltf {
  const key = `${source} ${triangles}`;
  const done = reduced.get(key);
  if (done) return done;
  const gltf = runBlender(dir, source, triangles);
  reduced.set(key, gltf);
  return gltf;
}

function runBlender(dir: string, source: string, triangles: string): Gltf {
  const out = join(dir, `${source.replace(/[^a-z0-9]+/gi, "_")}_${triangles.replace(/,/g, "_")}.glb`);
  const run = Bun.spawnSync(["blender", "--background", "--factory-startup", "--python", join(ROOT, "tools/blender/reduce.py"), "--", join(RAW, source), out, triangles], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0 || !run.stdout.toString().includes("reduce: wrote")) {
    throw new Error(`Blender did not convert ${source}. Is it installed (brew install --cask blender)?\n${run.stdout.toString().slice(-600)}${run.stderr.toString().slice(-600)}`);
  }
  return readGltf(out);
}

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
      // Each hair and beard was modelled on one of the two heads and is fitted to this body.
      for (const [kind, styles] of [["hair", HAIR_STYLES], ["beard", BEARD_STYLES]] as const) {
        for (const style of styles) {
          if (style.source === null) continue;
          const source = (b.sex === SEX_IDS[1] && style.female) || style.source;
          const piece = convertBody(reduce(dir, `base-characters/hair/${source}.gltf`, HAIR_TRIANGLES), {
            id,
            rig,
            scale,
            materials: { MI_Hair_1: hair, MI_Hair_2: hair },
            whole: `${id}/${kind}/${style.id}`,
            onto: body.rig.rest,
          });
          warn(`${id}/${kind}/${style.id}`, piece.warnings);
          meshes.push(...piece.meshes);
        }
      }
      // An armor set is an outfit's parts together, cut by body slot and fitted to this body's joints.
      const Sex = b.sex === SEX_IDS[0] ? "Male" : "Female";
      const skinOf: MaterialRule = { image: readPng(join(RAW, `outfits-fantasy/T_Regular_${Sex}_Dark_BaseColor.png`)), color: skin };
      for (const set of ARMOR_SETS) {
        const parts = set.parts.flatMap((part) => {
          const file = OUTFIT_FILES.find((f) => f === `${Sex}_${part}` || f.startsWith(`${Sex}_${part}`));
          return file ? [reduce(dir, `outfits-fantasy/${file}.gltf`, ARMOR_TRIANGLES)] : [];
        });
        // The first pass samples how light each triangle is. The second cuts the regions at those shares.
        const image = readPng(join(RAW, `outfits-fantasy/${set.texture}`));
        const seen: number[] = [];
        const options = (color: ColorRule) => ({
          id: `${id}/armor/${set.id}`,
          rig,
          scale,
          onto: body.rig.rest,
          materials: { MI_Peasant: { image, color }, MI_Ranger: { image, color }, MI_Regular_Male: skinOf, MI_Regular_Female: skinOf },
        });
        convertBody(parts, options((r, g, bl) => (seen.push((r + g + bl) / 3), REGION_MAIN)));
        seen.sort((p, q) => p - q);
        const at = (share: number): number => seen[Math.floor((seen.length - 1) * share)] ?? 0;
        const armor = convertBody(parts, options(threeTones(at(SECOND_SHARE), at(TRIM_FROM))));
        warn(`${id}/armor/${set.id}`, armor.warnings);
        meshes.push(...armor.meshes);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { meshes, rigs };
}

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

/**
 * The pack's dinosaurs share one skeleton. The model's root never moves and its chain ends carry nothing, so both
 * are dropped. The model hangs the hind feet on that root, and here they hang on the lower legs.
 */
const DINO: SkeletonSpec = {
  id: "dino",
  root: "Body",
  drop: /^root$|_end$/,
  reparent: { "BackFoot.L": "BackLowLeg.L", "BackFoot.R": "BackLowLeg.R" },
  zones: [
    { zone: ZONE_HEAD, on: "Head", from: "Head", to: "Head_end", covers: ["Head"] },
    { zone: ZONE_TORSO, on: "Neck", from: "Neck", to: "Head", covers: ["Neck"] },
    { zone: ZONE_TORSO, on: "Body", from: "Tail1", to: "Shoulders", covers: ["Body", "Back", "Hips", "Torso", "Shoulders", "BackLeg.L", "BackLeg.R", "FrontLeg.L", "FrontLeg.R"] },
    { zone: ZONE_TORSO, on: "Tail1", from: "Tail1", to: "Tail3", covers: ["Tail1", "Tail2"] },
    { zone: ZONE_TORSO, on: "Tail3", from: "Tail3", to: "Tail5_end", covers: ["Tail3", "Tail4", "Tail5"] },
    { zone: ZONE_LEG_L, on: "BackUpLeg.L", from: "BackUpLeg.L", to: "BackFoot.L", covers: ["BackUpLeg.L", "BackLowLeg.L", "BackFoot.L"] },
    { zone: ZONE_LEG_R, on: "BackUpLeg.R", from: "BackUpLeg.R", to: "BackFoot.R", covers: ["BackUpLeg.R", "BackLowLeg.R", "BackFoot.R"] },
    { zone: ZONE_ARM_L, on: "FrontUpLeg.L", from: "FrontUpLeg.L", to: "FrontFoot.L_end", covers: ["FrontUpLeg.L", "FrontLowLeg.L", "FrontFoot.L"] },
    { zone: ZONE_ARM_R, on: "FrontUpLeg.R", from: "FrontUpLeg.R", to: "FrontFoot.R_end", covers: ["FrontUpLeg.R", "FrontLowLeg.R", "FrontFoot.R"] },
  ],
  sockets: [
    { name: "seat", bone: "Torso", of: ["Body", "Back", "Hips", "Torso", "Shoulders"], at: "top" },
    { name: "mouth", bone: "Head", of: ["Head"], at: "front" },
  ],
};
const DINO_CLIPS = (prefix: string): CreatureSpec["clips"] => [
  { source: `${prefix}_Idle`, name: "idle", loop: true },
  { source: `${prefix}_Walk`, name: "walk", loop: true },
  { source: `${prefix}_Run`, name: "run", loop: true },
  { source: `${prefix}_Attack`, name: "attack", loop: false },
  { source: `${prefix}_Jump`, name: "jump", loop: false },
  { source: `${prefix}_Death`, name: "death", loop: false },
];
const DINOSAURS: readonly { file: string; spec: CreatureSpec }[] = [
  { file: "dinosaurs/Parasaurolophus.fbx", spec: { id: "core:parasaur", scale: 0.6, regions: ["Green", "LightGreen", "LightYellow", "Red"], clips: DINO_CLIPS("Parasaurolophus") } },
  { file: "dinosaurs/Velociraptor.fbx", spec: { id: "core:raptor", scale: 0.28, regions: ["Brown", "LightBrown", "Black"], clips: DINO_CLIPS("Velociraptor") } },
];

function convertCreatures(dir: string): { meshes: SourceMesh[]; rigs: PackRig[]; clips: Clip[] } {
  const out = { meshes: [] as SourceMesh[], rigs: [] as PackRig[], clips: [] as Clip[] };
  for (const { file, spec } of DINOSAURS) {
    const glb = join(dir, `${spec.id.replace(/[^a-z0-9]+/gi, "_")}.glb`);
    const run = Bun.spawnSync(["blender", "--background", "--factory-startup", "--disable-autoexec", "--python", join(ROOT, "tools/blender/convert.py"), "--", join(RAW, file), glb], { stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0 || !existsSync(glb)) throw new Error(`Blender did not convert ${file}. Is it installed (brew install --cask blender)?\n${run.stdout.toString().slice(-600)}${run.stderr.toString().slice(-600)}`);
    const made = convertCreature(readGltf(glb), DINO, spec);
    for (const w of made.warnings) console.warn(`${file}: ${w}`);
    out.meshes.push(made.mesh);
    out.rigs.push(made.rig);
    out.clips.push(...made.clips);
    console.log(`  ${spec.id.padEnd(16)} ${made.rig.names!.length} bones, ${made.mesh.lods[0]!.indices.length / 3} triangles, ${made.rig.caps!.length / 9} capsules, clips ${made.clips.map((c) => `${c.id.split("/")[1]} ${c.frames}`).join(", ")}`);
  }
  return out;
}

if (import.meta.main && process.argv.includes("--repack")) {
  // The files again in today's pack format, made from themselves: no raw art and no Blender. How far each level lies
  // from the finest is measured afresh.
  for (const file of [HUMAN_CLIPS_FILE, HUMAN_BODIES_FILE, CREATURES_FILE]) {
    const pack = parsePack(new Uint8Array(readFileSync(file)));
    const meshes = unpackMeshes(pack).map((m) => ({ ...m, lods: m.lods.map(({ error: _, ...lod }) => lod) }));
    const again = buildPack(meshes, defaultPalette(), pack.clips.clips, pack.header.rigs);
    writeFileSync(file, again);
    console.log(`${file}\n${again.length} bytes`);
  }
} else if (import.meta.main && process.argv.includes("--creatures")) {
  const dir = mkdtempSync(join(tmpdir(), "snark-art-"));
  const made = convertCreatures(dir);
  const pack = buildPack(made.meshes, defaultPalette(), made.clips, made.rigs);
  mkdirSync(dirname(CREATURES_FILE), { recursive: true });
  writeFileSync(CREATURES_FILE, pack);
  console.log(`${CREATURES_FILE}\n${made.meshes.length} creatures, ${pack.length} bytes`);
  rmSync(dir, { recursive: true, force: true });
} else if (import.meta.main) {
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
