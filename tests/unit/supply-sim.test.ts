// A supply drop's ticks, its pose and its wire (shared/sim/supply.ts).

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BRAKE_HEIGHT, LEAVE_SECONDS, MARKS, POSE_BRAKING, POSE_COMING, POSE_FLYING, POSE_GONE, POSE_LANDED, POSE_LEAVING, SENDER_ZENITH, SUPPLY_MOST, newPose, readSupply, supplyPose, supplyTimes, writeSupply, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { CAST_PHASE, EYE_COLORS, EYE_KNOT, EYE_PERIOD, aperture, eyePhase, eyePower } from "../../shared/world/tide-eye.ts";

const R = TICK_RATE;
const row = (more: Partial<SupplyRow> = {}): SupplyRow => ({
  id: 7, tier: 0, cls: 0, ringed: false, landed: false, opened: false, announce: 0, sender: 0, eye: 0, look: 200,
  ox: 3000, oy: EYE_KNOT, oz: 4000, x: 1200.5, y: 14.25, z: 900.75,
  ...supplyTimes(1000, "blue", 240, 30, 7, 1200, R),
  ...more,
});

test("the seven top-marks, in the order a class names them", () => {
  expect([...MARKS]).toEqual(["bar", "saltire", "buckler", "hourglass", "cross", "cone_down", "cone_up"]);
});

test("a cast leaves at its sender's ignition, so a drop lands between its notice and one cycle after; with no display it lands on the notice", () => {
  for (const color of EYE_COLORS) {
    for (const called of [0, 1, 999, 3599, 3600, 77777, 2 ** 31]) {
      const t = supplyTimes(called, color, 240, 30, 7, 1200, R);
      const phase = eyePhase(t.release / R, { color });
      expect([Math.abs(phase - CAST_PHASE) < 1e-6, eyePower(phase), aperture(phase)]).toEqual([true, 1, 1]);
      const wait = (t.land - called) / R;
      expect([wait >= 240, wait < 240 + EYE_PERIOD, t.land - t.release, t.brake, t.end - t.land, t.left]).toEqual([true, true, 30 * R, 7 * R, 1200 * R, 0]);
    }
  }
  const plain = supplyTimes(500, null, 240, 30, 7, 1200, R);
  expect([plain.release - 500, plain.land - 500]).toEqual([210 * R, 240 * R]);
  // A notice shorter than the flight: the cast leaves at once, and at the sender's next ignition where it has one.
  expect(supplyTimes(500, null, 5, 30, 7, 1200, R).release).toBe(500);
  expect(supplyTimes(500, "red", 5, 30, 7, 1200, R).release - 500).toBeLessThan(EYE_PERIOD * R);
  // Whatever a book says, the jets light after the cast leaves and before it lands.
  for (const [flight, brake] of [[30, 7], [1, 7], [0, 0], [10, 10], [0.01, 100]] as const) {
    const t = supplyTimes(0, null, 60, flight, brake, 60, R);
    expect([t.brake >= 1, t.brake < t.land - t.release]).toEqual([true, true]);
  }
});

test("the capsule's place is one unbroken path from the sender to the ground, and its speed is unbroken where the jets light and where it lands", () => {
  const d = row();
  const jets = d.land - d.brake;
  const a = newPose();
  const b = newPose();
  const at = (tick: number, out = a) => supplyPose(d, tick, R, out);
  // Coming: nothing has left, and the shaft is up within two seconds of the call.
  expect([at(d.called).state, at(d.called).shaft, at(d.called + 2 * R).shaft, at(d.release - 1).state]).toEqual([POSE_COMING, 0, 1, POSE_COMING]);
  // It leaves from the sender, level, and arrives over the landing, straight down.
  const first = at(d.release);
  expect([first.state, first.x, first.y, first.z, first.along]).toEqual([POSE_FLYING, d.ox, d.oy, d.oz, 0]);
  const early = { ...at(d.release + 1) };
  expect(Math.abs(early.y - d.oy)).toBeLessThan(0.05 * Math.hypot(early.x - d.ox, early.z - d.oz));
  const late = { ...at(jets - 1) };
  expect(Math.hypot(late.x - d.x, late.z - d.z)).toBeLessThan(0.01);
  // No step of a tick is longer than its speed allows for, and nothing jumps at a seam.
  let most = 0;
  for (let tick = d.release; tick < d.land + 60; tick++) {
    const p = { ...at(tick) };
    const q = at(tick + 1, b);
    const moved = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    most = Math.max(most, moved);
    expect(moved).toBeLessThanOrEqual((Math.max(p.speed, q.speed) / R) * 1.02 + 1e-6);
    if (tick + 1 <= jets) expect(q.y).toBeLessThanOrEqual(p.y + 1e-9);
  }
  // A streak, not a teleport: it crosses the sky in tens of metres a tick.
  expect(most).toBeGreaterThan(5);
  expect(most).toBeLessThan(40);
  // The seam at the jets: the same place and the same speed from either side.
  const before = { ...at(jets - 1e-6) };
  const after = { ...at(jets) };
  expect([after.state, Math.abs(after.y - (d.y + BRAKE_HEIGHT)) < 1e-9, Math.abs(before.y - after.y) < 1e-3, Math.abs(before.speed - after.speed) < 1e-3]).toEqual([POSE_BRAKING, true, true, true]);
  expect(after.speed).toBeCloseTo((2 * BRAKE_HEIGHT) / 7, 6);
  // The braking: the jets on, the legs out before the ground, and it meets the ground at rest.
  const mid = { ...at(jets + d.brake / 2) };
  expect([mid.thrust > 0.9, mid.legs, mid.y > d.y + 20]).toEqual([true, 0, true]);
  const last = { ...at(d.land - 1e-6) };
  expect([last.legs, last.speed < 1e-3, Math.abs(last.y - d.y) < 1e-6, last.thrust > 0.5]).toEqual([1, true, true, true]);
  const down = { ...at(d.land) };
  expect([down.state, down.x, down.y, down.z, down.speed, down.shutters, down.since]).toEqual([POSE_LANDED, d.x, d.y, d.z, 0, 0, 0]);
  // Landed: the jets cut, the shutters open in their time, the pulses turn to standing.
  const open = { ...at(d.land + 6 * R) };
  expect([open.thrust, open.shutters, open.standing, open.legs, open.shaft]).toEqual([0, 1, 1, 1, 1]);
});

test("a capsule that leaves shuts, lifts on its jets and is gone in twelve seconds, its shaft fading as it goes; nothing of it runs back", () => {
  const d = row({ landed: true });
  d.left = d.land + 90 * R;
  const p = newPose();
  const at = (seconds: number) => ({ ...supplyPose(d, d.left + seconds * R, R, p) });
  expect(supplyPose(d, d.left - 1, R, p).state).toBe(POSE_LANDED);
  const start = at(0);
  expect([start.state, start.y, start.shutters, start.shaft, start.legs, start.thrust]).toEqual([POSE_LEAVING, d.y, 1, 1, 1, 0]);
  expect([at(1.3).shutters, at(1.3).y, at(1.5).thrust]).toEqual([0, d.y, 1]);
  let y = d.y;
  let shaft = 1;
  for (let s = 0; s < LEAVE_SECONDS; s += 0.1) {
    const q = at(s);
    expect([q.y >= y, q.shaft <= shaft]).toEqual([true, true]);
    y = q.y;
    shaft = q.shaft;
  }
  expect([at(4).legs, at(4).shaft, at(LEAVE_SECONDS - 0.1).y > d.y + 400, at(LEAVE_SECONDS).state]).toEqual([0, 0, true, POSE_GONE]);
});

test("the list of live drops goes over the wire whole and comes back the same, and a message cut short or saying what cannot be is refused", () => {
  const list: SupplyList = {
    tiers: [{ name: "White", rgb: 0xf2f2ea, level: 3, count: 1 }, { name: "Meridian", rgb: 0x3fe0d0, level: 80, count: 7 }],
    classes: [{ name: "Arms", mark: 1 }, { name: "Voyage", mark: 6 }],
    rows: [
      row(),
      row({ id: 65535, tier: 1, cls: 1, ringed: true, landed: true, opened: true, announce: 3, sender: SENDER_ZENITH, eye: SENDER_ZENITH, look: 0, ox: 0, oz: 0, x: 32767.96875, y: -120.5, z: 0.03125, left: 0 }),
      { ...row({ id: 9, landed: true }), left: row().land + 4000 },
    ],
  };
  const w = new BitWriter(256);
  writeSupply(w, list);
  const bytes = w.bytes().slice();
  expect(readSupply(new BitReader(bytes))).toEqual(list);
  // Three rows with their tiers and classes: under forty bytes a row.
  expect(bytes.length).toBeLessThan(160);
  expect(readSupply(new BitReader(bytes.subarray(0, bytes.length - 3)))).toBeNull();
  const wrong = new BitWriter(256);
  writeSupply(wrong, { ...list, rows: [{ ...row(), tier: 2 }] });
  expect(readSupply(new BitReader(wrong.bytes().slice()))).toBeNull();
  const none = new BitWriter(16);
  writeSupply(none, { tiers: [], classes: [], rows: [] });
  expect(readSupply(new BitReader(none.bytes().slice()))).toEqual({ tiers: [], classes: [], rows: [] });
  // The most a message carries.
  const full = new BitWriter(4096);
  writeSupply(full, { ...list, rows: Array.from({ length: SUPPLY_MOST }, (_, i) => row({ id: i + 1 })) });
  expect([readSupply(new BitReader(full.bytes().slice()))!.rows.length, full.bytes().length < 1300]).toEqual([SUPPLY_MOST, true]);
});
