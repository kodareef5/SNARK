// Pictures of a built map drawn by the game's own page on this machine's GPU, from fixed cameras, so that a change is
// judged on the same views each time:
//
//   bun tools/mapworld/gpu-views.ts <file.snmap> <cameras.json> <out folder> --dist <built client> [--tiers high,medium]
//                                   [--seconds 40] [--only name,name] [--off effect,effect] [--hide-hud] [--film]
//                                   [--canvas 1920x1080@1] [--page key=value] [--suffix name]
//
// --canvas is the page in points and the device pixels a point (1800x962@2 is a laptop's 3,600 by 1,924 canvas), --page
// adds to each page's address (`scale=1`, client/core/app.ts address), and --suffix ends each picture's name.
//
// The client is one built apart (`bun run build -- --dist DIR`), never the checkout's client/dist. A server on the map
// answers each view's /__look with its orders (cheats, the hour, the way to face) and holds the survivor there as a ghost,
// and one headless Chrome, muted, opens each view on each tier and keeps a screenshot as <out>/<view>-<tier>.png, or with
// effects off (client/core/passes.ts EFFECTS) as <out>/<view>-<tier>-off-<effects>.png. The cameras file is
// { hour, views: [{ name, x, z, up | y, look: [x, z, metres over the ground] | yaw and pitch in degrees }] } in engine
// metres, x west and z north (assets/source/maps/miami/look/route.json). With --film, a camera with replayEyeSeconds
// also produces a 12 fps clip from that time. replayDuration gives its length in seconds and defaults to 20.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

import { placeFileCameras } from "./obelisk-cameras.ts";

interface Camera { obelisk?: string; fromSpawn?: string; hour?: number; eyeSeconds?: number; replayEyeSeconds?: number; replayDuration?: number; name: string; x: number; z: number; up?: number; y?: number; look?: [number, number, number?]; yaw?: number; pitch?: number }

const { values, positionals } = parseArgs({ allowPositionals: true, options: { film: { type: "boolean" }, "hide-hud": { type: "boolean" }, dist: { type: "string" }, tiers: { type: "string", default: "high,medium" }, seconds: { type: "string", default: "40" }, only: { type: "string" }, off: { type: "string" }, canvas: { type: "string", default: "1920x1080@1" }, page: { type: "string", multiple: true, default: [] }, suffix: { type: "string", default: "" } } });
const [size, dpr = "1"] = values.canvas!.split("@"), [winW, winH] = size!.split("x").map(Number), scale = Number(dpr);
const [map, list, out] = positionals;
if (!map || !list || !out || !values.dist) throw new Error("bun tools/mapworld/gpu-views.ts <file.snmap> <cameras.json> <out folder> --dist <built client>");
if (!existsSync(join(values.dist, "main.js"))) throw new Error(`no built client in ${values.dist}`);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
const file = JSON.parse(readFileSync(list, "utf8")) as { hour?: number; views: Camera[] };
const views = await placeFileCameras(file.views.filter((v) => !values.only || values.only.split(",").includes(v.name)), map);
const seconds = Number(values.seconds);
mkdirSync(out, { recursive: true });

const orders = new Map<string, { eyeSeconds?: number; run: string[]; look: [number, number]; at: [number, number, number] }>();
// An optional clip samples the same world clock on every retake, independent of GPU or encoder speed.
async function recordIgnition(send: (method: string, params: object) => Promise<any>, start: number, duration: number, file: string): Promise<void> {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid clip duration for " + file);
  const partial = file + ".partial.mp4";
  const encoder = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "image2pipe", "-framerate", "12", "-i", "pipe:0", "-vf", "scale=1280:-2", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", partial], { stdin: "pipe", stderr: "inherit" });
  try {
    for (let frame = 0; frame < Math.round(12 * duration); frame++) {
      const response = await send("Runtime.evaluate", {
        expression: `(async () => { const app = globalThis.snarkTrip.app; if (!app.scene || app.artEyeTime == null) throw Error("camera has not loaded"); app.playEye = false; app.artEyeAt = null; app.artEyeTime = ${start + frame / 12}; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`,
        awaitPromise: true, returnByValue: true,
      });
      if (response?.result?.value !== true) throw new Error("Could not set the obelisk clock for " + file);
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
      encoder.stdin.write(Buffer.from(shot.data, "base64"));
      await encoder.stdin.flush();
    }
    await encoder.stdin.end();
    if (await encoder.exited !== 0) throw new Error("Could not encode " + file);
    renameSync(partial, file);
  } finally {
    if (encoder.exitCode === null) encoder.kill();
    await encoder.exited;
    rmSync(partial, { force: true });
  }
}
if (values.film && !Bun.which("ffmpeg")) throw new Error("--film requires ffmpeg");
const work = mkdtempSync(join(tmpdir(), "snark-gpu-views-"));
const server = startServer({
  dev: true, hostname: "127.0.0.1", port: 0, dbPath: join(work, "world.db"), config: loadConfigFolder(DEV_CONFIG, []).rules, map, clientDir: values.dist,
  routes: (_req, url) => (url.pathname === "/__look" ? (orders.has(url.searchParams.get("view") ?? "") ? Response.json(orders.get(url.searchParams.get("view")!)) : new Response("no such view", { status: 404 })) : null),
});
const hf = server.host.world.hf;
const ground = (x: number, z: number): number => Math.max(hf.heightAt(x, z), hf.seaLevel);
for (const v of views) {
  const eye = v.y ?? ground(v.x, v.z) + (v.up ?? 1.7);
  let [yaw, pitch] = [((v.yaw ?? 0) * Math.PI) / 180, ((v.pitch ?? 0) * Math.PI) / 180];
  if (v.look) {
    const [lx, lz, lup = 0] = v.look;
    yaw = Math.atan2(lx - v.x, lz - v.z);
    pitch = Math.atan2(ground(lx, lz) + lup - eye, Math.hypot(lx - v.x, lz - v.z));
  }
  // A body's place is its feet, 1.62 m under its eye.
  orders.set(v.name, { eyeSeconds: v.eyeSeconds, run: ["enablecheats", `settime ${v.hour ?? file.hour ?? 14}`], look: [yaw, pitch], at: [v.x, eye - 1.62, v.z] });
}
// Every survivor is held at the view being taken, still, as a ghost: a line typed on arrival would move it only after the
// page had placed its camera.
let at: [number, number, number] | null = null;
const { world, game } = server.host;
const hold = setInterval(() => {
  if (!at) return;
  for (const c of game.clients) {
    if (!c?.active || c.closed || c.ent < 0) continue;
    if (world.ents.mode[c.ent] === MODE_GHOST && Math.hypot(world.ents.x[c.ent]! - at[0], world.ents.y[c.ent]! - at[1], world.ents.z[c.ent]! - at[2]) < 0.01) continue;
    world.ents.mode[c.ent] = MODE_GHOST;
    world.ents.setPosition(c.ent, at[0], at[1], at[2]);
    world.history.discontinuity(c.ent);
    world.ents.vx[c.ent] = world.ents.vy[c.ent] = world.ents.vz[c.ent] = 0;
  }
}, 50);

const profile = join(work, "profile");
const port = 9300 + Math.floor(Math.random() * 500);
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${winW},${winH}`, `--force-device-scale-factor=${scale}`, "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
// Ended early, it takes its browser with it.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { browser.kill(); server.stop(); process.exit(1); });
const report: Record<string, unknown>[] = [];
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
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && waiting.has(d.id)) waiting.get(d.id)!(d.result);
    if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) lines.push(`${d.params.type}: ${d.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`);
    if (d.method === "Runtime.exceptionThrown") lines.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  };
  const send = (method: string, params: object = {}): Promise<any> => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: winW!, height: winH!, deviceScaleFactor: scale, mobile: false });
  // Each view logs in as one of NAMES survivors in turn, so it comes in as the first view does. With one survivor for the
  // run, the next page came back within the 5 s a body lingers and took the session over, and every view after the first
  // was taken from where the first had been. Four views on, the name's session has ended and the name logs in afresh. More
  // names would run into the server's 8 new names an hour from one machine (NEW_NAMES in server/game.ts).
  const who = Math.floor(Math.random() * 1e6);
  const NAMES = 4;
  let first = true, taken = 0;
  for (const tier of values.tiers!.split(",")) {
    for (const v of views) {
      lines.length = 0;
      at = orders.get(v.name)!.at;
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick&name=look${who}v${taken++ % NAMES}&tier=${tier}&look=${encodeURIComponent(v.name)}${values.film && v.replayEyeSeconds !== undefined ? "&trip" : ""}${values.off ? `&off=${values.off}` : ""}${values.page!.map((p) => `&${p}`).join("")}` });
      // The first view fetches the map and the art as well.
      await Bun.sleep((first ? 2 : 1) * seconds * 1000);
      first = false;
      if (values["hide-hud"]) {
        await send("Runtime.evaluate", { expression: 'document.getElementById("ui").style.visibility = "hidden"' });
      }
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const name = `${v.name}-${tier}${values.off ? `-off-${values.off.replaceAll(",", "-")}` : ""}${values.suffix}.png`;
      writeFileSync(join(out, name), Buffer.from(shot.data, "base64"));
      if (values.film && v.replayEyeSeconds !== undefined) {
        await recordIgnition(send, v.replayEyeSeconds, v.replayDuration ?? 20, join(out, `${v.name}-${tier}.mp4`));
      }
      const gl = await send("Runtime.evaluate", { expression: "(() => { const c = document.querySelector('canvas'); const g = c && c.getContext('webgl2'); const i = g && g.getExtension('WEBGL_debug_renderer_info'); return JSON.stringify({ renderer: i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : null }); })()", returnByValue: true });
      report.push({ name, ...(v.hour !== undefined ? { hour: v.hour } : {}), ...JSON.parse(gl.result.value), console: lines.slice(0, 8) });
      console.log(`${name}${lines.length ? `\n  ${lines.slice(0, 8).join("\n  ")}` : ""}`);
    }
  }
} finally {
  clearInterval(hold);
  browser.kill();
  await browser.exited;
  server.stop();
  rmSync(work, { recursive: true, force: true });
  writeFileSync(join(out, "views.json"), `${JSON.stringify({ map, cameras: list, hour: file.hour ?? 14, seconds, pictures: report }, null, 2)}\n`);
}
process.exit(0);
