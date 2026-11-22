import { expect, test } from 'bun:test';
import { stepBoat } from '../../shared/sim/boat.ts';
import { bankBoat, steepBank, strikeBank } from '../fixtures/boat-bank.ts';

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

test('a stranded moderate-bank boat retires obstructed velocity while preserving a real sideways shove', () => {
  for (const degrees of [20, 29]) {
    const world = steepBank(2, degrees * Math.PI / 180), r = strikeBank(world, .6, .1);
    expect(r.first).toBeGreaterThanOrEqual(0); expect(r.capsized).toBe(false);
    expect(r.maxStalled).toBe(0); expect(Math.hypot(r.state.vx, r.state.vy, r.state.vz)).toBeLessThan(1);
    // The propeller is dry: this case needs physical recovery, not fictitious engine-powered reverse.
    expect(world.groundAt(r.state.x, r.state.z)).toBeGreaterThan(0); expect(r.propWet).toBe(0);
    for (const sign of [-1, 1]) {
      const s = { ...r.state }, x = s.x; s.vx += sign * 1.25;
      for (let tick = 0; tick < 90; tick++) {
        stepBoat(s, { throttle: 0, steer: 0, neutral: true, pilot: false }, bankBoat, world);
      }
      expect(sign * (s.x - x)).toBeGreaterThan(.08);
      expect(world.penetration(s, bankBoat)?.depth ?? 0).toBeLessThan(.002);
    }
  }
});
