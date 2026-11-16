// The device probe's page on the harness, for tests/integration/device*.test.ts: a browser and a phone's GPU made of
// numbers, a whole client the probe watches, and a run of virtual time until the probe says it is done.

import { App } from "../../client/core/app.ts";
import { deviceScenarios, type DeviceBrowser, type DeviceProbe, type DeviceReport, type RendererLike, type Timing } from "../../client/core/device.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { fakeGl } from "./gl.ts";
import { Harness } from "./net.ts";
import { corePack } from "./pack.ts";

export const TOKEN = "0123456789abcdef0123456789abcdef";
export const TIMING: Timing = { measureMs: 300, rungMs: 100, settleMs: 3000, loadMs: 20000, soakMs: 2000, holdMs: 100, flightMs: 2000, teleportMs: 500, turnMs: 200 };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1";

/** A browser made of numbers. Its timers never fire, so nothing is waited out. `frameMs` is the display's interval. */
export function browser(opts: { saved?: string; clock?: () => number; expected?: Record<string, string>; mode?: string; tests?: string; frameMs?: number; stand?: (k: number) => number[] | null; layers?: (path: string) => unknown } = {}) {
  const posts: DeviceReport[] = [];
  const asked: number[] = [];
  const boxed: number[] = [];
  const page = { text: "", whole: false, saved: opts.saved ?? null };
  let frame = 0;
  const b: DeviceBrowser = {
    global: { navigator: { userAgent: UA, hardwareConcurrency: 6, maxTouchPoints: 5 }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 },
    id: "fedcba9876543210",
    dpr: 3,
    query: (name) => (name === "mode" ? (opts.mode ?? null) : name === "tests" ? (opts.tests ?? null) : null),
    now: opts.clock ?? (() => 0),
    sleep: () => new Promise(() => {}),
    nextFrame: (fn) => queueMicrotask(() => fn((frame += opts.frameMs ?? 16.6))),
    fetch: (path, body) => {
      if (path === "report") posts.push(JSON.parse(body!) as DeviceReport);
      if (path.startsWith("base/")) asked.push(Number(path.slice(5)));
      if (path.startsWith("box/")) boxed.push(Number(path.slice(4)));
      const value = path === "ping" ? true : path === "hashes" ? (opts.expected ?? null) : path === "report" ? { skipped: 3 + posts.length, overflows: 1 } : path.startsWith("stand/") ? (opts.stand?.(Number(path.slice(6))) ?? null) : path.startsWith("layers/") ? (opts.layers?.(path) ?? null) : { pieces: Number(path.split("/")[1]) };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
    },
    load: () => page.saved,
    save: (text) => void (page.saved = text),
    show: (text, style) => void Object.assign(page, { text, whole: style.includes("inset:0") }),
    wake: () => Promise.resolve("held"),
    rest: () => {},
    entries: () => [{ transferSize: 300000, encodedBodySize: 280000 }, { transferSize: 0, encodedBodySize: 200000 }],
  };
  return { b, posts, page, asked, boxed };
}

/**
 * A renderer of a phone that takes textures 2,048 wide at most and `room` megabytes of them. It draws nothing, and its
 * canvas is what a test says. `spent` is the time its draws would take a GPU, 0.1 ms each, for a page's clock to add;
 * its executor spends as long on each draw and caster of a packet, and `kinds` lists the flags of the draws it was given.
 */
export function renderer(room = 300) {
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
  const kinds = new Set<number>();
  const r: RendererLike = {
    gl,
    rendererName: "a test GPU",
    format: "astc",
    drawCalls: 50,
    readPixel: () => [0, 0, 0],
    draw: (p) => {
      for (let d = 0; d < p.drawCount; d++) kinds.add(p.drawFlags[d]!);
      spent += 0.1 * (p.drawCount + p.casterCount);
    },
  };
  return { r, gl, fire: (type: string) => heard.get(type)!(), tiles: () => tiles, spent: () => spent, kinds };
}

export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export interface Driven {
  /** After each frame the probe saw. */
  each?: (now: number) => void;
  /** May change a frame's packet before the probe sees it. */
  tamper?: (p: FramePacket) => void;
  /** The page's clock from the harness's, for a test that stalls it. */
  clock?: (now: number) => number;
}

/** A whole client on the harness with a probe on it, run until the probe says it is done, or `ms` of virtual time. */
export async function run(probe: DeviceProbe, h: Harness, app: App, gpu: RendererLike, ms = 30000, o: Driven = {}): Promise<void> {
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

/** The hashes the server expects of each scenario: the same for every client of the core content and pack, so made once. */
let hashes: Record<string, string> | null = null;

export function client() {
  const h = new Harness();
  const pack = corePack();
  const app = new App(h.join("phone", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  hashes ??= Object.fromEntries(deviceScenarios(h.reg, pack).map(([name, f]) => [name, f()]));
  return { h, pack, app, expected: { ...hashes } };
}
