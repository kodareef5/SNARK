// The device probe's page: with ?device=<token>, as tools/device.ts links to it, the page measures this device by itself
// and reports. All of it is client/core/device.ts; here the browser is handed to it.

import { DeviceProbe } from "../core/device.ts";

export function devicePage(token: string): DeviceProbe {
  const box = document.body.appendChild(document.createElement("pre"));
  let lock: WakeLockSentinel | null = null;
  const probe = new DeviceProbe(token, {
    global: globalThis as unknown as Record<string, unknown>,
    id: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join(""),
    dpr: devicePixelRatio,
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    nextFrame: (fn) => void requestAnimationFrame(fn),
    fetch: (path, body) => fetch(`__device/${path}?token=${token}`, body === undefined ? { cache: "no-store" } : { method: "POST", body, headers: { "content-type": "application/json" } }),
    load: () => sessionStorage.getItem("snark.device"),
    save: (text) => sessionStorage.setItem("snark.device", text),
    show: (text, style) => void ((box.style.cssText = style), (box.textContent = text)),
    wake: async () => ((lock = await navigator.wakeLock.request("screen")), "held"),
    rest: () => void lock?.release().catch(() => {}),
    entries: () => [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")] as PerformanceResourceTiming[],
  });
  addEventListener("error", (e) => probe.error(e.message));
  addEventListener("unhandledrejection", (e) => probe.error(String(e.reason)));
  document.addEventListener("visibilitychange", () => probe.visible(!document.hidden));
  addEventListener("pointerdown", () => probe.touched());
  setInterval(() => document.hidden || probe.watch(), 1000);
  return probe;
}
