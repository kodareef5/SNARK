// `bun run probe -- --pages`: the field guide in headless Chrome, served from client/dist by the server's own file
// serving, after `bun run build` and `bun run pages`. Each page below is opened at a desktop's width and a phone's: it must
// raise no error, fit the width and decode every picture it shows. A creature's sound must decode from the game's file
// as the page plays it, the search must find a raptor, and a map's layer must load when its box is ticked. It prints
// what each page fetched. With `--shots <folder>` it keeps a picture of each page there.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveFile } from "../server/files.ts";

const DIST = resolve(import.meta.dir, "../client/dist");
const PAGES = ["/guide/", "/guide/creatures/raptor/", "/guide/items/piece_foundation_wood/", "/guide/items/pistol/", "/guide/vehicles/compact/", "/guide/maps/miami/", "/guide/items/", "/guide/search/?q=raptor", "/guide/commands/"];
const WIDTHS = [1280, 390];

export async function pagesProbe(chrome: string): Promise<boolean> {
  if (!existsSync(join(DIST, "guide/index.html"))) throw new Error("client/dist/guide is missing: run bun run build, then bun run pages");
  const at = process.argv.indexOf("--shots");
  const shots = at > 0 ? resolve(process.argv[at + 1]!) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  const server = Bun.serve({ port: 0, fetch: (req) => serveFile(DIST, req) });
  const profile = mkdtempSync(join(tmpdir(), "snark-pages-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--disable-extensions", "--remote-debugging-port=0", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const faults: string[] = [];
  try {
    let port = 0;
    for (let k = 0; k < 100 && !port; k++, await Bun.sleep(100)) if (existsSync(join(profile, "DevToolsActivePort"))) port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
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
        const page = await run(`({ wide: document.documentElement.scrollWidth > innerWidth, broken: [...document.images].filter((i) => i.getAttribute('src') && i.complete && i.loading !== 'lazy' && i.naturalWidth === 0).map((i) => i.src), bytes: performance.getEntriesByType('resource').reduce((n, r) => n + r.transferSize, 0) + performance.getEntriesByType('navigation')[0].transferSize })`);
        if (page.wide) faults.push(`${path} at ${width}: wider than the screen`);
        if (page.broken.length) faults.push(`${path} at ${width}: pictures that do not decode: ${page.broken.join(", ")}`);
        if (width > 500 && path.includes("raptor")) {
          await run("document.querySelector('[data-k]').click()");
          await Bun.sleep(1500);
          if (await run("document.querySelector('[data-k]').classList.contains('failed')")) faults.push(`${path}: its first sound does not play`);
        }
        if (width > 500 && path.includes("search")) {
          await Bun.sleep(500);
          if (!(await run("[...document.querySelectorAll('.results a')].some((a) => a.textContent === 'Raptor')"))) faults.push(`${path}: no raptor found`);
        }
        if (width > 500 && path.includes("maps/")) {
          await run("(() => { const box = document.querySelector('[data-show=\"palm\"]'); box.click(); return document.querySelector('img[data-layer=\"palm\"]').decode(); })()");
          if (!(await run("document.querySelector('img[data-layer=\"palm\"]').naturalWidth > 0"))) faults.push(`${path}: the palm layer does not load`);
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
