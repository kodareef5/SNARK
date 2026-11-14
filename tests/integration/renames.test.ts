// An id that was renamed: a save, a ledger and a settings file that still use it read as if they used the new one.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import { Lists } from "../../server/settings/lists.ts";
import { Rules } from "../../server/settings/rules.ts";
import { compilePacks, type DefPatch } from "../../shared/content/packs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-renames-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const made = (defs: DefPatch[]): Registry => {
  const out = compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs }]);
  if (!out.registry) throw new Error(out.errors.join("\n"));
  return out.registry;
};
const item = (id: string): DefPatch => ({ id, type: "item", class: "resource", stack: 100, craft: { needs: [{ item: "core:stone", count: 1 }], seconds: 5, xp: 1 } });
const engram = (id: string, unlocks: string[]): DefPatch => ({ id, type: "engram", label: id, level: 1, cost: 1, unlocks });

const BEFORE = made([item("t:old"), item("t:other"), engram("t:engram-old", ["t:old"]), engram("t:engram-kit", [])]);
const AFTER = made([
  item("t:new"),
  engram("t:engram-new", ["t:new"]),
  engram("t:engram-kit-a", []),
  engram("t:engram-kit-b", []),
  { id: "t:old", type: "rename", to: ["t:new"] },
  // Two things that became one.
  { id: "t:other", type: "rename", to: ["t:new"] },
  { id: "t:engram-old", type: "rename", to: ["t:engram-new"] },
  // One thing that became two.
  { id: "t:engram-kit", type: "rename", to: ["t:engram-kit-a", "t:engram-kit-b"] },
]);

test("a save made before a rename loads after it: the stack, the ledger, what was learned and what was being made", () => {
  const db = join(dir, "world.db");
  const h = new Harness({}, 1, 60, { dbPath: db }, BEFORE);
  const ada = h.join("ada");
  h.run(500);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const was = (id: string): number => BEFORE.index.get(id)!;
  h.host.items.mint(rec, was("t:old"), 40);
  h.host.items.mint(rec, was("t:other"), 2);
  rec.engrams.push(was("t:engram-old"), was("t:engram-kit"));
  rec.jobs.push({ item: was("t:old"), left: 3, doneAt: h.world.tick + 9000 });
  h.host.records.dirty.add(rec.pid);
  h.run(500);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db }, AFTER);
  const now = (id: string): number => AFTER.index.get(id)!;
  const back = h2.host.records.byPid.get(rec.pid)!;
  expect(back.inv!.total(now("t:new"))).toBe(42);
  expect(h2.host.items.audit()).toEqual([]);
  expect([...back.engrams].sort((a, b) => a - b)).toEqual([now("t:engram-new"), now("t:engram-kit-a"), now("t:engram-kit-b")].sort((a, b) => a - b));
  expect(back.jobs.map((j) => [j.item, j.left])).toEqual([[now("t:new"), 3]]);
  expect(h2.host.persistence!.store.missingContent).toEqual([]);
  // Saved again, it is written under the new ids, and reads the same a second time.
  h2.host.records.dirty.add(back.pid);
  h2.run(500);
  h2.host.shutdown();
  const h3 = new Harness({}, 1, 60, { dbPath: db }, AFTER);
  const again = h3.host.records.byPid.get(rec.pid)!;
  expect([again.inv!.total(now("t:new")), again.engrams.length, again.jobs.length]).toEqual([42, 3, 1]);
  expect(h3.host.items.audit()).toEqual([]);
  h3.host.shutdown();
});

test("a settings file that names what was renamed still means it, and a rename is not content", () => {
  const lists = new Lists(new Rules(), AFTER);
  expect(lists.index("PreventDinoTameClassNames", "t:old")).toBe(AFTER.index.get("t:new")!);
  expect(lists.index("PreventDinoTameClassNames", "t:never")).toBe(0);
  expect([AFTER.index.has("t:old"), AFTER.ids.includes("t:old"), AFTER.redirects.get("t:engram-kit")!.length]).toEqual([false, false, 2]);
  // The hash is of the content. A rename alone does not change it.
  const without = made([item("t:new"), engram("t:engram-new", ["t:new"]), engram("t:engram-kit-a", []), engram("t:engram-kit-b", [])]);
  expect(without.hash).toBe(AFTER.hash);
});

test("a rename must lead somewhere that exists, once, and to one kind of thing", () => {
  const bad = (...defs: DefPatch[]): string[] => compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs: [item("t:new"), ...defs] }]).errors;
  expect(bad({ id: "t:old", type: "rename", to: ["t:gone"] })).toEqual(['t:old: is renamed to "t:gone", which is not defined']);
  // A pack refuses an id used twice. Content compiled without packs is refused for the same thing.
  expect(bad({ id: "t:new2", type: "rename", to: ["t:new"] }, item("t:new2"))).toEqual(["t:new2: defined twice"]);
  expect(compileContent([...CORE_CONTENT, { type: "rename", id: "core:stone", to: ["core:wood"] }]).errors).toEqual(["core:stone: is renamed and also defined"]);
  expect(bad({ id: "t:old", type: "rename", to: ["t:new", "core:raptor"] })).toEqual(["t:old: is renamed to things of different types"]);
  expect(bad({ id: "t:old", type: "rename", to: [] })).toEqual([]);
  expect(bad({ id: "t:old", type: "rename" })).toEqual(['t:old: class rename must declare "to"']);
  expect(bad({ id: "t:old", type: "rename", to: "t:new" })).toEqual(['t:old: "to" must be a list']);
});

/**
 * A save made by the code as it was before content was realigned (commit ea95969): a survivor at level 100 who has learned
 * the spear, the pick, hide armor, cloth armor and the wooden wall, with three spears and a hide hat being made. Then a
 * recipe was a definition of its own, "core:make-spear", and the job names it.
 */
const BEFORE_REALIGNMENT = join(import.meta.dir, "../fixtures/saves/before-realignment.db");
const ADA = 1099511627777;

test("a save from before recipes became part of their items goes on making what it was making", () => {
  const db = join(dir, "before.db");
  copyFileSync(BEFORE_REALIGNMENT, db);
  const h = new Harness({}, 1, 60, { dbPath: db });
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const rec = h.host.records.byPid.get(ADA)!;
  expect(h.host.persistence!.store.missingContent).toEqual([]);
  expect(rec.jobs.map((j) => [h.reg.ids[j.item], j.left])).toEqual([["core:spear", 3], ["core:hide_hat", 1]]);
  expect(h.host.items.audit()).toEqual([]);
  expect(rec.engrams.map((e) => h.reg.ids[e]).filter((e) => e === "core:engram-spear" || e === "core:engram-piece_wall_wood")).toEqual(["core:engram-spear", "core:engram-piece_wall_wood"]);
  h.run(60000);
  expect([rec.inv!.total(id("spear")), rec.inv!.total(id("hide_hat")), rec.jobs.length]).toEqual([3, 1, 0]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});
