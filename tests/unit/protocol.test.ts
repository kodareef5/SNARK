import { expect, test } from "bun:test";
import { tokenize, parseNumber } from "../../shared/console.ts";
import { TICK_DT, WORLD_MAX_Y } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { EntityView, MAX_VIEW, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, Body, MODE_GHOST, MODE_NONE, STAMINA_UNITS, stepBody } from "../../shared/sim/character.ts";
import { CLOCK_HOUR_TICKS, DAY_TICKS, UNIT_CLOCK, cycleTicks, dayTick, formatHour, hourOfDay, isDay, offsetForHour } from "../../shared/sim/clock.ts";
import { provingWorld } from "../fixtures/world.ts";

test("every field of a body survives the wire exactly", () => {
  const rng = new Rng(4);
  const w = new BitWriter(64);
  const r = new BitReader();
  const a = new Body();
  const b = new Body();
  for (let i = 0; i < 500; i++) {
    a.x = Math.fround(rng.range(0, 8192));
    a.y = Math.fround(rng.range(-900, 3000));
    a.z = Math.fround(rng.range(0, 8192));
    a.vx = Math.fround(rng.range(-60, 60));
    a.vy = Math.fround(rng.range(-60, 60));
    a.vz = Math.fround(rng.range(-60, 60));
    a.grounded = rng.int(2) === 0;
    a.mode = rng.int(4);
    a.staminaMax = rng.int(65536);
    a.stamina = rng.int(a.staminaMax * STAMINA_UNITS + 1);
    a.speedQ = rng.int(4096);
    a.swimQ = rng.int(4096);
    a.mflags = rng.int(16);
    a.kind = rng.int(65536);
    a.yaw = rng.int(65536);
    w.reset();
    w.bits(i, 3); // any bit offset
    writeBody(w, a);
    r.reset(w.bytes());
    r.bits(3);
    readBody(r, b);
    expect(r.overflow).toBe(false);
    expect(b.equals(a)).toBe(true);
  }
});

test("a ghost flies where it looks, ignores walls, and stays inside the map's box", () => {
  const world = provingWorld();
  const p = world.reg.move[world.reg.index.get("core:survivor")!]!;
  const b = new Body();
  b.mode = MODE_GHOST;
  b.x = 256;
  b.z = 240;
  b.y = 2;
  // Level flight north is +Z only.
  for (let i = 0; i < 30; i++) stepBody(world, b, 0, 127, 0, 0, 0, p, TICK_DT);
  expect(b.x).toBe(256);
  expect(b.y).toBe(2);
  expect(Math.abs(b.z - 252)).toBeLessThan(0.001); // 12 m/s for a second
  // Looking straight up, forward is up; jump also rises.
  const y = b.y;
  for (let i = 0; i < 30; i++) stepBody(world, b, 0, 127, 0, 16384, 0, p, TICK_DT);
  expect(Math.abs(b.y - y - 12)).toBeLessThan(0.001);
  expect(Math.abs(b.z - 252)).toBeLessThan(0.001);
  // Straight down through the ground, sprinting, for a long time: it stops at the world's floor.
  for (let i = 0; i < 3000; i++) stepBody(world, b, 0, 127, 0, -16384, BTN_SPRINT, p, TICK_DT);
  expect(b.y).toBe(-1024);
  for (let i = 0; i < 6000; i++) stepBody(world, b, 127, 127, 9000, 16384, BTN_SPRINT | BTN_JUMP, p, TICK_DT);
  expect(b.y).toBe(WORLD_MAX_Y);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x).toBeLessThanOrEqual(world.hf.sizeX);
  expect(b.z).toBeLessThanOrEqual(world.hf.sizeZ);
});

test("a body in mode none does not move, whatever is pressed", () => {
  const world = provingWorld();
  const p = world.reg.move[world.reg.index.get("core:survivor")!]!;
  const b = new Body();
  b.mode = MODE_NONE;
  b.x = 256;
  b.y = 30; // in the air: no gravity either
  b.z = 240;
  b.vy = -5;
  for (let i = 0; i < 60; i++) stepBody(world, b, 127, 127, 0, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
  expect([b.x, b.y, b.z, b.vx, b.vy, b.vz]).toEqual([256, 30, 240, 0, 0, 0]);
});

test("console lines split into words, with quotes grouping", () => {
  expect(tokenize("  spawn core:grazer   150 ")).toEqual(["spawn", "core:grazer", "150"]);
  expect(tokenize('kick "two words" x')).toEqual(["kick", "two words", "x"]);
  expect(tokenize('say ""')).toEqual(["say", ""]);
  expect(tokenize('open "unterminated quote')).toEqual(["open", "unterminated quote"]);
  expect(tokenize("")).toEqual([]);
  expect(parseNumber("-3.5")).toBe(-3.5);
  expect(parseNumber("12")).toBe(12);
  for (const bad of ["", "1e9", "0x10", "Infinity", "NaN", "1.", " 1", undefined]) expect(parseNumber(bad)).toBeNaN();
});

test("the time of day is the world clock plus an offset, and setting it changes only the offset", () => {
  // A day of 50.4 minutes at the clock's own pace: 2.1 seconds to the game minute.
  expect([DAY_TICKS, CLOCK_HOUR_TICKS / 60 / 30, DAY_TICKS / 30 / 60, cycleTicks()]).toEqual([24 * CLOCK_HOUR_TICKS, 2.1, 50.4, DAY_TICKS]);
  expect(hourOfDay(0, 0)).toBe(0);
  expect(formatHour(hourOfDay(CLOCK_HOUR_TICKS * 13 + CLOCK_HOUR_TICKS / 2, 0))).toBe("13:30");
  const rng = new Rng(2);
  for (let i = 0; i < 200; i++) {
    const tick = rng.int(2 ** 31);
    const hour = rng.range(0, 24);
    const offset = offsetForHour(tick, hour);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(DAY_TICKS);
    const got = hourOfDay(tick, offset);
    expect(Math.min(Math.abs(got - hour), 24 - Math.abs(got - hour))).toBeLessThan(1 / CLOCK_HOUR_TICKS);
    // A day later it is the same time.
    expect(dayTick(tick + DAY_TICKS, offset)).toBe(dayTick(tick, offset));
  }
});

test("the clock at the server's three scales: a closed form that is what stepping it would give, with a day part and a night part, and an hour that can be asked for", () => {
  const rng = new Rng(7);
  for (let n = 0; n < 60; n++) {
    const c = n === 0 ? UNIT_CLOCK : { cycle: Math.exp((rng.float() - 0.5) * 6), day: Math.exp((rng.float() - 0.5) * 4), night: Math.exp((rng.float() - 0.5) * 4) };
    const whole = cycleTicks(c);
    // The day is from six to eighteen, and takes twelve of the clock's hours at the cycle's pace times the day's; the night the same at the night's.
    const day = (12 * CLOCK_HOUR_TICKS) / (c.cycle * c.day);
    const night = (12 * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
    expect(whole).toBeCloseTo(day + night, 6);
    // A tick is worth what the hour it falls in says: the cycle's pace times the day's between sunrise and sunset, times the
    // night's outside them, and something between the two in the one tick that crosses from one to the other. Nothing else:
    // that is all stepping a clock would do.
    const byDay = (c.cycle * c.day) / CLOCK_HOUR_TICKS;
    const byNight = (c.cycle * c.night) / CLOCK_HOUR_TICKS;
    const span = Math.min(40000, Math.floor(whole) - 1);
    let crossings = 0;
    for (let tick = 0; tick < span; tick++) {
      const from = hourOfDay(tick, 0, c);
      const to = hourOfDay(tick + 1, 0, c);
      const gain = to - from;
      if (isDay(from) && isDay(to)) expect(Math.abs(gain - byDay)).toBeLessThan(1e-9);
      else if (!isDay(from) && !isDay(to) && (from < 6) === (to < 6)) expect(Math.abs(gain - byNight)).toBeLessThan(1e-9);
      else {
        crossings++;
        expect([gain >= Math.min(byDay, byNight) - 1e-9, gain <= Math.max(byDay, byNight) + 1e-9]).toEqual([true, true]);
      }
    }
    expect(crossings).toBeLessThanOrEqual(2);
    // It never runs backwards, is the same a whole day and night later, and passes sunrise and sunset where it should.
    const dawn = (6 * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
    expect([hourOfDay(dawn, 0, c), hourOfDay(dawn + day, 0, c)].map((h) => Math.round(h * 1e6) / 1e6)).toEqual([6, 18]);
    let last = -1;
    for (let k = 0; k < 500; k++) {
      const h = hourOfDay((k / 500) * whole * 0.999999, 0, c);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    // Any hour can be asked for at any tick: the offset is a whole number of ticks, and the hour is then that, to within half a tick's worth.
    for (let k = 0; k < 20; k++) {
      const tick = rng.int(2 ** 31);
      const want = rng.range(0, 24);
      const offset = offsetForHour(tick, want, c);
      const got = hourOfDay(tick, offset, c);
      expect([Number.isInteger(offset), offset >= 0, offset < whole + 1]).toEqual([true, true, true]);
      expect(Math.min(Math.abs(got - want), 24 - Math.abs(got - want))).toBeLessThanOrEqual((0.51 * c.cycle * Math.max(c.day, c.night)) / CLOCK_HOUR_TICKS);
    }
  }
  // The cycle ten times as fast is a day of five minutes; the day alone twice as fast is a short day and the same night.
  expect([cycleTicks({ cycle: 10, day: 1, night: 1 }) / 30 / 60, cycleTicks({ cycle: 1, day: 2, night: 1 }) / 30 / 60, cycleTicks({ cycle: 1, day: 1, night: 4 }) / 30 / 60].map((m) => Math.round(m * 100) / 100)).toEqual([5.04, 37.8, 31.5]);
  // About 0.035 is a day as long as a real one.
  expect(cycleTicks({ cycle: 0.035, day: 1, night: 1 }) / 30 / 3600).toBeCloseTo(24, 0);
  expect([isDay(5.99), isDay(6), isDay(17.99), isDay(18)]).toEqual([false, true, true, false]);
});

test("whose an entity is, what it sits on and how old it is travel when it appears, stay with it as it moves, and are sent again when they change", () => {
  const w = new BitWriter(1 << 16);
  const r = new BitReader();
  const colors = new Uint8Array(6);
  const belongs = (v: EntityView, i: number): number[] => [v.team[i]!, v.seat[i]!, v.span[i]!, v.grown[i]!];
  /** What the server holds for the client, and what the client holds, after sending `cur` on top of them. */
  const send = (cur: EntityView, sent: EntityView | null, held: EntityView | null): [EntityView, EntityView] => {
    const next = new EntityView();
    const got = new EntityView();
    w.reset();
    writeViewDelta(w, sent, cur, next, 1 << 20, 0);
    r.reset(w.bytes());
    expect(readViewDelta(r, held, got)).toBe(true);
    expect(r.overflow).toBe(false);
    expect(got.count).toBe(cur.count);
    return [next, got];
  };
  const make = (qx: number, rev: number, team: number, seat: number, span: number, grown: number): EntityView => {
    const v = new EntityView();
    // A tame someone sits on; a wild creature with nothing to say; a young one, far along the id space.
    v.push(3, 1, 7, qx, 200, 300, 5, 1, 0);
    v.appear(rev, 12, colors, 0, "Rex", null, null);
    v.belong(team, seat, 0, 0);
    v.push(8, 1, 7, 110, 200, 300, 5, 1, 0);
    v.appear(0, 1, colors, 0, "", null, null);
    v.push(MAX_VIEW + 9000, 2, 9, 120, 200, 300, 5, 1, 0);
    v.appear(0, 1, colors, 0, "", null, null);
    v.belong(0, 0, span, grown);
    return v;
  };
  let [sent, held] = send(make(100, 0, 0xfffffff, 41, 1234567, 4000000000), null, null);
  expect(belongs(held, 0)).toEqual([0xfffffff, 41, 0, 0]);
  expect(belongs(held, 1)).toEqual([0, 0, 0, 0]);
  expect(belongs(held, 2)).toEqual([0, 0, 1234567, 4000000000]);
  // It moves: an update says nothing of whose it is, and the client still knows.
  [sent, held] = send(make(101, 0, 0xfffffff, 41, 1234567, 4000000000), sent, held);
  expect(held.qx[0]).toBe(101);
  expect(belongs(held, 0)).toEqual([0xfffffff, 41, 0, 0]);
  expect(belongs(held, 2)).toEqual([0, 0, 1234567, 4000000000]);
  // Its rider gets down and it changes hands: its revision moved, so it is sent whole again.
  [sent, held] = send(make(101, 1, 5, 0, 1234567, 4000000000), sent, held);
  expect(belongs(held, 0)).toEqual([5, 0, 0, 0]);
  expect(held.name[0]).toBe("Rex");
  expect(belongs(sent, 0)).toEqual([5, 0, 0, 0]);
});
