// A survivor's emote over its pose (humanPose calls it): the emote's clip from its first tick, blended in over
// EMOTE_FADE ticks and, for a one-shot, out over its last; the whole body for a full emote, the back, arms and head
// for an upper one, over whatever the legs are doing. A synced loop plays at the world's tick, so every body dancing
// it so is in step; a pair's two sides share their first tick, set by the server as it brings them face to face.

import { Pose, blendPose, sampleClip, type Clip } from "./clip.ts";
import { EMOTE_FADE, emoteOf } from "./emotes.ts";
import { B_FINGERS_L, B_SPINE, B_UPPER_LEG_L, HUMAN, HUMAN_BONES } from "./human.ts";
import { EMOTE_SYNCED, type AnimState } from "./pose.ts";

/** Each bone's mirror image across the body (its .L for its .R), itself for a bone on the middle. */
export const HUMAN_MIRRORS: readonly number[] = HUMAN.names.map((name, bone) => {
  const other = name.endsWith(".L") ? name.slice(0, -2) + ".R" : name.endsWith(".R") ? name.slice(0, -2) + ".L" : name;
  const mirrored = HUMAN.names.indexOf(other);
  return mirrored < 0 ? bone : mirrored;
});

/** `out` as its mirror image: left for right, turned the other way about the body's up and forward axes. */
export function mirrorPose(from: Pose, out: Pose): void {
  for (let b = 0; b < HUMAN_BONES; b++) {
    const src = HUMAN_MIRRORS[b]! * 4;
    out.rot[b * 4] = from.rot[src]!;
    out.rot[b * 4 + 1] = -from.rot[src + 1]!;
    out.rot[b * 4 + 2] = -from.rot[src + 2]!;
    out.rot[b * 4 + 3] = from.rot[src + 3]!;
  }
  out.root[0] = -from.root[0]!;
  out.root[1] = from.root[1]!;
  out.root[2] = from.root[2]!;
}

/** Ticks since the emote began: its start is the low 16 bits of its first tick. A moment drawn just before it counts as 0. */
export function emoteElapsed(st: AnimState, tick: number): number {
  let e = (tick - st.emoteStart) % 65536;
  if (e < 0) e += 65536;
  return e > 65000 ? 0 : e;
}

const sampled = new Pose(HUMAN_BONES);
const flipped = new Pose(HUMAN_BONES);

/**
 * Plays the body's emote over `out`. Returns how much of the body it took: 0 for none, else its weight, negative for an
 * upper-body emote (so the caller keeps the hips' twist and the spine's share of the look for a full one only).
 */
export function emotePose(clips: readonly (Clip | null)[], st: AnimState, tick: number, out: Pose): number {
  if (st.emote === 0) return 0;
  const def = emoteOf(st.emote);
  const clip = clips[st.emote];
  if (!def || !clip) return 0;
  const e = emoteElapsed(st, tick);
  let w = e >= EMOTE_FADE ? 1 : e / EMOTE_FADE;
  let frame: number;
  if (def.loop) frame = st.emoteRole === EMOTE_SYNCED ? tick : e;
  else {
    const last = clip.frames - 1;
    frame = e < last ? e : last;
    const left = last - e;
    if (left < EMOTE_FADE) w = Math.min(w, left <= 0 ? 0 : left / EMOTE_FADE);
  }
  if (w <= 0) return 0;
  sampleClip(clip, frame, sampled);
  const pose = st.emoteMirror ? (mirrorPose(sampled, flipped), flipped) : sampled;
  if (def.mask === "full") {
    blendPose(out, out, pose, w);
    return w;
  }
  blendPose(out, out, pose, w, B_SPINE, B_UPPER_LEG_L);
  blendPose(out, out, pose, w, B_FINGERS_L, HUMAN_BONES);
  return -w;
}
