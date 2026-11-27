// Converts the humanoid's clips and bodies from the packs in assets/raw. What to convert is in each asset's asset.ts.

import { join } from "node:path";
import { BODY_SCALES, SEX_IDS } from "../../shared/anim/look.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { B_TOE_L, B_TOE_R, HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_FEET, SLOT_HANDS, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { SKIN_ZONE_SLOT } from "../../shared/anim/skin-zones.ts";
import { MATERIAL_EXHAUST, MATERIAL_INDICATOR, MATERIAL_LENS, parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { convertHumanClips } from "../pack/anim.ts";
import { readGltf, type Gltf } from "../pack/gltf.ts";
import { cookBody, restBody, RIGID_BONES, type Cooked, type CookOptions } from "../pack/body.ts";
import { bodyField, REFIT_CLEAR, refitPiece, shiftAt, skinWeightsAt, type BodyField } from "../pack/refit.ts";
import { clearOf, line, liningOf, skinLevel } from "../pack/liner.ts";
import { humanAnim, motionSet } from "./cloth-fit.ts";
import { easeInMotion } from "./ease-fit.ts";
import { fitBody } from "../makehuman/fit.ts";
import { fittedSourceOf, scriptedBody } from "../makehuman/cooked.ts";
import { cookFaces } from "../makehuman/faces.ts";
import { encodeFaces, remapFaces } from "../../shared/people/faces.ts";
import { rigOf } from "../pack/skin.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import { calibrateHand } from "../pack/grips.ts";
import type { Described } from "./materials.ts";
import { RAW } from "./blender.ts";
import type { HumanBodiesAsset, HumanClipsAsset } from "./spec.ts";

/** The materials every hair and beard is drawn with (assets/source/core/humans/hair/), by their names in asset.ts. */
const HAIR_MATERIALS = ["hair_core", "hair_cards"] as const;

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

/**
 * Whether a slot's piece is lined. A hood leaves the head drawn under it; a boot stands in for the whole foot, as its
 * soles are found on its lowest points and the new foot's toes may come through its calibrated shell.
 */
const linedSlot = (slot: string): boolean => slot !== SLOT_NAMES[SLOT_HEAD] && slot !== SLOT_NAMES[SLOT_FEET];

/** The rigid bones of the hands, whose glove vertices a refit leaves where they were. */
const HAND_BONES: ReadonlySet<number> = new Set([...RIGID_BONES].filter((b) => HUMAN.slot[b] === SLOT_HANDS));

/** A cooked body's skin at its finest level, its slot meshes together: the triangles drawn with its skin. */
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
    for (let t = 0; t < lod.indices.length / 3; t++) if (/skin/.test(mesh.materials?.[lod.sections?.[t] ?? 0]?.id ?? "skin")) {
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

/** The cook's sections and materials for what `sources` are drawn with: each source material's own, as `spec.dressed` names it. */
function dressed(spec: HumanBodiesAsset, described: ReadonlyMap<string, Described>, sources: readonly Gltf[], what: string, leave: readonly string[] = []): Pick<CookOptions, "sections" | "materials"> {
  const names: string[] = [];
  const sections: Record<string, number> = {};
  for (const m of sourceMaterials(sources)) {
    const name = spec.dressed[m];
    if (name === undefined || leave.includes(m)) continue;
    if (!names.includes(name)) names.push(name);
    sections[m] = names.indexOf(name);
  }
  const materials = names.map((name) => {
    const d = described.get(name);
    if (!d) throw new Error(`${what}: asset.ts has no material "${name}"`);
    return { material: d.material, textures: d.textures, maps: d.maps };
  });
  return { sections, materials };
}

/** How the armor sets made on the Quaternius body `sex` move to sit on the cooked body `meshes`, resting on the frozen rig. */
export function armorField(spec: HumanBodiesAsset, sex: number, meshes: readonly SourceMesh[], palette: Uint8Array): BodyField {
  const b = spec.bodies[sex]!;
  const file = readGltf(join(RAW, spec.raw, b.file));
  const rig = `human_${SEX_IDS[sex]}`;
  const was = restBody(file, { id: `core:human_${SEX_IDS[sex]}`, rig, scale: BODY_SCALES[sex]!, onto: fittedRest(rigOf(file, rig, BODY_SCALES[sex]!), spec.rigs[sex]!), triangles: [], flat: 1, palette, sections: { [b.material]: 0 }, materials: [] });
  return bodyField({ positions: was.positions, indices: was.indices }, skinOf(meshes), HUMAN_BONES);
}

/**
 * The armor sets on body `sex`, each an outfit's parts together, cut by body slot and fitted to the body's joints at
 * `rest`; moved onto it by `field` where given.
 */
export function armorSets(spec: HumanBodiesAsset, sex: number, rest: readonly number[], field: BodyField | null, described: ReadonlyMap<string, Described>, palette: Uint8Array, lines: string[], warnings: string[], body: readonly SourceMesh[] = []): SourceMesh[] {
  const b = spec.bodies[sex]!;
  const id = `core:human_${SEX_IDS[sex]}`;
  const rig = `human_${SEX_IDS[sex]}`;
  const scale = BODY_SCALES[sex]!;
  const o = spec.outfits;
  const out: SourceMesh[] = [];
  for (const set of o.sets) {
    const parts = set.parts.flatMap((part) => {
      const name = o.files.find((f) => f === `${b.outfits}_${part}` || f.startsWith(`${b.outfits}_${part}`));
      return name ? [readGltf(join(RAW, spec.raw, `${o.folder}/${name}.gltf`))] : [];
    });
    const armor = `${id}/armor/${set.id}`;
    let said = "";
    const refit = field ? (piece: Parameters<typeof refitPiece>[0]) => {
      // Every slot's skin may be drawn beside a piece: its own where the piece is lined, the face under a hood.
      const r = refitPiece(piece, field, RIGID_BONES, () => true, (zone) => SKIN_ZONE_SLOT[zone]!);
      said = `${armor}: refit ${r.vertices} vertices, moved at most ${(r.most * 1000).toFixed(1)} mm; ${r.pushed} pushed out of the skin, the deepest ${(r.deepest * 1000).toFixed(1)} mm in`;
    } : undefined;
    const cook = (flat: number): Cooked => cookBody(parts, { id: armor, rig, scale, onto: rest, triangles: spec.triangles.armor, flat, palette, refit, leave: o.skin, ...dressed(spec, described, parts, armor, o.skin) });
    let made = cook(spec.flat);
    // A set whose pictures are cut too fine to come down to its second level's budget is flat from there.
    const second = made.meshes.reduce((t, m) => t + ((m.flat ?? 0) > 1 ? m.lods[1]!.indices.length / 3 : 0), 0);
    if (spec.flat > 1 && second > spec.triangles.armor[1]! * ARMOR_OVER) {
      made = cook(1);
      lines.push(`${armor}: ${second} triangles drawn with pictures at its second level for a budget of ${spec.triangles.armor[1]}; flat from there`);
    }
    if (said) lines.push(said);
    warnings.push(...made.warnings.map((w) => `${armor}: ${w}`));
    // Its levels, made after it was fitted, are kept clear of the skin of theirs, but where it stands in for a hand or a foot.
    if (body.length > 0) {
      const skins = made.meshes[0]!.lods.map((_, level) => skinLevel(body, level));
      let moved = 0;
      for (const mesh of made.meshes) mesh.lods.forEach((lod, level) => {
        const held = (v: number): boolean => HAND_BONES.has(lod.bones![v]!) && (!lod.weights || lod.weights[v * 4]! >= 0.999);
        moved += clearOf(lod, skins[level]!, REFIT_CLEAR, held);
      });
      lines.push(`${armor}: ${moved} vertices of its levels moved clear of the skin`);
    }
    // Let out where skin drawn beside it comes through it in the game's motion.
    if (body.length > 0) {
      const poses = motionSet(humanAnim(), Float32Array.from(rest), true);
      for (const mesh of made.meshes) {
        const slot = mesh.id.split("/").at(-1)!;
        const bare = body.find((m) => m.id === `${id}/${slot}`);
        const lined = bare && linedSlot(slot) ? liningOf(mesh, bare) : () => -1;
        const held = (lod: SourceLod, v: number): boolean => HAND_BONES.has(lod.bones![v]!) && (!lod.weights || lod.weights[v * 4]! >= 0.999);
        const r = easeInMotion(mesh, body, Float32Array.from(rest), poses, lined, held);
        lines.push(`${mesh.id}: let out at most ${(r.most * 1000).toFixed(1)} mm in motion; skin came through it ${r.deepest.map((d) => (d * 1000).toFixed(1)).join(", ")} mm by round`);
      }
    }
    // A piece stands in for its slot's skin: the body's own is put in where the piece leaves it showing.
    for (const mesh of made.meshes) {
      const slot = mesh.id.split("/").at(-1)!;
      const bare = body.find((m) => m.id === `${id}/${slot}`);
      if (!bare || !linedSlot(slot)) continue;
      const lined = line(mesh, bare);
      lines.push(`${mesh.id}: lined with ${lined.added.join(" / ")} triangles of the body's skin, ${lined.underwearShows} of underwear where it shows`);
    }
    // A slot whose part of the outfit was all skin is the body's own: an item worn there still has its piece.
    for (const slot of SLOT_NAMES.slice(0, SLOT_COUNT)) {
      const bare = body.find((m) => m.id === `${id}/${slot}`);
      if (!bare || slot === SLOT_NAMES[SLOT_HEAD] || made.meshes.some((m) => m.id === `${armor}/${slot}`)) continue;
      made.meshes.push({ ...bare, id: `${armor}/${slot}`, lods: bare.lods.map(({ zones: _, ...lod }) => ({ ...lod })) });
      lines.push(`${armor}/${slot}: the body's own skin, the outfit having none of its own there`);
    }
    out.push(...made.meshes);
  }
  return out;
}

/**
 * The body's slot meshes a suit is lined with, three levels each: each of its levels takes the body's next, as the old
 * suit's lining was cut from a coarser body than the one beside it, and its seams with a bare slot near by are a level
 * apart (the neck's is held at every level).
 */
export function suitLining(meshes: readonly SourceMesh[]): SourceMesh[] {
  return meshes.map((m) => ({ ...m, lods: [1, 2, 3].map((k) => (m.id.endsWith("/feet") ? toeless(m.lods[k]!) : m.lods[k]!)) }));
}

/** A foot's skin without its toes, which the boot's toe cap stands in for, so the sole is found on the boot. */
function toeless(lod: SourceLod): SourceLod {
  const keep: number[] = [];
  for (let t = 0; t < lod.indices.length / 3; t++) {
    const c = [lod.indices[t * 3]!, lod.indices[t * 3 + 1]!, lod.indices[t * 3 + 2]!];
    if (!c.every((v) => lod.bones![v] === B_TOE_L || lod.bones![v] === B_TOE_R)) keep.push(t);
  }
  return { ...lod, indices: Uint32Array.from(keep.flatMap((t) => [lod.indices[t * 3]!, lod.indices[t * 3 + 1]!, lod.indices[t * 3 + 2]!])), ...(lod.sections ? { sections: Uint8Array.from(keep, (t) => lod.sections![t]!) } : {}), ...(lod.zones ? { zones: Uint8Array.from(keep, (t) => lod.zones![t]!) } : {}) };
}

/**
 * Keeps a suit's plates clear of the skin of each level, as cloth and hide are; its lining, the body's own skin, stays,
 * and so do its gloves and boots, on which grips and soles are found.
 */
export function suitClear(suit: SourceMesh[], body: readonly SourceMesh[], lines: string[]): void {
  const at = (lod: SourceLod, v: number): string => `${lod.positions[v * 3]},${lod.positions[v * 3 + 1]},${lod.positions[v * 3 + 2]}`;
  const lining = new Set(suitLining(body).flatMap((m) => m.lods.flatMap((lod) => Array.from({ length: lod.positions.length / 3 }, (_, v) => at(lod, v)))));
  for (const mesh of suit) {
    if (!/\/armor\/[^/]+\/(head|torso|legs)$/.test(mesh.id)) continue;
    let moved = 0;
    mesh.lods.forEach((lod, level) => (moved += clearOf(lod, skinLevel(body, level), REFIT_CLEAR, (v) => lining.has(at(lod, v)))));
    lines.push(`${mesh.id}: ${moved} vertices moved clear of the skin`);
  }
}

/** A tailored outfit's mesh with its finish's materials: the finish, its indicators, its visor and its exhaust. */
export function dressTailored(spec: HumanBodiesAsset, mesh: SourceMesh, finish: Described): SourceMesh {
  const t = spec.tailored!;
  mesh.materials = [finish.material];
  if (t.indicatorEmission) mesh.materials.push({ ...finish.material, id: finish.material.id + "/indicators", flags: finish.material.flags | MATERIAL_INDICATOR, emissive: t.indicatorEmission });
  if (t.visor) {
    mesh.materials[1] ??= finish.material;
    mesh.materials[2] = { ...finish.material, id: finish.material.id + "/visor", flags: finish.material.flags | MATERIAL_LENS };
  }
  if (t.exhaust) mesh.materials[3] = { ...finish.material, id: finish.material.id + "/exhaust", flags: MATERIAL_EXHAUST };
  mesh.textures = finish.textures;
  return mesh;
}

/** `described` are the asset's materials by the name asset.ts gives them, the tailored outfit's among them. */
export function convertBodies(spec: HumanBodiesAsset, _dir: string, described: ReadonlyMap<string, Described>, palette: Uint8Array): { meshes: SourceMesh[]; rigs: PackRig[]; warnings: string[]; lines: string[] } {
  const meshes: SourceMesh[] = [];
  const rigs: PackRig[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  const warn = (what: string, list: string[]): void => list.forEach((w) => warnings.push(`${what}: ${w}`));
  const finish = spec.tailored ? described.get(spec.tailored.material) : undefined;
  if (spec.tailored && !finish) throw new Error(`human-bodies: no material "${spec.tailored.material}" for the tailored outfit`);
  if (spec.rigs.length !== spec.bodies.length) throw new Error(`human-bodies: ${spec.bodies.length} bodies and ${spec.rigs.length} rigs`);
  const mh = spec.makehuman;
  const [hairCore, hairCards] = HAIR_MATERIALS.map((name) => {
    const d = described.get(name);
    if (!d) throw new Error(`human-bodies: asset.ts has no material "${name}"`);
    return { material: d.material, textures: d.textures, maps: d.maps };
  });
  spec.bodies.forEach((_, sex) => {
    const id = `core:human_${SEX_IDS[sex]}`;
    const rig = `human_${SEX_IDS[sex]}`;
    const fitted = fitBody(sex === 0 ? "male" : "female", spec.rigs[sex]!);
    const { body: made, kept } = scriptedBody(fitted);
    const materials = [mh.skin[sex]!, mh.eyes, mh.brows].map((name) => {
      const d = described.get(name);
      if (!d) throw new Error(`${id}: asset.ts has no material "${name}"`);
      return { material: d.material, textures: d.textures, maps: d.maps };
    });
    const body = cookBody(made, { id, rig, scale: 1, onto: [...spec.rigs[sex]!], zoned: true, triangles: mh.triangles, flat: spec.flat, palette, sections: {}, materials });
    // The armor sets and the suit are made on the Quaternius body: this moves them to sit on MakeHuman's.
    const field = armorField(spec, sex, body.meshes, palette);
    lines.push(`${id}: MakeHuman's body fitted; triangles kept by part: ${Object.entries(kept).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    warn(id, body.warnings);
    meshes.push(...body.meshes);
    rigs.push(body.rig);
    {
      // The head's face table goes with it, its vertices those of its finest level (shared/people/faces.ts).
      const head = body.meshes.find((m) => m.id === `${id}/head`);
      if (!head) throw new Error(`${id}: no head mesh for the face table`);
      const faces = cookFaces(sex === 0 ? "male" : "female", spec.rigs[sex]!);
      const from = fittedSourceOf(head.lods[0]!.positions, fitted);
      const lost = from.reduce((n, v) => n + (v < 0 ? 1 : 0), 0);
      if (lost > 0) throw new Error(`${id}/head: ${lost} vertices of its finest level are not the fitted body's, so no face reaches them`);
      head.faces = encodeFaces(remapFaces(faces.table, from));
      lines.push(`${id}/head: face table ${head.faces.length} bytes; sides kept below 100%: ${faces.modifiers.flatMap((m) => m.kept.flatMap((k, s) => (k < 0.995 ? [`${m.name} ${s ? "+" : "-"}${(k * 100).toFixed(0)}%`] : []))).join(", ") || "none"}`);
    }
    // Garment cuts are made on the MakeHuman body's own surface, each cooked as a mesh of its own.
    if (spec.garments) for (const g of spec.garments.make(body.meshes, id, body.rig.rest)) {
      const d = described.get(g.material);
      if (!d) throw new Error(`${g.id}: asset.ts has no material "${g.material}"`);
      const made = cookBody(g.body, { id, rig, scale: 1, onto: body.rig.rest, whole: g.id, zoned: true, triangles: g.triangles, flat: g.flat ?? spec.flat, printArea: g.print, palette, sections: {}, materials: [{ material: d.material, textures: d.textures, maps: d.maps }] });
      warn(g.id, made.warnings);
      lines.push(...g.lines.map((l) => `${id}: ${l}`));
      meshes.push(...made.meshes);
    }
    if (spec.tailored && finish) {
      // The suit's lining is the cooked body's own skin, a level coarser, and its plates, drawn on the Quaternius body,
      // move as the skin under them moved.
      const made = spec.tailored.make(suitLining(body.meshes), body.rig, (p) => shiftAt(field, p), (p) => skinWeightsAt(field, p, RIGID_BONES));
      suitClear(made, body.meshes, lines);
      for (const mesh of made) meshes.push(dressTailored(spec, mesh, finish));
    }
    // Hair and beards are made on the MakeHuman head by the asset's own script.
    const styled = spec.hair.make(fitted, sex, id, rig, hairCore!, hairCards!, spec.triangles.hair, spec.flat);
    meshes.push(...styled.meshes);
    lines.push(...styled.lines);
    meshes.push(...armorSets(spec, sex, body.rig.rest, field, described, palette, lines, warnings, body.meshes));
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
