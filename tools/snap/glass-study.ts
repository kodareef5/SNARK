// bun tools/snap/glass-study.ts <miami.snmap> <built assets directory> <output directory> [--vehicles=compact,taxi]
//   [--tier=high] [--off=effects] [--software] [--stipple]
//
// Vehicle glass (planning/workstreams/vehicle-materials.md): each road vehicle on the road under a working lamp of
// Miami's (night-study.ts LAMP), a survivor in its driver's seat, seen from eye height 3 m off its passenger's side, 3 m
// off its front corner and 15 m along the road, by day (12:30) and by night (22:00, the lamp lit as a light); "parked"
// among the vehicles names an abandoned compact parked at the kerb, seen the same way with no car on the road. Each
// view is taken twice at the same moment, the panes solid as they were (`?off=glass`, client/core/passes.ts) and seen
// through, as `before/<vehicle>-<state>-<view>.png` and `after/...`, drawn on the GPU by the shell's renderer on the
// tier named (high unless given), with --software the software render beside each, and it prints each frame's draws
// and triangles and the levels the car is drawn at. --off= turns other effects off as a page's ?off= has them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { isWheelVehicle } from "../../shared/sim/vehicle.ts";
import { MapStatics, type MapStatic, mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { effectsOff, packetWithout, tierWithout } from "../../client/core/passes.ts";
import { DRAW_TEXTURED, FRAME, GLASS_AT, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "./png.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const names = (arg("vehicles") ?? "compact,taxi,panel_van,veloce,patrol_sedan,bus,parked").split(",");
const off = effectsOff(arg("off") ?? "");
/** The same with the panes solid, as they were. */
const solid = effectsOff([...off, "glass"].join());
const software = process.argv.includes("--software");
/** --stipple draws the panes as a frame without samples does, keeping whole pixels (vehicle-glass.ts). */
const stipple = process.argv.includes("--stipple");
for (const folder of ["before", "after"]) mkdirSync(join(out, folder), { recursive: true });
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));

const t = map.statics;
/** The first working lamp of a pair either side of a road (night-study.ts LAMP): +z out over the road, which runs along x. */
let lamp: { x: number; z: number; yaw: number } | null = null;
for (let i = 0; i < t.kind.length && !lamp; i++) {
  if (Math.hypot(t.x[i]! - 6700.5, t.z[i]! - 11397.3) < 2 && t.kinds[t.kind[i]!] === "core:zzstreet_lamp_lit") lamp = { x: t.x[i]!, z: t.z[i]!, yaw: (t.yaw[i]! / 65536) * 2 * Math.PI };
}
if (!lamp) throw new Error("No working lamp at the study's place on this map");
const L = lamp;
/** A point of the lamp's frame, x along the road and z out over it, in the world. */
const along = (x: number, z: number): [number, number] => [L.x + Math.cos(L.yaw) * x + Math.sin(L.yaw) * z, L.z - Math.sin(L.yaw) * x + Math.cos(L.yaw) * z];
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) if (Math.hypot(t.x[i]! - L.x, t.z[i]! - L.z) < 260) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
/** Two abandoned compacts parked at the kerb behind the car and before it (the "parked" pictures look at the first). */
const PARKED: readonly (readonly [number, number, string])[] = [[-8, 2.3, "core:compact_abandoned_blue"], [9, 2.3, "core:compact_abandoned_white"]];
for (const [x, z, kind] of PARKED) {
  const [wx, wz] = along(x, z);
  rows.push({ kind, x: wx, y: hf.heightAt(wx, wz), z: wz, yaw: Math.round(((L.yaw + Math.PI / 2) / (2 * Math.PI)) * 65536) & 0xffff });
}

const width = 1280, height = 720;
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote, raster } = v;
scene.assets.tier = tierWithout(tierOf(arg("tier") ?? "high"), off);
scene.viewHeight = height;
cam.fovY = (57 * Math.PI) / 180;

/** The car's middle on the road, 4.4 m out from the lamp and 1 m past it, and its heading, along the road. */
const carYaw = L.yaw + Math.PI / 2;
let [carX, carZ] = along(1, 4.4);
/** A point of the car's own frame, x across (the driver's side +x), z forward, in the world. */
const world = (x: number, z: number): [number, number] => [carX + Math.cos(carYaw) * x + Math.sin(carYaw) * z, carZ - Math.sin(carYaw) * x + Math.cos(carYaw) * z];

interface View { readonly name: string; readonly eye: [number, number, number]; readonly at: [number, number, number] }
/** The views of a car `half` wide, `long` from its middle to its nose, and `high`: x, height over the ground, z in its frame. */
const viewsOf = (half: number, long: number, high: number): View[] => [
  { name: "side-3m", eye: [-(half + 3), 1.65, 0.2], at: [0.3, high * 0.72, 0.2] },
  { name: "corner-3m", eye: [-(half + 2.1), 1.65, long + 2.1], at: [0.2, high * 0.7, long * 0.25] },
  { name: "along-15m", eye: [-3.5, 1.65, long + 14.5], at: [0, high * 0.6, 0] },
];
interface State { readonly name: string; readonly hour: number }
const STATES: readonly State[] = [{ name: "day", hour: 12.5 }, { name: "night", hour: 22 }];

/** Puts the car and its driver in place and the camera at a view: of the first parked car, with none on the road, for -1. */
function look(kind: number, view: View): void {
  [carX, carZ] = kind < 0 ? along(PARKED[0]![0], PARKED[0]![1]) : along(1, 4.4);
  const ground = hf.heightAt(carX, carZ);
  const e = world(view.eye[0], view.eye[2]), a = world(view.at[0], view.at[2]);
  cam.x = e[0];
  cam.z = e[1];
  cam.y = hf.heightAt(e[0], e[1]) + view.eye[1];
  cam.yaw = Math.atan2(a[0] - e[0], a[1] - e[1]);
  cam.pitch = Math.atan2(ground + view.at[1] - cam.y, Math.hypot(a[0] - e[0], a[1] - e[1]));
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 3, () => false);
  remote.count = kind < 0 ? 0 : 2;
  for (let n = 0; n < remote.count; n++) {
    remote.id[n] = 1700 + n;
    remote.gen[n] = 0;
    remote.kind[n] = n === 0 ? kind : v.reg.index.get("core:survivor")!;
    remote.x[n] = carX;
    remote.z[n] = carZ;
    remote.y[n] = ground;
    remote.yaw[n] = carYaw;
    remote.flags[n] = 1;
    remote.anim[n] = 0;
    remote.colors.fill(0, n * 6, n * 6 + 6);
    remote.colors[n * 6] = n === 0 ? 41 : 10;
  }
  // The survivor sits in the car's first seat, the driver's: the car's id plus one, and its generation.
  remote.seat[0] = remote.seatSlot[0] = 0;
  remote.seat[1] = remote.id[0]! + 1;
  remote.seatSlot[1] = 1;
  remote.seatGen[1] = remote.gen[0]!;
}

/** Frames on, `each` handed each frame built, until the card holds what the view asks for and the maps are made. */
function settled(each: (p: FramePacket) => void, most = 900): void {
  let still = 0;
  for (let frame = 0; frame < most && still < 30; frame++) {
    scene.now += 1000 / 60;
    v.port!.advance(scene.now);
    const p = scene.build(cam, remote);
    const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
    const load = scene.assets.residency;
    still = !loading && !load.flying && !load.waiting && !!scene.farShadow?.whole && p.frame[FRAME.reflection + 3] === 1 ? still + 1 : 0;
    each(p);
  }
}

/** Every picture, `frame` handed each frame built, with the picture's name for one to be kept. */
function pictures(frame: (p: FramePacket, keep: string | null) => void): string[] {
  const made: string[] = [];
  for (const name of names) {
    // "parked" is the abandoned compact at the kerb, a compact's size, seen from the road as the car on it is.
    const kind = name === "parked" ? -1 : v.reg.index.get("core:" + name);
    const def = kind === undefined ? null : v.reg.vehicle[kind < 0 ? v.reg.index.get("core:compact")! : kind];
    if (kind === undefined || !def || !isWheelVehicle(def)) throw new Error("Expected a driveable road vehicle or parked: core:" + name);
    const s = def.spec, car = kind < 0 ? "compact_abandoned" : name;
    for (const state of STATES) {
      scene.hour = state.hour;
      for (const view of viewsOf(s.halfWidth, s.halfLength, s.height)) {
        look(kind, view);
        settled((p) => frame(p, null));
        const clock = scene.now;
        for (const [folder, without] of [["before", solid], ["after", off]] as const) {
          scene.now = clock;
          const p = scene.build(cam, remote);
          packetWithout(p, without);
          if (stipple) p.frame[GLASS_AT] = 0;
          const keep = `${folder}/${name}-${state.name}-${view.name}`;
          // The car's own draws: each mesh's level, and whether it is drawn with its materials (T) or flat (F).
          const own = new Set<string>();
          for (let d = 0; d < p.drawCount; d++) {
            const id = manifest.meshes[p.drawMesh[d]!]?.id ?? "";
            if (id === "core:" + car || id.startsWith(`core:${car}/`) || id.startsWith(`core:${car}_`)) own.add(`${id.slice(5)} ${p.drawLod[d]}${(p.drawFlags[d]! & DRAW_TEXTURED) !== 0 ? "T" : "F"}`);
          }
          console.log(`${keep}: ${p.drawCount} draws, ${p.triangles} triangles, ${p.casterCount} casters; the car at ${[...own].join(", ")}`);
          made.push(keep);
          frame(p, keep);
        }
      }
    }
  }
  return made;
}

if (software) {
  pictures((p, keep) => {
    if (!keep) p.drawCount = p.tileCount = 0;
    raster.render(p);
    if (keep) writeFileSync(join(out, keep + "-software.png"), encodePng(width, height, raster.color));
  });
}
const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the WebGL study");
scene.resetUploads();
const shot = new Shot("vehicle-glass", width, height, hf, files[0]!);
shot.manifest = manifest;
shot.shadows = true;
let taken: string[] = [];
const passed = await litProbe(chrome, [{
  name: "Vehicle glass",
  shots() {
    taken = pictures((p, keep) => {
      if (!keep) p.drawCount = p.tileCount = p.casterCount = 0;
      shot.add(p, keep !== null);
    });
    return [shot];
  },
  judge(back) {
    taken.forEach((name, k) => writeFileSync(join(out, name + ".png"), encodePng(width, height, back.pixels(shot.key, shot.read[k]!)!)));
    return { ok: taken.length > 0, lines: [back.device.renderer] };
  },
}]);
process.exit(passed ? 0 : 1);
