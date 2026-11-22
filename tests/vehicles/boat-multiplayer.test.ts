import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_SPRINT, BTN_PRIMARY, MODE_SWIM } from "../../shared/sim/character.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const LINK = { latencyMs: 70, jitterMs: 12, loss: .02 };
test("four players stay grouped through planing and docking over delayed links with deterministic owner prediction", () => {
  const h = new Harness({}, 14, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8, { seaLevel: 4 })) });
  try {
    const crew = ["pilot", "front", "rear-left", "rear-right"].map(name => h.join(name, LINK)); h.run(1200);
    const pilot = h.client(crew[0]!)!, e = h.host.spawnVehicle("core:boat", 180, 180, 0), ents = h.world.ents;
    expect(e).toBeGreaterThanOrEqual(0);
    const def = h.reg.vehicle[ents.kind[e]!]!;
    for (let i = 0; i < crew.length; i++) {
      const c = h.client(crew[i]!)!, entry = def.seats[i]!.entry;
      ents.setPosition(c.ent, 180 + entry[0], 2.65, 180 + entry[2]);
      ents.mode[c.ent] = MODE_SWIM;
      expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1100);
      expect(ents.seatSlot[c.ent]).toBe(i + 1);
    }
    h.pilots[0]!.yaw = .6; h.pilots[0]!.pitch = .3;
    h.run(500); const before = crew.map(c => c.stats.corrections);
    expect(ents.yaw[pilot.ent]).toBe(pilot.heldYaw); expect(ents.pitch[pilot.ent]).toBe(pilot.heldPitch);
    h.pilots[0]!.moveZ = 127; h.run(9000);
    expect(Math.hypot(ents.vx[e]!, ents.vz[e]!)).toBeGreaterThan(12);
    expect(ents.y[e]!).toBeGreaterThan(3.3); expect(ents.y[e]!).toBeLessThan(4);
    expect(crew[0]!.driving).toBe(e);
    for (let i = 1; i < crew.length; i++) { h.pilots[i]!.buttons = BTN_PRIMARY; h.pilots[i]!.yaw = 1.3 * i; }
    h.pilots[0]!.moveX = 35;
    for (let k = 0; k < 20; k++) {
      h.run(100);
      const qx = ents.vehicleQx[ents.vrow[e]!]!, qy = ents.vehicleQy[ents.vrow[e]!]!, qz = ents.vehicleQz[ents.vrow[e]!]!, qw = ents.vehicleQw[ents.vrow[e]!]!;
      const frame = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[ents.vrow[e]!]!, pitch: ents.vehiclePitch[ents.vrow[e]!]!, roll: ents.vehicleRoll[ents.vrow[e]!]!, qx, qy, qz, qw };
      for (let i = 0; i < crew.length; i++) {
        const c = h.client(crew[i]!)!, anchor = [0, 0, 0]; vehiclePoint(frame, def.seats[i]!.anchor, anchor);
        expect(ents.seat[c.ent]).toBe(e + 1);
        expect(Math.hypot(ents.x[c.ent]! - anchor[0]!, ents.y[c.ent]! - anchor[1]!, ents.z[c.ent]! - anchor[2]!)).toBeLessThan(1.5);
        expect(c.did).toBe(0);
      }
    }
    const remote = new RemoteSample(); crew[1]!.sampleRemote(remote);
    const at = remote.id.indexOf(e); expect(at).toBeGreaterThanOrEqual(0); expect(remote.vehicleBoat[at]).toBe(1);
    expect(remote.vehicleRpm[at]!).toBeGreaterThan(4000);
    expect(Math.hypot(remote.vehicleQx[at]!, remote.vehicleQy[at]!, remote.vehicleQz[at]!, remote.vehicleQw[at]!)).toBeCloseTo(1, 5);
    h.pilots[0]!.moveX = 0; h.pilots[0]!.buttons = BTN_SPRINT; h.run(1000);
    expect(ents.vehicleRpm[ents.vrow[e]!]!).toBeLessThan(4000);
    h.pilots[0]!.buttons = BTN_JUMP; h.run(300);
    expect(ents.vehicleGear[ents.vrow[e]!]).toBe(0); expect(Math.hypot(ents.vx[e]!, ents.vz[e]!)).toBeGreaterThan(2);
    expect(pilot.drive).toBe(e);
    expect(crew.map((s, i) => s.stats.corrections - before[i]!)).toEqual([0, 0, 0, 0]);
    // Lost pilot control cannot leave the motor driving forever or detach remaining passengers.
    h.pilots[0]!.buttons = 0; h.pilots[0]!.moveZ = 127; h.run(300);
    expect(ents.vehicleEngineOn[ents.vrow[e]!]).toBe(1);
    h.ends[0]!.close(); h.run(500);
    expect(pilot.drive).toBe(-1); expect(ents.vehicleEngineOn[ents.vrow[e]!]).toBe(0); expect(ents.vehicleGear[ents.vrow[e]!]).toBe(0);
    for (const session of crew.slice(1)) expect(ents.seat[h.client(session)!.ent]).toBe(e + 1);
    expect([ents.x[e], ents.y[e], ents.z[e], ents.vx[e], ents.vz[e]].every(Number.isFinite)).toBe(true);
  } finally { h.host.shutdown(); }
});
