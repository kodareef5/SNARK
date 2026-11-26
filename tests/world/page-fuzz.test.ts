// Two seeded random runs of a page of a map it takes in parts (tests/fixtures/map-page-fuzz.ts): the loader alone. The
// slow tier runs 440 (page-fuzz.slow.test.ts). One seed again:
//
//   PAGE_FROM=17 PAGE_SEEDS=1 bun test tests/world/page-fuzz.test.ts

import { expect, test } from "bun:test";
import { fuzzLoader, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

test("random moves, answers, failures and wants leave a page holding the map's own", async () => {
  expect(await wrongSeeds(fuzzLoader, Number(process.env.PAGE_FROM ?? 1), Number(process.env.PAGE_SEEDS ?? 2), 300)).toEqual([]);
});
