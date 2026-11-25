import { expect, test } from "bun:test";
import { VEHICLE_PLACEMENT_REASONS, VehiclePlacement } from "../../client/core/vehicle-placement.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { Def } from "../../shared/content/defs.ts";
import { CMD_VEHICLE, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, VEHICLE_DEPLOY } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
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

test("a car's kit aimed at a parked car is refused by the preview and the server alike, and a clear spot by neither", () => {
  const h = new Harness({}, 1, 60, { map: writeMap(flatMap()) }, reg);
  const s = h.join("ada");
  h.run(400);
  const c = h.client(s)!, actor = h.host.records.byPid.get(c.pid)!, kit = reg.index.get("core:compact_kit")!;
  const def = reg.vehicle[reg.index.get("core:compact")!]!, x0 = 40, z0 = 40;
  h.world.ents.setPosition(c.ent, x0, groundUnder(h.world.hf, x0, z0, .4), z0);
  expect(h.host.spawnVehicle("core:compact", x0 + 8, z0, 0, Math.PI / 2)).toBeGreaterThanOrEqual(0);
  h.host.items.mint(actor, kit, 1);
  h.run(400);
  const slot = s.inventory!.item.indexOf(kit);
  /** The preview's verdict on aiming at `x, z`, and the server's on the pose it would send. */
  const aim = (x: number, z: number): number[] => {
    const preview = new VehiclePlacement(), eyeY = s.own.y + 1.6, y = groundUnder(h.world.hf, x, z, def.spec.halfWidth);
    const dx = x - s.own.x, dy = y - eyeY, dz = z - s.own.z, length = Math.hypot(dx, dy, dz);
    preview.begin(slot);
    preview.update(s, h.world, reg, s.own.x, eyeY, s.own.z, dx / length, dy / length, dz / length, Math.atan2(dx, dz), 0);
    let code = -1;
    s.onResult = (_, result) => { code = result; };
    s.command(CMD_VEHICLE, (w) => { w.u8(VEHICLE_DEPLOY); w.u8(slot); w.f32(preview.pose.x); w.f32(preview.pose.y); w.f32(preview.pose.z); w.u16(preview.pose.yaw); });
    h.run(300);
    return [preview.problem, code];
  };
  expect(aim(x0 + 8, z0)).toEqual([RESULT_OBSTRUCTED, RESULT_OBSTRUCTED]);
  expect(VEHICLE_PLACEMENT_REASONS[RESULT_OBSTRUCTED]).toBe("A body or vehicle is in the way");
  expect(aim(x0, z0 + 8)).toEqual([RESULT_OK, RESULT_OK]);
  expect(s.log.at(-1)?.text).toBe("Compact assembled. Add gasoline before starting.");
  h.host.shutdown();
});
