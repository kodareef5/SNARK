// The device probe: a whole run of a client on the harness, as a phone's page makes it, and the server's routes for it,
// which the internet can reach while a tunnel is up.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { DeviceProbe, deviceScenarios, deviceTable, newReport, type DeviceBrowser, type DeviceReport, type RendererLike } from "../../client/core/device.ts";
import { MAX_RUNS, MAX_WRONG, REPORT_BYTES, deviceRoutes, lacking } from "../../tools/device.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const TIMING = { measureMs: 300, settleMs: 3000, loadMs: 20000 };

/** A browser made of numbers. Its timers never fire, so nothing is waited out. */
function browser(opts: { saved?: string; clock?: () => number; expected?: Record<string, string> } = {}) {
  const posts: DeviceReport[] = [];
  const page = { text: "", whole: false, saved: opts.saved ?? null };
  const b: DeviceBrowser = {
    global: { navigator: { userAgent: "a test", hardwareConcurrency: 6, maxTouchPoints: 5 }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 },
    id: "fedcba9876543210",
    dpr: 3,
    now: opts.clock ?? (() => 0),
    sleep: () => new Promise(() => {}),
    nextFrame: (fn) => queueMicrotask(() => fn((frame += 16.6))),
    fetch: (path, body) => {
      if (body !== undefined) posts.push(JSON.parse(body) as DeviceReport);
      const value = path === "ping" ? true : path === "hashes" ? (opts.expected ?? null) : null;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
    },
    load: () => page.saved,
    save: (text) => void (page.saved = text),
    show: (text, style) => void Object.assign(page, { text, whole: style.includes("inset:0") }),
    wake: () => Promise.resolve("held"),
    rest: () => {},
    entries: () => [{ transferSize: 300000, encodedBodySize: 280000 }, { transferSize: 0, encodedBodySize: 200000 }],
  };
  let frame = 0;
  return { b, posts, page };
}

/** A renderer of a phone that takes textures 2,048 wide at most. It draws nothing, and its canvas is what a test says. */
function renderer() {
  const heard = new Map<string, () => void>();
  const r: RendererLike = {
    gl: {
      getParameter: (n: number) => (n === 0x0d33 ? 2048 : 4),
      getExtension: () => null,
      getSupportedExtensions: () => ["WEBGL_compressed_texture_astc"],
      getShaderPrecisionFormat: () => ({ precision: 23 }),
      getContextAttributes: () => ({ antialias: true }),
      createTexture: () => ({}),
      canvas: { addEventListener: (type: string, fn: () => void) => heard.set(type, fn) },
      drawingBufferWidth: 390,
      drawingBufferHeight: 844,
    },
    rendererName: "a test GPU",
    drawCalls: 50,
    readPixel: () => [0, 0, 0],
  };
  return { r, fire: (type: string) => heard.get(type)!() };
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("a run measures every tier the device can take in every scene, then the first again, and posts after every step", async () => {
  const h = new Harness();
  const pack = corePack();
  const app = new App(h.join("phone", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const expected = Object.fromEntries(deviceScenarios(h.reg, pack).map(([name, run]) => [name, run()]));
  const { b, posts, page } = browser({ clock: () => h.now, expected });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  expect(await probe.before()).toBe(true);
  const { r: gpu } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  const yaw = new Map<string, number>();
  for (let i = 0; i < 300 && !probe.report.done; i++) {
    h.run(100, (now) => {
      const p = app.frame(now, 390, 844);
      if (!p) return;
      // As the page sizes its canvas, from the tier in use.
      const most = app.scene!.assets.tier.pixelRatio;
      const ratio = most > 0 ? Math.min(3, most) : 3;
      [gpu.gl.drawingBufferWidth, gpu.gl.drawingBufferHeight] = [Math.floor(390 * ratio), Math.floor(844 * ratio)];
      probe.frame(now, p, now - 1, now - 0.5);
      yaw.set(probe.report.stage, app.controls.yaw);
    });
  }
  await settle();
  const r = probe.report;
  expect([r.done, r.errors, r.reloadedDuring]).toEqual([true, [], null]);
  // Ultra's textures are 4,096 wide, which this device does not take.
  expect(r.phases.map((p) => `${p.tier} ${p.scene}`)).toEqual(["lowpoly plain", "lowpoly stress", "lowpoly crowd", "medium plain", "medium stress", "medium crowd", "high plain", "high stress", "high crowd"]);
  expect(r.skipped).toEqual(["ultra: its textures are up to 4096 wide, and this device takes 2048"]);
  // Each tier draws as many device pixels to a CSS pixel as it says, and the crowd scene turns round.
  expect(r.phases.map((p) => p.ratio)).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 2, 2, 2]);
  expect(r.phases[3]!.canvas).toEqual([585, 1266]);
  expect([yaw.get("medium crowd"), yaw.get("medium plain")]).toEqual([Math.PI, 0]);
  expect([r.again?.tier, r.again?.scene]).toEqual(["lowpoly", "plain"]);
  for (const p of [...r.phases, r.again!]) expect(p.frames).toBeGreaterThan(10);
  expect(r.hashes!.every((h) => h.got === h.want)).toBe(true);
  expect(r.probes!.length).toBeGreaterThan(0);
  expect([r.load!.pageBytes, r.link.httpMs!.median, r.idleFrameMs, r.wakeLock, r.gpu!.maxTexture, r.device!.touch]).toEqual([500000, 0, 16.6, "held", 2048, 5]);
  // Every post is newer than the one before, the last says it is done, and the page keeps it.
  expect(posts.every((p, i) => i === 0 || p.seq > posts[i - 1]!.seq)).toBe(true);
  expect(posts.at(-1)!.done).toBe(true);
  expect(JSON.parse(page.saved!).report.done).toBe(true);
  expect(page.whole).toBe(true);
  expect(page.text.startsWith("Done. Sent. You can close this page.")).toBe(true);
  expect(page.text).toContain("tiers run lowpoly, medium, high");
  // The browser made of numbers draws nothing, so the probes of the picture are wrong.
  expect(lacking(r).filter((line) => !line.startsWith("probe "))).toEqual(["tier ultra did not run every scene"]);
});

test("a page the browser reloads in the middle of a run shows and sends what it had, and does not run again", async () => {
  const saved = JSON.stringify({ token: TOKEN, report: { ...newReport("0011223344556677"), seq: 7, stage: "medium stress" } });
  const { b, posts, page } = browser({ saved });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  expect(await probe.before()).toBe(false);
  await settle();
  expect([probe.report.run, probe.report.reloadedDuring, posts.length, posts[0]!.seq, posts[0]!.done]).toEqual(["0011223344556677", "medium stress", 1, 8, true]);
  expect(page.text.startsWith("Stopped early. Sent.")).toBe(true);
  // A run of another server's page, or one that finished, is not taken up.
  expect(await new DeviceProbe("another".padEnd(32, "0"), browser({ saved }).b, TIMING).before()).toBe(true);
  const finished = JSON.stringify({ token: TOKEN, report: { ...newReport("0011223344556677"), done: true } });
  expect(await new DeviceProbe(TOKEN, browser({ saved: finished }).b, TIMING).before()).toBe(true);
});

test("a run whose frames stop ends, saying why, and one whose game never starts ends too", async () => {
  const h = new Harness();
  const pack = corePack();
  const app = new App(h.join("phone", {}, { manual: true }), h.reg, pack);
  let clock = 0;
  const { b, posts } = browser({ clock: () => clock });
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

  const never = browser({ clock: () => clock });
  const idle = new DeviceProbe(TOKEN, never.b, TIMING);
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
  const { routes } = deviceRoutes({ dir, token: TOKEN, code: "bqzk", password: "secret", expected: { sim: "abc" }, say: (line) => said.push(line), done: (_, file) => done.push(file) });
  const ask = async (path: string, init: RequestInit = {}): Promise<Response | null> => {
    const req = new Request(`http://127.0.0.1${path}`, init);
    return (await routes(req, new URL(req.url))) ?? null;
  };
  return { ask, said, done };
}

const post = (report: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(report) });

test("the probe's routes need the token, and the short path leads to the page with the token and the password until it is guessed at too often", async () => {
  const { ask, said } = server();
  expect(await ask("/main.js")).toBeNull();
  expect(await ask("/ws")).toBeNull();
  expect((await ask("/main.js.map"))!.status).toBe(404);
  expect(said).toEqual(["a browser fetched the page's script", "a page opened the game's socket"]);
  for (const path of ["/__device/ping", `/__device/ping?token=${TOKEN.slice(1)}`, `/__device/ping?token=${"é".repeat(32)}`, `/__device/hashes?token=${TOKEN.toUpperCase()}`]) expect((await ask(path))!.status).toBe(404);
  expect(await (await ask(`/__device/ping?token=${TOKEN}`))!.json()).toBe(true);
  expect(await (await ask(`/__device/hashes?token=${TOKEN}`))!.json()).toEqual({ sim: "abc" });
  const to = await ask("/d/bqzk");
  expect([to!.status, to!.headers.get("location")]).toEqual([302, `/?device=${TOKEN}&password=secret`]);
  for (let i = 0; i < MAX_WRONG; i++) expect((await ask(`/d/x${i}`))!.status).toBe(404);
  expect((await ask("/d/bqzk"))!.status).toBe(404);
});

test("a report is kept in its folder under a name of the server's making, newer over older, and what is too large, malformed or too many is refused", async () => {
  const { ask, done } = server();
  const report = { ...newReport("aaaaaaaaaaaaaaaa"), seq: 2, stage: "medium plain" };
  const path = `/__device/report?token=${TOKEN}`;
  expect((await ask(path, post(report)))!.status).toBe(200);
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
