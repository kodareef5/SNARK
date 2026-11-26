// Converts the humanoid's clips and bodies from the packs in assets/raw. What to convert is in each asset's asset.ts.

import { join } from "node:path";
import { BEARD_STYLES, BODY_SCALES, HAIR_STYLES, REGION_CLOTH, REGION_EYE, REGION_HAIR, REGION_SKIN, SEX_IDS } from "../../shared/anim/look.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { SKIN_ZONE_SLOT } from "../../shared/anim/skin-zones.ts";
import { MATERIAL_EXHAUST, MATERIAL_INDICATOR, MATERIAL_LENS, parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { convertHumanClips } from "../pack/anim.ts";
import { readGltf, type Gltf } from "../pack/gltf.ts";
import { readPng } from "../pack/png-read.ts";
import { cookBody, restBody, RIGID_BONES, type Cooked, type CookOptions } from "../pack/body.ts";
import { bodyField, headShift, refitPiece, shiftLod, type BodyField, type HeadShift } from "../pack/refit.ts";
import { fitBody } from "../makehuman/fit.ts";
import { scriptedBody } from "../makehuman/cooked.ts";
import { convertBody, rigOf, type ColorRule, type MaterialRule } from "../pack/skin.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../pack/write.ts";
import { calibrateHand } from "../pack/grips.ts";
import type { Described } from "./materials.ts";
import { RAW, blender } from "./blender.ts";
import type { HumanBodiesAsset, HumanClipsAsset } from "./spec.ts";

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

/** How far past its budget an armor set's second level may come, made with pictures, before that level is made flat. */
const ARMOR_OVER = 1.2;

/** How far a body's own joint may sit from the rig it is fitted to, in metres. */
export const FIT_REACH = 0.003;

/** The frozen rest a body is cooked on, once its own joints (`own`) are found within FIT_REACH of it. */
export function fittedRest(own: PackRig, frozen: readonly number[]): number[] {
  if (frozen.length !== HUMAN_BONES * 3 || own.rest.length !== HUMAN_BONES * 3) throw new Error(`${own.id}: a rig has ${HUMAN_BONES * 3} numbers`);
  const off: string[] = [];
  for (let b = 0; b < HUMAN_BONES; b++) {
    const d = Math.hypot(own.rest[b * 3]! - frozen[b * 3]!, own.rest[b * 3 + 1]! - frozen[b * 3 + 1]!, own.rest[b * 3 + 2]! - frozen[b * 3 + 2]!);
    if (d > FIT_REACH) off.push(`${HUMAN.names[b]} ${(d * 1000).toFixed(1)} mm`);
  }
  if (off.length > 0) throw new Error(`${own.id}: joints sit more than ${FIT_REACH * 1000} mm from the frozen rig (rigs.ts beside the asset): ${off.join(", ")}. Fit the body to the rig; the rig does not move`);
  return [...frozen];
}

export function convertClipLibraries(spec: HumanClipsAsset): { clips: Clip[]; warnings: string[] } {
  const clips: Clip[] = [];
  const warnings: string[] = [];
  for (const library of spec.libraries) {
    const report = convertHumanClips(readGltf(join(RAW, library.raw)), library.clips);
    warnings.push(...report.warnings.map((w) => `${library.raw}: ${w}`));
    clips.push(...report.clips);
  }
  return { clips, warnings };
}

/** A cooked body's skin at its finest level, its slot meshes together: the triangles of its first material. */
function skinOf(meshes: readonly SourceMesh[]): { positions: number[]; indices: number[]; joints: number[]; weights: number[]; slots: number[] } {
  const out = { positions: [] as number[], indices: [] as number[], joints: [] as number[], weights: [] as number[], slots: [] as number[] };
  for (const mesh of meshes) {
    const lod = mesh.lods[0]!;
    const slot = SLOT_NAMES.indexOf(mesh.id.split("/").at(-1)!);
    const base = out.positions.length / 3;
    out.positions.push(...lod.positions);
    lod.bones!.forEach((b, v) => {
      for (let k = 0; k < 4; k++) {
        out.joints.push(lod.joints?.[v * 4 + k] ?? b);
        out.weights.push(lod.weights ? lod.weights[v * 4 + k]! : k === 0 ? 1 : 0);
      }
    });
    for (let t = 0; t < lod.indices.length / 3; t++) if ((lod.sections?.[t] ?? 0) === 0) {
      out.indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
      out.slots.push(slot);
    }
  }
  return out;
}

/** The source material names the primitives of `sources` are drawn with, in the order first met. */
function sourceMaterials(sources: readonly Gltf[]): string[] {
  const out: string[] = [];
  for (const g of sources) for (const mesh of g.json.meshes ?? []) for (const prim of mesh.primitives) {
    const name = g.json.materials?.[prim.material ?? -1]?.name ?? "";
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * `dir` is a folder for what Blender writes. `described` are the asset's materials by the name asset.ts gives them, the
 * tailored outfit's among them.
 */
export function convertBodies(spec: HumanBodiesAsset, dir: string, described: ReadonlyMap<string, Described>, palette: Uint8Array): { meshes: SourceMesh[]; rigs: PackRig[]; warnings: string[]; lines: string[] } {
  const raw = join(RAW, spec.raw);
  const meshes: SourceMesh[] = [];
  const rigs: PackRig[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  const warn = (what: string, list: string[]): void => list.forEach((w) => warnings.push(`${what}: ${w}`));
  const reduced = new Map<string, Gltf>();
  const reduce = (source: string, triangles: readonly number[]): Gltf => {
    const key = `${source} ${triangles}`;
    let gltf = reduced.get(key);
    if (!gltf) {
      const out = join(dir, `${source.replace(/[^a-z0-9]+/gi, "_")}_${triangles.join("_")}.glb`);
      blender("reduce.py", [join(raw, source), out, triangles.join(",")], "reduce: wrote");
      reduced.set(key, (gltf = readGltf(out)));
    }
    return gltf;
  };
  const read = new Map<string, Gltf>();
  const source = (file: string): Gltf => {
    let gltf = read.get(file);
    if (!gltf) read.set(file, (gltf = readGltf(join(raw, file))));
    return gltf;
  };
  /** The cook's sections and materials for what `sources` are drawn with: each source material's own, as `dressed` names it. */
  const dressedFor = (sources: readonly Gltf[], what: string): Pick<CookOptions, "sections" | "materials"> => {
    const names: string[] = [];
    const sections: Record<string, number> = {};
    for (const m of sourceMaterials(sources)) {
      const name = spec.dressed[m];
      if (name === undefined) continue;
      if (!names.includes(name)) names.push(name);
      sections[m] = names.indexOf(name);
    }
    const materials = names.map((name) => {
      const d = described.get(name);
      if (!d) throw new Error(`${what}: asset.ts has no material "${name}"`);
      return { material: d.material, textures: d.textures, maps: d.maps };
    });
    return { sections, materials };
  };
  const finish = spec.tailored ? described.get(spec.tailored.material) : undefined;
  if (spec.tailored && !finish) throw new Error(`human-bodies: no material "${spec.tailored.material}" for the tailored outfit`);
  if (spec.rigs.length !== spec.bodies.length) throw new Error(`human-bodies: ${spec.bodies.length} bodies and ${spec.rigs.length} rigs`);
  spec.bodies.forEach((b, sex) => {
    const scale = BODY_SCALES[sex]!;
    const id = `core:human_${SEX_IDS[sex]}`;
    const rig = `human_${SEX_IDS[sex]}`;
    const file = source(b.file);
    let body: Cooked;
    /** How hair and beards made on the Quaternius head move to sit on this body's. */
    let onHead: HeadShift | null = null;
    /** How the armor sets made on the Quaternius body move to sit on this one. */
    let onBody: BodyField | null = null;
    if (spec.body === "makehuman") {
      const mh = spec.makehuman;
      if (!mh) throw new Error("human-bodies: a MakeHuman body needs the asset's makehuman entry");
      const fitted = fitBody(sex === 0 ? "male" : "female", spec.rigs[sex]!);
      const { body: made, kept } = scriptedBody(fitted);
      const materials = [mh.skin[sex]!, mh.eyes, mh.brows].map((name) => {
        const d = described.get(name);
        if (!d) throw new Error(`${id}: asset.ts has no material "${name}"`);
        return { material: d.material, textures: d.textures, maps: d.maps };
      });
      body = cookBody(made, { id, rig, scale: 1, onto: [...spec.rigs[sex]!], zoned: true, triangles: mh.triangles, flat: spec.flat, palette, sections: {}, materials });
      const frozen = spec.rigs[sex]!;
      const was = restBody(file, { id, rig, scale, onto: fittedRest(rigOf(file, rig, scale), frozen), triangles: [], flat: 1, palette, sections: { [b.material]: 0 }, materials: [] });
      const headOf = (positions: ArrayLike<number>, indices: ArrayLike<number>, bone: (v: number) => number, keep: (t: number) => boolean) => ({
        positions,
        indices: Array.from({ length: indices.length / 3 }, (_, t) => t).filter((t) => keep(t) && [0, 1, 2].every((k) => bone(indices[t * 3 + k]!) === B_HEAD)).flatMap((t) => [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!]),
      });
      onHead = headShift(
        headOf(was.positions, was.indices, (v) => was.bones[v]!, () => true),
        headOf(fitted.positions, fitted.indices, (v) => fitted.bone[v]!, (t) => fitted.part[t] === 0),
        [frozen[B_HEAD * 3]!, frozen[B_HEAD * 3 + 1]! + 0.09, frozen[B_HEAD * 3 + 2]! + 0.02],
      );
      onBody = bodyField({ positions: was.positions, indices: was.indices }, skinOf(body.meshes), HUMAN_BONES);
      lines.push(`${id}: MakeHuman's body fitted; triangles kept by part: ${Object.entries(kept).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    } else {
      // The body is moved onto the frozen rig, as its hair and armor are below.
      const onto = fittedRest(rigOf(file, rig, scale), spec.rigs[sex]!);
      body = cookBody(file, { id, rig, scale, onto, zoned: true, triangles: spec.triangles.body, flat: spec.flat, palette, ...dressedFor([file], id) });
    }
    warn(id, body.warnings);
    meshes.push(...body.meshes);
    rigs.push(body.rig);
    // Garment cuts are made on the MakeHuman body's own surface, each cooked as a mesh of its own.
    if (spec.garments && spec.body === "makehuman") for (const g of spec.garments.make(body.meshes, id, body.rig.rest)) {
      const d = described.get(g.material);
      if (!d) throw new Error(`${g.id}: asset.ts has no material "${g.material}"`);
      const made = cookBody(g.body, { id, rig, scale: 1, onto: body.rig.rest, whole: g.id, zoned: true, triangles: g.triangles, flat: g.flat ?? spec.flat, palette, sections: {}, materials: [{ material: d.material, textures: d.textures, maps: d.maps }] });
      warn(g.id, made.warnings);
      lines.push(...g.lines.map((l) => `${id}: ${l}`));
      meshes.push(...made.meshes);
    }
    if (spec.tailored && finish) {
      // The tailored outfit is cut from the flat one-bone body it was designed on, so its counts and look stay its own.
      const eyes: MaterialRule = { image: readPng(join(raw, spec.eyes)), color: eye };
      const reducedBody = reduce(b.file, spec.triangles.tailored);
      const plain = convertBody(reducedBody, {
        id, rig, scale,
        materials: { [b.material]: { image: readPng(join(raw, b.texture)), color: skin }, MI_Eyes: eyes, MI_Hair_1: hair, MI_Hair_2: hair },
        onto: fittedRest(rigOf(reducedBody, rig, scale), spec.rigs[sex]!),
      });
      warn(`${id} tailored`, plain.warnings);
      for (const mesh of spec.tailored.make(plain.meshes, plain.rig)) {
        mesh.materials = [finish.material];
        if (spec.tailored.indicatorEmission) mesh.materials.push({ ...finish.material, id: finish.material.id + "/indicators", flags: finish.material.flags | MATERIAL_INDICATOR, emissive: spec.tailored.indicatorEmission });
        if (spec.tailored.visor) {
          mesh.materials[1] ??= finish.material;
          mesh.materials[2] = { ...finish.material, id: finish.material.id + "/visor", flags: finish.material.flags | MATERIAL_LENS };
        }
        if (spec.tailored.exhaust) {
          mesh.materials[3] = { ...finish.material, id: finish.material.id + "/exhaust", flags: MATERIAL_EXHAUST };
        }
        mesh.textures = finish.textures;
        meshes.push(mesh);
      }
    }
    // Each hair and beard was modelled on one of the two heads and is fitted to this body.
    for (const [kind, styles] of [["hair", HAIR_STYLES], ["beard", BEARD_STYLES]] as const) {
      for (const style of styles) {
        if (style.source === null) continue;
        const name = (sex === 1 && style.female) || style.source;
        const piece = source(`${spec.hair}/${name}.gltf`);
        const whole = `${id}/${kind}/${style.id}`;
        const made = cookBody(piece, { id, rig, scale, whole, onto: body.rig.rest, triangles: spec.triangles.hair, flat: spec.flat, palette, ...dressedFor([piece], whole) });
        if (onHead) for (const mesh of made.meshes) for (const lod of mesh.lods) shiftLod(lod, onHead);
        warn(whole, made.warnings);
        meshes.push(...made.meshes);
      }
    }
    // An armor set is an outfit's parts together, cut by body slot and fitted to this body's joints.
    const o = spec.outfits;
    for (const set of o.sets) {
      const parts = set.parts.flatMap((part) => {
        const name = o.files.find((f) => f === `${b.outfits}_${part}` || f.startsWith(`${b.outfits}_${part}`));
        return name ? [source(`${o.folder}/${name}.gltf`)] : [];
      });
      const armor = `${id}/armor/${set.id}`;
      const field = onBody;
      let said = "";
      const refit = field ? (piece: Parameters<typeof refitPiece>[0]) => {
        // The cloth and hide sets' hoods leave the face drawn under them.
        const r = refitPiece(piece, field, RIGID_BONES, (worn, skin) => skin !== worn || worn === SLOT_HEAD, (zone) => SKIN_ZONE_SLOT[zone]!);
        said = `${armor}: refit ${r.vertices} vertices, moved at most ${(r.most * 1000).toFixed(1)} mm; ${r.pushed} pushed out of the skin, the deepest ${(r.deepest * 1000).toFixed(1)} mm in`;
      } : undefined;
      const cook = (flat: number): Cooked => cookBody(parts, { id: armor, rig, scale, onto: body.rig.rest, triangles: spec.triangles.armor, flat, palette, refit, ...dressedFor(parts, armor) });
      let made = cook(spec.flat);
      // A set whose pictures are cut too fine to come down to its second level's budget is flat from there.
      const second = made.meshes.reduce((t, m) => t + ((m.flat ?? 0) > 1 ? m.lods[1]!.indices.length / 3 : 0), 0);
      if (spec.flat > 1 && second > spec.triangles.armor[1]! * ARMOR_OVER) {
        made = cook(1);
        lines.push(`${armor}: ${second} triangles drawn with pictures at its second level for a budget of ${spec.triangles.armor[1]}; flat from there`);
      }
      if (said) lines.push(said);
      warn(armor, made.warnings);
      meshes.push(...made.meshes);
    }
  });
  // A material is measured on each piece it is cooked on; it spans what the widest measure says, on all of them.
  const span = new Map<string, number>();
  for (const m of meshes.flatMap((mesh) => mesh.materials ?? [])) span.set(m.id, Math.max(span.get(m.id) ?? 0, m.span));
  for (const mesh of meshes) if (mesh.materials) mesh.materials = mesh.materials.map((m) => ({ ...m, span: span.get(m.id)! }));
  // Calibrate the exact positions the native quantizer will ship, once at source build. Ordinary repacks/boot
  // streaming preserve these compact tables and never run the offline search.
  const native = parsePack(buildPack(meshes.filter(m => m.id.endsWith("/hands")), defaultPalette(), [], rigs));
  for (const mesh of unpackMeshes(native)) {
    const rig = rigs.find(r => r.id === mesh.rig)!;
    const result = calibrateHand(mesh, Float32Array.from(rig.rest));
    if (result.checks.some(c => !Number.isFinite(c.clearance + c.gap) || c.clearance < 0 || Math.max(...c.contacts) > .002)) throw new Error(`${mesh.id}: native grip calibration failed physical contact`);
    (rig.grips ??= []).push(result.calibration);
  }
  return { meshes, rigs, warnings, lines };
}
