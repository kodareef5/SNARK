import { expect, test } from "bun:test";
import { CMD_CRAFT, CMD_LEARN, RESULT_DENIED, RESULT_OK } from "../../../shared/net/protocol.ts";
import { HOLD_PICK, HOLD_TOOL } from "../../../shared/sim/weapon.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, count, id, send, until } from "../kit.ts";

test("a pick is made from its parts once its engram is learned, and held", () => {
  const { h, ada } = camp({ items: { stone: 1, wood: 1, thatch: 10 } });
  const craft = (): number => send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(1)));
  expect(craft()).toBe(RESULT_DENIED);
  expect(send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")))).toBe(RESULT_OK);
  expect(craft()).toBe(RESULT_OK);
  expect(until(h, () => count(h, ada, "pick") === 1, 10)).toBe(true);
  expect([count(h, ada, "stone"), count(h, ada, "wood"), count(h, ada, "thatch")]).toEqual([0, 0, 0]);
  takeInHand(h, ada, id("pick"));
  expect(h.world.ents.hold[h.ent(ada)]).toBe(HOLD_TOOL | HOLD_PICK);
});
