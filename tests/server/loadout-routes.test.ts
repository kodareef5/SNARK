// The loadouts' admin page's requests against a running world (server/admin/loadout-routes.ts): the book is read, saved
// with its revision and reset, and what a survivor wears and carries is read as entries (server/loadout/capture.ts).

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { LoadoutRoutes, applyLine } from "../../server/admin/loadout-routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { PAGE } from "../../server/admin/supply-routes.ts";
import { Guesses } from "../../server/guesses.ts";
import { captureLoadout } from "../../server/loadout/capture.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { builtinLoadouts } from "../../content/loadouts.ts";
import { loadoutFaults, type Entry, type LoadoutBook, type LoadoutFault } from "../../shared/loadout/book.ts";
import type { LoadoutCatalog } from "../../shared/loadout/catalog.ts";
import { QUALITY_NAMES } from "../../shared/sim/items.ts";
import { Harness } from "../fixtures/net.ts";
import { adminLines } from "../fixtures/acts.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-loadout-routes-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const AT = "http://localhost";
interface BookWire { revision: number; builtin: boolean; kept: boolean; book: LoadoutBook; warnings: LoadoutFault[] }

function world(host: ConstructorParameters<typeof Harness>[3] = {}, game: ConstructorParameters<typeof Harness>[0] = {}) {
  const h = new Harness(game, 1, 30, { dev: true, log: () => {}, ...host });
  const routes = new LoadoutRoutes(h.host);
  const ask = (what: string, init?: RequestInit) => routes.answer(new Request(`${AT}/admin/loadouts/${what}`, init), `/admin/loadouts/${what.split("?")[0]}`, new URL(`${AT}/admin/loadouts/${what}`))!;
  const get = async <T>(what: string): Promise<{ status: number; answer: T }> => {
    const r = await ask(what);
    return { status: r.status, answer: (await r.json()) as T };
  };
  const post = async (what: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; answer: Record<string, unknown> }> => {
    const r = await ask(what, { method: "POST", headers: { "content-type": "application/json", origin: AT, host: "localhost", ...headers }, body: JSON.stringify(body) });
    return { status: r.status, answer: (await r.json()) as Record<string, unknown> };
  };
  return { h, get, post };
}

/** A survivor with cheats, who gives itself things at the console. */
function geared(h: Harness, name: string, lines: readonly string[]) {
  const s = h.join(name);
  h.run(500);
  h.say(s, "enablecheats");
  for (const line of lines) h.say(s, line);
  return h.host.survivorRecord(name)!;
}

test("the page reads the book, its revision, and a catalogue with species", async () => {
  const { h, get } = world();
  const read = (await get<BookWire>("book.json")).answer;
  expect([read.revision, read.builtin, read.kept, read.warnings, read.book]).toEqual([0, true, false, [], builtinLoadouts()]);
  const c = (await get<LoadoutCatalog>("catalog.json")).answer;
  const item = (id: string) => c.items.find((i) => i.id === id)!;
  expect(c.quality).toEqual([...QUALITY_NAMES]);
  expect([item("core:flak_shirt").wear, item("core:rifle").wear, item("core:rifle").ammo.includes("core:round_rifle"), item("core:rifle").fits.includes("core:scope")]).toEqual([true, false, true, true]);
  expect([item("core:hatchet").quality, item("core:hatchet").blueprint, item("core:wood").quality, item("core:hatchet").label.length > 0]).toEqual([true, true, false, true]);
  // A full soul ball stands for a record, so the page is not offered it; the empty one is an item like any other.
  expect([c.items.some((i) => i.id === "core:soul_ball"), c.items.some((i) => h.reg.ballEmpty[i.index] !== 0)]).toEqual([true, false]);
  const ptera = c.species.find((s) => s.id === "core:pteranodon")!;
  expect([ptera.saddle, ptera.label.length > 0, c.species.some((s) => s.id === "core:survivor"), c.species.some((s) => !s.saddle)]).toEqual([true, true, false, true]);
  expect((await get<{ error: string }>("nothing.json")).status).toBe(404);
  h.host.shutdown();
});

test("a saved book is in force, is kept beside the save and is in the journal", async () => {
  const dbPath = join(dir, "saved.db");
  const { h, get, post } = world({ dbPath });
  const read = (await get<BookWire>("book.json")).answer;
  expect(read.kept).toBe(true);
  const draft = structuredClone(read.book);
  draft.assign.admin = "scout";
  draft.loadouts[1]!.respawn = true;
  const saved = await post("book", { book: draft, expected: read.revision, note: "admins start\nas scouts" });
  expect([saved.status, saved.answer]).toEqual([200, { revision: 1, warnings: [] }]);
  expect([h.host.loadoutBook.book.revision, h.host.loadoutBook.builtin, h.host.loadoutBook.assigned(true)?.id, h.host.loadoutBook.find("stone")?.respawn]).toEqual([1, false, "scout", true]);
  expect((JSON.parse(readFileSync(`${dbPath}.loadouts.json`, "utf8")) as LoadoutBook).assign).toEqual({ player: "naked", admin: "scout" });
  // A book that names what the game lacks is saved, and the answer says so.
  const odd = structuredClone(h.host.loadoutBook.book);
  odd.loadouts[1]!.entries.push({ item: "mod:laser_sword", count: 1, place: "hotbar" });
  const warned = await post("book", { book: odd, expected: 1, note: "" });
  expect([warned.status, warned.answer.revision, (warned.answer.warnings as LoadoutFault[]).map((f) => [f.path, f.warn])]).toEqual([200, 2, [["loadouts[1].entries[8].item", true]]]);
  h.run(60);
  h.host.shutdown();
  const store = new WorldStore(dbPath, h.reg);
  const typed = adminLines(store);
  store.close();
  expect(typed).toEqual([`${PAGE}\tloadouts saved (admins start as scouts): revision 1`, `${PAGE}\tloadouts saved: revision 2`]);
});

test("a stale save is 409, a faulty one 422 with its paths, and another site's 403", async () => {
  const { h, get, post } = world();
  const read = (await get<BookWire>("book.json")).answer;
  const draft = structuredClone(read.book);
  draft.loadouts[0]!.label = "Bare";
  expect((await post("book", { book: draft, expected: 0, note: "" })).status).toBe(200);
  // The second editor read revision 0 too: its save changes nothing and is told the revision in force.
  const second = structuredClone(read.book);
  second.loadouts[0]!.label = "Nothing";
  const stale = await post("book", { book: second, expected: 0, note: "" });
  expect([stale.status, stale.answer.revision, h.host.loadoutBook.book.loadouts[0]!.label]).toEqual([409, 1, "Bare"]);
  const broken = structuredClone(draft);
  broken.assign.player = "gone";
  broken.loadouts[1]!.entries[0] = { item: "core:hatchet", count: 0, place: "wear" };
  broken.loadouts[4]!.entries.push({ tame: "core:pteranodon", level: 0, saddled: true, place: "bag" });
  const refused = await post("book", { book: broken, expected: 1, note: "" });
  expect([refused.status, (refused.answer.faults as LoadoutFault[]).map((f) => f.path).sort(), h.host.loadoutBook.book.revision]).toEqual([422, ["assign.player", "loadouts[1].entries[0].count", "loadouts[1].entries[0].place", "loadouts[4].entries[6].level"], 1]);
  // A page of another site cannot make a signed-in browser change the book; a request that is not from a page may.
  const elsewhere = await post("book", { book: draft, expected: 1, note: "" }, { origin: "https://elsewhere.example" });
  expect([elsewhere.status, (await post("reset", {}, { origin: "https://elsewhere.example" })).status, (await post("apply", { loadout: "stone", pid: 1 }, { origin: "https://elsewhere.example" })).status, h.host.loadoutBook.book.revision]).toEqual([403, 403, 403, 1]);
  expect([(await post("book", { book: draft }, {})).status, (await post("book", { expected: 1 })).status, (await post("book", { book: draft, expected: 1 }, { "content-type": "text/plain" })).status, (await post("nothing", {})).status]).toEqual([400, 400, 400, 404]);
  h.host.shutdown();
});

test("reset puts the built-ins back as the next revision", async () => {
  const { h, post } = world();
  const draft = builtinLoadouts();
  draft.loadouts = draft.loadouts.filter((l) => l.id !== "hunter");
  draft.assign.player = "stone";
  expect((await post("book", { book: draft, expected: 0, note: "" })).answer.revision).toBe(1);
  // A page that read an older revision is told, and nothing is reset.
  expect([(await post("reset", { expected: 0 })).status, h.host.loadoutBook.book.loadouts.length]).toEqual([409, 4]);
  const reset = await post("reset", { expected: 1 });
  expect([reset.status, reset.answer.revision, h.host.loadoutBook.book]).toEqual([200, 2, { ...builtinLoadouts(), revision: 2 }]);
  h.host.shutdown();
});

test("capture reads what a survivor wears and carries, blueprint and loaded gun too", async () => {
  const { h, get } = world();
  const ada = geared(h, "Ada", ["armor hide", "kit rifle", "give hatchet 1 journeyman", "give core:spear 1 apprentice bp", "give wood 250"]);
  const { items } = h.host;
  const reg = h.host.world.reg;
  const inv = items.inv(ada);
  const slotOf = (id: string): number => inv.item.indexOf(reg.index.get(id)!);
  // The rifle goes to the first hotbar slot, loaded and scoped, and the hatchet to the third.
  expect(items.move(ada, slotOf("core:rifle"), ada, inv.hotbar, 1)).toBe(1);
  expect(items.load(ada, inv.hotbar, reg.index.get("core:round_rifle")!, 1)).toBe(1);
  expect(items.attach(ada, inv.hotbar, slotOf("core:scope"))).toBe(true);
  expect(items.move(ada, slotOf("core:hatchet"), ada, inv.hotbar + 2, 1)).toBe(1);

  const got = await get<{ survivor: string; entries: Entry[]; cut: number }>("capture.json?survivor=ada");
  expect([got.status, got.answer.survivor, got.answer.cut]).toEqual([200, "Ada", 0]);
  const worn: Entry[] = ["hat", "shirt", "gloves", "pants", "boots"].map((p) => ({ item: `core:hide_${p}`, count: 1, place: "wear" }));
  expect(got.answer.entries).toEqual([
    ...worn,
    { item: "core:rifle", count: 1, place: "hotbar", ammo: "core:round_rifle", attach: "core:scope" },
    { item: "core:hatchet", count: 1, place: "hotbar", quality: 3 },
    { item: "core:round_rifle", count: 29, place: "bag" },
    { item: "core:dart_tranq", count: 20, place: "bag" },
    { item: "core:spear", count: 1, place: "bag", quality: 2, blueprint: true },
    { item: "core:wood", count: 250, place: "bag" },
  ]);
  // What was read is a loadout the book takes as it is, and reading it saved nothing.
  const book = builtinLoadouts();
  book.loadouts[0]!.entries = captureLoadout(h.host, ada);
  expect([loadoutFaults(book, reg), h.host.loadoutBook.book.revision]).toEqual([[], 0]);
  // By its number too, as the page asks.
  const numbered = await get<{ survivor: string; entries: Entry[] }>(`capture.json?pid=${ada.pid}`);
  expect([numbered.status, numbered.answer.survivor, numbered.answer.entries]).toEqual([200, "Ada", got.answer.entries]);
  expect((await get<{ error: string }>("capture.json?pid=999999")).answer.error).toBe("No survivor has the number 999999.");
  expect([(await get<{ error: string }>("capture.json?survivor=Grace")).status, (await get<{ error: string }>("capture.json?survivor=Grace")).answer.error, (await get("capture.json")).status]).toEqual([404, "No survivor is called Grace.", 404]);
  h.host.shutdown();
});

test("capture reads a full soul ball as the tame it keeps, with its level and saddle", async () => {
  const { h, get } = world();
  const ada = geared(h, "ada", ["give soul_ball 2", "gmsummon pteranodon 30"]);
  const { items, records, world: w } = h.host;
  const reg = w.reg;
  const inv = items.inv(ada);
  const ball = inv.item.indexOf(reg.index.get("core:soul_ball")!);
  let body = -1;
  for (const [pid, e] of records.entOf) if (records.byPid.get(pid)?.kind === reg.index.get("core:pteranodon")) body = e;
  const tame = records.byPid.get(w.ents.pid[body]!)!;
  expect([h.host.balls.keepIn(ada, ball, body), tame.stored > 0, tame.saddle !== 0]).toEqual(["", true, true]);
  expect(items.move(ada, ball, ada, inv.hotbar + 4, 1)).toBe(1);
  // The empty ball is an item; the full one is its tame, and names no item the book would refuse.
  const entries = (await get<{ entries: Entry[] }>("capture.json?survivor=ada")).answer.entries;
  expect(entries).toEqual([{ tame: "core:pteranodon", level: tame.genome!.level, saddled: true, place: "hotbar" }, { item: "core:soul_ball", count: 1, place: "bag" }]);
  const book = builtinLoadouts();
  book.loadouts[0]!.entries = entries;
  expect(loadoutFaults(book, reg)).toEqual([]);
  h.host.shutdown();
});

test("apply writes one console line, and refuses an id or a number no line can carry", async () => {
  expect([applyLine("scout", 12, false), applyLine("stone-2", 7, true)]).toEqual(["loadout scout #12", "loadout stone-2 #7 -clear"]);
  for (const [id, pid] of [["Scout", 7], ["scout clear", 7], ["-clear", 7], ["", 7], ["scout", "7"], ["scout", 0], ["scout", -3], ["scout", 1.5], ["scout", "ada"], [undefined, 7]] as const) expect([id, pid, applyLine(id, pid, false)]).toEqual([id, pid, null]);
  const { h, post } = world();
  for (const body of [{ loadout: "scout", survivor: "ada" }, { loadout: "no such", pid: 7 }, { loadout: "scout" }]) expect((await post("apply", body)).status).toBe(400);
  expect((await post("apply", { loadout: "scout", pid: 999999 })).status).toBe(404);
  h.host.shutdown();
});

test("apply dresses an online survivor through the console's own command", async () => {
  const { h, post } = world();
  h.join("Ada Lovelace");
  h.run(500);
  const rec = h.host.survivorRecord("Ada Lovelace")!;
  const worn = (): number => {
    const inv = h.host.items.inv(rec);
    return [...inv.item.slice(inv.armor, inv.armor + 5)].filter((k) => k !== 0).length;
  };
  expect(worn()).toBe(0);
  const done = await post("apply", { loadout: "stone", pid: rec.pid });
  expect([done.status, done.answer.line, done.answer.survivor, worn()]).toEqual([200, `loadout stone #${rec.pid}`, "Ada Lovelace", 5]);
  expect(String(done.answer.said)).toStartWith("stone for Ada Lovelace: gave");
  const cleared = await post("apply", { loadout: "naked", pid: rec.pid, clear: true });
  expect([cleared.status, cleared.answer.line, h.host.items.inv(rec).used()]).toEqual([200, `loadout naked #${rec.pid} -clear`, 0]);
  h.host.shutdown();
});

test("apply reaches only the survivor picked, never one whose name is like it", async () => {
  const { h, post } = world({}, { lingerTicks: 0 });
  const away = h.join("Ada");
  h.run(500);
  const Ada = h.host.survivorRecord("Ada")!;
  away.close();
  h.run(300);
  expect(h.host.online(Ada.pid)).toBe(false);
  h.join("ada");
  h.run(500);
  const ada = h.host.survivorRecord("ada")!;
  h.host.items.mint(ada, h.host.world.reg.index.get("core:stone")!, 10);
  expect(Ada.pid).not.toBe(ada.pid);
  // Ada is away: she is handed nothing, and ada, who is here, is neither dressed nor cleared in her place.
  for (const clear of [false, true]) {
    const refused = await post("apply", { loadout: "stone", pid: Ada.pid, clear });
    expect([refused.status, refused.answer.error]).toEqual([409, "Ada is not in the world. A loadout is handed to a survivor who is."]);
  }
  expect([h.host.items.inv(Ada).used(), h.host.items.inv(ada).used()]).toEqual([0, 1]);
  expect(h.host.exec(`loadout stone #${Ada.pid}`)).toBe("Ada is not in the world");
  expect([h.host.exec("loadout stone #999999"), h.host.items.inv(ada).used()]).toEqual(["no survivor has the number 999999", 1]);
  // By its number, ada is the one dressed.
  expect((await post("apply", { loadout: "stone", pid: ada.pid })).answer.survivor).toBe("ada");
  expect(h.host.items.inv(ada).used()).toBe(9);
  h.host.shutdown();
});

test("a saved book dresses the next new survivor", async () => {
  const { h, get, post } = world();
  const book = (await get<BookWire>("book.json")).answer.book;
  book.assign.admin = "stone";
  book.assign.player = "stone";
  expect((await post("book", { book, expected: 0, note: "stone for all" })).status).toBe(200);
  h.join("ada");
  h.run(500);
  const inv = h.host.items.inv(h.host.survivorRecord("ada")!);
  expect([...inv.item.slice(inv.armor, inv.armor + 5)].every((k) => k !== 0)).toBe(true);
  h.host.shutdown();
});

test("the admin pages serve the loadouts page and its routes past their gate", async () => {
  const h = new Harness({}, 1, 30, { log: () => {} });
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
  const gate = { dev: false, password: "hunter2", guesses: new Guesses(), tick: () => h.host.world.tick };
  const ask = async (path: string, init: RequestInit = {}, password = "hunter2") => {
    const req = new Request(`${AT}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Basic ${btoa(`admin:${password}`)}` } });
    return (await pages.answer(req, "1.2.3.4", gate, new URL(req.url).pathname))!;
  };
  expect([(await ask("/admin/loadouts/book.json", {}, "wrong")).status, (await ask("/admin/loadouts/book.json")).status, ((await (await ask("/admin/Loadouts/book.json")).json()) as BookWire).revision]).toEqual([401, 200, 0]);
  const draft = builtinLoadouts();
  draft.assign.player = "stone";
  const saved = await ask("/admin/loadouts/book", { method: "POST", headers: { "content-type": "application/json", origin: AT, host: "localhost" }, body: JSON.stringify({ book: draft, expected: 0, note: "" }) });
  expect([saved.status, h.host.loadoutBook.assigned(false)?.id]).toEqual([200, "stone"]);
  // The page's own files are the build's: here there is none yet.
  expect([existsSync(join(dir, "loadouts.html")), (await ask("/admin/loadouts.html")).status, await (await ask("/admin/loadouts.html")).text()]).toEqual([false, 404, "build the client first"]);
  h.host.shutdown();
});
