// The street's wrecks as content: every look is a wreck with its rungs, and its lesser looks are kinds a row may take.

import { expect, test } from "bun:test";
import { SALVAGED_LOOKS, STREET_LOOKS, WRECK_KINDS, lesserLook, wreckLook } from "../../content/vehicles/wrecks.ts";
import { BREAK_VARIANTS, FORM_BREACH_A, FORM_OPEN, FORM_WHOLE, formKind } from "../../shared/content/breaks.ts";
import { shapeHalf, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
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
  const forms = { stripped: FORM_BREACH_A, shell: FORM_OPEN } as const;
  const lesser = { stripped: 0, shell: 0 };
  for (const look of STREET_LOOKS) {
    const k = reg.index.get(WRECK_KINDS[look.mesh]![0]!)!;
    for (let rung = 0; rung < 3; rung++) expect(rungKind(reg, k, rung)).not.toBe(0);
    for (const form of ["stripped", "shell"] as const) {
      const kind = formKind(reg, k, forms[form], 0);
      // The tanker's salvage is its own content: where it stopped it is drawn stripped, and it has no shell.
      const as = look.body === "tanker" ? (look.mesh === "core:tanker_abandoned" && form === "stripped" ? { mesh: "core:tanker_stripped", shape: "core:shape_tanker_stripped", boxes: STREET_LOOKS.find((l) => l.mesh === "core:tanker_stripped")!.boxes } : undefined)
        : ((to) => to && { mesh: to.look.mesh, shape: to.shape, boxes: to.look.boxes })(lesserLook(look, form));
      expect([look.mesh, form, kind !== 0]).toEqual([look.mesh, form, as !== undefined]);
      if (!as) continue;
      lesser[form]++;
      expect([def(kind).mesh, def(kind).shape, def(kind).half]).toEqual([as.mesh, as.shape, shapeHalf(as.boxes)]);
      expect((reg.defs[reg.index.get(as.shape)!] as ShapeDef).boxes).toEqual(as.boxes);
      // Every paint of the look takes the one kind, cut once for every place.
      for (const id of WRECK_KINDS[look.mesh]!) for (let v = 0; v < BREAK_VARIANTS; v++) expect(formKind(reg, reg.index.get(id)!, forms[form], v)).toBe(kind);
    }
    // Where it stopped it is stripped and then a shell; set down stripped, a shell at once; on its roof or burnt, itself.
    const [stripped, shell] = [formKind(reg, k, FORM_BREACH_A, 0), formKind(reg, k, FORM_OPEN, 0)];
    expect([look.mesh, rungKind(reg, k, 1), rungKind(reg, k, 2)]).toEqual([look.mesh, stripped || shell || k, shell || stripped || k]);
  }
  // Every body is stripped where it stopped, the tanker too. Every body but the tanker has a shell, which the compact,
  // the Concept, the fastback, the caravan and the panel van take from their stripped looks too.
  expect(lesser).toEqual({ stripped: 15, shell: 19 });
});

test("a look only salvage leaves is no kind a map places: it has a shape, and a body's street looks lead to it", () => {
  // The nine bodies the street never set down stripped, and the fourteen shells.
  expect([SALVAGED_LOOKS.filter((l) => l.mesh.endsWith("_stripped")).length, SALVAGED_LOOKS.filter((l) => l.mesh.endsWith("_shell")).length]).toEqual([9, 14]);
  const drawn = new Set(reg.defs.flatMap((d) => (d?.type === "structure" && d.breaks?.family === "wreck" && d.breaks.form !== "whole" && d.mesh ? [d.mesh] : [])));
  for (const look of SALVAGED_LOOKS) {
    expect([look.mesh, look.mesh in WRECK_KINDS, STREET_LOOKS.some((l) => l.mesh === look.mesh), drawn.has(look.mesh)]).toEqual([look.mesh, false, false, true]);
    expect(look.boxes.length).toBeGreaterThan(0);
    // It is as long and as wide as its body where it stopped, within a door's swing, and no taller.
    const whole = shapeHalf(STREET_LOOKS.find((l) => l.mesh === `core:${look.body}_abandoned`)!.boxes), half = shapeHalf(look.boxes);
    expect([look.mesh, half[0] < whole[0] + 0.5, half[1] <= whole[1] + 0.02, Math.abs(half[2] - whole[2]) < 0.6]).toEqual([look.mesh, true, true, true]);
  }
  // No kind but a wreck's form is drawn as one, so none is dyed, placed or counted as a street look.
  for (const d of reg.defs) if (d?.type === "structure" && SALVAGED_LOOKS.some((l) => l.mesh === d.mesh)) expect([d.id, d.id.startsWith("core:zzzzzzzwreck_"), wreckLook(d.id)]).toEqual([d.id, true, undefined]);
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
