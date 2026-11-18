import { expect, test } from "bun:test";
import { affectedTests, importsOf } from "../../tools/check-changed.ts";

const sources = new Map([
  ["shared/math.ts", "export const add = (a: number, b: number) => a + b;"],
  ["server/score.ts", 'import { add } from "../shared/math.ts";\nexport const score = () => add(1, 2);'],
  ["server/lore.ts", 'const text = readFileSync(join(ROOT, "planning/lore.md"), "utf8");'],
  ["tests/unit/math.test.ts", 'import { add } from "../../shared/math.ts";'],
  ["tests/unit/score.test.ts", 'import { score } from "../../server/score.ts";'],
  ["tests/unit/lore.test.ts", 'import "../../server/lore.ts";'],
  ["tests/unit/alone.test.ts", "// imports \"../../shared/math.ts\" only in a comment"],
]);
const tests = [...sources.keys()].filter((f) => f.endsWith(".test.ts"));

test("imports are read by relative name, from code and not from comments", () => {
  expect(importsOf("tests/unit/score.test.ts", sources.get("tests/unit/score.test.ts")!)).toEqual(["server/score.ts"]);
  expect(importsOf("tests/unit/alone.test.ts", sources.get("tests/unit/alone.test.ts")!)).toEqual([]);
  expect(importsOf("a/b.ts", 'import x from "node:fs";\nexport * from "./c.ts";\nawait import("../d.ts");')).toEqual(["a/c.ts", "d.ts"]);
});

test("a changed file reaches the tests that import it at any depth, and no others", () => {
  expect(affectedTests(["shared/math.ts"], sources, tests)).toEqual(["tests/unit/math.test.ts", "tests/unit/score.test.ts"]);
  expect(affectedTests(["server/score.ts"], sources, tests)).toEqual(["tests/unit/score.test.ts"]);
  expect(affectedTests(["tests/unit/alone.test.ts"], sources, tests)).toEqual(["tests/unit/alone.test.ts"]);
  expect(affectedTests(["planning/unread.md"], sources, tests)).toEqual([]);
});

test("a document reaches the tests of the code that names it", () => {
  expect(affectedTests(["planning/lore.md"], sources, tests)).toEqual(["tests/unit/lore.test.ts"]);
});

test("a change to what every test may read runs them all", () => {
  for (const f of ["content/creatures/dodo.json", "config/official/Game.ini", "tests/fixtures/pack.ts", "bun.lock", "package.json", "tools/check.ts", "client/core/tsconfig.json"]) {
    expect(affectedTests([f], sources, tests)).toBe("all");
  }
});
