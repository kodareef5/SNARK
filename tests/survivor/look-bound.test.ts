// One skeleton is hit for every survivor, whatever its look (shared/anim/look.ts). The look's stretches that move the
// head are bounded instead, so a drawn head stays near the head shots are judged on and never outgrows it.
import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, HEAD_GROW, LOOK_SEX, lookLift, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { Rng } from "../../shared/rng.ts";
import { frozenPack } from "../fixtures/pack.ts";

const pack = frozenPack(), anim = new HumanAnim(pack.clips);

/** The middle of a solved head, stretched by `scale`. */
function headMiddle(s: Solved, scale: Float32Array | null): number[] {
  const k = (a: number): number => (scale ? scale[B_HEAD * 3 + a]! : 1), out = [0, 0, 0];
  boneToModel(s, B_HEAD, ((HUMAN.capA[B_HEAD * 3]! + HUMAN.capB[B_HEAD * 3]!) / 2) * k(0), ((HUMAN.capA[B_HEAD * 3 + 1]! + HUMAN.capB[B_HEAD * 3 + 1]!) / 2) * k(1), ((HUMAN.capA[B_HEAD * 3 + 2]! + HUMAN.capB[B_HEAD * 3 + 2]!) / 2) * k(2), out);
  return out;
}

test("every look stands with its head within 2.5 cm of the hit head, never outgrowing it", () => {
  const pose = new Pose(HUMAN_BONES), hit = new Solved(HUMAN_BONES), drawn = new Solved(HUMAN_BONES), rng = new Rng(3);
  humanPose(anim, new AnimState(), 30, pose);
  solve(HUMAN, pose, hit);
  const at = headMiddle(hit, null), root = pose.root[1]!;
  let tried = 0;
  for (const rig of pack.header.rigs.filter((r) => r.id === "human_m" || r.id === "human_f")) {
    const rest = Float32Array.from(rig.rest);
    const looks: ((r: number) => number)[] = [() => 0, () => -1, () => 1];
    for (let r = 0; r < REGION_COUNT; r++) for (const v of [-1, 1]) looks.push((q) => (q === r ? v : 0));
    for (let k = 0; k < 200; k++) {
      const values = Array.from({ length: REGION_COUNT }, () => rng.range(-1, 1));
      looks.push((q) => values[q]!);
    }
    for (const slider of looks) {
      const look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3);
      look[LOOK_SEX] = rig.id === "human_f" ? 1 : 0;
      for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, slider(r));
      lookScales(look, scale, rest);
      // Drawn as the renderer draws it: its legs lift its hips so its feet stay on the ground.
      pose.root[1] = root + lookLift(scale, rest);
      solve(HUMAN, pose, drawn, rest, scale);
      pose.root[1] = root;
      const m = headMiddle(drawn, scale);
      expect(Math.hypot(m[0]! - at[0]!, m[1]! - at[1]!, m[2]! - at[2]!), `${rig.id} ${tried}`).toBeLessThan(0.025);
      for (let a = 0; a < 3; a++) expect(scale[B_HEAD * 3 + a]!).toBeLessThanOrEqual(Math.fround(HEAD_GROW));
      tried++;
    }
  }
  expect(tried).toBeGreaterThan(400);
});
