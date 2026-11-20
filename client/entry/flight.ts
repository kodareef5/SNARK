// A menu scene owns only a renderer. It has no gameplay connection, player slot or input channel.
import { GlRenderer } from "../shell/gl.ts";
import { WorkerPort } from "../assets/port.ts";
import { WorkerCityMaker } from "../city/maker.ts";
import { Scene, type RenderWorld } from "../core/render/scene.ts";
import { Camera } from "../core/render/camera.ts";
import { giveSky } from "../core/render/sky.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { GEAR_WORN } from "../../shared/sim/entities.ts";
import { LOOK_BYTES, defaultLook, validLook } from "../../shared/anim/look.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { MapLoader } from "../core/mapload.ts";
import { fetchBytes, fetchContent, nextTask, withLandmarks } from "../core/fetched.ts";
import { RemoteSample } from "../core/session.ts";
import { forTouch, startingTier, tierOf } from "../core/assets/tiers.ts";
import { flightPosition, MIAMI_FLIGHT as route, studioGround } from "../core/title-route.ts";

import "../core/render/city-late.ts";
import { heroMeshes, shorePalms, shoreLight, prepareShore, type Shore, mountRex, shoreView } from "../core/title-shore.ts";
import { OPENING_SHOT, validShot } from "../../shared/title-scene.ts";

const params = new URLSearchParams(location.search);
const still = params.has("still");
const plateSeconds = Number(params.get("still") || 3);
const live = params.has("set");
let posterRequest = 0,
  posterPortrait = false;
let preset = OPENING_SHOT,
  aimX = 0,
  aimY = 0,
  mx = 0,
  my = 0;
const notify = (type: string) => parent.postMessage({ source: "snark-scene", type }, location.origin);
const canvas = document.querySelector("canvas")!;
const capture = params.has("retake");
let shot = capture ? "flight" : "survivor",
  seconds = live ? (still && Number.isFinite(plateSeconds) ? Math.max(0, Math.min(3600, plateSeconds)) : 0) : (route.poster as number),
  paused = false,
  turn = 0.25,
  yaw = 0,
  pitch = 0,
  focused = 0;
let appearance = defaultLook();
let reset = false,
  subjectLeft = true;
addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.source !== "snark-title") return;
  const m = event.data;
  if (live) {
    if (Number.isSafeInteger(m.posterRequest) && m.posterRequest > 0) {
      posterRequest = m.posterRequest;
      posterPortrait = m.portrait === true;
    }
    if (validShot(m.preset)) preset = m.preset;
    if (Number.isFinite(m.mx)) aimX = Math.max(-1, Math.min(1, m.mx));
    if (Number.isFinite(m.my)) aimY = Math.max(-1, Math.min(1, m.my));
  }
  if (m.shot === "flight" || m.shot === "survivor") shot = m.shot;
  subjectLeft = m.subjectLeft !== false;
  if (typeof m.paused === "boolean") paused = m.paused;
  if (Number.isFinite(m.turn)) turn = m.turn;
  if (Number.isFinite(m.yaw)) yaw = Math.max(-route.camera.yawLimit, Math.min(route.camera.yawLimit, m.yaw));
  if (Number.isFinite(m.pitch)) pitch = Math.max(-route.camera.pitchLimit, Math.min(route.camera.pitchLimit, m.pitch));
  if (Number.isInteger(m.spawn)) focused = Math.max(0, m.spawn);
  if (Array.isArray(m.look) && m.look.length === LOOK_BYTES) {
    const value = Uint8Array.from(m.look);
    if (validLook(value)) appearance = value;
  }
  reset = true;
});

async function start() {
  const shorePrep = live
    ? fetch("title/wynwood-shore.json", { priority: "high" }).then(async (r) => {
        if (!r.ok) throw Error("Miami shore unavailable");
        return prepareShore((await r.json()) as Shore);
      })
    : null;
  const active = live
    ? fetch("/cluster/title-scene.json", { signal: AbortSignal.timeout(3500) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    : null;
  const metadata = fetch("entry-media.json").then((r) => r.json());
  const assets = fetch("assets/manifest.json")
    .then((r) => r.text())
    .then(parseManifest);
  const prep = capture
    ? fetch("map.json")
        .then((r) => r.json())
        .then((named) =>
          MapLoader.start(fetch, named.head, {
            say: () => {},
            wait: (ms) => new Promise((done) => setTimeout(done, ms)),
            pause: nextTask(new MessageChannel()),
          }),
        )
    : null;
  const [core, media] = await Promise.all([assets, metadata]);
  const [loader, boot, base, sky] = await Promise.all([
    prep,
    fetchBytes(fetch, "assets/" + core.files[core.boot]!.name),
    fetchContent(fetch, media.content),
    fetchBytes(fetch, media.sky),
  ]);
  const [shore, published] = await Promise.all([shorePrep, active]);
  if (preset === OPENING_SHOT && validShot(published)) preset = published;
  const hf = shore?.hf ?? loader?.staged.hf ?? studioGround();
  const head = loader?.staged.head ?? { id: "studio", dims: hf.dims, spawns: [] };
  const content = loader?.staged.content;
  const { reg, manifest, pack } = await withLandmarks(fetch, content, base, core, parsePack(new Uint8Array(boot)));
  giveSky(new Uint8Array(sky));
  const renderer = new GlRenderer(canvas, pack, hf, manifest, null);
  // The portrait floor needs no city material sets. Art retakes still draw the live world.
  const touchFirst = matchMedia("(pointer: coarse)").matches;
  const tier = live
    ? forTouch(
        tierOf(
          startingTier({
            touchFirst,
            renderer: renderer.rendererName,
            light: renderer.light > 0,
            memory: (navigator as { deviceMemory?: number }).deviceMemory,
          }),
        ),
        touchFirst,
      )
    : capture
      ? tierOf("high")
      : { ...tierOf("medium"), finishes: 0 };
  const world: RenderWorld & { city?: NonNullable<RenderWorld["city"]> } = {
    mapId: shore ? "core:miami" : head.id,
    tideEyes: shore ? [shore.eye] : loader?.staged.head.tideEyes,
    ...(shore ? { nodes: shorePalms(shore, reg), tops: { tops: shore.tops, maker: new WorkerCityMaker("city-worker.js", 1) } } : {}),
    dims: head.dims,
    hf,
    structs: new StructureStore(head.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts),
    landmarks: content?.landmarks,
  };
  const scene = new Scene(world, reg, pack, { manifest, port: new WorkerPort(manifest, "assets", tier.diskBytes, null) });
  // Show the subjects at a useful mip before a fresh visit spends bandwidth on their finest maps.
  // Once the viewer stays, the native residency queue refines the same textures in place.
  scene.assets.tier = live ? { ...tier, texture: 512, finishes: 256, reflectionHz: 0 } : tier;
  scene.assets.format = renderer.format;
  const actors = new RemoteSample(),
    cam = new Camera(),
    flight = new AnimState();
  const cast = shore ? mountRex(actors, shore, reg) : null;
  const focus = shore ? heroMeshes.map((id) => scene.assets.table.find(id)).filter((m) => m >= 0) : undefined;
  const readyToReveal = () => {
    if (!focus?.length) return false;
    return focus.every((mesh) => {
      if (!scene.assets.known(mesh)) return false;
      const level = scene.assets.heldLevel(mesh, 0);
      if (level < 0) return false;
      return !scene.assets.table.sections[mesh]![level]?.length || scene.assets.residency.textured(mesh, level);
    });
  };
  const mount = reg.index.get(route.mount)!,
    rider = reg.index.get(route.rider)!;
  flight.mode = MODE_FLYER;
  flight.grounded = false;
  flight.setMotion(0, 12, 0, 0);
  const first = head.spawns[0] ?? { x: hf.sizeX / 2, z: hf.sizeZ / 2 };
  let complete = false,
    frames = 0,
    city = 0;
  await loader?.follow(() => ({ x: cam.x || first.x, z: cam.z || first.z, vx: 0, vz: 0 }), {
    arrived: (statics) => {
      world.city = { statics: new CityStatics(head.dims, statics, reg), complete: () => false, maker: new WorkerCityMaker() };
      complete = true;
    },
  });
  const update = () => {
    const w = posterRequest ? (posterPortrait ? 540 : 960) : canvas.clientWidth,
      h = posterRequest ? (posterPortrait ? 960 : 540) : canvas.clientHeight;
    if (!w || !h) return;
    const ratio = posterRequest
      ? 1
      : live
        ? Math.min(devicePixelRatio, 1.5, (tier.name === "high" ? 1920 : 1100) / w, 1080 / h)
        : Math.min(devicePixelRatio, capture ? 1 : Math.min(1, 1400 / w));
    canvas.width !== Math.round(w * ratio) && (canvas.width = Math.round(w * ratio));
    canvas.height !== Math.round(h * ratio) && (canvas.height = Math.round(h * ratio));
    cam.aspect = w / h;
    cam.fovY = 0.88;
    const flying = (shot === "flight" || shot === "splash") && head.id === route.map;
    if (cast) shoreView(scene, cam, actors, preset, seconds, mx, my, cast);
    else {
      actors.count = shot === "region" ? 0 : flying ? 2 : 1;
      actors.tick = seconds * 30;
      const i = flying ? 1 : 0;
      actors.id[i] = 2;
      actors.gen[i] = 1;
      actors.kind[i] = rider;
      actors.seat[i] = flying ? 2 : 0;
      actors.hasLook[i] = 1;
      actors.look.set(appearance, i * LOOK_BYTES);
      actors.anim[i] = 0;
      if (flying) {
        const [x, y, z] = flightPosition(seconds) as [number, number, number];
        const next = flightPosition(seconds + 0.05);
        const heading = Math.atan2(next[0]! - x, next[2]! - z);
        actors.kind[0] = mount;
        actors.id[0] = 1;
        actors.gen[0] = 1;
        actors.hasLook[0] = 0;
        actors.gear[GEAR_WORN] = reg.index.get(route.saddle)!;
        actors.seat[0] = 0;
        actors.anim[0] = flight.pack();
        actors.x[0] = actors.x[1] = x;
        actors.y[0] = actors.y[1] = y;
        actors.z[0] = actors.z[1] = z;
        actors.yaw[0] = actors.yaw[1] = heading;
        const close = shot === "splash",
          angle = heading + (close ? -1.42 : route.camera.angle) + yaw,
          length = close ? 6.2 : route.camera.distance,
          height = (close ? 1.15 : route.camera.height) + pitch * 5;
        cam.x = x - Math.sin(angle) * length;
        cam.z = z - Math.cos(angle) * length;
        cam.y = y + height;
        cam.yaw = angle + 0.13;
        cam.pitch = -0.135 - pitch * 0.5;
      } else if (shot === "region") {
        const p = head.spawns[focused] ?? first;
        const angle = Math.atan2(hf.sizeX * 0.54 - p.x, hf.sizeZ * 0.54 - p.z);
        cam.x = p.x - Math.sin(angle) * 185;
        cam.z = p.z - Math.cos(angle) * 185;
        cam.y = Math.max(hf.heightAt(p.x, p.z), hf.heightAt(cam.x, cam.z)) + 92;
        cam.yaw = angle;
        cam.pitch = -0.36;
        cam.fovY = 0.78;
      } else {
        actors.gear[GEAR_WORN] = 0;
        const p = head.spawns[focused] ?? first;
        actors.x[0] = p.x;
        actors.z[0] = p.z;
        actors.y[0] = hf.heightAt(p.x, p.z);
        actors.yaw[0] = turn;
        const left = shot === "portrait-left" || (shot !== "portrait" && subjectLeft);
        const side = cam.aspect > 1.1 ? (left ? 1.15 : -1.25) : 0;
        cam.x = p.x + side;
        cam.z = p.z + (cam.aspect > 1.1 ? 3.4 : 4.8);
        cam.y = actors.y[0]! + 1.25;
        cam.yaw = Math.PI;
        cam.pitch = cam.aspect > 1.1 ? -0.095 : -0.32;
      }
      scene.hour = flying ? route.hour : 11;
      scene.eyeSeconds = seconds;
    }
    scene.now = seconds * 1000;
    scene.canvasWidth = canvas.width;
    scene.canvasHeight = canvas.height;
    scene.viewHeight = canvas.height;
    scene.viewDistance = 5500;
    const packet = scene.build(cam, actors, focus, live ? performance.now() : scene.now);
    if (shore) shoreLight(packet);
    renderer.draw(packet);
    if (posterRequest) {
      const webp = canvas.toDataURL("image/webp", 0.84);
      const picture = webp.startsWith("data:image/webp;") ? webp : canvas.toDataURL("image/jpeg", 0.82);
      parent.postMessage({ source: "snark-scene", type: "poster", request: posterRequest, picture }, location.origin);
      posterRequest = 0;
    }
    city = scene.city?.drawn.reduce((a, b) => a + b, 0) ?? 0;
    frames++;
    if (frames === 1) notify("frame");
  };
  const started = performance.now();
  let prior = started,
    announced = false,
    settle = 0;
  if (still && live)
    Object.assign(window, {
      titleRetake: () => ({
        frames,
        assets: scene.assets.line(),
        blocks: scene.blocks?.stats,
        elapsed: seconds,
        hero: focus?.map((m) => [scene.assets.manifest.meshes[m]!.id, scene.assets.heldLevel(m, 0)]),
      }),
    });
  let lastRender = -Infinity,
    quiet = 0,
    refineAfter = Infinity;
  const interval = !live ? 0 : tier.name === "high" ? 1000 / 30 : 1000 / 24;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - prior) / 1000);
    if (!paused && !still && !capture && !document.hidden) {
      seconds += dt;
      const smooth = 1 - Math.exp(-dt * 5);
      mx += (aimX - mx) * smooth;
      my += (aimY - my) * smooth;
    }
    prior = now;
    if (live && now >= refineAfter && !document.hidden && (!paused || still)) {
      scene.assets.tier = { ...tier, reflectionHz: 0 };
      refineAfter = Infinity;
    }
    if (reset) settle = 20;
    if (
      !document.hidden &&
      now - lastRender >= interval - 0.6 &&
      (!paused || settle > 0 || !announced || capture || scene.assets.residency.flying > 0 || scene.assets.residency.waiting > 0)
    ) {
      update();
      lastRender = now;
      if (
        live &&
        announced &&
        refineAfter === Infinity &&
        scene.assets.residency.flying === 0 &&
        scene.assets.residency.waiting === 0 &&
        (scene.blocks?.stats.draws ?? 0) > 0
      ) {
        if (++quiet === 5) document.body.dataset.settled = "true";
      } else quiet = 0;
      settle--;
    }
    reset = false;
    if (
      !announced &&
      frames > 12 &&
      (shore
        ? readyToReveal() || (now - started > 6500 && focus!.every((m) => scene.assets.held(m) !== 0))
        : shot === "survivor" || (complete && city > 0))
    ) {
      announced = true;
      if (live) refineAfter = now + 1200;
      document.body.dataset.ready = "true";
      notify("ready");
    }
    if (live && !announced && !document.hidden && now - started > 20000 && scene.assets.residency.stats.dead > 0) {
      notify("failed");
      return;
    }
    requestAnimationFrame(frame);
  }
  if (capture)
    Object.assign(window, {
      snarkShot: (time: number, view: string, region = 0) => {
        focused = region;
        seconds = time;
        shot = view;
        update();
        return {
          ready: complete,
          frames,
          city,
          pending: scene.assets.residency.flying + scene.assets.residency.waiting,
          mount: reg.ids[mount],
          rider: reg.ids[rider],
          map: head.id,
        };
      },
    });
  canvas.addEventListener("webglcontextlost", () => notify("failed"), { once: true });
  requestAnimationFrame(frame);
}
start().catch((e) => {
  console.error(e);
  document.body.dataset.error = String(e);
  notify("failed");
});
