// The sky's openness on a GPU (client/core/render/skyopen.ts), a check of tools/probe-lit.ts. A street 16 m wide between
// two rows of frame buildings 40 m tall, ruins of the sloped kinds down it and a building turned across its end, on high
// in the morning: from down in the street, from 150 m up over it, and at the foot of a building from 10 m. The GPU must
// draw what the rasterizer, the reference for light, draws with the measure as the card holds it, from the rows the
// frames sent: where the openness or the contact takes the sky's light down, and where they leave it, within 4 levels;
// with the measure let go, as a frame of low poly lets it go; and after a lost context, when it goes on the card again.
// The rasterizer draws no shadows (D203), so neither does the GPU here.
//
// With PROBE_PICTURES naming a folder and PROBE_MAP a built map, Miami's, it writes there pictures of that map on high
// with the sun's shadows: a street between towers at noon and at 17:30, the foot of a building from 10 m, the same street
// from 150 m up, and open ground by the shore, each without the openness and with it, the measure let go for without, so
// both are the same frame, and where it darkened the picture.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, parseMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { building, cityWorld, slopes, type CityWorld } from "../../tests/fixtures/cityworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_SKY } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** Levels of 255 the GPU may be off the rasterizer, the share of judged pixels that may be off further, and how much the measure must take for a pixel to count as taken. */
const SAME = 4;
const MOST_OFF = 0.01;
const TAKEN = 4;

interface Held {
  name: string;
  frame: number;
  /** The rasterizer's picture, what is under each pixel, and the rasterizer's picture without the measure; null for a frame drawn without it. */
  color: Uint8Array;
  kind: Uint8Array;
  id: Float64Array;
  without: Uint8Array | null;
}

const made = { key: "", held: [] as Held[], pictures: [] as { name: string; key: string; off: number; on: number }[] };

/** The street, its ruins and the building across its end. */
function street(): MapStatic[] {
  const out: MapStatic[] = [];
  for (let z = 296; z <= 456; z += 16) out.push(...building(360, z, 0, 10), ...building(392, z, 0, 10));
  out.push(...slopes(376, 340, 0, 16384).all);
  out.push(...building(380, 500, 0, 6, 2, YAW_UNITS / 12));
  return out;
}

/** Builds a frame into `shot` and the rasterizer, read if `read`. */
function frame(w: CityWorld, shot: Shot, read: boolean): FramePacket {
  w.scene.now += 1000 / 60;
  const p = w.scene.build(w.cam, null);
  w.raster.render(p);
  shot.add(p, read);
  return p;
}

/** Frames until nothing more goes on the card for three. */
function settle(w: CityWorld, shot: Shot): void {
  for (let quiet = 0, k = 0; quiet < 3 && k < 600; k++) {
    const p = frame(w, shot, false);
    quiet = p.assetUploads.length + p.uploads.length > 0 || p.openRows > 0 || (w.scene.city?.stats.missing ?? 0) > 0 ? 0 : quiet + 1;
  }
}

/** The frame from where the camera stands, read; then the same frame with the measure let go, read; then the measure sent again. */
function hold(w: CityWorld, shot: Shot, name: string): void {
  settle(w, shot);
  const p = frame(w, shot, true);
  const held: Held = { name, frame: shot.frames.length - 1, color: Uint8Array.from(w.raster.color), kind: w.raster.pickKind.slice(), id: w.raster.pickId.slice(), without: null };
  const [width, height] = [p.openWidth, p.openHeight];
  p.openWidth = p.openHeight = 0;
  w.raster.render(p);
  shot.add(p, true);
  held.without = Uint8Array.from(w.raster.color);
  made.held.push(held, { name: `${name}, the measure let go`, frame: shot.frames.length - 1, color: held.without, kind: held.kind, id: held.id, without: null });
  [p.openWidth, p.openHeight] = [width, height];
  w.scene.farShadow!.open.reset();
}

function stagedShots(): Shot[] {
  const bytes = buildCorePack();
  const w = cityWorld({ chunks: 16, statics: street(), tier: { ...tierOf("high"), uploadBytes: 64 * 2 ** 20 }, width: W, height: H, pack: parsePack(bytes) });
  // The rasterizer draws no haze (D264), so these frames carry none.
  w.scene.plainSky = true;
  w.scene.hour = 9;
  const shot = new Shot("sky-open", W, H, w.hf, bytes);
  made.key = shot.key;
  w.scene.resetUploads();
  const stand = (x: number, y: number, z: number, lx: number, ly: number, lz: number): void => {
    [w.cam.x, w.cam.y, w.cam.z] = [x, y, z];
    [w.cam.yaw, w.cam.pitch] = [Math.atan2(lx - x, lz - z), Math.atan2(ly - y, Math.hypot(lx - x, lz - z))];
  };
  // The near store holds the street's chunks, so its buildings are drawn near, and textured where they have materials.
  for (let z = 256; z < 560; z += CHUNK_SIZE) for (let x = 320; x < 448; x += CHUNK_SIZE) w.rows(w.chunkOf(x, z));
  stand(376, 1.7, 300, 376, 6, 460);
  hold(w, shot, "down in the street");
  stand(376, 150, 230, 376, 0, 380);
  hold(w, shot, "the street from 150 m up");
  stand(376, 1.7, 330, 360, 3, 340);
  hold(w, shot, "the foot of a building from 10 m");
  // The context lost: the measure goes on the card again, as the rows the frames send.
  shot.loseAt = shot.frames.length;
  w.scene.resetUploads();
  stand(376, 1.7, 300, 376, 6, 460);
  hold(w, shot, "down in the street after a lost context");
  return [shot];
}

/**
 * Pixels whose 5 by 5 neighbours are one thing and one colour in the rasterizer, so that an edge the GPU draws a sample
 * aside is not judged, taken down by the measure or not: how many, how many the GPU has more than SAME off, and the worst.
 */
function compare(gpu: Uint8Array, h: Held): { taken: number[]; left: number[] } {
  const out = { taken: [0, 0, 0], left: [0, 0, 0] };
  const off = (a: Uint8Array, b: Uint8Array, at: number, bt = at): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[bt * 4 + c]!)));
  for (let y = 2; y < H - 2; y++) {
    next: for (let x = 2; x < W - 2; x++) {
      const at = y * W + x;
      if (h.kind[at] === PICK_SKY) continue;
      for (let dy = -2 * W; dy <= 2 * W; dy += W) for (let dx = -2; dx <= 2; dx++) if (h.kind[at + dy + dx] !== h.kind[at] || h.id[at + dy + dx] !== h.id[at] || off(h.color, h.color, at + dy + dx, at) > 2) continue next;
      const n = h.without && off(h.without, h.color, at) >= TAKEN ? out.taken : out.left;
      const o = off(gpu, h.color, at);
      n[0]!++;
      if (o > SAME) n[1]!++;
      n[2] = Math.max(n[2]!, o);
    }
  }
  return out;
}

/** Pictures side by side with a gap of 4 pixels, `width` by `height` each. */
function sheet(row: Uint8Array[], width: number, height: number): Uint8Array {
  const sw = row.length * (width + 4) - 4;
  const out = new Uint8Array(sw * height * 4).fill(255);
  row.forEach((px, c) => {
    for (let y = 0; y < height; y++) out.set(px.subarray(y * width * 4, (y + 1) * width * 4), (y * sw + c * (width + 4)) * 4);
  });
  return encodePng(sw, height, out);
}

/** The views of a built map's pictures, of Miami: where the camera stands, at a height or `up` over the ground, the point it looks at (x, y, z), and the hours. */
const VIEWS: { name: string; x: number; z: number; y?: number; up?: number; look: [number, number, number]; hours: number[] }[] = [
  { name: "street", x: 6540, z: 4114, up: 1.7, look: [6700, 20, 4114], hours: [12, 17.5] },
  { name: "foot", x: 6618, z: 4110, up: 1.7, look: [6618, 3, 4122], hours: [12] },
  { name: "street-150m", x: 6470, z: 4114, y: 150, look: [6640, 0, 4114], hours: [12] },
  { name: "shore", x: 2022, z: 2290, up: 1.7, look: [2150, 0, 2340], hours: [12] },
];
const [PW, PH] = [1280, 720];

/** A built map on high with the sun's shadows, its statics all held by a near store holding the chunks within three of the camera whole; its trees left out. */
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
  scene.assets.tier = { ...tierOf("high"), uploadBytes: 64 * 2 ** 20 };
  scene.viewHeight = PH;
  if (scene.city) scene.city.makeMs = Infinity;
  const shot = new Shot("sky-open-map", PW, PH, hf, bytes);
  shot.shadows = true;
  scene.resetUploads();
  for (const v of VIEWS) {
    for (const hour of v.hours) {
      scene.hour = hour;
      [cam.x, cam.z] = [v.x, v.z];
      cam.y = v.y ?? hf.heightAt(v.x, v.z) + v.up!;
      const [dx, dy, dz] = [v.look[0] - cam.x, v.look[1] - cam.y, v.look[2] - cam.z];
      [cam.yaw, cam.pitch] = [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
      for (let quiet = 0, k = 0; quiet < 3 && k < 2000; k++) {
        scene.now += 1000 / 60;
        const p = scene.build(cam, null);
        shot.add(p, false);
        const r = scene.assets.residency;
        quiet = p.assetUploads.length + p.uploads.length > 0 || p.farRows > 0 || p.openRows > 0 || r.flying > 0 || r.waiting > 0 || (scene.city?.stats.missing ?? 0) > 0 ? 0 : quiet + 1;
      }
      scene.now += 1000 / 60;
      const p = scene.build(cam, null);
      // Without the measure, then with it again, all of it sent in the frame: the same frame but for that.
      const [width, height] = [p.openWidth, p.openHeight];
      p.openWidth = p.openHeight = 0;
      shot.add(p, true);
      scene.farShadow!.open.reset();
      scene.now += 1000 / 60;
      const again = scene.build(cam, null);
      if (again.openWidth !== width || again.openHeight !== height || again.openRows !== height) throw new Error("the measure did not go on the card again in one frame");
      shot.add(again, true);
      made.pictures.push({ name: `${v.name}-${String(Math.floor(hour)).padStart(2, "0")}${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`, key: shot.key, off: shot.frames.length - 2, on: shot.frames.length - 1 });
    }
  }
  const s = scene.farShadow!.open.stats;
  console.log(`  sky's openness: ${chunkCount(map.dims)} chunks, ${statics.count} statics; ${s.made} made, the last in ${s.ms.toFixed(0)} ms here`);
  return [shot];
}

export const skyOpenCheck: LitCheck = {
  name: "the sky's openness and the foot of what stands (skyopen.ts)",

  shots(): Shot[] {
    const shots = stagedShots();
    if (process.env.PROBE_MAP && process.env.PROBE_PICTURES) shots.push(...mapShots(process.env.PROBE_MAP));
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    const say = (n: number[]): string => `${n[0]} (${n[1]} more than ${SAME} off, the worst ${n[2]})`;
    const folder = process.env.PROBE_PICTURES;
    if (folder) mkdirSync(folder, { recursive: true });
    made.held.forEach((h, k) => {
      const gpu = back.pixels(made.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        return;
      }
      const c = compare(gpu, h);
      const fine = (n: number[]): boolean => n[1]! <= n[0]! * MOST_OFF;
      const pass = fine(c.taken) && fine(c.left) && c.taken[0]! + c.left[0]! >= 2000 && (h.without === null || c.taken[0]! >= 3000);
      ok &&= pass;
      lines.push(`${h.name}: pixels taken down ${say(c.taken)}, and left ${say(c.left)}  ${pass ? "ok" : "FAIL"}`);
      // The GPU's picture, the rasterizer's, and where they are more than SAME apart, in red.
      if (folder) writeFileSync(join(folder, `staged-${k}.png`), sheet([gpu, h.color, gpu.map((v, i) => ((i & 3) === 3 ? 255 : (i & 3) === 0 && Math.max(...[0, 1, 2].map((ch) => Math.abs(gpu[(i & ~3) + ch]! - h.color[(i & ~3) + ch]!))) > SAME ? 255 : 0))], W, H));
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
      // Where the measure darkened the picture, by how much, over the picture without it greyed; and whether it lightened any.
      let darker = 0, lighter = 0, most = 0;
      const where = new Uint8Array(PW * PH * 4);
      for (let at = 0; at < PW * PH; at++) {
        const d = off[at * 4]! + off[at * 4 + 1]! + off[at * 4 + 2]! - on[at * 4]! - on[at * 4 + 1]! - on[at * 4 + 2]!;
        if (d > 6) darker++;
        if (d < -6) lighter++;
        most = Math.max(most, d);
        const grey = (off[at * 4]! + off[at * 4 + 1]! + off[at * 4 + 2]!) / 6;
        where.set([Math.min(255, grey + Math.max(0, d)), grey, Math.min(255, grey + Math.max(0, -d)), 255], at * 4);
      }
      writeFileSync(join(folder, `${pic.name}-darker.png`), encodePng(PW, PH, where));
      lines.push(`${pic.name}: ${((100 * darker) / (PW * PH)).toFixed(1)}% of the picture darker by more than 2 levels a channel, the most ${Math.round(most / 3)}; ${lighter} pixels lighter`);
    }
    return { ok, lines };
  },
};
