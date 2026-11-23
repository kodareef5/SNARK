import { expect, test } from "bun:test";
import { BOARD_ID, BOARD_KIT } from "../../content/vehicles/skateboard.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { CMD_CRAFT, CMD_LEARN, CMD_VEHICLE, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, VEHICLE_PACK, VEHICLE_RIDE } from "../../shared/net/protocol.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_RELOAD, BTN_USE } from "../../shared/sim/character.ts";
import { FLIP } from "../../shared/sim/skate-state.ts";
import { T_POP_SHOVE } from "../../shared/sim/skate-tricks.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";
import { remoteVehiclePose } from "../../client/core/vehicle-view.ts";
import { RemoteSample } from "../../client/core/session.ts";

test("a crafted board drops and rides, predicts a pop shove-it and a 180, and throws its rider on a hard drop", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(3)) });
  try {
    const s = h.join("skater", { latencyMs: 45 }), watcher = h.join("watcher");
    h.run(600); h.say(s, "enablecheats"); h.say(s, "addxp 5");
    const c = h.client(s)!, me = h.host.records.byPid.get(c.pid)!, inv = h.host.items.inv(me);
    const item = h.reg.index.get(BOARD_KIT)!;
    for (const [name, count] of [["wood", 8], ["fiber", 6], ["stone", 4]] as const) h.say(s, `give ${name} ${count}`);
    s.command(CMD_LEARN, w => w.u16(h.reg.index.get("core:zzzzzskateboard_engram")!)); h.run(300);
    s.command(CMD_CRAFT, w => { w.u16(item); w.u8(1); }); h.run(5400);
    expect(inv.total(item)).toBe(1);
    h.say(s, "tp 82 84"); h.run(400);
    // Set down at the feet and stepped onto in one command.
    s.command(CMD_VEHICLE, w => { w.u8(VEHICLE_RIDE); w.u8(inv.item.indexOf(item)); w.u16(0); });
    h.run(700);
    expect(inv.total(item)).toBe(0);
    const rec = [...h.host.records.byPid.values()].find(r => r.kind === h.reg.index.get(BOARD_ID))!;
    const e = h.host.records.entOf.get(rec.pid)!;
    expect(s.driving).toBe(e);
    const keys = h.pilots[0]!;
    keys.moveZ = 1; h.run(1500);
    expect(s.own.vz).toBeGreaterThan(3);
    const corrections = s.stats.corrections, health = s.vitals.at(V_HEALTH, s.serverTick);
    // A held pop, let go, then S with the flip key: a pop shove-it.
    keys.moveZ = 0; keys.buttons = BTN_JUMP; h.run(250);
    keys.buttons = 0; h.run(70);
    keys.moveZ = -1; keys.buttons = BTN_RELOAD; h.run(70);
    expect(s.own.skate!.trick).toBe(T_POP_SHOVE);
    // The watcher draws a few ticks behind.
    h.run(150);
    const remote = new RemoteSample(); watcher.sampleRemote(remote);
    const i = remote.id.subarray(0, remote.count).indexOf(e);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(remote.vehicleGear[i]).toBe(FLIP);
    expect(remoteVehiclePose(remote, i).skateTrick).toBe(T_POP_SHOVE);
    keys.buttons = 0; keys.moveZ = 0; h.run(1850);
    expect(s.own.skate!.bank).toBe(100);
    expect(s.stats.corrections).toBe(corrections);
    expect(s.vitals.at(V_HEALTH, s.serverTick)).toBe(health);
    // A pop with A tapped in the air: a 180, landed switch, which the watcher sees.
    keys.buttons = BTN_JUMP; h.run(250);
    keys.buttons = 0; h.run(70);
    keys.moveX = -1; h.run(130); keys.moveX = 0; h.run(800);
    expect(s.own.skate!.switched).toBe(true);
    watcher.sampleRemote(remote);
    expect(remoteVehiclePose(remote, remote.id.subarray(0, remote.count).indexOf(e)).switched).toBe(true);
    expect(s.stats.corrections).toBe(corrections);
    // A grab held into the landing: a light fall, back up without a ragdoll, then E steps back on from beside the board.
    keys.buttons = BTN_JUMP; h.run(250);
    keys.buttons = 0; h.run(70);
    keys.buttons = BTN_CROUCH; h.run(1200);
    keys.buttons = 0; h.run(300);
    expect(s.driving).toBe(-1);
    expect(h.host.falls.stats.fell).toBe(0);
    const light = (health - s.vitals.at(V_HEALTH, s.serverTick)) / 1e6;
    expect(light).toBeGreaterThan(0); expect(light).toBeLessThanOrEqual(2);
    h.run(1200);
    keys.buttons = BTN_USE; h.run(100); keys.buttons = 0; h.run(600);
    expect(s.driving).toBe(e);
    // A hard drop throws the rider down as a ragdoll.
    h.world.ents.setPosition(e, h.world.ents.x[e]!, 7, h.world.ents.z[e]!); c.ownDirty = true;
    h.run(1800);
    expect(h.host.falls.stats.fell).toBe(1);
    expect(s.driving).toBe(-1);
    expect(h.host.urban.occupancy.seatOf(me.pid)).toBeNull();
    const lost = (health - s.vitals.at(V_HEALTH, s.serverTick)) / 1e6;
    expect(lost).toBeGreaterThan(light); expect(lost).toBeLessThanOrEqual(light + 8);
    h.run(5000);
    expect(h.host.falls.stats.rose).toBe(1);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("packing returns one kit, protects cargo and restores the deck's condition", () => {
  const mod = listener("bonus", ["item.gain"]);
  mod.heard.each = event => {
    if (event.data.why === "pack skateboard") event.data.n = 2;
  };
  const h = new Harness({}, 1, 60, { dev: true, modules: [mod.def], clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(3)) });
  try {
    const s = h.join("skater");
    h.run(600);
    const c = h.client(s)!, me = h.host.records.byPid.get(c.pid)!, items = h.host.items;
    const inv = items.inv(me), ents = h.world.ents, kit = h.reg.index.get(BOARD_KIT)!;
    ents.setPosition(c.ent, 82, 0, 84);
    const board = h.host.spawnVehicle(BOARD_ID, 83, 84, me.team, 0, { hull: .65 });
    const handle = makeHandle(board, ents.gen[board]!), rec = h.host.records.byPid.get(ents.pid[board]!)!;
    expect(h.host.urban.mount(c, board)).toBe(RESULT_OK);
    h.run(700);
    // Ridden and rolling, it stays under the rider; stopped, F steps off and picks it up in one go.
    ents.vx[board] = 3;
    expect(h.host.vehicles.packBoard(c, handle)).toBe(RESULT_DENIED);
    ents.vx[board] = 0;
    const wood = h.reg.index.get("core:wood")!;
    items.mint(rec, wood, 1);
    h.host.vehicles.packBoard(c, handle);
    expect(c.drive).toBe(-1);
    expect(c.open).toBe(rec.pid);
    expect(inv.total(kit)).toBe(0);
    items.burn(rec, items.inv(rec).item.indexOf(wood), 1);
    const stone = h.reg.index.get("core:stone")!;
    items.mint(me, stone, 65535);
    expect(h.host.vehicles.packBoard(c, handle)).toBe(RESULT_FULL);
    expect(ents.resolve(handle)).toBe(board);
    for (let i = 0; i < 2; i++) {
      const slot = inv.item.indexOf(stone);
      items.burn(me, slot, inv.count[slot]!);
    }
    const condition = rec.vitals!.at(V_HEALTH, h.world.tick) / rec.vitals!.max[V_HEALTH]!;
    s.command(CMD_VEHICLE, w => { w.u8(VEHICLE_PACK); w.u32(handle); });
    h.run(250);
    expect(inv.total(kit)).toBe(1);
    const slot = inv.item.indexOf(kit);
    expect(inv.dur[slot]! / 1000).toBeCloseTo(condition, 3);
    const packedCondition = inv.dur[slot]! / 1000;
    expect(h.host.records.byPid.has(rec.pid)).toBe(false);
    expect(h.host.vehicles.packBoard(c, handle)).toBe(RESULT_INVALID);
    expect(h.host.vehicles.deploy(c, slot, 86, 0, 84, 0)).toBe(RESULT_OK);
    expect(inv.total(kit)).toBe(0);
    const placed = [...h.host.records.byPid.values()].find(r => r.kind === rec.kind)!;
    expect(placed.pid).not.toBe(rec.pid);
    expect(placed.vitals!.at(V_HEALTH, h.world.tick) / placed.vitals!.max[V_HEALTH]!).toBeCloseTo(packedCondition, 3);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
