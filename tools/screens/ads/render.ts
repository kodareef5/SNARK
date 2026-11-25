// Renders the ad pages in tools/screens/ads/ to stills and clips, with a sheet for `bun run screens add`.
//   bun tools/screens/ads/render.ts [name...]   all ads, or those named, into var/ads/out/
// Each page carries its facts in <script type="application/json" id="ad">: name, title, type, kind, and for a clip
// its seconds and poster second. A still is a screenshot at the type's size. A clip is frame(t) stepped at 30 a
// second, each frame a screenshot, encoded by ffmpeg to H.264 with fixed settings.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHROME_FLAGS, findChrome } from "../../chrome.ts";
import { SIZES, adsIn, sheetOf } from "./facts.ts";

const HERE = import.meta.dir;
const ROOT = resolve(HERE, "../../..");
const OUT = join(ROOT, "var/ads/out");
const FPS = 30;

/** A small DevTools client over one page. */
async function open(): Promise<{ send: (method: string, params?: object) => Promise<any>; close: () => void }> {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome found; set CHROME");
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = join(ROOT, `var/tmp/ads-profile-${port}`);
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb", "--allow-file-access-from-files", "--font-render-hinting=none", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 100 && !target; i++) {
    await Bun.sleep(100);
    try {
      target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  const waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.method === "Runtime.exceptionThrown") console.error(`  page: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    const w = d.id && waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.error) w.fail(new Error(d.error.message));
    else w.ok(d.result);
  };
  const send = (method: string, params: object = {}): Promise<any> => new Promise((ok, fail) => {
    waiting.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  return { send, close: () => (ws.close(), browser.kill(), rmSync(profile, { recursive: true, force: true })) };
}

async function evaluate(send: (m: string, p?: object) => Promise<any>, expression: string): Promise<unknown> {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function shot(send: (m: string, p?: object) => Promise<any>): Promise<Buffer> {
  return Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
}

// --at S takes a still of each chosen ad S seconds in, as var/ads/look/<name>@S.png, to look at one moment.
const at = process.argv.includes("--at") ? Number(process.argv[process.argv.indexOf("--at") + 1]) : undefined;
const names = process.argv.slice(2).filter((a, i, all) => a !== "--at" && all[i - 1] !== "--at");
const all = adsIn(HERE);
const chosen = names.length ? all.filter((a) => names.includes(a.facts.name)) : all;
if (names.length && chosen.length !== names.length) throw new Error(`no ad named ${names.filter((n) => !all.some((a) => a.facts.name === n)).join(", ")}`);
mkdirSync(OUT, { recursive: true });
mkdirSync(join(ROOT, "var/tmp"), { recursive: true });

// The creature cutouts are made from the installed art when any are missing.
const pictures = all.flatMap(({ file }) => [...readFileSync(file, "utf8").matchAll(/data-(?:src|frames)="([^"]+)"/g)].map((m) => join(HERE, m[1]!.replace("%02d", "00"))));
if (pictures.some((p) => !existsSync(p))) {
  console.log("making the creature cutouts");
  if (Bun.spawnSync(["bun", join(HERE, "creatures.ts")], { stdout: "inherit", stderr: "inherit" }).exitCode !== 0) throw new Error("creatures.ts failed; is the art installed (bun run media art)?");
}

const { send, close } = await open();
try {
  for (const { file, facts } of chosen) {
    const t0 = performance.now();
    const [w, h] = SIZES[facts.type][facts.kind];
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `file://${file}` });
    await evaluate(send, "new Promise((ok, fail) => { const go = () => (window.adReady ? window.adReady.then(ok, fail) : setTimeout(go, 20)); go(); })");
    if (at !== undefined) {
      if (facts.kind === "clip") await evaluate(send, `window.frame(${at})`);
      mkdirSync(join(ROOT, "var/ads/look"), { recursive: true });
      writeFileSync(join(ROOT, "var/ads/look", `${facts.name}@${at}.png`), await shot(send));
    } else if (facts.kind === "image") {
      writeFileSync(join(OUT, `${facts.name}.png`), await shot(send));
    } else {
      const out = join(OUT, `${facts.name}.mp4`);
      const kbps = SIZES[facts.type].kbps;
      const ffmpeg = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", "20", "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
        "-g", String(FPS * 2), "-pix_fmt", "yuv420p", "-threads", "1", "-an", "-map_metadata", "-1",
        "-fflags", "+bitexact", "-flags:v", "+bitexact", "-movflags", "+faststart", out], { stdin: "pipe", stderr: "inherit" });
      const frames = Math.round(facts.seconds! * FPS);
      for (let i = 0; i < frames; i++) {
        await evaluate(send, `window.frame(${i / FPS})`);
        ffmpeg.stdin.write(await shot(send));
      }
      await ffmpeg.stdin.end();
      if ((await ffmpeg.exited) !== 0) throw new Error(`${facts.name}: ffmpeg failed`);
    }
    console.log(`${facts.name}: ${facts.kind} ${w}x${h}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  close();
}

// The sheet lists every ad, rendered now or before.
writeFileSync(join(OUT, "sheet.csv"), sheetOf(all.map((a) => a.facts)));
console.log(`${join(OUT, "sheet.csv")}: ${all.length} rows`);
process.exit(0);
