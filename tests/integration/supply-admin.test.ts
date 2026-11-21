// The drop book's admin page's requests against a running world (server/admin/supply-routes.ts): a table changed
// through them drops differently in the world, drops already called included, and each act is in the page's log. The statuses through the front are held by tests/integration/site.test.ts.

import { expect, test } from "bun:test";
import { PAGE, SupplyRoutes } from "../../server/admin/supply-routes.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { SupplyBook } from "../../shared/supply/book.ts";
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
