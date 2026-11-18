// The sundial's arithmetic, face and layout, the sky that follows it, and what it sends, all without a server.
import { expect, test } from "bun:test";
import { SkyClock } from "../../client/core/sky.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { WorldSounds } from "../../client/core/sound/world.ts";
import { K_DIAL, K_IMAGE, UiFrame } from "../../client/core/ui/nodes.ts";
import { BAND_IN, BAND_OUT, DIAL_PIXELS, IMAGE_DIAL, KEY_SUNDIAL, KEY_SUNDIAL_PRESET, NUDGE_TICKS, NUMERAL_RADIUS, SEND_TICKS, SPRITE_LOW, SPRITE_MOON, SPRITE_PIXELS, SPRITE_SUN, SUN_RADIUS, Sundial, angleOfHour, elevation, hourOfAngle, paintDial, span, turnsOf } from "../../client/core/ui/sundial.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CMD_CLOCK } from "../../shared/net/protocol.ts";
import { CLOCK_HOUR_TICKS, CLOCK_SHARES, SUNRISE, SUNSET, UNIT_CLOCK, cycleTicks, dayTickOfHour, hourOfDay, hourOfShare, offsetForHour, shareOfHour, type ClockScales } from "../../shared/sim/clock.ts";
import { cueKey } from "../../shared/sound/cues.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";

/** A quick day and a slow night: the day runs 20 times the clock's pace and the night 5 times. */
const FAST: ClockScales = { cycle: 10, day: 2, night: 0.5 };
const TAU = Math.PI * 2;

test("an hour and its place on the dial are one: noon up, midnight down, and each hour as far round as its ticks", () => {
  expect([0, 6, 12, 18].map((h) => angleOfHour(h, UNIT_CLOCK))).toEqual([0.5, 0.75, 0, 0.25]);
  expect([turnsOf(0, -1), turnsOf(1, 0), turnsOf(0, 1), turnsOf(-1, 0)]).toEqual([0, 0.25, 0.5, 0.75]);
  for (const c of [UNIT_CLOCK, FAST]) {
    for (let h = 0; h < 24; h += 0.37) expect(Math.abs(hourOfAngle(angleOfHour(h, c), c) - h)).toBeLessThan(1e-9);
    for (let t = 0; t < 1; t += 0.013) expect(Math.abs(angleOfHour(hourOfAngle(t, c), c) - t)).toBeLessThan(1e-9);
    // The day's arc is the share of the cycle its ticks take, and sunrise and sunset stand level either side of noon.
    const day = (dayTickOfHour(SUNSET, c) - dayTickOfHour(SUNRISE, c)) / cycleTicks(c);
    expect(angleOfHour(SUNSET, c)).toBeCloseTo(day / 2, 12);
    expect(angleOfHour(SUNRISE, c)).toBeCloseTo(1 - day / 2, 12);
    // A turn of the dial is a cycle of the server's own day, at even speed: a twentieth of it is a twentieth of the ticks.
    expect(dayTickOfHour(hourOfAngle(0.05, c), c) - dayTickOfHour(12, c)).toBeCloseTo(cycleTicks(c) * 0.05, 6);
    expect([elevation(12, c), elevation(SUNRISE, c), elevation(SUNSET, c), elevation(0, c)].map((e) => Math.round(e * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, -1]);
  }
  // On the quick day the day is a fifth of the dial: sunset sits at a tenth of a turn, not a quarter.
  expect(angleOfHour(SUNSET, FAST)).toBeCloseTo(0.1, 12);
  expect(hourOfAngle(0.2, FAST)).toBeGreaterThan(SUNSET);
  // The wire's hour: a share of the day, two game seconds a step, every minute exact; and offsetForHour puts the hour within half a tick.
  for (const h of [0, 6, 17.5, 23.999]) expect(Math.abs(hourOfShare(shareOfHour(h)) - h)).toBeLessThan(24 / CLOCK_SHARES);
  expect([shareOfHour(24), hourOfShare(shareOfHour(17)), hourOfShare(shareOfHour(6.5))]).toEqual([0, 17, 6.5]);
  for (const c of [UNIT_CLOCK, FAST]) expect(Math.abs(hourOfDay(5000, offsetForHour(5000, 17.5, c), c) - 17.5)).toBeLessThan(1 / CLOCK_HOUR_TICKS * c.cycle * c.day);
  expect([span(30), span(63), span(25 * 60), span(70 * 60), span(120 * 60)]).toEqual(["30 s", "1 min", "25 min", "1 h 10 min", "2 h"]);
});

/** The face's colour at an hour, in the middle of the band, as [red, green, blue, alpha]. */
function bandAt(face: { width: number; data: Uint8ClampedArray }, hour: number, c: ClockScales): number[] {
  const t = angleOfHour(hour, c) * TAU, r = (BAND_IN + BAND_OUT) / 2;
  const x = Math.floor((1 + r * Math.sin(t)) * DIAL_PIXELS / 2), y = Math.floor((1 - r * Math.cos(t)) * DIAL_PIXELS / 2);
  const at = (y * face.width + x) * 4;
  return [...face.data.slice(at, at + 4)];
}
const light = (p: number[]): number => p[0]! + p[1]! + p[2]!;

test("the face is painted from the clock: day where the day falls, night where the night does, and the markers beneath", () => {
  const unit = paintDial(UNIT_CLOCK), fast = paintDial(FAST);
  expect([unit.width, unit.height]).toEqual([DIAL_PIXELS, DIAL_PIXELS + SPRITE_PIXELS]);
  // Noon is bright and blue, midnight dark, and the hour after sunrise warm.
  const [noon, midnight, dawn] = [bandAt(unit, 12, UNIT_CLOCK), bandAt(unit, 0, UNIT_CLOCK), bandAt(unit, 6.25, UNIT_CLOCK)];
  expect(light(noon)).toBeGreaterThan(500);
  expect(noon[2]!).toBeGreaterThan(noon[0]!);
  expect(light(midnight)).toBeLessThan(150);
  expect(dawn[0]!).toBeGreaterThan(dawn[2]!);
  for (const p of [noon, midnight, dawn]) expect(p[3]!).toBeGreaterThan(200);
  // Where a plain clock is still in its afternoon, the quick day's dial is already in its night.
  const there = hourOfAngle(0.2, UNIT_CLOCK);
  expect([there > 16 && there < 17, light(bandAt(unit, there, UNIT_CLOCK)) > 400]).toEqual([true, true]);
  expect(light(bandAt(fast, hourOfAngle(0.2, FAST), FAST))).toBeLessThan(250);
  // Outside the rim nothing is painted; the middle is glass.
  expect([unit.data[3], unit.data[((DIAL_PIXELS / 2) * DIAL_PIXELS + DIAL_PIXELS / 2) * 4 + 3]! > 100]).toEqual([0, true]);
  // The markers: each is lit in its middle and clear in its corners, the sun warm and the moon cool.
  const mid = (which: number): number[] => {
    const at = ((DIAL_PIXELS + SPRITE_PIXELS / 2) * unit.width + which * SPRITE_PIXELS + SPRITE_PIXELS / 2) * 4;
    return [...unit.data.slice(at, at + 4)];
  };
  expect(mid(SPRITE_SUN)[3]).toBe(255);
  expect(mid(SPRITE_SUN)[0]! - mid(SPRITE_SUN)[2]!).toBeGreaterThan(0);
  expect(mid(SPRITE_MOON)[2]! - mid(SPRITE_MOON)[0]!).toBeGreaterThan(-1);
  expect(unit.data[(DIAL_PIXELS * unit.width + SPRITE_LOW * SPRITE_PIXELS) * 4 + 3]).toBe(0);
});

/** A session as the sundial uses one: a clock, a tick, an offset, and the commands it sent, read back. */
function fakeSession(c: ClockScales = UNIT_CLOCK) {
  const sent: { tick: number; hour: number; last: boolean }[] = [];
  const s = {
    clock: c,
    serverTick: 1000,
    dayOffset: offsetForHour(1000, 9, c),
    admin: true,
    command(op: number, args?: (w: BitWriter) => void): number {
      const w = new BitWriter(16);
      args?.(w);
      const r = new BitReader(w.bytes());
      expect(op).toBe(CMD_CLOCK);
      sent.push({ tick: s.serverTick, hour: hourOfShare(r.u16()), last: r.bool() });
      return 1;
    },
  };
  return { s, session: s as unknown as ClientSession, sent };
}

test("the dial is laid out on its own geometry: the sun on the band at the hour, the numerals where their hours fall, the hour in the middle", () => {
  for (const [c, hour] of [[UNIT_CLOCK, 17.5], [FAST, 17.5], [UNIT_CLOCK, 22.5]] as const) {
    const f = new UiFrame(), dial = new Sundial(), { session } = fakeSession(c);
    f.begin(16 / 9);
    dial.build(f, 100, 120, 392, 500, session, hour, KEY_SUNDIAL);
    const { cx, cy, radius } = dial.box;
    const hit = f.find(KEY_SUNDIAL)!;
    expect([hit.kind, hit.interactive, hit.w, hit.h, hit.x + hit.w / 2, hit.y + hit.h / 2]).toEqual([K_DIAL, true, radius * 2, radius * 2, cx, cy]);
    const face = f.find(KEY_SUNDIAL + 1)!;
    expect([face.kind, face.image, face.sw, f.images[IMAGE_DIAL]!.width]).toEqual([K_IMAGE, IMAGE_DIAL, DIAL_PIXELS, DIAL_PIXELS]);
    // The marker's middle lies on the band at the hour's angle, to a hundredth of a unit.
    const sun = f.find(KEY_SUNDIAL + 2)!, at = angleOfHour(hour, c) * TAU;
    expect(Math.hypot(sun.x + sun.w / 2 - (cx + radius * SUN_RADIUS * Math.sin(at)), sun.y + sun.h / 2 - (cy - radius * SUN_RADIUS * Math.cos(at)))).toBeLessThan(0.01);
    expect(sun.sx).toBe((elevation(hour, c) >= 0.26 ? SPRITE_SUN : elevation(hour, c) >= 0 ? SPRITE_LOW : SPRITE_MOON) * SPRITE_PIXELS);
    // Each numeral is centred where its hour falls.
    for (let i = 0; i < 8; i++) {
      const n = f.find(7110 + i)!, a = angleOfHour(i * 3, c) * TAU;
      expect(n.text).toBe(String(i * 3).padStart(2, "0"));
      expect(Math.abs(n.x + n.w / 2 - (cx + radius * NUMERAL_RADIUS * Math.sin(a)))).toBeLessThan(0.51);
      expect(Math.abs(n.y + n.h / 2 - (cy - radius * NUMERAL_RADIUS * Math.cos(a)))).toBeLessThan(0.51);
    }
    expect(f.find(KEY_SUNDIAL + 3)!.text).toBe(hour === 17.5 ? "17:30" : "22:30");
    // Within the area, with the four hours to press beneath the dial.
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      if (n.key >= 7120 && n.key < 7130) continue;
      expect([n.key, n.x >= 100 - 1e-9 && n.x + n.w <= 492 + 1e-9 && n.y >= 120 && n.y + n.h <= 620]).toEqual([n.key, true]);
    }
    expect(f.find(KEY_SUNDIAL_PRESET + 3)!.y).toBeGreaterThan(cy + radius);
  }
  // Half a game hour before sunset on a plain clock is 63 real seconds; on the quick day, about three.
  const caption = (c: ClockScales, hour: number): string => {
    const f = new UiFrame(), dial = new Sundial();
    dial.build(f, 0, 0, 392, 500, fakeSession(c).session, hour, 0);
    return f.find(KEY_SUNDIAL + 4)!.text;
  };
  expect([caption(UNIT_CLOCK, 17.5), caption(FAST, 17.5), caption(UNIT_CLOCK, 22.5)]).toEqual(["sunset in 1 min", "sunset in 3 s", "sunrise in 16 min"]);
});

test("a drag turns the hour under the hand at once, tells the server at most ten times a second, and ends with one last message", () => {
  const f = new UiFrame(), dial = new Sundial(), { s, session, sent } = fakeSession();
  dial.build(f, 0, 0, 392, 500, session, 9, KEY_SUNDIAL);
  const { cx, cy, radius } = dial.box;
  const point = (hour: number): [number, number] => {
    const a = angleOfHour(hour, UNIT_CLOCK) * TAU;
    return [cx + radius * 0.8 * Math.sin(a), cy - radius * 0.8 * Math.cos(a)];
  };
  // A press in the middle, where the hour is read, does nothing.
  expect(dial.pointer(0, KEY_SUNDIAL, cx, cy, session)).toBe(true);
  dial.pump(session, true);
  expect([Number.isNaN(dial.held), sent.length]).toEqual([true, 0]);
  // From nine to half past five over two seconds of frames at sixty a second, through noon.
  dial.pointer(0, KEY_SUNDIAL, ...point(9), session);
  for (let frame = 0; frame <= 120; frame++) {
    s.serverTick = 1000 + Math.floor(frame / 2);
    dial.pointer(2, KEY_SUNDIAL, ...point(9 + (8.5 * frame) / 120), session);
    expect(Math.abs(dial.held - (9 + (8.5 * frame) / 120))).toBeLessThan(1e-9);
    dial.pump(session, true);
  }
  dial.pointer(1, KEY_SUNDIAL, ...point(17.5), session);
  expect(sent.length).toBeLessThanOrEqual(60 / SEND_TICKS + 2);
  expect(sent.length).toBeGreaterThan(10);
  for (let i = 1; i < sent.length - 1; i++) expect(sent[i]!.tick - sent[i - 1]!.tick).toBeGreaterThanOrEqual(SEND_TICKS);
  expect(sent.filter((m) => m.last).length).toBe(1);
  expect(sent.at(-1)!.last).toBe(true);
  expect(Math.abs(sent.at(-1)!.hour - 17.5)).toBeLessThan(24 / CLOCK_SHARES);
  // The hand keeps the hour until the server's agrees, then lets go; a server that never agrees is let go of in two seconds.
  dial.pump(session, true);
  expect(dial.held).toBeCloseTo(17.5, 9);
  s.dayOffset = offsetForHour(s.serverTick, 17.5, UNIT_CLOCK);
  dial.pump(session, true);
  expect(Number.isNaN(dial.held)).toBe(true);
  dial.pointer(0, KEY_SUNDIAL_PRESET, 0, 0, session);
  expect([sent.at(-1)!.hour, sent.at(-1)!.last, dial.held]).toEqual([6, true, 6]);
  s.serverTick += 61;
  dial.pump(session, true);
  expect(Number.isNaN(dial.held)).toBe(true);
});

test("keys and the pad nudge by quarter hours, or whole ones, and a run of nudges is one turn", () => {
  const f = new UiFrame(), dial = new Sundial(), { s, session, sent } = fakeSession();
  dial.build(f, 0, 0, 392, 500, session, 17.4, KEY_SUNDIAL);
  expect(dial.adjust(KEY_SUNDIAL + 1, 1, false)).toBe(false);
  for (const [by, coarse, want] of [[1, false, 17.5], [1, false, 17.75], [-1, true, 17], [-1, false, 16.75], [1, true, 17]] as const) {
    expect(dial.adjust(KEY_SUNDIAL, by, coarse)).toBe(true);
    expect(dial.held).toBeCloseTo(want, 9);
    dial.pump(session, true);
    s.serverTick += 2;
  }
  expect(sent.every((m) => !m.last)).toBe(true);
  s.serverTick += NUDGE_TICKS;
  dial.pump(session, true);
  expect(sent.filter((m) => m.last).map((m) => m.hour)).toEqual([17]);
  // Past midnight and back.
  dial.adjust(KEY_SUNDIAL, 1, false);
  expect(dial.held).toBeCloseTo(17.25, 9);
  for (let i = 0; i < 30; i++) dial.adjust(KEY_SUNDIAL, 1, true);
  expect(dial.held).toBe((17 + 30) % 24);
});

test("the sky sweeps to a set hour the short way round, follows the hand at frame rate, and keeps the stingers quiet meanwhile", () => {
  const c = UNIT_CLOCK, sky = new SkyClock();
  let tick = 50000;
  const at = (hour: number): number => offsetForHour(tick, hour, c);
  expect(sky.step(tick, at(17.5), c, 16)).toBeCloseTo(17.5, 3);
  expect(sky.turned).toBe(false);
  // Set to 18:30 by another admin: it moves a little each frame, the clock's own minute aside, and gets there.
  const hours: number[] = [];
  const offset = at(18.5);
  for (let frame = 0; frame < 100; frame++) {
    hours.push(sky.step(tick, offset, c, 16));
    if (frame < 5) expect(sky.turned).toBe(true);
  }
  expect(hours[0]! - 17.5).toBeGreaterThan(0.05);
  expect(hours[0]! - 17.5).toBeLessThan(0.5);
  for (let i = 1; i < hours.length; i++) expect(hours[i]!).toBeGreaterThanOrEqual(hours[i - 1]! - 1e-9);
  expect(hours.at(-1)!).toBeCloseTo(18.5, 6);
  expect(sky.turned).toBe(false);
  // The clock running on is no turn.
  tick += 1;
  sky.step(tick, offset, c, 33);
  expect(sky.turned).toBe(false);
  // Across midnight it goes forward through it, not back through the day.
  sky.step(tick, at(23.9), c, 1e6);
  const across = sky.step(tick, at(0.2), c, 16);
  expect(across > 23.9 || across < 0.2).toBe(true);
  // In the hand: a step of the hand is followed within a few frames, and the hour stays in the hand while the clock runs.
  sky.step(tick, at(0.2), c, 1e6, 9.25);
  expect(sky.hour).toBeCloseTo(9.25, 6);
  for (let frame = 0; frame < 15; frame++) sky.step(tick, at(0.2), c, 16, 9.5);
  expect(sky.hour).toBeCloseTo(9.5, 2);
  expect(sky.hour).toBeLessThan(9.5);
  sky.step(tick, at(0.2), c, 1e6, 9.5);
  tick += 300;
  sky.step(tick, at(0.2), c, 16, 9.5);
  expect([sky.hour, sky.turned]).toEqual([9.5, true]);
  // A server without creative mode is shown as before: a set hour comes at once, and the stingers hear it.
  const plain = new SkyClock();
  plain.step(tick, at(5.9), c, 16, NaN, false);
  plain.step(tick, at(6.5), c, 16, NaN, false);
  expect([plain.hour, plain.turned]).toEqual([hourOfDay(tick, at(6.5), c), false]);

  // The dawn stinger: once for a forward crossing by the clock, never for the dial swept across it.
  const hf = buildProvingHeightfield();
  const heard: number[] = [];
  const ear = [450, hf.heightAt(450, 60) + 1.6, 60] as const;
  const sounds = new WorldSounds();
  const step = (hour: number, turned: boolean): void => sounds.update(1e9, hf, ...ear, hour, () => 0, () => {}, (k) => heard.push(k), turned);
  step(5.9, false);
  for (let i = 0; i < 6; i++) {
    step(6.2, true);
    step(5.8, true);
  }
  expect(heard).toEqual([]);
  step(6.01, false);
  expect(heard).toEqual([cueKey("stinger/dawn")]);
});
