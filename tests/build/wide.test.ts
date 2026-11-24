// Pieces over two edges or several storeys: the double doorway and its door, the large wall, the gateway and its gate.

import { expect, test } from "bun:test";
import type { EngramDef, StructureDef } from "../../shared/content/defs.ts";
import { RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { Plot, at, cornerFault, keyOf } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const survivor = reg.move[id("survivor")]!;

test("the wide pieces are kinds in wood, stone and metal, each an item, each leaf with the form it has open", () => {
  for (const tier of ["wood", "stone", "metal"]) {
    for (const item of ["double_doorway", "double_door", "large_wall", "gateway", "gate"]) expect([...reg.places[id(`piece_${item}_${tier}`)]!]).toEqual([id(`${item}_${tier}`)]);
    for (const leaf of ["double_door", "gate"]) expect([reg.opens[id(`${leaf}_${tier}`)], reg.opens[id(`${leaf}_open_${tier}`)], reg.lockedAtFirst[id(`${leaf}_${tier}`)]]).toEqual([id(`${leaf}_open_${tier}`), id(`${leaf}_${tier}`), 1]);
  }
  expect(reg.index.get("core:gateway_thatch")).toBeUndefined();
  const engram = (name: string): [number, number] => [(reg.defs[id(`engram-piece_${name}`)] as EngramDef).level, (reg.defs[id(`engram-piece_${name}`)] as EngramDef).cost];
  expect([engram("large_wall_wood"), engram("gateway_wood"), engram("gate_wood"), engram("double_door_wood"), engram("gateway_metal"), engram("double_doorway_stone")]).toEqual([[15, 9], [18, 7], [18, 5], [18, 4], [52, 12], [31, 6]]);
  expect(["large_wall_wood", "gateway_stone", "gate_metal", "double_door_wood", "double_doorway_wood"].map((name) => (reg.defs[id(name)] as StructureDef).hp)).toEqual([18000, 10000, 6250, 8000, 10000]);
  // Each covers every cell it stands in: two edges, four storeys, or two of each. An open pair of leaves is two boxes.
  expect([reg.forms.wide[id("double_doorway_wood")], reg.forms.span[id("large_wall_wood")], reg.forms.def[id("gateway_wood")]!.cells!.length, reg.forms.def[id("gate_wood")]!.cells!.length]).toEqual([2, 16, 4, 4]);
  const boxes = (name: string): number => reg.parts.start[id(name) + 1]! - reg.parts.start[id(name)]!;
  expect([boxes("double_door_wood"), boxes("double_door_open_wood"), boxes("gate_open_wood"), boxes("gateway_wood")]).toEqual([1, 2, 2, 3]);
});

/** Whether a survivor's body has room at the lattice point `p`, on level `lvl`. */
function room(w: TestWorld, plot: Plot, p: number[], lvl = 0): boolean {
  const [x, z] = plot.metres(p);
  return capsuleFree(w, x, plot.height(lvl) + 0.02, z, survivor.radius, survivor.height);
}

for (const yaw of [0, 5003]) {
  test(`at yaw ${yaw}: a double doorway is offered from either of its two edges, takes both, and shuts with its double door`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(128, 128, yaw);
    p.put("core:foundation_wood", at(3, 1), 0, 0);
    const dd = "core:double_doorway_wood";
    // Over the two south edges: looked at from either, the one slot is offered.
    expect([p.offers(dd, at(1, 0), 0, 0, at(1, 0), 0), p.offers(dd, at(1, 0), 0, 0, at(3, 0), 0)]).toEqual([true, true]);
    // A wall on its second edge, and it has no room; the wall gone, it goes down and both edges are taken.
    const wall = p.put("core:wall_wood", at(3, 0), 0, 0);
    expect(p.judge(dd, at(1, 0), 0, 0)).toBe(RESULT_OBSTRUCTED);
    w.structs.remove(wall);
    const frame = p.put(dd, at(1, 0), 0, 0);
    expect([cornerFault(w, frame), p.stability(frame)]).toEqual(["", 4]);
    expect([p.judge("core:wall_wood", at(1, 0), 0, 0), p.judge("core:wall_wood", at(3, 0), 0, 0)]).toEqual([RESULT_OBSTRUCTED, RESULT_OBSTRUCTED]);
    // Walls round the rest and a floor over both: the room is open at the doorway until its door stands in it.
    for (const [m, own] of [[at(4, 1), 3], [at(3, 2), 6], [at(1, 2), 6], [at(0, 1), 9]] as const) p.put("core:wall_wood", m, 0, own);
    for (const i of [1, 3]) p.put("core:ceiling_wood", at(i, 1), 4, 0);
    const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
    const inside = (): number => (enclose(w.structs, p.fr, rooms), rooms.flood(), rooms.found.inside);
    expect([inside(), room(w, p, at(2, 0))]).toEqual([0, true]);
    // A single door is not its leaf, and the double door goes nowhere else.
    expect([p.judge("core:door_wood", at(1, 0), 0, 0), p.judge("core:double_door_wood", at(4, 1), 0, 3)]).toEqual([RESULT_NO_SNAP, RESULT_NO_SNAP]);
    const door = p.put("core:double_door_wood", at(1, 0), 0, 0);
    expect([p.stability(door), inside(), room(w, p, at(2, 0))]).toEqual([4, 2, false]);
    // Open, its two leaves stand at the jambs and the way through is clear.
    w.structs.swap(door, id("double_door_open_wood"));
    expect([p.stability(door), inside(), room(w, p, at(2, 0))]).toEqual([4, 0, true]);
    // The doorway gone, its door has nothing to hang in.
    w.structs.remove(frame);
    p.site.support.forget();
    expect(p.stability(door)).toBe(-1);
  });

  test(`at yaw ${yaw}: a large wall stands four storeys in one edge, takes a ladder at each and a floor at its top`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(128, 128, yaw);
    const tall = p.put("core:large_wall_wood", at(1, 0), 0, 0);
    expect([cornerFault(w, tall), p.stability(tall)]).toEqual(["", 4]);
    // Nothing else stands in its edge at any storey, and a wall goes on its top.
    expect([p.judge("core:wall_wood", at(1, 0), 0, 0), p.judge("core:half_wall_wood", at(1, 0), 0, 0)]).toEqual([RESULT_OBSTRUCTED, RESULT_OBSTRUCTED]);
    expect(p.judge("core:wall_wood", at(1, 0), 16, 0)).toBe(RESULT_OK);
    for (const lvl of [0, 4, 8, 12]) expect(p.stability(p.put("core:ladder_wood", at(1, 0), lvl, 0))).toBe(4);
    const top = p.put("core:ceiling_wood", at(1, 1), 16, 0);
    expect(p.stability(top)).toBe(3);
    // And it holds a floor at each storey it passes, as a wall of that height would.
    expect(p.stability(p.w.structs.place(w.kind("core:ceiling_wood"), p.fr, keyOf(w, p.fr, "core:ceiling_wood", at(1, 1), 8, 0).k0, keyOf(w, p.fr, "core:ceiling_wood", at(1, 1), 8, 0).k1, 7, 1))).toBe(3);
  });

  test(`at yaw ${yaw}: a gateway stands two edges wide and two storeys high on a fence, and its gate shuts it and opens`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    p.start(128, 128, yaw, "core:fence_foundation_wood");
    p.put("core:fence_foundation_wood", at(3, 0), 0, 0);
    // From either footing. It is named by its first edge's middle whichever way its front is turned: here south, away from the base's +Z.
    expect([p.offers("core:gateway_wood", at(1, 0), 0, 6, at(1, 0), 0), p.offers("core:gateway_wood", at(1, 0), 0, 6, at(3, 0), 0)]).toEqual([true, true]);
    const gateway = p.put("core:gateway_wood", at(1, 0), 0, 6);
    expect([cornerFault(w, gateway), p.stability(gateway)]).toEqual(["", 4]);
    // The way through is as wide as the two edges less its posts, and open.
    expect([room(w, p, at(1, 0)), room(w, p, at(3, 0)), room(w, p, at(2, 0))]).toEqual([true, true, true]);
    expect(p.judge("core:door_wood", at(1, 0), 0, 6)).toBe(RESULT_NO_SNAP);
    const gate = p.put("core:gate_wood", at(1, 0), 0, 6);
    expect([p.stability(gate), room(w, p, at(1, 0)), room(w, p, at(3, 0)), room(w, p, at(2, 0))]).toEqual([4, false, false, false]);
    // Open, its leaves stand out from the posts toward its front, and the way is clear.
    w.structs.swap(gate, id("gate_open_wood"));
    expect([p.stability(gate), room(w, p, at(1, 0)), room(w, p, at(3, 0)), room(w, p, at(2, 0))]).toEqual([4, true, true, true]);
    // A footing under it gone, it stands on the other; both gone, it and its gate have nothing under them.
    const footings: number[] = [];
    w.structs.chunks.forEach((t, chunk) => {
      for (let s = 0; t && s < t.high; s++) if (t.kind[s] === id("fence_foundation_wood")) footings.push(chunk * 65536 + s);
    });
    w.structs.remove(footings[0]!);
    p.site.support.forget();
    expect(p.stability(gateway)).toBe(4);
    w.structs.remove(footings[1]!);
    p.site.support.forget();
    expect([p.stability(gateway), p.stability(gate)]).toEqual([-1, -1]);
  });
}
