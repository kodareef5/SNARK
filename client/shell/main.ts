// Browser entry point. Each frame it asks the app what to draw, and hands the world to WebGL and the interface to the DOM binder.

import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { WorkerPort } from "../assets/port.ts";
import { DEFAULT_TIER, tierOf } from "../core/assets/tiers.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { App } from "../core/app.ts";
import { fetchBytes, fetchJson, fetchText } from "../core/fetched.ts";
import { loadIdentity } from "../core/identity.ts";
import { SelfcheckSurfaces } from "../core/selfcheck-surfaces.ts";
import { SelfcheckProgress, selfcheckReport } from "../core/selfcheck-report.ts";
import { BenchRun, PassClock } from "../core/passes.ts";
import { groundSize } from "../core/render/terrain.ts";
import { ClientSession } from "../core/session.ts";
import { arrivalOf, type ClusterList } from "../core/travel.ts";
import { devicePage } from "./device.ts";
import { GlRenderer } from "./gl.ts";
import { bindInput } from "./input.ts";
import { connect } from "./socket.ts";
import { VoiceIo } from "../voice/voice.ts";
import { SoundIo } from "../sound/sound.ts";
import { WorkerDecoder } from "../sound/decoder.ts";
import { UiView } from "./ui.ts";
import { VehicleSelfcheck } from "../core/vehicle-selfcheck.ts";
import { probeProgress } from "../core/diagnostics.ts";
import { installSkin, SKIN_URL } from "../core/ui/skin.ts";

const params = new URLSearchParams(location.search);
const selfcheck = params.has("selfcheck");
const driveCheck = selfcheck && params.has("urbanDrive");
/** A measurement run. The camera flies itself and the page reports frame times and the GPU's by pass. */
const bench = params.has("bench") ? new BenchRun() : null;
/** A device probe (tools/device.ts). The page measures itself and reports. */
const device = params.has("device") ? devicePage(params.get("device")!) : null;
const root = document.querySelector<HTMLElement>("#ui")!;
/** A survivor arriving from another server of the cluster, with its ticket (client/core/travel.ts). */
const arrival = arrivalOf(location.hash);

async function boot(): Promise<void> {
  const reg = compileContent(CORE_CONTENT).registry!;
  // The server names its map's file. It is fetched whole, while the assets are, since the renderer draws the ground from it.
  const mapBytes = (async () => {
    const named = (await fetchJson(fetch, "map.json")) as { file: string };
    return fetchBytes(fetch, named.file);
  })();
  // The manifest says where every level of every mesh is. The boot pack is fetched whole, and the rest as it is wanted.
  const manifest = parseManifest(await fetchText(fetch, "assets/manifest.json"));
  const pack = parsePack(new Uint8Array(await fetchBytes(fetch, `assets/${manifest.files[manifest.boot]!.name}`)));
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
    ...loadIdentity({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, (bytes) => { crypto.getRandomValues(bytes); }, arrival?.name ?? params.get("name"), arrival !== null),
    ...(arrival ? { ticket: arrival.ticket } : {}),
    spectate: params.has("spectate"),
    password: params.get("password") ?? "",
    registry: reg,
    clipHash: pack.clips.hash,
    // The self-check, the bench, the device probe and ?quick skip the creator.
    ...(selfcheck || bench || device || params.has("quick") ? { look: defaultLook() } : {}),
    resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null),
    nodes: (ground, content) => mapNodes(map, ground, content),
    city: (content) => new CityStatics(map.dims, map.statics, content),
  });
  const surfaces = selfcheck ? new SelfcheckSurfaces(manifest, port) : null;
  const app = new App(session, reg, pack, { manifest, port: surfaces ?? port });
  session.prediction.enabled = selfcheck;
  const skin = installSkin(app.ui.frame), skinImage = new Image();
  skinImage.src = SKIN_URL;
  void skinImage.decode().then(() => { skin.url = SKIN_URL; }).catch(() => {});
  // A measurement run neither reads nor writes the player's saved interface preferences.
  const measured = selfcheck || bench !== null || device !== null;
  const save = (): void => { if (!measured) try { localStorage.setItem("snark.interface", app.ui.settings.interfacePreferences()); } catch {} };
  if (!measured) try { app.ui.settings.restoreInterface(localStorage.getItem("snark.interface")); } catch {}
  addEventListener("pagehide", save);
  app.stress = params.has("stress");
  app.debug = app.stress || params.has("debug");
  app.steer = driveCheck || !selfcheck && !device;
  app.plainSky = selfcheck;
  [app.ui.settings.touchFirst, app.dpr] = [matchMedia("(pointer: coarse)").matches, devicePixelRatio];
  app.address((name) => params.get(name), measured);
  app.page = {
    origin: location.origin,
    protocol: location.protocol,
    hostname: location.hostname,
    go: (url) => location.assign(url),
    reload: () => location.reload(),
    arrived: () => arrival && history.replaceState(null, "", location.pathname + location.search),
    cluster: async () => (await fetchJson(fetch, "cluster.json")) as ClusterList,
  };
  const clock = (renderer.passes = device ? null : new PassClock(renderer.gl, bench !== null && params.has("passes")));
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button) => app.pointer(kind, key, x, y, button) });
  // A device probe runs by itself, and a touch must not move or open anything.
  if (!device) bindInput(canvas, app);
  // Voice plays once the session has its token and the viewer has touched the page.
  // The world's sounds and the voices share one audio context.
  const sound = SoundIo.supported ? new SoundIo(app.ui.settings.touchFirst) : null;
  app.sound = sound;
  if (sound && typeof Worker !== "undefined") app.soundDecoder = new WorkerDecoder();
  // The music the build lists; without it the game has no music and plays on.
  if (sound) void fetch("assets/music/music.json").then((r) => (r.ok ? r.json() : null)).then((m) => (app.musicTracks = m?.tracks ?? null)).catch(() => {});
  const voice = new VoiceIo(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice`, sound ? () => sound.shared() : null);
  app.voice = voice;
  for (const gesture of ["pointerdown", "pointerup", "keydown"]) addEventListener(gesture, () => (voice.unlock(), sound?.unlock()));
  /** With ?voice=1 the self-check talks to itself. Its own voice must come back from the server and play. */
  const voiceCheck = selfcheck && params.get("voice") === "1";
  /** With ?voice=listen it only listens to another page, and reports whose voice it played. */
  const voiceListen = selfcheck && params.get("voice") === "listen";
  voice.loop = voiceCheck;
  const progress = new SelfcheckProgress();
  const drivingCheck = driveCheck ? new VehicleSelfcheck() : null;
  const drive = drivingCheck?.data;

  let restored = 0;
  if (selfcheck) Object.assign(globalThis, { snarkProbe: () => ({ ...probeProgress(app), frames: progress.frames, still: progress.still, cache: port.cache, glErrors: renderer.errors, drawCalls: renderer.drawCalls, drive }) });
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

  let savedRevision = app.ui.settings.revision, savedAt = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const t0 = performance.now();
    app.gamepads(document.hasFocus() ? navigator.getGamepads?.() ?? [] : [], now);
    if (!app.ui.wantsPointerLock && document.pointerLockElement) document.exitPointerLock();
    if (bench) app.autopilot(bench.since(now));
    drivingCheck?.step(app, now);
    voice.sync(session.voice);
    if (voiceCheck && voice.report.status === "listening") voice.talk(true);
    if (app.scene) app.scene.assets.format = renderer.format;
    const packet = app.frame(now, cssWidth, cssHeight);
    drivingCheck?.observe(app);
    if (savedRevision !== app.ui.settings.revision && now - savedAt > 250) {
      savedRevision = app.ui.settings.revision; savedAt = now;
      save();
    }
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
    if (packet.lit) surfaces?.start();
    renderer.draw(packet);
    if (renderer.failed.length + renderer.failedTextures.length > 0) {
      for (const slot of renderer.failed) app.scene?.assets.residency.failed(slot);
      for (const t of renderer.failedTextures) app.scene?.assets.residency.failedTexture(t);
      app.pressure();
    }
    const [ours, gpu] = [performance.now() - t0, clock?.take() ?? []];
    app.drawn(packet, ours, gpu);
    device?.frame(now, packet, t0, built);
    if (progress.frames === 30) loser?.loseContext();
    // The self-check asks for a call and listens for it leaving the volume.
    if (selfcheck && sound && progress.frames >= 0) {
      if (progress.frames === 30) app.ui.local?.("sound call");
      sound.listen();
    }
    if (progress.frames === 45) loser?.restoreContext();
    const r = app.scene!.assets.residency;
    const result = bench?.frame(now, ours, gpu, packet, r.flying + r.waiting === 0, { drawCalls: renderer.drawCalls, canvas: [width, height], renderer: renderer.rendererName, userAgent: navigator.userAgent });
    if (result) document.title = `SNARK ${result.frameMs.median} ms`;
    if (result) void fetch("__bench", { method: "POST", body: JSON.stringify(result) });

    // The self-check reads pixels back and reports on the 90th drawn frame. With voice it first waits for a
    // second of played voice, or for ten seconds to report that none was.
    const voiced = voiceCheck || voiceListen;
    // Parts are written to disk a little after they arrive. The report waits until that has been still for half a second.
    if (progress.advance(performance.now() - t0, port.cache.used, selfcheck && (!packet.lit || surfaces!.done), voiced, voice.report.played, !drive || drive.finished)) {
      const report = selfcheckReport(app, pack, manifest, hf, packet, {
        has: name => params.has(name), voiced, voiceListen, voice: voice.report,
        driveCheck, drive, restored, misplaced: view.misplaced(app.ui.frame), sound: sound ? { peak: sound.peak } : null,
        cache: port.cache, userAgent: navigator.userAgent, width, height, times: progress.times, renderer, surfaces,
      });
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
