// Which tests a look runs (tools/check-pick.ts), and the smoke set's list held to the files there are.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOW_TEST } from "../fixtures/load.ts";
import { pick, smokeList } from "../../tools/check-pick.ts";

const ROOT = join(import.meta.dir, "../..");
const ALL = ["tests/net/codec.test.ts", "tests/net/hostile.slow.test.ts", "tests/net/wire.test.ts", "tests/vehicles/wear.test.ts"];

test("a folder gives its fast tests, a file is taken as named, and nothing runs twice", () => {
  expect(pick(["tests/net"], ALL, SLOW_TEST)).toEqual({ files: ["tests/net/codec.test.ts", "tests/net/wire.test.ts"], none: [] });
  expect(pick(["tests/net/hostile.slow.test.ts"], ALL, SLOW_TEST).files).toEqual(["tests/net/hostile.slow.test.ts"]);
  expect(pick(["./tests/vehicles/", "tests/net/wire.test.ts", "tests/vehicles/wear.test.ts"], ALL, SLOW_TEST).files).toEqual(["tests/net/wire.test.ts", "tests/vehicles/wear.test.ts"]);
});

test("a name that matches no test file is said, a folder's prefix is not the folder", () => {
  expect(pick(["tests/ne", "tests/net/gone.test.ts", "tests/net"], ALL, SLOW_TEST)).toEqual({ files: ["tests/net/codec.test.ts", "tests/net/wire.test.ts"], none: ["tests/ne", "tests/net/gone.test.ts"] });
});

test("the smoke list is its paths: comments and blank lines left out", () => {
  expect(smokeList("# a group\ntests/a/b.test.ts\n\n  tests/c/d.test.ts  # why\n")).toEqual(["tests/a/b.test.ts", "tests/c/d.test.ts"]);
});

test("every path in tests/smoke.txt is a fast test file that exists, named once", () => {
  const listed = smokeList(readFileSync(join(ROOT, "tests/smoke.txt"), "utf8"));
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.filter((f) => !existsSync(join(ROOT, f)) || !f.endsWith(".test.ts") || SLOW_TEST.test(f))).toEqual([]);
  expect(listed.filter((f, i) => listed.indexOf(f) !== i)).toEqual([]);
});
