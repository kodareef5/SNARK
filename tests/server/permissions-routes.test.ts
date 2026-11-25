// A world's Permissions page's API (server/permissions/routes.ts): the state it reads, the changes, clears and imports it
// sends, who each is made as and on which map, what the admin log and the history keep of them, and what is refused: it
// never makes, sets or shows a password.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR } from "../../server/acts.ts";
import { refused } from "../../server/admin/gate.ts";
import { frontPasses, sitePost, startFront } from "../../server/front.ts";
import type { Host } from "../../server/host.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { permissionsAdmin, permissionsState } from "../../server/permissions/routes.ts";
import { passwordHash, staffPasswords } from "../../server/permissions/secrets.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TEAM_RANGE } from "../../server/records.ts";
import { idText } from "../../server/survivor-ids.ts";
import { idOf } from "../../shared/ids.ts";
import { CHANGED_MEANWHILE, type PermissionOp } from "../../shared/permissions/model.ts";
import {
  CHAT_DOCUMENT, OLD_PERMISSIONS_PATHS, PERMISSIONS_API, PERMISSIONS_HISTORY, PERMISSIONS_STATE, type ImportKind, type PermissionsAnswer, type PermissionsHistory, type PermissionsPost,
  type PermissionsSame, type PermissionsState,
} from "../../shared/permissions/page.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { runningArkApi } from "../fixtures/arkapi.ts";
import { TestCluster, rec } from "../fixtures/cluster.ts";
import { issue } from "../fixtures/permissions.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const MAP = "map-kiwi";
const CLUSTER = "cluster-pear";
const PASSWORD = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;

// A built client, as far as a server needs one: the manifest and the files it names.
const dir = mkdtempSync(join(tmpdir(), "snark-permission-routes-"));
const { files, manifest } = splitPack(corePackBytes(), "core");
mkdirSync(join(dir, "assets"));
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
mkdirSync(join(dir, "admin"));
writeFileSync(join(dir, "admin/permissions.html"), "<title>the permissions page</title>");
const running: { stop(): void }[] = [];
afterAll(() => {
  for (const s of running) s.stop();
  rmSync(dir, { recursive: true, force: true });
});

const signIn = (user: string, password: string): Record<string, string> => ({ authorization: `Basic ${btoa(`${user}:${password}`)}` });
const posted = (post: PermissionsPost | string, headers: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: typeof post === "string" ? post : JSON.stringify(post),
});

/** A server on a port of its own with the map's password, outside a cluster. */
function serve(): { s: RunningServer; at: string; kody: Record<string, string> } {
  const s = startServer({ port: 0, clientDir: dir, probeScene: true, adminPassword: MAP });
  running.push(s);
  return { s, at: `http://127.0.0.1:${s.port}`, kody: signIn("kody", MAP) };
}

/** A world with the map's password and ada joined, whose page's API is asked past its gate, as the world's admin pages are. */
function world(opts: { dev?: boolean; log?: (line: string) => void } = {}): { h: Harness; ada: ClientSession; adaId: string; ask: (path: string, init?: RequestInit) => Promise<Response> } {
  const h = new Harness({}, 1, 60, { adminPassword: MAP, log: opts.log ?? (() => {}) });
  const ada = h.join("ada");
  h.run(500);
  const gate = { dev: opts.dev ?? false, password: MAP, cluster: null, guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick, staff: staffPasswords(h.host) };
  const ask = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const req = new Request(`http://localhost${path}`, init);
    return refused(req, "1.2.3.4", gate) ?? (await permissionsAdmin(req, new URL(req.url).pathname, h.host))!;
  };
  return { h, ada, adaId: idText(h.host.records.byPid.get(h.client(ada)!.pid)!), ask };
}

/** The digest of what an import of `text` would do now, as its check answers it. */
async function checkedDigest(ask: (path: string, init?: RequestInit) => Promise<Response>, kind: ImportKind, text: string, as: Record<string, string>): Promise<string> {
  const [status, check] = await ask(PERMISSIONS_API, posted({ do: "plan", kind, text }, as)).then(answered);
  if (status !== 200 || !check.digest) throw new Error(`the check answered ${status}: ${check.why}`);
  return check.digest;
}

/** Makes `op` as the operator, which must be done. */
function operator(host: Host, op: PermissionOp): void {
  const why = host.changePermissions(OPERATOR, op);
  if (why !== "") throw new Error(why);
}

/** Ada in Admins with the password she claims in game. */
function claimed(h: Harness, ada: ClientSession, adaId: string): string {
  operator(h.host, { op: "addMember", kind: "survivor", key: adaId, group: "Admins" });
  h.say(ada, "claimpassword");
  if (!PASSWORD.test(ada.secret)) throw new Error("ada claimed no password");
  return ada.secret;
}

/** Ada's sign-in with her own password: a regular admin's. */
const regular = (h: Harness, ada: ClientSession, adaId: string): Record<string, string> => signIn("ada", claimed(h, ada, adaId));

const answered = async (res: Response): Promise<[number, PermissionsAnswer]> => [res.status, (await res.json()) as PermissionsAnswer];

test("the state names who has claimed a password, and when, and carries no hash", async () => {
  const { h, ada, adaId, ask } = world();
  const password = claimed(h, ada, adaId);
  const res = await ask(PERMISSIONS_STATE, { headers: signIn("kody", MAP) });
  expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
  const text = await res.text();
  const state = JSON.parse(text) as PermissionsState;
  expect(state.me).toEqual({ name: "(kody)", id: "", rank: RANK_MAP, world: 0 });
  expect([state.saved, state.passwords, state.survivors]).toEqual([false, [{ id: adaId, at: h.host.permissions.claimedAt(adaId) }], [{ id: adaId, name: "ada", online: true }]]);
  expect(state.passwords[0]!.at).toBeGreaterThan(0);
  expect(state.members.find((m) => m.group === "Admins")).toMatchObject({ kind: "survivor", key: adaId, name: "ada" });
  expect(state.groups.map((g) => g.name)).toContain("Admins");
  expect([state.commands.includes("god"), state.commands.includes("help"), state.worlds.length]).toEqual([true, false, 1]);
  for (const secret of [password, passwordHash(password), h.host.permissions.secretOf(adaId)]) expect(text).not.toContain(secret);
  h.host.shutdown();
});

test("a viewer below admin rank reads the state and can change nothing", async () => {
  const { h, adaId, ask } = world({ dev: true });
  const state = (await (await ask(PERMISSIONS_STATE)).json()) as PermissionsState;
  expect([state.me.name, state.me.rank]).toEqual(["(development)", RANK_STAFF]);
  const before = h.host.permissions.snapshot();
  const refusals = await Promise.all([
    ask(PERMISSIONS_API, posted({ do: "op", op: { op: "addGroup", group: "VIP" } }, {})).then(answered),
    ask(PERMISSIONS_API, posted({ do: "op", op: { op: "clearSecret", id: adaId } }, {})).then(answered),
    ask(PERMISSIONS_API, posted({ do: "plan", kind: "commands", text: "Permissions.AddGroup VIP" }, {})).then(answered),
    ask(PERMISSIONS_API, posted({ do: "import", kind: "commands", text: "Permissions.AddGroup VIP", digest: "0".repeat(64) }, {})).then(answered),
  ]);
  // Even a check is an admin's: it reads what was sent, which is work the server does inside its tick.
  expect(refusals).toEqual([
    [403, { ok: false, why: "Permissions are managed from an admin's rank." }],
    [403, { ok: false, why: "Permissions are managed from an admin's rank." }],
    [403, { ok: false, why: "An import is checked and applied from an admin's rank." }],
    [403, { ok: false, why: "An import is checked and applied from an admin's rank." }],
  ]);
  expect(h.host.permissions.snapshot()).toEqual(before);
  h.host.shutdown();
});

test("a change is made as who signed in and shows in the admin log", async () => {
  const { s, at, kody } = serve();
  const res = await fetch(`${at}${PERMISSIONS_API}`, posted({ do: "op", op: { op: "addGroup", group: "VIP" } }, kody));
  expect([await answered(res), res.headers.get("cache-control")]).toEqual([[200, { ok: true, why: "" }], "no-store"]);
  expect(s.host.permissions.group("VIP")?.name).toBe("VIP");
  const acts = s.host.acts.recent().filter((a) => a.kind !== "sign-in");
  expect(acts.map((a) => [a.name, a.rank, a.via, a.kind, a.what])).toEqual([["(kody)", RANK_MAP, "page", "change", "Permissions.AddGroup VIP"]]);
});

test("a regular admin's change to a map-rank group is refused with the reason", async () => {
  const { h, ada: session, adaId, ask } = world();
  operator(h.host, { op: "addGroup", group: "Owners", rank: RANK_MAP });
  const ada = regular(h, session, adaId);
  const grant = { do: "op", op: { op: "grant", group: "Owners", permission: "Cheat.fly" } } as const;
  expect(await ask(PERMISSIONS_API, posted(grant, ada)).then(answered)).toEqual([403, { ok: false, why: "That needs the map rank." }]);
  expect(h.host.permissions.group("Owners")!.permissions).toEqual([]);
  // Her own rank's groups are hers to change.
  expect(await ask(PERMISSIONS_API, posted({ do: "op", op: { op: "grant", group: "Admins", permission: "Cheat.fly" } }, ada)).then(answered)).toEqual([200, { ok: true, why: "" }]);
  expect(h.host.acts.recent().at(-1)).toMatchObject({ name: "ada", id: adaId, rank: RANK_ADMIN, what: "Permissions.Grant Admins Cheat.fly" });
  h.host.shutdown();
});

test("a hash or a tag choice sent as a change is refused", async () => {
  const { h, adaId, ask } = world();
  const kody = signIn("kody", MAP);
  operator(h.host, { op: "addMember", kind: "survivor", key: adaId, group: "Admins" });
  const SET = "A survivor claims their own password in game. Nobody sets one here.";
  const hashes = await Promise.all([
    ask(PERMISSIONS_API, posted(JSON.stringify({ do: "op", op: { op: "setSecret", id: adaId, hash: "0".repeat(64) } }), kody)).then(answered),
    ask(PERMISSIONS_API, posted(JSON.stringify({ do: "op", op: { op: "clearSecret", id: adaId, hash: "0".repeat(64) } }), kody)).then(answered),
  ]);
  const tag = await ask(PERMISSIONS_API, posted({ do: "op", op: { op: "tag", id: adaId, tag: "Admins", show: false } }, kody)).then(answered);
  expect(hashes).toEqual([[403, { ok: false, why: SET }], [403, { ok: false, why: SET }]]);
  expect(tag).toEqual([403, { ok: false, why: "A tag is shown or hidden by its survivor, in game." }]);
  expect([h.host.permissions.secretOf(adaId), h.host.permissions.tagChoice(adaId, "Admins")]).toEqual(["", undefined]);
  h.host.shutdown();
});

test("the page neither makes nor shows a password, and clears one", async () => {
  const said: string[] = [];
  const { h, ada, adaId, ask } = world({ log: (line) => said.push(line) });
  const kody = signIn("kody", MAP);
  const asked = await ask(PERMISSIONS_API, posted(JSON.stringify({ do: "password", id: adaId }), kody)).then(answered);
  expect(asked).toEqual([400, { ok: false, why: "That is not a request the permissions page sends." }]);
  expect(h.host.permissions.secretOf(adaId)).toBe("");
  const password = claimed(h, ada, adaId);
  expect(h.host.permissions.secretOf(adaId)).toBe(passwordHash(password));
  const state = await (await ask(PERMISSIONS_STATE, { headers: kody })).text();
  expect((JSON.parse(state) as PermissionsState).passwords.map((p) => p.id)).toEqual([adaId]);
  expect(await ask(PERMISSIONS_API, posted({ do: "op", op: { op: "clearSecret", id: adaId } }, kody)).then(answered)).toEqual([200, { ok: true, why: "" }]);
  expect(h.host.acts.recent().filter((a) => a.kind === "change").map((a) => [a.name, a.what])).toEqual([
    ["(operator)", `Permissions.Add ${adaId} Admins`],
    ["ada", "claimed their own password"],
    ["(kody)", `cleared the password of ${adaId}`],
  ]);
  h.run(300);
  const after = await (await ask(PERMISSIONS_STATE, { headers: kody })).text();
  expect((JSON.parse(after) as PermissionsState).passwords).toEqual([]);
  const texts = [state, after, ...said, ...h.host.acts.recent().map((a) => JSON.stringify(a)), ...ada.log.map((l) => l.text)];
  for (const text of texts) for (const secret of [password, passwordHash(password)]) expect(text).not.toContain(secret);
  h.host.shutdown();
});

test("a change from another site's page is refused, and the front passes ours to its world", async () => {
  const saves = mkdtempSync(join(tmpdir(), "snark-permission-front-"));
  const log = console.log;
  console.log = () => {};
  const config = loadConfig({}, ["-clusterid=perms", `-ClusterDirOverride=${saves}`]).rules;
  const miami = startServer({ port: 0, clientDir: dir, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config, clusterPassword: CLUSTER });
  const front = startFront(join(saves, "perms"), 0, "127.0.0.1");
  const at = `http://127.0.0.1:${front.port}`;
  const top = signIn("kody", CLUSTER);
  try {
    for (let k = 0; k < 200 && (await fetch(`${at}/miami${PERMISSIONS_STATE}`, { headers: top })).status === 503; k++) await Bun.sleep(50);
    const state = (await (await fetch(`${at}/miami${PERMISSIONS_STATE}`, { headers: top })).json()) as PermissionsState;
    expect([state.saved, state.me.rank, state.worlds.map((w) => w.id)]).toEqual([true, RANK_CLUSTER, [miami.host.permissions.world]]);
    const add = { do: "op", op: { op: "addGroup", group: "VIP" } } as const;
    const other = await fetch(`${at}/miami${PERMISSIONS_API}`, posted(add, { ...top, origin: "https://elsewhere.example" })).then(answered);
    expect(other).toEqual([403, { ok: false, why: "Open the permissions page on this world." }]);
    expect(miami.host.permissions.group("VIP")).toBeUndefined();
    expect([sitePost(PERMISSIONS_API), frontPasses("POST", PERMISSIONS_API)]).toEqual([false, true]);
    const ours = await fetch(`${at}/miami${PERMISSIONS_API}`, posted(add, { ...top, origin: at })).then(answered);
    expect(ours).toEqual([200, { ok: true, why: "" }]);
    expect(miami.host.permissions.group("VIP")?.name).toBe("VIP");
  } finally {
    front.stop();
    miami.stop();
    console.log = log;
    rmSync(saves, { recursive: true, force: true });
  }
});

const LIST = ["Permissions.AddGroup VIP", "Permissions.Grant VIP Cheat.fly", "Permissions.Grant Top Cheat.fly"].join("\n");

test("an import's check changes nothing and lists what it would do", async () => {
  const { s, at, kody } = serve();
  const before = s.host.permissions.snapshot();
  const [status, check] = await fetch(`${at}${PERMISSIONS_API}`, posted({ do: "plan", kind: "commands", text: LIST }, kody)).then(answered);
  expect([status, check.ok, check.ops]).toEqual([200, true, 4]);
  expect(check.notes).toEqual(expect.arrayContaining(["Permissions.AddGroup VIP", "Permissions.Grant VIP Cheat.fly", "Permissions.AddGroup Top", "Permissions.Grant Top Cheat.fly"]));
  expect(s.host.permissions.snapshot()).toEqual(before);
  // A dry run is no change, so the admin log keeps none.
  expect(s.host.acts.recent().filter((a) => a.kind !== "sign-in")).toEqual([]);
});

test("an import makes its changes as one act and reports what was refused", async () => {
  const { s, at, kody } = serve();
  operator(s.host, { op: "addGroup", group: "Top", rank: RANK_CLUSTER });
  const ask = (path: string, init?: RequestInit): Promise<Response> => fetch(`${at}${path}`, init);
  const digest = await checkedDigest(ask, "commands", LIST, kody);
  const [status, made] = await fetch(`${at}${PERMISSIONS_API}`, posted({ do: "import", kind: "commands", text: LIST, digest }, kody)).then(answered);
  expect([status, made.ok, made.ops, made.refused]).toEqual([200, true, 2, [{ what: "Permissions.Grant Top Cheat.fly", why: "That needs the cluster rank." }]]);
  expect(s.host.permissions.group("VIP")!.permissions).toEqual(["Cheat.fly"]);
  const acts = s.host.acts.recent().filter((a) => a.name === "(kody)" && a.kind !== "sign-in");
  expect(acts.map((a) => [a.kind, a.what])).toEqual([
    ["change", "imported a list of Permissions commands: 2 changes"],
    ["refused", "1 of the import's 3 changes, the first Permissions.Grant Top Cheat.fly: That needs the cluster rank."],
  ]);
});

test("an import below the top rank is refused", async () => {
  const { h, ada: session, adaId, ask } = world();
  const ada = regular(h, session, adaId);
  const check = (await ask(PERMISSIONS_API, posted({ do: "plan", kind: "commands", text: LIST }, ada)).then(answered))[1];
  expect([check.ok, check.notes?.at(-1)]).toEqual([true, "Applying it needs the map rank."]);
  expect(await ask(PERMISSIONS_API, posted({ do: "import", kind: "commands", text: LIST, digest: check.digest! }, ada)).then(answered)).toEqual([403, { ok: false, why: "An import needs the map rank." }]);
  expect(h.host.permissions.group("VIP")).toBeUndefined();
  h.host.shutdown();
});

test("a file that is no ArkApi database is refused with a plain reason", async () => {
  const { h, ask } = world();
  const text = Buffer.from("these are not the tables you are looking for").toString("base64");
  const kody = signIn("kody", MAP);
  expect(await ask(PERMISSIONS_API, posted({ do: "plan", kind: "arkapi", text }, kody)).then(answered)).toEqual([400, { ok: false, why: "That file is not an SQLite database." }]);
  h.host.shutdown();
});

test("a body too large, bad JSON or an unknown request is refused plainly", async () => {
  const { h, ask } = world();
  const kody = signIn("kody", MAP);
  const huge = JSON.stringify({ do: "plan", kind: "commands", text: "x".repeat(8 * 1024 * 1024) });
  expect(await ask(PERMISSIONS_API, posted(huge, kody)).then(answered)).toEqual([413, { ok: false, why: "That is too large: a request is at most 8 MB." }]);
  expect(await ask(PERMISSIONS_API, posted("{ not json", kody)).then(answered)).toEqual([400, { ok: false, why: "That is not a request the permissions page sends." }]);
  expect(await ask(PERMISSIONS_API, posted(JSON.stringify({ do: "everything" }), kody)).then(answered)).toEqual([400, { ok: false, why: "That is not a request the permissions page sends." }]);
  h.host.shutdown();
});

test("the page's grant to an ID or a team never made is refused", async () => {
  const { h, ada, ask } = world();
  const kody = signIn("kody", MAP);
  const ghost = idOf(1, 999);
  operator(h.host, { op: "addGroup", group: "Vip" });
  const refusals = await Promise.all([
    ask(PERMISSIONS_API, posted({ do: "op", op: { op: "addMember", kind: "survivor", key: ghost, group: "Admins" } }, kody)).then(answered),
    ask(PERMISSIONS_API, posted({ do: "op", op: { op: "addMember", kind: "tribe", key: String(TEAM_RANGE + 999), group: "Vip" } }, kody)).then(answered),
  ]);
  expect(refusals).toEqual([
    [403, { ok: false, why: `No survivor has the ID ${ghost}.` }],
    [403, { ok: false, why: `No tribe has the number ${TEAM_RANGE + 999}.` }],
  ]);
  const team = String(h.host.records.byPid.get(h.client(ada)!.pid)!.team);
  expect(await ask(PERMISSIONS_API, posted({ do: "op", op: { op: "addMember", kind: "tribe", key: team, group: "Vip" } }, kody)).then(answered)).toEqual([200, { ok: true, why: "" }]);
  expect(h.host.permissions.membersIn("Admins")).toEqual([]);
  h.host.shutdown();
});

test("the state names a member of another map from the register", () => {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000 };
    const a = cluster.server("a", "f", clock);
    const b = cluster.server("b", "f", clock);
    cluster.survivor(a, "bob");
    const id = idText(rec(a, "bob")!);
    operator(b.h.host, { op: "addMember", kind: "survivor", key: id, group: "Admins", world: 0 });
    const state = permissionsState(b.h.host, new Request("http://localhost/"));
    expect(state.members).toEqual([expect.objectContaining({ key: id, name: "bob" })]);
    expect(state.register).toEqual([{ id, name: "bob", world: a.world }]);
    expect(state.survivors).toEqual([]);
  } finally {
    cluster.cleanup();
  }
});

/** Two worlds of one cluster behind a front, each with its own map password; the cluster's password too. */
async function twoWorlds(): Promise<{ at: string; one: RunningServer; two: RunningServer; stop: () => void }> {
  const saves = mkdtempSync(join(tmpdir(), "snark-permission-two-"));
  const log = console.log;
  console.log = () => {};
  const start = (name: string, password: string): RunningServer => {
    const config = loadConfig({}, ["-clusterid=perms", `-ClusterDirOverride=${saves}`, `?SessionName=${name}`]).rules;
    return startServer({ port: 0, clientDir: dir, publicUrl: `/${name.toLowerCase()}`, dbPath: join(saves, `${name}.db`), noBackups: true, config, adminPassword: password, clusterPassword: CLUSTER });
  };
  const one = start("Miami", "one-password");
  const two = start("Tampa", "two-password");
  const front = startFront(join(saves, "perms"), 0, "127.0.0.1");
  const at = `http://127.0.0.1:${front.port}`;
  for (let k = 0; k < 200 && (await fetch(`${at}/tampa${PERMISSIONS_STATE}`)).status === 503; k++) await Bun.sleep(50);
  return {
    at, one, two,
    stop: () => {
      front.stop();
      one.stop();
      two.stop();
      console.log = log;
      rmSync(saves, { recursive: true, force: true });
    },
  };
}

test("behind a front, a world's page is answered by that world, with its own gate", async () => {
  const { at, one, two, stop } = await twoWorlds();
  try {
    const [w1, w2] = [one.host.cluster!.world, two.host.cluster!.world];
    expect(w1).not.toBe(w2);
    const mine = signIn("kody", "two-password");
    const theirs = signIn("kody", "one-password");
    const page = `${at}/admin/worlds/${w2}/permissions/`;
    expect([(await fetch(page, { headers: mine })).status, (await fetch(page, { headers: theirs })).status]).toEqual([200, 401]);
    expect([(await fetch(`${at}/tampa${PERMISSIONS_STATE}`, { headers: theirs })).status]).toEqual([401]);
    const state = (await (await fetch(`${at}/tampa${PERMISSIONS_STATE}`, { headers: mine })).json()) as PermissionsState;
    expect([state.me, state.worlds.map((w) => w.id)]).toEqual([{ name: "(kody)", id: "", rank: RANK_MAP, world: w2 }, [w1, w2].sort((a, b) => a - b)]);
    // A staff membership made on Tampa's page holds on Tampa, and Tampa's log has it.
    const ada = idOf(w1, 1);
    issue(two.host.permissions, ada);
    const add = { do: "op", op: { op: "addMember", kind: "survivor", key: ada, group: "Admins" } } as const;
    expect(await fetch(`${at}/tampa${PERMISSIONS_API}`, posted(add, { ...mine, origin: at })).then(answered)).toEqual([200, { ok: true, why: "" }]);
    expect(two.host.permissions.membersIn("Admins").map((m) => m.world)).toEqual([w2]);
    const changes = (s: RunningServer) => s.host.acts.recent().filter((a) => a.kind === "change").map((a) => a.what);
    expect([changes(two), changes(one)]).toEqual([[`Permissions.Add ${ada} Admins`], []]);
    // A map admin may not make it for every map; the cluster's admin makes it for this map unless asked.
    const every = { do: "op", op: { ...add.op, world: 0 } } as const;
    expect(await fetch(`${at}/tampa${PERMISSIONS_API}`, posted(every, { ...mine, origin: at })).then(answered)).toEqual([403, { ok: false, why: "A staff membership is made on its own world, or by the cluster." }]);
    const top = signIn("kody", CLUSTER);
    const here = { do: "op", op: { op: "addMember", kind: "survivor", key: ada, group: "Admins", world: w2, hours: 1 } } as const;
    expect(await fetch(`${at}/tampa${PERMISSIONS_API}`, posted(here, { ...top, origin: at })).then(answered)).toEqual([200, { ok: true, why: "" }]);
    expect(two.host.permissions.membersIn("Admins").map((m) => m.world)).toEqual([w2]);
    // The history is the cluster's: Miami reads Tampa's changes with Tampa's number.
    const read = (await (await fetch(`${at}/miami${PERMISSIONS_HISTORY}`, { headers: signIn("kody", "one-password") })).json()) as PermissionsHistory;
    expect(read.rows.map((r) => [r.world, r.name, r.what])).toEqual([
      [w2, "(kody)", `Permissions.AddTimed ${ada} Admins 1 0`],
      [w2, "(kody)", `Permissions.Add ${ada} Admins`],
    ]);
  } finally {
    stop();
  }
});

test("the front passes the world's POST, and the old cluster addresses go", async () => {
  const { at, one, stop } = await twoWorlds();
  try {
    const w1 = one.host.cluster!.world;
    const top = signIn("kody", CLUSTER);
    expect([frontPasses("POST", PERMISSIONS_API), ...OLD_PERMISSIONS_PATHS.map(sitePost)]).toEqual([true, false, false]);
    for (const old of OLD_PERMISSIONS_PATHS) {
      expect((await fetch(`${at}${old}`, { headers: top })).status).toBe(404);
      expect((await fetch(`${at}${old}`, posted({ do: "op", op: { op: "addGroup", group: "VIP" } }, { ...top, origin: at }))).status).toBe(405);
    }
    for (const old of ["/admin/permissions", "/admin/permissions/"]) {
      const res = await fetch(`${at}${old}?tab=1`, { redirect: "manual" });
      expect([res.status, res.headers.get("location")]).toEqual([308, `/admin/worlds/${w1}/permissions/?tab=1`]);
    }
    expect(one.host.permissions.group("VIP")).toBeUndefined();
  } finally {
    stop();
  }
});

test("a second editor of a whole value is answered 409 with it, and wins sent again", async () => {
  const { h, ask } = world();
  const kody = signIn("kody", MAP);
  operator(h.host, { op: "addGroup", group: "Vip" });
  const send = (op: PermissionOp) => ask(PERMISSIONS_API, posted({ do: "op", op }, kody)).then(answered);
  const cases: [PermissionOp, PermissionOp, (was: string | number) => PermissionOp, () => string | number][] = [
    [{ op: "setChat", group: "Vip", chat: '{"Priority":1}', was: "" }, { op: "setChat", group: "Vip", chat: '{"Priority":2}', was: "" }, (was) => ({ op: "setChat", group: "Vip", chat: '{"Priority":2}', was: was as string }), () => h.host.permissions.group("Vip")!.chat],
    [{ op: "setDocument", name: CHAT_DOCUMENT, text: "{}", was: "" }, { op: "setDocument", name: CHAT_DOCUMENT, text: '{"x":1}', was: "" }, (was) => ({ op: "setDocument", name: CHAT_DOCUMENT, text: '{"x":1}', was: was as string }), () => h.host.permissions.document(CHAT_DOCUMENT)],
    [{ op: "setRank", group: "Vip", rank: RANK_ADMIN, was: 0 }, { op: "setRank", group: "Vip", rank: RANK_STAFF, was: 0 }, (was) => ({ op: "setRank", group: "Vip", rank: RANK_STAFF, was: was as number }), () => h.host.permissions.group("Vip")!.rank],
  ];
  for (const [first, second, again, now] of cases) {
    expect(await send(first)).toEqual([200, { ok: true, why: "" }]);
    const won = now();
    expect(await send(second)).toEqual([409, { ok: false, why: CHANGED_MEANWHILE, current: won }]);
    expect(now()).toEqual(won);
    expect(await send(again(won))).toEqual([200, { ok: true, why: "" }]);
    expect(now()).not.toEqual(won);
  }
  // A refusal over a value changed meanwhile is no refused act: the editor did nothing wrong.
  expect(h.host.acts.recent().filter((a) => a.kind === "refused")).toEqual([]);
  // A command sends no `was`, and is never refused for one.
  expect(h.host.exec("Permissions.Rank Vip open")).not.toMatch(/meanwhile/);
  h.host.shutdown();
});

test("an import applies only the plan it showed", async () => {
  const { s, at, kody } = serve();
  const ask = (path: string, init?: RequestInit): Promise<Response> => fetch(`${at}${path}`, init);
  const digest = await checkedDigest(ask, "commands", LIST, kody);
  const send = (post: PermissionsPost) => ask(PERMISSIONS_API, posted(post, kody)).then(answered);
  // Another admin makes VIP meanwhile: the import would now make one change fewer.
  operator(s.host, { op: "addGroup", group: "VIP" });
  const before = s.host.permissions.snapshot();
  const [status, changed] = await send({ do: "import", kind: "commands", text: LIST, digest });
  expect([status, changed.ok, changed.ops, changed.digest !== digest, changed.notes]).toEqual([409, false, 3, true, expect.arrayContaining(["Permissions.Grant VIP Cheat.fly"])]);
  expect(changed.why).toStartWith("What the import would do changed since it was checked.");
  expect(s.host.permissions.snapshot()).toEqual(before);
  expect(await send(JSON.parse(JSON.stringify({ do: "import", kind: "commands", text: LIST })) as PermissionsPost)).toEqual([400, { ok: false, why: "Check the import first: Apply makes only the changes the check showed." }]);
  expect(s.host.permissions.snapshot()).toEqual(before);
  const [ok, made] = await send({ do: "import", kind: "commands", text: LIST, digest: changed.digest! });
  expect([ok, made.ok, made.ops]).toEqual([200, true, 3]);
  expect(s.host.permissions.group("Top")?.permissions).toEqual(["Cheat.fly"]);
});

test("a running ArkApi server's database and its -wal give the group only in the log", async () => {
  const { s, at, kody } = serve();
  const { main, wal } = runningArkApi(join(dir, "running.db"));
  const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
  const check = async (post: PermissionsPost): Promise<PermissionsAnswer> => (await fetch(`${at}${PERMISSIONS_API}`, posted(post, kody)).then(answered))[1];
  const alone = await check({ do: "plan", kind: "arkapi", text: b64(main) });
  const both = await check({ do: "plan", kind: "arkapi", text: b64(main), wal: b64(wal) });
  expect([alone.notes?.includes("Permissions.AddGroup Late"), both.notes?.includes("Permissions.AddGroup Late")]).toEqual([false, true]);
  expect(alone.notes?.some((n) => n.includes("ends in -wal"))).toBe(true);
  expect(await check({ do: "plan", kind: "commands", text: LIST, wal: b64(wal) })).toEqual({ ok: false, why: "A -wal file goes only beside an ArkApi database." });
  const made = await check({ do: "import", kind: "arkapi", text: b64(main), wal: b64(wal), digest: both.digest! });
  expect([made.ok, s.host.permissions.group("Late")?.permissions]).toEqual([true, ["ArkShop.Kits.late"]]);
});

test("the history pages newest first and holds no password, hash or address", async () => {
  const { h, ada, adaId, ask } = world();
  const kody = signIn("kody", MAP);
  const password = claimed(h, ada, adaId);
  for (const g of ["G1", "G2"]) expect(await ask(PERMISSIONS_API, posted({ do: "op", op: { op: "addGroup", group: g } }, kody)).then(answered)).toEqual([200, { ok: true, why: "" }]);
  const page = async (query: string): Promise<PermissionsHistory> => (await (await ask(`${PERMISSIONS_HISTORY}${query}`, { headers: kody })).json()) as PermissionsHistory;
  const first = await page("?most=2");
  expect([first.rows.map((r) => [r.name, r.via, r.what]), first.more]).toEqual([[["(kody)", "page", "Permissions.AddGroup G2"], ["(kody)", "page", "Permissions.AddGroup G1"]], true]);
  const rest = await page(`?before=${first.rows[1]!.seq}&most=2`);
  expect([rest.rows.map((r) => [r.name, r.id, r.what]), rest.more]).toEqual([[["ada", adaId, "claimed their own password"], ["(operator)", "", `Permissions.Add ${adaId} Admins`]], false]);
  const text = JSON.stringify([first, rest]);
  for (const secret of [password, passwordHash(password), h.host.permissions.secretOf(adaId), "1.2.3.4"]) expect(text).not.toContain(secret);
  expect((await ask(PERMISSIONS_HISTORY, { method: "POST", headers: kody })).status).toBe(405);
  h.host.shutdown();
});

test("the state is answered the same while its key holds, and in full once anything moved", async () => {
  const { h, ada, adaId, ask } = world();
  const kody = signIn("kody", MAP);
  const read = async (key = ""): Promise<PermissionsState | PermissionsSame> => (await (await ask(`${PERMISSIONS_STATE}${key ? `?key=${key}` : ""}`, { headers: kody })).json()) as PermissionsState | PermissionsSame;
  const full = (await read()) as PermissionsState;
  expect(await read(full.key)).toEqual({ same: true, key: full.key });
  const moved = async (what: string, act: () => void): Promise<string> => {
    const was = ((await read()) as PermissionsState).key;
    act();
    const now = (await read(was)) as PermissionsState;
    expect([what, "same" in now]).toEqual([what, false]);
    return now.key;
  };
  await moved("a change", () => operator(h.host, { op: "addGroup", group: "Vip" }));
  // A claim, a new survivor, one leaving, a register write and a change from another map each raise no revision here at once.
  await moved("a claim", () => void claimed(h, ada, adaId));
  await moved("a new survivor", () => (h.join("bea"), h.run(500)));
  await moved("a register write", () => issue(h.host.permissions, idOf(7, 3)));
  await moved("a survivor leaving", () => (ada.close(), h.run(1000)));
  const older = (await read("stale")) as PermissionsState;
  expect([older.key !== "", "groups" in older]).toEqual([true, true]);
  h.host.shutdown();
});

test("a pasted import too long to be one is refused before it is read", async () => {
  const { h, ask } = world();
  const kody = signIn("kody", MAP);
  const long = "Permissions.AddGroup G\n".repeat(20_000);
  const [status, said] = await ask(PERMISSIONS_API, posted({ do: "plan", kind: "commands", text: long }, kody)).then(answered);
  expect([status, said.ok, said.why]).toEqual([413, false, "That is too long to paste as one import: 256 KB at most. Bring it in as several."]);
  h.host.shutdown();
});

test("the history says there is more when its largest page is full", async () => {
  const { h, ask } = world();
  const kody = signIn("kody", MAP);
  for (let i = 0; i < 501; i++) operator(h.host, { op: "addGroup", group: `G${i}` });
  const page = (await (await ask(`${PERMISSIONS_HISTORY}?most=500`, { headers: kody })).json()) as PermissionsHistory;
  expect([page.rows.length <= 500, page.more]).toEqual([true, true]);
  h.host.shutdown();
});
