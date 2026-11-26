// 200 seeded random runs of a page of a map it takes in parts, its loader and its session on a server
// (tests/fixtures/map-page-fuzz.ts): 10 batches of 20, a batch a test so each stays within its time. Others, from a
// seed on:
//
//   PAGE_FROM=1000 bun test tests/world/page-fuzz-play.slow.test.ts

import { expect, test } from "bun:test";
import { fuzzGame, wrongSeeds } from "../fixtures/map-page-fuzz.ts";

const FROM = Number(process.env.PAGE_FROM ?? 1);
const SEEDS = 20;

for (let from = FROM; from < FROM + 10 * SEEDS; from += SEEDS) {
  test(`random play on a server: seeds ${from} to ${from + SEEDS - 1}`, async () => {
    expect(await wrongSeeds(fuzzGame, from, SEEDS, 400)).toEqual([]);
  });
}
