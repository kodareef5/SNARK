// Check the generated wiki at desktop and phone widths with the game's static file server.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveFile } from "../server/files.ts";
import { loadConfigFolder } from "../server/settings/config.ts";
import { publicValues } from "../server/settings/rules.ts";
import { CHROME_FLAGS } from "./chrome.ts";

const DIST = resolve(import.meta.dir, "../client/dist");
const PAGES = [
  "/wiki/",
  "/wiki/creatures/raptor/",
  "/wiki/creatures/",
  "/wiki/guides/getting-started/",
  "/wiki/items/piece_foundation_wood/",
  "/wiki/items/pistol/",
  "/wiki/vehicles/compact/",
  "/wiki/vehicles/needle/",
  "/wiki/vehicles/",
  "/wiki/maps/miami/?show=raptor",
  "/wiki/maps/",
  "/wiki/items/",
  "/wiki/items/group/building/",
  "/wiki/search/?q=no-such-thing",
  "/wiki/search/?q=raptor",
  "/wiki/commands/",
  "/wiki/landmarks/koru/",
  "/wiki/resources/banyan/",
  "/wiki/statuses/entangled/",
  "/wiki/controls/",
  "/wiki/sounds/",
  "/wiki/sounds/raptor/",
  "/wiki/music/",
  // Last, as it is remembered for the visit: the figures of a world on config/boosted-50x.
  "/wiki/creatures/pteranodon/?world=/fifty",
];
const WIDTHS = [1280, 390];
// Expected mesh ids are independent of the viewer descriptor.
const STUDIO: readonly [path: string, id: string, mesh: RegExp, move?: string][] = [
  ["/wiki/creatures/raptor/", "core:raptor", /^core:raptor$/, "walk"],
  ["/wiki/characters/survivor/", "core:survivor", /^core:(?:human_|survivor|mannequin)/, "emote:wave"],
  ["/wiki/vehicles/compact/", "core:compact", /^core:compact$/],
  ["/wiki/items/piece_foundation_wood/", "core:piece_foundation_wood", /foundation_wood/],
  ["/wiki/items/club/", "core:club", /^core:club$/],
  ["/wiki/items/boat_assembly/", "core:boat_assembly", /^core:boat$/],
  ["/wiki/resources/banyan/", "core:banyan", /^core:banyan_1$/],
  ["/wiki/landmarks/koru/", "koru", /^koru:/],
  ["/wiki/landmarks/cruise/", "cruise", /^cruise:/],
];

export async function wikiProbe(chrome: string, dist = DIST): Promise<boolean> {
  if (!existsSync(join(dist, "wiki/index.html"))) throw new Error("client/dist/wiki is missing: run bun run build, then bun run wiki");
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
  const built = readdirSync(join(dist, "wiki/maps"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  const worlds: Record<string, object> = { "/settings.json": { name: "Miami", map: "core:miami", settings: {} }, "/fifty/settings.json": fifty, "/worlds.json": cluster };
  const server = Bun.serve({ port: 0, fetch: (req) => worlds[new URL(req.url).pathname] ? Response.json(worlds[new URL(req.url).pathname]) : serveFile(dist, req) });
  const profile = mkdtempSync(join(tmpdir(), "snark-pages-"));
  // WebGL 2 from the CPU, for the studio, where the machine has no GPU Chrome will use headless.
  const flags = ["--headless=new", "--mute-audio", ...CHROME_FLAGS, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0"];
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
        const timer = setTimeout(() => fail(new Error(`${method} took too long`)), 60000);
        waiting.set(n, (m) => (clearTimeout(timer), m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const run = async (expression: string): Promise<any> => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result.value;
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map((m) => send(m)));
    const waitFor = "(predicate, ms = 3000) => new Promise((resolve) => { const end = performance.now() + ms; const check = () => predicate() ? resolve(true) : performance.now() > end ? resolve(false) : setTimeout(check, 25); check(); })";
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
        const chrome = await run(`(() => {
          const nav = document.querySelector('[data-sidebar]');
          const main = document.querySelector('main').getBoundingClientRect();
          const footer = document.querySelector('footer').getBoundingClientRect();
          const desktop = innerWidth > 832;
          const left = nav.closest('.sidebar').getBoundingClientRect();
          const placed = desktop ? nav.open && left.right <= main.left : !nav.open;
          if (!desktop) {
            nav.querySelector('summary').click();
            if (!nav.open) return false;
            nav.querySelector('summary').click();
          }
          return placed && footer.bottom >= innerHeight - 1 && !!document.querySelector('footer .footer-art');
        })()`);
        if (!chrome) faults.push(`${path} at ${width}: sidebar or footer layout failed`);
        if (path === "/wiki/") {
          const images = await run("['.front-intro img','.front-lead .hero-art'].every((s) => document.querySelector(s)?.naturalWidth > 0)");
          if (!images) faults.push(`${path}: homepage logo or scene failed to load`);
          const framed = await run(`(() => {
            const image = document.querySelector(".hero-art");
            const portrait = image.closest("picture").querySelector("source");
            const expected = innerWidth <= 560 && portrait ? portrait.srcset : image.src;
            return new URL(expected, location.href).href === image.currentSrc && !document.querySelector("audio[autoplay], video[autoplay]");
          })()`);
          if (!framed) faults.push(`${path}: the cover did not use its intended frame`);
        }
        if (/guides\/getting-started|^\/wiki\/sounds\/$|^\/wiki\/creatures\/$/.test(path)) {
          if (!(await run("!!document.querySelector('.section-banner img')"))) faults.push(`${path}: missing a section scene`);
        }
        if (path === "/wiki/items/piece_foundation_wood/") {
          if (!(await run("!!document.querySelector('.item-views .item-angles img')"))) faults.push(`${path}: missing the alternate item view`);
        }
        if (path === "/wiki/items/group/building/") {
          if (!(await run("!!document.querySelector('.group-plate img') && !!document.querySelector('a.card img')"))) faults.push(`${path}: missing the group shot or item photos`);
        }
        if (path.startsWith("/wiki/maps/miami/")) {
          const photos = await run("['#city-photos', '#obelisk-photos'].every((id) => document.querySelector(id)?.querySelectorAll('img').length >= 2)");
          if (!photos) faults.push(`${path}: city or obelisk gallery is incomplete`);
          if (width < 500) {
            const sharp = await run(`(async () => {
              const ground = document.querySelector('.ground');
              ground.scrollIntoView();
              document.querySelector('[data-zoom="1"]').click();
              return (${waitFor})(() => ground.complete && ground.currentSrc === ground.src);
            })()`);
            if (!sharp) faults.push(`${path}: zoom did not request the detailed map`);
          }
        }
        if (page.wide) faults.push(`${path} at ${width}: wider than the screen`);
        if (page.broken.length) faults.push(`${path} at ${width}: pictures that do not decode: ${page.broken.join(", ")}`);
        if (width > 500 && /creatures\/raptor|sounds\/raptor/.test(path)) {
          const played = await run(`(async () => {
            const wait = ${waitFor};
            const button = [...document.querySelectorAll('[data-k]')].sort((a, b) => parseFloat(b.style.getPropertyValue('--d')) - parseFloat(a.style.getPropertyValue('--d')))[0];
            if (!button) return 'no sound button';
            const row = button.closest('[data-takes]').dataset;
            const lengths = row.takes.split(' ').map((take) => Number(take.split(':')[1]));
            const index = Number(button.dataset.k);
            const start = Number(row.at) + lengths.slice(0, index).reduce((a, b) => a + b, 0);
            const range = 'bytes=' + start + '-' + (start + lengths[index] - 1);
            const ranges = [];
            const original = window.fetch;
            window.fetch = async (url, init) => {
              if (url !== row.file) return original(url, init);
              ranges.push(init.headers.range);
              return ranges.length === 1 ? new Response(null, { status: 416 }) : original(url, init);
            };
            button.click();
            if (!await wait(() => button.dataset.state === 'failed')) return 'missing retry state';
            button.click();
            button.click();
            button.click();
            if (!await wait(() => button.getAttribute('aria-pressed') === 'true')) return 'did not play after retry';
            if (!await wait(() => parseFloat(getComputedStyle(button).backgroundSize) > 0)) return 'no progress';
            button.click();
            window.fetch = original;
            return button.getAttribute('aria-pressed') === 'false' && ranges.join() === [range, range].join() ? 'ok' : ranges.join();
          })()`);
          if (played !== "ok") faults.push(`${path}: audio retry and selected range failed (${played})`);
        }
        if (width > 500 && path === "/wiki/music/") {
          const played = await run(`(async () => {
            const [first, second] = document.querySelectorAll('audio');
            if (!first || !second) return false;
            await first.play();
            await second.play();
            return first.paused && !second.paused && second.readyState >= 2;
          })().catch(() => false)`);
          if (!played) faults.push(`${path}: music did not decode or switch layers`);
        }
        if (width < 500 && path.includes("sounds/")) {
          const small = await run("[...document.querySelectorAll('.take')].filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).length");
          if (small > 0) faults.push(`${path} at ${width}: ${small} takes are smaller than a thumb's 44 px`);
        }
        if (path === "/wiki/creatures/") {
          const filtered = await run(`(() => {
            const select = document.querySelector('[data-filter="temper"]');
            select.value = 'Aggressive';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            const names = [...document.querySelectorAll('[data-directory-row]:not([hidden]) a.directory-name')].map((link) => link.textContent);
            return names.includes('Raptor') && !names.includes('Dodo');
          })()`);
          if (!filtered) faults.push(`${path}: temperament filter did not update the directory`);
        }
        if (width > 500 && path.includes("q=raptor")) {
          await Bun.sleep(500);
          if (!(await run("[...document.querySelectorAll('.results a')].some((a) => a.textContent === 'Raptor')"))) faults.push(`${path}: no raptor found`);
        }
        if (width > 500 && path.startsWith("/wiki/maps/miami/")) {
          const layers = await run(`(async () => {
            const checked = document.querySelector('[data-show="raptor"]');
            const group = checked.closest('details');
            if (!checked.checked || !group.open || document.querySelector('[data-layer="raptor"]').hasAttribute('hidden')) return false;
            const filter = document.querySelector('[data-layer-filter]');
            filter.value = 'palm';
            filter.dispatchEvent(new Event('input'));
            const box = document.querySelector('[data-show="palm"]');
            if (!box.closest('details').open) return false;
            box.click();
            const layer = document.querySelector('img[data-layer="palm"]');
            await layer.decode();
            document.querySelector('[data-layer-reset]').click();
            return layer.naturalWidth > 0 && layer.hidden && !checked.checked;
          })().catch(() => false)`);
          if (!layers) faults.push(`${path}: map deep link, filtering, or reset did not work`);
          // Each landmark the map places is a dot that leads to its page and a card under the map.
          const led = await run("[...document.querySelectorAll('[data-layer=\"landmarks\"] g.landmark')].map((g) => [g.closest('a')?.getAttribute('href') ?? '', !!document.querySelector(`main section .card[href=\"${g.closest('a')?.getAttribute('href')}\"]`)])");
          if (led.length === 0 || led.some(([href, card]: [string, boolean]) => !href.startsWith("/wiki/landmarks/") || !card)) faults.push(`${path}: a landmark's dot and card do not lead to its page (${JSON.stringify(led)})`);
        }
        // Each map says which world of the cluster runs it, a link into it and who is on it, those first; the rest are not running.
        if (path.startsWith("/wiki/maps/") || path === "/wiki/") {
          await run("new Promise((r) => { const t = Date.now(); const k = () => (document.querySelector('.live') || Date.now() - t > 3000 ? r() : setTimeout(k, 50)); k(); })");
          const maps = await run("[...document.querySelectorAll('[data-maps] > [data-map]')].map((c) => [c.dataset.map, [...c.querySelectorAll('.live')].map((l) => l.textContent).join(' / '), c.querySelector('.live a')?.getAttribute('href') ?? '', c.querySelector(':scope > small')?.textContent ?? ''])");
          const want = path.startsWith("/wiki/maps/miami/") ? [marked[0]] : [...marked, ...Array.from({ length: built - 1 }, () => ["Not running here", "", ""])];
          if (JSON.stringify(maps.map((m: string[]) => (m[1] === "Not running here" ? m.slice(1) : m))) !== JSON.stringify(want)) faults.push(`${path} at ${width}: the cluster's maps are not shown as it runs them (${JSON.stringify(maps)})`);
        }
        if (path.includes("creatures/raptor/") || path.includes("?world=")) {
          const special = path.includes("?world=");
          const tame = await run(`(() => {
            const input = document.querySelector('[data-taming-tools] input');
            input.value = '150';
            input.dispatchEvent(new Event('input'));
            const result = document.querySelector('[data-taming-result]');
            return [result.hidden, result.querySelector('th')?.textContent, result.querySelector('td:nth-child(4)')?.textContent];
          })()`);
          if (tame.join() !== [false, "150", special ? "1 in 2 min 30 s" : "51 in 42 min 30 s"].join()) faults.push(`${path}: exact tame ${tame.join()}`);
          await run("(() => { const input = document.querySelector('[data-taming-tools] input'); input.value = ''; input.dispatchEvent(new Event('input')); })()");
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
    for (const width of WIDTHS) for (const [path, id, mesh, move] of STUDIO) {
      // On a phone the survivor alone: its bar has the most to hold.
      if (width < 500 && !path.includes("survivor")) continue;
      await send("Emulation.setDeviceMetricsOverride", { width, height: width > 500 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 500 });
      errors.length = 0;
      await send("Page.navigate", { url: `http://localhost:${server.port}${path}` });
      await Bun.sleep(300);
      await run(settled);
      if (await run("!!document.querySelector('iframe.studio')")) faults.push(`${path}: studio requested before press`);
      // Pressed, the studio must say it is ready within a minute; then it plays the move asked and is let run a moment.
      const said = await run(`new Promise((r) => {
        addEventListener('message', (e) => e.data?.source === 'snark-studio' && r(e.data.type + (e.data.detail ? ': ' + e.data.detail : '')));
        const b = document.querySelector('[data-view]');
        if (!b) return r('no button');
        b.click();
        setTimeout(() => r('silent'), 50000);
      })`);
      if (said !== "ready") faults.push(`${path}: the studio said ${said}, not ready`);
      const inside = "document.querySelector('iframe.studio').contentDocument";
      if (said === "ready") {
        const [subject, meshes] = await run(`[${inside}.body.dataset.subject, ${inside}.body.dataset.meshes]`);
        if (subject !== id || !meshes?.split(" ").some((name: string) => mesh.test(name))) faults.push(`${path}: drew ${subject} with ${meshes}`);
      }
      const played = said === "ready" ? await run(`(async () => {
        const d = ${inside}, list = d.getElementById('move');
        const wait = ${waitFor};
        const move = ${JSON.stringify(move ?? "")};
        if (move) {
          if (!await wait(() => [...list.options].some((o) => o.value === move && !o.disabled), 15000)) return 'not offered: ' + move;
          list.value = move;
          list.dispatchEvent(new Event('change'));
          if (!await wait(() => !!d.getElementById('told').value)) return 'did not play: ' + move;
        }
        return [list.options.length, d.getElementById('told').value, d.body.dataset.error ?? ''].join(' | ');
      })()`) : "";
      console.log(`  studio ${path.padEnd(34)} ${String(width).padStart(4)} px  ${said}${played ? `  (${played})` : ""}`);
      if (move && /^(not offered|did not play)/.test(played)) faults.push(`${path}: ${played}`);
      faults.push(...errors.map((e) => `${path} in 3D: ${e}`));
      if (shots) {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `studio-${path.replace(/[/?=]+/g, "-").replace(/^-|-$/g, "")}-${width}.png`), Buffer.from(shot.data, "base64"));
      }
      const closed = await run(`(() => {
        const before = document.querySelector('[data-view]');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const poster = document.querySelector('[data-model-stage] img');
        return !document.querySelector('iframe.studio') && getComputedStyle(poster).visibility === 'visible' && before.getAttribute('aria-expanded') === 'false';
      })()`);
      if (!closed) faults.push(`${path}: close did not restore the still`);
    }
    const blocked = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      if (location.pathname === '/studio.html') {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind === 'webgl2' ? null : getContext.call(this, kind, ...args);
        };
      }
    ` });
    await send("Page.navigate", { url: `http://localhost:${server.port}/wiki/creatures/raptor/` });
    await Bun.sleep(400);
    const fallback = await run(`(async () => {
      const wait = ${waitFor}, b = document.querySelector('[data-view]');
      b.click();
      await wait(() => b.textContent === 'Retry 3D', 12000);
      return b.textContent === 'Retry 3D' && !document.querySelector('iframe.studio') && getComputedStyle(document.querySelector('[data-model-stage] img')).visibility === 'visible';
    })()`);
    if (!fallback) faults.push("Without WebGL the 3D viewer did not return to the still.");
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: blocked.identifier });
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
