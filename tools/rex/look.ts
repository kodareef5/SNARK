// Pictures of the Rexes drawn by the game's own page on this machine's GPU, from fixed cameras around each, so the old
// and new Rex are judged on the same views:
//
//   bun tools/rex/look.ts <out folder> --dist <built client> [--species core:rex,core:rex2] [--tiers high,ultra]
//                         [--views side,front,quarter,head,far,saddle] [--seconds 25] [--hour 14] [--ride core:rex2]
//
// The client is one built apart, such as the paddock's (`bun tools/carbonemys-rex/dev.ts --rex2 --dist DIR`). A server
// on the Rex paddock places each Rex wild in a row and holds it still, facing east. It answers each view's /__look with
// its orders and holds the survivor there as a ghost. One headless Chrome, muted, opens each view on each tier and keeps
// <out>/<view>-<species>-<tier>.png. With --ride, a second page's survivor is tamed that Rex, saddles it and sits on it,
// and that page's own riding camera is <out>/ride-<species>-<tier>.png. Two pages share the GPU, so the camera page's
// pictures are then drawn coarser.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import { MODE_GHOST } from "../../shared/sim/character.ts";
import { writeDinosaurCourse } from "../carbonemys-rex/course.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dist: { type: "string" }, species: { type: "string", default: "core:rex,core:rex2" }, tiers: { type: "string", default: "high" },
    views: { type: "string", default: "side,front,quarter,head,far" }, seconds: { type: "string", default: "25" }, hour: { type: "string", default: "14" },
    ride: { type: "string" },
  },
});
const [out] = positionals;
if (!out || !values.dist) throw new Error("bun tools/rex/look.ts <out folder> --dist <built client>");
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
mkdirSync(out, { recursive: true });

// Each view: where the eye stands from the Rex, along its forward and right, how high, and where it looks on the Rex.
// The Rex faces +X, so its right is -Z.
type View = { ahead: number; right: number; up: number; look: [number, number] };
const VIEWS: Record<string, View> = {
  side: { ahead: 0, right: 20, up: 3, look: [0, 2.8] },
  front: { ahead: 18, right: 0, up: 3, look: [0, 3] },
  quarter: { ahead: 11, right: 12, up: 5, look: [0, 2.8] },
  head: { ahead: 7.5, right: 4, up: 4.6, look: [3.6, 4.3] },
  far: { ahead: 20, right: 60, up: 2, look: [0, 2.8] },
  saddle: { ahead: 3, right: 7, up: 5.2, look: [1, 5] },
};

const species = values.species!.split(",");
const work = mkdtempSync(join(tmpdir(), "snark-rex-look-"));
const map = writeDinosaurCourse(join(work, "course.snmp"));
const orders = new Map<string, { run: string[]; look: [number, number]; at: [number, number, number] }>();
const server = startServer({
  dev: true, hostname: "127.0.0.1", port: 0, dbPath: join(work, "world.db"), config: loadConfigFolder(DEV_CONFIG, []).rules, map, clientDir: values.dist,
  routes: (_req, url) => (url.pathname === "/__look" ? (orders.has(url.searchParams.get("view") ?? "") ? Response.json(orders.get(url.searchParams.get("view")!)) : new Response("no such view", { status: 404 })) : null),
});
const { world, game } = server.host;
const ground = (x: number, z: number): number => Math.max(world.hf.heightAt(x, z), world.hf.seaLevel);

// The Rexes stand in a row on the open ground south of the spawn, far enough apart that each view shows one.
const EAST = 16384;
const placed = species.map((id, i) => {
  const x = 112 + i * 45, z = 92;
  const e = server.host.spawnCreature(id, x, z, 40, "admin");
  if (e < 0) throw new Error(`could not place ${id}`);
  return { id, e, x, z };
});
for (const p of placed) {
  for (const [name, v] of Object.entries(VIEWS)) {
    // Facing +X: forward is (1, 0) and right is (0, -1).
    const ex = p.x + v.ahead, ez = p.z - v.right, eye = ground(ex, ez) + v.up;
    const lx = p.x + v.look[0], lz = p.z, ly = ground(p.x, p.z) + v.look[1];
    const yaw = Math.atan2(lx - ex, lz - ez), pitch = Math.atan2(ly - eye, Math.hypot(lx - ex, lz - ez));
    orders.set(`${name}-${p.id.replace("core:", "")}`, { run: ["enablecheats", `settime ${values.hour}`], look: [yaw, pitch], at: [ex, eye - 1.62, ez] });
  }
}

// Hold each Rex where it was put, facing east, and the survivor at the view being taken, as a ghost.
let at: [number, number, number] | null = null;
const hold = setInterval(() => {
  for (const p of placed) {
    if (world.ents.pid[p.e] === undefined) continue;
    world.ents.setPosition(p.e, p.x, ground(p.x, p.z), p.z);
    world.ents.vx[p.e] = world.ents.vy[p.e] = world.ents.vz[p.e] = 0;
    world.ents.yaw[p.e] = EAST;
    server.host.creatures.mind.look[p.e] = EAST;
  }
  if (!at) return;
  for (const c of game.clients) {
    if (!c?.active || c.closed || c.ent < 0 || !c.name.startsWith("look")) continue;
    world.ents.mode[c.ent] = MODE_GHOST;
    world.ents.setPosition(c.ent, at[0], at[1], at[2]);
    world.history.discontinuity(c.ent);
    world.ents.vx[c.ent] = world.ents.vy[c.ent] = world.ents.vz[c.ent] = 0;
  }
}, 50);

/** A second page whose survivor gets on `id`: tamed to them, saddled, and mounted, all by the server. */
async function ride(port: number, who: number, id: string, tier: string): Promise<string> {
  const name = `rider${who}`;
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/?quick&name=${name}&tier=${tier}`)}`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
  let client;
  for (let i = 0; i < 240 && !client; i++) {
    await Bun.sleep(500);
    client = game.clients.find((c) => c?.active && !c.closed && c.ent >= 0 && c.name === name);
  }
  if (!client) throw new Error("the rider never joined");
  const p = placed.find((q) => q.id === id);
  if (!p) throw new Error(`${id} is not among --species`);
  const reg = world.reg, owner = server.host.records.byPid.get(client.pid)!, rec = server.host.records.byPid.get(world.ents.pid[p.e]!)!;
  if (!server.host.taming.give(rec, owner, 0, "forced")) throw new Error(`could not tame ${id}`);
  rec.saddle = reg.saddleFits.indexOf(reg.index.get(id)!);
  if (rec.saddle <= 0) throw new Error(`no saddle fits ${id}`);
  server.host.refreshBody(rec);
  world.ents.setPosition(client.ent, p.x, ground(p.x, p.z), p.z - 3);
  world.history.discontinuity(client.ent);
  await Bun.sleep(1000);
  const result = server.host.riding.mount(client, p.e);
  await Bun.sleep(3000);
  console.log(`the rider got on ${id}: ${result === 0 ? "yes" : `no, result ${result}`}`);
  return page.webSocketDebuggerUrl;
}

/** A picture of a page by its debugging socket: here the rider's own, whose camera follows the mount. */
async function picture(socket: string, file: string): Promise<void> {
  const ws = new WebSocket(socket);
  await new Promise((r) => (ws.onopen = r));
  const shot = await new Promise<{ data: string }>((r) => {
    ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id === 1) r(d.result); };
    ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
  });
  ws.close();
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(file);
}

const profile = join(work, "profile");
const port = 9300 + Math.floor(Math.random() * 500);
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1600,900", "--force-device-scale-factor=1", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { browser.kill(); server.stop(); process.exit(1); });
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
    if (d.method === "Runtime.exceptionThrown") lines.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") lines.push(`error: ${d.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`);
  };
  const send = (method: string, params: object = {}): Promise<any> => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const who = Math.floor(Math.random() * 1e6);
  if (values.ride) {
    // The rider's page is drawn on the first tier asked for, and its own riding camera is the picture.
    const tier = values.tiers!.split(",")[0]!;
    const rider = await ride(port, who, values.ride, tier);
    await Bun.sleep(Number(values.seconds) * 1000);
    await picture(rider, join(out, `ride-${values.ride.replace("core:", "")}-${tier}.png`));
  }
  let first = true;
  for (const tier of values.tiers!.split(",")) {
    for (const p of placed) {
      for (const name of values.views!.split(",")) {
        const view = `${name}-${p.id.replace("core:", "")}`;
        if (!orders.has(view)) throw new Error(`no view ${name}`);
        lines.length = 0;
        at = orders.get(view)!.at;
        await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick&name=look${who}&tier=${tier}&look=${encodeURIComponent(view)}` });
        await Bun.sleep((first ? 2 : 1) * Number(values.seconds) * 1000);
        first = false;
        await send("Runtime.evaluate", { expression: 'document.getElementById("ui").style.visibility = "hidden"' });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const file = `${view}-${tier}.png`;
        writeFileSync(join(out, file), Buffer.from(shot.data, "base64"));
        console.log(`${file}${lines.length ? `\n  ${lines.slice(0, 6).join("\n  ")}` : ""}`);
      }
    }
  }
} finally {
  clearInterval(hold);
  browser.kill();
  await browser.exited;
  server.stop();
  rmSync(work, { recursive: true, force: true });
}
process.exit(0);
