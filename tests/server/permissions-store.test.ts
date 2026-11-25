import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idOf } from "../../shared/ids.ts";
import type { PermissionActor } from "../../shared/permissions/model.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_OPEN } from "../../shared/ranks.ts";
import { Permissions, POLL_MS } from "../../server/permissions/permissions.ts";
import { RETIRED_MS } from "../../server/permissions/secrets.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { issue } from "../fixtures/permissions.ts";

const root = mkdtempSync(join(tmpdir(), "snark-perms-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let files = 0;
const fresh = (): string => join(root, `p${++files}.sqlite`);

const A = idOf(2, 1);
const B = idOf(2, 2);
const cluster: PermissionActor = { rank: RANK_CLUSTER, world: 2, name: "cluster" };

test("a fresh file has the two starting groups", () => {
  const store = new PermissionStore(fresh());
  const snap = store.read();
  expect(snap.groups.map((g) => [g.name, g.rank, g.permissions])).toEqual([
    ["Default", RANK_OPEN, []],
    ["Admins", RANK_ADMIN, ["*"]],
  ]);
  expect(snap.members).toEqual([]);
  store.close();
});

test("what one store writes another on the same file sees after its poll", () => {
  const file = fresh();
  const clock = { t: 1_000_000 };
  const one = new Permissions({ store: new PermissionStore(file), world: 2, now: () => clock.t });
  const two = new Permissions({ store: new PermissionStore(file), world: 5, now: () => clock.t });
  issue(one, A);
  two.poll();
  expect(one.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
  expect(one.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Vip" })).toBe("");
  expect(two.poll()).toBe(false);
  expect(two.group("Vip")).toBeUndefined();
  clock.t += POLL_MS;
  expect(two.poll()).toBe(true);
  expect(two.inGroup({ id: A, team: 0, signed: false, world: 5 }, "vip")).toBe(true);
  expect(two.apply(cluster, { op: "grant", group: "Vip", permission: "Kit.vip" })).toBe("");
  clock.t += POLL_MS;
  expect(one.poll()).toBe(true);
  expect(one.group("Vip")?.permissions).toEqual(["Kit.vip"]);
});

test("a write made on a stale view reads the file first", () => {
  const file = fresh();
  const one = new Permissions({ store: new PermissionStore(file), world: 2 });
  const two = new Permissions({ store: new PermissionStore(file), world: 5 });
  expect(one.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
  expect(two.apply(cluster, { op: "addGroup", group: "Vip" })).not.toBe("");
  expect(two.apply(cluster, { op: "grant", group: "Vip", permission: "Kit.vip" })).toBe("");
  expect(new PermissionStore(file).read().groups.find((g) => g.name === "Vip")?.permissions).toEqual(["Kit.vip"]);
});

test("everything survives a close and reopen", () => {
  const file = fresh();
  const store = new PermissionStore(file);
  const perms = new Permissions({ store, world: 2, now: () => 5_000 });
  issue(perms, A, B, "9");
  const ops = [
    { op: "addGroup", group: "Vip" },
    { op: "setChat", group: "Vip", chat: '{"Tag":"[VIP]"}' },
    { op: "grant", group: "Vip", permission: "ArkShop.*" },
    { op: "addMember", kind: "survivor", key: A, group: "Vip", hours: 2, delayHours: 1 },
    { op: "addMember", kind: "tribe", key: "9", group: "Vip", world: 4 },
    { op: "addMember", kind: "survivor", key: B, group: "Admins", world: 0 },
    { op: "setDocument", name: "CrossChat", text: "{}" },
    { op: "tag", id: A, tag: "VIP", show: false },
  ] as const;
  for (const op of ops) expect(perms.apply(cluster, op)).toBe("");
  expect(perms.claim(B, "0123456789abcdef", "")).toEqual({ why: "", wrong: false });
  expect(perms.snapshot().secrets).toEqual([{ id: B, hash: "0123456789abcdef", at: 5_000 }]);
  const before = perms.snapshot();
  store.close();
  const again = new PermissionStore(file).read();
  expect(again).toEqual(new Permissions({ store: new PermissionStore(file), world: 2, now: () => 5_000 }).snapshot());
  expect(again.revision).toBe(before.revision);
  expect(again.groups).toEqual(before.groups);
  expect(again.members).toEqual(before.members);
  expect(again.secrets).toEqual(before.secrets);
  expect(again.documents).toEqual(before.documents);
  expect(again.tags).toEqual(before.tags);
});

test("a memory store works and keeps its writes", () => {
  const perms = new Permissions({ store: new PermissionStore(":memory:"), world: 1 });
  expect(perms.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
  expect(perms.poll()).toBe(false);
  expect(perms.group("vip")?.name).toBe("Vip");
});

test("a bad row in the file is skipped, not fatal", () => {
  const file = fresh();
  new PermissionStore(file).read();
  const db = new Database(file);
  db.exec(
    "INSERT INTO groups VALUES ('Vip', 0, 'Kit.vip,two words,Kit.*', '');" +
      "INSERT INTO groups VALUES ('bad name', 0, '', '');" +
      "INSERT INTO groups VALUES ('Huge', 9, '', '');" +
      "INSERT INTO groups VALUES ('Null', 0, NULL, '');" +
      `INSERT INTO members VALUES ('survivor', '${A}', 'vip', 0, 1, 0, 0);` +
      "INSERT INTO members VALUES ('survivor', '123', 'Vip', 0, 1, 0, 0);" +
      `INSERT INTO members VALUES ('pet', '${A}', 'Vip', 0, 1, 0, 0);` +
      `INSERT INTO members VALUES ('survivor', '${A}', 'Huge', 0, 1, 0, 0);` +
      `INSERT INTO members VALUES ('survivor', '${A}', 'Vip', 3, 'x', 0, 0);` +
      "INSERT INTO secrets VALUES ('nobody', 'abcdefabcdefabcd', 0);" +
      "INSERT INTO tags VALUES ('nobody', 'VIP', 1);" +
      "UPDATE meta SET revision = revision + 1;",
  );
  db.close();
  const snap = new PermissionStore(file).read();
  expect(snap.groups.map((g) => g.name).sort()).toEqual(["Admins", "Default", "Vip"]);
  expect(snap.groups.find((g) => g.name === "Vip")?.permissions).toEqual(["Kit.vip", "Kit.*"]);
  expect(snap.members.map((m) => [m.key, m.group, m.world])).toEqual([[A, "Vip", 0]]);
  expect(snap.secrets).toEqual([]);
  expect(snap.tags).toEqual([]);
  const perms = new Permissions({ store: new PermissionStore(file), world: 2 });
  expect(perms.has({ id: A, team: 0, signed: false, world: 2 }, "Kit.anything")).toBe(true);
});

test("a starting group missing from the file is still there", () => {
  const file = fresh();
  new PermissionStore(file).read();
  const db = new Database(file);
  db.exec("DELETE FROM groups WHERE name = 'default'");
  db.close();
  expect(new PermissionStore(file).read().groups.map((g) => g.name).sort()).toEqual(["Admins", "Default"]);
});

test("a file made before claims were dated is read, and takes a dated claim", () => {
  const file = fresh();
  const db = new Database(file);
  db.exec("CREATE TABLE secrets (id TEXT PRIMARY KEY, hash TEXT NOT NULL);" + `INSERT INTO secrets VALUES ('${A}', 'abcdefabcdefabcd');`);
  db.close();
  const store = new PermissionStore(file);
  expect(store.read().secrets).toEqual([{ id: A, hash: "abcdefabcdefabcd", at: 0 }]);
  const perms = new Permissions({ store, world: 2, now: () => 7_000 });
  issue(perms, A);
  expect(perms.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Admins", world: 0 })).toBe("");
  expect(perms.claim(A, "0123456789abcdef", "abcdefabcdefabcd")).toEqual({ why: "", wrong: false });
  expect(new PermissionStore(file).read().secrets).toEqual([{ id: A, hash: "0123456789abcdef", at: 7_000 }]);
});

test("a file made before the register opens, gains it and keeps what it held", () => {
  const file = fresh();
  const db = new Database(file);
  db.exec(
    "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL); INSERT INTO meta VALUES (1, 4);" +
      "CREATE TABLE groups (name TEXT PRIMARY KEY COLLATE NOCASE, rank INTEGER NOT NULL, permissions TEXT NOT NULL, chat TEXT NOT NULL);" +
      "CREATE TABLE members (kind TEXT NOT NULL, key TEXT NOT NULL, grp TEXT NOT NULL COLLATE NOCASE, world INTEGER NOT NULL, forever INTEGER NOT NULL, start INTEGER NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (kind, key, grp, world));" +
      "INSERT INTO groups VALUES ('Admins', 2, '*', '');" +
      `INSERT INTO members VALUES ('survivor', '${A}', 'Admins', 0, 1, 0, 0);`,
  );
  db.close();
  const perms = new Permissions({ store: new PermissionStore(file), world: 2, now: () => 9_000 });
  expect([perms.snapshot().revision, perms.membersOf("survivor", A).length, perms.marks(2), perms.issued(A)]).toEqual([4, 1, { survivor: 0, team: 0 }, null]);
  expect(perms.register({ origin: 2, survivors: 3, teams: 2, minted: [], known: [{ id: A, name: "ada" }] })).toBe(0);
  expect([perms.issued(A), perms.marks(2), perms.snapshot().revision]).toEqual([{ id: A, name: "ada", world: 2, at: 9_000 }, { survivor: 3, team: 2 }, 4]);
  const tables = (new Database(file).query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(["issued", "marks", "secrets", "tags", "documents"]));
});

test("the register keeps the first time an ID was seen, follows its name, and its marks only rise", () => {
  const clock = { t: 1_000 };
  const perms = new Permissions({ store: new PermissionStore(fresh()), world: 2, now: () => clock.t });
  const v = perms.version;
  expect(perms.register({ origin: 2, survivors: 5, teams: 4, minted: [{ id: A, name: "ada" }], known: [] })).toBe(0);
  clock.t = 2_000;
  expect(perms.register({ origin: 2, survivors: 3, teams: 2, minted: [], known: [{ id: A, name: "Ada" }, { id: idOf(7, 9), name: "kit" }] })).toBe(0);
  expect([perms.issued(A), perms.issuedNamed("ADA").map((r) => r.id), perms.marks(2), perms.marks(7)]).toEqual([
    { id: A, name: "Ada", world: 2, at: 1_000 },
    [A],
    { survivor: 5, team: 4 },
    { survivor: 10, team: 0 },
  ]);
  expect([perms.teamMade(String(2 * 1048576 + 3)), perms.teamMade(String(2 * 1048576 + 4)), perms.teamMade(String(7 * 1048576 + 1))]).toEqual([true, false, false]);
  // Nothing anyone may do changed, so the revision and this view stayed.
  expect([perms.snapshot().revision, perms.version]).toEqual([0, v]);
});

test("a view opened later still knows a password retired within the day", () => {
  const file = fresh();
  const clock = { t: 1_000_000 };
  const one = new Permissions({ store: new PermissionStore(file), world: 2, now: () => clock.t });
  issue(one, A, B);
  expect(one.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Admins" })).toBe("");
  expect(one.apply(cluster, { op: "addMember", kind: "survivor", key: B, group: "Admins" })).toBe("");
  const [first, second, third, gone] = ["a1", "b2", "c3", "d4"].map((x) => x.repeat(32));
  expect([one.claim(A, first!, "").why, one.claim(B, gone!, "").why]).toEqual(["", ""]);
  // A view that was open all along and never saw the first two: both were replaced between its polls.
  const two = new Permissions({ store: new PermissionStore(file), world: 5, now: () => clock.t });
  expect(one.claim(A, second!, first!).why).toBe("");
  expect(one.claim(A, third!, second!).why).toBe("");
  expect(one.apply(cluster, { op: "clearSecret", id: B })).toBe("");
  clock.t += POLL_MS;
  two.poll();
  expect([first, second, gone, third].map((h) => two.retired(h!))).toEqual([true, true, true, false]);
  // A world that starts after it all, as one restarted does.
  clock.t += 3600_000;
  const late = new Permissions({ store: new PermissionStore(file), world: 6, now: () => clock.t });
  expect([first, second, gone, third].map((h) => late.retired(h!))).toEqual([true, true, true, false]);
  // After a day none is remembered, in memory or in the file.
  clock.t += RETIRED_MS;
  expect([first, second, gone].map((h) => late.retired(h!))).toEqual([false, false, false]);
  expect(one.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
  const after = new Permissions({ store: new PermissionStore(file), world: 7, now: () => clock.t });
  expect([first, second, gone].map((h) => after.retired(h!))).toEqual([false, false, false]);
  const db = new Database(file);
  expect((db.query("SELECT COUNT(*) AS n FROM retired").get() as { n: number }).n).toBe(0);
  db.close();
});

/** Two worlds over one file, with A already holding what B wrote: bob in a group that gives every cheat. */
function twoWorlds() {
  const file = fresh();
  const clock = { t: 1_800_000_000_000 };
  const said: string[] = [];
  const a = new Permissions({ store: new PermissionStore(file), world: 1, now: () => clock.t, say: (line) => said.push(line) });
  const b = new Permissions({ store: new PermissionStore(file), world: 2, now: () => clock.t });
  issue(b, B);
  for (const op of [{ op: "addGroup", group: "Gods" }, { op: "grant", group: "Gods", permission: "*" }, { op: "addMember", kind: "survivor", key: B, group: "Gods" }] as const) expect(b.apply(cluster, op)).toBe("");
  clock.t += POLL_MS;
  a.poll();
  const bob = { id: B, team: 0, signed: false, world: 1 };
  expect(a.has(bob, "Cheat.god")).toBe(true);
  return { file, clock, a, b, bob, said };
}

test("another world's change is seen at the next poll, whatever the file's time and size say", () => {
  const { file, clock, a, b, bob } = twoWorlds();
  // A file system with coarse times, as FAT's or a network share's, gives two commits one time, and SQLite's pages one size.
  const coarse = Math.floor(statSync(file).mtimeMs / 1000);
  expect(b.apply(cluster, { op: "grant", group: "Gods", permission: "Cheat.fly" })).toBe("");
  utimesSync(file, coarse, coarse);
  clock.t += POLL_MS;
  a.poll();
  expect(b.apply(cluster, { op: "removeMember", kind: "survivor", key: B, group: "Gods" })).toBe("");
  utimesSync(file, coarse, coarse);
  clock.t += POLL_MS;
  expect(a.poll()).toBe(true);
  expect(a.has(bob, "Cheat.god")).toBe(false);
});

test("a clock put back does not stop a world from looking at the file", () => {
  const { clock, a, b, bob } = twoWorlds();
  clock.t -= 3_600_000;
  expect(b.apply(cluster, { op: "removeMember", kind: "survivor", key: B, group: "Gods" })).toBe("");
  clock.t += 2 * POLL_MS;
  a.poll();
  expect(a.has(bob, "Cheat.god")).toBe(false);
});

test("a file another process holds locked costs a short wait, throws nothing, and is read once free", () => {
  const { file, clock, a, b, bob, said } = twoWorlds();
  expect(b.apply(cluster, { op: "removeMember", kind: "survivor", key: B, group: "Gods" })).toBe("");
  const holder = new Database(file);
  holder.exec("BEGIN EXCLUSIVE");
  const timed = <T>(run: () => T): [T, number] => {
    const from = performance.now();
    const out = run();
    return [out, performance.now() - from];
  };
  clock.t += POLL_MS;
  const [polled, pollMs] = timed(() => a.poll());
  const [why, applyMs] = timed(() => a.apply(cluster, { op: "addGroup", group: "Vip" }));
  const [claimed, claimMs] = timed(() => a.claim(B, "ab".repeat(32), ""));
  const [registered, registerMs] = timed(() => a.register({ origin: 1, survivors: 5, teams: 5, minted: [], known: [] }));
  expect([polled, why, claimed.why, registered]).toEqual([false, "The permissions could not be written.", "The permissions could not be written.", null]);
  for (const ms of [pollMs, applyMs, claimMs, registerMs]) expect(ms).toBeLessThan(1000);
  // It keeps what it had, says so once, and reads the file again when it can.
  expect(a.has(bob, "Cheat.god")).toBe(true);
  clock.t += POLL_MS;
  a.poll();
  expect(said.filter((line) => line.includes("could not be read")).length).toBe(1);
  holder.exec("ROLLBACK");
  holder.close();
  clock.t += POLL_MS;
  expect(a.poll()).toBe(true);
  expect(a.has(bob, "Cheat.god")).toBe(false);
  expect(said.at(-1)).toContain("read again");
  expect(a.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
});

test("a write that fails half way leaves nothing of itself in the view", () => {
  const file = fresh();
  const store = new PermissionStore(file);
  const perms = new Permissions({ store, world: 2 });
  issue(perms, A);
  // The membership reaches the view and the file, and then the transaction fails as it ends.
  const raise = store.raise.bind(store);
  store.raise = () => {
    throw new Error("the disk is full");
  };
  expect(perms.apply(cluster, { op: "addMember", kind: "survivor", key: A, group: "Admins" })).toBe("The permissions could not be written.");
  store.raise = raise;
  expect([perms.membersOf("survivor", A), perms.staffRank(A)]).toEqual([[], RANK_OPEN]);
  const other = new Permissions({ store: new PermissionStore(file), world: 5 });
  expect(other.membersOf("survivor", A)).toEqual([]);
});
