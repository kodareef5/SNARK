import { expect, test } from "bun:test";
import { tokenize, parseNumber } from "../../shared/console.ts";
import { TICK_DT, WORLD_MAX_Y } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, Body, MODE_GHOST, MODE_NONE, STAMINA_UNITS, stepBody } from "../../shared/sim/character.ts";
import { DAY_TICKS, dayTick, formatHour, hourOfDay, offsetForHour } from "../../shared/sim/clock.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
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
  expect(DAY_TICKS).toBe(24 * GAME_HOUR_TICKS);
  expect(hourOfDay(0, 0)).toBe(0);
  expect(formatHour(hourOfDay(GAME_HOUR_TICKS * 13 + GAME_HOUR_TICKS / 2, 0))).toBe("13:30");
  const rng = new Rng(2);
  for (let i = 0; i < 200; i++) {
    const tick = rng.int(2 ** 31);
    const hour = rng.range(0, 24);
    const offset = offsetForHour(tick, hour);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(DAY_TICKS);
    const got = hourOfDay(tick, offset);
    expect(Math.min(Math.abs(got - hour), 24 - Math.abs(got - hour))).toBeLessThan(1 / GAME_HOUR_TICKS);
    // A day later it is the same time.
    expect(dayTick(tick + DAY_TICKS, offset)).toBe(dayTick(tick, offset));
  }
});
