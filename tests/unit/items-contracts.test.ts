// The item program's contracts (planning/reference/items-plan.md): the numbers it reserved, and the shapes later tasks
// build on. A task that builds one of these moves its pin here in the same change.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { ITEMS } from "../../content/items/index.ts";
import { defFaults } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { MANIFEST_VERSION } from "../../shared/pack/manifest.ts";
import * as P from "../../shared/net/protocol.ts";

test("the numbers the item program reserved are its own and still free of anything else", () => {
  expect([P.PROTOCOL_VERSION, P.CMD_CRAFT_AT, P.CMD_CRAFT_BLUEPRINT, P.OWN_STATION, P.SLOT_BLUEPRINT]).toEqual([12, 29, 30, 16, 1]);
  const own = Object.entries(P).filter(([k]) => k.startsWith("OWN_")).map(([, v]) => v);
  expect(new Set(own).size).toBe(own.length);
  // Task B moves the manifest to 4 for icon sheets.
  expect(MANIFEST_VERSION).toBe(3);
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
