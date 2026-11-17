import { expect, test } from 'bun:test';
import { VehiclePrediction } from '../../client/core/vehicle-prediction.ts';
import { VehicleCorrection } from '../../client/core/vehicle-correction.ts';
import { RemoteSample } from '../../client/core/session.ts';
import { COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { makeHandle } from '../../shared/ids.ts';
import { ContactSnapshot, contactBody } from '../../shared/net/contact.ts';
import { Body, BTN_JUMP } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { flatWorld } from '../fixtures/world.ts';

function setup() {
  const world = flatWorld(), prediction = new VehiclePrediction(world, world.reg), snapshot = new ContactSnapshot();
  snapshot.owner = makeHandle(4, 1); snapshot.count = 1; snapshot.tick = 10;
  const p = snapshot.rows[0]!, target = p.body;
  p.handle = makeHandle(8, 2); p.mass = 1515; p.radius = 1; p.height = 1.5;
  p.kind = world.kind('core:compact'); p.vehicle = p.native = true;
  target.kind = p.kind; target.vehicle = true; target.x = 40; target.z = 40; target.fuel = 40;
  contactBody(target, p.state);
  const own = new Body(); own.kind = target.kind; own.vehicle = true; own.x = own.z = 80;
  const draw = new RemoteSample(); draw.count = 1; draw.id[0] = 8; draw.gen[0] = 2; draw.kind[0] = target.kind;
  draw.x[0] = 40; draw.z[0] = 40; draw.vehicleQw[0] = 1;
  prediction.accept(snapshot);
  return { world, prediction, snapshot, p, target, own, draw };
}

test('exact driving can skip replay on an empty road after applying the final target withdrawal', () => {
  const s = setup();
  s.snapshot.count = 0;
  s.snapshot.tick++;
  s.prediction.accept(s.snapshot);
  expect(s.prediction.needsReplay).toBe(true); // setup supplied one nearby target.
  s.snapshot.tick++;
  s.prediction.accept(s.snapshot);
  expect(s.prediction.needsReplay).toBe(false);
  s.snapshot.count = 1;
  s.snapshot.tick++;
  s.prediction.accept(s.snapshot);
  expect(s.prediction.needsReplay).toBe(true);
  s.snapshot.count = 0;
  s.snapshot.tick++;
  s.prediction.accept(s.snapshot);
  expect(s.prediction.needsReplay).toBe(true); // Remove the old target's predicted response first.
  s.snapshot.tick++;
  s.prediction.accept(s.snapshot);
  expect(s.prediction.needsReplay).toBe(false);
});

test('a moving target holds native steering and drivetrain through the exact same replay ticks', () => {
  const s = setup();
  s.p.moveX = 50; s.p.moveZ = 127; s.p.pilot = true;
  s.prediction.accept(s.snapshot); s.prediction.draw(s.draw, 0, 1, 10);
  const before = new Body();
  for (let tick = 11; tick <= 22; tick++) {
    stepVehicleBody(s.world, s.target, 50, 127, 0, COMPACT_VEHICLE);
    before.copy(s.own); s.prediction.step(tick, before, s.own, COMPACT_VEHICLE);
    s.prediction.draw(s.draw, 0, 1, tick);
    expect([s.draw.x[0], s.draw.y[0], s.draw.z[0]]).toEqual([s.target.x, s.target.y, s.target.z]);
    expect(s.draw.vehicleQy[0]).toBeCloseTo(s.target.vehicleQy, 6);
  }
  expect(s.prediction.stats.contacts).toBe(0);
  expect(s.p.body.fuel).toBeLessThan(40); // Authority fixture stepped; prediction cannot mutate its snapshot copy.
});

test('an initial driver-clock offset decays through snapshots instead of restarting every replay', () => {
  const s = setup();
  s.draw.z[0] = 46;
  s.prediction.draw(s.draw, 0, 1, 10);
  expect(s.draw.z[0]).toBe(46);
  for (let i = 0; i < 12; i++) {
    s.prediction.update(30);
    s.prediction.accept(s.snapshot);
    s.prediction.finishReplay();
    s.draw.z[0] = 46; // Ordinary remote history remains at the delayed clock on every sample.
    s.prediction.draw(s.draw, 0, 1, 10);
  }
  expect(s.draw.z[0]).toBeCloseTo(40 + 6 * Math.exp(-4), 4);
});

test('qualified target teleports, omitted targets and recycled slots cannot replay an old contact', () => {
  const s = setup();
  s.prediction.draw(s.draw, 0, 1, 10);
  s.target.z = 42; s.p.epoch++;
  contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot); s.prediction.finishReplay();
  s.prediction.draw(s.draw, 0, 1, 10); expect(s.draw.z[0]).toBe(42);
  s.draw.gen[0]++; s.draw.z[0] = 75;
  s.prediction.draw(s.draw, 0, 1, 10); expect(s.draw.z[0]).toBe(75);
  s.snapshot.count = 0; s.snapshot.tick++;
  s.prediction.accept(s.snapshot); expect(s.prediction.stats.proxies).toBe(0);
  s.draw.gen[0]--; s.prediction.draw(s.draw, 0, 1, 11); expect(s.draw.z[0]).toBe(75);
});

test('stale and fixed target facts cannot keep driving speculative bodies', () => {
  const s = setup();
  s.p.response = 'fixed'; s.target.vz = 20; s.p.moveZ = 127; s.p.buttons = BTN_JUMP;
  contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot);
  s.prediction.draw(s.draw, 0, 1, 10);
  s.prediction.step(11, s.own, s.own, COMPACT_VEHICLE);
  s.prediction.draw(s.draw, 0, 1, 11); expect(s.draw.z[0]).toBe(40);
  s.draw.z[0] = 70;
  s.prediction.draw(s.draw, 0, 1, 23); expect(s.draw.z[0]).toBe(70);
  s.snapshot.epoch++;
  expect(s.prediction.accept(s.snapshot)).toBe(true);
  expect(s.prediction.accept(s.snapshot)).toBe(false);
});

test('orientation correction preserves the old displayed heading, decays, and cuts qualified discontinuities', () => {
  const fade = new VehicleCorrection(), body = new Body(), q = new Float64Array(4);
  fade.capture(body);
  body.vehicleQy = Math.sin(.2); body.vehicleQw = Math.cos(.2);
  fade.reconcile(body, true);
  q.set([0, body.vehicleQy, 0, body.vehicleQw]); fade.apply(q);
  expect(Math.abs(q[1]!)).toBeLessThan(1e-9); expect(fade.angle).toBeCloseTo(.4, 8);
  for (let i = 0; i < 30; i++) fade.update(30);
  expect(fade.angle).toBeLessThan(.00003);
  fade.capture(body); body.vehicleQy = 1; body.vehicleQw = 0; fade.reconcile(body, true);
  expect(fade.angle).toBe(0);
  fade.capture(body); body.vehicleQy = 0; body.vehicleQw = 1; fade.reconcile(body, false);
  expect(fade.angle).toBe(0);
});
