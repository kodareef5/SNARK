// Roofs, sloped walls and the ramp: which form and turn the pieces round a slot ask for, what holds a roof and what it
// holds, what a gable shuts, and a body on the slopes.

import { expect, test } from "bun:test";
import type { EngramDef, StructureDef } from "../../shared/content/defs.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { RESULT_NO_SNAP, RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { riseAt, type LatticeKey } from "../../shared/world/lattice/frames.ts";
import { cellOf } from "../../shared/world/lattice/module.ts";
import { propose, type Proposal } from "../../shared/world/lattice/place.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { Plot, at, cornerFault, keyOf, leaks } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const fit: Proposal = { variant: 0, rot: 0, held: false };
const ROOFS = (tier: string): number[] => [...reg.places[id(`piece_roof_${tier}`)]!];
const GABLES = (tier: string): number[] => [...reg.places[id(`piece_sloped_wall_${tier}`)]!];

test("roofs, sloped walls and the ramp are kinds: a roof with its hip and valley on one item, the two hands of a sloped wall on one, the ramp on the stairs'", () => {
  for (const tier of ["wood", "stone", "metal"]) {
    expect(ROOFS(tier)).toEqual([id(`roof_${tier}`), id(`roof_hip_${tier}`), id(`roof_valley_${tier}`)]);
    expect([...reg.places[id(`piece_triangle_roof_${tier}`)]!]).toEqual([id(`triangle_roof_${tier}`), id(`triangle_roof_low_${tier}`)]);
    expect(GABLES(tier)).toEqual([id(`sloped_wall_left_${tier}`), id(`sloped_wall_right_${tier}`)]);
    expect([...reg.places[id(`piece_stairs_${tier}`)]!]).toEqual([id(`stairs_${tier}`), id(`ramp_${tier}`)]);
  }
  // Thatch has the reference's sloped roof and sloped walls, and no triangle or ramp.
  expect([ROOFS("thatch").length, GABLES("thatch").length, reg.index.get("core:triangle_roof_thatch"), reg.index.get("core:ramp_thatch")]).toEqual([3, 2, undefined, undefined]);
  const engram = (name: string): [number, number] => [(reg.defs[id(`engram-piece_${name}`)] as EngramDef).level, (reg.defs[id(`engram-piece_${name}`)] as EngramDef).cost];
  expect([engram("roof_wood"), engram("sloped_wall_wood"), engram("triangle_roof_stone"), engram("roof_thatch"), engram("roof_metal")]).toEqual([[14, 4], [12, 3], [27, 4], [5, 3], [47, 10]]);
  expect([(reg.defs[id("roof_wood")] as StructureDef).hp, (reg.defs[id("roof_thatch")] as StructureDef).hp, (reg.defs[id("triangle_roof_metal")] as StructureDef).hp]).toEqual([10000, 1600, 5000]);
  // A roof's collider is convex parts, two for a hip or a valley; it rises two levels and its cell reaches three.
  const parts = (name: string): number => reg.parts.hulls!.start[id(name) + 1]! - reg.parts.hulls!.start[id(name)]!;
  expect([parts("roof_wood"), parts("roof_hip_wood"), parts("roof_valley_wood"), parts("triangle_roof_wood"), parts("ramp_wood"), parts("sloped_wall_left_wood")]).toEqual([1, 2, 2, 1, 1, 1]);
  expect([reg.forms.reach[id("roof_wood")], reg.forms.reach[id("ceiling_wood")], reg.forms.rise[id("ceiling_wood")]]).toEqual([3, 1, 0]);
});

/** A house two squares by two with walls all round, in a plot begun at its south-west foundation. */
function house(yaw: number): { w: TestWorld; p: Plot; walls: number[] } {
  const w = flatWorld(4);
  const p = new Plot(w);
  p.start(128, 128, yaw);
  for (const [i, j] of [[3, 1], [1, 3], [3, 3]] as const) p.put("core:foundation_wood", at(i, j), 0, 0);
  const walls: number[] = [];
  for (const i of [1, 3]) walls.push(p.put("core:wall_wood", at(i, 0), 0, 0), p.put("core:wall_wood", at(i, 4), 0, 6), p.put("core:wall_wood", at(0, i), 0, 9), p.put("core:wall_wood", at(4, i), 0, 3));
  return { w, p, walls };
}

/** The corners' rises of the roof the builder would be shown in a square's slot, south-west first and round by the east, with the form's name. */
function shown(p: Plot, i: number, j: number, lvl: number, kinds = ROOFS("wood")): [string, number[]] | null {
  const cell = keyOf(p.w, p.fr, "core:roof_wood", at(i, j), lvl, 0);
  if (!propose(p.w.structs, kinds, p.fr, cell.k0, cellOf(cell.k1), 0, fit)) return null;
  const rise = riseAt(p.w.reg.forms, kinds[fit.variant]!, cell.k0, (cellOf(cell.k1) | (fit.rot << 26)) >>> 0);
  return [reg.ids[kinds[fit.variant]!]!.slice(5, -5), [0, 1, 2, 3].map((c) => (rise >> (3 * c)) & 7)];
}

/** Sets down the roof the builder is shown in a square's slot, as the server would. */
function roofed(p: Plot, i: number, j: number, lvl: number): number {
  const kinds = ROOFS("wood");
  const cell = keyOf(p.w, p.fr, "core:roof_wood", at(i, j), lvl, 0);
  if (!propose(p.w.structs, kinds, p.fr, cell.k0, cellOf(cell.k1), 0, fit)) throw new Error("nothing is proposed");
  const key: LatticeKey = { fr: p.fr, k0: cell.k0, k1: (cellOf(cell.k1) | (fit.rot << 26)) >>> 0 };
  return p.putKey(reg.ids[kinds[fit.variant]!]!, key);
}

for (const yaw of [0, 5003]) {
  test(`at yaw ${yaw}: a gable roof is proposed piece by piece, stands on its walls, shuts with its gables in either order, and holds no second storey`, () => {
    const { w, p, walls } = house(yaw);
    // Over a wall with nothing beside it a slope is low along the wall. A wall top offers it, inside and out.
    expect(p.offers("core:roof_wood", at(1, 1), 4, 0, at(1, 0), 4)).toBe(true);
    expect(shown(p, 3, 1, 4)![0]).toBe("roof");
    const first = shown(p, 1, 1, 4)!;
    expect([first[0], first[1].filter((r) => r === 0).length]).toEqual(["roof", 2]);
    // The south-west one is set to rise north, as its neighbour will then be shown.
    const sw = p.put("core:roof_wood", at(1, 1), 4, 0);
    expect(shown(p, 3, 1, 4)).toEqual(["roof", [0, 0, 2, 2]]);
    const se = roofed(p, 3, 1, 4);
    // Across the ridge a slope is shown that comes down from it: its low side over the north wall.
    expect(shown(p, 1, 3, 4)).toEqual(["roof", [2, 2, 0, 0]]);
    const refs = [sw, se, roofed(p, 1, 3, 4), roofed(p, 3, 3, 4)];
    for (const ref of refs) expect(cornerFault(w, ref)).toBe("");
    // Each lies on the wall under its low side, and leans on its neighbours.
    expect(refs.map((ref) => p.stability(ref))).toEqual([3, 3, 3, 3]);
    // The two gable ends: a sloped wall on each wall under a sloped side, its hand said by the roof over it whichever face is turned out.
    const gables: number[] = [];
    for (const [i, j, own] of [[0, 1, 9], [0, 3, 9], [4, 1, 3], [4, 3, 3]] as const) {
      const cell = keyOf(w, p.fr, "core:sloped_wall_left_wood", at(i, j), 4, own);
      const hands = [0, 1].map((rot) => (propose(w.structs, GABLES("wood"), p.fr, cell.k0, cellOf(cell.k1), rot, fit) && fit.held ? fit.variant : -1));
      expect(hands.sort()).toEqual([0, 1]);
      propose(w.structs, GABLES("wood"), p.fr, cell.k0, cellOf(cell.k1), 0, fit);
      gables.push(p.putKey(reg.ids[GABLES("wood")[fit.variant]!]!, { fr: p.fr, k0: cell.k0, k1: cellOf(cell.k1) }));
    }
    for (const ref of gables) expect([cornerFault(w, ref), p.stability(ref)]).toEqual(["", 4]);
    // One room under the roof, shut to a body: four cells, each as high as its roof.
    const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
    const inside = (): number => (enclose(w.structs, p.fr, rooms), rooms.flood(), rooms.found.inside);
    expect(inside()).toBe(4);
    const [x, z] = p.metres(at(2, 2));
    for (const y of [1.5, 3.4, 4.2]) expect(leaks(w, x, p.height(0) + y, z, 9, 1440)).toBe(0);
    // A gable gone, the attic is open; set down again with the roof already over it, it is not in the roof's way nor the roof in its.
    const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
    w.structs.keyAt(gables[0]!, key);
    const kind = w.structs.chunks[Math.floor(gables[0]! / 65536)]!.kind[gables[0]! & 0xffff]!;
    w.structs.remove(gables[0]!);
    expect(inside()).toBe(0);
    expect(leaks(w, x, p.height(0) + 3.4, z, 9, 1440)).toBeGreaterThan(0);
    p.putKey(reg.ids[kind]!, key);
    expect(inside()).toBe(4);
    // Nothing is built up from a roof: no wall on its side, no post on it, no floor in the height it rises through.
    expect([p.offers("core:pillar_wood", at(1, 1), 4, 0), p.judge("core:ceiling_wood", at(1, 1), 5, 0), p.judge("core:ceiling_wood", at(1, 1), 6, 0)]).toEqual([false, RESULT_NO_SNAP, RESULT_OBSTRUCTED]);
    expect(p.judge("core:wall_wood", at(2, 1), 4, 3)).toBe(RESULT_NO_SNAP);
    // A wall may still go up from the wall under the eave, and it stands on that wall, not the roof.
    const up = p.put("core:wall_wood", at(1, 0), 4, 0);
    expect(p.stability(up)).toBe(4);
    // With the wall under its eave gone a roof hangs on its neighbours alone; with both of a slope's gone, down they come.
    w.structs.remove(up);
    w.structs.remove(walls[0]!);
    p.site.support.forget();
    expect(p.stability(sw)).toBe(1);
    w.structs.remove(walls[4]!);
    p.site.support.forget();
    expect([p.stability(sw), p.stability(se)]).toEqual([1, 1]);
    // With the walls under the other two eaves gone as well nothing holds any of the four: a gable holds no roof.
    w.structs.remove(walls[1]!);
    w.structs.remove(walls[5]!);
    p.site.support.forget();
    expect(refs.map((ref) => p.stability(ref))).toEqual([-1, -1, -1, -1]);
  });
}

test("a hip is shown at the corner two slopes meet from outside, a valley where they meet from inside, and a slope carries a slope on", () => {
  const w = flatWorld(4);
  const p = new Plot(w);
  p.start(128, 128, 0);
  const set = (name: string, i: number, j: number, lvl: number, own: number): number => p.w.structs.place(w.kind(name), p.fr, keyOf(w, p.fr, name, at(i, j), lvl, own).k0, keyOf(w, p.fr, name, at(i, j), lvl, own).k1, 7, 1);
  // A slope along a south eave rising north, and one along an east eave rising west: the square between them at the
  // outside corner is low where both are low and high where they meet.
  set("core:roof_wood", 11, 11, 4, 0);
  set("core:roof_wood", 13, 13, 4, 3);
  expect(shown(p, 13, 11, 4)).toEqual(["roof_hip", [0, 0, 0, 2]]);
  // The same two set round an inside corner: the square between them is low only where both come down to.
  set("core:roof_wood", 25, 23, 4, 0);
  set("core:roof_wood", 23, 21, 4, 3);
  expect(shown(p, 23, 23, 4)).toEqual(["roof_valley", [2, 0, 2, 2]]);
  // Beside one slope alone a slope is shown, turned as it is; and a rise up from its high side, the next slope up.
  expect(shown(p, 9, 11, 4)).toEqual(["roof", [0, 0, 2, 2]]);
  expect(shown(p, 25, 25, 6)).toEqual(["roof", [0, 0, 2, 2]]);
  // A floor level with its high side is offered there too: the roof rises to it.
  expect(p.offers("core:ceiling_wood", at(25, 25), 6, 0, at(25, 25), 6)).toBe(true);
  // Triangle roofs: one corner up or one corner down, turned so the corners it shares agree.
  const tri = [...reg.places[id("piece_triangle_roof_wood")]!];
  expect(tri.map((k) => reg.forms.rise[k])).toEqual([0o020, 0o202]);
});

/** A body of the survivor's at rest on what is under (x, z), coming down from `from`. */
function standing(w: TestWorld, x: number, z: number, from: number): Body {
  const move = reg.move[id("survivor")]!;
  const b = new Body();
  [b.x, b.z, b.y] = [x, z, from];
  while (capsuleFree(w, x, b.y - 0.01, z, move.radius, move.height) && b.y > 0) b.y -= 0.01;
  b.grounded = true;
  return b;
}

test("a survivor walks up a roof to its ridge and up a ramp to the floor it reaches, on its feet all the way", () => {
  const move = reg.move[id("survivor")]!;
  for (const yaw of [0, 5003]) {
    const { w, p } = house(yaw);
    for (const [i, j, own] of [[1, 1, 0], [3, 1, 0], [1, 3, 6], [3, 3, 6]] as const) p.put("core:roof_wood", at(i, j), 4, own);
    // From just inside the south eave toward the ridge: the base's +Z, which is the body's forward at the base's yaw.
    const [x, z] = p.metres(at(1, 0));
    const [rx, rz] = p.metres(at(1, 2));
    const far = Math.hypot(rx - x, rz - z);
    const [ux, uz] = [(rx - x) / far, (rz - z) / far];
    const b = standing(w, x + ux * 0.4, z + uz * 0.4, p.height(4) + 3);
    const foot = b.y;
    expect(foot).toBeGreaterThan(p.height(4));
    expect(foot).toBeLessThan(p.height(4) + 0.6);
    const heading = Math.round((Math.atan2(ux, uz) / (2 * Math.PI)) * 65536) & 0xffff;
    let air = 0;
    for (let t = 0; t < 400 && Math.hypot(b.x - x, b.z - z) < far - 0.3; t++) {
      stepBody(w, b, 0, 127, heading, 0, 0, move, TICK_DT);
      if (!b.grounded) air++;
    }
    expect(Math.hypot(b.x - x, b.z - z)).toBeGreaterThanOrEqual(far - 0.3);
    expect(b.y - foot).toBeGreaterThan(1.1);
    expect(air).toBeLessThan(4);

    // A ramp on the south-west floor of a house with no roof, rising north.
    const bare = house(yaw).p;
    const ramp = bare.put("core:ramp_wood", at(1, 1), 0, 0);
    expect(cornerFault(bare.w, ramp)).toBe("");
    const [fx, fz] = bare.metres(at(1, 0));
    const c = standing(bare.w, fx + ux * 0.25, fz + uz * 0.25, bare.height(0) + 1);
    let off = 0;
    for (let t = 0; t < 400 && Math.hypot(c.x - fx, c.z - fz) < 2.7; t++) {
      stepBody(bare.w, c, 0, 127, heading, 0, 0, move, TICK_DT);
      if (!c.grounded) off++;
    }
    expect(c.y - bare.height(0)).toBeGreaterThan(2.5);
    expect(off).toBeLessThan(4);
    // Nothing is floored over a ramp, as over stairs, and no ramp goes under a roof.
    expect([bare.judge("core:ceiling_wood", at(1, 1), 4, 0), p.judge("core:ramp_wood", at(1, 1), 0, 0)]).toEqual([RESULT_OBSTRUCTED, RESULT_OBSTRUCTED]);
  }
});
