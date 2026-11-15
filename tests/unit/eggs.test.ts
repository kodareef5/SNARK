// A one of a kind in a slot: the record it stands for moves with it and goes with it, and never with anything else.

import { expect, test } from "bun:test";
import { Inventory, moveSlot } from "../../shared/sim/items.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const fertile = reg.index.get("core:dodo_egg_fertile")!;
const egg = reg.index.get("core:dodo_egg")!;
const SPOIL = reg.spoilTicks[fertile]!;

test("a slot's ref moves with it, swaps with it and is cleared with it; one inventory never pays for refs it has none of", () => {
  const a = new Inventory(4);
  const b = new Inventory(4);
  expect([a.ref, a.refOf(2)]).toEqual([null, 0]);
  a.set(0, fertile, 1, 0, 0, 500);
  a.setRef(0, 2 ** 45 + 7);
  a.add(egg, 30, 0, 0, 0, reg);
  // Moved whole, the ref goes with it and leaves nothing behind.
  expect(moveSlot(a, 0, b, 3, 0, reg)).toBe(1);
  expect([a.refOf(0), b.refOf(3), b.item[3], b.spoilAt[3]]).toEqual([0, 2 ** 45 + 7, fertile, 500]);
  // Swapped with a stack of plain eggs, each side keeps what it is.
  b.set(1, fertile, 1, 0, 0, 900);
  b.setRef(1, 99);
  expect(moveSlot(b, 1, a, 1, 0, reg)).toBe(1);
  expect([a.item[1], a.refOf(1), b.item[1], b.count[1], b.refOf(1)]).toEqual([fertile, 99, egg, 30, 0]);
  // Another added never joins it, and stands for nothing; an emptied slot stands for nothing.
  expect(a.add(fertile, 1, 0, 0, 0, reg)).toBe(0);
  expect([a.item[0], a.refOf(0), a.refOf(1)]).toEqual([fertile, 0, 99]);
  a.remove(1, 1);
  expect([a.item[1], a.refOf(1)]).toEqual([0, 0]);
  expect(new Inventory(3).ref).toBeNull();
});

test("spoiling names the record a one of a kind stood for", () => {
  const inv = new Inventory(2);
  inv.set(0, fertile, 1, 0, 0, 100);
  inv.setRef(0, 42);
  inv.set(1, egg, 3, 0, 0, 100);
  const lost: number[][] = [];
  inv.settle(100 + SPOIL, reg, (item, n, ref) => lost.push([item, n, ref]));
  expect(lost).toEqual([
    [fertile, 1, 42],
    [egg, 2, 0],
  ]);
  expect([inv.item[0], inv.refOf(0)]).toEqual([0, 0]);
});
