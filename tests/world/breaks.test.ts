// Break sets cut from the city kit's shapes (content/breaks): what every form must hold to before it is content.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boxVolume, formFaults, leftVolume, lookVolume } from "../../content/breaks/check.ts";
import { VARIANTS, wallBreach } from "../../content/breaks/forms.ts";
import { area, rectPoly } from "../../content/breaks/geometry.ts";
import { plan, profilePlan } from "../../content/breaks/plan.ts";
import { SAMPLES } from "../../content/breaks/samples.ts";

const RUST = 179;
const sample = (name: string) => SAMPLES.find((c) => c.name === name)!;
const variants = Array.from({ length: VARIANTS }, (_, v) => v);

describe("a cut plan", () => {
  test("teeth and shards fill the window with nothing over", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const o = wallBreach([-4, 0, 0, 2.8]);
      const p = plan({ ...o, seed });
      const filled = [...p.teeth, ...p.shards].reduce((s, cell) => s + area(cell), 0);
      expect(filled).toBeCloseTo(area(rectPoly(o.window)), 3);
    }
  });

  test("the mouth is never inside the opening that is passable", () => {
    const o = wallBreach([-4, 0, 0, 2.8]);
    const [u0, u1, v0, v1] = o.passable[0]!;
    for (const seed of [1, 2, 3, 4, 5]) for (const [u, v] of plan({ ...o, seed }).mouth) expect(u <= u0 + 1e-6 || u >= u1 - 1e-6 || v >= v1 - 1e-6 || v <= v0 + 1e-6).toBe(true);
  });

  test("no tooth stands more than the art allows past the opening", () => {
    const o = wallBreach([-4, 0, 0, 2.8]);
    const [u0, u1, , v1] = o.passable[0]!;
    for (const seed of [1, 2, 3, 4, 5]) for (const [u, v] of plan({ ...o, seed }).mouth) expect(Math.max(u0 - u, u - u1, v - v1)).toBeLessThanOrEqual(0.32 + 0.05);
  });

  test("a wall broken down to a line is filled by what stands under it and the bands over it", () => {
    const window = [-4, 4, 0, 2.8] as const;
    const p = profilePlan({ window, seed: 7, profile: [[-4, 2.5], [-3.6, 2], [-3.6, 0.6], [-1.5, 0.4], [-1.5, 0], [1.5, 0], [1.5, 0.5], [3.6, 0.6], [3.6, 2.2], [4, 2.6]] });
    expect([...p.teeth, ...p.shards].reduce((s, cell) => s + area(cell), 0)).toBeCloseTo(area(rectPoly(window)), 3);
  });
});

describe("the sample components", () => {
  test("every form of every component could be written as a shape", () => {
    for (const c of SAMPLES) for (const v of variants) for (const f of c.forms(v)) expect({ form: `${c.name} ${f.name} ${v}`, faults: formFaults(f) }).toEqual({ form: `${c.name} ${f.name} ${v}`, faults: [] });
  });

  test("a form is solid the same way in every variant", () => {
    for (const c of SAMPLES) {
      const first = c.forms(0);
      for (const v of variants) c.forms(v).forEach((f, i) => expect(f.walked).toEqual(first[i]!.walked));
    }
  });

  test("a variant is cut the same way twice", () => {
    for (const c of SAMPLES) expect(c.forms(2)).toEqual(c.forms(2));
  });

  test("two variants of a breach are not drawn alike", () => {
    for (const name of ["floor8", "wall8", "zpanel8", "zwin"]) expect(sample(name).forms(0)[1]!.look).not.toEqual(sample(name).forms(1)[1]!.look);
  });

  test("what stands and what leaves fill a plain piece exactly, bars apart", () => {
    for (const name of ["floor8", "wall8", "zpanel8", "zparapet8"]) {
      const c = sample(name), whole = c.skin.reduce((s, b) => s + boxVolume(b), 0);
      for (const v of variants) for (const f of c.forms(v).filter((f) => f.name.startsWith("breach") || f.name === "open")) {
        const stands = lookVolume({ boxes: f.look.boxes.filter((b) => b.color !== RUST), chunks: f.look.chunks });
        expect(Math.abs(stands + leftVolume(f) - whole) / whole).toBeLessThan(0.02);
      }
    }
  });

  test("a breached half leaves the other half's glass in place", () => {
    const [whole, a] = sample("zwin").forms(0);
    expect(whole!.panes.length).toBe(0);
    expect(a!.panes.length).toBe(1);
    expect(a!.panes[0]!.at[0]).toBeLessThan(0);
  });

  test("every number of every form is on the 1/4096 m grid", () => {
    const off = (v: number): boolean => v * 4096 !== Math.round(v * 4096);
    for (const c of SAMPLES) for (const v of variants) for (const f of c.forms(v)) {
      const boxes = [...f.look.boxes, ...f.walked.boxes, ...f.panes].flatMap((b) => [...b.at, ...b.half]);
      const corners = [...f.look.chunks, ...f.fragments.flat(), ...f.walked.hulls].flatMap((h) => h.corners.flat());
      expect([c.name, f.name, v, [...boxes, ...corners].filter(off)]).toEqual([c.name, f.name, v, []]);
    }
  });

  test("a hollow shell opened is still solid", () => {
    const forms = sample("zshaft16").forms(0);
    for (const f of forms) expect(f.walked).toEqual(forms[0]!.walked);
  });
});

test("nothing that makes a form uses arithmetic an engine may round its own way", () => {
  const dir = join(import.meta.dir, "../../content/breaks");
  const inexact = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*(?!\/)|\bDate\.now\b/;
  for (const file of readdirSync(dir)) {
    const code = readFileSync(join(dir, file), "utf8").split("\n").filter((line) => !/^\s*(\/\/|\/\*\*|\*)/.test(line));
    expect([file, code.filter((line) => inexact.test(line))]).toEqual([file, []]);
  }
});
