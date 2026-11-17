import { expect, test } from 'bun:test';
import { COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { BitReader, BitWriter } from '../../shared/net/codec.ts';
import { CONTACT_HEADER_BITS, ContactSnapshot, contactBody, readContacts, writeContacts } from '../../shared/net/contact.ts';
import { makeHandle } from '../../shared/ids.ts';
import { BTN_JUMP } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { flatWorld } from '../fixtures/world.ts';

function snapshot() {
  const world = flatWorld(), out = new ContactSnapshot();
  out.owner = makeHandle(18, 4); out.epoch = 27; out.count = 16;
  for (let i = 0; i < out.count; i++) {
    const p = out.rows[i]!, b = p.body;
    p.handle = makeHandle(40 + i, i + 1); p.epoch = 3; p.native = p.pilot = p.tamed = true;
    p.mass = 1515; p.radius = 1; p.height = 1.5; p.moveX = -45; p.moveZ = 127; p.yaw = 32767; p.pitch = -1234; p.buttons = BTN_JUMP;
    p.response = i % 3 === 0 ? 'protected' : i % 3 === 1 ? 'fixed' : 'dynamic';
    b.kind = world.kind('core:compact'); b.vehicle = true; b.fuel = 40; b.vehiclePayloadMass = 280;
    b.x = 40; b.z = 40;
    for (let t = 0; t < 20; t++) stepVehicleBody(world, b, p.moveX, p.moveZ, 0, COMPACT_VEHICLE);
    contactBody(b, p.state);
  }
  return out;
}

test('contact snapshot carries full native mechanical state and held controls with qualified identities', () => {
  const src = snapshot(), dst = new ContactSnapshot(), w = new BitWriter(4096), r = new BitReader();
  writeContacts(w, src, 4096 * 8);
  expect(w.overflow).toBe(false);
  r.reset(w.bytes()); expect(readContacts(r, dst, 100)).toBe(true);
  expect([dst.tick, dst.owner, dst.epoch, dst.count, dst.truncated]).toEqual([100, src.owner, 27, 16, false]);
  for (let i = 0; i < src.count; i++) {
    const a = src.rows[i]!, b = dst.rows[i]!;
    expect(b.body.equals(a.body)).toBe(true);
    expect([b.handle, b.epoch, b.response, b.mass, b.native, b.pilot, b.tamed, b.moveX, b.moveZ, b.yaw, b.pitch, b.buttons])
      .toEqual([a.handle, a.epoch, a.response, 1515, true, true, true, -45, 127, 32767, -1234, BTN_JUMP]);
  }
});

test('every contact packet budget keeps its priority prefix and leaves the following view readable', () => {
  const src = snapshot(), dst = new ContactSnapshot(), r = new BitReader();
  for (const bytes of [9, 32, 128, 240, 480, 960]) {
    const w = new BitWriter(bytes + 4), budget = bytes * 8;
    writeContacts(w, src, budget);
    expect(w.overflow).toBe(false); expect(w.pos).toBeLessThanOrEqual(budget);
    w.u32(0xcafef00d);
    expect(w.overflow).toBe(false);
    r.reset(w.bytes()); expect(readContacts(r, dst, 100)).toBe(true);
    expect(r.u32()).toBe(0xcafef00d); expect(r.overflow).toBe(false);
    expect(dst.truncated).toBe(true);
    for (let i = 0; i < dst.count; i++) expect(dst.rows[i]!.handle).toBe(src.rows[i]!.handle);
    if (bytes === 480) expect(dst.count).toBeGreaterThanOrEqual(2);
  }
  const w = new BitWriter(16);
  writeContacts(w, src, CONTACT_HEADER_BITS);
  expect(w.pos).toBe(CONTACT_HEADER_BITS);
  r.reset(w.bytes()); expect(readContacts(r, dst, 100)).toBe(true); expect(dst.count).toBe(0);
});

test('contact decoding rejects malformed counts, non-finite physical facts and truncated bodies', () => {
  const src = snapshot(), dst = new ContactSnapshot(), w = new BitWriter(4096), r = new BitReader();
  w.bool(true); w.u32(src.owner); w.u32(0); w.bits(17, 5); w.bool(false);
  r.reset(w.bytes()); expect(readContacts(r, dst, 1)).toBe(false);
  src.count = 1;
  for (const field of ['mass', 'vx', 'vehicleQw', 'fuel'] as const) {
    w.reset();
    const p = src.rows[0]!, object = field === 'mass' ? p : p.body, key = field as keyof typeof object;
    const old = object[key];
    (object as unknown as Record<string, number>)[field] = NaN;
    writeContacts(w, src, 4096 * 8);
    r.reset(w.bytes()); expect(readContacts(r, dst, 2)).toBe(false);
    (object as unknown as Record<string, unknown>)[field] = old;
  }
  w.reset(); writeContacts(w, src, 4096 * 8);
  r.reset(w.bytes().subarray(0, w.byteLength - 4)); expect(readContacts(r, dst, 3)).toBe(false);
});
