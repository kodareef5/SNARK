// A survivor's own password: claimed in game by the survivor, shown once to that session alone, kept as a hash, and given
// in game or on the admin pages to switch on the survivor's groups of staff rank and above. Replacing or clearing one ends
// its sign-ins, an open page that still sends it is not taken for a guesser, and nothing an admin does sets or shows one.
import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinServer } from "../../agent/join.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR, sessionActor } from "../../server/acts.ts";
import { actorOf, refused, type AdminGate } from "../../server/admin/gate.ts";
import { ServerLog, teeConsole } from "../../server/log.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { Permissions } from "../../server/permissions/permissions.ts";
import { permissionsState } from "../../server/permissions/routes.ts";
import { passwordHash, passwordText, staffPasswords } from "../../server/permissions/secrets.ts";
import { PermissionStore } from "../../server/permissions/store.ts";
import { Rules } from "../../server/settings/rules.ts";
import { idText } from "../../server/survivor-ids.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { idOf } from "../../shared/ids.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CHEAT_GUESSES, WRONG_PASSWORD } from "../../shared/console.ts";
import { KEY_BYTES, TEXT_CONSOLE, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import type { PermissionOp } from "../../shared/permissions/model.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { TestCluster, beat, keyAt, rec, rise, travel } from "../fixtures/cluster.ts";
import { listener } from "../fixtures/module.ts";
import { issue } from "../fixtures/permissions.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const MAP = "map-kiwi";
const PASSWORD = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
const RETIRED = "that password was replaced or cleared";
const CLAIMED = "The password above is yours, shown this once. enablecheats takes it in game, and the admin pages take it with your name or ID.";
const HAS_ONE = "You have a password already. To replace it, give it: claimpassword <your password>";
const NO_STAFF = "You are in no staff group, so there is no password to claim. An admin puts you in one first.";
const TOLD_CLAIM = "You are in a staff group. Claim your own password: open the console and type claimpassword.";
const TOLD_SIGN_IN = "Your staff group counts once you sign in: type enablecheats and your password in the console.";

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
function world(opts: { password?: string; creative?: boolean; wait?: number } = {}): { h: Harness; ada: ClientSession } {
  const config = opts.creative ? asShipped(new Rules()) : undefined;
  // These worlds replace a password as soon as it is claimed, which a real one makes a survivor wait an hour for.
  const h = new Harness({}, 1, 60, { adminPassword: opts.password, config, claimWaitMs: opts.wait ?? 0, log: () => {} });
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

/** `s` types claimpassword, giving `current` if any: what its session alone was sent, and every line it was told. */
function claim(h: Harness, s: ClientSession, current = ""): { password: string; said: string[] } {
  const said = h.say(s, current === "" ? "claimpassword" : `claimpassword "${current}"`);
  const password = s.secret ?? "";
  s.secret = "";
  return { password, said };
}

/** A password `s` claims, which must be made. */
function claimed(h: Harness, s: ClientSession, current = ""): string {
  const { password, said } = claim(h, s, current);
  if (!PASSWORD.test(password)) throw new Error(`${s.name} claimed no password: ${said.join(" | ")}`);
  return password;
}

/** The admin pages' gate of a harness's world, sharing its guess count. */
function gateOf(h: Harness, password: string | null = h.host.adminPassword): AdminGate {
  return { dev: false, password, cluster: null, guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick, staff: staffPasswords(h.host) };
}

function asked(user: string, password?: string): Request {
  const headers: Record<string, string> = password === undefined ? {} : { authorization: `Basic ${btoa(`${user}:${password}`)}` };
  return new Request("http://localhost/admin/", { headers });
}

const status = (g: AdminGate, req: Request, who = "1.2.3.4"): number => refused(req, who, g)?.status ?? 200;

test("a survivor in a staff group claims a password only their session is sent, once", () => {
  const { h, ada } = world();
  const bob = h.join("bob");
  h.run(500);
  op(h, "Permissions.Add ada Admins");
  const { password, said } = claim(h, ada);
  expect(password).toMatch(PASSWORD);
  expect(said).toEqual([TOLD_CLAIM, CLAIMED]);
  expect(bob.secret ?? "").toBe("");
  expect(h.host.permissions.secretOf(idOfSession(h, ada))).toBe(passwordHash(password));
  // Sent once: nothing comes again.
  h.run(500);
  expect(ada.secret).toBe("");
  const act = h.host.acts.recent().at(-1)!;
  expect([act.name, act.id, act.kind, act.what]).toEqual(["ada", idOfSession(h, ada), "change", "claimed their own password"]);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  h.host.shutdown();
});

test("a claimed password signs its survivor in, in the game and on the pages", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const c = h.client(ada)!;
  expect([c.admin, c.rank, c.signed]).toEqual([false, RANK_OPEN, false]);
  const password = claimed(h, ada);
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
  const password = claimed(h, ada);
  const g = gateOf(h);
  for (const typed of [password.toLowerCase(), password.replaceAll("-", ""), password.replaceAll("-", " "), ` ${password.slice(0, 9)} ${password.slice(9).toLowerCase()} `]) {
    expect(status(g, asked("ada", typed)), typed).toBe(200);
  }
  expect(h.say(ada, `enablecheats ${password.toLowerCase().replaceAll("-", " ")}`)).toEqual(["cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_ADMIN);
  h.host.shutdown();
});

test("a survivor with no staff group has nothing to claim", () => {
  const { h, ada } = world();
  op(h, "Permissions.AddGroup Vip");
  op(h, "Permissions.Add ada Vip");
  expect(claim(h, ada)).toEqual({ password: "", said: [NO_STAFF] });
  expect([h.host.permissions.secretOf(idOfSession(h, ada)), h.host.permissions.anySecret()]).toEqual(["", false]);
  expect(h.host.acts.recent().some((a) => a.what.includes("claimed"))).toBe(false);
  h.host.shutdown();
});

test("a second claim needs the current password, and a wrong one is counted as a guess", () => {
  const { h, ada } = world({ password: MAP });
  op(h, "Permissions.Add ada Admins");
  const first = claimed(h, ada);
  const c = h.client(ada)!;
  expect(h.say(ada, `enablecheats ${first}`)).toEqual(["cheats enabled"]);
  expect(claim(h, ada)).toEqual({ password: "", said: [HAS_ONE] });
  expect(claim(h, ada, "ABCD-EFGH-JKLM-NPQR")).toEqual({ password: "", said: [WRONG_PASSWORD] });
  expect(c.cheatAttempts).toBe(1);
  expect(h.host.permissions.secretOf(idOfSession(h, ada))).toBe(passwordHash(first));
  // It is the count enablecheats and the pages keep: two more wrong guesses there, and the map's own password waits.
  const by = c.conn.address ?? "ada";
  expect([status(gateOf(h), asked("x", "plum"), by), status(gateOf(h), asked("x", "plum"), by)]).toEqual([401, 401]);
  expect(h.say(ada, `enablecheats ${MAP}`)[0]).toStartWith("too many wrong passwords");
  h.host.shutdown();

  const again = world();
  op(again.h, "Permissions.Add ada Admins");
  const old = claimed(again.h, again.ada);
  const d = again.h.client(again.ada)!;
  expect(again.h.say(again.ada, `enablecheats ${old}`)).toEqual(["cheats enabled"]);
  const next = claimed(again.h, again.ada, old.toLowerCase());
  expect(next).not.toBe(old);
  // The replaced one's sign-in ends, and the new one is needed now.
  expect([d.admin, d.signed, again.h.say(again.ada, `enablecheats ${old}`)]).toEqual([false, false, [RETIRED]]);
  expect(again.h.say(again.ada, `enablecheats ${next}`)).toEqual(["cheats enabled"]);
  for (let i = 1; i < CHEAT_GUESSES; i++) expect(claim(again.h, again.ada, `plum${i}`).said).toEqual([WRONG_PASSWORD]);
  expect(d.closed).toBe(false);
  claim(again.h, again.ada, "plum3");
  expect(d.closed).toBe(true);
  again.h.host.shutdown();
});

test("a holder of the character's key without its password cannot replace the password", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const password = claimed(h, ada);
  const id = idOfSession(h, ada);
  // Another browser with the same key takes the survivor over.
  const thief = h.join("ada");
  h.run(500);
  expect(idOfSession(h, thief)).toBe(id);
  expect(claim(h, thief)).toEqual({ password: "", said: [HAS_ONE] });
  expect(claim(h, thief, "ABCD-EFGH-JKLM-NPQR")).toEqual({ password: "", said: [WRONG_PASSWORD] });
  expect(h.host.permissions.secretOf(id)).toBe(passwordHash(password));
  expect(h.say(thief, "god")).toEqual(["denied: cheats are not enabled for you"]);
  expect(h.host.acts.recent().filter((a) => a.what === "claimed their own password")).toHaveLength(1);
  h.host.shutdown();
});

test("an admin's clear lets the survivor claim again, and the old password is refused uncounted", () => {
  const { h, ada } = world({ password: MAP });
  op(h, "Permissions.Add ada Admins");
  const old = claimed(h, ada);
  const c = h.client(ada)!;
  expect(h.say(ada, `enablecheats ${old}`)).toEqual(["cheats enabled"]);
  expect(h.say(ada, "fly")).toEqual(["flying"]);
  expect(h.host.exec("Permissions.Password ada clear")).toBe(`ada (${idOfSession(h, ada)}) has no password now`);
  expect([c.admin, c.rank, c.signed]).toEqual([false, RANK_OPEN, false]);
  expect(h.say(ada, "god")).toEqual(["denied: cheats are not enabled for you"]);
  expect(h.say(ada, `enablecheats ${old}`)).toEqual([RETIRED]);
  expect(status(gateOf(h), asked("ada", old))).toBe(401);
  expect(h.host.exec("Permissions.Password ada clear")).toBe(`${idOfSession(h, ada)} has no password.`);
  const next = claimed(h, ada);
  expect(next).not.toBe(old);
  // The old one given with a claim is no guess either.
  expect(claim(h, ada, old)).toEqual({ password: "", said: [RETIRED] });
  expect(c.cheatAttempts).toBe(0);
  expect(h.say(ada, `enablecheats ${next}`)).toEqual(["cheats enabled"]);
  h.host.shutdown();
});

test("nothing an admin, a page or the terminal can do sets or shows a survivor's password", () => {
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  const { h, ada } = world();
  try {
    const id = idOfSession(h, ada);
    op(h, "Permissions.Add ada Admins");
    expect(h.host.exec("Permissions.Password ada")).toBe(`ada (${id}) has not claimed a password`);
    const password = claimed(h, ada);
    const hash = passwordHash(password);
    expect(h.host.exec("Permissions.Password ada")).toMatch(new RegExp(`^ada \\(${id}\\) claimed a password on \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC$`));
    expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
    expect(h.say(ada, "Permissions.Password ada")[0]).toStartWith(`ada (${id}) claimed a password on `);
    // No door takes a hash: the host's, a module's, a page's, the store's own.
    const set = { op: "setSecret", id, hash: "ab".repeat(32) } as unknown as PermissionOp;
    for (const by of [OPERATOR, sessionActor(h.client(ada)!, h.host.records)]) expect(h.host.changePermissions(by, set)).toBe("That is not a permission change.");
    expect(h.host.permissions.apply({ rank: RANK_CLUSTER, world: 0, name: "cluster" }, set)).toBe("That is not a permission change.");
    expect("issuePassword" in h.host).toBe(false);
    expect(h.host.permissions.secretOf(id)).toBe(hash);
    const written = out.mock.calls.map((call) => String(call[0])).join("");
    expect(written.toUpperCase()).not.toContain(passwordText(password));
  } finally {
    out.mockRestore();
    h.host.shutdown();
  }
});

test("a regular admin cannot clear a map admin's password", () => {
  const { h, ada } = world();
  const bob = h.join("bob");
  h.run(500);
  op(h, "Permissions.AddGroup Owners");
  op(h, "Permissions.Rank Owners map");
  op(h, "Permissions.Add bob Owners");
  op(h, "Permissions.Add ada Admins");
  const bobs = claimed(h, bob);
  expect(h.say(ada, `enablecheats ${claimed(h, ada)}`)).toEqual(["cheats enabled"]);
  const regular = sessionActor(h.client(ada)!, h.host.records);
  expect(regular.rank).toBe(RANK_ADMIN);
  const higher = "That survivor holds a higher rank than yours.";
  expect(h.host.clearPassword(regular, idOfSession(h, bob))).toBe(higher);
  expect(h.say(ada, "Permissions.Password bob clear")).toEqual([higher]);
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
  const password = claimed(h, ada);
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
  const password = claimed(h, ada);
  const g = gateOf(h);
  expect([status(g, asked("ada", password)), status(g, asked("ada", password)), status(g, asked("ada", password))]).toEqual([401, 401, 401]);
  // Refused as a wrong password is, and counted as one.
  expect(status(g, asked("ada", password))).toBe(429);
  // In game the same password signs in at the staff rank.
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect([h.client(ada)!.rank, h.client(ada)!.admin]).toEqual([RANK_STAFF, true]);
  h.host.shutdown();
});

test("a retired password still sent by an open page is not counted as a guess", () => {
  const { h, ada } = world();
  op(h, "Permissions.Add ada Admins");
  const old = claimed(h, ada);
  const g = gateOf(h);
  expect(status(g, asked("ada", old))).toBe(200);
  const next = claimed(h, ada, old);
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
  const password = claimed(h, ada);
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
  const mine = claimed(alone.h, alone.ada);
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
  const password = claimed(h, ada);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  expect([c.admin, c.rank, c.signed]).toEqual([true, RANK_ADMIN, true]);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["cheats are already enabled"]);
  // One with no password of its own has nothing more to gain.
  expect(h.say(bob, "enablecheats anything")).toEqual(["cheats are already enabled"]);
  h.host.shutdown();
});

test("a survivor whose groups count on no map here is told so as it signs in", () => {
  const { h, ada } = world();
  // A staff membership on another map of a cluster: it may claim, and its group does not count here.
  expect(h.host.changePermissions(OPERATOR, { op: "addMember", kind: "survivor", key: idOfSession(h, ada), group: "Admins", world: 7 })).toBe("");
  const password = claimed(h, ada);
  expect(h.say(ada, `enablecheats ${password}`)).toEqual(["signed in, but no group of yours counts on this map"]);
  expect([h.client(ada)!.signed, h.client(ada)!.admin]).toEqual([true, false]);
  const bob = h.join("bob");
  h.run(500);
  expect(h.say(bob, "enablecheats anything")).toEqual(["cheats are disabled on this server"]);
  h.host.shutdown();
});

test("a survivor is told once per connection to claim, and once to sign in", () => {
  const { h, ada } = world();
  const bob = h.join("bob");
  h.run(500);
  const notices = (s: ClientSession, from: number): string[] => s.log.slice(from).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
  const start = ada.log.length;
  op(h, "Permissions.AddGroup Vip");
  op(h, "Permissions.Add bob Vip");
  op(h, "Permissions.Add ada Admins");
  op(h, "Permissions.Grant Vip Kit.vip");
  h.run(300);
  expect([notices(ada, start), notices(bob, 0).filter((t) => t.includes("password"))]).toEqual([[TOLD_CLAIM], []]);
  // Claiming answers how to sign in, so that notice is not given on this connection.
  const password = claimed(h, ada);
  op(h, "Permissions.Grant Vip Kit.more");
  h.run(300);
  expect(notices(ada, start)).toEqual([TOLD_CLAIM]);
  // A new connection is told to sign in, once, and once signed in is told nothing.
  const back = h.join("ada");
  h.run(500);
  op(h, "Permissions.Revoke Vip Kit.more");
  h.run(300);
  expect(notices(back, 0)).toEqual([TOLD_SIGN_IN]);
  expect(h.say(back, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
  const again = h.join("ada");
  h.run(500);
  expect(notices(again, 0)).toEqual([TOLD_SIGN_IN]);
  h.say(again, `enablecheats ${password}`);
  op(h, "Permissions.Grant Vip Kit.most");
  h.run(300);
  expect(notices(again, 0)).toEqual([TOLD_SIGN_IN]);
  expect(notices(bob, 0).filter((t) => t.includes("password"))).toEqual([]);
  h.host.shutdown();
});

test("a world with only claimed passwords opens its pages and asks for one", async () => {
  const s = startServer({ port: 0, clientDir: dir, probeScene: true });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  const me = (auth?: string): Promise<Response> => fetch(`${at}/admin/me.json`, { headers: auth ? { authorization: `Basic ${btoa(auth)}` } : {} });
  expect((await me()).status).toBe(404);
  const session = await joinServer(`ws://127.0.0.1:${s.port}/ws`, "ada", crypto.getRandomValues(new Uint8Array(KEY_BYTES)), compileContent(CORE_CONTENT).registry!);
  const beat = setInterval(() => session.update(performance.now(), 0, 0, 0, 0, 0), 33);
  try {
    const here = () => s.host.game.clients.find((c) => !!c?.active && !c.closed && c.name === "ada" && c.pid !== 0);
    for (let k = 0; k < 300 && !here(); k++) await Bun.sleep(50);
    const id = idText(s.host.records.byPid.get(here()!.pid)!);
    expect(s.host.exec(`Permissions.Add ${id} Admins`)).toStartWith(`ada (${id}) is in Admins.`);
    session.text("claimpassword");
    for (let k = 0; k < 100 && session.secret === ""; k++) await Bun.sleep(50);
    const password = session.secret;
    expect(password).toMatch(PASSWORD);
    const ask = await me();
    expect([ask.status, ask.headers.get("www-authenticate")]).toEqual([401, 'Basic realm="SNARK admin", charset="UTF-8"']);
    expect((await me(`${id}:plum`)).status).toBe(401);
    const yes = await me(`${id}:${password}`);
    expect([yes.status, await yes.json()]).toEqual([200, { name: "ada", id, rank: RANK_ADMIN, world: 0 }]);
    const signIn = s.host.acts.recent().filter((a) => a.kind === "sign-in");
    expect(signIn.map((a) => [a.name, a.id, a.rank, a.via, a.what])).toEqual([["ada", id, RANK_ADMIN, "page", "opened the admin pages"]]);
  } finally {
    clearInterval(beat);
    session.close();
  }
});

test("the password is in no act, event, answer, log line, journal entry or page state", () => {
  const log = new ServerLog();
  const untee = teeConsole(log);
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  const ears = listener("ears", ["perm.changed", "command.ran"]);
  const said: string[] = [];
  const saves = mkdtempSync(join(tmpdir(), "snark-staff-save-"));
  const dbPath = join(saves, "world.db");
  const h = new Harness({}, 1, 60, { modules: [ears.def], log: (line) => said.push(line), dbPath, claimWaitMs: 0 });
  try {
    const ada = h.join("ada");
    h.run(500);
    const replies: string[] = [];
    replies.push(h.host.exec("Permissions.Add ada Admins"));
    const first = claimed(h, ada);
    replies.push(...h.say(ada, `enablecheats ${first}`), h.host.exec("Permissions.Password ada"));
    const g = gateOf(h);
    expect(status(g, asked("ada", first))).toBe(200);
    const second = claimed(h, ada, first);
    replies.push(...h.say(ada, `enablecheats ${first}`), ...h.say(ada, `enablecheats ${second}`), ...h.say(ada, "acts 50"), ...h.say(ada, `cheat claimpassword ${second}`));
    const third = ada.secret;
    ada.secret = "";
    expect(third).toMatch(PASSWORD);
    replies.push(h.host.exec("Permissions.Password ada clear"));
    h.run(300);
    h.host.persistence!.commit();
    const page = permissionsState(h.host, asked("kody"));
    expect(page.passwords).toEqual([]);
    const journal = (h.host.persistence!.store.db.query("SELECT data FROM journal").all() as { data: Uint8Array }[]).map((r) => Buffer.from(r.data).toString("latin1"));
    const texts = [
      ...replies,
      ...said,
      ...ears.heard.lines,
      ...log.since(0).map((l) => l.text),
      ...out.mock.calls.map((call) => String(call[0])),
      ...h.host.acts.recent().map((a) => JSON.stringify(a)),
      ...ada.log.map((l) => l.text),
      ...journal,
      JSON.stringify(page),
    ];
    expect(texts.length).toBeGreaterThan(10);
    expect(ada.log.filter((l) => l.channel === TEXT_CONSOLE).map((l) => l.text)).toContain(CLAIMED);
    const secrets = [first, second, third].flatMap((p) => [p, passwordText(p), passwordHash(p)]);
    for (const text of texts) for (const secret of secrets) expect(text.toUpperCase()).not.toContain(secret.toUpperCase());
    // The store keeps hashes alone, and SQLite may leave an old row's bytes in the file.
    const stored = readFileSync(`${dbPath}.permissions.sqlite`).toString("latin1").toUpperCase();
    for (const p of [first, second, third]) expect([stored.includes(p), stored.includes(passwordText(p))]).toEqual([false, false]);
  } finally {
    out.mockRestore();
    untee();
    h.host.shutdown();
    rmSync(saves, { recursive: true, force: true });
  }
});

test("a password claimed on one map signs its survivor in on another", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const host = { survivorLog: { wall: () => clock.ms } };
    const a = cluster.server("a", "f", clock, { host });
    const b = cluster.server("b", "f", clock, { host });
    beat(a, b);
    const { session: bob } = cluster.survivor(a, "bob");
    const id = idText(rec(a, "bob")!);
    // Two hosts over one store file: the cluster's.
    expect(a.h.host.exec(`Permissions.Add ${id} Admins all`)).toStartWith(`bob (${id}) is in Admins on every map.`);
    const password = claimed(a.h, bob);
    clock.ms += 5000;
    b.h.run(200);
    // The other map's pages know the survivor by ID alone, and take the password.
    const pages: AdminGate = { ...gateOf(b.h, null), staff: staffPasswords(b.h.host) };
    expect(status(pages, asked(id, password))).toBe(200);
    expect(travel(a, bob, b.world)).toBeInstanceOf(Uint8Array);
    clock.ms += 30_000;
    beat(a, b);
    const there = b.h.join("bob", {}, { key: keyAt("bob", b.world), ticket: bob.travelled!.ticket });
    b.h.run(400);
    rise(b, there);
    expect(b.h.say(there, `enablecheats ${password}`)).toEqual(["cheats enabled"]);
    const c = b.h.client(there)!;
    expect([c.admin, c.rank, c.signed]).toEqual([true, RANK_ADMIN, true]);
    // Cleared on the first map, the sign-in on the second ends within the poll, and the map has nothing left to check.
    expect(a.h.host.clearPassword(OPERATOR, id)).toBe("");
    clock.ms += 5000;
    b.h.run(200);
    expect([c.admin, c.signed]).toEqual([false, false]);
    expect(b.h.say(there, `enablecheats ${password}`)).toEqual(["cheats are disabled on this server"]);
  } finally {
    cluster.cleanup();
  }
});

test("two maps over one store keep a claim whole when both write at once", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-claim-"));
  try {
    const file = join(root, "permissions.sqlite");
    const one = new Permissions({ store: new PermissionStore(file), world: 1, claimWaitMs: 0 });
    const two = new Permissions({ store: new PermissionStore(file), world: 2, claimWaitMs: 0 });
    const id = idOf(1, 1);
    issue(one, id);
    const actor = { rank: RANK_CLUSTER, world: 1, name: "cluster" };
    expect(one.apply(actor, { op: "addMember", kind: "survivor", key: id, group: "Admins", world: 0 })).toBe("");
    // The second has not polled: its claim reads the file inside its write and finds the membership.
    expect(two.claim(id, passwordHash("ABCD-EFGH-JKLM-NPQR"), "")).toEqual({ why: "", wrong: false });
    // A claim on the first now needs that password, though the first has not polled either.
    expect(one.claim(id, passwordHash("BCDE-FGHJ-KLMN-PQRS"), "")).toEqual({ why: HAS_ONE, wrong: false });
    expect(one.claim(id, passwordHash("BCDE-FGHJ-KLMN-PQRS"), passwordHash("ABCD-EFGH-JKLM-NPQR"))).toEqual({ why: "", wrong: false });
    expect(new PermissionStore(file).read().secrets.map((s) => [s.id, s.hash])).toEqual([[id, passwordHash("BCDE-FGHJ-KLMN-PQRS")]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a survivor who has just claimed a password waits to replace it, and floods nothing", () => {
  const { h, ada } = world({ wait: 3600_000 });
  op(h, "Permissions.Add ada Mods".replace("Mods", "Admins"));
  const first = claimed(h, ada);
  const before = [h.host.permissions.snapshot().revision, h.host.permissions.history().length, h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).length];
  for (let i = 0; i < 20; i++) {
    const again = claim(h, ada, first);
    expect([again.password, again.said[0]]).toEqual(["", "You claimed a password a short while ago. A new one can be claimed in 60 minutes."]);
  }
  expect([h.host.permissions.snapshot().revision, h.host.permissions.history().length, h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).length]).toEqual(before);
  expect(h.host.permissions.secretOf(idOfSession(h, ada))).toBe(passwordHash(first));
  h.host.shutdown();
});

test("signing in again with the same password writes no second act", () => {
  const { h, ada } = world({ password: MAP });
  op(h, "Permissions.AddGroup Mods");
  op(h, "Permissions.Rank Mods staff");
  op(h, "Permissions.Add ada Mods");
  const hers = claimed(h, ada);
  expect(h.say(ada, `enablecheats ${hers}`)[0]).toBeDefined();
  const signIns = (): number => h.host.acts.recent(0, Number.MAX_SAFE_INTEGER).filter((a) => a.kind === "sign-in").length;
  const once = signIns();
  for (let i = 0; i < 10; i++) h.say(ada, `enablecheats ${hers}`);
  expect([signIns(), h.client(ada)!.signed]).toEqual([once, true]);
  // The map's password still raises her, and that is a sign-in of its own.
  expect(h.say(ada, `enablecheats ${MAP}`)).toEqual(["cheats enabled"]);
  expect(signIns()).toBe(once + 1);
  h.host.shutdown();
});
