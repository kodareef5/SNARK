import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { predictedVehiclePose, remoteVehiclePose } from "../../client/core/vehicle-view.ts";
import { quatRotate, quatUnrotate } from "../../shared/math/quat.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { vehicleRotation, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("all four native cockpit cameras remain in the cabin and follow the host through yaw, roll and inversion", () => {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(2)) });
  const pack = parsePack(corePackBytes());
  try {
    const crew = ["pilot", "front", "rear-left", "rear-right"].map(name => new App(h.join(name, {}, { manual: true }), h.reg, pack));
    const run = (ms: number) => h.run(ms, now => { for (const app of crew) app.frame(now, 640, 360); });
    run(400);
    const e = h.host.spawnVehicle("core:helicopter", 62, 64, 0), ents = h.world.ents, def = h.reg.vehicle[ents.kind[e]!]!;
    expect(e).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < crew.length; i++) {
      const c = h.client(crew[i]!.session)!, entry = def.seats[i]!.entry;
      ents.setPosition(c.ent, 62 + entry[0], entry[1], 64 + entry[2]);
      h.world.history.untrack(c.ent); h.world.history.track(c.ent);
      expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); run(1200);
      expect(crew[i]!.session.own.seatSlot).toBe(i === 0 ? 0 : i + 1);
    }
    for (const app of crew) { expect(app.view.thirdPerson).toBe(true); app.key("KeyV", true); app.key("KeyV", false); }
    crew[0]!.key("KeyC", true); crew[0]!.key("KeyC", false);
    const q = new Float64Array(4), local = new Float64Array(3), ray = new Float64Array(3), expected = new Float64Array(3);
    for (const attitude of [{ yaw: Math.PI / 2, pitch: 0, roll: 0 }, { yaw: .6, pitch: .4, roll: Math.PI / 2 }, { yaw: 0, pitch: 0, roll: Math.PI }]) {
      vehicleRotation({ x: 0, y: 0, z: 0, ...attitude }, q);
      ents.setPosition(e, 62, 70, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
      ents.vehicleQx[ents.vrow[e]!] = q[0]!; ents.vehicleQy[ents.vrow[e]!] = q[1]!; ents.vehicleQz[ents.vrow[e]!] = q[2]!; ents.vehicleQw[ents.vrow[e]!] = q[3]!;
      ents.vehicleYaw[ents.vrow[e]!] = attitude.yaw; ents.vehiclePitch[ents.vrow[e]!] = attitude.pitch; ents.vehicleRoll[ents.vrow[e]!] = attitude.roll;
      ents.vx[e] = ents.vy[e] = ents.vz[e] = ents.vehicleYawRate[ents.vrow[e]!] = ents.vehiclePitchRate[ents.vrow[e]!] = ents.vehicleRollRate[ents.vrow[e]!] = 0;
      ents.vehicleEngineOn[ents.vrow[e]!] = 1; ents.vehicleRotorRpm[ents.vrow[e]!] = 410; ents.vehicleCollective[ents.vrow[e]!] = .6;
      h.host.urban.syncAfterContact(e); run(250);
      for (let i = 0; i < crew.length; i++) {
        const app = crew[i]!, s = app.session, r = app.remote;
        let frame: VehicleFrame;
        if (i === 0) {
          const a = s.alpha;
          frame = { ...predictedVehiclePose(s.ownPrev, s.own, a, true), yaw: s.own.vehicleYaw,
            x: s.ownPrev.x + (s.own.x - s.ownPrev.x) * a + s.smoothX,
            y: s.ownPrev.y + (s.own.y - s.ownPrev.y) * a + s.smoothY,
            z: s.ownPrev.z + (s.own.z - s.ownPrev.z) * a + s.smoothZ };
        } else {
          const j = r.id.subarray(0, r.count).indexOf(e);
          expect(j).toBeGreaterThanOrEqual(0);
          frame = { ...remoteVehiclePose(r, j), x: r.x[j]!, y: r.y[j]!, z: r.z[j]!, yaw: r.yaw[j]! };
        }
        vehicleRotation(frame, q);
        quatUnrotate(q, 0, app.cam.x - frame.x, app.cam.y - frame.y, app.cam.z - frame.z, local, 0);
        expect(Math.abs(local[0]!)).toBeLessThan(1.25); expect(local[1]!).toBeGreaterThan(.55); expect(local[1]!).toBeLessThan(2.6);
        expect(local[2]!).toBeGreaterThan(-1.85); expect(local[2]!).toBeLessThan(2.45);
        quatRotate(q, 0, 0, 0, 1, expected, 0); app.cam.ray(.5, .5, ray);
        for (let k = 0; k < 3; k++) expect(ray[k]!).toBeCloseTo(expected[k]!, 5);
        expect(app.controls.yaw).toBeCloseTo(app.cam.yaw, 6); expect(app.controls.pitch).toBeCloseTo(app.cam.pitch, 6);
      }
    }
    // A passenger can look independently and return to the remembered chase bearing without changing the pilot's cyclic.
    const passenger = crew[2]!, pilot = crew[0]!, buttons = pilot.controls.buttons;
    passenger.look(80, -20); run(50);
    expect(pilot.controls.buttons).toBe(buttons); expect(pilot.controls.moveX).toBe(0); expect(pilot.controls.moveZ).toBe(0);
    for (const app of crew) { app.key("KeyV", true); app.key("KeyV", false); } run(50);
    for (const app of crew) expect(app.cam.roll).toBe(0);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
