// A limit on the wall clock, for a test that times its own work. With more work waiting than there are cores, the clock
// times the neighbours as much as the test, so the limit stretches with the load as tools/check.ts stretches its hung-test
// limit: by the last minute's load over the cores, never less than once and at most six times.

import { cpus, loadavg } from "node:os";

/** `ms` stretched by the machine's load. */
export function underLoad(ms: number): number {
  return ms * Math.min(6, Math.max(1, loadavg()[0]! / cpus().length));
}
