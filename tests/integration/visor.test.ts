// The Meridian helmet's visor in the whole client (client/core/visor.ts, D1033).

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { zoomed } from "../../client/core/optics.ts";
import { DRAW_HEAT_SHIFT, DRAW_SKINNED, HEAT_COLD, HEAT_WARM, OPTIC_AT, OPTIC_HEAT, OPTIC_NIGHT } from "../../client/core/render/packet.ts";
import { VISOR_FIRST } from "../../client/core/visor.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("in the whole client: the issued helmet's visor held up zooms from the eye, its window a wide box, the server told; N turns night vision on; let go, all as it was", () => {
  // As the server ships, every survivor comes to life in the Meridian set (D957).
  const h = new Harness({}, 1, 60, { dev: true, config: asShipped() });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  app.ui.settings.thirdPerson = true;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1500);
  const base = (app.ui.settings.fov * Math.PI) / 180;
  expect([app.hud.visor, app.hud.behind]).toEqual([false, true]);
  app.visor.held = true;
  run(1500);
  expect([app.hud.visor, app.view.atEye, app.hud.behind]).toEqual([true, true, false]);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, VISOR_FIRST), 3);
  expect(h.host.gaze.count).toBe(1);
  let packet = app.frame(h.now, 1280, 720)!;
  // Wide open at four times: the whole width, and most of the height.
  expect([packet.window[0], packet.window[2]]).toEqual([0, 1]);
  expect(packet.window[3]! - packet.window[1]!).toBeGreaterThan(0.6);
  // Narrowed, a slit.
  app.visor.zoom = 400;
  run(1500);
  packet = app.frame(h.now, 1280, 720)!;
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 400), 4);
  expect(packet.window[2]! - packet.window[0]!).toBeLessThan(0.6);
  expect(packet.window[3]! - packet.window[1]!).toBeLessThan(0.35);
  expect(app.hud.visorDigital).toBe(true);
  // N: night vision, not the held weapon's attachment.
  expect(packet.frame[OPTIC_AT]).toBe(0);
  app.key("KeyN", true);
  app.key("KeyN", false);
  run(200);
  expect(app.hud.visorMode).toBe(OPTIC_NIGHT);
  expect(app.frame(h.now, 1280, 720)!.frame[OPTIC_AT]).toBe(OPTIC_NIGHT);
  // Let go: the view as it was, behind, the server told.
  app.visor.held = false;
  run(1500);
  packet = app.frame(h.now, 1280, 720)!;
  expect([app.hud.visor, app.view.atEye, app.hud.behind, h.host.gaze.count]).toEqual([false, false, true, 0]);
  expect(app.cam.fovY).toBeCloseTo(base, 4);
  expect([...packet.window, packet.frame[OPTIC_AT]]).toEqual([0, 0, 0, 0, 0]);
});

test("in the whole client: through the visor's heat view another survivor's draws are warm and a turtle's cold; out of it no draw says how hot it is", () => {
  const h = new Harness({}, 1, 60, { dev: true, config: asShipped() });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  h.join("bob");
  app.ui.settings.thirdPerson = false;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1500);
  const s = app.session;
  const turtle = h.host.spawnCreature("core:carbonemys", s.own.x, s.own.z + 8, 5);
  expect(turtle).toBeGreaterThanOrEqual(0);
  app.controls.yaw = 0;
  app.controls.pitch = -0.1;
  run(1500);
  const heats = (): number[] => {
    const p = app.frame(h.now, 1280, 720)!;
    const out = [0, 0, 0, 0];
    for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_SKINNED) !== 0) out[(p.drawFlags[d]! >>> DRAW_HEAT_SHIFT) & 3]!++;
    return out;
  };
  expect(heats().slice(1)).toEqual([0, 0, 0]);
  app.visor.held = true;
  app.visor.zoom = 2;
  app.visor.mode = OPTIC_HEAT;
  run(1500);
  expect(app.frame(h.now, 1280, 720)!.frame[OPTIC_AT]).toBe(OPTIC_HEAT);
  const seen = heats();
  expect(seen[HEAT_COLD]).toBeGreaterThan(0);
  expect(seen[HEAT_WARM]).toBeGreaterThan(0);
  app.visor.held = false;
  run(1500);
  expect(heats().slice(1)).toEqual([0, 0, 0]);
});
