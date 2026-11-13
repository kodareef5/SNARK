// Taming as arithmetic, at the reference's numbers.

import { expect, test } from "bun:test";
import { bonusLevels, effectiveness, harmCost, narcoticsNeeded, pieceCost, piecesNeeded, tameNeeded, tameSeconds, type TameParams } from "../../shared/sim/taming.ts";

const RAPTOR: TameParams = { a0: 1200, a1: 60, foodBase: 0.001543, proneMult: 648.09, k: 3.125 };
const PARASAUR: TameParams = { a0: 1500, a1: 75, foodBase: 0.001929, proneMult: 864.01, k: 0.4 };
const REX: TameParams = { a0: 3450, a1: 150, foodBase: 0.002314, proneMult: 180.06, k: 1.25 };
// Food value and affinity of a piece.
const RAW = { food: 50, affinity: 50 };
const PRIME = { food: 50, affinity: 150 };
const BERRY = { food: 20, affinity: 20 };

/** What a whole tame on one food comes to: pieces, seconds, effectiveness to a tenth of a percent, bonus levels. */
function tame(p: TameParams, level: number, food: { food: number; affinity: number }, speed = 1): [number, number, number, number] {
  const pieces = piecesNeeded(p, level, food.affinity, speed);
  const te = effectiveness(p, pieces * pieceCost(food.affinity, speed));
  return [pieces, tameSeconds(p, pieces, food.food), Math.round(te * 1000) / 10, bonusLevels(level, te)];
}

test("the reference's table: pieces, time, effectiveness and bonus levels for a raptor and a rex, on raw meat and on prime", () => {
  // Raptor, level 30, raw meat: 15 pieces, 750 seconds, 81.0%, +12.
  expect(tameNeeded(RAPTOR, 30)).toBe(3000);
  expect(tame(RAPTOR, 30, RAW)).toEqual([15, 750, 81, 12]);
  // Rex, level 150, raw meat: 130 pieces, 15,600 seconds, 55.2%, +41. On prime: 44 pieces, 91.6%, +68.
  expect(tame(REX, 150, RAW)).toEqual([130, 15600, 55.2, 41]);
  const prime = tame(REX, 150, PRIME);
  expect([prime[0], prime[2], prime[3]]).toEqual([44, 91.6, 68]);
  // A parasaur, level 1, on berries: its own numbers, and a herbivore loses little for the many pieces it eats.
  expect(tame(PARASAUR, 1, BERRY)).toEqual([20, 240, 90.9, 0]);
  // Faster taming is fewer pieces, each worth more, at a better effectiveness.
  expect(tame(RAPTOR, 30, RAW, 5)).toEqual([3, 150, 99.1, 14]);
});

test("the narcotics a long tame takes: what it shakes off over the time, less what it holds, each narcotic also stopping the loss while it acts", () => {
  // A rex of level 150: 1550 * (1 + 0.06 * 149) at its most, shaking off 0.725 + 149^0.8004 / (22.3967 / 0.725) a second.
  const most = 1550 * (1 + 0.06 * 149);
  const drain = 0.725 + Math.pow(149, 0.800403041) / (22.39671632 / 0.725);
  expect(most).toBeCloseTo(15407, 0);
  expect(drain).toBeCloseTo(2.501, 2);
  expect(narcoticsNeeded(most, drain, 15600, 40, 8)).toBe(394);
  // A raptor of level 30 on raw meat is down 750 seconds: it holds 493 and loses half a point a second, so it needs none.
  // Kept under twice as long, it would need six.
  const rmost = 180 * (1 + 0.06 * 29);
  const rdrain = 0.3 + Math.pow(29, 0.800403041) / (22.39671632 / 0.3);
  expect(rdrain).toBeCloseTo(0.498, 3);
  expect(narcoticsNeeded(rmost, rdrain, 750, 40, 8)).toBe(0);
  expect(narcoticsNeeded(rmost, rdrain, 1500, 40, 8)).toBe(6);
});

test("harm while it lies there costs effectiveness in proportion to the health it takes, and that is not got back", () => {
  let sum = 5 * pieceCost(RAW.affinity, 1);
  const before = effectiveness(RAPTOR, sum);
  // A tenth of its health: a tenth of its effectiveness.
  sum += harmCost(RAPTOR, sum, 0.1);
  expect(effectiveness(RAPTOR, sum)).toBeCloseTo(before * 0.9, 9);
  // More pieces only lower it further.
  sum += pieceCost(RAW.affinity, 1);
  expect(effectiveness(RAPTOR, sum)).toBeLessThan(before * 0.9);
  expect(harmCost(RAPTOR, sum, 0)).toBe(0);
  // All of its health: nothing left of it.
  expect(effectiveness(RAPTOR, sum + harmCost(RAPTOR, sum, 1))).toBeLessThan(1e-6);
});
