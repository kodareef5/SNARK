// Long hair's guides (client/core/render/hair-motion.ts): the skin a curtain takes them in, rows that hang as the head
// nods and turn with it as it looks round, a swing the head's motion moves and its reach bounds, and no allocation.

import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { writeBones } from "../../client/core/render/characters.ts";
import { HAIR_ROW, HAIR_ROWS, HairMotion, guideSkin } from "../../client/core/render/hair-motion.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, B_NECK, B_UPPER_CHEST, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { SKIN_BYTES } from "../../shared/pack/pack.ts";

const REST = HUMAN.rest;
const J = [REST[B_HEAD * 3]!, REST[B_HEAD * 3 + 1]!, REST[B_HEAD * 3 + 2]!];
const BLOCK = HAIR_ROW + HAIR_ROWS;

/** The bone rows of a body at (x, 0, 0), its head turned on its neck by `yaw` about the upright and `nod` about the side. */
function posed(yaw: number, nod: number, x = 0): { bones: Float32Array; solved: Solved } {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), bones = new Float32Array(BLOCK * BONE_FLOATS);
  const turn = new Float64Array(4);
  quatAxis(turn, 0, 0, 1, 0, yaw);
  const tip = new Float64Array(4);
  quatAxis(tip, 0, 1, 0, 0, nod);
  // Yaw after the nod, on the neck, so the head turns about the chest's upright.
  const q = [turn[3]! * tip[0]! + turn[0]! * tip[3]! + turn[1]! * tip[2]! - turn[2]! * tip[1]!, turn[3]! * tip[1]! - turn[0]! * tip[2]! + turn[1]! * tip[3]! + turn[2]! * tip[0]!, turn[3]! * tip[2]! + turn[0]! * tip[1]! - turn[1]! * tip[0]! + turn[2]! * tip[3]!, turn[3]! * tip[3]! - turn[0]! * tip[0]! - turn[1]! * tip[1]! - turn[2]! * tip[2]!];
  pose.rot.set(q, B_NECK * 4);
  solve(HUMAN, pose, solved);
  writeBones(bones, 0, solved, REST, null, x, 0, 0, 0);
  return { bones, solved };
}

/** Where bone `b`'s row takes the rest point `p`. */
const apply = (bones: Float32Array, b: number, p: readonly number[]): number[] => [0, 1, 2].map((r) => bones[b * BONE_FLOATS + r * 4]! * p[0]! + bones[b * BONE_FLOATS + r * 4 + 1]! * p[1]! + bones[b * BONE_FLOATS + r * 4 + 2]! * p[2]! + bones[b * BONE_FLOATS + r * 4 + 3]!);

/** A point hanging 12 cm under the head's joint and 5 cm behind it. */
const HUNG = [J[0]!, J[1]! - 0.12, J[2]! - 0.05];

test("the upper chest's share of a curtain goes to the guides either side of it", () => {
  // Behind the head, at its left side, and on the head alone.
  const rest = Float32Array.of(J[0]!, J[1]! - 0.1, J[2]! - 0.1, J[0]! + 0.1, J[1]! - 0.1, J[2]!, J[0]!, J[1]! + 0.1, J[2]!);
  const skin = new Uint8Array(3 * SKIN_BYTES);
  skin.set([B_HEAD, B_UPPER_CHEST, B_HEAD, B_HEAD, 55, 200, 0, 0], 0);
  skin.set([B_UPPER_CHEST, B_UPPER_CHEST, B_UPPER_CHEST, B_UPPER_CHEST, 255, 0, 0, 0], SKIN_BYTES);
  skin.set([B_HEAD, B_HEAD, B_HEAD, B_HEAD, 255, 0, 0, 0], 2 * SKIN_BYTES);
  expect(guideSkin(rest, skin, 3, J[0]!, J[2]!)).toBe(true);
  const weight = (v: number, bone: number): number => [0, 1, 2, 3].reduce((s, k) => s + (skin[v * SKIN_BYTES + k] === bone ? skin[v * SKIN_BYTES + 4 + k]! : 0), 0);
  expect([weight(0, B_HEAD), weight(0, HAIR_ROW + 1), weight(0, HAIR_ROW + 2)]).toEqual([55, 100, 100]);
  expect(weight(1, HAIR_ROW)).toBe(255);
  expect(weight(2, B_HEAD)).toBe(255);
  expect(weight(0, B_UPPER_CHEST) + weight(1, B_UPPER_CHEST)).toBe(0);
  expect(guideSkin(rest.subarray(6), skin.subarray(2 * SKIN_BYTES), 1, J[0]!, J[2]!)).toBe(false);
});

test("at rest a guide is the head's row; turned, it follows the turn but not the nod", () => {
  const m = new HairMotion();
  const still = posed(0, 0);
  m.rows(still.bones, 0, REST, still.solved, 1, 0, 30, 0, 0, 0);
  for (let g = 0; g < HAIR_ROWS; g++) for (let k = 0; k < BONE_FLOATS; k++) expect(still.bones[(HAIR_ROW + g) * BONE_FLOATS + k]!).toBeCloseTo(still.bones[B_HEAD * BONE_FLOATS + k]!, 5);
  // Looking round by 0.6 rad, the hair turns by three quarters of it about the head's joint.
  const turned = posed(0.6, 0);
  m.rows(turned.bones, 0, REST, turned.solved, 2, 0, 30, 0, 0, 0);
  const at = apply(turned.bones, HAIR_ROW + 1, HUNG), joint = apply(turned.bones, B_HEAD, J);
  const a = 0.45, d = [HUNG[0]! - J[0]!, HUNG[1]! - J[1]!, HUNG[2]! - J[2]!];
  const want = [d[0]! * Math.cos(a) + d[2]! * Math.sin(a), d[1]!, -d[0]! * Math.sin(a) + d[2]! * Math.cos(a)];
  for (let c = 0; c < 3; c++) expect(at[c]! - joint[c]!).toBeCloseTo(want[c]!, 3);
  // Nodding forward 0.5 rad, the hair hangs nearly straight: a fifth of the nod.
  const nod = posed(0, 0.5);
  m.rows(nod.bones, 0, REST, nod.solved, 3, 0, 30, 0, 0, 0);
  const hung = apply(nod.bones, HAIR_ROW + 1, HUNG), head = apply(nod.bones, B_HEAD, HUNG), j = apply(nod.bones, B_HEAD, J);
  const angle = (p: number[]): number => Math.atan2(p[2]! - j[2]!, -(p[1]! - j[1]!)) - Math.atan2(d[2]!, -d[1]!);
  expect(Math.abs(angle(hung))).toBeCloseTo(0.1, 2);
  expect(Math.abs(angle(head))).toBeCloseTo(0.5, 2);
});

test("a sudden move swings the guides no farther than their reach allows, and they settle", () => {
  const m = new HairMotion();
  const still = posed(0, 0);
  m.rows(still.bones, 0, REST, still.solved, 1, 0, 30, 0, 0, 0);
  // Jerked a metre aside in one tick.
  const moved = posed(0, 0, 1);
  m.rows(moved.bones, 0, REST, moved.solved, 1, 1, 30, 0, 0, 0);
  const swing = (b: Float32Array): number => {
    const hung = apply(b, HAIR_ROW, HUNG), head = apply(b, B_HEAD, HUNG), j = apply(b, B_HEAD, J);
    const u = hung.map((x, c) => x - j[c]!), v = head.map((x, c) => x - j[c]!);
    return Math.acos(Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(...u) * Math.hypot(...v))));
  };
  const first = swing(moved.bones);
  expect(first).toBeGreaterThan(0.2);
  expect(first).toBeLessThanOrEqual(0.35 + 1e-3);
  // Held there, it comes to rest within three seconds.
  for (let t = 2; t <= 90; t++) m.rows(moved.bones, 0, REST, moved.solved, 1, t, 30, 0, 0, 0);
  expect(swing(moved.bones)).toBeLessThan(0.02);
  // Not seen for a while, it starts again hanging still.
  m.rows(still.bones, 0, REST, still.solved, 1, 500, 30, 0, 0, 0);
  expect(swing(still.bones)).toBeLessThan(1e-4);
});

test("sixteen groomed bodies write their guides without allocating", () => {
  const m = new HairMotion(), bodies = Array.from({ length: 16 }, (_, k) => posed(0.05 * k, 0.02 * k, k));
  const step = (t: number): void => {
    for (let k = 0; k < 16; k++) m.rows(bodies[k]!.bones, 0, REST, bodies[k]!.solved, 100 + k, t, 30, 0, 0, 0);
  };
  for (let t = 0; t < 100; t++) step(t);
  Bun.gc(true);
  const before = heapStats().objectCount;
  for (let t = 100; t < 2100; t++) step(t);
  Bun.gc(true);
  expect(heapStats().objectCount - before).toBeLessThan(50);
});
