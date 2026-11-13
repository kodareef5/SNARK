// What holds a piece up: the reference's support table, asked of rows.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { poseAt, units, type Pose } from "../../shared/world/snap.ts";
import { CEILING_REACH, LOAD_REACH, Support } from "../../shared/world/support.ts";
import { flatWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;

function setup(yaw = 0) {
  const w = flatWorld(4);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const kind = (piece: string): number => w.kind(`core:${piece}_wood`);
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Whether a piece would stand in place `k` of `target`, without building it. */
  const would = (target: number, piece: string, k: number, turn = 0): boolean => {
    expect(poseAt(w.structs, w.reg, target, kind(piece), k, turn, pose)).toBe(true);
    return support.stands(kind(piece), pose.x, pose.y, pose.z, pose.yaw);
  };
  /** Build a piece in place `k` of `target`, whether or not it would stand. */
  const join = (target: number, piece: string, k: number, turn = 0): number => {
    expect(poseAt(w.structs, w.reg, target, kind(piece), k, turn, pose)).toBe(true);
    return w.structs.add(kind(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7, 1);
  };
  const foundation = (x: number, z: number): number => w.structs.add(kind("foundation"), x, FOUNDATION_THICK / 2, z, yaw, 7, 1);
  /** A pillar with its foot in the ground. */
  const pillar = (x: number, z: number): number => w.structs.add(kind("pillar"), x, WALL_HEIGHT / 2 - 0.125, z, yaw, 7, 1);
  return { w, support, would, join, foundation, pillar, kind };
}

test("what stands by itself, and what stands straight on it however high", () => {
  const { w, support, would, join, foundation, pillar, kind } = setup(7000);
  // A foundation stands. A pillar with its foot in the ground stands; one in the air does not.
  const f = foundation(100, 100);
  expect(support.standsRef(f)).toBe(true);
  const p = pillar(120, 100);
  expect(support.standsRef(p)).toBe(true);
  const floating = w.structs.add(kind("pillar"), 130, 4, 100, 0, 7, 1);
  expect(support.standsRef(floating)).toBe(false);
  // A wall by itself on the ground does not, nor a ceiling, nor stairs.
  for (const piece of ["wall", "ceiling", "stairs", "door"]) expect(support.standsRef(w.structs.add(kind(piece), 140, 1.6, 100 + ["wall", "ceiling", "stairs", "door"].indexOf(piece) * 8, 0, 7, 1))).toBe(false);
  // Walls on a foundation's edge, and walls on those, five storeys up.
  let wall = join(f, "wall", 0);
  for (let storey = 0; storey < 5; storey++) {
    expect(support.standsRef(wall)).toBe(true);
    expect(would(wall, "wall", 0)).toBe(true);
    wall = join(wall, "wall", 0);
  }
  // Pillars on pillars likewise, and on a foundation; stairs on a foundation.
  let col = p;
  for (let storey = 0; storey < 4; storey++) {
    expect(would(col, "pillar", 0)).toBe(true);
    col = join(col, "pillar", 0);
    expect(support.standsRef(col)).toBe(true);
  }
  expect(would(f, "pillar", 0)).toBe(true);
  expect(would(f, "stairs", 0)).toBe(true);
  // A pillar hung under a foundation does not reach the ground here, and holds nothing; the foundation stands regardless.
  expect(would(f, "pillar", 1)).toBe(true); // its foot is in the ground: a foundation lies on it
  // Something that is not a building piece is no concern of this.
  expect(support.standsRef(w.structs.add(w.kind("core:block"), 60, 9, 60, 0, 0, 1))).toBe(true);
  expect(support.standsRef(0x7fff0000)).toBe(false);
});

test("a floor reaches two pieces out from what holds it and no further: (2,0) and (1,1) stand, (2,1) and (3,0) do not", () => {
  for (const yaw of [0, 9000, 16384, 31000]) {
    const { support, would, join, pillar } = setup(yaw);
    // A pillar in the ground with a ceiling on it: the middle of the table.
    const c00 = join(pillar(100, 100), "ceiling", 0);
    expect(support.standsRef(c00)).toBe(true);
    // Out along one side: one, two, and not three.
    expect(would(c00, "ceiling", 1)).toBe(true);
    const c10 = join(c00, "ceiling", 1);
    expect(would(c10, "ceiling", 1)).toBe(true);
    const c20 = join(c10, "ceiling", 1);
    expect(support.standsRef(c20)).toBe(true);
    expect(would(c20, "ceiling", 1)).toBe(false);
    // Round the corner: (1,1) stands; (2,1), further on the flat than the reach, does not, from either neighbour.
    expect(would(c10, "ceiling", 0)).toBe(true);
    const c11 = join(c10, "ceiling", 0);
    expect(support.standsRef(c11)).toBe(true);
    expect(would(c20, "ceiling", 0)).toBe(false);
    expect(would(c11, "ceiling", 1)).toBe(false);
    // (1,2) the other way round is the same distance, and fails the same.
    const c01 = join(c00, "ceiling", 0);
    const c02 = join(c01, "ceiling", 0);
    expect(support.standsRef(c02)).toBe(true);
    expect(would(c02, "ceiling", 1)).toBe(false);
    // A second pillar under the far end makes (3,0) stand, and a floor go on from there.
    const far = join(c20, "pillar", 1);
    expect(support.standsRef(far)).toBe(true);
    expect(would(c20, "ceiling", 1)).toBe(true);
    const c30 = join(c20, "ceiling", 1);
    expect(would(c30, "ceiling", 1)).toBe(true);
  }
  expect([CEILING_REACH, LOAD_REACH]).toEqual([6.5, 5]);
});

test("held by walls: two floors out from the wall and not a third; walls on a floor near its support and not at the far edge of the second piece out", () => {
  const { w, support, would, join, foundation, kind } = setup(0);
  const f = foundation(100, 100);
  const walls = [0, 1, 2, 3].map((k) => join(f, "wall", k));
  // The floor over the room, and out past the east wall: one, two, not three.
  const over = join(walls[1]!, "ceiling", 1);
  expect(support.standsRef(over)).toBe(true);
  // (A ceiling set on a wall takes the wall's frame, which faces out: its own +Z is away from the room.)
  const out1 = join(walls[1]!, "ceiling", 0);
  const out2 = join(out1, "ceiling", 0);
  expect([support.standsRef(out1), support.standsRef(out2)]).toEqual([true, true]);
  expect(would(out2, "ceiling", 0)).toBe(false);
  // The upper storey's walls stand straight on the lower ones, through the floor.
  for (const k of [0, 1, 2, 3]) expect(would(over, "wall", k)).toBe(true);
  // A wall on the far edge of the first piece out stands; on the far edge of the second, it does not.
  expect(would(out1, "wall", 0)).toBe(true);
  expect(would(out2, "wall", 0)).toBe(false);
  // Stairs stand in the middle of a piece: on the second out they are still within reach of the wall.
  expect(would(out1, "stairs", 0)).toBe(true);
  expect(would(out2, "stairs", 0)).toBe(true);
  // The same from a pillar: on the rim of the first piece out, yes; of the second, no.
  const { would: pwould, join: pjoin, pillar } = setup(0);
  const c0 = pjoin(pillar(100, 100), "ceiling", 0);
  const c1 = pjoin(c0, "ceiling", 1);
  const c2 = pjoin(c1, "ceiling", 1);
  expect([pwould(c0, "wall", 1), pwould(c1, "wall", 1), pwould(c2, "wall", 1)]).toEqual([true, true, false]);

  // Near is not joined: a ceiling beside a wall but not in any place of anything stands on nothing.
  const loose = w.structs.add(kind("ceiling"), 104.2, FOUNDATION_THICK + WALL_HEIGHT - 0.125, 104.2, 0, 7, 1);
  expect(support.standsRef(loose)).toBe(false);
  // A door stands in its frame and nowhere else.
  const frame = join(foundation(120, 100), "doorframe", 0);
  expect(would(frame, "door", 0)).toBe(true);
  expect(support.standsRef(w.structs.add(kind("door"), 126, 1.5, 100, 0, 7, 1))).toBe(false);
  // Floors joined in a ring with nothing under any of them hold nothing up, each other included.
  const a = w.structs.add(kind("ceiling"), 150, 6, 150, 0, 7, 1);
  const b = join(a, "ceiling", 1);
  const c = join(b, "ceiling", 0);
  const d = join(c, "ceiling", 3);
  expect([a, b, c, d].map((r) => support.standsRef(r))).toEqual([false, false, false, false]);
  // What a question costs is small: a handful of pieces looked at.
  support.standsRef(out2);
  expect(support.visited).toBeLessThan(12);
  expect(units(1)).toBe(U);
});
