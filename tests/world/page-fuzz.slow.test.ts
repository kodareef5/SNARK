// 440 seeded random runs of a page of a map it takes in parts, the loader alone (tests/fixtures/map-page-fuzz.ts): 11
// batches of 40, a batch a test so each stays within its time. Others, from a seed on:
//
//   PAGE_FROM=1000 bun test tests/world/page-fuzz.slow.test.ts

import { expect, test } from "bun:test";
import { fuzzLoader, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

const FROM = Number(process.env.PAGE_FROM ?? 1);
const SEEDS = 40;

for (let from = FROM; from < FROM + 11 * SEEDS; from += SEEDS) {
  test(`random moves, answers, failures and wants: seeds ${from} to ${from + SEEDS - 1}`, async () => {
    expect(await wrongSeeds(fuzzLoader, from, SEEDS, 300)).toEqual([]);
  });
}
