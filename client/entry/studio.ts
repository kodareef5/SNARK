// The wiki studio uses the game renderer on a beach or an open-water stage.

import { GlRenderer } from "../shell/gl.ts";
import { WorkerPort } from "../assets/port.ts";
import { Scene, type RenderWorld } from "../core/render/scene.ts";
import { Camera } from "../core/render/camera.ts";
import { giveSky } from "../core/render/sky.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { withContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { GEAR_HELD } from "../../shared/sim/entities.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fetchBytes, fetchContent, fetchJson, fetchText, withLandmarks } from "../core/fetched.ts";
import { RemoteSample } from "../core/session.ts";
import { tierOf } from "../core/assets/tiers.ts";
import { STUDIO_SHORE, STUDIO_TINTS, studioGround } from "../core/title-route.ts";
import { clipOf, creatureMoves, firstMove, humanMoves, type Move, type MoveGroup } from "../core/studio/moves.ts";
import { Playback, SPEEDS } from "../core/studio/clock.ts";
import { Orbit, pinchZoom } from "../core/studio/orbit.ts";
import { boundsOf, landmarkBounds, studioStatic, subjectOf, type WikiModel } from "../core/studio/subject.ts";
import type { ManifestMesh } from "../../shared/pack/manifest.ts";
import type { Clip } from "../../shared/anim/clip.ts";

const notify = (type: string, detail = "") => parent.postMessage({ source: "snark-studio", type, detail }, location.origin);
const canvas = document.querySelector("canvas")!;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const BODY = 1;

const STUDIO_PROP = "studio:mesh";
const MODEL_FILE = /^\/wiki\/media\/model-[a-z0-9_.-]+\.json$/i;

async function modelFrom(file: string | null, id: string): Promise<WikiModel | null> {
  if (!file) return null;
  if (!MODEL_FILE.test(file)) throw new Error("Invalid model address");
  const model = await fetchJson(fetch, file) as WikiModel;
  if (model.id !== id || !model.meshes.length) throw new Error("Model does not match the article");
  return model;
}

function seaStage(radius: number): Heightfield {
  const chunks = Math.max(4, Math.ceil((radius + CHUNK_SIZE) * 2 / CHUNK_SIZE));
  const hf = new Heightfield({ chunksX: chunks, chunksZ: chunks }, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(0);
  hf.tint.fill(STUDIO_TINTS.bed);
  hf.seaLevel = 0;
  return hf;
}

function errorNote(fault: unknown): void {
  const detail = fault instanceof Error ? fault.message : String(fault);
  const note = $<HTMLElement>("note");
  note.textContent = /webgl/i.test(detail) ? "This browser could not start WebGL 2." : detail;
  note.hidden = false;
  document.body.dataset.error = detail;
  notify("error", detail);
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") ?? "";
  const [media, manifestText, model] = await Promise.all([
    fetchJson(fetch, "entry-media.json") as Promise<{ content: string; studioContent?: string; sky: string }>,
    fetchText(fetch, "assets/manifest.json"),
    modelFrom(params.get("model"), id),
  ]);
  const core = parseManifest(manifestText);
  const [boot, base, sky] = await Promise.all([fetchBytes(fetch, "assets/" + core.files[core.boot]!.name), fetchContent(fetch, media.studioContent ?? media.content, media.studioContent ? "studio" : "world"), fetchBytes(fetch, media.sky)]);
  const land = model?.kind === "landmark" ? model : null;
  const map = land ? { landmarks: [{ name: land.name, x: 0, y: 0, z: 0, yaw: 0 }], defs: [] } : undefined;
  const loaded = await withLandmarks(fetch, map, base, core, parsePack(new Uint8Array(boot)));
  const { manifest, pack } = loaded;
  const byId = new Map(manifest.meshes.map((mesh) => [mesh.id, mesh]));
  const loose = model?.kind === "mesh" ? byId.get(model.meshes[0]!) : undefined;
  const prop = loose ? { ...loose, ...model?.box } : undefined;
  if (model?.kind === "mesh" && !prop) throw new Error("The model's mesh is missing");
  const placedMeshes = new Map<string, ManifestMesh>();
  const definitions = [];
  if (prop && model?.kind === "mesh") definitions.push(studioStatic(STUDIO_PROP, prop, model.color));
  for (const structure of land?.structures ?? []) {
    const mesh = byId.get(structure.mesh);
    if (!mesh) continue;
    placedMeshes.set(structure.id, mesh);
    definitions.push({ ...studioStatic(structure.id, mesh, structure.color), ...structure });
  }
  const reg = withContent(loaded.reg, definitions);
  const subject = land ? null : subjectOf(reg, model?.kind === "content" ? model.target : prop ? STUDIO_PROP : id);
  if (!land && !subject) throw new Error(`${id || "Nothing"} has no model to show`);
  const label = model?.label ?? subject!.label;
  const whole = land ? land.bounds ?? landmarkBounds(land.pieces, placedMeshes) : null;
  if (land && !whole) throw new Error("The landmark's meshes are missing");
  giveSky(new Uint8Array(sky));
  const hf = whole ? seaStage(whole.radius) : studioGround();
  const renderer = new GlRenderer(canvas, pack, hf, manifest, null);
  const tier = { ...tierOf(innerWidth >= 900 && devicePixelRatio <= 2 ? "high" : "medium"), finishes: 0 };
  const world: RenderWorld = { mapId: "studio", dims: hf.dims, hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const scene = new Scene(world, reg, pack, { manifest, port: new WorkerPort(manifest, "assets", tier.diskBytes, null) });
  scene.assets.tier = tier;
  scene.assets.format = renderer.format;
  const chars = scene.characters;
  const vehicle = subject?.kind === "vehicle" ? reg.vehicle[subject.index] : null;
  const boat = vehicle?.movement === "boat";
  const x = hf.sizeX / 2 - (whole?.x ?? (boat ? STUDIO_SHORE + 14 : 0));
  const z = hf.sizeZ / 2 - (whole?.z ?? 0);
  const ground = boat || land ? 0 : hf.heightAt(x, z);
  const y = prop ? ground - prop.center[1] + prop.half[1] : ground;
  const actors = new RemoteSample();
  const body = subject?.kind === "creature" || subject?.kind === "survivor";
  let meshAt = -1;
  if (land) {
    for (const p of land.pieces) {
      if (placedMeshes.has(p.kind)) world.structs.add(reg.index.get(p.kind)!, x + p.at[0], y + p.at[1], z + p.at[2], p.yaw, 0, 1);
    }
  } else if (subject) {
    const { index, kind } = subject;
    meshAt = kind === "item" ? scene.assets.bind.own(reg.ids[index]!, "dropped") : kind === "survivor" ? -1 : scene.meshOfKind[index]!;
    if (kind === "structure") world.structs.add(index, x, y, z, 0, 0, 1);
    else {
      actors.count = 1;
      actors.id[0] = BODY;
      actors.gen[0] = 1;
      actors.x[0] = x;
      actors.y[0] = y;
      actors.z[0] = z;
      actors.yaw[0] = 0;
      actors.anim[0] = new AnimState().pack();
      if (kind === "item") {
        if (meshAt < 0) throw new Error("This item has no dropped model");
        actors.kind[0] = reg.index.get("core:bag")!;
        actors.gear[GEAR_HELD] = index;
      } else actors.kind[0] = index;
      if (kind === "survivor") {
        actors.hasLook[0] = 1;
        actors.look.set(defaultLook(), 0);
        chars.wantEmotes();
      }
      if (vehicle) actors.vehicleGrounded[0] = 1;
    }
  }

  const cam = new Camera(), orbit = new Orbit();
  const mesh = manifest.meshes[meshAt] ?? null;
  const expected = new Set(model ? model.meshes.map((id) => scene.assets.table.find(id)) : mesh && mesh.id !== "core:missing" ? [meshAt] : []);
  if (expected.has(-1)) throw new Error("Some of the model's meshes are missing");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const frameView = (): void => {
    const b = whole ?? boundsOf(reg, subject!, model?.box ?? manifest.meshes[meshAt] ?? null);
    orbit.frame({ x: x + b.x, y: y + b.y, z: z + b.z, radius: b.radius }, cam.fovY, cam.aspect || 1, ground);
    orbit.turning = !reduced.matches;
  };

  // The moves, made again when a creature's clips or the emotes come.
  const play = new Playback();
  const panel = $<HTMLElement>("moves"), list = $<HTMLSelectElement>("move"), toggle = $<HTMLButtonElement>("play"), timeline = $<HTMLInputElement>("time");
  const told = $<HTMLOutputElement>("told"), speed = $<HTMLSelectElement>("speed"), loop = $<HTMLInputElement>("loop"), turn = $<HTMLInputElement>("turn");
  let groups: MoveGroup[] = [], move: Move | null = null, clip: Clip | null = null, madeFrom: unknown = null;
  for (const s of SPEEDS) speed.append(new Option(`${s}×`, String(s), s === 1, s === 1));
  const relist = (): void => {
    const creature = subject?.kind === "creature" ? chars.creature(subject.index) : null;
    const from = subject?.kind === "survivor" ? `${chars.emotesHere}` : creature;
    if (!body || from === madeFrom) return;
    madeFrom = from;
    groups = subject?.kind === "survivor" ? humanMoves(chars.anim, chars.emotesHere) : creature ? creatureMoves(creature) : [];
    const keep = move?.key;
    list.replaceChildren(...groups.map((g) => {
      const og = document.createElement("optgroup");
      og.label = g.name;
      og.append(...g.moves.map((m) => new Option(m.missing ? `${m.label} (${m.missing})` : m.label, m.key, false, m.key === keep)));
      for (const o of og.querySelectorAll("option")) o.disabled = groups.flatMap((q) => q.moves).find((m) => m.key === o.value)?.missing !== undefined;
      return og;
    }));
    panel.hidden = groups.length === 0;
    if (!keep) choose(firstMove(groups)?.key ?? "");
  };
  const choose = (key: string): void => {
    move = groups.flatMap((g) => g.moves).find((m) => m.key === key) ?? null;
    actors.gear[GEAR_HELD] = move?.item ? reg.index.get(move.item) ?? 0 : 0;
    list.value = key;
    clip = null;
  };
  list.onchange = () => choose(list.value);
  toggle.onclick = () => (play.playing ? (play.playing = false) : play.play());
  timeline.oninput = () => {
    play.playing = false;
    play.scrub(Number(timeline.value));
  };
  speed.onchange = () => (play.speed = Number(speed.value));
  loop.onchange = () => (play.loop = loop.checked);
  turn.onchange = () => (orbit.turning = turn.checked);
  turn.checked = !reduced.matches;
  $<HTMLButtonElement>("reset").onclick = () => {
    frameView();
    turn.checked = orbit.turning;
  };
  $<HTMLButtonElement>("zoom-in").onclick = () => orbit.zoom(1.25);
  $<HTMLButtonElement>("zoom-out").onclick = () => orbit.zoom(0.8);
  $<HTMLElement>("spin").hidden = !vehicle || boat;
  const spin = $<HTMLInputElement>("spinning");
  $<HTMLElement>("spinlabel").textContent = vehicle?.movement === "rotor" ? "Turn rotors" : "Turn wheels";

  // Dragging turns the view, the wheel and a pinch zoom it, the keys do either.
  const fingers = new Map<number, { x: number; y: number }>();
  let spread = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener("pointermove", (e) => {
    const was = fingers.get(e.pointerId);
    if (!was) return;
    if (fingers.size === 1) orbit.drag(e.clientX - was.x, e.clientY - was.y);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      const now = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      orbit.zoom(pinchZoom(spread, now));
      spread = now;
    }
    turn.checked = orbit.turning;
  });
  const lift = (e: PointerEvent): void => {
    fingers.delete(e.pointerId);
    spread = 0;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    orbit.zoom(Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && parent !== window) {
      notify("close");
      return;
    }
    if ((e.target as HTMLElement).closest("select, input, button")) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") orbit.drag(k === "ArrowLeft" ? -24 : 24, 0);
    else if (k === "ArrowUp" || k === "ArrowDown") orbit.drag(0, k === "ArrowUp" ? -18 : 18);
    else if (k === "+" || k === "=") orbit.zoom(1.15);
    else if (k === "-") orbit.zoom(1 / 1.15);
    else if (k === "r" || k === "R") $<HTMLButtonElement>("reset").click();
    else if (k === " " && body) toggle.click();
    else return;
    e.preventDefault();
    turn.checked = orbit.turning;
  });

  let prior = performance.now(), seconds = 0, frames = 0, announced = false, failed = false;
  const drawn = new Set<number>();
  const fail = (fault: unknown): void => {
    if (failed) return;
    failed = true;
    errorNote(fault);
  };
  canvas.addEventListener("webglcontextlost", () => fail(new Error("WebGL 2 context lost")));
  let lastAspect = 0;
  const update = (dt: number): void => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, Math.min(2, 1600 / w));
    if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
    if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
    cam.aspect = w / h;
    cam.fovY = 0.7;
    if (cam.aspect !== lastAspect) {
      frameView();
      lastAspect = cam.aspect;
    }
    seconds += dt;
    orbit.step(dt);
    orbit.place(cam);
    if (body) {
      relist();
      // The move's clip once it is here; until then the body stands as it would.
      const now = move ? clipOf(move.source, subject?.kind === "creature" ? chars.creature(subject.index) : null, chars.anim) : null;
      if (now !== clip) {
        clip = now;
        if (clip) {
          play.start(clip.frames, clip.loop, move?.durationTicks);
          loop.checked = clip.loop;
          if (reduced.matches) play.playing = false;
        }
      }
      if (clip) play.step(dt);
      chars.override = clip ? { id: BODY, clip, frame: play.at } : null;
      toggle.textContent = play.playing ? "Pause" : "Play";
      toggle.setAttribute("aria-pressed", String(play.playing));
      if (document.activeElement !== timeline) timeline.value = String(play.share);
      told.value = clip ? `${play.seconds.toFixed(1)} / ${play.length.toFixed(1)} s` : "";
    }
    if (vehicle && spin.checked) {
      actors.wheelAngle[0] = (actors.wheelAngle[0]! + dt * 6) % (Math.PI * 2);
      actors.vehicleRotorRpm[0] = 320;
      actors.vehicleRotorPhase[0] = (actors.vehicleRotorPhase[0]! + dt * (320 / 60) * Math.PI * 2) % (Math.PI * 2);
    } else actors.vehicleRotorRpm[0] = 0;
    actors.tick = Math.floor(seconds * 30);
    scene.now = seconds * 1000;
    scene.hour = 11;
    scene.viewHeight = canvas.height;
    scene.viewDistance = Math.max(800, orbit.distance + (whole?.radius ?? 0) + 32);
    const packet = scene.build(cam, actors);
    renderer.draw(packet);
    if (!announced) {
      for (let i = 0; i < packet.drawCount; i++) {
        const index = packet.drawMesh[i]!;
        if (expected.has(index)) drawn.add(index);
      }
      frames++;
    }
  };
  const frame = (t: number): void => {
    if (failed) return;
    try {
      const dt = Math.min(0.1, (t - prior) / 1000);
      prior = t;
      if (!document.hidden) update(dt);
      // A composite's hidden interior may fall outside the visible draws of a given view.
      const required = land ? Math.min(2, expected.size) : expected.size;
      const settled = !land || scene.assets.residency.flying + scene.assets.residency.waiting === 0;
      if (!announced && frames > 2 && drawn.size >= required && settled) {
        announced = true;
        document.body.dataset.ready = "1";
        document.body.dataset.subject = id;
        document.body.dataset.meshes = [...drawn].map((k) => manifest.meshes[k]!.id).join(" ");
        notify("ready");
      }
      requestAnimationFrame(frame);
    } catch (fault) {
      fail(fault);
    }
  };
  document.title = `SNARK · ${label} in 3D`;
  canvas.setAttribute("aria-label", `${label} in 3D. Drag or use arrow keys to turn. Use plus and minus to zoom, or R to reset.`);
  requestAnimationFrame(frame);
}

void start().catch(errorNote);
