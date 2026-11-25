// The permissions store's register of every survivor ID issued and each world's marks. A save put back from a backup or
// started afresh never hands out an ID or a team number again, so nobody inherits a lost survivor's or tribe's groups.
import { Database } from "bun:sqlite";
import { afterAll, expect, spyOn, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR } from "../../server/acts.ts";
import { POLL_MS } from "../../server/permissions/permissions.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { TEAM_RANGE } from "../../server/records.ts";
import { idText } from "../../server/survivor-ids.ts";
import { ID_COUNT_RANGE, idOf, idParts } from "../../shared/ids.ts";
import { TestCluster, beat, rec } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const NO_STAFF = "You are in no staff group, so there is no password to claim. An admin puts you in one first.";
const LOCKED = "the permissions register could not be written: it is tried again in 5 s";
const behind = (what: string, from: number, was: number): string => `the save is behind the permissions register: ${what} numbers go on from ${from}, not ${was}`;

const root = mkdtempSync(join(tmpdir(), "snark-register-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let saves = 0;
const freshDb = (): string => join(root, `w${++saves}.db`);

function world(db: string, said: string[], wall?: () => number): Harness {
  return new Harness({}, 1, 60, { dbPath: db, log: (line) => said.push(line), ...(wall ? { survivorLog: { wall } } : {}) });
}

const recOf = (h: Harness, s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
const idOfSession = (h: Harness, s: ClientSession): string => idText(recOf(h, s));
const groupsOf = (h: Harness, s: ClientSession): string[] => h.host.permissions.groupsOf(h.host.subjectOf(h.client(s)!)!).map((g) => g.name);

function joined(h: Harness, name: string): ClientSession {
  const s = h.join(name);
  h.run(500);
  return s;
}

/** The operator's line, which must be done. */
function op(h: Harness, line: string): string {
  const out = h.host.exec(line);
  if (/^(There|That|No |denied)/.test(out)) throw new Error(`${line}: ${out}`);
  return out;
}

/** A copy of the save at its last commit, as a backup holds it. */
function backup(h: Harness, as: string): string {
  h.host.persistence!.commit();
  h.host.persistence!.store.db.query("VACUUM INTO ?").run(as);
  return as;
}

/** Puts a copy in place of the save, whose server has stopped. */
function putBack(db: string, copy: string): void {
  for (const end of ["", "-wal", "-shm"]) rmSync(`${db}${end}`, { force: true });
  copyFileSync(copy, db);
}

test("a restored save gives its next survivor an ID no earlier survivor had", () => {
  const db = freshDb();
  const said: string[] = [];
  let h = world(db, said);
  joined(h, "ada");
  joined(h, "bob");
  const copy = backup(h, join(root, "restore-backup.db"));
  const cyd = joined(h, "cyd");
  const cydId = idOfSession(h, cyd);
  expect(op(h, "Permissions.Add cyd Admins")).toStartWith(`cyd (${cydId}) is in Admins`);
  h.say(cyd, "claimpassword");
  expect(h.host.permissions.secretOf(cydId)).not.toBe("");
  h.host.shutdown();
  putBack(db, copy);
  said.length = 0;
  h = world(db, said);
  expect(said).toContain(behind("survivor", 4, 3));
  // The operator is told who was lost and still holds something: only they can decide whether it should stay.
  expect(said).toContain(`the save no longer has cyd (${cydId}), who is still in Admins and has a password: Permissions.Remove and Permissions.Password ${cydId} clear take those away`);
  expect(said.filter((line) => line.includes("the save no longer has")).length).toBe(1);
  const dan = joined(h, "dan");
  const danId = idOfSession(h, dan);
  expect(danId).toBe(idOf(1, 4));
  expect(groupsOf(h, dan)).toEqual(["Default"]);
  expect(h.host.permissions.secretOf(danId)).toBe("");
  expect(h.say(dan, "claimpassword")).toEqual([NO_STAFF]);
  // The lost survivor's membership is kept: its ID is still its own.
  expect(h.host.permissions.membersOf("survivor", cydId).map((m) => m.group)).toEqual(["Admins"]);
  h.host.shutdown();
});

test("a restored save gives its next tribe a number no earlier tribe had", () => {
  const db = freshDb();
  const said: string[] = [];
  let h = world(db, said);
  joined(h, "ada");
  const copy = backup(h, join(root, "restore-team-backup.db"));
  const cyd = joined(h, "cyd");
  expect(h.host.tribes.create(recOf(h, cyd), "Raptors")).toBe("");
  const team = recOf(h, cyd).team;
  op(h, "Permissions.AddGroup Vip");
  op(h, "Permissions.Grant Vip Kit.vip");
  expect(op(h, `Permissions.AddTribe ${team} Vip`)).toStartWith(`Raptors (${team}) is in Vip`);
  h.host.shutdown();
  putBack(db, copy);
  said.length = 0;
  h = world(db, said);
  expect(said).toContain(behind("team", 3, 2));
  const dan = joined(h, "dan");
  expect(h.host.tribes.create(recOf(h, dan), "Dans")).toBe("");
  expect(recOf(h, dan).team).toBe(TEAM_RANGE + 3);
  expect(h.host.permissions.has(h.host.subjectOf(h.client(dan)!)!, "Kit.vip")).toBe(false);
  expect(h.host.permissions.membersOf("tribe", String(team))).toHaveLength(1);
  h.host.shutdown();
});

test("a fresh save over a kept permissions file numbers on from the register", () => {
  const db = freshDb();
  const said: string[] = [];
  let h = world(db, said);
  const ada = joined(h, "ada");
  const adaId = idOfSession(h, ada);
  const adaTeam = recOf(h, ada).team;
  op(h, "Permissions.Add ada Admins");
  h.host.shutdown();
  // The world is wiped: its save goes, and the permissions file beside it stays.
  for (const end of ["", "-wal", "-shm"]) rmSync(`${db}${end}`, { force: true });
  said.length = 0;
  h = world(db, said);
  expect(said).toEqual(expect.arrayContaining([behind("survivor", 2, 1), behind("team", 2, 1)]));
  const bea = joined(h, "bea");
  expect(idOfSession(h, bea)).toBe(idOf(1, 2));
  expect(recOf(h, bea).team).not.toBe(adaTeam);
  expect(groupsOf(h, bea)).toEqual(["Default"]);
  expect(h.say(bea, "claimpassword")).toEqual([NO_STAFF]);
  expect(h.host.permissions.membersOf("survivor", adaId)).toHaveLength(1);
  h.host.shutdown();
});

test("a grant to an ID or a team number never made is refused", () => {
  const h = new Harness({}, 1, 60, { log: () => {} });
  const ada = joined(h, "ada");
  const ghost = idOf(1, 999);
  expect(h.host.exec(`Permissions.Add ${ghost} Admins`)).toBe(`No survivor has the ID ${ghost}.`);
  expect(h.host.changePermissions(OPERATOR, { op: "addMember", kind: "survivor", key: ghost, group: "Admins" })).toBe(`No survivor has the ID ${ghost}.`);
  op(h, "Permissions.AddGroup Vip");
  const team = String(TEAM_RANGE + 999);
  expect(h.host.exec(`Permissions.AddTribe ${team} Vip`)).toBe(`No tribe has the number ${team}.`);
  // Ada's own ID and team were made, and may be granted.
  expect(op(h, `Permissions.Add ${idOfSession(h, ada)} Vip`)).toStartWith("ada (");
  expect(op(h, `Permissions.AddTribe ${recOf(h, ada).team} Vip`)).toStartWith(`tribe ${recOf(h, ada).team} is in Vip`);
  expect(h.host.permissions.membersIn("Vip")).toHaveLength(2);
  h.host.shutdown();
});

test("a module's grant for a survivor whose ID was never issued is refused", () => {
  const ears = listener("ears", []);
  const h = new Harness({}, 1, 60, { modules: [ears.def], log: () => {} });
  const ada = joined(h, "ada");
  const me = recOf(h, ada);
  const m = ears.heard.context!;
  expect(m.act.addToGroup(me.pid, "Admins")).toBe("");
  // A number written on the record by hand, which no world issued.
  me.sid = 1 * ID_COUNT_RANGE + 777;
  expect(m.act.addToGroup(me.pid, "Admins")).toBe(`No survivor has the ID ${idOf(1, 777)}.`);
  h.host.shutdown();
});

test("a grant in the very tick a survivor is made is taken", () => {
  const h = new Harness({}, 1, 60, { log: () => {} });
  const answers: string[] = [];
  // Heard right after the host made the survivor, before the tick's register write.
  h.host.game.sessions.onBody.on((c) => {
    const id = idText(h.host.records.byPid.get(c.pid)!);
    answers.push(h.host.changePermissions(OPERATOR, { op: "addMember", kind: "survivor", key: id, group: "Admins" }));
  });
  const ada = joined(h, "ada");
  expect(answers).toEqual([""]);
  expect(h.host.permissions.membersOf("survivor", idOfSession(h, ada)).map((m) => m.group)).toEqual(["Admins"]);
  h.host.shutdown();
});

test("a survivor of one map is put in a group on another by ID and by name", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const host = { survivorLog: { wall: () => clock.ms } };
    const a = cluster.server("a", "f", clock, { host });
    const b = cluster.server("b", "f", clock, { host });
    beat(a, b);
    cluster.survivor(a, "bob");
    const id = idText(rec(a, "bob")!);
    expect(b.h.host.survivorById(id)).toBeNull();
    expect(b.h.host.exec("Permissions.AddGroup Vip")).toBe("made the group Vip");
    expect(b.h.host.exec(`Permissions.Add ${id} Vip`)).toBe(`bob (${id}) is in Vip on every map. bob is on another map, a.`);
    expect(b.h.host.exec("Permissions.Remove bob Vip")).toBe(`bob (${id}) is out of Vip. bob is on another map, a.`);
    expect(b.h.host.exec("Permissions.Add Bob Vip")).toBe(`bob (${id}) is in Vip on every map. bob is on another map, a.`);
    expect(b.h.host.exec("Permissions.PlayerGroups bob")).toBe(`bob (${id}):\nVip: for good, on every map`);
    // Two of that name elsewhere, and the ID is asked for.
    cluster.survivor(b, "ada");
    expect(a.h.host.exec("Permissions.Add ada Vip")).toStartWith("ada (");
    const c = cluster.server("c", "f", clock, { host });
    cluster.survivor(c, "ada");
    expect(a.h.host.exec("Permissions.Add ada Vip")).toBe('2 survivors are called "ada": give the ID of the one you mean.');
    // A name nobody has, here or elsewhere.
    expect(b.h.host.exec("Permissions.Add zed Vip")).toBe('There is no survivor called "zed" on this map: give their ID.');
  } finally {
    cluster.cleanup();
  }
});

test("rows that named an ID before it was made are gone once it is made", () => {
  const db = freshDb();
  const file = `${db}.permissions.sqlite`;
  const ada = idOf(1, 1);
  // A permissions file holding rows for an ID no survivor has had, as one written by hand or by a tool.
  new PermissionStore(file).read();
  const raw = new Database(file);
  raw.exec(
    `INSERT INTO members VALUES ('survivor', '${ada}', 'Admins', 0, 1, 0, 0);` +
      `INSERT INTO secrets VALUES ('${ada}', 'abcdef0123456789', 0);` +
      `INSERT INTO tags VALUES ('${ada}', 'VIP', 0);` +
      "UPDATE meta SET revision = revision + 1;",
  );
  raw.close();
  const said: string[] = [];
  const h = world(db, said);
  const p = h.host.permissions;
  expect([p.membersOf("survivor", ada).length, p.secretOf(ada) !== ""]).toEqual([1, true]);
  const revision = p.snapshot().revision;
  const s = joined(h, "ada");
  expect(idOfSession(h, s)).toBe(ada);
  expect([p.membersOf("survivor", ada), p.secretOf(ada), p.tagChoice(ada, "VIP")]).toEqual([[], "", undefined]);
  expect(groupsOf(h, s)).toEqual(["Default"]);
  expect(p.snapshot().revision).toBeGreaterThan(revision);
  const stored = new PermissionStore(file).read();
  expect([stored.members, stored.secrets, stored.tags]).toEqual([[], [], []]);
  expect(said).toContain("the permissions register took out 3 rows that named survivor IDs or team numbers before they were made");
  h.host.shutdown();
});

test("a store from before the register keeps its tribes' memberships on the first run", () => {
  const db = freshDb();
  const file = `${db}.permissions.sqlite`;
  let h = world(db, []);
  const ada = joined(h, "ada");
  expect(h.host.tribes.create(recOf(h, ada), "Raptors")).toBe("");
  const team = String(recOf(h, ada).team);
  op(h, "Permissions.AddGroup Vip");
  op(h, `Permissions.AddTribe ${team} Vip`);
  h.host.shutdown();
  // As a file made before the register was kept.
  const raw = new Database(file);
  raw.exec("DROP TABLE issued; DROP TABLE marks;");
  raw.close();
  h = world(db, []);
  h.run(200);
  expect(h.host.permissions.membersOf("tribe", team)).toHaveLength(1);
  expect(h.host.permissions.marks(1)).toEqual({ survivor: 2, team: 2 });
  joined(h, "bea");
  expect(h.host.permissions.membersOf("tribe", team)).toHaveLength(1);
  expect(h.host.permissions.issued(idOf(1, 1))?.name).toBe("ada");
  h.host.shutdown();
});

test("two maps over one store keep their own marks and do not reload for them", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const host = { survivorLog: { wall: () => clock.ms } };
    const a = cluster.server("a", "f", clock, { host });
    const b = cluster.server("b", "f", clock, { host });
    beat(a, b);
    clock.ms += POLL_MS;
    b.h.run(100);
    const version = b.h.host.permissions.version;
    cluster.survivor(a, "bob");
    cluster.survivor(a, "cyd");
    expect(a.h.host.permissions.marks(a.world)).toEqual({ survivor: 3, team: 3 });
    expect(b.h.host.permissions.marks(b.world)).toEqual({ survivor: 1, team: 1 });
    clock.ms += POLL_MS;
    b.h.run(100);
    expect(b.h.host.permissions.version).toBe(version);
    expect(b.h.host.permissions.issued(idText(rec(a, "bob")!))?.world).toBe(a.world);
  } finally {
    cluster.cleanup();
  }
});

test("a register write that fails is tried again later, not every tick", () => {
  const db = freshDb();
  const file = `${db}.permissions.sqlite`;
  const clock = { ms: 1_000_000 };
  const said: string[] = [];
  const h = world(db, said, () => clock.ms);
  h.run(100);
  const tries = spyOn(h.host.permissions, "register");
  const lock = new Database(file);
  lock.exec("BEGIN EXCLUSIVE");
  try {
    const ada = joined(h, "ada");
    h.run(500);
    expect(tries).toHaveBeenCalledTimes(1);
    expect(said.filter((l) => l === LOCKED)).toHaveLength(1);
    const id = idOfSession(h, ada);
    lock.exec("ROLLBACK");
    clock.ms += POLL_MS - 1;
    h.run(100);
    expect(tries).toHaveBeenCalledTimes(1);
    clock.ms += 1;
    h.run(100);
    expect(tries).toHaveBeenCalledTimes(2);
    expect(h.host.permissions.issued(id)?.name).toBe("ada");
    expect(idParts(id)).toEqual({ world: 1, n: 1 });
  } finally {
    lock.close();
    tries.mockRestore();
    h.host.shutdown();
  }
});
