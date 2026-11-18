// Native Host + TCP loopback + ClientSession traffic. Public APIs only; no private prediction maps or render hooks.
// bun tools/bench/vehicle-traffic.ts [fixed|changing|burst|all] [seed=61] [rtt=320] [on|off|paired=on]
// Five oncoming driven cars pass a driver. Measure displayed movement per actual frame against authority speed,
// not the tautologically continuous before/after reconcile endpoint. CPU/browser performance is not measured here.
import { RemoteSample, type ClientSession } from '../../client/core/session.ts';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { flatMap } from '../../tests/fixtures/map.ts';
import { Harness } from '../../tests/fixtures/net.ts';

export type TrafficCase = 'fixed' | 'changing' | 'burst';
export interface TrafficOptions { kind: TrafficCase; seed: number; rtt: number; prediction?: boolean }
let map: ReturnType<typeof writeMap> | undefined;
export function trafficTrial({ kind, seed, rtt, prediction = true }: TrafficOptions) {
  const h = new Harness({ maxClients: 8 }, seed, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: map ??= writeMap(flatMap(4)) });
  try {
    const link = { tcp: true, latencyMs: (kind === 'changing' ? 80 : rtt) / 2, jitterMs: 10, loss: kind === 'burst' ? .02 : 0, burstMs: kind === 'burst' ? 80 : 0 };
    const driver = h.join('driver', link), others = Array.from({ length: 5 }, (_, i) => h.join(`traffic-${i}`, link));
    h.run(4000); const a = h.world.ents;
    const seat = (session: ClientSession, x: number, z: number, yaw: number): number => {
      const c = h.client(session)!, car = h.host.spawnVehicle('core:compact', x, z, 0, yaw), side = yaw ? -1 : 1;
      if (car < 0) throw new Error('traffic car did not spawn');
      a.setPosition(c.ent, x + side * 1.6, a.y[car]!, z + side * .12); h.world.history.discontinuity(c.ent);
      if (h.host.urban.mount(c, car) !== RESULT_OK) throw new Error('traffic driver did not board');
      h.host.survival.gods.add(c.pid); return car;
    };
    const car = seat(driver, 128, 20, 0), cars = others.map((s, i) => seat(s, 128 + (i % 2 ? -3.4 : 3.4), 230 - 12 * i, Math.PI));
    h.run(3500);
    if (driver.driving !== car || others.some((s, i) => s.driving !== cars[i])) throw new Error('traffic fixture lost a driver');
    if (!prediction) driver.vehicleContacts = null;
    const draw = new RemoteSample(), again = new RemoteSample(), ordinary = new RemoteSample();
    const seen = new Uint32Array(5), lastX = new Float64Array(5), lastZ = new Float64Array(5), hold = new Float64Array(5);
    let frames = 0, movingSamples = 0, jumps = 0, maxExcess = 0, maxStep = 0, still = 0, longestHold = 0, maxFromAuthority = 0, maxFromOrdinary = 0;
    const jumpsByPhase = [0, 0, 0, 0, 0], maxByPhase = [0, 0, 0, 0, 0]; let phase = 0;
    const corrections = driver.stats.corrections, start = h.now;
    for (let frame = 0; frame < 540; frame++) {
      const elapsed = h.now - start;
      phase = elapsed < 5500 ? 0 : elapsed < 6500 ? 1 : elapsed < 7500 ? 2 : elapsed < 8500 ? 3 : 4;
      if (kind === 'changing') {
        const value = [80, 320, 80, 350, 80][phase]!;
        for (const end of h.ends) end.link.latencyMs = value / 2;
      }
      if (kind === 'burst' && (frame === 270 || frame === 420)) h.net.outage(h.ends[0]!, 180);
      const ids = [car, ...cars], speeds = [20, 17, 19.3, 21.6, 23.9, 19.2];
      for (let i = 0; i < ids.length; i++) {
        h.pilots[i]!.moveZ = Math.hypot(a.vx[ids[i]!]!, a.vz[ids[i]!]!) < speeds[i]! ? 1 : 0;
        h.pilots[i]!.buttons = 0; h.pilots[i]!.moveX = 0;
      }
      const before = h.now; h.run(1000 / 60); const dt = (h.now - before) / 1000;
      driver.sampleRemote(draw); driver.sampleRemote(again); frames++;
      const contacts = driver.vehicleContacts; driver.vehicleContacts = null; driver.sampleRemote(ordinary); driver.vehicleContacts = contacts;
      for (let i = 0; i < draw.count; i++) {
        const k = cars.indexOf(draw.id[i]!); if (k < 0) continue;
        if (draw.gen[i] !== a.gen[cars[k]!]) throw new Error('traffic handle changed');
        if (draw.id[i] !== again.id[i] || draw.x[i] !== again.x[i] || draw.y[i] !== again.y[i] || draw.z[i] !== again.z[i] ||
          draw.vehicleQx[i] !== again.vehicleQx[i] || draw.vehicleQy[i] !== again.vehicleQy[i] || draw.vehicleQz[i] !== again.vehicleQz[i] || draw.vehicleQw[i] !== again.vehicleQw[i]) throw new Error('repeated public draw changed presentation');
        const x = draw.x[i]!, z = draw.z[i]!, speed = Math.hypot(a.vx[cars[k]!]!, a.vz[cars[k]!]!);
        if (!Number.isFinite(x + z + speed)) throw new Error('invalid traffic sample');
        if (seen[k]! > 0) {
          const distance = Math.hypot(x - lastX[k]!, z - lastZ[k]!), excess = Math.abs(distance - speed * dt);
          maxExcess = Math.max(maxExcess, excess); maxStep = Math.max(maxStep, distance); maxByPhase[phase] = Math.max(maxByPhase[phase]!, excess);
          if (excess > .3) { jumps++; jumpsByPhase[phase]!++; }
          if (speed > 5) { movingSamples++; if (distance < .01) { still++; hold[k]! += dt * 1000; longestHold = Math.max(longestHold, hold[k]!); } else hold[k] = 0; }
        }
        maxFromAuthority = Math.max(maxFromAuthority, Math.hypot(x - a.x[cars[k]!]!, z - a.z[cars[k]!]!));
        const j = ordinary.id.subarray(0, ordinary.count).indexOf(draw.id[i]!);
        if (j >= 0) maxFromOrdinary = Math.max(maxFromOrdinary, Math.hypot(x - ordinary.x[j]!, z - ordinary.z[j]!));
        lastX[k] = x; lastZ[k] = z; seen[k]!++;
      }
    }
    if (seen.some(n => n < 500) || movingSamples < 1800) throw new Error(`missing/nonmoving traffic samples: ${seen} / ${movingSamples}`);
    return { kind, seed, rtt, prediction, frames, samples: Array.from(seen), movingSamples, jumpsOver30cm: jumps, maxExcessM: maxExcess,
      maxStepM: maxStep, stillFrames: still, longestHoldMs: longestHold, maxFromAuthorityM: maxFromAuthority, maxFromOrdinaryM: maxFromOrdinary,
      jumpsByPhase, maxByPhase, ownCorrections: driver.stats.corrections - corrections, undecodable: driver.stats.undecodable };
  } finally { h.host.shutdown(); }
}
if (import.meta.main) {
  const which = process.argv[2] ?? 'all', seed = Number(process.argv[3] ?? 61), rtt = Number(process.argv[4] ?? 320);
  if (!['fixed', 'changing', 'burst', 'all'].includes(which) || !Number.isInteger(seed) || !(rtt >= 0 && rtt <= 1000)) throw new Error('invalid traffic arguments');
  const mode = process.argv[5] ?? 'on'; if (!['on', 'off', 'paired'].includes(mode)) throw new Error('invalid prediction comparison');
  for (const kind of (which === 'all' ? ['fixed', 'changing', 'burst'] : [which]) as TrafficCase[])
    for (const prediction of mode === 'paired' ? [true, false] : [mode === 'on']) console.log(JSON.stringify(trafficTrial({ kind, seed, rtt, prediction })));
}
