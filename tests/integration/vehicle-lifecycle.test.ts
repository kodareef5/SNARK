import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_NOT_YOURS, RESULT_OK } from '../../shared/net/protocol.ts';
import { CORE_CONTENT } from '../../content/core.ts';
import { compileContent } from '../../shared/content/registry.ts';
import { createVehicle, type VehicleSeat } from '../../shared/sim/vehicle.ts';
import { STANCE_CROUCH, stanceHeight } from '../../shared/sim/character.ts';
import { V_HEALTH } from '../../shared/sim/vitals.ts';
import { capsuleFree } from '../../shared/world/collide.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';
import { Harness } from '../fixtures/net.ts';
import { flatGround } from '../fixtures/arena.ts';

function setup(dbPath?: string) {
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
  return { h, me, other, car, x, z, owner, ground };
}

test('a destroyed car releases its driver and passenger and frees its seats for another car', () => {
  const { h, me, other, car, x, z, owner } = setup();
  try {
    const ents = h.world.ents, pid = ents.pid[car]!;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    expect(h.host.urban.mount(other, car)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(car);
    expect(ents.seatSlot[other.ent]).toBe(2);
    h.host.survival.hurt(h.host.records.byPid.get(pid)!, 1e6, 0);
    h.run(200);
    expect(h.host.records.entOf.has(pid)).toBe(false);
    for (const c of [me, other]) {
      expect(c.drive).toBe(-1);
      expect(ents.seat[c.ent]).toBe(0);
      expect(h.host.urban.riding(c)).toBe(false);
    }
    // The survivor is free to use the next car normally.
    const next = h.host.spawnVehicle('core:compact', x, z + 8, owner, 0);
    h.say(h.sessions[0]!, `tp ${x + 1.6} ${z + 8.12}`); h.run(100);
    expect(h.host.urban.mount(me, next)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(next);
  } finally { h.host.shutdown(); }
});

test('PvE keeps another tribe out of its cars and its survivors in their seats; PvP allows theft', () => {
  const { h, me, other, car, x, z, owner, ground } = setup();
  try {
    const ents = h.world.ents, rec = h.host.records.byPid.get(ents.pid[car]!)!;
    expect(h.host.records.byPid.get(other.pid)!.team).not.toBe(owner);
    expect(h.host.setSetting('serverPVE', 'True')).toBe('');
    expect(h.host.urban.mount(other, car)).toBe(RESULT_NOT_YOURS);
    // The owner's tribe may use it, and an unowned car is anyone's.
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    h.run(800);
    expect(me.drive).toBe(car);
    rec.team = 0;
    // Around the car, not across it: a jump through the hull is clipped like a walk through it.
    ents.setPosition(other.ent, x - 1.6, ground.y, z + 6); h.run(50);
    ents.setPosition(other.ent, x + 1.6, ground.y, z + 6); h.run(50);
    ents.setPosition(other.ent, x + 1.6, ground.y, z + 0.12); h.run(50);
    expect(h.host.urban.mount(other, car)).toBe(RESULT_NOT_YOURS);
    expect(me.drive).toBe(car);
    expect(h.host.setSetting('serverPVE', 'False')).toBe('');
    expect(h.host.urban.mount(other, car)).toBe(RESULT_OK);
    h.run(800);
    expect(other.drive).toBe(car);
    expect(me.drive).toBe(-1);
  } finally { h.host.shutdown(); }
});

test('a saved car from another build or a retuned definition loads clamped instead of stopping the world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snark-urban-clamp-')), dbPath = join(dir, 'world.db');
  let active: Harness | null = null;
  try {
    const { h, car, x, z, owner } = setup(dbPath); active = h;
    const second = h.host.spawnVehicle('core:compact', x, z + 8, owner, 0);
    const ents = h.world.ents, pid = ents.pid[car]!, pid2 = ents.pid[second]!;
    h.run(100);
    // A v4 component whose fuel and gear exceed the current definition.
    const tuned = new Uint8Array(h.host.records.byPid.get(pid)!.extra.get(0x757262)!);
    const view = new DataView(tuned.buffer);
    view.setFloat32(1 + 5 * 4, 999, true);
    view.setFloat32(1 + 16 * 4, 40, true);
    view.setFloat32(1 + 1 * 4, 8, true); // attitude
    view.setFloat32(1 + 3 * 4, 9, true); // steering
    view.setFloat32(1 + 6 * 4, 20, true); // yaw inertia
    view.setFloat32(1 + 11 * 4, 12, true); // suspension extension
    view.setFloat32(1 + 13 * 4, 120, true); // horizontal speed
    view.setFloat32(1 + 14 * 4, 120, true); // vertical speed
    h.host.records.byPid.get(pid)!.extra.set(0x757262, tuned);
    // A component version this build does not know.
    const future = new Uint8Array(90); future[0] = 9;
    h.host.records.byPid.get(pid2)!.extra.set(0x757262, future);
    h.host.records.dirty.add(pid); h.host.records.dirty.add(pid2);
    h.host.shutdown(); active = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); active = restored;
    const definition = restored.reg.vehicle[restored.reg.index.get('core:compact')!]!;
    if (definition.movement === 'rotor' || definition.movement === 'boat') throw new Error('compact must keep its wheeled controller');
    const spec = definition.spec;
    const e = restored.host.records.entOf.get(pid)!, e2 = restored.host.records.entOf.get(pid2)!;
    expect(restored.world.ents.fuel[e]).toBe(Math.fround(spec.fuelCapacity));
    expect(restored.world.ents.vehicleGear[e]).toBe(spec.drivetrain!.forwardRatios.length);
    expect(Math.abs(restored.world.ents.vehiclePitch[e]!)).toBeLessThan(1);
    expect(restored.world.ents.steering[e]).toBe(Math.fround(spec.maxSteer));
    expect(restored.world.ents.vehicleYawRate[e]).toBe(3);
    expect(restored.world.ents.vehicleRideOffset[e]).toBe(Math.fround(spec.suspensionTravel!));
    expect(restored.world.ents.vx[e]).toBe(spec.maxForward);
    expect(restored.world.ents.vy[e]).toBe(60);
    expect(restored.world.ents.fuel[e2]).toBe(Math.fround(spec.fuelCapacity));
    expect(restored.host.records.byPid.get(pid2)!.extra.get(0x757263)).toEqual(future);
    // The unreadable future component survives the ordinary record codec too.
    restored.host.shutdown(); active = null;
    const again = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); active = again;
    expect(again.host.records.byPid.get(pid2)!.extra.get(0x757263)).toEqual(future);
  } finally { active?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test('content refuses vehicle seats the seat authority would refuse at spawn', () => {
  const broken = (seats: (s: VehicleSeat[]) => VehicleSeat[]): string[] => compileContent(CORE_CONTENT.map(d =>
    d.type === 'species' && d.vehicle ? { ...d, vehicle: { ...d.vehicle, seats: seats([...d.vehicle.seats]) } } : d)).errors;
  expect(broken(s => s)).toEqual([]);
  expect(broken(s => s.map(seat => seat.driver ? { ...seat, id: 'Driver' } : seat))[0]).toContain('core:compact');
  const many = (s: VehicleSeat[]) => [s[0]!, ...Array.from({ length: 16 }, (_, i) => ({ ...s[1]!, id: `rear_${i}` }))];
  expect(broken(many)[0]).toContain('core:compact');
});

test('a passenger adopts its pinned seat from snapshots instead of replaying a correction for each one', () => {
  const { h, me, other, car } = setup();
  try {
    const bob = h.sessions[1]!;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
    expect(h.host.urban.mount(other, car)).toBe(RESULT_OK);
    h.run(800);
    expect(bob.own.seatSlot).toBe(2);
    const before = bob.stats.corrections, z = h.world.ents.z[car]!;
    h.pilots[0]!.moveZ = 127; h.run(1500);
    expect(h.world.ents.z[car]!).toBeGreaterThan(z + 3);
    expect(bob.stats.corrections - before).toBe(0);
    // The passenger's own body still follows the car it sits in.
    expect(Math.hypot(bob.own.x - h.world.ents.x[car]!, bob.own.z - h.world.ents.z[car]!)).toBeLessThan(3);
  } finally { h.host.shutdown(); }
});

test('destroying a car under a low ceiling recovers a fitting crouched capsule', () => {
  const { h, me, car, x, z, ground } = setup();
  try {
    const ents = h.world.ents;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK); h.run(800);
    h.world.structs.add(h.reg.index.get('core:ceiling')!, x, ground.y + 1.7, z, 0, 0, 100);
    const definition = h.reg.vehicle[ents.kind[car]!]!;
    if (definition.movement === 'rotor' || definition.movement === 'boat') throw new Error('compact must keep its wheeled controller');
    const spec = definition.spec, parked = createVehicle(spec, x, ground.y, z);
    expect(new StaticVehicleWorld(h.world).blocked(parked, parked, spec)).toBeNull();
    h.host.survival.hurt(h.host.records.byPid.get(ents.pid[car]!)!, 1e6, 0);
    h.run(100);
    const p = h.reg.move[ents.kind[me.ent]!]!;
    expect(me.drive).toBe(-1); expect(ents.seat[me.ent]).toBe(0);
    expect(ents.stance[me.ent]).toBe(STANCE_CROUCH);
    expect(capsuleFree(h.world, ents.x[me.ent]!, ents.y[me.ent]!, ents.z[me.ent]!, p.radius, stanceHeight(p, ents.stance[me.ent]!))).toBe(true);
  } finally { h.host.shutdown(); }
});

test('a temporary bola suspends control and collision credit, then the same driver resumes', () => {
  const { h, me, other, car } = setup();
  try {
    const rec = h.host.records.byPid.get(me.pid)!, buff = h.reg.index.get('core:entangled')!;
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK); h.run(800);
    expect(h.host.entangle.give(rec, buff, other.pid)).toBe(true); h.run(100);
    expect(me.drive).toBe(-1); expect(h.host.urban.riderOf(car)).toBeNull();
    expect(h.host.urban.occupancy.seatOf(me.pid)?.seat).toBe('driver');
    h.host.buffs.take(rec, buff); h.run(100);
    expect(me.drive).toBe(car); expect(h.host.urban.riderOf(car)).toBe(rec);
    const z = h.world.ents.z[car]!;
    h.pilots[0]!.moveZ = 127; h.run(350);
    expect(h.world.ents.z[car]!).toBeGreaterThan(z + 0.05);
  } finally { h.host.shutdown(); }
});

test('a revoked driver cannot deal coast damage or permanently deny the PvE owner its seat', () => {
  const { h, me, other, car, x, z, ground } = setup();
  try {
    const ents = h.world.ents, carRec = h.host.records.byPid.get(ents.pid[car]!)!;
    carRec.team = h.host.records.byPid.get(other.pid)!.team; ents.setTeam(car, carRec.team);
    ents.setPosition(other.ent, x + 5, ground.y, z + 0.12);
    expect(h.host.urban.mount(me, car)).toBe(RESULT_OK); h.run(800);
    const bird = h.host.spawnCreature('core:dodo', x, z + 2.45, 1), victim = h.host.records.byPid.get(ents.pid[bird]!)!;
    const health = h.host.survival.value(victim, V_HEALTH);
    expect(h.host.setSetting('serverPVE', 'True')).toBe(''); ents.vz[car] = 10;
    me.inputs.set(h.world.tick + 1, 0, 127, 0, 0, 0); h.server.tick();
    expect(me.drive).toBe(-1); expect(h.host.urban.riderOf(car)).toBeNull();
    expect(h.host.survival.value(victim, V_HEALTH)).toBe(health);
    // The revoked driver gets out, moving or not, and the car stops on its handbrake.
    h.run(3000);
    expect(h.host.urban.riding(me)).toBe(false);
    ents.setPosition(me.ent, ents.x[car]! + 6, ground.y, ents.z[car]!);
    ents.setPosition(other.ent, ents.x[car]! + 1.6, ground.y, ents.z[car]! + 0.12);
    expect(h.host.urban.mount(other, car)).toBe(RESULT_OK); h.run(800);
    expect(other.drive).toBe(car); expect(h.host.urban.riding(me)).toBe(false);
  } finally { h.host.shutdown(); }
});
