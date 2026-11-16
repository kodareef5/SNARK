// Loaded before each test file (bunfig.toml): the hang limit its tests share, and under the check, what the worker is
// running and what the file cost.

import { afterAll, beforeEach, setDefaultTimeout } from "bun:test";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_WATCH, hungAfter } from "./load.ts";

const limit = hungAfter(Bun.main);
setDefaultTimeout(limit);

const dir = process.env[TEST_WATCH];
if (dir) {
  // The file, its test now running (0 while it loads), when that began and its limit. A test that never yields to its
  // own timeout, such as a loop with no end, is stopped by the check from this.
  const now = join(dir, `${process.pid}.now`);
  let n = 0;
  const running = (): void => writeFileSync(now, `${Bun.main}\t${n++}\t${Date.now()}\t${limit}`);
  running();
  beforeEach(running);
  const from = process.cpuUsage();
  afterAll(() => {
    rmSync(now, { force: true });
    // This process's time only: processes a test starts are in the check's total, not here.
    const used = process.cpuUsage(from);
    appendFileSync(join(dir, `${process.pid}.tsv`), `${Bun.main}\t${(used.user + used.system) / 1e6}\n`);
  });
}
