// Survivors reeling from blows, as every machine poses them for drawing and for judging shots: the solver's curve for a
// spread of reaction words, the pose laid over a standing body at fractional ticks through each, and the topple.
import { createHash } from "node:crypto";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { packReact, reactCurve, reactFrames, REACT_FALL, REACT_HEAVY, REACT_STAGGER } from "../../shared/anim/reactions.ts";

/** The hash of reaction curves and the poses they make. */
export function reactionTrace(): string {
  const hash = createHash("sha256"), anim = new HumanAnim(NO_CLIPS), st = new AnimState(), pose = new Pose(HUMAN.bones);
  const words: number[] = [];
  for (const kind of [REACT_STAGGER, REACT_HEAVY]) for (let dir = 0; dir < 16; dir += 3) for (let height = 0; height < 4; height++) words.push(packReact(kind, 40, dir, height, (dir + height) & 3));
  for (let dir = 0; dir < 16; dir += 5) words.push(packReact(REACT_FALL, 40, dir, 1, 0));
  for (const word of words) {
    const curve = reactCurve(word);
    if (curve) hash.update(new Uint8Array(curve.buffer, curve.byteOffset, curve.byteLength));
    st.react = word;
    for (let t = 39; t <= 40 + reactFrames(word); t += 2.25) {
      humanPose(anim, st, t, pose);
      hash.update(new Uint8Array(pose.rot.buffer, pose.rot.byteOffset, pose.rot.byteLength));
      hash.update(new Uint8Array(pose.root.buffer, pose.root.byteOffset, pose.root.byteLength));
    }
  }
  return hash.digest("hex");
}

if (import.meta.main) console.log(reactionTrace());
