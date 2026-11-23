// The family table and the kit's components (content/breaks): which shapes break, by which ladder, and what still bears.

import { expect, test } from "bun:test";
import { BREAKING_SHAPES, FAMILY_RULES, familyOf, formBears, shapeBreaks } from "../../content/breaks/families.ts";
import { KIT, kitOf } from "../../content/breaks/kit.ts";
import { RUIN_BREAKS, RUIN_SHAPES, RUIN_SLOPES } from "../../content/ruins.ts";

const names = (shape: string): string[] => kitOf(shape)!.forms(0).map((f) => f.name);

test("every shape with a family has forms, and each ends in its heap", () => {
  expect(KIT.map((k) => k.name)).toEqual([...BREAKING_SHAPES]);
  for (const k of KIT) {
    expect(k.name in RUIN_SHAPES).toBe(true);
    expect(k.family).toBe(familyOf(k.name));
    const forms = names(k.name);
    expect([k.name, forms[0], forms[forms.length - 1]]).toEqual([k.name, "whole", "heap"]);
    expect(forms.includes("open")).toBe(true);
  }
});

test("stairs, ramps, roads, the street, plants, pipes and the hand-made breaks never break", () => {
  const never = ["flight", "landing", "step", "zcore", "zdeckramp", "zpipe4", "zpipefoot", "zpipetop", "zshrub", "zrooftree", "zivy1", ...Object.keys(RUIN_BREAKS), ...Object.keys(RUIN_SLOPES).filter((n) => !n.startsWith("zpitch"))];
  for (const name of never) expect([name, familyOf(name)]).toEqual([name, "none"]);
});

test("a family's ladder is as long as the plan gives it", () => {
  expect(names("floor8")).toEqual(["whole", "breach A", "breach B", "open", "hung", "heap"]);
  expect(names("pier4")).toEqual(["whole", "breach A", "breach B", "open", "hung", "heap"]);
  expect(names("zpanel16")).toEqual(["whole", "breach A", "breach B", "open", "hung", "heap"]);
  expect(names("wall8")).toEqual(["whole", "breach A", "breach B", "open", "heap"]);
  // A piece of one half has one breach.
  expect(names("wall4")).toEqual(["whole", "breach A", "open", "heap"]);
  for (const bar of ["beam8", "zheader", "sill4", "fin16", "trim8", "zgate", "zentry", "zpartition", "zcover", "zbed"]) expect([bar, names(bar)]).toEqual([bar, ["whole", "open", "heap"]]);
});

test("a piece has a breach to each half, or none", () => {
  for (const k of KIT) {
    const { halves } = shapeBreaks(k.name, RUIN_SHAPES[k.name as keyof typeof RUIN_SHAPES]);
    const breaches = names(k.name).filter((n) => n.startsWith("breach")).length;
    expect([k.name, breaches === 0 || breaches === halves]).toEqual([k.name, true]);
  }
});

test("each form bears as its family's row says", () => {
  for (const k of KIT) for (const f of k.forms(0)) expect([k.name, f.name, f.bears]).toEqual([k.name, f.name, formBears(k.family, f.name)]);
});

test("toughness is the plan's: pier 3, beam 2, slab and bearing wall 1.5, parapet 0.5", () => {
  expect(["pier", "beam", "slab", "wall", "panel", "window", "parapet"].map((f) => FAMILY_RULES[f as keyof typeof FAMILY_RULES].tough)).toEqual([3, 2, 1.5, 1.5, 1, 1, 0.5]);
  expect(shapeBreaks("wall8", RUIN_SHAPES.wall8)).toEqual({ family: "wall", halves: 2, tough: 1.5, bears: [true, true, false] });
  expect(shapeBreaks("pier4", RUIN_SHAPES.pier4).halves).toBe(2);
  expect(shapeBreaks("wall4", RUIN_SHAPES.wall4).halves).toBe(1);
});

test("a sibling's forms are its own size, not the sample's", () => {
  const reach = (shape: string, axis: number): number => Math.max(...kitOf(shape)!.forms(0).filter((f) => f.name === "open").flatMap((f) => f.look.boxes.map((b) => Math.abs(b.at[axis]!) + b.half[axis]!)));
  expect(reach("pier16", 1)).toBeLessThan(8);
  expect(reach("zpanel16", 0)).toBeCloseTo(8, 2);
  expect(reach("beam4", 0)).toBeCloseTo(2, 2);
});
