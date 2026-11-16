// The one hang limit for every test, set before each file by tests/fixtures/preload.ts. It stretches with the load: the
// last minute's average over the cores, plus the check's own workers, which that average does not hold when they start.

import { cpus, loadavg } from "node:os";

/** A test file of the slow tier, which runs before a merge and nightly instead of on every push. */
export const SLOW_TEST = /\.slow\.test\.ts$/;
/** Set by the check: the test workers it runs, counted in the load. */
export const TEST_WORKERS = "SNARK_TEST_WORKERS";
/** Set by the check: a folder where each worker says what it is running, and each test file what it cost. */
export const TEST_WATCH = "SNARK_TEST_WATCH";

/**
 * On an idle machine a test is called hung after a minute, and one in the slow tier after 5 minutes. Generous: a test of
 * 9.5 s alone took over two minutes while the load rose from 48 to 81 on 10 cores.
 */
const HUNG_MS = 60_000;
const SLOW_HUNG_MS = 300_000;

/** Milliseconds after which a test in `file` is called hung, at the load now. */
export function hungAfter(file: string, workers = Number(process.env[TEST_WORKERS] ?? 0)): number {
  const load = loadavg()[0]! + workers;
  return Math.round((SLOW_TEST.test(file) ? SLOW_HUNG_MS : HUNG_MS) * Math.max(1, load / cpus().length));
}
