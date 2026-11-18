// A clip stores each bone's parent-relative rotation per frame, one frame per tick. Every skeleton rests at identity rotations,
// so one clip drives any rig with those bones. The arithmetic is exactly rounded, so the server and every client compute the same pose.

import { quatNlerp } from "../math/quat.ts";

export interface Clip {
  readonly id: string;
  readonly bones: number;
  /** A looping clip continues from the last frame to frame 0. */
  readonly frames: number;
  readonly loop: boolean;
  /** frames * bones * 4 numbers. Each rotation is relative to the bone's parent. */
  readonly rot: Float32Array;
  /** frames * 3 numbers, the root bone's offset from its rest position. */
  readonly root: Float32Array;
}

export interface ClipSet {
  readonly clips: readonly Clip[];
  readonly index: ReadonlyMap<string, number>;
  /** Changes when any clip changes. The server and its clients must agree. The sum of its clips' own, so sets joined sum theirs. */
  readonly hash: number;
}

export const NO_CLIPS: ClipSet = { clips: [], index: new Map(), hash: 0 };

/** One set of the clips of several that share none. */
export function joinClips(sets: readonly ClipSet[]): ClipSet {
  const clips = sets.flatMap((s) => s.clips);
  return { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: sets.reduce((h, s) => (h + s.hash) >>> 0, 0) };
}

export class Pose {
  readonly rot: Float32Array;
  readonly root = new Float32Array(3);

  constructor(bones: number) {
    this.rot = new Float32Array(bones * 4);
    this.rest();
  }

  rest(): void {
    this.rot.fill(0);
    for (let i = 3; i < this.rot.length; i += 4) this.rot[i] = 1;
    this.root.fill(0);
  }
}

/** `frame` may fall between frames. A looping clip wraps, and any other holds its first and last frames. */
export function sampleClip(clip: Clip, frame: number, out: Pose): void {
  const n = clip.frames;
  let f = frame;
  if (clip.loop) {
    f -= Math.floor(f / n) * n;
  } else if (f < 0) f = 0;
  else if (f > n - 1) f = n - 1;
  const f0 = Math.floor(f);
  const t = f - f0;
  let f1 = f0 + 1;
  if (f1 >= n) f1 = clip.loop ? 0 : n - 1;
  const width = clip.bones * 4;
  const a = f0 * width;
  const b = f1 * width;
  const rot = clip.rot;
  const o = out.rot;
  if (t === 0) {
    for (let i = 0; i < width; i++) o[i] = rot[a + i]!;
  } else {
    for (let i = 0; i < width; i += 4) quatNlerp(o, i, rot, a + i, rot, b + i, t);
  }
  // A newer skeleton may append optional geometry bones. Legacy clips must clear a prior special pose on those bones.
  for (let i = width; i < o.length; i += 4) { o[i] = 0; o[i + 1] = 0; o[i + 2] = 0; o[i + 3] = 1; }
  const root = clip.root;
  for (let k = 0; k < 3; k++) out.root[k] = root[f0 * 3 + k]! + (root[f1 * 3 + k]! - root[f0 * 3 + k]!) * t;
}

/** Blends a toward b by t for bones `from` to `to`, exclusive. The root blends only when the range starts at bone 0. */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number, from = 0, to = out.rot.length >> 2): void {
  if (t <= 0) {
    if (out !== a) copyBones(out, a, from, to);
    return;
  }
  if (t >= 1) {
    if (out !== b) copyBones(out, b, from, to);
    return;
  }
  for (let i = from * 4; i < to * 4; i += 4) quatNlerp(out.rot, i, a.rot, i, b.rot, i, t);
  if (from === 0) for (let k = 0; k < 3; k++) out.root[k] = a.root[k]! + (b.root[k]! - a.root[k]!) * t;
}

function copyBones(out: Pose, src: Pose, from: number, to: number): void {
  for (let i = from * 4; i < to * 4; i++) out.rot[i] = src.rot[i]!;
  if (from === 0) for (let k = 0; k < 3; k++) out.root[k] = src.root[k]!;
}
