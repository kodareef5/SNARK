// The admin pages' gate and the in-game sign-in: the cluster's password above the map's, who a page request acts as, the
// guess count each password may forgive, and what the acts log keeps of sign-ins and of changes made from a page.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorOf, refused, type AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { Act } from "../../shared/acts.ts";
import { RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const MAP = "map-kiwi";
const CLUSTER = "cluster-pear";

// A built client, as far as a server needs one: the manifest and the files it names.
const dir = mkdtempSync(join(tmpdir(), "snark-gate-"));
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

function gate(password: string | null, cluster: string | null): AdminGate {
  return { dev: false, password, cluster, guesses: new Guesses(), tick: () => 0 };
}

/** A request signed in as `user` with `password`, or not signed in. */
function asked(path: string, user?: string, password?: string, init: RequestInit = {}): Request {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (password !== undefined) headers.authorization = `Basic ${btoa(`${user ?? ""}:${password}`)}`;
  return new Request(`http://localhost${path}`, { ...init, headers });
}

/** The gate's answer's status, or 200 where it let the request through. */
function status(g: AdminGate, req: Request, who = "1.2.3.4"): number {
  return refused(req, who, g)?.status ?? 200;
}

/** A server on a port of its own, with the map's and the cluster's passwords. */
function serve(): { s: RunningServer; at: string } {
  const s = startServer({ port: 0, clientDir: dir, probeScene: true, adminPassword: MAP, clusterPassword: CLUSTER });
  running.push(s);
  return { s, at: `http://127.0.0.1:${s.port}` };
}

const signIns = (acts: readonly Act[]): Act[] => acts.filter((a) => a.kind === "sign-in");

test("the cluster password signs in above the map password, in game and on the pages", () => {
  const h = new Harness({}, 1, 60, { adminPassword: MAP, clusterPassword: CLUSTER, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  expect(h.say(ada, `enablecheats ${MAP}`)).toEqual(["cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_MAP);
  // The map's rank is not the highest here, so the cluster's password still raises it.
  expect(h.say(ada, `enablecheats ${CLUSTER}`)).toEqual(["cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_CLUSTER);
  expect(h.say(ada, `enablecheats ${CLUSTER}`)).toEqual(["cheats are already enabled"]);
  h.host.shutdown();

  const g = gate(MAP, CLUSTER);
  const [byMap, byCluster] = [asked("/admin/", "kody", MAP), asked("/admin/", "kody", CLUSTER)];
  expect([status(g, byMap), status(g, byCluster)]).toEqual([200, 200]);
  expect([actorOf(byMap).rank, actorOf(byCluster).rank]).toEqual([RANK_MAP, RANK_CLUSTER]);
});

test("ClusterAdminPassword gives the cluster's rank, and one like the map's is said", () => {
  const said: string[] = [];
  const config = loadConfig({ gus: `[ServerSettings]\nServerAdminPassword=${MAP}\nClusterAdminPassword=${CLUSTER}\n` }).rules;
  const h = new Harness({}, 1, 60, { config, log: (line) => said.push(line) });
  const ada = h.join("ada");
  h.run(500);
  expect(h.say(ada, `enablecheats ${CLUSTER}`)).toEqual(["cheats enabled"]);
  expect([h.client(ada)!.rank, h.host.clusterPassword]).toEqual([RANK_CLUSTER, CLUSTER]);
  h.host.shutdown();
  expect(said.filter((line) => line.includes("they should differ"))).toEqual([]);
  const same = new Harness({}, 1, 60, { adminPassword: MAP, clusterPassword: MAP, log: (line) => said.push(line) });
  same.host.shutdown();
  expect(said.filter((line) => line.includes("they should differ"))).toHaveLength(1);
});

test("a world with only a cluster password opens its pages with it", async () => {
  const g = gate(null, CLUSTER);
  expect([status(g, asked("/admin/")), status(g, asked("/admin/", "x", MAP)), status(g, asked("/admin/", "x", CLUSTER))]).toEqual([401, 401, 200]);
  expect(status(gate(null, null), asked("/admin/", "x", CLUSTER))).toBe(404);

  const h = new Harness({}, 1, 60, { clusterPassword: CLUSTER, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  expect(h.say(ada, `enablecheats ${CLUSTER}`)).toEqual(["cheats enabled"]);
  expect(h.client(ada)!.rank).toBe(RANK_CLUSTER);
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: 0 } });
  const me = await pages.answer(asked("/admin/me.json", "kody", CLUSTER), "1.2.3.4", { ...g, guesses: new Guesses() }, "/admin/me.json")!;
  expect(await me.json()).toEqual({ name: "(kody)", id: "", rank: RANK_CLUSTER, world: 0 });
  h.host.shutdown();
});

test("a typed name with a host password is kept in brackets and carries no ID", () => {
  const g = gate(MAP, CLUSTER);
  const as = (user: string, password: string): [string, string, number, string, string] => {
    const req = asked("/admin/", user, password);
    expect(status(g, req, "203.0.113.9")).toBe(200);
    const by = actorOf(req);
    return [by.name, by.id, by.pid, by.via, by.from];
  };
  expect(as("kody", MAP)).toEqual(["(kody)", "", 0, "page", "203.0.113.9"]);
  // A name no survivor could have is not kept: the password stands in its place.
  for (const user of ["", "(ada)", "a name longer than any survivor's", "<b>"]) expect(as(user, MAP)[0]).toBe("(map password)");
  expect(as("", CLUSTER)[0]).toBe("(cluster password)");
  // Each request is its own actor.
  const [one, two] = [asked("/admin/", "kody", MAP), asked("/admin/", "kody", MAP)];
  status(g, one);
  status(g, two);
  expect(actorOf(one)).not.toBe(actorOf(two));
});

test("a right password of a lower rank forgives no guess at a higher one", () => {
  const g = gate(MAP, CLUSTER);
  const wrong = (): number => status(g, asked("/admin/", "x", "plum"));
  expect([wrong(), wrong(), status(g, asked("/admin/", "x", MAP)), wrong()]).toEqual([401, 401, 200, 401]);
  // Three wrong in all: the map's password did not clear the count, so even the cluster's now waits.
  expect(status(g, asked("/admin/", "x", CLUSTER))).toBe(429);
  const fresh = gate(MAP, CLUSTER);
  const wrongAgain = (): number => status(fresh, asked("/admin/", "x", "plum"));
  expect([wrongAgain(), wrongAgain(), status(fresh, asked("/admin/", "x", CLUSTER)), wrongAgain(), wrongAgain()]).toEqual([401, 401, 200, 401, 401]);
  // Where the map's is the highest password there is, it forgives.
  const alone = gate(MAP, null);
  const wrongAlone = (): number => status(alone, asked("/admin/", "x", "plum"));
  expect([wrongAlone(), wrongAlone(), status(alone, asked("/admin/", "x", MAP)), wrongAlone(), wrongAlone()]).toEqual([401, 401, 200, 401, 401]);

  // In game, the same rule over the same count, which the pages share.
  const h = new Harness({}, 1, 60, { adminPassword: MAP, clusterPassword: CLUSTER, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  const who = h.client(ada)!.conn.address ?? "ada";
  const shared: AdminGate = { ...gate(MAP, CLUSTER), guesses: h.host.game.sessions.cheatGuesses, tick: () => h.world.tick };
  expect([h.say(ada, "enablecheats plum"), h.say(ada, "enablecheats plum"), h.say(ada, `enablecheats ${MAP}`)].map((r) => r[0])).toEqual(["wrong password", "wrong password", "cheats enabled"]);
  expect(status(shared, asked("/admin/", "x", "plum"), who)).toBe(401);
  expect(h.say(ada, `enablecheats ${CLUSTER}`)[0]).toStartWith("too many wrong passwords");
  h.host.shutdown();
});

test("an open development page acts with cheats only", async () => {
  // Development comes first, as before: a server with passwords that is a development one stays open to whoever it lets in.
  for (const g of [{ ...gate(null, null), dev: true }, { ...gate(MAP, CLUSTER), dev: true }]) {
    const req = asked("/admin/");
    expect(status(g, req, "127.0.0.1")).toBe(200);
    const by = actorOf(req);
    expect([by.name, by.id, by.pid, by.rank, by.via, by.from]).toEqual(["(development)", "", 0, RANK_STAFF, "page", "127.0.0.1"]);
  }
  // A request the gate never passed is the nameless page, which manages nothing either.
  expect(actorOf(asked("/admin/")).name).toBe("(admin page)");
});

test("a page's sign-in is logged once, not with every request", async () => {
  const { s, at } = serve();
  const me = (user: string): Promise<Response> => fetch(`${at}/admin/me.json`, { headers: { authorization: `Basic ${btoa(`${user}:${MAP}`)}` } });
  for (let i = 0; i < 3; i++) expect(await (await me("kody")).json()).toEqual({ name: "(kody)", id: "", rank: RANK_MAP, world: 0 });
  await me("ana");
  const signed = signIns(s.host.acts.recent());
  expect(signed.map((a) => [a.name, a.rank, a.via, a.what])).toEqual([
    ["(kody)", RANK_MAP, "page", "opened the admin pages"],
    ["(ana)", RANK_MAP, "page", "opened the admin pages"],
  ]);
});

test("a setting changed from a page is logged under who changed it", async () => {
  const { s, at } = serve();
  const res = await fetch(`${at}/admin/settings`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`kody:${CLUSTER}`)}`, "content-type": "application/json" },
    body: JSON.stringify({ op: "set", name: "XPMultiplier", value: "3" }),
  });
  expect(res.status).toBe(200);
  const changes = s.host.acts.recent().filter((a) => a.kind === "command");
  expect(changes.map((a) => [a.name, a.id, a.rank, a.via, a.what])).toEqual([["(kody)", "", RANK_CLUSTER, "page", "setting XPMultiplier 3"]]);
  expect(changes[0]!.from).toEndWith("127.0.0.1");
});

test("a page's change that logs nothing itself is logged by its path", async () => {
  const { s, at } = serve();
  const cast = (body: unknown): Promise<Response> => fetch(`${at}/admin/cast`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`kody:${MAP}`)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect((await cast({ op: "set", name: "CastActivity", value: "2" })).status).toBe(200);
  // A change refused is no change, and is not logged.
  expect((await cast({ op: "set", name: "CastModelKey", value: "x" })).status).toBe(400);
  const changes = s.host.acts.recent().filter((a) => a.kind === "command");
  expect(changes.map((a) => [a.name, a.rank, a.what])).toEqual([["(kody)", RANK_MAP, "POST /admin/cast"]]);
});

test("a sign-in never puts the password in an act", async () => {
  const { s, at } = serve();
  await fetch(`${at}/admin/me.json`, { headers: { authorization: `Basic ${btoa(`kody:${CLUSTER}`)}` } });
  await fetch(`${at}/admin/me.json`, { headers: { authorization: `Basic ${btoa(`(x):${MAP}`)}` } });
  const h = new Harness({}, 1, 60, { adminPassword: MAP, clusterPassword: CLUSTER, log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, `enablecheats ${MAP}`);
  h.say(ada, `enablecheats ${CLUSTER}`);
  const acts = [...s.host.acts.recent(), ...h.host.acts.recent()];
  h.host.shutdown();
  expect(signIns(acts).map((a) => [a.name, a.what])).toEqual([
    ["(kody)", "opened the admin pages"],
    ["(map password)", "opened the admin pages"],
    ["ada", "enablecheats with the map's password"],
    ["ada", "enablecheats with the cluster's password"],
  ]);
  const text = JSON.stringify(acts);
  for (const secret of [MAP, CLUSTER]) expect(text).not.toContain(secret);
});

test("the acts answer hides addresses from a viewer below the map's rank", async () => {
  const h = new Harness({}, 1, 60, { adminPassword: MAP, log: () => {} });
  h.host.acts.write({ name: "ada", id: "", pid: 0, rank: RANK_MAP, via: "page", from: "203.0.113.9" }, "settime 6:30");
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: 0 } });
  const read = async (g: AdminGate, password?: string): Promise<string[]> => {
    const res = await pages.answer(asked("/admin/acts.json?after=0", "kody", password), "1.2.3.4", g, "/admin/acts.json")!;
    return ((await res.json()) as { acts: Act[] }).acts.map((a) => a.from);
  };
  expect(await read({ ...gate(null, null), dev: true })).toEqual([""]);
  expect(await read(gate(MAP, null), MAP)).toEqual(["203.0.113.9"]);
  const seq = h.host.acts.recent()[0]!.seq;
  const later = await pages.answer(asked(`/admin/acts.json?after=${seq}`, "kody", MAP), "1.2.3.4", gate(MAP, null), "/admin/acts.json")!;
  expect(await later.json()).toEqual({ acts: [] });
  h.host.shutdown();
});
