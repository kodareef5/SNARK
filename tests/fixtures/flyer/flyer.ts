// The pteranodon as the game has it, for tests and pictures of flight: what it plays on its rig from the core pack, and
// how far its clips turn each bone.

import { sampleClip } from "../../../shared/anim/clip.ts";
import { CreatureAnim } from "../../../shared/anim/creature.ts";
import { buildRig, type Rig } from "../../../shared/anim/rigs.ts";
import { Solved, solve } from "../../../shared/anim/skeleton.ts";
import { corePack } from "../pack.ts";
import { coreRegistry } from "../world.ts";

export const FLYER = "core:pteranodon";

let anim: CreatureAnim | null = null;

/** What the pteranodon plays, as the server and every client make it. */
export function flyerAnim(): CreatureAnim {
  if (anim) return anim;
  const pack = corePack();
  const r = coreRegistry();
  const i = r.index.get(FLYER)!;
  const rig = buildRig(pack.header.rigs.find((g) => g.skeleton === "pteranodon")!, pack.clips)!;
  return (anim = new CreatureAnim(rig, r.runAt[i]!, r.move[i]?.swimSpeed ?? 0));
}

/** Degrees between the turns of `bone` in two solved poses, in model space. */
export function turnBetween(a: Float32Array, b: Float32Array, bone: number): number {
  let d = 0;
  for (let k = 0; k < 4; k++) d += a[bone * 4 + k]! * b[bone * 4 + k]!;
  return (2 * Math.acos(Math.min(1, Math.abs(d))) * 180) / Math.PI;
}

/** The most any clip of `rig` turns each bone from one frame to the next, a loop's last frame to its first included, in degrees. */
export function clipTurns(rig: Rig): Float64Array {
  const most = new Float64Array(rig.bones);
  const was = new Solved(rig.bones);
  for (const clip of rig.clips.values()) {
    for (let f = 0; f <= (clip.loop ? clip.frames : clip.frames - 1); f++) {
      sampleClip(clip, f, rig.a);
      solve(rig, rig.a, rig.solved);
      if (f > 0) for (let b = 0; b < rig.bones; b++) most[b] = Math.max(most[b]!, turnBetween(rig.solved.rot, was.rot, b));
      was.rot.set(rig.solved.rot);
    }
  }
  return most;
}
