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

// The refining forge's fire (planning/reference/stations-plan.md, S1): what a fire makes by itself, a lane a recipe, and
// what a piece of fuel leaves when it burns out. Ticks at 30 a second: wood 900, thatch 225, sparkpowder 1,800; an ingot
// 600 (Metal Ingot: 2 metal in 20 s), five gasoline 300 (Refining Forge: 6 oil and 5 hide in 10 s).

/** One of a fire's own recipes: what a unit needs, its ticks, and how many it makes. */
interface Recipe {
  item: string;
  needs: [string, number][];
  ticks: number;
  makes: number;
}
const INGOT: Recipe = { item: "ingot", needs: [["ore", 2]], ticks: 600, makes: 1 };
const GASOLINE: Recipe = { item: "gasoline", needs: [["oil", 6], ["hide", 5]], ticks: 300, makes: 5 };
const PIECES = ["", "wood", "thatch", "sparkpowder"];
const PIECE_TICKS: Record<string, number> = { wood: 900, thatch: 225, sparkpowder: 1800 };

/**
 * A forge of plain counts: `pieces` the fuel in burn order, `have` what else lies in it, `room` the most of each item it can
 * hold (unlimited where not given). Wood leaves charcoal. It cooks nothing.
 */
function forge(pieces: string[], have: Record<string, number>, recipes: Recipe[], room: Record<string, number> = {}) {
  const events: string[] = [];
  const state = { pieces: [...pieces], have: { ...have } as Record<string, number>, room: { ...room } as Record<string, number> };
  const count = (i: string): number => state.have[i] ?? 0;
  const fits = (i: string, n: number): boolean => count(i) + n <= (state.room[i] ?? Infinity);
  let fed = 0;
  const h: Hearth = {
    settle: () => {},
    feed: () => {
      const p = state.pieces.shift();
      fed = p === undefined ? 0 : PIECES.indexOf(p);
      return p === undefined ? 0 : PIECE_TICKS[p]!;
    },
    fed: () => fed,
    burnt: (piece, t) => {
      if (PIECES[piece] !== "wood" || !fits("charcoal", 1)) return;
      state.have.charcoal = count("charcoal") + 1;
      events.push(`charcoal@${t}`);
    },
    waiting: () => 0,
    done: () => true,
    lanes: () => recipes.map((_, k) => 100 + k),
    laneNeed: (k) => (recipes[k]!.needs.every(([i, n]) => count(i) >= n) ? recipes[k]!.ticks : 0),
    laneDone: (k, t) => {
      const r = recipes[k]!;
      if (!fits(r.item, r.makes)) return false;
      for (const [i, n] of r.needs) state.have[i] = count(i) - n;
      state.have[r.item] = count(r.item) + r.makes;
      events.push(`${r.item}@${t}`);
      return true;
    },
  };
  return { h, state, events };
}

test("a forge of 300 ore and 100 wood read once at 3,000 s comes out as one read every tick: 150 ingots and 100 charcoal, out at the tick the last wood ends", () => {
  const wood = Array.from({ length: 100 }, () => "wood");
  const once = forge(wood, { ore: 300 }, [INGOT]);
  const f1: Fire = { at: 0, fuel: 0, cook: 0 };
  expect(burn(f1, once.h, 90000)).toBe(90000);
  expect(once.state.have).toEqual({ ore: 0, ingot: 150, charcoal: 100 });
  // The first charcoal comes when the second piece is taken, the last as the last piece ends; the last ingot is made at the
  // tick the fire goes out, before it does.
  expect([once.events[0], once.events[1], once.events.at(-2), once.events.at(-1)]).toEqual(["ingot@600", "charcoal@900", "ingot@90000", "charcoal@90000"]);
  const often = forge(wood, { ore: 300 }, [INGOT]);
  const f2: Fire = { at: 0, fuel: 0, cook: 0 };
  let out = -1;
  for (let t = 0; out < 0 && t <= 90000; t++) out = burn(f2, often.h, t);
  expect([out, often.events, often.state, f2]).toEqual([90000, once.events, once.state, f1]);
});

test("each recipe has its own lane and both run at once; ore taken out mid-unit starts its lane again; a full forge holds the unit; nothing burnt but wood leaves anything", () => {
  // Ingots and gasoline together: 4 ore, 12 oil and 10 hide on one piece of wood make an ingot and 10 gasoline in 30 s. The
  // second ingot was 300 ticks in when the wood ran out: a fire that goes out makes nothing more.
  const both = forge(["wood"], { ore: 4, oil: 12, hide: 10 }, [INGOT, GASOLINE]);
  const fire: Fire = { at: 0, fuel: 0, cook: 0 };
  expect(burn(fire, both.h, 450)).toBe(-1);
  expect(fire.lanes).toEqual([{ item: 100, ticks: 450 }, { item: 101, ticks: 150 }]);
  expect(burn(fire, both.h, 5000)).toBe(900);
  expect([both.events, both.state.have]).toEqual([["gasoline@300", "ingot@600", "gasoline@600", "charcoal@900"], { ore: 2, oil: 0, hide: 0, ingot: 1, gasoline: 10, charcoal: 1 }]);

  // Ore taken out at 300 and put back at 400: the lane starts again from nothing at 400, and its ingot is made at 1,000.
  const taken = forge(["wood", "wood"], { ore: 2 }, [INGOT]);
  const f: Fire = { at: 0, fuel: 0, cook: 0 };
  burn(f, taken.h, 300);
  expect(f.lanes).toEqual([{ item: 100, ticks: 300 }]);
  taken.state.have.ore = 0;
  burn(f, taken.h, 400);
  expect(f.lanes).toEqual([{ item: 100, ticks: 0 }]);
  taken.state.have.ore = 2;
  burn(f, taken.h, 999);
  expect(taken.events).toEqual(["charcoal@900"]);
  burn(f, taken.h, 1000);
  expect(taken.events).toEqual(["charcoal@900", "ingot@1000"]);

  // With room for one ingot, the second waits done while the fire burns on; given room, it is made at the tick the fire was
  // last worked out to, which on the server is the tick the room was made.
  const full = forge(["wood", "wood"], { ore: 6 }, [INGOT], { ingot: 1, charcoal: 0 });
  const g: Fire = { at: 0, fuel: 0, cook: 0 };
  expect(burn(g, full.h, 1500)).toBe(-1);
  expect([full.events, g.lanes, full.state.have.ore]).toEqual([["ingot@600"], [{ item: 100, ticks: 600 }], 4]);
  full.state.room.ingot = 9;
  burn(g, full.h, 1501);
  expect([full.events, g.lanes]).toEqual([["ingot@600", "ingot@1500"], [{ item: 100, ticks: 1 }]]);
  // With no room for charcoal, it is lost.
  expect(full.state.have.charcoal).toBeUndefined();

  // Sparkpowder burns 60 s, thatch 7.5 s, and neither leaves anything.
  const spark = forge(["sparkpowder", "thatch"], { ore: 20 }, [INGOT]);
  expect([burn({ at: 0, fuel: 0, cook: 0 }, spark.h, 9999), spark.events.filter((e) => e.startsWith("charcoal")), spark.state.have.ingot]).toEqual([2025, [], 3]);
});

test("looked at every tick or once at the end, a forge comes to the same, lanes, charcoal and all", () => {
  const rng = new Rng(17);
  const kinds = ["wood", "thatch", "sparkpowder"];
  for (let round = 0; round < 200; round++) {
    const pieces = Array.from({ length: rng.int(5) }, () => kinds[rng.int(3)]!);
    const have = { ore: rng.int(12), oil: rng.int(20), hide: rng.int(16) };
    const room: Record<string, number> = rng.int(3) === 0 ? { ingot: rng.int(4), gasoline: 5 * rng.int(3), charcoal: rng.int(2) } : {};
    const recipes = rng.int(2) === 0 ? [INGOT, GASOLINE] : [GASOLINE, INGOT];
    const end = 1 + rng.int(8000);
    const once = forge(pieces, have, recipes, room);
    const f1: Fire = { at: 0, fuel: 0, cook: 0 };
    const out1 = burn(f1, once.h, end);
    const often = forge(pieces, have, recipes, room);
    const f2: Fire = { at: 0, fuel: 0, cook: 0 };
    let out2 = -1;
    for (let t = 0; out2 < 0 && t <= end; t += t < 700 ? 1 : 1 + rng.int(400)) out2 = burn(f2, often.h, Math.min(t, end));
    if (out2 < 0) out2 = burn(f2, often.h, end);
    expect([out2, often.events, often.state, f2], `round ${round}`).toEqual([out1, once.events, once.state, f1]);
  }
});
