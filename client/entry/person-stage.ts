// The person stage: the game's renderer drawing one person on a plain floor, driven by messages from the admin page
// that holds it in an iframe (shared/people/stage.ts). What it holds is client/core/studio/person.ts.

import { GlRenderer } from "../shell/gl.ts";
import { WorkerPort } from "../assets/port.ts";
import { Scene, type RenderWorld } from "../core/render/scene.ts";
import { Camera } from "../core/render/camera.ts";
import { giveSky } from "../core/render/sky.ts";
import { withContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { LOOK_SEX, SEX_IDS } from "../../shared/anim/look.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fetchBytes, fetchContent, fetchJson, fetchText, withLandmarks } from "../core/fetched.ts";
import { RemoteSample } from "../core/session.ts";
import { tierOf } from "../core/assets/tiers.ts";
import { Playback } from "../core/studio/clock.ts";
import { Orbit, pinchZoom } from "../core/studio/orbit.ts";
import { framingOf, PersonStage } from "../core/studio/person.ts";
import { parseStageCommand, STAGE_FROM, type StageAnswer, type StageCommand } from "../../shared/people/stage.ts";
import type { Clip } from "../../shared/anim/clip.ts";

const tell = (reply: StageAnswer): void => {
  if (parent !== window) parent.postMessage({ ...reply, from: STAGE_FROM }, location.origin);
};
const canvas = document.querySelector("canvas")!;
const BODY = 1;
/** The floor's palette tints: a lighter disc the person stands on, and the floor around it. */
const DISC = 85, FLOOR = 83, DISC_RADIUS = 3.2;

/** A flat floor four chunks across with a disc in its middle, and no sea. */
function floor(): Heightfield {
  const hf = new Heightfield({ chunksX: 2, chunksZ: 2 }, TERRAIN_CELL, -8, 1 / 64);
  hf.heights.fill(Math.round(8 * 64));
  const mid = hf.sizeX / 2;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    hf.tint[j * hf.nx + i] = Math.hypot(i * hf.cell - mid, j * hf.cell - mid) <= DISC_RADIUS ? DISC : FLOOR;
  }
  hf.seaLevel = -100;
  return hf;
}

function fault(detail: string): void {
  const note = document.getElementById("note")!;
  note.textContent = /webgl/i.test(detail) ? "This browser could not start WebGL 2." : detail;
  note.hidden = false;
  document.body.dataset.error = detail;
  tell({ kind: "error", detail });
}

async function start(): Promise<void> {
  const [media, manifestText] = await Promise.all([
    fetchJson(fetch, "entry-media.json") as Promise<{ content: string; studioContent?: string; sky: string }>,
    fetchText(fetch, "assets/manifest.json"),
  ]);
  const core = parseManifest(manifestText);
  const [boot, base, sky] = await Promise.all([fetchBytes(fetch, "assets/" + core.files[core.boot]!.name), fetchContent(fetch, media.studioContent ?? media.content, media.studioContent ? "studio" : "world"), fetchBytes(fetch, media.sky)]);
  const { manifest, pack, reg: loaded } = await withLandmarks(fetch, undefined, base, core, parsePack(new Uint8Array(boot)));
  const reg = withContent(loaded, []);
  giveSky(new Uint8Array(sky));
  const hf = floor();
  const renderer = new GlRenderer(canvas, pack, hf, manifest, null);
  const tier = { ...tierOf("high"), finishes: 0 };
  const world: RenderWorld = { mapId: "stage", dims: hf.dims, hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const scene = new Scene(world, reg, pack, { manifest, port: new WorkerPort(manifest, "assets", tier.diskBytes, null) });
  scene.assets.tier = tier;
  scene.assets.format = renderer.format;
  const chars = scene.characters;
  chars.wantEmotes();
  const stage = new PersonStage(reg);
  chars.skinHidden = (id) => (id === BODY ? stage.hide : 0);
  const survivor = reg.index.get("core:survivor")!;
  const x = hf.sizeX / 2, z = hf.sizeZ / 2, ground = hf.heightAt(x, z);
  const actors = new RemoteSample();
  actors.count = 1;
  actors.id[0] = BODY;
  actors.gen[0] = 1;
  actors.x[0] = x;
  actors.y[0] = ground;
  actors.z[0] = z;
  actors.anim[0] = new AnimState().pack();

  const cam = new Camera(), orbit = new Orbit();
  orbit.turning = false;
  cam.fovY = 0.6;
  const frameView = (): void => {
    const f = framingOf(stage.framing, stage.pose);
    const half = Math.min(cam.fovY, 2 * Math.atan(Math.tan(cam.fovY / 2) * (cam.aspect || 1))) / 2;
    orbit.framed = orbit.distance = (f.radius / Math.sin(half)) * 1.08;
    Object.assign(orbit.target, { x, y: ground + f.y, z });
    orbit.ground = ground;
    orbit.yaw = f.yaw;
    orbit.pitch = f.pitch;
    orbit.clamp();
  };

  // Each print's picture, decoded, by key; let go once the stage no longer holds its key.
  const pictures = new Map<string, ImageBitmap>();
  const loadPrint = async (c: Extract<StageCommand, { kind: "print" }>): Promise<void> => {
    const blob = c.png ? new Blob([c.png.slice().buffer], { type: "image/png" }) : await (await fetch(c.url!)).blob();
    const bitmap = await createImageBitmap(blob);
    const held = stage.prints.find((p) => p.key === c.key);
    if (!held) return bitmap.close();
    pictures.get(c.key)?.close();
    pictures.set(c.key, bitmap);
    held.width = bitmap.width;
    held.height = bitmap.height;
  };
  const forget = (): void => {
    for (const key of [...pictures.keys()]) if (!stage.prints.some((p) => p.key === key)) {
      pictures.get(key)!.close();
      pictures.delete(key);
    }
  };

  // Pictures wait for a frame drawn with everything asked for in place.
  const asked: { id?: number; width: number | null; height: number | null }[] = [];
  let lastFraming = "", drawnVersion = -1, settledFrames = 0;
  let ignored = 0;
  const ignore = (why: string): void => {
    console.info(`person stage: ignored a message (${why})`);
    document.body.dataset.ignored = String(++ignored);
  };
  addEventListener("message", (e) => {
    if (parent === window || e.source !== parent || e.origin !== location.origin) return ignore(`from ${e.origin}, not this page's parent on its own origin`);
    const parsed = parseStageCommand(e.data);
    if (!parsed.command) return ignore(parsed.problem);
    const c = parsed.command;
    const { held, notes } = stage.apply(c);
    for (const n of notes) console.info(`person stage: ${n}`);
    const id = c.id === undefined ? {} : { id: c.id };
    if (c.kind === "picture") asked.push({ ...id, width: c.width, height: c.height });
    else if (c.kind === "print") {
      loadPrint(c).then(
        () => (forget(), tell({ kind: "applied", ...id, of: "print", held: stage.heldOf("print"), notes })),
        (problem) => {
          console.info(`person stage: the print ${c.key} could not be read (${String(problem)})`);
          stage.prints.splice(stage.prints.findIndex((p) => p.key === c.key), 1);
          forget();
          tell({ kind: "applied", ...id, of: "print", held: stage.heldOf("print"), notes: [...notes, `the print ${c.key} could not be read`] });
        },
      );
    } else tell({ kind: "applied", ...id, of: c.kind, held, notes });
  });

  // Dragging turns the view, the wheel and a pinch zoom it, as the wiki's studio does.
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
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") orbit.drag(k === "ArrowLeft" ? -24 : 24, 0);
    else if (k === "ArrowUp" || k === "ArrowDown") orbit.drag(0, k === "ArrowUp" ? -18 : 18);
    else if (k === "+" || k === "=") orbit.zoom(1.15);
    else if (k === "-") orbit.zoom(1 / 1.15);
    else if (k === "r" || k === "R") lastFraming = "";
    else return;
    e.preventDefault();
  });

  const play = new Playback();
  let clip: Clip | null = null, clipFor = "", prior = performance.now(), seconds = 0, frames = 0, announced = false, failed = false;
  canvas.addEventListener("webglcontextlost", () => {
    failed = true;
    fault("WebGL 2 context lost");
  });
  const draw = (dt: number): void => {
    // A change since the last frame unsettles it before a picture is judged: a picture may be asked before it is drawn.
    if (stage.version !== drawnVersion) {
      drawnVersion = stage.version;
      settledFrames = 0;
    }
    const picture = asked.length > 0 && settledFrames >= 3 ? asked.shift()! : null;
    const w = picture?.width ?? Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
    const h = picture?.height ?? Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2));
    if (!w || !h) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const aspect = w / h;
    const framing = `${stage.framing} ${stage.pose} ${aspect.toFixed(3)}`;
    cam.aspect = aspect;
    if (framing !== lastFraming) {
      frameView();
      lastFraming = framing;
    }
    seconds += dt;
    orbit.place(cam);
    // The move for the pose once its clip is here; until then the body stands as it would.
    const { clip: now, held } = stage.move(chars.anim);
    const want = `${stage.pose} ${stage.at}`;
    if (now !== clip || want !== clipFor) {
      clip = now;
      clipFor = want;
      if (clip) {
        play.start(clip.frames, clip.loop);
        if (stage.at !== null) {
          play.scrub(stage.at);
          play.playing = false;
        }
      }
    }
    if (clip) play.step(dt);
    chars.override = clip ? { id: BODY, clip, frame: play.at } : null;
    stage.writeActor(actors, 0, survivor, held);
    actors.tick = Math.floor(seconds * 30);
    scene.now = seconds * 1000;
    scene.hour = stage.hour;
    scene.viewHeight = canvas.height;
    scene.viewDistance = 120;
    const packet = scene.build(cam, actors);
    renderer.draw(packet);
    // Settled: nothing wanted, coming or waiting, every texture shown begun, the pose's clip here, and the person drawn.
    const residency = scene.assets.residency;
    const body = `core:human_${SEX_IDS[stage.look[LOOK_SEX]!]}`;
    const meshes = new Set<string>();
    for (let i = 0; i < packet.drawCount; i++) {
      const id = manifest.meshes[packet.drawMesh[i]!]?.id ?? "";
      if (id.startsWith(body)) meshes.add(id);
    }
    // A seated pose without its clip once the emotes have come is drawn standing, as the game would.
    const posed = clip !== null || (stage.pose === "seated" && chars.emotesHere);
    const settled = residency.flying === 0 && residency.waiting === 0 && residency.wanting() === 0 && residency.bare() === 0 && meshes.size > 0 && posed;
    settledFrames = settled ? settledFrames + 1 : 0;
    frames++;
    document.body.dataset.settled = String(settledFrames >= 3);
    if (!announced && frames > 2 && settledFrames >= 1) {
      announced = true;
      document.body.dataset.ready = "1";
      tell({ kind: "ready", meshes: [...meshes].sort() });
    }
    if (picture) {
      const id = picture.id === undefined ? {} : { id: picture.id };
      // Read in the task that drew it, before the drawing buffer is handed to the page.
      canvas.toBlob((png) => (png ? tell({ kind: "picture", ...id, png, width: w, height: h }) : console.info("person stage: the picture could not be made")), "image/png");
    }
  };
  const frame = (t: number): void => {
    if (failed) return;
    try {
      const dt = Math.min(0.1, (t - prior) / 1000);
      prior = t;
      if (!document.hidden) draw(dt);
      requestAnimationFrame(frame);
    } catch (problem) {
      failed = true;
      fault(problem instanceof Error ? problem.message : String(problem));
    }
  };
  requestAnimationFrame(frame);
}

void start().catch((problem: unknown) => fault(problem instanceof Error ? problem.message : String(problem)));
