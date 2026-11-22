// The Meridian helmet's visor in the whole client (client/core/visor.ts, D1080).

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { zoomed } from "../../client/core/optics.ts";
import { DRAW_HEAT_SHIFT, DRAW_SKINNED, HEAT_COLD, HEAT_HOT, HEAT_WARM, HEAT_WORLD, OPTIC_AT, OPTIC_HEAT, OPTIC_NIGHT } from "../../client/core/render/packet.ts";
import { kindHeat } from "../../client/core/render/characters.ts";
import { VISOR_FIRST } from "../../client/core/visor.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { FLAG_ON } from "../../shared/sim/items.ts";
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

test("in the whole client: through the visor's heat view the survivors' draws say they are warm; out of it no draw says how hot it is; a turtle is cold-blooded, a dodo warm, a car as the world", () => {
  const h = new Harness({}, 1, 60, { dev: true, config: asShipped() });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  h.join("bob");
  app.ui.settings.thirdPerson = false;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1500);
  app.controls.yaw = 0;
  app.controls.pitch = -0.1;
  run(500);
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
  expect([seen[HEAT_WARM]! > 0, seen[HEAT_COLD], seen[HEAT_HOT]]).toEqual([true, 0, 0]);
  app.visor.held = false;
  run(1500);
  expect(heats().slice(1)).toEqual([0, 0, 0]);
  // The kinds the test pack has no rigs for, by their content.
  const at = (name: string): number => h.reg.index.get(name)!;
  expect([kindHeat(h.reg, at("core:carbonemys")), kindHeat(h.reg, at("core:dodo")), kindHeat(h.reg, at("core:survivor")), kindHeat(h.reg, at("core:compact"))]).toEqual([HEAT_COLD, HEAT_WARM, HEAT_WARM, HEAT_WORLD]);
});

test("in the whole client: N held raises the visor and held again lowers it; a tap while it is up turns its view, and G is melee again", () => {
  const h = new Harness({}, 1, 60, { dev: true, config: asShipped() });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  app.ui.settings.thirdPerson = false;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1500);
  // A tap does not raise it.
  app.key("KeyN", true);
  run(100);
  app.key("KeyN", false);
  run(500);
  expect([app.visor.held, app.hud.visor]).toEqual([false, false]);
  app.key("KeyN", true);
  run(700);
  app.key("KeyN", false);
  run(1000);
  expect([app.visor.held, app.hud.visor]).toEqual([true, true]);
  // Up, a tap turns its view.
  app.key("KeyN", true);
  run(100);
  app.key("KeyN", false);
  run(200);
  expect(app.hud.visorMode).toBe(OPTIC_NIGHT);
  app.key("KeyN", true);
  run(700);
  app.key("KeyN", false);
  run(1000);
  expect([app.visor.held, app.hud.visor]).toEqual([false, false]);
  // G is melee again, not the visor's.
  app.key("KeyG", true);
  run(100);
  app.key("KeyG", false);
  run(300);
  expect(app.visor.held).toBe(false);
});

test("in the whole client: with the helmet worn a tap of N still switches the held weapon's laser, sent as the tap ends", () => {
  const h = new Harness({}, 1, 60, { dev: true, config: asShipped() });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1500);
  const s = app.session;
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const items = h.host.items, at = (name: string): number => h.reg.index.get(name)!;
  items.mint(rec, at("core:pistol"), 1);
  items.mint(rec, at("core:laser"), 1);
  run(300);
  const slot = takeInHand(h, s, at("core:pistol"));
  expect(items.attach(rec, slot, items.inv(rec).item.indexOf(at("core:laser")))).toBe(true);
  run(400);
  app.key("KeyN", true);
  run(100);
  app.key("KeyN", false);
  run(500);
  expect([items.inv(rec).flags[slot], app.visor.held]).toEqual([FLAG_ON, false]);
});
