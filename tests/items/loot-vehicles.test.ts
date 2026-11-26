// Loot in cars and boats (planning/workstreams/loot.md): a found one's hold is rolled when first opened, and a dead one
// on the street is searched as a bin is.

import { expect, test } from "bun:test";
import { CMD_STRUCT, CMD_VEHICLE, RESULT_OK, VEHICLE_INSPECT } from "../../shared/net/protocol.ts";
import { makeHandle } from "../../shared/ids.ts";
import { NO_PIN, STRUCT_SEARCH, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { city } from "../fixtures/city.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { camp, put, rules, send, survivor } from "../kit/kit.ts";
import type { Harness } from "../fixtures/net.ts";
import type { ClientSession } from "../../client/core/session.ts";

const SURE = { WorldLootChanceMultiplier: 4 };

/** Parks a vehicle beside the survivor, found (with a placement's name) or not, and opens its hold. Returns the stacks it holds. */
function opened(h: Harness, s: ClientSession, kind: string, found: boolean, at: { x: number; z: number }): number {
  const e = h.host.spawnVehicle(kind, at.x, at.z, 0, 0, found ? { origin: `test/${kind}@${at.x}` } : {});
  expect(e).toBeGreaterThanOrEqual(0);
  h.run(500);
  put(h, s, { x: at.x + 2.2, z: at.z });
  const handle = makeHandle(e, h.world.ents.gen[e]!);
  expect(send(h, s, CMD_VEHICLE, (w) => (w.u8(VEHICLE_INSPECT), w.u32(handle)))).toBe(RESULT_OK);
  h.run(200);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  expect(s.open).not.toBe(null);
  // Shut again, for the next.
  expect(send(h, s, CMD_VEHICLE, (w) => (w.u8(VEHICLE_INSPECT), w.u32(handle)))).toBe(RESULT_OK);
  return h.host.items.inv(rec).used();
}

test("a found car's hold is rolled when it is first opened, once, and a car somebody made is empty", () => {
  const { h, ada, at } = camp({ god: true, rules: SURE });
  const first = opened(h, ada, "core:compact", true, { x: at.x + 8, z: at.z });
  expect(first).toBeGreaterThan(0);
  expect(opened(h, ada, "core:compact", false, { x: at.x + 8, z: at.z + 10 })).toBe(0);
  // A van carries a load besides.
  expect(opened(h, ada, "core:panel_van", true, { x: at.x + 8, z: at.z + 20 })).toBeGreaterThan(first - 1);
  expect(h.host.loot.finds).toBeGreaterThanOrEqual(3);
  expect(h.host.items.audit()).toEqual([]);
});

test("with vehicle loot off a found car is empty", () => {
  const { h, ada, at } = camp({ god: true, rules: { ...SURE, VehicleLootEnabled: false } });
  expect(opened(h, ada, "core:compact", true, { x: at.x + 8, z: at.z })).toBe(0);
});

test("a street wreck is searched as a bin is, and is still salvage", () => {
  const reg = coreRegistry();
  const wreck = reg.ids.find((id, i) => reg.holds[i] === "wreck" && reg.salvageYield[i] != null)!;
  const c = city([{ kind: wreck, x: 120, z: 120 }], 4, { config: rules(SURE) });
  const h = c.h;
  const ada = survivor(h, "ada", { god: true });
  const ref = c.refs[0]!;
  put(h, ada, { x: 120, z: 117.2 });
  expect(send(h, ada, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_SEARCH)))).toBe(RESULT_OK);
  h.run(2500);
  expect(send(h, ada, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)))).toBe(RESULT_OK);
  h.run(200);
  expect([ada.open?.takeOnly, ada.open?.inventory.item.some((i) => i !== 0)]).toEqual([true, true]);
  expect(reg.salvageYield[h.world.structs.mapKind(Math.floor(ref / 65536), ref & 0xffff)]).not.toBeNull();
});
