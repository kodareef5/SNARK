import { expect, test } from "bun:test";
import { AIR_PHASE, emptyAirSupport, readAirSupport, writeAirSupport } from "../../shared/sim/air-support.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";

test("a cut delivery feed leaves the last complete view in place", () => {
  const view = emptyAirSupport();
  const pose = { id: 8, x: -14, y: 26, z: 80, yaw: 0.75 };
  view.tick = 80;
  view.order = 8;
  view.flight = 21;
  view.pod = 18;
  view.notice = "Stop to receive the trailer.";
  view.carriers.push({ ...pose, ent: 9, pitch: .5, roll: -.25, phase: AIR_PHASE.follow, loaded: true, trailer: true, jaws: 0 });
  view.pods.push({ ...pose, id: 18, ent: 77, hitched: true, open: 1, slots: 35, selected: 5 });
  view.drones.push({ ...pose, id: 21, fuel: 0.6, pitch: 0.5, bay: 3 });
  const w = new BitWriter(512);
  writeAirSupport(w, view);
  expect(readAirSupport(new BitReader(w.bytes()))).toEqual(view);
  expect(readAirSupport(new BitReader(w.bytes().slice(0, -3)))).toBeNull();
});
