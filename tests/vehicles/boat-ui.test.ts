import { expect, test } from "bun:test";
import { InventoryScreen, KEY_INV_DEPLOY, KEY_OPEN_ORDER, KEY_VEHICLE_RECOVER, KEY_VEHICLE_REFUEL, KEY_VEHICLE_REPAIR, KEY_VEHICLE_SERVICE, KEY_VEHICLE_TAB } from "../../client/core/ui/inventory.ts";
import { UiFrame, textWidth } from "../../client/core/ui/nodes.ts";
import { VehiclePlacement } from "../../client/core/vehicle-placement.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_NO_SUPPORT, RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2, { seaLevel: 3 })) });
  const session = h.join("pilot"); h.run(400);
  const c = h.client(session)!, actor = h.host.records.byPid.get(c.pid)!;
  return { h, session, c, actor };
}

test("boat inventory shows bounded costs and sends real service commands, with no creature orders", () => {
  const { h, session, c, actor } = setup();
  try {
    const e = h.host.spawnVehicle("core:boat", 68, 64, actor.team, 0, { fuel: .1, hull: .5, engine: .5, rotor: 1 });
    const ents = h.world.ents; ents.setPosition(c.ent, 64, 1.65, 64);
    for (const [id, count] of [["gasoline", 2], ["ingot", 40], ["polymer", 10], ["electronics", 8]] as const) h.host.items.mint(actor, h.reg.index.get(`core:${id}`)!, count);
    expect(h.host.vehicles.inspect(c, makeHandle(e, ents.gen[e]!))).toBe(RESULT_OK); h.run(250);
    const inventory = new InventoryScreen(), f = new UiFrame();
    for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
      f.begin(aspect); inventory.draw(f, session, h.reg, null);
      expect(f.find(KEY_OPEN_ORDER)).toBeNull();
      expect(f.find(KEY_VEHICLE_SERVICE)!.text).toContain("Hull");
      expect(f.find(KEY_VEHICLE_REFUEL)!.interactive).toBe(true);
      expect(f.find(KEY_VEHICLE_REPAIR)!.interactive).toBe(true);
      expect(f.find(KEY_VEHICLE_RECOVER)!.interactive).toBe(true);
      expect(new Set(f.nodes.slice(0, f.count).map(n => n.key)).size).toBe(f.count);
      for (const n of f.nodes.slice(0, f.count)) {
        expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThanOrEqual(f.height);
        if (n.text) expect(textWidth(n.text, n.style)).toBeLessThanOrEqual(n.w + 1);
      }
    }
    inventory.press(0, KEY_VEHICLE_TAB, 0, session); f.begin(9 / 16); inventory.draw(f, session, h.reg, null);
    expect(f.find(KEY_VEHICLE_SERVICE)).toBeNull();
    for (const n of f.nodes.slice(0, f.count)) expect(n.y + n.h).toBeLessThanOrEqual(f.height);
    inventory.press(0, KEY_VEHICLE_TAB, 0, session); f.begin(9 / 16); inventory.draw(f, session, h.reg, null);
    inventory.press(0, KEY_VEHICLE_REFUEL, 0, session); h.run(100);
    expect(ents.fuel[ents.vrow[e]!]).toBe(19); expect(h.host.items.inv(actor).total(h.reg.index.get("core:gasoline")!)).toBe(0);
    inventory.press(0, KEY_VEHICLE_REPAIR, 0, session); h.run(100);
    expect(ents.vehicleEngineCondition[ents.vrow[e]!]).toBeCloseTo(.75, 2);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("boat assembly preview targets actual water, rotates, cancels and submits one authoritative deployment", () => {
  const { h, session, c, actor } = setup();
  try {
    h.world.ents.setPosition(c.ent, 64, 1.65, 64); c.ownDirty = true;
    const kit = h.reg.index.get("core:boat_assembly")!;
    h.host.items.mint(actor, kit, 1); h.run(100);
    const slot = session.inventory!.item.indexOf(kit), preview = new VehiclePlacement(), inventory = new InventoryScreen();
    inventory.open = true; inventory.held = slot; inventory.onDeploy = s => preview.begin(s);
    const f = new UiFrame(); inventory.draw(f, session, h.reg, null);
    expect(f.find(KEY_INV_DEPLOY)!.text).toBe("Assemble");
    inventory.press(0, KEY_INV_DEPLOY, 0, session);
    expect(inventory.open).toBe(false);
    const length = Math.hypot(8, 1), update = (dy: number) => preview.update(session, session.world!, h.reg, 64, 4, 64, 8 / length, dy, 0, 0, h.now);
    session.world!.hf.seaLevel = -Infinity; update(-1 / length);
    expect(preview.problem).toBe(RESULT_NO_SUPPORT); expect(Number.isFinite(preview.pose.y)).toBe(true);
    session.world!.hf.seaLevel = 3;
    update(0); expect(preview.active).toBe(true); expect(preview.problem).toBe(RESULT_NO_SUPPORT); expect(preview.place(session)).toBe(0);
    update(-1 / length); expect(preview.problem).toBe(RESULT_OK);
    preview.key("KeyE", true, false); update(-1 / length); expect(preview.pose.yaw).toBe(4096);
    session.own.seat = 5; update(-1 / length);
    expect(preview.active).toBe(false); expect(preview.key("KeyE", true, false)).toBe(false); expect(preview.key("KeyQ", true, false)).toBe(false);
    session.own.seat = 0; update(-1 / length); expect(preview.active).toBe(true);
    preview.key("Escape", true, false); expect(preview.active).toBe(false);
    preview.begin(slot); update(-1 / length);
    session.onResult = (seq, code) => preview.result(seq, code, h.now);
    expect(preview.place(session)).toBeGreaterThan(0); expect(preview.place(session)).toBe(0);
    h.run(200);
    expect(preview.active).toBe(false);
    expect(h.host.items.inv(actor).total(kit)).toBe(0);
    expect([...h.host.records.byPid.values()].filter(r => h.reg.ids[r.kind] === "core:boat")).toHaveLength(1);
    expect(c.drive).toBe(-1); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("authoritative water-depth refusal keeps the assembly and shows a marine placement reason", () => {
  const { h, session, c, actor } = setup();
  try {
    h.world.ents.setPosition(c.ent, 64, 1.65, 64); c.ownDirty = true;
    const kit = h.reg.index.get("core:boat_assembly")!; h.host.items.mint(actor, kit, 1); h.run(100);
    const preview = new VehiclePlacement(); preview.begin(session.inventory!.item.indexOf(kit));
    const length = Math.hypot(8, 1), update = () => preview.update(session, session.world!, h.reg, 64, 4, 64, 8 / length, -1 / length, 0, 0, h.now);
    update(); expect(preview.problem).toBe(RESULT_OK);
    session.onResult = (seq, code) => preview.result(seq, code, h.now);
    // The server rejects changed support even when the client's preview had been valid.
    h.world.hf.seaLevel = .2;
    expect(preview.place(session)).toBeGreaterThan(0); h.run(200); update();
    expect(preview.notice).toContain("open water"); expect(preview.notice).not.toContain("rotors");
    expect(h.host.items.inv(actor).total(kit)).toBe(1);
  } finally { h.host.shutdown(); }
});
