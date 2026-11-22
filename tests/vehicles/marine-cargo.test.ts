import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_INV_SLOT, KEY_OPEN_SLOT, KEY_VEHICLE_REFUEL, KEY_VEHICLE_SERVICE } from "../../client/core/ui/inventory.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { fleetMarina } from "../../tools/boat/marina.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("F services unclaimed flagship cargo at the dock and in passenger seats, with reach, sight and ownership rechecked", () => {
  const course = fleetMarina(), berth = course.vehicles!.find(v => v.kind === "core:sovereign")!;
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [],
    map: writeMap({ ...course, vehicles: [{ ...berth, fuel: [0, 0] }] }) });
  try {
    const app = new App(h.join("dockhand", {}, { manual: true }), h.reg, corePack());
    const apps = [app], s = app.session;
    const run = (ms: number) => h.run(ms, now => { for (const playing of apps) playing.frame(now, 984, 600); });
    const open = (playing = app) => { playing.key("KeyF", true); playing.key("KeyF", false); run(350); };
    const click = (key: number) => app.pointer(0, key, 0, 0, 0);
    run(450);
    const c = h.client(s)!, ents = h.world.ents, kind = h.reg.index.get("core:sovereign")!;
    const boat = [...h.host.records.byPid.values()].find(r => r.kind === kind)!;
    const e = h.host.records.entOf.get(boat.pid)!, handle = makeHandle(e, ents.gen[e]!);
    const actor = h.host.records.byPid.get(c.pid)!;
    const stone = h.reg.index.get("core:stone")!, gas = h.reg.index.get("core:gasoline")!;
    h.host.items.mint(actor, stone, 5); h.host.items.mint(actor, gas, 2);
    const def = h.reg.vehicle[kind]!;
    if (def.movement !== "boat") throw Error("expected a boat");
    const x = berth.x + def.boarding!.water[0], z = berth.z + def.boarding!.water[2] - 1.25;
    const dock = () => { ents.setPosition(c.ent, x, .55, z); c.ownDirty = true; };
    dock(); app.controls.yaw = 0; app.controls.pitch = -.61; run(450);
    expect(app.lookedAt).toBe(-1);
    expect(app.target).toBe(e);
    open();
    expect(c.open).toBe(boat.pid);
    expect(s.subject?.id).toBe(e);
    expect(app.ui.frame.find(KEY_VEHICLE_SERVICE)?.text).toContain("Hull");
    expect(app.ui.frame.find(KEY_VEHICLE_REFUEL)?.interactive).toBe(true);
    click(KEY_VEHICLE_REFUEL); run(200);
    expect(ents.fuel[ents.vrow[e]!]).toBe(10);
    click(KEY_INV_SLOT + 3 * s.inventory!.item.indexOf(stone)); click(KEY_OPEN_SLOT); run(250);
    expect(h.host.items.inv(boat).total(stone)).toBe(5);

    // A wall built after opening must immediately prevent further inventory moves.
    const wall = h.world.structs.add(h.reg.index.get("core:wall_wood")!, x, 1.65, z + .63, 0, actor.team, 1000);
    expect(h.host.containers.openOf(c)).toBeNull();
    expect(h.host.vehicles.inspect(c, handle)).toBe(RESULT_OBSTRUCTED);
    h.world.structs.remove(wall);
    expect(h.host.setSetting("serverPVE", "True")).toBe("");
    boat.team = actor.team + 100;
    expect(h.host.vehicles.inspect(c, handle)).toBe(RESULT_NOT_YOURS);
    boat.team = 0;
    expect(h.host.vehicles.inspect(c, handle)).toBe(RESULT_OK);
    ents.setPosition(c.ent, x + 30, .55, z); c.ownDirty = true;
    run(150); expect(s.open).toBeNull();
    app.ui.inventory.close(s);

    // The second occupant opens their host's inventory while looking away from the hull.
    const helm = new App(h.join("skipper", {}, { manual: true }), h.reg, corePack());
    apps.push(helm); run(350);
    const skipper = h.client(helm.session)!;
    ents.setPosition(skipper.ent, x, .55, z); skipper.ownDirty = true; run(160);
    expect(h.host.urban.mount(skipper, e)).toBe(RESULT_OK); run(1250);
    expect(skipper.drive).toBe(e);
    open(helm); expect(helm.session.subject?.id).toBe(e);
    dock(); run(160);
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); run(1250);
    expect(s.own.seatSlot).toBe(2);
    app.controls.pitch = .9; run(100); open();
    expect(c.open).toBe(boat.pid);
    click(KEY_OPEN_SLOT); click(KEY_INV_SLOT + 3 * s.inventory!.free()); run(180);
    expect(h.host.items.inv(actor).total(stone)).toBe(5);

    // Salvage keeps the hull's render kind and stern access. Machinery stays disabled.
    h.host.items.mint(boat, stone, 3);
    h.host.survival.hurt(boat, 50000, 0); run(150);
    const wreck = [...h.host.corpses.bodies.values()].find(b => b.kind === kind)!;
    expect(wreck.rec.pid).not.toBe(boat.pid);
    app.ui.inventory.close(s); dock(); app.controls.yaw = 0; app.controls.pitch = -.61; run(150);
    const wreckHandle = makeHandle(wreck.e, ents.gen[wreck.e]!);
    open();
    expect(c.open).toBe(wreck.rec.pid);
    expect(s.open!.inventory.total(stone)).toBe(3);
    expect(h.host.vehicles.refuel(c, wreckHandle, 1)).toBe(RESULT_INVALID);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
