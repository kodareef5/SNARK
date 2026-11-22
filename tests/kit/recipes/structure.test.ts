import { expect, test } from "bun:test";
import { NO_TARGET } from "../../../server/build.ts";
import { STRUCT_UNITS as U } from "../../../shared/coords.ts";
import { CMD_PLACE, CMD_STRUCT, RESULT_NOT_YOURS, RESULT_OK } from "../../../shared/net/protocol.ts";
import { STRUCT_DEMOLISH } from "../../../shared/world/upkeep.ts";
import { takeInHand } from "../../fixtures/gather.ts";
import { camp, count, id, send, survivor } from "../kit.ts";

test("a foundation is set down from the hand; only its builder may demolish it", () => {
  const { h, ada, at } = camp({ items: { piece_foundation_wood: 1 } });
  const bob = survivor(h, "bob", { at: { x: at.x + 2, z: at.z } });
  takeInHand(h, ada, id("piece_foundation_wood"));
  const [x, z] = [Math.round(at.x * U), Math.round((at.z + 4) * U)];
  expect(send(h, ada, CMD_PLACE, (w) => (w.u8(0), w.u32(NO_TARGET), w.sbits(x, 32), w.sbits(z, 32), w.u16(0), w.sbits(0, 8), w.u8(0)))).toBe(RESULT_OK);
  const ref = h.host.build.last;
  expect([h.world.structs.count, bob.world!.structs.count, count(h, ada, "piece_foundation_wood")]).toEqual([1, 1, 0]);

  const demolish = (w: { u32(n: number): void; u8(n: number): void }): void => (w.u32(ref), w.u8(STRUCT_DEMOLISH));
  expect(send(h, bob, CMD_STRUCT, demolish)).toBe(RESULT_NOT_YOURS);
  expect(send(h, ada, CMD_STRUCT, demolish)).toBe(RESULT_OK);
  h.run(200);
  expect([h.world.structs.count, bob.world!.structs.count]).toEqual([0, 0]);
});
