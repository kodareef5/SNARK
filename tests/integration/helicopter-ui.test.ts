import { expect, test } from "bun:test";
import { InventoryScreen, KEY_INV_DEPLOY, KEY_OPEN_ORDER, KEY_VEHICLE_REFUEL, KEY_VEHICLE_REPAIR, KEY_VEHICLE_SERVICE, KEY_VEHICLE_TAB } from "../../client/core/ui/inventory.ts";
import { UiFrame, textWidth } from "../../client/core/ui/nodes.ts";
import { VehiclePlacement } from "../../client/core/vehicle-placement.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_NO_SUPPORT, RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  const session = h.join("pilot"); h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!;
  return { h, session, c, actor };
}

test("aircraft inventory shows bounded costs and sends real service commands, with no creature orders", () => {
  const { h, session, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:helicopter", 68, 64, actor.team, 0, { fuel: .1, hull: .5, engine: .5, rotor: .5 });
    const ents = h.world.ents;
    for (const [id, count] of [["gasoline", 2], ["ingot", 40], ["polymer", 10], ["electronics", 8]] as const) h.host.items.mint(actor, h.reg.index.get(`core:${id}`)!, count);
    expect(h.host.vehicles.inspect(c, makeHandle(e, ents.gen[e]!))).toBe(RESULT_OK); h.run(250);
    const inventory = new InventoryScreen(), f = new UiFrame();
    for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
      f.begin(aspect); inventory.build(f, session, h.reg, null);
      expect(f.find(KEY_OPEN_ORDER)).toBeNull();
      expect(f.find(KEY_VEHICLE_SERVICE)!.text).toContain("Hull");
      expect(f.find(KEY_VEHICLE_REFUEL)!.interactive).toBe(true);
      expect(f.find(KEY_VEHICLE_REPAIR)!.interactive).toBe(true);
      expect(new Set(f.nodes.slice(0, f.count).map(n => n.key)).size).toBe(f.count);
      for (const n of f.nodes.slice(0, f.count)) {
        expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThanOrEqual(f.height);
        if (n.text) expect(textWidth(n.text, n.style)).toBeLessThanOrEqual(n.w + 1);
      }
    }
    inventory.pointer(0, KEY_VEHICLE_TAB, 0, session); f.begin(9 / 16); inventory.build(f, session, h.reg, null);
    expect(f.find(KEY_VEHICLE_SERVICE)).toBeNull();
    for (const n of f.nodes.slice(0, f.count)) expect(n.y + n.h).toBeLessThanOrEqual(f.height);
    inventory.pointer(0, KEY_VEHICLE_TAB, 0, session); f.begin(9 / 16); inventory.build(f, session, h.reg, null);
    inventory.pointer(0, KEY_VEHICLE_REFUEL, 0, session); h.run(100);
    expect(ents.fuel[e]).toBe(20); expect(h.host.items.inv(actor).total(h.reg.index.get("core:gasoline")!)).toBe(0);
    inventory.pointer(0, KEY_VEHICLE_REPAIR, 0, session); h.run(100);
    expect(ents.vehicleEngineCondition[e]).toBeCloseTo(.75, 2);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("assembly preview shares support checks, rotates, cancels and submits exactly one successful deployment", () => {
  const { h, session, c, actor } = setup();
  try {
    const kit = h.reg.index.get("core:helicopter_assembly")!;
    h.host.items.mint(actor, kit, 1); h.run(100);
    const slot = session.inventory!.item.indexOf(kit), preview = new VehiclePlacement(), inventory = new InventoryScreen();
    inventory.open = true; inventory.held = slot; inventory.onDeploy = s => preview.begin(s);
    const f = new UiFrame(); inventory.build(f, session, h.reg, null);
    expect(f.find(KEY_INV_DEPLOY)!.text).toBe("Assemble");
    inventory.pointer(0, KEY_INV_DEPLOY, 0, session);
    expect(inventory.open).toBe(false);
    const length = Math.hypot(8, 1.6), update = (dy: number) => preview.update(session, session.world!, h.reg, 64, 1.6, 64, 8 / length, dy, 0, 0, h.now);
    update(0); expect(preview.active).toBe(true); expect(preview.problem).toBe(RESULT_NO_SUPPORT); expect(preview.place(session)).toBe(0);
    update(-1.6 / length); expect(preview.problem).toBe(RESULT_OK);
    preview.key("KeyE", true, false); update(-1.6 / length); expect(preview.pose.yaw).toBe(4096);
    session.own.seat = 5; update(-1.6 / length);
    expect(preview.active).toBe(false); expect(preview.key("KeyE", true, false)).toBe(false); expect(preview.key("KeyQ", true, false)).toBe(false);
    session.own.seat = 0; update(-1.6 / length); expect(preview.active).toBe(true);
    preview.key("Escape", true, false); expect(preview.active).toBe(false);
    preview.begin(slot); update(-1.6 / length);
    session.onResult = (seq, code) => preview.result(seq, code, h.now);
    expect(preview.place(session)).toBeGreaterThan(0); expect(preview.place(session)).toBe(0);
    h.run(200);
    expect(preview.active).toBe(false);
    expect(h.host.items.inv(actor).total(kit)).toBe(0);
    expect([...h.host.records.byPid.values()].filter(r => h.reg.ids[r.kind] === "core:helicopter")).toHaveLength(1);
    expect(c.drive).toBe(-1); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
