import { expect, test } from 'bun:test';
import { predictedVehiclePose } from '../../client/core/vehicle-view.ts';
import { type ClientSession } from '../../client/core/session.ts';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { makeHandle } from '../../shared/ids.ts';
import { ContactSnapshot } from '../../shared/net/contact.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { Body, BTN_JUMP, BTN_PRIMARY } from '../../shared/sim/character.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { flatMap } from '../fixtures/map.ts';
import { Harness } from '../fixtures/net.ts';

function displayed(s: ClientSession) {
  const a = s.alpha, p = s.ownPrev, b = s.own;
  const q = predictedVehiclePose(p, b, a, false, false, s.vehicleCorrection);
  return { x: p.x + (b.x - p.x) * a + s.smoothX, y: p.y + (b.y - p.y) * a + s.smoothY,
    z: p.z + (b.z - p.z) * a + s.smoothZ, q: [q.qx!, q.qy!, q.qz!, q.qw!] };
}

for (const swerve of [false, true]) test(`TCP150ms native crash ${swerve ? 'eases unknown steering at the actual visible pose' : 'predicts opposing held controls before authority arrives'}`, () => {
  const seed = swerve ? 15 : 6;
  const h = new Harness({}, seed, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const link = { tcp: true, latencyMs: 75, jitterMs: 10 };
    const s = h.join('driver', link), other = h.join('opposing', link);
    h.run(4000);
    const ents = h.world.ents, a = h.client(s)!, b = h.client(other)!;
    const offset = ((seed * 7 % 23) / 22 - .5) * 1.4;
    const car = h.host.spawnVehicle('core:compact', 128, 30, 0, 0);
    const target = h.host.spawnVehicle('core:compact', 128 + offset + (swerve ? 1.65 : 0), 135, 0, Math.PI);
    ents.setPosition(a.ent, 129.6, 0, 30.12);
    ents.setPosition(b.ent, ents.x[target]! - 1.6, 0, 134.88);
    expect(h.host.urban.mount(a, car)).toBe(RESULT_OK); expect(h.host.urban.mount(b, target)).toBe(RESULT_OK);
    h.host.survival.gods.add(a.pid); h.host.survival.gods.add(b.pid);
    h.run(3500); expect(s.driving).toBe(car);
    let impact = 0, predictedForward = false, maxRaw = 0, maxDisplayed = 0, maxAngle = 0, samples = 0;
    const pair = h.host.urban.collisionPair.bind(h.host.urban);
    h.host.urban.collisionPair = event => {
      if ((event.a.entity === car && event.b.entity === target) || (event.a.entity === target && event.b.entity === car)) impact ||= event.tick;
      pair(event);
    };
    const observed = s as unknown as { reconcile(tick: number, body: Body): void };
    const reconcile = observed.reconcile.bind(s);
    observed.reconcile = (tick, body) => {
      const before = displayed(s), x = s.own.x, y = s.own.y, z = s.own.z, sim = s.simTick;
      reconcile(tick, body);
      if (tick >= sim) return;
      const after = displayed(s), dot = Math.abs(before.q.reduce((sum, n, i) => sum + n * after.q[i]!, 0));
      maxRaw = Math.max(maxRaw, Math.hypot(s.own.x - x, s.own.y - y, s.own.z - z));
      maxDisplayed = Math.max(maxDisplayed, Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z));
      maxAngle = Math.max(maxAngle, 2 * Math.acos(Math.min(1, dot)));
      samples++;
    };
    const update = s.update.bind(s), handle = makeHandle(target, ents.gen[target]!);
    s.update = (...args) => {
      const count = s.vehicleContacts!.stats.contacts;
      update(...args);
      const stats = s.vehicleContacts!.stats;
      if (stats.contacts > count && stats.lastTarget === handle) predictedForward = true;
    };
    let swerving = false;
    for (let elapsed = 0; elapsed < 14000 && (!impact || h.world.tick < impact + 90); elapsed += 50) {
      h.run(50, () => {
        const velocity = Math.hypot(ents.vx[car]!, ents.vz[car]!), age = impact ? h.world.tick - impact : 0;
        h.pilots[0]!.moveZ = age > 30 ? 0 : velocity < 19.7 ? 1 : velocity > 20.3 ? 0 : .35;
        h.pilots[0]!.buttons = age > 30 ? BTN_JUMP : 0;
        swerving ||= swerve && ents.z[target]! - ents.z[car]! < 14;
        h.pilots[1]!.moveX = swerving && age < 18 ? 1 : 0;
        h.pilots[1]!.moveZ = velocity > 8 && age < 1 && !swerving ? .7 : 0;
        h.pilots[1]!.buttons = age >= 1 || swerving ? BTN_JUMP : 0;
      });
    }
    expect(impact).toBeGreaterThan(0); expect(predictedForward).toBe(true); expect(samples).toBeGreaterThan(100);
    // Hidden future steering remains a real raw error; the correction must preserve the displayed interpolation endpoints.
    if (swerve) expect(maxRaw).toBeGreaterThan(.5);
    else expect(maxRaw).toBeLessThan(.01);
    expect(maxDisplayed).toBeLessThan(.00001); expect(maxAngle).toBeLessThan(.00001);
    expect(s.stats.undecodable).toBe(0);
  } finally { h.host.shutdown(); }
});

test('a nearby driver gets actor movement without the other survivor’s private weapon state', () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const target = h.join('armed passerby');
    h.run(1200);
    const c = h.client(target)!, ents = h.world.ents, body = new Body(), snapshot = new ContactSnapshot();
    const car = h.host.spawnVehicle('core:compact', 128, 125);
    ents.loadBody(c.ent, body);
    body.x = 128; body.z = 130; body.held = h.reg.index.get('core:pistol')!;
    body.rounds = 7; body.bloom = 15; body.kick = 9;
    ents.storeBody(c.ent, body);
    c.heldButtons = BTN_JUMP | BTN_PRIMARY;
    h.host.urban.contacts!.proxies(car, snapshot);
    expect(snapshot.count).toBe(1);
    const row = snapshot.rows[0]!;
    expect(row.buttons).toBe(BTN_JUMP);
    expect([row.body.held, row.body.rounds, row.body.reloadTo, row.body.bloom, row.body.kick]).toEqual([0, 0, 0, 0, 0]);
    ents.loadBody(c.ent, body);
    expect([body.rounds, body.bloom, body.kick]).toEqual([7, 15, 9]);
  } finally { h.host.shutdown(); }
});
