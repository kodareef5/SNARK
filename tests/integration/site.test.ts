// Worlds reached at paths of one host (--public-url /miami), the site around them, and the front that sends each path to its
// world (server/site.ts, server/front.ts).

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  for (const bad of ["/mi ami", "/miami?x", "//miami", "/..", "/wiki", "https://play.example/assets", "/source/x", "javascript:alert(1)", "ftp://play.example/miami"]) expect(() => pathOf(bad)).toThrow("--public-url");
  expect([placeOf("", "/ws"), placeOf("/miami", "/miami"), placeOf("/miami", "/miami/ws"), placeOf("/miami", "/"), placeOf("/miami", "/miamiz/ws")]).toEqual([
    { at: "world", path: "/ws" },
    { at: "slash", path: "/miami" },
    { at: "world", path: "/ws" },
    { at: "site", path: "/" },
    { at: "site", path: "/miamiz/ws" },
  ]);
});

test("the start screen lists each world with its count and goes to its path, and a link is only ever an address or a path of the site", () => {
  expect([worldAddress({ url: "/miami", port: 8798 }, "abc.trycloudflare.com", false), worldAddress({ url: "https://tampa.example/", port: 8799 }, "x", false), worldAddress({ url: "", port: 8799 }, "192.168.1.20:8798", true)]).toEqual(["/miami/", "https://tampa.example/", "//192.168.1.20:8799/"]);
  // A page that came straight to a world's port goes to the other's port, under its path.
  expect(worldAddress({ url: "/tampa", port: 8799 }, "localhost:8798", true)).toBe("//localhost:8799/tampa/");
  expect([linkOf(" /wiki/ "), linkOf("https://git.example.com/snark"), linkOf("javascript:alert(1)"), linkOf("wiki"), linkOf(""), linkOf("//elsewhere.example/"), linkOf("/\\elsewhere.example/")]).toEqual(["/wiki/", "https://git.example.com/snark", "", "", "", "", ""]);
  const page = startPage(
    [
      { name: "Miami", map: "Miami", address: "/miami/", players: 3, max: 70 },
      { name: "<Tampa>", map: "Tampa", address: "/tampa/", players: 70, max: 70 },
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
  const s = startServer({ port: 0, clientDir: dir, probeScene: true, publicUrl: "/miami", config });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  const slash = await get(`${at}/miami?name=Ada`);
  expect([slash.status, slash.headers.get("location")]).toEqual([308, "/miami/?name=Ada"]);
  // The world's page, and the map it is told to ask for at once, named beside it.
  const page = await get(`${at}/miami/`);
  expect([page.status, await page.text(), /^<map\.[0-9a-f]{16}\.snmap>; rel=preload/.test(page.headers.get("link") ?? "")]).toEqual([200, "<!doctype html><title>the game</title>", true]);
  expect([(await get(`${at}/miami/map.json`)).status, (await get(`${at}/miami/assets/manifest.json`)).status]).toEqual([200, 200]);
  expect(await (await get(`${at}/miami/links.json`)).json()).toEqual({ wiki: "https://wiki.example/snark", repository: "" });
  // Its sockets are under its path, and not at the root, which is the site's.
  expect([await opens(`ws://127.0.0.1:${s.port}/miami/ws`, null), await opens(`ws://127.0.0.1:${s.port}/ws`, null)]).toEqual([true, false]);
  // The site: the start screen with this world alone, at its port since the page came straight to it, the wiki at /wiki/, and
  // the page the source link goes to by default.
  const start = await (await get(`${at}/`)).text();
  expect([start.includes(`href="//127.0.0.1:${s.port}/miami/"`), start.includes("0 of 70 online"), start.includes('href="https://wiki.example/snark"'), start.includes("Source code")]).toEqual([true, true, true, false]);
  const wiki = await get(`${at}/wiki?x=1`);
  expect([wiki.status, wiki.headers.get("location"), await (await get(`${at}/wiki/`)).text()]).toEqual([308, "wiki/?x=1", "<!doctype html><title>the wiki</title>"]);
  expect([(await get(`${at}/source/`)).status, (await (await get(`${at}/source/`)).text()).includes("Coming soon")]).toEqual([200, true]);
  // The sound board is the world's, behind its password, and the site does not hand its page out.
  writeFileSync(join(dir, "sounds.html"), "the board");
  expect([await (await get(`${at}/sounds.html`)).text(), (await get(`${at}/admin/sounds.json`)).status]).toEqual(["not found", 404]);
  // The world's own is behind its gate, which this server, with no admin password, keeps shut.
  expect(await (await get(`${at}/miami/sounds.html`)).text()).toStartWith("the sound board opens on a development server");
});

test("a server at the root of its host is all world as before, and has the page the source link goes to and its links", async () => {
  const s = startServer({ port: 0, clientDir: dir, probeScene: true });
  running.push(s);
  const at = `http://127.0.0.1:${s.port}`;
  expect([await (await get(`${at}/`)).text(), (await get(`${at}/source/`)).status]).toEqual(["<!doctype html><title>the game</title>", 200]);
  expect(await (await get(`${at}/links.json`)).json()).toEqual({ wiki: "/wiki/", repository: "/source/" });
});

test("the front sends each path to its world and the site to the lowest world, sockets and all, and the page's origin is still asked", async () => {
  const saves = mkdtempSync(join(dir, "cluster-"));
  const world = (name: string, adminPassword?: string): RunningServer => {
    const config = loadConfig({}, ["-clusterid=site", `-ClusterDirOverride=${saves}`, `?SessionName=${name}`]).rules;
    const s = startServer({ port: 0, clientDir: dir, publicUrl: `/${name.toLowerCase()}`, dbPath: join(saves, `${name}.db`), noBackups: true, config, ...(adminPassword ? { adminPassword } : {}) });
    running.push(s);
    return s;
  };
  const [miami, tampa] = [world("Miami"), world("Tampa", "the password")];
  const front = startFront(join(saves, "site"), 0, "127.0.0.1");
  running.push(front);
  const at = `http://127.0.0.1:${front.port}`;
  // The start screen, from whichever world answers the site, lists both.
  const start = await (await get(`${at}/`)).text();
  expect([start.indexOf('href="/miami/"') > 0, start.indexOf('href="/tampa/"') > start.indexOf('href="/miami/"')]).toEqual([true, true]);
  // Each path goes to its own world: their maps are their own, and each sends its path on with its slash.
  const [m, t] = [await (await get(`${at}/miami/map.json`)).json(), await (await get(`${at}/tampa/map.json`)).json()];
  expect([miami.host.world.mapHash, tampa.host.world.mapHash]).toEqual([(m as { hash: number }).hash, (t as { hash: number }).hash]);
  expect((await get(`${at}/tampa`)).headers.get("location")).toBe("/tampa/");
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
  const a = { world: 2, saveId: "", save: "", name: "", map: "", port: 8799, url: "/tampa", players: 0, max: 70, content: 0, survivors: true, items: true, at: 100_000 };
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
