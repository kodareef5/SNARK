// What the events page says and does to its draft (client/core/admin/events.ts, events-edit.ts): fields read and shown,
// a kind's tuning kept to what was changed, kinds switched, starter rows added, the address, a path's runs, and each
// kind's tuning laid out from its own sheet.

import { expect, test } from "bun:test";
import { UFO_TUNING } from "../../modules/ufo.ts";
import { eventWords, fromHash, hoursWords, kindStatus, lookWords, pathRuns, pathWords, perDay, toHash, tuningGroups } from "../../client/core/admin/events.ts";
import { addSchedule, addStarter, changes, differs, parseEventBook, read, removeSchedule, resetTuning, setAt, setKindOn, setTuning, show, tuningValue, type EditKind } from "../../client/core/admin/events-edit.ts";
import { eventBookFaults, starterEventBook, type KindSheet, type ScheduleDoc } from "../../shared/mapevent/book.ts";

const night: ScheduleDoc = { key: "ufo.night", kind: "ufo", on: true, firstDelay: [900, 2400], interval: [2400, 4800], maxLive: 1, hours: [20, 5], chance: 0.8 };
const UFO: KindSheet = { id: "ufo", label: "UFO", about: "", module: "ufo", fields: UFO_TUNING, schedules: [night] };

test("a field's text is read as its kind and shown as it was typed", () => {
  const cases: [EditKind, string, unknown][] = [
    ["number", " -2.5 ", -2.5], ["whole", "7", 7], ["share", "97", 0.97], ["share", "12.5%", 0.125], ["pair", "750 to 1100", [750, 1100]], ["pair", "1, 2", [1, 2]],
    ["wholePair", "9 to 14", [9, 14]], ["flag", "true", true], ["flag", "", false], ["text", "meridian", "meridian"], ["keys", "arms, armour works", ["arms", "armour", "works"]],
    ["hours", "20 to 5", [20, 5]], ["hours", "", null], ["hours", "any", null], ["choice", "chat", "chat"],
  ];
  for (const [kind, text, value] of cases) expect([kind, text, read(kind, text)]).toEqual([kind, text, { ok: true, value }]);
  for (const [kind, text] of [["whole", "2.5"], ["number", "x"], ["share", "120"], ["pair", "5 to 1"], ["wholePair", "1.5 to 2"], ["hours", "25 to 3"], ["keys", ""], ["keys", "Bad!"], ["number", ""]] as const) expect([kind, text, read(kind, text).ok]).toEqual([kind, text, false]);
  expect([show("share", 0.97), show("pair", [750, 1100]), show("keys", ["arms", "works"]), show("hours", null), show("number", 60000)]).toEqual(["97", "750 to 1100", "arms, works", "", "60000"]);
});

test("a kind's tuning keeps only what differs from its defaults, and a kind is on unless the book says off", () => {
  const book = starterEventBook([UFO]);
  expect(tuningValue(book, UFO, "health")).toBe(60000);
  setTuning(book, UFO, "health", 40000);
  setTuning(book, UFO, "cruiseHeight", [800, 1200]);
  expect(book.tuning).toEqual({ ufo: { health: 40000, cruiseHeight: [800, 1200] } });
  setTuning(book, UFO, "health", 60000);
  setTuning(book, UFO, "cruiseHeight", [750, 1100]);
  expect(book.tuning).toEqual({});
  setTuning(book, UFO, "lootRolls", 3);
  resetTuning(book, "ufo");
  expect(book.tuning).toEqual({});
  setKindOn(book, "ufo", false);
  expect(book.kinds).toEqual({ ufo: { on: false } });
  setKindOn(book, "ufo", true);
  expect(book.kinds).toEqual({});
  // A path into a kind's tuning that the book has not got yet is made on the way.
  setAt(book, ["tuning", "meteor", "rolls"], 2);
  expect(book.tuning.meteor).toEqual({ rolls: 2 });
});

test("schedules are added off, taken out, and a kind's starter rows are added under keys of their own", () => {
  const book = starterEventBook([]);
  expect(addStarter(book, UFO)).toBe(1);
  expect(addStarter(book, UFO)).toBe(0);
  expect(addSchedule(book, "ufo")).toBe("ufo.new");
  expect(addSchedule(book, "ufo")).toBe("ufo.new.2");
  expect(book.schedules.map((s) => [s.key, s.on])).toEqual([["ufo.night", true], ["ufo.new", false], ["ufo.new.2", false]]);
  removeSchedule(book, 1);
  expect(book.schedules.map((s) => s.key)).toEqual(["ufo.night", "ufo.new.2"]);
  expect(eventBookFaults(book, new Map([["ufo", UFO]]), "save")).toEqual([]);
  // A copy: the starter row the sheet gave is not the book's.
  book.schedules[0]!.firstDelay[0] = 1;
  expect(night.firstDelay[0]).toBe(900);
  expect(differs(starterEventBook([UFO]), book)).toBe(true);
  expect(changes(starterEventBook([UFO]), book)).toEqual(["schedules: 1 → 2 lines"]);
});

test("a file is taken as a book only if it is one, and a drop book is named as the wrong file", () => {
  expect(parseEventBook(JSON.stringify(starterEventBook([UFO])))).toEqual({ book: starterEventBook([UFO]) });
  expect(String((parseEventBook("{") as { error: string }).error)).toStartWith("not JSON");
  expect(parseEventBook(JSON.stringify({ tiers: [], tables: [] }))).toEqual({ error: "this is a drop book, not an event book" });
  expect(parseEventBook(JSON.stringify({ rules: {}, kinds: {}, schedules: [] }))).toEqual({ error: "an event book has tuning" });
});

test("the address names the view, and for the map and tuning a kind and a seed", () => {
  expect(fromHash("#map/ufo/4242")).toEqual({ view: "map", kind: "ufo", seed: 4242 });
  expect(fromHash("#tuning/xp_hour")).toEqual({ view: "tuning", kind: "xp_hour", seed: null });
  expect(fromHash("#nothing")).toEqual({ view: null, kind: "", seed: null });
  expect([toHash({ view: "map", kind: "ufo", seed: 7 }), toHash({ view: "tuning", kind: "ufo", seed: 7 }), toHash({ view: "live", kind: "ufo", seed: 7 })]).toEqual(["#map/ufo/7", "#tuning/ufo", "#live"]);
});

test("a path is drawn as runs split where its beam comes on and goes off, and said in a line", () => {
  const p = (x: number, low: boolean) => ({ x, y: 500, z: 0, speed: 100, low });
  const points = [p(0, false), p(1000, true), p(2000, true), p(3000, false)];
  const runs = pathRuns(points);
  expect(runs.map((r) => r.low)).toEqual([false, true, false]);
  // Unbroken: each run starts where the one before ended.
  for (let k = 1; k < runs.length; k++) expect(runs[k]!.line[0]).toEqual(runs[k - 1]!.line.at(-1)!);
  expect(pathWords(points, 31)).toBe("31 s across the map, 4 points, 1 low pass");
  expect(pathRuns([p(0, false)])).toEqual([]);
});

test("each kind's tuning is laid out from its own sheet, in its groups", () => {
  const groups = tuningGroups(UFO);
  expect(groups.map((g) => [g.group, g.fields.length])).toEqual([["Toughness", 4], ["Flight", 8], ["Its core", 5]]);
  const soak = groups[0]!.fields[1]!;
  expect([soak.key, soak.path, soak.kind, soak.unit, soak.bounds]).toEqual(["shieldSoak", ["tuning", "ufo", "shieldSoak"], "share", "%", "0 to 1"]);
  expect(groups[1]!.fields.map((f) => f.kind)).toEqual(["number", "number", "pair", "number", "pair", "wholePair", "wholePair", "number"]);
  expect(groups[2]!.fields.map((f) => f.kind)).toEqual(["text", "keys", "whole", "flag", "number"]);
});

test("a schedule's pace, a kind's status, and an event in words", () => {
  expect(hoursWords([20, 5])).toBe("20:00 to 05:00, past midnight");
  // Every 3,600 s at 80 in 100, nine hours of the day in.
  expect(perDay(night)).toBeCloseTo((86400 / 3600) * 0.8 * (9 / 24), 3);
  const book = starterEventBook([UFO]);
  expect(kindStatus(book, "ufo", 1)).toEqual({ on: true, schedules: 1, scheduled: 1, perDay: perDay(night), live: 1 });
  expect(kindStatus({ ...book, kinds: { ufo: { on: false } } }, "ufo", 0).perDay).toBe(0);
  expect(lookWords({ key: "k", on: true, looks: 120, why: "out of its hours", looked: 3, now: "" })).toEqual({ next: "looks in 2 min", last: "passed: out of its hours", now: "would call one now, at its chance" });
  expect(eventWords({ state: "notice", left: 40, parts: [] })).toBe("coming in 40 s");
  expect(eventWords({ state: "live", left: 0, parts: [{ type: "craft", id: 1, state: "flying", x: 2100, y: 900, z: 3300, health: 800, most: 1000, shield: "closed" }, { type: "crate", id: 2, x: 5, z: 6, stacks: 4 }] })).toBe("craft 1 flying, 80% of its health, its shield shut at 2100, 3300, 900 up; crate 2 at 5, 6, 4 stacks");
});
