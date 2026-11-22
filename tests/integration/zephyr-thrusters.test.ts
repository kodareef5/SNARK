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
    const s = h.join("zephyr-driver"), pilot = h.pilots[0]!;
    h.run(1500);
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:zephyr", spawn.x + 1.6, spawn.z - .12, 0, Math.PI);
    expect(car).toBeGreaterThanOrEqual(0);
    expect(h.host.urban.mount(h.client(s)!, car)).toBe(0); h.run(800);
    expect(s.driving).toBe(car);
    // Someone watching from the kerb, who joins once the driver is in.
    const watcher = h.join("zephyr-watcher"); h.run(1500);
    // Off to the side of the course, where the car will not run into it.
    const w = h.ent(watcher); h.world.ents.setPosition(w, spawn.x + 30, h.world.hf.heightAt(spawn.x + 30, spawn.z - 60) + .05, spawn.z - 60); h.world.history.discontinuity(w); h.run(500);
    const ents = h.world.ents, v = ents.vrow[car]!, remote = new RemoteSample();
    const record = h.host.records.byPid.get(ents.pid[car]!)!, health = h.host.survival.value(record, V_HEALTH);
    const corrections = s.stats.corrections, states = s.stats.stateCorrections, start = s.simTick;
    s.prediction.enabled = true;
    let boosted = false, flips = 0, flipping = false, seen = 0;
    // Then a kickflip, a roll each way, a front and a back flip, each a press with its direction, 3.5 s apart.
    const moves = [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]] as const;
    h.run(22000, () => {
      const age = s.simTick - start, move = Math.floor((age - 150) / 105), at = (age - 150) % 105;
      pilot.moveX = 0; pilot.moveZ = 0; pilot.buttons = 0;
      // A boost from a roll, then hard on the brakes, short of the ledge the test ground has some 85 m on.
      if (age < 40) { pilot.moveZ = 1; pilot.buttons = age > 15 ? BTN_SPRINT : 0; }
      else if (age < 150) pilot.moveZ = Math.hypot(ents.vx[car]!, ents.vz[car]!) > 1 && age < 120 ? -1 : 0;
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
