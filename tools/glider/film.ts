// A glide filmed on this machine's GPU by the game's own page (planning/workstreams/glider.md): a server, one headless
// Chrome on a built client, and the page's own keys pressed over DevTools as a player presses them. The survivor is let go
// high over where it spawned, throws its glider open with C, flies, turns, dives, pulls out, flares and lands.
//
//   bun tools/glider/film.ts <out folder> --dist <built client> [--map file.snmap] [--up 160] [--tier high] [--wait 40]
//                            [--canvas 1280x720] [--yaw 0] [--suit]
//
// The client is one built apart (`bun tools/build-client.ts --quick --dist DIR`). With no --map the world is the proving
// ground. It writes glide.mp4 at 12 frames a second from the page's own screencast, each frame the newest the page had
// drawn, and a still at each moment of the flight. A survivor spawns with nothing on; --suit puts the Meridian set on it.

import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { dist: { type: "string" }, map: { type: "string" }, up: { type: "string", default: "160" }, tier: { type: "string", default: "high" }, wait: { type: "string", default: "40" }, canvas: { type: "string", default: "1280x720" }, suit: { type: "boolean" }, yaw: { type: "string", default: "0" } } });
const [out] = positionals;
if (!out || !values.dist) throw new Error("bun tools/glider/film.ts <out folder> --dist <built client> [--map file.snmap]");
if (!existsSync(join(values.dist, "main.js"))) throw new Error(`no built client in ${values.dist}`);
if (!Bun.which("ffmpeg")) throw new Error("ffmpeg is needed");
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
const [winW, winH] = values.canvas!.split("x").map(Number);
mkdirSync(out, { recursive: true });

const work = mkdtempSync(join(tmpdir(), "snark-glider-film-"));
const orders = ["enablecheats", "settime 15", ...(values.suit ? ["armor meridian"] : []), "give frond_glider 1"];
const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, dbPath: join(work, "world.db"), config: loadConfigFolder(DEV_CONFIG, []).rules, ...(values.map ? { map: values.map } : {}), clientDir: values.dist });
const profile = join(work, "profile");
const port = 9300 + Math.floor(Math.random() * 500);
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${winW},${winH}`, "--force-device-scale-factor=1", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { browser.kill(); server.stop(); process.exit(1); });
const file = join(out, "glide.mp4"), partial = join(out, "glide.partial.mp4");
let encoder: ReturnType<typeof Bun.spawn> | null = null;
const report: Record<string, unknown> = { map: values.map ?? "the proving ground", tier: values.tier, suit: !!values.suit };
try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 100 && !target; i++) {
    await Bun.sleep(200);
    try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not open a page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiting = new Map<number, (v: any) => void>();
  const lines: string[] = [];
  /** The newest frame the page's screencast has sent, and how many it has. */
  let latest: Buffer | null = null, cast = 0;
  const send = (method: string, params: object = {}): Promise<any> => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && waiting.has(d.id)) waiting.get(d.id)!(d.result);
    if (d.method === "Page.screencastFrame") {
      latest = Buffer.from(d.params.data, "base64");
      cast++;
      void send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
    }
    if (d.method === "Runtime.exceptionThrown") lines.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: winW!, height: winH!, deviceScaleFactor: 1, mobile: false });
  // A trip's page has no splash to click through and hands its App to this tool. The look is the player's own.
  await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick&name=glider${Math.floor(Math.random() * 1e6)}&tier=${values.tier}&trip` });
  // The page fetches the map and the art.
  await Bun.sleep(Number(values.wait) * 1000);
  /** Evaluates `js` with `app` the page's App, and returns what it gives. */
  const page = async (js: string): Promise<any> => {
    const r = await send("Runtime.evaluate", { expression: `(() => { const app = globalThis.snarkTrip.app; ${js} })()`, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(`the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r?.result?.value;
  };
  const own = (): Promise<{ x: number; y: number; z: number; vy: number; speed: number; glide: number; gear: number; grounded: boolean; swimming: boolean; stamina: number; third: boolean }> =>
    page("const o = app.session.own; return { x: o.x, y: o.y, z: o.z, vy: o.vy, speed: Math.hypot(o.vx, o.vz), glide: o.glide, gear: o.glideGear, grounded: o.grounded, swimming: o.mode === 2, stamina: o.stamina / 1000, third: app.view.thirdPerson };");
  const key = (code: string, down: boolean): Promise<unknown> => page(`app.key(${JSON.stringify(code)}, ${down});`);
  /** A quarter turn by the mouse over 0.7 s, `way` 1 to its left. */
  const quarter = async (way: number): Promise<void> => { for (let i = 0; i < 10; i++) { await page(`app.look(${(-way * (Math.PI / 2 / 10)) / 0.0025}, 0);`); await Bun.sleep(70); } };
  for (const line of orders) { await page(`app.session.text(${JSON.stringify(line)});`); await Bun.sleep(300); }
  // It faces as --yaw says, in degrees: 0 is +Z, north on a city's map.
  await page(`app.controls.yaw = ${(Number(values.yaw) * Math.PI) / 180}; app.controls.pitch = -0.1;`);
  const start = await own();
  if (start.gear !== 1) throw new Error(`the survivor carries no glider (gear ${start.gear}): were its orders typed?`);
  report.start = start;
  await page(`app.session.text("tp ${start.x.toFixed(1)} ${(start.y + Number(values.up)).toFixed(1)} ${start.z.toFixed(1)}");`);
  await Bun.sleep(500);

  encoder = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "image2pipe", "-framerate", "12", "-i", "pipe:0", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", partial], { stdin: "pipe", stdout: "ignore", stderr: "inherit" });
  const pipe = encoder.stdin as import("bun").FileSink;
  await send("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1 });
  for (let i = 0; i < 50 && !latest; i++) await Bun.sleep(100);
  if (!latest) throw new Error("the page sent no screencast frame");
  // What is done when, in seconds from the first frame, and how long after it its still is kept.
  const script: { at: number; name: string; still: number; do: () => Promise<unknown> }[] = [
    { at: 0.5, name: "open", still: 0.25, do: async () => { await key("KeyC", true); await Bun.sleep(90); await key("KeyC", false); } },
    { at: 1.2, name: "forward", still: 2.6, do: () => key("KeyW", true) },
    { at: 5.0, name: "turn-left", still: 0.55, do: () => quarter(1) },
    { at: 8.0, name: "dive", still: 1.3, do: () => key("ShiftLeft", true) },
    { at: 9.6, name: "pull-out", still: 0.5, do: () => key("ShiftLeft", false) },
    { at: 12.0, name: "turn-right", still: 0.55, do: () => quarter(-1) },
    { at: 15.0, name: "flare", still: 1.3, do: async () => { await key("KeyW", false); await key("KeyS", true); } },
    { at: 16.6, name: "forward-again", still: 2, do: async () => { await key("KeyS", false); await key("KeyW", true); } },
  ];
  const stills: Record<string, unknown>[] = [];
  const due: { name: string; at: number }[] = [];
  const began = performance.now();
  const clock = (): number => (performance.now() - began) / 1000;
  let frames = 0, next = 0, landedAt = -1, asked = 0;
  const most = 90;
  // The script's steps run beside the frames, so a turn's half second of mouse does not hold the film up.
  let acting: Promise<unknown> = Promise.resolve();
  while (true) {
    const now = clock();
    while (next < script.length && now >= script[next]!.at) {
      const step = script[next++]!;
      due.push({ name: step.name, at: clock() + step.still });
      acting = acting.then(step.do);
    }
    pipe.write(latest!);
    await pipe.flush();
    frames++;
    while (due.length > 0 && clock() >= due[0]!.at) {
      const s = due.shift()!;
      writeFileSync(join(out, `${String(stills.length + 1).padStart(2, "0")}-${s.name}.jpg`), latest!);
      stills.push({ name: s.name, at: +clock().toFixed(1), ...(await own()) });
    }
    // Asked a few times a second whether it is down, a second after which the film ends.
    if (clock() - asked > 0.3) {
      asked = clock();
      const o = await own();
      if ((o.grounded || o.swimming) && landedAt < 0) {
        landedAt = clock();
        acting = acting.then(() => key("KeyW", false));
      }
    }
    if ((landedAt >= 0 && clock() - landedAt > 1.5) || clock() > most) break;
    const wait = frames / 12 - clock();
    if (wait > 0) await Bun.sleep(wait * 1000);
  }
  await acting;
  await send("Page.stopScreencast");
  await pipe.end();
  if ((await encoder.exited) !== 0) throw new Error("ffmpeg could not write the film");
  renameSync(partial, file);
  const end = await own();
  const seconds = (performance.now() - began) / 1000;
  const gl = await send("Runtime.evaluate", { expression: "(() => { const c = document.querySelector('canvas'); const g = c && c.getContext('webgl2'); const i = g && g.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()", returnByValue: true });
  Object.assign(report, { end, landed: landedAt >= 0 ? (end.swimming ? "in water" : "on the ground") : "no", seconds: +seconds.toFixed(1), frames, drawnASecond: +(cast / seconds).toFixed(1), flown: +Math.hypot(end.x - start.x, end.z - start.z).toFixed(0), renderer: gl?.result?.value, stills, page: lines.slice(0, 8) });
  console.log(`${file}: ${frames} frames over ${seconds.toFixed(1)} s, of ${cast} the page sent (${(cast / seconds).toFixed(1)} a second); flown ${report.flown} m, ${landedAt >= 0 ? (end.swimming ? "came down in water" : "landed") : "still in the air"}${lines.length ? `\n  ${lines.slice(0, 8).join("\n  ")}` : ""}`);
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  browser.kill();
  await browser.exited;
  server.stop();
  rmSync(work, { recursive: true, force: true });
  rmSync(partial, { force: true });
  writeFileSync(join(out, "film.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.exit(0);
