// bun tools/snap/night-study.ts <miami.snmap> <built assets directory> <output directory> [--gpu] [--hour=22] [--only=name]
//
// The night moments (planning/workstreams/night-light.md), each drawn as it was before and as built, from the same frame
// where the frame block can say so. The moon: the rose arcade of the shade study (shade-study.ts), with cars parked at
// the kerb before it, under the moon at 22:00, before the moon cast through the cascades and after. It writes
// `<state>/<scene>-<view>-software.png`, and with --gpu `<state>/<scene>-<view>.png` drawn by the shell's renderer with
// the shadows, which the software render has not, and prints the sRGB of a few probes, each the median of a 5 by 5
// window round where a point of the scene falls on screen. It draws on high.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, parseMap } from "../../shared/world/mapfile.ts";
import { mapHeightfield } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { CAST_AT, FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView, settle } from "../snap.ts";
import { encodePng } from "./png.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
const gpu = process.argv.includes("--gpu");
const hour = Number(process.argv.find((a) => a.startsWith("--hour="))?.slice(7) ?? 22);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));

/** A place in a frame of its own: an origin, a turn, and x along, z out from it. */
interface Frame { readonly x: number; readonly z: number; readonly c: number; readonly s: number }
const frameAt = (x: number, z: number, yaw: number): Frame => ({ x, z, c: Math.cos(yaw), s: Math.sin(yaw) });
const at = (f: Frame, x: number, z: number): [number, number] => [f.x + f.c * x + f.s * z, f.z - f.s * x + f.c * z];

/** The rose arcade of the shade study: x along it, z out from its middle, its outer edge at z -3 and the wall at z +1. */
const t = map.statics;
let slab = -1;
for (let i = 0; i < t.kind.length && slab < 0; i++) if (Math.hypot(t.x[i]! - 7633.2, t.z[i]! - 7463.5) < 2 && t.kinds[t.kind[i]!] === "core:zruin_zroof8_rose") slab = i;
if (slab < 0) throw new Error("The rose arcade is not on this map");
const ARCADE = frameAt(t.x[slab]!, t.z[slab]!, (t.yaw[slab]! / 65536) * 2 * Math.PI);

interface View { readonly name: string; readonly eye: readonly [number, number, number]; readonly at: readonly [number, number, number] }
interface Probe { readonly name: string; readonly x: number; readonly y: number; readonly z: number }
interface Scene {
  readonly name: string;
  readonly frame: Frame;
  /** Cars parked at the kerb, as statics: x along, z out, turn in radians from the frame's, and kind. */
  readonly parked: readonly (readonly [number, number, number, string])[];
  readonly views: readonly View[];
  /** Heights over the frame's ground at its origin. */
  readonly probes: readonly Probe[];
  /** Each state's folder, and what it changes in a built frame. */
  readonly states: readonly { readonly name: string; readonly set: (p: FramePacket) => void }[];
}

const SCENES: readonly Scene[] = [
  {
    name: "moon",
    frame: ARCADE,
    parked: [[-9.5, -6.6, Math.PI / 2, "core:compact_abandoned_blue"], [-3.6, -6.6, Math.PI / 2, "core:compact_abandoned_white"], [4.2, -6.7, -Math.PI / 2, "core:compact_abandoned_red"]],
    views: [
      { name: "street", eye: [-12, 1.7, -13], at: [0, 1.2, -2] },
      { name: "along", eye: [12, 1.7, -9.5], at: [-4, 0.8, -5] },
    ],
    probes: [
      { name: "floor under", x: 1.2, y: 0.02, z: -0.6 },
      { name: "walk out", x: 1.2, y: 0.05, z: -4.6 },
      { name: "road by car", x: -3.6, y: 0.0, z: -8.6 },
      { name: "car roof", x: -3.6, y: 1.4, z: -6.6 },
      { name: "back wall", x: 3.0, y: 1.0, z: 0.95 },
    ],
    states: [
      // Before: the moon lights everything as if nothing stood in its way, as main drew it.
      { name: "before", set: (p) => void (p.frame[CAST_AT + 3] = 0) },
      { name: "after", set: () => {} },
    ],
  },
];

const width = 1280, height = 720;
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) if (Math.hypot(t.x[i]! - ARCADE.x, t.z[i]! - ARCADE.z) < 260) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
for (const scene of SCENES) for (const [x, z, turn, kind] of scene.parked) {
  const [wx, wz] = at(scene.frame, x, z);
  const yaw = Math.atan2(scene.frame.s, scene.frame.c) + turn;
  rows.push({ kind, x: wx, y: hf.heightAt(wx, wz), z: wz, yaw: Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff });
}
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote, raster } = v;
scene.assets.tier = tierOf("high");
scene.viewHeight = height;
scene.hour = hour;
cam.fovY = (57 * Math.PI) / 180;
remote.count = 0;

function look(s: Scene, view: View): number {
  const ground = hf.heightAt(s.frame.x, s.frame.z);
  const e = at(s.frame, view.eye[0], view.eye[2]), a = at(s.frame, view.at[0], view.at[2]);
  cam.x = e[0];
  cam.z = e[1];
  cam.y = ground + view.eye[1];
  cam.yaw = Math.atan2(a[0] - e[0], a[1] - e[1]);
  cam.pitch = Math.atan2(ground + view.at[1] - cam.y, Math.hypot(a[0] - e[0], a[1] - e[1]));
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 3, () => false);
  return ground;
}

/** Where each probe falls on screen with the packet's view, or null behind the camera or off it. */
function probeAt(s: Scene, ground: number, p: { viewProj: Float32Array }): ([number, number] | null)[] {
  return s.probes.map((q) => {
    const [wx, wz] = at(s.frame, q.x, q.z);
    const r = [wx - cam.x, ground + q.y - cam.y, wz - cam.z];
    const m = p.viewProj;
    const cx = m[0]! * r[0]! + m[4]! * r[1]! + m[8]! * r[2]! + m[12]!;
    const cy = m[1]! * r[0]! + m[5]! * r[1]! + m[9]! * r[2]! + m[13]!;
    const cw = m[3]! * r[0]! + m[7]! * r[1]! + m[11]! * r[2]! + m[15]!;
    if (cw <= 0) return null;
    const sx = Math.round(((cx / cw) * 0.5 + 0.5) * width), sy = Math.round((0.5 - (cy / cw) * 0.5) * height);
    return sx < 2 || sy < 2 || sx >= width - 2 || sy >= height - 2 ? null : [sx, sy];
  });
}

/** The median sRGB of a 5 by 5 window of `picture` at each probe. */
function measure(picture: Uint8Array | Uint8ClampedArray, places: ([number, number] | null)[]): string[] {
  return places.map((q) => {
    if (!q) return "off screen";
    const channel = (k: number): number => {
      const values: number[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) values.push(picture[((q[1] + dy) * width + q[0] + dx) * 4 + k]!);
      return values.sort((a, b) => a - b)[12]!;
    };
    const [r, g, b] = [channel(0), channel(1), channel(2)];
    return `${r},${g},${b} luma ${Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)}`;
  });
}

/** Whether the sky's openness and the map of what stands overhead are on the card, which the scene does over frames. */
const ready = (): boolean => !!scene.farShadow?.whole;
function readied(): void {
  for (let k = 0; k < 2000 && !ready(); k++) {
    scene.now += 1000 / 60;
    v.port!.advance(scene.now);
    const p = scene.build(cam, remote);
    p.drawCount = p.tileCount = 0;
    raster.render(p);
  }
  if (!ready()) throw new Error("the sky's openness or the roof map did not come");
}

const chosen = SCENES.filter((s) => !only || s.name === only);
for (const s of chosen) for (const state of s.states) mkdirSync(join(out, state.name), { recursive: true });
const report: string[] = [];
const places: ([number, number] | null)[][] = [];
for (const s of chosen) {
  for (const view of s.views) {
    const ground = look(s, view);
    settle(v);
    readied();
    settle(v);
    scene.now += 510;
    const p = v.render();
    const where = probeAt(s, ground, p);
    places.push(where);
    const kept = p.frame.slice();
    for (const state of s.states) {
      state.set(p);
      raster.render(p);
      const name = `${state.name}/${s.name}-${view.name}`;
      writeFileSync(join(out, name + "-software.png"), encodePng(width, height, raster.color));
      measure(raster.color, where).forEach((m, k) => report.push(`${name} software ${s.probes[k]!.name.padEnd(14)} ${m}`));
      p.frame.set(kept);
    }
  }
}
console.log(report.join("\n"));
if (!gpu) process.exit(0);

const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the WebGL study");
scene.resetUploads();
const shot = new Shot("night-light", width, height, hf, files[0]!);
shot.manifest = manifest;
shot.shadows = true;
const names: string[] = [];
const probes: Probe[][] = [];
const passed = await litProbe(chrome, [{
  name: "Night light",
  shots() {
    for (const s of chosen) {
      for (const view of s.views) {
        look(s, view);
        let settled = 0;
        for (let frame = 0; frame < 900 && settled < 30; frame++) {
          scene.now += 1000 / 60;
          v.port!.advance(scene.now);
          const p = scene.build(cam, remote);
          const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
          const load = scene.assets.residency;
          settled = !loading && !load.flying && !load.waiting && ready() && p.frame[FRAME.reflection + 3] === 1 ? settled + 1 : 0;
          if (settled >= 30) break;
          p.drawCount = p.tileCount = p.casterCount = 0;
          shot.add(p);
        }
        const p = scene.packet, kept = p.frame.slice();
        for (const state of s.states) {
          state.set(p);
          shot.add(p, true);
          p.frame.set(kept);
          names.push(`${state.name}/${s.name}-${view.name}`);
          probes.push(s.probes as Probe[]);
        }
      }
    }
    return [shot];
  },
  judge(back) {
    const lines = [back.device.renderer];
    let view = -1;
    names.forEach((name, k) => {
      const picture = back.pixels(shot.key, shot.read[k]!)!;
      writeFileSync(join(out, name + ".png"), encodePng(width, height, picture));
      if (k === 0 || names[k - 1]!.split("/")[1] !== name.split("/")[1]) view++;
      measure(picture, places[view]!).forEach((m, j) => lines.push(`${name} gpu ${probes[k]![j]!.name.padEnd(14)} ${m}`));
    });
    return { ok: names.length > 0, lines };
  },
}]);
process.exit(passed ? 0 : 1);
