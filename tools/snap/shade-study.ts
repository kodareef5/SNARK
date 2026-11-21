// bun tools/snap/shade-study.ts <miami.snmap> <built assets directory> <output directory> [--gpu] [--hours=12,17]
//
// The arcade moment (planning/workstreams/shade-light.md): a pink arcade on the north face of a building in Miami, a
// slab 8 m wide standing 4 m out over the walk with its underside 2.7 m up, so at noon the sun is in front of it and the
// walk before it is sunlit. A white compact stands nose in, half under it, and a survivor in a white shirt stands on its
// edge. Two views, from the street and from under the arcade looking out, at each hour asked for (noon and 17:00 by
// default), each in the states of STATES, one folder each: the frame as built, and with what was added since the study
// was made switched off in its frame block, as the lit programs drew it before. It writes `<state>/<view>-<hhmm>-software.png`,
// and with --gpu `<state>/<view>-<hhmm>.png` drawn by the shell's renderer with the sun's shadows, which the software
// render has not. For each it prints the sRGB of a few probes, each the
// median of a 5 by 5 window round where a point of the scene falls on screen: the floor under the arcade and the walk
// in the sun, the car's flank and roof under it and out of it, the shirt, the arcade's ceiling near its edge and deep
// under it, and the shop's wall at its back. `-probes.png` marks where they fall. It draws on high.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME, ROOF_AT, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView, settle } from "../snap.ts";
import { encodePng } from "./png.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
mkdirSync(out, { recursive: true });
const gpu = process.argv.includes("--gpu");
const hours = (process.argv.find((a) => a.startsWith("--hours="))?.slice(8) ?? "12,17").split(",").map(Number);
if (hours.some((h) => !Number.isFinite(h) || h < 0 || h >= 24)) throw new Error("--hours must be hours in [0,24)");
const map = parseMap(Bun.mmap(mapPath), true, true);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));

/** The arcade: the rose slab nearest this point, at 3.2 m over its ground, its building on its +z side in its own frame. */
const SITE = { x: 7633.2, z: 7463.5 };
const t = map.statics;
let slab = -1;
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) {
  const d = Math.hypot(t.x[i]! - SITE.x, t.z[i]! - SITE.z);
  if (d < 2 && t.kinds[t.kind[i]!] === "core:zruin_zroof8_rose") slab = i;
  if (d < 200) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
}
if (slab < 0) throw new Error("The rose arcade is not on this map");
const yaw = (t.yaw[slab]! / 65536) * 2 * Math.PI, c = Math.cos(yaw), s = Math.sin(yaw);
/** A point in the arcade's frame: x along it, z out from its middle, its outer edge at z -3 and the wall at z +1. */
const world = (x: number, z: number): [number, number] => [t.x[slab]! + c * x + s * z, t.z[slab]! - s * x + c * z];

const width = 1280, height = 720;
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) });
const { cam, scene, remote, hf, raster } = v;
scene.assets.tier = tierOf("high");
scene.viewHeight = height;
cam.fovY = (57 * Math.PI) / 180;
const ground = hf.heightAt(...world(0, -3));

// The car nose in toward the wall with its middle on the edge, white; the survivor on the edge further along, facing out.
const car = world(-1.6, -3), man = world(2.3, -2.9);
const placeBody = (n: number, id: number, kind: string, at: [number, number], turn: number): void => {
  const k = v.reg.index.get(kind);
  if (k === undefined) throw new Error("No " + kind);
  remote.id[n] = id;
  remote.kind[n] = k;
  [remote.x[n], remote.z[n]] = at;
  remote.y[n] = hf.heightAt(at[0], at[1]);
  remote.yaw[n] = turn;
  remote.flags[n] = 1;
  remote.anim[n] = 0;
};
placeBody(0, 1701, "core:compact", car, yaw);
remote.colors[0] = 10;
placeBody(1, 1702, "core:survivor", man, yaw + Math.PI);
remote.colors[6 + 1] = 10;
remote.count = 2;

interface View { readonly name: string; readonly eye: [number, number, number]; readonly at: [number, number, number] }
/** From the street, out and to the open end; and from under the arcade by the wall, looking out past the car. */
const VIEWS: readonly View[] = [
  { name: "street", eye: [-6.5, 1.6, -13.5], at: [0.3, 1.0, -2.2] },
  { name: "under", eye: [3.4, 1.45, 0.25], at: [-1.6, 1.05, -7.5] },
];
function look(view: View): void {
  const e = world(view.eye[0], view.eye[2]), a = world(view.at[0], view.at[2]);
  cam.x = e[0];
  cam.z = e[1];
  cam.y = ground + view.eye[1];
  cam.yaw = Math.atan2(a[0] - e[0], a[1] - e[1]);
  cam.pitch = Math.atan2(ground + view.at[1] - cam.y, Math.hypot(a[0] - e[0], a[1] - e[1]));
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 3, () => false);
}

/** Points measured, in the arcade's frame: x along, height over its ground, z out. */
const PROBES: readonly (readonly [string, number, number, number])[] = [
  ["floor under", 1.2, 0.02, -1.4],
  ["walk in sun", 1.2, 0.05, -4.6],
  ["car flank under", -2.5, 0.72, -2.1],
  ["car flank out", -2.5, 0.72, -3.9],
  ["car roof under", -1.6, 1.42, -2.3],
  ["car roof out", -1.6, 1.42, -3.8],
  ["shirt", 2.3, 1.3, -3.08],
  ["ceiling edge", 1.0, 2.69, -2.6],
  ["ceiling deep", 1.0, 2.69, -0.3],
  ["back wall", 3.0, 1.0, 0.95],
];
/**
 * Each state: its folder, and what the frame block's fRoof.w is set to, or null for as built: 0 is before what stands
 * overhead took the sky's light down (render/roof.ts).
 */
const STATES: readonly { readonly name: string; readonly roof: number | null }[] = [
  { name: "before", roof: 0 },
  { name: "roofs", roof: null },
];
for (const state of STATES) mkdirSync(join(out, state.name), { recursive: true });
/** Calls `draw` with the packet in each state in turn, and leaves it as built. */
function inEach(p: FramePacket, draw: (name: string) => void): void {
  const built = p.frame[ROOF_AT + 3]!;
  for (const state of STATES) {
    p.frame[ROOF_AT + 3] = state.roof ?? built;
    draw(state.name);
  }
  p.frame[ROOF_AT + 3] = built;
}
const hhmm = (h: number): string => String(Math.floor(h)).padStart(2, "0") + String(Math.round((h % 1) * 60)).padStart(2, "0");

/** Where each probe falls on screen with the packet's view, or null behind the camera or off it. */
function probeAt(p: { viewProj: Float32Array }): ([number, number] | null)[] {
  return PROBES.map(([, x, y, z]) => {
    const [wx, wz] = world(x, z);
    const r = [wx - cam.x, ground + y - cam.y, wz - cam.z];
    const m = p.viewProj;
    const cx = m[0]! * r[0]! + m[4]! * r[1]! + m[8]! * r[2]! + m[12]!;
    const cy = m[1]! * r[0]! + m[5]! * r[1]! + m[9]! * r[2]! + m[13]!;
    const cw = m[3]! * r[0]! + m[7]! * r[1]! + m[11]! * r[2]! + m[15]!;
    if (cw <= 0) return null;
    const sx = Math.round((cx / cw * 0.5 + 0.5) * width), sy = Math.round((0.5 - cy / cw * 0.5) * height);
    return sx < 2 || sy < 2 || sx >= width - 2 || sy >= height - 2 ? null : [sx, sy];
  });
}

/** The median sRGB of a 5 by 5 window of `picture` at each probe. */
function measure(picture: Uint8Array | Uint8ClampedArray, at: ([number, number] | null)[]): string[] {
  return at.map((q) => {
    if (!q) return "off screen";
    const channel = (k: number): number => {
      const values: number[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) values.push(picture[((q[1] + dy) * width + q[0] + dx) * 4 + k]!);
      return values.sort((a, b) => a - b)[12]!;
    };
    const [r, g, b] = [channel(0), channel(1), channel(2)];
    return `${r},${g},${b} luma ${Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)} warm ${r - b}`;
  });
}

function marked(picture: Uint8ClampedArray, at: ([number, number] | null)[]): Uint8ClampedArray {
  const copy = Uint8ClampedArray.from(picture);
  for (const q of at) {
    if (!q) continue;
    for (let d = -6; d <= 6; d++) for (const [x, y] of [[q[0] + d, q[1]], [q[0], q[1] + d]] as const) if (x >= 0 && y >= 0 && x < width && y < height) copy.set([255, 0, 255, 255], (y * width + x) * 4);
  }
  return copy;
}

const report: string[] = [];
const places: ([number, number] | null)[][] = [];
for (const hour of hours) {
  scene.hour = hour;
  for (const view of VIEWS) {
    look(view);
    settle(v);
    scene.now += 510;
    const p = v.render();
    const at = probeAt(p);
    places.push(at);
    inEach(p, (state) => {
      raster.render(p);
      const name = `${state}/${view.name}-${hhmm(hour)}`;
      writeFileSync(join(out, name + "-software.png"), encodePng(width, height, raster.color));
      writeFileSync(join(out, name + "-probes.png"), encodePng(width, height, marked(raster.color, at)));
      measure(raster.color, at).forEach((m, k) => report.push(`${name} software ${PROBES[k]![0].padEnd(16)} ${m}`));
    });
  }
}
console.log(report.join("\n"));
if (!gpu) process.exit(0);

const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the WebGL study");
scene.resetUploads();
const shot = new Shot("arcade-shade", width, height, hf, files[0]!);
shot.manifest = manifest;
shot.shadows = true;
const names: string[] = [];
const passed = await litProbe(chrome, [{
  name: "Arcade shade",
  shots() {
    for (const hour of hours) {
      scene.hour = hour;
      for (const view of VIEWS) {
        look(view);
        let settled = 0;
        for (let frame = 0; frame < 900 && settled < 30; frame++) {
          scene.now += 1000 / 60;
          v.port!.advance(scene.now);
          const p = scene.build(cam, remote);
          const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
          const load = scene.assets.residency;
          settled = !loading && !load.flying && !load.waiting && p.frame[FRAME.reflection + 3] === 1 ? settled + 1 : 0;
          if (settled >= 30) break;
          p.drawCount = p.tileCount = p.casterCount = 0;
          shot.add(p);
        }
        inEach(scene.packet, (state) => {
          shot.add(scene.packet, true);
          names.push(`${state}/${view.name}-${hhmm(hour)}`);
        });
      }
    }
    return [shot];
  },
  judge(back) {
    const lines = [back.device.renderer];
    names.forEach((name, k) => {
      const picture = back.pixels(shot.key, shot.read[k]!)!;
      writeFileSync(join(out, name + ".png"), encodePng(width, height, picture));
      measure(picture, places[Math.floor(k / STATES.length)]!).forEach((m, j) => lines.push(`${name} gpu ${PROBES[j]![0].padEnd(16)} ${m}`));
    });
    return { ok: names.length === hours.length * VIEWS.length * STATES.length, lines };
  },
}]);
process.exit(passed ? 0 : 1);
