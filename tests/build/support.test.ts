// The reference game's support table, asked of structure rows.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { slopeKind } from "../../content/slopes.ts";
import { floorTop, units } from "../../shared/world/snap.ts";
import { STABILITY, Support } from "../../shared/world/support.ts";
import { TRIANGLE_HALF, hullWorld } from "../fixtures/hulls.ts";
import { count, join as joinTo, slot, start } from "../fixtures/slots.ts";
import { flatWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;

function setup(yaw = 0) {
  const w = flatWorld(4);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const kind = (piece: string): number => w.kind(`core:${piece}_wood`);
  const key = { fr: 0, k0: 0, k1: 0 };
  /** Whether a piece would stand in place `k` of `target`, without building it. */
  const would = (target: number, piece: string, k: number, turn = 0): boolean => {
    expect(slot(w, target, kind(piece), k, turn, key)).toBe(true);
    return support.standsAt(kind(piece), key.fr, key.k0, key.k1);
  };
  /** Builds a piece in place `k` of `target`, whether or not it would stand. */
  const join = (target: number, piece: string, k: number, turn = 0): number => {
    const ref = joinTo(w, target, kind(piece), k, turn);
    expect(ref).toBeGreaterThanOrEqual(0);
    return ref;
  };
  const foundation = (x: number, z: number): number => start(w, kind("foundation"), x, FOUNDATION_THICK / 2, z, yaw, 7);
  /** A pillar with its foot in the ground. */
  const pillar = (x: number, z: number): number => start(w, kind("pillar"), x, WALL_HEIGHT / 2 - 0.125, z, yaw, 7);
  return { w, support, would, join, foundation, pillar, kind };
}

test("what stands by itself, and what stands straight on it however high", () => {
  const { w, support, would, join, foundation, pillar, kind } = setup(7000);
  const f = foundation(100, 100);
  expect(support.standsRef(f)).toBe(true);
  const p = pillar(120, 100);
  expect(support.standsRef(p)).toBe(true);
  const floating = w.structs.add(kind("pillar"), 130, 4, 100, 0, 7, 1);
  expect(support.standsRef(floating)).toBe(false);
  for (const piece of ["wall", "ceiling", "stairs", "door"]) expect(support.standsRef(w.structs.add(kind(piece), 140, 1.6, 100 + ["wall", "ceiling", "stairs", "door"].indexOf(piece) * 8, 0, 7, 1))).toBe(false);
  let wall = join(f, "wall", 0);
  for (let storey = 0; storey < 5; storey++) {
    expect(support.standsRef(wall)).toBe(true);
    expect(would(wall, "wall", 0)).toBe(true);
    wall = join(wall, "wall", 0);
  }
  let col = p;
  for (let storey = 0; storey < 4; storey++) {
    expect(would(col, "pillar", 0)).toBe(true);
    col = join(col, "pillar", 0);
    expect(support.standsRef(col)).toBe(true);
  }
  expect(would(f, "pillar", 0)).toBe(true);
  expect(would(f, "stairs", 0)).toBe(true);
  expect(would(f, "pillar", 1)).toBe(true); // The foundation lies on the ground, so the pillar's foot is in the ground.
  // Support does not judge a structure that is not a building piece.
  expect(support.standsRef(w.structs.add(w.kind("core:block"), 60, 9, 60, 0, 0, 1))).toBe(true);
  expect(support.standsRef(0x7fff0000)).toBe(false);
});

test("a floor reaches two pieces out from what holds it and no further: (2,0) and (1,1) stand, (2,1) and (3,0) do not", () => {
  for (const yaw of [0, 9000, 16384, 31000]) {
    const { support, would, join, pillar } = setup(yaw);
    // A pillar in the ground with a ceiling on it is (0,0).
    const c00 = join(pillar(100, 100), "ceiling", 0);
    expect(support.standsRef(c00)).toBe(true);
    expect(would(c00, "ceiling", 1)).toBe(true);
    const c10 = join(c00, "ceiling", 1);
    expect(would(c10, "ceiling", 1)).toBe(true);
    const c20 = join(c10, "ceiling", 1);
    expect(support.standsRef(c20)).toBe(true);
    expect(would(c20, "ceiling", 1)).toBe(false);
    // (2,1) is farther than the reach and does not stand, from either neighbour.
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
    // A second pillar under the far end makes (3,0) stand, and the floor can go on from there.
    const far = join(c20, "pillar", 1);
    expect(support.standsRef(far)).toBe(true);
    expect(would(c20, "ceiling", 1)).toBe(true);
    const c30 = join(c20, "ceiling", 1);
    expect(would(c30, "ceiling", 1)).toBe(true);
  }
  expect(STABILITY).toBe(4);
});

test("held by walls: two floors out from the wall and not a third; walls on a floor near its support and not at the far edge of the second piece out", () => {
  const { w, support, would, join, foundation, kind } = setup(0);
  const f = foundation(100, 100);
  const walls = [0, 1, 2, 3].map((k) => join(f, "wall", k));
  const over = join(walls[1]!, "ceiling", 1);
  expect(support.standsRef(over)).toBe(true);
  // A ceiling set on a wall takes the wall's frame, which faces out, so its own +Z is away from the room.
  const out1 = join(walls[1]!, "ceiling", 0);
  const out2 = join(out1, "ceiling", 0);
  expect([support.standsRef(out1), support.standsRef(out2)]).toEqual([true, true]);
  expect(would(out2, "ceiling", 0)).toBe(false);
  // The upper storey's walls stand straight on the lower ones, through the floor.
  for (const k of [0, 1, 2, 3]) expect(would(over, "wall", k)).toBe(true);
  expect(would(out1, "wall", 0)).toBe(true);
  expect(would(out2, "wall", 0)).toBe(false);
  // Stairs stand in the middle of a piece, so on the second piece out they are still within reach of the wall.
  expect(would(out1, "stairs", 0)).toBe(true);
  expect(would(out2, "stairs", 0)).toBe(true);
  // From a pillar too, a wall stands on the rim of the first piece out and not of the second.
  const { would: pwould, join: pjoin, pillar } = setup(0);
  const c0 = pjoin(pillar(100, 100), "ceiling", 0);
  const c1 = pjoin(c0, "ceiling", 1);
  const c2 = pjoin(c1, "ceiling", 1);
  expect([pwould(c0, "wall", 1), pwould(c1, "wall", 1), pwould(c2, "wall", 1)]).toEqual([true, true, false]);

  // Near is not joined. A ceiling beside a wall but in no slot of its base stands on nothing.
  const loose = w.structs.add(kind("ceiling"), 104.2, FOUNDATION_THICK + WALL_HEIGHT - 0.125, 104.2, 0, 7, 1);
  expect(support.standsRef(loose)).toBe(false);
  // A door stands in its frame and nowhere else.
  const frame = join(foundation(120, 100), "doorframe", 0);
  expect(would(frame, "door", 0)).toBe(true);
  expect(support.standsRef(w.structs.add(kind("door"), 126, 1.5, 100, 0, 7, 1))).toBe(false);
  // Floors joined in a ring with nothing under any of them hold nothing up, each other included.
  const a = start(w, kind("ceiling"), 150, 6, 150, 0, 7);
  const b = join(a, "ceiling", 1);
  const c = join(b, "ceiling", 0);
  const d = join(c, "ceiling", 3);
  expect([a, b, c, d].map((r) => support.standsRef(r))).toEqual([false, false, false, false]);
  // A question visits only a handful of pieces.
  support.standsRef(out2);
  expect(support.visited).toBeLessThan(12);
  expect(units(1)).toBe(U);
});

test("a map's static is no building piece, sloped or not: it offers no place, holds nothing up and is never judged", () => {
  const w = flatWorld(4);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const statics = w.reg.defs.flatMap((d, k) => (d?.type === "structure" && d.class === "static" ? [k] : []));
  expect(statics).toContain(w.kind(slopeKind("roof")));
  expect(statics.filter((k) => w.reg.role[k] !== -1)).toEqual([]);
  // A roof left in the air stands, as a box static does, and a floor beside it is offered no place on it.
  const roof = w.structs.add(w.kind(slopeKind("roof")), 100, 9, 100, 0, 0, 9000);
  expect(support.standsRef(roof)).toBe(true);
  expect(count(w, roof, w.kind("core:ceiling_wood"))).toBe(0);
});

test("a thing stands on a floor of convex parts where its foot is on the part's top under its middle, level or sloped", () => {
  const w = hullWorld();
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const box = w.kind("core:storage_box");
  const half = units(0.3125);
  const set = (ref: number, x: number, z: number, y = floorTop(w.structs, w.reg, ref, units(x), units(z))): boolean => support.stands(box, units(x), y + half, units(z));
  // On a triangle foundation, and not off it over the square about its corner, at the same height.
  const tri = w.structs.add(w.kind("test:triangle"), 100, TRIANGLE_HALF, 100, 0, 7, 1);
  expect(set(tri, 101.5, 100.8)).toBe(true);
  expect(set(tri, 99.2, 99.2, units(2 * TRIANGLE_HALF))).toBe(false);
  // A sloped roof slab over a pillar, its top level with the pillar's: a thing come down on its slope stands there, and
  // not at the height of its peak. The slab has no form, so it is in no base: it is the one that stands by itself.
  start(w, w.kind("core:pillar_stone"), 150, WALL_HEIGHT / 2 - 0.125, 150, 0, 7);
  const roofY = units(WALL_HEIGHT - 0.125) - units(w.reg.halfY[w.kind("test:roof_standing")]!);
  const roof = w.structs.add(w.kind("test:roof_standing"), 150, roofY / U, 150, 0, 7, 1);
  expect(support.standsRef(roof)).toBe(true);
  expect([set(roof, 150.4, 149), set(roof, 149, 151.2)]).toEqual([true, true]);
  expect(set(roof, 150.4, 149, roofY + units(w.reg.halfY[w.kind("test:roof_standing")]!))).toBe(false);
});
