// The creature packages' places in a running host: their commands are answered and refused, and a held creature is left
// to whoever holds it.

import { expect, test } from "bun:test";
import { CARRY_PICK_UP, CARRY_THROW, CMD_CARRY, CMD_ORDER, CMD_TAKE, ORDER_ATTACK, ORDER_WANDER, RESULT_INVALID, RESULT_NOT_YOURS } from "../../shared/net/protocol.ts";
import { F_GROUNDED, F_HELD } from "../../shared/sim/entities.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

test("carrying, taking an egg and the new orders are refused until they are built, and a held creature is not stepped", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  h.say(ada, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  const e = h.host.spawnCreature("core:dodo", g.x + 20, g.z + 10, 5);
  expect(e).toBeGreaterThanOrEqual(0);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  ada.command(CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(e)));
  ada.command(CMD_CARRY, (w) => w.u8(CARRY_THROW));
  ada.command(CMD_TAKE, (w) => w.u32(e));
  ada.command(CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_WANDER)));
  ada.command(CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_ATTACK), w.u32(e)));
  h.run(400);
  // The orders are built (tests/integration/orders.test.ts): a wild dodo is nobody's to order.
  expect(codes).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NOT_YOURS]);
  expect([h.host.corpses, h.host.carry, h.host.feces, h.host.eggs, h.host.overhead, h.host.hurt].every((m) => m !== undefined)).toBe(true);

  // Lifted into the air and held, it stays there; let go, it falls.
  const ents = h.world.ents;
  ents.flags[e] = (ents.flags[e]! | F_HELD) & ~F_GROUNDED;
  ents.setPosition(e, ents.x[e]!, ents.y[e]! + 3, ents.z[e]!);
  const up = ents.y[e]!;
  h.run(500);
  expect(ents.y[e]).toBe(up);
  ents.flags[e] = ents.flags[e]! & ~F_HELD;
  h.run(1500);
  expect(ents.y[e]!).toBeLessThan(up - 2);
});
