// The device probe: whole runs of a client on the harness, as a phone's page makes them, and the server's routes for it,
// which the internet can reach while a tunnel is up.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { DeviceProbe, MEMORY_MB, deviceScenarios, newReport, type DeviceBrowser, type DeviceReport, type RendererLike, type Timing } from "../../client/core/device.ts";
import { deviceTable } from "../../client/core/devicetext.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { MAX_RUNS, MAX_WRONG, REPORT_BYTES, deviceRoutes, lacking } from "../../tools/device.ts";
import { fakeGl } from "../fixtures/gl.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const TIMING: Timing = { measureMs: 300, rungMs: 100, settleMs: 3000, loadMs: 20000, soakMs: 2000, holdMs: 100 };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1";

/** A browser made of numbers. Its timers never fire, so nothing is waited out. `frameMs` is the display's interval. */
function browser(opts: { saved?: string; clock?: () => number; expected?: Record<string, string>; mode?: string; frameMs?: number } = {}) {
  const posts: DeviceReport[] = [];
  const asked: number[] = [];
  const page = { text: "", whole: false, saved: opts.saved ?? null };
  let frame = 0;
  const b: DeviceBrowser = {
    global: { navigator: { userAgent: UA, hardwareConcurrency: 6, maxTouchPoints: 5 }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 },
    id: "fedcba9876543210",
    dpr: 3,
    query: (name) => (name === "mode" ? (opts.mode ?? null) : null),
    now: opts.clock ?? (() => 0),
    sleep: () => new Promise(() => {}),
    nextFrame: (fn) => queueMicrotask(() => fn((frame += opts.frameMs ?? 16.6))),
    fetch: (path, body) => {
      if (path === "report") posts.push(JSON.parse(body!) as DeviceReport);
      if (path.startsWith("base/")) asked.push(Number(path.slice(5)));
      const value = path === "ping" ? true : path === "hashes" ? (opts.expected ?? null) : path === "report" ? { skipped: 3 + posts.length, overflows: 1 } : { pieces: asked.at(-1) };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
    },
    load: () => page.saved,
    save: (text) => void (page.saved = text),
    show: (text, style) => void Object.assign(page, { text, whole: style.includes("inset:0") }),
    wake: () => Promise.resolve("held"),
    rest: () => {},
    entries: () => [{ transferSize: 300000, encodedBodySize: 280000 }, { transferSize: 0, encodedBodySize: 200000 }],
  };
  return { b, posts, page, asked };
}

/**
 * A renderer of a phone that takes textures 2,048 wide at most and `room` megabytes of them. It draws nothing, and its
 * canvas is what a test says. `spent` is the time its draws would take a GPU, 0.1 ms each, for a page's clock to add.
 */
function renderer(room = 300) {
  const heard = new Map<string, () => void>();
  let [tiles, error, spent] = [0, 0, 0];
  const gl = fakeGl({
    params: { 0x0d33: 2048 },
    drawn: () => void (spent += 0.1),
    with: {
      getSupportedExtensions: () => ["WEBGL_compressed_texture_astc"],
      deleteTexture: () => void tiles--,
      texStorage2D: () => void (++tiles > room && (error = 0x0505)),
      getError: () => [error, (error = 0)][0]!,
      canvas: { addEventListener: (type: string, fn: () => void) => heard.set(type, fn) },
    },
  });
  const r: RendererLike = {
    gl,
    rendererName: "a test GPU",
    format: "astc",
    drawCalls: 50,
    readPixel: () => [0, 0, 0],
  };
  return { r, gl, fire: (type: string) => heard.get(type)!(), tiles: () => tiles, spent: () => spent };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Driven {
  /** After each frame the probe saw. */
  each?: (now: number) => void;
  /** May change a frame's packet before the probe sees it. */
  tamper?: (p: FramePacket) => void;
  /** The page's clock from the harness's, for a test that stalls it. */
  clock?: (now: number) => number;
}

/** A whole client on the harness with a probe on it, run until the probe says it is done, or `ms` of virtual time. */
async function run(probe: DeviceProbe, h: Harness, app: App, gpu: RendererLike, ms = 30000, o: Driven = {}): Promise<void> {
  for (let t = 0; t < ms && !probe.report.done; t += 100) {
    h.run(100, (harness) => {
      const now = o.clock?.(harness) ?? harness;
      const p = app.frame(harness, 390, 844);
      if (!p) return;
      // As the page sizes its canvas, from the tier in use.
      const most = app.scene!.assets.tier.pixelRatio;
      const ratio = most > 0 ? Math.min(3, most) : 3;
      [gpu.gl.drawingBufferWidth, gpu.gl.drawingBufferHeight] = [Math.floor(390 * ratio), Math.floor(844 * ratio)];
      o.tamper?.(p);
      probe.frame(now, p, now - 1, now - 0.5);
      o.each?.(now);
    });
    await settle();
  }
  await settle();
}

function client() {
  const h = new Harness();
  const pack = corePack();
  const app = new App(h.join("phone", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  return { h, pack, app, expected: Object.fromEntries(deviceScenarios(h.reg, pack).map(([name, f]) => [name, f()])) };
}

test("a page shows which device it is on and the tests, starts nothing until one is tapped, then runs the quick look and posts after every step", async () => {
  const { h, pack, app, expected } = client();
  const card = renderer();
  const { b, posts, page } = browser({ clock: () => h.now + card.spent(), expected });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  const going = probe.before();
  await settle();
  expect(page.whole).toBe(true);
  expect(page.text).toContain("This looks like <b>an iPhone, Chrome for iOS 157 (WebKit, as every iOS browser), iOS 27.2, 390 by 844 at 3x</b>");
  expect(page.text).toContain('data-mode="ladder"');
  expect(posts.length).toBe(0);
  probe.start("quick");
  expect(await going).toBe(true);
  const gpu = card.r;
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  const yaw = new Map<string, number>();
  const split = new Map<string, number>();
  const each = (): void => void (yaw.set(probe.report.stage, app.controls.yaw), split.set(probe.report.stage, app.scene!.packet.split));
  await run(probe, h, app, gpu, 60000, { each });
  const r = probe.report;
  expect([r.mode, r.done, r.errors, r.reloadedDuring]).toEqual(["quick", true, [], null]);
  expect(r.phases.map((p) => `${p.tier} ${p.scene}`)).toEqual(["lowpoly plain", "lowpoly stress", "lowpoly crowd", "medium plain", "medium stress", "medium crowd", "medium crowd1", "high plain", "high stress", "high crowd", "high crowd1"]);
  expect(r.skipped).toEqual(["ultra: its textures are up to 4096 wide, and this device takes 2048"]);
  expect(r.phases.map((p) => p.ratio)).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 1.5, 2, 2, 2, 2]);
  expect(r.phases[3]!.canvas).toEqual([585, 1266]);
  expect([yaw.get("medium crowd"), yaw.get("medium plain"), yaw.get("medium crowd1")]).toEqual([Math.PI, 0, Math.PI]);
  // The crowd on medium in its two depth ranges and then in one; the next tier has its split again.
  expect([split.get("medium crowd"), split.get("medium crowd1"), split.get("high plain")]).toEqual([384, 0, 384]);
  expect(deviceTable(r).some((line) => line.startsWith("ranges    medium, two against one in the crowd: frames "))).toBe(true);
  // The GPU questions were asked first, and each answered on the harness's context.
  const q = r.gpuTests!;
  expect([q.lostDuring, q.passes.filter((p) => p.note !== "").length, typeof q.seam]).toEqual([null, 0, "object"]);
  expect([r.again?.tier, r.again?.scene]).toEqual(["lowpoly", "plain"]);
  expect(r.hashes!.every((x) => x.got === x.want)).toBe(true);
  expect([r.load!.pageBytes, r.link.httpMs!.median, r.idleFrameMs, r.wakeLock, r.gpu!.maxTexture, r.gpu!.variant, r.device!.touch]).toEqual([500000, 0, 16.6, "held", 2048, "astc", 5]);
  // Counted from the first snapshot, nothing is missed on the harness; the server's counts are this run's own.
  expect([r.link.missed, r.link.missedLoading, r.link.missedHidden, r.link.snapshots > 0]).toEqual([0, 0, 0, true]);
  expect(r.link.server).toEqual({ skipped: posts.length - 1, overflows: 0 });
  expect(posts.every((p, i) => i === 0 || p.seq > posts[i - 1]!.seq)).toBe(true);
  expect(posts.at(-1)!.done).toBe(true);
  expect(page.text.startsWith("<div")).toBe(true);
  expect(page.text).toContain("Done.</b> Sent.");
  expect(page.text).toContain("tiers run lowpoly, medium, high");
  expect(lacking(r).filter((line) => !line.startsWith("probe "))).toEqual(["tier ultra did not run every scene"]);
  expect(card.gl.invalid).toEqual([]);

  // Another test on the same page begins at once, with the game as it is, under a run of its own.
  probe.start("soak");
  expect([probe.report.mode, probe.report.run, probe.report.done, probe.report.device?.touch]).toEqual(["soak", "fedcba9876543201", false, 5]);
  await run(probe, h, app, gpu, 30000);
  const s = probe.report.soak!;
  expect([probe.report.done, probe.report.errors, s.tier, s.from, s.minutes.length]).toEqual([true, [], "high", "defaults", 1]);
  expect(s.minutes[0]!.frames).toBeGreaterThan(100);
  expect(deviceTable(probe.report).some((line) => line.startsWith("soak      high: 200 bodies, 1024 pieces"))).toBe(true);
});

test("the ladder climbs until a rung breaks, asks the server for the base, and ends taking texture memory until the device refuses it", async () => {
  const { h, pack, app, expected } = client();
  // A display twice as fast as the harness draws: no rung holds its rate, so each axis stops at its first.
  const { b, asked } = browser({ clock: () => h.now, expected, mode: "ladder", frameMs: 8.3 });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  expect(await probe.before()).toBe(true);
  const card = renderer(300);
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  await run(probe, h, app, card.r, 60000);
  const r = probe.report;
  expect([r.mode, r.done, r.errors]).toEqual(["ladder", true, []]);
  const l = r.ladder!;
  expect(l.display).toBe(8.3);
  expect(l.rungs.map((g) => `${g.tier} ${g.axis} ${g.n} ${g.held}`)).toEqual(["lowpoly", "medium", "high"].flatMap((t) => [`${t} bodies 25 false`, `${t} triangles 8 false`, `${t} draws 256 false`, `${t} pieces 64 false`]));
  // The harness frames take its 16.7 ms while our code takes 1.5, so the GPU is said to have taken the frame.
  expect(l.rungs.every((g) => g.limit === "the GPU")).toBe(true);
  // The base was asked for on each tier's pieces rung, and let go after.
  expect(asked).toEqual([64, 0, 64, 0, 64, 0]);
  // Every amount was sampled and read back as the colour its blocks decode to; the harness's frames are slow for a display this fast.
  const rung = { frameMs: 16.7, p95: 16.7, worst: 16.7, oursMs: 0, held: false };
  expect(l.memory).toEqual({ variant: "astc", gameMB: 0, heldMB: 256, failedMB: 512, slowMB: 128, how: "out of memory", rungs: [{ mb: 128, ...rung }, { mb: 256, ...rung }] });
  expect(card.tiles()).toBe(0);
  expect(MEMORY_MB[2]).toBe(512);
  // The probe binds its textures only on units the renderer leaves free.
  expect([...card.gl.boundOn].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const table = deviceTable(r);
  expect(table).toContain("memory    256 MB of astc textures held and sampled besides the game's 0 MB; frames first fell behind the display's rate at 128 MB; frames 128 MB 16.7! ms, 256 MB 16.7! ms; at 512 MB: out of memory");
  expect(table.some((line) => line.startsWith("broke     medium bodies 25: frames 16.7 ms"))).toBe(true);
});

test("the soak counts a long frame while the page is shown as a stall, and leaves out only the time the page was hidden", async () => {
  const { h, pack, app, expected } = client();
  let offset = 0;
  const { b } = browser({ clock: () => h.now + offset, expected, mode: "soak" });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, soakMs: 5000 });
  await probe.before();
  const { r: gpu } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  let frames = 0;
  const each = (): void => {
    if (probe.report.stage !== "soak") return;
    // Hidden for 5 s, then shown; later a stall of 2.5 s with the page shown all the while.
    if (++frames === 60) {
      probe.visible(false);
      offset += 5000;
      probe.visible(true);
    }
    if (frames === 120) offset += 2500;
  };
  await run(probe, h, app, gpu, 60000, { each, clock: (now) => now + offset });
  const s = probe.report.soak!;
  expect([probe.report.done, probe.report.errors, s.hidden, s.hiddenMs, s.minutes.length]).toEqual([true, [], 1, 5000, 1]);
  const m = s.minutes[0]!;
  expect(m.frameMs.worst).toBeGreaterThanOrEqual(2500);
  expect(m.frameMs.worst).toBeLessThan(3000);
  expect(m.long).toBe(1);
  // The stall took its share of the soak's 5 s, so fewer frames were drawn in it; the hidden 5 s took none.
  expect(m.frames).toBeGreaterThan((5000 - 2600) / 16.7 - 2);
  expect(m.frames).toBeLessThan((5000 - 2400) / 16.7 + 2);
  expect(deviceTable(probe.report).some((line) => /^1 +\d+ +16\.7 +16\.7 +16\.7 +25\d\d\.\d +[\d.]+ +[\d.]+ +\d+ +1 +0$/.test(line))).toBe(true);
});

test("a rung that did not draw all it was given, or never settled, is invalid: neither held nor broke, and not counted as held", async () => {
  const { h, pack, app, expected } = client();
  // A display the harness keeps up with, so every rung would hold on its frames alone.
  const { b } = browser({ clock: () => h.now, expected, mode: "ladder" });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, settleMs: 300 });
  await probe.before();
  const card = renderer(300);
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  // Ten draws skipped and ten things dropped every frame, as an outside review did.
  await run(probe, h, app, card.r, 60000, { tamper: (p) => void ((p.skipped += 10), (p.dropped += 10)) });
  const r = probe.report;
  expect([r.done, r.errors]).toEqual([true, []]);
  const rungs = r.ladder!.rungs;
  expect(rungs.map((g) => `${g.tier} ${g.axis} ${g.n}`)).toEqual(["lowpoly", "medium", "high"].flatMap((t) => [`${t} bodies 25`, `${t} triangles 8`, `${t} draws 256`, `${t} pieces 64`]));
  for (const g of rungs) {
    expect([g.held, g.limit, g.settled]).toEqual([false, "", false]);
    expect(g.invalid).toMatch(/^\d+ things dropped, \d+ draws skipped, never settled$/);
  }
  const table = deviceTable(r);
  expect(table).toContain("lowpoly  none; 25 invalid         none; 8 invalid          none; 256 invalid        none; 64 invalid");
  expect(table.some((line) => line.startsWith("most held 0 bodies, 0 pieces, 0 triangles, 0 draws"))).toBe(true);
  expect(table.some((line) => line.startsWith("invalid   medium bodies 25: ") && line.includes("draws skipped, never settled"))).toBe(true);
  expect(table.some((line) => line.startsWith("broke "))).toBe(false);
});

test("a page the browser reloads in the middle of a run shows and sends what it had, and runs again only when a test is tapped", async () => {
  const ladder = { display: 16.7, rungs: [], memory: { variant: "astc", gameMB: 40, heldMB: 1024, failedMB: null, slowMB: null, how: "", rungs: [{ mb: 1024, frameMs: 17, p95: 18, worst: 20, oursMs: 0.3, held: true }] } };
  const saved = JSON.stringify({ token: TOKEN, report: { ...newReport("0011223344556677", "ladder"), seq: 7, stage: "memory 1536 MB", ladder } });
  const { b, posts, page } = browser({ saved });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  const going = probe.before();
  await settle();
  expect([probe.report.run, probe.report.reloadedDuring, posts.length, posts[0]!.seq, posts[0]!.done]).toEqual(["0011223344556677", "memory 1536 MB", 1, 8, true]);
  expect(page.text).toContain("Stopped early.</b> Sent.");
  expect(page.text).toContain("memory    1024 MB of astc textures held and sampled besides the game&#39;s 40 MB; every amount kept the display&#39;s rate; frames 1024 MB 17 ms; the page was reloaded while it took 1536 MB of textures: the browser dropped the tab");
  probe.start("quick");
  expect(await going).toBe(true);
  expect([probe.report.run, probe.report.mode, probe.report.reloadedDuring, probe.report.done]).toEqual(["fedcba9876543201", "quick", null, false]);
  // A run of another server's page, or one that finished, is not taken up.
  const other = new DeviceProbe("another".padEnd(32, "0"), browser({ saved, mode: "quick" }).b, TIMING);
  expect([await other.before(), other.report.reloadedDuring]).toEqual([true, null]);
});

test("a run whose frames stop ends, saying why, and one whose game never starts ends too", async () => {
  const { h, pack, app } = client();
  let clock = 0;
  const { b, posts } = browser({ clock: () => clock, mode: "quick" });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  await probe.before();
  const { r: gpu, fire } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  h.run(1000, (now) => {
    clock = now;
    const p = app.frame(now, 390, 844);
    if (p) probe.frame(now, p, now - 1, now - 0.5);
  });
  // A texture the renderer makes counts, except while a lost context is made again.
  gpu.gl.createTexture();
  fire("webglcontextlost");
  gpu.gl.createTexture();
  fire("webglcontextrestored");
  gpu.gl.createTexture();
  expect(probe.report.texturesMade).toBe(2);
  probe.watch();
  expect(probe.report.done).toBe(false);
  // Hidden, the frames' stopping does not count from before the page was shown again.
  probe.visible(false);
  clock += 60000;
  probe.visible(true);
  probe.watch();
  expect(probe.report.done).toBe(false);
  clock += 16000;
  probe.watch();
  await settle();
  expect(probe.report.done).toBe(true);
  expect(probe.report.errors[0]).toMatch(/^[a-z ]+: the frames stopped for 16 s: /);
  expect(posts.at(-1)!.done).toBe(true);

  const idle = new DeviceProbe(TOKEN, browser({ clock: () => clock, mode: "quick" }).b, TIMING);
  await idle.before();
  clock += TIMING.loadMs + 1;
  idle.watch();
  expect(idle.report.errors).toEqual(["loading: the game did not start"]);
});

const dir = mkdtempSync(join(tmpdir(), "snark-device-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function server() {
  const said: string[] = [];
  const done: string[] = [];
  const bases: number[] = [];
  const { routes } = deviceRoutes({ dir, token: TOKEN, code: "bqzk", password: "secret", expected: { sim: "abc" }, say: (line) => said.push(line), done: (_, file) => done.push(file), base: (n) => (bases.push(n), Math.min(n, 1000)), held: () => ({ skipped: 7, overflows: 2 }) });
  const ask = async (path: string, init: RequestInit = {}): Promise<Response | null> => {
    const req = new Request(`http://127.0.0.1${path}`, init);
    return (await routes(req, new URL(req.url))) ?? null;
  };
  return { ask, said, done, bases };
}

const post = (report: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(report) });

test("the probe's routes need the token, the short path leads to the page until it is guessed at too often, and a page may only size the base", async () => {
  const { ask, said, bases } = server();
  expect(await ask("/main.js")).toBeNull();
  expect(await ask("/ws")).toBeNull();
  expect((await ask("/main.js.map"))!.status).toBe(404);
  expect(said).toEqual(["a browser fetched the page's script", "a page opened the game's socket"]);
  for (const path of ["/__device/ping", `/__device/ping?token=${TOKEN.slice(1)}`, `/__device/ping?token=${"é".repeat(32)}`, `/__device/hashes?token=${TOKEN.toUpperCase()}`, "/__device/base/64"]) expect((await ask(path, { method: "POST" }))!.status).toBe(404);
  expect(await (await ask(`/__device/ping?token=${TOKEN}`))!.json()).toBe(true);
  expect(await (await ask(`/__device/hashes?token=${TOKEN}`))!.json()).toEqual({ sim: "abc" });
  expect(await (await ask(`/__device/base/64?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ pieces: 64 });
  expect(await (await ask(`/__device/base/4096?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ pieces: 1000 });
  for (const path of ["/__device/base/4097", "/__device/base/-1", "/__device/base/12345678", "/__device/base/1e3"]) expect((await ask(`${path}?token=${TOKEN}`, { method: "POST" }))!.status).toBe(path.endsWith("4097") ? 400 : 404);
  expect((await ask(`/__device/base/64?token=${TOKEN}`))!.status).toBe(404);
  expect(bases).toEqual([64, 4096]);
  const to = await ask("/d/bqzk");
  expect([to!.status, to!.headers.get("location")]).toEqual([302, `/?device=${TOKEN}&password=secret`]);
  for (let i = 0; i < MAX_WRONG; i++) expect((await ask(`/d/x${i}`))!.status).toBe(404);
  expect((await ask("/d/bqzk"))!.status).toBe(404);
});

test("a report is kept in its folder under a name of the server's making, newer over older, and what is too large, malformed or too many is refused", async () => {
  const { ask, done } = server();
  const report = { ...newReport("aaaaaaaaaaaaaaaa"), seq: 2, stage: "medium plain" };
  const path = `/__device/report?token=${TOKEN}`;
  const first = await ask(path, post(report));
  expect([first!.status, await first!.json()]).toEqual([200, { skipped: 7, overflows: 2 }]);
  expect((await ask(path, post({ ...report, seq: 1, stage: "loading" })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, seq: 3, done: true })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, seq: 4, done: true })))!.status).toBe(200);
  const files = readdirSync(dir);
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d-]+Z-aaaaaaaaaaaaaaaa\.json$/);
  expect(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).seq).toBe(4);
  expect(done.length).toBe(1);
  expect((await ask(`/__device/report?token=${TOKEN}`, { method: "GET" }))!.status).toBe(404);
  for (const bad of ["not json", JSON.stringify({ ...report, run: "../../escape" }), JSON.stringify({ ...report, run: "AAAAAAAAAAAAAAAA" }), JSON.stringify([1]), JSON.stringify({ run: "bbbbbbbbbbbbbbbb" })]) expect((await ask(path, { method: "POST", body: bad }))!.status).toBe(400);
  // Too large, whether it says so or not.
  const big = JSON.stringify({ ...report, run: "cccccccccccccccc", errors: ["x".repeat(REPORT_BYTES)] });
  expect((await ask(path, { method: "POST", body: big }))!.status).toBe(413);
  const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new TextEncoder().encode(big)), c.close()) });
  expect((await ask(path, { method: "POST", body: stream, duplex: "half" } as RequestInit))!.status).toBe(413);
  for (let i = 1; i < MAX_RUNS; i++) expect((await ask(path, post({ ...report, run: i.toString(16).padStart(16, "d") })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, run: "eeeeeeeeeeeeeeee" })))!.status).toBe(429);
  expect(readdirSync(dir).length).toBe(MAX_RUNS);
  expect(existsSync(join(dir, "..", "escape"))).toBe(false);
});

test("a report's table holds no control characters once cleaned, so a hostile one cannot drive the terminal", () => {
  const r = { ...newReport("0123456789abcdef"), stage: "\u001b[2J\u001b]0;owned\u0007" };
  const lines = deviceTable(r);
  expect(lines[0]).toContain("\u001b");
  expect(lines.map((l) => l.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")).join("")).not.toMatch(/[\u0000-\u001f]/);
});
