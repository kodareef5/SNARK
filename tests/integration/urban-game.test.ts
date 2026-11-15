import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { BTN_JUMP, BTN_USE, stanceEye } from '../../shared/sim/character.ts';
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
  const car = h.host.spawnVehicle('urban:compact', x, z, owner, 0);
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
    h.run(700); h.pilots[0]!.buttons = 0;
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
    const driver = h.host.spawnCreature('urban:civilian', x + 1.25, z + 0.12, 1);
    const passenger = h.host.spawnCreature('urban:civilian', x - 1.25, z + 0.12, 1);
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
    const pid = ents.pid[car]!, fuel = ents.fuel[car]!, wheel = ents.wheelAngle[car]!;
    expect(fuel).toBeLessThan(40);
    h.host.shutdown(); host = null;
    const restored = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath }); host = restored;
    const e = restored.host.records.entOf.get(pid)!;
    expect(e).toBeGreaterThanOrEqual(0);
    expect(restored.world.ents.fuel[e]).toBe(fuel);
    expect(restored.world.ents.wheelAngle[e]).toBe(wheel);
    const record = restored.host.records.byPid.get(pid)!;
    expect(record.team).toBe(owner);
    expect(restored.host.items.inv(record).total(item)).toBe(4);
  } finally { host?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
