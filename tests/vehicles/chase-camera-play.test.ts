// The whole page but its drawing, at the wheel of a Zephyr over a line with lag: from its cruise on, through each boost
// and a frame that took 150 ms, the chase camera keeps its distance behind the car as it is drawn.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("a driver's chase camera keeps its distance through boosts and a long frame at speed", () => {
  const chunks = 32, x = (chunks * CHUNK_SIZE) / 2;
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(chunks)) });
  try {
    const app = new App(h.join("driver", { tcp: true, latencyMs: 30, jitterMs: 8 }, { manual: true }), h.reg, parsePack(corePackBytes()));
    const s = app.session;
    let stalled = 0;
    const run = (ms: number, each?: () => void): void => h.run(ms, (now) => {
      // A frame not drawn: the next one comes that much later.
      if (stalled > 0 && stalled-- > 0) return;
      app.frame(now, 640, 360);
      each?.();
    });
    run(400);
    const c = h.client(s)!, a = h.world.ents;
    const car = h.host.spawnVehicle("core:zephyr", x, 24, h.host.records.byPid.get(c.pid)!.team);
    expect(car).toBeGreaterThanOrEqual(0);
    a.setPosition(c.ent, x + 1.8, a.y[car]! + 0.05, 24.1);
    h.world.history.discontinuity(c.ent);
    expect(h.host.urban.mount(c, car)).toBe(0);
    run(1500);
    expect(s.driving).toBe(car);
    app.key("KeyW", true);
    app.key("ShiftLeft", true);
    const before = s.stats.corrections;
    let least = Infinity, most = 0, fastest = 0, stalls = 0, leap = 0, last = NaN;
    run(22000, () => {
      const speed = Math.hypot(s.own.vx, s.own.vz), at = app.director.carFrame;
      fastest = Math.max(fastest, speed);
      // Under way at its cruise: from here the boom is as long as it gets.
      if (speed < 44) return;
      const gap = Math.hypot(app.cam.x - at.x, app.cam.z - at.z);
      least = Math.min(least, gap);
      most = Math.max(most, gap);
      if (!Number.isNaN(last)) leap = Math.max(leap, Math.abs(gap - last));
      last = gap;
      // Nine frames not drawn, 150 ms, once at each of three speeds.
      if (stalls < 3 && speed > 50 + stalls * 12) { stalls++; stalled = 9; }
    });
    expect(fastest).toBeGreaterThan(75);
    expect(stalls).toBe(3);
    expect(most - least).toBeLessThan(0.6);
    expect(leap).toBeLessThan(0.3);
    expect(s.stats.corrections).toBe(before);
  } finally {
    h.host.shutdown();
  }
});
