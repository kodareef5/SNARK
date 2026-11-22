import { expect, test } from "bun:test";
import type { Client } from "../../server/game.ts";
import { Signal, Veto } from "../../server/signal.ts";
import { walk, type System } from "../../server/system.ts";

test("a signal tells every listener in the order they were added, with every argument", () => {
  const happened = new Signal<[a: number, b: string, c: number, d: number, e: number, f: number]>();
  const heard: string[] = [];
  happened.emit(1, "nobody", 3, 4, 5, 6);
  happened.on((a, b) => void heard.push(`first ${a} ${b}`));
  happened.on((...all) => void heard.push(`second ${all.join(" ")}`));
  happened.emit(1, "x", 3, 4, 5, 6);
  happened.emit(2, "y", 0, 0, 0, 0);
  expect(heard).toEqual(["first 1 x", "second 1 x 3 4 5 6", "first 2 y", "second 2 y 0 0 0 0"]);
  expect(happened.size).toBe(2);
  happened.clear();
  happened.emit(3, "z", 0, 0, 0, 0);
  expect([heard.length, happened.size]).toEqual([4, 0]);
});

test("a listener added while a signal is told hears of it too", () => {
  const happened = new Signal();
  let late = 0;
  happened.on(() => void (late === 0 && happened.on(() => void late++)));
  happened.emit();
  expect(late).toBe(1);
});

test("a veto gives the first refusal and asks nobody after it; unrefused, and unasked, it gives yes", () => {
  const why = new Veto<[level: number], string>("");
  const asked: string[] = [];
  expect(why.ask(1)).toBe("");
  why.on((level) => (asked.push("low"), level < 5 ? "too low" : ""));
  why.on((level) => (asked.push("high"), level > 50 ? "too high" : ""));
  why.on(() => (asked.push("last"), "never"));
  expect([why.ask(1), why.ask(60), why.ask(10)]).toEqual(["too low", "too high", "never"]);
  expect(asked).toEqual(["low", "low", "high", "low", "high", "last"]);
  const may = new Veto<[who: number]>(true);
  expect([may.size, may.ask(1)]).toEqual([0, true]);
  may.on((who) => who !== 2);
  may.on((who) => who !== 3);
  expect([may.ask(1), may.ask(2), may.ask(3)]).toEqual([true, false, false]);
});

test("each tick hook walks the rows that have it, in the list's order", () => {
  const ran: string[] = [];
  class Both {
    readonly name: string;
    constructor(name: string) {
      this.name = name;
    }
    beforeStep(): void {
      ran.push(`${this.name} before`);
    }
    step(tick: number): void {
      ran.push(`${this.name} step ${tick}`);
    }
  }
  const systems: System[] = [
    { beforeStep: () => void ran.push("first before") },
    new Both("a"),
    { step: (tick) => void ran.push(`plain step ${tick}`), replicate: (c) => void ran.push(`plain feed ${c.id}`) },
    new Both("b"),
    { replicate: (c) => void ran.push(`last feed ${c.id}`), snapshot: (c) => void ran.push(`sent ${c.id}`) },
  ];
  const tick = walk(systems);
  const c = { id: 4 } as Client;
  tick.beforeStep();
  tick.step(9);
  tick.replicate(c);
  tick.snapshot(c, null!);
  expect(ran).toEqual(["first before", "a before", "b before", "a step 9", "plain step 9", "b step 9", "plain feed 4", "last feed 4", "sent 4"]);
});
