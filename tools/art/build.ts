// Builds one asset from its source: Blender where the source needs it, then the conversion for its kind.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clip } from "../../shared/anim/clip.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { convertCreature } from "../pack/creature.ts";
import { importGlb } from "../pack/glb.ts";
import { readGltf } from "../pack/gltf.ts";
import { withLevels } from "../pack/simplify.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../pack/write.ts";
import type { Asset } from "./assets.ts";
import { RAW, blender, withScratch } from "./blender.ts";
import { convertBodies, convertClipLibraries } from "./human.ts";

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

const triangles = (m: SourceMesh): string => m.lods.map((l) => String(l.indices.length / 3).padStart(5)).join(" ");

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
      const made = convertCreature(readGltf(glb), asset.id, spec);
      // A model that brings one level gets the rest from ours.
      const mesh = withLevels(made.mesh);
      out.meshes.push(mesh);
      out.rigs.push(made.rig);
      out.clips.push(...made.clips);
      out.warnings.push(...made.warnings);
      out.faults.push(...made.faults);
      const w = made.weights;
      out.lines.push(`${made.rig.names!.length} bones, ${made.rig.caps!.length / 9} capsules, triangles ${triangles(mesh).trim()}`);
      out.lines.push(`weights: ${w.vertices} vertices, ${w.none} on no joint, ${w.over} on more than four, ${w.shared} shared between joints and drawn on the heaviest`);
      out.lines.push(`clips ${made.clips.map((c) => `${c.id.split("/")[1]} ${c.frames}`).join(", ")}`);
    } else if (spec.kind === "pieces") {
      const files = Object.fromEntries(spec.pieces.map((p) => [p.object, join(dir, `${p.object}.glb`)]));
      scripted(spec.source.scripts, { pieces: files });
      for (const p of spec.pieces) {
        const report = importGlb(readFileSync(files[p.object]!), p.id, defaultPalette());
        out.warnings.push(...report.warnings.map((w) => `${p.id}: ${w}`));
        out.meshes.push(report.mesh);
        out.lines.push(`${p.id.padEnd(28)} triangles ${triangles(report.mesh)}`);
      }
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
    return out;
  });
}

export function packOf(built: Built): Uint8Array {
  return buildPack(built.meshes, defaultPalette(), built.clips, built.rigs);
}

/**
 * A pack again in today's format, made from itself: no source and no Blender. How far each level lies from the finest
 * is measured afresh. With `levels`, every mesh that follows a rig of its own gets its coarser levels made afresh from
 * its finest, which undoes any the model brought.
 */
export function repack(file: Uint8Array, levels: boolean): Uint8Array {
  const pack = parsePack(file);
  const own = new Set(pack.header.rigs.filter((r) => r.names).map((r) => r.id));
  const meshes = unpackMeshes(pack).map((m) => {
    const measured = { ...m, lods: m.lods.map(({ error: _, ...lod }) => lod) };
    return levels && m.rig !== undefined && own.has(m.rig) ? withLevels({ ...measured, lods: [measured.lods[0]!] }) : measured;
  });
  return buildPack(meshes, defaultPalette(), pack.clips.clips, pack.header.rigs);
}
