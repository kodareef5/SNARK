// A supply drop's cast in the sky (client/core/render/supply-sky.ts): the frame's lanes the scene writes, the streak
// the dome draws from them, and the strike its sender's knot makes as it leaves.

import { expect, test } from "bun:test";
import { DROPS_AT, DROP_LANES, DROP_STREAKS, FRAME_BLOCK, FRAME_FLOATS, OPTIC_AT } from "../../client/core/render/packet.ts";
import { CAST_FALL, CAST_FLICKER, CAST_STRIKE, DROP_SKY_GLSL, STREAK_PAST, STREAK_PIXELS, STREAK_WIDTH, TRAIL_SECONDS, castFlash, dropStreaks, eyeSlot, writeDropSky } from "../../client/core/render/supply-sky.ts";
import { alongBone } from "../../client/core/render/supply.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { newPose, supplyPose, supplyTimes, type SupplyList, type SupplyRow } from "../../shared/sim/supply.ts";
import { EYE_KNOT, aperture, eyeKnot, eyePhase, type TideEyeSite } from "../../shared/world/tide-eye.ts";

const R = TICK_RATE;
const BLUE: TideEyeSite = { name: "Blue", color: "blue", x: 200, z: 200, y: 0, yaw: 0, radius: 70 };
const RED: TideEyeSite = { name: "Red", color: "red", form: "sextant", x: 5000, z: 900, y: 0, yaw: 16384, radius: 70 };
const GREEN: TideEyeSite = { name: "Green", color: "green", form: "lantern", x: 900, z: 6000, y: 0, yaw: 0, radius: 70 };
const SITES = [BLUE, RED, GREEN];
const row = (more: Partial<SupplyRow> = {}): SupplyRow => ({
  id: 7, tier: 0, cls: 0, ringed: false, landed: false, opened: false, announce: 0, sender: 0, eye: 0, look: 3,
  ox: 200, oy: EYE_KNOT, oz: 200, x: 2600, y: 4, z: 1800,
  ...supplyTimes(0, "blue", 240, 30, 7, 1200, R),
  ...more,
});
const list = (...rows: SupplyRow[]): SupplyList => ({ tiers: [{ name: "Blue", rgb: 0x3a7bff, level: 25, count: 3 }], classes: [{ name: "Arms", mark: 1 }], rows });
const lanes = (frame: Float32Array, lane: number): number[] => [...frame.subarray(DROPS_AT + lane * 4, DROPS_AT + lane * 4 + 4)];
const light = (frame: Float32Array, d: readonly number[], px = 0.001): number[] => {
  const out = [0, 0, 0];
  dropStreaks(frame, d[0]!, d[1]!, d[2]!, px, out);
  return out;
};
const unit = (v: number[]): number[] => v.map((c) => c / Math.hypot(...v));

test("the frame has eleven lanes for the casts after everything else but a visor's optic, and the programs' block declares them", () => {
  expect([DROP_STREAKS, DROP_LANES, OPTIC_AT - DROPS_AT, FRAME_BLOCK.includes(`highp vec4 fDrops[${DROP_LANES}];`), DROP_SKY_GLSL.includes(`k < ${DROP_STREAKS}`)]).toEqual([4, 11, 44, true, true]);
  for (const v of [STREAK_WIDTH, STREAK_PIXELS]) expect(DROP_SKY_GLSL).toContain(String(v));
});

test("a knot flickers as its cast gathers, each flicker stronger, strikes as it leaves and falls after", () => {
  expect([castFlash(-CAST_FLICKER - 0.01), castFlash(0), castFlash(CAST_FALL) < 0.4, castFlash(6 * CAST_FALL) < 0.01]).toEqual([0, 1, true, true]);
  const flickers: number[] = [];
  let was = 0;
  for (let t = -CAST_FLICKER; t < 0; t += 0.005) {
    const f = castFlash(t);
    expect(f).toBeLessThan(0.4);
    if (f > 0 && was === 0) flickers.push(f);
    was = f;
  }
  expect([flickers.length, flickers[0]! < flickers[1]!, flickers[1]! < flickers[2]!]).toEqual([3, true, true]);
  // After the strike it only falls.
  for (let t = 0, last = 2; t < 3; t += 0.05) {
    expect(castFlash(t)).toBeLessThan(last);
    last = castFlash(t);
  }
});

test("a site's place among the display's three is found as the display fills them: the open ones, in order", () => {
  for (const seconds of [0, 3, 10, 16, 45, 57, 83, 97, 119.5]) {
    const open = SITES.map((s) => aperture(eyePhase(seconds, s)) > 0);
    let next = 0;
    const want = open.map((o) => (o ? next++ : -1));
    expect([seconds, SITES.map((_, i) => eyeSlot(SITES, i, seconds, 3))]).toEqual([seconds, want]);
  }
  expect([eyeSlot(SITES, 2, 60, 2), eyeSlot(SITES, 7, 60, 3)]).toEqual([-1, -1]);
});

test("a cast leaves from the knot over its sender's emitter, which stands off the deck's axis as the form has it and the heading turns it", () => {
  const [blue, red] = [eyeKnot(BLUE), eyeKnot(RED)];
  // The Tide Eye's emitter is off its axis along x; the Sextant's quarter turn swings its own round to z.
  expect([blue.z, Math.abs(blue.x - BLUE.x) > 1, Math.abs(red.x - RED.x) < 1e-6, Math.abs(red.z - RED.z) > 1]).toEqual([BLUE.z, true, true, true]);
  expect(eyeKnot(GREEN)).toEqual({ x: GREEN.x, z: GREEN.z });
});

test("the scene writes a streak for a drop in flight from its tail to its head, and the dome lights the sky along it: white at the head, the tier's colour behind, nothing beside it", () => {
  const d = row();
  const frame = new Float32Array(FRAME_FLOATS);
  const eye = [2000, 2, 1500] as const;
  // Coming, braking and landed: no streak. In flight: one.
  for (const tick of [d.release - 60, d.land - d.brake + 1, d.land + 10]) {
    writeDropSky(frame, list(d), tick, R, ...eye, SITES, tick / R);
    expect(lanes(frame, 0)[3]).toBe(0);
  }
  const tick = d.release + 10 * R;
  writeDropSky(frame, list(d), tick, R, ...eye, SITES, tick / R);
  const pose = newPose();
  supplyPose(d, tick, R, pose);
  const head = unit([pose.x - eye[0], pose.y - eye[1], pose.z - eye[2]]);
  supplyPose(d, tick - TRAIL_SECONDS * R, R, pose);
  const tail = unit([pose.x - eye[0], pose.y - eye[1], pose.z - eye[2]]);
  const [h, t] = [lanes(frame, 0), lanes(frame, 1)];
  expect([h.slice(0, 3).map((v, i) => Math.abs(v - head[i]!) < 1e-6), h[3], t.slice(0, 3).map((v, i) => Math.abs(v - tail[i]!) < 1e-6), t[3]]).toEqual([[true, true, true], 1, [true, true, true], 0x3a7bff]);
  // The dome: at the head white and bright; half way down the tail the tier's blue; off to the side and beyond either end nothing.
  const mid = unit(head.map((v, i) => (v + tail[i]!) / 2));
  // Well clear of the head's halo, which reaches a degree or so.
  const side = unit([mid[0]! + 0.03, mid[1]!, mid[2]! + 0.03]);
  const beyond = unit(head.map((v, i) => v + 1.6 * (v - tail[i]!)));
  const [atHead, atMid, atTail] = [light(frame, head), light(frame, mid), light(frame, tail)];
  expect([atHead[0]! > 2, atHead[2]! >= atHead[0]!, atMid[2]! > 3 * atMid[0]!, atMid[2]! > 0.05, atMid[2]! < atHead[2]!, Math.max(...atTail) < 0.02, Math.max(...light(frame, side)) < 1e-4, Math.max(...light(frame, beyond)) < 0.01]).toEqual([true, true, true, true, true, true, true, true]);
  // It is never thinner than its pixels: seen with coarse pixels it is wider.
  const near = unit([head[0]! + 0.003, head[1]!, head[2]!]);
  expect(Math.max(...light(frame, near, 0.004))).toBeGreaterThan(2.5 * Math.max(...light(frame, near, 0.0005)));
  // Past forty-five of its widths from its head and its arc it adds nothing at all, which spares most of the sky its
  // sums; just inside, what is cut is too little to see.
  const w = Math.max(STREAK_WIDTH, STREAK_PIXELS * 0.001);
  // Square off its arc: across the plane its head and tail lie in.
  const across = unit([head[1]! * tail[2]! - head[2]! * tail[1]!, head[2]! * tail[0]! - head[0]! * tail[2]!, head[0]! * tail[1]! - head[1]! * tail[0]!]);
  const off = (widths: number): number[] => unit(head.map((v, i) => v + widths * w * across[i]!));
  const inside = Math.max(...light(frame, off(STREAK_PAST - 6)));
  expect([light(frame, off(STREAK_PAST + 6)), inside > 0, inside < 0.01]).toEqual([[0, 0, 0], true, true]);
  // It comes up as it leaves and goes as it nears its shaft, where the jets take it up.
  writeDropSky(frame, list(d), d.release + 3, R, ...eye, SITES, 0);
  const rising = lanes(frame, 0)[3]!;
  writeDropSky(frame, list(d), d.land - d.brake - 6, R, ...eye, SITES, 0);
  expect([rising > 0 && rising < 0.3, lanes(frame, 0)[3]! < 0.5]).toEqual([true, true]);
  // From above, where the sky is not behind it, no streak is written: the scene draws its trail as a piece of light.
  writeDropSky(frame, list(d), tick, R, 2000, 2900, 1500, SITES, tick / R);
  expect(lanes(frame, 0)[3]).toBe(0);
  // Four streaks at the most, the first four in flight.
  const many = Array.from({ length: 6 }, (_, k) => row({ id: k + 1, x: 2600 + k * 300 }));
  writeDropSky(frame, list(...many), tick, R, ...eye, SITES, tick / R);
  expect([0, 2, 4, 6].map((lane) => lanes(frame, lane)[3]! > 0)).toEqual([true, true, true, true]);
});

test("the sender's strike is written to its place among the display's, toward where the drop goes; an obelisk with no display has none", () => {
  const d = row();
  const frame = new Float32Array(FRAME_FLOATS);
  const seconds = d.release / R;
  // Blue is the only site open sixteen seconds into its cycle with the others dark or open: its place is found.
  const slot = eyeSlot(SITES, 0, seconds, 3);
  expect(slot).toBeGreaterThanOrEqual(0);
  writeDropSky(frame, list(d), d.release, R, 0, 0, 0, SITES, seconds);
  const cast = lanes(frame, DROP_STREAKS * 2 + slot);
  const far = Math.hypot(d.x - d.ox, d.z - d.oz);
  expect([Math.abs(cast[0]! - (d.x - d.ox) / far) < 1e-6, Math.abs(cast[1]! - (d.z - d.oz) / far) < 1e-6, cast[2], cast[3]]).toEqual([true, true, Math.fround(CAST_STRIKE), 4096 + d.id]);
  // Gathering, a flicker; long after, nothing.
  writeDropSky(frame, list(d), d.release - 0.9 * R, R, 0, 0, 0, SITES, seconds);
  expect(lanes(frame, DROP_STREAKS * 2 + slot)[2]).toBeCloseTo(castFlash(-0.9) * CAST_STRIKE, 6);
  writeDropSky(frame, list(d), d.release + 10 * R, R, 0, 0, 0, SITES, seconds);
  expect(lanes(frame, DROP_STREAKS * 2 + slot)[2]).toBe(0);
  writeDropSky(frame, list(row({ eye: 255, sender: 255 })), d.release, R, 0, 0, 0, SITES, seconds);
  expect([8, 9, 10].map((lane) => lanes(frame, lane)[2])).toEqual([0, 0, 0]);
});

test("a trail's bone lays a plume along the way it came: its length along the way, its width across, square and right-handed", () => {
  const rows = new Float32Array(12);
  const way = unit([0.3, -0.8, 0.5]);
  alongBone(rows, 0, 10, 20, 30, way[0]!, way[1]!, way[2]!, 4, 50);
  const col = (k: number): number[] => [rows[k]!, rows[4 + k]!, rows[8 + k]!];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const [x, y, z] = [col(0), col(1), col(2)];
  expect([Math.hypot(...x), Math.hypot(...y), Math.hypot(...z)].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([4, 50, 4]);
  expect([dot(x, y), dot(y, z), dot(x, z)].every((v) => Math.abs(v) < 1e-4)).toBe(true);
  // Its own +Y is the way; a point a metre down its plume is fifty metres back along it.
  expect([y.map((v) => v / 50).every((v, i) => Math.abs(v - way[i]!) < 1e-6), [rows[3], rows[7], rows[11]]]).toEqual([true, [10, 20, 30]]);
  const cross = [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  expect(dot(cross, z)).toBeGreaterThan(0);
});
