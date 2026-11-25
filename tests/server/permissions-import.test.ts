// ArkApi's Permissions database, a pasted command list and a CrossChat config, planned and applied.
import { afterAll, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatFormat, readChatSettings, readLooseJson } from "../../shared/permissions/chat.ts";
import { CHANGED_MEANWHILE, type PermissionActor } from "../../shared/permissions/model.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { applyPlan, CHAT_DOCUMENT, IMPORT_CHANGES_MOST, IMPORT_NOTES_MOST, planArkApi, planCommands, planCrossChat, type ArkApiFiles, type ImportPlan, type Planned } from "../../server/permissions/import.ts";
import { Permissions } from "../../server/permissions/permissions.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { STEAM, TRIBE, pluginDatabase, removeDatabase, runningArkApi } from "../fixtures/arkapi.ts";

const root = mkdtempSync(join(tmpdir(), "snark-import-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const cluster: PermissionActor = { rank: RANK_CLUSTER, world: 3, name: "cluster" };
/** On a world in no cluster, where an admin edits the groups of its rank. */
const admin: PermissionActor = { rank: RANK_ADMIN, world: 0, name: "admin" };
const COMMANDS = ["kick", "give", "tp", "save", "settime", "ghost", "fly"];

const fresh = () => new Permissions({ store: new PermissionStore(":memory:"), world: 3 });

let files = 0;
/** An ArkApi Permissions file, made as the plugin's source makes its tables. */
function arkApiFile(): Uint8Array {
  const path = join(root, `perms-${++files}.db`);
  const db = new Database(path, { create: true });
  db.exec(
    "CREATE TABLE Groups (Id INTEGER PRIMARY KEY AUTOINCREMENT, GroupName TEXT NOT NULL UNIQUE, Permissions TEXT DEFAULT '');" +
      "CREATE TABLE Players (Id INTEGER PRIMARY KEY AUTOINCREMENT, SteamId INTEGER NOT NULL UNIQUE, Groups TEXT DEFAULT 'Default,', TimedGroups TEXT DEFAULT '');" +
      "CREATE TABLE Tribes (Id INTEGER PRIMARY KEY AUTOINCREMENT, TribeId INTEGER NOT NULL UNIQUE, Groups TEXT DEFAULT '', TimedGroups TEXT DEFAULT '');",
  );
  const group = db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)");
  group.run("Admins", "*,");
  group.run("Default", "ArkShop.Kits.starter,");
  group.run("Vip", "ArkShop.Kits.vip,Cheat.KickPlayer,Cheat.DestroyWildDinos,");
  group.run("Builders", "Build.Fast,Bad Perm,");
  group.run("Mod Team", "Cheat.*,");
  const player = db.query("INSERT INTO Players (SteamId, Groups, TimedGroups) VALUES (?, ?, ?)");
  player.run(STEAM[0]!, "Default,Vip,", "0;1800000000;Vip,");
  player.run(STEAM[1]!, "Vip,Admins,", "");
  db.query("INSERT INTO Tribes (TribeId, Groups, TimedGroups) VALUES (?, ?, ?)").run(TRIBE, "Vip,", "0;1800000000;Builders,");
  db.close();
  const bytes = readFileSync(path);
  rmSync(path);
  return bytes;
}

/** ArkApi's database from a server stopped cleanly: its log was folded into it and removed. */
function stoppedFile(): Uint8Array {
  const path = join(root, `stopped-${++files}.db`);
  pluginDatabase(path).close();
  if (existsSync(`${path}-wal`)) throw new Error("the log outlived the server");
  const bytes = readFileSync(path);
  removeDatabase(path);
  return bytes;
}

/** ArkApi's database and its log, copied while the server runs: the group Late is only in the log. */
const runningFiles = (pageSize?: number, late = "Late"): { main: Uint8Array; wal: Uint8Array } => runningArkApi(join(root, `running-${++files}.db`), pageSize, late);

/** The log of a database in write-ahead-log mode that is not ArkApi's. */
function otherLog(): Uint8Array {
  const path = join(root, `other-${++files}.db`);
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE Things (Id INTEGER PRIMARY KEY, Name TEXT);");
  for (let i = 0; i < 40; i++) db.query("INSERT INTO Things (Name) VALUES (?)").run("thing ".repeat(40));
  const wal = readFileSync(`${path}-wal`);
  db.close();
  removeDatabase(path);
  return wal;
}

const added = (plan: ImportPlan): string[] => plan.ops.flatMap((op) => (op.op === "addGroup" ? [op.group] : []));

const COMMAND_LIST = `
# The same groups, typed
admincheat Permissions.Grant Admins *
cheat Permissions.Grant Default ArkShop.Kits.starter
Permissions.AddGroup Vip
permissions.grant Vip ArkShop.Kits.vip
Permissions.Grant Vip Cheat.KickPlayer
Permissions.Grant Vip Cheat.DestroyWildDinos
// builders
Permissions.AddGroup Builders
Permissions.Grant Builders Build.Fast
Permissions.Add ${STEAM[0]} Vip
Permissions.AddTimed ${STEAM[0]} Vip 24 0
Permissions.AddTribeTimed ${TRIBE} Builders 1 0
Permissions.ListGroups
Permissions.Remove ${STEAM[1]} Vip
Permissions.Grant Vip
${STEAM[1]} hello
`;

const SAMPLE = `{
  // CrossChat, as its sample ships
  "Mysql": { "UseMysql": false },
  "PermissionsFormatting": {
    "Default": {
      "ChatFormat": "{map}: {tags} {sender} {tribe}: {message}",
      "Priority": 0, // the higher the more priority it is given
      "Icon": "", // the icon to show before the name in chat
      "FormattingParts": {
        "map": "[{name}]",
        "tags": "{name}",
        "sender": "<RichColor Color=\\"1, 0.9, 0, 1\\">{name}</>",
        "tribe": "<RichColor Color=\\"1, 0.9, 0, 1\\">[{name}]</>",
        "message": "{message}"
      }
    },
    "Admin": {
      "ChatFormat": "{tags} {sender}: {message}",
      "Priority": 9999,
      "Icon": "",
      "FormattingParts": {
        "map": "[{name}]",
        "tags": "{name}",
        "sender": "<RichColor Color=\\"1, 0, 0, 1\\">{name}</>",
        "tribe": "[{name}]",
        "message": "{message}",
      },
    },
    "Helpers": { "ChatFormat": "{sender}: {message}", "Priority": 5 }
  },
  "ChatTags": {
    "StackChatTags": true, // all tags show when true
    "Admin": { "Priority": 9999, "Icon": "Game/Icons/Admin", "Text": "<RichColor Color=\\"1, 0, 0, 1\\">[{icon}Admin]</>", "CanBeDisabled": true },
    "VIP": { "Priority": 10, "Icon": "", "Text": "<RichColor Color=\\"0, 1, 0, 1\\">[VIP]</>", "CanBeDisabled": true },
  },
  "MutedPermissionGroup": "Muted",
  "MapColors": { "TheIsland_WP": [0, 125, 125] }
}`;

function planOf(planned: Planned): ImportPlan {
  if (!planned.ok) throw new Error(planned.reason);
  return planned.plan;
}

const opts = (perms: Permissions) => ({ look: perms, commands: COMMANDS });
const groupsOf = (perms: Permissions) =>
  perms
    .groups()
    .map((g) => ({ name: g.name, rank: g.rank, permissions: [...g.permissions].sort(), chat: g.chat }))
    .sort((a, b) => a.name.localeCompare(b.name));
const noteWith = (plan: ImportPlan, text: string): string | undefined => plan.notes.find((n) => n.includes(text));

test("groups and permissions come over and the starting groups are merged into", () => {
  const perms = fresh();
  const plan = planOf(planArkApi(arkApiFile(), opts(perms)));
  expect(plan.ops.filter((op) => op.op === "addMember")).toEqual([]);
  expect(applyPlan(perms, cluster, plan).refused).toEqual([]);
  expect(perms.group("Vip")).toMatchObject({ rank: RANK_OPEN, permissions: ["ArkShop.Kits.vip", "Cheat.KickPlayer", "Cheat.DestroyWildDinos"] });
  expect(perms.group("Builders")?.permissions).toEqual(["Build.Fast"]);
  expect(perms.group("Admins")).toMatchObject({ rank: RANK_ADMIN, permissions: ["*"] });
  expect(perms.group("Default")).toMatchObject({ rank: RANK_OPEN, permissions: ["ArkShop.Kits.starter"] });
  expect(perms.group("Mod Team")).toBeUndefined();
  expect(noteWith(plan, '"Mod Team" was skipped')).toBeDefined();
  expect(noteWith(plan, '"Bad Perm" was skipped')).toBeDefined();
});

test("players' and tribes' memberships are counted and left behind", () => {
  const plan = planOf(planArkApi(arkApiFile(), opts(fresh())));
  expect(plan.ops.some((op) => op.op === "addMember")).toBe(false);
  expect(noteWith(plan, "Vip: 4 memberships left behind (3 players, 1 tribe; 1 timed)")).toBeDefined();
  expect(noteWith(plan, "Builders: 1 membership left behind (1 tribe; 1 timed)")).toBeDefined();
  expect(noteWith(plan, "Admins: 1 membership left behind (1 player)")).toBeDefined();
  expect(noteWith(plan, "Default:")).toBeUndefined();
  for (const note of plan.notes) for (const id of [...STEAM, TRIBE]) expect(note).not.toContain(id);
});

test("a pasted command list gives the same groups", () => {
  const fromFile = fresh();
  applyPlan(fromFile, cluster, planOf(planArkApi(arkApiFile(), opts(fromFile))));
  const typed = fresh();
  const plan = planOf(planCommands(COMMAND_LIST, opts(typed)));
  expect(applyPlan(typed, cluster, plan).refused).toEqual([]);
  expect(groupsOf(typed)).toEqual(groupsOf(fromFile));
  expect(noteWith(plan, "Vip: 2 memberships left behind (2 players; 1 timed)")).toBeDefined();
  expect(noteWith(plan, "Builders: 1 membership left behind (1 tribe; 1 timed)")).toBeDefined();
  expect(noteWith(plan, "1 line that only lists was skipped")).toBeDefined();
  expect(noteWith(plan, "1 line that takes a member out was skipped")).toBeDefined();
  expect(noteWith(plan, "Too few words")).toBeDefined();
  expect(noteWith(plan, "is not a Permissions command")).toBeDefined();
  for (const note of plan.notes) for (const id of [...STEAM, TRIBE]) expect(note).not.toContain(id);
});

test("CrossChat's sample gives each group's format and the tags", () => {
  const perms = fresh();
  const plan = planOf(planCrossChat(SAMPLE, opts(perms)));
  expect(applyPlan(perms, cluster, plan).refused).toEqual([]);
  const format = (group: string) => readChatFormat(JSON.parse(perms.group(group)!.chat)).value!;
  expect(format("Default").chatFormat).toBe("{map}: {tags} {sender} {tribe}: {message}");
  expect(format("Default").parts.sender).toBe('<RichColor Color="1, 0.9, 0, 1">{name}</>');
  expect(format("Helpers").priority).toBe(5);
  expect(perms.group("Helpers")?.rank).toBe(RANK_OPEN);
  const json = readLooseJson(perms.document(CHAT_DOCUMENT));
  if (!json.ok) throw new Error(json.reason);
  const settings = readChatSettings(json.value);
  expect(settings.faults).toEqual([]);
  expect(settings.value.tags.map((t) => t.name)).toEqual(["Admins", "VIP"]);
  expect(settings.value.stackTags).toBe(true);
  expect(settings.value.mutedGroup).toBe("Muted");
  expect(settings.value.mapColors.get("TheIsland_WP")).toBe(0x007d7d);
  expect(noteWith(plan, "do not carry over: Mysql")).toBeDefined();
  expect(noteWith(plan, "Icons do not carry over")).toBeDefined();
  expect(noteWith(plan, "The tag VIP has no group")).toBeDefined();
});

test("CrossChat's Admin lands on Admins with a note", () => {
  const perms = fresh();
  const plan = planOf(planCrossChat(SAMPLE, opts(perms)));
  applyPlan(perms, cluster, plan);
  expect(perms.group("Admin")).toBeUndefined();
  expect(readChatFormat(JSON.parse(perms.group("Admins")!.chat)).value!.priority).toBe(9999);
  expect(noteWith(plan, "Admin block and tag went to Admins")).toBeDefined();

  const kept = fresh();
  kept.apply(cluster, { op: "addGroup", group: "Admin" });
  const own = planOf(planCrossChat(SAMPLE, opts(kept)));
  applyPlan(kept, cluster, own);
  expect(kept.group("Admin")!.chat).not.toBe("");
  expect(kept.group("Admins")!.chat).toBe("");
  expect(noteWith(own, "went to Admins")).toBeUndefined();
});

test("an open group that holds a cheat is named", () => {
  const plan = planOf(planArkApi(arkApiFile(), opts(fresh())));
  expect(noteWith(plan, "Vip is open and holds cheats: its members need no password")).toBeDefined();
  expect(noteWith(plan, "Admins is open")).toBeUndefined();
  expect(noteWith(plan, "Builders is open")).toBeUndefined();
});

test("a Cheat permission with no command here is named", () => {
  const plan = planOf(planArkApi(arkApiFile(), opts(fresh())));
  const note = noteWith(plan, "commands this game does not have");
  expect(note).toContain("Cheat.DestroyWildDinos");
  expect(note).not.toContain("Cheat.KickPlayer");
});

test("a file that is no database is a plain reason", () => {
  const perms = fresh();
  for (const bytes of [new TextEncoder().encode("not a database at all ".repeat(50)), new Uint8Array(0)]) {
    const planned = planArkApi(bytes, opts(perms));
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.reason).toContain("not an SQLite database");
  }
  const other = new Database(":memory:");
  other.exec("CREATE TABLE Things (Id INTEGER)");
  const planned = planArkApi(other.serialize(), opts(perms));
  other.close();
  expect(planned.ok).toBe(false);
  if (!planned.ok) expect(planned.reason).toContain("no Groups table");
  expect(planCrossChat("{ nope", opts(perms)).ok).toBe(false);
});

test("a database SQLite finds damaged is refused, not half read", () => {
  const bytes = new Uint8Array(arkApiFile());
  const whole = Database.deserialize(bytes, true);
  // An index no read of ours walks: only a check of the whole file finds it broken.
  const page = (whole.query("SELECT rootpage FROM sqlite_master WHERE name = 'sqlite_autoindex_Tribes_1'").get() as { rootpage: number }).rootpage;
  const size = (whole.query("PRAGMA page_size").get() as { page_size: number }).page_size;
  whole.close();
  bytes.fill(0xff, (page - 1) * size, page * size);
  const planned = planArkApi(bytes, opts(fresh()));
  expect(planned.ok).toBe(false);
  if (!planned.ok) expect(planned.reason).toContain("damaged");
});

test("a view called Groups is not read as the plugin's table", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE Hidden (GroupName TEXT, Permissions TEXT); INSERT INTO Hidden VALUES ('Sneak', '*,'); CREATE VIEW Groups AS SELECT GroupName, Permissions FROM Hidden;");
  const planned = planArkApi(db.serialize(), opts(fresh()));
  db.close();
  expect(planned.ok).toBe(false);
  if (!planned.ok) expect(planned.reason).toContain("no Groups table");
});

test("a value that is not text is no group and no permission", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE Groups (Id INTEGER PRIMARY KEY, GroupName, Permissions); CREATE TABLE Players (Id INTEGER PRIMARY KEY, SteamId, Groups, TimedGroups);");
  db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)").run(new Uint8Array([1, 2, 3]), "Build.Fast,");
  db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)").run("Vip", new Uint8Array([4, 5]));
  db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)").run(null, null);
  db.query("INSERT INTO Players (SteamId, Groups, TimedGroups) VALUES (?, ?, ?)").run(1, new Uint8Array([6]), null);
  const plan = planOf(planArkApi(db.serialize(), opts(fresh())));
  db.close();
  expect(plan.ops).toEqual([{ op: "addGroup", group: "Vip" }]);
});

test("the MySQL table names are read too", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE PermissionGroups (Id INTEGER PRIMARY KEY, GroupName TEXT, Permissions TEXT); CREATE TABLE TribePermissions (Id INTEGER PRIMARY KEY, TribeId INTEGER, Groups TEXT, TimedGroups TEXT);");
  db.exec("INSERT INTO PermissionGroups (GroupName, Permissions) VALUES ('Vip', 'ArkShop.Kits.vip,'); INSERT INTO TribePermissions (TribeId, Groups, TimedGroups) VALUES (55, 'Vip,', '');");
  const plan = planOf(planArkApi(db.serialize(), opts(fresh())));
  db.close();
  expect(plan.ops).toEqual([
    { op: "addGroup", group: "Vip" },
    { op: "grant", group: "Vip", permission: "ArkShop.Kits.vip" },
  ]);
  expect(noteWith(plan, "Vip: 1 membership left behind (1 tribe)")).toBeDefined();
});

test("applying a plan twice changes nothing the second time", () => {
  const perms = fresh();
  const plan = planOf(planCrossChat(SAMPLE, { ...opts(perms), onto: planOf(planArkApi(arkApiFile(), opts(perms))) }));
  applyPlan(perms, cluster, plan);
  const once = { groups: groupsOf(perms), documents: perms.snapshot().documents };
  applyPlan(perms, cluster, plan);
  expect({ groups: groupsOf(perms), documents: perms.snapshot().documents }).toEqual(once);
  expect(planOf(planArkApi(arkApiFile(), opts(perms))).ops).toEqual([]);
  expect(planOf(planCrossChat(SAMPLE, opts(perms))).ops).toEqual([]);
});

test("a refusal by the edit rule is reported and the rest still applies", () => {
  const perms = fresh();
  expect(perms.apply(cluster, { op: "setRank", group: "Admins", rank: RANK_MAP })).toBe("");
  const plan = planOf(planCrossChat(SAMPLE, opts(perms)));
  const applied = applyPlan(perms, admin, plan);
  expect(applied.refused.map((r) => [r.op.op, "group" in r.op ? r.op.group : ""])).toEqual([["setChat", "Admins"]]);
  expect(applied.done).toBe(plan.ops.length - 1);
  expect(perms.group("Default")!.chat).not.toBe("");
  expect(perms.group("Admins")!.chat).toBe("");
  expect(perms.document(CHAT_DOCUMENT)).not.toBe("");
});

test("a database from a server stopped cleanly gives its groups", () => {
  const bytes = stoppedFile();
  expect([bytes[18], bytes[19]]).toEqual([2, 2]);
  const plan = planOf(planArkApi(bytes, opts(fresh())));
  expect(added(plan)).toEqual(["Vip", "Builders"]);
  expect(noteWith(plan, "Vip: 2 memberships left behind (2 players; 1 timed)")).toBeDefined();
  expect(noteWith(plan, "Builders: 1 membership left behind (1 tribe)")).toBeDefined();
});

test("a database copied from a running server reads its newest groups from its -wal", () => {
  const { main, wal } = runningFiles();
  const plan = planOf(planArkApi(main, opts(fresh()), { wal }));
  expect(added(plan)).toEqual(["Vip", "Builders", "Late"]);
  expect(noteWith(plan, "Late: 1 membership left behind (1 player)")).toBeDefined();
  expect(noteWith(plan, "-wal")).toBeUndefined();
});

test("the same database without its -wal says where the newest changes are", () => {
  const plan = planOf(planArkApi(runningFiles().main, opts(fresh())));
  expect(added(plan)).toEqual(["Vip", "Builders"]);
  expect(noteWith(plan, "keeps its newest changes in the file beside it whose name ends in -wal until the ARK server is stopped")).toBeDefined();
  expect(noteWith(plan, "Stop the server first, or give that file too")).toBeDefined();
});

test("a -wal file that is not the database's own is said to be so", () => {
  const { main, wal } = runningFiles();
  const damaged = new Uint8Array(wal);
  damaged[40]! ^= 0xff;
  const logs: [string, Uint8Array][] = [
    ["another database's", otherLog()],
    ["one of another page size", runningFiles(1024, "Elsewhere").wal],
    ["a damaged one", damaged],
    ["not a log at all", new TextEncoder().encode("not a log ".repeat(100))],
  ];
  for (const [what, log] of logs) {
    const plan = planOf(planArkApi(main, opts(fresh()), { wal: log }));
    const said = noteWith(plan, "The -wal file does not belong to this database or is damaged") !== undefined;
    expect({ what, groups: added(plan), said }).toEqual({ what, groups: ["Vip", "Builders"], said: true });
  }
  const plan = planOf(planArkApi(arkApiFile(), opts(fresh()), { wal }));
  expect(noteWith(plan, "does not belong to this database")).toBeDefined();
});

test("a database in the default journal mode still reads, and writes no file", () => {
  const nowhere: ArkApiFiles = { folder: join(root, "no-such-folder") };
  expect(planOf(planArkApi(arkApiFile(), opts(fresh()), nowhere)).ops.length).toBeGreaterThan(0);
  expect(planArkApi(stoppedFile(), opts(fresh()), nowhere)).toMatchObject({ ok: false, reason: expect.stringContaining("could not open that database") });
  expect(existsSync(nowhere.folder!)).toBe(false);
});

test("no file or folder is left behind, also when a read fails", () => {
  const folder = join(root, "scratch");
  mkdirSync(folder);
  const { main, wal } = runningFiles();
  const plain = new Database(":memory:");
  plain.exec("CREATE TABLE Things (Id INTEGER)");
  const noGroups = new Uint8Array(plain.serialize());
  plain.close();
  noGroups[18] = 2;
  noGroups[19] = 2;
  const cut = main.subarray(0, 600);
  const cases: [Uint8Array, Uint8Array | undefined, boolean][] = [
    [stoppedFile(), undefined, true],
    [main, wal, true],
    [main, undefined, true],
    [main, otherLog(), true],
    [arkApiFile(), wal, true],
    [noGroups, wal, false],
    [noGroups, undefined, false],
    [cut, wal, false],
  ];
  for (const [bytes, log, ok] of cases) {
    expect(planArkApi(bytes, opts(fresh()), { wal: log, folder }).ok).toBe(ok);
    expect(readdirSync(folder)).toEqual([]);
  }
});

/** A pasted list that makes `groups` groups, each holding one permission. */
const manyGroups = (groups: number): string => Array.from({ length: groups }, (_, i) => `Permissions.Grant Group${i} Kit.k${i}`).join("\n");

test("a plan is applied in one write, however many changes it makes", () => {
  const store = new PermissionStore(":memory:");
  const perms = new Permissions({ store, world: 3 });
  const plan = planOf(planCommands(manyGroups(40), opts(perms)));
  expect(plan.ops.length).toBe(80);
  const writes = spyOn(store, "transaction");
  const before = perms.version;
  const applied = applyPlan(perms, cluster, plan);
  expect([applied.done, applied.refused, writes.mock.calls.length]).toEqual([80, [], 1]);
  writes.mockRestore();
  // Each change still has its own row of history and its own revision, and the view moved once.
  expect(perms.history(undefined, 200).map((row) => row.revision).sort((a, b) => a - b)).toEqual(Array.from({ length: 80 }, (_, i) => perms.snapshot().revision - 79 + i));
  expect([perms.version - before, perms.group("Group39")?.permissions]).toEqual([1, ["Kit.k39"]]);
});

test("a plan's write that fails leaves none of its changes, in the file or the view", () => {
  const file = join(root, "half.sqlite");
  const store = new PermissionStore(file);
  const perms = new Permissions({ store, world: 3 });
  const plan = planOf(planCommands(manyGroups(5), opts(perms)));
  const raise = store.raise.bind(store);
  let raised = 0;
  store.raise = () => {
    if (++raised === 4) throw new Error("the disk is full");
    return raise();
  };
  const applied = applyPlan(perms, cluster, plan);
  store.raise = raise;
  expect([applied.done, applied.refused.length, applied.refused[0]?.reason]).toEqual([0, 10, "The permissions could not be written."]);
  expect([perms.groups().map((g) => g.name), perms.history().length]).toEqual([["Default", "Admins"], 0]);
  const other = new Permissions({ store: new PermissionStore(file), world: 5 });
  expect(other.groups().map((g) => g.name)).toEqual(["Default", "Admins"]);
});

test("an import of more changes than one may make is refused at the check", () => {
  const perms = fresh();
  const most = planCommands(manyGroups(IMPORT_CHANGES_MOST / 2), opts(perms));
  expect(most.ok && most.plan.ops.length).toBe(IMPORT_CHANGES_MOST);
  const over = planCommands(manyGroups(IMPORT_CHANGES_MOST / 2 + 1), opts(perms));
  expect(over.ok).toBe(false);
  if (!over.ok) expect(over.reason).toBe(`That import would make ${IMPORT_CHANGES_MOST + 2} changes, and one import makes ${IMPORT_CHANGES_MOST} at most. Bring it in as several.`);
});

test("the largest import holds the server for a moment, not for seconds", () => {
  const file = join(root, "largest.sqlite");
  const perms = new Permissions({ store: new PermissionStore(file), world: 3 });
  const plan = planOf(planCommands(manyGroups(IMPORT_CHANGES_MOST / 2), opts(perms)));
  const from = performance.now();
  const applied = applyPlan(perms, cluster, plan);
  const ms = performance.now() - from;
  expect(applied.done).toBe(IMPORT_CHANGES_MOST);
  // On a file, with its commit: a tick is 33 ms, and the old way took four of them for each change.
  expect(ms).toBeLessThan(500);
});

test("an import never writes over a whole value another map changed since it was planned", () => {
  const file = join(root, "stale.sqlite");
  const clock = { t: 1_000_000 };
  const two = new Permissions({ store: new PermissionStore(file), world: 2, now: () => clock.t });
  const five = new Permissions({ store: new PermissionStore(file), world: 5, now: () => clock.t });
  const tag = (name: string) => ({ Priority: 1, Icon: "", Text: `[${name}]`, CanBeDisabled: true });
  const first = JSON.stringify({ ChatTags: { StackChatTags: true, Old: tag("Old") }, MutedPermissionGroup: "", MapColors: {} });
  expect(two.apply(cluster, { op: "setDocument", name: "chat", text: first })).toBe("");
  clock.t += 6000;
  five.poll();
  // World 2 plans an import that adds a tag. World 5 then adds another, and world 2 has not looked at the file since.
  const plan = planOf(planCrossChat(JSON.stringify({ ChatTags: { VIP: tag("VIP") } }), opts(two)));
  const added = JSON.stringify({ ChatTags: { StackChatTags: true, Old: tag("Old"), Elders: tag("Elders") }, MutedPermissionGroup: "", MapColors: {} });
  expect(five.apply(cluster, { op: "setDocument", name: "chat", text: added, was: first })).toBe("");
  const applied = applyPlan(two, cluster, plan);
  expect(applied.refused.map((r) => [r.op.op, r.reason])).toEqual([["setDocument", CHANGED_MEANWHILE]]);
  expect(new PermissionStore(file).read().documents.find((d) => d.name === "chat")!.text).toBe(added);
  // Planned from the file as it is now, as the page's check and apply plan after a look at it, it loses nothing.
  two.lookNow();
  const fresh = planOf(planCrossChat(JSON.stringify({ ChatTags: { VIP: tag("VIP") } }), opts(two)));
  expect(applyPlan(two, cluster, fresh).refused).toEqual([]);
  const text = new PermissionStore(file).read().documents.find((d) => d.name === "chat")!.text;
  expect(["Old", "Elders", "VIP"].map((name) => text.includes(`"${name}"`))).toEqual([true, true, true]);
});

test("an import's notes are cut short, however many lines it was given", () => {
  const perms = fresh();
  const planned = planCommands(Array.from({ length: 5000 }, (_, i) => `nonsense ${i}`).join("\n"), opts(perms));
  const plan = planOf(planned);
  expect(plan.notes.length).toBe(IMPORT_NOTES_MOST + 1);
  expect(plan.notes.at(-1)).toBe(`And ${5000 - IMPORT_NOTES_MOST} more notes like these.`);
});

test("a look at the file now reads another world's change without waiting for the poll", () => {
  const file = join(root, "look.sqlite");
  const clock = { t: 1_000_000 };
  const two = new Permissions({ store: new PermissionStore(file), world: 2, now: () => clock.t });
  const five = new Permissions({ store: new PermissionStore(file), world: 5, now: () => clock.t });
  two.poll();
  expect(five.apply(cluster, { op: "addGroup", group: "Vip" })).toBe("");
  expect([two.poll(), two.group("Vip")]).toEqual([false, undefined]);
  expect([two.lookNow(), two.group("Vip")?.name, two.lookNow()]).toEqual([true, "Vip", false]);
});

test("a pasted rank change over another admin's change is refused as changed meanwhile", () => {
  const file = join(root, "rank.sqlite");
  const two = new Permissions({ store: new PermissionStore(file), world: 2 });
  const five = new Permissions({ store: new PermissionStore(file), world: 5 });
  expect(two.apply(cluster, { op: "addGroup", group: "Mods", rank: RANK_STAFF })).toBe("");
  const plan = planOf(planCommands("Permissions.Rank Mods admin", opts(two)));
  expect(plan.ops).toEqual([{ op: "setRank", group: "Mods", rank: RANK_ADMIN, was: RANK_STAFF }]);
  expect(five.apply(cluster, { op: "setRank", group: "Mods", rank: RANK_MAP })).toBe("");
  expect(two.makeAll(cluster, plan.ops).map((m) => m.why)).toEqual([CHANGED_MEANWHILE]);
  expect(new PermissionStore(file).read().groups.find((g) => g.name === "Mods")?.rank).toBe(RANK_MAP);
});

test("a -wal that SQLite takes is read whole, and its plan's refusal is said", () => {
  const path = join(root, `crowded-${++files}.db`);
  const db = pluginDatabase(path);
  db.exec("PRAGMA wal_autocheckpoint=0;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const group = db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)");
  for (let i = 0; i <= IMPORT_CHANGES_MOST / 2; i++) group.run(`Late${i}`, `Kit.k${i},`);
  const main = readFileSync(path);
  const wal = readFileSync(`${path}-wal`);
  db.close();
  removeDatabase(path);
  expect(planArkApi(main, opts(fresh())).ok).toBe(true);
  const both = planArkApi(main, opts(fresh()), { wal });
  expect(both).toEqual({ ok: false, reason: expect.stringContaining(`one import makes ${IMPORT_CHANGES_MOST} at most`) });
});
