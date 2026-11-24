// bun tools/snap/air-feed.ts <miami.snmap> <built assets directory> <output directory> [--gpu] [--tier=high] [--only=name]
//   [--size=1920x1080]
//
// A drone's camera feed (planning/workstreams/air-support.md) over a Miami street with creatures and survivors on it: the
// feed's own view and heat by day, night vision by night, each at a good signal and a bad one, with the feed's HUD and
// its tracking boxes drawn over (hud/air-feed.ts, hud/tracks.ts). It writes `<case>-software.png`, the rasterizer's
// picture with the feed's finish done in software (render/feed.ts feedPicture), and with --gpu `<case>.png` drawn by the
// shell's renderer, whose finishing pass draws the feed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AirFeed } from "../../client/core/air-feed.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FEED, buildFeed } from "../../client/core/hud/air-feed.ts";
import { TRACKS, trackBodies } from "../../client/core/hud/tracks.ts";
import { feedPicture } from "../../client/core/render/feed.ts";
import { daylight } from "../../client/core/render/laser.ts";
import { FRAME, OPTIC_FEED, OPTIC_HEAT, OPTIC_NIGHT, type FramePacket } from "../../client/core/render/packet.ts";
import { UiFrame, canvasHeight } from "../../client/core/ui/nodes.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { latOf, lonOf } from "../../shared/world/coords.ts";
import { type MapStatic, MapStatics, mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { findChrome } from "../chrome.ts";
import { litProbe } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "./png.ts";
import { drawUi } from "./ui.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const gpu = process.argv.includes("--gpu");
/** --plain draws the view as it is, with no feed: to tell what the feed does from what the place looks like. */
const plain = process.argv.includes("--plain");
const only = arg("only")?.split(",");
const [width, height] = (arg("size") ?? "1920x1080").split("x").map(Number) as [number, number];
mkdirSync(out, { recursive: true });
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));

/** A street of the GPU bench's (tools/bench/gpu.ts CITY_PLACES): its lamp, +z out over the road, which runs along x. */
const t = map.statics;
let lamp: { x: number; z: number; yaw: number } | null = null;
for (let i = 0; i < t.kind.length && !lamp; i++) if (Math.hypot(t.x[i]! - 7075.5, t.z[i]! - 5564.8) < 2 && t.kinds[t.kind[i]!] === "core:zzstreet_lamp_lit") lamp = { x: t.x[i]!, z: t.z[i]!, yaw: (t.yaw[i]! / 65536) * 2 * Math.PI };
if (!lamp) throw new Error("No lamp at the study's place on this map");
const L = lamp;
const along = (x: number, z: number): [number, number] => [L.x + Math.cos(L.yaw) * x + Math.sin(L.yaw) * z, L.z - Math.sin(L.yaw) * x + Math.cos(L.yaw) * z];
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) if (Math.hypot(t.x[i]! - L.x, t.z[i]! - L.z) < 320) rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });

const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote, raster } = v;
scene.assets.tier = tierOf(arg("tier") ?? "high");
scene.viewHeight = height;
scene.canvasWidth = width;
scene.canvasHeight = height;
if (arg("share")) scene.share = Number(arg("share"));
cam.aspect = width / height;
const world = { hf: v.hf, structs: v.structs, nodes: v.nodes.store };

/** The viewer's tribe; bodies on the street: kind, x along, z out, turn, name, level, tribe (0 wild, TEAM ours, 2 another's). */
const TEAM = 7;
const BODIES: readonly (readonly [string, number, number, number, string, number, number])[] = [
  ["core:trike", -4, 8, 0.9, "Mabel", 38, TEAM],
  ["core:raptor", -9, 9, 2.1, "", 22, 0],
  ["core:raptor", -11.5, 11, 2.4, "", 19, 0],
  ["core:dodo", 12, 3, -1.2, "", 4, 0],
  ["core:dodo", 13.4, 4.1, 0.3, "", 7, 0],
  ["core:parasaur", 17, 9.5, -2.6, "Saltine", 41, 2],
  ["core:survivor", 4.5, 2.2, 3.4, "Ada", 31, TEAM],
  ["core:survivor", -3, 13.5, 0.4, "Krag", 55, 2],
  ["core:stego", -24, 4, 1.4, "", 64, 0],
];
remote.count = 0;
BODIES.forEach(([kind, x, z, turn, name, level, team], n) => {
  const [wx, wz] = along(x, z);
  remote.count++;
  remote.id[n] = 1800 + n;
  remote.gen[n] = 1;
  remote.kind[n] = v.reg.index.get(kind)!;
  remote.x[n] = wx;
  remote.z[n] = wz;
  remote.y[n] = hf.heightAt(wx, wz);
  remote.yaw[n] = L.yaw + turn;
  remote.flags[n] = kind === "core:survivor" ? 1 | 4 : 1;
  remote.anim[n] = 0;
  remote.name[n] = name;
  remote.level[n] = level;
  remote.team[n] = team;
  remote.colors.fill(0, n * 6, n * 6 + 6);
});

/** A drone's view: where it hangs over the street's frame (x along, height, z out), and the body its middle holds. */
interface View { readonly name: string; readonly eye: readonly [number, number, number]; readonly lock: number; readonly zoom: number }
const VIEWS: readonly View[] = [
  { name: "over", eye: [-22, 17, 30], lock: 0, zoom: 1 },
  { name: "zoom", eye: [-22, 17, 30], lock: 0, zoom: 2.5 },
];
interface Case { readonly name: string; readonly hour: number; readonly mode: number; readonly signal: number; readonly burst: number; readonly view: View }
const CASES: Case[] = [];
for (const view of VIEWS) {
  for (const [look, hour, mode] of [["feed", 14.5, OPTIC_FEED], ["heat", 14.5, OPTIC_HEAT], ["night", 22.5, OPTIC_NIGHT]] as const) {
    if (view.name === "zoom" && look !== "feed") continue;
    CASES.push({ name: `${view.name}-${look}-good`, hour, mode, signal: 0.94, burst: 0, view });
    if (view.name === "over") CASES.push({ name: `${view.name}-${look}-bad`, hour, mode, signal: 0.12, burst: 0.7, view });
  }
}
const chosen = CASES.filter((c) => !only || only.includes(c.name));

const feed = new AirFeed();
const base = (60 * Math.PI) / 180;
/** Places the camera for `c` and the feed's optic. */
function stage(c: Case): void {
  const [ex, ez] = along(c.view.eye[0], c.view.eye[2]);
  const n = c.view.lock;
  cam.x = ex;
  cam.z = ez;
  cam.y = hf.heightAt(ex, ez) + c.view.eye[1];
  const dx = remote.x[n]! - ex, dz = remote.z[n]! - ez, dy = remote.y[n]! + 1.2 - cam.y;
  cam.yaw = Math.atan2(dx, dz);
  cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  cam.roll = 0;
  cam.fovY = 2 * Math.atan(Math.tan(base / 2) / c.view.zoom);
  scene.hour = c.hour;
  feed.mode = c.mode;
  if (!plain) feed.frame(scene.optic, c.signal, daylight(c.hour), c.burst);
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 4, () => false);
}

/** The HUD over `color`: the feed's frame and readouts, and a box round each body in view. */
function hud(color: Uint8Array | Uint8ClampedArray, c: Case, post: boolean): void {
  const f = new UiFrame();
  f.begin(width / height, canvasHeight(width, height));
  f.count = 0;
  const m = { ...FEED.make!(), ...TRACKS.make!(), hour: c.hour };
  cam.update();
  trackBodies(m, cam, world, v.reg, remote, -1, -1, TEAM, 0, scene.characters);
  trackBodies(m, cam, world, v.reg, remote, -1, -1, TEAM, 2000, scene.characters);
  Object.assign(m, {
    feed: true, feedName: "BAY 4 · SRV-04", feedClock: `${String(Math.floor(c.hour)).padStart(2, "0")}:${String(Math.round((c.hour % 1) * 60)).padStart(2, "0")}:17`,
    feedFuel: 0.63, feedSignal: c.signal, feedSpeed: 14.2, feedAgl: c.view.eye[1], feedHeading: ((-cam.yaw * 180) / Math.PI + 720) % 360, feedPitch: (cam.pitch * 180) / Math.PI,
    feedMode: c.mode, feedZoom: c.view.zoom, feedFrozen: false, feedNow: 2000, feedPost: post,
    trackNow: 2000, trackSignal: c.signal, trackHealth: 0.72, trackTribe: "",
    feedLat: latOf(hf.dims, cam.z), feedLon: lonOf(hf.dims, cam.x), feedRange: rangeOf(),
  });
  buildFeed(f, m, 0);
  drawUi(color as Uint8ClampedArray, width, height, f);
}

/** Metres to what the middle of the view is on, 0 for nothing. */
function rangeOf(): number {
  const d = [0, 0, 0];
  cam.ray(0.5, 0.5, d);
  return castWorld(world, cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, 2000) !== HIT_NONE ? rayHit.t : 0;
}

/** Frames on until the card holds what the view asks for, each built frame handed to `each`. */
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

/** Every case's frame, settled: `frame` is handed each built, with the case's name for the one kept. */
function pictures(frame: (p: FramePacket, keep: Case | null) => void): void {
  for (const c of chosen) {
    stage(c);
    settled((p) => frame(p, null));
    frame(scene.build(cam, remote), c);
  }
}

pictures((p, keep) => {
  if (!keep) {
    p.drawCount = p.tileCount = 0;
    raster.render(p);
    return;
  }
  raster.render(p);
  const color = Uint8ClampedArray.from(raster.color), post = p.tier.post !== null;
  // A tier with no finishing pass has the grade alone, and the HUD's scanlines and vignette.
  if (post && !plain) feedPicture(color, width, height, p.share, keep.signal, keep.burst, Math.floor(scene.now / 16));
  hud(color, keep, post);
  writeFileSync(join(out, `${keep.name}-software.png`), encodePng(width, height, color));
  console.log(`${keep.name}: share ${p.share.toFixed(2)}, ${p.drawCount} draws`);
});
if (!gpu) process.exit(0);

const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the GPU pictures");
scene.resetUploads();
const shot = new Shot("air-feed", width, height, hf, files[0]!);
shot.manifest = manifest;
shot.shadows = true;
const taken: Case[] = [];
const passed = await litProbe(chrome, [{
  name: "Air feed",
  shots() {
    pictures((p, keep) => {
      if (!keep) p.drawCount = p.tileCount = p.casterCount = 0;
      else taken.push(keep);
      shot.add(p, keep !== null);
    });
    return [shot];
  },
  judge(back) {
    const lines = [back.device.renderer];
    taken.forEach((c, k) => {
      const picture = back.pixels(shot.key, shot.read[k]!)!;
      stage(c);
      hud(picture, c, scene.assets.tier.post !== null);
      writeFileSync(join(out, `${c.name}.png`), encodePng(width, height, picture));
      lines.push(`${c.name}: written`);
    });
    return { ok: taken.length > 0, lines };
  },
}]);
process.exit(passed ? 0 : 1);
