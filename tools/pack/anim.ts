// Turns glTF animations into clips for a skeleton whose bones rest at identity, such as shared/anim/human.ts. The source
// must rest in the same pose as the target (for the human, a T-pose facing +Z). Its bone lengths do not matter.

import type { Clip } from "../../shared/anim/clip.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FINGERTIPS_L, B_FOOT_L, B_FOOT_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { quatMul, quatMulConj, quatNlerp, quatNormalize, quatRotate } from "../../shared/math/quat.ts";
import { nodeParents, readAccessor, type Gltf } from "./gltf.ts";

/** The source joint that drives each human bone, by name. Null for bones the source does not have. */
export const HUMAN_SOURCE_JOINTS: readonly (string | null)[] = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l",
  "thigh_r", "calf_r", "foot_r",
  "ball_l", "ball_r", "middle_01_l", "thumb_01_l", "middle_01_r", "thumb_01_r",
  null, null,
  "middle_02_l", "middle_02_r",
];

export interface ClipSpec {
  /** Animation name in the source file. */
  source: string;
  id: string;
  /** Defaults to true when the source name ends in "_Loop". */
  loop?: boolean;
  /** Starts the loop where the left foot is farthest forward, so gaits blend in step. */
  gait?: boolean;
  /** Inclusive range of source frames to keep. */
  from?: number;
  to?: number;
}

interface Track {
  times: Float64Array;
  values: Float64Array;
  size: number;
  step: boolean;
}

function sample(track: Track, time: number, out: Float64Array): void {
  const { times, values, size } = track;
  const n = times.length;
  // The key at or before `time`.
  let lo = 0;
  if (time >= times[n - 1]!) lo = n - 1;
  else if (time > times[0]!) {
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= time) lo = mid;
      else hi = mid;
    }
  }
  const hi = lo + 1;
  if (hi >= n || track.step || time <= times[lo]!) {
    for (let k = 0; k < size; k++) out[k] = values[lo * size + k]!;
    return;
  }
  const t = (time - times[lo]!) / (times[hi]! - times[lo]!);
  if (size === 4) quatNlerp(out, 0, values, lo * 4, values, hi * 4, t);
  else for (let k = 0; k < size; k++) out[k] = values[lo * size + k]! + (values[hi * size + k]! - values[lo * size + k]!) * t;
}

/** Throws if the file lacks a joint. A missing animation is skipped with a warning. */
export function convertHumanClips(g: Gltf, specs: readonly ClipSpec[]): { clips: Clip[]; warnings: string[] } {
  // Clips move each finger whole, from the bones before the fingertips; the fingertips stay straight. Distal bending
  // is an explicit runtime grip pose.
  const made = convertClips(g, HUMAN_SOURCE_JOINTS.slice(0, B_FINGERTIPS_L), HUMAN.parent, specs);
  const tipped = made.clips.map((clip): Clip => {
    const rot = new Float32Array(clip.frames * HUMAN_BONES * 4);
    for (let f = 0; f < clip.frames; f++) {
      rot.set(clip.rot.subarray(f * B_FINGERTIPS_L * 4, (f + 1) * B_FINGERTIPS_L * 4), f * HUMAN_BONES * 4);
      for (let b = B_FINGERTIPS_L; b < HUMAN_BONES; b++) rot[(f * HUMAN_BONES + b) * 4 + 3] = 1;
    }
    return { ...clip, rot, bones: HUMAN_BONES };
  });
  const clips = tipped.map((clip, i) => (made.specs[i]!.gait && clip.loop ? rotated(clip, leftFootForward(clip)) : clip));
  return { clips, warnings: made.warnings };
}

/**
 * `joints` names the source joint that drives each bone, or null. `parents` gives each bone's parent, with -1 for the
 * root, the only bone whose travel is kept. A bone's parent need not be its joint's parent in the source. Each bone's
 * rotation is its joint's turn from rest in model space, relative to the same turn of its parent bone.
 * Returns the clips and, in the same order, the spec each came from.
 */
export function convertClips(g: Gltf, joints: readonly (string | null)[], parents: ArrayLike<number>, specs: readonly ClipSpec[], scale = 1): { clips: Clip[]; specs: ClipSpec[]; warnings: string[] } {
  const BONES = joints.length;
  let rootBone = 0;
  for (let b = 0; b < BONES; b++) if (parents[b]! < 0) rootBone = b;
  const done: ClipSpec[] = [];
  const nodes = g.json.nodes ?? [];
  const parent = nodeParents(g);
  const warnings: string[] = [];
  // Parents before children.
  const order: number[] = [];
  const visit = (i: number): void => {
    order.push(i);
    nodes[i]!.children?.forEach(visit);
  };
  parent.forEach((p, i) => p < 0 && visit(i));

  const joint = joints.map((name) => {
    if (name === null) return -1;
    const i = nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`${g.path}: no joint named "${name}"`);
    return i;
  });

  const n = nodes.length;
  const localT = new Float64Array(n * 3);
  const localR = new Float64Array(n * 4);
  const localS = new Float64Array(n);
  const worldT = new Float64Array(n * 3);
  const worldR = new Float64Array(n * 4);
  const worldS = new Float64Array(n);
  const restLocal = (i: number): void => {
    const node = nodes[i]!;
    if (node.matrix) throw new Error(`${g.path}: node "${node.name}" uses a matrix; export with translation, rotation and scale`);
    for (let k = 0; k < 3; k++) localT[i * 3 + k] = node.translation?.[k] ?? 0;
    for (let k = 0; k < 4; k++) localR[i * 4 + k] = node.rotation?.[k] ?? (k === 3 ? 1 : 0);
    const s = node.scale ?? [1, 1, 1];
    if (Math.abs(s[0]! - s[1]!) > 1e-4 || Math.abs(s[0]! - s[2]!) > 1e-4) warnings.push(`node "${node.name}" has a non-uniform scale, read as ${s[0]}`);
    localS[i] = s[0]!;
  };
  const v = new Float64Array(3);
  const solveWorld = (): void => {
    for (const i of order) {
      const p = parent[i]!;
      if (p < 0) {
        for (let k = 0; k < 3; k++) worldT[i * 3 + k] = localT[i * 3 + k]!;
        for (let k = 0; k < 4; k++) worldR[i * 4 + k] = localR[i * 4 + k]!;
        worldS[i] = localS[i]!;
        continue;
      }
      quatMul(worldR, i * 4, worldR, p * 4, localR, i * 4);
      quatNormalize(worldR, i * 4);
      worldS[i] = worldS[p]! * localS[i]!;
      quatRotate(worldR, p * 4, localT[i * 3]! * worldS[p]!, localT[i * 3 + 1]! * worldS[p]!, localT[i * 3 + 2]! * worldS[p]!, v, 0);
      for (let k = 0; k < 3; k++) worldT[i * 3 + k] = worldT[p * 3 + k]! + v[k]!;
    }
  };

  for (let i = 0; i < n; i++) restLocal(i);
  solveWorld();
  const restR = worldR.slice();
  const restHips = [0, 1, 2].map((k) => worldT[joint[rootBone]! * 3 + k]!);

  const clips: Clip[] = [];
  const delta = new Float64Array(BONES * 4);
  const scratch = new Float64Array(4);
  for (const spec of specs) {
    const anim = g.json.animations?.find((a) => a.name === spec.source);
    if (!anim) {
      warnings.push(`no animation named "${spec.source}"`);
      continue;
    }
    const tracks: { node: number; path: string; track: Track }[] = [];
    let duration = 0;
    for (const ch of anim.channels) {
      if (ch.target.node === undefined || ch.target.path === "weights") continue;
      const s = anim.samplers[ch.sampler]!;
      const times = readAccessor(g, s.input).data;
      const out = readAccessor(g, s.output);
      let values = out.data;
      if (s.interpolation === "CUBICSPLINE") {
        // Drops the tangents. At one key per frame the difference cannot be seen.
        const picked = new Float64Array(times.length * out.size);
        for (let k = 0; k < times.length; k++) for (let c = 0; c < out.size; c++) picked[k * out.size + c] = values[(k * 3 + 1) * out.size + c]!;
        values = picked;
      }
      tracks.push({ node: ch.target.node, path: ch.target.path, track: { times, values, size: out.size, step: s.interpolation === "STEP" } });
      if (times[times.length - 1]! > duration) duration = times[times.length - 1]!;
    }
    const loop = spec.loop ?? /_Loop$/.test(spec.source);
    const keys = Math.round(duration * TICK_RATE) + 1;
    const first = spec.from ?? 0;
    // A loop's last key repeats its first.
    const last = Math.min(spec.to ?? Infinity, loop ? keys - 2 : keys - 1);
    const frames = last - first + 1;
    if (frames < 1) {
      warnings.push(`"${spec.source}" has no frames in the range asked for`);
      continue;
    }
    const rot = new Float32Array(frames * BONES * 4);
    const root = new Float32Array(frames * 3);
    const value = new Float64Array(4);
    for (let f = 0; f < frames; f++) {
      const time = (first + f) / TICK_RATE;
      for (let i = 0; i < n; i++) restLocal(i);
      for (const t of tracks) {
        sample(t.track, time, value);
        if (t.path === "rotation") {
          for (let k = 0; k < 4; k++) localR[t.node * 4 + k] = value[k]!;
          quatNormalize(localR, t.node * 4);
        } else if (t.path === "translation") for (let k = 0; k < 3; k++) localT[t.node * 3 + k] = value[k]!;
        else if (t.path === "scale") localS[t.node] = value[0]!;
      }
      solveWorld();
      // Each joint's turn from rest in model space is world(t) * world(rest)^-1.
      for (let b = 0; b < BONES; b++) {
        const j = joint[b]!;
        if (j < 0) continue;
        scratch[0] = -restR[j * 4]!;
        scratch[1] = -restR[j * 4 + 1]!;
        scratch[2] = -restR[j * 4 + 2]!;
        scratch[3] = restR[j * 4 + 3]!;
        quatMul(delta, b * 4, worldR, j * 4, scratch, 0);
      }
      for (let b = 0; b < BONES; b++) {
        const at = (f * BONES + b) * 4;
        const p = parents[b]!;
        if (joint[b]! < 0) rot[at + 3] = 1;
        else if (p < 0) for (let k = 0; k < 4; k++) rot[at + k] = delta[b * 4 + k]!;
        else {
          quatMulConj(scratch, 0, delta, p * 4, delta, b * 4);
          quatNormalize(scratch, 0);
          for (let k = 0; k < 4; k++) rot[at + k] = scratch[k]!;
        }
      }
      for (let k = 0; k < 3; k++) root[f * 3 + k] = (worldT[joint[rootBone]! * 3 + k]! - restHips[k]!) * scale;
    }
    clips.push({ id: spec.id, bones: BONES, frames, loop, rot, root });
    done.push(spec);
  }
  return { clips, specs: done, warnings };
}

/** The frame at which the left foot is farthest ahead of the right. */
function leftFootForward(clip: Clip): number {
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  let best = 0;
  let bestLead = -Infinity;
  for (let f = 0; f < clip.frames; f++) {
    pose.rot.set(clip.rot.subarray(f * HUMAN_BONES * 4, (f + 1) * HUMAN_BONES * 4));
    pose.root.set(clip.root.subarray(f * 3, f * 3 + 3));
    solve(HUMAN, pose, solved);
    const lead = solved.pos[B_FOOT_L * 3 + 2]! - solved.pos[B_FOOT_R * 3 + 2]!;
    if (lead > bestLead) {
      bestLead = lead;
      best = f;
    }
  }
  return best;
}

/** The same loop starting at frame `start`. */
function rotated(clip: Clip, start: number): Clip {
  if (start === 0) return clip;
  const width = clip.bones * 4;
  const rot = new Float32Array(clip.rot.length);
  const root = new Float32Array(clip.root.length);
  for (let f = 0; f < clip.frames; f++) {
    const from = (f + start) % clip.frames;
    rot.set(clip.rot.subarray(from * width, (from + 1) * width), f * width);
    root.set(clip.root.subarray(from * 3, from * 3 + 3), f * 3);
  }
  return { ...clip, rot, root };
}
