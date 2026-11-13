// Builds the core asset pack: a graybox mesh for every definition whose mesh is
// "box", plus every .glb under assets/source (id "<folder>:<file name>").
//
//   bun tools/pack/build.ts        writes client/dist/assets/core.snpk

import { mkdirSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { WATER_TILE } from "../../client/core/render/shading.ts";
import { REGION_BASE, WATER_COLOR, defaultPalette } from "../../shared/pack/palette.ts";
import { importGlb } from "./glb.ts";
import { boxMesh, buildPack, type SourceMesh } from "./write.ts";

export const MISSING_MESH = "core:missing";
export const WATER_MESH = "core:water";
export const BEAM_MESH = "core:beam";

/** One tile of water surface: a flat square facing up, centred on its origin. */
function waterMesh(): SourceMesh {
  const h = WATER_TILE / 2;
  return {
    id: WATER_MESH,
    lods: [{ positions: Float32Array.from([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]), colors: new Uint8Array(4).fill(WATER_COLOR), indices: Uint32Array.from([0, 2, 1, 0, 3, 2]) }],
  };
}

/** Graybox meshes for content. Their single colour is region 0, so the definition's colour applies per instance. */
export function grayboxMeshes(defs: readonly Def[]): SourceMesh[] {
  // The beam marks a place from far off: where a survivor died.
  const beam = boxMesh([0.15, 40, 0.15], REGION_BASE);
  for (let i = 1; i < beam.positions.length; i += 3) beam.positions[i]! += 40;
  const meshes: SourceMesh[] = [{ id: MISSING_MESH, lods: [boxMesh([0.5, 0.5, 0.5], 0)] }, waterMesh(), { id: BEAM_MESH, lods: [beam] }];
  for (const d of defs) {
    if ((d.type !== "species" && d.type !== "structure" && d.type !== "prop" && d.type !== "node") || d.mesh !== "box") continue;
    if (d.type === "structure") meshes.push({ id: d.id, lods: [boxMesh(d.half, REGION_BASE)] });
    else if (d.type === "node") {
      // A node stands on its base; its position is the centre of its collider.
      const lod = boxMesh(d.half, REGION_BASE);
      if (d.top) {
        const top = boxMesh(d.top.half, d.top.color);
        for (let i = 1; i < top.positions.length; i += 3) top.positions[i]! += d.half[1] + d.top.half[1] * 0.6;
        const n = lod.positions.length / 3;
        lod.positions = Float32Array.from([...lod.positions, ...top.positions]);
        lod.colors = Uint8Array.from([...lod.colors, ...top.colors]);
        lod.indices = Uint32Array.from([...lod.indices, ...Array.from(top.indices, (v) => v + n)]);
      }
      meshes.push({ id: d.id, lods: [lod] });
    } else {
      // A species or a prop stands on its origin: lift the box so its base is at y = 0.
      const lod = boxMesh([d.radius, d.height / 2, d.radius], REGION_BASE);
      for (let i = 1; i < lod.positions.length; i += 3) lod.positions[i]! += d.height / 2;
      meshes.push({ id: d.id, lods: [lod] });
    }
  }
  return meshes;
}

export function buildCorePack(extra: SourceMesh[] = []): Uint8Array {
  return buildPack([...grayboxMeshes(CORE_CONTENT), ...extra], defaultPalette());
}

function findGlbs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findGlbs(p, out);
    else if (name.endsWith(".glb")) out.push(p);
  }
  return out;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const palette = defaultPalette();
  const imported: SourceMesh[] = [];
  for (const file of findGlbs(join(root, "assets/source"))) {
    const id = `${basename(dirname(file))}:${basename(file, ".glb")}`;
    const report = importGlb(readFileSync(file), id, palette);
    for (const w of report.warnings) console.warn(`${id}: ${w}`);
    imported.push(report.mesh);
  }
  const pack = buildCorePack(imported);
  const out = join(root, "client/dist/assets/core.snpk");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pack);
  console.log(`core.snpk  ${pack.length} bytes, ${grayboxMeshes(CORE_CONTENT).length} graybox + ${imported.length} imported meshes`);
}
