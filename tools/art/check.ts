// Measures what the engine depends on in an asset's pack, and says nothing about taste. It prints numbers and counts
// as a fault only what would draw wrong: a hole, a face turned inward, a vertex on no bone, a loop that jumps as it
// wraps, a planted foot that slides, a level over its budget. A wanted opening in a mesh is two faces back to back.

import { TIERS, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Pose, sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { Solved, boneToModel, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { surfaceError } from "../pack/error.ts";
import { spanOf } from "../pack/surface.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";
import type { Asset } from "./assets.ts";
import type { CreatureAsset } from "./spec.ts";
import { measureTextures, type MaterialFacts } from "./textures.ts";

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
/** Texel density is remarked on when one material on one mesh has this many times the pixels to a metre of another. */
const DENSITY = 2;

export interface LevelFacts {
  triangles: number;
  vertices: number;
  /** The most triangles the asset allows the level, or null where it gives none. */
  budget: number | null;
  /** Metres its surface lies from the finest level's, as the pack holds it: measured, or stated by the asset. */
  error: number;
  /** Where the asset states the error: the error measured on its points, for the reader to set against it. */
  measured?: number;
  /** Metres off at which the level is first drawn on medium, and how many pixels tall the mesh then stands. Both 0 for the finest. */
  from: number;
  tall: number;
  /** The same on each tier in TIERS' order, 0 for the finest the tier draws, null where the tier never draws it. */
  starts: ({ from: number; tall: number } | null)[];
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
  collapsed: number;
  /** In a level drawn with materials: how many it is drawn with, and its vertices shared by triangles that lay the picture both ways round. */
  materials?: number;
  bothWays?: number;
}

export interface MeshFacts {
  id: string;
  /** Metres across, up and along. */
  size: [number, number, number];
  levels: LevelFacts[];
  /** In a skinned mesh: vertices, over all levels, that follow a bone the rig does not have. */
  strays?: number;
  /**
   * In a mesh drawn with materials, for each on its finest level: the metres one picture spans as measured there,
   * and the pixels of its widest texture to a metre.
   */
  materials?: { id: string; span: number; texels: number }[];
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
  /** The bodies of the ragdoll, with their limits and how far the clips bend each, in degrees. */
  ragdoll?: { limp: number; bodies: { bone: string; swing: number; twist: number; bent: [number, number] }[] };
  /** The materials the asset names, each with its pictures (tools/art/textures.ts), and what their textures weigh. */
  textures: MaterialFacts[];
  megabytes: { textures: number; budget: number | null };
  /** Whether the pictures were read and measured. Without that only their sizes are known. */
  pictures: boolean;
  notes: string[];
  faults: string[];
}

/** The vertices of a level that are shared by triangles that lay the picture both ways round. Each has one tangent, which is wrong for one side. */
export function bothWays(lod: SourceLod): number[] {
  const { uvs, indices } = lod;
  if (!uvs) return [];
  const sense = new Uint8Array(uvs.length / 2);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t]! * 2, indices[t + 1]! * 2, indices[t + 2]! * 2];
    const det = (uvs[b]! - uvs[a]!) * (uvs[c + 1]! - uvs[a + 1]!) - (uvs[c]! - uvs[a]!) * (uvs[b + 1]! - uvs[a + 1]!);
    if (det !== 0) for (const v of [a, b, c]) sense[v / 2]! |= det > 0 ? 1 : 2;
  }
  return [...sense.keys()].filter((v) => sense[v] === 3);
}

/** Counts what is wrong with the surface of one level. Points at one place are one point, whatever colour or bone they carry. */
export function measureSurface(lod: SourceLod): Pick<LevelFacts, "parts" | "openEdges" | "holes" | "flipped" | "insideOut" | "crowded" | "collapsed"> {
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
  let collapsed = 0;
  for (let t = 0; t + 2 < lod.indices.length; t += 3) {
    const [a, b, c] = [point[lod.indices[t]!]!, point[lod.indices[t + 1]!]!, point[lod.indices[t + 2]!]!];
    if (a === b || b === c || a === c) {
      collapsed++;
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
  for (const [key, [fore, back]] of edges) {
    const [u, v] = [Math.floor(key / n), key % n];
    if (fore + back === 1) {
      openEdges++;
      rim[rimOf(u)] = rimOf(v);
      onRim.add(u).add(v);
    } else if (fore + back > 2) crowded++;
    else if (fore !== back) flipped++;
  }
  const holes = new Set([...onRim].map(rimOf)).size;

  // A part's volume, measured about its own middle, is below zero when its faces look inward. A part is judged only if
  // it holds enough volume for its area to be a body and not a sheet: what a simplified level leaves of a small part
  // (two triangles back to back) and a thin card hold none to speak of, and either sign.
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
  for (const part of parts.values()) {
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
    if (-volume > 0.002 * area ** 1.5) insideOut++;
  }
  return { parts: parts.size, openEdges, holes, flipped, insideOut, crowded, collapsed };
}

/**
 * Where each level of a mesh `height` metres tall with these errors is first drawn on `tier`, on a SCREEN-row screen,
 * and how many pixels tall it then stands: the tier draws the coarsest level whose error it lets pass. The finest
 * the tier draws is drawn from 0 m. Null for a level the tier never draws: one finer than its finest, or one no
 * coarser level is worse than.
 */
export function levelStarts(errors: readonly number[], height: number, tier: Tier): ({ from: number; tall: number } | null)[] {
  const scale = SCREEN / (2 * Math.tan(FOV_Y / 2));
  const finest = Math.min(tier.finest, errors.length - 1);
  return errors.map((error, level) => {
    if (level === finest) return { from: 0, tall: 0 };
    if (level < finest || error <= 0 || errors.slice(level + 1).some((e) => e <= error)) return null;
    const from = (error * scale) / tier.threshold;
    return { from, tall: (height * scale) / from };
  });
}

function measureMesh(mesh: SourceMesh, pack: Pack, budgets: readonly number[], faults: string[], bones?: number, stated?: readonly number[]): MeshFacts {
  const header = pack.header.meshes[pack.meshIndex.get(mesh.id)!]!;
  const tall = header.half[1] * 2;
  const errors = header.lods.map((l, level) => (level === 0 ? 0 : l.error));
  const starts = TIERS.map((tier) => levelStarts(errors, tall, tier));
  const medium = TIERS.indexOf(tierOf(TIER));
  let strays = 0;
  const levels = mesh.lods.map((lod, l): LevelFacts => {
    const error = errors[l]!;
    const at = starts.map((s) => s[l] ?? null);
    const facts: LevelFacts = {
      triangles: lod.indices.length / 3,
      vertices: lod.positions.length / 3,
      budget: budgets[l] ?? null,
      error,
      from: l === 0 ? 0 : (at[medium]?.from ?? Infinity),
      tall: l === 0 ? 0 : (at[medium]?.tall ?? 0),
      starts: at,
      ...measureSurface(lod),
    };
    if (l > 0 && stated?.[l - 1] !== undefined) facts.measured = surfaceError(mesh.lods[0]!, lod);
    const where = `${mesh.id} level ${l}`;
    if (facts.budget !== null && facts.triangles > facts.budget) faults.push(`${where}: ${facts.triangles} triangles, and its budget is ${facts.budget}`);
    if (facts.budget === null && budgets.length > 0) faults.push(`${where}: the asset gives this level no triangle budget`);
    if (facts.holes > 0) faults.push(`${where}: ${facts.holes} ${facts.holes === 1 ? "hole" : "holes"} (${facts.openEdges} open edges)`);
    if (facts.flipped > 0) faults.push(`${where}: ${facts.flipped} edges between faces that look opposite ways`);
    if (facts.insideOut > 0) faults.push(`${where}: ${facts.insideOut} of its ${facts.parts} parts inside out`);
    if (bones !== undefined && lod.bones) for (const b of lod.bones) if (b >= bones) strays++;
    if (l >= (mesh.flat ?? 0)) return facts;
    const mixed = bothWays(lod);
    facts.materials = new Set(lod.sections ?? [0]).size;
    facts.bothWays = mixed.length;
    if (mixed.length > 0) faults.push(`${where}: ${mixed.length} vertices are shared by triangles that lay the picture both ways round, so one side of each is lit wrongly (the first at ${[...lod.positions.subarray(mixed[0]! * 3, mixed[0]! * 3 + 3)].map((v) => v.toFixed(3)).join(", ")}). A model whose export writes tangents has such vertices twice`);
    return facts;
  });
  const out: MeshFacts = { id: mesh.id, size: [header.half[0] * 2, tall, header.half[2] * 2], levels };
  if (mesh.flat) {
    const fine = mesh.lods[0]!;
    out.materials = (mesh.materials ?? []).flatMap((m, k) => {
      if (!(fine.sections ? fine.sections.includes(k) : k === 0)) return [];
      const span = spanOf(fine, k);
      const widest = Math.max(0, ...TEXTURE_ROLES.map((role) => mesh.textures?.[m[role]]?.top ?? 0));
      return [{ id: m.id, span, texels: widest / span }];
    });
  }
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
  // A foot is planted while it is low and not on its way forward: it has come back since the frame before, or goes back to the next.
  const planted = tracks.map((t) => {
    const low = Math.min(...t.y);
    const rise = Math.max(...t.y) - low;
    return Array.from(t.y, (y, f) => y - low <= rise * PLANTED && (t.z[f]! <= t.z[(f + n - 1) % n]! + STILL || t.z[(f + 1) % n]! <= t.z[f]! + STILL));
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
    const stated = spec.gaits[c.name]?.stated;
    for (const foot of gait.feet) {
      if (foot.slide <= SLIDE_SHARE * given) continue;
      const says = `clip "${c.name}": ${foot.bone} slides ${(foot.slide * 100).toFixed(1)} cm while planted at a stride of ${given} m (it holds best at ${gait.measured.toFixed(2)} m)`;
      if (stated) notes.push(`${says}. The stride is stated: ${stated}`);
      else faults.push(says);
    }
  }
  if (spec.ragdoll) report.ragdoll = checkRagdoll(rig, spec, pack, faults, notes);
  for (const bone of spec.feet) if (!rig.names.includes(bone)) faults.push(`foot "${bone}" is not a bone of the rig`);
  for (const name of Object.keys(spec.gaits)) if (!spec.clips.some((c) => c.name === name)) faults.push(`gait "${name}" is not one of the clips`);
}

/**
 * The ragdoll as the rig carries it. Faults: a body on a bone with no capsule, a body with no listed body above it but
 * the first, a share of the mass not above 0, a limp frame past the death clip. Noted: a limit narrower than a clip bends
 * the joint, which the ragdoll then starts past and closes in from.
 */
function checkRagdoll(rig: Rig, spec: CreatureAsset, pack: Pack, faults: string[], notes: string[]): Report["ragdoll"] {
  const def = rig.ragdoll;
  const listed = spec.ragdoll!.bodies;
  if (!def || def.bone.length !== listed.length) {
    faults.push(`ragdoll: the rig has ${def?.bone.length ?? 0} bodies of the ${listed.length} the asset lists. Build it again`);
    return undefined;
  }
  const doll = new Ragdoll(rig, def);
  listed.forEach((b, i) => {
    if (!(rig.capR[def.bone[i]!]! > 0)) faults.push(`ragdoll: "${b.bone}" carries no hit capsule, and a body is its capsule`);
    if (i > 0 && doll.parent[i]! < 0) faults.push(`ragdoll: "${b.bone}" has no listed body above it, and only the first may not`);
    if (!(b.mass > 0)) faults.push(`ragdoll: "${b.bone}" has no share of the mass`);
  });
  if (rig.death && def.limp > rig.death.frames - 1) faults.push(`ragdoll: it goes limp at frame ${def.limp}, past the death clip's last, ${rig.death.frames - 1}`);
  // How far each clip bends each joint, in the body's own frame against its parent body's.
  const bent = listed.map((): [number, number] => [0, 0]);
  const pose = new Pose(rig.bones);
  const solved = new Solved(rig.bones);
  for (const c of spec.clips) {
    const clip = pack.clips.clips[pack.clips.index.get(`${rig.id}/${c.name}`) ?? -1];
    if (!clip || clip.bones !== rig.bones) continue;
    for (let f = 0; f < clip.frames; f++) {
      sampleClip(clip, f, pose);
      solve(rig, pose, solved);
      doll.start(solved, solved, 0, 0, 0, 0, 1);
      for (let i = 1; i < listed.length; i++) {
        const [swing, twist] = doll.bend(i);
        bent[i]![0] = Math.max(bent[i]![0], (swing * 180) / Math.PI);
        bent[i]![1] = Math.max(bent[i]![1], (twist * 180) / Math.PI);
      }
    }
  }
  const bodies = listed.map((b, i) => ({ bone: b.bone, swing: b.swing ?? 0, twist: b.twist ?? 0, bent: bent[i]! }));
  for (const b of bodies.slice(1)) {
    if (b.bent[0] > b.swing + 1 || b.bent[1] > b.twist + 1) notes.push(`ragdoll: the clips bend "${b.bone}" ${b.bent[0].toFixed(0)} degrees and twist it ${b.bent[1].toFixed(0)}, past its limits of ${b.swing} and ${b.twist}`);
  }
  return { limp: def.limp, bodies };
}

/**
 * Measures the pack an asset was converted to. With `pictures`, the pictures its materials name are read and measured
 * too, which takes seconds. Without, only their sizes are.
 */
export function checkAsset(asset: Asset, pack: Pack, pictures = false): Report {
  const report: Report = { id: asset.id, kind: asset.spec.kind, meshes: [], clips: [], gaits: [], textures: [], megabytes: { textures: 0, budget: null }, pictures, notes: [], faults: [] };
  const meshes = unpackMeshes(pack);
  const spec = asset.spec;
  if (spec.kind === "creature") checkCreature(asset, spec, pack, meshes, report);
  else if (spec.kind === "pieces") {
    for (const piece of spec.pieces) {
      const mesh = meshes.find((m) => m.id === piece.id);
      if (mesh) report.meshes.push(measureMesh(mesh, pack, spec.budgets.triangles, report.faults, undefined, piece.errors));
      else report.faults.push(`${piece.id}: not in the pack`);
    }
  } else {
    // Bodies are cut by slot, so every mesh ends at a cut. Their surfaces are counted and not judged.
    for (const mesh of meshes) report.meshes.push(measureMesh(mesh, pack, [], []));
    for (const clip of pack.clips.clips) report.clips.push({ name: clip.id, frames: clip.frames, seconds: clip.frames / TICK_RATE, loop: clip.loop, step: 0, still: 0 });
    return report;
  }
  const textures = measureTextures(asset, pack, pictures, report.faults, report.notes);
  report.textures = textures.materials;
  report.megabytes = { textures: textures.megabytes, budget: textures.budget };
  // One material drawn much finer on one mesh than on another shows as a blurred mesh beside a sharp one.
  const drawn = report.meshes.flatMap((m) => (m.materials ?? []).filter((d) => d.texels > 0).map((d) => ({ mesh: m.id, ...d })));
  const [least, most] = [drawn.reduce((a, b) => (b.texels < a.texels ? b : a), drawn[0]!), drawn.reduce((a, b) => (b.texels > a.texels ? b : a), drawn[0]!)];
  if (drawn.length > 1 && most.texels > DENSITY * least.texels) {
    report.notes.push(`texel density runs from ${least.texels.toFixed(0)} pixels a metre (${least.id} on ${least.mesh}) to ${most.texels.toFixed(0)} (${most.id} on ${most.mesh}), more than ${DENSITY} times apart`);
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
    const stated = m.levels.some((l) => l.measured !== undefined);
    const heads = ["level", "triangles", "budget", "vertices", "error cm", ...(stated ? ["measured cm"] : []), ...TIERS.map((t) => `${t.name} m, px`), "parts", "holes", "open edges", "flipped", "inside out", "materials"];
    const start = (s: { from: number; tall: number } | null): string => (s === null ? "-" : s.from === 0 ? "0" : `${s.from.toFixed(0)}, ${s.tall.toFixed(0)}`);
    out.push(...table(heads, m.levels.map((l, i) => [i, l.triangles, l.budget ?? "-", l.vertices, cm(l.error), ...(stated ? [l.measured === undefined ? "-" : cm(l.measured)] : []), ...l.starts.map(start), l.parts, l.holes, l.openEdges, l.flipped, l.insideOut, l.materials ?? "flat"]), "    "));
    for (const d of m.materials ?? []) out.push(`    ${d.id}: a picture spans ${d.span.toFixed(2)} m here${d.texels > 0 ? `, ${d.texels.toFixed(0)} pixels a metre` : ""}`);
  }
  if (r.meshes.length > 0 && judged) {
    out.push(`    m, px: where each tier first draws the level and how many pixels tall the mesh then stands on a ${SCREEN} pixel screen; 0 the finest it draws, - never`);
    if (r.meshes.some((m) => m.levels.some((l) => l.measured !== undefined))) out.push("    measured cm: where the asset states a level's error, what is measured on its points, set against it");
  }
  if (r.rig) out.push(`  rig: skeleton "${r.rig.skeleton}", ${r.rig.bones} bones, ${r.rig.capsules} hit capsules of which ${r.rig.buried.length} buried, sockets ${r.rig.sockets.join(", ") || "none"}`);
  if (r.clips.length > 0 && judged) {
    out.push(...table(["clip", "frames", "seconds", "loop", "largest step cm", "wrap cm", "still frames"], r.clips.map((c) => [c.name, c.frames, c.seconds.toFixed(2), c.loop ? "yes" : "no", cm(c.step), c.wrap === undefined ? "-" : cm(c.wrap), c.still]), "  "));
  } else if (r.clips.length > 0) out.push(`  ${r.clips.length} clips, ${r.clips.filter((c) => c.loop).length} of them loops`);
  if (r.ragdoll) {
    out.push(`  ragdoll: limp from frame ${r.ragdoll.limp} of the death clip`);
    out.push(...table(["body", "swing", "twist", "clips bend", "clips twist"], r.ragdoll.bodies.map((b, i) => [b.bone, i === 0 ? "-" : b.swing, i === 0 ? "-" : b.twist, i === 0 ? "-" : b.bent[0].toFixed(0), i === 0 ? "-" : b.bent[1].toFixed(0)]), "    "));
  }
  for (const g of r.gaits) {
    out.push(`  gait ${g.clip}: stride ${g.stride ?? "-"} m, holds best at ${g.measured.toFixed(2)} m`);
    for (const f of g.feet) out.push(`    ${f.bone.padEnd(14)} planted ${(f.planted * 100).toFixed(0).padStart(3)}% of the clip, slides ${cm(f.slide)} cm`);
  }
  for (const t of r.textures) {
    const tops = Object.entries(t.tops).map(([role, top]) => `${role} ${top}`).join(", ");
    out.push(`  material ${t.id}: ${t.tiles ? "tiles every" : "a picture spans"} ${+t.span.toFixed(2)} m, stored as ${tops || "nothing"}`);
    out.push(...table(["picture", "pixels", "bits", "wraps", "file"], t.layers.map((l) => [l.what, l.width === l.height ? l.width : `${l.width}x${l.height}`, l.depth, l.seam ? l.seam.map((v) => v.toFixed(2)).join(" ") : "-", ` ${l.file}`]), "    "));
    if (t.mean && t.nearest) out.push(`    mean colour ${t.mean.join(", ")}: the nearest palette colour is ${t.nearest.colour}, ${t.nearest.distance.toFixed(1)} away`);
    if (t.normal) out.push(`    normal against height: ${t.normal.x.toFixed(2)} across, ${t.normal.y.toFixed(2)} down (1 is exactly), mean length ${t.normal.length.toFixed(3)}, furthest from 1 by ${t.normal.off.toFixed(3)}`);
    if (t.regions) out.push(`    regions:${t.regions.stray === undefined ? "" : ` ${(t.regions.stray * 100).toFixed(2)}% of the map is no region's colour,`} cover ${t.regions.cover.map((c) => `${(c * 100).toFixed(0)}%`).join(" ")}, the weights sum to ${t.regions.most.toFixed(2)} at most`);
    for (const [what, db] of Object.entries(t.shrunk ?? {})) out.push(`    ${what}, shrunk, against its small one: ${db.toFixed(1)} dB`);
  }
  if (r.textures.length > 0) {
    out.push(`  textures: ${r.megabytes.textures.toFixed(1)} MB in the largest variant${r.megabytes.budget === null ? "" : `, of ${r.megabytes.budget} MB allowed`}${r.pictures ? "" : ". The pictures were not read: wraps, normals, regions and sizes against each other are measured by --check"}`);
    if (r.textures.some((t) => t.layers.some((l) => l.seam))) out.push("    wraps: how hard a tiling picture jumps across its edge, across and down, against inside it. About 1 where it tiles");
  }
  for (const n of r.notes) out.push(`  note: ${n}`);
  for (const f of r.faults) out.push(`  FAULT: ${f}`);
  out.push(r.faults.length === 0 ? "  ok" : `  ${r.faults.length} ${r.faults.length === 1 ? "fault" : "faults"}`);
  return out;
}
