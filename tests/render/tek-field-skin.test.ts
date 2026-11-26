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

function viewed(x: number, y: number, phase: number, facing: number, viewX: number, viewY: number, footprint = 0.003, conductor = 0): number {
  const light = new Float64Array(3);
  tekFieldLight(light, x, y, 7, facing, footprint, phase, 1, 0.5, viewX, viewY, conductor);
  return light[1]!;
}

test("the skin intersects the sight ray above the metal from either side", () => {
  const facing = 0.6, rise = TEK_WALL.fieldZ - TEK_WALL.panelZ;
  const facets = (x: number, y: number, phase: number, vx: number, vy: number): number =>
    viewed(x, y, phase, facing, vx, vy) - viewed(x, y, phase, facing, vx, vy, 0.035);
  for (const vx of [-0.64, 0.64]) {
    const vy = 0.48;
    let displacement = 0;
    for (const phase of [0.7, 1.4, 2.1]) {
      for (let i = 0; i < 12; i++) {
        const x = 0.13 + i * 0.009, y = 0.11, shifted = facets(x, y, phase, vx, vy);
        expect(shifted).toBeCloseTo(facets(x + rise * vx / facing, y + rise * vy / facing, phase, 0, 0), 3);
        displacement = Math.max(displacement, Math.abs(shifted - facets(x, y, phase, 0, 0)));
      }
    }
    expect(displacement).toBeGreaterThan(0.06);
  }
});

test("the projected skin meets the gasket and clips at its chamfer", () => {
  for (const side of [-1, 1]) {
    const x = side * TEK_WALL.panelX;
    expect(viewed(x, 0.23, 1, 0, side, 0)).toBe(viewed(x, 0.23, 1, 0, -side, 0));
    const y = TEK_WALL.panelY - 0.02;
    expect(viewed(x - side * 0.02, y, 1, 0, 0, 1)).toBe(viewed(x - side * 0.02, y, 1, 0, 0, -1));
  }
});

test("the conductor charge stays on the plate when the eye crosses the wall", () => {
  const charge = (phase: number, view: number, footprint = 0.003): number =>
    viewed(0.21, 0.12, phase, 0.6, view, 0, footprint, 1) - viewed(0.21, 0.12, phase, 0.6, view, 0, footprint, 0);
  const cycle = Array.from({ length: 24 }, (_, i) => i * Math.PI / 12);
  const values = cycle.map(phase => charge(phase, 0.8));
  expect(Math.max(...values)).toBeGreaterThan(0.6);
  expect(values.filter(v => v === 0).length).toBeGreaterThan(12);
  for (const phase of cycle) {
    expect(charge(phase, 0.8)).toBeCloseTo(charge(phase, -0.8), 10);
    expect(charge(phase, 0.8, 0.07)).toBe(0);
  }
});
