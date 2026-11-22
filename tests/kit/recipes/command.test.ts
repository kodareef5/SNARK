import { expect, test } from "bun:test";
import { CMD_SPEND, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../../shared/net/protocol.ts";
import { STAT_NAMES } from "../../../shared/sim/genome.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { camp, send } from "../kit.ts";

test("a stat point is spent only when there is one, and only on a stat", () => {
  const { h, ada } = camp();
  const spend = (stat: number): number => send(h, ada, CMD_SPEND, (w) => w.u8(stat));
  const health = STAT_NAMES.indexOf("health");
  expect(spend(health)).toBe(RESULT_SHORT);
  h.say(ada, "addxp 10");
  expect(ada.progress.statPoints).toBe(1);
  expect(spend(STAT_NAMES.length)).toBe(RESULT_INVALID);
  expect(spend(health)).toBe(RESULT_OK);
  expect([ada.progress.statPoints, ada.vitals.max[V_HEALTH]! / 1e6]).toEqual([0, 110]);
});
