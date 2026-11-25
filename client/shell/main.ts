import { logTo } from "./early-log.ts";
import { launchKey, readLaunch } from "../core/entry-state.ts";
import { SETTLED_MS, backAddress, readComeback, readReady, waitKey, waitOut, type Comeback } from "../core/waiting.ts";
import type { Ready } from "../../shared/ready.ts";
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
import { PassClock } from "../core/passes.ts";
import { giveSky, SKY_FILE } from "../core/render/sky.ts";
import { groundSize } from "../core/render/terrain.ts";
import { ClientSession, PARK_CHUNKS_TOUCH } from "../core/session.ts";
import { arrivalOf, socketAddress } from "../core/travel.ts";
import { GlRenderer } from "./gl.ts";
import { bindInput } from "./input.ts";
import { connect } from "./socket.ts";
import { VoiceIo } from "../voice/voice.ts";
import { SoundIo } from "../sound/sound.ts";
import { WorkerDecoder } from "../sound/decoder.ts";
import { UiView } from "./ui.ts";
import { probeProgress } from "../core/diagnostics.ts";
import { installSkin, SKIN_URL, skinPixels } from "../core/ui/skin.ts";

declare const __CONTENT_FILE__: string;
const params = new URLSearchParams(location.search);
const selfcheck = params.has("selfcheck");
// The self-check's code comes only to a page told ?selfcheck (D873).
const checks = selfcheck ? await import("../core/selfcheck-tools.ts") : null;
const driveCheck = selfcheck && params.has("urbanDrive");
/** A measurement run. The camera flies itself and the page reports frame times and the GPU's by pass. */
// The bench's own code comes only to a page told ?bench (D873).
const bench = params.has("bench") ? new (await import("../core/bench-run.ts")).BenchRun() : null;
// The far city and the city's blocks come as their own file, which the first frame does not wait for (D873).
void import("../core/render/city-late.ts");
/** A device probe (tools/device.ts). The page measures itself and reports. */
const device = params.has("device") ? (await import("./device.ts")).devicePage(params.get("device")!) : null;
const root = document.querySelector<HTMLElement>("#ui")!;
const splash = document.querySelector<HTMLElement>("#boot-splash")!;
const loadingLine = document.querySelector<HTMLElement>("#boot-line")!;
const loadingBar = document.querySelector<HTMLProgressElement>("#boot-progress")!;
const entryBack = document.querySelector<HTMLAnchorElement>("#entry-back")!;
const loadingStages = ["Loading world data…", "Preparing the scene…", "Joining the server…", "Loading the starting area…", "Drawing the first frame…"];
function showStage(stage: number, detail = ""): void {
  loadingBar.value = stage;
  loadingLine.textContent = detail || loadingStages[stage]!;
}
function bootError(message: string): void {
  splash.hidden = false;
  document.querySelector<HTMLElement>("#boot-heading")!.textContent = "Couldn’t enter world";
  loadingBar.hidden = true;
  loadingLine.textContent = message;
  entryBack.hidden = false;
  root.textContent = message;
}
if (selfcheck || bench || device || params.has("look") || params.has("trip")) splash.hidden = true;
/** The GPU's times of a frame where nothing times it. */
const UNTIMED: readonly number[][] = [];
/** A survivor arriving from another server of the cluster, with its ticket (client/core/travel.ts). */
const arrival = arrivalOf(location.hash);
const entryKey=launchKey(location.pathname);
let launch=null as ReturnType<typeof readLaunch>;
try { if(!arrival && location.pathname.endsWith("/play.html")) launch=readLaunch(sessionStorage.getItem(entryKey)); } catch {}


if(launch && params.get("name")!==launch.name)launch=null;
if(launch?.intent==="create"){
  entryBack.href = "./?screen=create";
  entryBack.textContent = "Return to character creation";
}
async function boot(): Promise<void> {
  // Every file the first frame needs is asked for before anything else runs, and index.html asked for most of them already.
  // The server names its map's head, which holds the whole map coarse. Its landmarks' definitions come first, then the ground
  // round the body and its overviews once the welcome says where that is, and the rest while the world is drawn
  // (client/core/mapload.ts).
  // Until the first frame the page's one line says what it waits for when a part has failed (client/core/mapload.ts).
  const loading = fetchJson(fetch, "map.json").then((named) => MapLoader.start(fetch, (named as { head: string }).head, {
    say: (line) => showStage(loadingBar.value, line),
    wait: (ms) => new Promise((go) => setTimeout(go, ms)),
    pause: nextTask(new MessageChannel()),
  }));
  const manifestText = fetchText(fetch, "assets/manifest.json"), skyBytes = fetchBytes(fetch, SKY_FILE), content = fetchContent(fetch, __CONTENT_FILE__);
  // The reaction curves come as their own file after the first frame. A world is joined once they are held, so a
  // stagger is drawn as the server judges it.
  const reactionCurves = import("../../shared/anim/reaction-late.ts");
  // The socket opens once the landmarks' definitions are in, so its handshake runs while they are read. The server waits 5 s
  // for a hello, and a socket it gave up on is opened again.
  const early = loading.then(() => connect(socketAddress(location, "ws")), () => null);
  // The manifest names every mesh and says where the pages are. The boot pack is fetched whole, and the rest as it is
  // wanted. The sound library starts once the sounds' rows have come.
  const core = parseManifest(await manifestText);
  const bootBytes = fetchBytes(fetch, `assets/${core.files[core.boot]!.name}`);
  // Each part is checked against the hash its head names as it is read.
  const loader = await loading, { head, hf, nodes, content: land } = loader.staged;
  showStage(1);
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
  showStage(2);
  const socket = await early;
  await reactionCurves;
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
    tops: loader.staged.tops,
    buildings: loader.staged.buildings,
    tideEyes: head.tideEyes,
    orbs: head.orbs,
    ...(land ? { landmarks: land.landmarks } : {}),
  });
  // Riding out a restart (client/core/waiting.ts). The page learns which start of the server it is on, and when the
  // server says "go", or the connection closes with no word, it notes who to bring back, for this tab alone.
  const tooled = selfcheck || bench !== null || device !== null || params.has("look") || params.has("trip");
  const waitAt = waitKey(location.pathname);
  let was: Comeback | null = null;
  try { was = readComeback(sessionStorage.getItem(waitAt)); } catch {}
  let ready: Ready | null = null;
  const askReady = (): Promise<Ready | null> => fetch("ready.json", { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).then(readReady, () => null);
  const comeback = (why: Comeback["why"]): Comeback => ({ name: session.name, password: launch?.password ?? params.get("password") ?? "", spectate: params.has("spectate"), started: ready?.started ?? 0, map: ready?.map ?? "", why, at: Date.now(), tries: was?.why === "lost" ? was.tries : 0 });
  const keep = (c: Comeback): void => { try { sessionStorage.setItem(waitAt, JSON.stringify(c)); } catch {} };
  /** Back into the game as the same survivor: the launch the game page reads, and a count of the tries in a row. */
  const comeIn = (c: Comeback): void => {
    try { sessionStorage.setItem(launchKey(new URL("play.html", location.href).pathname), JSON.stringify({ intent: "resume", name: c.name, password: c.password })); } catch {}
    keep({ ...c, tries: c.tries + 1 });
    location.replace(backAddress(c));
  };
  /** The connection closed with no word: the page waits where it is, and comes back when the server answers. */
  const waitHere = (why: Comeback["why"] = "lost"): void => {
    if (tooled || session.sessionState === SESSION_CREATING) return;
    const c = comeback(why);
    waitOut(c, { now: () => Date.now(), ask: askReady, later: (run, ms) => void setTimeout(run, ms), random: () => Math.random(), say: (line) => void (session.waiting = line), enter: () => comeIn(c) });
  };
  void session.welcomed.then(async () => {
    if (session.state !== "active" || tooled) return;
    ready = await askReady();
    // A session that has lasted is no longer one of a row that keeps dropping.
    setTimeout(() => { if (session.state === "active") { was = null; try { sessionStorage.removeItem(waitAt); } catch {} } }, SETTLED_MS);
  });
  session.onLost = () => waitHere();
  session.onRestart = (go) => {
    if (!go || tooled) return;
    // A survivor still being made has nothing to come back to: the title makes it again.
    if (session.sessionState === SESSION_CREATING) return void location.replace("./");
    keep({ ...comeback("restart"), tries: 0 });
    // The waiting page must be fetched while the server still answers. If it cannot be, the page waits where it is.
    fetch("wait.html", { cache: "no-store", signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? location.replace("wait.html") : waitHere("restart")), () => waitHere("restart"));
  };
  let createSeq=0, createFailed=false;
  if(launch){
    const chosen=launch;
    void session.welcomed.then(()=>{
      if(session.state==="closed")return;
      if(chosen.intent==="create" && session.sessionState===SESSION_CREATING)createSeq=session.create(Uint8Array.from(chosen.look!),chosen.spawn);
    });
  }
  const surfaces = checks ? new checks.SelfcheckSurfaces(manifest, port) : null;
  const app = new App(session, reg, pack, { manifest, port: surfaces ?? port });
  app.mapLoader = loader;
  // The data utility's record of each frame comes as its own file, which the first frame does not wait for (D899).
  void import("../core/assets/frames.ts").then((m) => (app.frames = new m.FrameRing()));
  // The debug bar's part that needs the browser, fetched once the bar is first on; it takes the page's log from then.
  app.debugPort = () => import("../debug/debug-port.ts").then((m) => m.debugPort(canvas, renderer, PassClock, logTo));
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
  const save = (): void => { if (!measured) try { localStorage.setItem("snark.interface", app.ui.settings.interfacePreferences()); if (app.hammer) localStorage.setItem("snark.templates", app.hammer.templates.serialize()); } catch {} };
  if (!measured) try { app.ui.settings.restoreInterface(localStorage.getItem("snark.interface")); } catch {}
  // The templates the template hammer has copied are kept on this device, beside the interface's preferences. The hammer
  // is given them when the editor's code comes (editor-load.ts).
  if (!measured) try { app.savedTemplates = localStorage.getItem("snark.templates"); } catch {}
  app.copyText = (text) => void navigator.clipboard?.writeText(text).catch(() => {});
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
  app.plainSky = selfcheck; app.fromEye = measured || params.has("look") || params.has("trip");
  app.ui.settings.touchFirst = matchMedia("(pointer: coarse)").matches;
  if (app.ui.settings.touchFirst) session.parkMost = PARK_CHUNKS_TOUCH;
  if (app.ui.settings.touchFirst) app.ui.inputDevice = 2;
  // The textures the card makes come as a file of their own, which the first frame does not wait for; a touch-first device makes none.
  if (!app.ui.settings.touchFirst) void import("../core/texgen/late.ts").then((m) => renderer.makeWith((app.texgen = m.texgen(renderer.gl))), () => {});
  // A map with an orb fetches its screens as a file of their own: their program is begun when it lands.
  if (head.orbs?.length) void import("../core/render/orb-late.ts").then(() => renderer.late(), () => {});
  // What the screen's own edges take (a notch, a home bar), which the page's padding measures: the interface keeps clear of them.
  const edges = (): void => { const s = getComputedStyle(document.body); [s.paddingLeft, s.paddingTop, s.paddingRight, s.paddingBottom].forEach((side, i) => (app.insets[i] = parseFloat(side) || 0)); };
  edges();
  addEventListener("resize", edges);
  if (!measured) app.ui.settings.start({ renderer: renderer.rendererName, light: renderer.light > 0, memory: (navigator as { deviceMemory?: number }).deviceMemory });
  app.dpr = devicePixelRatio;
  app.tierReady = (tier) => renderer.ready(tier);
  app.address((name) => params.get(name), measured, orders);
  // A trip's page is a tool's too: nobody is at it to unmute, and its pictures are of the world.
  if (params.has("trip")) app.ui.settings.muted = false;
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
  // canvas, and sends it with its record of play. Its code (core/light-capture.ts) comes at the first press.
  let light: import("../core/light-capture.ts").LightCapture | null = null, copy: CanvasRenderingContext2D | null = null, sampleW = 0, sampleH = 0;
  const say = (line: string): void => (console.log(line), app.ui.chat.print(TEXT_NOTICE, line, session.serverTick));
  const capture = (): Promise<void> => import("../core/light-capture.ts").then((m) => {
    light ??= new m.LightCapture();
    sampleW = m.SAMPLE_W;
    sampleH = m.SAMPLE_H;
    copy ??= Object.assign(document.createElement("canvas"), { width: sampleW, height: sampleH }).getContext("2d", { willReadFrequently: true })!;
    if (light.start(performance.now())) say("Capturing the light of every frame for ten seconds");
  });
  if (!measured) void fetch("__play").then((r) => r.status === 204 && addEventListener("keydown", (e) => void (e.code === "F9" && capture())), () => {});
  // A device probe runs by itself, and a touch must not move or open anything.
  if (!device) bindInput(canvas, app);
  // Voice plays once the session has its token and the viewer has touched the page.
  // The world's sounds and the voices share one audio context.
  const sound = SoundIo.supported ? new SoundIo(app.ui.settings.touchFirst) : null;
  app.sound = sound;
  // A map with an orb plays its screen's video through a file of its own.
  if (head.orbs?.length) void import("./screen-video.ts").then((m) => (app.screenHost = m.videoHost(sound)), () => {});
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
  const progress = checks ? new checks.SelfcheckProgress() : null;
  const drivingCheck = checks ? new checks.ActivitySelfcheck(params) : null;
  const drive = drivingCheck?.vehicle?.data;

  function showEntryProblem(){
    bootError(createFailed ? "This spawn is unavailable. Choose another starting area."
      : session.closeReason === REJECT_PASSWORD ? "Incorrect server password."
      : session.closeReason === REJECT_NAME ? "This survivor is unavailable." : "Disconnected from world.");
  }
  let restored = 0;
  if (selfcheck) Object.assign(globalThis, { snarkProbe: () => ({ ...probeProgress(app), frames: progress!.frames, still: progress!.still, cache: port.cache, glErrors: renderer.errors, drawCalls: renderer.drawCalls, drive, dinosaur: drivingCheck?.dinosaur?.data }) });
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

  // The touch layer's layout and its art's stand-in are fetched by a page a finger has used, and by no other.
  let layering = false;
  let savedRevision = app.ui.settings.revision, savedAt = 0;
  // The hammer's templates as they came with it, so only a change after that is saved.
  let savedTemplates = -1;
  // Where each frame was, for the debug bar's chart of it (App.shellMarks).
  const marks = app.shellMarks;
  const frame = (now: number): void => {
    if(launch && (session.state==="closed" || createFailed)){showEntryProblem();return;}
    if(launch && session.state==="active" && session.sessionState!==SESSION_CREATING){
      try {sessionStorage.setItem(entryKey,JSON.stringify({intent:"resume",password:launch.password,name:launch.name}));localStorage.setItem("snark.name",launch.name);localStorage.setItem("snark.played."+new URL("./",location.href).href,JSON.stringify({name:launch.name,time:Date.now()}));} catch {}
      launch=null;
    }
    requestAnimationFrame(frame);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const t0 = (marks[0] = performance.now());
    app.gamepads(document.hasFocus() ? navigator.getGamepads?.() ?? [] : [], now);
    if (app.ui.touch && !app.ui.layer && !layering) { layering = true; void import("../core/ui/touch.ts").then((m) => (app.ui.layer = m), () => (layering = false)); }
    if (!app.ui.wantsPointerLock && document.pointerLockElement) document.exitPointerLock();
    if (bench) app.autopilot(params.has("still") ? -1 : bench.since(now), bench.clock(now));
    drivingCheck?.step(app, now);
    voice.sync(session.voice);
    if (voiceCheck && voice.report.status === "listening") voice.talk(true);
    if (app.scene) app.scene.assets.format = renderer.format;
    marks[1] = performance.now();
    const packet = app.frame(now, cssWidth, cssHeight);
    marks[2] = performance.now();
    drivingCheck?.observe(app);
    const templates = app.hammer?.templates.revision ?? -1;
    if (savedTemplates < 0) savedTemplates = templates;
    if ((savedRevision !== app.ui.settings.revision || savedTemplates !== templates) && now - savedAt > 250) {
      savedRevision = app.ui.settings.revision; savedTemplates = templates; savedAt = now;
      save();
    }
    view.apply(app.ui.frame, cssHeight);
    if (!packet) {
      if (session.state === "closed") splash.hidden = true;
      return;
    }
    const built = (marks[3] = performance.now());
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
    if (light?.on && copy) {
      copy.drawImage(canvas, 0, 0, sampleW, sampleH);
      const sent = light.frame(now, packet, app, copy.getImageData(0, 0, sampleW, sampleH).data, { userAgent: navigator.userAgent, dpr: devicePixelRatio, renderer: renderer.rendererName, format: renderer.format });
      if (sent) void Promise.all(sent.map((part) => fetch("__play", { method: "POST", body: part }).then((r) => r.ok, () => false))).then((ok) => say(ok.every(Boolean) ? `Light capture saved in the record of play, ${sent.length} parts` : `Light capture: ${ok.filter((o) => !o).length} of ${sent.length} parts not saved`));
    }
    if (!splash.hidden && !(launch?.intent === "create" && session.sessionState === SESSION_CREATING)) {
      splash.hidden = true;
      performance.mark("snark-first-world-frame");
    }
    if (renderer.failed.length + renderer.failedTextures.length > 0) {
      for (const slot of renderer.failed) app.scene?.assets.residency.failed(slot);
      for (const t of renderer.failedTextures) app.scene?.assets.residency.failedTexture(t);
      app.pressure();
    }
    const ours = (marks[4] = performance.now()) - t0, gpu = clock?.take() ?? UNTIMED;
    app.drawn(packet, ours, width, height, renderer.uploadMs, built - t0);
    device?.frame(now, packet, t0, built);
    if (progress?.frames === 30) loser?.loseContext();
    // The self-check asks for a call and listens for it leaving the volume.
    if (selfcheck && sound && progress!.frames >= 0) {
      if (progress!.frames === 30) app.ui.local?.("sound call");
      sound.listen();
    }
    if (progress?.frames === 45) loser?.restoreContext();
    const r = app.scene!.assets.residency;
    const result = bench?.frame(now, ours, gpu, packet, r.flying + r.waiting === 0, { drawCalls: renderer.drawCalls, canvas: [width, height], renderer: renderer.rendererName, userAgent: navigator.userAgent, card: { bytes: r.ledger, textures: r.texLedger }, squeeze: app.scene!.budget.squeeze, map: () => loader.progress() }, app.scene!.assets.table.tris);
    if (result) document.title = `SNARK ${result.frameMs.median} ms`;
    if (result) void fetch("__bench", { method: "POST", body: JSON.stringify(result) });

    // The self-check reads pixels back and reports on the 90th drawn frame. With voice it first waits for a
    // second of played voice, or for ten seconds to report that none was.
    const voiced = voiceCheck || voiceListen;
    // Parts are written to disk a little after they arrive. The report waits until that has been still for half a second.
    if (checks && progress && drivingCheck && progress.advance(performance.now() - t0, port.cache,!packet.lit || surfaces!.done, voiced, voice.report.played, drivingCheck.finished)) {
      const report = checks.selfcheckReport(app, pack, manifest, hf, packet, {
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
  showStage(3);
  await loader.follow(() => session.mapFocus, { say: (line) => app.ui.console.print(line), arriving: (statics, whole) => session.staticsSteps(statics, whole), held: () => session.behind });
  showStage(4);
  // The interface takes the page's line from here.
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button, finger) => app.pointer(kind, key, x, y, button, finger), typing: () => app.ui.typing });
  requestAnimationFrame(frame);
}

(device ? device.before().then((go) => (go ? boot() : undefined)) : boot()).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  bootError(message);
  device?.fail(message);
  if (selfcheck) void fetch("__selfcheck", { method: "POST", body: JSON.stringify({ ok: false, error: message }) });
});
