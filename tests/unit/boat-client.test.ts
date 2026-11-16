import { expect, test } from "bun:test";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { buildHud, KEY_VEHICLE } from "../../client/core/ui/hud.ts";
import { UiFrame, textWidth } from "../../client/core/ui/nodes.ts";
import { vehicleSoundTargets } from "../../client/core/audio/vehicle.ts";
import { predictedVehiclePose, remoteVehiclePose } from "../../client/core/vehicle-view.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { BOAT } from "../../content/vehicles/boat.ts";
import { Body } from "../../shared/sim/character.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";

test("capsized predicted and observed boats share one full-attitude render pose and reverse prop rotation", () => {
  const a = new Body(), b = new Body();
  a.vehicleQz = Math.sin(170 * Math.PI / 360); a.vehicleQw = Math.cos(170 * Math.PI / 360);
  b.vehicleQz = Math.sin(190 * Math.PI / 360); b.vehicleQw = Math.cos(190 * Math.PI / 360);
  a.vehicleRpm = b.vehicleRpm = 4000; a.vehicleGear = b.vehicleGear = -1;
  a.wheelAngle = 2.8; b.wheelAngle = (a.wheelAngle - 4000 * 2 * Math.PI / 60 / 30) % (Math.PI * 2);
  const pose = predictedVehiclePose(a, b, .5, false, true), at = [0, 0, 0];
  vehiclePoint({ ...pose, x: 10, y: 20, z: 30, yaw: 0 }, [0, 1, 0], at);
  expect(at[0]).toBeCloseTo(10, 6); expect(at[1]).toBeCloseTo(19, 6); expect(at[2]).toBeCloseTo(30, 6);
  expect(pose.wheelAngle).toBeLessThan(a.wheelAngle - Math.PI);
  const remote = new RemoteSample(); remote.vehicleBoat[0] = 1; remote.vehicleQz[0] = 1; remote.vehicleFlooding[0] = .5;
  const observed = remoteVehiclePose(remote, 0); expect(observed.qz).toBe(1); expect(observed.flooding).toBe(.5);
});

test("marine instruments fit wide and portrait views and do not emit placeholder car audio", () => {
  const b = new Body(), v = new VehicleTelemetry(), hud = new HudModel();
  b.fuel = 72; b.vehicleRpm = 4500; b.vehicleGear = -1; b.vehicleEngineOn = true; b.vz = -4; b.vehicleFlooding = .2;
  v.updateBoat(4, b, BOAT, true); hud.vehicle = v;
  expect(v.rpm).toBe(4500); expect(v.gear).toBe(-1); expect(v.flooding).toBe(.2);
  expect(vehicleSoundTargets(v).engine).toBe(0);
  for (const aspect of [16 / 9, 9 / 16]) {
    const f = new UiFrame(); f.begin(aspect); buildHud(f, hud);
    const gauges = f.nodes.slice(0, f.count).filter(n => n.key >= KEY_VEHICLE && n.key < KEY_VEHICLE + 11);
    expect(gauges.length).toBe(11);
    for (const n of gauges) {
      expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThan(f.height);
      if (n.text) expect(textWidth(n.text, n.style)).toBeLessThanOrEqual(n.w + 1);
    }
    expect(gauges.map(n => n.text)).toContain("REVERSE"); expect(gauges.map(n => n.text)).toContain("PRECISION THROTTLE");
  }
  b.vehicleQz = 1; b.vehicleQw = 0; v.updateBoat(4, b, BOAT, false);
  expect(v.capsized).toBe(true);
  const f = new UiFrame(); f.begin(9 / 16); buildHud(f, hud);
  expect(f.nodes.slice(0, f.count).map(n => n.text)).toContain("CAPSIZED - E to escape");
});
