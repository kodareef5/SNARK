import { expect, test } from 'bun:test';
import { trafficTrial } from '../../tools/bench/vehicle-traffic.ts';
import { collisionNetworkTrial } from '../../tools/bench/collision-network.ts';

for (const rtt of [150, 300, 320, 330]) test(`native five-car traffic does not freeze or jump between proxy clocks at TCP ${rtt} ms`, () => {
  const r = trafficTrial({ kind: 'fixed', seed: 61, rtt });
  expect(r.frames).toBe(540); expect(r.movingSamples).toBeGreaterThan(1800); expect(r.undecodable).toBe(0);
  expect(r.maxExcessM).toBeLessThan(.5); expect(r.longestHoldMs).toBeLessThan(34);
  if (rtt >= 300) { expect(r.jumpsOver30cm).toBe(0); expect(r.stillFrames).toBe(0); }
});

for (const [kind, rtt] of [['changing', 320], ['burst', 320], ['burst', 80]] as const) test(`native ${kind} ${rtt} ms link preserves bounded proxy transitions and exposes ordinary transport stalls`, () => {
  const on = trafficTrial({ kind, seed: 61, rtt }), off = trafficTrial({ kind, seed: 61, rtt, prediction: false });
  expect(on.movingSamples).toBeGreaterThan(1800); expect(on.undecodable).toBe(0);
  // A delayed ordinary view can still stall/jump after a TCP outage. This repair must not amplify it.
  expect(on.maxExcessM).toBeLessThanOrEqual(off.maxExcessM + .001);
  expect(on.longestHoldMs).toBeLessThanOrEqual(off.longestHoldMs + .001);
  expect(on.jumpsOver30cm).toBeLessThanOrEqual(off.jumpsOver30cm);
  expect(on.ownCorrections).toBe(off.ownCorrections);
  if (kind === 'changing') expect(on.maxFromOrdinaryM).toBeGreaterThan(1); // Actually entered and left prediction.
});

for (const seed of [1, 2, 3]) test(`native parked-car impact predicts the automatic brake, TCP150 seed ${seed}`, () => {
  const r = collisionNetworkTrial({ kind: 'parked', rtt: 150, seed });
  expect(r.predictedHit).toBe(true); expect(r.serverHit).toBe(true); expect(r.comparedSnapshots).toBeGreaterThan(150);
  expect(r.significantCorrections).toBe(0); expect(r.directSnaps).toBe(0); expect(r.peakTranslationM).toBe(0);
});
