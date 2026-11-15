// Builds one asset from its source: Blender where the source needs it, then the conversion for its kind.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clip } from "../../shared/anim/clip.ts";
import { B_PROP_L, B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { MOST_SECTIONS, parsePack, type PackMaterial, type PackRig, type PackTexture } from "../../shared/pack/pack.ts";
import { RAMP_BASE, SKIN_BASE, defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { LAST_STEP, TEXTURE_ROLES, stepSize } from "../../shared/pack/texture.ts";
import { convertCreature, withMotion } from "../pack/creature.ts";
import { importGlb } from "../pack/glb.ts";
import { readGltf } from "../pack/gltf.ts";
import { lying } from "../pack/lying.ts";
import { withLevels, withSurfaceLevels } from "../pack/simplify.ts";
import { spanOf, tangentsOf } from "../pack/surface.ts";
import type { MaterialMaps } from "../pack/texture.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import type { Asset } from "./assets.ts";
import { RAW, blender, withScratch } from "./blender.ts";
import { convertBodies, convertClipLibraries } from "./human.ts";
import { describe, materialsOf, type Described } from "./materials.ts";
import type { CreatureAsset, PieceSpec, PiecesAsset, SkyAsset, WaterAsset } from "./spec.ts";

export interface Built {
  meshes: SourceMesh[];
  rigs: PackRig[];
  clips: Clip[];
  /** What was made, a line each, for the console. */
  lines: string[];
  warnings: string[];
  /** What would draw wrong. An asset with any is not written. */
  faults: string[];
}

const triangles = (m: SourceMesh): string => m.lods.map((l, i) => `${String(l.indices.length / 3).padStart(5)}${i < (m.flat ?? 0) ? "*" : " "}`).join("");

/** An asset's materials as its pack will have them, by the name its model gives each. Their pictures are read here, once. */
function described(asset: Asset & { spec: CreatureAsset | PiecesAsset }, palette: Uint8Array, out: Built): Map<string, Described> {
  const made = new Map(materialsOf(asset).map((m) => [m.name, describe(m, asset.spec.budgets.texture?.top ?? stepSize(LAST_STEP), palette)]));
  for (const d of made.values()) out.faults.push(...d.faults);
  return made;
}

/**
 * `mesh` with the asset's materials in place of those it came with, by name, and the textures they name. `names` are
 * the names of the materials it came with, in their order. One the asset says nothing of stays as it came.
 */
function withMaterials(mesh: SourceMesh, names: readonly string[], made: ReadonlyMap<string, Described>): { mesh: SourceMesh; maps: MaterialMaps[] } {
  const textures: PackTexture[] = [];
  const materials = names.map((name, k): PackMaterial => {
    const d = made.get(name);
    if (!d) return mesh.materials![k]!;
    const material = { ...d.material };
    for (const role of TEXTURE_ROLES) if (material[role] >= 0) material[role] += textures.length;
    textures.push(...d.textures);
    return material;
  });
  return { mesh: { ...mesh, materials, textures }, maps: names.map((name) => made.get(name)?.maps ?? {}) };
}

/** Gives each material that does not say how far it tiles the span measured on the meshes it is on: the widest, where they differ. */
function measureSpans(meshes: readonly SourceMesh[]): void {
  const span = new Map<string, number>();
  for (const mesh of meshes) {
    if (!mesh.flat) continue;
    mesh.materials!.forEach((m, k) => {
      const used = mesh.lods[0]!.sections ? mesh.lods[0]!.sections.includes(k) : k === 0;
      if (used && m.span === 0) span.set(m.id, Math.max(span.get(m.id) ?? 0, spanOf(mesh.lods[0]!, k)));
    });
  }
  for (const mesh of meshes) for (const m of mesh.materials ?? []) if (m.span === 0) m.span = span.get(m.id) ?? 1;
}

/** What is wrong with a mesh's surface that conversion can tell: too many materials, or tangents that had to be worked out across a mirror seam. */
function surfaceFaults(mesh: SourceMesh): string[] {
  const faults: string[] = [];
  mesh.lods.slice(0, mesh.flat ?? 0).forEach((lod, level) => {
    const used = new Set(lod.sections ?? [0]).size;
    if (used > MOST_SECTIONS) faults.push(`${mesh.id} level ${level}: drawn with ${used} materials, and a level may be drawn with ${MOST_SECTIONS}`);
    if (lod.tangents || !lod.uvs || !lod.normals) return;
    const mixed: number[] = [];
    tangentsOf({ positions: lod.positions, indices: lod.indices, uvs: lod.uvs, normals: lod.normals }, mixed);
    if (mixed.length > 0) faults.push(`${mesh.id} level ${level}: the model has no tangents, and ${mixed.length} of its vertices are shared by triangles that lay the picture both ways round (the first at ${[...lod.positions.subarray(mixed[0]! * 3, mixed[0]! * 3 + 3)].map((v) => v.toFixed(3)).join(", ")}): one side of each would be lit wrongly`);
  });
  return faults;
}

/**
 * A creature from the model Blender wrote of it: its rig, its clips, and its mesh with all its levels. Blender is not
 * needed from here on, so a test can call this on a model written in code.
 */
export function convertModel(asset: Asset & { spec: CreatureAsset }, glb: string, out: Built): void {
  const spec = asset.spec;
  const palette = defaultPalette();
  const made = convertCreature(readGltf(glb), asset.id, spec);
  const pictured = described(asset, palette, out);
  let mesh: SourceMesh;
  if (pictured.size === 0) mesh = withLevels(made.mesh); // A model that brings one level gets the rest from ours.
  else {
    // The finest level is the model's, and the rest are made from it in the colours its pictures give them.
    const first = withMaterials({ ...made.mesh, flat: 1, materials: [] }, [...pictured.keys()], pictured);
    measureSpans([first.mesh]);
    out.faults.push(...surfaceFaults(first.mesh));
    const budgets = spec.budgets.triangles.slice(1);
    mesh = withSurfaceLevels(first.mesh, { budgets, flat: spec.flat ?? Math.max(1, budgets.length), maps: first.maps, palette });
  }
  out.meshes.push(mesh);
  out.rigs.push(made.rig);
  out.clips.push(...made.clips);
  out.warnings.push(...made.warnings);
  out.faults.push(...made.faults);
  const w = made.weights;
  out.lines.push(`${made.rig.names!.length} bones, ${made.rig.caps!.length / 9} capsules, triangles ${triangles(mesh).trim()}`);
  out.lines.push(`weights: ${w.vertices} vertices, ${w.none} on no joint, ${w.over} on more than four, ${w.shared} shared between joints${pictured.size === 0 ? " and drawn on the heaviest" : ""}`);
  out.lines.push(`clips ${made.clips.map((c) => `${c.id.split("/")[1]} ${c.frames}`).join(", ")}`);
}

/** `mesh` with the errors its piece states for its levels after the finest. The rest are measured when it is written. */
function withStated(mesh: SourceMesh, errors: readonly number[] | undefined, faults: string[]): SourceMesh {
  if (!errors) return mesh;
  if (errors.length > mesh.lods.length - 1) faults.push(`${mesh.id}: it states errors for ${errors.length} levels after the finest, and has ${mesh.lods.length - 1}`);
  if (errors.some((e) => !(e > 0))) faults.push(`${mesh.id}: a stated error is not above 0`);
  return { ...mesh, lods: mesh.lods.map((lod, level) => (level > 0 && errors[level - 1] !== undefined ? { ...lod, error: errors[level - 1] } : lod)) };
}

/** The prop bone of the hand a piece is held in. */
export const HOLD_BONES = { prop_r: B_PROP_R, prop_l: B_PROP_L } as const;

/**
 * A rigid piece as an item held in the hand: on the human skeleton, every vertex on the prop bone of that hand, as
 * tools/pack/weapons.ts makes the boxes. The character renderer draws it at that bone, offset to where the bone rests on
 * the body that holds it, so the grip modelled at the origin is in the palm.
 */
export function heldOn(mesh: SourceMesh, hold: NonNullable<PieceSpec["hold"]>): SourceMesh {
  const bone = HOLD_BONES[hold];
  const lods = mesh.lods.map(({ joints: _j, weights: _w, ...lod }) => ({ ...lod, bones: new Uint8Array(lod.positions.length / 3).fill(bone) }));
  return { ...mesh, lods, skeleton: HUMAN.id };
}

/** The pieces a pieces asset converts: its own, and the lying piece of each whose `dropped` names an object of its own. */
export function piecesOf(spec: PiecesAsset): PieceSpec[] {
  return spec.pieces.flatMap((p) => (p.dropped !== undefined && p.dropped !== "auto" ? [p, { id: `${p.id}/dropped`, object: p.dropped }] : [p]));
}

/**
 * Rigid pieces from the file Blender wrote of each, by the name of its object. An item's piece that is held is put on
 * the hand's prop bone, and one dropped "auto" gets a lying mesh `<id>/dropped` made from it (tools/pack/lying.ts).
 */
export function convertPieces(asset: Asset & { spec: PiecesAsset }, files: Readonly<Record<string, string>>, out: Built): void {
  const spec = asset.spec;
  const palette = defaultPalette();
  const pictured = described(asset, palette, out);
  const maps = new Map<string, MaterialMaps[]>();
  const brought = new Map<string, number>();
  const pieces = piecesOf(spec);
  for (const p of pieces) {
    const report = importGlb(readFileSync(files[p.object]!), p.id, palette, { flat: (name) => pictured.get(name)?.flat });
    out.warnings.push(...report.warnings.map((w) => `${p.id}: ${w}`));
    brought.set(p.id, report.levels - 1);
    if (!report.mesh.flat || pictured.size === 0) {
      out.meshes.push(report.mesh);
      continue;
    }
    const made = withMaterials(report.mesh, report.mesh.materials!.map((m) => m.id.slice(p.id.length + 1)), pictured);
    out.meshes.push(made.mesh);
    maps.set(p.id, made.maps);
  }
  measureSpans(out.meshes);
  out.meshes = out.meshes.map((mesh) => {
    out.faults.push(...surfaceFaults(mesh));
    // Asked for, a piece's levels are made from its finest as a creature's are, and any its script brought follow them
    // as its last, each taking the last of the budgets. Otherwise it keeps its own.
    const errors = pieces.find((p) => p.id === mesh.id)?.errors;
    if (spec.flat === undefined || !maps.has(mesh.id)) return withStated(mesh, errors, out.faults);
    const own = mesh.lods.slice(1, 1 + brought.get(mesh.id)!);
    const budgets = spec.budgets.triangles.slice(1, spec.budgets.triangles.length - own.length);
    const made = withSurfaceLevels({ ...mesh, lods: [mesh.lods[0]!] }, { budgets, flat: spec.flat, maps: maps.get(mesh.id)!, palette });
    return withStated({ ...made, lods: [...made.lods, ...own] }, errors, out.faults);
  });
  // The lying piece is made from the held one as it is drawn, every level, before it goes on the hand.
  for (const p of spec.pieces) {
    if (p.dropped !== "auto") continue;
    const held = out.meshes.find((m) => m.id === p.id);
    if (held) out.meshes.push(lying(held, `${p.id}/dropped`));
  }
  out.meshes = out.meshes.map((mesh) => {
    const hold = spec.pieces.find((p) => p.id === mesh.id)?.hold;
    return hold ? heldOn(mesh, hold) : mesh;
  });
  for (const mesh of out.meshes) out.lines.push(`${mesh.id.padEnd(28)} triangles ${triangles(mesh)}${mesh.skeleton ? `  held on ${spec.pieces.find((p) => p.id === mesh.id)!.hold}` : ""}`);
}

/**
 * The sky's or the sea's pictures as the one material of a mesh of one triangle that is never drawn (SkyAsset,
 * WaterAsset). No Blender. The sea's mesh is named apart from the flat mesh core:water the sea is drawn with.
 */
export function convertSky(asset: Asset & { spec: SkyAsset | WaterAsset }, out: Built): void {
  const made = describe(materialsOf(asset)[0]!, stepSize(LAST_STEP), defaultPalette());
  out.faults.push(...made.faults);
  out.meshes.push({
    id: asset.spec.kind === "water" ? `${asset.id}/maps` : asset.id,
    flat: 1,
    materials: [made.material],
    textures: made.textures,
    lods: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 2, 1]), uvs: Float32Array.from([0, 0, 1, 0, 0, 1]), normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]), tangents: Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]) }],
  });
  out.lines.push(...made.textures.map((t) => `${t.id.padEnd(28)} ${t.role.padEnd(6)} ${t.top} pixels`));
}

export function buildAsset(asset: Asset): Built {
  const spec = asset.spec;
  const out: Built = { meshes: [], rigs: [], clips: [], lines: [], warnings: [], faults: [] };
  return withScratch((dir) => {
    /** Runs the asset's scripts and has Blender write `what`. */
    const scripted = (scripts: readonly string[], what: object): void => {
      const job = join(dir, "job.json");
      writeFileSync(job, JSON.stringify({ folder: asset.dir, scripts, ...what }));
      blender("build.py", [job], "build: done");
    };
    if (spec.kind === "creature") {
      const glb = join(dir, "model.glb");
      if ("raw" in spec.source) blender("convert.py", [join(RAW, spec.source.raw), glb], "convert: wrote");
      else scripted(spec.source.scripts, { out: glb });
      convertModel({ ...asset, spec }, glb, out);
    } else if (spec.kind === "pieces") {
      const files = Object.fromEntries(piecesOf(spec).map((p) => [p.object, join(dir, `${p.object}.glb`)]));
      scripted(spec.source.scripts, { pieces: files });
      convertPieces({ ...asset, spec }, files, out);
    } else if (spec.kind === "sky" || spec.kind === "water") {
      convertSky({ ...asset, spec }, out);
    } else if (spec.kind === "human-clips") {
      const made = convertClipLibraries(spec);
      out.clips.push(...made.clips);
      out.warnings.push(...made.warnings);
      for (const c of made.clips) out.lines.push(`${c.id.padEnd(22)} ${String(c.frames).padStart(4)} frames${c.loop ? "  loop" : ""}`);
    } else {
      const made = convertBodies(spec, dir);
      out.meshes.push(...made.meshes);
      out.rigs.push(...made.rigs);
      out.warnings.push(...made.warnings);
      for (const m of made.meshes) out.lines.push(`${m.id.padEnd(34)} ${triangles(m)} triangles`);
    }
    if (out.meshes.some((m) => m.flat)) out.lines.push("a level marked * is drawn with materials");
    return out;
  });
}

export function packOf(built: Built): Uint8Array {
  return buildPack(built.meshes, defaultPalette(), built.clips, built.rigs);
}

/**
 * A pack's levels in today's palette, where it was made with another. A material with pictures takes the colour read
 * off them again, on every vertex a piece draws with it and wherever its old colour was no other material's. Any other
 * colour of the block made by rule becomes today's nearest. The fixed colours, the body colours and the regions stay.
 */
function recolour(was: Uint8Array, now: Uint8Array, asset?: Asset): (mesh: SourceMesh, lod: SourceLod) => SourceLod {
  if (was.every((b, i) => b === now[i])) return (_, lod) => lod;
  const spec = asset?.spec;
  const top = spec && (spec.kind === "creature" || spec.kind === "pieces") ? (spec.budgets.texture?.top ?? stepSize(LAST_STEP)) : 0;
  const flats = new Map(asset ? materialsOf(asset).map((m) => [m.id, [describe(m, top, was).flat, describe(m, top, now).flat] as const]) : []);
  const mine = new Map<number, number>();
  const shared = new Set<number>();
  for (const [old, made] of flats.values()) {
    if (mine.has(old) && mine.get(old) !== made) shared.add(old);
    mine.set(old, made);
  }
  const again = (c: number): number => {
    if (c < RAMP_BASE || c >= SKIN_BASE) return c;
    if (mine.has(c) && !shared.has(c)) return mine.get(c)!;
    return nearestColour(now, was[c * 4]!, was[c * 4 + 1]!, was[c * 4 + 2]!);
  };
  return (mesh, lod) => {
    const colors = lod.colors.map(again);
    // A piece's vertex drawn with a material has the material's flat colour, so it is known by its triangle.
    if (spec?.kind === "pieces" && lod.sections && mesh.materials) {
      for (let t = 0; t < lod.indices.length / 3; t++) {
        const flat = flats.get(mesh.materials[lod.sections[t]!]!.id)?.[1];
        if (flat !== undefined) for (let k = 0; k < 3; k++) colors[lod.indices[t * 3 + k]!] = flat;
      }
    }
    return { ...lod, colors };
  };
}

/**
 * A pack again in today's format and palette, made from itself: no Blender. How far each level lies from the finest
 * is measured afresh, or stated again where a piece's asset states it. With `levels`, every mesh that follows a rig of its own gets its coarser levels made afresh from
 * its finest, which undoes any the model brought. One drawn with materials has them made as its asset says, which
 * reads the asset's pictures. A creature's rig takes its feet, strides and ragdoll from its asset as it is now.
 */
export function repack(file: Uint8Array, levels: boolean, asset?: Asset): Uint8Array {
  const pack = parsePack(file);
  const palette = defaultPalette();
  const colour = recolour(pack.palette, palette, asset);
  const own = new Set(pack.header.rigs.filter((r) => r.names).map((r) => r.id));
  const stating = asset?.spec.kind === "pieces" ? asset.spec.pieces : [];
  const faults: string[] = [];
  const meshes = unpackMeshes(pack).map((m) => {
    // What a piece's asset states of its levels' errors now, it states again.
    const measured = withStated({ ...m, lods: m.lods.map(({ error: _, ...lod }) => colour(m, lod)) }, stating.find((p) => p.id === m.id)?.errors, faults);
    if (!levels || m.rig === undefined || !own.has(m.rig)) return measured;
    if (!m.flat) return withLevels({ ...measured, lods: [measured.lods[0]!] });
    const spec = asset?.spec;
    if (!asset || spec?.kind !== "creature") throw new Error(`${m.id} is drawn with materials: its levels are made again only from its asset's pictures`);
    const pictures = new Map(materialsOf(asset).map((d) => [d.id, describe(d, spec.budgets.texture?.top ?? stepSize(LAST_STEP), palette).maps]));
    const budgets = spec.budgets.triangles.slice(1);
    return withSurfaceLevels({ ...measured, lods: [measured.lods[0]!] }, { budgets, flat: spec.flat ?? Math.max(1, budgets.length), maps: measured.materials!.map((d) => pictures.get(d.id) ?? {}), palette });
  });
  // A creature's rig takes what its asset now says of how it moves and dies.
  const spec = asset?.spec;
  const rigs = pack.header.rigs.map((r) => (spec?.kind === "creature" && r.id === asset!.id ? withMotion(r, spec, pack.clips.clips, faults) : r));
  if (faults.length > 0) throw new Error(`${asset!.id}: ${faults.join("; ")}`);
  return buildPack(meshes, palette, pack.clips.clips, rigs);
}
