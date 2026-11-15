import { expect, test } from "bun:test";
import { PredictionTrace } from "../../client/core/diagnostics.ts";
import { ClientSession, RemoteSample } from "../../client/core/session.ts";
import { Body } from "../../shared/sim/character.ts";
import { packVehicleDrive } from "../../shared/sim/vehicle-body.ts";
import { EntityView, type ViewRing } from "../../shared/net/view.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("vehicle observers blend engine speed but select actual gears and shift state at the nearer snapshot", () => {
  const conn: Connection = { send() {}, close() {}, open: true, onMessage: null, onClose: null };
  const registry = coreRegistry();
  const s = new ClientSession(conn, { registry, name: "observer", key: new Uint8Array(32), spectate: true, resolveMap: () => null });
  // Exact received-view fixtures isolate observer sampling from transport, whose codec has its own tests.
  const views = (s as unknown as { drawn: ViewRing<EntityView> }).drawn;
  for (const [tick, gear, rpm, shifting] of [[100, 2, 5800, 0], [102, 3, 3900, 1]] as const) {
    const view = views.alloc(tick);
    view.push(4, 1, registry.index.get("urban:compact")!, 0, 0, 0, 0, 0, 0);
    view.vehicleDrive[0] = packVehicleDrive(gear, rpm, shifting !== 0);
  }
  const remote = new RemoteSample();
  s.renderClock = 100.5; s.sampleRemote(remote, 0);
  expect(remote.vehicleRpm[0]).toBe(5325);
  expect(remote.vehicleGear[0]).toBe(2); expect(remote.vehicleShifting[0]).toBe(0);
  s.renderClock = 101.5; s.sampleRemote(remote, 0);
  expect(remote.vehicleRpm[0]).toBe(4375);
  expect(remote.vehicleGear[0]).toBe(3); expect(remote.vehicleShifting[0]).toBe(1);
  // Reused entity IDs cannot blend the old occupant's engine into a replacement.
  views.find(102)!.gen[0] = 2;
  s.sampleRemote(remote, 0);
  expect(remote.vehicleRpm[0]).toBe(3900);
});

test("prediction evidence is opt-in, captures tiny state differences and keeps only a bounded history", () => {
  const trace = new PredictionTrace(), predicted = new Body(), actual = new Body();
  actual.x = Math.fround(.00001); actual.vehicleRpm = 1500;
  trace.record(1, 2, -1, 4, predicted, actual, [0, 127, 0]);
  expect(trace.differences).toHaveLength(0);
  trace.enabled = true;
  for (let tick = 1; tick <= 65; tick++) trace.record(tick, tick + 2, -1, 4, predicted, actual, [0, 127, 0]);
  expect(trace.differences).toHaveLength(64); expect(trace.dropped).toBe(1);
  const last = trace.differences[63]!;
  expect(last.distance).toBeGreaterThan(0); expect(last.distance).toBeLessThan(.00002);
  expect(last.fields.map(field => field.name)).toEqual(["x", "vehicleRpm"]);
  actual.vehicleRpm = 2000;
  expect(last.fields[1]!.authoritative).toBe(1500);
  trace.adopt(80, 75); expect(trace.furthestAhead).toBe(5);
});
