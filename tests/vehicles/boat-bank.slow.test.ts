import { expect, test } from 'bun:test';
import { stepBoat } from '../../shared/sim/boat.ts';
import { bankBoat, steepBank, strikeBank } from '../fixtures/boat-bank.ts';

test('the full seventy-seven strike terrain-bank course preserves flotation and usable reverse', () => {
  const world = steepBank();
  for (const throttle of [.4, .5, .6, .7, .8, .9, 1]) for (let angle = 0; angle <= 10; angle++) {
    const r = strikeBank(world, throttle, angle / 10);
    expect(r.first).toBeGreaterThanOrEqual(0); expect(r.capsized).toBe(false); expect(r.maxY).toBeLessThan(.6);
    expect(world.groundAt(r.state.x, r.state.z)).toBeLessThan(0);
    expect(Math.abs(r.neutralY - r.rest)).toBeLessThan(.06); expect(r.path).toBeGreaterThan(3);
    expect(r.state.gear).toBe(-1); expect(r.propWet).toBeGreaterThan(.8);
    expect(r.maxStalled).toBe(0); expect(r.penetration).toBeLessThan(.002);
    if (r.reverse <= 2) {
      // This finite channel has two banks: after useful reverse travel the stern can meet the other wall.
      // Prove that direction is obstructed, then drive out through actual clear geometry; never excuse hidden speed.
      const s = r.state, sn = Math.sin(s.yaw), cs = Math.cos(s.yaw), x = s.x, z = s.z;
      expect(world.blocked(s, { ...s, x: x - sn, z: z - cs }, bankBoat)).not.toBeNull();
      expect(world.blocked(s, { ...s, x: x + sn, z: z + cs }, bankBoat)).toBeNull();
      let path = 0;
      for (let tick = 0; tick < 180; tick++) {
        const px = s.x, pz = s.z; stepBoat(s, { throttle: 1, steer: 0, neutral: false, pilot: true }, bankBoat, world);
        path += Math.hypot(s.x - px, s.z - pz);
      }
      expect(path).toBeGreaterThan(15); expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(10);
    }
  }
});
