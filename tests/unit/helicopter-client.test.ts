import { expect, test } from "bun:test";
import { Controls } from "../../client/core/controls.ts";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { buildHud, KEY_VEHICLE } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { vehicleSoundTargets } from "../../client/core/audio/vehicle.ts";
import { predictedVehiclePose } from "../../client/core/vehicle-view.ts";
import { HELICOPTER } from "../../content/vehicles/helicopter.ts";
import { Body, BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_PRIMARY, BTN_PRONE } from "../../shared/sim/character.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";

test("helicopter controls retain direct mode across key releases, isolate mouse look and clear on exit", () => {
  const c = new Controls();
  c.key("KeyC", true); c.key("KeyC", false); c.heli(true);
  expect(c.buttons).toBe(0);
  c.key("KeyC", true); c.key("KeyC", true); c.key("KeyC", false);
  expect(c.directFlight).toBe(true); expect(c.buttons).toBe(BTN_MOD);
  c.key("Space", true); c.key("KeyQ", true); c.key("KeyX", true);
  expect(c.buttons).toBe(BTN_MOD | BTN_JUMP | BTN_PRIMARY | BTN_PRONE);
  c.key("Space", false); c.key("KeyQ", false); c.key("KeyX", false);
  c.mouseButton(0, true); c.mouseButton(2, true); c.look(20, -10);
  expect(c.buttons).toBe(BTN_MOD); expect(c.yaw).not.toBe(0);
  c.key("ControlLeft", true); expect(c.buttons & BTN_CROUCH).toBe(BTN_CROUCH);
  c.heli(false); expect(c.buttons).toBe(0); expect(c.directFlight).toBe(false);
  c.mouseButton(0, true); expect(c.buttons).toBe(BTN_PRIMARY);
});

test("predicted aircraft presentation crosses inversion without an Euler jump or reverse spinning rotor", () => {
  const a = new Body(), b = new Body();
  a.vehicleQz = Math.sin(170 * Math.PI / 360); a.vehicleQw = Math.cos(170 * Math.PI / 360);
  b.vehicleQz = Math.sin(190 * Math.PI / 360); b.vehicleQw = Math.cos(190 * Math.PI / 360);
  a.vehicleRotorRpm = b.vehicleRotorRpm = 410; a.vehicleRotorPhase = 2.8; b.vehicleRotorPhase = -2.05;
  const pose = predictedVehiclePose(a, b, .5, true), at = [0, 0, 0];
  vehiclePoint({ ...pose, x: 10, y: 20, z: 30, yaw: 0 }, [0, 1, 0], at);
  expect(at[0]).toBeCloseTo(10, 6); expect(at[1]).toBeCloseTo(19, 6); expect(at[2]).toBeCloseTo(30, 6);
  expect(pose.rotorPhase!).toBeGreaterThan(a.vehicleRotorPhase);
});

test("rotor instruments show physical flight state in wide and portrait views and leave car audio silent", () => {
  const b = new Body(), v = new VehicleTelemetry(), hud = new HudModel();
  b.fuel = 72; b.vehicleRotorRpm = 410; b.vehicleCollective = .63; b.vehicleEngineOn = true; b.vy = -2.4; b.vz = 20;
  v.updateRotor(4, b, HELICOPTER, 12.6, true, false); hud.vehicle = v;
  expect(v.rpm).toBe(410); expect(v.vertical).toBe(-2.4); expect(v.collective).toBe(.63);
  expect(vehicleSoundTargets(v).engine).toBe(0);
  for (const aspect of [16 / 9, 9 / 16]) {
    const f = new UiFrame(); f.begin(aspect); buildHud(f, hud);
    const gauges = f.nodes.slice(0, f.count).filter(n => n.key >= KEY_VEHICLE && n.key < KEY_VEHICLE + 11);
    expect(gauges.length).toBe(11);
    for (const n of gauges) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThan(f.height); }
    expect(gauges.map(n => n.text)).toContain("DIRECT");
    expect(gauges.map(n => n.text)).toContain("12.6 m AGL · -2.4 m/s");
  }
});
