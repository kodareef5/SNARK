import { expect, test } from "bun:test";
import { tekWallKinds, tekWallNeighbours } from "../../shared/world/lattice/tek-walls.ts";
import { pieceShapes } from "../../shared/world/tactical.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld } from "../../shared/world/ray.ts";
import { flatWorld } from "../fixtures/world.ts";
import { set, start } from "../fixtures/slots.ts";

test("coplanar Tek panels join across chunks and storeys in local edge order", () => {
  const w = flatWorld(8), kinds = tekWallKinds(w.reg.index), out = new Int32Array(4);
  const base = start(w, w.kind("core:foundation_tek"), 63, 0, 64, 0, 17), fr = w.structs.frameAt(base);
  const a = set(w, fr, kinds.door, 1, 0), b = set(w, fr, kinds.door, 3, 0, 0, 6);
  const above = set(w, fr, kinds.open, 1, 0, 4, 6);
  const other = set(w, fr, kinds.solid, -1, 0);
  const perpendicular = set(w, fr, kinds.door, 0, 1, 0, 3);
  expect([base, a, b, above, other, perpendicular].every(ref => ref >= 0)).toBe(true);
  expect(a >>> 16).not.toBe(b >>> 16);
  expect(tekWallNeighbours(w.structs, kinds, a, out)).toBe(11);
  expect([...out]).toEqual([other, b, -1, above]);
  expect(tekWallNeighbours(w.structs, kinds, a, out, true)).toBe(10);
  expect([...out]).toEqual([-1, b, -1, above]);
  expect(tekWallNeighbours(w.structs, kinds, b, out)).toBe(2);
  expect(out[1]).toBe(a);
  expect(tekWallNeighbours(w.structs, kinds, above, out)).toBe(4);
  w.structs.chunks[b >>> 16]!.owner[b & 65535] = 23;
  expect(tekWallNeighbours(w.structs, kinds, a, out, true)).toBe(8);
  w.structs.remove(above);
  expect(tekWallNeighbours(w.structs, kinds, a, out, true)).toBe(0);
});

test("both wall modes return the Tek wall kit and only the closed field stops rays", () => {
  const w = flatWorld(4), kinds = tekWallKinds(w.reg.index), far = pieceShapes(w.reg);
  const item = w.reg.pieceItem[kinds.solid]!;
  expect(item).toBe(w.kind("core:piece_wall_tek"));
  const ref = w.structs.add(kinds.solid, 40, 2, 40, 0, 5, 24);
  for (const k of [kinds.solid, kinds.door, kinds.open]) {
    w.structs.swap(ref, k);
    expect(w.reg.pieceItem[k]).toBe(item);
    expect(w.reg.forms.def[k]?.carries).toBe(true);
    expect(w.reg.forms.def[k]?.closes).toBe(k === kinds.open ? "none" : "full");
    expect(w.reg.maxHp[k]).toBe(w.reg.maxHp[kinds.solid]);
    expect(far.far[k]).toBe(k === kinds.open ? 0 : 1);
    expect(castWorld(w, 40, 2, 38, 0, 0, 1, 4)).toBe(k === kinds.open ? HIT_NONE : HIT_STRUCTURE);
  }
});
