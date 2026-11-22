import { expect, test } from "bun:test";
import { missingArt } from "../../tools/art/installed.ts";
import { failuresOf, verdict } from "../../tools/check-report.ts";

test("art is installed when every pinned archive is recorded with the pinned digest, each on its own", () => {
  const pinned = [{ name: "core-creatures-dodo", sha256: "aa" }, { name: "core-sfx", sha256: "bb" }];
  expect(missingArt(pinned, { "core-creatures-dodo": "aa", "core-sfx": "bb", "an-older-asset": "cc" })).toEqual([]);
  // One archive pinned anew leaves the others installed.
  expect(missingArt(pinned, { "core-creatures-dodo": "aa", "core-sfx": "b0" })).toEqual(["core-sfx"]);
  expect(missingArt(pinned, {})).toEqual(["core-creatures-dodo", "core-sfx"]);
});

const run = { problems: [], art: true, noArt: false, passed: 12_000, unart: 0, ok: "OK in 80.00s" };

test("a check that skipped tests for missing art is not a gate, unless it was told the art is not here", () => {
  expect(verdict(run)).toEqual({ text: "\nOK in 80.00s", pass: true });
  expect(verdict({ ...run, art: false, unart: 302 })).toEqual({ text: "\nNOT A GATE: 302 tests skipped for missing art (run: bun run media art)", pass: false });
  const told = verdict({ ...run, art: false, noArt: true, unart: 302 });
  expect(told.pass).toBe(true);
  expect(told.text).toBe("\nOK in 80.00s\n12,000 tests passed. 302 were skipped: they need the art or the planning documents, which are not in this repository.");
  // Told so where the art is installed, nothing was skipped and nothing is said.
  expect(verdict({ ...run, noArt: true })).toEqual(verdict(run));
  // A look at some tests that skipped none lost nothing to the art.
  expect(verdict({ ...run, art: false }).pass).toBe(true);
});

test("a failed check says both what failed and that tests were skipped", () => {
  const failed = verdict({ ...run, problems: ["types", "fast tests failed"], art: false, unart: 302 });
  expect(failed.pass).toBe(false);
  expect(failed.text).toStartWith("\nFAILED (2)\n - types\n - fast tests failed");
  expect(failed.text).toEndWith("\nNOT A GATE: 302 tests skipped for missing art (run: bun run media art)");
  expect(verdict({ ...run, problems: ["types"] })).toEqual({ text: "\nFAILED (1)\n - types", pass: false });
});

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="5" assertions="2" failures="3" skipped="1" time="5.01">
  <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" tests="4" assertions="2" failures="2" skipped="1" time="0.001" hostname="h">
    <testcase name="one passes" classname="" time="0.000019" file="tests/unit/a.test.ts" line="2" assertions="1" />
    <testsuite name="group &lt;x&gt; &amp; &quot;q&quot;" file="tests/unit/a.test.ts" line="3" tests="2" assertions="1" failures="2" skipped="0" time="0" hostname="h">
      <testcase name="two fails" classname="group &lt;x&gt; &amp; &quot;q&quot;" time="0.000148" file="tests/unit/a.test.ts" line="4" assertions="1">
        <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 3&#10;Received: 2&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 3&#10;      at a.test.ts:4:43&#10;</failure>
      </testcase>
    </testsuite>
    <testcase name="skipped" classname="" time="0" file="tests/unit/a.test.ts" line="7" assertions="0">
      <skipped />
    </testcase>
  </testsuite>
  <testsuite name="tests/unit/c.test.ts" file="tests/unit/c.test.ts" tests="1" assertions="0" failures="1" skipped="0" time="5.002" hostname="h">
    <testcase name="times out" classname="" time="5.001694" file="tests/unit/c.test.ts" line="2" assertions="0">
      <failure type="TimeoutError" message="test timed out" />
    </testcase>
  </testsuite>
</testsuites>`;

const OUT = `
tests/unit/a.test.ts:
4 |   test("two fails", () => { expect(1 + 1).toBe(3); });
error: expect(received).toBe(expected)
(fail) group <x> & "q" > two fails [0.15ms]

tests/unit/b.test.ts:

# Unhandled error between tests
-------------------------------
2 | throw new Error("cannot load");
error: cannot load
      at /repo/tests/unit/b.test.ts:2:11
-------------------------------

tests/unit/c.test.ts:
(fail) times out [5001.69ms]
`;

test("each failing test is one line: its file, its name and the first line of its error", () => {
  expect(failuresOf(JUNIT, OUT)).toEqual([
    'tests/unit/a.test.ts\tgroup <x> & "q" > two fails\texpect(received).toBe(expected)',
    "tests/unit/c.test.ts\ttimes out\ttest timed out",
    "tests/unit/b.test.ts\t(outside a test)\tcannot load",
  ]);
  expect(failuresOf(JUNIT.replace(/<failure[^]*?<\/failure>|<failure[^>]*\/>/g, ""), "")).toEqual([]);
  // A run that left no report still names the file that would not load.
  expect(failuresOf("", OUT)).toEqual(["tests/unit/b.test.ts\t(outside a test)\tcannot load"]);
});
