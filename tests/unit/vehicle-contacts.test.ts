import { expect, test } from 'bun:test';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { F_ALIVE, F_GROUNDED } from '../../shared/sim/entities.ts';
import { MF_ROOTED } from '../../shared/sim/character.ts';
import { V_HEALTH } from '../../shared/sim/vitals.ts';
import { Harness } from '../fixtures/net.ts';
import { flatGround } from '../fixtures/arena.ts';

function setup() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  const session = h.join('driver'); h.run(400);
  const ground = flatGround(h, 28, 32), x = ground.x + 14, z = ground.z + 8;
  const driver = h.client(session)!, ents = h.world.ents;
  const record = h.host.records.byPid.get(driver.pid)!;
  const car = h.host.spawnVehicle('urban:compact', x, z, record.team, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  ents.setPosition(driver.ent, x + 1.6, ground.y, z + 0.12);
  expect(h.host.urban.mount(driver, car)).toBe(RESULT_OK);
  for (let i = 0; i < 19; i++) h.server.tick();
  expect(driver.drive).toBe(car);
  const tick = () => { driver.inputs.set(h.world.tick + 1, 0, 0, 0, 0, 0); h.server.tick(); };
  const health = (e: number) => h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH);
  const placeCar = (atX = x, atZ = z, speed = 10) => {
    ents.setPosition(car, atX, ground.y, atZ);
    ents.vehicleYaw[car] = ents.vehicleYawRate[car] = ents.yaw[car] = 0;
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
    const passenger = h.host.spawnCreature('urban:civilian', x - 1.25, z + 0.12, 1);
    expect(h.host.urban.seatNpc(passenger, car, 'passenger')).toBe(RESULT_OK);
    for (let i = 0; i < 19; i++) tick();
    const target = s.victim('urban:civilian', x, z + 2.5), pid = ents.pid[target]!;
    const before = health(target), driverHealth = health(driver.ent), passengerHealth = health(passenger);
    s.placeCar(); tick();
    expect(h.host.combat.last.victim).toBe(pid); expect(h.host.combat.last.by).toBe(driver.pid);
    expect(health(target)).toBeLessThan(before - 10); expect(health(target)).toBeGreaterThan(0);
    expect(health(driver.ent)).toBe(driverHealth); expect(health(passenger)).toBe(passengerHealth);
    expect(ents.vz[target]).toBeGreaterThan(5); expect(ents.vy[target]).toBeGreaterThan(0);
    expect(ents.flags[target]! & F_GROUNDED).toBe(0);
    expect(ents.z[car]).toBeLessThan(z + 0.21);
    const at = ents.z[target]!, up = ents.y[target]!; tick();
    expect(ents.z[target]).toBeGreaterThan(at + 0.1); expect(ents.y[target]).toBeGreaterThan(up);
    expect(ents.seat[driver.ent]).toBe(car + 1); expect(ents.seat[passenger]).toBe(car + 1);
    expect(h.host.records.byPid.get(ents.pid[car]!)!.team).toBe(s.record.team);
  } finally { h.host.shutdown(); }
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

test('friendly fire, PvE and walking-speed contacts stop the car without damage or knockback', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    for (let i = 0; i < 3; i++) {
      const atX = x - 5 + i * 5, target = s.victim('core:dummy', atX, z + 2.6);
      const rec = h.host.records.byPid.get(ents.pid[target]!)!;
      if (i === 0) rec.team = s.record.team;
      if (i === 1) { rec.team = s.record.team + 1; expect(h.host.setSetting('serverPVE', 'True')).toBe(''); }
      ents.setTeam(target, rec.team);
      const before = health(target), at = ents.z[target]!;
      s.placeCar(atX, z, i === 2 ? 1.5 : 10);
      // Low-speed contact needs a few ticks to close the gap.
      for (let k = 0; k < (i === 2 ? 6 : 1); k++) tick();
      expect(health(target)).toBe(before); expect(ents.vx[target]).toBe(0); expect(ents.vz[target]).toBe(0);
      expect(ents.z[target]).toBe(at); expect(ents.vz[car]).toBe(0);
      expect(ents.z[car]).toBeLessThan(z + 0.21);
    }
  } finally { h.host.shutdown(); }
});

test('sustained contact cannot farm damage and an old vehicle capture is invalid after removal', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    const target = s.victim('core:dummy', x, z + 2.6);
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
    const contacts = h.host.urban.contacts!;
    contacts.capture(car);
    const oldGen = ents.gen[car]!;
    h.host.creatures.remove(car);
    expect(ents.gen[car]).not.toBe(oldGen); expect(ents.flags[car]! & F_ALIVE).toBe(0);
    expect(contacts.step()).toHaveLength(0);
    expect(h.host.combat.hits).toBe(hits);
  } finally { h.host.shutdown(); }
});

test('a saturated native broadphase fails closed instead of driving through unexamined bodies', () => {
  const s = setup(), { h, x, z, car, ents, tick } = s;
  try {
    // Deliberately stacked server-spawned practice bodies simulate a crowded chunk.
    for (let i = 0; i < 257; i++) s.victim('core:dummy', x + 5, z + 5);
    const contacts = h.host.urban.contacts!, before = contacts.overflowStops, hits = h.host.combat.hits;
    s.placeCar(); tick();
    expect(contacts.overflowStops).toBe(before + 1); expect(ents.z[car]).toBe(z); expect(ents.vz[car]).toBe(0);
    expect(h.host.combat.hits).toBe(hits);
  } finally { h.host.shutdown(); }
});

test('relative sweeps stop a body crossing a parked car even when both endpoint capsules are clear', () => {
  const s = setup(), { h, ents, car, x, z, tick, health } = s;
  try {
    const target = s.victim('core:dummy', x - 1.6, z + 0.4), before = health(target);
    // Native stepBody caps this high velocity to 3.2m of travel: beyond the entire
    // 1.8m-wide car plus both 0.4m capsule radii. An endpoint-only test misses it.
    ents.vx[target] = 100; ents.flags[target] = ents.flags[target]! & ~F_GROUNDED;
    s.placeCar(x, z, 0); h.world.history.record(h.world.tick);
    const contacts = h.host.urban.contacts!, count = contacts.contacts; tick();
    expect(contacts.contacts).toBe(count + 1); expect(health(target)).toBe(before);
    expect(ents.x[target]).toBeLessThan(x - 1.3); expect(ents.x[target]).toBeGreaterThan(x - 1.6);
    expect(Math.abs(ents.vx[target]!)).toBeLessThan(0.00001); expect(ents.vz[car]).toBe(0);
    const stopped = ents.x[target]!; tick(); expect(ents.x[target]).toBe(stopped);
  } finally { h.host.shutdown(); }
});

test('a driverless car blocks but cannot harm, so an unowned car never carries damage past PvE', () => {
  const s = setup(), { h, ents, x, z, tick, health } = s;
  try {
    const empty = h.host.spawnVehicle('urban:compact', x - 8, z, 0, 0);
    expect(empty).toBeGreaterThanOrEqual(0);
    const target = s.victim('core:dummy', x - 8, z + 2.6), before = health(target), hits = h.host.combat.hits;
    ents.setPosition(empty, x - 8, s.ground.y, z);
    ents.vehicleYaw[empty] = ents.vehicleYawRate[empty] = ents.yaw[empty] = 0;
    ents.vx[empty] = ents.vy[empty] = 0; ents.vz[empty] = 10;
    ents.flags[empty] = ents.flags[empty]! | F_GROUNDED;
    tick();
    expect(health(target)).toBe(before);
    expect(h.host.combat.hits).toBe(hits);
    expect(ents.z[empty]).toBeLessThan(z + 0.3);
  } finally { h.host.shutdown(); }
});

test('a driver disabled after contact capture loses impact authority in the same tick', () => {
  const s = setup(), { h, ents, x, z, car, tick, health } = s;
  try {
    const target = s.victim('core:dummy', x, z + 2.6), before = health(target), hits = h.host.combat.hits;
    const beforeStep = h.server.onBeforeStep;
    h.server.onBeforeStep = () => {
      beforeStep?.(); // Captures the current authorized driver and vehicle frame.
      expect(h.host.entangle.give(s.record, h.reg.index.get('core:entangled')!, 0)).toBe(true);
      h.server.onBeforeStep = beforeStep;
    };
    s.placeCar(); tick();
    expect(h.host.urban.riderOf(car)).toBeNull();
    expect(health(target)).toBe(before); expect(h.host.combat.hits).toBe(hits);
    expect(ents.vx[target]).toBe(0); expect(ents.vz[target]).toBe(0);
    expect(ents.vz[car]).toBe(0);
  } finally { h.host.shutdown(); }
});
