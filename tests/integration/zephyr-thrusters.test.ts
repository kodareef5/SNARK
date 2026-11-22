import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_BURST, BTN_SPRINT } from "../../shared/sim/character.ts";
import { thrustAxis, thrustBoostLeft } from "../../shared/sim/vehicle-thrusters.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";

for (const fps of [60, 20]) test(`a driver's boost and every flip are predicted exactly, and seen by another, at ${fps} fps`, () => {
  const h = new Harness({}, 1, fps, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("zephyr-driver"), watcher = h.join("zephyr-watcher"), pilot = h.pilots[0]!;
    h.run(1500);
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:zephyr", spawn.x + 1.6, spawn.z - .12, 0, Math.PI);
    expect(car).toBeGreaterThanOrEqual(0);
    h.host.urban.mount(h.client(s)!, car); h.run(800);
    expect(s.driving).toBe(car);
    const ents = h.world.ents, v = ents.vrow[car]!, remote = new RemoteSample();
    const record = h.host.records.byPid.get(ents.pid[car]!)!, health = h.host.survival.value(record, V_HEALTH);
    const corrections = s.stats.corrections, states = s.stats.stateCorrections, start = s.simTick;
    s.prediction.enabled = true;
    let boosted = false, flips = 0, flipping = false, seen = 0;
    // A boost, then a kickflip, a roll each way, a front and a back flip, each a press with its direction, 3.5 s apart.
    const moves = [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]] as const;
    h.run(22000, () => {
      const age = s.simTick - start, move = Math.floor((age - 60) / 105), at = (age - 60) % 105;
      pilot.moveX = 0; pilot.moveZ = 0; pilot.buttons = 0;
      if (age < 60) { pilot.moveZ = 1; pilot.buttons = age > 20 && age < 40 ? BTN_SPRINT : 0; }
      else if (move < moves.length && at < 2) { pilot.moveX = moves[move]![0]; pilot.moveZ = moves[move]![1]; pilot.buttons = BTN_BURST; }
      boosted ||= thrustBoostLeft(ents.vehicleThrust[v]!) > 0;
      const now = thrustAxis(ents.vehicleThrust[v]!) !== 0;
      if (now && !flipping) flips++;
      flipping = now;
      watcher.sampleRemote(remote);
      const i = [...remote.id.subarray(0, remote.count)].indexOf(car);
      if (i >= 0 && thrustAxis(remote.vehicleThrust[i]!) !== 0) seen++;
    });
    expect(boosted).toBe(true); expect(flips).toBe(5); expect(seen).toBeGreaterThan(0);
    expect(s.stats.corrections).toBe(corrections); expect(s.stats.stateCorrections).toBe(states);
    expect(s.prediction.differences).toEqual([]);
    // On its wheels and unhurt at the end of it.
    expect(1 - 2 * (ents.vehicleQx[v]! ** 2 + ents.vehicleQz[v]! ** 2)).toBeGreaterThan(.99);
    expect(h.host.survival.value(record, V_HEALTH)).toBe(health);
  } finally { h.host.shutdown(); }
});
