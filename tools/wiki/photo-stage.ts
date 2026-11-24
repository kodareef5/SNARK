/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// A local photography page that uses the game's native render path without joining a world.
import { WorkerPort } from "../../client/assets/port.ts";
import { WorkerCityMaker } from "../../client/city/maker.ts";
import { fetchBytes, fetchContent, nextTask, withLandmarks } from "../../client/core/fetched.ts";
import { MapLoader } from "../../client/core/mapload.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { Scene, type RenderWorld } from "../../client/core/render/scene.ts";
import { giveSky } from "../../client/core/render/sky.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { GlRenderer } from "../../client/shell/gl.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import { defaultLook, LOOK_BYTES, randomLook } from "../../shared/anim/look.ts";
import { AnimState, CUE_ROAR, CUE_TORPOR } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { chunkAt, TICK_RATE } from "../../shared/coords.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { MODE_FLYER, STANCE_CROUCH } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ACT_HOLD, ACT_SWING, HOLD_TOOL } from "../../shared/sim/weapon.ts";
import { CityStatics } from "../../shared/world/city.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { placeLandmark } from "../../shared/world/landmark.ts";
import { nodeLayers } from "../../shared/world/mapfile.ts";
import { formOf, NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { photoChunks, photoPoint, type Position, type SceneBrief } from "./photo-recipe.ts";

const RAD = Math.PI / 180;
const TICK = 504;
const canvas = document.querySelector("canvas")!;

interface Shot {
  recipe: SceneBrief;
  position: Position;
}
const turn = (degrees: number): number => Math.round(degrees * 65536 / 360) & 65535;
const ground = (hf: Heightfield, x: number, z: number): number => Math.max(hf.heightAt(x, z), hf.seaLevel);

function kind(reg: Registry, id: string): number {
  const full = id.includes(":") ? id : `core:${id}`;
  const number = reg.index.get(full);
  if (number === undefined) throw Error(`The shot names an unknown kind "${full}"`);
  return number;
}

function actorsOf(reg: Registry, hf: Heightfield, shot: Shot, rng: Rng): RemoteSample {
  const r = new RemoteSample();
  r.tick = shot.recipe.time === undefined ? TICK : shot.recipe.time * TICK_RATE;
  for (const [id, dx, dz, yaw, pose, altitude = 0, on, saddle, wear] of shot.recipe.actors) {
    const n = r.count++;
    const k = kind(reg, id);
    const def = reg.defs[k]!;
    if (def.type !== "species") throw Error(`The shot actor "${id}" is not a species`);
    const [x, z] = photoPoint(shot.position, dx, dz);
    const anim = new AnimState();
    [r.id[n], r.gen[n], r.kind[n], r.x[n], r.z[n], r.yaw[n], r.flags[n]] = [n + 1, 1, k, x, z, (yaw + shot.position[2]) * RAD, 1];
    r.y[n] = shot.recipe.absoluteHeight ? altitude : ground(hf, x, z) + altitude;
    r.bare[n] = def.vehicle ? 0 : 1;
    r.level[n] = 1;
    if (def.vehicle) {
      r.vehicleGrounded[n] = 1;
      r.vehicleHullCondition[n] = 255;
      r.vehicleFuel[n] = 200;
      r.vehicleEngineCondition[n] = 255;
    }
    if (def.skeleton === "human") {
      r.hasLook[n] = 1;
      r.look.set(pose === "kit" || pose === "driver" || n === 0 ? defaultLook() : randomLook(rng), n * LOOK_BYTES);
    }
    if (pose === "drive") {
      r.vehicleEngineOn[n] = 1;
      r.vehicleGear[n] = 2;
      r.vehicleRpm[n] = 3300;
      r.steering[n] = 0.14;
      r.wheelAngle[n] = 0.72;
      r.vehicleLightMode[n] = 1;
    }
    if (on !== undefined && on >= 0 && on < n) {
      [r.x[n], r.y[n], r.z[n], r.yaw[n]] = [r.x[on]!, r.y[on]!, r.z[on]!, r.yaw[on]!];
      r.seat[n] = r.id[on]! + 1;
      r.seatGen[n] = 1;
      r.seatSlot[n] = 1;
    }
    if (saddle) r.gear[n * GEAR_COUNT + GEAR_WORN] = kind(reg, saddle);
    const tool = reg.index.get(`core:${pose === "chop" ? "hatchet" : pose}`);
    const gear = tool === undefined ? null : reg.defs[tool];
    if (tool !== undefined && gear?.type === "item") {
      r.gear[n * GEAR_COUNT + (gear.saddle ? GEAR_WORN : GEAR_HELD)] = tool;
      if (!gear.saddle) anim.setAction(pose === "chop" ? ACT_SWING : ACT_HOLD, HOLD_TOOL, TICK - 7);
    }
    const outfit = wear ?? (pose === "kit" || pose === "driver" ? "meridian" : undefined);
    if (outfit) for (const [at, piece] of ["hat", "shirt", "gloves", "pants", "boots"].entries()) {
      r.gear[n * GEAR_COUNT + GEAR_WORN + at] = kind(reg, outfit + "_" + piece);
    }
    if (pose === "out") {
      anim.out = true;
      anim.cue = CUE_TORPOR;
      anim.cueStart = TICK - 92;
    }
    if (pose === "roar") {
      anim.cue = CUE_ROAR;
      anim.cueStart = TICK - 8;
    }
    if (pose === "young") {
      r.span[n] = 10000;
      r.grown[n] = TICK + 9750;
    }
    if (pose === "fly") {
      anim.mode = MODE_FLYER;
      anim.grounded = false;
      anim.setMotion(0, 10, 0, 0);
      anim.bank = 2;
    }
    if (pose === "crouch") anim.stance = STANCE_CROUCH;
    r.anim[n] = anim.pack();
    r.cue[n] = anim.packCue();
  }
  return r;
}

async function start() {
  const named = await (await fetch("__wiki-photo-map.json")).json() as { head: string; first: Position };
  const load = MapLoader.start(fetch, named.head, { wait: (ms) => new Promise((done) => setTimeout(done, ms)), pause: nextTask(new MessageChannel()) });
  const manifest = parseManifest(await (await fetch("assets/manifest.json")).text());
  const media = await (await fetch("entry-media.json")).json() as { content: string; sky: string };
  const [loader, base, boot, sky] = await Promise.all([
    load, fetchContent(fetch, media.content), fetchBytes(fetch, "assets/" + manifest.files[manifest.boot]!.name), fetchBytes(fetch, media.sky),
  ]);
  const { head, hf, tops, nodes: layers, content } = loader.staged;
  const { reg, manifest: assets, pack } = await withLandmarks(fetch, content, base, manifest, parsePack(new Uint8Array(boot)));
  giveSky(new Uint8Array(sky));
  const dim = head.dims;
  const structs = new StructureStore(dim, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const source = nodeLayers(dim, hf, reg, layers) ?? { perChunk: 0, at: (_c: number, _i: number, out: { kind: number }) => void (out.kind = 0) };
  const nodes = new NodeField(dim, reg, source);
  const maker = new WorkerCityMaker("city-worker.js", 2);
  const world: RenderWorld & { city?: NonNullable<RenderWorld["city"]> } = {
    mapId: head.id, dims: dim, hf, structs, nodes: nodes.store, tideEyes: head.tideEyes,
    tops: { tops, maker }, landmarks: content?.landmarks,
  };
  const tier = tierOf("high");
  const renderer = new GlRenderer(canvas, pack, hf, assets, null);
  const scene = new Scene(world, reg, pack, { manifest: assets, port: new WorkerPort(assets, "assets", tier.diskBytes, null) });
  scene.assets.tier = tier;
  scene.assets.format = renderer.format;
  scene.viewDistance = 4400;
  const cam = new Camera();
  [cam.x, cam.z] = named.first;
  await loader.follow(() => ({ x: cam.x, z: cam.z, vx: 0, vz: 0 }), {
    arrived(statics) {
      world.city = { statics: new CityStatics(dim, statics, reg), complete: () => false, maker };
    },
  });
  let current: Shot | null = null;
  let people: RemoteSample | null = null;
  let quiet = 0;
  let freeze = 0;
  let frozen = 0;
  let frames = 0;
  let runway = -1;
  let cameraChunk = -1;
  let precise = false;
  let chunks: readonly number[] = [];
  let started = performance.now();
  let built: number[] = [];
  let planted: number[] = [];

  function positionCamera(shot: Shot) {
    const [dx, height, dz, yaw, pitch, fov] = shot.recipe.view;
    [cam.x, cam.z] = photoPoint(shot.position, dx, dz);
    cam.y = shot.recipe.absoluteHeight ? height : ground(hf, cam.x, cam.z) + height;
    cam.yaw = (yaw + shot.position[2]) * RAD;
    cam.pitch = pitch * RAD;
    cam.fovY = fov * RAD;
    cameraChunk = chunkAt(dim, cam.x, cam.z);
  }

  function clearStage() {
    built.forEach((ref) => structs.remove(ref));
    planted.forEach((ref) => nodes.store.remove(ref));
    if (runway >= 0) nodes.retain(runway, 5, -1, () => false);
    built = [];
    planted = [];
    runway = -1;
    people = null;
  }

  function stage(shot: Shot) {
    runway = cameraChunk;
    precise = true;
    const [ox, oz] = shot.position;
    const clear = (chunk: number, index: number): boolean => {
      const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
      source.at(chunk, index, spot);
      return Math.hypot(spot.x - ox, spot.z - oz) < 14;
    };
    nodes.retain(runway, 5, 1, clear, undefined, clear);
    let seed = 19;
    for (const chr of shot.recipe.route) seed = (Math.imul(seed, 33) + chr.charCodeAt(0)) >>> 0;
    const rng = new Rng(seed);
    people = actorsOf(reg, hf, shot, rng);
    const floor = ground(hf, ox, oz);
    for (const [id, dx, dz, yaw = 0, lift = 0] of shot.recipe.props ?? []) {
      const k = kind(reg, id);
      const [x, z] = photoPoint(shot.position, dx, dz);
      const itemFloor = /^(?:foundation|wall|windowframe|doorframe|ceiling)_wood$/.test(id) ? floor : ground(hf, x, z);
      built.push(structs.add(k, x, itemFloor + reg.halfY[k]! + lift, z, turn(yaw + shot.position[2]), 0, 1));
    }
    const ship = LANDMARKS.find((landmark) => landmark.name === shot.recipe.landmark);
    const site = content?.landmarks.find((landmark) => landmark.name === shot.recipe.landmark);
    if (ship && site) for (const p of placeLandmark(ship, site.x, site.y, site.z, site.yaw).statics) {
      built.push(structs.add(kind(reg, p.kind), p.x, p.y, p.z, p.yaw, 0, 1));
    }
    for (const [id, dx, dz, yaw = 0] of shot.recipe.plants ?? []) {
      const k = kind(reg, id);
      const [x, z] = photoPoint(shot.position, dx, dz);
      const y = hf.heightAt(x, z);
      if (y >= hf.seaLevel - .04) planted.push(nodes.store.add(formOf(nodes.forms, k, rng.u32()), x, y, z, turn(yaw), 0, 1));
    }
    scene.hour = shot.recipe.hour;
    scene.eyeSeconds = shot.recipe.eyeSeconds ?? 44;
    scene.viewDistance = shot.recipe.city ? 7500 : 4400;
  }

  Object.assign(window, {
    snarkWikiPhoto: (shot: Shot) => {
      current = shot;
      quiet = frames = freeze = frozen = 0;
      started = performance.now();
      clearStage();
      precise = false;
      chunks = photoChunks(dim, shot.recipe, shot.position);
      positionCamera(shot);
    },
    snarkWikiFreeze: () => { freeze = 2; frozen = 0; },
    snarkWikiPhotoStatus: () => {
      const map = loader.progress();
      return {
        renderer: renderer.rendererName, near: precise, whole: map.whole, left: map.left, roads: map.roads, frames, quiet, frozen,
        pending: scene.assets.residency.flying + scene.assets.residency.waiting,
        milliseconds: performance.now() - started,
        errors: [...renderer.failed, ...renderer.failedTextures],
        city: scene.city?.drawn.reduce((n, b) => n + b, 0) ?? 0,
      };
    },
  });

  function frame(now: number) {
    if (current && frozen < 2) {
      if (!precise && chunks.every((chunk) => hf.exact[chunk] === 1)) {
        positionCamera(current);
        stage(current);
        quiet = 0;
      }
      canvas.width !== canvas.clientWidth && (canvas.width = canvas.clientWidth);
      canvas.height !== canvas.clientHeight && (canvas.height = canvas.clientHeight);
      cam.aspect = canvas.width / canvas.height;
      scene.canvasWidth = canvas.width;
      scene.canvasHeight = scene.viewHeight = canvas.height;
      scene.now = freeze > 0 ? (current.recipe.time ?? TICK / TICK_RATE) * 1000 : now;
      renderer.draw(scene.build(cam, people, undefined, now));
      if (freeze > 0) {
        freeze--;
        frozen++;
      }
      if (!scene.assets.residency.flying && !scene.assets.residency.waiting) quiet++;
      else quiet = 0;
      frames++;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch((e: unknown) => { document.body.dataset.error = String(e); console.error(e); });
