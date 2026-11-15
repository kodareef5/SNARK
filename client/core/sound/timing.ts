// When, within a creature's clips, a sound belongs: read from the motion itself, so a new creature needs no numbers. A
// blow lands where its mouth is farthest from where it started, a peck at the ground where its mouth comes lowest, a
// cry starts as its jaw opens, and a falling body thumps where its hips come down.

import type { Clip } from "../../../shared/anim/clip.ts";
import { sampleClip } from "../../../shared/anim/clip.ts";
import { FADE } from "../../../shared/anim/creature.ts";
import type { Rig } from "../../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../../shared/coords.ts";

/** The sockets a mouth may be named by, in order. Without any, the bone farthest from the root at rest stands in. */
const MOUTHS = ["beak_tip", "mouth", "jaw_tip", "head"];

/** Where the mouth is in each frame of `clip`, three numbers a frame, in the body's own space. */
function mouthTrack(rig: Rig, clip: Clip): Float64Array {
  const socket = MOUTHS.map((m) => rig.sockets.get(m)).find((s) => s !== undefined);
  let bone = socket?.bone ?? 0;
  if (!socket) {
    let far = -1;
    for (let b = 0; b < rig.bones; b++) {
      const d = Math.hypot(rig.rest[b * 3]!, rig.rest[b * 3 + 1]!, rig.rest[b * 3 + 2]!);
      if (d > far) [far, bone] = [d, b];
    }
  }
  const out = new Float64Array(clip.frames * 3);
  const at = [0, 0, 0];
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f, rig.a);
    solve(rig, rig.a, rig.solved);
    boneToModel(rig.solved, bone, socket?.x ?? 0, socket?.y ?? 0, socket?.z ?? 0, at);
    out.set(at, f * 3);
  }
  return out;
}

/** Seconds into `clip` at which a blow lands: where the mouth is farthest from its place in the first frame. */
export function strikeAt(rig: Rig, clip: Clip | null): number {
  if (!clip) return 0;
  const t = mouthTrack(rig, clip);
  let best = 0;
  let at = 0;
  for (let f = 1; f < clip.frames; f++) {
    const d = Math.hypot(t[f * 3]! - t[0]!, t[f * 3 + 1]! - t[1]!, t[f * 3 + 2]! - t[2]!);
    if (d > best) [best, at] = [d, f];
  }
  return at / TICK_RATE;
}

/**
 * Seconds into `clip` at which the mouth meets the ground: the lowest point of each dip that comes within a tenth of its
 * whole drop of the lowest of all. A mouth that hovers just over the ground between pecks rises out of that tenth, so
 * each peck is its own. Empty where the mouth does not come 5 cm under where it started.
 */
export function groundPecks(rig: Rig, clip: Clip): number[] {
  const t = mouthTrack(rig, clip);
  const y = (f: number): number => t[f * 3 + 1]!;
  let low = Infinity;
  for (let f = 0; f < clip.frames; f++) low = Math.min(low, y(f));
  const drop = y(0) - low;
  if (drop < 0.05) return [];
  const out: number[] = [];
  let dip = -1;
  for (let f = 0; f < clip.frames; f++) {
    if (y(f) <= low + drop * 0.1) {
      if (dip < 0 || y(f) < y(dip)) dip = f;
    } else if (dip >= 0) {
      out.push(dip / TICK_RATE);
      dip = -1;
    }
  }
  if (dip >= 0) out.push(dip / TICK_RATE);
  return out;
}

/** Seconds into `clip` at which the jaw has opened most of the way, or as the clip has faded in where the rig has no jaw. */
export function mouthOpens(rig: Rig, clip: Clip): number {
  const jaw = rig.names.indexOf("jaw");
  if (jaw < 0) return FADE / TICK_RATE;
  const angle = (f: number): number => {
    const i = (f * clip.bones + jaw) * 4;
    const j = jaw * 4;
    // The turn between this frame's jaw and the first frame's.
    const dot = Math.abs(clip.rot[i]! * clip.rot[j]! + clip.rot[i + 1]! * clip.rot[j + 1]! + clip.rot[i + 2]! * clip.rot[j + 2]! + clip.rot[i + 3]! * clip.rot[j + 3]!);
    return 2 * Math.acos(Math.min(1, dot));
  };
  let most = 0;
  for (let f = 0; f < clip.frames; f++) most = Math.max(most, angle(f));
  if (most < 0.05) return FADE / TICK_RATE;
  for (let f = 0; f < clip.frames; f++) if (angle(f) >= most * 0.4) return f / TICK_RATE;
  return 0;
}

/** Seconds into `clip` at which the body meets the ground: where its root has come within a seventh of the way down. */
export function bodyDown(rig: Rig, clip: Clip | null): number {
  if (!clip) return 0;
  const heights = new Float64Array(clip.frames);
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f, rig.a);
    solve(rig, rig.a, rig.solved);
    heights[f] = rig.solved.pos[1]!;
  }
  let low = Infinity;
  for (const h of heights) low = Math.min(low, h);
  const fall = heights[0]! - low;
  if (fall < 0.02) return 0;
  for (let f = 0; f < clip.frames; f++) if (heights[f]! <= low + fall * 0.15) return f / TICK_RATE;
  return 0;
}
