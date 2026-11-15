// When, within a creature's clips, something meets the ground: read from the motion itself, so a new creature needs no
// numbers. A falling body meets it where its root has come most of the way down; a beak meets it where it comes lowest.
// Details read these (client/core/details/), and sound may read them too.

import { TICK_RATE } from "../coords.ts";
import { sampleClip, type Clip } from "./clip.ts";
import type { Rig } from "./rigs.ts";
import { boneToModel, solve } from "./skeleton.ts";

/** Seconds into `clip` at which the body meets the ground: where its root has come within a seventh of the way down. 0 without a fall. */
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
  for (let f = 0; f < clip.frames; f++) if (heights[f]! <= low + fall / 7) return f / TICK_RATE;
  return 0;
}

/** Seconds into `clip` at which the body has risen most of the way back up from its lowest: getting up, the moment it shakes itself. */
export function bodyUp(rig: Rig, clip: Clip | null): number {
  if (!clip) return 0;
  let low = Infinity;
  let high = -Infinity;
  const heights = new Float64Array(clip.frames);
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f, rig.a);
    solve(rig, rig.a, rig.solved);
    heights[f] = rig.solved.pos[1]!;
    low = Math.min(low, heights[f]!);
    high = Math.max(high, heights[f]!);
  }
  if (high - low < 0.02) return 0;
  for (let f = clip.frames - 1; f > 0; f--) if (heights[f - 1]! < low + (high - low) * 0.8 && heights[f]! >= low + (high - low) * 0.8) return f / TICK_RATE;
  return 0;
}

/**
 * Seconds into `clip` at which the socket `name` meets the ground: the lowest point of each dip that comes within a tenth
 * of its whole drop of the lowest of all. Empty where the socket is not on the rig or does not come 5 cm under where it
 * started.
 */
export function socketDips(rig: Rig, clip: Clip, name: string): number[] {
  const socket = rig.sockets.get(name);
  if (!socket) return [];
  const y = new Float64Array(clip.frames);
  const at = [0, 0, 0];
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f, rig.a);
    solve(rig, rig.a, rig.solved);
    boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
    y[f] = at[1]!;
  }
  let low = Infinity;
  for (const v of y) low = Math.min(low, v);
  const drop = y[0]! - low;
  if (drop < 0.05) return [];
  const out: number[] = [];
  let dip = -1;
  for (let f = 0; f < clip.frames; f++) {
    if (y[f]! <= low + drop * 0.1) {
      if (dip < 0 || y[f]! < y[dip]!) dip = f;
    } else if (dip >= 0) {
      out.push(dip / TICK_RATE);
      dip = -1;
    }
  }
  if (dip >= 0) out.push(dip / TICK_RATE);
  return out;
}
