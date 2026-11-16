import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { TICK_RATE } from '../../shared/coords.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { Body, BTN_JUMP, BTN_USE, stanceEye } from '../../shared/sim/character.ts';
import { F_GROUNDED } from '../../shared/sim/entities.ts';
import { vehicleDoor } from '../../shared/sim/vehicle-body.ts';
import { RemoteSample } from '../../client/core/session.ts';
import { Harness } from '../fixtures/net.ts';
import { flatGround } from '../fixtures/arena.ts';

function setup(dbPath?: string) {
  // Explicit no-art authority clips/rigs avoid rebuilding the full art pack for this logic proof.
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath });
  const ada = h.join('ada'), bob = h.join('bob');
  h.run(400);
  const ground = flatGround(h, 24, 28), x = ground.x + 10, z = ground.z + 8;
  h.say(ada, 'enablecheats'); h.say(bob, 'enablecheats');
  h.say(ada, `tp ${x + 1.6} ${z + 0.12}`);
  h.say(bob, `tp ${x - 1.6} ${z + 0.12}`);
  const me = h.client(ada)!, other = h.client(bob)!;
  const owner = h.host.records.byPid.get(me.pid)!.team;
  const car = h.host.spawnVehicle('core:compact', x, z, owner, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  return { h, ada, bob, me, other, car, x, z, owner };
}

function use(h: Harness, index: number, target: number) {
  const client = h.client(h.sessions[index]!)!, ents = h.world.ents, pilot = h.pilots[index]!;
  const e = client.ent, dx = ents.x[target]! - ents.x[e]!, dz = ents.z[target]! - ents.z[e]!;
  const eye = ents.y[e]! + stanceEye(h.reg.move[ents.kind[e]!]!, ents.stance[e]!);
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[target]! + 0.8 - eye, Math.hypot(dx, dz));
  h.run(100); pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(750);
}

test('normal use/input/snapshot path drives a real vehicle with a real passenger and safe exits', () => {
  const { h, ada, bob, me, other, car, owner } = setup();
  try {
    const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[car]!)!;
    const item = h.reg.index.get('core:berry')!;
    expect(h.host.items.mint(rec, item, 3)).toBe(3);
    use(h, 0, car);
    expect(me.drive).toBe(car);
    expect(ada.driving).toBe(car);
    expect(ents.seatSlot[me.ent]).toBe(1);
    use(h, 1, car);
    expect(other.drive).toBe(-1);
    expect(ents.seatSlot[other.ent]).toBe(2);
    expect(bob.own.seatSlot).toBe(2);
    const before = ents.z[car]!;
    h.pilots[0]!.moveZ = 127;
    h.pilots[1]!.moveZ = 127; // Passenger input must not walk the survivor out of the car.
    h.run(1000);
    expect(ents.z[car]!).toBeGreaterThan(before + 1);
    expect(Math.hypot(ents.x[other.ent]! - ents.x[car]!, ents.z[other.ent]! - ents.z[car]!)).toBeLessThan(1);
    const remote = new RemoteSample(); bob.sampleRemote(remote);
    const seen = [...remote.id.subarray(0, remote.count)].indexOf(car);
    expect(seen).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(remote.vehiclePitch[seen]!)).toBe(true);
    expect(remote.wheelAngle[seen]).not.toBe(0);
    h.pilots[0]!.moveZ = 0; h.pilots[0]!.buttons = BTN_JUMP; h.pilots[1]!.moveZ = 0;
    for (let waited = 0; waited < 3000 && Math.hypot(ents.vx[car]!, ents.vz[car]!) > .03; waited += 100) h.run(100);
    expect(Math.hypot(ents.vx[car]!, ents.vz[car]!)).toBeLessThan(.03);
    h.pilots[0]!.buttons = 0;
    use(h, 0, car);
    expect(me.drive).toBe(-1); expect(ents.seatSlot[me.ent]).toBe(0);
    expect(rec.team).toBe(owner); expect(h.host.items.inv(rec).total(item)).toBe(3);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test('real NPC seats are session-independent; carjack transfers only control and disconnect releases safely', () => {
  const { h, me, car, x, z, owner } = setup();
  try {
    h.say(h.sessions[0]!, `tp ${x + 3.2} ${z + 0.12}`);
    h.say(h.sessions[1]!, `tp ${x - 3.2} ${z + 0.12}`);
    const driver = h.host.spawnCreature('core:civilian', x + 1.25, z + 0.12, 1);
    const passenger = h.host.spawnCreature('core:civilian', x - 1.25, z + 0.12, 1);
    expect(driver).toBeGreaterThanOrEqual(0); expect(passenger).toBeGreaterThanOrEqual(0);
    expect(h.host.urban.seatNpc(driver, car)).toBe(RESULT_OK);
    expect(h.host.urban.seatNpc(passenger, car, 'passenger')).toBe(RESULT_OK);
    h.run(800);
    expect(h.world.ents.seatSlot[driver]).toBe(1);
    expect(h.world.ents.seatSlot[passenger]).toBe(2);
    expect(h.server.playerCount).toBe(2); // NPCs add no sessions.
    h.say(h.sessions[0]!, `tp ${x + 1.6} ${z + 0.12}`);
    use(h, 0, car);
    expect(me.drive).toBe(car);
    expect(h.world.ents.seat[driver]).toBe(0);
    expect(h.world.ents.seatSlot[passenger]).toBe(2);
    expect(h.host.urban.incidents).toHaveLength(1);
    expect(h.host.records.byPid.get(h.world.ents.pid[car]!)!.team).toBe(owner);
    h.ends[0]!.close();
    h.run(1000);
    expect(me.drive).toBe(-1);
    expect(h.world.ents.seat[me.ent]).toBe(0);
    expect(Math.hypot(h.world.ents.vx[car]!, h.world.ents.vz[car]!)).toBeLessThan(0.001);
    h.run(5000); // The real connection/session and survivor entity are now finalized.
    expect(me.ent).toBe(-1);
    expect(h.host.urban.occupancy.occupant(h.world.ents.pid[car]!, 'driver')).toBe(0);
  } finally { h.host.shutdown(); }
});

test('driver parks a car with a civilian at its wheel, who is pulled out of it; gmsummon parks one for the tribe', () => {
  const { h, ada, me, car, x, z, owner } = setup();
  try {
    const ents = h.world.ents, compact = h.reg.index.get('core:compact')!, civilian = h.reg.index.get('core:civilian')!;
    const of = (kind: number, not = -1): number => { for (let e = 0; e < ents.count; e++) if (ents.kind[e] === kind && e !== not && ents.pid[e]! > 0) return e; return -1; };
    expect(h.say(ada, 'driver boat')[0]).toBe('a boat is boarded from the water: spawn it, and a civilian');
    expect(h.say(ada, 'driver raptor')[0]).toBe('core:raptor is not a vehicle');
    expect(h.say(ada, 'driver')[0]).toMatch(/^spawned core:compact \d+ m ahead, a civilian getting in at its wheel$/);
    h.run(800);
    const driven = of(compact, car), driver = of(civilian);
    expect(driven).toBeGreaterThanOrEqual(0);
    expect(ents.seatSlot[driver]).toBe(1);
    expect(h.host.records.byPid.get(ents.pid[driven]!)!.team).toBe(0);
    h.say(ada, `tp ${ents.x[driven]! + 1.6} ${ents.z[driven]! + 0.12}`);
    use(h, 0, driven);
    expect(me.drive).toBe(driven);
    expect(ents.seat[driver]).toBe(0);
    use(h, 0, driven);
    expect(me.drive).toBe(-1);
    h.say(ada, `tp ${x + 12} ${z}`);
    expect(h.say(ada, 'gmsummon compact')[0]).toMatch(/^summoned core:compact \d+ m ahead, your tribe's$/);
    expect([...h.host.records.byPid.values()].filter((r) => r.kind === compact && r.team === owner)).toHaveLength(2);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test('normal record codec restores vehicle fuel and wheel state without changing legal owner or cargo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snark-urban-real-')), dbPath = join(dir, 'world.db');
  let host: Harness | null = null;
  try {
    const made = setup(dbPath); host = made.h;
    const { h, car, me, owner } = made, ents = h.world.ents;
    const cargo = h.host.records.byPid.get(ents.pid[car]!)!;
    const item = h.reg.index.get('core:berry')!;
    expect(h.host.items.mint(cargo, item, 4)).toBe(4);
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    h.run(800); h.pilots[0]!.moveZ = 127; h.run(700);
    h.pilots[0]!.moveZ = 0; h.pilots[0]!.buttons = BTN_JUMP; h.run(500);
    h.host.urban.dismount(me); h.run(800);
    const pid = ents.pid[car]!, fuel = ents.fuel[ents.vrow[car]!]!, wheel = ents.wheelAngle[ents.vrow[car]!]!;
    expect(fuel).toBeLessThan(40);
    h.host.shutdown(); host = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); host = restored;
    const e = restored.host.records.entOf.get(pid)!;
    expect(e).toBeGreaterThanOrEqual(0);
    expect(restored.world.ents.fuel[restored.world.ents.vrow[e]!]).toBe(fuel);
    expect(restored.world.ents.wheelAngle[restored.world.ents.vrow[e]!]).toBe(wheel);
    const record = restored.host.records.byPid.get(pid)!;
    expect(record.team).toBe(owner);
    expect(restored.host.items.inv(record).total(item)).toBe(4);
  } finally { host?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test('a real SQLite restart retains airborne velocity, suspension and transmission together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snark-urban-flight-')), dbPath = join(dir, 'world.db');
  let active: Harness | null = null;
  try {
    const { h, car } = setup(dbPath); active = h;
    const ents = h.world.ents, pid = ents.pid[car]!, body = new Body();
    ents.loadBody(car, body);
    body.y += 8; body.vx = 3; body.vy = -4; body.vz = 6; body.grounded = false;
    body.vehicleYawRate = .12; body.vehiclePitchRate = .08; body.vehicleRollRate = -.03;
    body.vehicleGear = 3; body.vehicleRpm = 4300; body.vehicleShiftTime = .6;
    ents.storeBody(car, body); h.run(100);
    const fields = ['y', 'vx', 'vy', 'vz', 'vehicleYawRate', 'vehiclePitchRate', 'vehicleRollRate', 'vehicleRideOffset', 'vehicleRideVelocity', 'vehicleGear', 'vehicleRpm', 'vehicleShiftTime'] as const;
    ents.loadBody(car, body);
    const expected = fields.map(field => body[field]);
    expect(ents.flags[car]! & F_GROUNDED).toBe(0);
    h.host.shutdown(); active = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); active = restored;
    const e = restored.host.records.entOf.get(pid)!;
    restored.world.ents.loadBody(e, body);
    expect(fields.map(field => body[field])).toEqual(expected);
    expect(restored.world.ents.flags[e]! & F_GROUNDED).toBe(0);
  } finally { active?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test('vehicle payload follows cargo and every occupant, and a dead passenger releases its mass', () => {
  const { h, car, me, x, z } = setup();
  try {
    h.say(h.sessions[1]!, `tp ${x - 4} ${z}`);
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK); h.run(800);
    const passenger = h.host.spawnCreature('core:civilian', x - 1.25, z + .12, 1);
    expect(h.host.urban.seatNpc(passenger, car, 'passenger')).toBe(RESULT_OK); h.run(800);
    const ents = h.world.ents, cargo = h.host.records.byPid.get(ents.pid[car]!)!, rec = h.host.records.byPid.get(ents.pid[passenger]!)!;
    const before = ents.vehiclePayloadMass[ents.vrow[car]!]!, stone = h.reg.index.get('core:stone')!;
    expect(before).toBeGreaterThanOrEqual(160);
    h.host.items.mint(cargo, stone, 40); h.host.items.mint(rec, stone, 20); h.run(100);
    expect(ents.vehiclePayloadMass[ents.vrow[car]!]).toBeCloseTo(before + 30, 3);
    const lost = (h.reg.mass[rec.kind]! || 80) + h.host.items.inv(rec).weight(h.host.items.table);
    h.host.survival.hurt(rec, 10000, me.pid); h.run(100);
    expect(h.host.records.entOf.has(rec.pid)).toBe(false);
    expect(h.host.urban.occupancy.occupant(cargo.pid, 'passenger')).toBe(0);
    expect(ents.vehiclePayloadMass[ents.vrow[car]!]).toBeCloseTo(before + 30 - lost, 3);
  } finally { h.host.shutdown(); }
});

test('a seat opens its own door while someone gets in by it, and the door swings shut after', () => {
  const { h, me, car } = setup();
  try {
    const ents = h.world.ents, def = h.reg.vehicle[ents.kind[car]!]!;
    const driverDoor = def.seats.find((s) => s.driver)!.door!, other = def.seats.find((s) => !s.driver)!.door!;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    let most = 0;
    for (let t = 0; t <= def.actionTicks; t++) {
      h.run(1000 / TICK_RATE);
      most = Math.max(most, vehicleDoor(ents.vehicleDoors[ents.vrow[car]!]!, driverDoor));
      expect(vehicleDoor(ents.vehicleDoors[ents.vrow[car]!]!, other)).toBe(0);
    }
    expect(most).toBe(1);
    expect(me.drive).toBe(car);
    h.run(1000);
    expect(vehicleDoor(ents.vehicleDoors[ents.vrow[car]!]!, driverDoor)).toBe(0);
  } finally { h.host.shutdown(); }
});
