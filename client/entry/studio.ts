// The wiki's studio: one thing of the game, drawn by the game's own renderer, as the title's flight draws its actors, on the
// title's beach with no server. A body plays any move it has (client/core/studio/moves.ts) through the characters' pose
// override; the view turns round it by itself until it is dragged, and zooms by the wheel or a pinch. The wiki opens it in
// a frame (studio.html?id=core:raptor) and is told "ready" or "error", so that a page keeps its picture where 3D fails.

import { GlRenderer } from "../shell/gl.ts";
import { WorkerPort } from "../assets/port.ts";
import { Scene, type RenderWorld } from "../core/render/scene.ts";
import { Camera } from "../core/render/camera.ts";
import { giveSky } from "../core/render/sky.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { GEAR_HELD } from "../../shared/sim/entities.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fetchBytes, fetchContent, withLandmarks } from "../core/fetched.ts";
import { RemoteSample } from "../core/session.ts";
import { tierOf } from "../core/assets/tiers.ts";
import { STUDIO_SHORE, studioGround } from "../core/title-route.ts";
import { clipOf, creatureMoves, firstMove, humanMoves, type Move, type MoveGroup } from "../core/studio/moves.ts";
import { Playback, SPEEDS } from "../core/studio/clock.ts";
import { Orbit, pinchZoom } from "../core/studio/orbit.ts";
import { boundsOf, subjectOf } from "../core/studio/subject.ts";
import type { Clip } from "../../shared/anim/clip.ts";

const notify = (type: string, detail = "") => parent.postMessage({ source: "snark-studio", type, detail }, location.origin);
const canvas = document.querySelector("canvas")!;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const BODY = 1;

async function start(): Promise<void> {
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const media = await (await fetch("entry-media.json")).json();
  const core = parseManifest(await (await fetch("assets/manifest.json")).text());
  const [boot, base, sky] = await Promise.all([fetchBytes(fetch, "assets/" + core.files[core.boot]!.name), fetchContent(fetch, media.content), fetchBytes(fetch, media.sky)]);
  const { reg, manifest, pack } = await withLandmarks(fetch, undefined, base, core, parsePack(new Uint8Array(boot)));
  const subject = subjectOf(reg, id);
  if (!subject) throw new Error(`${id || "Nothing"} has no model to show`);
  giveSky(new Uint8Array(sky));
  const hf = studioGround();
  const renderer = new GlRenderer(canvas, pack, hf, manifest, null);
  const tier = { ...tierOf(innerWidth >= 900 && devicePixelRatio <= 2 ? "high" : "medium"), finishes: 0 };
  const world: RenderWorld = { mapId: "studio", dims: hf.dims, hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const scene = new Scene(world, reg, pack, { manifest, port: new WorkerPort(manifest, "assets", tier.diskBytes, null) });
  scene.assets.tier = tier;
  scene.assets.format = renderer.format;
  const chars = scene.characters;

  // Where it stands: on the sand, or for a boat on the water off the beach.
  const boat = subject.kind === "vehicle" && (reg.vehicle[subject.index] as { movement?: string } | null)?.movement === "boat";
  const x = hf.sizeX / 2 - (boat ? STUDIO_SHORE + 14 : 0), z = hf.sizeZ / 2;
  const y = boat ? 0 : hf.heightAt(x, z);
  const actors = new RemoteSample(), st = new AnimState();
  const body = subject.kind === "creature" || subject.kind === "survivor";
  if (subject.kind === "structure") world.structs.add(subject.index, x, y, z, 0, 0, 1);
  else {
    actors.count = 1;
    actors.id[0] = BODY;
    actors.gen[0] = 1;
    actors.x[0] = x;
    actors.y[0] = y;
    actors.z[0] = z;
    actors.yaw[0] = 0;
    actors.anim[0] = st.pack();
    if (subject.kind === "item") {
      actors.kind[0] = reg.index.get("core:bag") ?? 0;
      actors.gear[GEAR_HELD] = subject.index;
    } else actors.kind[0] = subject.index;
    if (subject.kind === "survivor") {
      actors.hasLook[0] = 1;
      actors.look.set(defaultLook(), 0);
      chars.wantEmotes();
    }
    if (subject.kind === "vehicle") actors.vehicleGrounded[0] = 1;
  }

  // The view, framed on the mesh's box where the manifest has one.
  const cam = new Camera(), orbit = new Orbit();
  const meshAt = subject.kind === "item" ? scene.assets.table.find(`${reg.ids[subject.index]}/dropped`) : subject.kind === "survivor" ? -1 : scene.meshOfKind[subject.index]!;
  const mesh = meshAt >= 0 && manifest.meshes[meshAt]?.id !== "core:missing" ? manifest.meshes[meshAt]! : null;
  const frameView = (): void => {
    const b = boundsOf(reg, subject, mesh);
    orbit.frame({ x: x + b.x, y: y + b.y, z: z + b.z, radius: b.radius }, cam.fovY, cam.aspect || 1, y);
  };

  // The moves, made again when a creature's clips or the emotes come.
  const play = new Playback();
  const panel = $<HTMLElement>("moves"), list = $<HTMLSelectElement>("move"), toggle = $<HTMLButtonElement>("play"), timeline = $<HTMLInputElement>("time");
  const told = $<HTMLOutputElement>("told"), speed = $<HTMLSelectElement>("speed"), loop = $<HTMLInputElement>("loop"), turn = $<HTMLInputElement>("turn");
  let groups: MoveGroup[] = [], move: Move | null = null, clip: Clip | null = null, madeFrom: unknown = null;
  for (const s of SPEEDS) speed.append(new Option(`${s}×`, String(s), s === 1, s === 1));
  const relist = (): void => {
    const creature = subject.kind === "creature" ? chars.creature(subject.index) : null;
    const from = subject.kind === "survivor" ? `${chars.emotesHere}` : creature;
    if (!body || from === madeFrom) return;
    madeFrom = from;
    groups = subject.kind === "survivor" ? humanMoves(chars.anim, chars.emotesHere) : creature ? creatureMoves(creature) : [];
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
  $<HTMLButtonElement>("reset").onclick = () => {
    frameView();
    turn.checked = true;
  };
  $<HTMLElement>("spin").hidden = subject.kind !== "vehicle";
  const spin = $<HTMLInputElement>("spinning");
  $<HTMLElement>("spinlabel").textContent = reg.vehicle[subject.index] && (reg.vehicle[subject.index] as { movement?: string }).movement === "rotor" ? "Rotor turning" : "Wheels turning";

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
    if ((e.target as HTMLElement).closest("select, input")) return;
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

  let prior = performance.now(), seconds = 0, frames = 0, announced = false, framed = false;
  const update = (dt: number): void => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, Math.min(2, 1600 / w));
    if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
    if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
    cam.aspect = w / h;
    cam.fovY = 0.7;
    if (!framed) {
      frameView();
      framed = true;
    }
    seconds += dt;
    orbit.step(dt);
    orbit.place(cam);
    if (body) {
      relist();
      // The move's clip once it is here; until then the body stands as it would.
      const now = move ? clipOf(move.source, subject.kind === "creature" ? chars.creature(subject.index) : null, chars.anim) : null;
      if (now !== clip) {
        clip = now;
        if (clip) {
          play.start(clip.frames, clip.loop);
          loop.checked = clip.loop;
        }
      }
      if (clip) play.step(dt);
      chars.override = clip ? { id: BODY, clip, frame: play.at } : null;
      toggle.textContent = play.playing ? "Pause" : "Play";
      toggle.setAttribute("aria-pressed", String(play.playing));
      if (document.activeElement !== timeline) timeline.value = String(play.share);
      told.value = clip ? `${play.seconds.toFixed(1)} / ${play.length.toFixed(1)} s` : "";
    }
    if (subject.kind === "vehicle" && spin.checked) {
      actors.wheelAngle[0] = (actors.wheelAngle[0]! + dt * 6) % (Math.PI * 2);
      actors.vehicleRotorRpm[0] = 320;
      actors.vehicleRotorPhase[0] = (actors.vehicleRotorPhase[0]! + dt * (320 / 60) * Math.PI * 2) % (Math.PI * 2);
    } else actors.vehicleRotorRpm[0] = 0;
    actors.tick = Math.floor(seconds * 30);
    scene.now = seconds * 1000;
    scene.hour = 11;
    scene.viewHeight = canvas.height;
    scene.viewDistance = 800;
    renderer.draw(scene.build(cam, actors));
    frames++;
  };
  const frame = (t: number): void => {
    const dt = Math.min(0.1, (t - prior) / 1000);
    prior = t;
    if (!document.hidden) update(dt);
    if (!announced && frames > 8 && scene.assets.residency.flying + scene.assets.residency.waiting === 0) {
      announced = true;
      document.body.dataset.ready = "1";
      notify("ready");
    }
    requestAnimationFrame(frame);
  };
  document.title = `SNARK · ${subject.label} in 3D`;
  canvas.setAttribute("aria-label", `${subject.label}, drawn by the game. Drag or use the arrow keys to turn it, the wheel or plus and minus to zoom, R to reset.`);
  requestAnimationFrame(frame);
}

start().catch((e) => {
  console.error(e);
  const note = $<HTMLElement>("note");
  note.textContent = e instanceof Error && /webgl/i.test(e.message) ? "3D needs WebGL 2, which this browser has not given." : String(e instanceof Error ? e.message : e);
  note.hidden = false;
  document.body.dataset.error = String(e);
  notify("error", String(e));
});
