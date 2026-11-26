// A seeded random run of a page of a map it takes in parts (tests/fixtures/map-page-fuzz.ts): its loader and its
// session on a server. The slow tier runs 200 (page-fuzz-play.slow.test.ts). One seed again, with each change of the
// statics it wants as it settles:
//
//   PAGE_FROM=17 PAGE_SEEDS=1 PAGE_SAY=1 bun test tests/world/page-fuzz-play.test.ts

import { expect, test } from "bun:test";
import { fuzzGame, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

test("random play on a server leaves a page holding what the server and the map do", async () => {
  expect(await wrongSeeds(fuzzGame, Number(process.env.PAGE_FROM ?? 1), Number(process.env.PAGE_SEEDS ?? 1), 400)).toEqual([]);
});
