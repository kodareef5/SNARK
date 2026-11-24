// The loadouts' admin page, its parts that are not its wiring (client/core/admin/loadouts.ts): the draft and each
// change to it, what the pickers find, what the save bar says, and where a fault is shown.

import { expect, test } from "bun:test";
import {
  cannotHand, fill,
  addEntry, addLoadout, asShown, assignOptions, barHtml, changeEntry, copyLoadout, differs, draftFaults, draftOf, faultAt, fieldChange, knownOf, listHtml, loadoutHtml, moveEntry, parseBook,
  picked, pickerMatches, placesFor, qualityFor, removeEntry, removeLoadout, renameLoadout, replaceEntries, savable, setAssign, setLoadout, survivorOptions, withServer,
} from "../../client/core/admin/loadouts.ts";
import { builtinLoadouts } from "../../content/loadouts.ts";
import { MOST, loadoutFaults, type ItemEntry, type LoadoutBook } from "../../shared/loadout/book.ts";
import { loadoutCatalog } from "../../shared/loadout/catalog.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const known = knownOf(loadoutCatalog(reg));
const entries = (book: LoadoutBook, id: string) => book.loadouts.find((l) => l.id === id)!.entries;

test("an entry is added, changed, moved and removed in the draft", () => {
  const book = builtinLoadouts();
  const d = draftOf(book);
  expect([addEntry(d, "naked", "item"), addEntry(d, "naked", "tame"), addEntry(d, "nothing", "item")]).toEqual([true, true, false]);
  expect(entries(d, "naked")).toEqual([{ item: "", count: 1, place: "bag" }, { tame: "", level: 1, saddled: false, place: "bag" }]);
  // Each field of a row is one change; what a field does not take changes nothing.
  for (const [field, raw] of [["item", "core:rifle"], ["count", "2"], ["place", "hotbar"], ["quality", "3"], ["ammo", "core:round_rifle"], ["attach", "core:scope"]] as const) expect(changeEntry(d, "naked", 0, fieldChange(field, raw)!, known)).toBe(true);
  expect(entries(d, "naked")[0]).toEqual({ item: "core:rifle", count: 2, place: "hotbar", quality: 3, ammo: "core:round_rifle", attach: "core:scope" });
  expect([fieldChange("count", "lots"), fieldChange("count", "2.5"), fieldChange("place", "pocket"), fieldChange("blueprint", "yes"), fieldChange("weight", "3")]).toEqual([null, null, null, null, null]);
  expect([fieldChange("count", "0"), fieldChange("count", "99999"), fieldChange("level", "5000"), fieldChange("saddled", true)]).toEqual([{ count: 1 }, { count: MOST.count }, { level: MOST.level }, { saddled: true }]);
  // Primitive quality and no rounds are the entry without the field, as the built-ins are written.
  changeEntry(d, "naked", 0, { quality: 0, ammo: "" }, known);
  expect(entries(d, "naked")[0]).toEqual({ item: "core:rifle", count: 2, place: "hotbar", attach: "core:scope" });
  // A blueprint lies in the bag, unloaded and bare; a bow takes no scope.
  changeEntry(d, "naked", 0, { blueprint: true }, known);
  expect(entries(d, "naked")[0]).toEqual({ item: "core:rifle", count: 2, place: "bag", blueprint: true });
  changeEntry(d, "naked", 0, { blueprint: false, attach: "core:scope", item: "core:bow" }, known);
  expect(entries(d, "naked")[0]).toEqual({ item: "core:bow", count: 2, place: "bag" });
  // A tame is a species, a level and a saddle where one is made for it.
  changeEntry(d, "naked", 1, { tame: "core:pteranodon", level: 150, saddled: true, place: "hotbar" }, known);
  expect(entries(d, "naked")[1]).toEqual({ tame: "core:pteranodon", level: 150, saddled: true, place: "hotbar" });
  changeEntry(d, "naked", 1, { tame: "core:dodo" }, known);
  expect(entries(d, "naked")[1]).toEqual({ tame: "core:dodo", level: 150, saddled: false, place: "hotbar" });

  expect([moveEntry(d, "naked", 0, -1), moveEntry(d, "naked", 1, 1), moveEntry(d, "naked", 0, 1)]).toEqual([false, false, true]);
  expect(entries(d, "naked").map((e) => ("tame" in e ? e.tame : e.item))).toEqual(["core:dodo", "core:bow"]);
  expect([removeEntry(d, "naked", 5), removeEntry(d, "naked", 0), entries(d, "naked")]).toEqual([false, true, [{ item: "core:bow", count: 2, place: "bag" }]]);
  // What was read from a survivor takes the place of every entry, and is the draft's own copy.
  const read: ItemEntry[] = [{ item: "core:spear", count: 1, place: "hotbar" }];
  expect(replaceEntries(d, "naked", read)).toBe(true);
  read[0]!.count = 9;
  expect(entries(d, "naked")).toEqual([{ item: "core:spear", count: 1, place: "hotbar" }]);
  // None of it touched the book the draft was made from, and the draft is a book the game takes.
  expect([book, loadoutFaults(d, reg)]).toEqual([builtinLoadouts(), []]);
  for (let n = entries(d, "naked").length; n < MOST.entries; n++) expect(addEntry(d, "naked", "item")).toBe(true);
  expect(addEntry(d, "naked", "item")).toBe(false);
});

test("wear is offered only for armor, and quality only where it counts", () => {
  const item = (id: string) => known.item.get(id);
  expect([placesFor(item("core:flak_shirt")), placesFor(item("core:rifle")), placesFor(item("core:wood")), placesFor(undefined)]).toEqual([["wear", "hotbar", "bag"], ["hotbar", "bag"], ["hotbar", "bag"], ["hotbar", "bag"]]);
  expect([placesFor(item("core:flak_shirt"), true), placesFor(item("core:rifle"), true)]).toEqual([["bag"], ["bag"]]);
  expect([qualityFor(item("core:hatchet")), qualityFor(item("core:flak_shirt")), qualityFor(item("core:wood")), qualityFor(item("core:round_rifle")), qualityFor(undefined)]).toEqual([true, true, false, false, false]);
  // The rows offer the same: a shirt may be worn and has a quality, wood neither, and neither is offered rounds.
  const d = draftOf(builtinLoadouts());
  replaceEntries(d, "naked", [{ item: "core:flak_shirt", count: 1, place: "bag" }, { item: "core:wood", count: 50, place: "bag" }, { item: "core:rifle", count: 1, place: "hotbar" }]);
  const rows = loadoutHtml(d, 0, known, []).split("<tr data-entry").slice(1);
  expect(rows.map((r) => [r.includes('value="wear"'), r.includes('data-field="quality"'), r.includes('data-field="ammo"'), r.includes('data-field="attach"')])).toEqual([[true, true, false, false], [false, false, false, false], [false, true, true, true]]);
  // A piece of armor just chosen is worn, one at a time; changed to what is not armor it goes to the bag.
  addEntry(d, "naked", "item");
  changeEntry(d, "naked", 3, { item: "core:flak_hat", count: 4 }, known);
  expect(entries(d, "naked")[3]).toEqual({ item: "core:flak_hat", count: 1, place: "wear" });
  changeEntry(d, "naked", 3, { item: "core:wood", quality: 2, blueprint: true }, known);
  expect(entries(d, "naked")[3]).toEqual({ item: "core:wood", count: 1, place: "bag" });
});

test("the draft says what differs from the book in force", () => {
  const book = builtinLoadouts();
  const d = draftOf(book);
  expect([differs(book, d), asShown(book, d, "stone")]).toEqual([[], true]);
  setAssign(d, "admin", "scout");
  setLoadout(d, "stone", { label: "Stone age", respawn: true });
  setLoadout(d, "hunter", { note: "A bow." });
  removeEntry(d, "rifleman", 0);
  changeEntry(d, "scout", 5, { level: 100 }, known);
  const copy = copyLoadout(d, "naked")!;
  removeLoadout(d, "hunter");
  expect(differs(book, d)).toEqual(["New admins get scout, not naked", "naked-copy: new, with 0 entries", "stone: its label, handed out again after each death", "rifleman: 7 entries, not 8", "scout: its entries", "hunter: removed"]);
  // Only a loadout in force as the page shows it is handed to a survivor from the page.
  expect([copy, asShown(book, d, "stone"), asShown(book, d, "scout"), asShown(book, d, copy)]).toEqual(["naked-copy", true, false, false]);
  const bar = barHtml(4, differs(book, d), [], -1);
  expect([bar.includes("6 changes to revision 4"), bar.includes('data-do="save" class="go">'), bar.includes("stone: its label"), barHtml(4, [], [], -1).includes('data-do="save"')]).toEqual([true, true, true, false]);
  // A save that lost to another editor's says so, and offers theirs.
  const lost = barHtml(4, ["x"], [], 5);
  expect([lost.includes("another editor saved revision 5"), lost.includes('data-do="theirs"'), lost.includes('data-do="over"')]).toEqual([true, true, true]);
});

test("a fault is shown at its entry, and a warning does not stop a save", () => {
  const d = draftOf(builtinLoadouts());
  addEntry(d, "stone", "item");
  changeEntry(d, "rifleman", 0, { item: "mod:laser_rifle" }, known);
  entries(d, "scout").push({ tame: "core:dodo", level: 5, saddled: true, place: "bag" }, { tame: "mod:wyvern", level: 5, saddled: false, place: "bag" });
  const faults = draftFaults(d, known);
  expect(faults).toEqual([
    { path: "loadouts[1].entries[8].item", message: "an item's id" },
    { path: "loadouts[3].entries[0].item", message: "mod:laser_rifle is not among the items the game hands out", warn: true },
    { path: "loadouts[4].entries[6].saddled", message: "no saddle fits core:dodo", warn: true },
    { path: "loadouts[4].entries[7].tame", message: "the game has no creature mod:wyvern", warn: true },
  ]);
  expect([faultAt(faults, "loadouts[1]").length, faultAt(faults, "loadouts[1].entries[8]").length, faultAt(faults, "loadouts[1].entries[0]").length, faultAt(faults, "loadouts[4]").length, faultAt(faults, "loadouts").length]).toEqual([1, 1, 0, 2, 4]);
  // The entry with the fault has it under its row and on its field; the list counts each loadout's.
  const stone = loadoutHtml(d, 1, known, faults);
  expect([stone.split('<tr class="said">').length - 1, stone.includes(`<div class="bad">an item's id</div>`), /data-field="item"[^>]*class="wrong"/.test(stone)]).toEqual([1, true, true]);
  const scout = loadoutHtml(d, 4, known, faults);
  expect([scout.split('<tr class="said">').length - 1, scout.includes('<div class="warn">no saddle fits core:dodo</div>'), /data-field="saddled"[^>]*class="odd"/.test(scout)]).toEqual([2, true, true]);
  const list = listHtml(d, "stone", faults);
  expect([list.includes('<span class="chip bad">1 fault</span>'), list.includes('<span class="chip warn">1 warning</span>'), list.includes('<span class="chip warn">2 warnings</span>'), list.split('class="pick on"').length - 1]).toEqual([true, true, true, 1]);
  // The fault holds the Save button back; with it mended the warnings alone do not.
  expect([savable(faults), barHtml(0, ["x"], faults, -1).includes('class="go" disabled')]).toEqual([false, true]);
  removeEntry(d, "stone", 8);
  const warned = draftFaults(d, known);
  expect([warned.length, savable(warned), barHtml(0, ["x"], warned, -1).includes('class="go" disabled'), loadoutFaults(d, reg).filter((f) => !f.warn)]).toEqual([3, true, false, []]);
  // What the server says of a path stands in place of the page's own guess at it.
  const told = withServer(warned, [{ path: "loadouts[3].entries[0].item", message: "the game has no mod:laser_rifle", warn: true }, { path: "loadouts[1].entries[3].place", message: "another entry is worn in the same place", warn: true }]);
  expect(told.map((f) => f.message)).toEqual(["the game has no mod:laser_rifle", "another entry is worn in the same place", "no saddle fits core:dodo", "the game has no creature mod:wyvern"]);
});

test("a loadout a role is given cannot be removed, and renamed it keeps the role", () => {
  const d = draftOf(builtinLoadouts());
  expect([removeLoadout(d, "naked"), d.loadouts.length]).toEqual(["New players get this loadout. Choose another for them first.", 5]);
  expect([setAssign(d, "player", "stone"), setAssign(d, "player", "nothing"), removeLoadout(d, "naked")]).toEqual([true, false, "New admins get this loadout. Choose another for them first."]);
  setAssign(d, "admin", "scout");
  expect([removeLoadout(d, "naked"), removeLoadout(d, "naked"), d.loadouts.map((l) => l.id)]).toEqual(["", "There is no such loadout.", ["stone", "hunter", "rifleman", "scout"]]);
  expect([renameLoadout(d, "scout", "Scout!"), renameLoadout(d, "scout", "stone"), renameLoadout(d, "scout", "flyer"), d.assign, loadoutFaults(d, reg)]).toEqual(["An id is 1 to 32 of a to z, 0 to 9 and -, and begins with no -.", "Another loadout is stone already.", "", { player: "stone", admin: "flyer" }, []]);
  expect(assignOptions(d, "admin")).toContain('<option value="flyer" selected>Scout (flyer)</option>');
  // An assignment to a loadout the book lacks is shown as it is, to be put right.
  d.assign.player = "gone";
  expect(assignOptions(d, "player")).toStartWith('<option value="gone" selected>gone (no such loadout)</option>');
});

test("a loadout is added and copied under an id of its own, until the book is full", () => {
  const d = draftOf(builtinLoadouts());
  expect([addLoadout(d), addLoadout(d), copyLoadout(d, "scout"), copyLoadout(d, "scout"), copyLoadout(d, "nothing")]).toEqual(["new", "new-2", "scout-copy", "scout-copy-2", null]);
  expect(d.loadouts.map((l) => l.id)).toEqual(["naked", "stone", "hunter", "rifleman", "scout", "scout-copy-2", "scout-copy", "new", "new-2"]);
  // A copy has the entries, not the same ones.
  entries(d, "scout-copy").length = 0;
  expect([entries(d, "scout").length, d.loadouts.find((l) => l.id === "scout-copy")!.label, loadoutFaults(d, reg).filter((f) => !f.warn)]).toEqual([6, "Scout copy", []]);
  while (d.loadouts.length < MOST.loadouts) addLoadout(d);
  expect([addLoadout(d), copyLoadout(d, "scout"), loadoutFaults(d).length]).toEqual([null, null, 0]);
});

test("the picker finds an item by its label or its id", () => {
  const ids = (text: string, kind: "item" | "tame" = "item") => pickerMatches(known, text, kind).map((p) => p.id);
  expect(ids("long rifle")).toEqual(["core:rifle"]);
  expect(ids("core:rifle")[0]).toBe("core:rifle");
  // Every word is looked for, in the label or the id, whatever its capitals; the nearest come first.
  expect([ids("rifle")[0], ids("rifle").includes("core:round_rifle"), ids("rifle").includes("core:rifle_assault"), ids("rifle").includes("core:hatchet")]).toEqual(["core:rifle", true, true, false]);
  expect([ids("Rifle Round")[0], ids("flak sh"), ids("no such thing"), ids("ptera", "tame"), ids("pteranodon").includes("core:pteranodon")]).toEqual(["core:round_rifle", ["core:flak_shirt"], [], ["core:pteranodon"], false]);
  expect(pickerMatches(known, "", "item", 5).length).toBe(5);
  // What is written in a picker is the id it means, or nothing where it could be several.
  expect([picked(known, "long rifle", "item"), picked(known, "rifle", "item"), picked(known, "core:hatchet", "item"), picked(known, "Hatchet", "item"), picked(known, "flak sh", "item"), picked(known, "flak", "item"), picked(known, "", "item"), picked(known, "Dodo", "tame")]).toEqual(["core:rifle", "core:rifle", "core:hatchet", "core:hatchet", "core:flak_shirt", "", "", "core:dodo"]);
});

test("a file is read as a draft only if it is a book without faults", () => {
  const book = builtinLoadouts();
  expect(parseBook(JSON.stringify(book))).toEqual({ book });
  const { revision: _, ...bare } = book;
  expect("book" in parseBook(JSON.stringify(bare))).toBe(true);
  expect(parseBook("{")).toMatchObject({ error: expect.stringMatching(/^not JSON/) });
  expect(parseBook("[]")).toEqual({ error: "a book is an object" });
  book.loadouts[1]!.entries[0] = { item: "core:hatchet", count: 0, place: "hotbar" };
  book.assign.admin = "gone";
  expect(parseBook(JSON.stringify(book))).toEqual({ error: "loadouts[1].entries[0].count: a whole number from 1 to 10000, and 1 more" });
});

test("only a survivor in the world may be handed a loadout, and that as saved", () => {
  const ada = { pid: 7, name: "Ada", online: false };
  expect(cannotHand(undefined, true)).toBe("No survivor has joined this world yet.");
  expect(cannotHand(ada, true)).toStartWith("Ada is away.");
  expect([cannotHand({ ...ada, online: true }, true), cannotHand({ ...ada, online: true }, false)]).toEqual(["", "Save first: a survivor is handed the loadout as it is in force, not the draft."]);
  // Two whose names differ by a capital are two options, each by its number.
  expect(survivorOptions([ada, { pid: 9, name: "ada", online: true }], "7")).toBe('<option value="9">ada (online)</option><option value="7" selected>Ada (away)</option>');
});

test("a fill goes to the loadout it was asked for, whatever is shown when it comes", () => {
  const d = draftOf(builtinLoadouts());
  const carried: ItemEntry[] = [{ item: "core:spear", count: 1, place: "hotbar" }];
  const stone = d.loadouts.find((l) => l.id === "stone")!.entries.length;
  // Asked for scout, and stone picked before the answer: scout is filled and stone is as it was.
  expect(fill(d, d, "scout", carried)).toBe("");
  expect([d.loadouts.find((l) => l.id === "scout")!.entries, d.loadouts.find((l) => l.id === "stone")!.entries.length]).toEqual([carried, stone]);
  // A loadout removed meanwhile, or a draft replaced, takes nothing.
  expect(removeLoadout(d, "hunter")).toBe("");
  expect(fill(d, d, "hunter", carried)).toBe("Nothing was filled: hunter was removed while the survivor was read.");
  const other = draftOf(builtinLoadouts());
  expect([fill(d, other, "scout", carried), other.loadouts.find((l) => l.id === "scout")!.entries.length]).toEqual(["Nothing was filled: the draft was replaced while the survivor was read.", 6]);
});

test("what an admin wrote is escaped wherever the page shows it", () => {
  const d = draftOf(builtinLoadouts());
  const sharp = '<img src=x onerror="alert(1)">';
  setLoadout(d, "naked", { label: sharp, note: sharp });
  replaceEntries(d, "naked", [{ item: sharp, count: 1, place: "bag", ammo: sharp }, { tame: sharp, level: 1, saddled: false, place: "bag" }]);
  const faults = draftFaults(d, known);
  const all = [listHtml(d, "naked", faults), loadoutHtml(d, 0, known, faults), assignOptions(d, "player"), barHtml(0, [`${sharp}: new`], [{ path: sharp, message: sharp }], -1), survivorOptions([{ pid: 7, name: sharp, online: true }, { pid: 9, name: "ada", online: false }], "9")];
  for (const html of all) expect([html.includes("<img"), html.includes('onerror="')]).toEqual([false, false]);
  expect(all[4]).toBe(`<option value="7">&#60;img src=x onerror=&#34;alert(1)&#34;&#62; (online)</option><option value="9" selected>ada (away)</option>`);
});
