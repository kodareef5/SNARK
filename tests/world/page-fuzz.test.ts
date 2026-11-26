// A few seeded random runs of a page of a map it takes in parts, alone and in the game (tests/fixtures/map-page-fuzz.ts).
// The slow tier runs many more (page-fuzz.slow.test.ts). One seed again, with what it measured:
//
//   PAGE_FROM=17 PAGE_SEEDS=1 bun test tests/world/page-fuzz.test.ts

import { expect, test } from "bun:test";
import { fuzzGame, fuzzLoader, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

const FROM = Number(process.env.PAGE_FROM ?? 1);
const SEEDS = Number(process.env.PAGE_SEEDS ?? 0);

test("random moves, answers, failures and wants leave a page holding the map's own", async () => {
  expect(await wrongSeeds(fuzzLoader, FROM, SEEDS || 4, 300)).toEqual([]);
});

test("random play on a server leaves a page holding what the server and the map do", async () => {
  expect(await wrongSeeds(fuzzGame, FROM, SEEDS || 2, 400)).toEqual([]);
});
