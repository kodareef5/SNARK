// One whole check at a time, and its workers sized to the machine (tools/check-lock.ts).

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, born, release, take, workersFor, freeMemory, type Holder } from "../../tools/check-lock.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-lock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Processes 1 to 3 are running, each born at its own moment. */
const bornOf = (pid: number): string => (pid >= 1 && pid <= 3 ? `day ${pid}` : "");
/** A holder that `alive` finds running: this process's number, so the signal reaches something. */
const me = (checkout: string, started = born(process.pid)): Holder => ({ pid: process.pid, born: started, checkout, since: 1000 });

test("the first takes the lock, the second is told who holds it, and it is free again once let go", () => {
  const file = join(dir, "a/check.lock");
  expect(take(file, me("/one"))).toBeNull();
  expect(take(file, { ...me("/two"), since: 2000 })).toEqual(me("/one"));
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(me("/one"));
  release(file, process.pid);
  expect(existsSync(file)).toBe(false);
  expect(take(file, me("/two"))).toBeNull();
  // Nothing is left beside it.
  expect(readdirSync(join(dir, "a"))).toEqual(["check.lock"]);
});

test("a lock whose process is gone, or is another process by now, or is not a lock, is taken over", () => {
  const file = join(dir, "b/check.lock");
  // No process has this number.
  expect(take(file, { pid: 2 ** 22 + 7, born: "long ago", checkout: "/dead", since: 1 }, () => "long ago")).toBeNull();
  const gone: (string | undefined)[] = [];
  expect(take(file, me("/next"), born, (was) => gone.push(was?.checkout))).toBeNull();
  expect(gone).toEqual(["/dead"]);
  expect(JSON.parse(readFileSync(file, "utf8")).checkout).toBe("/next");
  // This process's number, as a restart might hand it out again: born at another moment.
  writeFileSync(file, JSON.stringify(me("/before-restart", "another day")));
  expect(take(file, me("/after"))).toBeNull();
  writeFileSync(file, "not a lock");
  expect(take(file, me("/whole"))).toBeNull();
  expect(JSON.parse(readFileSync(file, "utf8")).checkout).toBe("/whole");
});

test("a process is alive only as the process it was; letting go leaves another's lock alone", () => {
  expect(born(process.pid)).not.toBe("");
  expect(alive(me("/here"))).toBe(true);
  expect(alive(me("/here", "another day"))).toBe(false);
  expect(alive({ pid: 2 ** 22 + 7, born: "", checkout: "/dead", since: 1 }, bornOf)).toBe(false);
  const file = join(dir, "c/check.lock");
  expect(take(file, me("/mine"))).toBeNull();
  release(file, process.pid + 1);
  expect(existsSync(file)).toBe(true);
});

test("workers: sixteen at most, two cores left free, and no more than memory has room for at 0.6 GB each", () => {
  expect(workersFor(32, 44e9)).toBe(16);
  expect(workersFor(10, 44e9)).toBe(8);
  expect(workersFor(32, 6e9)).toBe(10);
  expect(workersFor(2, 44e9)).toBe(1);
  expect(workersFor(32, 0.2e9)).toBe(1);
});

test("free memory is what the system says, but on macOS never under half the machine's", () => {
  expect(freeMemory("linux", 3e9, 64e9)).toBe(3e9);
  expect(freeMemory("darwin", 0.4e9, 16e9)).toBe(8e9);
  expect(freeMemory("darwin", 20e9, 32e9)).toBe(20e9);
});
