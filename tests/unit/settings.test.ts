// The catalogue of server settings: sound in itself, and standing where the plan says.

import { expect, test } from "bun:test";
import { CATALOG, catalogCounts, catalogFaults, rowOf } from "../../server/settings/catalog.ts";
import { FEATURES } from "../../server/settings/row.ts";

test("every row of the catalogue is whole: one of each name, a meaning, a default in its range, and a reason for whatever it does not yet do", () => {
  expect(catalogFaults()).toEqual([]);
  const n = catalogCounts();
  expect(n.all).toBeGreaterThan(450);
  expect(n.live + n.todo + n.planned + n.none).toBe(n.all);
  // Every feature that is waited for is waited for by something.
  const waited = new Set(CATALOG.filter((r) => r.status === "planned").map((r) => r.waits));
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
});

test("keys are found whatever their case, and a command-line flag is not the file key of the same letters", () => {
  expect(rowOf("tamingspeedmultiplier")!.name).toBe("TamingSpeedMultiplier");
  expect(rowOf("TAMINGSPEEDMULTIPLIER")!.at).toBe("server");
  expect([rowOf("Port")!.at, rowOf("port", true)!.at]).toEqual(["session", "cli"]);
  expect(rowOf("NoSuchSetting")).toBeUndefined();
  // The reference's defaults and directions, at a few places where they are easy to get wrong.
  expect(rowOf("PerLevelStatsMultiplier_DinoTamed")!.def).toEqual([0.2, 1, 1, 1, 1, 1, 1, 1, 0.17, 1, 1, 1]);
  expect(rowOf("PlayerBaseStatMultipliers")!.def).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0]);
  expect([rowOf("StructurePickupTimeAfterPlacement")!.def, rowOf("StructureDamageRepairCooldown")!.def, rowOf("FastDecayInterval")!.def, rowOf("DinoHarvestingDamageMultiplier")!.def]).toEqual([30, 180, 43200, 3.2]);
  expect([rowOf("EggHatchSpeedMultiplier")!.retime, rowOf("MatingIntervalMultiplier")!.retime, rowOf("ResourcesRespawnPeriodMultiplier")!.retime]).toEqual(["speed", "period", "period"]);
});
