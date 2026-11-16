import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { LOOK_SPEED } from "../../client/core/controls.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { corePack } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

test("the first native camera and forward steps honor the map facing and retain the player's look", () => {
  for (const [yaw, loadingLook] of [[16384, 0], [49152, -80]] as const) {
    const hf = new Heightfield({ chunksX: 2, chunksZ: 2 }, 2, 0, 1 / 256);
    hf.heights.fill(256);
    const map = writeMap({ id: `test:spawn-facing-${yaw}`, dims: hf.dims, minY: hf.minY, stepY: hf.stepY,
      seaLevel: -Infinity, heights: hf.heights, tint: hf.tint, statics: [], nodes: [],
      spawns: [{ name: "Quay", x: 64, z: 64, yaw }] });
    const h = new Harness({}, yaw, 60, { map });
    try {
      const session = h.join("visitor", { latencyMs: 40, jitterMs: 8 }, { manual: true });
      const app = new App(session, h.reg, corePack());
      app.frame(0, 800, 450);
      app.look(loadingLook, 0);
      h.run(500, now => app.frame(now, 800, 450));
      const initial = yaw * Math.PI * 2 / 65536 - loadingLook * LOOK_SPEED;
      expect(app.controls.yaw).toBeCloseTo(initial, 6);
      expect(app.cam.yaw).toBeCloseTo(initial, 6);
      expect(session.ownYaw).toBeCloseTo(initial, 6);
      const before = { x: session.own.x, z: session.own.z };
      app.key("KeyW", true);
      h.run(1100, now => app.frame(now, 800, 450));
      app.key("KeyW", false);
      h.run(250, now => app.frame(now, 800, 450));
      const dx = session.own.x - before.x, dz = session.own.z - before.z;
      expect(dx * Math.sin(initial) + dz * Math.cos(initial)).toBeGreaterThan(3);
      expect(Math.abs(dx * Math.cos(initial) - dz * Math.sin(initial))).toBeLessThan(.05);
      app.look(100, -20);
      h.run(500, now => app.frame(now, 800, 450));
      expect(app.controls.yaw).toBeCloseTo(initial - 100 * LOOK_SPEED, 6);
      expect(app.cam.yaw).toBeCloseTo(app.controls.yaw, 6);
      expect(app.controls.pitch).toBeCloseTo(20 * LOOK_SPEED, 6);
      expect(session.own.x).toBe(h.world.ents.x[h.ent(session)]!);
      expect(session.own.z).toBe(h.world.ents.z[h.ent(session)]!);
    } finally { h.host.shutdown(); }
  }
});
