// The item program's contracts (planning/reference/items-plan.md): the numbers it reserved, and the shapes later tasks
// build on. A task that builds one of these moves its pin here in the same change.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { ITEMS } from "../../content/items/index.ts";
import { CLASSES, FIELDS, defFaults } from "../../shared/content/classes.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { MANIFEST_VERSION } from "../../shared/pack/manifest.ts";
import * as P from "../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, QUALITY_COST, QUALITY_CRAFT_XP, QUALITY_NAMES, QUALITY_RATING } from "../../shared/sim/items.ts";

test("task E built quality and blueprints: the flag is the wire's bit, slots save as component 22 (record format 7), ARK's tier table, and loot is rolled", async () => {
  expect(FLAG_BLUEPRINT).toBe(P.SLOT_BLUEPRINT);
  const store = await Bun.file(new URL("../../server/persist/codec.ts", import.meta.url)).text();
  // The flyers' contracts raised the format to 6 for the flying bit (tests/unit/contracts.test.ts), the stations wave's to 7 for
  // a fire's piece and lanes and a paused job's rest (tests/unit/stations-contracts.test.ts).
  expect([/const COMP_SLOTS3 = (\d+);/.exec(store)?.[1], /const RECORD_FORMAT = (\d+);/.exec(store)?.[1]]).toEqual(["22", "7"]);
  expect(QUALITY_NAMES).toEqual(["primitive", "ramshackle", "apprentice", "journeyman", "mastercraft", "ascendant"]);
  expect([QUALITY_RATING, QUALITY_CRAFT_XP, QUALITY_COST]).toEqual([[1, 1.25, 2.5, 4.5, 7, 10], [1, 2, 3, 4, 5, 6], [1, 1.33, 1.67, 2, 2.5, 3.5]]);
  expect(CLASSES.find((r) => r.id === "loot")).toMatchObject({ status: "partial", waits: "loot" });
  expect(FIELDS.item.blueprint!.waits).toBeUndefined();
});

test("the numbers the item program reserved are its own and still free of anything else", () => {
  // The weapons program moved the protocol to 13 (tests/unit/weapons-contracts.test.ts); the item program's codes stand.
  expect([P.CMD_CRAFT_AT, P.CMD_CRAFT_BLUEPRINT, P.OWN_STATION, P.SLOT_BLUEPRINT]).toEqual([29, 30, 16, 1]);
  const own = Object.entries(P).filter(([k]) => k.startsWith("OWN_")).map(([, v]) => v);
  expect(new Set(own).size).toBe(own.length);
  // Task B moved the manifest to 4 for icon sheets, the creature clips coming with their species to 5, pages to 6, landmark far meshes to 7, and landmarks' pages to 8.
  expect(MANIFEST_VERSION).toBe(8);
});

test("the item program's content is in the core pack, and a consumable may be one only for what using it does", () => {
  const ids = new Set(CORE_CONTENT.map((d) => `${d.type} ${d.id}`));
  expect(ITEMS.every((d) => ids.has(`${d.type} ${d.id}`))).toBe(true);
  const skin = CORE_CONTENT.find((d) => d.id === "core:waterskin")!;
  // Task C built it: a vessel of ARK's 100 water, kept when empty (server/use.ts).
  expect(skin).toMatchObject({ class: "consumable", stack: 1, weight: 0.3, use: { holds: { water: 100, each: 100 } } });
  const used = { type: "item", class: "consumable", id: "core:test_tonic", stack: 10, use: { buffs: ["core:fed"] } } as Def;
  expect(defFaults(used)).toEqual([]);
});

test("task D built craft.at: sparkpowder is made at the mortar and pestle, a station with slots, at ARK's numbers, and nothing is made at what is no station or has no slots", () => {
  const def = (id: string): Def => CORE_CONTENT.find((d) => d.id === id && d.type !== "rename")!;
  expect(def("core:sparkpowder")).toMatchObject({ class: "resource", stack: 100, weight: 0.1, craft: { needs: [{ item: "core:flint", count: 2 }, { item: "core:stone", count: 1 }], seconds: 1, xp: 0.24, count: 2, at: "core:mortar" } });
  expect(def("core:mortar")).toMatchObject({ type: "structure", class: "station", hp: 1000, slots: 24, material: "core:mat_thatch" });
  expect(def("core:piece_mortar")).toMatchObject({ stack: 100, weight: 4, craft: { needs: [{ item: "core:stone", count: 65 }, { item: "core:hide", count: 15 }], seconds: 5, xp: 28.8 } });
  expect([def("core:engram-piece_mortar"), def("core:engram-sparkpowder")].map((e) => (e.type === "engram" ? [e.level, e.cost] : []))).toEqual([[6, 6], [6, 3]]);
  const spark = def("core:sparkpowder") as ItemDef;
  const at = (station: string): string[] => compileContent(CORE_CONTENT.map((d) => (d === spark ? { ...spark, craft: { ...spark.craft!, at: station } } : d))).errors;
  expect(at("core:mortar")).toEqual([]);
  expect(at("core:storage_box").some((e) => e.includes("core:sparkpowder"))).toBe(true);
  const bare = CORE_CONTENT.map((d) => (d.id === "core:mortar" && d.type === "structure" ? { ...d, slots: 0 } : d));
  expect(compileContent(bare).errors).toContain('core:sparkpowder: it is made at "core:mortar", which has no slots to make it from');
});
