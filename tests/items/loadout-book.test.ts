// The loadout book (shared/loadout/book.ts), its built-ins (content/loadouts.ts) and its file (server/loadout/store.ts).

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinLoadouts } from "../../content/loadouts.ts";
import { LoadoutStore } from "../../server/loadout/store.ts";
import { MOST, isTame, loadoutFaults, type ItemEntry, type LoadoutBook, type LoadoutFault, type TameEntry } from "../../shared/loadout/book.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const dir = mkdtempSync(join(tmpdir(), "snark-loadout-book-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The faults of the built-in book after `change`, checked against the game. */
function faults(change: (b: LoadoutBook) => void): LoadoutFault[] {
  const b = builtinLoadouts();
  change(b);
  return loadoutFaults(b, reg);
}
const paths = (change: (b: LoadoutBook) => void): string[] => faults(change).map((f) => f.path);
/** The first entry of the loadout `id`, which the built-in book holds. */
const first = (b: LoadoutBook, id: string): ItemEntry => b.loadouts.find((l) => l.id === id)!.entries[0] as ItemEntry;
const pteranodon = (b: LoadoutBook): TameEntry => b.loadouts.find((l) => l.id === "scout")!.entries.find(isTame)!;

test("the built-in book has no faults and names only things the game has", () => {
  const book = builtinLoadouts();
  expect(loadoutFaults(book)).toEqual([]);
  expect(loadoutFaults(book, reg)).toEqual([]);
  expect(book.loadouts.map((l) => l.id)).toEqual(["naked", "stone", "hunter", "rifleman", "scout"]);
  for (const l of book.loadouts) {
    for (const e of l.entries) {
      for (const id of isTame(e) ? [e.tame] : [e.item, e.ammo, e.attach]) if (id !== undefined) expect([id, reg.index.has(id)]).toEqual([id, true]);
    }
  }
  // Each call makes its own book.
  book.loadouts.length = 0;
  expect(builtinLoadouts().loadouts.length).toBe(5);
});

test("the built-in book assigns the naked loadout to players and to admins", () => {
  const book = builtinLoadouts();
  expect(book.assign).toEqual({ player: "naked", admin: "naked" });
  expect(book.loadouts.find((l) => l.id === "naked")!.entries).toEqual([]);
  expect(book.loadouts.every((l) => !l.respawn)).toBe(true);
});

test("a book that assigns a loadout it does not hold is refused, with the path", () => {
  expect(faults((b) => void (b.assign.admin = "knight"))).toEqual([{ path: "assign.admin", message: "names a loadout of the book" }]);
  expect(paths((b) => void (b.assign.player = "Scout"))).toEqual(["assign.player"]);
  expect(paths((b) => void b.loadouts.shift())).toEqual(["assign.player", "assign.admin"]);
});

test("a loadout's id is its own, of lower-case letters, digits and dashes", () => {
  expect(paths((b) => void (b.loadouts[2]!.id = "stone"))).toEqual(["loadouts[2].id"]);
  // None begins with a dash, so a command's `-clear` is never a loadout.
  for (const id of ["", "Stone", "stone age", "a".repeat(33), "-clear", "-"]) expect(paths((b) => void (b.loadouts[1]!.id = id))).toEqual(["loadouts[1].id"]);
  for (const id of ["stone-2", "clear", "2-"]) expect(paths((b) => void (b.loadouts[1]!.id = id))).toEqual([]);
});

test("an entry with a bad count, place or level is refused, with its path", () => {
  for (const count of [0, -1, 1.5, "3", MOST.count + 1]) expect(paths((b) => void ((first(b, "hunter") as { count: unknown }).count = count))).toEqual(["loadouts[2].entries[0].count"]);
  expect(paths((b) => void ((first(b, "stone") as { place: string }).place = "hand"))).toEqual(["loadouts[1].entries[0].place"]);
  expect(paths((b) => void ((pteranodon(b) as { place: string }).place = "wear"))).toEqual(["loadouts[4].entries[5].place"]);
  for (const level of [0, 2.5, MOST.level + 1]) expect(paths((b) => void (pteranodon(b).level = level))).toEqual(["loadouts[4].entries[5].level"]);
  for (const quality of [-1, 6, 1.5]) expect(paths((b) => void (first(b, "stone").quality = quality))).toEqual(["loadouts[1].entries[0].quality"]);
  expect(paths((b) => void (first(b, "stone").quality = 5))).toEqual([]);
});

test("a blueprint goes in the bag, of an item that may be one", () => {
  expect(paths((b) => void (first(b, "stone").blueprint = true))).toEqual(["loadouts[1].entries[0].place"]);
  expect(paths((b) => void Object.assign(first(b, "stone"), { blueprint: true, place: "bag" }))).toEqual([]);
  expect(paths((b) => void b.loadouts[1]!.entries.push({ item: "core:wood", count: 1, place: "bag", blueprint: true }))).toEqual(["loadouts[1].entries[8].blueprint"]);
});

test("only armor is worn, and only a creature is a tame", () => {
  expect(paths((b) => void (first(b, "stone").place = "wear"))).toEqual(["loadouts[1].entries[0].place"]);
  expect(paths((b) => void (pteranodon(b).tame = "core:hatchet"))).toEqual(["loadouts[4].entries[5].tame"]);
  const vehicle = reg.defs.find((d) => d?.type === "species" && d.class === "vehicle")!.id;
  expect(paths((b) => void (pteranodon(b).tame = vehicle))).toEqual(["loadouts[4].entries[5].tame"]);
  // A full soul ball stands for a tame's record, so it is given as a tame entry and never as an item.
  expect(paths((b) => void b.loadouts[0]!.entries.push({ item: "core:soul_ball_full", count: 1, place: "bag" }))).toEqual(["loadouts[0].entries[0].item"]);
});

test("an id the game lacks is a warning, not a fault", () => {
  const change = (b: LoadoutBook): void => {
    first(b, "stone").item = "mod:greatsword";
    first(b, "rifleman").ammo = "mod:round_silver";
    pteranodon(b).tame = "mod:griffin";
  };
  expect(faults(change).map((f) => [f.path, f.warn])).toEqual([["loadouts[1].entries[0].item", true], ["loadouts[3].entries[0].ammo", true], ["loadouts[4].entries[5].tame", true]]);
  // Without the game to ask, nothing is said of ids.
  const b = builtinLoadouts();
  change(b);
  expect(loadoutFaults(b)).toEqual([]);
});

test("ammunition or an attachment the weapon cannot take is a warning", () => {
  expect(faults((b) => void (first(b, "rifleman").ammo = "core:arrow_stone")).map((f) => [f.path, f.warn])).toEqual([["loadouts[3].entries[0].ammo", true]]);
  expect(faults((b) => void (first(b, "hunter").attach = "core:scope")).map((f) => [f.path, f.warn])).toEqual([["loadouts[2].entries[0].attach", true]]);
  // Darts are fired with nothing fitted.
  expect(faults((b) => void (first(b, "rifleman").ammo = "core:dart_tranq")).map((f) => [f.path, f.warn])).toEqual([["loadouts[3].entries[0].attach", true]]);
});

test("whatever a book is handed, its faults are said and nothing throws", () => {
  for (const junk of [null, 7, "book", [], {}, { revision: 0, assign: "naked", loadouts: {} }, { revision: 0, assign: {}, loadouts: [null, 3, { id: 5, entries: [null, 1, { item: 4 }, { tame: {}, item: [] }] }] }]) {
    expect(loadoutFaults(junk, reg).filter((f) => !f.warn).length).toBeGreaterThan(0);
  }
  expect(paths((b) => void (b.revision = -1))).toEqual(["revision"]);
  expect(paths((b) => void (b.loadouts[0]!.label = ""))).toEqual(["loadouts[0].label"]);
  expect(paths((b) => void (b.loadouts[0]!.note = "n".repeat(MOST.note + 1)))).toEqual(["loadouts[0].note"]);
  expect(paths((b) => void ((b.loadouts[0] as { respawn: unknown }).respawn = "yes"))).toEqual(["loadouts[0].respawn"]);
  expect(paths((b) => void (b.loadouts[0]!.entries = Array.from({ length: MOST.entries + 1 }, () => ({ item: "core:wood", count: 1, place: "bag" as const }))))).toEqual(["loadouts[0].entries"]);
  expect(paths((b) => void (b.loadouts = Array.from({ length: MOST.loadouts + 1 }, (_, i) => ({ id: i === 0 ? "naked" : `l-${i}`, label: "L", note: "", respawn: false, entries: [] }))))).toEqual(["loadouts"]);
});

test("a stale save is a conflict and changes nothing", () => {
  const path = join(dir, "stale.db.loadouts.json");
  const store = new LoadoutStore(path, builtinLoadouts, reg);
  expect([store.builtin, store.book.revision, store.kept, existsSync(path)]).toEqual([true, 0, true, false]);
  const next = builtinLoadouts();
  next.assign.admin = "scout";
  expect(store.save(next, 0, "ada", "admins scout")).toEqual({ ok: true, revision: 1 });
  expect([store.builtin, store.book.revision, store.assigned(true)?.id, store.assigned(false)?.id]).toEqual([false, 1, "scout", "naked"]);
  // What was handed in is not the book in force.
  next.assign.admin = "stone";
  expect(store.book.assign.admin).toBe("scout");
  const onDisk = readFileSync(path, "utf8");
  expect(store.save(next, 0, "bob", "")).toEqual({ ok: false, conflict: 1 });
  expect([store.book.revision, store.book.assign.admin, readFileSync(path, "utf8") === onDisk]).toEqual([1, "scout", true]);
});

test("a save with a fault is refused with its path, and one with a warning is kept", () => {
  const store = new LoadoutStore(null, builtinLoadouts, reg);
  const next = builtinLoadouts();
  next.assign.player = "knight";
  expect(store.save(next, 0, "ada", "")).toEqual({ ok: false, faults: [{ path: "assign.player", message: "names a loadout of the book" }] });
  expect([store.builtin, store.book.revision, store.kept]).toEqual([true, 0, false]);
  next.assign.player = "stone";
  first(next, "stone").item = "mod:greatsword";
  expect(store.save(next, 0, "ada", "")).toEqual({ ok: true, revision: 1 });
  expect([store.find("stone")!.entries.length, store.find("knight"), store.warnings().map((f) => f.path)]).toEqual([8, undefined, ["loadouts[1].entries[0].item"]]);
  // A book with nowhere to be written is not saved, and the answer says so.
  const lost = new LoadoutStore(join(dir, "no-such-folder", "w.loadouts.json"), builtinLoadouts, reg);
  const r = lost.save(builtinLoadouts(), 0, "ada", "");
  expect([r.ok, "failed" in r && r.failed.length > 0, lost.book.revision, lost.builtin]).toEqual([false, true, 0, true]);
});

test("a saved book is read at the next start; a broken file leaves the built-ins", () => {
  const path = join(dir, "world.db.loadouts.json");
  const said: string[] = [];
  const open = (): LoadoutStore => new LoadoutStore(path, builtinLoadouts, reg, (l) => said.push(l));
  const next = builtinLoadouts();
  next.assign.player = "hunter";
  next.loadouts[2]!.respawn = true;
  expect(open().save(next, 0, "ada", "")).toEqual({ ok: true, revision: 1 });
  const again = open();
  expect([again.builtin, again.book.revision, again.assigned(false)?.id, again.assigned(false)?.respawn]).toEqual([false, 1, "hunter", true]);
  // A file cut short is left as it is, and so is one whose book has a fault.
  const whole = readFileSync(path, "utf8");
  const cut = whole.slice(0, whole.length / 2);
  writeFileSync(path, cut);
  const broken = open();
  expect([broken.builtin, broken.book.revision, broken.assigned(false)?.id, readFileSync(path, "utf8") === cut]).toEqual([true, 0, "naked", true]);
  expect(said.at(-1)).toBe(`loadouts: ${path} is not whole JSON, so the built-in loadouts are in force and the file is left as it is`);
  const faulty = whole.replace('"player": "hunter"', '"player": "knight"');
  writeFileSync(path, faulty);
  expect([open().builtin, readFileSync(path, "utf8") === faulty]).toEqual([true, true]);
  expect(said.at(-1)).toMatch(/has 1 faults \(assign\.player: names a loadout of the book\), so the built-in loadouts are in force/);
});

test("reset puts the built-ins back as the next revision", () => {
  const path = join(dir, "reset.db.loadouts.json");
  const store = new LoadoutStore(path, builtinLoadouts, reg);
  const next = builtinLoadouts();
  next.assign = { player: "stone", admin: "rifleman" };
  next.loadouts.pop();
  expect(store.save(next, 0, "ada", "")).toEqual({ ok: true, revision: 1 });
  expect(store.reset("ada")).toEqual({ ok: true, revision: 2 });
  expect(store.book).toEqual({ ...builtinLoadouts(), revision: 2 });
  expect(new LoadoutStore(path, builtinLoadouts, reg).book).toEqual({ ...builtinLoadouts(), revision: 2 });
});
