// Builds the core asset pack: grayboxes made from the content, every pack found under assets/source, and every .glb
// under assets/source as "<folder>:<file name>". `bun run build` splits it into the files a client fetches.

import { HAS_SURFACES, worldSurfaceMeshes } from "../surfaces/build.ts";
import { HAS_FACADES, facadeMeshes } from "../facade/build.ts";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ShapeBox } from "../../shared/content/defs.ts";
import { cornerByte } from "../../shared/world/city.ts";
import { hullOf, hullPoint, type HullDef } from "../../shared/world/convex.ts";
import { FAR_HEIGHT, FAR_MESH, FAR_TILE_METRES } from "../../client/core/render/far.ts";
import { WATER_TILE } from "../../client/core/render/shading.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import type { LandmarkFarRow } from "../../shared/pack/far.ts";
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

/**
 * Boxes and convex parts as one level: each face of a part its corners round it, in a fan. With `cull`, a face whose every
 * corner is in one of the other parts is left out, as a flight's treads hide each other's backs.
 */
function partsMesh(boxes: readonly ShapeBox[], hulls: readonly HullDef[], cull = false): SourceLod {
  // Each part as its faces, each face its corners round it seen from outside; and its colour, the instance's where it has none.
  const parts: number[][][][] = [];
  const colour = [...boxes.map((b) => b.color ?? REGION_BASE), ...hulls.map(() => REGION_BASE)];
  for (const b of boxes) {
    const one = boxMesh(b.half, REGION_BASE);
    const at = (v: number): number[] => [0, 1, 2].map((a) => one.positions[v * 3 + a]! + b.at[a]!);
    parts.push(Array.from({ length: 6 }, (_, f) => [0, 1, 2, 3].map((k) => at(f * 4 + k))));
  }
  for (const h of hulls) {
    const made = hullOf(h);
    if (typeof made === "string") throw new Error(made);
    parts.push(made.rings.map((ring) => ring.map((c) => hullPoint(h.corners[c]!, h.sixty === true))));
  }
  // A face's outward normal by Newell's sum, which three corners in a line along its edge do not spoil.
  const inside = (part: number[][][], q: number[]): boolean =>
    part.every((face) => {
      const n = [0, 0, 0];
      face.forEach((p, k) => {
        const r = face[(k + 1) % face.length]!;
        for (let a = 0; a < 3; a++) n[a]! += (p[(a + 1) % 3]! - r[(a + 1) % 3]!) * (p[(a + 2) % 3]! + r[(a + 2) % 3]!);
      });
      const a = face[0]!;
      return n[0]! * (q[0]! - a[0]!) + n[1]! * (q[1]! - a[1]!) + n[2]! * (q[2]! - a[2]!) <= 1e-6 * Math.hypot(n[0]!, n[1]!, n[2]!);
    });
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const bones: number[] = [];
  const lowest = Math.min(...parts.flat(2).map((q) => q[1]!));
  // A box's border is an outer edge unless a point 2 cm past its middle, across the face's plane, is in another part,
  // as a join or an inside corner is, or it is a wall's foot on the piece's lowest level, where it stands on what is under it.
  const outer = (i: number, face: number[][]): number => {
    const middle = [0, 1, 2].map((a) => face.reduce((sum, q) => sum + q[a]!, 0) / 4);
    let edges = 0;
    [[0, 3], [1, 2], [0, 1], [3, 2]].forEach(([a, b], k) => {
      const mid = [0, 1, 2].map((c) => (face[a!]![c]! + face[b!]![c]!) / 2), away = mid.map((c, e) => c - middle[e]!), l = Math.hypot(...away);
      if (Math.abs(away[1]!) > 0.5 * l && Math.max(face[a!]![1]!, face[b!]![1]!) <= lowest + 1e-6) return;
      const past = mid.map((c, e) => c + (away[e]! / l) * 0.02);
      if (!parts.some((other, j) => j !== i && inside(other, past))) edges |= 1 << k;
    });
    return edges;
  };
  parts.forEach((faces, i) => {
    for (const face of faces) {
      if (cull && parts.some((other, j) => j !== i && face.every((q) => inside(other, q)))) continue;
      const first = positions.length / 3;
      const edges = i < boxes.length ? outer(i, face) : 0;
      face.forEach((q, k) => {
        positions.push(q[0]!, q[1]!, q[2]!);
        colors.push(colour[i]!);
        bones.push(i < boxes.length ? cornerByte(k, edges) : 0);
      });
      for (let k = 2; k < face.length; k++) indices.push(first, first + k - 1, first + k);
    }
  });
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices), bones: Uint8Array.from(bones) };
}

/** A palette box standing on the entity's origin. */
function standingBox(id: string, half: readonly [number, number, number]): SourceMesh {
  const lod = boxMesh(half, REGION_BASE);
  for (let i = 1; i < lod.positions.length; i += 3) lod.positions[i]! += half[1];
  return { id, lods: [lod] };
}

/** Their single colour is region 0, so the definition's colour applies per instance. */
export function grayboxMeshes(defs: readonly Def[]): SourceMesh[] {
  // The beam marks where a survivor died, visible from far off.
  const beam = boxMesh([0.15, 40, 0.15], REGION_BASE);
  for (let i = 1; i < beam.positions.length; i += 3) beam.positions[i]! += 40;
  const meshes: SourceMesh[] = [{ id: MISSING_MESH, lods: [boxMesh([0.5, 0.5, 0.5], 0)] }, waterMesh(), { id: BEAM_MESH, lods: [beam] }, eggMesh()];
  for (const d of defs) {
    // Under its own id: what a structure that names a mesh of the pack is drawn as until the pack has it.
    if (d.type === "structure" && d.shape !== undefined) {
      const shape = defs.find((s) => s.type === "shape" && s.id === d.shape);
      if (shape?.type !== "shape") continue;
      const walked = partsMesh(shape.boxes, shape.hulls ?? []);
      // A shape drawn otherwise than it is walked, a flight's treads over its ramp, is drawn as walked at its coarsest level.
      // Its look is the first two, since low poly draws from the second. One whose look has parts of their own colours, a
      // facade module, is its look at every level, as the near city's mesh draws it: walked, its recesses are a flat wall.
      const look = shape.look ? partsMesh(shape.look.boxes ?? [], shape.look.hulls ?? [], true) : null;
      meshes.push({ id: d.id, lods: look ? [look, look, shape.look!.boxes?.some((b) => b.color) ? look : walked] : [walked] });
      continue;
    }
    if ((d.type !== "species" && d.type !== "structure" && d.type !== "prop" && d.type !== "node") || d.mesh !== "box") continue;
    if (d.type === "structure") meshes.push({ id: d.id, lods: [boxMesh(d.half, REGION_BASE, true)] });
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
      meshes.push(standingBox(d.id, [d.radius, d.height / 2, d.radius]));
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

/** `landmarks` are the rows of landmark far meshes among `extra` (tools/pack/far.ts). */
export function buildCorePack(extra: SourceMesh[] = [], landmarks: readonly LandmarkFarRow[] = []): Uint8Array {
  const made = [...grayboxMeshes(CORE_CONTENT), farMesh(), ...mannequinMeshes(), ...weaponMeshes()];
  const art = coreArt();
  const rigs = new Map(art.rigs.map((rig) => [rig.id, rig]));
  const available = new Set([...made, ...art.meshes, ...extra].map((m) => m.id));
  for (const d of CORE_CONTENT) {
    if (d.type !== "species" || d.skeleton === "human" || d.mesh === "box" || available.has(d.mesh)) continue;
    const spec = d.vehicle?.spec;
    const mesh = standingBox(d.mesh, [spec?.halfWidth ?? d.radius, d.height / 2, spec?.halfLength ?? d.radius]);
    if (d.vehicle) {
      // A chassis lets the block bank and pitch and its occupants use the normal seat poses.
      mesh.skeleton = d.skeleton ?? d.mesh;
      mesh.rig = d.mesh;
      const lod = mesh.lods[0]!;
      lod.bones = new Uint8Array(lod.positions.length / 3);
      if (!rigs.has(d.mesh)) rigs.set(d.mesh, { id: d.mesh, skeleton: mesh.skeleton, names: ["chassis"], parent: [-1], rest: [0, 0, 0] });
    }
    made.push(mesh);
    available.add(d.mesh);
  }
  return buildPack([...withArt(made, art.meshes), ...(HAS_SURFACES ? worldSurfaceMeshes() : []), ...(HAS_FACADES ? facadeMeshes() : []), ...extra], defaultPalette(), coreClips(), [...rigs.values()], art.details, landmarks);
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
