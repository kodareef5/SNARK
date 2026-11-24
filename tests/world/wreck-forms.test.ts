// The street's wrecks as content: every look is a wreck with its rungs, and its lesser looks are kinds a row may take.

import { expect, test } from "bun:test";
import { STREET_LOOKS, WRECK_KINDS } from "../../content/vehicles/wrecks.ts";
import { BREAK_VARIANTS, FORM_BREACH_A, FORM_WHOLE, formKind } from "../../shared/content/breaks.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import { WRECK, formOf, rungAt, rungKind, workHealth } from "../../shared/world/breaking.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const def = (kind: number): StructureDef => reg.defs[kind] as StructureDef;

test("every kind a street sets down is a whole wreck with one to three rungs", () => {
  for (const look of STREET_LOOKS) {
    for (const id of WRECK_KINDS[look.mesh]!) {
      const k = reg.index.get(id)!;
      const rungs = reg.salvageYield[k]!.length;
      expect([id, reg.breakFamily[k], formOf(reg, k), rungs >= 1 && rungs <= 3, reg.salvageWork[k]! > 0]).toEqual([id, WRECK, FORM_WHOLE, true, true]);
      // Where it stopped it has all three, and stripped the two left.
      if (look.mesh.endsWith("_abandoned")) expect([id, rungs]).toEqual([id, 3]);
      if (look.mesh.endsWith("_stripped")) expect([id, rungs]).toEqual([id, 2]);
    }
  }
});

test("a rung's kind is always one a row may take, and a lesser look is drawn and walked as the look it is", () => {
  let lesser = 0;
  for (const look of STREET_LOOKS) {
    const k = reg.index.get(WRECK_KINDS[look.mesh]![0]!)!;
    for (let rung = 0; rung < 3; rung++) expect(rungKind(reg, k, rung)).not.toBe(0);
    const stripped = rungKind(reg, k, 1);
    if (stripped === k) continue;
    lesser++;
    const as = STREET_LOOKS.find((l) => l.mesh === (look.body === "tanker" ? "core:tanker_stripped" : `${look.mesh}_stripped`))!;
    const whole = def(reg.index.get(WRECK_KINDS[as.mesh]![0]!)!);
    expect([def(stripped).mesh, def(stripped).shape, def(stripped).half]).toEqual([as.mesh, whole.shape, whole.half]);
    // Every paint of the look takes the one kind, cut once for every place.
    for (const id of WRECK_KINDS[look.mesh]!) for (let v = 0; v < BREAK_VARIANTS; v++) expect(formKind(reg, reg.index.get(id)!, FORM_BREACH_A, v)).toBe(stripped);
  }
  // The compact, the Concept, the fastback, the caravan, the panel van and the tanker have a stripped look.
  expect(lesser).toBe(6);
});

test("a wreck's rung follows its health, and a rung's work is the same share of it whatever its health", () => {
  const car = reg.index.get("core:compact_abandoned_white")!, bus = reg.index.get("core:zzzzroad_bus_abandoned")!;
  expect([8000, 5334, 5333, 2667, 2666, 1, 0].map((hp) => rungAt(reg, car, hp))).toEqual([0, 0, 1, 1, 2, 2, 3]);
  expect([workHealth(reg, car) * 40, workHealth(reg, bus) * 120].map(Math.round)).toEqual([2667, 5333]);
});

test("the lesser looks' ids sort after every id there was", () => {
  const ids = reg.ids.filter((id): id is string => typeof id === "string").sort();
  const first = ids.findIndex((id) => id.startsWith("core:zzzzzzzwreck_"));
  expect([first > 0, ids.slice(first).every((id) => id.startsWith("core:zzzzzzzwreck_"))]).toEqual([true, true]);
});
