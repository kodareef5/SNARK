// When a thing that holds loot shines (client/core/shine.ts): as it is come upon, and when the aim rests on it.

import { expect, test } from "bun:test";
import { SHINE_LOOK_MS, SHINE_NEAR, Shine } from "../../client/core/shine.ts";
import { SHIMMER_GAP_MS, SHIMMER_MOST, SHIMMER_MS } from "../../client/core/shimmer.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const kind = (name: string): number => reg.index.get(name)!;

function street(n = 1) {
  const structs = new StructureStore({ chunksX: 4, chunksZ: 4 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const bins = Array.from({ length: n }, (_, k) => structs.add(kind("core:zzstreet_bin"), 100 + k * 2, 0, 100, 0, 0, 500));
  const hydrant = structs.add(kind("core:zzstreet_hydrant"), 100, 0, 104, 0, 0, 500);
  const shine = new Shine();
  const at = (now: number, x: number, aimed = -1, on = true): number[] => {
    shine.update(now, structs, reg, x, 0, 100, () => on, aimed);
    return Array.from(shine.refs.subarray(0, shine.count));
  };
  return { structs, bins, hydrant, shine, at };
}

test("a bin shines once as it is come upon, for its moment, and again only after it has been left", () => {
  const { bins, shine, at } = street();
  expect(at(0, 100 - SHINE_NEAR - 6)).toEqual([]);
  expect(at(1000, 100 - SHINE_NEAR + 1)).toEqual([bins[0]!]);
  expect(shine.phase[0]).toBe(0);
  at(1000 + SHIMMER_MS / 2, 100 - 5);
  expect(shine.phase[0]).toBeCloseTo(0.5, 5);
  expect(at(1000 + SHIMMER_MS, 100 - 5)).toEqual([]);
  // Standing by it, it does not shine again, however long.
  expect(at(1000 + SHIMMER_GAP_MS * 3, 100 - 5)).toEqual([]);
  // Left and come back to, it does.
  at(40000, 100 - SHINE_NEAR - 6);
  expect(at(40000 + SHINE_LOOK_MS, 100 - 5)).toEqual([bins[0]!]);
});

test("the aim sets a bin off again once its gap is out, a searched one never shines, and a hydrant never does", () => {
  const { bins, hydrant, shine, at } = street();
  at(0, 99);
  expect(at(SHIMMER_MS + 100, 99, bins[0]!)).toEqual([]);
  expect(at(SHIMMER_GAP_MS, 99, bins[0]!)).toEqual([bins[0]!]);
  // A thing with nothing to hold is nothing to the look, even aimed at through a mistake of the caller's.
  expect(at(SHIMMER_GAP_MS * 3, 99, -1)).toEqual([]);
  expect(shine.refs.includes(hydrant)).toBe(false);
  shine.spent = (ref) => ref === bins[0];
  expect(at(SHIMMER_GAP_MS * 5, 99, bins[0]!)).toEqual([]);
});

test("four shine at once at the most, the nearest first, and none where the server searches nothing", () => {
  const { bins, at } = street(6);
  const first = at(0, 99);
  expect(first.length).toBe(SHIMMER_MOST);
  expect(first).toEqual(bins.slice(0, 4));
  // The two there was no room for shine at the next look after those are done.
  expect(at(SHIMMER_MS + SHINE_LOOK_MS, 99)).toEqual(bins.slice(4));
  const off = street(3);
  expect(off.at(0, 99, -1, false)).toEqual([]);
});
