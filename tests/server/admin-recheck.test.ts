// The admin pages' changes, judged again as they are made. B's gate reads B's view of the permissions, up to 5 s old,
// and a request's body may come later still: an admin lowered on map A a moment ago changes nothing on B.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { TitleScenes } from "../../server/admin/title-scenes.ts";
import { WORLD_POSTS } from "../../server/front.ts";
import { POLL_MS } from "../../server/permissions/permissions.ts";
import { staffPasswords } from "../../server/permissions/secrets.ts";
import { idText } from "../../server/survivor-ids.ts";
import { VideoLibrary } from "../../server/video/library.ts";
import { SCREEN_POSTS, screensAdmin } from "../../server/video/routes.ts";
import { PERMISSIONS_API } from "../../shared/permissions/page.ts";
import { OPENING_SHOT } from "../../shared/title-scene.ts";
import { TestCluster, beat, rec, type Clock, type Server } from "../fixtures/cluster.ts";

const MAP_A = "Tui-Map-A-7731";
const MAP_B = "Kea-Map-B-4402";
const CLUSTER = "Moa-Cluster-9915";
const SCENES = "/admin/scenes/api";
const LOWERED = "Your groups no longer give you the admin rank. Nothing was changed.";
const CLEARED = "Your password was replaced or cleared since this page signed in. Nothing was changed.";
const UNREAD = "The permissions file could not be read, so nothing was changed. Try again in a moment.";

interface Maps {
  cluster: TestCluster;
  clock: Clock;
  a: Server;
  b: Server;
}

/** Map A and map B over one cluster folder, each with its own password and the cluster's, on one wall clock. */
async function maps(run: (m: Maps) => Promise<void>): Promise<void> {
  const cluster = new TestCluster();
  try {
    const clock = { ms: 1_000_000_000 };
    const host = (password: string) => ({ host: { adminPassword: password, clusterPassword: CLUSTER, claimWaitMs: 0, survivorLog: { wall: () => clock.ms } } });
    const a = cluster.server("a", "f", clock, host(MAP_A));
    const b = cluster.server("b", "f", clock, host(MAP_B));
    beat(a, b);
    await run({ cluster, clock, a, b });
  } finally {
    cluster.cleanup();
  }
}

const idIn = (s: Server, name: string): string => idText(rec(s, name)!);
const keptActs = (s: Server) => s.h.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
const groupsOn = (s: Server, id: string): string[] => s.h.host.permissions.membersOf("survivor", id).map((m) => m.group);
const refusals = (s: Server) => keptActs(s).filter((act) => act.kind === "refused").map((act) => [act.name, act.what]);

/** The operator's change on a map, which must be made. */
function must(s: Server, line: string): void {
  const before = keptActs(s).length;
  const out = s.h.host.exec(line);
  if (keptActs(s).length !== before + 1 || keptActs(s).at(-1)!.kind !== "change") throw new Error(`${line}: ${out}`);
}

/** `session` claims its own password: the one only its session was sent. */
function claim(s: Server, session: ClientSession): string {
  s.h.say(session, "claimpassword");
  const password = session.secret;
  session.secret = "";
  if (password === "") throw new Error(`${session.name} claimed no password`);
  return password;
}

/** Ada, put in Admins on every map by A's operator, with her own password claimed on B, which has read the store. */
function adminOnB(m: Maps): { id: string; password: string } {
  const { session } = m.cluster.survivor(m.b, "ada");
  const id = idIn(m.b, "ada");
  must(m.a, `Permissions.Add ${id} Admins all`);
  m.clock.ms += POLL_MS;
  m.b.h.run(200);
  return { id, password: claim(m.b, session) };
}

/** A body still on its way: the request is sent, and its body arrives when `arrive` is called. */
function onItsWay(): { body: ReadableStream<Uint8Array>; arrive(bytes: Uint8Array | string): void } {
  let to!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (to = c) });
  return { body, arrive: (bytes) => (to.enqueue(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes), to.close()) };
}

/** B's admin pages as its server answers them, through the real gate: the world's pages, its screens and the scene studio. */
function pagesOf(s: Server, dir: string) {
  const host = s.h.host;
  const gate: AdminGate = {
    dev: false, password: host.adminPassword, cluster: host.clusterPassword, guesses: host.game.sessions.cheatGuesses, tick: () => s.h.world.tick, world: s.world, staff: staffPasswords(host),
  };
  const pages = new AdminPages({ host, meter: new TickMeter(() => gaugesOf(host)), dir, start: { tick: 0, wall: 0 } });
  mkdirSync(join(dir, "dist"), { recursive: true });
  const starters = join(dir, "dist", "starter.json");
  writeFileSync(starters, JSON.stringify({ clips: [], channels: [] }));
  const lib = new VideoLibrary({ db: join(dir, "video.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), starters });
  const scenes = new TitleScenes(join(dir, "shots.sqlite"));
  const screen = () => ({ night: false, seconds: 0, hour: 12, only: -1, gain: 1 });
  /** Sends a POST to `path` signed in as `user`, its body a stream that may still be on its way. */
  const post = (path: string, user: string, password: string, body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}): Promise<Response> => {
    const req = new Request(`http://localhost${path}`, {
      method: "POST", body, duplex: "half",
      headers: { authorization: `Basic ${btoa(`${user}:${password}`)}`, "content-type": "application/json", ...headers },
    } as RequestInit);
    const no = refused(req, "1.2.3.4", gate);
    if (no) return Promise.resolve(no);
    if (path === SCENES) return scenes.admin(req, host.acts, host);
    return Promise.resolve(screensAdmin(req, path, lib, screen, host.acts, host) ?? pages.answer(req, "1.2.3.4", gate, path)!);
  };
  return { post, lib, scenes, close: () => (lib.close(), scenes.close()) };
}

/** Starts a change by Ada, lowers her on A as `lower` says, then lets the body arrive. B has not polled meanwhile. */
async function lowered(m: Maps, path: string, body: unknown, lower: (id: string) => string): Promise<{ res: Response; id: string }> {
  const { id, password } = adminOnB(m);
  const pages = pagesOf(m.b, join(m.cluster.dir, "pages"));
  try {
    const way = onItsWay();
    const answer = pages.post(path, id, password, way.body);
    must(m.a, lower(id));
    // B's own view still holds her as an admin: only a look at the file now can tell.
    expect(groupsOn(m.b, id)).toEqual(["Admins"]);
    way.arrive(JSON.stringify(body));
    return { res: await answer, id };
  } finally {
    pages.close();
  }
}

test("a settings change on its way when A takes her out of Admins is refused on B", async () => {
  await maps(async (m) => {
    const was = m.b.h.host.rules.num("XPMultiplier");
    const { res } = await lowered(m, "/admin/settings", { op: "set", name: "XPMultiplier", value: "7" }, (id) => `Permissions.Remove ${id} Admins`);
    expect([res.status, await res.json()]).toEqual([403, { ok: false, why: LOWERED, error: LOWERED }]);
    expect(m.b.h.host.rules.num("XPMultiplier")).toBe(was);
    expect(refusals(m.b)).toEqual([["ada", `POST /admin/settings: ${LOWERED}`]]);
  });
});

test("a stop on its way when A takes her out of Admins is refused on B", async () => {
  await maps(async (m) => {
    const { res } = await lowered(m, "/admin/stop", { seconds: 60 }, (id) => `Permissions.Remove ${id} Admins`);
    expect(res.status).toBe(403);
    expect(m.b.h.host.stopLeft).toBe(-1);
    expect(refusals(m.b)).toEqual([["ada", `POST /admin/stop: ${LOWERED}`]]);
  });
});

test("a settings change and a stop on their way when A clears her password", async () => {
  await maps(async (m) => {
    const was = m.b.h.host.rules.num("XPMultiplier");
    const set = await lowered(m, "/admin/settings", { op: "set", name: "XPMultiplier", value: "7" }, (id) => `Permissions.Password ${id} clear`);
    expect([set.res.status, ((await set.res.json()) as { why: string }).why]).toEqual([403, CLEARED]);
    expect(m.b.h.host.rules.num("XPMultiplier")).toBe(was);
    expect(refusals(m.b)).toEqual([["ada", `POST /admin/settings: ${CLEARED}`]]);
  });
  await maps(async (m) => {
    const stop = await lowered(m, "/admin/stop", { seconds: 60 }, (id) => `Permissions.Password ${id} clear`);
    expect(stop.res.status).toBe(403);
    expect(m.b.h.host.stopLeft).toBe(-1);
  });
});

test("Cast, a loadout reset and a drop book reset on their way are refused on B", async () => {
  const cases: [string, (b: Server) => unknown, (b: Server) => number][] = [
    ["/admin/cast", () => ({ op: "set", name: "CastActivity", value: "1.5" }), (b) => b.h.host.rules.num("CastActivity")],
    ["/admin/loadouts/reset", (b) => ({ expected: b.h.host.loadoutBook.book.revision }), (b) => b.h.host.loadoutBook.book.revision],
    ["/admin/supply/reset", (b) => ({ revision: b.h.host.supplyBook.book.revision }), (b) => b.h.host.supplyBook.book.revision],
  ];
  for (const [path, body, probe] of cases) {
    await maps(async (m) => {
      const was = probe(m.b);
      const { res } = await lowered(m, path, body(m.b), (id) => `Permissions.Remove ${id} Admins`);
      expect([path, res.status, probe(m.b)]).toEqual([path, 403, was]);
      expect(refusals(m.b)).toEqual([["ada", `POST ${path}: ${LOWERED}`]]);
    });
  }
});

test("every admin POST the front passes is judged again once its body is in", async () => {
  const clip = readFileSync(join(import.meta.dir, "../fixtures/video/small.mp4"));
  /** What each route is sent, and whether it changes anything: a pasted override is only read into the page's draft. */
  const sent: Record<string, { body: Uint8Array | string; headers?: Record<string, string>; reads?: true }> = {
    "/admin/cast": { body: JSON.stringify({ op: "set", name: "CastActivity", value: "1.5" }) },
    "/admin/settings": { body: JSON.stringify({ op: "set", name: "XPMultiplier", value: "7" }) },
    "/admin/stop": { body: JSON.stringify({ seconds: 60 }) },
    "/admin/loadouts/book": { body: JSON.stringify({ expected: 0, book: {} }) },
    "/admin/loadouts/reset": { body: "{}" },
    "/admin/loadouts/apply": { body: JSON.stringify({ loadout: "naked", pid: 1 }) },
    "/admin/supply/book": { body: JSON.stringify({ revision: 0, book: {} }) },
    "/admin/supply/reset": { body: JSON.stringify({ revision: 0 }) },
    "/admin/supply/restore": { body: JSON.stringify({ revision: 0, to: 0 }) },
    "/admin/supply/call": { body: JSON.stringify({ x: 0, z: 0, tier: "white", cls: "plain" }) },
    "/admin/supply/land": { body: JSON.stringify({ id: "all" }) },
    "/admin/supply/cancel": { body: JSON.stringify({ id: "all" }) },
    "/admin/supply/ark": { body: JSON.stringify({ text: "" }), reads: true },
    "/admin/screens/upload": { body: clip, headers: { "content-type": "video/mp4", "content-length": String(clip.length) } },
    "/admin/screens/clip": { body: JSON.stringify({ id: "0000000000000000", title: "x", rights: "x" }) },
    "/admin/screens/edit": { body: JSON.stringify({ revision: 0, op: "screen", screen: "orb", show: "night" }) },
    [SCENES]: { body: JSON.stringify({ shot: OPENING_SHOT, revision: 0, publish: false }) },
  };
  // The Permissions page's own changes are judged inside the store's write (permissions-two-maps.test.ts).
  const posts = [...WORLD_POSTS].filter((p) => p.startsWith("/admin/") && p !== PERMISSIONS_API).concat(SCREEN_POSTS, [SCENES]);
  expect(posts.filter((p) => !(p in sent))).toEqual([]);
  await maps(async (m) => {
    const { id, password } = adminOnB(m);
    const pages = pagesOf(m.b, join(m.cluster.dir, "pages"));
    try {
      // Every request passes B's gate first; then A takes her out of Admins, and then the bodies arrive.
      const ways = posts.map((path) => ({ path, way: onItsWay() }));
      const answers = ways.map(({ path, way }) => pages.post(path, id, password, way.body, sent[path]!.headers));
      must(m.a, `Permissions.Remove ${id} Admins`);
      for (const { path, way } of ways) way.arrive(sent[path]!.body);
      const statuses = await Promise.all(answers.map((a) => a.then((r) => r.status)));
      expect(posts.map((p, i) => [p, sent[p]!.reads ? statuses[i] !== 403 : statuses[i]])).toEqual(posts.map((p) => [p, sent[p]!.reads ? true : 403]));
      expect(refusals(m.b).map(([, what]) => what.slice(0, what.indexOf(":"))).sort()).toEqual(posts.filter((p) => !sent[p]!.reads).map((p) => `POST ${p}`).sort());
      // The upload left no clip, waiting or kept, and no file of its own.
      const files = ["media", "tmp"].flatMap((f) => readdirSync(join(m.cluster.dir, "pages", f))).filter((f) => !f.endsWith(".json"));
      expect([pages.lib.view().doc.clips.length, files, m.b.h.host.stopLeft]).toEqual([0, [], -1]);
    } finally {
      pages.close();
    }
  });
});

test("a host-password admin changes a setting at once, with the store locked", async () => {
  await maps(async (m) => {
    const pages = pagesOf(m.b, join(m.cluster.dir, "pages"));
    const lock = new Database(join(m.b.h.host.cluster!.folder.root, "permissions.sqlite"));
    try {
      lock.exec("BEGIN EXCLUSIVE");
      const from = performance.now();
      const res = await pages.post("/admin/settings", "kody", MAP_B, JSON.stringify({ op: "set", name: "XPMultiplier", value: "7" }));
      // A look at a locked file waits a quarter second: a host password never looks.
      expect([res.status, performance.now() - from < 200]).toEqual([200, true]);
      expect(m.b.h.host.rules.num("XPMultiplier")).toBe(7);
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
      pages.close();
    }
  });
});

test("a locked store refuses an own-password admin's change with 503, not a throw", async () => {
  await maps(async (m) => {
    const { id, password } = adminOnB(m);
    const pages = pagesOf(m.b, join(m.cluster.dir, "pages"));
    const lock = new Database(join(m.b.h.host.cluster!.folder.root, "permissions.sqlite"));
    const was = m.b.h.host.rules.num("XPMultiplier");
    const change = JSON.stringify({ op: "set", name: "XPMultiplier", value: "7" });
    try {
      lock.exec("BEGIN EXCLUSIVE");
      const res = await pages.post("/admin/settings", id, password, change);
      expect([res.status, ((await res.json()) as { why: string }).why]).toEqual([503, UNREAD]);
      expect(m.b.h.host.rules.num("XPMultiplier")).toBe(was);
      expect(refusals(m.b)).toEqual([["ada", `POST /admin/settings: ${UNREAD}`]]);
      lock.exec("ROLLBACK");
      // Once the file can be read she is an admin still, and the change is made.
      expect((await pages.post("/admin/settings", id, password, change)).status).toBe(200);
      expect(m.b.h.host.rules.num("XPMultiplier")).toBe(7);
    } finally {
      if (lock.inTransaction) lock.exec("ROLLBACK");
      lock.close();
      pages.close();
    }
  });
});
