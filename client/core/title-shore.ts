import { nodeForms, SIZE_UNITS } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { HeldTops, TOP_CELLS } from "./render/blocks.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import type { MapDims } from "../../shared/coords.ts";
import type { TitleShot } from "../../shared/title-scene.ts";
import { FRAME, type FramePacket } from "./render/packet.ts";
import type { Camera } from "./render/camera.ts";
import type { RemoteSample } from "./session.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { defaultLook, LOOK_BYTES } from "../../shared/anim/look.ts";
import type { Scene } from "./render/scene.ts";

interface Ground {
  heights: number[];
  tint: number[];
}
export interface Shore extends Ground {
  dims: MapDims;
  eye: TideEyeSite;
  actor: [number, number];
  seaLevel: number;
  minY: number;
  stepY: number;
  close: Ground & { x: number; z: number };
  skyline: number[];
}
export function prepareShore(s: Shore) {
  const hf = new Heightfield(s.dims, TERRAIN_CELL, s.minY, s.stepY);
  hf.holdNone();
  hf.fill(0, 0, s.dims.chunksX, s.dims.chunksZ, 32, Uint16Array.from(s.heights), Uint8Array.from(s.tint));
  const c = s.close;
  // Dress the narrow foreground strip with the Miami beach palette, preserving the surveyed shoreline and relief.
  for (let i = 0; i < c.tint.length; i++) {
    const y = s.minY + c.heights[i]! * s.stepY;
    if (Math.hypot(c.x * 64 + (i % 97) * 2 - s.actor[0], c.z * 64 + Math.floor(i / 97) * 2 - s.actor[1]) < 72 && y < 3.5)
      c.tint[i] = y < 0.25 ? 122 : y < 0.55 ? 121 : 125;
  }
  hf.fill(c.x, c.z, c.x + 3, c.z + 3, 1, Uint16Array.from(c.heights), Uint8Array.from(c.tint));
  hf.hold(0, 0, s.dims.chunksX, s.dims.chunksZ);
  hf.seaLevel = s.seaLevel;
  const tops = new HeldTops(s.dims);
  const rows = new Map<number, number>(),
    chunks: number[] = [];
  const top: number[] = [],
    tint: number[] = [];
  for (let i = 0; i < s.skyline.length; i += 2) {
    const key = s.skyline[i]!,
      chunk = key >> 4,
      b = key & 15;
    if (!rows.has(chunk)) {
      rows.set(chunk, chunks.length);
      chunks.push(chunk);
      for (let j = 0; j < TOP_CELLS; j++) {
        top.push(0);
        tint.push(0);
      }
    }
    const at = rows.get(chunk)! * TOP_CELLS + (b >> 2) * 64 + (b % 4) * 4;
    const value = s.skyline[i + 1]!;
    for (let j = 0; j < 16; j++) {
      const cell = at + (j >> 2) * 16 + (j % 4);
      top[cell] = value >> 8;
      tint[cell] = value & 255;
    }
  }
  tops.take({ chunks: Uint32Array.from(chunks), top: Uint8Array.from(top), tint: Uint8Array.from(tint) });
  return { hf, tops, actor: s.actor, eye: { ...s.eye } };
}
export type ShoreSet = ReturnType<typeof prepareShore>;
/** Stage palms at the landward edge of the camera, in local right/forward coordinates. */
export function shorePalms(set: ShoreSet, reg: Registry) {
  const forms = nodeForms(reg),
    ground = set.hf;
  const nodes = new StructureStore(ground.dims, forms.halfX, forms.halfY, forms.halfZ, forms.soft, forms.parts);
  const [x, z] = set.actor,
    a = Math.atan2(set.eye.x - x, set.eye.z - z),
    sn = Math.sin(a),
    cs = Math.cos(a);
  for (const [right, forward, variant, yaw] of [
    [-13, 7, 4, 29000],
    [-21, 15, 1, 6000],
    [-32, 26, 3, 42000],
    [-41, 35, 5, 10000],
    [9, 5, 2, 31000],
    [17, 12, 6, 24000],
  ] as const) {
    const px = x - cs * right + sn * forward,
      pz = z + sn * right + cs * forward;
    const form = forms.mesh.findIndex((name, i) => name === "core:palm_" + variant && forms.size[i]! >= SIZE_UNITS);
    const y = ground.heightAt(px, pz);
    if (form > 0 && y > -0.05) nodes.add(form, px, y, pz, yaw, 0, 1);
  }
  return nodes;
}
export const heroMeshes = [
  "core:rex",
  "core:saddle_rex/worn",
  ...["head", "torso", "hands", "legs", "feet"].map((s) => "core:human_m/armor/meridian/" + s),
];
const DEG = Math.PI / 180;
const TURN = 2 * Math.PI;
interface ShoreCast {
  seatHeight: number;
  bearing: number;
  eye: ShoreSet["eye"];
}
export function mountRex(actors: RemoteSample, set: ShoreSet, reg: Registry): ShoreCast {
  const requireKind = (name: string) => {
    const id = reg.index.get("core:" + name);
    if (!id) throw Error("Missing title actor " + name);
    return id;
  };
  const [x, z] = set.actor,
    bearing = Math.atan2(set.eye.x - x, set.eye.z - z),
    groundY = set.hf.heightAt(x, z);
  actors.count = 2;
  const idle = new AnimState().pack();
  for (let i = 0; i < 2; i++) {
    actors.id[i] = i + 1;
    actors.gen[i] = 1;
    actors.flags[i] = 1;
    actors.x[i] = x;
    actors.y[i] = groundY;
    actors.z[i] = z;
    actors.yaw[i] = bearing + 0.25;
    actors.anim[i] = idle;
  }
  actors.kind[0] = requireKind("rex");
  actors.gear[GEAR_WORN] = requireKind("saddle_rex");
  actors.colors.set([8, 7, 14, 6, 9, 3]);
  actors.kind[1] = requireKind("survivor");
  actors.seat[1] = 2;
  actors.seatGen[1] = 1;
  actors.seatSlot[1] = 1;
  actors.hasLook[1] = 1;
  actors.look.set(defaultLook(), LOOK_BYTES);
  ["hat", "shirt", "gloves", "pants", "boots"].forEach((piece, i) => {
    actors.gear[GEAR_COUNT + GEAR_WORN + i] = requireKind("meridian_" + piece);
  });
  const seat = reg.saddleSeats[actors.gear[GEAR_WORN]!]?.find((s) => s.driver);
  if (!seat) throw Error("The title Rex needs a driver seat");
  return { seatHeight: seat.anchor[1], bearing, eye: set.eye };
}
export function shoreView(
  scene: Scene,
  cam: Camera,
  actors: RemoteSample,
  shot: TitleShot,
  seconds: number,
  mouseX: number,
  mouseY: number,
  cast: ShoreCast,
) {
  const c = shot.camera,
    a = cast.bearing,
    sn = Math.sin(a),
    cs = Math.cos(a);
  // Bring the shoulder inside a portrait frame without cutting the instrument out above it.
  const portrait = Math.max(0, Math.min(1, (1.15 - cam.aspect) / 0.64));
  const side = c.side - 0.1 * portrait + mouseX * 0.23,
    back = c.back + 2.4 * portrait;
  cam.x = actors.x[0]! - cs * side - sn * back;
  cam.z = actors.z[0]! + sn * side - cs * back;
  cam.y = actors.y[0]! + cast.seatHeight + c.height + mouseY * 0.12;
  cam.yaw = a + (c.pan - portrait * 12 + mouseX * 1.3) * DEG;
  cam.pitch = (c.tilt + mouseY * 0.75) * DEG;
  cam.fovY = c.lens * DEG;
  actors.tick = seconds * 30;
  scene.hour = c.hour;
  // Face the shore at the opening. Linger broadside and pass the narrow edge faster, with continuous angular velocity.
  const turn = seconds * TURN / 180;
  const heading = a + Math.PI + turn - 0.32 * Math.sin(2 * turn);
  cast.eye.yaw = Math.round(heading * 65536 / TURN) & 65535;
  // The display is held at full power and its own clock only runs forward: nothing in the sky plays back.
  scene.eyeSeconds = -40 + 20;
  scene.eyeHold = seconds;
  // Keep the clock face at its directed screen size through the Rex shot’s wider 68-degree lens.
  scene.sextantScale = 3.35;
  scene.eyeIndexOffset = 0.72 * Math.sin(seconds * TURN / 64);
  scene.characters.seatedHeadTurn = 0.42 * Math.sin(seconds * 0.29) + 0.13 * Math.sin(seconds * 0.71);
}

/** Red spill from the instrument on the low clouds, with a dusk grade shared by the bay and the actors. */
export function shoreLight(packet: FramePacket) {
  const f = packet.frame;
  // Keep the opening's red spill and cap it at higher exposures for shots authored after dusk.
  const exposure = f[FRAME.exposure]!;
  const inverseExposure = exposure > 0 ? 1 / exposure : 0;
  f[FRAME.cloudSun]! += Math.min(0.012, 1.8 * inverseExposure);
  f[FRAME.cloudSun + 1]! *= 0.52;
  f[FRAME.cloudSun + 2]! *= 0.57;
  f[FRAME.grade]! *= 1.06;
  f[FRAME.grade + 1]! *= 0.51;
  f[FRAME.grade + 2]! *= 0.58;
  f[FRAME.gamma]! *= 1.1;
}
