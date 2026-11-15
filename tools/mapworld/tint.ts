// The ground's colour: one palette index a sample (shared/pack/palette.ts), by what the ground is and, for a ruin, by
// the district it stood in. The earth tones run dark to light in steps of one index, so a step either way is the same
// colour in more or less light. Variation is by smooth noise of many metres and by ruin, never by sample, since far
// ground is drawn from every fourth sample and sample-to-sample speckle would crawl there.

import { S, type Ground, type World } from "./ground.ts";
import { fbm, hash3 } from "./raster.ts";

/** Each surface's colours: the first is the most common, and noise picks among the rest. */
const GROUND: Record<number, readonly number[]> = {
  [S.CHANNEL]: [96, 95, 127],
  [S.DEEP]: [128, 127, 97],
  [S.FLAT]: [148, 129, 131, 158],
  [S.SHALLOW]: [123, 122, 159],
  [S.POOL]: [118, 129, 117],
  [S.WET_SAND]: [122, 121],
  [S.BEACH]: [125, 124, 169],
  [S.DUNE]: [168, 133, 160],
  [S.HIGHWAY]: [84, 85, 96],
  [S.STREET]: [85, 86, 129],
  [S.DECK]: [89, 88, 99],
  [S.FORD]: [99, 98, 129],
  [S.COURT]: [151, 150, 98],
  [S.OPEN]: [101, 100, 150, 151],
  [S.YARD]: [102, 101, 86],
  [S.GREEN]: [197, 150, 196, 151],
  [S.CANOPY]: [195, 137, 196, 138],
  [S.MANGROVE]: [138, 117, 137],
  [S.MARSH]: [139, 130, 147, 129],
  [S.WRECK]: [179, 180, 97],
};

/** A ruin's colour by its district's style: one picked for each ruin, then a step lighter or darker by noise. */
const RUIN: Record<string, readonly number[]> = {
  concrete: [100, 101, 88, 99, 89],
  deco: [113, 112, 104, 135, 92, 114],
  terracotta: [205, 206, 183, 112],
  // Warehouses painted over: most are brick and block, and many still carry their murals.
  mural: [172, 98, 59, 65, 69, 61, 180, 99],
  residential: [104, 103, 114, 102],
  industrial: [102, 89, 179, 101],
};

/** Shipping containers, a colour each. */
const CONTAINERS = [179, 181, 41, 89, 205, 196, 53];

export function makeTint(ground: Ground, world: World): Uint8Array {
  const { n, surface, heaps } = ground;
  const tint = new Uint8Array(n * n);
  const cell = 2;
  for (let i = 0; i < n * n; i++) {
    const c = i % n;
    const r = (i - c) / n;
    const s = surface[i]!;
    const x = c * cell;
    const z = r * cell;
    const ruin = heaps.owner[i]!;
    if (ruin >= 0 && (s === S.HEAP || s === S.SPILL || s === S.WALL || s === S.FLOOR)) {
      const d = heaps.ruins[ruin]!.district;
      const style = world.districts[d - 1]?.style ?? "residential";
      const list = RUIN[style] ?? RUIN.residential!;
      let k = list[hash3(ruin, 7, 0) % list.length]!;
      const v = fbm(x, z, 10, 401, 2);
      if (s === S.SPILL || s === S.FLOOR) k = v < 0.45 ? k - 1 : k;
      else k = v < 0.33 ? k - 1 : v > 0.68 ? k + 1 : k;
      // Weeds take the spill and the low floors of halls.
      if ((s === S.SPILL || s === S.FLOOR) && fbm(x, z, 14, 402, 2) > 0.6) k = 150;
      tint[i] = k;
      continue;
    }
    if (s === S.CONTAINER) {
      tint[i] = CONTAINERS[ground.container[i]! % CONTAINERS.length]!;
      continue;
    }
    const list = GROUND[s] ?? [15];
    let k = list[0]!;
    if (list.length > 1) {
      const wet = s === S.FLAT || s === S.DEEP || s === S.CHANNEL || s === S.SHALLOW;
      const v = fbm(x, z, wet ? 60 : 16, 300 + s, 2);
      if (v > 0.58) k = list[1]!;
      if (list.length > 2 && v < 0.38) k = list[2]!;
      if (list.length > 3 && v > 0.68) k = list[3]!;
    }
    tint[i] = k;
  }
  return tint;
}
