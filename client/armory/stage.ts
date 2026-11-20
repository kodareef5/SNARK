import { GlRenderer } from "../shell/gl.ts";
import { exhaustPhase } from "../core/render/suit-finish.ts";
import { Camera } from "../core/render/camera.ts";
import { Scene } from "../core/render/scene.ts";
import { BONE_FLOATS, FRAME } from "../core/render/packet.ts";
import { giveSky } from "../core/render/sky.ts";
import { RemoteSample } from "../core/session.ts";
import { tierOf } from "../core/assets/tiers.ts";
import type { AssetPort, AssetRequest, AssetArrival } from "../core/assets/port.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { defaultLook, LOOK_SEX, LOOK_BEARD, LOOK_HAIR, setRegion } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { HOLD_TOOL } from "../../shared/sim/weapon.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { B_HAND_R } from "../../shared/anim/human.ts";
import { INSTANCE_BYTES, parsePack } from "../../shared/pack/pack.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;
const params = new URLSearchParams(location.search),
  canvas = $<HTMLCanvasElement>("canvas"),
  status = $("#status");
if (params.has("capture")) document.body.classList.add("capture");
const fit = $<HTMLSelectElement>("#fit"),
  pose = $<HTMLSelectElement>("#pose"),
  view = $<HTMLSelectElement>("#view"),
  shade = $<HTMLInputElement>("#shade");
fit.value = params.get("fit") ?? "m";
pose.value = params.get("pose") ?? "idle";
view.value = params.get("view") ?? "whole";
shade.checked = params.has("dusk");
async function bytes(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw Error(path);
  if (path.endsWith(".gz")) return new Uint8Array(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return new Uint8Array(await res.arrayBuffer());
}
async function run() {
  const [manifest, defs, sky] = await Promise.all([
    fetch("actors.json").then((r) => r.json() as Promise<Manifest>),
    fetch("content.json").then((r) => r.json()),
    bytes("sky.bin"),
  ]);
  const reg = compileContent(defs).registry!;
  giveSky(sky);
  const files = await Promise.all(manifest.files.map((_, i) => bytes(i + ".gz")));
  let pending: AssetArrival[] = [];
  const port: AssetPort = {
    protocol: "memory",
    cache: { used: 0, limit: 0, mode: "memory", filling: 0 },
    request(req: AssetRequest) {
      const file = files[req.file]!,
        data = new Uint8Array(req.parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of req.parts) {
        data.set(file.subarray(p.offset, p.offset + p.length), at);
        at += p.length;
      }
      pending.push({ slot: req.slot, generation: req.generation, data, fail: 0, fetched: 0, cached: at });
    },
    cancel(slot) {
      pending = pending.filter((a) => a.slot !== slot);
    },
    take(out) {
      const n = pending.length;
      for (let i = 0; i < n; i++) out[i] = pending[i]!;
      pending = [];
      return n;
    },
    fill() {},
  };
  const pack = parsePack(files[manifest.boot]!),
    dims = { chunksX: 1, chunksZ: 1 },
    hf = new Heightfield(dims, 8, 0, 1);
  hf.tint.fill(4); // The studio floor is slate in the environment seen by the suit.
  const scene = new Scene({ dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) }, reg, pack, {
    manifest,
    port,
  });
  const gl = new GlRenderer(canvas, pack, hf, manifest, "rgba", true),
    cam = new Camera(),
    actor = new RemoteSample(),
    anim = new AnimState();
  scene.assets.format = "rgba";
  scene.assets.tier = tierOf("high");
  scene.viewDistance = 35;
  const equipment = ["hat", "shirt", "gloves", "pants", "boots"],
    inputs: HTMLInputElement[] = [];
  equipment.forEach((s) => {
    const id = "core:meridian_" + s,
      d = reg.defs[reg.index.get(id)!]!;
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !params.get("off")?.split(",").includes(s);
    const icon = document.createElement("img");
    icon.src = "meridian_" + s + ".png";
    icon.alt = "";
    label.append(input, icon, " " + (d.type === "item" ? d.label : s));
    $("fieldset").append(label);
    inputs.push(input);
  });
  const look = defaultLook();
  look[LOOK_HAIR] = 2;
  look[LOOK_BEARD] = 1;
  const build = $<HTMLSelectElement>("#build");
  build.value = params.get("build") ?? "standard";
  const sizeBody = () => {
    for (const r of [0, 4, 6, 7, 9, 10, 11, 14, 17, 18]) setRegion(look, r, build.value === "broad" ? 1 : build.value === "slight" ? -1 : 0);
  };
  sizeBody();
  build.onchange = sizeBody;
  actor.hasLook[0] = 1;
  for (let i = 0; i < 2; i++) {
    actor.gen[i] = 1;
    actor.id[i] = 1 + i;
    actor.x[i] = actor.z[i] = 32;
    actor.flags[i] = 1;
  }
  actor.kind[0] = reg.index.get("core:survivor")!;
  actor.kind[1] = reg.index.get("core:pteranodon")!;
  const mount = reg.defs[actor.kind[1]!]!;
  if (mount.type === "species") mount.regions?.forEach((region, i) => (actor.colors[6 + i] = region?.colors[0]?.[0] ?? 0));
  const saddle = reg.index.get("core:saddle_pteranodon")!;
  actor.gear[GEAR_COUNT + GEAR_WORN] = saddle;
  const mix = $<HTMLSelectElement>("#mix");
  mix.value = params.get("mix") ?? "bare";
  const grip = $<HTMLInputElement>("#tool");
  grip.checked = params.has("tool");
  const orbit = () => (view.value === "glove" ? -1.28 : view.value === "back" ? 2.7 : pose.value === "mount" ? 1.15 : 0.42);
  let angle = Number(params.get("angle") ?? orbit()),
    drag: number | null = null;
  view.onchange = pose.onchange = () => {
    angle = orbit();
  };
  canvas.onpointerdown = (e) => {
    drag = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (drag !== null) {
      angle -= (e.clientX - drag) * 0.011;
      drag = e.clientX;
    }
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = null;
  };
  canvas.onkeydown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      angle += e.key === "ArrowLeft" ? -0.16 : 0.16;
    }
  };
  // Follow the animated right palm in the same bone palette used for the actual draw.
  const palm = [32, 0.9, 32], instances = new DataView(scene.packet.transient.buffer);
  const fits = ["m", "f"].map(sex => ({
    hands: new Map(["bare", "meridian", "cloth", "hide"].map(set => [set, scene.assets.table.find(
      "core:human_" + sex + (set === "bare" ? "/hands" : "/armor/" + set + "/hands")
    )])),
    rest: pack.header.rigs.find(rig => rig.id === "human_" + sex)!.rest
  }));
  let frames = 0;
  let captureTick = params.has("tick") ? Number(params.get("tick")) : null;
  if (params.has("capture"))
    window.addEventListener("armory-frame", (event) => {
      const tick = (event as CustomEvent<number>).detail;
      if (Number.isFinite(tick)) captureTick = tick;
    });
  function draw(now: number) {
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)),
      h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    look[LOOK_SEX] = fit.value === "f" ? 1 : 0;
    actor.look.set(look);
    const mounted = pose.value === "mount";
    actor.count = mounted ? 2 : 1;
    actor.seat[0] = mounted ? actor.id[1]! + 1 : 0;
    inputs.forEach((v, k) => {
      const tier = v.checked ? "meridian" : mix.value;
      actor.gear[GEAR_WORN + k] = tier === "bare" ? 0 : reg.index.get("core:" + tier + "_" + equipment[k])!;
    });
    actor.gear[GEAR_HELD] = grip.checked ? reg.index.get("core:pick")! : 0;
    anim.setAction(0, grip.checked ? HOLD_TOOL : 0, 0);
    anim.grounded = pose.value !== "air";
    anim.jet = !anim.grounded;
    actor.cue[0] = anim.packCue();
    actor.flags[0] = anim.grounded ? 1 : 0;
    anim.stance = pose.value === "crouch" || mounted ? STANCE_CROUCH : 0;
    anim.speed = pose.value === "run" ? 16 : 0;
    const t = captureTick ?? now * 0.03;
    actor.tick = t;
    actor.anim[0] = anim.pack();
    actor.anim[1] = 0;
    // A moving survivor travels through the actual stride tracker. The camera follows.
    actor.z[0] = pose.value === "run" ? 32 + (t % 180) * 0.085 : 32;
    cam.aspect = w / h;
    const close = view.value !== "whole",
      dist = view.value === "back" ? 1.32 : close ? 1.1 : mounted ? Math.max(6.4, 6.0 / cam.aspect) : Math.max(3.3, 1.75 / cam.aspect);
    const target = view.value === "back" && !mounted ? 1.19 : mounted
      ? close
        ? 1.98
        : 1.12
      : close
        ? pose.value === "crouch"
          ? 1.04
          : 1.47
        : pose.value === "crouch"
          ? 0.71
          : 0.86;
    cam.fovY = close ? 0.63 : 0.65;
    cam.x = 32 + Math.sin(angle) * dist;
    cam.z = actor.z[0]! + Math.cos(angle) * dist;
    cam.y = target + dist * 0.08;
    cam.yaw = angle + Math.PI;
    cam.pitch = -0.08;
    if (view.value === "under" || view.value === "soles") {
      const soles = view.value === "soles";
      const distance = soles ? 0.26 : 0.78;
      const rise = soles ? 1.04 : 0.68;
      cam.x = 32 + Math.sin(angle) * distance;
      cam.z = actor.z[0]! + Math.cos(angle) * distance;
      cam.y = (soles ? 0.04 : 1.21) - rise;
      cam.pitch = Math.atan2(rise, distance);
    }
    if (view.value === "glove") {
      const distance = 0.34;
      cam.x = palm[0]! + Math.sin(angle)*distance;
      cam.y = palm[1]! + 0.06;
      cam.z = palm[2]! + Math.cos(angle)*distance;
      cam.pitch = -Math.atan2(0.06,distance);
    }
    scene.hour = shade.checked ? 18.8 : 11.5;
    scene.now = now;
    scene.viewHeight = h;
    const p = scene.build(cam, actor);
    if (view.value === "glove") {
      const { hands, rest } = fits[look[LOOK_SEX]!]!;
      const mesh = hands.get(inputs[2]!.checked ? "meridian" : mix.value) ?? -1;
      const d = p.drawMesh.subarray(0, p.drawCount).indexOf(mesh);
      if (d >= 0) {
        const bone = instances.getUint16(p.drawFirst[d]!*INSTANCE_BYTES + 12, true) + B_HAND_R;
        const wrist = B_HAND_R*3;
        palm[0] = cam.x; palm[1] = cam.y; palm[2] = cam.z;
        for (let axis = 0; axis < 3; axis++) {
          const r = bone*BONE_FLOATS + 4*axis;
          palm[axis]! += p.bones[r+3]!
            + p.bones[r]!*(rest[wrist]! - 0.067) + p.bones[r+1]!*rest[wrist+1]! + p.bones[r+2]!*rest[wrist+2]!;
        }
      }
    }
    if (captureTick !== null) p.frame[FRAME.exhaustPhase] = exhaustPhase(t * (1000 / 30));
    p.tileCount = 0;
    p.sky.set([0.076, 0.115, 0.153]);
    p.frame[FRAME.eyeHeight] = -1;
    gl.draw(p);
    if (captureTick !== null) {
      canvas.dataset.tick = String(t);
      const vents = scene.assets.table.find("core:human_" + fit.value + "/armor/meridian/vents");
      canvas.dataset.vents = String(p.drawMesh.subarray(0, p.drawCount).includes(vents));
    }
    canvas.parentElement!.dataset.floor = close ? "hidden" : mounted ? "mounted" : "visible";
    if (++frames > 6 && !scene.assets.residency.flying && !scene.assets.residency.waiting && gl.textures.size > 0) {
      status.textContent = "Native models loaded";
      document.body.dataset.ready = "true";
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
run().catch((error) => {
  status.textContent = String(error);
  console.error(error);
});
