// What a collapse's search is charged: pieces in the box the kinds found there need, and far less for the rest of the box.

import { expect, test } from "bun:test";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { Found } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { flatWorld } from "../fixtures/world.ts";

test("a search is charged an eighth for pieces only the widest piece's box takes in", () => {
  const found = new Found(64);
  const charged: number[] = [];
  // Sixteen blocks stacked `d` metres east of the lost piece's place, which is a block's too.
  for (let d = 0; d <= 60; d++) {
    const w = flatWorld(4);
    const block = w.kind("core:block");
    const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
    for (let k = 0; k < 16; k++) w.structs.add(block, 100 + d, 0.5 + k, 100, 0, 0, 100);
    const before = support.work;
    support.dependents(100 * STRUCT_UNITS, 100 * STRUCT_UNITS, -1, found, block);
    charged.push(support.work - before);
  }
  const [near, ring, none] = [charged[0]!, charged[0]! - 6, charged[0]! - 8];
  const firstRing = charged.indexOf(ring);
  const firstNone = charged.indexOf(none);
  // Whole inside the box a block needs, then at an eighth as far as the widest piece's, then not found.
  expect(firstRing).toBeGreaterThan(3);
  expect(firstNone).toBeGreaterThan(firstRing);
  expect(charged.slice(0, firstRing).every((c) => c === near)).toBe(true);
  expect(charged.slice(firstRing, firstNone).every((c) => c === ring)).toBe(true);
  expect(charged.slice(firstNone).every((c) => c === none)).toBe(true);
});
