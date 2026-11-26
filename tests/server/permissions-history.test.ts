// The cluster's history of permission changes: one row for each change, written in the same transaction as the change,
// so a crash cannot leave a grant nobody is named for, and every map's admins read who changed what on any map.
import { Database } from "bun:sqlite";
import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPERATOR } from "../../server/acts.ts";
import { planCommands } from "../../server/permissions/import.ts";
import { Permissions, type Acting } from "../../server/permissions/permissions.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { idText } from "../../server/survivor-ids.ts";
import { idOf } from "../../shared/ids.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { issue } from "../fixtures/permissions.ts";
import { Harness } from "../fixtures/net.ts";

const root = mkdtempSync(join(tmpdir(), "snark-history-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let files = 0;
const fresh = (): string => join(root, `h${++files}.sqlite`);

const A = idOf(2, 1);
const B = idOf(2, 2);
const HASH = "0123456789abcdef";
const boss: Acting = { rank: RANK_CLUSTER, world: 2, name: "boss", id: B, via: "page" };

/** What a row says, without its sequence number and time. */
const said = (r: { name: string; id: string; rank: number; via: string; world: number; what: string }) => [r.name, r.id, r.rank, r.via, r.world, r.what];

test("each change leaves one row; a refusal and a tag choice leave none", () => {
  const perms = new Permissions({ store: new PermissionStore(fresh()), world: 2, now: () => 4_000 });
  issue(perms, A, "9");
  const ops = [
    ["Permissions.AddGroup Vip", { op: "addGroup", group: "Vip" }],
    ["Permissions.AddGroup Mods; Permissions.Rank Mods staff", { op: "addGroup", group: "Mods", rank: RANK_STAFF }],
    ["Permissions.Rank Vip admin", { op: "setRank", group: "vip", rank: RANK_ADMIN }],
    ["Permissions.Rank Vip open", { op: "setRank", group: "Vip", rank: 0 }],
    ["Permissions.Grant Vip Kit.vip", { op: "grant", group: "VIP", permission: "Kit.vip" }],
    ["Permissions.Revoke Vip Kit.vip", { op: "revoke", group: "Vip", permission: "Kit.vip" }],
    ["set the chat format of Vip", { op: "setChat", group: "Vip", chat: '{"Tag":"[VIP]"}' }],
    // An open group's membership holds on every map, and says so.
    [`Permissions.Add ${A} Vip all`, { op: "addMember", kind: "survivor", key: A, group: "Vip" }],
    [`Permissions.AddTimed ${A} Mods 2 1`, { op: "addMember", kind: "survivor", key: A, group: "mods", hours: 2, delayHours: 1, world: 2 }],
    [`Permissions.Add ${A} Mods all`, { op: "addMember", kind: "survivor", key: A, group: "Mods", world: 0 }],
    ["Permissions.AddTribe 9 Vip", { op: "addMember", kind: "tribe", key: "9", group: "Vip" }],
    [`Permissions.RemoveTimed ${A} Mods`, { op: "removeMember", kind: "survivor", key: A, group: "Mods", timedOnly: true }],
    ["Permissions.RemoveTribe 9 Vip", { op: "removeMember", kind: "tribe", key: "9", group: "Vip" }],
    ["set the chat settings", { op: "setDocument", name: "chat", text: "{}" }],
    ["Permissions.RemoveGroup Vip", { op: "removeGroup", group: "vip" }],
  ] as const;
  for (const [, op] of ops) expect(perms.apply(boss, op)).toBe("");
  expect(perms.claim(A, HASH, "", { name: "ada", rank: 0, via: "session" })).toEqual({ why: "", wrong: false });
  expect(perms.apply(boss, { op: "clearSecret", id: A })).toBe("");
  // Refused, and a tag choice, which is no change to what anyone may do.
  expect(perms.apply(boss, { op: "grant", group: "Nobody", permission: "x" })).not.toBe("");
  expect(perms.apply({ ...boss, rank: RANK_STAFF }, { op: "addGroup", group: "Low" })).not.toBe("");
  expect(perms.apply(boss, { op: "tag", id: A, tag: "Mods", show: false })).toBe("");
  const rows = perms.history();
  const words = [...ops.map(([w]) => w), "claimed their own password", `cleared the password of ${A}`].reverse();
  expect(rows.map((r) => r.what)).toEqual(words);
  expect(rows.map(said).slice(2)).toEqual(ops.map(([w]) => ["boss", B, RANK_CLUSTER, "page", 2, w]).reverse());
  expect(said(rows[1]!)).toEqual(["ada", A, 0, "session", 2, "claimed their own password"]);
  // Newest first, each with the revision its change made and the time; the tag choice made the last revision.
  expect(rows[0]!.revision).toBe(perms.snapshot().revision - 1);
  expect(rows.map((r) => r.revision)).toEqual(rows.map((_, i) => rows[0]!.revision - i));
  expect(rows.every((r) => r.at === 4_000)).toBe(true);
  expect(rows.map((r) => r.seq)).toEqual([...rows.map((r) => r.seq)].sort((a, b) => b - a));
  // No password and no hash in any row.
  expect(JSON.stringify(rows)).not.toContain(HASH);
  expect(JSON.stringify(rows)).not.toContain("[VIP]");
});

test("the row is in the file the moment the change returns, with no save", () => {
  const db = join(root, `w${++files}.db`);
  const h = new Harness({}, 1, 60, { dbPath: db, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  expect(h.host.exec("Permissions.Add ada Admins")).not.toMatch(/^(There|That|No |denied)/);
  // The world dies here: nothing is committed or shut down, and its journal was never saved.
  const other = new PermissionStore(`${db}.permissions.sqlite`);
  const row = other.history(Number.MAX_SAFE_INTEGER, 10)[0]!;
  const id = idText(h.host.records.byPid.get(h.client(ada)!.pid)!);
  expect(said(row)).toEqual(["(operator)", "", RANK_CLUSTER, "operator", 0, `Permissions.Add ${id} Admins`]);
  // The world's act says it in the same words.
  expect(h.host.acts.recent().at(-1)!.what).toBe(row.what);
  other.close();
  h.host.shutdown();
});

test("a change made on one map is read on another, with the first map's number", () => {
  const file = fresh();
  const two = new Permissions({ store: new PermissionStore(file), world: 2 });
  const five = new Permissions({ store: new PermissionStore(file), world: 5 });
  expect(two.apply({ rank: RANK_MAP, world: 2, name: "mapper", id: A, via: "session" }, { op: "addGroup", group: "Vip" })).not.toBe("");
  expect(two.apply(boss, { op: "addGroup", group: "Vip" })).toBe("");
  // Map 5 never polled: the history is read from the file when asked.
  expect(five.history().map(said)).toEqual([["boss", B, RANK_CLUSTER, "page", 2, "Permissions.AddGroup Vip"]]);
});

test("a write that fails takes back both the change and its row", () => {
  const file = fresh();
  const store = new PermissionStore(file);
  const perms = new Permissions({ store, world: 2 });
  const put = spyOn(store, "putHistory").mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(perms.apply(boss, { op: "addGroup", group: "Vip" })).toBe("The permissions could not be written.");
  put.mockRestore();
  const group = spyOn(store, "putGroup").mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(perms.apply(boss, { op: "addGroup", group: "Mods" })).toBe("The permissions could not be written.");
  group.mockRestore();
  const again = new PermissionStore(file);
  expect([again.read().groups.map((g) => g.name).sort(), again.history(Number.MAX_SAFE_INTEGER, 10), perms.group("Vip")]).toEqual([["Admins", "Default"], [], undefined]);
  expect(perms.apply(boss, { op: "addGroup", group: "Vip" })).toBe("");
  expect(again.history(Number.MAX_SAFE_INTEGER, 10).map((r) => r.what)).toEqual(["Permissions.AddGroup Vip"]);
});

test("only the newest rows are kept, and they page from the newest", () => {
  const perms = new Permissions({ store: new PermissionStore(fresh(), { historyKept: 3 }), world: 2 });
  for (const g of ["G1", "G2", "G3", "G4", "G5"]) expect(perms.apply(boss, { op: "addGroup", group: g })).toBe("");
  const rows = perms.history();
  expect(rows.map((r) => r.what)).toEqual(["Permissions.AddGroup G5", "Permissions.AddGroup G4", "Permissions.AddGroup G3"]);
  expect(perms.history(rows[0]!.seq, 1).map((r) => r.what)).toEqual(["Permissions.AddGroup G4"]);
  expect(perms.history(rows[2]!.seq, 10)).toEqual([]);
});

test("an import leaves one row for each change it made", () => {
  const db = join(root, `w${++files}.db`);
  const h = new Harness({}, 1, 60, { dbPath: db, log: () => {} });
  const planned = planCommands("Permissions.AddGroup Vip\nPermissions.Grant Vip Kit.vip\nPermissions.Grant Vip Kit.vip", { look: h.host.permissions, commands: [] });
  if (!planned.ok) throw new Error(planned.reason);
  const done = h.host.importPermissions(OPERATOR, "a list of Permissions commands", planned.plan);
  expect(done.done).toBe(2);
  expect(new PermissionStore(`${db}.permissions.sqlite`).history(Number.MAX_SAFE_INTEGER, 10).map(said)).toEqual([
    ["(operator)", "", RANK_CLUSTER, "operator", 0, "Permissions.Grant Vip Kit.vip"],
    ["(operator)", "", RANK_CLUSTER, "operator", 0, "Permissions.AddGroup Vip"],
  ]);
  h.host.shutdown();
});

test("rows the register drops for an ID made again leave a row by the server", () => {
  const perms = new Permissions({ store: new PermissionStore(fresh()), world: 2, now: () => 8_000 });
  issue(perms, A);
  expect(perms.apply(boss, { op: "addMember", kind: "survivor", key: A, group: "Admins", world: 0 })).toBe("");
  expect(perms.register({ origin: 2, minted: [{ id: A, name: "ada" }], known: [] })).toBe(1);
  const row = perms.history()[0]!;
  expect([...said(row), row.revision]).toEqual(["(server)", "", -1, "server", 2, "took out 1 row that named survivor IDs or team numbers before they were made", perms.snapshot().revision]);
  // A register write that drops nothing leaves no row.
  expect(perms.register({ origin: 2, survivors: 9, minted: [], known: [] })).toBe(0);
  expect(perms.history().length).toBe(2);
});

test("a store file from before the history opens and gains it", () => {
  const file = fresh();
  const db = new Database(file);
  db.exec(
    "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL); INSERT INTO meta VALUES (1, 6);" +
      "CREATE TABLE groups (name TEXT PRIMARY KEY COLLATE NOCASE, rank INTEGER NOT NULL, permissions TEXT NOT NULL, chat TEXT NOT NULL);" +
      "INSERT INTO groups VALUES ('Admins', 2, '*', ''); INSERT INTO groups VALUES ('Default', 0, '', '');" +
      "CREATE TABLE issued (id TEXT PRIMARY KEY, name TEXT NOT NULL, world INTEGER NOT NULL, at INTEGER NOT NULL);" +
      "CREATE TABLE marks (world INTEGER NOT NULL, kind TEXT NOT NULL, next INTEGER NOT NULL, PRIMARY KEY (world, kind));",
  );
  db.close();
  const perms = new Permissions({ store: new PermissionStore(file), world: 2 });
  expect([perms.snapshot().revision, perms.history()]).toEqual([6, []]);
  expect(perms.apply(boss, { op: "addGroup", group: "Vip" })).toBe("");
  expect(perms.history().map((r) => [r.what, r.revision])).toEqual([["Permissions.AddGroup Vip", 7]]);
});

test("a store's commit count moves with another map's write, the register's too", () => {
  const file = fresh();
  const two = new Permissions({ store: new PermissionStore(file), world: 2 });
  const five = new Permissions({ store: new PermissionStore(file), world: 5 });
  const seen = five.commits();
  expect(five.commits()).toBe(seen);
  issue(two, A);
  const after = five.commits();
  expect(after).not.toBe(seen);
  expect(two.apply(boss, { op: "addGroup", group: "Vip" })).toBe("");
  expect(five.commits()).not.toBe(after);
});
