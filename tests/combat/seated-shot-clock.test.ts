import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { Lasers } from "../../client/core/render/laser.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { SeatedAim } from "../../client/core/seated-aim.ts";
import { EVENT_SHOT, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";

test("a moving passenger fires before the first App frame from the reported carrier clock, once through replay", () => {
  const pack = frozenPack(), h = new Harness({}, 13, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(4)) });
  try {
    const driver = h.join("aim-driver"), passenger = h.join("aim-passenger", { latencyMs: 80, jitterMs: 10, loss: .02 });
    h.run(1500); h.say(passenger, "enablecheats"); h.say(passenger, "kit pistol"); h.run(500);
    takeInHand(h, passenger, h.reg.index.get("core:pistol")!); h.run(6000);
    const a = h.client(driver)!, b = h.client(passenger)!, { ents } = h.world;
    const car = h.host.spawnVehicle("core:compact", 128, 120, 0);
    ents.setPosition(a.ent, 129.6, 0, 120.12); ents.setPosition(b.ent, 126.4, 0, 120.12);
    expect(h.host.urban.mount(a, car)).toBe(RESULT_OK); expect(h.host.urban.mount(b, car)).toBe(RESULT_OK); h.run(1500);
    const app = new App(passenger, h.reg, pack); app.steer = false;
    expect(app.scene).toBeNull(); expect(passenger.weaponsAllowed).toBe(true); expect(driver.weaponsAllowed).toBe(false);
    h.pilots[0]!.moveZ = 1; h.pilots[0]!.moveX = .12; h.run(1200);
    const rounds = passenger.own.rounds, start = passenger.fired.length;
    const eventStart = driver.events.length;
    let shown = 0, ownEye = 0, calls = 0;
    const origin = passenger.shotOrigin!;
    passenger.shotOrigin = (out, tick, yaw, pitch) => {
      calls++; const ok = origin(out, tick, yaw, pitch); shown = passenger.shown;
      ownEye = passenger.own.y + 1.62; expect(ok).toBe(true); return ok;
    };
    h.pilots[1]!.yaw = 1.1; h.pilots[1]!.pitch = .2; h.pilots[1]!.buttons = BTN_PRIMARY | BTN_SECONDARY;
    h.run(100); h.pilots[1]!.buttons = BTN_SECONDARY; h.run(1100);
    expect(calls).toBe(1); expect(passenger.fired.length - start).toBe(1);
    expect(passenger.own.rounds).toBe(rounds - 1); expect(ents.rounds[b.ent]).toBe(rounds - 1);
    const local = passenger.fired[start]!, shots = driver.events.slice(eventStart).filter(e => e.kind === EVENT_SHOT);
    expect(shots.length).toBe(1);
    const server = shots[0]!;
    expect(Math.hypot(server.x - local.x, server.y - local.y, server.z - local.z)).toBeLessThan(.12);
    expect(Math.abs(local.y - ownEye)).toBeGreaterThan(.2);
    expect(shown).toBeGreaterThan(0); expect(shown).toBeLessThan(h.world.tick - 20);
    expect(app.scene).toBeNull(); // Origin resolution did not depend on a rendered frame or a cached camera.
  } finally { h.host.shutdown(); }
});

test("local lasers skip a passenger's own full-attitude carrier when the local actor is absent from remote snapshots", () => {
  const pack = frozenPack(), h = new Harness({}, 3, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(2)) });
  try {
    const r = new RemoteSample(), kind = h.reg.index.get("core:compact")!;
    r.count = 1; r.id[0] = 14; r.gen[0] = 3; r.kind[0] = kind; r.x[0] = r.z[0] = 60; r.y[0] = 5; r.vehicleQw[0] = 1;
    const lasers = new Lasers(), aim = new SeatedAim(h.reg, pack);
    // This deliberately low ray crosses the actual hull. Without attachment exclusion it makes a false dot.
    lasers.cast(h.reg, h.world, r, 60, 5.4, 60, 1, 0, 0, 0, 0, 7, aim, 14, 3);
    expect(lasers.count).toBe(0);
    lasers.cast(h.reg, h.world, r, 55, 5.4, 60, 1, 0, 0, 0, 0, 7, aim, 14, 4);
    expect(lasers.count).toBe(1); expect(lasers.dots[0]!.x).toBeGreaterThan(58); expect(lasers.dots[0]!.x).toBeLessThan(60);
  } finally { h.host.shutdown(); }
});

test("remote lasers retain open passenger aim and stow in driver and enclosed cabin seats", () => {
  const pack = frozenPack(), h = new Harness({}, 3, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(flatMap(2)) });
  try {
    const r = new RemoteSample(), lasers = new Lasers(), aim = new SeatedAim(h.reg, pack);
    r.count = 2; r.tick = 20; r.id[0] = 14; r.gen[0] = 3; r.x[0] = r.z[0] = 60; r.y[0] = 5; r.vehicleQw[0] = 1;
    r.id[1] = 7; r.kind[1] = h.reg.index.get("core:survivor")!; r.seat[1] = 15; r.seatGen[1] = 3; r.seatSlot[1] = 2; r.on[1] = 1;
    h.world.structs.add(h.reg.index.get("core:wall")!, 60, 5, 63, 0, 0, 1);
    for (const vehicle of ["compact", "boat", "helicopter"]) for (const slot of [1, 2]) {
      r.kind[0] = h.reg.index.get(`core:${vehicle}`)!; r.seatSlot[1] = slot;
      lasers.clear(); lasers.remotes(h.reg, h.world, r, 0, aim);
      expect(lasers.count).toBe(vehicle === "compact" && slot === 2 ? 1 : 0);
    }
  } finally { h.host.shutdown(); }
});
