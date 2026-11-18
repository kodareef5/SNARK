import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { type ClientSession, RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { CMD_VEHICLE, RESULT_DENIED, RESULT_INVALID, RESULT_OK, VEHICLE_LIGHTS } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { Harness } from "../fixtures/net.ts";

test("a driver changes the lightbar while moving, other clients see it, and its parked mode survives reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-patrol-")), options = { dev: true, clips: NO_CLIPS, rigs: [], dbPath: join(dir, "world.db") };
  let h = new Harness({}, 1, 60, options);
  try {
    const driver = h.join("driver"), passenger = h.join("passenger"); h.run(450);
    const x = h.world.spawn.x, z = h.world.spawn.z - 8;
    h.say(driver, "enablecheats"); h.say(passenger, "enablecheats");
    h.say(driver, `tp ${x + 1.55} ${z + .22}`); h.say(passenger, `tp ${x - 1.55} ${z + .22}`);
    const jeep = h.host.spawnVehicle("core:patrol_jeep", x, z, 0, 0), compact = h.host.spawnVehicle("core:compact", x + 13, z, 0, 0);
    const ents = h.world.ents, pid = ents.pid[jeep]!, handle = makeHandle(jeep, ents.gen[jeep]!);
    expect(h.host.urban.mount(h.client(driver)!, jeep)).toBe(RESULT_OK);
    expect(h.host.urban.mount(h.client(passenger)!, jeep)).toBe(RESULT_OK);
    h.run(1200);
    expect(driver.driving).toBe(jeep); expect(passenger.own.seatSlot).toBe(2);
    const requested = (s: ClientSession, target: number) => {
      let code = -1; s.onResult = (_, result) => { code = result; };
      s.command(CMD_VEHICLE, w => { w.u8(VEHICLE_LIGHTS); w.u32(target); }); h.run(200); return code;
    };
    expect(requested(passenger, handle)).toBe(RESULT_DENIED);
    expect(requested(driver, makeHandle(jeep, ents.gen[jeep]! + 1))).toBe(RESULT_INVALID);
    expect(requested(driver, makeHandle(compact, ents.gen[compact]!))).toBe(RESULT_INVALID);
    const app = new App(driver, h.reg, parsePack(buildPack([], defaultPalette()))), remote = new RemoteSample();
    const observe = (s: ClientSession) => {
      s.sampleRemote(remote);
      return remote.vehicleLightMode[remote.id.subarray(0, remote.count).indexOf(jeep)];
    };
    h.pilots[0]!.moveZ = 1;
    for (const mode of [1, 2, 3, 0, 1, 2]) {
      driver.sampleRemote(app.remote);
      expect(app.key("KeyK", true)).toBe(true);
      app.key("KeyK", true, true); app.key("KeyK", false);
      h.run(350);
      expect(observe(driver)).toBe(mode); expect(observe(passenger)).toBe(mode);
    }
    expect(driver.own.z).toBeGreaterThan(z + 2);
    h.pilots[0]!.moveZ = 0; h.pilots[0]!.buttons = BTN_JUMP; h.run(1700);
    h.host.urban.dismount(h.client(driver)!);
    h.run(900);
    expect(driver.driving).toBe(-1);
    expect(requested(driver, handle)).toBe(RESULT_DENIED);
    const arriving = h.join("observer"); h.run(500);
    expect(observe(arriving)).toBe(2);
    h.host.shutdown();
    h = new Harness({}, 1, 60, options);
    const restored = h.world.ents, e = h.host.records.entOf.get(pid)!;
    expect(restored.vehicleLightMode[restored.vrow[e]!]).toBe(2);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
