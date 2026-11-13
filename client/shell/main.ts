// Browser entry point. Loads assets, connects, and each frame asks the app
// (client/core/app.ts) what to draw, hands the world to WebGL and the interface
// to the DOM binder.

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
/** A measurement run: the camera flies itself and the page reports how long frames took. */
const bench = params.has("bench");
const BENCH_FRAMES = 900;
const root = document.querySelector<HTMLElement>("#ui")!;

/** This browser's device key: made once, kept in local storage. It is what owns a survivor's name. */
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
    // A server that asks a password is given the one in the address: ?password=...
    password: params.get("password") ?? "",
    registry: reg,
    clipHash: pack.clips.hash,
    // The self-check and the bench go straight into the world; so does ?quick. Anyone else new meets the creator.
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
  // Voice: heard once the session has its token and the viewer has touched the page; B is held to talk.
  const voice = new VoiceIo(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice`);
  app.voice = voice;
  addEventListener("pointerdown", () => voice.unlock());
  addEventListener("keydown", () => voice.unlock());
  /** The self-check also talks to itself: its own voice, sent to the server and back, must be played. */
  const voiceCheck = selfcheck && params.get("voice") === "1";
  /** Or it only listens, for another page that is talking: what it reports is whose voice it played. */
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

    // Self-check: once the world has arrived, read pixels back and report.
    // With voice it waits for a second of it to have been played, or for ten seconds to say that none was.
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
        // A page that only listens stands beside the other, which is in its view: its picture is not the fixed one.
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
