// A kind's tuning schema (shared/mapevent/fields.ts) and the event book it is kept in (shared/mapevent/book.ts): read
// leniently, so a book keeps what another build wrote, and saved strictly.

import { expect, test } from "bun:test";
import { EVENT_BOOK_FORMAT, eventBookFaults, inHours, kindOn, sheetFaults, starterEventBook, type EventBook, type KindSheet, type ScheduleDoc } from "../../shared/mapevent/book.ts";
import { choice, fieldsFaults, flag, keys, number, range, share, text, tunedOf, valueFault, valueFaults, whole, wholeRange } from "../../shared/mapevent/fields.ts";

const G = "Toughness";
const fields = {
  health: number(60000, { min: 1, max: 1e7, label: "health", help: "", group: G }),
  soak: share(0.97, { label: "shield stops", help: "", group: G }),
  passes: wholeRange([1, 3], { min: 0, max: 6, label: "passes", help: "", group: "Flight" }),
  height: range([750, 1100], { min: 50, max: 2500, unit: "m", label: "height", help: "", group: "Flight" }),
  rolls: whole(2, { min: 1, max: 4, label: "rolls", help: "", group: "Loot" }),
  ringed: flag(true, { label: "ringed", help: "", group: "Loot" }),
  tier: text("meridian", { label: "tier", help: "", group: "Loot", most: 48 }),
  sky: choice("night", ["day", "night", "any"], { label: "sky", help: "", group: "Loot" }),
  classes: keys(["arms", "armour"], { most: 7, label: "classes", help: "", group: "Loot" }),
};

const night: ScheduleDoc = { key: "ufo.night", kind: "ufo", on: true, firstDelay: [900, 2400], interval: [2400, 4800], maxLive: 1, hours: [20, 5], chance: 0.8 };
const sheet: KindSheet = { id: "ufo", label: "UFO", about: "A craft.", module: "ufo", fields, schedules: [night] };
const sheets = new Map([["ufo", sheet]]);

test("each kind of field takes what it says and refuses the rest", () => {
  const cases: [keyof typeof fields, unknown, boolean][] = [
    ["health", 1, true], ["health", 0, false], ["health", Number.NaN, false], ["health", "5", false],
    ["soak", 1, true], ["soak", 1.01, false],
    ["passes", [0, 6], true], ["passes", [2, 1], false], ["passes", [1.5, 2], false], ["passes", [1], false],
    ["height", [50.5, 60.25], true], ["height", [40, 60], false],
    ["rolls", 3, true], ["rolls", 2.5, false],
    ["ringed", false, true], ["ringed", 0, false],
    ["tier", "x".repeat(48), true], ["tier", "x".repeat(49), false],
    ["sky", "any", true], ["sky", "dusk", false],
    ["classes", ["works"], true], ["classes", [], false], ["classes", ["Works!"], false], ["classes", Array(8).fill("a"), false],
  ];
  for (const [key, v, ok] of cases) expect([key, v, valueFault(fields[key], v) === ""]).toEqual([key, v, ok]);
  expect(fieldsFaults(fields)).toEqual([]);
});

test("a schema with a bad key, a default out of its bounds or bounds the wrong way round is refused", () => {
  expect(fieldsFaults({ "2fast": number(1, { min: 0, max: 2, label: "a", help: "", group: "g" }) })[0]).toContain("a key is a letter");
  expect(fieldsFaults({ a: number(5, { min: 0, max: 2, label: "a", help: "", group: "g" }) })[0]).toContain("its default is not a number from 0 to 2");
  expect(fieldsFaults({ a: range([1, 2], { min: 5, max: 0, label: "a", help: "", group: "g" }) })[0]).toContain("the least first");
  expect(fieldsFaults({ a: choice("x", ["y"], { label: "a", help: "", group: "g" }) })[0]).toContain("its default is not one of y");
  expect(fieldsFaults({ a: flag(true, { label: "", help: "", group: "g" }) })[0]).toContain("a label");
});

test("a kind's values are each field's from the book where fit, its default where not, and a copy", () => {
  const tuned = tunedOf(fields, { health: 5000, soak: 2, passes: [2, 2], stray: 1 });
  expect([tuned.health, tuned.soak, tuned.passes, tuned.ringed]).toEqual([5000, 0.97, [2, 2], true]);
  expect("stray" in tuned).toBe(false);
  const given = { classes: ["works"] };
  const again = tunedOf(fields, given);
  (again.classes as string[]).push("voyage");
  expect(given.classes).toEqual(["works"]);
  expect(tunedOf(fields).classes).toEqual(["arms", "armour"]);
  expect(tunedOf(fields, "nonsense").health).toBe(60000);
});

test("a value out of its bounds is a fault on save and a warning on load, and an unknown field is always kept", () => {
  const values = { health: -1, stray: 4 };
  expect(valueFaults(fields, values, "tuning.ufo", false)).toEqual([
    { path: "tuning.ufo.health", message: "a number from 1 to 10000000" },
    { path: "tuning.ufo.stray", message: "this kind has no such field: it is kept and not used", warn: true },
  ]);
  expect(valueFaults(fields, values, "tuning.ufo", true).every((f) => f.warn)).toBe(true);
});

test("the starter book holds each kind's starter schedules with its id, every kind on, every field at its default", () => {
  const book = starterEventBook([sheet]);
  expect(book.format).toBe(EVENT_BOOK_FORMAT);
  expect(book.schedules).toEqual([{ ...night, kind: "ufo" }]);
  expect(book.schedules[0]!.firstDelay).not.toBe(night.firstDelay);
  expect([book.kinds, book.tuning]).toEqual([{}, {}]);
  expect(eventBookFaults(book, sheets, "save")).toEqual([]);
  expect(kindOn(book, "ufo")).toBe(true);
  expect(kindOn({ ...book, kinds: { ufo: { on: false } } }, "ufo")).toBe(false);
  expect(starterEventBook().schedules).toEqual([]);
});

test("a book naming a kind no module defines is kept, with warnings, and its schedule calls nothing", () => {
  const book: EventBook = { ...starterEventBook([sheet]), kinds: { meteor: { on: false } }, tuning: { meteor: { size: 3 } } };
  book.schedules.push({ ...night, key: "rocks", kind: "meteor" });
  const faults = eventBookFaults(book, sheets, "save");
  expect(faults.map((f) => [f.path, f.warn ?? false])).toEqual([["kinds.meteor", true], ["tuning.meteor", true], ["schedules[1].kind", true]]);
});

test("a book that is no book is refused at load, and one with a bad value only at save", () => {
  expect(eventBookFaults(null, sheets, "load")).toEqual([{ path: "", message: "a book is an object" }]);
  const broken = { ...starterEventBook([sheet]), format: 1, rules: { minPlayers: -1, maxLive: 99 }, announce: "shout", schedules: [{ ...night, chance: 2 }, { ...night }] };
  expect(eventBookFaults(broken, sheets, "load").filter((f) => !f.warn).map((f) => f.path)).toEqual(["format", "rules.minPlayers", "rules.maxLive", "announce", "schedules[0].chance", "schedules[1].key"]);
  const odd = { ...starterEventBook([sheet]), tuning: { ufo: { health: 0 } } };
  expect(eventBookFaults(odd, sheets, "load").filter((f) => !f.warn)).toEqual([]);
  expect(eventBookFaults(odd, sheets, "save").map((f) => f.path)).toEqual(["tuning.ufo.health"]);
});

test("a kind's own words, fields and starter schedules are checked when it is defined", () => {
  expect(sheetFaults(sheet)).toEqual([]);
  expect(sheetFaults({ ...sheet, id: "Ufo!" })[0]).toContain("a kind's id");
  expect(sheetFaults({ ...sheet, schedules: [{ ...night, interval: [10, 20] }] })[0]).toContain("schedules[0].interval");
});

test("a schedule's hours wrap past midnight where it begins later than it ends", () => {
  expect([inHours([20, 5], 22), inHours([20, 5], 3), inHours([20, 5], 12), inHours([8, 17], 12), inHours([8, 17], 17), inHours(null, 4)]).toEqual([true, true, false, true, false, true]);
});
