// Fence foundations, the hatch frame with its trapdoor, and ladders: where each is offered, what holds it, what it
// shuts, and a body on and through a hatch.

import { expect, test } from "bun:test";
import type { EngramDef, StructureDef } from "../../shared/content/defs.ts";
import { RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { keyLvl } from "../../shared/world/lattice/module.ts";
import { makeCandidates } from "../../shared/world/lattice/place.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { Plot, at, cornerFault, keyOf, siteOf, step } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

test("fence foundations, hatch frames, trapdoors and ladders are kinds: each an item of its own, a trapdoor with the form it has open, no ladder of stone", () => {
  for (const tier of ["wood", "stone", "metal"]) {
    for (const item of ["fence_foundation", "trapdoor_frame", "trapdoor"]) expect([...reg.places[id(`piece_${item}_${tier}`)]!]).toEqual([id(`${item}_${tier}`)]);
    // Using a trapdoor swaps it for its open form and back, and it starts locked to other tribes, as a door.
    expect([reg.opens[id(`trapdoor_${tier}`)], reg.opens[id(`trapdoor_open_${tier}`)], reg.lockedAtFirst[id(`trapdoor_${tier}`)], reg.pieceItem[id(`trapdoor_open_${tier}`)]]).toEqual([id(`trapdoor_open_${tier}`), id(`trapdoor_${tier}`), 1, id(`piece_trapdoor_${tier}`)]);
  }
  expect([reg.index.get("core:ladder_stone"), reg.index.get("core:fence_foundation_thatch"), reg.index.get("core:ladder_wood") !== undefined, reg.index.get("core:ladder_metal") !== undefined]).toEqual([undefined, undefined, true, true]);
  const engram = (name: string): [number, number] => [(reg.defs[id(`engram-piece_${name}`)] as EngramDef).level, (reg.defs[id(`engram-piece_${name}`)] as EngramDef).cost];
  expect([engram("fence_foundation_wood"), engram("trapdoor_frame_wood"), engram("trapdoor_wood"), engram("ladder_wood"), engram("ladder_metal")]).toEqual([[11, 6], [13, 9], [13, 6], [13, 6], [48, 21]]);
  expect(["fence_foundation_wood", "trapdoor_frame_stone", "trapdoor_metal", "ladder_wood"].map((name) => (reg.defs[id(name)] as StructureDef).hp)).toEqual([10000, 10000, 6250, 3125]);
  // A fence foundation stands by itself only with its foot in the ground, and goes by a foundation's rules for the ground and other tribes.
  expect([reg.forms.def[id("fence_foundation_wood")]!.root, reg.role[id("fence_foundation_wood")]]).toEqual(["grounded", 0]);
});

for (const yaw of [0, 5003]) {
  test(`at yaw ${yaw}: a fence runs on from a foundation's corner and from its own ends at any of twelve turns, and carries walls and rails`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(128, 128, yaw);
    const fence = "core:fence_foundation_wood";
    // From the foundation's north-east corner: on along its north side's line, and out east from it.
    expect([p.offers(fence, at(3, 2), 0, 0, at(2, 2), 0), p.offers(fence, at(2, 3), 0, 3, at(2, 2), 0)]).toEqual([true, true]);
    // Never across the foundation itself.
    expect(p.judge(fence, step(at(2, 2), 7, 1), 0, 7)).not.toBe(RESULT_OK);
    const first = p.put(fence, at(3, 2), 0, 0);
    expect([cornerFault(w, first), p.stability(first)]).toEqual(["", 4]);
    // From its far end: straight on, a quarter turn, and 30 and 60 degrees round.
    const end = at(4, 2);
    for (const d of [0, 3, 9, 1, 2, 11]) expect([d, p.offers(fence, step(end, d, 1), 0, d, end, 0)]).toEqual([d, true]);
    const turned = p.put(fence, step(end, 1, 1), 0, 1);
    const on = p.put(fence, step(step(end, 1, 2), 1, 1), 0, 1);
    for (const ref of [turned, on]) expect([cornerFault(w, ref), p.stability(ref)]).toEqual(["", 4]);
    // A wall, a half wall and a railing stand on a footing as on a foundation; a gate's frame needs two in a row.
    const rail = p.put("core:railing_wood", at(3, 2), 0, 0);
    const half = p.put("core:half_wall_wood", step(end, 1, 1), 0, 1);
    const wall = p.put("core:wall_wood", step(step(end, 1, 2), 1, 1), 0, 1);
    expect([rail, half, wall].map((ref) => p.stability(ref))).toEqual([4, 4, 4]);
    // The footing gone, what stood on it has nothing under it.
    w.structs.remove(on);
    p.site.support.forget();
    expect(p.stability(wall)).toBe(-1);
    // A fence shuts nothing in: there is no floor and so no room.
    const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
    enclose(w.structs, p.fr, rooms);
    rooms.flood();
    expect(rooms.found.inside).toBe(0);
  });
}

test("down a slope a fence's footing is offered a level lower where its foot would be in the air, the highest that stands first", () => {
  const w = flatWorld(4);
  // Level at 0 to x = 134, then falling a metre in three.
  const ground = (x: number): number => (x > 134 ? -(x - 134) / 3 : 0);
  const p = new Plot(w, 7, siteOf(w, ground));
  p.start(128, 128, 0);
  const fence = "core:fence_foundation_wood";
  p.put(fence, at(3, 0), 0, 0);
  p.put(fence, at(5, 0), 0, 0);
  // The third, from 6 to 9 m out, is over ground a metre down at its middle: level with the others its foot is in the air.
  expect(p.judge(fence, at(7, 0), 0, 0)).toBe(RESULT_NO_SUPPORT);
  expect(p.judge(fence, at(7, 0), -1, 0)).toBe(RESULT_OK);
  const out = makeCandidates();
  p.look(fence, at(7, 0), 0, out);
  const key = keyOf(w, p.fr, fence, at(7, 0), 0, 0);
  const levels: number[] = [];
  for (let i = 0; i < out.n; i++) if (out.k0[i] === key.k0 && (out.k1[i]! & ~(511 << 10)) === (key.k1 & ~(511 << 10))) levels.push(keyLvl(out.k1[i]!));
  expect(levels[0]).toBe(-1);
  expect(levels.includes(0)).toBe(false);
});

/** A one-square room in a plot: a foundation, a wall on each side, and a hatch's frame for its ceiling. */
function cellar(yaw: number): { w: TestWorld; p: Plot; walls: number[]; frame: number } {
  const w = flatWorld(4);
  const p = new Plot(w);
  p.start(128, 128, yaw);
  const walls = [p.put("core:wall_wood", at(1, 0), 0, 0), p.put("core:wall_wood", at(2, 1), 0, 3), p.put("core:wall_wood", at(1, 2), 0, 6), p.put("core:wall_wood", at(0, 1), 0, 9)];
  const frame = p.put("core:trapdoor_frame_wood", at(1, 1), 4, 0);
  return { w, p, walls, frame };
}

/** A survivor's body let down from `from` over (x, z) and left a second and a half: the height it comes to rest at. */
function dropped(w: TestWorld, x: number, z: number, from: number): number {
  const move = reg.move[id("survivor")]!;
  const b = new Body();
  [b.x, b.z, b.y] = [x, z, from];
  for (let t = 0; t < 90; t++) stepBody(w, b, 0, 0, 0, 0, 0, move, TICK_DT);
  if (!capsuleFree(w, b.x, b.y, b.z, move.radius, move.height)) throw new Error("the body is in a piece");
  return b.y;
}

for (const yaw of [0, 5003]) {
  test(`at yaw ${yaw}: a trapdoor goes only in a hatch's frame, shuts the room and carries a body; open, the body drops through`, () => {
    const { w, p, frame } = cellar(yaw);
    expect([cornerFault(w, frame), p.stability(frame)]).toEqual(["", 3]);
    // The frame offers its own cell to a trapdoor, and a plain ceiling beside it offers none.
    p.put("core:foundation_wood", at(3, 1), 0, 0);
    p.put("core:ceiling_wood", at(3, 1), 4, 0);
    expect([p.offers("core:trapdoor_wood", at(1, 1), 4, 0), p.judge("core:trapdoor_wood", at(3, 1), 4, 0)]).toEqual([true, RESULT_NO_SNAP]);
    const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
    const inside = (): number => (enclose(w.structs, p.fr, rooms), rooms.flood(), rooms.found.inside);
    // The hole alone leaves the room open.
    expect(inside()).toBe(0);
    const [x, z] = p.metres(at(1, 1));
    expect(dropped(w, x, z, p.height(4) + 0.5)).toBeLessThan(p.height(0) + 0.1);
    const leaf = p.put("core:trapdoor_wood", at(1, 1), 4, 0);
    expect([p.stability(leaf), inside()]).toEqual([3, 1]);
    expect(Math.abs(dropped(w, x, z, p.height(4) + 0.5) - p.height(4))).toBeLessThan(0.05);
    // A second leaf has no place in the frame.
    expect(p.judge("core:trapdoor_wood", at(1, 1), 4, 3)).toBe(RESULT_OBSTRUCTED);
    // Stood open it hangs under the frame at one side of the hole: the room is open and a body goes down through it.
    w.structs.swap(leaf, id("trapdoor_open_wood"));
    expect([inside(), p.stability(leaf)]).toEqual([0, 3]);
    expect(dropped(w, x, z, p.height(4) + 0.5)).toBeLessThan(p.height(0) + 0.1);
    // The frame gone, the leaf goes with it.
    w.structs.remove(frame);
    p.site.support.forget();
    expect(p.stability(leaf)).toBe(-1);
  });

  test(`at yaw ${yaw}: a ladder hangs on a whole wall's face at each storey, and under a hatch's side with no wall`, () => {
    const { w, p, walls, frame } = cellar(yaw);
    const ladder = "core:ladder_wood";
    // On the south wall, inside or out; not on a doorframe or a half wall.
    expect(p.offers(ladder, at(1, 0), 0, 0, at(1, 0), 1)).toBe(true);
    const inner = p.put(ladder, at(1, 0), 0, 0);
    expect(p.stability(inner)).toBe(4);
    expect(p.judge(ladder, at(1, 0), 0, 6)).toBe(RESULT_OBSTRUCTED);
    p.put("core:foundation_wood", at(3, 1), 0, 0);
    p.put("core:doorframe_wood", at(3, 0), 0, 0);
    p.put("core:half_wall_wood", at(3, 2), 0, 6);
    expect([p.judge(ladder, at(3, 0), 0, 0), p.judge(ladder, at(3, 2), 0, 6)]).toEqual([RESULT_NO_SNAP, RESULT_NO_SNAP]);
    // It stands clear of the wall's face: a body's width from the wall the ladder is met before the wall is.
    const k = id("ladder_wood");
    expect([reg.parts.box[reg.parts.start[k]! * 6 + 2]! - reg.parts.box[reg.parts.start[k]! * 6 + 5]!, reg.halfZ[id("wall_wood")]!].map((v) => Math.round(v * 1000))).toEqual([130, 100]);
    // A second storey of wall takes a second ladder over the first.
    p.put("core:wall_wood", at(1, 0), 4, 0);
    expect(p.stability(p.put(ladder, at(1, 0), 4, 0))).toBe(4);
    // Under the frame's east side with the wall there gone: the frame offers the edge under it, a storey down, and holds the ladder.
    w.structs.remove(walls[1]!);
    p.site.support.forget();
    expect(p.offers(ladder, at(2, 1), 0, 3, at(2, 1), 2)).toBe(true);
    const hung = p.put(ladder, at(2, 1), 0, 3);
    expect(p.stability(hung)).toBe(p.stability(frame));
    w.structs.remove(frame);
    p.site.support.forget();
    expect([p.stability(hung), p.stability(inner)]).toEqual([-1, 4]);
  });
}
