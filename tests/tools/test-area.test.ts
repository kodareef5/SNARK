// Where a test file left in the old folders goes (tools/test-area.ts).

import { expect, test } from "bun:test";
import { areaOf, placed, rewritten, type Moved } from "../../tools/test-area.ts";

const MOVED: Moved = {
  "unit/vehicle-rest.test.ts": "vehicles/vehicle-rest.test.ts",
  "integration/vehicle-cost.test.ts": "vehicles/vehicle-cost.test.ts",
  "unit/vehicle-sound.test.ts": "sound/vehicle-sound.test.ts",
  "unit/breeding.test.ts": "creatures/breeding.test.ts",
  "integration/breeding.test.ts": "creatures/breeding-play.test.ts",
};

test("a new file goes where most files with its first word are, and one with no kin has no area", () => {
  expect(areaOf("vehicle-jump.test.ts", MOVED)).toBe("vehicles");
  expect(areaOf("breeding.slow.test.ts", MOVED)).toBe("creatures");
  expect(areaOf("ufo.test.ts", MOVED)).toBeUndefined();
});

test("a name the area already has becomes <name>-play, slow or not", () => {
  const taken = (p: string): boolean => p === "creatures/eggs.test.ts" || p === "world/cruise.slow.test.ts";
  expect(placed("eggs.test.ts", "items", taken)).toBe("items/eggs.test.ts");
  expect(placed("eggs.test.ts", "creatures", taken)).toBe("creatures/eggs-play.test.ts");
  expect(placed("cruise.slow.test.ts", "world", taken)).toBe("world/cruise-play.slow.test.ts");
});

test("old paths in text become the new ones, with tests/ before them or not, and others stay", () => {
  const text = "see tests/unit/breeding.test.ts and ../integration/breeding.test.ts, not tests/unit/gone.test.ts or client/unit/x.ts";
  expect(rewritten(text, MOVED)).toBe("see tests/creatures/breeding.test.ts and ../creatures/breeding-play.test.ts, not tests/unit/gone.test.ts or client/unit/x.ts");
});
