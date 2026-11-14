// The device probe's page: with ?device=<token>, as tools/device.ts links to it, the page measures this device by itself
// and reports. All of it is client/core/device.ts; here the browser is handed to it.

import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { App } from "../core/app.ts";
import { DeviceProbe } from "../core/device.ts";
import type { FramePacket } from "../core/render/packet.ts";
import type { GlRenderer } from "./gl.ts";

const BAR = "position:fixed;left:0;right:0;bottom:0;margin:0;padding:6px 8px;background:rgba(0,0,0,.55);color:#eee;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:10;pointer-events:none";
const PAGE = "position:fixed;inset:0;margin:0;padding:12px;background:#111;color:#eee;font:11px ui-monospace,Menlo,monospace;white-space:pre;overflow:auto;z-index:10";

export function devicePage(token: string): { probe: DeviceProbe; attach(app: App, renderer: GlRenderer, pack: Pack, reg: Registry, hf: Heightfield): void; frame(now: number, packet: FramePacket, t0: number, built: number): void } {
  const box = document.body.appendChild(document.createElement("pre"));
  const ask = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`__device/${path}?token=${token}`, { cache: "no-store", ...init });
  let lock: WakeLockSentinel | null = null;
  let renderer: GlRenderer | null = null;
  const probe = new DeviceProbe(token, {
    global: globalThis as unknown as Record<string, unknown>,
    id: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join(""),
    dpr: devicePixelRatio,
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    frames: (n) => new Promise((done) => {
      const at: number[] = [];
      const step = (t: number): void => void (at.push(t) < n ? requestAnimationFrame(step) : done(at));
      requestAnimationFrame(step);
    }),
    ask: (path) => ask(path).then((res) => (res.ok ? res.json() : null) as Promise<unknown>),
    send: (body) => ask("report", { method: "POST", body, headers: { "content-type": "application/json" } }).then((res) => res.status),
    load: () => sessionStorage.getItem("snark.device"),
    save: (text) => sessionStorage.setItem("snark.device", text),
    show: (text, whole) => void ((box.style.cssText = whole ? PAGE : BAR), (box.textContent = text)),
    wake: async () => ((lock = await navigator.wakeLock.request("screen")), "held"),
    rest: () => void lock?.release().catch(() => {}),
    pageBytes: () => [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")].reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || (e as PerformanceResourceTiming).encodedBodySize || 0), 0),
  });
  addEventListener("error", (e) => probe.error(e.message));
  addEventListener("unhandledrejection", (e) => probe.error(String(e.reason)));
  document.addEventListener("visibilitychange", () => probe.visible(!document.hidden));
  addEventListener("pointerdown", () => probe.touched());
  setInterval(() => document.hidden || probe.watch(), 1000);
  return {
    probe,
    // After the shell's own listeners for a lost context, so a restored context's textures are made before counting resumes.
    attach(app, gr, pack, reg, hf) {
      renderer = gr;
      const gl = gr.gl;
      const create = gl.createTexture.bind(gl);
      gl.createTexture = () => (probe.textureMade(), create());
      (gl.canvas as HTMLCanvasElement).addEventListener("webglcontextlost", () => probe.lost());
      (gl.canvas as HTMLCanvasElement).addEventListener("webglcontextrestored", () => probe.restored());
      probe.attach({ app, pack, reg, hf }, gl, gr.rendererName);
    },
    frame(now, packet, t0, built) {
      const r = renderer!;
      probe.frame(now, packet, built - t0, performance.now() - built, r.drawCalls, [r.gl.drawingBufferWidth, r.gl.drawingBufferHeight], (x, y) => r.readPixel(x, y));
    },
  };
}
