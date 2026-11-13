// Animation clips and poses.
//
// A clip is a table: for every frame and every bone, the bone's rotation
// relative to its parent, plus where the root bone is. Frames are one
// simulation tick apart, so the pose at a whole tick is a table lookup. Every
// skeleton rests with all rotations at identity, which makes a clip independent
// of the body it was made on: the same table drives any rig with those bones.
//
// A pose is the same thing for one moment: `bones * 4` rotation numbers and
// three root numbers. Everything here is exactly rounded arithmetic, so the
// server and every client compute the same pose from the same inputs.

import { quatNlerp } from "../math/quat.ts";

export interface Clip {
  readonly id: string;
  readonly bones: number;
  /** Distinct frames. A looping clip continues from the last frame to frame 0. */
  readonly frames: number;
  readonly loop: boolean;
  /** frames * bones * 4: rotation of each bone relative to its parent. */
  readonly rot: Float32Array;
  /** frames * 3: the root bone's position relative to where it rests. */
  readonly root: Float32Array;
}

export interface ClipSet {
  readonly clips: readonly Clip[];
  readonly index: ReadonlyMap<string, number>;
  /** Changes when any clip changes. The server and its clients must agree. */
  readonly hash: number;
}

export const NO_CLIPS: ClipSet = { clips: [], index: new Map(), hash: 0 };

/** One pose: `rot` holds `bones * 4` numbers, `root` three. */
export class Pose {
  readonly rot: Float32Array;
  readonly root = new Float32Array(3);

  constructor(bones: number) {
    this.rot = new Float32Array(bones * 4);
    this.rest();
  }

  /** Every bone at rest. */
  rest(): void {
    this.rot.fill(0);
    for (let i = 3; i < this.rot.length; i += 4) this.rot[i] = 1;
    this.root.fill(0);
  }
}

/**
 * The pose of `clip` at `frame` (which may fall between frames) into `out`.
 * A looping clip wraps; any other holds its first and last frames.
 */
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
  const root = clip.root;
  for (let k = 0; k < 3; k++) out.root[k] = root[f0 * 3 + k]! + (root[f1 * 3 + k]! - root[f0 * 3 + k]!) * t;
}

/** out = a toward b by t, for bones `from` up to `to`. The root is blended only when the range starts at bone 0. */
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
