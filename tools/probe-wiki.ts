// `bun run probe -- --wiki`: the wiki in headless Chrome, served from client/dist by the server's own file
// serving, after `bun run build` and `bun run wiki`. Each page below is opened at a desktop's width and a phone's: it must
// raise no error, fit the width and decode every picture it shows. A creature's sound must decode from the game's file
// as the page plays it, show it is sounding and stop at a second press, a take must be a thumb's size on a phone, the
// search must find a raptor, a map's layer must load when its box is ticked, a page opened
// for a world on config/boosted-50x must show that world's figures, and with a cluster of two worlds behind the pages, the
// front page, the maps page and a map's own page must show the worlds on their maps first and every other map as not
// running. It prints what each page fetched. With `--shots <folder>` it keeps a picture of each page there.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveFile } from "../server/files.ts";
import { loadConfigFolder } from "../server/settings/config.ts";
import { publicValues } from "../server/settings/rules.ts";

const DIST = resolve(import.meta.dir, "../client/dist");
const PAGES = [
  "/wiki/",
  "/wiki/creatures/raptor/",
  "/wiki/items/piece_foundation_wood/",
  "/wiki/items/pistol/",
  "/wiki/vehicles/compact/",
  "/wiki/maps/miami/",
  "/wiki/maps/",
  "/wiki/items/",
  "/wiki/search/?q=raptor",
  "/wiki/commands/",
  "/wiki/landmarks/koru/",
  "/wiki/resources/banyan/",
  "/wiki/statuses/entangled/",
  "/wiki/controls/",
  "/wiki/sounds/raptor/",
  "/wiki/music/",
  // Last, as it is remembered for the visit: the figures of a world on config/boosted-50x.
  "/wiki/creatures/pteranodon/?world=/fifty",
];
const WIDTHS = [1280, 390];

export async function wikiProbe(chrome: string): Promise<boolean> {
  if (!existsSync(join(DIST, "wiki/index.html"))) throw new Error("client/dist/wiki is missing: run bun run build, then bun run wiki");
  const at = process.argv.indexOf("--shots");
  const shots = at > 0 ? resolve(process.argv[at + 1]!) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  // A world at the root on its defaults, and one at /fifty as config/boosted-50x sets it, as each answers its settings.json.
  const fifty = { name: "A 50x server", map: "core:miami", settings: publicValues(loadConfigFolder(resolve(import.meta.dir, "../config/boosted-50x")).rules) };
  // The cluster's worlds as they answer worlds.json: one on Miami, and one on a map this build has no page for.
  const cluster = [
    { name: "Miami", map: "Miami", mapId: "core:miami", address: "/miami/", players: 3, max: 70 },
    { name: "Atlantis", map: "Atlantis", mapId: "core:atlantis", address: "/atlantis/", players: 70, max: 70 },
  ];
  const marked = [["core:miami", "Running: Miami, 3 of 70 online", "/miami/", ""], ["core:atlantis", "Running: Atlantis, full, 70 of 70", "/atlantis/", "Its page is not built here"]];
  const built = readdirSync(join(DIST, "wiki/maps"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  const worlds: Record<string, object> = { "/settings.json": { name: "Miami", map: "core:miami", settings: {} }, "/fifty/settings.json": fifty, "/worlds.json": cluster };
  const server = Bun.serve({ port: 0, fetch: (req) => worlds[new URL(req.url).pathname] ? Response.json(worlds[new URL(req.url).pathname]) : serveFile(DIST, req) });
  const profile = mkdtempSync(join(tmpdir(), "snark-pages-"));
  const flags = ["--headless=new", "--mute-audio", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", "--autoplay-policy=no-user-gesture-required"];
  const browser = Bun.spawn([chrome, ...flags, `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const faults: string[] = [];
  try {
    let port = 0;
    const active = join(profile, "DevToolsActivePort");
    for (let k = 0; k < 100 && !port; k++, await Bun.sleep(100)) if (existsSync(active)) port = Number(readFileSync(active, "utf8").split("\n")[0]);
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const waiting = new Map<number, (r: { result?: any; error?: unknown }) => void>();
    const errors: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ""}`.trim());
      waiting.get(m.id)?.(m);
    };
    let id = 0;
    const send = (method: string, params: object = {}): Promise<any> =>
      new Promise((ok, fail) => {
        const n = ++id;
        const timer = setTimeout(() => fail(new Error(`${method} took too long`)), 30000);
        waiting.set(n, (m) => (clearTimeout(timer), m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const run = async (expression: string): Promise<any> => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result.value;
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map((m) => send(m)));
    const settled = "new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r())))";
    for (const width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: width > 500 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 500 });
      for (const path of PAGES) {
        errors.length = 0;
        await send("Page.navigate", { url: `http://localhost:${server.port}${path}` });
        await Bun.sleep(300);
        await run(`${settled}.then(() => document.fonts.ready).then(() => Promise.all([...document.images].filter((i) => i.loading !== 'lazy').map((i) => i.decode().catch(() => i.src))))`);
        const page = await run(`({
          wide: document.documentElement.scrollWidth > innerWidth,
          broken: [...document.images].filter((i) => i.getAttribute('src') && i.complete && i.loading !== 'lazy' && !i.naturalWidth).map((i) => i.src),
          bytes: [...performance.getEntriesByType('resource'), ...performance.getEntriesByType('navigation')].reduce((n, r) => n + r.transferSize, 0),
        })`);
        if (page.wide) faults.push(`${path} at ${width}: wider than the screen`);
        if (page.broken.length) faults.push(`${path} at ${width}: pictures that do not decode: ${page.broken.join(", ")}`);
        // A take shows it is sounding from its press, filling as it goes, and a press while it sounds stops it.
        if (width > 500 && /creatures\/raptor|sounds\//.test(path)) {
          const pressed = "(b) => new Promise((r) => { const o = new MutationObserver(() => (o.disconnect(), r(b.getAttribute('aria-pressed')))); o.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); b.click(); setTimeout(() => r(b.classList.contains('failed') ? 'failed' : 'unchanged'), 3000); })";
          const longest = "[...document.querySelectorAll('[data-k]')].sort((a, b) => parseFloat(b.style.getPropertyValue('--d')) - parseFloat(a.style.getPropertyValue('--d')))[0]";
          const filled = "new Promise((r) => setTimeout(() => r(parseFloat(getComputedStyle(b).backgroundSize) > 0 ? 'filling' : 'not filling'), 250))";
          const states = await run(`(async () => { const b = ${longest}; const p = ${pressed}; return [await p(b), await ${filled}, await p(b)]; })().catch((e) => [String(e)])`);
          if (states.join() !== "true,filling,false") faults.push(`${path}: its longest take, pressed twice, went ${states.join(" then ")}, not sounding, filling, then stopped`);
        }
        if (width < 500 && path.includes("sounds/")) {
          const small = await run("[...document.querySelectorAll('.take')].filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).length");
          if (small > 0) faults.push(`${path} at ${width}: ${small} takes are smaller than a thumb's 44 px`);
        }
        if (width > 500 && path.includes("search")) {
          await Bun.sleep(500);
          if (!(await run("[...document.querySelectorAll('.results a')].some((a) => a.textContent === 'Raptor')"))) faults.push(`${path}: no raptor found`);
        }
        if (width > 500 && /\/maps\/\w/.test(path)) {
          await run("(() => { const box = document.querySelector('[data-show=\"palm\"]'); box.click(); return document.querySelector('img[data-layer=\"palm\"]').decode(); })()");
          if (!(await run("document.querySelector('img[data-layer=\"palm\"]').naturalWidth > 0"))) faults.push(`${path}: the palm layer does not load`);
          // Each landmark the map places is a dot that leads to its page and a card under the map.
          const led = await run("[...document.querySelectorAll('[data-layer=\"landmarks\"] g.landmark')].map((g) => [g.closest('a')?.getAttribute('href') ?? '', !!document.querySelector(`main section .card[href=\"${g.closest('a')?.getAttribute('href')}\"]`)])");
          if (led.length === 0 || led.some(([href, card]: [string, boolean]) => !href.startsWith("/wiki/landmarks/") || !card)) faults.push(`${path}: a landmark's dot and card do not lead to its page (${JSON.stringify(led)})`);
        }
        // Each map says which world of the cluster runs it, a link into it and who is on it, those first; the rest are not running.
        if (path.startsWith("/wiki/maps/") || path === "/wiki/") {
          await run("new Promise((r) => { const t = Date.now(); const k = () => (document.querySelector('.live') || Date.now() - t > 3000 ? r() : setTimeout(k, 50)); k(); })");
          const maps = await run("[...document.querySelectorAll('[data-maps] > [data-map]')].map((c) => [c.dataset.map, [...c.querySelectorAll('.live')].map((l) => l.textContent).join(' / '), c.querySelector('.live a')?.getAttribute('href') ?? '', c.querySelector(':scope > small')?.textContent ?? ''])");
          const want = path === "/wiki/maps/miami/" ? [marked[0]] : [...marked, ...Array.from({ length: built - 1 }, () => ["Not running here", "", ""])];
          if (JSON.stringify(maps.map((m: string[]) => (m[1] === "Not running here" ? m.slice(1) : m))) !== JSON.stringify(want)) faults.push(`${path} at ${width}: the cluster's maps are not shown as it runs them (${JSON.stringify(maps)})`);
        }
        if (path.includes("?world=")) {
          await Bun.sleep(500);
          const shown = await run("({ note: document.querySelector('main .note')?.textContent ?? '', top: document.querySelector('[data-taming] tbody tr:last-child td:nth-child(4)')?.textContent ?? '' })");
          if (!shown.note.startsWith("Figures here are for A 50x server") || shown.top !== "1 in 2 min 30 s") faults.push(`${path} at ${width}: the world's figures are not shown (${JSON.stringify(shown)})`);
          await run("sessionStorage.clear()");
        }
        faults.push(...errors.map((e) => `${path} at ${width}: ${e}`));
        console.log(`  ${path.padEnd(40)} ${String(width).padStart(4)} px  ${(page.bytes / 1024).toFixed(0).padStart(5)} KB fetched${errors.length ? `, ${errors.length} errors` : ""}`);
        if (shots) {
          const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          writeFileSync(join(shots, `${path.replace(/[/?=]+/g, "-").replace(/^-|-$/g, "") || "front"}-${width}.png`), Buffer.from(shot.data, "base64"));
        }
        // A fresh page each time: what it fetches is counted as a first visit's.
        await send("Network.clearBrowserCache");
      }
    }
    ws.close();
  } catch (e) {
    faults.push(String(e));
  } finally {
    browser.kill();
    await browser.exited;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
  for (const f of faults) console.log(`  FAULT ${f}`);
  return faults.length === 0;
}
