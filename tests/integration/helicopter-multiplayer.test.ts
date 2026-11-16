import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_MOD, BTN_PRONE, BTN_PRIMARY } from "../../shared/sim/character.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const LINK = { latencyMs: 70, jitterMs: 12, loss: .02 };
test("four players stay grouped through real helicopter flight over delayed links and observers receive full attitude", () => {
  const h = new Harness({}, 14, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(8)) });
  try {
    const crew = ["pilot", "front", "rear-left", "rear-right"].map(name => h.join(name, LINK)); h.run(1200);
    const pilot = h.client(crew[0]!)!, e = h.host.spawnVehicle("core:helicopter", 180, 180, 0), ents = h.world.ents;
    expect(e).toBeGreaterThanOrEqual(0);
    const def = h.reg.vehicle[ents.kind[e]!]!;
    for (let i = 0; i < crew.length; i++) {
      const c = h.client(crew[i]!)!, entry = def.seats[i]!.entry;
      ents.setPosition(c.ent, 180 + entry[0], entry[1], 180 + entry[2]);
      expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1100);
      expect(ents.seatSlot[c.ent]).toBe(i + 1);
    }
    h.pilots[0]!.yaw = .6; h.pilots[0]!.pitch = .3;
    h.run(500); const before = crew.map(c => c.stats.corrections);
    expect(ents.yaw[pilot.ent]).toBe(pilot.heldYaw); expect(ents.pitch[pilot.ent]).toBe(pilot.heldPitch);
    h.pilots[0]!.buttons = BTN_JUMP; h.run(12000);
    expect(ents.y[e]!).toBeGreaterThan(35);
    expect(crew[0]!.driving).toBe(e);
    // Passengers can look around and press fire, but cabin policy forbids action state/shot creation.
    for (let i = 1; i < crew.length; i++) { h.pilots[i]!.buttons = BTN_PRIMARY; h.pilots[i]!.yaw = 1.3 * i; }
    h.pilots[0]!.buttons = BTN_MOD; h.pilots[0]!.moveX = 127;
    let inverted = false;
    for (let k = 0; k < 30; k++) {
      h.run(100);
      const qx = ents.vehicleQx[e]!, qy = ents.vehicleQy[e]!, qz = ents.vehicleQz[e]!, qw = ents.vehicleQw[e]!;
      inverted ||= 1 - 2 * (qx * qx + qz * qz) < -.7;
      const frame = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[e]!, pitch: ents.vehiclePitch[e]!, roll: ents.vehicleRoll[e]!, qx, qy, qz, qw };
      for (let i = 0; i < crew.length; i++) {
        const c = h.client(crew[i]!)!, anchor = [0, 0, 0]; vehiclePoint(frame, def.seats[i]!.anchor, anchor);
        expect(ents.seat[c.ent]).toBe(e + 1);
        // The server pins the pelvis after its species/proportion solve; its origin stays within one seated body of it.
        expect(Math.hypot(ents.x[c.ent]! - anchor[0]!, ents.y[c.ent]! - anchor[1]!, ents.z[c.ent]! - anchor[2]!)).toBeLessThan(1.5);
        expect(c.did).toBe(0);
      }
    }
    expect(inverted).toBe(true);
    const remote = new RemoteSample(); crew[1]!.sampleRemote(remote);
    const at = remote.id.indexOf(e); expect(at).toBeGreaterThanOrEqual(0);
    expect(remote.vehicleRotorRpm[at]!).toBeGreaterThan(350);
    expect(Math.hypot(remote.vehicleQx[at]!, remote.vehicleQy[at]!, remote.vehicleQz[at]!, remote.vehicleQw[at]!)).toBeCloseTo(1, 5);
    h.pilots[0]!.moveX = 0; h.pilots[0]!.buttons = BTN_PRONE | BTN_JUMP; h.run(2000);
    expect(pilot.drive).toBe(e);
    expect(crew.map((s, i) => s.stats.corrections - before[i]!)).toEqual([0, 0, 0, 0]);
  } finally { h.host.shutdown(); }
});
