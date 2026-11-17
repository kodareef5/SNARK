import { expect, test } from 'bun:test';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { F_ALIVE, F_GROUNDED } from '../../shared/sim/entities.ts';
import { MF_ROOTED } from '../../shared/sim/character.ts';
import { V_HEALTH } from '../../shared/sim/vitals.ts';
import { Harness } from '../fixtures/net.ts';
import { flatGround } from '../fixtures/arena.ts';
import type { HostOptions } from '../../server/host.ts';
import { carMeetsCapsule } from '../../shared/world/vehicle.ts';
import { isWheelVehicle } from '../../shared/sim/vehicle.ts';
import { vehicleMassProperties } from '../../shared/sim/vehicle-rigid.ts';
import { BIRD_RIG, birdClips } from '../fixtures/bird.ts';
import { decodeCorpseCheckpoint } from '../../shared/net/corpse.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function separation(h: Harness, car: number, actor: number): number {
  const e = h.world.ents, v = e.vrow[car]!, p = h.reg.move[e.kind[actor]!]!;
  const def = h.reg.vehicle[e.kind[car]!]!; if (!isWheelVehicle(def)) throw new Error('expected a wheeled car');
  return carMeetsCapsule(def.spec, {
    x: e.x[car]!, y: e.y[car]!, z: e.z[car]!, yaw: e.vehicleYaw[v]!, pitch: e.vehiclePitch[v]!, roll: e.vehicleRoll[v]!,
    qx: e.vehicleQx[v]!, qy: e.vehicleQy[v]!, qz: e.vehicleQz[v]!, qw: e.vehicleQw[v]!,
  }, e.x[actor]!, e.y[actor]!, e.z[actor]!, p.radius, p.height)?.depth ?? 0;
}

function setup(host: HostOptions = {}, maxClients = 128) {
  const h = new Harness({ maxClients }, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], ...host });
  const session = h.join('driver'); h.run(400);
  const ground = flatGround(h, 28, 32), x = ground.x + 14, z = ground.z + 8;
  const driver = h.client(session)!, ents = h.world.ents;
  const record = h.host.records.byPid.get(driver.pid)!;
  const car = h.host.spawnVehicle('core:compact', x, z, record.team, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  ents.setPosition(driver.ent, x + 1.6, ground.y, z + 0.12);
  expect(h.host.urban.mount(driver, car)).toBe(RESULT_OK);
  for (let i = 0; i < 19; i++) h.server.tick();
  expect(driver.drive).toBe(car);
  const tick = () => { driver.inputs.set(h.world.tick + 1, 0, 0, 0, 0, 0); h.server.tick(); };
  const health = (e: number) => h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH);
  const placeCar = (atX = x, atZ = z, speed = 10) => {
    ents.setPosition(car, atX, ground.y, atZ);
    ents.vehicleYaw[ents.vrow[car]!] = ents.vehicleYawRate[ents.vrow[car]!] = ents.yaw[car] = 0;
    ents.vx[car] = ents.vy[car] = 0; ents.vz[car] = speed;
    ents.flags[car] = ents.flags[car]! | F_GROUNDED;
  };
  const victim = (kind: string, atX: number, atZ: number) => {
    const e = h.host.spawnCreature(kind, atX, atZ, 1);
    expect(e).toBeGreaterThanOrEqual(0); ents.mflags[e] = ents.mflags[e]! | MF_ROOTED;
    return e;
  };
  return { h, driver, record, car, x, z, ents, ground, tick, health, placeCar, victim };
}

test('native driving sweep harms a human, preserves both occupants, and moves the victim next tick', () => {
  const s = setup(), { h, car, x, z, ents, driver, health, tick } = s;
  try {
    // Seat an actual NPC passenger; contact filtering is independent of player sessions.
    const passenger = h.host.spawnCreature('core:civilian', x - 1.25, z + 0.12, 1);
    expect(h.host.urban.seatNpc(passenger, car, 'passenger')).toBe(RESULT_OK);
    for (let i = 0; i < 19; i++) tick();
    const target = s.victim('core:civilian', x, z + 2.5), pid = ents.pid[target]!;
    const before = health(target), driverHealth = health(driver.ent), passengerHealth = health(passenger);
    s.placeCar(); tick();
    expect(h.host.combat.last.victim).toBe(pid); expect(h.host.combat.last.by).toBe(driver.pid);
    expect(health(target)).toBeLessThan(before - 10); expect(health(target)).toBeGreaterThan(0);
    expect(health(driver.ent)).toBe(driverHealth); expect(health(passenger)).toBe(passengerHealth);
    expect(ents.vz[target]).toBeGreaterThan(5);
    expect(separation(h, car, target)).toBeLessThan(.005);
    const at = ents.z[target]!; tick();
    expect(ents.z[target]).toBeGreaterThan(at + 0.1);
    expect(ents.seat[driver.ent]).toBe(car + 1); expect(ents.seat[passenger]).toBe(car + 1);
    expect(h.host.records.byPid.get(ents.pid[car]!)!.team).toBe(s.record.team);
  } finally { h.host.shutdown(); }
});

test('owned cars exchange equal and opposite momentum once per pair and an offset hit generates spin', () => {
  const s = setup(), { h, ents, car, x, z } = s;
  try {
    const other = h.host.spawnVehicle('core:compact', x + .6, z + 4.2, s.record.team + 1, 0);
    expect(other).toBeGreaterThanOrEqual(0);
    // An empty protected foreign car is anchored under PvE; normal PvP still exchanges momentum.
    expect(h.host.setSetting('serverPVE', 'False')).toBe('');
    s.placeCar(); ents.setPosition(other, x + .6, s.ground.y, z + 4.2);
    ents.vx[other] = ents.vy[other] = ents.vz[other] = 0;
    const row = ents.vrow[car]!, otherRow = ents.vrow[other]!;
    const spec = h.reg.vehicle[ents.kind[car]!]!.spec;
    const m1 = vehicleMassProperties(spec, { payloadMass: ents.vehiclePayloadMass[row]! }).mass;
    const m2 = vehicleMassProperties(spec, { payloadMass: ents.vehiclePayloadMass[otherRow]! }).mass;
    const before = m1 * ents.vz[car]! + m2 * ents.vz[other]!, contacts = h.host.urban.contacts!, count = contacts.contacts;
    // Reverse registration order deliberately; canonical handle ordering still solves one pair.
    contacts.capture(other); contacts.capture(car);
    ents.setPosition(car, x, s.ground.y, z + .4);
    contacts.step();
    expect(contacts.contacts).toBe(count + 1);
    expect(ents.vz[other]).toBeGreaterThan(1); expect(ents.vz[car]).toBeLessThan(9);
    expect(m1 * ents.vz[car]! + m2 * ents.vz[other]!).toBeCloseTo(before, 2);
    expect(Math.abs(ents.vehicleYawRate[row]!) + Math.abs(ents.vehicleYawRate[otherRow]!)).toBeGreaterThan(.1);
    const after = [ents.vz[car], ents.vz[other], ents.vehicleYawRate[row], ents.vehicleYawRate[otherRow]];
    contacts.step(); expect([ents.vz[car], ents.vz[other], ents.vehicleYawRate[row], ents.vehicleYawRate[otherRow]]).toEqual(after);
  } finally { h.host.shutdown(); }
});

test('a glancing protected tame stays fixed while the car retains its tangent velocity', () => {
  const s = setup(), { h, ents, car, x, z, health } = s;
  try {
    const target = s.victim('core:dummy', x + .1, z + 2.6), rec = h.host.records.byPid.get(ents.pid[target]!)!;
    rec.team = s.record.team; ents.setTeam(target, rec.team);
    const at = [ents.x[target], ents.y[target], ents.z[target]], hp = health(target);
    s.placeCar(); ents.vx[car] = 3;
    const contacts = h.host.urban.contacts!; contacts.capture(car);
    ents.setPosition(car, x + .1, s.ground.y, z + .4); contacts.step();
    expect([ents.x[target], ents.y[target], ents.z[target]]).toEqual(at);
    expect([ents.vx[target], ents.vy[target], ents.vz[target]]).toEqual([0, 0, 0]); expect(health(target)).toBe(hp);
    expect(ents.vx[car]).toBeCloseTo(3, 5); expect(ents.vz[car]).toBeLessThan(2);
  } finally { h.host.shutdown(); }
});

test('a fatal native ram seeds a translating and tumbling corpse with current harvest bounds', () => {
  const clips = birdClips().map(c => ({ ...c, id: c.id.replace('t:bird/', 'core:dodo/') }));
  const s = setup({ clips: { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 }, rigs: [{ ...BIRD_RIG, id: 'core:dodo', skeleton: 'dodo' }] });
  const { h, ents, car, x, z, tick } = s;
  try {
    const target = s.victim('core:dodo', x, z + 2.42), pid = ents.pid[target]!;
    s.placeCar(x, z, 24); tick();
    expect(h.host.combat.last.victim).toBe(pid); expect(h.host.combat.last.killed).toBe(true);
    const corpse = [...h.host.corpses.bodies.values()].find(b => b.kind === h.reg.index.get('core:dodo'))!;
    expect(corpse).toBeDefined(); expect(corpse.motionRevision).toBeGreaterThan(0);
    const first = h.host.corpses.motion(corpse.e)!, saved = decodeCorpseCheckpoint(first.data)!;
    expect(saved.awake).toBe(true);
    expect(Array.from(corpse.fall!.ragdoll.w).some(w => Math.abs(w) > .5)).toBe(true);
    const before = corpse.z;
    for (let i = 0; i < 8; i++) tick();
    expect(corpse.z).toBeGreaterThan(before + .5);
    expect(ents.z[corpse.e]).toBe(corpse.z); expect(corpse.rec.z).toBe(corpse.z);
    const checkpoint = decodeCorpseCheckpoint(h.host.corpses.motion(corpse.e)!.data)!;
    expect([checkpoint.x, checkpoint.y, checkpoint.z]).toEqual([corpse.rec.x, corpse.rec.y, corpse.rec.z]);
    const middle = h.host.corpses.middle(corpse);
    expect(Math.hypot(middle.x - corpse.x, middle.y - corpse.y, middle.z - corpse.z)).toBeLessThan(corpse.reach);
    expect(h.host.corpses.cast(middle.x, middle.y + 2, middle.z, 0, -1, 0, 4)).toBe(corpse.e);
    expect(ents.vz[car]).toBeGreaterThan(0);
  } finally { h.host.shutdown(); }
});

test('a reused target vehicle slot cannot borrow the removed vehicle capture for relative impact speed', () => {
  const s = setup({ entityMax: 5, entityStart: 4 }, 1), { h, ents, car, x, z, health } = s;
  try {
    const old = h.host.spawnVehicle('core:compact', x + 8, z + 8, 0, 0), generation = ents.gen[old]!;
    const contacts = h.host.urban.contacts!;
    ents.setPosition(old, x, s.ground.y, z + 6); contacts.capture(old);
    expect(h.host.spawnVehicle('core:compact', x - 8, z + 8, 0, 0)).toBeGreaterThanOrEqual(0);
    h.host.creatures.remove(old);
    const next = h.host.spawnVehicle('core:compact', x + 8, z + 8, 0, 0);
    expect(next).toBe(old); expect(ents.gen[next]).not.toBe(generation);
    ents.setPosition(next, x, s.ground.y, z + 4.2); ents.vx[next] = ents.vy[next] = ents.vz[next] = 0;
    h.world.history.untrack(next); h.world.history.track(next);
    const before = health(next);
    s.placeCar(); contacts.capture(car); ents.setPosition(car, x, s.ground.y, z + .4); contacts.step();
    expect(health(next)).toBe(before); // Vehicle damage is queued once through the physical pair, never generic ram.
    expect(ents.vz[next]).toBeGreaterThan(1);
  } finally { h.host.shutdown(); }
});

test('an impact corpse restores the exact moving checkpoint and continues from its saved spatial root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snark-impact-corpse-'));
  const clips = birdClips().map(c => ({ ...c, id: c.id.replace('t:bird/', 'core:dodo/') }));
  const options: HostOptions = { dbPath: join(dir, 'world.db'), clips: { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 }, rigs: [{ ...BIRD_RIG, id: 'core:dodo', skeleton: 'dodo' }] };
  const s = setup(options); let closed = false, restored: Harness | null = null;
  try {
    s.victim('core:dodo', s.x, s.z + 2.42); s.placeCar(s.x, s.z, 24); s.tick();
    for (let i = 0; i < 3; i++) s.tick();
    const body = [...s.h.host.corpses.bodies.values()].find(b => b.kind === s.h.reg.index.get('core:dodo'))!;
    const state = body.fall!.ragdoll.checkpoint(), xyz = [body.x, body.y, body.z], pid = body.rec.pid;
    s.h.host.shutdown(); closed = true;
    restored = new Harness({}, 1, 60, options);
    const next = restored.host.corpses.bodies.get(pid)!;
    expect(next.fall!.ragdoll.checkpoint()).toEqual(state);
    expect([next.x, next.y, next.z]).toEqual(xyz); expect(next.drop).toBeNull();
    expect(next.motionStanding).toBe(true);
    restored.server.tick();
    expect(next.fall!.ticks).toBe(body.fall!.ticks + 1);
    expect(next.fall!.ragdoll.checkpoint()).not.toEqual(state);
    expect([next.rec.x, next.rec.y, next.rec.z]).toEqual([next.x, next.y, next.z]);
  } finally { if (!closed) s.h.host.shutdown(); restored?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test('dinosaur mass changes car deceleration; fatal road impacts use native death and driver credit', () => {
  const s = setup(), { h, ents, car, x, z, tick, health } = s;
  try {
    const bird = s.victim('core:dodo', x - 5, z + 2.42);
    const birdPid = ents.pid[bird]!, birdBefore = health(bird);
    s.placeCar(x - 5); tick();
    expect(health(bird)).toBeLessThan(birdBefore);
    const lightSpeed = ents.vz[car]!;
    const dino = s.victim('core:parasaur', x + 5, z + 3.3), dinoBefore = health(dino);
    s.placeCar(x + 5); tick();
    expect(health(dino)).toBeLessThan(dinoBefore);
    expect(ents.vz[car]).toBeLessThan(lightSpeed - 2);
    expect(ents.vz[dino]).toBeLessThan(ents.vz[bird]! + 1);
    const fatal = s.victim('core:dodo', x, z + 2.42), fatalPid = ents.pid[fatal]!;
    s.placeCar(x, z, 24); tick();
    expect(h.host.combat.last.victim).toBe(fatalPid); expect(h.host.combat.last.by).toBe(s.driver.pid);
    expect(h.host.combat.last.killed).toBe(true);
    expect(h.host.records.entOf.has(fatalPid)).toBe(false);
    expect(s.record.xp).toBeGreaterThan(0);
    // The other bird remains a distinct record, not a slot accidentally hit twice.
    expect(h.host.records.byPid.has(birdPid)).toBe(true);
  } finally { h.host.shutdown(); }
});

test('friendly fire and PvE actors stay immovable while slow wild contacts exchange momentum without harm', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    for (let i = 0; i < 3; i++) {
      const atX = x - 5 + i * 5, target = s.victim('core:civilian', atX, z + (i === 2 ? 2.31 : 2.6));
      const rec = h.host.records.byPid.get(ents.pid[target]!)!;
      if (i === 0) rec.team = s.record.team;
      if (i === 1) { rec.team = s.record.team + 1; expect(h.host.setSetting('serverPVE', 'True')).toBe(''); }
      ents.setTeam(target, rec.team);
      const before = health(target), at = ents.z[target]!;
      s.placeCar(atX, z, i === 2 ? 1.5 : 10);
      // Low-speed contact needs a few ticks to close the gap.
      for (let k = 0; k < (i === 2 ? 6 : 1); k++) tick();
      expect(health(target)).toBe(before);
      if (i < 2) {
        expect(ents.vx[target]).toBe(0); expect(ents.vz[target]).toBe(0); expect(ents.z[target]).toBe(at);
        expect(ents.vz[car]).toBeLessThan(1);
      } else {
        expect(ents.vz[target]).toBeGreaterThan(.1);
        expect(ents.vz[car]).toBeGreaterThan(.1);
      }
    }
  } finally { h.host.shutdown(); }
});

test('sustained contact cannot farm damage and an old vehicle capture is invalid after removal', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    const target = s.victim('core:civilian', x, z + 2.6);
    s.placeCar(); tick(); const once = health(target), hits = h.host.combat.hits;
    // Keep the same overlap episode under repeated incoming velocity. Position changes
    // are fixture setup; each impact still traverses the real server tick and Combat.
    for (let i = 0; i < 24; i++) {
      ents.setPosition(target, x, s.ground.y, z + 2.6); ents.vx[target] = ents.vy[target] = ents.vz[target] = 0;
      ents.flags[target] = ents.flags[target]! | F_GROUNDED;
      h.world.history.record(h.world.tick);
      s.placeCar(); tick();
    }
    expect(health(target)).toBeGreaterThanOrEqual(once); expect(h.host.combat.hits).toBe(hits);
    expect(ents.vz[target]).toBeGreaterThan(5); expect(ents.vz[car]).toBeGreaterThan(5);
    const contacts = h.host.urban.contacts!;
    contacts.capture(car);
    const oldGen = ents.gen[car]!;
    h.host.creatures.remove(car);
    expect(ents.gen[car]).not.toBe(oldGen); expect(ents.flags[car]! & F_ALIVE).toBe(0);
    expect(contacts.step()).toHaveLength(0);
    expect(h.host.combat.hits).toBe(hits);
  } finally { h.host.shutdown(); }
});

test('a crowd beside the road is met body by body, and never stops a car that touches none of it', () => {
  const s = setup(), { h, x, z, car, ents, tick } = s;
  try {
    // Three hundred practice bodies stacked a few metres to the side, inside the contact search, none in the car's way.
    for (let i = 0; i < 300; i++) s.victim('core:civilian', x + 5, z + 5);
    const hits = h.host.combat.hits;
    s.placeCar(); tick();
    expect(ents.z[car]).toBeGreaterThan(z + 0.2); expect(ents.vz[car]).toBeGreaterThan(5);
    expect(h.host.combat.hits).toBe(hits);
    // And one in its way among them is still met.
    const target = s.victim('core:civilian', x, z + 2.5), before = s.health(target);
    s.placeCar(); tick();
    expect(s.health(target)).toBeLessThan(before);
  } finally { h.host.shutdown(); }
});

test('relative sweeps stop a body crossing a parked car even when both endpoint capsules are clear', () => {
  const s = setup(), { h, ents, car, x, z, tick, health } = s;
  try {
    const target = s.victim('core:civilian', x - 1.6, z + 0.4), before = health(target);
    // Native stepBody caps this high velocity to 3.2m of travel: beyond the entire
    // 1.8m-wide car plus both 0.4m capsule radii. An endpoint-only test misses it.
    ents.vx[target] = 100; ents.flags[target] = ents.flags[target]! & ~F_GROUNDED;
    s.placeCar(x, z, 0); h.world.history.record(h.world.tick);
    const contacts = h.host.urban.contacts!, count = contacts.contacts; tick();
    expect(contacts.contacts).toBe(count + 1); expect(health(target)).toBe(before);
    expect(ents.x[target]).toBeLessThan(ents.x[car]! - 1.2); expect(separation(h, car, target)).toBeLessThan(.005);
    expect(ents.vx[target]!).toBeLessThan(20); expect(ents.vx[car]!).toBeGreaterThan(1);
    expect(Math.abs(ents.vz[car]!)).toBeLessThan(.01);
  } finally { h.host.shutdown(); }
});

test('a driverless car blocks but cannot harm, so an unowned car never carries damage past PvE', () => {
  const s = setup(), { h, ents, x, z, tick, health } = s;
  try {
    const empty = h.host.spawnVehicle('core:compact', x - 8, z, 0, 0);
    expect(empty).toBeGreaterThanOrEqual(0);
    const target = s.victim('core:civilian', x - 8, z + 2.6), before = health(target), hits = h.host.combat.hits;
    ents.setPosition(empty, x - 8, s.ground.y, z);
    ents.vehicleYaw[ents.vrow[empty]!] = ents.vehicleYawRate[ents.vrow[empty]!] = ents.yaw[empty] = 0;
    ents.vx[empty] = ents.vy[empty] = 0; ents.vz[empty] = 10;
    ents.flags[empty] = ents.flags[empty]! | F_GROUNDED;
    tick();
    expect(health(target)).toBe(before);
    expect(h.host.combat.hits).toBe(hits);
    expect(separation(h, empty, target)).toBeLessThan(.005);
    expect(ents.vz[target]).toBeGreaterThan(5); expect(ents.vz[empty]).toBeGreaterThan(5);
  } finally { h.host.shutdown(); }
});

test('a driver disabled after contact capture loses impact authority in the same tick', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    const target = s.victim('core:civilian', x, z + 2.6), before = health(target), hits = h.host.combat.hits;
    const beforeStep = h.server.onBeforeStep;
    h.server.onBeforeStep = () => {
      beforeStep?.(); // Captures the current authorized driver and vehicle frame.
      expect(h.host.entangle.give(s.record, h.reg.index.get('core:entangled')!, 0)).toBe(true);
      h.server.onBeforeStep = beforeStep;
    };
    s.placeCar(); tick();
    expect(h.host.urban.riderOf(car)).toBeNull();
    expect(health(target)).toBe(before); expect(h.host.combat.hits).toBe(hits);
    expect(ents.vx[target]).toBeCloseTo(0, 8); expect(ents.vz[target]).toBeGreaterThan(5);
    expect(ents.vz[car]).toBeGreaterThan(5);
  } finally { h.host.shutdown(); }
});
