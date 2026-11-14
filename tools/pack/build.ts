// Builds the core asset pack. Run directly, it also imports every .glb under assets/source as "<folder>:<file name>"
// and writes client/dist/assets/core.snpk.

import { mkdirSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { WATER_TILE } from "../../client/core/render/shading.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { REGION_BASE, WATER_COLOR, defaultPalette } from "../../shared/pack/palette.ts";
import { importGlb } from "./glb.ts";
import { mannequinMeshes } from "./mannequin.ts";
import { weaponMeshes } from "./weapons.ts";
import { boxMesh, buildPack, unpackMeshes, type SourceMesh } from "./write.ts";

export const MISSING_MESH = "core:missing";
export const WATER_MESH = "core:water";
export const BEAM_MESH = "core:beam";

/** A flat square facing up, centred on its origin. */
function waterMesh(): SourceMesh {
  const h = WATER_TILE / 2;
  return {
    id: WATER_MESH,
    lods: [{ positions: Float32Array.from([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]), colors: new Uint8Array(4).fill(WATER_COLOR), indices: Uint32Array.from([0, 2, 1, 0, 3, 2]) }],
  };
}

export const EGG_MESH = "core:egg";

/** Stands on its blunt end, 0.6 across and 0.7 tall, with its base at y = 0. */
function eggMesh(): SourceMesh {
  const around = 10;
  const up = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= up; j++) {
    const v = j / up;
    // Fatter below the middle than above it.
    const r = 0.3 * Math.sin(Math.PI * v) * (1.12 - 0.3 * v);
    const y = 0.35 - 0.35 * Math.cos(Math.PI * v);
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2;
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
    }
  }
  for (let j = 0; j < up; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * around + i;
      const b = j * around + ((i + 1) % around);
      // The first and last rings are single points, so a band that touches one needs only one triangle.
      if (j > 0) indices.push(a, b, a + around);
      if (j < up - 1) indices.push(b, b + around, a + around);
    }
  }
  return { id: EGG_MESH, lods: [{ positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3).fill(REGION_BASE), indices: Uint32Array.from(indices) }] };
}

/** Their single colour is region 0, so the definition's colour applies per instance. */
export function grayboxMeshes(defs: readonly Def[]): SourceMesh[] {
  // The beam marks where a survivor died, visible from far off.
  const beam = boxMesh([0.15, 40, 0.15], REGION_BASE);
  for (let i = 1; i < beam.positions.length; i += 3) beam.positions[i]! += 40;
  const meshes: SourceMesh[] = [{ id: MISSING_MESH, lods: [boxMesh([0.5, 0.5, 0.5], 0)] }, waterMesh(), { id: BEAM_MESH, lods: [beam] }, eggMesh()];
  for (const d of defs) {
    if (d.type === "structure" && d.mesh === "shape") {
      const shape = defs.find((s) => s.type === "shape" && s.id === d.shape);
      if (shape?.type !== "shape") continue;
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      for (const b of shape.boxes) {
        const one = boxMesh(b.half, REGION_BASE);
        const first = positions.length / 3;
        for (let i = 0; i < one.positions.length; i++) positions.push(one.positions[i]! + b.at[i % 3]!);
        colors.push(...one.colors);
        for (const v of one.indices) indices.push(v + first);
      }
      meshes.push({ id: d.id, lods: [{ positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) }] });
      continue;
    }
    if ((d.type !== "species" && d.type !== "structure" && d.type !== "prop" && d.type !== "node") || d.mesh !== "box") continue;
    if (d.type === "structure") meshes.push({ id: d.id, lods: [boxMesh(d.half, REGION_BASE)] });
    else if (d.type === "node") {
      // A node's position is the centre of its collider.
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
      // A species or prop stands on its origin, so the box is lifted to put its base at y = 0.
      const lod = boxMesh([d.radius, d.height / 2, d.radius], REGION_BASE);
      for (let i = 1; i < lod.positions.length; i += 3) lod.positions[i]! += d.height / 2;
      meshes.push({ id: d.id, lods: [lod] });
    }
  }
  return meshes;
}

const SOURCE = resolve(import.meta.dir, "../../assets/source");
let sourceClips: readonly Clip[] | null = null;

/** Clips from `bun run art`, clips written as code, and the creatures' clips. Read once. */
export function coreClips(): readonly Clip[] {
  if (sourceClips) return sourceClips;
  const file = join(SOURCE, "core/human-clips.snpk");
  sourceClips = [...(existsSync(file) ? parsePack(new Uint8Array(readFileSync(file))).clips.clips : []), ...authoredClips(), ...coreCreatures().clips];
  return sourceClips;
}

let sourceBodies: { meshes: SourceMesh[]; rigs: PackRig[] } | null = null;

/** Written by `bun run art`. Read once. */
export function coreBodies(): { meshes: SourceMesh[]; rigs: PackRig[] } {
  if (sourceBodies) return sourceBodies;
  const file = join(SOURCE, "core/human-bodies.snpk");
  if (!existsSync(file)) return (sourceBodies = { meshes: [], rigs: [] });
  const pack = parsePack(new Uint8Array(readFileSync(file)));
  return (sourceBodies = { meshes: unpackMeshes(pack), rigs: pack.header.rigs });
}

let sourceCreatures: { meshes: SourceMesh[]; rigs: PackRig[]; clips: readonly Clip[] } | null = null;

/** Written by `bun run art -- --creatures`. Read once. */
export function coreCreatures(): { meshes: SourceMesh[]; rigs: PackRig[]; clips: readonly Clip[] } {
  if (sourceCreatures) return sourceCreatures;
  const file = join(SOURCE, "core/creatures.snpk");
  if (!existsSync(file)) return (sourceCreatures = { meshes: [], rigs: [], clips: [] });
  const pack = parsePack(new Uint8Array(readFileSync(file)));
  return (sourceCreatures = { meshes: unpackMeshes(pack), rigs: pack.header.rigs, clips: pack.clips.clips });
}

export function buildCorePack(extra: SourceMesh[] = []): Uint8Array {
  const bodies = coreBodies();
  const creatures = coreCreatures();
  return buildPack([...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes(), ...bodies.meshes, ...creatures.meshes, ...extra], defaultPalette(), coreClips(), [...bodies.rigs, ...creatures.rigs]);
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
