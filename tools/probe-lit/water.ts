// The sea on a GPU (D270), a check of tools/probe-lit.ts. The sea is drawn calm, its waves' pictures not sent, and each
// sea pixel is held to water.ts's twin over what the rasterizer draws under it: a plate of sand 2 m down seen from
// above, and again under a pond 20 m up on a map with no sea, drawn from its squares (lakes.ts); the shore, where the
// sea is 5 to 15 cm deep, mostly see-through and under its foam, whose footprints the twin takes from the next pixels;
// the open sea at a grazing angle, where it is the sky table mirrored; and the sea across the split between the depth
// ranges, from 50 m up over deep water and over the shallows, and from the art director's camera over the proving
// ground, where a band blended twice or a row left undrawn would show. Each within 5 steps at 99 points in 100.
//
// With PROBE_PICTURES naming a folder it also writes what the shell draws with the waves' and the sky's pictures sent:
// each mood key's two views from the art director's cameras over the proving ground's rim, a beach of an island from
// eye height toward the light and away from it at the keys' eight hours, the sea from 50 m up, and the shore from a
// boat and from 100 m up.
// Run by itself, with the folder: bun tools/probe-lit/water.ts [folder]; with WATER_TIME it instead measures WATER full
// screen, calm and with its waves, and LIT beside it, in ms a megapixel.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera, FAR_FROM } from "../../client/core/render/camera.ts";
import { airFrame } from "../../client/core/render/atmosphere.ts";
import { WATER_PATHS, WATER_BOUNDS, WATER_MARKS, WATER_MARK_COUNT, MAX_WATER_MARKS, DRAW_WATER, FRAME, FRAME_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT } from "../../client/core/render/programs.ts";
import { SKY_SIZE, SKY_SLICES, hourOfSun, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { groundSize } from "../../client/core/render/terrain.ts";
import { beachWash } from "../../client/core/render/swash.ts";
import { FOAM, SHORE, WATER_MATERIAL, seaBank, seaDepth, seaFoam, seaFrame, seaPixel, seaShown } from "../../client/core/render/water.ts";
import { type Bank, bankFoamGain, bankFoamScale, bankNear, bankWash } from "../../client/core/render/bank.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { MapWater } from "../../shared/world/water.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { farRegistry, farWorld, type FarWorld } from "../../tests/fixtures/farworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { packedMips, readPicture } from "../pack/image.ts";
import { EYE, KEYS } from "../sky/base.ts";
import { PICK_SKY, PICK_TERRAIN, Rasterizer } from "../snap/raster.ts";
import { encodePng } from "../snap/png.ts";
import { provingView } from "../snap.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";
import { hazedShown, sendPictures } from "./sky.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const ROOT = resolve(import.meta.dir, "../..");
const [W, H] = [640, 360];
/** Steps of 255 a GPU's sea pixel may be from the twin's. */
const NEAR = 5;
const bank: Bank = { soft: 0, built: 0, still: 0, muddy: 0, grade: 0 };

/** The waves' pictures as the rgba variant sends them, in the frame given, as `fill` in the shell takes them. */
function sendWaves(p: FramePacket, pack: Uint8Array): void {
  const manifest = describePack(parsePack(pack), { name: "", bytes: pack.length });
  const material = manifest.materials!.find((m) => m.id === WATER_MATERIAL)!;
  for (const [role, file] of [["mask", "long.png"], ["mask2", "short.png"]] as const) {
    const mips = packedMips(readPicture(join(ROOT, "assets/source/core/water", file)));
    const top = 1 << (mips.length - 1);
    mips.forEach((data, k) => p.texUploads.push({ slot: material[role], role, format: "rgba", top, size: 1 << k, row: 0, rows: 1 << k, data, last: k === mips.length - 1 }));
  }
}

// An island 2 km across the middle of a map 2 km square: a sandy beach all round, its shore wandering, the sea floor
// falling 1 in 22 to 2.3 m, then 1 in 7 to 45 m.
const ISLE = { x: 1024, z: 1024 };
const shoreAt = (a: number): number => 300 + 20 * Math.sin(3 * a) + 12 * Math.sin(7 * a + 1);
/** Metres inland of the shore, under 0 out to sea. */
const inland = (x: number, z: number): number => shoreAt(Math.atan2(z - ISLE.z, x - ISLE.x)) - Math.hypot(x - ISLE.x, z - ISLE.z);
function islandHeight(x: number, z: number): number {
  const s = inland(x, z);
  if (s >= 0) return 3 * (1 - Math.exp(-s / 40)) + Math.max(0, s - 120) * 0.08;
  const d = -s;
  return -Math.min(d < 50 ? d / 22 : 50 / 22 + (d - 50) / 7, 45);
}

function island(pack: Uint8Array): FarWorld {
  const w = farWorld({ chunks: 32, ground: islandHeight, tier: tierOf("medium"), width: W, height: H, pack: parsePack(pack) });
  w.hf.seaLevel = 0;
  const palette = defaultPalette();
  const [sand, deep, grass] = [nearestColour(palette, 214, 196, 150), nearestColour(palette, 150, 140, 112), nearestColour(palette, 118, 142, 84)];
  for (let j = 0; j < w.hf.nz; j++) {
    for (let i = 0; i < w.hf.nx; i++) {
      const s = inland(i * w.hf.cell, j * w.hf.cell);
      w.hf.tint[j * w.hf.nx + i] = s > 45 ? grass : s > -110 ? sand : deep;
    }
  }
  w.scene.viewDistance = 4000;
  return w;
}

/** Sand 2 m under a calm sea, on a map 512 m square. */
function plate(pack: Uint8Array): FarWorld {
  const w = farWorld({ chunks: 8, ground: () => -2, tier: tierOf("medium"), width: W, height: H, pack: parsePack(pack) });
  w.hf.seaLevel = 0;
  w.hf.tint.fill(nearestColour(defaultPalette(), 214, 196, 150));
  w.scene.viewDistance = 4000;
  return w;
}

/** The plate 20 m up, a pond over the whole of it with no sea round it, as Los Angeles has its lakes: drawn from its squares (lakes.ts). */
function pond(pack: Uint8Array): World {
  const dims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  hf.heights.fill((POND - 2 + 64) * 64);
  hf.tint.fill(nearestColour(defaultPalette(), 214, 196, 150));
  hf.water = MapWater.fromGrid(dims, hf.minY, hf.stepY, CHUNK_SIZE, [{ name: "Pond", level: (POND + 64) * 64 }], new Uint16Array(64).fill(1));
  const reg = farRegistry();
  const parsed = parsePack(pack);
  const scene = new Scene({ dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) }, reg, parsed);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  return { hf, scene, cam, raster: new Rasterizer(W, H, parsed, hf) };
}
const POND = 20;

/** The angle round the island, from x toward z, of the way to the sun or, with `moon`, to the moon, at an hour. */
function lightWay(hour: number, moon: boolean): number {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, theSky(), frame);
  const s = [0, 0, 0];
  trueSun(frame, s);
  return moon ? Math.atan2(-s[2]!, -s[0]!) : Math.atan2(s[2]!, s[0]!);
}

/** Stands the camera on the island's beach facing out to sea at angle `a` round it, `up` metres over the ground `back` metres inland of the shore. */
function onBeach(w: FarWorld, a: number, back: number, up: number, pitch: number): void {
  const r = shoreAt(a) - back;
  [w.cam.x, w.cam.z] = [ISLE.x + Math.cos(a) * r, ISLE.z + Math.sin(a) * r];
  w.cam.y = Math.max(w.hf.heightAt(w.cam.x, w.cam.z), 0) + up;
  w.cam.yaw = Math.atan2(Math.cos(a), Math.sin(a));
  w.cam.pitch = pitch;
}

/** A world a proof frame is made of: the far blocks' fixture or the proving ground. */
type World = Pick<FarWorld, "hf" | "scene" | "cam" | "raster">;

/** What a proof frame keeps to judge it: the frame block, the camera, the rasterizer's picture of what is under the sea, and what to count. */
interface Held {
  key: string;
  frame: number;
  name: string;
  kind: "plate" | "shore" | "grazing" | "split";
  block: Float32Array;
  color: Uint8Array;
  pick: Uint8Array;
  depth: Float32Array;
  window: Int32Array;
  cam: { x: number; y: number; z: number; yaw: number; pitch: number; fovY: number; near: number; far: number; split: number };
  world: World;
  /** The level of the water's surface it is held at: the sea's, or a pond's. */
  surface: number;
}

/** The point of the water's surface at height `sea` the pixel (x, y) of the camera at height `y0` sees, from the camera. */
function surfaceAt(cam: Camera, y0: number, sea: number, x: number, y: number): number[] {
  const r = [0, 0, 0];
  cam.ray((x + 0.5) / W, (y + 0.5) / H, r);
  return r.map((c) => (c * (sea - y0)) / r[1]!);
}

const held: Held[] = [];
let rippleFrame = -1;
const pictured: { key: string; frame: number; name: string }[] = [];

/** Builds a frame of `w` and has the rasterizer draw it with the sea left out, so that it shows what is under it. */
function build(w: World, now: number): FramePacket {
  w.scene.now = now;
  const p = w.scene.build(w.cam, null);
  const kept: number[] = [];
  for (let d = 0; d < p.drawCount; d++) {
    kept.push(p.drawInstances[d]!);
    if ((p.drawFlags[d]! & DRAW_WATER) !== 0) p.drawInstances[d] = 0;
  }
  w.raster.render(p);
  kept.forEach((n, d) => (p.drawInstances[d] = n));
  return p;
}

/** Proof frames of a world in a shot: three frames a view, the last read back and kept, held at the water's surface `surface`. */
function prove(shot: Shot, w: World, name: string, kind: Held["kind"], surface = w.hf.seaLevel, offsetMs = 0): void {
  for (let f = 0; f < 3; f++) {
    const p = build(w, offsetMs + (shot.frames.length + 1) * (1000 / 60));
    shot.add(p, f === 2);
    if (f < 2) continue;
    const c = w.cam;
    held.push({ key: shot.key, frame: shot.frames.length - 1, name, kind, block: p.frame.slice(), color: Uint8Array.from(w.raster.color), pick: w.raster.pickKind.slice(), depth: w.raster.depth.slice(), window: p.groundWindow.slice(), cam: { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fovY: c.fovY, near: c.near, far: c.far, split: p.split }, world: w, surface });
    pictured.push({ key: shot.key, frame: shot.frames.length - 1, name: `proof ${name}` });
  }
}

export const waterCheck: LitCheck = {
  name: "the sea (D270)",

  shots(): Shot[] {
    held.length = pictured.length = 0;
    const pack = buildCorePack();
    const shots: Shot[] = [];
    // Calm, with no pictures sent: the plate from 12 m up, looking down; the beach at the shore from eye height,
    // looking down at the water's edge; the open sea level from the beach at noon and at sunset; and from 50 m up.
    const flat = plate(pack);
    const p1 = new Shot("water-plate", W, H, flat.hf, pack);
    for (const [hour, name] of [[12, "noon"], [17.2, "evening"]] as const) {
      flat.scene.hour = hour;
      [flat.cam.x, flat.cam.z, flat.cam.y, flat.cam.yaw, flat.cam.pitch] = [256, 200, 12, 0.3, -0.9];
      prove(p1, flat, `plate 2 m down, ${name}`, "plate");
    }
    // The same pixels with a localized splash, then with the splash on a different lake level.
    flat.cam.yaw = 0;
    flat.cam.pitch = -Math.atan2(12, 9);
    for (let i = 0; i < 5; i++) {
      const p = build(flat, 2400);
      if (i >= 3) {
        p.frame[WATER_MARK_COUNT] = 1;
        p.frame.set([-4, 5, 4, 13], WATER_BOUNDS);
        p.frame.set([0, 9, 0, 0, i === 3 ? -12 : -9, 0.8, 0.22, -0.8], WATER_MARKS);
      }
      p1.add(p, i >= 2);
      if (i === 2) rippleFrame = p1.frames.length - 1;
    }
    shots.push(p1);
    // The same, a pond's surface 20 m up on a map with no sea: its depth is its own surface's over the ground.
    const lake = pond(pack);
    const p0 = new Shot("water-pond", W, H, lake.hf, pack);
    lake.scene.hour = 12;
    [lake.cam.x, lake.cam.z, lake.cam.y, lake.cam.yaw, lake.cam.pitch] = [256, 200, POND + 12, 0.3, -0.9];
    prove(p0, lake, "a pond 20 m up, 2 m deep, no sea", "plate", POND);
    shots.push(p0);
    const isle = island(pack);
    const p2 = new Shot("water-calm", W, H, isle.hf, pack);
    for (const [hour, name] of [[12, "noon"], [17.6, "sunset"]] as const) {
      isle.scene.hour = hour;
      onBeach(isle, 2.2, 5, 1.7, -0.32);
      prove(p2, isle, `shore, ${name}`, "shore");
      prove(p2, isle, `returning wash, ${name}`, "shore", isle.hf.seaLevel, 3000);
      onBeach(isle, 2.2, 5, 1.7, 0.005);
      prove(p2, isle, `open sea level, ${name}`, "grazing");
      // A row the split crosses has its middle on one side or the other: four heights between them see both.
      for (const up of [50, 50.23, 50.47, 50.71]) {
        onBeach(isle, 2.2, 0, up, -0.14);
        prove(p2, isle, `${up} m up across the split, ${name}`, "split");
      }
      // From 380 m out at sea, 50 m up, looking in at the beach: the split lies on the shallows, the sand just under them.
      for (const up of [50, 50.35]) {
        onBeach(isle, 2.2, -380, up, -0.12);
        isle.cam.yaw += Math.PI;
        prove(p2, isle, `the shallows across the split, ${up} m up, ${name}`, "split");
      }
    }
    shots.push(p2);
    // The open sea past the proving ground from the art director's camera toward the setting sun, 80 m over it, where
    // the dome lies behind the sea at the split: the row the split crosses, at two heights a third of a row apart.
    const cams = JSON.parse(readFileSync(join(ROOT, "assets/source/core/sky/keys/views/cameras.json"), "utf8")) as Record<string, Record<string, { heading: number; elevation: number; horizontalFOV: number }>>;
    const rim = provingView(W, H);
    const p3 = new Shot("water-rim", W, H, rim.hf, pack);
    const toward = cams.sunset!.toward!;
    rim.scene.hour = hourOfSun(0, true);
    for (const up of [0, 0.4]) {
      [rim.cam.x, rim.cam.z] = [EYE.x, EYE.z];
      rim.cam.y = rim.hf.heightAt(EYE.x, EYE.z) + EYE.over + up;
      rim.cam.fovY = 2 * Math.atan(Math.tan((toward.horizontalFOV * Math.PI) / 360) / (W / H));
      [rim.cam.yaw, rim.cam.pitch] = [(-toward.heading * Math.PI) / 180, (toward.elevation * Math.PI) / 180];
      prove(p3, rim, `the keys' sunset camera${up ? ` ${up} m higher` : ""}`, "split");
    }
    shots.push(p3);
    if (!process.env.PROBE_PICTURES) return shots;

    // The keys' views as the art director's cameras saw them (keys/views/cameras.json), from 4 m over the proving
    // ground's rim, with the waves' and the sky's pictures sent.
    const v = provingView(W, H);
    const keys = new Shot("water-keys", W, H, v.hf, pack);
    const found = new Found();
    for (let i = v.nodes.store.query(EYE.x - 60, EYE.z - 60, EYE.x + 60, EYE.z + 60, found) - 1; i >= 0; i--) v.nodes.store.remove(found.refs[i]!);
    for (const key of KEYS) {
      v.scene.hour = key.hour;
      for (const side of ["toward", "away"] as const) {
        const c = cams[key.name]![side]!;
        [v.cam.x, v.cam.z] = [EYE.x, EYE.z];
        v.cam.y = v.hf.heightAt(EYE.x, EYE.z) + EYE.over;
        v.cam.fovY = 2 * Math.atan(Math.tan((c.horizontalFOV * Math.PI) / 360) / (W / H));
        [v.cam.yaw, v.cam.pitch] = [(-c.heading * Math.PI) / 180, (c.elevation * Math.PI) / 180];
        for (let f = 0; f < 3; f++) {
          v.scene.now = (keys.frames.length + 1) * (1000 / 60);
          const p = v.render();
          if (keys.frames.length === 0) {
            sendPictures(p, pack);
            sendWaves(p, pack);
          }
          keys.add(p, f === 2);
        }
        pictured.push({ key: keys.key, frame: keys.frames.length - 1, name: `keys ${key.name}-${side}` });
      }
    }
    shots.push(keys);
    // The island's beach from eye height, and the sea from 50 m up, toward the light and away from it, on a card of its own.
    isle.scene.resetUploads();
    const beach = new Shot("water-beach", W, H, isle.hf, pack);
    for (const key of KEYS) {
      isle.scene.hour = key.hour;
      const toward = lightWay(key.hour, key.moon);
      const views: [string, number, number, number, number, boolean?][] = [["toward", toward, 4, 1.7, -0.1], ["away", toward + Math.PI, 4, 1.7, -0.1]];
      if (key.name === "noon" || key.name === "golden" || key.name === "night") views.push(["high toward", toward, 0, 50, -0.16], ["high away", toward + Math.PI, 0, 50, -0.16]);
      // The shore and its foam from a boat 30 m out, and from 100 m up and 150 m out.
      if (key.name === "noon" || key.name === "golden") views.push(["boat", toward, -30, 2.6, -0.06, true], ["100 m up", toward, -150, 100, -0.5, true]);
      for (const [side, a, back, up, pitch, inland] of views) {
        onBeach(isle, a, back, up, pitch);
        if (inland) isle.cam.yaw += Math.PI;
        for (let f = 0; f < 3; f++) {
          const p = build(isle, (beach.frames.length + 1) * (1000 / 60));
          if (beach.frames.length === 0) {
            sendPictures(p, pack);
            sendWaves(p, pack);
          }
          beach.add(p, f === 2);
        }
        pictured.push({ key: beach.key, frame: beach.frames.length - 1, name: `beach ${key.name}-${side}` });
      }
    }
    shots.push(beach);
    return shots;
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`a calm sea held to water.ts's twin over what the rasterizer draws under it, each within ${NEAR} at 99 points in 100`];
    const plain = back.pixels("water-plate", rippleFrame);
    const impact = back.pixels("water-plate", rippleFrame + 1);
    const above = back.pixels("water-plate", rippleFrame + 2);
    let affected = 0, outside = 0, wrongLevel = 0;
    if (plain && impact && above) {
      const cam = new Camera();
      cam.aspect = W / H;
      cam.pitch = -Math.atan2(12, 9);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const delta = Math.max(...[0, 1, 2].map(k => Math.abs(impact[i + k]! - plain[i + k]!)));
          if (delta > 2) {
            affected++;
            const rel = surfaceAt(cam, 12, 0, x, y);
            if (Math.abs(rel[0]!) > 4.1 || Math.abs(rel[2]! - 9) > 4.1) outside++;
          }
          if ([0, 1, 2].some(k => above[i + k] !== plain[i + k])) wrongLevel++;
        }
      }
    }
    let ok = affected > 100 && outside === 0 && wrongLevel === 0;
    lines.push(`surface impact: ${affected} altered pixels, ${outside} outside its bounds, ${wrongLevel} on another water level: ${ok ? "ok" : "FAIL"}`);
    const table = theSky().table;
    for (const h of held) {
      const gpu = back.pixels(h.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const cam = Object.assign(new Camera(), { yaw: h.cam.yaw, pitch: h.cam.pitch, fovY: h.cam.fovY, aspect: W / H });
      const forward = [Math.sin(h.cam.yaw) * Math.cos(h.cam.pitch), Math.sin(h.cam.pitch), Math.cos(h.cam.yaw) * Math.cos(h.cam.pitch)];
      const sea = h.surface;
      const hf = h.world.hf;
      const size = groundSize(hf);
      const r = [0, 0, 0];
      let [count, over, worst, cover, seen, foamed] = [0, 0, 0, 0, 0, 0];
      const share = [0];
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          const at = y * W + x;
          // The sea all round, within the view: two rows up as well, so that the sea's far edge is not in the pixel.
          cam.ray((x + 0.5) / W, (y - 1.5) / H, r);
          if (r[1]! >= -1e-4 || (sea - h.cam.y) / r[1]! > h.world.scene.viewDistance) continue;
          cam.ray((x + 0.5) / W, (y + 0.5) / H, r);
          const t = (sea - h.cam.y) / r[1]!;
          const rel = r.map((c) => c * t);
          // A pond is drawn on its squares, on the map, and nowhere past them.
          const [wx, wz] = [h.cam.x + rel[0]!, h.cam.z + rel[2]!];
          if (hf.water && (wx < 0 || wz < 0 || wx > hf.sizeX || wz > hf.sizeZ || hf.waterAt(wx, wz) !== sea)) continue;
          // What the rasterizer drew under the sea there must be the ground under it or the dome, the same all round.
          let same = true;
          for (let dy = -2; dy <= 2 && same; dy++) for (let dx = -2; dx <= 2 && same; dx++) {
            const o = at + dy * W + dx;
            same = h.pick[o] === h.pick[at] && Math.max(...[0, 1, 2].map((k) => Math.abs(h.color[o * 4 + k]! - h.color[at * 4 + k]!))) <= 2;
          }
          if (!same || (h.pick[at] !== PICK_TERRAIN && h.pick[at] !== PICK_SKY)) continue;
          let below: number[] | null = [0, 1, 2].map((k) => h.color[at * 4 + k]!);
          if (h.pick[at] === PICK_TERRAIN) {
            const d = h.depth[at]!;
            const far = d >= 0;
            const [n, f] = far ? [h.cam.split * FAR_FROM, h.cam.far] : [h.cam.near, h.cam.split];
            const z = far ? (d - 0.5) * 2 : (d + 0.5) * 2;
            const ground = (2 * f * n) / (f + n - z * (f - n)) / (r[0]! * forward[0]! + r[1]! * forward[1]! + r[2]! * forward[2]!);
            if (ground < t * 1.001) continue;
            below = hazedShown(below, r.map((c) => c * ground), h.block);
            if (!below) continue;
          }
          const depth = seaDepth(h.block, hf, size, h.window, rel[0]!, rel[2]!, rel[1]!, share);
          if (depth <= 0) continue;
          const lean = (Math.asin(-r[1]!) * 180) / Math.PI;
          const want = h.kind === "plate" || (h.kind === "shore" && depth > 0.05 && depth < 0.15) || (h.kind === "grazing" && lean < 4 && depth > 20) || (h.kind === "split" && Math.abs((t * (r[0]! * forward[0]! + r[1]! * forward[1]! + r[2]! * forward[2]!)) / h.cam.split - 1) < 0.15);
          if (!want) continue;
          // The foam's footprints, as the GPU's fwidth takes them from the next pixel across and down.
          const [across, down] = [surfaceAt(cam, h.cam.y, sea, x + 1, y), surfaceAt(cam, h.cam.y, sea, x, y + 1)];
          const wide = Math.hypot(Math.abs(across[0]! - rel[0]!) + Math.abs(down[0]! - rel[0]!), Math.abs(across[2]! - rel[2]!) + Math.abs(down[2]! - rel[2]!));
          const ddx = seaDepth(h.block, hf, size, h.window, across[0]!, across[2]!, across[1]!) - depth;
          const ddy = seaDepth(h.block, hf, size, h.window, down[0]!, down[2]!, down[1]!) - depth;
          const ax = across[0]! - rel[0]!, az = across[2]! - rel[2]!, bx = down[0]! - rel[0]!, bz = down[2]! - rel[2]!;
          const det = ax * bz - az * bx;
          const gx = (ddx * bz - ddy * az) / det, gz = (ax * ddy - bx * ddx) / det;
          // What the water meets (bank.ts), from the window's samples as the GPU reads them.
          seaBank(h.block, hf, size, h.window, rel[0]!, rel[2]!, rel[1]!, depth < 1.1 ? share[0]! * bankNear(t) : 0, bank);
          const wash = t < 110 ? beachWash(h.block, rel[0]!, rel[2]!, depth, share[0]! * bankWash(bank), gx, gz, t) : { depth, film: 0, slopeX: 0, slopeZ: 0, lace: 1 };
          const lap = bankFoamScale(bank, FOAM);
          const foam = wash.lace * bankFoamGain(bank) * seaFoam(h.block, rel[0]!, rel[2]!, wash.depth * lap, share[0]!, wide, (Math.abs(ddx) + Math.abs(ddy)) * lap);
          const n = Math.hypot(wash.slopeX, 1, wash.slopeZ);
          const px = seaPixel(h.block, table, [-wash.slopeX / n, 1 / n, -wash.slopeZ / n], r.map((c) => -c), wash.depth, 0, 1, foam, bank);
          px.film = wash.film;
          foamed += foam;
          const shown = seaShown(px, rel, below, h.block, table);
          const off = Math.max(...[0, 1, 2].map((k) => Math.abs(gpu[at * 4 + k]! - shown[k]!)));
          count++;
          if (off > NEAR) over++;
          worst = Math.max(worst, off);
          cover += px.cover;
          seen += Math.max(...[0, 1, 2].map((k) => Math.abs(gpu[at * 4 + k]! - below![k]!)));
        }
      }
      const fine = count >= 300 && over <= count * 0.01;
      ok &&= fine;
      const extra = h.kind === "shore" ? `; the twin covers ${((cover / Math.max(count, 1)) * 100).toFixed(0)}% of what is under it, ${((foamed / Math.max(count, 1)) * 100).toFixed(0)}% with foam, and the GPU's pixel is ${(seen / Math.max(count, 1)).toFixed(1)} steps from it on average (fades out over the last ${SHORE} m)` : "";
      lines.push(`${h.name.padEnd(36)} ${count} points, ${over} over ${NEAR}, worst ${worst.toFixed(1)}${extra}  ${fine ? "ok" : "FAIL"}`);
    }
    const folder = process.env.PROBE_PICTURES;
    if (folder) {
      mkdirSync(folder, { recursive: true });
      for (const p of pictured) {
        const px = back.pixels(p.key, p.frame);
        if (px) writeFileSync(join(folder, `${p.name.replace(/[ ,.]+/g, "-")}.png`), encodePng(W, H, px));
      }
      lines.push(`${pictured.length} pictures written to ${folder}`);
    }
    return { ok, lines };
  },
};

/**
 * The timing page: each program full screen on a canvas 1,024 square, blended so that a tiled GPU shades every pixel of
 * every draw, by timer query where there is one, else by the clock; seven rounds in a turned order, the median. The
 * sea is a plane 10 m under the eye from 20 m to 420 m off, 2 m deep over ground read from a window 1,025 square, or
 * 15 cm deep, where it is all under foam.
 */
const TIME_PAGE = `<!doctype html><meta charset="utf-8"><title>water timing</title><body><script type="module">
const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const { runs, UNIT, SKY_SIZE, SKY_SLICES, ground, sand } = await get("/runs");
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [1024, 1024];
  const gl = canvas.getContext("webgl2", { antialias: false });
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, gl.createBuffer());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SLICES, 0, gl.RGBA, gl.UNSIGNED_BYTE, await bytes("/table"));
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  const heights = new Uint16Array(ground * ground).fill(ground === 0 ? 0 : 3968);
  for (const unit of [UNIT.heights, UNIT.windowHeights]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, ground, ground, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  gl.activeTexture(gl.TEXTURE0 + UNIT.windowTint);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, ground, ground, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(ground * ground).fill(sand));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const waves = [];
  gl.activeTexture(gl.TEXTURE0 + UNIT.maps);
  for (const name of ["long", "short"]) {
    const mips = await get("/mips/" + name);
    const blob = await bytes("/mips/" + name + ".bin");
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const top = mips.length - 1;
    gl.texStorage2D(gl.TEXTURE_2D, mips.length, gl.RGBA8, 1 << top, 1 << top);
    let at = 0;
    for (let k = 0; k < mips.length; k++) {
      gl.texSubImage2D(gl.TEXTURE_2D, top - k, 0, 0, 1 << k, 1 << k, gl.RGBA, gl.UNSIGNED_BYTE, blob.subarray(at, at + (4 << (2 * k))));
      at += 4 << (2 * k);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    waves.push(t);
  }
  const calm = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, calm);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const programs = runs.map((r) => {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, r.vertex], [gl.FRAGMENT_SHADER, r.fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(r.name + ": " + gl.getShaderInfoLog(s));
      gl.attachShader(program, s);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name in r.samplers) gl.uniform1i(gl.getUniformLocation(program, name), r.samplers[name]);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "Frame"), 0);
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniform3f(u("uSky"), 0.6, 0.75, 0.9);
    gl.uniform3f(u("uCamMod"), 0.3, 0.2, 0.1);
    gl.uniform2f(u("uFog"), 1e6, 2e6);
    for (const name of ["uSolid", "uAlpha"]) gl.uniform1f(u(name), 1);
    return { program, frame: new Float32Array(r.frame), waves: r.waves };
  });
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, 1024, 1024);
  const one = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  const ms = async (p, n) => {
    gl.useProgram(p.program);
    gl.bufferData(gl.UNIFORM_BUFFER, p.frame, gl.DYNAMIC_DRAW);
    for (const [k, unit] of [[0, UNIT.maps + 3], [1, UNIT.maps + 4]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, p.waves ? waves[k] : calm);
    }
    for (let i = 0; i < 4; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    finish();
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error("water timing WebGL error: " + error);
    if (timer) {
      const q = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      finish();
      for (let wait = 0; wait < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); wait++) await new Promise((r) => setTimeout(r, 5));
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n;
    }
    const t0 = performance.now();
    for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    finish();
    return (performance.now() - t0) / n;
  };
  const times = runs.map(() => []);
  for (let round = 0; round < 7; round++) {
    for (let k = 0; k < runs.length; k++) {
      const i = (k + round) % runs.length;
      times[i].push((await ms(programs[i], 60)) / ((1024 * 1024) / 1e6));
    }
  }
  const out = { timer: !!timer, renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
  runs.forEach((r, i) => (out[r.name] = times[i].sort((a, b) => a - b)[3]));
  await post("/done", JSON.stringify(out));
} catch (e) {
  await post("/done", JSON.stringify({ error: String((e && e.stack) || e) }));
}
</script>`;

/** WATER full screen, calm and with its waves, inside the window and past the map and shallow enough for foam, and LIT hazed for scale; noon's frame block, in ms a megapixel, blended. */
async function timeWater(chrome: string): Promise<Record<string, number | string | boolean>> {
  const ground = 1025;
  const sand = nearestColour(defaultPalette(), 214, 196, 150);
  const hf = new Heightfield({ chunksX: 32, chunksZ: 32 }, 2, -64, 1 / 64);
  hf.seaLevel = 0;
  // The ground 2 m under the sea, or `deep` metres under it where the sea's level is moved down to it.
  const frame = (inside: boolean, deep = 2): number[] => {
    const f = new Float32Array(FRAME_FLOATS);
    skyFrame(12, theSky(), f);
    airFrame(f, theSky(), 12, 0, 0, 0, 4000, 0, false);
    f[FRAME.eyeHeight] = 10;
    seaFrame(f, hf, groundSize(hf), Int32Array.of(0, 0, 0, -1, 0, 0, 0, 0), inside ? 1024 : -2000, 1024, 0);
    f[FRAME.sea] = f[FRAME.sea]! - (2 - deep) / hf.stepY;
    return [...f];
  };
  // The sea 10 m under the eye, spread over the screen from 20 m to 420 m off.
  const vertex = `#version 300 es\nout vec3 vRel;\nflat out vec3 vColor;\nflat out int vSurface;\nflat out vec4 vFinish; flat out float vShare;\nvoid main() {\n  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\n  vRel = vec3(at.x * 200.0, -10.0, at.y * 200.0 + 220.0);\n  gl_Position = vec4(at, 0.5, 1.0);\n  vColor = vec3(0.24, 0.43, 0.67);\n  vSurface = 0; vFinish = vec4(0); vShare = 0.0;\n}`;
  const water = PROGRAMS.water!(tierOf("medium"), "rgba");
  const lit = PROGRAMS.flat!(tierOf("medium"), "rgba");
  const runs = [
    { name: "WATER, calm", vertex, fragment: water.fragment, samplers: water.samplers, frame: frame(true), waves: false },
    { name: "WATER, waves", vertex, fragment: water.fragment, samplers: water.samplers, frame: frame(true), waves: true },
    { name: "WATER, waves, open sea", vertex, fragment: water.fragment, samplers: water.samplers, frame: frame(false), waves: true },
    { name: "WATER, waves, 15 cm deep, foam", vertex, fragment: water.fragment, samplers: water.samplers, frame: frame(true, 0.15), waves: true },
    { name: "LIT, hazed, same place", vertex, fragment: lit.fragment, samplers: lit.samplers, frame: frame(true), waves: false },
  ];
  // A nearby hull covers the view. Measure empty, touch and desktop budgets with identical pixels and wave maps.
  const close = vertex.replace("at.x * 200.0", "at.x * 7.0").replace("at.y * 200.0 + 220.0", "at.y * 6.0 + 8.0");
  for (const count of [0, 4, MAX_WATER_MARKS]) {
    const f = frame(true);
    f[WATER_MARK_COUNT] = count;
    f.splice(WATER_BOUNDS, 4, -8, 0, 8, 16);
    for (let i = 0; i < count; i++) {
      f.splice(WATER_MARKS + 8 * i, 8, (i % 3 - 1) * 3, 2 + Math.floor(i / 3) * 3.2, 0.3, 1.8, -10, i * 0.18, 1, 0.5);
      f.splice(WATER_PATHS + 4 * i, 4, 0.43, -0.22, 0.18, 3);
    }
    const fragment = count ? water.fragment.replace("#version 300 es", "#version 300 es\n#define LOCAL_WAKES") : water.fragment;
    runs.push({ name: `WATER, close hull, ${count} marks`, vertex: close, fragment, samplers: water.samplers, frame: f, waves: true });
  }
  const mips = { long: packedMips(readPicture(join(ROOT, "assets/source/core/water/long.png"))), short: packedMips(readPicture(join(ROOT, "assets/source/core/water/short.png"))) };
  let finish: (r: Record<string, number | string | boolean>) => void = () => {};
  const finished = new Promise<Record<string, number | string | boolean>>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const [, kind, name = ""] = path.split("/");
      if (path === "/") return new Response(TIME_PAGE, { headers: { "content-type": "text/html" } });
      if (path === "/runs") return Response.json({ runs, UNIT, SKY_SIZE, SKY_SLICES, ground, sand });
      if (path === "/table") return new Response(theSky().table);
      if (kind === "mips") {
        const key = name.replace(".bin", "") as keyof typeof mips;
        return name.endsWith(".bin") ? new Response(Buffer.concat(mips[key])) : Response.json(mips[key].map((m) => m.length));
      }
      if (path === "/done") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const done = await Promise.race([finished, new Promise<Record<string, string>>((r) => setTimeout(() => r({ error: "the page sent nothing within five minutes" }), 300000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (done.error) throw new Error(String(done.error));
  return done;
}

if (import.meta.main) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome found. Set CHROME to its path.");
  if (process.env.WATER_TIME) {
    const t = await timeWater(chrome);
    console.log(`full screen on ${t.renderer}, blended, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel:`);
    for (const [name, v] of Object.entries(t)) if (typeof v === "number") console.log(`  ${name.padEnd(24)} ${v.toFixed(3)}`);
    process.exit(0);
  }
  if (process.argv[2]) process.env.PROBE_PICTURES = process.argv[2];
  // Loaded once this file has been, since the probe lists this check.
  const { litProbe } = await import("../probe-lit.ts");
  process.exit((await litProbe(chrome, [waterCheck])) ? 0 : 1);
}
