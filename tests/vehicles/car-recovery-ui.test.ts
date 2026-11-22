import { expect, test } from "bun:test";
import { InventoryScreen, KEY_VEHICLE_FLIP, KEY_VEHICLE_PULL, KEY_VEHICLE_RECOVER } from "../../client/core/ui/inventory.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

for (const key of [KEY_VEHICLE_RECOVER, KEY_VEHICLE_PULL, KEY_VEHICLE_FLIP]) test(`car recovery control ${key} sends a real qualified command`, () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  try {
    const session = h.join("car-service"); h.run(400);
    const c = h.client(session)!, a = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
    const e = h.host.spawnVehicle("core:compact", 64, 64, actor.team), v = a.vrow[e]!;
    a.setPosition(c.ent, 64, 0, 67.2); h.world.history.discontinuity(c.ent);
    if (key !== KEY_VEHICLE_FLIP) a.vehicleFlooding[v] = 1;
    expect(h.host.vehicles.inspect(c, makeHandle(e, a.gen[e]!))).toBe(RESULT_OK); h.run(250);
    const inventory = new InventoryScreen(), frame = new UiFrame();
    for (const aspect of [16 / 9, 9 / 16]) {
      frame.begin(aspect); inventory.build(frame, session, h.reg, null);
      expect(frame.find(key)?.interactive).toBe(true);
      expect(new Set(frame.nodes.slice(0, frame.count).map(n => n.key)).size).toBe(frame.count);
      for (const n of frame.nodes.slice(0, frame.count)) {
        expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(frame.width); expect(n.y + n.h).toBeLessThanOrEqual(frame.height);
      }
    }
    if (key === KEY_VEHICLE_FLIP) {
      a.setPosition(e, 64, h.reg.vehicle[a.kind[e]!]!.spec.halfWidth + .015, 64);
      a.vehicleRoll[v] = Math.PI / 2; a.vehicleQz[v] = a.vehicleQw[v] = Math.SQRT1_2;
      a.flags[e] = a.flags[e]! & ~F_GROUNDED;
    }
    const results: number[] = [];
    session.onResult = (_sequence, result) => results.push(result);
    inventory.pointer(0, key, 0, session); h.run(1000);
    expect(results).toEqual([RESULT_OK]);
    if (key === KEY_VEHICLE_FLIP) expect(Math.abs(a.vehicleRoll[v]!)).toBeLessThan(.1);
    else expect((a.z[e]! - 64) * (key === KEY_VEHICLE_PULL ? 1 : -1)).toBeGreaterThan(.25);
  } finally { h.host.shutdown(); }
});
