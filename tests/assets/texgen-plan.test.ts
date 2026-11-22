// The weathering masks' plan (client/core/texgen/plan.ts): every layer at an eighth of the side first, which the card
// reads from as soon as it is whole and the weathering rises from, then the whole side; no draw crosses a bay layer's
// middle, where its two variants meet; a frame's share follows the card's time; a new side begins again.
import { expect, test } from "bun:test";
import { WEATHER_COARSE, WEATHER_RISE, WeatherPlan } from "../../client/core/texgen/plan.ts";
import { MADE_FIRST, MADE_LAYERS, WEATHER_BAYS } from "../../client/core/texgen/weather.ts";

/** Frames until the pass at the plan's level is whole, each frame's draws checked; the level it made whole. */
function pass(p: WeatherPlan, rows: Map<number, number>): number {
  for (let f = 0; f < 10000; f++) {
    expect(p.frame()).toBe(true);
    for (let k = 0; k < p.count; k++) {
      const layer = p.draws[k * 4]!, row = p.draws[k * 4 + 1]!, n = p.draws[k * 4 + 2]!, half = p.draws[k * 4 + 3]!;
      expect(row).toBe(rows.get(layer) ?? 0);
      rows.set(layer, row + n);
      if (layer < WEATHER_BAYS) {
        // A bay's draw keeps to its half, and says which.
        expect(half).toBe(row >= p.wide / 2 ? 1 : 0);
        expect(row < p.wide / 2 ? row + n <= p.wide / 2 : true).toBe(true);
      } else expect(half).toBe(layer < MADE_FIRST ? -1 : 2 + ((layer - MADE_FIRST) & 1));
    }
    if (p.whole >= 0) return p.whole;
  }
  throw new Error("the pass never ended");
}

test("the coarse pass comes first and the weathering rises from it; the whole side after it; then nothing", () => {
  const p = new WeatherPlan();
  expect(p.ask(512)).toBe(true);
  expect(p.ask(512)).toBe(false);
  expect([p.level, p.ready]).toEqual([WEATHER_COARSE, 0]);
  const coarse = new Map<number, number>();
  expect(pass(p, coarse)).toBe(WEATHER_COARSE);
  for (let l = 0; l < MADE_LAYERS; l++) expect(coarse.get(l)).toBe(512 >> WEATHER_COARSE);
  expect(p.level).toBe(0);
  expect(pass(p, new Map())).toBe(0);
  for (let f = 0; f < WEATHER_RISE; f++) expect(p.frame()).toBe(false);
  expect(p.ready).toBe(1);
});

test("a frame draws its share of pixels, which the card's time sizes; a new side begins again, and none stops", () => {
  const p = new WeatherPlan();
  p.ask(1024);
  // A fast card: the whole coarse pass, every layer at 128 by 128, in one frame.
  p.measured(1, 1 << 16, 1);
  p.frame();
  expect([p.drawn, p.whole]).toEqual([MADE_LAYERS * 128 * 128, WEATHER_COARSE]);
  // A slow one: the least share, 8 rows of the whole side.
  p.measured(1e9, 1 << 16, 1);
  p.frame();
  expect([p.drawn, p.at]).toEqual([8 * 1024, 0]);
  expect(p.ask(512)).toBe(true);
  expect([p.level, p.ready]).toEqual([WEATHER_COARSE, 0]);
  expect(p.ask(0)).toBe(true);
  expect(p.frame()).toBe(false);
});
