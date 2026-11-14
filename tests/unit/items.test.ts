import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { Inventory, moveSlot } from "../../shared/sim/items.ts";
import { V_FOOD, V_HEALTH, Vitals } from "../../shared/sim/vitals.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const stone = reg.index.get("core:stone")!; // stacks to 100, keeps
const berry = reg.index.get("core:berry")!; // stacks to 100, spoils
const skin = reg.index.get("core:waterskin")!; // does not stack
const SPOIL = reg.spoilTicks[berry]!;

const slots = (inv: Inventory): string[] => {
  const out: string[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push(`${s}:${reg.ids[inv.item[s]!]}x${inv.count[s]}`);
  return out;
};

test("adding tops up matching stacks, then fills empty slots, and reports what did not fit", () => {
  const inv = new Inventory(4);
  expect(inv.add(stone, 250, 0, 0, 0, reg)).toBe(0);
  expect(slots(inv)).toEqual(["0:core:stonex100", "1:core:stonex100", "2:core:stonex50"]);
  expect(inv.room(stone, 0, reg)).toBe(150);
  expect(inv.add(skin, 3, 0, 0, 0, reg)).toBe(2); // one free slot, and they do not stack
  expect(inv.add(stone, 80, 0, 0, 0, reg)).toBe(30);
  expect(slots(inv)).toEqual(["0:core:stonex100", "1:core:stonex100", "2:core:stonex100", "3:core:waterskinx1"]);
  expect(inv.total(stone)).toBe(300);
  expect(inv.weight(reg)).toBeCloseTo(300 * 0.5 + 1, 5);
  expect(inv.used()).toBe(4);
  // Taking is all or nothing.
  expect(inv.take(stone, 301)).toBe(false);
  expect(inv.total(stone)).toBe(300);
  expect(inv.take(stone, 150)).toBe(true);
  expect(slots(inv)).toEqual(["0:core:stonex100", "1:core:stonex50", "3:core:waterskinx1"]);
  expect(inv.add(reg.index.get("core:wall")!, 1, 0, 0, 0, reg)).toBe(1); // not an item
});

test("a stack larger than its limit has become leaves the room the empty slots give, not less", () => {
  const inv = new Inventory(2);
  inv.add(stone, 100, 0, 0, 0, reg);
  // The same registry, but a stack of stone is 50.
  const small = { ...reg, stack: reg.stack.map((n) => (n > 1 ? 50 : n)) };
  expect(inv.room(stone, 0, small)).toBe(50);
  expect(inv.room(stone, 0, reg)).toBe(100);
});

test("a move goes to an empty slot, joins a matching stack, swaps whole stacks, or is refused", () => {
  const a = new Inventory(6);
  const b = new Inventory(6);
  a.add(stone, 160, 0, 0, 0, reg); // slots 0 (100) and 1 (60)
  a.set(2, skin, 1, 3, 500, 0);
  expect(moveSlot(a, 1, b, 4, 0, reg)).toBe(60); // whole stack to an empty slot
  expect(moveSlot(a, 0, b, 4, 70, reg)).toBe(40); // joins, up to the stack size
  expect(slots(b)).toEqual(["4:core:stonex100"]);
  expect(moveSlot(a, 0, b, 4, 0, reg)).toBe(0); // The target stack is full, so the move is refused.
  expect(moveSlot(a, 0, a, 5, 20, reg)).toBe(20); // split within one inventory
  expect(slots(a)).toEqual(["0:core:stonex40", "2:core:waterskinx1", "5:core:stonex20"]);
  expect(moveSlot(a, 2, a, 0, 0, reg)).toBe(1); // Different items swap.
  expect(slots(a)).toEqual(["0:core:waterskinx1", "2:core:stonex40", "5:core:stonex20"]);
  expect([a.quality[0], a.dur[0]]).toEqual([3, 500]); // instance data travels with it
  expect(moveSlot(a, 2, a, 0, 10, reg)).toBe(0); // part of a stack cannot swap
  expect(moveSlot(a, 3, a, 4, 0, reg)).toBe(0); // nothing there
  expect(moveSlot(a, 2, a, 2, 0, reg)).toBe(0); // onto itself
  expect(moveSlot(a, 2, a, 99, 0, reg)).toBe(0); // no such slot
  expect(a.total(stone) + b.total(stone)).toBe(160);
});

test("property: no sequence of moves creates or destroys anything", () => {
  const rng = new Rng(5);
  for (let round = 0; round < 40; round++) {
    const boxes = [new Inventory(8), new Inventory(5), new Inventory(12)];
    const items = [stone, berry, skin];
    const start = [0, 0, 0];
    for (const inv of boxes) {
      for (let k = 0; k < 6; k++) {
        const i = rng.int(3);
        const n = 1 + rng.int(150);
        start[i] = start[i]! + n - inv.add(items[i]!, n, rng.int(2), 0, rng.int(1000), reg);
      }
    }
    for (let step = 0; step < 300; step++) {
      const a = boxes[rng.int(3)]!;
      const b = boxes[rng.int(3)]!;
      moveSlot(a, rng.int(a.cap + 1), b, rng.int(b.cap + 1), rng.int(4) === 0 ? 0 : rng.int(120), reg);
    }
    for (let i = 0; i < 3; i++) expect(boxes.reduce((n, inv) => n + inv.total(items[i]!), 0)).toBe(start[i]!);
    for (const inv of boxes) {
      for (let s = 0; s < inv.cap; s++) {
        if (inv.item[s] === 0) expect([inv.count[s], inv.quality[s], inv.dur[s], inv.spoilAt[s]]).toEqual([0, 0, 0, 0]);
        else expect(inv.count[s]! >= 1 && inv.count[s]! <= reg.stack[inv.item[s]!]!).toBe(true);
      }
    }
  }
});

test("spoilage: one item per interval, the same whether looked at once or every tick, and never for things that keep", () => {
  // Ten minutes.
  expect(SPOIL).toBe(18000);
  const once = new Inventory(4);
  const often = new Inventory(4);
  for (const inv of [once, often]) {
    inv.add(berry, 30, 0, 0, 1000, reg);
    inv.add(stone, 10, 0, 0, 1000, reg);
  }
  expect(once.spoilAt[0]).toBe(1000 + SPOIL);
  const lostOnce: number[] = [];
  const lostOften: number[] = [];
  const end = 1000 + SPOIL * 7 + 123;
  for (let t = 1000; t <= end; t += 97) often.settle(t, reg, (_item, n) => lostOften.push(n));
  often.settle(end, reg, (_item, n) => lostOften.push(n));
  once.settle(end, reg, (item, n) => (expect(item).toBe(berry), lostOnce.push(n)));
  expect(lostOnce).toEqual([7]);
  expect(lostOften.reduce((a, b) => a + b, 0)).toBe(7);
  expect(once.count[0]).toBe(23);
  expect(often.count[0]).toBe(23);
  expect(once.spoilAt[0]).toBe(often.spoilAt[0]);
  expect(once.spoilAt[0]).toBe(1000 + SPOIL * 8);
  expect(once.total(stone)).toBe(10);
  once.settle(end + SPOIL * 100, reg, () => {});
  expect(once.total(berry)).toBe(0);
  expect(once.used()).toBe(1);

  // Joining a fresher stack onto an older one keeps the older clock. The reverse makes the target older.
  const a = new Inventory(2);
  a.set(0, berry, 10, 0, 0, 5000);
  a.set(1, berry, 10, 0, 0, 9000);
  moveSlot(a, 1, a, 0, 0, reg);
  expect([a.count[0], a.spoilAt[0]]).toEqual([20, 5000]);
  a.set(1, berry, 5, 0, 0, 2000);
  moveSlot(a, 1, a, 0, 0, reg);
  expect([a.count[0], a.spoilAt[0]]).toEqual([25, 2000]);
});

test("a vital read once equals the same vital stepped every tick, and says when it will run out", () => {
  const v = new Vitals();
  v.max.fill(100_000_000);
  v.value[V_FOOD] = 60_000_000;
  v.rate[V_FOOD] = -1429; // six points an hour
  v.value[V_HEALTH] = 99_999_000;
  v.rate[V_HEALTH] = 6667;
  v.tick = 500;
  let stepped = 60_000_000;
  for (let t = 501; t <= 90_000; t++) stepped = Math.max(0, stepped - 1429);
  expect(v.at(V_FOOD, 90_000)).toBe(stepped);
  expect(v.at(V_HEALTH, 501)).toBe(100_000_000); // clamped at the maximum
  const out = v.zeroTick(V_FOOD);
  expect(v.at(V_FOOD, out)).toBe(0);
  expect(v.at(V_FOOD, out - 1)).toBeGreaterThan(0);
  expect(v.zeroTick(V_HEALTH)).toBe(Infinity);
  const before = [v.at(V_FOOD, 7000), v.at(V_HEALTH, 7000)];
  v.rebase(7000);
  expect([v.at(V_FOOD, 7000), v.at(V_HEALTH, 7000)]).toEqual(before);
  expect(v.at(V_FOOD, 90_000)).toBe(stepped);
  expect(v.version).toBe(1);
});
