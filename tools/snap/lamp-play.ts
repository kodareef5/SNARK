// bun tools/snap/lamp-play.ts <miami.snmap> <out folder> --dist <built client> [--canvas 1800x962@2] [--tiers high,medium]
//   [--seconds 30] [--hour 22] [--only name,name] [--page name:key=value&key=value ...]
//
// The street lamps as a player meets them (planning/workstreams/night-light.md): the game's own page in Chrome on this
// machine's GPU, as a player's page and not a tool's, so the governor steps as it would for them and the scene's share
// is the game's own ("auto"), the tier chosen in the settings. A server on the map of its own, on a port of its own,
// keeps the hour and puts the survivor where each moment wants it. --canvas is the page in points and the device
// pixels a point (1800x962@2 is a laptop's 3,600 by 1,924 canvas). After every moment on every tier, each --page is a
// variant: the page opened again with that added to its address (`off=bloom`, `off=lamps`) and the strips taken again on
// the first tier, their pictures named with the variant's name.
//
// - A stand: the survivor on foot, in third person or from the eye, a car parked beside, under or along from a working
//   lamp; the page is watched for a few seconds and what the lamp did each frame is kept with a picture.
// - A strip: the survivor a ghost carried along a street a step at a time, or held still, and a picture of a part of the
//   screen at each step. Each working lamp in that part is followed: the light in a window round its lens and in one
//   round its pool's middle at each step, and how much each jumps from step to step against the smooth change the
//   camera's creep makes (`jumpiness`), with a sheet of its lens magnified, a row a lamp and a column a step.
//
// It writes <out>/<moment>-<tier>.png, the strips' frames as <out>/<moment>-<tier>/<k>.png and their sheets as
// <out>/<moment>-<tier>-lenses.png, and <out>/play.json: each moment's frames of the lamp, the governor's level and
// steps, the scene's share and the camera, and each strip's lamps.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import { MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { offsetForHour } from "../../shared/sim/clock.ts";
import { LAMP_AT } from "../../client/core/render/packet.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { decodePng, type Picture } from "../pack/image.ts";
import { encodePng } from "./png.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { dist: { type: "string" }, canvas: { type: "string", default: "1800x962@2" }, tiers: { type: "string", default: "high,medium" }, seconds: { type: "string", default: "30" }, hour: { type: "string", default: "22" }, only: { type: "string" }, page: { type: "string", multiple: true, default: [] } } });
const [mapPath, out] = positionals;
if (!mapPath || !out || !values.dist) throw new Error("bun tools/snap/lamp-play.ts <miami.snmap> <out folder> --dist <built client>");
const [size, dpr = "1"] = values.canvas!.split("@"), [winW, winH] = size!.split("x").map(Number) as [number, number], scale = Number(dpr);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
const seconds = Number(values.seconds), hour = Number(values.hour);
mkdirSync(out, { recursive: true });

/** A place in a lamp's own frame: x along the road, z out over it from the mast, as night-study.ts has it. */
interface Frame { readonly x: number; readonly z: number; readonly yaw: number }
interface Moment {
  readonly name: string;
  /** A working lamp's mast, near which the moment is: the piece nearest this place in the world. */
  readonly near: readonly [number, number];
  /** stand: the survivor's feet and the point it looks at (x, height, z), a car beside (x, z, turn), in the lamp's frame. */
  readonly body?: readonly [number, number];
  readonly at?: readonly [number, number, number];
  readonly car?: readonly [number, number, number];
  readonly third?: boolean;
  /** strip: the eye's way from and to, metres over the ground, the steps, and the screen's part kept (x, y, w, h of 1). */
  readonly from?: readonly [number, number];
  readonly to?: readonly [number, number];
  readonly up?: number;
  readonly steps?: number;
  readonly part?: readonly [number, number, number, number];
  /** Degrees the look turns across the strip, a step at a time, as a player's mouse turns it. */
  readonly turn?: number;
}

const MOMENTS: readonly Moment[] = [
  // The lamp of night-study.ts's pair: on the kerb under it facing the car on the road, and 12 m along the walk from it.
  { name: "under", near: [6700.5, 11397.3], body: [1.5, 1.2], at: [-1.5, 0.8, 4.4], car: [-1.5, 4.4, Math.PI / 2], third: true },
  { name: "under-eye", near: [6700.5, 11397.3], body: [1.5, 1.2], at: [-1.5, 0.8, 4.4], car: [-1.5, 4.4, Math.PI / 2], third: false },
  { name: "along", near: [6700.5, 11397.3], body: [-12, 0.6], at: [0, 0.8, 4], car: [-1.5, 4.4, Math.PI / 2], third: true },
  // The GPU bench's lamp station (tools/bench/gpu.ts CITY_PLACES.lamp): 6 m along the road from under its lens.
  { name: "bench", near: [7303, 5231], body: [6, 2.9], at: [-2, 0.8, 3], car: [2, 4.6, Math.PI / 2], third: true },
  // A street with ten working lamps 50 to 210 m along it: the eye on the road, held still, then creeping along it at a
  // walk's 3 m/s seen 60 times a second, and over it at 15 m flying slowly, at 7.5 m/s.
  { name: "far-still", near: [7013.8, 10173.9], from: [-2, 4], to: [-2, 4], up: 1.7, steps: 24, part: [0.2, 0.3, 0.6, 0.3] },
  { name: "far-creep", near: [7013.8, 10173.9], from: [-2, 4], to: [-3.5, 4], up: 1.7, steps: 31, part: [0.2, 0.3, 0.6, 0.3] },
  { name: "far-fly", near: [7013.8, 10173.9], from: [-2, 4], to: [-4.5, 4], up: 15, steps: 21, part: [0.2, 0.3, 0.6, 0.3] },
  // Standing on the road, the look turning slowly, a twentieth of a degree a step: the lamps far off move a pixel or two.
  { name: "far-turn", near: [7013.8, 10173.9], from: [-2, 4], to: [-2, 4], up: 1.7, steps: 21, part: [0.2, 0.3, 0.6, 0.3], turn: 1 },
  // As the owner most likely looked: on foot in third person on the walk, still, then walking along it at 3 m/s.
  { name: "third-still", near: [7013.8, 10173.9], from: [-2, -1.5], to: [-2, -1.5], up: 1.7, steps: 21, part: [0.2, 0.25, 0.6, 0.3], third: true },
  { name: "third-walk", near: [7013.8, 10173.9], from: [-2, -1.5], to: [-3, -1.5], up: 1.7, steps: 21, part: [0.2, 0.25, 0.6, 0.3], third: true },
];

const map = Bun.mmap(mapPath);
const work = mkdtempSync(join(tmpdir(), "snark-lamp-play-"));
const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, dbPath: join(work, "world.db"), config: loadConfigFolder(DEV_CONFIG, []).rules, map: mapPath, clientDir: values.dist });
void map;
const { world, game } = server.host;
const hf = world.hf;
const lit = world.reg.index.get("core:zzstreet_lamp_lit")!;
/** The working lamp nearest a place, as a frame. */
function lampNear(x: number, z: number): Frame {
  let best: Frame | null = null, d = Infinity;
  for (const t of world.structs.chunks) {
    if (!t) continue;
    for (let s = 0; s < t.high; s++) {
      if (t.kind[s] !== lit) continue;
      const e = Math.hypot(t.x[s]! - x, t.z[s]! - z);
      if (e < d) [d, best] = [e, { x: t.x[s]!, z: t.z[s]!, yaw: (t.yaw[s]! / 65536) * 2 * Math.PI }];
    }
  }
  if (!best) throw new Error(`no working lamp near ${x}, ${z}`);
  return best;
}
const at = (f: Frame, x: number, z: number): [number, number] => [f.x + Math.cos(f.yaw) * x + Math.sin(f.yaw) * z, f.z - Math.sin(f.yaw) * x + Math.cos(f.yaw) * z];
const ground = (x: number, z: number): number => Math.max(hf.heightAt(x, z), hf.seaLevel);
const own = (): number => game.clients.find((c) => c?.active && !c.closed && c.ent >= 0)?.ent ?? -1;
/** Puts the survivor's feet at a place, walking or a ghost, still. */
function place(x: number, y: number, z: number, ghost: boolean): void {
  const e = own();
  if (e < 0) return;
  world.ents.mode[e] = ghost ? MODE_GHOST : MODE_WALK;
  world.ents.setPosition(e, x, y, z);
  world.history.discontinuity(e);
  world.ents.vx[e] = world.ents.vy[e] = world.ents.vz[e] = 0;
}
/** The working lamps within `r` metres of a place, nearest first: each one's lens and the middle of its pool on the ground (street-lamps.ts LENS, lamp.ts LAMP_OUT). */
function lampsNear(x: number, z: number, r: number): { lens: [number, number, number]; pool: [number, number, number] }[] {
  const found: { d: number; lens: [number, number, number]; pool: [number, number, number] }[] = [];
  for (const t of world.structs.chunks) {
    if (!t) continue;
    for (let s = 0; s < t.high; s++) {
      const d = Math.hypot(t.x[s]! - x, t.z[s]! - z);
      if (t.kind[s] !== lit || d > r) continue;
      const yaw = (t.yaw[s]! / 65536) * 2 * Math.PI, wx = Math.sin(yaw), wz = Math.cos(yaw);
      const lx = t.x[s]! + wx * 2.9, lz = t.z[s]! + wz * 2.9, px = lx + wx * 2, pz = lz + wz * 2;
      found.push({ d, lens: [lx, t.y[s]! + 8.85, lz], pool: [px, ground(px, pz), pz] });
    }
  }
  return found.sort((a, b) => a.d - b.d);
}
/** Where camera-relative world points fall on the page, in its points, by the page's own camera, or null behind it. */
const project = (points: readonly (readonly number[])[]): string => `(() => { const c = snarkTrip.app.cam, m = c.viewProj, w = innerWidth, h = innerHeight;
  return ${JSON.stringify(points)}.map(([x, y, z]) => { const r = [x - c.x, y - c.y, z - c.z], cx = m[0] * r[0] + m[4] * r[1] + m[8] * r[2] + m[12], cy = m[1] * r[0] + m[5] * r[1] + m[9] * r[2] + m[13], cw = m[3] * r[0] + m[7] * r[1] + m[11] * r[2] + m[15];
    return cw <= 0 ? null : [((cx / cw) * 0.5 + 0.5) * w, (0.5 - (cy / cw) * 0.5) * h]; }); })()`;
/** The sum of the luma of a window `w` by `h` device pixels round (x, y) of a picture, or NaN where it is not wholly in it. */
function windowLuma(p: Picture, x: number, y: number, w: number, h: number): number {
  const x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
  if (x0 < 0 || y0 < 0 || x0 + w > p.width || y0 + h > p.height) return NaN;
  let sum = 0;
  for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) {
    const o = (j * p.width + i) * p.channels;
    sum += 0.2126 * p.data[o]! + 0.7152 * p.data[o + 1]! + 0.0722 * p.data[o + 2]!;
  }
  return sum;
}
/**
 * How much a lamp's light jumps from one step to the next against the smooth change of the camera's creep: the mean of
 * each step's distance from the middle of its neighbours', over the mean, or for a still camera from the mean.
 */
function jumpiness(series: readonly number[], still: boolean): number {
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  if (!(mean > 0)) return NaN;
  let sum = 0, n = 0;
  for (let k = still ? 0 : 1; k < series.length - (still ? 0 : 1); k++, n++) sum += Math.abs(series[k]! - (still ? mean : (series[k - 1]! + series[k + 1]!) / 2));
  return sum / n / mean;
}
world.dayOffset = offsetForHour(world.tick, hour, world.clock);
game.replication.markAllOwn();

const profile = join(work, "profile");
const port = 9300 + Math.floor(Math.random() * 500);
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${winW},${winH}`, `--force-device-scale-factor=${scale}`, "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { browser.kill(); server.stop(); process.exit(1); });
const report: Record<string, unknown>[] = [];
const parked = new Set<string>();
/** What the page's lamp and governor are this frame, as the page sees them. */
const STATE = `(() => { const a = globalThis.snarkTrip?.app, s = a?.scene; if (!s) return null; const f = s.packet.frame, L = s.streetLamps, c = a.cam, o = a.session.own, t = s.assets.tier;
  return { tier: t.name, cascades: t.shadows.cascades, lampTier: t.shadows.lamp === true, post: t.post !== null, level: a.governor.level, share: s.share, canvas: [s.canvasWidth, s.canvasHeight], third: a.view.thirdPerson,
    cam: [c.x, c.y, c.z, c.yaw, c.pitch], own: [o.x, o.y, o.z], shows: L.shows, on: s.lamp.on, range: f[${LAMP_AT + 3}], layer: f[${LAMP_AT + 7}], lens: [f[${LAMP_AT}] + c.x, f[${LAMP_AT + 1}] + c.y, f[${LAMP_AT + 2}] + c.z], cards: L.count, now: s.now }; })()`;
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
  const evaluate = async (expression: string): Promise<any> => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: winW, height: winH, deviceScaleFactor: scale, mobile: false });
  let first = true;
  for (const variant of ["", ...values.page!]) {
  // A variant is a name and what it adds to the page's address (client/core/app.ts address), as `bloomoff:off=bloom`.
  const [label = "", query = ""] = variant.split(":");
  const tag = label ? `-${label}` : "";
  await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick&name=lampplay&trip${query ? `&${query}` : ""}` });
  await Bun.sleep(3000);
  for (let i = 0; i < 600 && own() < 0; i++) await Bun.sleep(100);
  if (own() < 0) throw new Error("the page never joined");
  const renderer = await evaluate("(() => { const g = document.querySelector('canvas')?.getContext('webgl2'); const i = g?.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : null; })()");
  console.log(`renderer ${renderer}${tag}`);
  for (const tier of label ? values.tiers!.split(",").slice(0, 1) : values.tiers!.split(",")) {
    for (const m of MOMENTS.filter((m) => (!values.only || values.only.split(",").includes(m.name)) && (!label || m.from))) {
      lines.length = 0;
      const f = lampNear(m.near[0], m.near[1]);
      let yaw = 0, pitch = 0;
      if (m.body) {
        const [bx, bz] = at(f, m.body[0], m.body[1]), [lx, lz] = at(f, m.at![0], m.at![2]);
        place(bx, ground(bx, bz) + 0.05, bz, false);
        yaw = Math.atan2(lx - bx, lz - bz);
        pitch = Math.atan2(ground(lx, lz) + m.at![1] - (ground(bx, bz) + 1.62), Math.hypot(lx - bx, lz - bz));
        // A car once a place, which stays for the next tier's look.
        const [cx, cz] = m.car ? at(f, m.car[0], m.car[1]) : [0, 0];
        if (m.car && !parked.has(`${Math.round(cx)} ${Math.round(cz)}`)) {
          parked.add(`${Math.round(cx)} ${Math.round(cz)}`);
          server.host.spawnVehicle("core:compact", cx, cz, 0, f.yaw + m.car[2]);
        }
      }
      /** The strip's eye at step k, and its feet a ghost's 1.62 m under it. */
      const eyeAt = (k: number): [number, number, number] => {
        const s = m.steps! > 1 ? k / (m.steps! - 1) : 0, [x, z] = at(f, m.from![0] + (m.to![0] - m.from![0]) * s, m.from![1] + (m.to![1] - m.from![1]) * s);
        return [x, ground(x, z) + m.up!, z];
      };
      if (m.from) {
        const [ex, ey, ez] = eyeAt(0), [lx, lz] = at(f, -400, m.from[1]);
        place(ex, ey - 1.62, ez, !m.third);
        yaw = Math.atan2(lx - ex, lz - ez);
        pitch = Math.atan2(ground(lx, lz) + 1 - ey, 400);
      }
      await evaluate(`(() => { const a = snarkTrip.app; a.ui.settings.tier = ${JSON.stringify(tier)}; a.ui.settings.chosen = true; a.ui.settings.resolution = 0; a.view.thirdPerson = ${m.third === true}; a.held = [${yaw}, ${pitch}]; a.releaseLook = false; return true; })()`);
      // The first moment fetches the map and the art as well.
      for (let s = 0; s < (first ? 2 : 1) * seconds; s++) {
        await Bun.sleep(1000);
        if (m.body) {
          const [bx, bz] = at(f, m.body[0], m.body[1]), e = own();
          if (e >= 0 && Math.hypot(world.ents.x[e]! - bx, world.ents.z[e]! - bz) > 0.5) place(bx, ground(bx, bz) + 0.05, bz, false);
        }
        await evaluate(`(() => { const a = snarkTrip.app; a.view.thirdPerson = ${m.third === true}; return true; })()`);
      }
      first = false;
      if (m.from) {
        // Each step: the ghost, or in third person the body on foot, moved, the page's camera waited for where it was
        // put, or in third person till it stood still, then the part of the screen kept.
        const dir = join(out, `${m.name}-${tier}${tag}`), states: unknown[] = [];
        mkdirSync(dir, { recursive: true });
        const [px, py, pw, ph] = m.part!;
        // The working lamps along the street, and each step where each one's lens and pool fall in the part kept.
        const lamps = lampsNear(eyeAt(0)[0], eyeAt(0)[2], 330), points = lamps.flatMap((l) => [l.lens, l.pool]);
        const shots: Picture[] = [], places: ([number, number] | null)[][] = [];
        for (let k = 0; k < m.steps!; k++) {
          const [ex, ey, ez] = eyeAt(k), look = yaw + (((m.turn ?? 0) * Math.PI) / 180) * (k / Math.max(1, m.steps! - 1));
          place(ex, ey - 1.62, ez, !m.third);
          if (m.turn) await evaluate(`(() => { snarkTrip.app.held = [${look}, ${pitch}]; return true; })()`);
          let before: number[] | null = null;
          for (let w = 0; w < 40; w++) {
            const c = await evaluate("(() => { const c = snarkTrip.app.cam; return [c.x, c.y, c.z, c.yaw]; })()");
            const placed = c && (m.third ? before !== null && Math.hypot(c[0] - before[0]!, c[1] - before[1]!, c[2] - before[2]!) < 0.0005 && w > 4 : Math.hypot(c[0] - ex, c[2] - ez) < 0.005);
            if (c && placed && Math.abs(Math.atan2(Math.sin(c[3] - look), Math.cos(c[3] - look))) < 1e-4) break;
            before = c;
            await Bun.sleep(50);
          }
          states.push(await evaluate(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(${STATE}))))`));
          const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: px * winW, y: py * winH, width: pw * winW, height: ph * winH, scale: 1 } });
          const bytes = Buffer.from(shot.data, "base64");
          writeFileSync(join(dir, `${String(k).padStart(2, "0")}.png`), bytes);
          shots.push(decodePng(new Uint8Array(bytes)));
          places.push(((await evaluate(project(points))) as ([number, number] | null)[]).map((q) => (q ? [(q[0] - px * winW) * scale, (q[1] - py * winH) * scale] : null)));
        }
        // Each lamp in the part at every step: its lens's light and its pool's, step by step, and a sheet of its lens
        // magnified, a row a lamp and a column a step.
        const LENS_W = 40, POOL_W = 96, POOL_H = 24, ZOOM = 3;
        const seen = lamps.map((l, i) => ({ l, i })).filter(({ i }) => places.every((q, k) => q[2 * i] && Number.isFinite(windowLuma(shots[k]!, q[2 * i]![0], q[2 * i]![1], LENS_W, LENS_W))));
        const lampRows = seen.map(({ l, i }) => {
          const lens = shots.map((s, k) => windowLuma(s, places[k]![2 * i]![0], places[k]![2 * i]![1], LENS_W, LENS_W));
          const pool = shots.map((s, k) => (places[k]![2 * i + 1] ? windowLuma(s, places[k]![2 * i + 1]![0], places[k]![2 * i + 1]![1], POOL_W, POOL_H) : NaN));
          const still = m.from![0] === m.to![0] && m.from![1] === m.to![1] && !m.turn;
          return { metres: Math.round(Math.hypot(l.lens[0] - eyeAt(0)[0], l.lens[2] - eyeAt(0)[2])), lensJump: jumpiness(lens, still), poolJump: pool.every(Number.isFinite) ? jumpiness(pool, still) : NaN, lens: lens.map(Math.round), pool: pool.map(Math.round) };
        });
        const tile = LENS_W * ZOOM, sheet = new Uint8Array(m.steps! * tile * seen.length * tile * 4);
        seen.forEach(({ i }, row) => shots.forEach((s, k) => {
          const [cx, cy] = places[k]![2 * i]!, x0 = Math.round(cx - LENS_W / 2), y0 = Math.round(cy - LENS_W / 2);
          for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
            const from = ((y0 + Math.floor(y / ZOOM)) * s.width + x0 + Math.floor(x / ZOOM)) * s.channels, to = ((row * tile + y) * m.steps! * tile + k * tile + x) * 4;
            for (let c = 0; c < 3; c++) sheet[to + c] = s.data[from + c]!;
            sheet[to + 3] = 255;
          }
        }));
        if (seen.length > 0) writeFileSync(join(out, `${m.name}-${tier}${tag}-lenses.png`), encodePng(m.steps! * tile, seen.length * tile, sheet));
        report.push({ name: `${m.name}-${tier}${tag}`, lamp: f, lamps: lampRows, strip: states, console: lines.slice(0, 8) });
        console.log(`${m.name}-${tier}${tag}: ${m.steps} steps; lamps in view ${lampRows.map((r) => `${r.metres} m lens ${r.lensJump.toFixed(3)} pool ${r.poolJump.toFixed(3)}`).join(", ")}; ${JSON.stringify(states.at(-1))}`);
        continue;
      }
      // A few seconds of the page's frames, then its picture.
      const frames = await evaluate(`new Promise((done) => { const list = []; const t0 = performance.now(); const tick = () => { list.push(${STATE}); if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else done(list); }; requestAnimationFrame(tick); })`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const name = `${m.name}-${tier}${tag}`;
      writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
      const steps = await evaluate("snarkTrip.app.governor.steps.slice(-8)");
      const last = frames?.at(-1);
      const lit = frames?.filter((s: { on: boolean }) => s?.on).length ?? 0;
      report.push({ name, lamp: f, frames: frames?.length ?? 0, lit, last, steps, console: lines.slice(0, 8) });
      console.log(`${name}: ${frames?.length ?? 0} frames, the lamp lit in ${lit}; last ${JSON.stringify(last)}; governor ${JSON.stringify(steps)}${lines.length ? `\n  ${lines.slice(0, 8).join("\n  ")}` : ""}`);
    }
  }
  }
} finally {
  browser.kill();
  await browser.exited;
  server.stop();
  rmSync(work, { recursive: true, force: true });
  writeFileSync(join(out, "play.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.exit(0);
