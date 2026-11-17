// The boat's seats against real survivors over three million points: slow by nature, so in the slow tier
// (boat-art.test.ts checks the packs themselves).
import { expect } from "bun:test";
import { auditBoatFit } from "../../tools/art/boat-fit.ts";
import { test } from "../fixtures/needs-art.ts";

test("actual survivors and gear clear all other seats, console and hull across proportions and head look", () => {
  const report = auditBoatFit();
  expect(report.pointsTested).toBeGreaterThan(3_000_000);
  expect(report.failures).toEqual([]);
  expect(report.pilotProfiles).toBe(474);
  expect(report.gripResidual).toBeLessThan(.001);
  expect(report.worst.margin).toBeGreaterThan(.04);
  expect(report.headWorst.margin - report.headMotionAllowance).toBeGreaterThan(.04);
});
