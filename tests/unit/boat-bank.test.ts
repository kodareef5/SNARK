import { expect, test } from 'bun:test';
import { steepBank, strikeBank } from '../fixtures/boat-bank.ts';

test('steep terrain banks reject direct and glancing boats without vaulting, capsizing or pinning reverse', () => {
  const world = steepBank();
  for (const [throttle, angle] of [[.6, 0], [1, 0], [1, .6], [.7, .7], [.5, .4]]) {
    const r = strikeBank(world, throttle!, angle!);
    expect(r.first).toBeGreaterThanOrEqual(0); expect(r.capsized).toBe(false); expect(r.maxY).toBeLessThan(.6);
    expect(Math.abs(r.neutralY - r.rest)).toBeLessThan(.06); expect(r.path).toBeGreaterThan(3);
    expect(r.state.gear).toBe(-1); expect(r.reverse).toBeGreaterThan(2); expect(r.propWet).toBeGreaterThan(.8);
    expect(r.maxStalled).toBe(0); expect(r.penetration).toBeLessThan(.002);
    expect(world.groundAt(r.state.x, r.state.z)).toBeLessThan(0);
    // This glancing boat brakes, reverses and returns near its starting point: net displacement alone falsely calls it pinned.
    if (throttle === .7) { expect(r.net).toBeLessThan(1); expect(r.path).toBeGreaterThan(10); }
  }
});

test('one- and three-metre moderate banks reject hulls without vaulting and leave a powered reverse route', () => {
  for (const above of [1, 3]) for (const degrees of [45, 55, 60]) for (const angle of [0, .6]) {
    const world = steepBank(above, degrees * Math.PI / 180), r = strikeBank(world, 1, angle);
    expect(r.first).toBeGreaterThanOrEqual(0); expect(r.capsized).toBe(false); expect(r.maxY).toBeLessThan(.6);
    expect(Math.abs(r.neutralY - r.rest)).toBeLessThan(.06); expect(r.path).toBeGreaterThan(3);
    expect(r.state.gear).toBe(-1); expect(r.reverse).toBeGreaterThan(2); expect(r.propWet).toBeGreaterThan(.8);
    expect(r.maxStalled).toBe(0); expect(r.penetration).toBeLessThan(.002); expect(world.groundAt(r.state.x, r.state.z)).toBeLessThan(0);
  }
});
