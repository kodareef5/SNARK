// What an edit on the drop book's admin page does to a book (client/core/drops/edit.ts).

import { expect, test } from "bun:test";
import { addEntry, addSet, addSlot, changes, differs, faultsAt, getAt, moveAt, parseBook, pathText, read, removeAt, setAt, show } from "../../client/core/drops/edit.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { bookFaults } from "../../shared/supply/book.ts";

test("a field's text is read as its kind, and what is not its kind is refused and left out of the draft", () => {
  expect([read("whole", "12"), read("whole", "1.5"), read("whole", "-1"), read("number", "1.5"), read("number", "x")]).toEqual([{ ok: true, value: 12 }, { ok: false }, { ok: false }, { ok: true, value: 1.5 }, { ok: false }]);
  // A share is written as hundredths, with or without the sign.
  expect([read("share", "35"), read("share", "35%"), read("share", "0.5"), read("share", "120"), show("share", 0.35), show("share", 0.005)]).toEqual([{ ok: true, value: 0.35 }, { ok: true, value: 0.35 }, { ok: true, value: 0.005 }, { ok: false }, "35", "0.5"]);
  // Ids are the pack's own unless they say another's; a list of none is refused.
  expect([read("ids", "bow, core:crossbow  mod:lance"), read("ids", "Bow"), read("ids", " , ")]).toEqual([{ ok: true, value: ["core:bow", "core:crossbow", "mod:lance"] }, { ok: false }, { ok: false }]);
  expect([read("quality", "tier"), read("quality", "1.25 to 3.25"), read("quality", "2-5"), read("quality", "5 to 2"), read("quality", ""), show("quality", "tier"), show("quality", [1, 2.5])]).toEqual([{ ok: true, value: "tier" }, { ok: true, value: [1.25, 3.25] }, { ok: true, value: [2, 5] }, { ok: false }, { ok: true, value: undefined }, "tier", "1 to 2.5"]);
  expect([read("rgb", "#3a8cff"), read("rgb", "blue"), show("rgb", 0x3a8cff), read("pair", "240 to 360"), show("pair", [240, 360])]).toEqual([{ ok: true, value: 0x3a8cff }, { ok: false }, "#3a8cff", { ok: true, value: [240, 360] }, "240 to 360"]);
  // An empty field takes its key away, except where a value is needed; a flag unticked is no key.
  expect([read("whole", " "), read("whole", "", false), read("flag", "true"), read("flag", "false"), read("text", " kit "), show("whole", undefined)]).toEqual([{ ok: true, value: undefined }, { ok: false }, { ok: true, value: true }, { ok: true, value: undefined }, { ok: true, value: "kit" }, ""]);
});

test("a path finds a place in the book, though a set's key has dots; a value is put there, a key taken away, a line moved", () => {
  const b = starterBook();
  const line = ["sets", "prize.arms.white", "entries", 0] as const;
  expect([getAt(b, [...line, "min"]), getAt(b, ["sets", "no.such", "entries"]), pathText([...line, "min"])]).toEqual([1, undefined, "sets.prize.arms.white.entries.0.min"]);
  setAt(b, [...line, "max"], 3);
  setAt(b, [...line, "quality"], undefined);
  expect([b.sets["prize.arms.white"]!.entries[0]!.max, "quality" in b.sets["prize.arms.white"]!.entries[0]!]).toEqual([3, false]);
  expect(() => setAt(b, ["sets", "no.such", "min"], 1)).toThrow("no place");
  const first = b.sets["prize.arms.white"]!.entries.map((e) => e.items[0]);
  moveAt(b, ["sets", "prize.arms.white", "entries", 0], 1);
  moveAt(b, ["sets", "prize.arms.white", "entries", 0], -1);
  expect(b.sets["prize.arms.white"]!.entries.map((e) => e.items[0])).toEqual([first[1], first[0], ...first.slice(2)]);
  removeAt(b, ["sets", "prize.arms.white", "entries", 0]);
  expect(b.sets["prize.arms.white"]!.entries.length).toBe(first.length - 1);
  removeAt(b, ["future", "core:raft_assembly"]);
  expect(Object.keys(b.future)).toEqual([]);
});

test("lines, sets and slots are added, and what differs from the book in force is said a line a place", () => {
  const [a, b] = [starterBook(), starterBook()];
  expect([differs(a, b), changes(a, b)]).toEqual([false, []]);
  // The server sets a book's revision and map: neither is a change.
  [b.revision, b.map] = [9, "miami"];
  expect(differs(a, b)).toBe(false);
  b.rules.ringedChance = 0.1;
  b.sets["prize.arms.white"]!.entries[0]!.max = 2;
  addEntry(b, "kit.arms.white", "core:pike");
  expect([addSet(b, "prize.arms.extra"), addSet(b, "prize.arms.extra"), addSet(b, "Bad Key")]).toEqual([true, false, false]);
  addSlot(b, "white/arms", "prize.arms.extra");
  delete b.future["core:raft_assembly"];
  expect(differs(a, b)).toBe(true);
  expect(changes(a, b)).toEqual([
    "rules.ringedChance: 0.06 → 0.1",
    "sets.kit.arms.white.entries: 4 → 5 lines",
    "sets.prize.arms.white.entries.0.max: 1 → 2",
    'sets.prize.arms.extra: added {"name":"prize.arms.extra","min":1,"max":1,"entries":[{"i…',
    "tables.white/arms.slots: 4 → 5 lines",
    "future.core:raft_assembly: taken away",
  ]);
  // The draft is still a sound book, and its new slot draws from its new set.
  expect([bookFaults(b).filter((f) => !f.warn), b.tables["white/arms"]!.slots.at(-1)]).toEqual([[], { name: "more", from: [{ set: "prize.arms.extra" }] }]);
  // Many changes are cut short, with how many more.
  const c = starterBook();
  for (const t of c.tiers) t.target += 1;
  expect(changes(a, c, 3)).toEqual(["tiers.0.target: 200 → 201", "tiers.1.target: 400 → 401", "tiers.2.target: 800 → 801", "and 4 more"]);
});

test("a fault is found at its field and under it, and a file's text is a book or says why not", () => {
  const b = starterBook();
  b.rules.flightSeconds = 300;
  b.sets["prize.arms.white"]!.power = 0.3;
  const faults = bookFaults(b);
  expect([faultsAt(faults, ["rules", "flightSeconds"]).length, faultsAt(faults, ["rules"]).map((f) => f.path), faultsAt(faults, ["sets", "prize.arms.white"]).map((f) => f.path), faultsAt(faults, ["sets", "prize.armour.white"])]).toEqual([1, ["rules.flightSeconds", "rules.noticeSeconds"], ["sets.prize.arms.white.power"], []]);
  const text = JSON.stringify(starterBook());
  const back = parseBook(text);
  expect(["book" in back && !differs(back.book, starterBook()), parseBook("{not json"), parseBook("[1]"), parseBook('{"rules":{}}')]).toEqual([true, { error: expect.stringContaining("not JSON") }, { error: "a book is a JSON object" }, { error: "a book has tiers" }]);
});
