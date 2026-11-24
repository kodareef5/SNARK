import { expect, test } from "bun:test";
import { CMD_CRAFT, CMD_LEARN } from "../../../shared/net/protocol.ts";
import { camp, count, id, send, until, type CampOptions } from "../kit.ts";

/** The experience a new survivor has after making one pick, under some settings. */
function made(rules: CampOptions["rules"]): number {
  const { h, ada, me } = camp({ rules, items: { stone: 1, wood: 1, thatch: 10 } });
  send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")));
  send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(1)));
  expect(until(h, () => count(h, ada, "pick") === 1, 10)).toBe(true);
  return me.xp;
}

test("CraftXPMultiplier multiplies the experience for making a thing", () => {
  expect(made({})).toBe(1.6);
  expect(made({ CraftXPMultiplier: 4 })).toBe(6.4);
});

test("a setting the server does not know stops the test where it is given", () => {
  expect(() => made({ CraftXPMultiplyer: 4 })).toThrow("there is no setting called CraftXPMultiplyer");
});
