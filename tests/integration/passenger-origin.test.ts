import { expect } from "bun:test";
import { passengerOriginTrial } from "../../tools/bench/passenger-origin.ts";
import { test } from "../fixtures/needs-art.ts";

for (const rtt of [50, 150, 300]) test(`ordinary moving App passenger shot coverage and recorded error envelope at TCP ${rtt} ms`, () => {
  const r = passengerOriginTrial(rtt);
  expect(r.frames).toBeGreaterThanOrEqual(1800);
  expect(r.undecodable).toBe(0);
  expect(r.localShots).toBeGreaterThanOrEqual(14);
  expect(r.paired / r.localShots).toBeGreaterThanOrEqual(.75);
  expect(r.exact + r.adjacent).toBe(r.paired);
  expect(r.paired + r.unmatchedLocal).toBe(r.localShots);
  expect(r.paired + r.unmatchedServer).toBe(r.serverShots);
  expect(r.speedMps.median).toBeGreaterThan(20);
  // This preserves the measured course envelope, not a claim of sub-metre aim agreement or a general delay bound.
  expect(r.errorM.max).toBeLessThan(5);
  expect(r.rewindFromCurrentEyeM.median).toBeGreaterThan(3);
});
