// Pictures of a built map drawn by the game's own page on this machine's GPU, from fixed cameras, so that a change is
// judged on the same views each time:
//
//   bun tools/mapworld/gpu-views.ts <file.snmap> <cameras.json> <out folder> --dist <built client> [--tiers high,medium]
//                                   [--seconds 40] [--only name,name]
//
// The client is one built apart (`bun run build -- --dist DIR`), never the checkout's client/dist. A server on the map
// answers each view's /__look with its orders (cheats, the hour, the way to face) and holds the survivor there as a ghost,
// and one headless Chrome, muted, opens each view on each tier and keeps a screenshot as <out>/<view>-<tier>.png. The cameras file is
// { hour, views: [{ name, x, z, up | y, look: [x, z, metres over the ground] | yaw and pitch in degrees }] } in engine
// metres, x west and z north (assets/source/maps/miami/look/route.json).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import { findChrome } from "../chrome.ts";

interface Camera { name: string; x: number; z: number; up?: number; y?: number; look?: [number, number, number?]; yaw?: number; pitch?: number }

const { values, positionals } = parseArgs({ allowPositionals: true, options: { dist: { type: "string" }, tiers: { type: "string", default: "high,medium" }, seconds: { type: "string", default: "40" }, only: { type: "string" } } });
const [map, list, out] = positionals;
if (!map || !list || !out || !values.dist) throw new Error("bun tools/mapworld/gpu-views.ts <file.snmap> <cameras.json> <out folder> --dist <built client>");
if (!existsSync(join(values.dist, "main.js"))) throw new Error(`no built client in ${values.dist}`);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
const file = JSON.parse(readFileSync(list, "utf8")) as { hour?: number; views: Camera[] };
const views = file.views.filter((v) => !values.only || values.only.split(",").includes(v.name));
const seconds = Number(values.seconds);
mkdirSync(out, { recursive: true });

const orders = new Map<string, { run: string[]; look: [number, number]; at: [number, number, number] }>();
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
  orders.set(v.name, { run: ["enablecheats", `settime ${file.hour ?? 14}`], look: [yaw, pitch], at: [v.x, eye - 1.62, v.z] });
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
const browser = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1920,1080", "--force-device-scale-factor=1", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  // One survivor for the run, which each view moves.
  const who = Math.floor(Math.random() * 1e6);
  let first = true;
  for (const tier of values.tiers!.split(",")) {
    for (const v of views) {
      lines.length = 0;
      at = orders.get(v.name)!.at;
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick&name=look${who}&tier=${tier}&look=${encodeURIComponent(v.name)}` });
      // The first view fetches the map and the art as well.
      await Bun.sleep((first ? 2 : 1) * seconds * 1000);
      first = false;
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const name = `${v.name}-${tier}.png`;
      writeFileSync(join(out, name), Buffer.from(shot.data, "base64"));
      const gl = await send("Runtime.evaluate", { expression: "(() => { const c = document.querySelector('canvas'); const g = c && c.getContext('webgl2'); const i = g && g.getExtension('WEBGL_debug_renderer_info'); return JSON.stringify({ renderer: i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : null }); })()", returnByValue: true });
      report.push({ name, ...JSON.parse(gl.result.value), console: lines.slice(0, 8) });
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
