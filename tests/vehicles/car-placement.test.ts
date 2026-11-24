import { expect, test } from "bun:test";
import { VehiclePlacement } from "../../client/core/vehicle-placement.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Def } from "../../shared/content/defs.ts";
import { RESULT_NO_SUPPORT, RESULT_OK } from "../../shared/net/protocol.ts";
import { familyOf } from "../../shared/sim/families.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { flatWorld } from "../fixtures/world.ts";

// A car in a kit, as a mod might add one: no such kit is in the core's content.
const KIT = { type: "item", class: "vehicle", id: "core:compact_kit", label: "Compact in a kit", stack: 1, weight: 900, deploys: "core:compact" } as unknown as Def;
const reg = compileContent([...CORE_CONTENT, KIT]).registry!;

test("a car is held up by the ground under it, as the server judges it", () => {
  const w = flatWorld(), def = reg.vehicle[reg.index.get("core:compact")!]!, family = familyOf(def)!;
  const ground = groundUnder(w.hf, 40, 40, def.spec.halfWidth);
  expect(family.supports(w, 40, ground, 40, 0, def)).toBe(true);
  expect(family.supports(w, 40, ground + 1, 40, 0, def)).toBe(false);
});

test("a car's kit can be set down on level ground, where every car was refused for want of a rotor's pad", () => {
  const w = flatWorld(), inv = new Inventory(8);
  inv.set(0, reg.index.get("core:compact_kit")!, 1, 0, 0, 0);
  const session = {
    inventory: inv, held: -1, driving: -1, own: { seat: 0, x: 0, y: 0, z: 0, stance: 0 }, ownKind: reg.index.get("core:survivor")!, ownHandle: 0,
    sampleRemote: (out: { count: number }) => void (out.count = 0),
  } as unknown as ClientSession;
  const preview = new VehiclePlacement();
  preview.begin(0);
  // Looking down at the ground eight metres ahead.
  const length = Math.hypot(8, 1.6);
  preview.update(session, w, reg, 40, groundUnder(w.hf, 40, 40, 1) + 1.6, 32, 0, -1.6 / length, 8 / length, 0, 0);
  expect(preview.active).toBe(true);
  expect(preview.problem).not.toBe(RESULT_NO_SUPPORT);
  expect(preview.problem).toBe(RESULT_OK);
});
