import { expect, test } from "bun:test";
import { TICK_RATE } from "../../../shared/coords.ts";
import { CMD_CRAFT, CMD_LEARN, RESULT_OK } from "../../../shared/net/protocol.ts";
import { camp, count, id, send, survivor } from "../kit.ts";

test("three picks queued are made one after another while their maker is away", () => {
  const { h, ada } = camp({ items: { stone: 3, wood: 3, thatch: 30 } });
  send(h, ada, CMD_LEARN, (w) => w.u16(id("engram-pick")));
  expect(send(h, ada, CMD_CRAFT, (w) => (w.u16(id("pick")), w.u8(3)))).toBe(RESULT_OK);
  const due = ada.progress.jobs[0]!.doneAt;
  expect(due).toBeGreaterThan(h.world.tick + TICK_RATE);
  ada.close();

  h.run(((due - h.world.tick - 1) * 1000) / TICK_RATE);
  expect(h.server.playerCount).toBe(0);
  h.run(60_000);
  const back = survivor(h, "ada");
  expect(count(h, back, "pick")).toBe(3);
  expect(back.progress.jobs).toEqual([]);
});
