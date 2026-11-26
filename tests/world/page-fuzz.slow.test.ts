// Many seeded random runs of a page of a map it takes in parts, alone and in the game
// (tests/fixtures/map-page-fuzz.ts), a batch a test so each stays within its time. More, or others:
//
//   PAGE_FROM=1000 PAGE_SEEDS=200 bun test tests/world/page-fuzz.slow.test.ts

import { expect, test } from "bun:test";
import { fuzzGame, fuzzLoader, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

const FROM = Number(process.env.PAGE_FROM ?? 1);
const SEEDS = Number(process.env.PAGE_SEEDS ?? 0);
const LONG = SEEDS > 0 ? 3_600_000 : undefined;

for (let batch = 0; batch < 4; batch++) {
  const [from, seeds] = [FROM + batch * (SEEDS || 40), SEEDS || 40];
  test(`random moves, answers, failures and wants: seeds ${from} to ${from + seeds - 1}`, async () => {
    expect(await wrongSeeds(fuzzLoader, from, seeds, 300)).toEqual([]);
  }, LONG);
}

for (let batch = 0; batch < 3; batch++) {
  const [from, seeds] = [FROM + batch * (SEEDS || 20), SEEDS || 20];
  test(`random play on a server: seeds ${from} to ${from + seeds - 1}`, async () => {
    expect(await wrongSeeds(fuzzGame, from, seeds, 400)).toEqual([]);
  }, LONG);
}
