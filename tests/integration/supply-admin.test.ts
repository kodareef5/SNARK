// The drop book's admin page's requests against a running world (server/admin/supply-routes.ts): a table changed
// through them drops differently in the world, drops already called included, and each act is in the page's log. The statuses through the front are held by tests/integration/site.test.ts.

import { expect, test } from "bun:test";
import { PAGE, SupplyRoutes } from "../../server/admin/supply-routes.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { SupplyBook } from "../../shared/supply/book.ts";
import { moveSite } from "../../client/core/drops/place.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const CAPSULE = reg.index.get("core:supply_capsule")!;

function world() {
  const h = new Harness({}, 1, 30, { dev: true });
  h.run(200);
  const routes = new SupplyRoutes(h.host, () => 1_800_000_000_000);
  const at = "http://localhost";
  const get = async <T>(what: string): Promise<T> => (await (await routes.answer(new Request(`${at}/admin/supply/${what}`), `/admin/supply/${what.split("?")[0]}`, new URL(`${at}/admin/supply/${what}`))!).json()) as T;
  const post = async (what: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> }> => {
    const r = await routes.answer(new Request(`${at}/admin/supply/${what}`, { method: "POST", headers: { "content-type": "application/json", origin: at, host: "localhost" }, body: JSON.stringify(body) }), `/admin/supply/${what}`, new URL(`${at}/admin/supply/${what}`))!;
    return { status: r.status, answer: (await r.json()) as Record<string, unknown> };
  };
  /** What a landed drop's capsule holds, by id. */
  const held = (pid: number): Record<string, number> => {
    const box = h.host.records.byPid.get(pid) as EntityRecord;
    const out: Record<string, number> = {};
    for (let s = 0; s < box.inv!.cap; s++) if (box.inv!.item[s] !== 0) out[reg.ids[box.inv!.item[s]!]!] = (out[reg.ids[box.inv!.item[s]!]!] ?? 0) + box.inv!.count[s]!;
    return out;
  };
  const mid = [h.host.world.hf.sizeX / 2, h.host.world.hf.sizeZ / 2] as const;
  return { h, routes, get, post, held, mid };
}

test("a table changed on the page drops differently in the world: the next drop of it holds what the saved book says", async () => {
  const { h, get, post, held, mid } = world();
  const read = await get<{ revision: number; book: SupplyBook }>("book.json");
  // White Arms, as the page would send it: one slot, a kit of exactly seven pikes and three metal arrows.
  const draft = structuredClone(read.book);
  draft.sets["kit.arms.white"] = { name: "seven pikes", all: true, entries: [{ items: ["core:pike"], min: 7, max: 7 }, { items: ["core:arrow_metal"], min: 3, max: 3 }] };
  draft.tables["white/arms"]!.slots = [{ name: "kit", from: [{ set: "kit.arms.white" }] }];
  // A drop called before the save: it keeps its tier's level and colour and its times, and holds what the book says as it lands.
  const before = await post("call", { x: mid[0] - 80, z: mid[1], tier: "white", cls: "arms", seconds: 0 });
  expect(before.status).toBe(200);
  const saved = await post("book", { revision: read.revision, book: draft, note: "white arms is seven pikes" });
  expect([saved.status, saved.answer, h.host.supplyBook.revisions().map((r) => [r.revision, r.by, r.note])]).toEqual([200, { revision: 1 }, [[1, PAGE, "white arms is seven pikes"]]]);
  const after = await post("call", { x: mid[0] + 80, z: mid[1], tier: "white", cls: "arms", seconds: 0 });
  expect(after.status).toBe(200);
  // Both brought down at once, as the page's Land does.
  expect(((await post("land", { id: "all", seconds: 0 })).answer.said as string).split("\n").length).toBe(2);
  h.run(1000);
  const [old, fresh] = [h.host.supply.get(before.answer.id as number)!, h.host.supply.get(after.answer.id as number)!];
  expect([old.landed, fresh.landed, h.host.records.byPid.get(fresh.pid)?.kind]).toEqual([true, true, CAPSULE]);
  // The new drop is the saved table to the piece. So is the one called before the save: a drop's loot is rolled as it
  // lands, from the book then in force, so a table put right reaches the drops already on their way.
  expect([held(fresh.pid), held(old.pid)]).toEqual([{ "core:pike": 7, "core:arrow_metal": 3 }, { "core:pike": 7, "core:arrow_metal": 3 }]);
  // The page's log has each act, as the console line it was or as the save it was.
  const live = await get<{ revision: number; drops: { id: number; state: string }[]; acts: { what: string }[] }>("live.json");
  expect([live.revision, live.drops.map((d) => d.state), live.acts.map((a) => a.what.split(":")[0])]).toEqual([1, ["landed", "landed"], [`supply call ${mid[0] - 80} ${mid[1]} white arms plain 0`, "supply book saved (white arms is seven pikes)", `supply call ${mid[0] + 80} ${mid[1]} white arms plain 0`, "supply land all 0"]]);
  // Put back by the starter, the table is the starter's again for the next drop.
  expect((await post("reset", { revision: 1 })).answer).toEqual({ revision: 2 });
  const again = await post("call", { x: mid[0], z: mid[1] + 80, tier: "white", cls: "arms", seconds: 0 });
  await post("land", { id: again.answer.id, seconds: 0 });
  h.run(1000);
  expect(held(h.host.supply.get(again.answer.id as number)!.pid)["core:pike"]).toBeUndefined();
});

test("a draft that names what the game lacks is saved and forgiven; one with a fault is refused with its path and changes nothing", async () => {
  const { h, get, post, held, mid } = world();
  const read = await get<{ revision: number; book: SupplyBook }>("book.json");
  const draft = structuredClone(read.book);
  draft.sets["kit.arms.white"]!.entries.push({ items: ["mod:laser_sword"], min: 1, max: 1 });
  expect((await post("book", { revision: 0, book: draft })).answer).toEqual({ revision: 1 });
  const called = await post("call", { x: mid[0], z: mid[1], tier: "white", cls: "arms", seconds: 0 });
  await post("land", { id: called.answer.id, seconds: 0 });
  h.run(1000);
  const got = held(h.host.supply.get(called.answer.id as number)!.pid);
  expect([Object.keys(got).length > 2, "mod:laser_sword" in got]).toEqual([true, false]);
  // A set that draws more lines than it has is a fault of the book: 422, its path, and the book in force is still 1.
  const broken = structuredClone(draft);
  broken.tables["white/arms"]!.slots[0]!.from = [{ set: "no.such.set" }];
  const refused = await post("book", { revision: 1, book: broken });
  expect([refused.status, (refused.answer.faults as { path: string }[]).map((f) => f.path), h.host.supplyBook.book.revision]).toEqual([422, ["tables.white/arms.slots.0.from.0.set"], 1]);
  // One revision of the two is read back whole; one never kept is not found.
  const one = await get<{ revision: number; book: SupplyBook }>("revision.json?n=1");
  expect([one.revision, one.book.sets["kit.arms.white"]!.entries.at(-1)!.items]).toEqual([1, ["mod:laser_sword"]]);
  expect((await get<{ error: string }>("revision.json?n=9")).error).toBe("Revision 9 is not kept.");
});

test("a site moved on the map takes the next drop: the circuit's drops land where the saved book has its site", async () => {
  // Level ground 512 m on a side, Ada in its middle, and a book with one circuit of one site that looks every few seconds.
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(8)), log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "tp 250 250");
  h.run(300);
  const routes = new SupplyRoutes(h.host);
  const at = "http://localhost";
  const get = async <T>(what: string): Promise<T> => (await (await routes.answer(new Request(`${at}/admin/supply/${what}`), `/admin/supply/${what}`, new URL(`${at}/admin/supply/${what}`))!).json()) as T;
  const post = async (what: string, body: unknown): Promise<Record<string, unknown>> =>
    (await (await routes.answer(new Request(`${at}/admin/supply/${what}`, { method: "POST", headers: { "content-type": "application/json", origin: at, host: "localhost" }, body: JSON.stringify(body) }), `/admin/supply/${what}`, new URL(`${at}/admin/supply/${what}`))!).json()) as Record<string, unknown>;
  const read = await get<{ revision: number; book: SupplyBook }>("book.json");
  const draft = structuredClone(read.book);
  Object.assign(draft.rules, { noticeSeconds: 12, flightSeconds: 5, brakeSeconds: 2, lifeSeconds: 30 });
  draft.sites = [{ key: "c/001", x: 200, z: 220 }];
  draft.circuits = [{ key: "c", on: true, sites: ["c/001"], maxLive: 1, firstDelay: [1, 2], interval: [2, 3], tierWeights: { white: 1 } }];
  expect(await post("book", { revision: read.revision, book: draft, note: "one site" })).toEqual({ revision: 1 });
  expect(h.host.setSetting("bDisableLootCrates", "False")).toBe("");
  h.run(6000);
  const first = h.host.supply.drops[0]!;
  expect([h.host.supply.drops.length, first.x, first.z, first.site, first.circuit]).toEqual([1, 200, 220, "c/001", "c"]);
  // The page moves the site (as a drag on its map does to the draft) and saves; the drop in the air keeps its place.
  const moved = structuredClone(h.host.supplyBook.book);
  moveSite(moved, "c/001", 300.4, 310.6);
  expect(await post("book", { revision: 1, book: moved, note: "moved" })).toEqual({ revision: 2 });
  expect([first.x, first.z]).toEqual([200, 220]);
  // Its capsule lands, lasts its half minute and goes; the circuit's next drop is at the site's new place.
  h.run(60000);
  const next = h.host.supply.drops.find((d) => d.id !== first.id)!;
  expect([next.x, next.z, next.site, next.id > first.id]).toEqual([300, 311, "c/001", true]);
  // The page's live view has the circuit's count and the drop where it is.
  const live = await get<{ drops: { id: number; x: number; z: number }[]; circuits: { key: string; on: boolean; called: number }[] }>("live.json");
  expect([live.circuits.map((c) => [c.key, c.on, c.called >= 2]), live.drops.some((d) => d.id === next.id && d.x === 300 && d.z === 311)]).toEqual([[["c", true, true]], true]);
  // The server's own proposal for this ground: a place to each square a drop may land in, in bands, and nothing saved.
  const found = await get<{ sites: { key: string; x: number; z: number }[]; circuits: { key: string; sites: string[] }[] }>("found.json");
  expect([found.sites.length > 0, found.circuits.every((c) => c.sites.length > 0), found.sites.every((s) => s.x >= 0 && s.x <= 512 && s.z >= 0 && s.z <= 512), h.host.supplyBook.book.revision]).toEqual([true, true, true, 2]);
});

test("an ARK override pasted is read as the server reads its own, mapped to the book's tiers, and put in the book it drops", async () => {
  const { h, get, post, held, mid } = world();
  const read = await get<{ revision: number; book: SupplyBook }>("book.json");
  // Three crates as a Game.ini has them: blue's (ARK's level 25) with a thing this build lacks, blue's ringed one, a
  // cave's, which is no drop here; and a line that is no setting at all.
  const text = [
    "[/script/shootergame.shootergamemode]",
    'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level25_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=2,MaxNumItems=2,bItemsRandomWithoutReplacement=true,ItemEntries=((EntryWeight=1,ItemClassStrings=("core:crossbow"),MinQuantity=1,MaxQuantity=1,MinQuality=2,MaxQuality=2),(ItemClassStrings=("core:arrow_stone"),MinQuantity=40,MaxQuantity=40),(ItemClassStrings=("PrimalItem_WeaponTekRifle_C"),MinQuantity=1,MaxQuantity=1)))))',
    '(SupplyCrateClassString="SupplyCrate_Level25_Double_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=77,MaxQuantity=77)))))',
    'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="ArtifactCrate_1_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=1,MaxQuantity=1)))))',
    "this is not a line of an ini",
  ].join("\n");
  const got = (await post("ark", { text })).answer as unknown as { crates: number; sets: SupplyBook["sets"]; tables: SupplyBook["tables"]; tiers: { tier: string; plain: number; ringed: number }[]; said: string[]; missing: string[] };
  expect([got.crates, got.tiers, got.missing]).toEqual([3, [{ tier: "blue", plain: 1, ringed: 1 }], ["PrimalItem_WeaponTekRifle_C"]]);
  expect(got.said.map((s) => s.slice(0, 60))).toEqual([
    "line 5: not a Key=Value line",
    'ConfigOverrideSupplyCrateItems: 1 of the things "SupplyCrate',
    'ConfigOverrideSupplyCrateItems: "ArtifactCrate_1_C" is no su',
  ]);
  // Its documents: a set for each of ARK's, and for every class of blue one table of two slots, plain's and ringed's.
  expect([Object.keys(got.sets), Object.keys(got.tables).length, got.tables["blue/arms"]!.slots.map((s) => [s.name, s.chance ?? 1, s.ringed ?? s.chance ?? 1, s.from.map((f) => f.set)])]).toEqual([
    ["ark.blue.plain.1", "ark.blue.ringed.1"],
    7,
    [["ARK's crate", 1, 0, ["ark.blue.plain.1"]], ["ARK's ringed crate", 0, 1, ["ark.blue.ringed.1"]]],
  ]);
  expect(got.sets["ark.blue.plain.1"]).toEqual({ name: "ARK's blue set 1", min: 2, max: 2, entries: [{ items: ["core:crossbow"], min: 1, max: 1, quality: [2, 2] }, { items: ["core:arrow_stone"], min: 40, max: 40 }] });
  // Reading it changed nothing. Put in the draft and saved, it is what blue holds, plain and ringed, whatever the class.
  expect(h.host.supplyBook.book.revision).toBe(0);
  const draft = structuredClone(read.book);
  Object.assign(draft.sets, got.sets);
  Object.assign(draft.tables, got.tables);
  expect((await post("book", { revision: 0, book: draft, note: "ARK's blue" })).answer).toEqual({ revision: 1 });
  const plain = await post("call", { x: mid[0] - 60, z: mid[1], tier: "blue", cls: "voyage", seconds: 0 });
  const ringed = await post("call", { x: mid[0] + 60, z: mid[1], tier: "blue", cls: "armour", ringed: true, seconds: 0 });
  await post("land", { id: "all", seconds: 0 });
  h.run(1000);
  expect([held(h.host.supply.get(plain.answer.id as number)!.pid), held(h.host.supply.get(ringed.answer.id as number)!.pid)]).toEqual([{ "core:crossbow": 1, "core:arrow_stone": 40 }, { "core:stone": 77 }]);
  // The drops' own log has each landing, and the page's has what was done from it.
  const live = await get<{ log: { what: string }[]; acts: { what: string }[] }>("live.json");
  expect([live.log.map((x) => x.what.replace(/ at .*/, "")), live.acts.length]).toEqual([["drop 1 landed: blue voyage", "drop 2 landed: ringed blue armour"], 4]);
  // Cancelled, a landed drop goes, and the log says why.
  await post("cancel", { id: "all" });
  h.run(500);
  expect((await get<{ log: { what: string }[] }>("live.json")).log.slice(-2).map((x) => x.what)).toEqual(["drop 1 gone: cancelled", "drop 2 gone: cancelled"]);
  // Text that is not an override at all is read as nothing, and says so.
  expect((await post("ark", { text: "hello" })).answer).toMatchObject({ crates: 0, tiers: [], said: ["line 1: not a Key=Value line"] });
});
