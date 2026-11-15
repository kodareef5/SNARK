// Sun shadows on a GPU (D268, D269), a check of tools/probe-lit.ts. A block, a slab of nine foundations and a roofed
// thatch room with a doorway stand on flat ground at medium, staged here as the plan's open decision 9 has it. At noon,
// points the TypeScript puts in the block's shadow read the rasterizer's colour with no sun within 4 steps, and points
// outside, the block's own faces among them, its sunlit colour; once as this device looks shadows up and once comparing
// four texels in the shader, as a device whose compared lookups come back hard does, and after a lost context. Under a
// 15 degree sun no pixel on the slab, seams included, is 10 steps darker than sunlit. The room's floor seen through its
// doorway reads shaded. A pixel on the edge of the block's shadow holds within 2 steps while the camera moves 30 times
// along its view by under a texel. At midnight, when nothing casts, the room's floor reads as the rasterizer has it
// within 3 steps and a survivor in the room within 7, and the floor is set beside low poly's. With PROBE_PICTURES naming
// a folder, what a player sees is written there with materials, each with shadows off beside it: the thatch house with
// a survivor and a dodo at 10:00, noon and 17:30, a wall's foot, the wall and ceiling joints from inside at 10:00 and
// 17:30, the dodo at noon and 17:30 (its feather cards and the thatch's fringe are cut out), the slab under 15 degrees
// and the sunlit wall close by at 17:30.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { shadowCascade } from "../../client/core/render/shadowtext.ts";
import { hourOfSun, trueSun } from "../../client/core/render/sky.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { DOOR_HEIGHT, DOOR_WIDTH, FLOOR_THICK, FOUNDATION_THICK, SPAN, WALL_HEIGHT, WALL_THICK } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { buildCorePack } from "../pack/build.ts";
import { gameFiles, type GameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_ENTITY, PICK_STRUCTURE, PICK_TERRAIN, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

/** Odd, so that the middle pixel lies on the view's axis. */
const [W, H] = [641, 361];
const [PW, PH] = [960, 540];
const GROUND = 10;
const FLOOR = GROUND + FOUNDATION_THICK;
/** The room's middle, the block, and the slab's middle foundation. */
const ROOM = { x: 128, z: 128 };
const BLOCK = { x: 144.5, z: 116.5 };
const SLAB = { x: 104, z: 156 };
/** Levels of 255: the GPU against the twins, the most a slab pixel may be darker than sunlit, and how far the edge pixel may move. */
const SAME = 4;
const DARKER = 10;
const HOLD = 2;
const NIGHT_SAME = 3;
const BODY_SAME = 7;
/** Of the points judged against SAME, the share that may be off: edges the rasterizer and the GPU's samples split differently. */
const MOST_OFF = 0.01;

interface Box {
  min: number[];
  max: number[];
}

interface World {
  reg: Registry;
  hf: Heightfield;
  pack: Uint8Array;
  structs: StructureStore;
  remote: RemoteSample;
  scene: Scene;
  cam: Camera;
  raster: Rasterizer | null;
  port: FakeNet | null;
  boxes: Box[];
}

/** Flat ground 256 m square at medium, with the room, the block and the slab, from the boot pack or streamed with materials. */
function world(width: number, height: number, files?: GameFiles): World {
  const reg = compileContent(CORE_CONTENT).registry!;
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, GROUND);
  hf.tint.fill(1);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const bytes = files ? files.files[0]! : buildCorePack();
  const pack = parsePack(bytes);
  const port = files ? new FakeNet(files.files) : null;
  const scene = new Scene({ dims, hf, structs }, reg, pack, files && port ? { manifest: files.manifest, port } : undefined);
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = height;
  // The judged frames are held to the rasterizer, which draws no haze and no clouds; the pictures are what a player sees.
  scene.plainSky = !files;
  const cam = new Camera();
  cam.aspect = width / height;
  const w: World = { reg, hf, pack: bytes, structs, remote: new RemoteSample(), scene, cam, raster: files ? null : new Rasterizer(width, height, pack, hf), port, boxes: [] };
  stage(w);
  return w;
}

/** A piece where building puts it, turned a quarter for each `edge`, and the boxes it is made of. */
function put(w: World, piece: string, x: number, y: number, z: number, edge = 0, parts?: number[][]): void {
  const k = w.reg.index.get(`core:${piece}`)!;
  w.structs.add(k, x, y, z, edge * 16384, 0, 1);
  const turn = edge % 2 === 1;
  for (const [cx, cy, cz, hx, hy, hz] of parts ?? [[0, 0, 0, w.reg.halfX[k]!, w.reg.halfY[k]!, w.reg.halfZ[k]!]]) {
    const [ax, az, bx, bz] = turn ? [cz!, cx!, hz!, hx!] : [cx!, cz!, hx!, hz!];
    w.boxes.push({ min: [x + ax - bx, y + cy! - hy!, z + az - bz], max: [x + ax + bx, y + cy! + hy!, z + az + bz] });
  }
}

/** The room of four thatch foundations, its doorway on the south side, roofed; the block; the slab. */
function stage(w: World): void {
  const wy = FLOOR + WALL_HEIGHT / 2;
  const [h, t, post, lintel] = [SPAN / 2, WALL_THICK / 2, (SPAN - DOOR_WIDTH) / 4, (WALL_HEIGHT - DOOR_HEIGHT) / 2];
  const door = [[-h + post, 0, 0, post, WALL_HEIGHT / 2, t], [h - post, 0, 0, post, WALL_HEIGHT / 2, t], [0, WALL_HEIGHT / 2 - lintel, 0, DOOR_WIDTH / 2, lintel, t]];
  for (const ox of [-1.5, 1.5]) {
    for (const oz of [-1.5, 1.5]) {
      put(w, "foundation_thatch", ROOM.x + ox, GROUND + FOUNDATION_THICK / 2, ROOM.z + oz);
      put(w, "ceiling_thatch", ROOM.x + ox, FLOOR + WALL_HEIGHT - FLOOR_THICK / 2, ROOM.z + oz);
    }
    put(w, "wall_thatch", ROOM.x + ox, wy, ROOM.z + 3);
    put(w, "wall_thatch", ROOM.x + 3, wy, ROOM.z + ox, 1);
    put(w, "wall_thatch", ROOM.x - 3, wy, ROOM.z + ox, 3);
  }
  put(w, "wall_thatch", ROOM.x - 1.5, wy, ROOM.z - 3, 2);
  put(w, "doorframe_thatch", ROOM.x + 1.5, wy, ROOM.z - 3, 2, door);
  put(w, "block", BLOCK.x, GROUND + 1, BLOCK.z);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) put(w, "foundation_thatch", SLAB.x + i * 3, GROUND + FOUNDATION_THICK / 2, SLAB.z + j * 3);
}

/** Bodies standing at (x, y, z) facing `yaw`, as a view of the server's would hold them. */
function bodies(w: World, list: [string, number, number, number, number][]): void {
  const r = w.remote;
  r.count = 0;
  for (const [kind, x, y, z, yaw] of list) {
    const n = r.count++;
    [r.id[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n], r.anim[n]] = [101 + n, w.reg.index.get(kind)!, x, y, z, yaw, 1, 0];
  }
}

/** Puts the camera at `eye` looking at `at`. */
function look(cam: Camera, eye: number[], at: number[]): void {
  const [dx, dy, dz] = [at[0]! - eye[0]!, at[1]! - eye[1]!, at[2]! - eye[2]!];
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [eye[0]!, eye[1]!, eye[2]!, Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

/** Builds `n` frames into `shot`, the last read back if `read`, the rasterizer given each one's uploads. */
function frames(w: World, shot: Shot, n: number, read: boolean): FramePacket {
  let p: FramePacket | null = null;
  for (let k = 0; k < n; k++) {
    w.scene.now += 1000 / 60;
    w.port?.advance(w.scene.now);
    p = w.scene.build(w.cam, w.remote);
    shot.add(p, read && k === n - 1);
    if (!w.raster) continue;
    const [draws, tiles] = [p.drawCount, p.tileCount];
    if (k < n - 1) p.drawCount = p.tileCount = 0;
    w.raster.render(p);
    [p.drawCount, p.tileCount] = [draws, tiles];
  }
  return p!;
}

/** Builds frames into `shot` until the card holds all the scene wants and nothing has been sent for three. */
function settle(w: World, shot: Shot): void {
  for (let quiet = 0, k = 0; quiet < 3 && k < 4000; k++) {
    w.scene.now += 1000 / 60;
    w.port?.advance(w.scene.now);
    const p = w.scene.build(w.cam, w.remote);
    const r = w.scene.assets.residency;
    quiet = p.assetUploads.length + p.texUploads.length + p.uploads.length > 0 || r.flying > 0 || r.waiting > 0 ? 0 : quiet + 1;
    shot.add(p, false);
  }
}

/** Where a ray from `o` along `d` enters a box grown by `grow`, and through which face: its distance, or Infinity. */
function enter(o: number[], d: number[], b: Box, grow: number, face?: number[]): number {
  let [near, far, axis] = [-Infinity, Infinity, -1];
  for (let a = 0; a < 3; a++) {
    const [lo, hi] = [b.min[a]! - grow, b.max[a]! + grow];
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < lo || o[a]! > hi) return Infinity;
      continue;
    }
    let [t0, t1] = [(lo - o[a]!) / d[a]!, (hi - o[a]!) / d[a]!];
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > near) [near, axis] = [t0, a];
    far = Math.min(far, t1);
  }
  if (near > far || far < 0) return Infinity;
  if (face) {
    face.fill(0);
    face[axis] = -Math.sign(d[axis]!);
  }
  return Math.max(near, 0);
}

/** The nearest thing pixel (x, y) sees of the ground and the staged boxes: the point, the box (-1 for the ground) and the normal there. */
function nearest(w: World, x: number, y: number): { point: number[]; own: number; normal: number[] } | null {
  const dir = [0, 0, 0];
  const face = [0, 0, 0];
  w.cam.ray((x + 0.5) / W, (y + 0.5) / H, dir);
  const eye = [w.cam.x, w.cam.y, w.cam.z];
  let [best, own, normal] = [dir[1]! < 0 ? (GROUND - eye[1]!) / dir[1]! : Infinity, -1, [0, 1, 0]];
  w.boxes.forEach((b, i) => {
    const t = enter(eye, dir, b, 0, face);
    if (t < best) [best, own, normal] = [t, i, [...face]];
  });
  return best === Infinity ? null : { point: eye.map((e, a) => e + dir[a]! * best), own, normal };
}

/** What the rasterizer saw of a judged frame: sunlit and with the sun taken out, and what is under each pixel. */
interface Judged {
  name: string;
  frame: number;
  /** Per pixel: 0 not judged, 1 sunlit, 2 in shadow, 3 sunlit and judged only for being darker (the slab), 4 at night. */
  want: Uint8Array;
  sunlit: Uint8Array;
  shaded: Uint8Array;
  lookup: string;
}

const made = {
  judged: [] as Judged[],
  edge: { frames: [] as number[] },
  night: { medium: -1, low: -1, floor: [] as number[], body: [] as number[], twin: new Uint8Array(0) },
  pictures: [] as { name: string; off: number; on: number }[],
};

/**
 * Classifies the pixels of the frame just built and rasterized: those whose nearest thing is the ground or one of the
 * staged boxes, as the rasterizer also has it, and that the TypeScript can say are sunlit or shaded, with a margin of
 * the filter's reach and the normal offset in the cascade's texels, and `slack` more for art that is not its boxes.
 * `on` says which receivers are judged, by their box or -1 for the ground; on the slab, only whether it is darker.
 */
function judge(w: World, p: FramePacket, name: string, frame: number, lookup: string, on: (box: number) => boolean, slack = 0, slab = false): void {
  const r = w.raster!;
  const sunlit = Uint8Array.from(r.color);
  const keep = p.frame.slice(FRAME.sunColor, FRAME.sunColor + 3);
  p.frame.fill(0, FRAME.sunColor, FRAME.sunColor + 3);
  r.render(p);
  const shaded = Uint8Array.from(r.color);
  p.frame.set(keep, FRAME.sunColor);
  r.render(p);
  const want = new Uint8Array(W * H);
  const sun = [0, 0, 0];
  trueSun(p.frame, sun);
  const eye = [w.cam.x, w.cam.y, w.cam.z];
  const taps = Math.round(Math.sqrt(p.tier.shadows.taps));
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const at = y * W + x;
      const hit = nearest(w, x, y);
      if (!hit || !on(hit.own)) continue;
      const { point, own, normal } = hit;
      const kind = r.pickKind[at];
      if (kind !== (own < 0 ? PICK_TERRAIN : PICK_STRUCTURE)) continue;
      if (slab) {
        // The slab: its top, away from its outer edges, where the rasterizer's colour is even.
        let even = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let c = 0; c < 3; c++) even &&= Math.abs(sunlit[(at + dy * W + dx) * 4 + c]! - sunlit[at * 4 + c]!) <= 2 && r.pickKind[at + dy * W + dx] === PICK_STRUCTURE;
        if (even && normal[1] === 1 && Math.abs(point[0]! - SLAB.x) < 4.45 && Math.abs(point[2]! - SLAB.z) < 4.45) want[at] = 3;
        continue;
      }
      // One surface about it, and the rasterizer's colour even there: no edge of a piece or of the checker.
      let one = true;
      for (let dy = -3; dy <= 3 && one; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const n = at + dy * W + dx;
          one &&= r.pickKind[n] === kind && r.pickId[n] === r.pickId[at];
          for (let c = 0; c < 3; c++) one &&= Math.abs(sunlit[n * 4 + c]! - sunlit[(n + 1) * 4 + c]!) <= 3 && Math.abs(sunlit[n * 4 + c]! - sunlit[(n + W) * 4 + c]!) <= 3;
        }
      }
      if (!one) continue;
      const rel = point.map((v, a) => v - eye[a]!);
      const { cascade, fade } = shadowCascade(rel[0]!, rel[1]!, rel[2]!, p.spheres, p.cascadeCount, x, H - 1 - y);
      if (cascade < 0 || fade > 0) {
        if (cascade < 0) want[at] = 1;
        continue;
      }
      const m = p.cascades.subarray(cascade * 16, cascade * 16 + 3);
      const margin = ((taps + 1) * 2) / (p.tier.shadows.size * Math.hypot(m[0]!, m[1]!, m[2]!)) + 0.01 + slack;
      const from = point.map((v, a) => v + normal[a]! * 1e-3);
      let [maybe, surely] = [false, false];
      w.boxes.forEach((b, i) => {
        if (i === own || b.max[1]! <= point[1]! + 1e-3) return;
        if (enter(from, sun, b, margin) < Infinity) maybe = true;
        if (enter(from, sun, b, -margin) < Infinity) surely = true;
      });
      if (!maybe) want[at] = 1;
      else if (surely) want[at] = 2;
    }
  }
  made.judged.push({ name, frame, want, sunlit, shaded, lookup });
}

/** The most a channel of pixel `at` of `a` differs from `b`'s, signed: negative where `a` is darker. */
function diff(a: Uint8Array, b: Uint8Array, at: number): number {
  let most = 0;
  for (let c = 0; c < 3; c++) {
    const d = a[at * 4 + c]! - b[at * 4 + c]!;
    if (Math.abs(d) > Math.abs(most)) most = d;
  }
  return most;
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

/** The judged shots: the block, the slab, the room, the edge and the night, from the boot pack. */
function judgedShots(): Shot[] {
  const w = world(W, H);
  const shots: Shot[] = [];
  // The boxes of the block, of the room's four foundations and of the slab's nine, by their middles.
  const near = (b: Box, x: number, z: number, d: number): boolean => Math.abs((b.min[0]! + b.max[0]!) / 2 - x) <= d && Math.abs((b.min[2]! + b.max[2]!) / 2 - z) <= d && b.max[1]! <= GROUND + 2;
  const block = w.boxes.findIndex((b) => near(b, BLOCK.x, BLOCK.z, 0.01));
  const floor = new Set(w.boxes.flatMap((b, i) => (near(b, ROOM.x, ROOM.z, 1.51) && b.max[1]! <= FLOOR + 1e-6 ? [i] : [])));
  const slab = new Set(w.boxes.flatMap((b, i) => (near(b, SLAB.x, SLAB.z, 3.01) ? [i] : [])));
  for (const lookup of ["device", "hard"]) {
    const shot = new Shot(`shadow-${lookup}`, W, H, w.hf, w.pack);
    shot.shadows = true;
    shot.lookup = lookup === "hard" ? "hard" : "";
    w.scene.resetUploads();
    w.scene.hour = 12;
    look(w.cam, [BLOCK.x + 3.2, GROUND + 2.6, BLOCK.z - 4.2], [BLOCK.x - 0.2, GROUND + 0.2, BLOCK.z - 0.9]);
    const how = lookup === "hard" ? "four texels compared in the shader" : "as this device looks up";
    const p = frames(w, shot, 4, true);
    judge(w, p, `the block at noon, ${how}`, shot.frames.length - 1, lookup, (i) => i < 0 || i === block);
    // A 15 degree sun in the morning, from the east, over the slab.
    w.scene.hour = hourOfSun(15, false);
    look(w.cam, [SLAB.x - 9, GROUND + 6, SLAB.z - 10], [SLAB.x + 0.5, GROUND, SLAB.z + 0.5]);
    frames(w, shot, 3, true);
    judge(w, p, `the slab under a 15 degree sun, ${how}`, shot.frames.length - 1, lookup, (i) => slab.has(i), 0, true);
    // The room's floor through its doorway at noon. The thatch hangs past the boxes of its pieces.
    w.scene.hour = 12;
    look(w.cam, [ROOM.x + 1.5, FLOOR + 1.7, ROOM.z - 6.5], [ROOM.x + 1.2, FLOOR, ROOM.z + 1]);
    frames(w, shot, 3, true);
    judge(w, p, `the room's floor through its doorway at noon, ${how}`, shot.frames.length - 1, lookup, (i) => floor.has(i), 0.1);
    if (lookup === "hard") {
      shots.push(shot);
      break;
    }
    // The edge of the block's shadow on the ground, at the middle pixel, the camera moving along its view.
    const edge = [BLOCK.x + 1, GROUND, BLOCK.z - 1.25];
    const eye = [edge[0]! + 3, GROUND + 2.5, edge[2]! - 4];
    look(w.cam, eye, edge);
    const first = frames(w, shot, 2, false);
    const texel = 2 / (first.tier.shadows.size * Math.hypot(...first.cascades.subarray(0, 3)));
    const way = edge.map((v, a) => v - eye[a]!);
    const along = Math.hypot(...way);
    for (let k = 0; k < 30; k++) {
      const s = (k * 0.37 * texel) / along;
      look(w.cam, eye.map((v, a) => v + way[a]! * s), edge);
      frames(w, shot, 1, true);
      made.edge.frames.push(shot.frames.length - 1);
    }
    // Midnight: a survivor in the room, at medium and then at low poly.
    w.scene.hour = 0;
    bodies(w, [["core:survivor", ROOM.x + 1.6, FLOOR, ROOM.z - 1, Math.PI]]);
    look(w.cam, [ROOM.x + 1.5, FLOOR + 1.6, ROOM.z - 4], [ROOM.x + 1.5, FLOOR + 0.7, ROOM.z - 0.5]);
    frames(w, shot, 3, true);
    made.night.medium = shot.frames.length - 1;
    made.night.twin = Uint8Array.from(w.raster!.color);
    for (let at = 0; at < W * H; at++) {
      const [x, y] = [at % W, Math.floor(at / W)];
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const [kind, c] = [w.raster!.pickKind[at], made.night.twin];
      let one = true;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const n = at + dy * W + dx;
          one &&= w.raster!.pickKind[n] === kind && w.raster!.pickId[n] === w.raster!.pickId[at];
          for (let k = 0; k < 3; k++) one &&= Math.abs(c[n * 4 + k]! - c[(n + 1) * 4 + k]!) <= 3 && Math.abs(c[n * 4 + k]! - c[(n + W) * 4 + k]!) <= 3;
        }
      }
      if (!one) continue;
      if (kind === PICK_ENTITY) made.night.body.push(at);
      const hit = kind === PICK_STRUCTURE ? nearest(w, x, y) : null;
      if (hit && hit.normal[1] === 1 && Math.abs(hit.point[1]! - FLOOR) < 1e-6 && Math.abs(hit.point[0]! - ROOM.x) < 2.7 && Math.abs(hit.point[2]! - ROOM.z) < 2.7) made.night.floor.push(at);
    }
    w.scene.assets.tier = tierOf("lowpoly");
    frames(w, shot, 4, true);
    made.night.low = shot.frames.length - 1;
    w.scene.assets.tier = tierOf("medium");
    bodies(w, []);
    // A lost context: the maps and the programs are made again, and every cascade drawn again.
    shot.loseAt = shot.frames.length;
    w.scene.resetUploads();
    w.scene.hour = 12;
    look(w.cam, [BLOCK.x + 3.2, GROUND + 2.6, BLOCK.z - 4.2], [BLOCK.x - 0.2, GROUND + 0.2, BLOCK.z - 0.9]);
    frames(w, shot, 4, true);
    judge(w, p, "the block at noon after a lost context", shot.frames.length - 1, lookup, (i) => i < 0 || i === block);
    shots.push(shot);
  }
  return shots;
}

/** The pictures, with materials, each with shadows off and on. */
async function pictureShots(): Promise<Shot[]> {
  const files = await gameFiles();
  const w = world(PW, PH, files);
  const shot = new Shot("shadow-pictures", PW, PH, w.hf, w.pack);
  shot.shadows = true;
  shot.manifest = files.manifest;
  const outside: [string, number, number, number, number][] = [["core:survivor", ROOM.x + 3.6, GROUND, ROOM.z - 5.4, 2.4], ["core:dodo", ROOM.x + 1.6, GROUND, ROOM.z - 5.8, 0.6]];
  const house = [[ROOM.x + 7.5, FLOOR + 3.2, ROOM.z - 9.5], [ROOM.x - 0.2, FLOOR + 0.9, ROOM.z - 2]];
  const dodo = [[ROOM.x + 0.6, GROUND + 1.3, ROOM.z - 8.2], [ROOM.x + 2.2, GROUND + 0.2, ROOM.z - 5.6]];
  const views: [string, number, [string, number, number, number, number][], number[][], number][] = [
    ["house-1000", 10, outside, house, 55],
    ["house-1200", 12, outside, house, 55],
    ["house-1730", 17.5, outside, house, 55],
    ["foot-1000", 10, [], [[ROOM.x - 2.2, GROUND + 1.1, ROOM.z - 5.2], [ROOM.x - 1.2, GROUND + 0.3, ROOM.z - 3.1]], 50],
    ["joint-1000", 10, [], [[ROOM.x + 2, FLOOR + 1.5, ROOM.z - 2], [ROOM.x - 2.9, FLOOR + 2.7, ROOM.z + 2.4]], 70],
    ["joint-1730", 17.5, [], [[ROOM.x - 2, FLOOR + 1.5, ROOM.z - 2], [ROOM.x + 2.9, FLOOR + 2.7, ROOM.z + 2.4]], 70],
    ["dodo-1200", 12, outside, dodo, 45],
    ["dodo-1730", 17.5, outside, dodo, 45],
    ["slab-15", hourOfSun(15, false), [], [[SLAB.x - 8, GROUND + 4, SLAB.z - 8], [SLAB.x + 0.5, GROUND, SLAB.z + 0.5]], 60],
    // The sunlit wall close by at 17:30, where the upper row's fringe shades the row below it.
    ["wall-1730", 17.5, [], [[ROOM.x + 5.5, FLOOR + 1.7, ROOM.z - 1], [ROOM.x + 3, FLOOR + 1.4, ROOM.z + 0.2]], 40],
  ];
  for (const [name, hour, list, [eye, at], fov] of views) {
    w.scene.hour = hour;
    bodies(w, list);
    look(w.cam, eye!, at!);
    w.cam.fovY = (fov * Math.PI) / 180;
    settle(w, shot);
    shot.shadows = false;
    const p = w.scene.build(w.cam, w.remote);
    shot.add(p, true);
    shot.shadows = true;
    shot.add(w.scene.build(w.cam, w.remote), true);
    made.pictures.push({ name, off: shot.frames.length - 2, on: shot.frames.length - 1 });
  }
  return [shot];
}

export const shadowCheck: LitCheck = {
  name: "sun shadows (D268, D269)",

  async shots(): Promise<Shot[]> {
    const shots = judgedShots();
    if (process.env.PROBE_PICTURES) shots.push(...(await pictureShots()));
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    const folder = process.env.PROBE_PICTURES;
    if (folder) mkdirSync(folder, { recursive: true });
    for (const j of made.judged) {
      const gpu = back.pixels(`shadow-${j.lookup}`, j.frame);
      if (!gpu) {
        lines.push(`${j.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const count = [0, 0, 0, 0];
      const off = [0, 0, 0, 0];
      const worst = [0, 0, 0, 0];
      for (let at = 0; at < W * H; at++) {
        const k = j.want[at]!;
        if (k === 0) continue;
        count[k]++;
        const d = diff(gpu, k === 2 ? j.shaded : j.sunlit, at);
        if (k === 3) {
          worst[k] = Math.min(worst[k]!, d);
          if (d < -DARKER) off[k]++;
          continue;
        }
        worst[k] = Math.max(worst[k]!, Math.abs(d));
        if (Math.abs(d) > SAME) off[k]++;
      }
      if (count[3]! > 0) {
        const pass = count[3]! >= 2000 && off[3] === 0;
        ok &&= pass;
        lines.push(`${j.name}: ${count[3]} pixels on its top, seams included; ${off[3]} more than ${DARKER} darker than sunlit, the darkest ${-worst[3]!}  ${pass ? "ok" : "FAIL"}`);
        continue;
      }
      // The floor is all in shadow; the block's view has both.
      const floor = j.name.includes("floor");
      const pass = (floor || count[1]! >= 500) && off[1]! <= count[1]! * MOST_OFF && count[2]! >= (floor ? 1000 : 500) && off[2]! <= count[2]! * MOST_OFF;
      ok &&= pass;
      lines.push(`${j.name}: ${count[2]} points in shadow, ${off[2]} more than ${SAME} off the shaded colour, the worst ${worst[2]}; ${count[1]} sunlit, ${off[1]} off, the worst ${worst[1]}  ${pass ? "ok" : "FAIL"}`);
    }

    // The two ways of looking up draw the same views; where they differ, the shader's own comparison ran.
    const hard = made.judged.filter((j) => j.lookup === "hard");
    made.judged.filter((j) => j.lookup !== "hard").forEach((device, i) => {
      if (!hard[i]) return;
      const [a, b] = [back.pixels("shadow-device", device.frame), back.pixels("shadow-hard", hard[i].frame)];
      if (!a || !b) return;
      let [differ, most] = [0, 0];
      for (let at = 0; at < W * H; at++) {
        const d = Math.abs(diff(a, b, at));
        if (d > 0) differ++;
        most = Math.max(most, d);
      }
      lines.push(`  the two lookups apart, ${device.name.replace(/,.*/, "")}: ${differ} pixels differ, by at most ${most}`);
      const apart = new Uint8Array(W * H * 4).map((_, k) => ((k & 3) === 3 ? 255 : Math.min(255, Math.abs(a[k]! - b[k]!) * 4)));
      if (folder) writeFileSync(join(folder, `l5-lookups-${i}.png`), sheet([a, b, apart], W, H));
    });
    const edge = made.edge.frames.map((f) => back.pixels("shadow-device", f));
    if (edge.some((e) => !e)) {
      lines.push("the shadow's edge: NO PICTURE");
      ok = false;
    } else {
      const middle = ((H - 1) / 2) * W + (W - 1) / 2;
      const values = edge.map((e) => e!.subarray(middle * 4, middle * 4 + 3));
      const most = Math.max(...values.map((v) => Math.max(...[0, 1, 2].map((c) => Math.abs(v[c]! - values[0]![c]!)))));
      const pass = most <= HOLD;
      ok &&= pass;
      lines.push(`a pixel on the block's shadow edge over 30 moves of 0.37 texel along the view: ${values.map((v) => v[0]).join(" ")} (red), moving at most ${most}  ${pass ? "ok" : "FAIL"}`);
    }

    const [medium, low] = [back.pixels("shadow-device", made.night.medium), back.pixels("shadow-device", made.night.low)];
    if (!medium || !low) {
      lines.push("midnight: NO PICTURE");
      ok = false;
    } else {
      const spread = (ats: number[], a: Uint8Array, b: Uint8Array): { mean: number; worst: number; off: number } => {
        const ds = ats.map((at) => Math.abs(diff(a, b, at)));
        return { mean: ds.reduce((s, d) => s + d, 0) / Math.max(1, ds.length), worst: Math.max(0, ...ds), off: ds.filter((d) => d > NIGHT_SAME).length };
      };
      const floor = spread(made.night.floor, medium, made.night.twin);
      const body = made.night.body.map((at) => Math.abs(diff(medium, made.night.twin, at)));
      const lowFloor = spread(made.night.floor, medium, low);
      const pass = made.night.floor.length >= 200 && floor.off <= made.night.floor.length * MOST_OFF && made.night.body.length >= 30 && body.filter((d) => d > BODY_SAME).length <= body.length * MOST_OFF;
      ok &&= pass;
      lines.push(`midnight, the room's floor: ${made.night.floor.length} points, against the lit twin mean ${floor.mean.toFixed(1)}, worst ${floor.worst}, ${floor.off} over ${NIGHT_SAME}; against low poly mean ${lowFloor.mean.toFixed(1)}, worst ${lowFloor.worst}`);
      lines.push(`midnight, a survivor in the room: ${body.length} points against the lit twin, worst ${Math.max(0, ...body)}, ${body.filter((d) => d > BODY_SAME).length} over ${BODY_SAME}  ${pass ? "ok" : "FAIL"}`);
    }

    if (folder) {
      const blank = new Uint8Array(PW * PH * 4);
      for (const pic of made.pictures) writeFileSync(join(folder, `l5-${pic.name}.png`), sheet([back.pixels("shadow-pictures", pic.off) ?? blank, back.pixels("shadow-pictures", pic.on) ?? blank], PW, PH));
      // Points the TypeScript puts in shadow tinted blue, and points the GPU has off the twins' colour red.
      const tint = (j: Judged, gpu: Uint8Array): Uint8Array => {
        const out = Uint8Array.from(gpu);
        for (let at = 0; at < W * H; at++) {
          const k = j.want[at]!;
          if (k === 2) out[at * 4 + 2] = Math.min(255, out[at * 4 + 2]! + 60);
          const d = k === 0 ? 0 : diff(gpu, k === 2 ? j.shaded : j.sunlit, at);
          if (k === 3 ? d < -DARKER : Math.abs(d) > SAME) out.set([255, 0, 0], at * 4);
        }
        return out;
      };
      const rows = made.judged.map((j) => [j.sunlit, back.pixels(`shadow-${j.lookup}`, j.frame) ?? new Uint8Array(W * H * 4), tint(j, back.pixels(`shadow-${j.lookup}`, j.frame) ?? new Uint8Array(W * H * 4))]);
      rows.forEach((row, i) => writeFileSync(join(folder, `l5-judged-${i}.png`), sheet(row, W, H)));
      if (medium && low) writeFileSync(join(folder, "l5-midnight.png"), sheet([made.night.twin, medium, low], W, H));
      lines.push(`pictures in ${folder}: ${made.pictures.map((p) => `l5-${p.name}.png`).join(", ")} (each shadows off, then on); l5-judged-0 to ${rows.length - 1}.png (${made.judged.map((j) => j.name).join("; ")}: the rasterizer, the GPU, and the GPU with points the TypeScript puts in shadow tinted blue)`);
    }
    return { ok, lines };
  },
};
