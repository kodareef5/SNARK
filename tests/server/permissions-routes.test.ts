// The Permissions page's API (server/permissions/routes.ts): the state it reads, the changes, clears and imports it sends,
// who each is made as, what the admin log keeps of them, and what is refused: it never makes, sets or shows a password.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { OPERATOR } from "../../server/acts.ts";
import { adminSite } from "../../server/admin/site.ts";
import { sitePost, startFront } from "../../server/front.ts";
import type { Host } from "../../server/host.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { permissionsAdmin } from "../../server/permissions/routes.ts";
import { passwordHash, staffPasswords } from "../../server/permissions/secrets.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TEAM_RANGE } from "../../server/records.ts";
import { idText } from "../../server/survivor-ids.ts";
import { idOf } from "../../shared/ids.ts";
import type { PermissionOp } from "../../shared/permissions/model.ts";
import { PERMISSIONS_API, PERMISSIONS_STATE, type PermissionsAnswer, type PermissionsPost, type PermissionsState } from "../../shared/permissions/page.ts";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { splitPack } from "../../tools/pack/split.ts";
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

/** A world with the map's password and ada joined, whose pages are asked through the site and its gate. */
function world(opts: { dev?: boolean; log?: (line: string) => void } = {}): { h: Harness; ada: ClientSession; adaId: string; ask: (path: string, init?: RequestInit) => Promise<Response> } {
  const h = new Harness({}, 1, 60, { adminPassword: MAP, log: opts.log ?? (() => {}) });
  const ada = h.join("ada");
  h.run(500);
  const gate = { dev: opts.dev ?? false, password: MAP, cluster: null, guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick, staff: staffPasswords(h.host) };
  const site = {
    dir, base: "", port: 0, id: "local" as const, who: "1.2.3.4", gate, destinations: () => [], scenes: () => new Response(null),
    permissions: (call: Request, at: string) => permissionsAdmin(call, at, h.host),
  };
  const ask = async (path: string, init: RequestInit = {}): Promise<Response> => (await adminSite(new Request(`http://localhost${path}`, init), new URL(`http://localhost${path}`), site))!;
  return { h, ada, adaId: idText(h.host.records.byPid.get(h.client(ada)!.pid)!), ask };
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
    ask(PERMISSIONS_API, posted({ do: "import", kind: "commands", text: "Permissions.AddGroup VIP" }, {})).then(answered),
  ]);
  expect(refusals).toEqual([
    [403, { ok: false, why: "Permissions are managed from an admin's rank." }],
    [403, { ok: false, why: "Permissions are managed from an admin's rank." }],
    [403, { ok: false, why: "An import needs the map rank." }],
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

test("a change from another site's page is refused, and the front passes ours", async () => {
  const saves = mkdtempSync(join(tmpdir(), "snark-permission-front-"));
  const log = console.log;
  console.log = () => {};
  const config = loadConfig({}, ["-clusterid=perms", `-ClusterDirOverride=${saves}`]).rules;
  const miami = startServer({ port: 0, clientDir: dir, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config, clusterPassword: CLUSTER });
  const front = startFront(join(saves, "perms"), 0, "127.0.0.1");
  const at = `http://127.0.0.1:${front.port}`;
  const top = signIn("kody", CLUSTER);
  try {
    for (let k = 0; k < 200 && (await fetch(`${at}${PERMISSIONS_STATE}`, { headers: top })).status === 503; k++) await Bun.sleep(50);
    const state = (await (await fetch(`${at}${PERMISSIONS_STATE}`, { headers: top })).json()) as PermissionsState;
    expect([state.saved, state.me.rank, state.worlds.map((w) => w.id)]).toEqual([true, RANK_CLUSTER, [miami.host.permissions.world]]);
    const add = { do: "op", op: { op: "addGroup", group: "VIP" } } as const;
    const other = await fetch(`${at}${PERMISSIONS_API}`, posted(add, { ...top, origin: "https://elsewhere.example" })).then(answered);
    expect(other).toEqual([403, { ok: false, why: "Open the permissions page on this cluster." }]);
    expect(miami.host.permissions.group("VIP")).toBeUndefined();
    expect(sitePost(PERMISSIONS_API)).toBe(true);
    const ours = await fetch(`${at}${PERMISSIONS_API}`, posted(add, { ...top, origin: at })).then(answered);
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
  const [status, made] = await fetch(`${at}${PERMISSIONS_API}`, posted({ do: "import", kind: "commands", text: LIST }, kody)).then(answered);
  expect([status, made.ok, made.ops, made.refused]).toEqual([200, true, 2, [{ what: "Permissions.Grant Top Cheat.fly", why: "That needs the cluster rank." }]]);
  expect(s.host.permissions.group("VIP")!.permissions).toEqual(["Cheat.fly"]);
  const acts = s.host.acts.recent().filter((a) => a.name === "(kody)" && a.kind !== "sign-in");
  expect(acts.map((a) => [a.kind, a.what])).toEqual([["change", "imported a list of Permissions commands: 2 changes"]]);
});

test("an import below the top rank is refused", async () => {
  const { h, ada: session, adaId, ask } = world();
  const ada = regular(h, session, adaId);
  const check = (await ask(PERMISSIONS_API, posted({ do: "plan", kind: "commands", text: LIST }, ada)).then(answered))[1];
  expect([check.ok, check.notes?.at(-1)]).toEqual([true, "Applying it needs the map rank."]);
  expect(await ask(PERMISSIONS_API, posted({ do: "import", kind: "commands", text: LIST }, ada)).then(answered)).toEqual([403, { ok: false, why: "An import needs the map rank." }]);
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
