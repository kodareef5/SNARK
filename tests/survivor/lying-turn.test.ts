// A body laid down by its reaction lies against the facing it had then and turns to its player's facing as it stands
// (shared/anim/reactions.ts). Its player may turn it round and round while it gets up: it goes on round the way it has
// been going, so its head never jumps as the facing passes the way opposite.
import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, humanPose } from "../../shared/anim/pose.ts";
import { facingOf, packLie, REACT_FALL, REACT_RISE, withTurn } from "../../shared/anim/reactions.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { coreAnim } from "../fixtures/pack.ts";

const anim = coreAnim(), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), st = new AnimState();

/** Where the head of a body laid down by `word`, facing `facing` (a share of a turn), is at `tick`, about its place. */
function head(word: number, facing: number, tick: number): number[] {
  st.react = word;
  st.facing = facing;
  humanPose(anim, st, tick, pose);
  solve(HUMAN, pose, solved);
  const a = facing * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), x = solved.pos[B_HEAD * 3]!, z = solved.pos[B_HEAD * 3 + 2]!;
  return [c * x + s * z, solved.pos[B_HEAD * 3 + 1]!, c * z - s * x];
}

/**
 * Turns a body from facing `from` by `turn` (shares of a turn) in steps of `step`, keeping its word up to date as the
 * server does each tick, and returns the most its head moved between two steps.
 */
function sweep(kind: number, tick: number, from: number, turn: number, step: number): number {
  const start = 10, facing = facingOf(from * 65536);
  let word = packLie(kind, start, kind === REACT_FALL, 37, facing), last: number[] | null = null, most = 0;
  for (let k = 0; k <= Math.abs(turn) / step; k++) {
    const f = from + Math.sign(turn) * k * step;
    word = withTurn(word, f);
    const h = head(word, f, tick);
    if (last) most = Math.max(most, Math.hypot(h[0]! - last[0]!, h[1]! - last[1]!, h[2]! - last[2]!));
    last = h;
  }
  return most;
}

test("a body getting up goes on round as its player turns through the way opposite", () => {
  // Halfway up, turned twice round each way: 1/720 of a turn moves a head under 0.62 m from its hips 5.4 mm at most.
  for (const turn of [2, -2]) expect(sweep(REACT_RISE, 10 + 15, 0.3, turn, 1 / 720)).toBeLessThan(0.006);
  // A topple lying, and getting up from it.
  for (const age of [30, 67]) for (const turn of [1.5, -1.5]) expect(sweep(REACT_FALL, 10 + age, 0.7, turn, 1 / 720)).toBeLessThan(0.006);
});

test("one step of the facing across the way opposite barely moves the head", () => {
  // Facing a hair either side of the way opposite where it went down, having turned there: the same body.
  const facing = facingOf(0.25 * 65536);
  for (const way of [1, -1]) {
    let word = packLie(REACT_RISE, 10, false, 20, facing);
    for (let k = 1; k <= 64; k++) word = withTurn(word, 0.25 + (way * k) / 128);
    const near = 0.25 + way * 0.5, a = head(word, near - way / 65536, 25), b = head(word, near + way / 65536, 25);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)).toBeLessThan(0.001);
  }
});
