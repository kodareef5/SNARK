// A survivor's own password: issued by an admin, kept as a hash, and given in game or on the admin pages to switch on the
// survivor's groups of staff rank and above. Replacing or clearing one ends its sign-ins, and an open page that still sends
// it is not taken for a guesser.
import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR, sessionActor } from "../../server/acts.ts";
import { actorOf, refused, type AdminGate } from "../../server/admin/gate.ts";
import { ServerLog, teeConsole } from "../../server/log.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { passwordHash, passwordText, staffPasswords } from "../../server/permissions/secrets.ts";
import { Rules } from "../../server/settings/rules.ts";
import { idText } from "../../server/survivor-ids.ts";
import { CHEAT_GUESSES, WRONG_PASSWORD } from "../../shared/console.ts";
import { idOf } from "../../shared/ids.ts";
import { RANK_ADMIN, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { TestCluster, rec } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const MAP = "map-kiwi";
const PASSWORD = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
const RETIRED = "that password was replaced or cleared";

// A built client, as far as a server needs one: the manifest and the files it names.
const dir = mkdtempSync(join(tmpdir(), "snark-staff-"));
const { files, manifest } = splitPack(corePackBytes(), "core");
mkdirSync(join(dir, "assets"));
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
mkdirSync(join(dir, "admin"));
const running: RunningServer[] = [];
afterAll(() => {
  for (const s of running) s.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** A world with no development cheats, the map's password if given, and one survivor joined without cheats. */
function world(opts: { password?: string; creative?: boolean } = {}): { h: Harness; ada: ClientSession } {
  const config = opts.creative ? asShipped(new Rules()) : undefined;
  const h = new Harness({}, 1, 60, { adminPassword: opts.password, config, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  return { h, ada };
}

const idOfSession = (h: Harness, s: ClientSession): string => idText(h.host.records.byPid.get(h.client(s)!.pid)!);

/** The operator's line, which must be done: its answer says so. */
function op(h: Harness, line: string): string {
  const out = h.host.exec(line);
  if (/^(There|That|denied)/.test(out)) throw new Error(`${line}: ${out}`);
  return out;
}

/** A password the operator issues to `s`. */
const issue = (h: Harness, s: ClientSession): string => {
  const { why, password } = h.host.issuePassword(OPERATOR, idOfSession(h, s));
  if (why !== "") throw new Error(why);
  return password;
};

/** The admin pages' gate of a harness's world, sharing its guess count. */
function gateOf(h: Harness, password: string | null = h.host.adminPassword): AdminGate {
  return { dev: false, password, cluster: null, guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick, staff: staffPasswords(h.host) };
}

function asked(user: string, password?: string): Request {
  const headers: Record<string, string> = password === undefined ? {} : { authorization: `Basic ${btoa(`${user}:${password}`)}` };
  return new Request("http://localhost/admin/", { headers });
}

const status = (g: AdminGate, req: Request, who = "1.2.3.4"): number => refused(req, who, g)?.status ?? 200;

test("an issued password signs its survivor in, in the game and on the pages", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const c = h.client(ada)!;
  expect([c.admin, c.rank, c.signed]).toEqual([false, RANK_OPEN, false]);
  const password = issue(h, ada);
  expect(password).toMatch(PASSWORD);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  const act = h.host.acts.recent().at(-1)!;
  expect([act.name, act.id, act.kind, act.what]).toEqual(["ada", idOfSession(h, ada), "sign-in", "enablecheats with their own password"]);
  expect([c.admin, c.rank, c.signed, h.say(ada, "god")]).toEqual([true, RANK_ADMIN, true, ["god on"]]);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats are already enabled"]);

  const g = gateOf(h);
  for (const user of ["ada", idOfSession(h, ada)]) {
    const req = asked(user, password);
    expect(status(g, req)).toBe(200);
    const by = actorOf(req);
    expect([by.name, by.id, by.pid, by.rank, by.via]).toEqual(["ada", idOfSession(h, ada), c.pid, RANK_ADMIN, "page"]);
  }
  h.host.shutdown();
});

test("a password typed with spaces, dashes or in lower case still signs in", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const password = issue(h, ada);
  const g = gateOf(h);
  for (const typed of [password.toLowerCase(), password.replaceAll("-", ""), password.replaceAll("-", " "), ` ${password.slice(0, 9)} ${password.slice(9).toLowerCase()} `]) {
    expect(status(g, asked("ada", typed)), typed).toBe(200);
  }
  expect(h.say(ada, `enablecheats ${password.toLowerCase().replaceAll("-", " ")}`)).toEqual(["cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_ADMIN);
  h.host.shutdown();
});

test("a regular admin can neither issue to nor clear the password of a map admin", () => {
  const { h, ada } = world();
  const bob = h.join("bob");
  h.run(500);
  op(h, "Permissions.AddGroup Owners");
  op(h, "Permissions.Rank Owners map");
  op(h, "Permissions.Add bob Owners");
  op(h, "Permissions.Add ada Admins");
  const bobs = issue(h, bob);
  expect(h.say(ada, `enablecheats ${issue(h, ada)}`)).toEqual(["cheats enabled"]);
  const regular = sessionActor(h.client(ada)!, h.host.records);
  expect(regular.rank).toBe(RANK_ADMIN);
  const higher = "That survivor holds a higher rank than yours.";
  expect(h.host.issuePassword(regular, idOfSession(h, bob))).toEqual({ why: higher, password: "" });
  expect(h.host.clearPassword(regular, idOfSession(h, bob))).toBe(higher);
  expect(h.say(ada, "Permissions.Password bob clear")).toEqual([higher]);
  expect(h.say(ada, "Permissions.Password bob")).toEqual(["A password is issued on the admin pages or at the server's terminal."]);
  // Bob's own password still stands.
  expect(h.say(bob, `enablecheats ${bobs}`)).toEqual(["cheats enabled"]);
  expect(h.client(bob)!.rank).toBe(RANK_MAP);
  h.host.shutdown();
});

test("a wrong name, a name with no password and a wrong password answer alike", async () => {
  const { h, ada } = world();
  h.join("bob");
  h.run(500);
  op(h, "Permissions.Add ada Admins");
  op(h, "Permissions.Add bob Admins");
  const password = issue(h, ada);
  const g = gateOf(h);
  const answers = [refused(asked("nobody", password), "1.2.3.4", g)!, refused(asked("bob", password), "1.2.3.4", g)!, refused(asked("ada", "ABCD-EFGH-JKLM-NPQR"), "1.2.3.4", g)!];
  const read = async (r: Response): Promise<[number, string, string | null]> => [r.status, await r.text(), r.headers.get("www-authenticate")];
  const [first, ...rest] = await Promise.all(answers.map(read));
  expect(first![0]).toBe(401);
  for (const r of rest) expect(r).toEqual(first!);
  // Each was one wrong guess: the right password now waits.
  expect(status(g, asked("ada", password))).toBe(429);
  h.host.shutdown();
});

test("a survivor whose groups give less than admin rank is refused the pages", () => {
  const { h, ada } = world();
  op(h, "Permissions.AddGroup Mods");
  op(h, "Permissions.Rank Mods staff");
  op(h, "Permissions.Grant Mods *");
  op(h, "Permissions.Add ada Mods");
  const password = issue(h, ada);
  const g = gateOf(h);
  expect([status(g, asked("ada", password)), status(g, asked("ada", password)), status(g, asked("ada", password))]).toEqual([401, 401, 401]);
  // Refused as a wrong password is, and counted as one.
  expect(status(g, asked("ada", password))).toBe(429);
  // In game the same password signs in at the staff rank.
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect([h.client(ada)!.rank, h.client(ada)!.admin]).toEqual([RANK_STAFF, true]);
  h.host.shutdown();
});

test("a cleared password stops working and its sessions lose their cheats at once", () => {
  const { h, ada } = world({ password: MAP });
  op(h, "Permissions.Add ada Admins");
  const password = issue(h, ada);
  const c = h.client(ada)!;
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect(h.say(ada, "fly")).toEqual(["flying"]);
  expect(h.host.exec("Permissions.Password ada clear")).toBe(`ada (${idOfSession(h, ada)}) has no password now`);
  expect([c.admin, c.rank, c.signed]).toEqual([false, RANK_OPEN, false]);
  expect(h.say(ada, "god")).toEqual(["denied: cheats are not enabled for you"]);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual([RETIRED]);
  expect(status(gateOf(h), asked("ada", password))).toBe(401);
  expect(h.host.exec("Permissions.Password ada clear")).toBe(`${idOfSession(h, ada)} has no password.`);
  h.host.shutdown();
});

test("a replaced password stops working, and the new one works", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const old = issue(h, ada);
  const c = h.client(ada)!;
  expect(h.say(ada, `enablecheats ${old}`)).toEqual(["cheats enabled"]);
  const next = issue(h, ada);
  expect(next).not.toBe(old);
  expect([c.admin, c.signed]).toEqual([false, false]);
  expect(h.say(ada, `enablecheats ${old}`)).toEqual([RETIRED]);
  const g = gateOf(h);
  expect([status(g, asked("ada", old)), status(g, asked("ada", next))]).toEqual([401, 200]);
  expect(h.say(ada, `enablecheats ${next}`)).toEqual(["cheats enabled"]);
  expect([c.admin, c.rank]).toEqual([true, RANK_ADMIN]);
  h.host.shutdown();
});

test("a retired password still sent by an open page is not counted as a guess", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const old = issue(h, ada);
  const g = gateOf(h);
  expect(status(g, asked("ada", old))).toBe(200);
  const next = issue(h, ada);
  for (let i = 0; i < 20; i++) expect(status(g, asked("ada", old))).toBe(401);
  expect(status(g, asked("ada", next))).toBe(200);
  // Nor in game, where enough wrong passwords end the connection.
  for (let i = 0; i < CHEAT_GUESSES + 2; i++) expect(h.say(ada, `enablecheats ${old}`)).toEqual([RETIRED]);
  expect(h.client(ada)!.cheatAttempts).toBe(0);
  // A wrong one is still counted.
  for (let i = 0; i < 3; i++) expect(status(g, asked("ada", "ABCD-EFGH-JKLM-NPQR"))).toBe(401);
  expect(status(g, asked("ada", next))).toBe(429);
  h.host.shutdown();
});

test("a survivor's own password forgives no guess at the map's password", () => {
  const { h, ada } = world({ password: MAP });
  op(h, "Permissions.Add ada Admins");
  const password = issue(h, ada);
  const who = h.client(ada)!.conn.address ?? "ada";
  const shared = gateOf(h);
  expect([h.say(ada, "enablecheats plum"), h.say(ada, "enablecheats plum"), h.say(ada, `enablecheats ${password}`)].map((r) => r[0])).toEqual([WRONG_PASSWORD, WRONG_PASSWORD, "cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_ADMIN);
  expect(status(shared, asked("x", "plum"), who)).toBe(401);
  expect(h.say(ada, `enablecheats ${MAP}`)[0]).toStartWith("too many wrong passwords");
  h.host.shutdown();

  // Where no host password stands above the rank it gave, it forgives.
  const alone = world();
  op(alone.h, "Permissions.Add ada Admins");
  const mine = issue(alone.h, alone.ada);
  const by = alone.h.client(alone.ada)!.conn.address ?? "ada";
  const g = gateOf(alone.h);
  expect([alone.h.say(alone.ada, "enablecheats plum"), alone.h.say(alone.ada, "enablecheats plum"), alone.h.say(alone.ada, `enablecheats ${mine}`)].map((r) => r[0])).toEqual([WRONG_PASSWORD, WRONG_PASSWORD, "cheats enabled"]);
  expect([status(g, asked("x", "plum"), by), status(g, asked("x", "plum"), by), status(g, asked("ada", mine), by)]).toEqual([401, 401, 200]);
  alone.h.host.shutdown();
});

test("a creative-for-all survivor can still sign in with their own password", () => {
  const { h, ada } = world({ creative: true });
  const bob = h.join("bob");
  h.run(500);
  const c = h.client(ada)!;
  expect([c.admin, c.rank]).toEqual([true, RANK_STAFF]);
  op(h, "Permissions.Add ada Admins");
  const password = issue(h, ada);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect([c.admin, c.rank, c.signed]).toEqual([true, RANK_ADMIN, true]);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats are already enabled"]);
  // One with no password of its own has nothing more to gain.
  expect(h.say(bob, "enablecheats anything")).toEqual(["cheats are already enabled"]);
  h.host.shutdown();
});

test("a survivor whose groups count on no map here is told so as it signs in", () => {
  const { h, ada } = world();
  const password = issue(h, ada);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["signed in, but no group of yours counts on this map"]);
  expect([h.client(ada)!.signed, h.client(ada)!.admin]).toEqual([true, false]);
  const bob = h.join("bob");
  h.run(500);
  expect(h.say(bob, "enablecheats anything")).toEqual(["cheats are disabled on this server"]);
  h.host.shutdown();
});

test("a world with only issued passwords opens its pages and asks for one", async () => {
  const s = startServer({ port: 0, clientDir: dir, probeScene: true });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  const me = (auth?: string): Promise<Response> => fetch(`${at}/admin/me.json`, { headers: auth ? { authorization: `Basic ${btoa(auth)}` } : {} });
  expect((await me()).status).toBe(404);
  // A survivor of another world of the cluster, whom this world knows by ID alone.
  const id = idOf(7, 12);
  expect(s.host.exec(`Permissions.Add ${id} Admins`)).toStartWith(`${id} is in Admins.`);
  const { why, password } = s.host.issuePassword(OPERATOR, id);
  expect(why).toBe("");
  const ask = await me();
  expect([ask.status, ask.headers.get("www-authenticate")]).toEqual([401, 'Basic realm="SNARK admin", charset="UTF-8"']);
  expect((await me(`${id}:plum`)).status).toBe(401);
  const yes = await me(`${id}:${password}`);
  expect([yes.status, await yes.json()]).toEqual([200, { name: id, id, rank: RANK_ADMIN, world: 0 }]);
  const signIn = s.host.acts.recent().filter((a) => a.kind === "sign-in");
  expect(signIn.map((a) => [a.name, a.id, a.rank, a.via, a.what])).toEqual([[id, id, RANK_ADMIN, "page", "opened the admin pages"]]);
});

test("no act, reply, event or server log line ever holds a password or a hash", () => {
  const log = new ServerLog();
  const untee = teeConsole(log);
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  const ears = listener("ears", ["perm.changed", "command.ran"]);
  const said: string[] = [];
  const h = new Harness({}, 1, 60, { modules: [ears.def], log: (line) => said.push(line) });
  try {
    const ada = h.join("ada");
    h.run(500);
    const replies: string[] = [];
    const run = (line: string): string => (replies.push(h.host.exec(line)), replies.at(-1)!);
    run("Permissions.Add ada Admins");
    run("Permissions.Password ada");
    const first = String(out.mock.calls.find((call) => String(call[0]).startsWith("The password of ada"))?.[0]).trim().split(" ").at(-1)!;
    expect(first).toMatch(PASSWORD);
    replies.push(...h.say(ada, `enablecheats ${first}`));
    const g = gateOf(h);
    expect(status(g, asked("ada", first))).toBe(200);
    const { password: second } = h.host.issuePassword(OPERATOR, idOfSession(h, ada));
    replies.push(...h.say(ada, `enablecheats ${first}`), ...h.say(ada, `enablecheats ${second}`), ...h.say(ada, "acts 50"));
    run("Permissions.Password ada clear");
    h.run(300);
    const texts = [
      ...replies,
      ...said,
      ...ears.heard.lines,
      ...log.since(0).map((l) => l.text),
      ...h.host.acts.recent().map((a) => JSON.stringify(a)),
      ...ada.log.map((l) => l.text),
    ];
    expect(texts.length).toBeGreaterThan(10);
    const secrets = [first, second].flatMap((p) => [p, passwordText(p), passwordHash(p)]);
    for (const text of texts) for (const secret of secrets) expect(text.toUpperCase()).not.toContain(secret.toUpperCase());
  } finally {
    out.mockRestore();
    untee();
    h.host.shutdown();
  }
});

test("the terminal's issue writes the password past the server's log", () => {
  const log = new ServerLog();
  const untee = teeConsole(log);
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  const said: string[] = [];
  const h = new Harness({}, 1, 60, { log: (line) => said.push(line) });
  try {
    const ada = h.join("ada");
    h.run(500);
    h.host.exec("Permissions.Add ada Admins");
    const reply = h.host.exec("Permissions.Password ada");
    expect(reply).toBe(`issued a password to ada (${idOfSession(h, ada)}); the terminal shows it this once`);
    const written = out.mock.calls.map((call) => String(call[0])).filter((text) => text.startsWith("The password of ada"));
    expect(written).toHaveLength(1);
    const password = written[0]!.trim().split(" ").at(-1)!;
    expect(password).toMatch(PASSWORD);
    expect([...said, ...log.since(0).map((l) => l.text)].some((text) => text.includes(password))).toBe(false);
    expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  } finally {
    out.mockRestore();
    untee();
    h.host.shutdown();
  }
});

test("a password issued on one world signs its survivor in on another", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const host = { survivorLog: { wall: () => clock.ms } };
    const a = cluster.server("a", "f", clock, { host });
    const b = cluster.server("b", "f", clock, { host });
    const { session: bob } = cluster.survivor(b, "bob");
    const id = idText(rec(b, "bob")!);
    // Two hosts over one store file: the cluster's.
    expect(a.h.host.exec(`Permissions.Add ${id} Admins all`)).toStartWith(`${id} is in Admins on every map.`);
    const { password } = a.h.host.issuePassword(OPERATOR, id);
    clock.ms += 5000;
    b.h.run(200);
    expect(b.h.say(bob, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
    const c = b.h.client(bob)!;
    expect([c.admin, c.rank, c.signed]).toEqual([true, RANK_ADMIN, true]);
    // Cleared on the first world, the sign-in on the second ends within the poll, and the world has nothing left to check.
    expect(a.h.host.clearPassword(OPERATOR, id)).toBe("");
    clock.ms += 5000;
    b.h.run(200);
    expect([c.admin, c.signed]).toEqual([false, false]);
    expect(b.h.say(bob, `enablecheats ${password}`)).toEqual(["cheats are disabled on this server"]);
  } finally {
    cluster.cleanup();
  }
});
