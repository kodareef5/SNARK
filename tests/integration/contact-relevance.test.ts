import { expect, test } from 'bun:test';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { ContactSnapshot, writeContacts } from '../../shared/net/contact.ts';
import { BitWriter } from '../../shared/net/codec.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { Body, MF_ROOTED } from '../../shared/sim/character.ts';
import { capsuleFree, push } from '../../shared/world/collide.ts';
import { Found } from '../../shared/world/structures.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { flatMap } from '../fixtures/map.ts';
import { Harness } from '../fixtures/net.ts';
import { frozenPack } from '../fixtures/pack.ts';

function fixture(posed = false) {
  const pack = posed ? frozenPack() : null;
  return new Harness({}, 41, 60, { dev: true, clips: pack?.clips ?? NO_CLIPS, rigs: pack?.header.rigs ?? [], map: writeMap(flatMap(4)) });
}

test('30 off-road bystanders add no driving replay or proxy simulation through a native kerb', () => {
  const results: { steps: number; corrections: number; proxySteps: number; z: number }[] = [];
  for (const count of [0, 30]) {
    const h = fixture();
    try {
      const s = h.join('driver', { tcp: true, latencyMs: 75, jitterMs: 10 }); h.run(4000);
      const c = h.client(s)!, ents = h.world.ents, car = h.host.spawnVehicle('core:compact', 128, 20);
      ents.setPosition(c.ent, 129.6, 0, 20.12); expect(h.host.urban.mount(c, car)).toBe(RESULT_OK);
      const wall = h.reg.index.get('core:foundation')!;
      for (const x of [125, 128, 131]) h.world.structs.add(wall, x, 0, 45, 0, 0, 15000);
      for (let i = 0; i < count; i++) {
        const e = h.host.spawnCreature('core:raptor', 128 + (i % 2 ? -8 : 8), 40 + i * 5, 1);
        ents.mflags[e] = ents.mflags[e]! | MF_ROOTED;
      }
      h.host.survival.gods.add(c.pid); h.run(3000);
      const prediction = s.vehicleContacts!, step = prediction.step.bind(prediction); let steps = 0;
      prediction.step = (...args) => { steps++; step(...args); };
      const initial = s.stats.corrections;
      h.run(10000, () => { const v = Math.hypot(ents.vx[car]!, ents.vz[car]!); h.pilots[0]!.moveZ = v < 12 ? 1 : v > 12.5 ? 0 : .4; });
      results.push({ steps, corrections: s.stats.corrections - initial, proxySteps: prediction.stats.steps, z: ents.z[car]! });
      expect(prediction.stats.contacts).toBe(0); expect(ents.z[car]!).toBeGreaterThan(100);
      expect(s.stats.undecodable).toBe(0);
    } finally { h.host.shutdown(); }
  }
  expect(results[1]).toEqual(results[0]);
  expect(results[0]!.steps).toBeLessThan(330); expect(results[0]!.proxySteps).toBe(0);
});

test('public vehicle packets reveal neither carried cargo through mass nor private mechanical condition', () => {
  const h = fixture();
  try {
    const own = h.host.spawnVehicle('core:compact', 128, 60), target = h.host.spawnVehicle('core:compact', 131.5, 60);
    const v = h.world.ents.vrow[target]!, s = new ContactSnapshot(), w = new BitWriter(1024);
    const bytes = () => { h.host.urban.contacts!.proxies(own, s); expect(s.count).toBe(1); w.reset(); writeContacts(w, s, 8192); return w.bytes().slice(); };
    const initial = bytes();
    h.world.ents.vehiclePayloadMass[v] = 430; h.world.ents.vehicleFlooding[v] = .7;
    h.world.ents.vehicleHullCondition[v] = .2; h.world.ents.fuel[v] = 2;
    expect(bytes()).toEqual(initial); expect(s.rows[0]!.mass).toBe(1100);
    expect(h.world.ents.vehiclePayloadMass[v]).toBe(430);
  } finally { h.host.shutdown(); }
});

test('a ridden parasaur publishes observed slow motion, never its AI or rider controls', () => {
  const h = fixture(true);
  try {
    const s = h.join('rider'); h.run(1000);
    const c = h.client(s)!, ents = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
    const mount = h.host.spawnCreature('core:parasaur', 128, 70, 1), rec = h.host.records.byPid.get(ents.pid[mount]!)!;
    rec.team = owner.team; rec.saddle = h.reg.index.get('core:saddle_parasaur')!; ents.setTeam(mount, rec.team);
    h.host.refreshBody(rec); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff);
    ents.setPosition(c.ent, 126, 0, 70); expect(h.host.riding.mount(c, mount)).toBe(RESULT_OK); h.run(1000);
    const car = h.host.spawnVehicle('core:compact', 131.5, 70), snapshot = new ContactSnapshot();
    let moving = 0, visible = 0;
    for (let t = 0; t < 24; t++) {
      c.inputs.set(h.world.tick + 1, 0, 12, 0, 0, 0); h.server.tick();
      h.host.urban.contacts!.proxies(car, snapshot);
      for (let i = 0; i < snapshot.count; i++) if ((snapshot.rows[i]!.handle & 0xfffff) === mount) {
        const row = snapshot.rows[i]!; visible++;
        expect(row.body.vz).toBe(ents.vz[mount]!); expect('moveZ' in row).toBe(false);
        if (row.body.vz > .01) moving++;
      }
    }
    expect(c.drive).toBe(mount); expect(visible).toBeGreaterThan(10); expect(moving).toBeGreaterThan(5);
    let uncertain = 0;
    for (let t = 0; t < 24; t++) {
      c.inputs.set(h.world.tick + 1, 0, 127, 0, 0, 0); h.server.tick();
      h.host.urban.contacts!.proxies(car, snapshot);
      if (Math.hypot(ents.vx[mount]!, ents.vz[mount]!) > 2) {
        uncertain++;
        expect(snapshot.rows.slice(0, snapshot.count).some(row => (row.handle & 0xfffff) === mount)).toBe(false);
      }
    }
    expect(uncertain).toBeGreaterThan(5);
  } finally { h.host.shutdown(); }
});

test('a real runner stops short of a passing car at TCP150 without a speculative crossing impact', () => {
  const h = fixture();
  try {
    const link = { tcp: true, latencyMs: 75, jitterMs: 10 };
    const driver = h.join('driver', link), runner = h.join('runner', link); h.run(4000);
    const a = h.client(driver)!, b = h.client(runner)!, ents = h.world.ents;
    const car = h.host.spawnVehicle('core:compact', 128, 30);
    ents.setPosition(a.ent, 129.6, 0, 30.12); expect(h.host.urban.mount(a, car)).toBe(RESULT_OK);
    ents.setPosition(b.ent, 136, 0, 70); h.world.history.discontinuity(b.ent);
    h.host.survival.gods.add(a.pid); h.host.survival.gods.add(b.pid); h.run(3000);
    let impacts = 0, moving = 0, stopped = false, maxRaw = 0;
    const pair = h.host.urban.collisionPair.bind(h.host.urban);
    h.host.urban.collisionPair = e => { if (e.a.entity === car && e.b.entity === b.ent || e.b.entity === car && e.a.entity === b.ent) impacts++; pair(e); };
    const observed = driver as unknown as { reconcile(tick: number, body: Body): void }, reconcile = observed.reconcile.bind(driver);
    observed.reconcile = (tick, body) => {
      const x = driver.own.x, y = driver.own.y, z = driver.own.z, sim = driver.simTick;
      reconcile(tick, body);
      if (tick < sim) maxRaw = Math.max(maxRaw, Math.hypot(driver.own.x - x, driver.own.y - y, driver.own.z - z));
    };
    const initialContacts = driver.vehicleContacts!.stats.contacts;
    h.run(10000, () => {
      const v = Math.hypot(ents.vx[car]!, ents.vz[car]!); h.pilots[0]!.moveZ = v < 15 ? 1 : 0;
      stopped ||= ents.x[b.ent]! < 131.8;
      h.pilots[1]!.yaw = -Math.PI / 2; h.pilots[1]!.moveZ = ents.z[car]! > 54 && !stopped ? 1 : 0;
      if (Math.abs(ents.vx[b.ent]!) > 2) moving++;
    });
    expect(moving).toBeGreaterThan(10); expect(stopped).toBe(true); expect(ents.x[b.ent]!).toBeGreaterThan(130.5);
    expect(ents.z[car]!).toBeGreaterThan(90); expect(impacts).toBe(0);
    expect(driver.vehicleContacts!.stats.contacts - initialContacts).toBe(0); expect(maxRaw).toBeLessThan(.03);
    expect(driver.stats.undecodable).toBe(0);
  } finally { h.host.shutdown(); }
});

test('late-join structure relinking cannot change the ordered capsule correction normal', () => {
  const h = new Harness({ maxClients: 64 }, 91, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const S = h.world.structs, wall = h.reg.index.get('core:wall')!;
    const refs = [[50, 60, 0], [51.5, 61.5, 16384], [52.9, 60, 0], [50.7, 60.2, 2000], [49.3, 61.4, 16384]]
      .map(([x, z, yaw]) => S.add(wall, x!, 1.5, z!, yaw!, 0, 10000));
    S.remove(refs[1]!); S.add(wall, 51.5, 1.5, 61.5, 16384, 0, 10000);
    const s = h.join('late'); h.run(5000); const client = s.world!, a = new Found(), b = new Found();
    const na = S.query(47, 57, 55, 64, a), nb = client.structs.query(47, 57, 55, 64, b);
    expect(Array.from(a.refs.slice(0, na)).sort()).toEqual(Array.from(b.refs.slice(0, nb)).sort());
    let blocked = 0, differentUnordered = 0;
    for (let i = 0; i < 400; i++) {
      const x = 50 + i % 20 * .15, z = 59.2 + Math.floor(i / 20) * .12;
      const oldFree = capsuleFree(h.world, x, 0, z, .4, 1.8), oldNormal = [push.x, push.y, push.z];
      const clientFree = capsuleFree(client, x, 0, z, .4, 1.8);
      if (oldFree !== clientFree || !oldFree && oldNormal.some((n, k) => n !== [push.x, push.y, push.z][k])) differentUnordered++;
      const free = capsuleFree(h.world, x, 0, z, .4, 1.8, true), normal = [push.x, push.y, push.z];
      expect(capsuleFree(client, x, 0, z, .4, 1.8, true)).toBe(free);
      if (!free) { blocked++; expect([push.x, push.y, push.z]).toEqual(normal); }
    }
    expect(blocked).toBeGreaterThan(100); expect(differentUnordered).toBeGreaterThan(0);
  } finally { h.host.shutdown(); }
});
