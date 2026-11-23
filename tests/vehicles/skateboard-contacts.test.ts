import { expect, test } from "bun:test";
import { VehiclePrediction } from "../../client/core/vehicle-prediction.ts";
import { BOARD_ID } from "../../content/vehicles/skateboard.ts";
import type { VehicleCollisionPair } from "../../server/vehicle-contacts.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { ContactSnapshot } from "../../shared/net/contact.ts";
import { Body } from "../../shared/sim/character.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

for (const [name, pve, friendly, speed, boardFirst] of [
  ["a moving car knocks a skateboarder off with capped fall damage", false, false, 22, false],
  ["a board registered before the striking car gives the same fall", false, false, 22, true],
  ["a car moves a protected PvE rider's board without knocking them off", true, false, 22, true],
  ["friendly fire protection keeps a teammate on their board", false, true, 22, false],
  ["a small bumper nudge lets the skater ride away", false, false, 6, false],
] as const) test(name, () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const a = h.join("driver"), b = h.join("rider");
    h.run(450);
    const driver = h.client(a)!, rider = h.client(b)!, ents = h.world.ents;
    const dr = h.host.records.byPid.get(driver.pid)!, sk = h.host.records.byPid.get(rider.pid)!;
    h.host.setSetting("serverPVE", pve ? "True" : "False");
    h.host.setSetting("Knockdowns", "True");
    expect(dr.team).not.toBe(sk.team);
    if (friendly) { dr.team = sk.team; ents.setTeam(driver.ent, sk.team); }
    const spawnCar = () => h.host.spawnVehicle("core:compact", 64, 70, dr.team, 0);
    const spawnBoard = () => h.host.spawnVehicle(BOARD_ID, 64, 80, sk.team, 0);
    const [first, second] = boardFirst ? [spawnBoard(), spawnCar()] : [spawnCar(), spawnBoard()];
    const [car, board] = boardFirst ? [second, first] : [first, second];
    ents.setPosition(driver.ent, 65.6, 0, 70.12);
    ents.setPosition(rider.ent, 64.65, 0, 80);
    expect(h.host.urban.mount(driver, car)).toBe(RESULT_OK);
    expect(h.host.urban.mount(rider, board)).toBe(RESULT_OK);
    h.run(750);
    expect([driver.drive, rider.drive]).toEqual([car, board]);
    const events: VehicleCollisionPair[] = [], native = h.host.urban.collisionPair.bind(h.host.urban);
    h.host.urban.collisionPair = pair => { events.push(pair); native(pair); };
    const hp = h.host.survival.value(sk, V_HEALTH);
    const boardHp = () => h.host.survival.value(h.host.records.byPid.get(ents.pid[board]!)!, V_HEALTH);
    const deckBefore = boardHp(), carBefore = ents.vehicleHullCondition[ents.vrow[car]!]!;
    ents.setPosition(car, 64, 0, 76);
    h.world.history.discontinuity(car);
    ents.vz[car] = speed;
    ents.vz[board] = 2;
    const owner = boardFirst ? board : car;
    const snap = new ContactSnapshot(), prediction = new VehiclePrediction(h.world, h.reg);
    h.host.urban.contacts!.proxies(owner, snap);
    const own = new Body(), before = new Body(), def = h.reg.vehicle[ents.kind[owner]!]!;
    ents.loadBody(owner, own);
    prediction.accept(snap, own);
    for (let i = 1; i <= 12 && !prediction.stats.contacts; i++) {
      before.copy(own);
      stepVehicleBody(h.world, own, 0, 0, 0, def);
      prediction.step(snap.tick + i, before, own, def);
    }
    const tick = () => {
      for (const c of [driver, rider]) c.inputs.set(h.world.tick + 1, 0, 0, 0, 0, 0);
      h.server.tick();
    };
    for (let i = 0; i < 40 && !events.length; i++) tick();
    const hit = events.find(p => (p.a.entity === car && p.b.entity === board) || (p.a.entity === board && p.b.entity === car));
    expect(hit).toBeDefined();
    const change = (hit!.a.entity === board ? hit!.a : hit!.b).deltaSpeed;
    expect(change).toBeGreaterThan(0);
    if (speed > 10) {
      expect(change).toBeGreaterThan(6.3);
      expect(prediction.stats.contacts).toBeGreaterThan(0);
      expect(Math.abs(prediction.stats.lastTick - hit!.tick)).toBeLessThanOrEqual(1);
    }
    tick();
    const loss = hp - h.host.survival.value(sk, V_HEALTH);
    if (pve || friendly || speed < 10) { expect(rider.drive).toBe(board); expect(loss).toBe(0); }
    else {
      expect(rider.drive).toBe(-1);
      expect(loss).toBeGreaterThan(0); expect(loss).toBeLessThanOrEqual(8);
      expect(h.host.falls.isDown(rider.ent)).toBe(true);
      for (let i = 0; i < 5; i++) tick();
      expect(hp - h.host.survival.value(sk, V_HEALTH)).toBeLessThanOrEqual(8);
    }
    expect(boardHp()).toBe(deckBefore);
    expect(ents.vehicleHullCondition[ents.vrow[car]!]).toBe(carBefore);
  } finally { h.host.shutdown(); }
});
