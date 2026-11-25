import { expect, test } from "bun:test";
import { TEK_WALL } from "../../content/building/tek-wall.ts";
import { frameSpill, tekFrameSurface, tekRailLight } from "../../client/core/render/tek-frame.ts";
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
