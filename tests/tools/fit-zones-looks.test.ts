// The zone audit's looks mode (tools/fit-zones.ts --looks): which looks it draws, and how a table of zone drawn
// against zone hit comes to the shares render-aim.test.ts holds a body to.

import { expect, test } from "bun:test";
import { HUMAN_ZONE_COUNT, ZONE_HEAD } from "../../shared/anim/human.ts";
import { LOOK_SEX, REGION_COUNT, defaultLook, regionOf, validLook } from "../../shared/anim/look.ts";
import { AIM_GATES, auditLooks, sharesOf, worstFirst, type Agreement } from "../../tools/fit-zones.ts";

test("the audit draws both sexes, every slider at each end, all at once, and 20 random", () => {
  const looks = auditLooks();
  const each = 1 + REGION_COUNT * 2 + 2 + 20;
  expect(looks.length).toBe(2 * each);
  expect(new Set(looks.map((l) => l.label)).size).toBe(looks.length);
  for (const { look } of looks) expect(validLook(look)).toBe(true);
  expect(looks.filter((l) => l.look[LOOK_SEX] === 1).length).toBe(each);
  const male = looks.slice(0, each);
  expect([...male[0]!.look]).toEqual([...defaultLook()]);
  for (let r = 0; r < REGION_COUNT; r++) {
    expect(regionOf(male[1 + r * 2]!.look, r)).toBe(-1);
    expect(regionOf(male[2 + r * 2]!.look, r)).toBe(1);
  }
  const all = male.find((l) => l.label.endsWith("every slider +1"))!;
  for (let r = 0; r < REGION_COUNT; r++) expect(regionOf(all.look, r)).toBe(1);
});

/** A table where each zone has `n` pixels drawn, `hit` of them found in it and the rest found in none. */
function agreement(n: number, hit: number, phantom: number, headHit = hit): Agreement {
  const table = Array.from({ length: HUMAN_ZONE_COUNT }, () => new Uint32Array(HUMAN_ZONE_COUNT));
  for (let z = 1; z < HUMAN_ZONE_COUNT; z++) {
    const h = z === ZONE_HEAD ? headHit : hit;
    table[z]![z] = h;
    table[z]![0] = n - h;
  }
  return { label: "test", table, phantom };
}

test("a table's shares and the gates it misses", () => {
  const zones = HUMAN_ZONE_COUNT - 1;
  const good = sharesOf(agreement(1000, 995, 100));
  expect(good.body).toBe(1000 * zones);
  expect(good.same).toBeCloseTo(0.995, 9);
  expect(good.missed).toBeCloseTo(0.005, 9);
  expect(good.phantom).toBeCloseTo(100 / (1000 * zones), 9);
  expect(good.misses).toEqual([]);
  const bad = sharesOf(agreement(100, 70, 600, 90));
  expect(bad.head).toBeCloseTo(0.9, 9);
  expect(bad.worst).toBeCloseTo(0.7, 9);
  expect(bad.misses).toEqual(["head", "same", "missed", "phantom", "zone", "zone seen"]);
  expect(AIM_GATES.head).toBe(0.965);
});

test("the worst look comes first: most gates missed, then the least head", () => {
  const a = { ...sharesOf(agreement(1000, 995, 100)), label: "a" };
  const b = { ...sharesOf(agreement(1000, 995, 100, 960)), label: "b" };
  const c = { ...sharesOf(agreement(100, 70, 600)), label: "c" };
  expect(worstFirst([a, b, c]).map((s) => s.label)).toEqual(["c", "b", "a"]);
});
