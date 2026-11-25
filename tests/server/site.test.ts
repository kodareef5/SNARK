// Worlds reached at paths of one host (--public-url /miami), the site around them, and the front that sends each path to its
// world (server/site.ts, server/front.ts).

import type { SupplyBook } from "../../shared/supply/book.ts";
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_TERRAIN_SIDE } from "../../shared/admin.ts";
import { ClusterFolder } from "../../server/cluster/folder.ts";
import { clientAddress, closeCode, frontRoute, frontWorlds, sendDown, startFront, type Pipe } from "../../server/front.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { startServer, type RunningServer } from "../../server/main.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { linkOf, pathOf, placeOf, startPage, worldAddress } from "../../server/site.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { corePackBytes } from "../fixtures/pack.ts";

// A built client, as far as these servers need one: the manifest and the files it names, a page, and a wiki's front page.
const dir = mkdtempSync(join(tmpdir(), "snark-site-"));
const { files, manifest } = splitPack(corePackBytes(), "core");
mkdirSync(join(dir, "assets"));
for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dir, "assets", manifest.files[f]!.name), file.bytes);
writeFileSync(join(dir, "assets/manifest.json"), JSON.stringify(manifest));
writeFileSync(join(dir, "index.html"), "<!doctype html><title>the game</title>");
mkdirSync(join(dir, "wiki"));
writeFileSync(join(dir, "wiki/index.html"), "<!doctype html><title>the wiki</title>");
const adminDir = join(dir, "admin");
mkdirSync(adminDir);
for (const file of ["index", "cluster", "scene-studio", "settings", "loadouts", "drops", "cast", "first-frame", "sounds"]) {
  writeFileSync(join(adminDir, `${file}.html`), `<title>admin ${file}</title>`);
}
writeFileSync(join(adminDir, "cluster.js"), "export {};");
writeFileSync(join(adminDir, "admin.css"), "body{color:white}");
writeFileSync(join(dir, "scene-studio.js"), "export const studio = true;");
writeFileSync(join(dir, "sounds.html"), "the old board");
const running: { stop(): void }[] = [];
afterAll(() => {
  for (const r of running) r.stop();
  rmSync(dir, { recursive: true, force: true });
});

const get = (at: string, init: RequestInit = {}): Promise<Response> => fetch(at, { redirect: "manual", signal: AbortSignal.timeout(5000), ...init });

/** Whether a socket to `url` opens, sent as a page of `origin` would send it (null for a program, which sends none). */
function opens(url: string, origin: string | null): Promise<boolean> {
  return new Promise((done) => {
    const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
    const timer = setTimeout(() => (ws.close(), done(false)), 5000);
    ws.onopen = () => (clearTimeout(timer), ws.close(), done(true));
    ws.onerror = ws.onclose = () => (clearTimeout(timer), done(false));
  });
}

test("a server's path is its public address's, plain words that are not the site's own; a request falls in its world, on the site, or at the path itself", () => {
  expect([pathOf(""), pathOf("https://play.example"), pathOf("https://play.example/"), pathOf("https://play.example/miami/"), pathOf("/miami"), pathOf("/eu/miami")]).toEqual(["", "", "", "/miami", "/miami", "/eu/miami"]);
  for (const bad of ["/mi ami", "/miami?x", "//miami", "/..", "/wiki", "https://play.example/assets", "/source/x", "/cluster", "/cluster/admin", "/admin/miami", "javascript:alert(1)", "ftp://play.example/miami"]) expect(() => pathOf(bad)).toThrow("--public-url");
  expect([placeOf("", "/ws"), placeOf("/miami", "/miami"), placeOf("/miami", "/miami/ws"), placeOf("/miami", "/"), placeOf("/miami", "/miamiz/ws")]).toEqual([
    { at: "world", path: "/ws" },
    { at: "slash", path: "/miami" },
    { at: "world", path: "/ws" },
    { at: "site", path: "/" },
    { at: "site", path: "/miamiz/ws" },
  ]);
});

test("the first title response offers play and chooses one poster orientation", () => {
  const html = startPage([], { wiki: "", repository: "" }, { world: true, directory: "" });
  expect(html).toContain('data-action="begin">Play</button>');
  expect(html).toContain('data-action="servers">Browse worlds</button>');
  expect(html).toContain('href="/cluster/title-poster.webp?portrait" media="(orientation: portrait)"');
  expect(html).toContain('<noscript><h1>SNARK</h1>');
  expect(html).not.toContain("flight.html");
  expect(html).not.toContain('src="main.js"');
});

test("the start screen lists each world with its count and goes to its path, and a link is only ever an address or a path of the site", () => {
  expect([worldAddress({ url: "/miami", port: 8798 }, "abc.trycloudflare.com", false), worldAddress({ url: "https://tampa.example/", port: 8799 }, "x", false), worldAddress({ url: "", port: 8799 }, "192.168.1.20:8798", true)]).toEqual(["/miami/", "https://tampa.example/", "//192.168.1.20:8799/"]);
  // A page that came straight to a world's port goes to the other's port, under its path.
  expect(worldAddress({ url: "/tampa", port: 8799 }, "localhost:8798", true)).toBe("//localhost:8799/tampa/");
  expect([linkOf(" /wiki/ "), linkOf("https://git.example.com/snark"), linkOf("javascript:alert(1)"), linkOf("wiki"), linkOf(""), linkOf("//elsewhere.example/"), linkOf("/\\elsewhere.example/")]).toEqual(["/wiki/", "https://git.example.com/snark", "", "", "", "", ""]);
  const page = startPage(
    [
      { id: 1, name: "Miami", map: "Miami", mapId: "core:miami", address: "/miami/", players: 3, max: 70 },
      { id: 2, name: "<Tampa>", map: "Tampa", mapId: "core:tampa", address: "/tampa/", players: 70, max: 70 },
    ],
    { wiki: "/wiki/", repository: "" },
  );
  expect(page).toContain('<a href="/miami/"><span class="name">Miami</span><span class="count">3 of 70 online</span></a>');
  expect(page).toContain('<li class="full"><a href="/tampa/"><span class="name">&#60;Tampa&#62;</span><span class="map">Tampa</span><span class="count">full, 70 of 70</span>');
  expect([page.includes('href="/wiki/">Wiki'), page.includes("Source code")]).toEqual([true, false]);
  expect(startPage([], { wiki: "", repository: "" })).toContain("No world is running.");
});

test("a server reached at /miami answers its world under it, sends /miami on with its slash, and answers the site around it everywhere else", async () => {
  const config = loadConfig({}, ["?SessionName=Miami", "?WikiUrl=https://wiki.example/snark", "?RepositoryUrl="]).rules;
  const s = startServer({ hostname: "127.0.0.1", port: 0, clientDir: dir, probeScene: true, publicUrl: "/miami", config });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  const slash = await get(`${at}/miami?name=Ada`);
  expect([slash.status, slash.headers.get("location")]).toEqual([308, "/miami/?name=Ada"]);
  // The world's page, and the map's head it is told to ask for at once, named beside it.
  const page = await get(`${at}/miami/`);
  expect([page.status, await page.text(), /^<map\/head\.[0-9a-f]{16}\.part>; rel=preload/.test(page.headers.get("link") ?? "")]).toEqual([200, "<!doctype html><title>the game</title>", true]);
  const head = (page.headers.get("link") ?? "").slice(1, page.headers.get("link")!.indexOf(">"));
  expect([(await get(`${at}/miami/${head}`)).status, (await get(`${at}/miami/map/head.0123456789abcdef.part`)).status]).toEqual([200, 404]);
  expect([(await get(`${at}/miami/map.json`)).status, (await get(`${at}/miami/assets/manifest.json`)).status]).toEqual([200, 200]);
  expect(await (await get(`${at}/miami/links.json`)).json()).toEqual({ wiki: "https://wiki.example/snark", repository: "" });
  // What the world runs, for the wiki's figures: its public settings not at their default, beside its links, and on the site
  // as the world that answers it, which the page names.
  const said = { name: "Miami", map: "proving:1", settings: {} };
  expect([await (await get(`${at}/miami/settings.json`)).json(), await (await get(`${at}/settings.json`)).json()]).toEqual([said, said]);
  // The worlds running, as the start screen lists them, for the wiki's maps: with no cluster, this one alone.
  const alone = [{ id: "local", name: "Miami", map: "proving:1", mapId: "proving:1", address: "/miami/", players: 0, max: 70 }];
  expect([await (await get(`${at}/miami/worlds.json`)).json(), await (await get(`${at}/worlds.json`)).json()]).toEqual([alone, alone]);
  // Its sockets are under its path, and not at the root, which is the site's.
  expect([await opens(`ws://127.0.0.1:${s.port}/miami/ws`, null), await opens(`ws://127.0.0.1:${s.port}/ws`, null)]).toEqual([true, false]);
  // The site: the start screen with this world alone, at its port since the page came straight to it, the wiki at /wiki/, and
  // the page the source link goes to by default.
  const start = await (await get(`${at}/`)).text();
  expect([start.includes('href="/miami/"'), start.includes("0 of 70 online"), start.includes('href="https://wiki.example/snark"'), start.includes("Source code")]).toEqual([true, true, true, false]);
  const wiki = await get(`${at}/wiki?x=1`);
  expect([wiki.status, wiki.headers.get("location"), await (await get(`${at}/wiki/`)).text()]).toEqual([308, "wiki/?x=1", "<!doctype html><title>the wiki</title>"]);
  expect([(await get(`${at}/source/`)).status, (await (await get(`${at}/source/`)).text()).includes("Coming soon")]).toEqual([200, true]);
  expect([await (await get(`${at}/sounds.html`)).text(), (await get(`${at}/admin/sounds.json`)).status]).toEqual(["not found", 404]);
  for (const path of ["/Sounds.html", "//sounds.html", "/Admin/index.html", "/admin/stats.json"]) expect([path, await (await get(`${at}${path}`)).text()]).toEqual([path, "not found"]);
  for (const path of ["/miami/sounds.html", "/miami/Sounds.html", "/miami/admin/", "/miami/ADMIN/stats.json", "/miami/admin/survivors.json", "/admin/worlds/local/map/"]) expect(await (await get(`${at}${path}`)).text()).toStartWith("the admin pages open on a development server");
});

test("standalone admin serves public navigation and gates each world tool", async () => {
  const s = startServer({ hostname: "127.0.0.1", port: 0, clientDir: dir, probeScene: true, adminPassword: "operator" });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  const good = { headers: { authorization: `Basic ${btoa("x:operator")}` } };
  for (const path of ["/admin/", "/admin/chat/"]) expect(await (await get(at + path)).text()).toBe("<title>admin cluster</title>");
  for (const [from, to] of [["/admin", "/admin/"], ["/admin/chat", "/admin/chat/"], ["/cluster/admin/", "/admin/"]]) {
    const res = await get(`${at}${from}?tab=chat`);
    expect([res.status, res.headers.get("location")]).toEqual([308, `${to}?tab=chat`]);
  }
  for (const page of ["map", "survivors", "items", "health", "saves", "restart", "settings", "loadouts", "drops", "cast", "first-frame", "sounds"]) {
    const path = `${at}/admin/worlds/local/${page}/`;
    expect((await get(path)).status).toBe(401);
    const res = await get(path, good);
    const file = ["map", "survivors", "items", "health", "saves", "restart"].includes(page) ? "index" : page;
    expect([res.status, res.headers.get("cache-control"), await res.text()]).toEqual([200, "no-store", `<title>admin ${file}</title>`]);
  }
  const map = await get(`${at}/admin/worlds/local/?survivor=Ada`, good);
  expect([map.status, map.headers.get("location")]).toEqual([308, "/admin/worlds/local/map/?survivor=Ada"]);
  for (const [old, page] of [["/sounds.html", "sounds"], ["/admin/index.html", "map"], ["/admin/drops.html", "drops"]]) {
    const res = await get(at + old, good);
    expect([res.status, res.headers.get("location")]).toEqual([308, `/admin/worlds/local/${page}/`]);
  }
  expect(await (await get(`${at}/admin/ui/admin.css`)).text()).toBe("body{color:white}");
  expect(await (await get(`${at}/admin/ui/scene-studio.js`)).text()).toBe("export const studio = true;");
  for (const path of ["/admin/ui/index.html", "/admin/ui/admin.js.gz", "/admin/worlds/99/map/", "/admin/worlds/local/toString/"]) expect((await get(at + path, good)).status).toBe(404);
  expect((await get(`${at}/admin/scenes/`)).status).toBe(401);
  expect(await (await get(`${at}/admin/scenes/`, good)).text()).toBe("<title>admin scene-studio</title>");
  expect((await get(`${at}/admin/scenes/api`, good)).status).toBe(200);
  expect(await (await get(`${at}/admin/map-context.json`, good)).json()).toEqual({ districts: [] });
});

test("a server at the root of its host is all world as before, and has the page the source link goes to and its links", async () => {
  const s = startServer({ hostname: "127.0.0.1", port: 0, clientDir: dir, probeScene: true });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  expect([await (await get(`${at}/`)).text(), (await get(`${at}/source/`)).status]).toEqual(["<!doctype html><title>the game</title>", 200]);
  expect(await (await get(`${at}/links.json`)).json()).toEqual({ wiki: "/wiki/", repository: "/source/" });
});

test("canonical links to an external world go to its announced mount", async () => {
  const saves = mkdtempSync(join(dir, "external-"));
  const config = loadConfig({}, ["-clusterid=external", `-ClusterDirOverride=${saves}`, "?SessionName=Miami"]).rules;
  const local = startServer({ hostname: "127.0.0.1", port: 0, clientDir: dir, publicUrl: "/miami", dbPath: join(saves, "miami.db"), noBackups: true, config });
  running.push(local);
  const folder = local.host.cluster!.folder;
  const announcement = folder.announcement(local.host.cluster!.world)!;
  folder.announce({ ...announcement, world: announcement.world + 1, url: "https://remote.example/region/tampa" });
  const front = startFront(join(saves, "external"), 0, "127.0.0.1");
  running.push(front);
  const path = `/admin/worlds/${announcement.world + 1}/map/?survivor=Ada`;
  for (const port of [local.port, front.port]) {
    const res = await get(`http://127.0.0.1:${port}${path}`);
    expect([res.status, res.headers.get("location")]).toEqual([307, `https://remote.example/region/tampa${path}`]);
  }
});

test("a standalone title stays at the proxy origin and the game preloads its map at the play URL", async () => {
  const built = mkdtempSync(join(tmpdir(), "snark-built-title-"));
  try {
    cpSync(join(dir, "assets"), join(built, "assets"), { recursive: true });
    cpSync(join(dir, "index.html"), join(built, "index.html"));
    writeFileSync(join(built, "entry.js"), "");
    const s = startServer({ hostname: "127.0.0.1", port: 0, clientDir: built, publicUrl: "https://play.example.org" });
    try {
      const at = `http://127.0.0.1:${s.port}`;
      const proxy = { host: "play.example.org" };
      const page = await get(at + "/?screen=roster&survivor=June", { headers: proxy });
      expect(await page.text()).toContain("entry-root");
      expect(page.headers.get("link")).toBeNull();
      expect(await (await get(at + "/entry-worlds.json", { headers: proxy })).json()).toMatchObject([{ address: "/", password: false }]);
      expect(await (await get(at + "/entry-world.json")).json()).toMatchObject({ spawns: expect.any(Array) });
      const play = await get(at + "/play.html");
      expect(await play.text()).toContain("<title>the game</title>");
      expect(play.headers.get("link")).toContain("map/head.");
      const roster = (origin: string, extra = "") => get(at + "/survivors", { method: "POST",
        headers: { ...proxy, origin, "content-type": "application/json" },
        body: JSON.stringify({ action: "roster", key: "11".repeat(16), extra }) });
      expect((await roster("https://elsewhere.example")).status).toBe(403);
      expect((await roster("https://play.example.org", "x".repeat(4096))).status).toBe(400);
      for (let i = 0; i < 30; i++) expect(await (await roster("https://play.example.org")).json()).toEqual({ survivors: [] });
      expect((await roster("https://play.example.org")).status).toBe(429);
    } finally { s.stop(); }
  } finally { rmSync(built, { recursive: true, force: true }); }
});

test("the front sends each path to its world and the site to the lowest world, sockets and all, and the page's origin is still asked", async () => {
  const saves = mkdtempSync(join(dir, "cluster-"));
  const world = (name: string, adminPassword?: string): RunningServer => {
    const config = loadConfig({}, ["-clusterid=site", `-ClusterDirOverride=${saves}`, `?SessionName=${name}`]).rules;
    const s = startServer({ hostname: "127.0.0.1", port: 0, clientDir: dir, publicUrl: `/${name.toLowerCase()}`, dbPath: join(saves, `${name}.db`), noBackups: true, config, ...(adminPassword ? { adminPassword } : {}) });
    running.push(s);
    return s;
  };

  const [miami, tampa] = [world("Miami", "miami password"), world("Tampa", "the password")];
  const front = startFront(join(saves, "site"), 0, "127.0.0.1");
  running.push(front);
  const at = `http://127.0.0.1:${front.port}`;
  // The start screen, from whichever world answers the site, lists both.
  const start = await (await get(`${at}/`)).text();
  expect([start.indexOf('href="/miami/"') > 0, start.indexOf('href="/tampa/"') > start.indexOf('href="/miami/"')]).toEqual([true, true]);
  // And so does the list the wiki's maps are marked from, each world by its map's id.
  const listed = (await (await get(`${at}/worlds.json`)).json()) as { id: number; name: string; mapId: string; address: string }[];
  expect(listed.map((w) => [w.id, w.name, w.mapId, w.address])).toEqual([[miami.host.cluster!.world, "Miami", miami.host.world.mapId, "/miami/"], [tampa.host.cluster!.world, "Tampa", tampa.host.world.mapId, "/tampa/"]]);
  const admin = await get(`${at}/cluster/admin?world=tampa`);
  expect([admin.status, admin.headers.get("location")]).toEqual([308, "/admin/?world=tampa"]);
  expect(await (await get(`${at}/cluster/admin/cluster.js`)).text()).toBe("export {};");
  expect((await get(`${at}/cluster/admin/overview.json`)).status).toBe(404);
  expect(await (await get(`${at}/cluster/title-scene.json`)).json()).toMatchObject({set:"wynwood-shore"});
  expect((await get(`${at}/cluster/admin/scenes/`)).status).toBe(401);
  expect((await get(`${at}/cluster/admin/scenes/api`, { method:"POST" })).status).toBe(401);
  const loader = await (await get(at + "/cluster/loader-scene.json")).json() as { landscape: string; portrait: string };
  expect(loader.landscape).toBe("/cluster/loader-poster.webp");
  expect(loader.portrait).toBe("/cluster/loader-poster.webp?portrait");
  expect((await get(at + loader.landscape)).status).toBe(307);
  expect((await get(at + "/cluster/loader-scene.json", { method: "POST" })).status).toBe(405);
  const director = { authorization: `Basic ${btoa("operator:miami password")}` };
  expect((await get(`${at}/cluster/admin/scenes/api`, {headers:director})).status).toBe(200);
  expect((await get(`${at}/cluster/admin/scenes/api`, {method:"POST",headers:{...director,origin:"https://elsewhere.example"}})).status).toBe(403);

  const shot = await (await get(`${at}/cluster/title-scene.json`)).json() as { name: string };
  const picture = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  const published = await get(`${at}/admin/scenes/api`, { method: "POST", headers: { ...director, origin: at, "content-type": "application/json" },
    body: JSON.stringify({ revision: 0, shot: { ...shot, name: "Harbor light" }, publish: true, picture, portrait: picture }) });
  expect(published.status).toBe(200);
  expect(await (await get(`http://127.0.0.1:${tampa.port}/cluster/title-scene.json`)).json()).toMatchObject({ name: "Harbor light" });
  expect((await get(`${at}/cluster/title-poster.webp?portrait`)).headers.get("content-type")).toBe("image/webp");
  const good = { headers: { authorization: `Basic ${btoa("x:the password")}` } };
  const tampaAdmin = `/admin/worlds/${listed[1]!.id}/settings/`;
  expect((await get(at + tampaAdmin, { headers: director })).status).toBe(401);
  expect(await (await get(at + tampaAdmin, good)).text()).toBe("<title>admin settings</title>");
  const realm = async (path: string): Promise<string | null> => (await get(at + path)).headers.get("www-authenticate");
  const tampaRealm = `Basic realm="SNARK admin world ${listed[1]!.id}", charset="UTF-8"`;
  expect([await realm(tampaAdmin), await realm("/tampa/admin/settings.json"), await realm("/miami/admin/settings.json")]).toEqual([
    tampaRealm, tampaRealm, `Basic realm="SNARK admin world ${listed[0]!.id}", charset="UTF-8"`,
  ]);
  const oldSettings = await get(`${at}/tampa/admin/settings.html?panel=stats`, good);
  expect([oldSettings.status, oldSettings.headers.get("location")]).toEqual([308, `${tampaAdmin}?panel=stats`]);
  const direct = await get(`http://127.0.0.1:${miami.port}${tampaAdmin}`);
  expect([direct.status, direct.headers.get("location")]).toEqual([307, `http://127.0.0.1:${tampa.port}/tampa${tampaAdmin}`]);
  expect((await get(direct.headers.get("location")!, good)).status).toBe(200);
  const named = await get(`http://127.0.0.1:${miami.port}${tampaAdmin}`, { headers: { host: "play.example" } });
  expect([named.status, named.headers.get("location")]).toEqual([307, `/tampa${tampaAdmin}`]);
  expect((await get(`${at}/miami/admin/chat.json`, good)).status).toBe(401);
  expect((await get(`${at}/tampa/admin/chat.json`)).status).toBe(401);
  expect(await (await get(`${at}/tampa/admin/overview.json`, good)).json()).toMatchObject({ stats: { world: { name: "Tampa" } }, positions: [], chat: [] });
  // The drop book's page, through the front (server/admin/supply-routes.ts): it reads with GET and changes with POST.
  const drops = `${at}/tampa/admin/supply`;
  const post = (what: string, body: unknown, headers: Record<string, string> = { ...good.headers, origin: at, "content-type": "application/json" }): Promise<Response> => get(`${drops}/${what}`, { method: "POST", headers, body: JSON.stringify(body) });
  const read = await (await get(`${drops}/book.json`, good)).json() as { revision: number; starter: boolean; kept: boolean; book: SupplyBook };
  expect([read.revision, read.starter, read.kept, read.book.tiers.length, read.book.classes.length]).toEqual([0, true, true, 7, 7]);
  const items = (await (await get(`${drops}/catalog.json`, good)).json() as { items: { id: string }[] }).items;
  expect([items.some((i) => i.id === "core:spear"), items.some((i) => i.id === "core:pike")]).toEqual([true, true]);
  // Not signed in: 401, reading or changing. Signed in to another world: 401 too.
  expect([(await get(`${drops}/book.json`)).status, (await post("book", { revision: 0, book: read.book }, { origin: at, "content-type": "application/json" })).status, (await get(`${at}/miami/admin/supply/book.json`, good)).status]).toEqual([401, 401, 401]);
  // From another site's page: 403. Not JSON: 400. A read route asked to change, and a write route read: 405.
  expect((await post("book", { revision: 0, book: read.book }, { ...good.headers, origin: "https://elsewhere.example", "content-type": "application/json" })).status).toBe(403);
  expect((await post("book", { revision: 0, book: read.book }, { ...good.headers, origin: at, "content-type": "text/plain" })).status).toBe(400);
  expect([(await get(`${drops}/book.json`, { method: "POST", headers: { ...good.headers, origin: at } })).status, (await get(`${drops}/book`, good)).status]).toEqual([405, 405]);
  // A book with a fault: 422, the fault with its path, and nothing saved.
  const broken = structuredClone(read.book);
  broken.rules.flightSeconds = 300;
  const refusedBook = await post("book", { revision: 0, book: broken, note: "a flight longer than its notice" });
  expect([refusedBook.status, ((await refusedBook.json()) as { faults: { path: string }[] }).faults.map((f) => f.path), tampa.host.supplyBook.book.revision]).toEqual([422, ["rules.flightSeconds", "rules.noticeSeconds"], 0]);
  // A save: the book in force is the next revision, by the page, and the journal has it.
  const richer = structuredClone(read.book);
  richer.rules.ringedChance = 0.1;
  const saved = await post("book", { revision: 0, book: richer, note: "ringed twice as often" });
  expect([saved.status, await saved.json(), tampa.host.supplyBook.book.rules.ringedChance, tampa.host.supplyBook.starter]).toEqual([200, { revision: 1 }, 0.1, false]);
  // Saved again from the page that still holds revision 0: 409, with the revision it lost to, and nothing changed.
  const stale = await post("book", { revision: 0, book: read.book });
  expect([stale.status, ((await stale.json()) as { revision: number }).revision, tampa.host.supplyBook.book.revision]).toEqual([409, 1, 1]);
  expect((await (await get(`${drops}/revisions.json`, good)).json() as { revision: number; by: string; note: string }[]).map((r) => [r.revision, r.by, r.note])).toEqual([[1, "(admin page)", "ringed twice as often"]]);
  // The starter again is a revision too, and an old revision comes back as a new one.
  expect([(await post("reset", { revision: 0 })).status, await (await post("reset", { revision: 1 })).json()]).toEqual([409, { revision: 2 }]);
  expect([await (await post("restore", { revision: 2, to: 1 })).json(), tampa.host.supplyBook.book.rules.ringedChance, (await post("restore", { revision: 3, to: 77 })).status]).toEqual([{ revision: 3 }, 0.1, 404]);
  // A test drop is the console's own `supply call`: it is live at once, and an unknown tier is said, with 422.
  const [mid, called, unknown] = [tampa.host.world.hf.sizeX / 2, await post("call", { x: tampa.host.world.hf.sizeX / 2, z: tampa.host.world.hf.sizeZ / 2, tier: "blue", cls: "arms", ringed: true }), await post("call", { x: 10, z: 10, tier: "mauve", cls: "arms" })];
  const made = (await called.json()) as { id: number };
  expect([called.status, tampa.host.supply.get(made.id)?.tierKey, tampa.host.supply.get(made.id)?.ringed, tampa.host.supply.get(made.id)?.x === mid, unknown.status, ((await unknown.json()) as { error: string }).error]).toEqual([200, "blue", true, true, 422, 'the book has no tier "mauve"']);
  const live = (await (await get(`${drops}/live.json`, good)).json()) as { drops: { id: number; state: string; tier: string }[]; acts: { what: string }[] };
  expect([live.drops.map((d) => [d.id, d.tier, d.state]), live.acts.length >= 5, live.acts.at(-1)!.what.startsWith("supply call 10 10 mauve arms plain: the book has no tier")]).toEqual([[[made.id, "blue", "coming"]], true, true]);
  expect([(await (await post("cancel", { id: made.id })).json() as { said: string }).said, tampa.host.supply.live(), (await post("land", { id: "x" })).status]).toEqual([`cancelled ${made.id}`, 0, 400]);
  // The front passes these acts and nothing else under a world's admin pages.
  for (const path of ["/tampa/admin/stats.json", "/tampa/admin/supply/fake", "/tampa/admin/loadouts/fake", "/fake/tampa/admin/settings", `${tampaAdmin}`]) {
    expect((await get(at + path, { method: "POST", headers: good.headers })).status).toBe(405);
  }
  for (const path of ["settings", "stop", "loadouts/apply", "loadouts/reset", "loadouts/book"]) {
    expect((await get(`${at}/tampa/admin/${path}`, { method: "POST" })).status).toBe(401);
    expect((await get(`${at}/tampa/admin/${path}`, { method: "POST", headers: { ...good.headers, origin: "https://elsewhere.example" } })).status).toBe(403);
  }
  const terrain = await get(`${at}/tampa/admin/terrain.rgba`, { headers: { ...good.headers, "accept-encoding": "identity" } });
  const rgba = new Uint8Array(await terrain.arrayBuffer());
  expect([terrain.status, terrain.headers.get("cache-control"), rgba.length]).toEqual([200, "no-store", ADMIN_TERRAIN_SIDE ** 2 * 4]);
  // The simulation deliberately discards terrain tints, but the admin map needs the colours from the file.
  expect(rgba.some((c, i) => i % 4 !== 3 && c > 0)).toBe(true);
  // Each path goes to its own world: their maps are their own, and each sends its path on with its slash.
  const [m, t] = [await (await get(`${at}/miami/map.json`)).json(), await (await get(`${at}/tampa/map.json`)).json()];
  expect([miami.host.world.mapHash, tampa.host.world.mapHash]).toEqual([(m as { hash: number }).hash, (t as { hash: number }).hash]);
  expect((await get(`${at}/tampa`)).headers.get("location")).toBe("/tampa/");
  const roster = await get(at + "/tampa/survivors", { method: "POST", headers: { origin: at, "content-type": "application/json" },
    body: JSON.stringify({ action: "roster", key: "22".repeat(16) }) });
  expect(await roster.json()).toEqual({ survivors: [] });
  // A range goes and comes back as the world answered it.
  const part = await get(`${at}/tampa/assets/manifest.json`, { headers: { range: "bytes=0-9" } });
  expect([part.status, (await part.arrayBuffer()).byteLength]).toEqual([206, 10]);
  // A socket goes through to its world, for a program and for a page of the front's own site, and a page of another site is
  // still turned away by the world itself.
  expect([await opens(`ws://127.0.0.1:${front.port}/tampa/ws`, null), await opens(`ws://127.0.0.1:${front.port}/tampa/ws`, at), await opens(`ws://127.0.0.1:${front.port}/tampa/ws`, "https://elsewhere.example")]).toEqual([true, true, false]);
  // Wrong passwords are counted by who sent them, as the tunnel in front names them, and not against everyone on this machine.
  const wrong = { authorization: `Basic ${btoa("x:wrong")}`, "x-forwarded-for": "203.0.113.7" };
  for (let i = 0; i < 3; i++) await get(`${at}/tampa/sounds.html`, { headers: wrong });
  expect([(await get(`${at}/tampa/sounds.html`, { headers: wrong })).status, (await get(`${at}/tampa/sounds.html`)).status]).toEqual([429, 401]);
  expect((await get(`${at}/tampa/__bench`, { method: "POST", body: "{}" })).status).toBe(405);
});

test("the front knows only worlds running and listening, routes a path to its world and the rest to the lowest reached at a path, and closes a socket as it may", () => {
  const a = { world: 2, saveId: "", save: "", name: "", map: "", mapId: "", port: 8799, url: "/tampa", players: 0, max: 70, content: 0, survivors: true, items: true, at: 100_000 };
  const seen = frontWorlds([a, { ...a, world: 1, url: "/miami", port: 8798 }, { ...a, world: 3, url: "/old", at: 1 }, { ...a, world: 4, url: "/wiki" }, { ...a, world: 5, url: "/x", port: 0 }], 100_500);
  expect(seen).toEqual([{ world: 1, path: "/miami", port: 8798 }, { world: 2, path: "/tampa", port: 8799 }]);
  expect([frontRoute(seen, "/tampa/ws")?.port, frontRoute(seen, "/tampa")?.port, frontRoute(seen, "/tampaz")?.port, frontRoute(seen, "/wiki/")?.port, frontRoute([], "/")]).toEqual([8799, 8799, 8798, 8798, null]);
  // A path under another world's goes to the world with the longest path it falls under.
  const nested = [{ world: 1, path: "/eu", port: 8798 }, { world: 2, path: "/eu/tampa", port: 8799 }];
  expect([frontRoute(nested, "/eu/tampa/ws")?.port, frontRoute(nested, "/eu/ws")?.port]).toEqual([8799, 8798]);
  // A world believes who a request is from what a proxy on its own machine says, and nothing else does.
  expect([clientAddress("127.0.0.1", "198.51.100.1, 203.0.113.7, 127.0.0.1"), clientAddress("::ffff:127.0.0.1", "2001:db8::7"), clientAddress("203.0.113.9", "198.51.100.1"), clientAddress("127.0.0.1", "<script>, 127.0.0.1"), clientAddress("::1", null)]).toEqual(["203.0.113.7", "2001:db8::7", "203.0.113.9", "127.0.0.1", "::1"]);
  expect([closeCode(1000), closeCode(1008), closeCode(1005), closeCode(1006), closeCode(4001), closeCode(0)]).toEqual([1000, 1008, 1000, 1000, 4001, 1000]);
});

test("the front answers a world's built files and map parts from disk itself, where the world says they are, ranges and Brotli as the world does, and passes on what it does not hold", async () => {
  const saves = mkdtempSync(join(dir, "front-files-"));
  const client = join(saves, "client"), parts = join(saves, "miami.parts");
  mkdirSync(join(client, "assets"), { recursive: true });
  mkdirSync(parts);
  writeFileSync(join(client, "assets", "core.tex.0123456789abcdef.bin"), new Uint8Array(4096).map((_, i) => i & 255));
  // A map's parts folder holds only the copies: the raw bytes are the map file's, which only the world reads.
  writeFileSync(join(parts, "ground.1-1.0123456789abcdef.part.br"), new Uint8Array(7));
  // The world's port answers nothing: whatever the front passes on comes back as a world not answering.
  const gone = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = gone.port;
  gone.stop(true);
  const a = { world: 1, saveId: "", save: "", name: "", map: "", mapId: "", port, url: "/miami", players: 0, max: 70, content: 0, survivors: true, items: true, at: Date.now(), files: { client, parts } };
  new ClusterFolder(saves).announce(a);
  const front = startFront(saves, 0, "127.0.0.1");
  running.push(front);
  const at = `http://127.0.0.1:${front.port}/miami`;
  const range = await get(`${at}/assets/core.tex.0123456789abcdef.bin`, { headers: { range: "bytes=10-19" } });
  expect([range.status, [...new Uint8Array(await range.arrayBuffer())]]).toEqual([206, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]]);
  const part = await get(`${at}/map/ground.1-1.0123456789abcdef.part`, { headers: { "accept-encoding": "br" }, decompress: false } as RequestInit);
  expect([part.status, part.headers.get("content-encoding"), (await part.arrayBuffer()).byteLength]).toEqual([200, "br", 7]);
  const raw = await get(`${at}/map/ground.1-1.0123456789abcdef.part`, { headers: { "accept-encoding": "identity" } });
  expect(raw.status).toBe(502);
  expect([(await get(`${at}/map.json`)).status, (await get(`${at}/assets/missing.bin`)).status, (await get(`http://127.0.0.1:${front.port}/assets/core.tex.0123456789abcdef.bin`)).status]).toEqual([502, 502, 502]);
});

test("the front keeps a world's backlog rule on a page's socket, which the world cannot see past it", () => {
  // What becomes of an unreliable message and then a reliable one, to a page with `buffered` bytes waiting.
  const page = (voice: boolean, buffered: number): string => {
    const did: string[] = [];
    const ws = { data: { voice } as Pipe, getBufferedAmount: () => buffered, send: () => (did.push("sent"), 0), close: (code?: number) => void did.push(`closed ${code}`) };
    for (const channel of [CH_UNRELIABLE, CH_RELIABLE]) {
      did.push(`${channel}:`);
      sendDown(ws, Uint8Array.of(channel));
    }
    return did.join(" ");
  };
  expect([page(false, 0), page(false, 8000), page(false, 5 << 20), page(true, 8000), page(true, 20000)]).toEqual(["0: sent 1: sent", "0: 1: sent", "0: 1: closed 1008", "0: sent 1: sent", "0: 1:"]);
});
