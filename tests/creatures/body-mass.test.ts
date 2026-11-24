// What a body weighs (shared/sim/body-mass.ts): its species' mass, or by its volume against a survivor's build, and
// which bodies that makes stop which (shared/sim/blockers.ts).
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { bodyMass } from "../../shared/sim/body-mass.ts";
import { Blockers } from "../../shared/sim/blockers.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const kind = (id: string): number => reg.index.get(id)!;

test("a body with no mass of its own weighs a survivor's 80 kg at a survivor's build", () => {
  expect(reg.mass[kind("core:survivor")]).toBe(0);
  expect(bodyMass(reg, kind("core:survivor"))).toBeCloseTo(80, 4);
  expect(bodyMass(reg, kind("core:dummy"))).toBeCloseTo(80, 4);
  expect(bodyMass(reg, kind("core:civilian"))).toBe(80);
  expect(bodyMass(reg, kind("core:rex"))).toBe(8300);
});

test("without a mass, a body weighs by its volume, and a young one by the cube of its scale", () => {
  const dodo = kind("core:dodo"), mass = reg.mass[dodo]!;
  try {
    reg.mass[dodo] = 0;
    const r = reg.bodyRadius[dodo]!, h = reg.bodyHeight[dodo]!;
    expect(bodyMass(reg, dodo)).toBeCloseTo(80 * (r / 0.4) * (r / 0.4) * (h / 1.8), 9);
  } finally {
    reg.mass[dodo] = mass;
  }
  expect(bodyMass(reg, kind("core:rex"), 0.5)).toBe(8300 / 8);
});

test("a survivor is stopped by a civilian, while survivor and civilian alike walk through a dodo", () => {
  const met = (walker: string, body: string): boolean => {
    const bl = new Blockers();
    bl.add(reg, 1, kind(body), 2, 0, 0, 0, false, kind(walker), 0, 0, 0, 0);
    return bl.count === 1;
  };
  expect(met("core:survivor", "core:civilian")).toBe(true);
  expect(met("core:civilian", "core:survivor")).toBe(true);
  expect(met("core:survivor", "core:dodo")).toBe(false);
  expect(met("core:civilian", "core:dodo")).toBe(false);
  expect(met("core:dodo", "core:survivor")).toBe(true);
  expect(met("core:raptor", "core:survivor")).toBe(false);
});
