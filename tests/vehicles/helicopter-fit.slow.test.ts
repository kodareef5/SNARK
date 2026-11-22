// The helicopter's cabin against real survivors over three million points: slow by nature, so in the slow tier
// (helicopter-art.test.ts checks the packs themselves).
import { expect } from "bun:test";
import { auditHelicopterFit } from "../../tools/art/helicopter-fit.ts";
import { test } from "../fixtures/needs-art.ts";

test("real survivor bodies, every armor set and hair fit across proportion extremes and continuous body/look bounds", () => {
  const report = auditHelicopterFit();
  expect(report.pointsTested).toBeGreaterThan(3_000_000);
  expect(report.failures).toEqual([]);
  expect(report.pilotProfiles).toBe(158);
  expect(report.gripResidual).toBeLessThan(.001);
  expect(report.controlsWorst.margin).toBeGreaterThan(.04);
  expect(report.worst.margin).toBeGreaterThan(.04);
  // Angle-times-radius covers the unsampled looks between sweep grid points, so corner poses alone cannot hide a breach.
  expect(report.headWorst.margin - report.headMotionAllowance).toBeGreaterThan(.04);
});
