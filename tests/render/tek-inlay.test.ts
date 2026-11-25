import { expect, test } from "bun:test";
import { tekCasting, tekGlass, tekInlayLight } from "../../client/core/render/tek-inlay.ts";
import { TEK_INLAY_COLOUR } from "../../content/building/tek-wall.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { tekTrims } from "../../tools/pack/pieces/tek-trims.ts";

test("the armor takes dye and soft sky while machined edges catch the horizon", () => {
  function cast(paint: number[], fixed: boolean) {
    const base = new Float64Array([.03, .045, .07]), orm = new Float64Array([1, .4, .2]);
    const mirror = tekCasting(base, orm, new Float64Array(paint), .5, fixed);
    return { base, orm, mirror };
  }
  const armor = cast([.35, .055, .04], false), land = cast([.36, .39, .42], true);
  const seal = cast([.007, .008, .01], true), copper = cast([.54, .18, .08], true);
  expect(armor.mirror).toBe(false);
  expect(armor.base[0]!).toBeGreaterThan(armor.base[2]! * 3);
  expect(land.mirror).toBe(true);
  expect(land.orm[1]!).toBeLessThan(armor.orm[1]!);
  expect(seal.orm[1]!).toBeGreaterThan(.65);
  expect(seal.orm[2]!).toBeLessThan(.15);
  expect(copper.base[0]!).toBeGreaterThan(2 * copper.base[1]!);
});

type Vec = [number, number, number];

function glow(p: Vec, n: Vec, phase = 0, footprint = .003, exposure = 1): Float64Array {
  const light = new Float64Array(3);
  tekInlayLight(light, ...p, ...n, ...n, phase, 0, footprint, exposure);
  return light;
}

test("the optical insert shows the same moving crest on a floor, jamb or leaf", () => {
  const u = .21, v = .36;
  const wall = glow([u, v, 9], [0, 0, 1]);
  expect(glow([u, -9, v], [0, 1, 0])).toEqual(wall);
  expect(glow([-9, v, u], [-1, 0, 0])).toEqual(wall);
  expect(glow([u, 9, v], [0, -1, 0])).toEqual(wall);
  const p: Vec = [0, 0, 0], normal: Vec = [0, 0, 1];
  expect(glow(p, normal, Math.PI / 2)[1]!).toBeGreaterThan(5 * glow(p, normal)[1]!);
  expect(glow(p, normal, 2 * Math.PI)[1]).toBeCloseTo(glow(p, normal)[1]!, 8);
  expect(glow(p, normal, 0, .003, 2)[1]! * 2).toBeCloseTo(glow(p, normal)[1]!, 8);
});

test("a narrow blue echo follows the pale optical crest", () => {
  const p: Vec = [0, 0, 0], n: Vec = [0, 0, 1];
  const lead = glow(p, n, Math.PI * .5);
  const echo = glow(p, n, Math.PI * .428);
  const gap = glow(p, n, Math.PI * .45);
  expect(lead[0]!).toBeGreaterThan(gap[0]! + .20);
  expect(echo[2]!).toBeGreaterThan(gap[2]! + .10);
  expect(echo[0]!).toBeLessThan(lead[0]! / 2);
});

test("the enamel stays dark and the fine etched lines fade with distance", () => {
  const base = new Float64Array(3), orm = new Float64Array([1, 1, 0]);
  tekGlass(base, orm, .6);
  expect(base[2]!).toBeLessThan(.10);
  expect(base[2]!).toBeGreaterThan(2 * base[0]!);
  const p: Vec = [.375, .06 / 5.5, 0], n: Vec = [0, 0, 1];
  expect(glow(p, n)[2]!).toBeGreaterThan(glow(p, n, 0, .1)[2]! + .05);
  const flat = defaultPalette().slice(TEK_INLAY_COLOUR * 4, TEK_INLAY_COLOUR * 4 + 3);
  expect(flat[1]!).toBeGreaterThan(3 * flat[0]!);
});

test("the fascia, footing and ridge keep optical strips inside the folded metal", () => {
  const trims = tekTrims();
  for (const name of ["skirt", "eave", "ridge"]) {
    const near = trims[name]![0]!.faces;
    const optics = near.filter(f => f.mat === "membrane");
    expect(optics.length).toBeGreaterThan(0);
    expect(near.some(f => f.mat === "chamfer" || f.mat === "bevel")).toBe(true);
    for (const f of optics) {
      const extent = f.points.map(p => p[2]);
      expect(Math.max(...extent) - Math.min(...extent)).toBeLessThan(.16);
    }
    expect(trims[name]!.at(-1)!.faces.some(f => f.mat === "membrane")).toBe(false);
  }
});
