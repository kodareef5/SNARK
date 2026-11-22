// bun tools/snap/night-study.ts <miami.snmap> <built assets directory> <output directory> [--gpu] [--hour=22] [--only=name] [--optic=night|heat]
//   [--states=name] [--tier=high] [--view=name]
//
// The night moments (planning/workstreams/night-light.md), each drawn in the states the moment has: as main drew it,
// with the moon's shadows (render/sky.ts castLight), and with the street lamp that lights as a light as well
// (render/lamp.ts). Each state is a frame built with the scene's switches for it (`moonShadows`, the street lamps'
// `light`) at the same moment of the scene's clock.
//
// - moon: the rose arcade of the shade study (shade-study.ts), with cars parked at the kerb before it, at 22:00, the moon
//   52 degrees up.
// - lamp: a working lamp of a pair either side of a road, a white compact driven past under it (three places along the
//   road) and a survivor standing at the kerb under it.
// - handover: the camera stepped across the road from the first lamp's side of the pair to the second's, and the frames a twentieth, a
//   tenth and three twentieths of a second on, as the first lamp's light fades into its card and the second's card into
//   its light (fade); the same step, and the frames a little and a while after, where it is too short for the light to
//   change hands (step); and a step from the first lamp's kerb to the second's, nearer the lamps, and the frames over
//   the second after it (cross).
// - cars, front: the GPU bench's two busy lamps (tools/bench/gpu.ts), over a row of parked cars and before a front.
//
// It writes `<state>/<scene>-<view>-software.png`, and with --gpu `<state>/<scene>-<view>.png` drawn by the shell's
// renderer with the shadows, which the software render has not, and prints the sRGB of a few probes, each the median of
// a 5 by 5 window round where a point of the scene falls on screen. It draws on high, or the tier --tier names; --states
// names the states drawn, of each scene's, and --view the one view of a scene's. In the states without the lamp's light,
// every lamp is its cards, which take the shadows of the bodies and cars in their pools (render/lamp.ts poolShade); in
// `plain` they take none, as before that (`?ab=pools`).
import { Visor } from "../../client/core/visor.ts";
import { OPTIC_HEAT, OPTIC_NIGHT } from "../../client/core/render/packet.ts";
import { daylight } from "../../client/core/render/laser.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "./png.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
const gpu = process.argv.includes("--gpu");
const hour = Number(process.argv.find((a) => a.startsWith("--hour="))?.slice(7) ?? 22);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7)?.split(",");
const viewOnly = process.argv.find((a) => a.startsWith("--view="))?.slice(7);
const statesOnly = process.argv.find((a) => a.startsWith("--states="))?.slice(9)?.split(",");
const tierName = process.argv.find((a) => a.startsWith("--tier="))?.slice(7) ?? "high";
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));

/** A place in a frame of its own: an origin, a turn, and x along, z out from it, as a piece's own frame has them. */
interface Frame { readonly x: number; readonly z: number; readonly yaw: number }
const at = (f: Frame, x: number, z: number): [number, number] => [f.x + Math.cos(f.yaw) * x + Math.sin(f.yaw) * z, f.z - Math.sin(f.yaw) * x + Math.cos(f.yaw) * z];
const t = map.statics;
/** The piece of a kind nearest a point, within 2 m, as a frame. */
function pieceAt(kind: string, x: number, z: number): Frame {
  for (let i = 0; i < t.kind.length; i++) if (Math.hypot(t.x[i]! - x, t.z[i]! - z) < 2 && t.kinds[t.kind[i]!] === kind) return { x: t.x[i]!, z: t.z[i]!, yaw: (t.yaw[i]! / 65536) * 2 * Math.PI };
  throw new Error(`No ${kind} near ${x}, ${z} on this map`);
}
/** The rose arcade of the shade study: x along it, z out from its middle, its outer edge at z -3 and the wall at z +1. */
const ARCADE = pieceAt("core:zruin_zroof8_rose", 7633.2, 7463.5);
/** A pair of working lamps either side of a road, 20 m apart: the first's frame, +z out over the road, which runs along x. */
const LAMP = pieceAt("core:zzstreet_lamp_lit", 6700.5, 11397.3);
/** The GPU bench's two busy lamps (tools/bench/gpu.ts CITY_PLACES): over a row of parked cars, and before a building's front. */
const CARS = pieceAt("core:zzstreet_lamp_lit", 7075.5, 5564.8);
const FRONT = pieceAt("core:zzstreet_lamp_lit", 9032.5, 10297.5);

interface View {
  readonly name: string;
  readonly eye: readonly [number, number, number];
  readonly at: readonly [number, number, number];
  /** The bodies' places for this view, in the scene's frame: x, z and turn from the frame's, by kind. */
  readonly bodies?: readonly (readonly [string, number, number, number])[];
  /** Pictures taken this many seconds after the view is taken up, each a view of its own, `<view>-<ms>`. */
  readonly after?: readonly number[];
  /** Where the camera stood before, settled there, for the views `after` takes: the scene's frame's x, height and z. */
  readonly from?: readonly [number, number, number];
}
interface Probe { readonly name: string; readonly x: number; readonly y: number; readonly z: number }
interface State { readonly name: string; readonly moon: boolean; readonly lamp: boolean; readonly shaded?: boolean }
interface Scene {
  readonly name: string;
  readonly frame: Frame;
  /** Cars parked at the kerb, as statics: x along, z out, turn in radians from the frame's, and kind. */
  readonly parked: readonly (readonly [number, number, number, string])[];
  readonly views: readonly View[];
  /** Heights over the frame's ground at its origin. */
  readonly probes: readonly Probe[];
  readonly states: readonly State[];
}

const BEFORE: State = { name: "before", moon: false, lamp: false };
const MOON: State = { name: "moon", moon: true, lamp: false };
const AFTER: State = { name: "after", moon: true, lamp: true };
/** The moon's shadows and every lamp its cards, which take no body's shadow. */
const PLAIN: State = { name: "plain", moon: true, lamp: false, shaded: false };
const CAR = "core:compact", MAN = "core:survivor";
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
    states: [{ ...BEFORE, lamp: true }, { ...AFTER }],
  },
  {
    name: "lamp",
    frame: LAMP,
    parked: [],
    views: [-5, -1.2, 3].map((x, k) => ({
      name: `car${k + 1}`,
      eye: [-10, 1.7, -2.5] as const,
      at: [0.5, 0.6, 3.6] as const,
      bodies: [[CAR, x, 4.4, Math.PI / 2], [MAN, 1.8, 1.4, Math.PI]] as const,
    })),
    probes: [
      { name: "road under", x: 0, y: 0.02, z: 2.9 },
      { name: "road beyond", x: 0, y: 0.02, z: 7 },
      { name: "grass at mast", x: -2, y: 0.05, z: 0.8 },
      { name: "walk", x: -5, y: 0.05, z: -0.6 },
      { name: "chest", x: 1.8, y: 1.3, z: 1.25 },
    ],
    states: [BEFORE, PLAIN, MOON, AFTER],
  },
  {
    name: "handover",
    frame: LAMP,
    parked: [],
    // The second lamp stands across the road, 20 m off, facing the first; the camera, 12 m along the road, steps across
    // its middle from the first lamp's side to the second's, looking along it between them.
    views: [
      { name: "fade", from: [-12, 1.7, 8.5], eye: [-12, 1.7, 11.5], at: [0, 0.6, 10], after: [0.05, 0.1, 0.15, 0.2, 0.3], bodies: [[MAN, 0, 6, Math.PI / 2], [CAR, 1, 14, Math.PI / 2]] },
      { name: "step", from: [-12, 1.7, 8.5], eye: [-12, 1.7, 11.5], at: [0, 0.6, 10], after: [0.15, 0.6], bodies: [[MAN, 0, 6, Math.PI / 2], [CAR, 1, 14, Math.PI / 2]] },
      { name: "cross", from: [-7, 1.7, 3], eye: [-7, 1.7, 17], at: [3, 0.4, 8], after: [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1], bodies: [[MAN, 0, 6, Math.PI / 2], [CAR, 1, 14, Math.PI / 2]] },
    ],
    probes: [],
    states: [AFTER],
  },
  // The bench's busy lamps, from near their stations: five abandoned cars along the kerb under one, and a three-storey
  // front 3 m behind the other's mast with two cars on the road before it.
  { name: "cars", frame: CARS, parked: [], views: [{ name: "row", eye: [14, 1.7, 10], at: [0, 0.8, 3] }], probes: [], states: [MOON, AFTER] },
  { name: "front", frame: FRONT, parked: [], views: [{ name: "face", eye: [12, 1.7, 10], at: [0, 2.5, -3] }], probes: [], states: [MOON, AFTER] },
];

const width = 1280, height = 720;
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) if (SCENES.some((s) => Math.hypot(t.x[i]! - s.frame.x, t.z[i]! - s.frame.z) < 260)) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
for (const scene of SCENES) for (const [x, z, turn, kind] of scene.parked) {
  const [wx, wz] = at(scene.frame, x, z);
  rows.push({ kind, x: wx, y: hf.heightAt(wx, wz), z: wz, yaw: Math.round(((scene.frame.yaw + turn) / (2 * Math.PI)) * 65536) & 0xffff });
}
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote, raster } = v;
scene.assets.tier = tierOf(tierName);
scene.viewHeight = height;
scene.hour = hour;
// --optic=night or --optic=heat: through a visor's night vision, as amplified at this hour, or its heat view (client/core/visor.ts).
const optic = process.argv.find((a) => a.startsWith("--optic="))?.slice(8);
if (optic === "night" || optic === "heat") {
  const visor = new Visor();
  [visor.up, visor.mode] = [true, optic === "night" ? OPTIC_NIGHT : OPTIC_HEAT];
  visor.frame(scene.optic, daylight(hour));
}
cam.fovY = (57 * Math.PI) / 180;

/** Puts the camera at `eye` looking at `look`, and the view's bodies in place, in the scene's frame; its ground's height. */
function look(s: Scene, view: View, eye = view.eye): number {
  const ground = hf.heightAt(s.frame.x, s.frame.z);
  const e = at(s.frame, eye[0], eye[2]), a = at(s.frame, view.at[0], view.at[2]);
  cam.x = e[0];
  cam.z = e[1];
  cam.y = ground + eye[1];
  cam.yaw = Math.atan2(a[0] - e[0], a[1] - e[1]);
  cam.pitch = Math.atan2(ground + view.at[1] - cam.y, Math.hypot(a[0] - e[0], a[1] - e[1]));
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 3, () => false);
  remote.count = 0;
  for (const [kind, x, z, turn] of view.bodies ?? []) {
    const n = remote.count++;
    const [wx, wz] = at(s.frame, x, z);
    remote.id[n] = 1700 + n;
    remote.kind[n] = v.reg.index.get(kind)!;
    remote.x[n] = wx;
    remote.z[n] = wz;
    remote.y[n] = hf.heightAt(wx, wz);
    remote.yaw[n] = s.frame.yaw + turn;
    remote.flags[n] = 1;
    remote.anim[n] = 0;
    remote.colors.fill(0, n * 6, n * 6 + 6);
    remote.colors[n * 6] = 10;
  }
  return ground;
}

/** Sets the scene's switches for a state. */
function stateOf(state: State): void {
  scene.moonShadows = state.moon;
  scene.streetLamps.light = state.lamp;
  scene.streetLamps.shaded = state.shaded !== false;
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
/** Frames on, `each` handed each frame built, until the card holds what the view asks for and the maps are made. */
function settled(each: (p: FramePacket, last: boolean) => void, most = 900): void {
  let still = 0;
  for (let frame = 0; frame < most && still < 30; frame++) {
    scene.now += 1000 / 60;
    v.port!.advance(scene.now);
    const p = scene.build(cam, remote);
    const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
    const load = scene.assets.residency;
    still = !loading && !load.flying && !load.waiting && ready() && p.frame[FRAME.reflection + 3] === 1 ? still + 1 : 0;
    each(p, still >= 30);
  }
}

/** Each picture: its name, its scene, and the probes' places. */
interface Picture { readonly name: string; readonly scene: Scene; readonly places: ([number, number] | null)[] }
/**
 * Takes every picture of the scenes chosen: `frame` is handed every frame built, with the picture's name for one to be
 * kept. A view is settled once in the last state, then each state drawn at the same clock; a view with `after` steps the
 * clock on in the last state.
 */
function pictures(frame: (p: FramePacket, keep: string | null) => void): Picture[] {
  const made: Picture[] = [];
  for (const s of SCENES.filter((s) => !only || only.includes(s.name))) {
    for (const view of s.views.filter((v) => !viewOnly || v.name === viewOnly)) {
      const last = s.states[s.states.length - 1]!;
      stateOf(last);
      if (view.from) {
        look(s, view, view.from);
        settled((p) => frame(p, null));
      }
      const ground = look(s, view);
      if (!view.after) settled((p) => frame(p, null));
      const clock = scene.now;
      for (const state of view.after ? [last] : s.states.filter((t) => !statesOnly || statesOnly.includes(t.name))) {
        stateOf(state);
        if (view.after) {
          let since = 0;
          for (const after of view.after) {
            for (; since < after - 1e-6; since += 1 / 60) {
              scene.now += 1000 / 60;
              frame(scene.build(cam, remote), null);
            }
            const p = scene.build(cam, remote);
            const name = `${state.name}/${s.name}-${view.name}-${Math.round(after * 1000)}ms`;
            made.push({ name, scene: s, places: probeAt(s, ground, p) });
            frame(p, name);
          }
          continue;
        }
        scene.now = clock;
        const p = scene.build(cam, remote);
        const name = `${state.name}/${s.name}-${view.name}`;
        made.push({ name, scene: s, places: probeAt(s, ground, p) });
        frame(p, name);
      }
      stateOf(last);
    }
  }
  return made;
}

const soft = new Map<string, Uint8ClampedArray>();
const made = pictures((p, keep) => {
  if (!keep) {
    p.drawCount = p.tileCount = 0;
    raster.render(p);
    return;
  }
  raster.render(p);
  soft.set(keep, Uint8ClampedArray.from(raster.color));
  mkdirSync(join(out, keep.split("/")[0]!), { recursive: true });
  writeFileSync(join(out, keep + "-software.png"), encodePng(width, height, raster.color));
});
for (const m of made) measure(soft.get(m.name)!, m.places).forEach((r, j) => console.log(`${m.name} software ${m.scene.probes[j]!.name.padEnd(14)} ${r}`));
if (!gpu) process.exit(0);

const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the WebGL study");
scene.resetUploads();
const shot = new Shot("night-light", width, height, hf, files[0]!);
shot.manifest = manifest;
shot.shadows = true;
let taken: Picture[] = [];
const passed = await litProbe(chrome, [{
  name: "Night light",
  shots() {
    taken = pictures((p, keep) => {
      if (!keep) p.drawCount = p.tileCount = p.casterCount = 0;
      shot.add(p, keep !== null);
    });
    return [shot];
  },
  judge(back) {
    const lines = [back.device.renderer];
    taken.forEach((m, k) => {
      const picture = back.pixels(shot.key, shot.read[k]!)!;
      writeFileSync(join(out, m.name + ".png"), encodePng(width, height, picture));
      measure(picture, m.places).forEach((r, j) => lines.push(`${m.name} gpu ${m.scene.probes[j]!.name.padEnd(14)} ${r}`));
    });
    return { ok: taken.length > 0, lines };
  },
}]);
process.exit(passed ? 0 : 1);
