import { launchKey,readLaunch } from "../core/entry-state.ts";
import { SESSION_CREATING, REJECT_NAME, REJECT_PASSWORD, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
// Browser entry point. Each frame it asks the app what to draw, and hands the world to WebGL and the interface to the DOM binder.

import { defaultLook } from "../../shared/anim/look.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { WorkerPort } from "../assets/port.ts";
import { WorkerCityMaker } from "../city/maker.ts";
import { DEFAULT_TIER, canvasRatio, tierOf } from "../core/assets/tiers.ts";
import { nodeLayers } from "../../shared/world/mapfile.ts";
import { App } from "../core/app.ts";
import { fetchBytes, fetchContent, fetchJson, fetchSounds, fetchText, nextTask, withLandmarks } from "../core/fetched.ts";
import { MapLoader } from "../core/mapload.ts";
import { loadIdentity } from "../core/identity.ts";
import { SelfcheckSurfaces } from "../core/selfcheck-surfaces.ts";
import { SelfcheckProgress, selfcheckReport } from "../core/selfcheck-report.ts";
import { BenchRun, PassClock } from "../core/passes.ts";
import { giveSky, SKY_FILE } from "../core/render/sky.ts";
import { groundSize } from "../core/render/terrain.ts";
import { ClientSession } from "../core/session.ts";
import { arrivalOf, socketAddress } from "../core/travel.ts";
import { GlRenderer } from "./gl.ts";
import { bindInput } from "./input.ts";
import { connect } from "./socket.ts";
import { VoiceIo } from "../voice/voice.ts";
import { SoundIo } from "../sound/sound.ts";
import { WorkerDecoder } from "../sound/decoder.ts";
import { UiView } from "./ui.ts";
import { ActivitySelfcheck } from "../core/activity-selfcheck.ts";
import { probeProgress } from "../core/diagnostics.ts";
import { installSkin, SKIN_URL, skinPixels } from "../core/ui/skin.ts";
import { CAPTURE_KEY, LightCapture, SAMPLE_H, SAMPLE_W } from "../core/light-capture.ts";

declare const __CONTENT_FILE__: string;
const params = new URLSearchParams(location.search);
const selfcheck = params.has("selfcheck");
const driveCheck = selfcheck && params.has("urbanDrive");
/** A measurement run. The camera flies itself and the page reports frame times and the GPU's by pass. */
const bench = params.has("bench") ? new BenchRun() : null;
/** A device probe (tools/device.ts). The page measures itself and reports. */
const device = params.has("device") ? (await import("./device.ts")).devicePage(params.get("device")!) : null;
const root = document.querySelector<HTMLElement>("#ui")!;
const splash=document.querySelector<HTMLElement>("#boot-splash");
const loadingLine=document.querySelector<HTMLElement>("#boot-line");
if(selfcheck || bench || device || params.has("look") || params.has("trip"))splash?.remove();
/** The GPU's times of a frame where nothing times it. */
const UNTIMED: readonly number[][] = [];
/** A survivor arriving from another server of the cluster, with its ticket (client/core/travel.ts). */
const arrival = arrivalOf(location.hash);
const entryKey=launchKey(location.pathname);
let launch=null as ReturnType<typeof readLaunch>;
try { if(!arrival && location.pathname.endsWith("/play.html")) launch=readLaunch(sessionStorage.getItem(entryKey)); } catch {}


if(launch && params.get("name")!==launch.name)launch=null;
if(launch?.intent==="create"){
  const back=document.querySelector<HTMLAnchorElement>("#entry-back");if(back){back.href="./?screen=create";back.textContent="Return to character creation";}
}
async function boot(): Promise<void> {
  // Every file the first frame needs is asked for before anything else runs, and index.html asked for most of them already.
  // The server names its map's head, which holds the whole map coarse. Its landmarks' definitions come first, then the ground
  // round the body and its overviews once the welcome says where that is, and the rest while the world is drawn
  // (client/core/mapload.ts).
  // Until the first frame the page's one line says what it waits for when a part has failed (client/core/mapload.ts).
  const loading = fetchJson(fetch, "map.json").then((named) => MapLoader.start(fetch, (named as { head: string }).head, { say: (line) => {root.textContent=line || "Preparing world…";if(loadingLine)loadingLine.textContent=root.textContent;}, wait: (ms) => new Promise((go) => setTimeout(go, ms)), pause: nextTask(new MessageChannel()) }));
  const manifestText = fetchText(fetch, "assets/manifest.json"), skyBytes = fetchBytes(fetch, SKY_FILE), content = fetchContent(fetch, __CONTENT_FILE__);
  // The socket opens once the landmarks' definitions are in, so its handshake runs while they are read. The server waits 5 s
  // for a hello, and a socket it gave up on is opened again.
  const early = loading.then(() => connect(socketAddress(location, "ws")), () => null);
  // The manifest names every mesh and says where the pages are. The boot pack is fetched whole, and the rest as it is
  // wanted. The sound library starts once the sounds' rows have come.
  const core = parseManifest(await manifestText);
  const bootBytes = fetchBytes(fetch, `assets/${core.files[core.boot]!.name}`);
  // Each part is checked against the hash its head names as it is read.
  const loader = await loading, { head, hf, nodes, content: land } = loader.staged;
  const { reg, manifest, pack } = await withLandmarks(fetch, land, await content, core, parsePack(new Uint8Array(await bootBytes)));
  const silent = fetchSounds(fetch, manifest);
  const port = new WorkerPort(manifest, "assets", tierOf(DEFAULT_TIER).diskBytes, params.get("assetnet"));
  giveSky(new Uint8Array(await skyBytes));
  const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
  // The texture variant is the best this device takes, or the one ?texfmt= names if it takes that.
  const renderer = new GlRenderer(canvas, pack, hf, manifest, params.get("texfmt"));
  // The ground's widest picture is the whole map at every fourth sample (client/core/render/terrain.ts).
  const widest = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) as number;
  const ground = groundSize(hf);
  if (Math.max(...ground.width, ...ground.height) > widest) throw new Error(`this map's ground is ${ground.width[0]} by ${ground.height[0]} texels, and this device draws ground of at most ${widest} a side`);
  const socket = await early;
  const session = new ClientSession(socket?.open ? socket : connect(socketAddress(location, "ws")), {
    ...loadIdentity({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, (bytes) => { crypto.getRandomValues(bytes); }, arrival?.name ?? launch?.name ?? params.get("name"), arrival !== null),
    ...(arrival ? { ticket: arrival.ticket } : {}),
    spectate: params.has("spectate"),
    password: launch?.password ?? params.get("password") ?? "",
    ...(launch ? {intent:launch.intent,createRequest:launch.request?Uint8Array.from(launch.request.match(/../g)!,hex=>parseInt(hex,16)):undefined} : {}),
    registry: reg,
    clipHash: manifest.clipHash,
    // The self-check, the bench, the device probe and ?quick skip the creator.
    ...(selfcheck || bench || device || params.has("quick") ? { look: defaultLook() } : {}),
    resolveMap: (id, hash) => (id === head.id && hash === head.hash ? hf : null),
    nodes: (ground, content) => nodeLayers(head.dims, ground, content, nodes),
    cityMaker: new WorkerCityMaker(),
    tideEyes: head.tideEyes,
    ...(land ? { landmarks: land.landmarks } : {}),
  });
  let createSeq=0, createFailed=false;
  if(launch){
    const chosen=launch;
    void session.welcomed.then(()=>{
      if(session.state==="closed")return;
      if(chosen.intent==="create" && session.sessionState===SESSION_CREATING)createSeq=session.create(Uint8Array.from(chosen.look!),chosen.spawn);
    });
  }
  const surfaces = selfcheck ? new SelfcheckSurfaces(manifest, port) : null;
  const app = new App(session, reg, pack, { manifest, port: surfaces ?? port });
  const previous=session.onResult;
  session.onResult=(seq,result)=>{previous?.(seq,result);if(createSeq && seq===createSeq && result!==RESULT_OK)createFailed=true;};
  if (params.has("trip")) void import("../core/trip.ts").then(({ TripProbe }) => TripProbe.watch(app, head.counts, globalThis as unknown as Record<string, unknown>, (go) => void requestAnimationFrame(go)));
  void silent.then((why) => why && app.ui.console.print(`no sounds: ${why}`));
  session.prediction.enabled = selfcheck;
  // A development world keeps the page's record of play from its first frame and is sent it off the game's socket (server/playlog.ts).
  if (!device) void fetch("__play").then((r) => r.status === 204 && session.prediction.start((report) => void fetch("__play", { method: "POST", body: report, keepalive: true }).catch(() => {})), () => {});
  const skin = installSkin(app.ui.frame);
  void Object.assign(new Image(), { src: SKIN_URL }).decode().catch(() => Object.assign(skin, { ...skinPixels(), url: "" }));
  // A tool's look at a place takes its orders from the server the tool started for it, which alone answers /__look; on
  // any other server the address does nothing.
  const orders = params.has("look") ? await fetch(`/__look?view=${encodeURIComponent(params.get("look")!)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  // A measurement run neither reads nor writes the player's saved interface preferences.
  const measured = selfcheck || bench !== null || device !== null || orders !== null;
  const save = (): void => { if (!measured) try { localStorage.setItem("snark.interface", app.ui.settings.interfacePreferences()); } catch {} };
  if (!measured) try { app.ui.settings.restoreInterface(localStorage.getItem("snark.interface")); } catch {}
  addEventListener("pagehide", () => {
    save();
    session.close();
  });
  addEventListener("pageshow", event => {
    if (event.persisted) location.reload();
  });
  app.stress = params.has("stress");
  app.debug = app.stress || params.has("debug");
  app.steer = driveCheck || selfcheck && params.has("dinosaur") || !selfcheck && !device;
  app.plainSky = selfcheck;
  app.ui.settings.touchFirst = matchMedia("(pointer: coarse)").matches;
  if (!measured) app.ui.settings.start({ renderer: renderer.rendererName, light: renderer.light > 0, memory: (navigator as { deviceMemory?: number }).deviceMemory });
  app.dpr = devicePixelRatio;
  app.address((name) => params.get(name), measured, orders);
  app.page = {
    origin: location.origin,
    protocol: location.protocol,
    hostname: location.hostname, host: location.host, pathname: location.pathname,
    go: (url) => location.assign(url),
    open: (url) => void open(url, "_blank", "noopener"),
    reload: () => location.reload(),
    arrived: () => arrival && history.replaceState(null, "", location.pathname + location.search),
    json: (name) => fetchJson(fetch, name),
  };
  const clock = (renderer.passes = bench ? new PassClock(renderer.gl, params.has("passes"), params.has("sync") ? () => performance.now() : null) : null);
  // A development world's page captures the light it draws for ten seconds at F9, read back from a small copy of the
  // canvas, and sends it with its record of play.
  const light = new LightCapture(), copy = Object.assign(document.createElement("canvas"), { width: SAMPLE_W, height: SAMPLE_H }).getContext("2d", { willReadFrequently: true })!;
  const say = (line: string): void => (console.log(line), app.ui.chat.print(TEXT_NOTICE, line, session.serverTick));
  if (!measured) void fetch("__play").then((r) => r.status === 204 && addEventListener("keydown", (e) => e.code === CAPTURE_KEY && light.start(performance.now()) && say("Capturing the light of every frame for ten seconds")), () => {});
  // A device probe runs by itself, and a touch must not move or open anything.
  if (!device) bindInput(canvas, app);
  // Voice plays once the session has its token and the viewer has touched the page.
  // The world's sounds and the voices share one audio context.
  const sound = SoundIo.supported ? new SoundIo(app.ui.settings.touchFirst) : null;
  app.sound = sound;
  if (sound && typeof Worker !== "undefined") app.soundDecoder = new WorkerDecoder();
  // The music the build lists; without it the game has no music and plays on.
  if (sound) void fetch("assets/music/music.json").then((r) => (r.ok ? r.json() : null)).then((m) => (app.musicTracks = m?.tracks ?? null)).catch(() => {});
  const voice = new VoiceIo(socketAddress(location, "voice"), sound ? () => sound.shared() : null);
  app.voice = voice;
  for (const gesture of ["pointerdown", "pointerup", "keydown"]) addEventListener(gesture, () => (voice.unlock(), sound?.unlock()));
  /** With ?voice=1 the self-check talks to itself. Its own voice must come back from the server and play. */
  const voiceCheck = selfcheck && params.get("voice") === "1";
  /** With ?voice=listen it only listens to another page, and reports whose voice it played. */
  const voiceListen = selfcheck && params.get("voice") === "listen";
  voice.loop = voiceCheck;
  const progress = new SelfcheckProgress();
  const drivingCheck = new ActivitySelfcheck(params);
  const drive = drivingCheck.vehicle?.data;

  function showEntryProblem(){
    splash?.remove();
    root.replaceChildren();
    root.textContent = createFailed ? "This spawn is unavailable. Choose another starting area."
      : session.closeReason === REJECT_PASSWORD ? "Incorrect server password."
      : session.closeReason === REJECT_NAME ? "This survivor is unavailable." : "Disconnected from world.";
    document.querySelector<HTMLElement>("#entry-back")!.hidden=false;
  }
  let restored = 0;
  if (selfcheck) Object.assign(globalThis, { snarkProbe: () => ({ ...probeProgress(app), frames: progress.frames, still: progress.still, cache: port.cache, glErrors: renderer.errors, drawCalls: renderer.drawCalls, drive, dinosaur: drivingCheck.dinosaur?.data }) });
  canvas.addEventListener("webglcontextlost", (e) => (e.preventDefault(), session.prediction.note("the graphics context was lost")));
  canvas.addEventListener("webglcontextrestored", () => {
    renderer.init();
    app.scene?.resetUploads();
    app.pressure();
    session.prediction.note(`the graphics context was given back (${++restored} times)`);
  });
  /** With ?lose=1 the self-check takes the graphics context away and gives it back, and must still see its picture. */
  const loser = params.has("lose") ? renderer.gl.getExtension("WEBGL_lose_context") : null;
  device?.attach({ app, pack, reg, hf }, renderer);

  let savedRevision = app.ui.settings.revision, savedAt = 0;
  const frame = (now: number): void => {
    if(launch && (session.state==="closed" || createFailed)){showEntryProblem();return;}
    if(launch && session.state==="active" && session.sessionState!==SESSION_CREATING){
      try {sessionStorage.setItem(entryKey,JSON.stringify({intent:"resume",password:launch.password,name:launch.name}));localStorage.setItem("snark.name",launch.name);localStorage.setItem("snark.played."+new URL("./",location.href).href,JSON.stringify({name:launch.name,time:Date.now()}));} catch {}
      launch=null;
    }
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
    if (!packet) {if(session.state==="closed" && splash?.isConnected)splash.remove();return;}
    const built = performance.now();
    // The tier says how many pixels to draw for one CSS pixel: the screen's own at most, or on ultra more (canvasRatio).
    const ratio = app.scene ? canvasRatio(app.scene.assets.tier, devicePixelRatio, cssWidth, cssHeight) : devicePixelRatio;
    const width = Math.floor(cssWidth * ratio);
    const height = Math.floor(cssHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (packet.lit) surfaces?.start();
    renderer.draw(packet);
    if (light.on) {
      copy.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
      const sent = light.frame(now, packet, app, copy.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, { userAgent: navigator.userAgent, dpr: devicePixelRatio, renderer: renderer.rendererName, format: renderer.format });
      if (sent) void Promise.all(sent.map((part) => fetch("__play", { method: "POST", body: part }).then((r) => r.ok, () => false))).then((ok) => say(ok.every(Boolean) ? `Light capture saved in the record of play, ${sent.length} parts` : `Light capture: ${ok.filter((o) => !o).length} of ${sent.length} parts not saved`));
    }
    if(splash?.isConnected)splash.remove();
    if (renderer.failed.length + renderer.failedTextures.length > 0) {
      for (const slot of renderer.failed) app.scene?.assets.residency.failed(slot);
      for (const t of renderer.failedTextures) app.scene?.assets.residency.failedTexture(t);
      app.pressure();
    }
    const ours = performance.now() - t0, gpu = clock?.take() ?? UNTIMED;
    app.drawn(packet, ours, width, height);
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
    if (selfcheck && progress.advance(performance.now() - t0, port.cache.used, !packet.lit || surfaces!.done, voiced, voice.report.played, drivingCheck.finished)) {
      const report = selfcheckReport(app, pack, manifest, hf, packet, {
        has: name => params.has(name), voiced, voiceListen, voice: voice.report,
        driveCheck, drive, dinosaur: drivingCheck.dinosaur?.data, restored, misplaced: view.misplaced(app.ui.frame), sound: sound ? { peak: sound.peak } : null,
        cache: port.cache, userAgent: navigator.userAgent, width, height, times: progress.times, renderer, surfaces,
      });
      document.title = report.ok ? "SNARK self-check passed" : "SNARK self-check FAILED";
      void fetch("__selfcheck", { method: "POST", body: JSON.stringify(report) });
    }
  };
  // The first frame waits for the ground round the body; the rest comes while the game is played, nearest first. From then
  // on the console says when the map comes slowly, and the statics are handed over round the body and then whole.
  await session.welcomed;
  if(launch && session.state==="closed"){showEntryProblem();return;}
  await loader.follow(() => session.place, { say: (line) => app.ui.console.print(line), arriving: (statics, whole) => session.staticsSteps(statics, whole), held: () => session.behind });
  // The interface takes the page's line from here.
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button) => app.pointer(kind, key, x, y, button) });
  requestAnimationFrame(frame);
}

(device ? device.before().then((go) => (go ? boot() : undefined)) : boot()).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  splash?.remove();
  root.textContent = message;
  document.querySelector<HTMLElement>("#entry-back")!.hidden=false;
  device?.fail(message);
  if (selfcheck) void fetch("__selfcheck", { method: "POST", body: JSON.stringify({ ok: false, error: message }) });
});
