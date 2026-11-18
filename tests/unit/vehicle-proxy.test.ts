import { expect, test } from 'bun:test';
import { VehiclePrediction } from '../../client/core/vehicle-prediction.ts';
import { VehicleCorrection } from '../../client/core/vehicle-correction.ts';
import { RemoteSample } from '../../client/core/session.ts';
import { COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { makeHandle } from '../../shared/ids.ts';
import { ContactSnapshot, contactBody } from '../../shared/net/contact.ts';
import { Body } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { flatWorld } from '../fixtures/world.ts';

function setup() {
  const world = flatWorld(), prediction = new VehiclePrediction(world, world.reg), snapshot = new ContactSnapshot();
  snapshot.owner = makeHandle(4, 1); snapshot.count = 1; snapshot.tick = 10;
  const p = snapshot.rows[0]!, target = p.body;
  p.handle = makeHandle(8, 2); p.mass = 1515; p.radius = 1; p.height = 1.5;
  p.kind = world.kind('core:compact'); p.vehicle = true;
  target.kind = p.kind; target.vehicle = true; target.x = 40; target.z = 40; target.fuel = 40;
  contactBody(target, p.state);
  const own = new Body(); own.kind = target.kind; own.vehicle = true; own.x = own.z = 80;
  const draw = new RemoteSample(); draw.count = 1; draw.id[0] = 8; draw.gen[0] = 2; draw.kind[0] = target.kind;
  draw.x[0] = 40; draw.z[0] = 40; draw.vehicleQw[0] = 1;
  prediction.accept(snapshot);
  return { world, prediction, snapshot, p, target, own, draw };
}

test('unchanged standing facts and off-path neighbours do not repeatedly rewind exact driving', () => {
  const s = setup();
  s.prediction.accept(s.snapshot); expect(s.prediction.needsReplay).toBe(false);
  s.snapshot.tick++; s.prediction.accept(s.snapshot); expect(s.prediction.needsReplay).toBe(false);
  s.snapshot.count = 0; s.snapshot.tick++;
  s.prediction.accept(s.snapshot); expect(s.prediction.needsReplay).toBe(false);
  s.snapshot.count = 1; s.snapshot.tick++;
  s.prediction.accept(s.snapshot, s.own); expect(s.prediction.stats.proxies).toBe(0);
  expect(s.prediction.needsReplay).toBe(false);
});

test('public coasting uses bounded native static motion without mutating its snapshot', () => {
  const s = setup(); s.target.vz = 10; s.target.fuel = 0;
  contactBody(s.target, s.p.state);
  s.prediction.accept(s.snapshot); s.prediction.beginReplay(); s.prediction.finishReplay();
  s.prediction.draw(s.draw, 0, 1, 10);
  const before = new Body();
  for (let tick = 11; tick <= 22; tick++) {
    stepVehicleBody(s.world, s.target, 0, 0, 0, COMPACT_VEHICLE, undefined, 0, false);
    before.copy(s.own); s.prediction.step(tick, before, s.own, COMPACT_VEHICLE);
    s.prediction.draw(s.draw, 0, 1, tick);
    expect([s.draw.x[0], s.draw.y[0], s.draw.z[0]]).toEqual([s.target.x, s.target.y, s.target.z]);
  }
  expect(s.prediction.stats.contacts).toBe(0); expect(s.p.state.z).toBe(40);
});

test('an initial driver-clock offset decays through snapshots instead of restarting every replay', () => {
  const s = setup();
  s.draw.z[0] = 46;
  s.prediction.draw(s.draw, 0, 1, 10);
  expect(s.draw.z[0]).toBe(46);
  let previous = 46;
  for (let i = 0; i < 80; i++) {
    s.prediction.update(30);
    s.prediction.accept(s.snapshot);
    s.prediction.finishReplay();
    s.draw.z[0] = 46; // Ordinary remote history remains at the delayed clock on every sample.
    s.prediction.draw(s.draw, 0, 1, 10);
    expect(previous - s.draw.z[0]!).toBeGreaterThanOrEqual(0);
    expect(previous - s.draw.z[0]!).toBeLessThan(.241); previous = s.draw.z[0]!;
  }
  expect(s.draw.z[0]).toBeCloseTo(40, 4);
});

test('qualified target teleports, omitted targets and recycled slots cannot replay an old contact', () => {
  const s = setup();
  s.prediction.draw(s.draw, 0, 1, 10);
  s.target.z = 42; s.p.epoch++;
  contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot); s.prediction.beginReplay(); s.prediction.finishReplay();
  s.prediction.draw(s.draw, 0, 1, 10); expect(s.draw.z[0]).toBe(42);
  s.draw.gen[0]++; s.draw.z[0] = 75;
  s.prediction.draw(s.draw, 0, 1, 10); expect(s.draw.z[0]).toBe(75);
  s.snapshot.count = 0; s.snapshot.tick++;
  s.prediction.accept(s.snapshot); expect(s.prediction.stats.proxies).toBe(0);
  s.draw.gen[0]--; s.prediction.draw(s.draw, 0, 1, 11); expect(s.draw.z[0]).toBe(42);
  s.prediction.update(900); s.draw.z[0] = 75; s.prediction.draw(s.draw, 0, 1, 11); expect(s.draw.z[0]).toBe(75);
});

test('stale and fixed target facts cannot keep driving speculative bodies', () => {
  const s = setup();
  s.p.response = 'fixed'; s.target.vz = 20;
  contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot);
  s.prediction.draw(s.draw, 0, 1, 10);
  s.prediction.step(11, s.own, s.own, COMPACT_VEHICLE);
  s.prediction.draw(s.draw, 0, 1, 11); expect(s.draw.z[0]).toBe(40);
  s.draw.z[0] = 70;
  s.prediction.draw(s.draw, 0, 1, 23); expect(s.draw.z[0]).toBe(40);
  s.prediction.update(900); s.draw.tick = 23; s.draw.z[0] = 70; s.prediction.draw(s.draw, 0, 1, 23); expect(s.draw.z[0]).toBe(70);
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
  expect(fade.angle).toBeGreaterThan(Math.PI / 2);
  fade.capture(body); body.vehicleQy = 0; body.vehicleQw = 1; fade.reconcile(body, false);
  expect(fade.angle).toBe(0);
});


test('nearby non-contact never clears grounded on an ascending kerb', () => {
  const s = setup(), before = new Body();
  s.own.grounded = true; s.own.vy = .3; before.copy(s.own);
  s.prediction.step(11, before, s.own, COMPACT_VEHICLE);
  expect(s.own.equals(before)).toBe(true); expect(s.prediction.stats.contacts).toBe(0);
});

test('fast crossing actors wait for authority and never replace normal delayed rendering', () => {
  const s = setup(); s.p.kind = s.world.kind('core:survivor'); s.p.vehicle = false; s.p.grounded = true;
  s.target.kind = s.p.kind; s.target.vehicle = false; s.target.grounded = true;
  s.target.x = 80; s.target.z = 82; s.target.vx = 6;
  contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot); s.prediction.beginReplay();
  s.own.vz = 20; const before = new Body(); before.copy(s.own); s.own.z += 20 / 30;
  s.prediction.step(11, before, s.own, COMPACT_VEHICLE);
  expect(s.prediction.stats.contacts).toBe(0); expect(s.prediction.stats.steps).toBe(0);
  s.draw.x[0] = 77; s.draw.z[0] = 79; s.prediction.draw(s.draw, 0, 1, 11);
  expect([s.draw.x[0], s.draw.z[0]]).toEqual([77, 79]);
});

test('grounded standing and slow bodies retain early physical contact; faster crossings wait', () => {
  for (const speed of [0, .5, 2, 3, 8]) {
    const s = setup(), before = new Body();
    s.p.kind = s.world.kind('core:survivor'); s.p.vehicle = false; s.p.grounded = true;
    s.p.mass = 80; s.p.radius = .4; s.p.height = 1.8;
    s.target.kind = s.p.kind; s.target.vehicle = false; s.target.grounded = true;
    s.target.x = 80; s.target.z = 84; s.target.vx = speed; contactBody(s.target, s.p.state);
    s.prediction.accept(s.snapshot); s.prediction.beginReplay(); s.own.vz = 20;
    for (let tick = 11; tick <= 14; tick++) {
      before.copy(s.own); stepVehicleBody(s.world, s.own, 0, 0, 0, COMPACT_VEHICLE);
      s.prediction.step(tick, before, s.own, COMPACT_VEHICLE);
    }
    if (speed <= 2) expect(s.prediction.stats.contacts).toBeGreaterThan(0);
    else expect(s.prediction.stats.contacts).toBe(0);
  }
});


test('replay preserves both interpolated endpoints and reentry preserves a partial withdrawal', () => {
  const s = setup(), before = new Body();
  s.target.vz = 12; contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot);
  s.prediction.beginReplay(.25); s.prediction.finishReplay(.25);
  s.prediction.step(11, before, s.own, COMPACT_VEHICLE);
  s.prediction.draw(s.draw, 0, .25, 11); const shown = s.draw.z[0]!;
  s.target.vz = 3; contactBody(s.target, s.p.state); s.prediction.accept(s.snapshot);
  s.prediction.beginReplay(.25); s.prediction.step(11, before, s.own, COMPACT_VEHICLE); s.prediction.finishReplay(.25);
  s.draw.z[0] = 38; s.prediction.draw(s.draw, 0, .25, 11); expect(s.draw.z[0]).toBeCloseTo(shown, 5);
  s.snapshot.count = 0; s.snapshot.tick++; s.prediction.accept(s.snapshot);
  s.draw.z[0] = 36; s.prediction.draw(s.draw, 0, .25, 11); expect(s.draw.z[0]).toBeCloseTo(shown, 5);
  s.prediction.update(40); s.draw.z[0] = 36; s.prediction.draw(s.draw, 0, .25, 11); const withdrawing = s.draw.z[0]!;
  s.snapshot.count = 1; s.snapshot.tick++; s.prediction.accept(s.snapshot);
  s.prediction.beginReplay(.25); s.prediction.finishReplay(.25);
  s.draw.z[0] = 36; s.prediction.draw(s.draw, 0, .25, 12); expect(s.draw.z[0]).toBeCloseTo(withdrawing, 5);
});

test('approaching vehicles converge visually before becoming physical candidates, without early replay', () => {
  const s = setup(); s.snapshot.epoch++; s.snapshot.tick = 100;
  s.target.x = 80; s.target.z = 60; s.target.vz = -15;
  s.target.vehicleQy = 1; s.target.vehicleQw = 0; s.target.vehicleYaw = Math.PI;
  s.own.x = 80; s.own.z = 10; s.own.vz = 20;
  let seeded = 0, physical = false;
  for (let i = 0; i < 30; i++) {
    s.snapshot.tick = 100 + i;
    s.target.z = Math.fround(60 - i * .5); s.own.z = Math.fround(10 + i * 20 / 30);
    contactBody(s.target, s.p.state);
    s.prediction.accept(s.snapshot, s.own, s.snapshot.tick + 8, 1);
    if (s.prediction.needsReplay) { physical = true; break; }
    s.draw.x[0] = 80; s.draw.z[0] = s.target.z + 1.5;
    s.prediction.draw(s.draw, 0, 1, s.snapshot.tick + 8); s.prediction.update(1000 / 30); seeded++;
  }
  expect(seeded).toBeGreaterThan(15); expect(physical).toBe(true);
  expect(s.prediction.stats.steps).toBe(0); expect(s.prediction.stats.replays).toBe(0); expect(s.prediction.stats.contacts).toBe(0);
  // The prior displayed frame is already close to the approaching vehicle's current motion clock.
  expect(Math.abs(s.draw.z[0]! - (s.target.z + .5 - 15 * 8 / 30))).toBeLessThan(.35);
});

test('expired vehicle motion holds its last display until the older ordinary view catches up', () => {
  const s = setup(), before = new Body();
  s.target.vz = 10; s.target.fuel = 0; contactBody(s.target, s.p.state);
  s.prediction.accept(s.snapshot); s.prediction.beginReplay(); s.prediction.finishReplay();
  s.prediction.draw(s.draw, 0, 1, 10);
  for (let t = 11; t <= 22; t++) { s.prediction.step(t, before, s.own, COMPACT_VEHICLE); s.prediction.draw(s.draw, 0, 1, t); }
  const shown = s.draw.z[0]!, steps = s.prediction.stats.steps;
  for (let t = 23; t <= 29; t++) {
    s.prediction.update(1000 / 30); s.prediction.step(t, before, s.own, COMPACT_VEHICLE);
    s.draw.tick = 10; s.draw.z[0] = 40; s.prediction.draw(s.draw, 0, 1, t);
    expect(s.draw.z[0]).toBe(shown);
  }
  expect(s.prediction.stats.steps).toBe(steps);
  s.draw.tick = 30; s.draw.z[0] = 50; s.prediction.draw(s.draw, 0, 1, 30);
  expect(s.draw.z[0]).toBe(shown);
  s.prediction.update(900); s.draw.z[0] = 50; s.prediction.draw(s.draw, 0, 1, 30); expect(s.draw.z[0]).toBe(50);
});
