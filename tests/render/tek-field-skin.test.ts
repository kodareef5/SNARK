import { expect, test } from "bun:test";
import { tekFieldLight } from "../../client/core/render/tek-field.ts";
import { TEK_WALL } from "../../content/building/tek-wall.ts";

function green(x: number, y: number, phase: number, footprint = 0.003): number {
  const light = new Float64Array(3);
  tekFieldLight(light, x, y, 7, 0.8, footprint, phase, 1);
  return light[1]!;
}

const dimmest = (x: number, y: number): number => Math.min(...Array.from({ length: 16 }, (_, i) => green(x, y, i * Math.PI / 8)));

test("light falls off inward and beyond each rail's ends and breaks", () => {
  for (const side of [-1, 1]) {
    const edge = side * (TEK_WALL.panelX - 0.005);
    const beside = dimmest(edge, 0.19);
    expect(beside).toBeGreaterThan(2 * dimmest(edge, 0.35));
    expect(beside).toBeGreaterThan(5 * dimmest(edge, TEK_WALL.railY + 0.17));
    expect(beside).toBeGreaterThan(5 * dimmest(side * 0.97, 0.19));
  }
});

test("passing light resolves recessed facets and distant light averages them", () => {
  const ripple = (phase: number, footprint: number): number => {
    let contrast = 0;
    for (let i = 0; i < 30; i++) {
      const x = 0.13 + i * 0.002;
      contrast = Math.max(contrast, Math.abs(green(x, 0.11, phase, footprint) - green(x, 0.11, phase, 0.035)));
    }
    return contrast;
  };
  const close = ripple(1, 0.003);
  expect(close).toBeGreaterThan(0.1);
  expect(ripple(1, 0.024)).toBeLessThan(close * 0.55);
  expect(ripple(1, 0.034)).toBe(0);
  expect(ripple(4, 0.003)).toBe(0);
});
