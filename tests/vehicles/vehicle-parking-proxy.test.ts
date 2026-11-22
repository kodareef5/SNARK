import { expect, test } from 'bun:test';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { BitReader, BitWriter } from '../../shared/net/codec.ts';
import { ContactSnapshot, readContacts, writeContacts } from '../../shared/net/contact.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { Body, BTN_JUMP, BTN_PRIMARY } from '../../shared/sim/character.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { flatMap } from '../fixtures/map.ts';
import { Harness } from '../fixtures/net.ts';

test('native parked, recovery-coasting and driven cars expose only the automatic brake through the contact wire', () => {
  const h = new Harness({}, 1, 60, { dev: true, wild: false, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const s = h.join('owner'); h.run(700); const c = h.client(s)!, a = h.world.ents;
    const owner = h.host.records.byPid.get(c.pid)!, source = h.host.spawnVehicle('core:compact', 128, 127, owner.team);
    const target = h.host.spawnVehicle('core:compact', 128, 132, owner.team), snapshot = new ContactSnapshot(), decoded = new ContactSnapshot();
    const w = new BitWriter(4096), r = new BitReader(), handle = a.handleOf(target);
    a.setPosition(c.ent, 100, 0, 100); h.world.history.discontinuity(c.ent); h.run(500);
    const packet = () => {
      h.host.urban.contacts!.proxies(source, snapshot); w.reset(); writeContacts(w, snapshot, 32768); r.reset(w.bytes());
      expect(readContacts(r, decoded, h.world.tick)).toBe(true);
      const row = decoded.rows.slice(0, decoded.count).find(p => p.handle === handle); expect(row).toBeDefined();
      return row!;
    };
    expect(packet().parkingBrake).toBe(true);
    // This is the same native callback used by successful local recovery. Its forward-speed/time gates remain authoritative.
    a.vz[target] = 1; h.host.urban.push(target, 0, 1); const z = a.z[target]!;
    expect(packet().parkingBrake).toBe(false); h.run(100); expect(a.z[target]! - z).toBeGreaterThan(.05);
    h.run(1200); expect(packet().parkingBrake).toBe(true); expect(Math.abs(a.vz[target]!)).toBeLessThan(.15);
    a.setPosition(c.ent, a.x[target]! + 1.8, a.y[target]!, a.z[target]! + .12); h.world.history.discontinuity(c.ent);
    expect(h.host.urban.mount(c, target)).toBe(RESULT_OK); h.run(1000); expect(c.drive).toBe(target);
    const row = packet(); expect(row.parkingBrake).toBe(false); const before = w.bytes().slice();
    c.heldButtons = BTN_JUMP | BTN_PRIMARY; c.heldX = 127; c.heldZ = -127;
    const body = new Body(); a.loadBody(target, body); body.fuel = 3; body.vehiclePayloadMass = 400; body.vehicleEngineCondition = .3;
    a.storeBody(target, body);
    expect(packet().parkingBrake).toBe(false); expect(w.bytes()).toEqual(before);
    for (const key of ['buttons', 'moveX', 'moveZ', 'pilot', 'throttle', 'brake']) expect(key in row).toBe(false);
    expect([row.body.fuel, row.body.vehiclePayloadMass, row.body.held, row.body.rounds]).toEqual([0, 0, 0, 0]);
  } finally { h.host.shutdown(); }
});
