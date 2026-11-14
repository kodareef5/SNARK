import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { Genome, HIGHER_STAT_CHANCE, MUTATION_LIMIT, POINT_CAP, STAT_COUNT, STAT_NAMES, WILD_STATS, breed, rollWild, spendPoint, statValue } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS, MICRO, lazyValue, lazyZeroTick, ratePerTick } from "../../shared/sim/lazy.ts";
import { DeadlineHeap } from "../../shared/sim/schedule.ts";

test("deadlines run in tick order, ties in scheduling order, and may schedule more for the same tick", () => {
  const heap = new DeadlineHeap(2);
  const rng = new Rng(4);
  const expected: [number, number][] = [];
  for (let i = 0; i < 500; i++) {
    const tick = rng.int(50);
    heap.push(tick, 1, i, 0);
    expected.push([tick, i]);
  }
  expected.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const got: [number, number][] = [];
  expect(heap.run(24, (_k, a, _b, tick) => got.push([tick, a]))).toBe(expected.filter((e) => e[0] <= 24).length);
  expect(heap.nextTick).toBeGreaterThan(24);
  heap.run(1000, (_k, a, _b, tick) => got.push([tick, a]));
  expect(got).toEqual(expected);
  expect(heap.size).toBe(0);

  // Follow-ups a handler schedules for the same tick run in the same call. The limit argument bounds a storm.
  let chain = 0;
  heap.push(5, 2, 0, 0);
  const ran = heap.run(5, () => {
    if (++chain < 10) heap.push(5, 2, 0, 0);
  });
  expect(ran).toBe(10);
  for (let i = 0; i < 50; i++) heap.push(1, 3, 0, 0);
  expect(heap.run(1, () => {}, 20)).toBe(20);
  expect(heap.size).toBe(30);
});

test("a lazy quantity read once equals the same quantity stepped every tick", () => {
  const rate = -ratePerTick(12); // 12 points per in-game hour
  const max = 400 * MICRO;
  let stepped = max;
  for (let t = 1; t <= 3 * GAME_HOUR_TICKS; t++) stepped = Math.max(0, stepped + rate);
  expect(lazyValue(max, 0, rate, max, 3 * GAME_HOUR_TICKS)).toBe(stepped);
  expect(stepped / MICRO).toBeCloseTo(400 - 36, 2);
  const zero = lazyZeroTick(max, 100, rate);
  expect(lazyValue(max, 100, rate, max, zero)).toBe(0);
  expect(lazyValue(max, 100, rate, max, zero - 1)).toBeGreaterThan(0);
  expect(lazyZeroTick(max, 0, 0)).toBe(Infinity);
});

test("stat values follow the species curve and points stop at 255", () => {
  const g = new Genome();
  g.wild[0] = 20;
  g.mutated[0] = 4;
  g.tamed[0] = 10;
  expect(statValue([100, 0.2, 0.05], g, 0)).toBeCloseTo(100 * (1 + 24 * 0.2) * (1 + 10 * 0.05), 9);
  expect(g.level).toBe(35);
  g.tamed[7] = 254;
  expect(spendPoint(g, 7)).toBe(true);
  expect(spendPoint(g, 7)).toBe(false);
  expect(g.tamed[7]).toBe(POINT_CAP);

  const wild = rollWild(new Rng(1), 150, [5, 6, 7]);
  expect(wild.level).toBe(150);
  expect(STAT_NAMES.length).toBe(STAT_COUNT);
  for (let s = 0; s < STAT_COUNT; s++) if (!WILD_STATS.includes(s)) expect(wild.wild[s]).toBe(0);
  for (const c of wild.colors) expect([5, 6, 7]).toContain(c);
});

test("breeding favours the higher stat, mutates rarely, and tracks mutation counters by lineage", () => {
  const rng = new Rng(99);
  const mother = rollWild(rng, 120, [5]);
  const father = rollWild(rng, 120, [6]);
  mother.wild[0] = 50;
  father.wild[0] = 30;
  mother.mutMat = 3;
  father.mutPat = 4;
  father.tamed[0] = 80;
  const N = 20000;
  let higher = 0;
  let mutants = 0;
  let viaMother = 0;
  for (let i = 0; i < N; i++) {
    const c = breed(mother, father, 11, 22, rng, [200, 201]);
    expect(c.mother).toBe(11);
    expect(c.father).toBe(22);
    expect(c.tamed[0]).toBe(0); // spent points are not inherited
    if (c.wild[0] === 50) higher++;
    else expect(c.wild[0]).toBe(30);
    const added = c.mutMat + c.mutPat - 7;
    let points = 0;
    for (let s = 0; s < STAT_COUNT; s++) points += c.mutated[s]!;
    expect(points).toBe(added * 2);
    if (added > 0) {
      mutants++;
      if (c.mutMat > 3) viaMother++;
      expect([...c.colors].some((x) => x === 200 || x === 201)).toBe(true);
    } else for (const x of c.colors) expect([5, 6]).toContain(x);
  }
  expect(higher / N).toBeGreaterThan(HIGHER_STAT_CHANCE - 0.015);
  expect(higher / N).toBeLessThan(HIGHER_STAT_CHANCE + 0.015);
  // Three rolls at 2.5% give 7.3% of offspring at least one new mutation, split between the two lines.
  expect(mutants / N).toBeGreaterThan(0.06);
  expect(mutants / N).toBeLessThan(0.086);
  expect(viaMother / mutants).toBeGreaterThan(0.42);
  expect(viaMother / mutants).toBeLessThan(0.58);

  // A parent at the mutation limit passes on its count but is never the source of a new mutation.
  mother.mutMat = MUTATION_LIMIT;
  father.mutPat = MUTATION_LIMIT;
  for (let i = 0; i < 3000; i++) {
    const c = breed(mother, father, 11, 22, rng, [200]);
    expect(c.mutMat + c.mutPat).toBe(mother.mutMat + mother.mutPat + father.mutMat + father.mutPat);
  }
  // A stat already at the cap cannot overflow.
  mother.mutMat = father.mutPat = 0;
  for (const s of WILD_STATS) mother.wild[s] = father.wild[s] = 254;
  for (let i = 0; i < 3000; i++) {
    const c = breed(mother, father, 11, 22, rng, [200]);
    for (const s of WILD_STATS) expect(c.wild[s]! + c.mutated[s]!).toBeLessThanOrEqual(POINT_CAP);
  }
});

test("a mutation comes from the parent stronger in that stat a little more than half the time, and from either when they are level", () => {
  const rng = new Rng(7);
  const mother = rollWild(rng, 1, [5]);
  const father = rollWild(rng, 1, [6]);
  // The mother is stronger in every stat a mutation can land on.
  for (const s of WILD_STATS) {
    mother.wild[s] = 40;
    father.wild[s] = 20;
  }
  const N = 60000;
  const count = (): [number, number] => {
    let viaMother = 0;
    let viaFather = 0;
    for (let i = 0; i < N; i++) {
      const c = breed(mother, father, 11, 22, rng, [200]);
      viaMother += c.mutMat;
      viaFather += c.mutPat;
    }
    return [viaMother, viaFather];
  };
  let [m, f] = count();
  // Three rolls of 2.5% each.
  expect((m + f) / N).toBeGreaterThan(0.07);
  expect((m + f) / N).toBeLessThan(0.08);
  expect(m / (m + f)).toBeGreaterThan(HIGHER_STAT_CHANCE - 0.03);
  expect(m / (m + f)).toBeLessThan(HIGHER_STAT_CHANCE + 0.03);
  for (const s of WILD_STATS) father.wild[s] = 60;
  [m, f] = count();
  expect(f / (m + f)).toBeGreaterThan(HIGHER_STAT_CHANCE - 0.03);
  expect(f / (m + f)).toBeLessThan(HIGHER_STAT_CHANCE + 0.03);
  for (const s of WILD_STATS) father.wild[s] = 40;
  [m, f] = count();
  expect(m / (m + f)).toBeGreaterThan(0.47);
  expect(m / (m + f)).toBeLessThan(0.53);
});
