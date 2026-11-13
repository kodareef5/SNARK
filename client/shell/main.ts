// Browser entry point. Loads assets, connects, and each frame passes input to
// the session, asks the scene for a frame packet, and hands it to WebGL.

import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { PROVING_ID, buildProvingHeightfield, provingMapHash } from "../../shared/world/proving.ts";
import { HudModel, minimapImage, updateHud } from "../core/hud.ts";
import { Camera } from "../core/render/camera.ts";
import { Scene } from "../core/render/scene.ts";
import { probePasses, provingProbes } from "../core/selfcheck.ts";
import { ClientSession, RemoteSample } from "../core/session.ts";
import { GlRenderer } from "./gl.ts";
import { HudView } from "./hud.ts";
import { Input } from "./input.ts";
import { connect } from "./socket.ts";

const params = new URLSearchParams(location.search);

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
const selfcheck = params.has("selfcheck");
const status = document.querySelector<HTMLElement>("#status")!;

async function boot(): Promise<void> {
  const reg = compileContent(CORE_CONTENT).registry!;
  const pack = parsePack(new Uint8Array(await (await fetch("assets/core.snpk")).arrayBuffer()));
  const hf = buildProvingHeightfield();
  const mapHash = provingMapHash(hf);
  const canvas = document.querySelector<HTMLCanvasElement>("#view")!;
  const renderer = new GlRenderer(canvas, pack, hf);
  const input = new Input(canvas);
  const session = new ClientSession(connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`), {
    name: params.get("name") ?? `survivor${Math.floor(performance.now() * 1000) % 100000}`,
    key: deviceKey(),
    spectate: params.has("spectate"),
    registry: reg,
    resolveMap: (id, hash) => (id === PROVING_ID && hash === mapHash ? hf : null),
  });

  const cam = new Camera();
  const remote = new RemoteSample();
  const hud = new HudModel();
  const hudView = new HudView(document.querySelector("#hud")!, hud, minimapImage(hf, pack.palette, 160), 160);
  let scene: Scene | null = null;
  let frames = 0;
  let fps = 60;
  let last = performance.now();
  const times: number[] = [];

  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    renderer.init();
    scene?.resetUploads();
  });

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    fps += (1000 / Math.max(dt, 1) - fps) * 0.05;
    if (session.state === "closed") {
      status.textContent = `disconnected (reason ${session.closeReason})`;
      return;
    }
    if (!selfcheck) input.sample();
    session.update(now, input.moveX, input.moveZ, input.yaw, input.pitch, input.buttons);
    const world = session.world;
    if (session.state !== "active" || !world) return;
    scene ??= new Scene(world, reg, pack);
    status.textContent = "";

    const width = Math.floor(canvas.clientWidth * devicePixelRatio);
    const height = Math.floor(canvas.clientHeight * devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Eye position: between the last two predicted ticks, so motion is smooth at any frame rate.
    const a = session.alpha;
    cam.x = session.ownPrev.x + (session.own.x - session.ownPrev.x) * a;
    cam.y = session.ownPrev.y + (session.own.y - session.ownPrev.y) * a + 1.62;
    cam.z = session.ownPrev.z + (session.own.z - session.ownPrev.z) * a;
    cam.yaw = input.yaw;
    cam.pitch = input.pitch;
    cam.aspect = width / Math.max(height, 1);
    session.sampleRemote(remote);
    const t0 = performance.now();
    const packet = scene.build(cam, remote);
    renderer.draw(packet);
    times.push(performance.now() - t0);
    updateHud(hud, session, remote, fps);
    hudView.update(hud);

    // Self-check: once the world has arrived, read pixels back and report.
    if (selfcheck && ++frames === 90) {
      const probes = provingProbes(cam, reg, pack.palette, SKY_COLOR, hf, params.has("creature")).map((p) => {
        const rgb = renderer.readPixel(p.sx, p.sy);
        return { name: p.name, expected: p.rgb, got: rgb, ok: probePasses(p, rgb[0], rgb[1], rgb[2]) };
      });
      times.sort((x, y) => x - y);
      const report = {
        ok: probes.every((p) => p.ok),
        userAgent: navigator.userAgent,
        renderer: renderer.rendererName,
        canvas: [width, height],
        probes,
        structures: world.structs.count,
        tiles: packet.tileCount,
        draws: packet.drawCount,
        entitiesDrawn: packet.transientCount,
        drawCalls: renderer.drawCalls,
        triangles: packet.triangles,
        buildAndSubmitMsMedian: times[times.length >> 1],
        snapshots: session.stats.snapshots,
        corrections: session.stats.corrections,
      };
      status.textContent = JSON.stringify(report, null, 2);
      void fetch("__selfcheck", { method: "POST", body: JSON.stringify(report) });
    }
  };
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  status.textContent = message;
  if (selfcheck) void fetch("__selfcheck", { method: "POST", body: JSON.stringify({ ok: false, error: message }) });
});
