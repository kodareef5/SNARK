// Measures what the engine depends on in an asset's pack, and says nothing about taste. It prints numbers and counts
// as a fault only what would draw wrong: a hole, a face turned inward, a vertex on no bone, a loop that jumps as it
// wraps, a planted foot that slides, a level over its budget. A wanted opening in a mesh is two faces back to back.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Pose, sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import { boneToModel, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import type { Asset } from "./assets.ts";
import type { CreatureAsset } from "./spec.ts";

/** A level's distance and height on screen are worked out for this tier, on a screen this many pixels high with this field of view. */
const TIER = "medium";
const SCREEN = 1080;
const FOV_Y = 1.2217;

/** A loop jumps if its last frame lies further from its first than this many of its largest steps, and by more than this share of the creature's height. */
const WRAP_STEPS = 2.5;
const WRAP_SHARE = 0.005;
/** A foot is planted while it is within this share of its rise above its lowest point. */
const PLANTED = 0.12;
/** A planted foot slides if it moves over the ground by more than this share of the stride. */
const SLIDE_SHARE = 0.05;
/** A loop whose feet travel this share of the creature's height is a gait, and wants a stride. */
const GAIT_SHARE = 0.25;
/** Vertices a clip is measured on. Nothing has moved between two frames if none of them moved this many metres. */
const SAMPLES = 400;
const STILL = 1e-4;
/** A loop that stands still for this share of its frames is remarked on. */
const STILL_SHARE = 0.25;

export interface LevelFacts {
  triangles: number;
  vertices: number;
  /** The most triangles the asset allows the level, or null where it gives none. */
  budget: number | null;
  /** Metres its surface lies from the finest level's. */
  error: number;
  /** Metres off at which the level is first drawn, and how many pixels tall the mesh then stands. Both 0 for the finest. */
  from: number;
  tall: number;
  /** Pieces that share no point. */
  parts: number;
  /** Edges with a triangle on one side only, and the openings they ring. */
  openEdges: number;
  holes: number;
  /** Edges whose two triangles face opposite ways. */
  flipped: number;
  /** Parts turned inside out. */
  insideOut: number;
  /** Edges with more than two triangles, and triangles with no area. Neither is a fault. */
  crowded: number;
  flat: number;
}

export interface MeshFacts {
  id: string;
  /** Metres across, up and along. */
  size: [number, number, number];
  levels: LevelFacts[];
  /** In a skinned mesh: vertices, over all levels, that follow a bone the rig does not have. */
  strays?: number;
}

export interface ClipFacts {
  name: string;
  frames: number;
  seconds: number;
  loop: boolean;
  /** The furthest any point of the body moves between two frames, in metres. */
  step: number;
  /** For a loop: the same from its last frame back to its first. A seamless loop wraps in about one step. */
  wrap?: number;
  /** Frames after which nothing moves. */
  still: number;
}

export interface GaitFacts {
  clip: string;
  /** The stride the asset gives, or null. */
  stride: number | null;
  /** The stride at which the planted feet slide least. */
  measured: number;
  feet: {
    bone: string;
    /** The share of the clip it is on the ground. */
    planted: number;
    /** Metres it moves over the ground while planted, at the asset's stride, or at the measured one where the asset gives none. */
    slide: number;
  }[];
}

export interface Report {
  id: string;
  kind: string;
  meshes: MeshFacts[];
  /** `buried` are the bones whose hit capsule no ray along an axis reaches before another capsule. */
  rig?: { skeleton: string; bones: number; capsules: number; buried: string[]; sockets: string[] };
  clips: ClipFacts[];
  gaits: GaitFacts[];
  /** B1 measures textures here: layers of one size and aligned, a normal map that agrees with its height, a tiling texture that wraps, a mask of pure colours with only ring neighbours touching, a larger size that matches the smaller when shrunk. The measures are in planning/artist-test/tools/measure.py. */
  textures: never[];
  notes: string[];
  faults: string[];
}

/** Counts what is wrong with the surface of one level. Points at one place are one point, whatever colour or bone they carry. */
export function measureSurface(lod: SourceLod): Pick<LevelFacts, "parts" | "openEdges" | "holes" | "flipped" | "insideOut" | "crowded" | "flat"> {
  const p = lod.positions;
  const ids = new Map<string, number>();
  const at: number[] = [];
  const point = lod.indices.length === 0 ? [] : Array.from({ length: p.length / 3 }, (_, v) => {
    const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      at.push(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
    }
    return id;
  });
  const n = ids.size;
  const group = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]!]!;
    return i;
  };
  // Per edge between two points, the triangles that run along it each way.
  const edges = new Map<number, [number, number]>();
  const faces: number[] = [];
  let flat = 0;
  for (let t = 0; t + 2 < lod.indices.length; t += 3) {
    const [a, b, c] = [point[lod.indices[t]!]!, point[lod.indices[t + 1]!]!, point[lod.indices[t + 2]!]!];
    if (a === b || b === c || a === c) {
      flat++;
      continue;
    }
    faces.push(a, b, c);
    group[find(a)] = find(b);
    group[find(b)] = find(c);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = u < v ? u * n + v : v * n + u;
      const e = edges.get(key) ?? [0, 0];
      e[u < v ? 0 : 1]++;
      edges.set(key, e);
    }
  }
  let openEdges = 0;
  let flipped = 0;
  let crowded = 0;
  const rim = Array.from({ length: n }, (_, i) => i);
  const rimOf = (i: number): number => {
    while (rim[i] !== i) i = rim[i] = rim[rim[i]!]!;
    return i;
  };
  const onRim = new Set<number>();
  const broken = new Set<number>();
  for (const [key, [fore, back]] of edges) {
    const [u, v] = [Math.floor(key / n), key % n];
    if (fore + back === 1) {
      openEdges++;
      rim[rimOf(u)] = rimOf(v);
      onRim.add(u).add(v);
      broken.add(find(u));
    } else if (fore + back > 2) crowded++;
    else if (fore !== back) {
      flipped++;
      broken.add(find(u));
    }
  }
  const holes = new Set([...onRim].map(rimOf)).size;

  // A part's volume, measured about its own middle, is below zero when its faces look inward. An open part is
  // judged only if it holds enough volume for its area to be a body and not a sheet.
  const parts = new Map<number, { faces: number[]; sum: [number, number, number]; count: number }>();
  for (let f = 0; f < faces.length; f += 3) {
    const g = find(faces[f]!);
    const part = parts.get(g) ?? { faces: [], sum: [0, 0, 0], count: 0 };
    parts.set(g, part);
    part.faces.push(f);
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) part.sum[a]! += at[faces[f + k]! * 3 + a]!;
      part.count++;
    }
  }
  let insideOut = 0;
  for (const [g, part] of parts) {
    const mid = part.sum.map((s) => s / part.count);
    let volume = 0;
    let area = 0;
    for (const f of part.faces) {
      const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((x) => at[faces[f + k]! * 3 + x]! - mid[x]!)) as [number[], number[], number[]];
      const cx = b[1]! * c[2]! - b[2]! * c[1]!, cy = b[2]! * c[0]! - b[0]! * c[2]!, cz = b[0]! * c[1]! - b[1]! * c[0]!;
      volume += (a[0]! * cx + a[1]! * cy + a[2]! * cz) / 6;
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
      const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    if (volume < 0 && (!broken.has(g) || -volume > 0.002 * area ** 1.5)) insideOut++;
  }
  return { parts: parts.size, openEdges, holes, flipped, insideOut, crowded, flat };
}

function measureMesh(mesh: SourceMesh, pack: Pack, budgets: readonly number[], faults: string[], bones?: number): MeshFacts {
  const header = pack.header.meshes[pack.meshIndex.get(mesh.id)!]!;
  const tall = header.half[1] * 2;
  const threshold = tierOf(TIER).threshold;
  const scale = SCREEN / (2 * Math.tan(FOV_Y / 2));
  let strays = 0;
  const levels = mesh.lods.map((lod, l): LevelFacts => {
    const error = l === 0 ? 0 : header.lods[l]!.error;
    const facts: LevelFacts = {
      triangles: lod.indices.length / 3,
      vertices: lod.positions.length / 3,
      budget: budgets[l] ?? null,
      error,
      from: error > 0 ? (error * scale) / threshold : 0,
      tall: error > 0 ? (tall * threshold) / error : 0,
      ...measureSurface(lod),
    };
    const where = `${mesh.id} level ${l}`;
    if (facts.budget !== null && facts.triangles > facts.budget) faults.push(`${where}: ${facts.triangles} triangles, and its budget is ${facts.budget}`);
    if (facts.holes > 0) faults.push(`${where}: ${facts.holes} ${facts.holes === 1 ? "hole" : "holes"} (${facts.openEdges} open edges)`);
    if (facts.flipped > 0) faults.push(`${where}: ${facts.flipped} edges between faces that look opposite ways`);
    if (facts.insideOut > 0) faults.push(`${where}: ${facts.insideOut} of its ${facts.parts} parts inside out`);
    if (bones !== undefined && lod.bones) for (const b of lod.bones) if (b >= bones) strays++;
    return facts;
  });
  const out: MeshFacts = { id: mesh.id, size: [header.half[0] * 2, tall, header.half[2] * 2], levels };
  if (bones !== undefined) {
    out.strays = strays;
    if (strays > 0) faults.push(`${mesh.id}: ${strays} vertices follow a bone the rig does not have`);
  }
  return out;
}

/** Poses a rig on a frame of a clip, and says where a point of its mesh then is. */
export class Poser {
  readonly rig: Rig;
  private readonly pose: Pose;
  private readonly v = new Float64Array(3);

  constructor(rig: Rig) {
    this.rig = rig;
    this.pose = new Pose(rig.bones);
  }

  /** Solves the rig on frame `frame` of `clip`, or at rest for null. */
  set(clip: Clip | null, frame: number): void {
    if (clip) sampleClip(clip, frame, this.pose);
    else this.pose.rest();
    solve(this.rig, this.pose, this.rig.solved);
  }

  /** Where a point of the mesh that follows `bone` is in the pose last set. */
  skin(bone: number, x: number, y: number, z: number, out: Float32Array | Float64Array | number[], at = 0): void {
    const { rest, solved } = this.rig;
    quatRotate(solved.rot, bone * 4, x - rest[bone * 3]!, y - rest[bone * 3 + 1]!, z - rest[bone * 3 + 2]!, this.v, 0);
    for (let k = 0; k < 3; k++) out[at + k] = solved.pos[bone * 3 + k]! + this.v[k]!;
  }
}

/** The bones whose capsule, at rest, is behind another along every axis through its ends and its middle. */
function buriedCapsules(poser: Poser): string[] {
  const rig = poser.rig;
  poser.set(null, 0);
  const p = [0, 0, 0];
  const out: string[] = [];
  for (let b = 0; b < rig.bones; b++) {
    if (rig.zone[b] === 0) continue;
    let reached = false;
    for (const t of [0, 0.5, 1]) {
      const at = (k: number): number => rig.capA[b * 3 + k]! + (rig.capB[b * 3 + k]! - rig.capA[b * 3 + k]!) * t;
      boneToModel(rig.solved, b, at(0), at(1), at(2), p);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        rayZones(rig, rig.solved, p[0]! - dx * 1000, p[1]! - dy * 1000, p[2]! - dz * 1000, dx, dy, dz, 2000);
        if (zoneHit.bone === b) reached = true;
      }
    }
    if (!reached) out.push(rig.names[b]!);
  }
  return out;
}

function measureClip(poser: Poser, clip: Clip, name: string, lod: SourceLod): ClipFacts {
  const every = Math.max(1, Math.floor(lod.positions.length / 3 / SAMPLES));
  const count = Math.ceil(lod.positions.length / 3 / every);
  const frames: Float64Array[] = [];
  for (let f = 0; f < clip.frames; f++) {
    poser.set(clip, f);
    const at = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = i * every;
      poser.skin(lod.bones![v]!, lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!, at, i * 3);
    }
    frames.push(at);
  }
  const apart = (a: Float64Array, b: Float64Array): number => {
    let far = 0;
    for (let i = 0; i < a.length; i += 3) far = Math.max(far, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!));
    return far;
  };
  let step = 0;
  let still = 0;
  for (let f = 0; f + 1 < frames.length; f++) {
    const moved = apart(frames[f]!, frames[f + 1]!);
    step = Math.max(step, moved);
    if (moved < STILL) still++;
  }
  const out: ClipFacts = { name, frames: clip.frames, seconds: clip.frames / TICK_RATE, loop: clip.loop, step, still };
  if (clip.loop) out.wrap = apart(frames[frames.length - 1]!, frames[0]!);
  return out;
}

/** Where each foot is on each frame, and the runs of frames it is planted for. A run may wrap. */
function measureGait(poser: Poser, clip: Clip, name: string, feet: readonly string[], stride: number | null): GaitFacts {
  const n = clip.frames;
  const tracks = feet.map((bone) => ({ bone, b: poser.rig.names.indexOf(bone), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) }));
  for (let f = 0; f < n; f++) {
    poser.set(clip, f);
    for (const t of tracks) {
      t.x[f] = poser.rig.solved.pos[t.b * 3]!;
      t.y[f] = poser.rig.solved.pos[t.b * 3 + 1]!;
      t.z[f] = poser.rig.solved.pos[t.b * 3 + 2]!;
    }
  }
  const planted = tracks.map((t) => {
    const low = Math.min(...t.y);
    const rise = Math.max(...t.y) - low;
    return Array.from(t.y, (y) => y - low <= rise * PLANTED);
  });
  // The body moves forward by the stride each turn, so a planted foot moves back by stride / frames each frame.
  let back = 0;
  let steps = 0;
  tracks.forEach((t, i) => {
    for (let f = 0; f < n; f++) {
      const next = (f + 1) % n;
      if (!planted[i]![f] || !planted[i]![next]) continue;
      back += t.z[f]! - t.z[next]!;
      steps++;
    }
  });
  const measured = steps > 0 ? (back / steps) * n : 0;
  const use = stride ?? measured;
  return {
    clip: name,
    stride,
    measured,
    feet: tracks.map((t, i) => {
      const on = planted[i]!;
      let slide = 0;
      // Each run of planted frames, starting where the foot comes down.
      for (let start = 0; start < n; start++) {
        if (!on[start] || on[(start + n - 1) % n]) continue;
        let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
        for (let k = 0; k < n && on[(start + k) % n]; k++) {
          const f = (start + k) % n;
          // Frames past the end of the clip are a turn later, so the body is a stride further on.
          const z = t.z[f]! + (use * (start + k)) / n;
          minX = Math.min(minX, t.x[f]!);
          maxX = Math.max(maxX, t.x[f]!);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        slide = Math.max(slide, Math.hypot(maxX - minX, maxZ - minZ));
      }
      return { bone: t.bone, planted: on.filter(Boolean).length / n, slide };
    }),
  };
}

function checkCreature(asset: Asset, spec: CreatureAsset, pack: Pack, meshes: SourceMesh[], report: Report): void {
  const { faults, notes } = report;
  const packRig = pack.header.rigs.find((r) => r.id === asset.id);
  const rig = packRig && buildRig(packRig, pack.clips);
  const mesh = meshes.find((m) => m.id === asset.id);
  if (!rig || !packRig || !mesh) {
    faults.push(`${asset.id}: the pack has no ${mesh ? "rig" : "mesh"} of that id`);
    return;
  }
  report.meshes.push(measureMesh(mesh, pack, spec.budgets.triangles, faults, rig.bones));
  const poser = new Poser(rig);
  report.rig = { skeleton: packRig.skeleton, bones: rig.bones, capsules: (packRig.caps?.length ?? 0) / 9, buried: buriedCapsules(poser), sockets: [...rig.sockets.keys()] };
  if (report.rig.capsules === 0) notes.push("no hit capsules: nothing can hit it");
  for (const bone of report.rig.buried) notes.push(`the hit capsule on "${bone}" is buried in others: no ray along an axis reaches it first`);

  const tall = report.meshes[0]!.size[1];
  for (const c of spec.clips) {
    const clip = pack.clips.clips[pack.clips.index.get(`${asset.id}/${c.name}`) ?? -1];
    if (!clip || clip.bones !== rig.bones) {
      faults.push(`clip "${c.name}" is not in the pack`);
      continue;
    }
    const facts = measureClip(poser, clip, c.name, mesh.lods[0]!);
    report.clips.push(facts);
    if (clip.loop !== c.loop) faults.push(`clip "${c.name}" ${clip.loop ? "loops" : "does not loop"}, and the asset says otherwise`);
    if (facts.wrap !== undefined && facts.wrap > WRAP_STEPS * facts.step && facts.wrap > WRAP_SHARE * tall) {
      faults.push(`clip "${c.name}" jumps ${(facts.wrap * 100).toFixed(1)} cm as it wraps, and its largest step is ${(facts.step * 100).toFixed(1)} cm: its last pose does not lead into its first`);
    }
    if (clip.loop && facts.still > STILL_SHARE * clip.frames) notes.push(`clip "${c.name}" stands still for ${facts.still} of its ${clip.frames} frames`);
    const feet = spec.feet.filter((bone) => rig.names.includes(bone));
    if (!clip.loop || feet.length === 0) continue;
    const given = spec.gaits[c.name]?.stride ?? null;
    const gait = measureGait(poser, clip, c.name, feet, given);
    if (given === null) {
      if (gait.measured > GAIT_SHARE * tall) notes.push(`clip "${c.name}" walks about ${gait.measured.toFixed(2)} m a turn and has no stride in asset.ts`);
      continue;
    }
    report.gaits.push(gait);
    for (const foot of gait.feet) {
      if (foot.slide > SLIDE_SHARE * given) faults.push(`clip "${c.name}": ${foot.bone} slides ${(foot.slide * 100).toFixed(1)} cm while planted at a stride of ${given} m (it holds best at ${gait.measured.toFixed(2)} m)`);
    }
  }
  for (const bone of spec.feet) if (!rig.names.includes(bone)) faults.push(`foot "${bone}" is not a bone of the rig`);
  for (const name of Object.keys(spec.gaits)) if (!spec.clips.some((c) => c.name === name)) faults.push(`gait "${name}" is not one of the clips`);
}

/** Measures the pack an asset was converted to. */
export function checkAsset(asset: Asset, pack: Pack): Report {
  const report: Report = { id: asset.id, kind: asset.spec.kind, meshes: [], clips: [], gaits: [], textures: [], notes: [], faults: [] };
  const meshes = unpackMeshes(pack);
  const spec = asset.spec;
  if (spec.kind === "creature") checkCreature(asset, spec, pack, meshes, report);
  else if (spec.kind === "pieces") {
    for (const piece of spec.pieces) {
      const mesh = meshes.find((m) => m.id === piece.id);
      if (mesh) report.meshes.push(measureMesh(mesh, pack, spec.budgets.triangles, report.faults));
      else report.faults.push(`${piece.id}: not in the pack`);
    }
  } else {
    // Bodies are cut by slot, so every mesh ends at a cut. Their surfaces are counted and not judged.
    for (const mesh of meshes) report.meshes.push(measureMesh(mesh, pack, [], []));
    for (const clip of pack.clips.clips) report.clips.push({ name: clip.id, frames: clip.frames, seconds: clip.frames / TICK_RATE, loop: clip.loop, step: 0, still: 0 });
  }
  return report;
}

const cm = (metres: number): string => (metres * 100).toFixed(1);

/** Rows under a heading, each column as wide as its widest cell and set to the right. */
function table(heads: readonly string[], rows: readonly (readonly (string | number)[])[], indent: string): string[] {
  const all = [heads, ...rows].map((row) => row.map(String));
  const wide = heads.map((_, k) => Math.max(...all.map((row) => row[k]!.length)));
  return all.map((row) => indent + row.map((cell, k) => cell.padStart(wide[k]!)).join("  "));
}

/** The report as lines for the console. */
export function reportLines(r: Report): string[] {
  const out: string[] = [`${r.id} (${r.kind})`];
  const judged = !r.kind.startsWith("human");
  for (const m of r.meshes) {
    if (!judged) {
      out.push(`  mesh ${m.id}: triangles ${m.levels.map((l) => l.triangles).join(" ")}`);
      continue;
    }
    out.push(`  mesh ${m.id}: ${m.size.map((v) => v.toFixed(2)).join(" x ")} m${m.strays === undefined ? "" : `, ${m.strays} vertices on a bone the rig lacks`}`);
    const heads = ["level", "triangles", "budget", "vertices", "error cm", "from m", "px tall", "parts", "holes", "open edges", "flipped", "inside out"];
    out.push(...table(heads, m.levels.map((l, i) => [i, l.triangles, l.budget ?? "-", l.vertices, cm(l.error), i === 0 ? "-" : l.from.toFixed(0), i === 0 ? "-" : l.tall.toFixed(0), l.parts, l.holes, l.openEdges, l.flipped, l.insideOut]), "    "));
  }
  if (r.meshes.length > 0 && judged) out.push(`    from m and px tall: where the level is first drawn on ${TIER}, and how tall the mesh then stands on a ${SCREEN} pixel screen`);
  if (r.rig) out.push(`  rig: skeleton "${r.rig.skeleton}", ${r.rig.bones} bones, ${r.rig.capsules} hit capsules of which ${r.rig.buried.length} buried, sockets ${r.rig.sockets.join(", ") || "none"}`);
  if (r.clips.length > 0 && judged) {
    out.push(...table(["clip", "frames", "seconds", "loop", "largest step cm", "wrap cm", "still frames"], r.clips.map((c) => [c.name, c.frames, c.seconds.toFixed(2), c.loop ? "yes" : "no", cm(c.step), c.wrap === undefined ? "-" : cm(c.wrap), c.still]), "  "));
  } else if (r.clips.length > 0) out.push(`  ${r.clips.length} clips, ${r.clips.filter((c) => c.loop).length} of them loops`);
  for (const g of r.gaits) {
    out.push(`  gait ${g.clip}: stride ${g.stride ?? "-"} m, holds best at ${g.measured.toFixed(2)} m`);
    for (const f of g.feet) out.push(`    ${f.bone.padEnd(14)} planted ${(f.planted * 100).toFixed(0).padStart(3)}% of the clip, slides ${cm(f.slide)} cm`);
  }
  out.push("  textures: not measured yet (B1)");
  for (const n of r.notes) out.push(`  note: ${n}`);
  for (const f of r.faults) out.push(`  FAULT: ${f}`);
  out.push(r.faults.length === 0 ? "  ok" : `  ${r.faults.length} ${r.faults.length === 1 ? "fault" : "faults"}`);
  return out;
}
