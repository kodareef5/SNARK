// Browser entry point. Each frame it asks the app what to draw, and hands the world to WebGL and the interface to the DOM binder.

import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { WorkerPort } from "../assets/port.ts";
import { DEFAULT_TIER, tierOf } from "../core/assets/tiers.ts";
import { LEVEL_COLOURS, SKY_COLOR } from "../../shared/pack/palette.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { App } from "../core/app.ts";
import { probePasses, provingProbes, type Probe } from "../core/selfcheck.ts";
import { groundSize } from "../core/render/terrain.ts";
import { ClientSession } from "../core/session.ts";
import { devicePage } from "./device.ts";
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
/** A device probe (tools/device.ts). The page measures itself and reports. */
const device = params.has("device") ? devicePage(params.get("device")!) : null;
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
  // The server names its map's file. It is fetched whole, while the assets are, since the renderer draws the ground from it.
  const mapBytes = (async () => {
    const named = (await (await fetch("map.json")).json()) as { file: string };
    return (await fetch(named.file)).arrayBuffer();
  })();
  // The manifest says where every level of every mesh is. The boot pack is fetched whole, and the rest as it is wanted.
  const manifest = parseManifest(await (await fetch("assets/manifest.json")).text());
  const pack = parsePack(new Uint8Array(await (await fetch(`assets/${manifest.files[manifest.boot]!.name}`)).arrayBuffer()));
  const port = new WorkerPort(manifest, "assets", tierOf(DEFAULT_TIER).diskBytes, params.get("assetnet"));
  const map = parseMap(new Uint8Array(await mapBytes));
  const hf = mapHeightfield(map);
  const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
  // The texture variant is the best this device takes, or the one ?texfmt= names if it takes that.
  const renderer = new GlRenderer(canvas, pack, hf, manifest, params.get("texfmt"));
  // The ground's widest picture is the whole map at every fourth sample (client/core/render/terrain.ts).
  const widest = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) as number;
  const ground = groundSize(hf);
  if (Math.max(...ground.width, ...ground.height) > widest) throw new Error(`this map's ground is ${ground.width[0]} by ${ground.height[0]} texels, and this device draws ground of at most ${widest} a side`);
  const session = new ClientSession(connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`), {
    name: params.get("name") ?? `survivor${Math.floor(performance.now() * 1000) % 100000}`,
    key: deviceKey(),
    spectate: params.has("spectate"),
    password: params.get("password") ?? "",
    registry: reg,
    clipHash: pack.clips.hash,
    // The self-check, the bench, the device probe and ?quick skip the creator.
    ...(selfcheck || bench || device || params.has("quick") ? { look: defaultLook() } : {}),
    resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    nodes: (ground, content) => mapNodes(map, ground, content),
  });
  const app = new App(session, reg, pack, { manifest, port });
  app.stress = params.has("stress");
  app.debug = app.stress || params.has("debug");
  app.steer = !selfcheck && !device;
  const intervals: number[] = [];
  let previous = 0;
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button) => app.pointer(kind, key, x, y, button) });
  // A device probe runs by itself, and a touch must not move or open anything.
  if (!device) bindInput(canvas, app);
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

  let restored = 0;
  let keptBefore = 0;
  let still = 0;
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    renderer.init();
    app.scene?.resetUploads();
    app.pressure();
    restored++;
  });
  /** With ?lose=1 the self-check takes the graphics context away and gives it back, and must still see its picture. */
  const loser = params.has("lose") ? renderer.gl.getExtension("WEBGL_lose_context") : null;
  device?.attach({ app, pack, reg, hf }, renderer);

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const t0 = performance.now();
    if (bench) app.autopilot(now);
    voice.sync(session.voice);
    if (voiceCheck && voice.report.status === "listening") voice.talk(true);
    if (app.scene) app.scene.assets.format = renderer.format;
    const packet = app.frame(now, cssWidth, cssHeight);
    view.apply(app.ui.frame, cssHeight);
    if (!packet) return;
    const built = performance.now();
    // The tier says how many device pixels to draw for one CSS pixel, at most, and 0 is as many as the screen has.
    const most = app.scene?.assets.tier.pixelRatio ?? 0;
    const ratio = most > 0 ? Math.min(devicePixelRatio, most) : devicePixelRatio;
    const width = Math.floor(cssWidth * ratio);
    const height = Math.floor(cssHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    renderer.draw(packet);
    if (renderer.failed.length + renderer.failedTextures.length > 0) {
      for (const slot of renderer.failed) app.scene?.assets.residency.failed(slot);
      for (const t of renderer.failedTextures) app.scene?.assets.residency.failedTexture(t);
      app.pressure();
    }
    device?.frame(now, packet, t0, built);
    if (frames === 30) loser?.loseContext();
    if (frames === 45) loser?.restoreContext();
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
    // Parts are written to disk a little after they arrive. The report waits until that has been still for half a second.
    still = port.cache.used === keptBefore ? still + 1 : 0;
    keptBefore = port.cache.used;
    if (selfcheck && frames >= 0 && ++frames >= 90 && still >= 30 && (!voiced || voice.report.played >= 50 || frames >= 690)) {
      frames = -1;
      const heard = !voiced || (voice.report.played >= 50 && voice.report.odd === 0 && voice.report.errors === 0 && (!voiceListen || voice.report.heard.length > 0));
      // In the stress scene three rocks hang in the sky, each drawn at another level, and a level is all one colour.
      const rocks = app.marks.map((m) => ({ ...m, drawn: app.scene!.things[m.thing]!.level }));
      const at = [0, 0, 0];
      const stressed = rocks.flatMap((m): Probe[] => (app.cam.project(m.x, m.y, m.z, at) ? [{ name: `rock at level ${m.level}`, sx: at[0]!, sy: at[1]!, rgb: [0, 1, 2].map((c) => pack.palette[LEVEL_COLOURS[m.level]! * 4 + c]!) as Probe["rgb"], mode: "hue" }] : []));
      const probes = [...provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, params.has("creature"), packet), ...stressed].map((p) => {
        const got = renderer.readPixel(p.sx, p.sy);
        return { name: p.name, expected: p.rgb, got, ok: probePasses(p, got[0], got[1], got[2]) };
      });
      times.sort((x, y) => x - y);
      const misplaced = view.misplaced(app.ui.frame);
      const report = {
        // A listening page has the talking page's body in view, so its picture is not the fixed one and the probes do not count.
        ok: (voiceListen || probes.every((p) => p.ok)) && misplaced === 0 && heard && restored === (params.has("lose") ? 1 : 0) && packet.skipped === 0 && packet.dropped === 0 && stressed.length === (app.stress ? 3 : 0) && rocks.every((m) => m.drawn === m.level),
        rocks: rocks.map((m) => [m.level, m.drawn]),
        restored,
        assets: { ...app.scene?.assets.residency.stats, kept: port.cache },
        ...(voiced ? { voice: voice.report } : {}),
        userAgent: navigator.userAgent,
        renderer: renderer.rendererName,
        textures: { format: renderer.format, takes: renderer.formats, errors: renderer.errors },
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

(device ? device.before().then((go) => (go ? boot() : undefined)) : boot()).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  root.textContent = message;
  device?.fail(message);
  if (selfcheck) void fetch("__selfcheck", { method: "POST", body: JSON.stringify({ ok: false, error: message }) });
});
