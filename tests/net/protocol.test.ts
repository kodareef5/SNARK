import { expect, test } from "bun:test";
import { tokenize, parseNumber } from "../../shared/console.ts";
import { TICK_DT, WORLD_MAX_Y } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { EntityView, MAX_VIEW, SentView, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";
import { AnimState, CUE_BITS, CUE_TORPOR, LAYER_EAT } from "../../shared/anim/pose.ts";
import { ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
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
  // Looking straight up, forward is up, and jump also rises.
  const y = b.y;
  for (let i = 0; i < 30; i++) stepBody(world, b, 0, 127, 0, 16384, 0, p, TICK_DT);
  expect(Math.abs(b.y - y - 12)).toBeLessThan(0.001);
  expect(Math.abs(b.z - 252)).toBeLessThan(0.001);
  // Down through the ground for a long time, it stops at the world's floor.
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
  // A day is 50.4 minutes at a scale of 1, which is 2.1 seconds to the game minute.
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
    expect(dayTick(tick + DAY_TICKS, offset)).toBe(dayTick(tick, offset));
  }
});

test("the clock at the server's three scales: a closed form that is what stepping it would give, with a day part and a night part, and an hour that can be asked for", () => {
  const rng = new Rng(7);
  for (let n = 0; n < 60; n++) {
    const c = n === 0 ? UNIT_CLOCK : { cycle: Math.exp((rng.float() - 0.5) * 6), day: Math.exp((rng.float() - 0.5) * 4), night: Math.exp((rng.float() - 0.5) * 4) };
    const whole = cycleTicks(c);
    // Day is 06:00 to 18:00: twelve clock hours at the cycle's pace times the day's. Night is the other twelve at the night's.
    const day = (12 * CLOCK_HOUR_TICKS) / (c.cycle * c.day);
    const night = (12 * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
    expect(whole).toBeCloseTo(day + night, 6);
    // Each tick advances the clock at the day's pace or the night's. Only the tick that crosses sunrise or sunset is between the two.
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
    // It never runs backwards, repeats after a whole cycle, and reaches 06:00 and 18:00 at the ticks the scales give.
    const dawn = (6 * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
    expect([hourOfDay(dawn, 0, c), hourOfDay(dawn + day, 0, c)].map((h) => Math.round(h * 1e6) / 1e6)).toEqual([6, 18]);
    let last = -1;
    for (let k = 0; k < 500; k++) {
      const h = hourOfDay((k / 500) * whole * 0.999999, 0, c);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    // The offset for any hour is a whole number of ticks, so the hour is right to within half a tick's worth.
    for (let k = 0; k < 20; k++) {
      const tick = rng.int(2 ** 31);
      const want = rng.range(0, 24);
      const offset = offsetForHour(tick, want, c);
      const got = hourOfDay(tick, offset, c);
      expect([Number.isInteger(offset), offset >= 0, offset < whole + 1]).toEqual([true, true, true]);
      expect(Math.min(Math.abs(got - want), 24 - Math.abs(got - want))).toBeLessThanOrEqual((0.51 * c.cycle * Math.max(c.day, c.night)) / CLOCK_HOUR_TICKS);
    }
  }
  // Cycle x10 is a five-minute day. Day x2 alone shortens the day and leaves the night.
  expect([cycleTicks({ cycle: 10, day: 1, night: 1 }) / 30 / 60, cycleTicks({ cycle: 1, day: 2, night: 1 }) / 30 / 60, cycleTicks({ cycle: 1, day: 1, night: 4 }) / 30 / 60].map((m) => Math.round(m * 100) / 100)).toEqual([5.04, 37.8, 31.5]);
  // A cycle scale of about 0.035 makes a day last a real day.
  expect(cycleTicks({ cycle: 0.035, day: 1, night: 1 }) / 30 / 3600).toBeCloseTo(24, 0);
  expect([isDay(5.99), isDay(6), isDay(17.99), isDay(18)]).toEqual([false, true, true, false]);
});

test("whose an entity is, what it sits on and how old it is travel when it appears, stay with it as it moves, and are sent again when they change", () => {
  const w = new BitWriter(1 << 16);
  const r = new BitReader();
  const colors = new Uint8Array(6);
  const belongs = (v: EntityView, i: number): number[] => [v.team[i]!, v.seat[i]!, v.span[i]!, v.grown[i]!];
  /** The appearance of each entity of `v` by its id, as the entity store has it. */
  const looksOf = (v: EntityView): Looks => {
    const n = MAX_VIEW + 9001;
    const looks = { level: new Uint16Array(n), colors: new Uint8Array(n * 6), names: new Map<number, string>(), looks: new Map<number, Uint8Array>(), gears: new Map<number, Uint16Array>(), team: new Uint32Array(n), seat: new Uint32Array(n), span: new Uint32Array(n), grown: new Uint32Array(n) };
    for (let i = 0; i < v.count; i++) {
      const id = v.id[i]!;
      looks.level[id] = v.level[i]!;
      if (v.name[i]) looks.names.set(id, v.name[i]!);
      looks.team[id] = v.team[i]!;
      looks.seat[id] = v.seat[i]!;
      looks.span[id] = v.span[i]!;
      looks.grown[id] = v.grown[i]!;
    }
    return looks;
  };
  /** What the server holds for the client, and what the client holds, after sending `cur` on top of them. */
  const send = (cur: EntityView, sent: SentView | null, held: EntityView | null): [SentView, EntityView] => {
    const next = new SentView();
    const got = new EntityView();
    w.reset();
    writeViewDelta(w, sent, cur, next, 1 << 20, 0, looksOf(cur));
    r.reset(w.bytes());
    expect(readViewDelta(r, held, got)).toBe(true);
    expect(r.overflow).toBe(false);
    expect(got.count).toBe(cur.count);
    return [next, got];
  };
  const make = (qx: number, rev: number, team: number, seat: number, span: number, grown: number): EntityView => {
    const v = new EntityView();
    // A ridden tame, a wild creature with no extras, and a young one far along the id space.
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
  let [sent, held]: [SentView | null, EntityView | null] = send(make(100, 0, 0xfffffff, 41, 1234567, 4000000000), null, null);
  expect(belongs(held, 0)).toEqual([0xfffffff, 41, 0, 0]);
  expect(belongs(held, 1)).toEqual([0, 0, 0, 0]);
  expect(belongs(held, 2)).toEqual([0, 0, 1234567, 4000000000]);
  // An update does not repeat the team, and the client keeps it.
  [sent, held] = send(make(101, 0, 0xfffffff, 41, 1234567, 4000000000), sent, held);
  expect(held.qx[0]).toBe(101);
  expect(belongs(held, 0)).toEqual([0xfffffff, 41, 0, 0]);
  expect(belongs(held, 2)).toEqual([0, 0, 1234567, 4000000000]);
  // Its rider gets down and it changes hands. The revision moved, so it is sent as a create again.
  [sent, held] = send(make(101, 1, 5, 0, 1234567, 4000000000), sent, held);
  expect(belongs(held, 0)).toEqual([5, 0, 0, 0]);
  expect(held.name[0]).toBe("Rex");
  expect(sent.rev[0]).toBe(1);
});

test("unchanged cues and stride offsets add no bits to position updates", () => {
  const w = new BitWriter(1 << 12);
  const r = new BitReader();
  const colors = new Uint8Array(6);
  const looks: Looks = { level: new Uint16Array(16), colors: new Uint8Array(96), names: new Map<number, string>(), looks: new Map<number, Uint8Array>(), gears: new Map<number, Uint16Array>(), team: new Uint32Array(16), seat: new Uint32Array(16), span: new Uint32Array(16), grown: new Uint32Array(16) };
  const st = new AnimState();
  st.speed = 3;
  const anim = st.pack();
  st.out = true;
  st.cue = CUE_TORPOR;
  st.cueStart = 201;
  st.layer = LAYER_EAT;
  st.layerStart = 7;
  const knocked = st.packCue();
  const view = (qx: number, word: number, cue: number): EntityView => {
    const v = new EntityView();
    v.push(4, 1, 7, qx, 200, 300, 5, 1, word, 0, cue);
    v.appear(0, 1, colors, 0, "", null, null);
    return v;
  };
  /** Sends `cur` against `sent`, which the client holds as `held`; returns what each then holds, and the bits it took. */
  const send = (cur: EntityView, sent: SentView | null, held: EntityView | null): [SentView, EntityView, number] => {
    const next = new SentView();
    const got = new EntityView();
    w.reset();
    writeViewDelta(w, sent, cur, next, 1 << 20, 0, looks);
    const bits = w.pos;
    r.reset(w.bytes());
    expect(readViewDelta(r, held, got)).toBe(true);
    return [next, got, bits];
  };
  const [plainSent, plainHeld, plainCreate] = send(view(100, anim, 0), null, null);
  const [sent, held, create] = send(view(100, anim, knocked), null, null);
  // Appearing, a body without cues says so in a bit, and one with them sends them whole.
  expect([held.cue[0], create - plainCreate, plainHeld.cue[0]]).toEqual([knocked, CUE_BITS, 0]);
  // Moving with its cues as they were costs what moving without any does.
  const [, movedHeld, moved] = send(view(101, anim, knocked), sent, held);
  const [, , plainMoved] = send(view(101, anim, 0), plainSent, plainHeld);
  expect([moved, movedHeld.cue[0]]).toEqual([plainMoved, knocked]);
  const running = view(100, anim, knocked);
  running.stride[0] = 219;
  const [clockSent, clockHeld, clockCreate] = send(running, null, null);
  expect([clockHeld.stride[0], clockCreate - create]).toEqual([219, 8]);
  running.qx[0] = 101;
  const [, steadyHeld, steadyBits] = send(running, clockSent, clockHeld);
  expect([steadyHeld.stride[0], steadyBits]).toEqual([219, moved]);
  const [, transition] = send(running, sent, held);
  expect(transition.stride[0]).toBe(219);
  const [, stopped] = send(view(100, anim, knocked), clockSent, clockHeld);
  expect(stopped.stride[0]).toBe(0);
  // A change of cues alone sends the action again with them: what a change of the action alone sends, and the cues.
  st.out = false;
  const woke = st.packCue();
  const [, wokeHeld, change] = send(view(100, anim, woke), sent, held);
  st.setAction(ACT_SWING, HOLD_HANDS, 9);
  const [, actHeld, act] = send(view(100, st.pack(), knocked), sent, held);
  expect([wokeHeld.cue[0], wokeHeld.anim[0], actHeld.cue[0], change - act]).toEqual([woke, anim, knocked, CUE_BITS]);
});
