// Browser entry point. Each frame it asks the app what to draw, and hands the world to WebGL and the interface to the DOM binder.

import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { PROVING_ID, buildProvingHeightfield, provingMapHash, provingNodes } from "../../shared/world/proving.ts";
import { App } from "../core/app.ts";
import { probePasses, provingProbes } from "../core/selfcheck.ts";
import { ClientSession } from "../core/session.ts";
import { GlRenderer } from "./gl.ts";
import { bindInput } from "./input.ts";
import { connect } from "./socket.ts";
import { VoiceIo } from "../voice/voice.ts";
import { UiView } from "./ui.ts";

const params = new URLSearchParams(location.search);
const selfcheck = params.has("selfcheck");
/** A measurement run. The camera flies itself and the page reports frame times. */
const bench = params.has("bench");
const BENCH_FRAMES = 900;
const root = document.querySelector<HTMLElement>("#ui")!;

/** Made once and kept in local storage. The key owns a survivor's name. */
function deviceKey(): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  try {
    const saved = localStorage.getItem("snark.key");
    if (saved && saved.length === KEY_BYTES * 2) {
      for (let i = 0; i < KEY_BYTES; i++) key[i] = parseInt(saved.slice(i * 2, i * 2 + 2), 16);
      return key;
    }
  } catch {}
  crypto.getRandomValues(key);
  try {
    localStorage.setItem("snark.key", Array.from(key, (b) => b.toString(16).padStart(2, "0")).join(""));
  } catch {}
  return key;
}

async function boot(): Promise<void> {
  const reg = compileContent(CORE_CONTENT).registry!;
  const pack = parsePack(new Uint8Array(await (await fetch("assets/core.snpk")).arrayBuffer()));
  const hf = buildProvingHeightfield();
  const mapHash = provingMapHash(hf);
  const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
  const renderer = new GlRenderer(canvas, pack, hf);
  const session = new ClientSession(connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`), {
    name: params.get("name") ?? `survivor${Math.floor(performance.now() * 1000) % 100000}`,
    key: deviceKey(),
    spectate: params.has("spectate"),
    password: params.get("password") ?? "",
    registry: reg,
    clipHash: pack.clips.hash,
    // The self-check, the bench and ?quick skip the creator.
    ...(selfcheck || bench || params.has("quick") ? { look: defaultLook() } : {}),
    resolveMap: (id, hash) => (id === PROVING_ID && hash === mapHash ? hf : null),
    nodes: provingNodes,
  });
  const app = new App(session, reg, pack);
  app.steer = !selfcheck;
  const intervals: number[] = [];
  let previous = 0;
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button) => app.pointer(kind, key, x, y, button) });
  bindInput(canvas, app);
  // Voice plays once the session has its token and the viewer has touched the page.
  const voice = new VoiceIo(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice`);
  app.voice = voice;
  addEventListener("pointerdown", () => voice.unlock());
  addEventListener("keydown", () => voice.unlock());
  /** With ?voice=1 the self-check talks to itself. Its own voice must come back from the server and play. */
  const voiceCheck = selfcheck && params.get("voice") === "1";
  /** With ?voice=listen it only listens to another page, and reports whose voice it played. */
  const voiceListen = selfcheck && params.get("voice") === "listen";
  voice.loop = voiceCheck;
  let frames = 0;
  const times: number[] = [];

  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    renderer.init();
    app.scene?.resetUploads();
  });

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const t0 = performance.now();
    if (bench) app.autopilot(now);
    voice.sync(session.voice);
    if (voiceCheck && voice.report.status === "listening") voice.talk(true);
    const packet = app.frame(now, cssWidth, cssHeight);
    view.apply(app.ui.frame, cssHeight);
    if (!packet) return;
    const width = Math.floor(cssWidth * devicePixelRatio);
    const height = Math.floor(cssHeight * devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    renderer.draw(packet);
    times.push(performance.now() - t0);
    if (bench && previous > 0 && intervals.push(now - previous) === BENCH_FRAMES) {
      const sorted = (list: number[]) => [...list].sort((x, y) => x - y);
      const at = (list: number[], q: number) => list[Math.floor((list.length - 1) * q)]!;
      const gaps = sorted(intervals);
      const work = sorted(times);
      const result = {
        frames: BENCH_FRAMES,
        frameMs: { median: at(gaps, 0.5), p95: at(gaps, 0.95), p99: at(gaps, 0.99), worst: at(gaps, 1) },
        buildAndSubmitMs: { median: at(work, 0.5), p99: at(work, 0.99) },
        drawCalls: renderer.drawCalls,
        triangles: packet.triangles,
        canvas: [width, height],
        renderer: renderer.rendererName,
        userAgent: navigator.userAgent,
      };
      document.title = `SNARK ${result.frameMs.median.toFixed(1)} ms`;
      void fetch("__bench", { method: "POST", body: JSON.stringify(result) });
    }
    previous = now;

    // The self-check reads pixels back and reports on the 90th drawn frame. With voice it first waits for a
    // second of played voice, or for ten seconds to report that none was.
    const voiced = voiceCheck || voiceListen;
    if (selfcheck && frames >= 0 && ++frames >= 90 && (!voiced || voice.report.played >= 50 || frames >= 690)) {
      frames = -1;
      const heard = !voiced || (voice.report.played >= 50 && voice.report.odd === 0 && voice.report.errors === 0 && (!voiceListen || voice.report.heard.length > 0));
      const probes = provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, params.has("creature")).map((p) => {
        const got = renderer.readPixel(p.sx, p.sy);
        return { name: p.name, expected: p.rgb, got, ok: probePasses(p, got[0], got[1], got[2]) };
      });
      times.sort((x, y) => x - y);
      const misplaced = view.misplaced(app.ui.frame);
      const report = {
        // A listening page has the talking page's body in view, so its picture is not the fixed one and the probes do not count.
        ok: (voiceListen || probes.every((p) => p.ok)) && misplaced === 0 && heard,
        ...(voiced ? { voice: voice.report } : {}),
        userAgent: navigator.userAgent,
        renderer: renderer.rendererName,
        canvas: [width, height],
        probes,
        interface: { nodes: app.ui.frame.count, misplaced },
        structures: session.world!.structs.count,
        tiles: packet.tileCount,
        draws: packet.drawCount,
        entitiesDrawn: packet.transientCount,
        drawCalls: renderer.drawCalls,
        triangles: packet.triangles,
        frameMsMedian: times[times.length >> 1],
        snapshots: session.stats.snapshots,
        corrections: session.stats.corrections,
      };
      document.title = report.ok ? "SNARK self-check passed" : "SNARK self-check FAILED";
      void fetch("__selfcheck", { method: "POST", body: JSON.stringify(report) });
    }
  };
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  root.textContent = message;
  if (selfcheck) void fetch("__selfcheck", { method: "POST", body: JSON.stringify({ ok: false, error: message }) });
});
