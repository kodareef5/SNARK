// Browser entry point. Each frame it asks the app what to draw, and hands the world to WebGL and the interface to the DOM binder.

import { CORE_CONTENT } from "../../content/core.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { WorkerPort } from "../assets/port.ts";
import { DEFAULT_TIER, tierOf } from "../core/assets/tiers.ts";
import { LEVEL_COLOURS, SKY_COLOR } from "../../shared/pack/palette.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { App } from "../core/app.ts";
import { fetchBytes, fetchJson, fetchText } from "../core/fetched.ts";
import { loadIdentity } from "../core/identity.ts";
import { heldTo, probePasses, provingProbes, type Probe } from "../core/selfcheck.ts";
import { BenchRun, PassClock } from "../core/passes.ts";
import { groundSize } from "../core/render/terrain.ts";
import { ClientSession } from "../core/session.ts";
import { devicePage } from "./device.ts";
import { GlRenderer } from "./gl.ts";
import { bindInput } from "./input.ts";
import { connect } from "./socket.ts";
import { VoiceIo } from "../voice/voice.ts";
import { UiView } from "./ui.ts";
import { VehicleAudio } from "./vehicle-audio.ts";
import { VehicleSelfcheck } from "../core/vehicle-selfcheck.ts";
import { probeProgress } from "../core/diagnostics.ts";

const params = new URLSearchParams(location.search);
const selfcheck = params.has("selfcheck");
const driveCheck = selfcheck && params.has("urbanDrive");
/** A measurement run. The camera flies itself and the page reports frame times and the GPU's by pass. */
const bench = params.has("bench") ? new BenchRun() : null;
/** A device probe (tools/device.ts). The page measures itself and reports. */
const device = params.has("device") ? devicePage(params.get("device")!) : null;
const root = document.querySelector<HTMLElement>("#ui")!;

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
    ...loadIdentity({ getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, (bytes) => { crypto.getRandomValues(bytes); }, params.get("name")),
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
  session.prediction.enabled = selfcheck;
  app.stress = params.has("stress");
  app.debug = app.stress || params.has("debug");
  app.steer = driveCheck || !selfcheck && !device;
  app.plainSky = selfcheck;
  [app.ui.settings.touchFirst, app.dpr] = [matchMedia("(pointer: coarse)").matches, devicePixelRatio];
  app.address((name) => params.get(name), selfcheck || bench !== null || device !== null);
  const clock = (renderer.passes = device ? null : new PassClock(renderer.gl, bench !== null && params.has("passes")));
  const view = new UiView(root, { text: (key, value) => app.textInput(key, value), pointer: (kind, key, x, y, button) => app.pointer(kind, key, x, y, button) });
  // A device probe runs by itself, and a touch must not move or open anything.
  if (!device) bindInput(canvas, app);
  // Voice plays once the session has its token and the viewer has touched the page.
  const voice = new VoiceIo(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/voice`);
  const vehicleAudio = new VehicleAudio();
  app.voice = voice;
  addEventListener("pointerdown", () => { voice.unlock(); vehicleAudio.unlock(); });
  addEventListener("keydown", () => { voice.unlock(); vehicleAudio.unlock(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) vehicleAudio.mute(); });
  addEventListener("pagehide", () => vehicleAudio.dispose());
  /** With ?voice=1 the self-check talks to itself. Its own voice must come back from the server and play. */
  const voiceCheck = selfcheck && params.get("voice") === "1";
  /** With ?voice=listen it only listens to another page, and reports whose voice it played. */
  const voiceListen = selfcheck && params.get("voice") === "listen";
  voice.loop = voiceCheck;
  let frames = 0;
  const times: number[] = [];
  const drivingCheck = driveCheck ? new VehicleSelfcheck() : null;
  const drive = drivingCheck?.data;

  let restored = 0;
  let keptBefore = 0;
  let still = 0;
  if (selfcheck) Object.assign(globalThis, { snarkProbe: () => ({ ...probeProgress(app), frames, still, cache: port.cache, glErrors: renderer.errors, drawCalls: renderer.drawCalls, drive }) });
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
    if (bench) app.autopilot(bench.since(now));
    drivingCheck?.step(app, now);
    voice.sync(session.voice);
    if (voiceCheck && voice.report.status === "listening") voice.talk(true);
    if (app.scene) app.scene.assets.format = renderer.format;
    const packet = app.frame(now, cssWidth, cssHeight);
    vehicleAudio.update(app.vehicleTelemetry, !document.hidden && session.state === "active");
    drivingCheck?.observe(app);
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
    const [ours, gpu] = [performance.now() - t0, clock?.take() ?? []];
    app.drawn(packet, ours, gpu);
    device?.frame(now, packet, t0, built);
    if (frames === 30) loser?.loseContext();
    if (frames === 45) loser?.restoreContext();
    times.push(performance.now() - t0);
    const r = app.scene!.assets.residency;
    const result = bench?.frame(now, ours, gpu, packet, r.flying + r.waiting === 0, { drawCalls: renderer.drawCalls, canvas: [width, height], renderer: renderer.rendererName, userAgent: navigator.userAgent });
    if (result) document.title = `SNARK ${result.frameMs.median} ms`;
    if (result) void fetch("__bench", { method: "POST", body: JSON.stringify(result) });

    // The self-check reads pixels back and reports on the 90th drawn frame. With voice it first waits for a
    // second of played voice, or for ten seconds to report that none was.
    const voiced = voiceCheck || voiceListen;
    // Parts are written to disk a little after they arrive. The report waits until that has been still for half a second.
    still = port.cache.used === keptBefore ? still + 1 : 0;
    keptBefore = port.cache.used;
    if (selfcheck && frames >= 0 && ++frames >= 90 && still >= 30 && (!drive || drive.finished) && (!voiced || voice.report.played >= 50 || frames >= 690)) {
      frames = -1;
      const heard = !voiced || (voice.report.played >= 50 && voice.report.odd === 0 && voice.report.errors === 0 && (!voiceListen || voice.report.heard.length > 0));
      // In the stress scene three rocks hang in the sky, each drawn at another level, and a level is all one colour.
      const rocks = app.marks.map((m) => ({ ...m, drawn: app.scene!.things[m.thing]!.level }));
      const at = [0, 0, 0];
      const stressed = rocks.flatMap((m): Probe[] => (app.cam.project(m.x, m.y, m.z, at) ? [{ name: `rock at level ${m.level}`, sx: at[0]!, sy: at[1]!, rgb: [0, 1, 2].map((c) => pack.palette[LEVEL_COLOURS[m.level]! * 4 + c]!) as Probe["rgb"], mode: "hue" }] : []));
      const probes = [...provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, params.has("creature"), packet), ...stressed].map((p) => {
        const got = renderer.readPixel(p.sx, p.sy);
        return { name: p.name, expected: heldTo(p, got[0], got[1], got[2]), got, ok: probePasses(p, got[0], got[1], got[2]) };
      });
      times.sort((x, y) => x - y);
      const misplaced = view.misplaced(app.ui.frame);
      const urban = params.has("urban") ? (() => {
        const drawn = Array.from(packet.drawMesh.subarray(0, packet.drawCount), index => manifest.meshes[index]?.id ?? "");
        const vehicles = drawn.filter(id => id.startsWith("urban:compact"));
        const humans = drawn.filter(id => id.startsWith("core:human"));
        const seats = Array.from(app.remote.seatSlot.subarray(0, app.remote.count)).filter(slot => slot > 0);
        const driving = drive ? { ...drive, ownKind: reg.ids[session.own.kind], audio: { ...vehicleAudio.report }, ok: !drive.timedOut && drive.maxSpeed > 3 && drive.hud && session.driving >= 0 } : null;
        return { vehicles, humans, seats, ownKind: reg.ids[session.own.kind], ...(driving ? { driving } : {}), ok: vehicles.length > 0 && humans.length > 0 && seats.length > 0 && renderer.errors === 0 && (!driving || driving.ok) };
      })() : null;
      const report = {
        // A listening page has the talking page's body in view, so its picture is not the fixed one and the probes do not count.
        ok: (driveCheck || voiceListen || probes.every((p) => p.ok)) && (!urban || urban.ok) && misplaced === 0 && heard && restored === (params.has("lose") ? 1 : 0) && packet.skipped === 0 && packet.dropped === 0 && stressed.length === (app.stress ? 3 : 0) && rocks.every((m) => m.drawn === m.level),
        ...(urban ? { urban } : {}),
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
        progress: selfcheck ? probeProgress(app) : undefined,
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
