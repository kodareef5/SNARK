import { expect, test } from "bun:test";
import { easeFov, EYE_FROM, forcesEye, lookScale, magnification, opticMost, opticZoom, zoomed } from "../../client/core/optics.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";

const DEG = Math.PI / 180;

test("a view zoomed so many times magnifies so many times, from any field of view, as far as 2,000 times", () => {
  for (const base of [50 * DEG, 70 * DEG, 100 * DEG]) {
    for (const z of [1, 1.25, 3, 40, 400, 2000]) expect(magnification(base, zoomed(base, z))).toBeCloseTo(z, 6);
  }
  // 400 times from 70 degrees is about a sixth of a degree.
  expect(zoomed(70 * DEG, 400) / DEG).toBeCloseTo(0.2005, 3);
});

test("the look slows on the tangent of the view's half, so a point on screen moves as far under the mouse at any zoom", () => {
  const base = 70 * DEG;
  expect(lookScale(base, base, 1)).toBe(1);
  expect(lookScale(base, base, 2, 1.5)).toBe(2);
  for (const z of [3, 40, 400]) {
    const fov = zoomed(base, z);
    expect(lookScale(base, fov, 1)).toBeCloseTo(1 / z, 9);
    // Angle alone (the old rule) is too fast once narrow: at 40 times about 1/35.
    if (z === 40) expect(fov / base).toBeGreaterThan(1 / 36);
    // The zoom sensitivity weighs the narrowed part: faster above 1, slower under, and never past it.
    expect(lookScale(base, fov, 1, 1.5)).toBeGreaterThan(1 / z);
    expect(lookScale(base, fov, 1, 1.5)).toBeLessThanOrEqual(1.5 / z);
    expect(lookScale(base, fov, 1, 0.5)).toBeLessThan(1 / z);
  }
  // A view opened past the player's own (a vehicle's speed, a glider) turns faster with it.
  expect(lookScale(base, base + 7 * DEG, 1)).toBeGreaterThan(1);
});

test("a view eases on the logarithm of its tangent: a step to forty times takes as long as its first fortieth", () => {
  const base = 70 * DEG;
  expect(easeFov(base, zoomed(base, 4), 1)).toBe(zoomed(base, 4));
  expect(easeFov(base, base, 0.3)).toBe(base);
  // Halfway in the logarithm from 1x to 4x is 2x, and from 4x to 40x is the square root of 160.
  expect(magnification(base, easeFov(base, zoomed(base, 4), 0.5))).toBeCloseTo(2, 9);
  expect(magnification(base, easeFov(zoomed(base, 4), zoomed(base, 40), 0.5))).toBeCloseTo(Math.sqrt(160), 9);
  // It comes to rest on what it wants.
  let fov = base;
  for (let k = 0; k < 200; k++) fov = easeFov(fov, zoomed(base, 400), 0.2);
  expect(magnification(base, fov)).toBeCloseTo(400, 3);
});

test("a sight that magnifies past one and a half times is looked through from the eye", () => {
  expect([forcesEye(0), forcesEye(1), forcesEye(1.25), forcesEye(EYE_FROM), forcesEye(1.51), forcesEye(3)]).toEqual([false, false, false, false, true, true]);
});

test("an optic magnifies from its least to its most, and the content refuses one under 1x, past 2,000x, or out of order", () => {
  expect([opticZoom({ min: 3 }), opticMost({ min: 3 }), opticMost({ min: 4, max: 40 })]).toEqual([3, 3, 40]);
  const scope = CORE_CONTENT.find((d) => d.id === "core:scope" && d.type === "item") as ItemDef;
  expect(scope.optic).toEqual({ min: 3 });
  const errors = (optic: ItemDef["optic"]): string[] => {
    const rest = CORE_CONTENT.filter((d) => d !== scope);
    return compileContent([...rest, { ...scope, optic } as Def]).errors;
  };
  expect(errors({ min: 4, max: 40, steps: [4, 8, 16, 40] })).toEqual([]);
  expect(errors({ min: 0.5 }).join()).toContain("optic must magnify");
  expect(errors({ min: 4, max: 3 }).join()).toContain("optic must magnify");
  expect(errors({ min: 1, max: 4000 }).join()).toContain("optic must magnify");
  expect(errors({ min: 2, max: 30, steps: [2, 8, 4, 30] }).join()).toContain("optic.steps");
  expect(errors({ min: 2, max: 30, steps: [2, 40] }).join()).toContain("optic.steps");
});
