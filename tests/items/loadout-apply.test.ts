// Loadouts handed out (server/loadout): what a new survivor is given and where it lies, when it comes again, that it is
// ordinary once given, and the console's `loadout` and `loadouts`. A tame in a ball: tests/creatures/loadout-tame.test.ts.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { builtinLoadouts } from "../../content/loadouts.ts";
import type { GameOptions } from "../../server/game.ts";
import type { HostOptions } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import type { EntityRecord } from "../../server/records.ts";
import { Rules } from "../../server/settings/rules.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import type { ItemEntry, Loadout, LoadoutBook, Place } from "../../shared/loadout/book.ts";
import { CHOOSE_ARRIVED, CHOOSE_TRAVEL, CMD_DROP, CMD_RESPAWN, RESULT_OK, SESSION_CREATING } from "../../shared/net/protocol.ts";
import { ARMOR_SLOTS, FLAG_BLUEPRINT, HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import { listener } from "../fixtures/module.ts";
import { Harness, asShipped, type JoinOptions } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { send } from "../kit/kit.ts";
import { adminLines } from "../fixtures/acts.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const dir = mkdtempSync(join(tmpdir(), "snark-loadout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const item = (name: string, count: number, place: Place, more: Partial<ItemEntry> = {}): ItemEntry => ({ item: `core:${name}`, count, place, ...more });
const loadout = (name: string, entries: Loadout["entries"], respawn = false): Loadout => ({ id: name, label: name, note: "", respawn, entries });
const named = (book: LoadoutBook, name: string): Loadout => book.loadouts.find((l) => l.id === name)!;

/** The book in force with `change` made to it, saved as its next revision. */
function edit(h: Harness, change: (book: LoadoutBook) => void): void {
  const store = h.host.loadoutBook;
  const next = JSON.parse(JSON.stringify(store.book)) as LoadoutBook;
  const revision = store.book.revision;
  change(next);
  expect(store.save(next, revision, "test", "")).toEqual({ ok: true, revision: revision + 1 });
}

/** A server whose book is the built-in one with `change` made, before anyone joins. Nobody has cheats unless `host` says. */
function server(change: (book: LoadoutBook) => void = () => {}, host: HostOptions = {}, game: Partial<GameOptions> = {}): Harness {
  const h = new Harness(game, 1, 60, host);
  edit(h, change);
  return h;
}

/** Joins a survivor, and waits for it to stand in the world. */
function enter(h: Harness, name: string, opts: JoinOptions = {}): { s: ClientSession; me: EntityRecord; inv: () => Inventory } {
  const s = h.join(name, {}, opts);
  h.run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  return { s, me, inv: () => h.host.items.inv(me) };
}

/** What `n` slots from `from` hold, by name, "" for an empty one. */
const names = (inv: Inventory, from: number, n: number): string[] => [...inv.item.slice(from, from + n)].map((k) => (k === 0 ? "" : reg.ids[k]!.slice(5)));
const hotbar = (inv: Inventory): string[] => names(inv, inv.hotbar, HOTBAR_SLOTS).filter((name) => name !== "");
const worn = (inv: Inventory): string[] => names(inv, inv.armor, ARMOR_SLOTS);
const STONE_KIT = ["hatchet", "pick", "spear"];
const CLOTH = ["cloth_hat", "cloth_shirt", "cloth_gloves", "cloth_pants", "cloth_boots"];
const caches = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === id("cache"));

/** Dies, and rises at the first place offered. */
function dieAndRise(h: Harness, s: ClientSession, me: EntityRecord): void {
  h.host.death.die(me, 1);
  h.run(300);
  expect(send(h, s, CMD_RESPAWN, (w) => (w.u8(0), w.u8(s.placesList)))).toBe(RESULT_OK);
  h.run(200);
}

test("a new survivor of a server as it comes has nothing", () => {
  const h = new Harness({}, 1, 60, { config: asShipped(new Rules()) });
  const { s, inv } = enter(h, "ada");
  expect([h.host.loadoutBook.builtin, h.host.loadoutBook.book.assign]).toEqual([true, { player: "naked", admin: "naked" }]);
  expect([s.admin, inv().used(), s.inventory!.item.some((k) => k !== 0), h.host.loadouts.firsts]).toEqual([true, 0, false, 0]);
  // Nothing was made for it either: no item, and no creature kept for it.
  expect([h.host.items.minted.some((n) => n !== 0), [...h.host.records.byPid.values()].filter((r) => r.stored !== 0).length]).toEqual([false, 0]);
  h.host.shutdown();
});

test("a new survivor is given its loadout: worn, in hotbar order, in the bag", () => {
  const h = server((book) => {
    book.loadouts.push(
      loadout("camp", [
        item("hatchet", 1, "hotbar"),
        item("stone", 40, "bag"),
        item("pick", 1, "hotbar", { quality: 2 }),
        item("cloth_hat", 1, "wear"),
        item("spear", 1, "hotbar"),
        item("cloth_shirt", 1, "wear"),
        // The head is taken, so this one lies in the bag.
        item("hide_hat", 1, "wear"),
        item("hatchet", 1, "bag", { blueprint: true, quality: 3 }),
      ]),
    );
    book.assign.player = "camp";
  });
  const { s, me, inv } = enter(h, "ada");
  const own = inv();
  expect([hotbar(own), worn(own)]).toEqual([STONE_KIT, ["cloth_hat", "cloth_shirt", "", "", ""]]);
  expect([own.total(id("stone")), own.total(id("hide_hat")), own.item.indexOf(id("hide_hat")) < own.bag]).toEqual([40, 1, true]);
  // The pick is of its quality and new; the blueprint is one, of its own quality, in the bag.
  const plan = own.blueprint(id("hatchet"), 3);
  expect([own.quality[own.hotbar + 1], own.dur[own.hotbar + 1], plan >= 0 && plan < own.bag, own.flags[plan]]).toEqual([2, h.host.items.maxDur(id("pick"), 2), true, FLAG_BLUEPRINT]);
  // Her client holds the same, and her body shows what she wears.
  expect([...s.inventory!.item.slice(own.hotbar, own.hotbar + 3), s.inventory!.item[own.armor]]).toEqual([...STONE_KIT.map(id), id("cloth_hat")]);
  expect([...h.world.ents.gears.get(h.ent(s))!].includes(id("cloth_hat"))).toBe(true);
  expect([me.xp, h.host.loadouts.firsts, h.host.items.audit()]).toEqual([0, 1, []]);
  h.host.shutdown();
});

test("a survivor that logs back in is given nothing again", () => {
  const h = server((book) => void (book.assign.player = "stone"), {}, { lingerTicks: 0 });
  const first = enter(h, "ada");
  expect(first.inv().used()).toBe(8);
  // She throws it all away and leaves.
  h.host.items.burnAll(first.me);
  first.s.close();
  h.run(300);
  expect(h.client(first.s)).toBeNull();
  const again = enter(h, "ada");
  expect([again.me.pid, again.inv().used(), h.host.loadouts.firsts, h.host.items.audit()]).toEqual([first.me.pid, 0, 1, []]);
  h.host.shutdown();
});

test("a survivor from the creator is given its loadout as it is made", () => {
  const h = server((book) => void (book.assign.player = "stone"));
  const ada = h.join("ada", {}, { look: null });
  h.run(500);
  expect([ada.sessionState, h.host.survivorRecord("ada"), h.host.loadouts.firsts]).toEqual([SESSION_CREATING, undefined, 0]);
  ada.create(defaultLook());
  h.run(500);
  const inv = h.host.items.inv(h.host.survivorRecord("ada")!);
  expect([hotbar(inv), worn(inv), h.host.loadouts.firsts, h.host.items.audit()]).toEqual([STONE_KIT, CLOTH, 1, []]);
  h.host.shutdown();
});

test("where everyone has cheats a new survivor takes the admins' loadout", () => {
  const admins = (book: LoadoutBook): void => void (book.assign.admin = "stone");
  // As a server comes, CreativeForAll gives everyone the role, though not before the first body is made.
  const open = server(admins, { config: asShipped(new Rules()) });
  const ada = enter(open, "ada");
  expect([ada.s.admin, hotbar(ada.inv()), worn(ada.inv())]).toEqual([true, STONE_KIT, CLOTH]);
  open.host.shutdown();
  // Where it does not, the same book gives a new survivor the players' loadout, which is nothing.
  const strict = server(admins);
  const bo = enter(strict, "bo");
  expect([bo.s.admin, bo.inv().used()]).toEqual([false, 0]);
  strict.host.shutdown();
});

test("a respawn loadout comes again after a death; a first-join one does not", () => {
  const h = server((book) => {
    book.assign.player = "stone";
    named(book, "stone").respawn = true;
  });
  const { s, me, inv } = enter(h, "ada");
  expect(inv().used()).toBe(8);
  dieAndRise(h, s, me);
  // What she died with lies in her cache, and she stands dressed again.
  expect([caches(h).map((c) => h.host.items.inv(c).used()), hotbar(inv()), worn(inv()), h.host.loadouts.rises]).toEqual([[8], STONE_KIT, CLOTH, 1]);
  expect([h.host.items.minted[id("hatchet")], s.inventory!.item[inv().hotbar]]).toEqual([2, id("hatchet")]);
  // Rising from bed travel or after coming from another server gives nothing, even to empty hands.
  h.host.items.burnAll(me);
  for (const why of [CHOOSE_TRAVEL, CHOOSE_ARRIVED]) h.host.loadouts.risen(h.client(s)!, me, why);
  expect([inv().used(), h.host.loadouts.rises]).toEqual([0, 1]);
  // The loadout made a first-join one, she rises with nothing.
  edit(h, (book) => void (named(book, "stone").respawn = false));
  dieAndRise(h, s, me);
  expect([inv().used(), h.host.loadouts.rises, h.host.items.minted[id("hatchet")], h.host.items.audit()]).toEqual([0, 1, 2, []]);
  h.host.shutdown();
});

test("the dead who kept their things are given nothing more", () => {
  const keeper = listener("keeper", ["death.cache"]);
  keeper.heard.each = (e) => e.refuse("the dead keep their things here");
  const h = server(
    (book) => {
      book.assign.player = "stone";
      named(book, "stone").respawn = true;
    },
    { modules: [keeper.def] },
  );
  const { s, me, inv } = enter(h, "ada");
  dieAndRise(h, s, me);
  expect([caches(h).length, inv().used(), hotbar(inv()), h.host.loadouts.rises, h.host.items.minted[id("hatchet")], h.host.items.audit()]).toEqual([0, 8, STONE_KIT, 0, 1, []]);
  h.host.shutdown();
});

test("loadout pieces are ordinary: dropped, stored, and left in the death cache", () => {
  const h = server((book) => void (book.assign.player = "stone"));
  const { s, me, inv } = enter(h, "ada");
  const items = h.host.items;
  const own = inv();
  expect([...own.flags].some((f) => f !== 0)).toBe(false);
  // The hatchet from her hand and the hat from her head are dropped as anything is.
  expect(send(h, s, CMD_DROP, (w) => (w.varint(own.hotbar), w.u16(0), w.u16(id("hatchet"))))).toBe(RESULT_OK);
  expect(send(h, s, CMD_DROP, (w) => (w.varint(own.armor), w.u16(0), w.u16(id("cloth_hat"))))).toBe(RESULT_OK);
  const dropped = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag"));
  expect(dropped.map((b) => items.inv(b).total(id("hatchet")) + items.inv(b).total(id("cloth_hat"))).reduce((a, b) => a + b, 0)).toBe(2);
  // The pick and the spear go into a box.
  const box = h.host.records.create(id("cache"), "box");
  expect([items.move(me, own.hotbar + 1, box, 0, 0), items.give(me, box, id("spear"), 1), items.inv(box).used()]).toEqual([1, true, 2]);
  // The rest lies in her cache when she dies, and she rises with nothing: the loadout is a first-join one.
  dieAndRise(h, s, me);
  const left = caches(h).filter((c) => c !== box).map((c) => worn(items.inv(c)).concat(names(items.inv(c), 0, 4)).filter((name) => name !== "").sort());
  expect([left, inv().used(), items.audit()]).toEqual([[["cloth_boots", "cloth_gloves", "cloth_pants", "cloth_shirt"]], 0, []]);
  h.host.shutdown();
});

test("a weapon comes loaded and fitted where its entry says", () => {
  const h = server((book) => void (book.assign.player = "rifleman"));
  const { s, inv } = enter(h, "ada");
  const own = inv();
  const items = h.host.items;
  const [rifle, round, scope] = [id("rifle"), id("round_rifle"), id("scope")];
  const clip = reg.weapon[rifle]!.clip;
  expect(clip).toBeGreaterThan(0);
  expect([own.item[own.hotbar], own.ammo[own.hotbar], own.loaded[own.hotbar], own.attach[own.hotbar]]).toEqual([rifle, round, clip, scope]);
  // The spare rounds are all there, and no scope lies loose: the one made is on the rifle.
  expect([own.total(round), own.total(id("dart_tranq")), own.total(scope), items.total(scope), items.minted[round], items.minted[scope]]).toEqual([30, 20, 0, 1, 30 + clip, 1]);
  expect([worn(own), own.used()]).toEqual([["flak_hat", "flak_shirt", "flak_gloves", "flak_pants", "flak_boots"], 8]);
  expect([s.inventory!.loaded[own.hotbar], s.inventory!.attach[own.hotbar], items.audit()]).toEqual([clip, scope, []]);
  h.host.shutdown();
});

test("what does not fit is left out and said, and the ledger balances", () => {
  const h = server();
  const { me, inv } = enter(h, "ada");
  const items = h.host.items;
  const give = (entries: Loadout["entries"]) => h.host.loadouts.give(me, loadout("odd", entries), { tames: true });
  // A dart is fired with nothing fitted, a pistol takes no rifle round, and the game has no such thing.
  const odd = give([item("rifle", 1, "hotbar", { ammo: "core:dart_tranq", attach: "core:scope" }), item("pistol", 1, "hotbar", { ammo: "core:round_rifle", attach: "core:nonesuch" }), item("nonesuch", 2, "bag")]);
  expect(odd).toEqual({ given: ["rifle", "pistol"], missed: ["scope on rifle", "round_rifle in pistol", "nonesuch on pistol", "2 nonesuch"] });
  const own = inv();
  expect([hotbar(own), own.ammo[own.hotbar], own.loaded[own.hotbar], own.attach[own.hotbar], own.loaded[own.hotbar + 1]]).toEqual([["rifle", "pistol"], id("dart_tranq"), 1, 0, 0]);
  expect([items.minted[id("scope")], items.minted[id("round_rifle")], own.used()]).toEqual([0, 0, 2]);
  // Eleven for a hotbar of ten, two places taken: the last three lie in the bag, and are given all the same.
  const many = give(Array.from({ length: 11 }, () => item("spear", 1, "hotbar")));
  expect([many.given.length, many.missed, hotbar(inv()).length, inv().total(id("spear"))]).toEqual([11, [], 10, 11]);

  // With one place left in the bag, the rounds take it and the darts find none. The rifle and the flak need no bag.
  items.burnAll(me);
  expect(items.mint(me, id("pistol"), inv().bag - 1)).toBe(inv().bag - 1);
  const full = give(named(builtinLoadouts(), "rifleman").entries);
  expect(full).toEqual({ given: ["rifle", "30 round_rifle", "flak_hat", "flak_shirt", "flak_gloves", "flak_pants", "flak_boots"], missed: ["20 dart_tranq"] });
  expect([inv().loaded[inv().hotbar], inv().attach[inv().hotbar], inv().total(id("round_rifle")), inv().free(), worn(inv())]).toEqual([1, id("scope"), 30, -1, ["flak_hat", "flak_shirt", "flak_gloves", "flak_pants", "flak_boots"]]);
  // A whole bag and hotbar leave nothing a place.
  items.burnAll(me);
  for (let s = inv().hotbar; s < inv().hotbar + HOTBAR_SLOTS; s++) expect([items.mint(me, id("pistol"), 1), items.move(me, 0, me, s, 0)]).toEqual([1, 1]);
  expect(items.mint(me, id("pistol"), inv().bag)).toBe(inv().bag);
  const none = give([item("stone", 5, "bag"), item("hatchet", 1, "hotbar", { ammo: "core:round_rifle" })]);
  expect(none).toEqual({ given: [], missed: ["5 stone", "hatchet"] });
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a full bag keeps nothing off an empty head, hand or weapon", () => {
  const h = server();
  const { me, inv } = enter(h, "ada");
  const items = h.host.items;
  const give = (entries: Loadout["entries"]) => h.host.loadouts.give(me, loadout("top-up", entries), { tames: true });
  expect(items.mint(me, id("pistol"), inv().bag)).toBe(inv().bag);
  const out = give([item("meridian_hat", 1, "wear"), item("hatchet", 1, "hotbar"), item("rifle", 1, "hotbar", { ammo: "core:round_rifle", attach: "core:scope" }), item("stone", 5, "bag")]);
  expect(out).toEqual({ given: ["meridian_hat", "hatchet", "rifle"], missed: ["5 stone"] });
  const own = inv();
  expect([worn(own)[0], hotbar(own), own.loaded[own.hotbar + 1], own.attach[own.hotbar + 1], own.total(id("pistol"))]).toEqual(["meridian_hat", ["hatchet", "rifle"], 1, id("scope"), own.bag]);
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a hotbar entry lies on the hotbar, not on a stack of its kind in the bag", () => {
  const h = server();
  const { me, inv } = enter(h, "ada");
  const items = h.host.items;
  expect(items.mint(me, id("wood"), 12)).toBe(12);
  const out = h.host.loadouts.give(me, loadout("top-up", [item("wood", 5, "hotbar"), item("wood", 3, "bag")]), {});
  const own = inv();
  expect([out, own.item[own.hotbar], own.count[own.hotbar], own.count[0], own.used()]).toEqual([{ given: ["5 wood", "3 wood"], missed: [] }, id("wood"), 5, 15, 2]);
  // More than one slot holds takes the next hotbar slots, and the bag when those are full.
  const stack = h.reg.stack[id("wood")]!;
  items.burnAll(me);
  const many = h.host.loadouts.give(me, loadout("top-up", [item("wood", stack * 11, "hotbar")]), {});
  expect([many.missed, hotbar(inv()).length, inv().total(id("wood")), inv().used()]).toEqual([[], HOTBAR_SLOTS, stack * 11, 11]);
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a module is asked of each loadout item with the reason loadout", () => {
  const ears = listener("ears", ["item.gain"]);
  const h = server((book) => void (book.assign.player = "rifleman"), { modules: [ears.def] });
  enter(h, "ada");
  const asked = (): [string, number, string][] => ears.heard.lines.splice(0).map((l) => JSON.parse(l.slice(l.indexOf("{"))) as { item: string; n: number; why: string }).map((d) => [d.item.slice(5), d.n, d.why]);
  // In the book's order, with the round in the rifle and its scope asked after it.
  expect(asked()).toEqual([
    ["rifle", 1, "loadout"],
    ["round_rifle", 1, "loadout"],
    ["scope", 1, "loadout"],
    ["round_rifle", 30, "loadout"],
    ["dart_tranq", 20, "loadout"],
    ...["hat", "shirt", "gloves", "pants", "boots"].map((piece): [string, number, string] => [`flak_${piece}`, 1, "loadout"]),
  ]);
  // What it refuses is left out: a piece, the scope of a rifle, and a tame's ball, whose tame is then not made.
  ears.heard.each = (e) => void (["core:flak_hat", "core:scope", "core:soul_ball_full"].includes(String(e.data.item)) && e.refuse("not here"));
  const bo = enter(h, "bo");
  expect([worn(bo.inv())[0], bo.inv().attach[bo.inv().hotbar], bo.inv().loaded[bo.inv().hotbar]]).toEqual(["", 0, 1]);
  const scout = h.host.loadouts.give(bo.me, named(builtinLoadouts(), "scout"), { clear: true, tames: true });
  expect([scout.missed, asked().some(([name, , why]) => name === "soul_ball_full" && why === "loadout")]).toEqual([["pteranodon 240"], true]);
  expect([[...h.host.records.byPid.values()].filter((r) => r.kind === id("pteranodon")).length, h.host.items.audit()]).toEqual([0, []]);
  h.host.shutdown();
});

test("the loadout command dresses its caller or another survivor, or clears first", () => {
  const h = server((book) => void (book.assign.admin = "hunter"), { dev: true });
  const ada = enter(h, "ada");
  const bo = enter(h, "bo peep");
  // Cheats turned on after joining give nothing by themselves; `loadout` alone hands over her role's.
  expect([h.say(ada.s, "enablecheats")[0]?.startsWith("cheats enabled"), ada.inv().used()]).toEqual([true, 0]);
  const said: string[] = [];
  const say = (line: string): string[] => {
    const out = h.say(ada.s, line);
    said.push(...out);
    return out;
  };
  expect(say("loadout")).toEqual(["hunter for ada: gave bow, 40 arrow_stone, 20 arrow_tranq, 20 arrow_flame, hide_hat, hide_shirt, hide_gloves, hide_pants, hide_boots"]);
  expect([hotbar(ada.inv()), worn(ada.inv())[0], ada.s.inventory!.item[ada.inv().armor]]).toEqual([["bow"], "hide_hat", id("hide_hat")]);
  // A named loadout, on top of what she has: the head is taken, so the cloth hat lies in the bag.
  expect(say("loadout stone")).toEqual(["stone for ada: gave hatchet, pick, spear, cloth_hat, cloth_shirt, cloth_gloves, cloth_pants, cloth_boots"]);
  expect([hotbar(ada.inv()), worn(ada.inv())[0], ada.inv().total(id("cloth_hat"))]).toEqual([["bow", ...STONE_KIT], "hide_hat", 1]);
  // Another survivor, by a name in quotes, and with what they held destroyed first.
  h.host.items.mint(bo.me, id("stone"), 7);
  expect(say('loadout stone "bo peep"')[0]).toStartWith("stone for bo peep: gave hatchet, pick, spear");
  expect([hotbar(bo.inv()), bo.inv().total(id("stone"))]).toEqual([STONE_KIT, 7]);
  expect(say('loadout rifleman "Bo Peep" -clear')[0]).toStartWith("rifleman for bo peep, cleared first: gave rifle, 30 round_rifle, 20 dart_tranq, flak_hat");
  expect([hotbar(bo.inv()), bo.inv().total(id("stone")), bo.inv().total(id("hatchet")), bo.inv().used()]).toEqual([["rifle"], 0, 0, 8]);
  expect(say("loadout -clear")).toEqual(["hunter for ada, cleared first: gave bow, 40 arrow_stone, 20 arrow_tranq, 20 arrow_flame, hide_hat, hide_shirt, hide_gloves, hide_pants, hide_boots"]);
  expect([hotbar(ada.inv()), ada.inv().used()]).toEqual([["bow"], 9]);
  // A full bag: what is left out is said, in a line a session is sent whole.
  h.host.items.burnAll(ada.me);
  h.host.items.mint(ada.me, id("pistol"), ada.inv().bag - 1);
  say("armor hide");
  expect(say("loadout rifleman")).toEqual(["rifleman for ada: gave rifle, 30 round_rifle; left out 20 dart_tranq, flak_hat, flak_shirt, flak_gloves, 2 more"]);
  expect(say("loadout naked ada -clear")).toEqual(["naked for ada, cleared first: nothing given"]);
  // Only the dashed word clears. A loadout called clear is handed out as any, and what she holds stays.
  edit(h, (book) => void book.loadouts.push(loadout("clear", [item("spear", 1, "hotbar")])));
  h.host.items.mint(ada.me, id("stone"), 10);
  expect(say("loadout clear")).toEqual(["clear for ada: gave spear"]);
  expect([hotbar(ada.inv()), ada.inv().total(id("stone"))]).toEqual([["spear"], 10]);
  expect([say("loadout clear -clear"), ada.inv().total(id("stone")), hotbar(ada.inv())]).toEqual([["clear for ada, cleared first: gave spear"], 0, ["spear"]]);
  // A survivor called clear is named as any, and by her number she alone is meant.
  const cl = enter(h, "clear");
  h.host.items.mint(cl.me, id("stone"), 4);
  expect([say("loadout stone clear")[0]!.startsWith("stone for clear: gave hatchet"), cl.inv().total(id("stone")), ada.inv().used()]).toEqual([true, 4, 1]);
  expect([say(`loadout naked #${cl.me.pid} -clear`), cl.inv().used(), ada.inv().used()]).toEqual([["naked for clear, cleared first: nothing given"], 0, 1]);
  h.host.items.burnAll(ada.me);
  // What it says when it cannot.
  expect([say("loadout nonesuch"), say("loadout stone cy"), say("loadout stone bo")]).toEqual([['no loadout "nonesuch"; "loadouts" lists them'], ['nobody called "cy" is here'], ['nobody called "bo" is here']]);
  h.host.death.die(bo.me, 1);
  h.run(300);
  expect(say('loadout stone "bo peep"')).toEqual(["bo peep has no body right now"]);
  // The operator, and so the admin page, names the survivor.
  expect(h.host.exec("loadout stone")).toBe("name a survivor; usage: loadout [id] [survivor | #number] [-clear]");
  said.push(h.host.exec("loadout scout ada -clear"));
  expect(said.at(-1)).toBe("scout for ada, cleared first: gave meridian_hat, meridian_shirt, meridian_gloves, meridian_pants, meridian_boots, pteranodon 240");
  expect(said.every((line) => new TextEncoder().encode(line).length < 200)).toBe(true);
  expect(say("loadouts")).toEqual(["naked: Naked (given to players)", "stone: Stone tools", "hunter: Hunter (given to admins)", "rifleman: Rifleman", "scout: Scout", "clear: clear"]);
  edit(h, (book) => void ((named(book, "scout").respawn = true), (book.assign.player = "scout"), (book.assign.admin = "scout")));
  expect(say("loadouts").at(-2)).toBe("scout: Scout, at each respawn (given to players and admins)");
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("loadout is refused without cheats, and an admin's is in the journal", () => {
  const db = join(dir, "journal.db");
  const h = server(() => {}, { dev: true, dbPath: db });
  const ada = enter(h, "ada");
  const bo = enter(h, "bo");
  h.say(ada.s, "enablecheats");
  expect([h.say(bo.s, "loadout stone"), h.say(bo.s, "loadouts"), bo.inv().used()]).toEqual([["denied: cheats are not enabled for you"], ["denied: cheats are not enabled for you"], 0]);
  expect(h.say(ada.s, "loadout stone bo -clear")[0]).toStartWith("stone for bo, cleared first: gave hatchet");
  expect(h.host.exec('loadout hunter "ada"')).toStartWith("hunter for ada: gave bow");
  h.run(200);
  h.host.shutdown();
  const store = new WorldStore(db, h.reg);
  const lines = adminLines(store);
  store.close();
  expect(lines).toEqual(["ada\tloadout stone bo -clear", '(operator)\tloadout hunter "ada"']);
});

test("every built-in loadout applies whole to a bare survivor (nothing missed)", () => {
  const h = server();
  const { me, inv } = enter(h, "ada");
  for (const l of builtinLoadouts().loadouts) {
    const out = h.host.loadouts.give(me, l, { clear: true, tames: true });
    expect([l.id, out.missed, out.given.length]).toEqual([l.id, [], l.entries.length]);
    // Each worn entry is on, and each hotbar entry is in hand's reach.
    const wears = l.entries.filter((e) => e.place === "wear").length;
    const hands = l.entries.filter((e) => e.place === "hotbar").length;
    expect([l.id, worn(inv()).filter((name) => name !== "").length, hotbar(inv()).length]).toEqual([l.id, wears, hands]);
  }
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});
