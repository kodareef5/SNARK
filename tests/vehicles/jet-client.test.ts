// The jet on its pilot's client: the predicted flight equals the server's through a poor line, and the chase camera
// holds its boom behind the jet at full speed.

import { expect, test } from "bun:test";
import { BTN_JUMP, BTN_MOD, BTN_SPRINT } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { camp, pilot, screen, tap, vehicle, type Place } from "../kit/kit.ts";

/** Six kilometres of level ground, the survivor near its south edge. */
const RUNWAY: Place = { map: writeMap(flatMap(96)), at: () => ({ x: 3072, z: 300 }) };
const LINE = { latencyMs: 90, jitterMs: 10, loss: .02 };

test("the predicted jet equals the server's after each acknowledged tick at 180 ms and 2% loss", () => {
  const { h, ada, at } = camp({ place: RUNWAY, link: LINE });
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0, drive: true });
  const ents = h.world.ents, p = pilot(h, ada);
  p.yaw = p.pitch = 0;
  h.run(1000);
  ada.prediction.enabled = true;
  ada.prediction.differences.length = 0;
  const moved = ada.stats.corrections, states = ada.stats.stateCorrections;
  // Up in the hover, then on to wing-borne flight with full throttle, a bank to the left and a pull.
  p.buttons = BTN_MOD | BTN_JUMP;
  h.run(5000);
  p.buttons = BTN_MOD;
  p.moveZ = 1;
  h.run(25000);
  p.buttons = BTN_SPRINT;
  p.yaw = 1.2;
  p.pitch = .25;
  h.run(6000);
  p.moveX = -1;
  h.run(800);
  p.moveX = 0;
  h.run(3000);
  expect(Math.hypot(ents.vx[jet.e]!, ents.vy[jet.e]!, ents.vz[jet.e]!)).toBeGreaterThan(90);
  expect(ada.stats.undecodable).toBe(0);
  expect(ada.prediction.differences.map((d) => `${d.tick}: ${d.fields.map((f) => f.name).join(", ")}`)).toEqual([]);
  expect([ada.stats.corrections - moved, ada.stats.stateCorrections - states]).toEqual([0, 0]);
});

test("the chase camera holds its boom behind a jet at 160 m/s", () => {
  const { h, ada, at } = camp({ place: RUNWAY, screen: true });
  const view = screen(h, ada), app = view.app;
  vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0, drive: true });
  app.controls.yaw = app.controls.pitch = 0;
  h.run(500);
  expect(app.controls.onJet).toBe(true);
  // Taken at rest, VTOL is on: Space lifts it straight up, full throttle carries it into flight, and N stows the nozzle.
  app.key("Space", true);
  h.run(5000);
  app.key("Space", false);
  app.key("KeyW", true);
  h.run(25000);
  tap(h, view, "KeyN");
  expect(app.controls.vtol).toBe(false);
  app.key("ShiftLeft", true);
  app.controls.pitch = .02;
  const s = app.session, speed = (): number => Math.hypot(s.own.vx, s.own.vy, s.own.vz);
  for (let t = 0; t < 40 && speed() < 155; t++) h.run(1000);
  expect(speed()).toBeGreaterThan(155);
  // Each frame the camera goes as far as the jet does, with no jerk at a tick's edge, and keeps the boom behind it.
  const steps: number[] = [], gaps: number[] = [];
  let x = app.cam.x, y = app.cam.y, z = app.cam.z;
  for (let frame = 0; frame < 240; frame++) {
    h.run(1000 / 60);
    steps.push(Math.hypot(app.cam.x - x, app.cam.y - y, app.cam.z - z) / (speed() / 60));
    x = app.cam.x; y = app.cam.y; z = app.cam.z;
    // From the last predicted tick, which the drawn jet is up to a tick behind.
    if (frame % 15 === 0) gaps.push(Math.hypot(x - s.own.x, y - s.own.y, z - s.own.z));
  }
  const boom = 15.6;
  expect(Math.min(...gaps)).toBeGreaterThan(boom);
  expect(Math.max(...gaps)).toBeLessThan(boom * 4 / 3 + 160 / 30 + 1);
  expect(Math.min(...steps), steps.map((n) => n.toFixed(2)).join(" ")).toBeGreaterThan(.8);
  expect(Math.max(...steps), steps.map((n) => n.toFixed(2)).join(" ")).toBeLessThan(1.2);
});
