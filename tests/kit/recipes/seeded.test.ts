import { expect, test } from "bun:test";
import { BOX_SELF, CMD_MOVE, RESULT_OK } from "../../../shared/net/protocol.ts";
import { Rng } from "../../../shared/rng.ts";
import { camp, count, send } from "../kit.ts";

for (const seed of [1, 2, 3]) test(`no move between slots makes or loses an item, seed ${seed}`, () => {
  const { h, ada } = camp({ items: { stone: 100, wood: 100, berry: 50 } });
  const rng = new Rng(seed);
  const inv = ada.inventory!;
  let moved = 0;
  for (let n = 0; n < 100; n++) {
    const held = [...inv.item.keys()].filter((slot) => inv.item[slot] !== 0);
    const from = held[rng.int(held.length)]!, to = rng.int(inv.cap), some = rng.int(150), item = inv.item[rng.int(4) === 0 ? to : from]!;
    const code = send(h, ada, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(some), w.u16(item)));
    if (code === RESULT_OK) moved++;
  }
  expect(moved).toBeGreaterThan(30);
  expect(h.host.items.audit()).toEqual([]);
  expect([count(h, ada, "stone"), count(h, ada, "wood"), count(h, ada, "berry")]).toEqual([100, 100, 50]);
  expect(inv.total(h.reg.index.get("core:stone")!)).toBe(100);
});
