import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { burn, type Fire, type Hearth } from "../../shared/sim/station.ts";

/** A hearth of plain numbers. fuel is ticks per piece in burn order, raw the tick each raw item spoils, and room the cooked items it holds. */
function hearth(fuel: number[], raw: number[], cookTicks: number, room: number) {
  const events: string[] = [];
  const state = { fuel: [...fuel], raw: [...raw].sort((a, b) => a - b), cooked: 0, room };
  const h: Hearth = {
    settle: (t) => {
      while (state.raw.length > 0 && state.raw[0]! <= t) events.push(`spoiled@${state.raw.shift()}`);
    },
    feed: () => state.fuel.shift() ?? 0,
    waiting: () => (state.raw.length > 0 ? cookTicks : 0),
    done: (t) => {
      if (state.cooked >= state.room) return false;
      state.raw.pop();
      state.cooked++;
      events.push(`cooked@${t}`);
      return true;
    },
  };
  return { h, state, events };
}

test("a fire burns its fuel a piece at a time, cooks what is over it one after another, and goes out at the tick the last piece ends", () => {
  // Two pieces of 900 ticks and three items of 600 ticks each that never spoil, lit at tick 100.
  // The items are cooked at 700, 1300 and 1900, and the fire is out at 1900.
  const a = hearth([900, 900], [1e9, 1e9, 1e9], 600, 99);
  const fire: Fire = { at: 100, fuel: 0, cook: 0 };
  expect(burn(fire, a.h, 100)).toBe(-1);
  expect([fire.fuel, a.state.fuel.length]).toEqual([900, 1]);
  expect(burn(fire, a.h, 699)).toBe(-1);
  expect([a.events, fire.cook, fire.fuel]).toEqual([[], 599, 301]);
  expect(burn(fire, a.h, 5000)).toBe(1900);
  expect(a.events).toEqual(["cooked@700", "cooked@1300", "cooked@1900"]);
  expect([fire.at, fire.fuel, a.state.raw.length, a.state.cooked]).toEqual([1900, 0, 0, 3]);
  // With nothing to burn it is out at once.
  expect(burn({ at: 7, fuel: 0, cook: 0 }, hearth([], [1e9], 600, 9).h, 50)).toBe(7);
  // An item over a fire that goes out early is not cooked. With nothing over it, the fuel still burns.
  const b = hearth([225, 225], [1e9], 600, 9);
  const short: Fire = { at: 0, fuel: 0, cook: 0 };
  expect([burn(short, b.h, 9999), b.events.length, short.cook]).toEqual([450, 0, 450]);
  expect(burn({ at: 0, fuel: 0, cook: 0 }, hearth([900], [], 600, 9).h, 9999)).toBe(900);
  // With no room, a cooked item waits over the fire while the fuel burns on. Given room, it comes off at once.
  const c = hearth([900, 900], [1e9, 1e9], 600, 0);
  const full: Fire = { at: 0, fuel: 0, cook: 0 };
  expect([burn(full, c.h, 1000), c.events.length, full.cook]).toEqual([-1, 0, 600]);
  c.state.room = 5;
  expect(burn(full, c.h, 1001)).toBe(-1);
  expect(c.events).toEqual(["cooked@1000"]);
  // An item that spoils before its turn is not cooked, and one half cooked when it spoiled gives the next no head start.
  const d = hearth([900, 900, 900], [1500, 1e9], 600, 9);
  const fresh: Fire = { at: 0, fuel: 0, cook: 0 };
  burn(fresh, d.h, 2700);
  expect(d.events).toEqual(["cooked@600", "cooked@1200"]);
  const e = hearth([900, 900, 900], [700, 800], 600, 9);
  expect([burn({ at: 0, fuel: 0, cook: 0 }, e.h, 2700), e.events]).toEqual([2700, ["cooked@600", "spoiled@700"]]);
});

test("looked at every tick or once at the end, a fire comes to the same: the same things at the same ticks", () => {
  const rng = new Rng(5);
  for (let round = 0; round < 300; round++) {
    const fuel = Array.from({ length: rng.int(6) }, () => (rng.int(2) === 0 ? 225 : 900));
    const raw = Array.from({ length: rng.int(7) }, () => (rng.int(3) === 0 ? 1e9 : 1 + rng.int(4000)));
    const cook = 300 + rng.int(4) * 150;
    const room = rng.int(4) === 0 ? rng.int(3) : 99;
    const end = 1 + rng.int(6000);
    const start = rng.int(50);
    const once = hearth(fuel, raw, cook, room);
    const f1: Fire = { at: start, fuel: 0, cook: 0 };
    const out1 = burn(f1, once.h, start + end);
    // Watched every tick for a while, then in steps of any size, to the same end tick.
    const often = hearth(fuel, raw, cook, room);
    const f2: Fire = { at: start, fuel: 0, cook: 0 };
    let out2 = -1;
    for (let t = start; out2 < 0 && t <= start + end; t += t < start + 400 ? 1 : 1 + rng.int(500)) out2 = burn(f2, often.h, Math.min(t, start + end));
    if (out2 < 0) out2 = burn(f2, often.h, start + end);
    expect([out2, often.events, often.state, f2], `round ${round}`).toEqual([out1, once.events, once.state, f1]);
  }
});
