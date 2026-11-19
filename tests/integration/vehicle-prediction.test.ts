import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_JUMP, BTN_USE } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";

test("damage changes mechanical condition once; health regeneration does not invalidate driving prediction", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("damaged-driver"), pilot = h.pilots[0]!;
    h.run(1500);
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:compact", spawn.x + 1.6, spawn.z - .12, 0, Math.PI);
    h.host.urban.mount(h.client(s)!, car); h.run(800);
    expect(s.driving).toBe(car);
    const ents = h.world.ents, record = h.host.records.byPid.get(ents.pid[car]!)!, v = ents.vrow[car]!;
    h.host.survival.hurt(record, 200, 0);
    h.run(500); // The one authoritative damage change has arrived before measuring continued prediction.
    const hull = ents.vehicleHullCondition[v]!, health = h.host.survival.value(record, V_HEALTH);
    expect(hull).toBeLessThan(.8);
    const corrections = s.stats.corrections, states = s.stats.stateCorrections, start = s.simTick;
    s.prediction.enabled = true;
    h.run(5000, () => {
      const age = s.simTick - start;
      pilot.moveZ = age < 120 ? 1 : 0;
      pilot.moveX = age >= 40 && age < 70 ? 1 : 0;
      pilot.buttons = age >= 100 ? BTN_JUMP : 0;
    });
    expect(h.host.survival.value(record, V_HEALTH)).toBeGreaterThan(health);
    expect(ents.vehicleHullCondition[v]).toBe(hull);
    expect(s.stats.corrections).toBe(corrections); expect(s.stats.stateCorrections).toBe(states);
    expect(s.prediction.differences).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("a long frame samples its newest tick alone, which carries a short tap seen before it, and sends none of the ticks it held", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("catch-up", {}, { manual: true });
    h.run(500, now => s.update(now, 0, 0, 0, 0, 0));
    const before = s.simTick;
    s.update(h.now + 1, 0, 0, 0, 0, BTN_USE);
    expect(s.simTick).toBe(before);
    s.update(h.now + 201, 0, 1, 0, 0, 0);
    expect(s.simTick - before).toBeGreaterThan(4);
    h.net.advance(h.now + 1);
    // The frame's ticks before its newest were never sampled: the server holds the input before them, as the page did.
    const accepted = h.client(s)!.inputs;
    for (let tick = before + 1; tick < s.simTick; tick++) expect(accepted.has(tick)).toBe(false);
    expect(accepted.buttons[s.simTick & accepted.mask]! & BTN_USE).toBe(BTN_USE);
    const last = s.simTick;
    // A clock jump past what one update steps is held the same way. Never label an input not sampled as sampled.
    s.tickClock += 20;
    s.update(h.now + 217, 0, 1, 0, 0, 0);
    h.net.advance(h.now + 2);
    expect(s.simTick).toBeGreaterThan(last + 8);
    expect(h.client(s)!.newestInput).toBe(s.simTick);
    for (let tick = last + 1; tick < s.simTick; tick++) expect(h.client(s)!.inputs.has(tick)).toBe(false);
  } finally { h.host.shutdown(); }
});

for (const fps of [60, 20]) test(`real vehicle prediction agrees through accelerate, steer and brake at ${fps} fps`, () => {
  const h = new Harness({}, 1, fps, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("driver"), pilot = h.pilots[0]!;
    h.run(1500);
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:compact", spawn.x + 1.6, spawn.z - .12, 0, Math.PI);
    h.host.urban.mount(h.client(s)!, car); h.run(800);
    expect(s.driving).toBe(car);
    const corrections = s.stats.corrections, stateCorrections = s.stats.stateCorrections, start = s.simTick;
    s.prediction.enabled = true;
    h.run(5000, () => {
      const age = s.simTick - start;
      pilot.moveZ = age < 120 ? 1 : 0;
      pilot.moveX = age >= 40 && age < 70 ? 1 : 0;
      pilot.buttons = age >= 100 ? BTN_JUMP : 0;
    });
    expect(s.stats.corrections).toBe(corrections);
    expect(s.stats.stateCorrections).toBe(stateCorrections);
    expect(s.prediction.differences).toEqual([]);
    expect(s.own.fuel).toBeLessThan(h.reg.vehicle[s.own.kind]!.spec.fuelCapacity);
  } finally { h.host.shutdown(); }
});

test("an authoritative snapshot ahead of a stalled client advances the body's tick before prediction resumes", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const s = h.join("brief-stall", {}, { manual: true });
    let throttle = 0;
    const update = (now: number) => s.update(now, 0, throttle, 0, 0, 0);
    h.run(1500, update);
    const spawn = h.world.spawn, car = h.host.spawnVehicle("core:compact", spawn.x + 1.6, spawn.z - .12, 0, Math.PI);
    h.host.urban.mount(h.client(s)!, car); h.run(800, update);
    throttle = 1; h.run(1000, update);
    const corrections = s.stats.corrections, states = s.stats.stateCorrections;
    s.prediction.enabled = true;
    // Snapshots still arrive while the render/input loop briefly pauses; the server holds the same throttle.
    h.run(200);
    expect(s.prediction.furthestAhead).toBeGreaterThan(0);
    expect(s.simTick).toBeGreaterThanOrEqual(s.latestSnapshot);
    h.run(1000, update);
    expect(s.stats.corrections).toBe(corrections);
    expect(s.stats.stateCorrections).toBe(states);
    expect(s.prediction.differences).toEqual([]);
  } finally { h.host.shutdown(); }
});
