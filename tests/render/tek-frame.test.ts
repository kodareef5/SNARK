import { expect, test } from "bun:test";
import { TEK_WALL } from "../../content/building/tek-wall.ts";
import { frameSpill, tekFinishNormal, tekFrameSurface, tekIndicator, tekPlateSurface, tekRailLight } from "../../client/core/render/tek-frame.ts";
import { BLOOM_FROM } from "../../client/core/render/post.ts";

test("machined titanium reflects more light than the dark seal", () => {
  function surface(metal: number, roughness: number, height: number) {
    const base = new Float64Array([metal, metal, metal]);
    const orm = new Float64Array([1, roughness, 0]);
    tekFrameSurface(base, orm, base.slice(), height);
    return { light: base[1]!, rough: orm[1]!, metal: orm[2]! };
  }
  const steel = surface(0.3, 0.4, 0.5), seal = surface(0.008, 0.4, 0.5);
  expect(steel.metal).toBeGreaterThan(0.85);
  expect(seal.metal).toBeLessThan(0.2);
  expect(steel.rough).toBeLessThan(seal.rough);
  expect(surface(0.3, 0.5, 0.65).light).toBeGreaterThan(steel.light);
  expect(surface(0.3, 0.5, 0.65).rough).toBeGreaterThan(steel.rough);
});

test("the lens blooms and its reflected light stays near the rail", () => {
  const { railX: x, railY: y } = TEK_WALL;
  const glow = new Float64Array(3), recess = new Float64Array(3);
  tekRailLight(glow, x, 0, true, 1);
  tekRailLight(recess, x + 0.04, 0, false, 1);
  expect(glow[1]!).toBeGreaterThan(BLOOM_FROM);
  expect(recess[1]!).toBeLessThan(BLOOM_FROM);
  expect(frameSpill(x, 0)).toEqual(frameSpill(-x, 0));
  expect(frameSpill(x, y)).toBeGreaterThan(4 * frameSpill(x, y + 0.12));
  expect(frameSpill(x + 0.025, 0)).toBeGreaterThan(4 * frameSpill(x + 0.15, 0));
});

test("rolled titanium turns the reflected sky with each upright on both faces", () => {
  for (const sign of [-1, 1]) {
    const front = new Float64Array([0, 0, sign]), turned = new Float64Array([sign, 0, 0]);
    tekFinishNormal(front, 1.43, 0.2, 1, 0, false, 1);
    tekFinishNormal(turned, 1.43, 0.2, 0, 1, false, 1);
    expect(front[0]!).toBeGreaterThan(0.1);
    expect(turned[2]!).toBeCloseTo(-front[0]!, 8);
    expect(turned[0]!).toBeCloseTo(front[2]!, 8);
    expect(Math.hypot(...turned)).toBeCloseTo(1, 8);
  }
});

test("the plate catches a violet reflection at grazing angles", () => {
  const silver = new Float64Array([0.06, 0.06, 0.06]), edge = silver.slice();
  const orm = new Float64Array([1, 0.35, 0.5]);
  tekPlateSurface(silver, orm.slice(), 0.5, 1, 0);
  tekPlateSurface(edge, orm.slice(), 0.5, 0.12, 0.8);
  expect(edge[0]! - silver[0]!).toBeGreaterThan(0.12);
  expect(edge[1]).toBe(silver[1]);
  expect(edge[2]! - silver[2]!).toBeGreaterThan(0.12);
});

test("structural indicator lenses keep the same cyan across a wide panel", () => {
  const middle = new Float64Array(3), side = new Float64Array(3);
  tekRailLight(middle, .2, 0, true, 1, tekIndicator(0, 0, 0));
  tekRailLight(side, 1.4, 0, true, 1, tekIndicator(2 * Math.PI, 0, 0));
  expect(middle).toEqual(side);
  expect(tekIndicator(Math.PI, 0, 0)).toBeGreaterThan(tekIndicator(0, 0, 0));
  expect(tekIndicator(Math.PI, 0, 8)).toBe(tekIndicator(0, 0, 0));
  expect(middle[1]!).toBeGreaterThan(middle[0]! * 2);
});
