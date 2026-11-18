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
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { MapLoader } from "../core/mapload.ts";
import { fetchBytes, fetchContent, nextTask, withLandmarks } from "../core/fetched.ts";
import { RemoteSample } from "../core/session.ts";
import { tierOf } from "../core/assets/tiers.ts";
import { flightPosition, MIAMI_FLIGHT as route } from "../core/title-route.ts";

const notify = (type: string) => parent.postMessage({ source: "snark-scene", type }, location.origin);
const canvas = document.querySelector("canvas")!;
const capture = new URLSearchParams(location.search).has("retake");
let shot = capture ? "flight" : "survivor",
  seconds = route.poster as number,
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
  const media = await (await fetch("entry-media.json")).json();
  const prep = capture ? fetch("map.json").then(r => r.json()).then(named => MapLoader.start(fetch, named.head, {
    say: () => {},
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    pause: nextTask(new MessageChannel()),
  })) : null;
  const core = parseManifest(await (await fetch("assets/manifest.json")).text());
  const [loader, boot, base, sky] = await Promise.all([
    prep,
    fetchBytes(fetch, "assets/" + core.files[core.boot]!.name),
    fetchContent(fetch, media.content),
    fetchBytes(fetch, media.sky),
  ]);
  const dims = { chunksX: 2, chunksZ: 2 };
  const head = loader?.staged.head ?? { id: "studio", dims, spawns: [] };
  const hf = loader?.staged.hf ?? new Heightfield(dims, TERRAIN_CELL, 4, 1 / 64);
  const content = loader?.staged.content;
  const { reg, manifest, pack } = await withLandmarks(fetch, content, base, core, parsePack(new Uint8Array(boot)));
  giveSky(new Uint8Array(sky));
  const renderer = new GlRenderer(canvas, pack, hf, manifest, null);
  // The portrait floor needs no city material sets. Art retakes still draw the live world.
  const tier = capture ? tierOf("high") : { ...tierOf("medium"), finishes: 0 };
  const world: RenderWorld & { city?: NonNullable<RenderWorld["city"]> } = {
    mapId: head.id,
    dims: head.dims,
    hf,
    structs: new StructureStore(head.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts),
    landmarks: content?.landmarks,
  };
  const scene = new Scene(world, reg, pack, { manifest, port: new WorkerPort(manifest, "assets", tier.diskBytes, null) });
  scene.assets.tier = tier;
  scene.assets.format = renderer.format;
  const actors = new RemoteSample(),
    cam = new Camera(),
    flight = new AnimState();
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
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, capture ? 1 : Math.min(1, 1400 / w));
    canvas.width !== Math.round(w * ratio) && (canvas.width = Math.round(w * ratio));
    canvas.height !== Math.round(h * ratio) && (canvas.height = Math.round(h * ratio));
    cam.aspect = w / h;
    cam.fovY = 0.88;
    const flying = (shot === "flight" || shot === "splash") && head.id === route.map;
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
    scene.now = seconds * 1000;
    scene.hour = flying ? route.hour : 11;
    scene.viewHeight = canvas.height;
    scene.viewDistance = 5500;
    const packet = scene.build(cam, actors);
    renderer.draw(packet);
    city = scene.city?.drawn.reduce((a, b) => a + b, 0) ?? 0;
    frames++;
    if (frames === 1) notify("frame");
  };
  let prior = performance.now(),
    announced = false,
    settle = 0;
  function frame(now: number) {
    if (!paused && !capture && !document.hidden) seconds += Math.min(0.1, (now - prior) / 1000);
    prior = now;
    if (reset) settle = 20;
    if (
      !document.hidden &&
      (!paused || settle > 0 || !announced || capture || scene.assets.residency.flying > 0 || scene.assets.residency.waiting > 0)
    ) {
      update();
      settle--;
    }
    reset = false;
    if (!announced && frames > 12 && (shot === "survivor" || (complete && city > 0))) {
      announced = true;
      notify("ready");
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
  requestAnimationFrame(frame);
}
start().catch((e) => {
  console.error(e);
  document.body.dataset.error = String(e);
  notify("failed");
});
