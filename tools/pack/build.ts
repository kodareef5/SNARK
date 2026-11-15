// Builds the core asset pack: grayboxes made from the content, every pack found under assets/source, and every .glb
// under assets/source as "<folder>:<file name>". `bun run build` splits it into the files a client fetches.

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ShapeBox } from "../../shared/content/defs.ts";
import { hullOf, hullPoint, type HullDef } from "../../shared/world/convex.ts";
import { FAR_HEIGHT, FAR_MESH, FAR_TILE_METRES } from "../../client/core/render/far.ts";
import { WATER_TILE } from "../../client/core/render/shading.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { REGION_BASE, WATER_COLOR, defaultPalette } from "../../shared/pack/palette.ts";
import { SOURCE, filesUnder, readPacks, type SourceArt } from "../art/source.ts";
import { importGlb } from "./glb.ts";
import { mannequinMeshes } from "./mannequin.ts";
import { weaponMeshes } from "./weapons.ts";
import { boxMesh, buildPack, type SourceLod, type SourceMesh } from "./write.ts";

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

/**
 * Never drawn as itself: its bounds, a far tile's square and FAR_HEIGHT up from its corner, are what far blocks are
 * stored within (client/core/render/far.ts). It is in the core pack and not among the grey boxes, so a pack built for a
 * test numbers its meshes as before.
 */
export function farMesh(): SourceMesh {
  const [h, up] = [FAR_TILE_METRES / 2, FAR_HEIGHT / 2];
  const lod = boxMesh([h, up, h], 0);
  for (let i = 0; i < lod.positions.length; i++) lod.positions[i]! += i % 3 === 1 ? up : h;
  return { id: FAR_MESH, lods: [lod] };
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

/** Boxes and convex parts as one level: each face of a part its corners round it, in a fan. */
function partsMesh(boxes: readonly ShapeBox[], hulls: readonly HullDef[]): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const b of boxes) {
    const one = boxMesh(b.half, REGION_BASE);
    const first = positions.length / 3;
    for (let i = 0; i < one.positions.length; i++) positions.push(one.positions[i]! + b.at[i % 3]!);
    for (const v of one.indices) indices.push(v + first);
  }
  for (const h of hulls) {
    const made = hullOf(h);
    if (typeof made === "string") throw new Error(made);
    for (const ring of made.rings) {
      const first = positions.length / 3;
      for (const c of ring) positions.push(...hullPoint(h.corners[c]!, h.sixty === true));
      for (let k = 2; k < ring.length; k++) indices.push(first, first + k - 1, first + k);
    }
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3).fill(REGION_BASE), indices: Uint32Array.from(indices) };
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
      const walked = partsMesh(shape.boxes, shape.hulls ?? []);
      // A shape drawn otherwise than it is walked, a flight's treads over its ramp, is drawn as walked one level coarser.
      meshes.push({ id: d.id, lods: shape.look ? [partsMesh(shape.look.boxes ?? [], shape.look.hulls ?? []), walked] : [walked] });
      continue;
    }
    if ((d.type !== "species" && d.type !== "structure" && d.type !== "prop" && d.type !== "node") || d.mesh !== "box") continue;
    if (d.type === "structure") meshes.push({ id: d.id, lods: [boxMesh(d.half, REGION_BASE)] });
    else if (d.type === "node") {
      const lod = boxMesh(d.half, REGION_BASE);
      if (d.top) {
        const top = boxMesh(d.top.half, d.top.color);
        for (let i = 1; i < top.positions.length; i += 3) top.positions[i]! += d.half[1] + d.top.half[1] * 0.6;
        const n = lod.positions.length / 3;
        lod.positions = Float32Array.from([...lod.positions, ...top.positions]);
        lod.colors = Uint8Array.from([...lod.colors, ...top.colors]);
        lod.indices = Uint32Array.from([...lod.indices, ...Array.from(top.indices, (v) => v + n)]);
      }
      // A node stands on its origin, where it meets the ground.
      for (let i = 1; i < lod.positions.length; i += 3) lod.positions[i]! += d.half[1];
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

let art: SourceArt | null = null;
let clips: readonly Clip[] | null = null;

/** Every pack under assets/source, as `bun run art` wrote them. Read once. */
function coreArt(): SourceArt {
  return (art ??= readPacks());
}

/** The clips of those packs and the clips written as code. */
export function coreClips(): readonly Clip[] {
  return (clips ??= [...coreArt().clips, ...authoredClips()]);
}

/** `made` and the meshes of `art`. A modelled mesh takes the place of the grey box content would get under the same id. */
export function withArt(made: readonly SourceMesh[], art: readonly SourceMesh[]): SourceMesh[] {
  const modelled = new Set(art.map((m) => m.id));
  return [...made.filter((m) => !modelled.has(m.id)), ...art];
}

export function buildCorePack(extra: SourceMesh[] = []): Uint8Array {
  const made = [...grayboxMeshes(CORE_CONTENT), farMesh(), ...mannequinMeshes(), ...weaponMeshes()];
  return buildPack([...withArt(made, coreArt().meshes), ...extra], defaultPalette(), coreClips(), coreArt().rigs, coreArt().details);
}

/** Every .glb under assets/source, imported. What the import had to say of each is printed. */
export function importedMeshes(): SourceMesh[] {
  const palette = defaultPalette();
  return filesUnder(SOURCE, ".glb").map((file) => {
    const id = `${basename(dirname(file))}:${basename(file, ".glb")}`;
    const report = importGlb(readFileSync(file), id, palette);
    for (const w of report.warnings) console.warn(`${id}: ${w}`);
    return report.mesh;
  });
}
