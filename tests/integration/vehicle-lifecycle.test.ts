import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_NOT_YOURS, RESULT_OK } from '../../shared/net/protocol.ts';
import { CORE_CONTENT } from '../../content/core.ts';
import { compileContent } from '../../shared/content/registry.ts';
import type { VehicleSeat } from '../../shared/sim/vehicle.ts';
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
  const car = h.host.spawnVehicle('urban:compact', x, z, owner, 0);
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
    const next = h.host.spawnVehicle('urban:compact', x, z + 8, owner, 0);
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
    const second = h.host.spawnVehicle('urban:compact', x, z + 8, owner, 0);
    const ents = h.world.ents, pid = ents.pid[car]!, pid2 = ents.pid[second]!;
    h.run(100);
    // A v4 component whose fuel and gear exceed the current definition.
    const tuned = new Uint8Array(h.host.records.byPid.get(pid)!.extra.get(0x757262)!);
    const view = new DataView(tuned.buffer);
    view.setFloat32(1 + 5 * 4, 999, true);
    view.setFloat32(1 + 16 * 4, 40, true);
    h.host.records.byPid.get(pid)!.extra.set(0x757262, tuned);
    // A component version this build does not know.
    const future = new Uint8Array(90); future[0] = 9;
    h.host.records.byPid.get(pid2)!.extra.set(0x757262, future);
    h.host.records.dirty.add(pid); h.host.records.dirty.add(pid2);
    h.host.shutdown(); active = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); active = restored;
    const spec = restored.reg.vehicle[restored.reg.index.get('urban:compact')!]!.spec;
    const e = restored.host.records.entOf.get(pid)!, e2 = restored.host.records.entOf.get(pid2)!;
    expect(restored.world.ents.fuel[e]).toBe(Math.fround(spec.fuelCapacity));
    expect(restored.world.ents.vehicleGear[e]).toBe(spec.drivetrain!.forwardRatios.length);
    expect(restored.world.ents.fuel[e2]).toBe(Math.fround(spec.fuelCapacity));
  } finally { active?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test('content refuses vehicle seats the seat authority would refuse at spawn', () => {
  const broken = (seats: (s: VehicleSeat[]) => VehicleSeat[]): string[] => compileContent(CORE_CONTENT.map(d =>
    d.type === 'species' && d.vehicle ? { ...d, vehicle: { ...d.vehicle, seats: seats([...d.vehicle.seats]) } } : d)).errors;
  expect(broken(s => s)).toEqual([]);
  expect(broken(s => s.map(seat => seat.driver ? { ...seat, id: 'Driver' } : seat))[0]).toContain('urban:compact');
  const many = (s: VehicleSeat[]) => [s[0]!, ...Array.from({ length: 16 }, (_, i) => ({ ...s[1]!, id: `rear_${i}` }))];
  expect(broken(many)[0]).toContain('urban:compact');
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
