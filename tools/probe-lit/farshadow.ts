// The sun's shadow past the cascades on a GPU (client/core/render/farshadow.ts), a check of tools/probe-lit.ts. Frame
// towers of the city stand on flat ground 350 to 700 m from a camera 90 m up on high, under a morning sun 25 degrees
// up, their shadows toward it. Each pixel of open ground the TypeScript twin (farLookup) says is wholly shaded reads
// the rasterizer's colour with no sun, and each it says is wholly sunlit its sunlit colour, within 4 steps: past every
// cascade, in the farthest one's hand-over to the far map, and within the cascades, where nothing near casts and the
// far map is looked up past the chunks the near store holds about the camera (farBeyondLookup), which the towers'
// shadows reach into. The twin is read from the rows the frames put on the card, as the card holds them. It is held
// once as this device looks shadows up, once comparing four texels in the shader, and after a lost context, when the
// map goes on the card again.
//
// With PROBE_PICTURES naming a folder it writes what the GPU drew of each beside the twin's shade. With PROBE_MAP
// naming a built map, Miami's, it writes there the pictures of the far shadow on that map: from the air over downtown,
// down a street, and across the bay at the skyline, at 8:00 and at noon, on high, without and with it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { farBeyondLookup, farLookup } from "../../client/core/render/farshadow.ts";
import { FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { shadowCascade } from "../../client/core/render/shadowtext.ts";
import { hourOfSun, trueSun } from "../../client/core/render/sky.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { building, cityWorld, type CityWorld } from "../../tests/fixtures/cityworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_TERRAIN } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** Levels of 255 the GPU may be off the rasterizer's sunlit or shaded colour, and the share of judged points that may be off further. */
const SAME = 4;
const MOST_OFF = 0.01;

/** Towers of 20 to 34 storeys, 16 m square, at (x, z) with a turn each, in a map of 24 chunks a side. */
const TOWERS: [number, number, number, number][] = [
  [820, 700, 30, 0],
  [900, 860, 24, 3000],
  [760, 960, 34, 9000],
  [1010, 760, 20, 0],
  [1080, 980, 28, 14000],
];

interface Judged {
  name: string;
  key: string;
  frame: number;
  /** Per pixel: 0 not judged, 1 sunlit, 2 in shadow; and where it lies, 1 within the cascades, 2 in the hand-over, 3 past them. */
  want: Uint8Array;
  where: Uint8Array;
  sunlit: Uint8Array;
  shaded: Uint8Array;
}

const made = { judged: [] as Judged[], pictures: [] as { name: string; key: string; off: number; on: number }[] };

/** The far map as the card holds it, from the rows each frame sent. */
class Layer {
  size = 0;
  map = new Uint16Array(0);

  take(p: FramePacket): void {
    const size = p.tier.shadows.size;
    if (size !== this.size) [this.size, this.map] = [size, new Uint16Array(size * size)];
    if (p.farRows > 0) this.map.set(p.farMap, p.farRow * size);
  }
}

/** Builds a frame of `w` into `shot`, the rasterizer given its uploads and drawing it only if `read`. */
function frame(w: CityWorld, shot: Shot, layer: Layer, read: boolean): FramePacket {
  w.scene.now += 1000 / 60;
  const p = w.scene.build(w.cam, null);
  layer.take(p);
  shot.add(p, read);
  const [draws, tiles] = [p.drawCount, p.tileCount];
  if (!read) p.drawCount = p.tileCount = 0;
  w.raster.render(p);
  [p.drawCount, p.tileCount] = [draws, tiles];
  return p;
}

/** Frames until the far map is all on the card and looked up, and nothing more is sent for three. */
function settle(w: CityWorld, shot: Shot, layer: Layer): void {
  for (let quiet = 0, k = 0; quiet < 3 && k < 600; k++) {
    const p = frame(w, shot, layer, false);
    quiet = p.assetUploads.length > 0 || p.farRows > 0 || p.frame[FRAME.farScale]! <= 0 ? 0 : quiet + 1;
  }
}

/**
 * The twin's shade at a camera-relative point on the ground, 0 or 1, past the cascades or, `beyond`, within them, where
 * it is the same moved a sixteenth of a cell any way and five centimetres up or down, so the GPU's rounding of where it
 * lies cannot change it; else null.
 */
function farShade(layer: Layer, f: Float32Array, rx: number, ry: number, rz: number, beyond: boolean): number | null {
  if (f[FRAME.farScale]! <= 0) return 1;
  const d = 1 / f[FRAME.farScale]! / 16;
  const look = beyond ? farBeyondLookup : farLookup;
  const v = look(layer.map, layer.size, f, rx, ry, rz, 0, 0);
  if (v !== 0 && v !== 1) return null;
  for (const [x, y, z] of [[d, 0, 0], [-d, 0, 0], [0, 0, d], [0, 0, -d], [0, 0.05, 0], [0, -0.05, 0]]) if (look(layer.map, layer.size, f, rx + x!, ry + y!, rz + z!, 0, 0) !== v) return null;
  return v;
}

/** Classifies the open ground of the frame just built and rasterized, and rasterizes it again with the sun taken out. */
function judge(w: CityWorld, layer: Layer, p: FramePacket, name: string, key: string, at: number): void {
  const r = w.raster;
  const sunlit = Uint8Array.from(r.color);
  const keep = p.frame.slice(FRAME.sunColor, FRAME.sunColor + 3);
  p.frame.fill(0, FRAME.sunColor, FRAME.sunColor + 3);
  r.render(p);
  const shaded = Uint8Array.from(r.color);
  p.frame.set(keep, FRAME.sunColor);
  r.render(p);
  const want = new Uint8Array(W * H), where = new Uint8Array(W * H);
  const sun = [0, 0, 0];
  trueSun(p.frame, sun);
  const dir = [0, 0, 0];
  const cam = w.cam;
  for (let y = 3; y < H - 3; y++) {
    next: for (let x = 3; x < W - 3; x++) {
      const k = y * W + x;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const n = k + dy * W + dx;
          if (r.pickKind[n] !== PICK_TERRAIN) continue next;
          for (let c = 0; c < 3; c++) if (Math.abs(sunlit[n * 4 + c]! - sunlit[(n + 1) * 4 + c]!) > 3 || Math.abs(sunlit[n * 4 + c]! - sunlit[(n + W) * 4 + c]!) > 3) continue next;
        }
      }
      cam.ray((x + 0.5) / W, (y + 0.5) / H, dir);
      if (dir[1]! >= 0) continue;
      const t = -cam.y / dir[1]!;
      const [rx, ry, rz] = [dir[0]! * t, -cam.y, dir[2]! * t];
      const { cascade, fade } = shadowCascade(rx, ry, rz, p.spheres, p.cascadeCount, x, H - 1 - y);
      // Nothing near casts on the open ground, so within the cascades it is the far map's past the chunks held near; in
      // the hand-over that and the far map's own, judged where they agree; past them the far map's.
      const far = cascade >= 0 && fade === 0 ? null : farShade(layer, p.frame, rx, ry, rz, false);
      const beyond = cascade >= 0 ? farShade(layer, p.frame, rx, ry, rz, true) : null;
      const v = cascade < 0 ? far : fade === 0 ? beyond : far === beyond ? far : null;
      if (v !== null) [want[k], where[k]] = [v === 1 ? 1 : 2, cascade < 0 ? 3 : fade === 0 ? 1 : 2];
    }
  }
  made.judged.push({ name, key, frame: at, want, where, sunlit, shaded });
}

/** The staged towers, held to the twin once as the device looks up, once comparing in the shader, and after a lost context. */
function judgedShots(): Shot[] {
  const bytes = buildCorePack();
  const statics = TOWERS.flatMap(([x, z, storeys, yaw]) => building(x, z, 0, storeys, 2, yaw));
  const w = cityWorld({ chunks: 24, statics, tier: tierOf("high"), width: W, height: H, pack: parsePack(bytes) });
  // The rasterizer draws no haze (D264), so these frames carry none.
  w.scene.plainSky = true;
  w.scene.hour = hourOfSun(25, false);
  const shots: Shot[] = [];
  for (const lookup of ["device", "hard"]) {
    const shot = new Shot(`far-shadow-${lookup}`, W, H, w.hf, bytes);
    shot.shadows = true;
    shot.lookup = lookup === "hard" ? "hard" : "";
    const layer = new Layer();
    w.scene.resetUploads();
    w.cam.fovY = (60 * Math.PI) / 180;
    // From the east of the towers, their shadows toward the camera.
    w.look(900, 0, 900, 550, (-100 * Math.PI) / 180, 90);
    // The near store holds the chunks about the camera, none of the towers', so within the cascades the far map is
    // looked up past them.
    for (let cz = 13; cz <= 17; cz++) for (let cx = 20; cx <= 23; cx++) w.rows(cz * 24 + cx);
    settle(w, shot, layer);
    const how = lookup === "hard" ? "four texels compared in the shader" : "as this device looks up";
    judge(w, layer, frame(w, shot, layer, true), `towers 350 to 700 m off, the sun 25 degrees up, ${how}`, shot.key, shot.frames.length - 1);
    if (lookup === "device") {
      // The context lost: the layer is empty until the map is all on it again.
      shot.loseAt = shot.frames.length;
      w.scene.resetUploads();
      settle(w, shot, layer);
      judge(w, layer, frame(w, shot, layer, true), "the same after a lost context", shot.key, shot.frames.length - 1);
    }
    shots.push(shot);
  }
  return shots;
}

/** Pictures side by side with a gap of 4 pixels, `width` by `height` each. */
function sheet(row: Uint8Array[], width: number, height: number): Uint8Array {
  const sw = row.length * (width + 4) - 4;
  const out = new Uint8Array(sw * height * 4).fill(255);
  row.forEach((px, c) => {
    for (let y = 0; y < height; y++) out.set(px.subarray(y * width * 4, (y + 1) * width * 4), (y * sw + c * (width + 4)) * 4);
  });
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return encodePng(sw, height, out);
}

/**
 * The views of a built map's pictures, planning's of Miami (assets/source/maps/miami/reports/farcity/views.json): where
 * the camera stands, at a height or `up` over the ground, and the point it looks at.
 */
const VIEWS: { name: string; x: number; z: number; y?: number; up?: number; look: [number, number, number] }[] = [
  { name: "air-downtown", x: 5900, z: 2500, y: 320, look: [6900, 2900, 0] },
  { name: "street", x: 6533, z: 3425, up: 1.7, look: [6773, 3416, 10] },
  { name: "bay-skyline", x: 4600, z: 2600, y: 8, look: [6700, 2800, 60] },
];
const [PW, PH] = [1280, 720];

/** A built map on high, its statics all held by a near store that holds the chunks within three of the camera whole; its trees left out. */
function mapShots(path: string): Shot[] {
  const map = parseMap(new Uint8Array(readFileSync(path)), false);
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = mapHeightfield(map);
  const statics = new CityStatics(map.dims, map.statics, reg);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (let i = 0; i < statics.count; i++) structs.add(statics.kind[i]!, statics.x[i]!, statics.y[i]!, statics.z[i]!, statics.yaw[i]!, 0, reg.maxHp[statics.kind[i]!]!);
  const bytes = buildCorePack();
  const cam = new Camera();
  cam.aspect = PW / PH;
  const near = (chunk: number): boolean => Math.abs(chunkCx(map.dims, chunk) - Math.floor(cam.x / CHUNK_SIZE)) <= 3 && Math.abs(chunkCz(map.dims, chunk) - Math.floor(cam.z / CHUNK_SIZE)) <= 3;
  const scene = new Scene({ mapId: map.id, dims: map.dims, hf, structs, far: { cells: new FarStore(), complete: near }, city: { statics, complete: near } }, reg, parsePack(bytes));
  // High, sending more a frame so the far city comes in fewer frames, which every one goes to the page.
  scene.assets.tier = { ...tierOf("high"), uploadBytes: 64 * 2 ** 20 };
  scene.viewHeight = PH;
  if (scene.city) scene.city.makeMs = Infinity;
  // One shot for them all: what each view puts on the card is there for the next.
  const shot = new Shot("far-map", PW, PH, hf, bytes);
  shot.shadows = true;
  scene.resetUploads();
  for (const v of VIEWS) {
    for (const hour of [8, 12]) {
      scene.hour = hour;
      [cam.x, cam.z] = [v.x, v.z];
      cam.y = v.y ?? hf.heightAt(v.x, v.z) + v.up!;
      const [dx, dy, dz] = [v.look[0] - cam.x, v.look[2] - cam.y, v.look[1] - cam.z];
      [cam.yaw, cam.pitch] = [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
      for (let quiet = 0, k = 0; quiet < 3 && k < 2000; k++) {
        scene.now += 1000 / 60;
        const p = scene.build(cam, null);
        shot.add(p, false);
        const r = scene.assets.residency;
        quiet = p.assetUploads.length + p.uploads.length > 0 || p.farRows > 0 || r.flying > 0 || r.waiting > 0 || (scene.city?.stats.missing ?? 0) > 0 ? 0 : quiet + 1;
      }
      scene.now += 1000 / 60;
      const p = scene.build(cam, null);
      const scale = p.frame[FRAME.farScale]!;
      // Without the far map, then with it: the same frame but for its lanes.
      p.frame[FRAME.farScale] = 0;
      shot.add(p, true);
      p.frame[FRAME.farScale] = scale;
      shot.add(p, true);
      made.pictures.push({ name: `${v.name}-${hour === 8 ? "0800" : "1200"}`, key: shot.key, off: shot.frames.length - 2, on: shot.frames.length - 1 });
    }
  }
  console.log(`  far shadow: ${chunkCount(map.dims)} chunks, ${statics.count} statics; ${scene.farShadow?.stats.sweeps} sweeps, the last in ${scene.farShadow?.stats.ms.toFixed(0)} ms here`);
  return [shot];
}

export const farShadowCheck: LitCheck = {
  name: "the sun's shadow past the cascades (farshadow.ts)",

  shots(): Shot[] {
    const shots = judgedShots();
    if (process.env.PROBE_MAP && process.env.PROBE_PICTURES) shots.push(...mapShots(process.env.PROBE_MAP));
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    const folder = process.env.PROBE_PICTURES;
    if (folder) mkdirSync(folder, { recursive: true });
    made.judged.forEach((j, i) => {
      const gpu = back.pixels(j.key, j.frame);
      if (!gpu) {
        lines.push(`${j.name}: NO PICTURE`);
        ok = false;
        return;
      }
      // By kind (sunlit, shaded) and place (within, hand-over, past): how many, how many off, the worst.
      const count = new Map<string, [number, number, number]>();
      for (let at = 0; at < W * H; at++) {
        if (j.want[at] === 0) continue;
        const want = j.want[at] === 2 ? j.shaded : j.sunlit;
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(gpu[at * 4 + c]! - want[at * 4 + c]!));
        const key = `${j.want[at]}${j.where[at]}`;
        const n = count.get(key) ?? [0, 0, 0];
        count.set(key, [n[0] + 1, n[1] + (d > SAME ? 1 : 0), Math.max(n[2], d)]);
      }
      const of = (key: string): [number, number, number] => count.get(key) ?? [0, 0, 0];
      const all = ["23", "13", "21", "11", "22", "12"].map(of);
      const fine = (n: [number, number, number]): boolean => n[1] <= n[0] * MOST_OFF;
      const say = (n: [number, number, number]): string => `${n[0]} (${n[1]} more than ${SAME} off, the worst ${n[2]})`;
      const pass = all.every(fine) && all[0]![0] + all[2]![0] >= 2000 && all[1]![0] >= 2000 && all[2]![0] >= 500 && all[3]![0] >= 1000;
      ok &&= pass;
      lines.push(`${j.name}: shaded and sunlit points past the cascades ${say(all[0]!)} and ${say(all[1]!)}, within them ${say(all[2]!)} and ${say(all[3]!)}, in the hand-over ${say(all[4]!)} and ${say(all[5]!)}  ${pass ? "ok" : "FAIL"}`);
      if (!folder) return;
      const twin = new Uint8Array(W * H * 4).map((_, k) => ((k & 3) === 3 ? 255 : [0, 255, 96, 160][j.want[k >> 2]! === 0 ? 0 : j.want[k >> 2]! === 1 ? 1 : 2]!));
      writeFileSync(join(folder, `far-judged-${i}.png`), sheet([gpu, twin], W, H));
    });
    for (const pic of made.pictures) {
      const [off, on] = [back.pixels(pic.key, pic.off), back.pixels(pic.key, pic.on)];
      if (!off || !on || !folder) {
        lines.push(`${pic.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      writeFileSync(join(folder, `${pic.name}-before.png`), encodePng(PW, PH, off));
      writeFileSync(join(folder, `${pic.name}-after.png`), encodePng(PW, PH, on));
      let darker = 0;
      for (let at = 0; at < PW * PH; at++) if (on[at * 4]! + on[at * 4 + 1]! + on[at * 4 + 2]! + 30 < off[at * 4]! + off[at * 4 + 1]! + off[at * 4 + 2]!) darker++;
      lines.push(`${pic.name}: ${((100 * darker) / (PW * PH)).toFixed(1)}% of the picture shaded by the far map`);
    }
    return { ok, lines };
  },
};
