// The terrain's pictures on a GPU (D253): the whole map at every fourth sample and a window of every sample round the
// camera. Over 4 km of hills seen at medium, the ground near and 3 km off is held to the software rasterizer, which
// reads the heightfield itself. Then the camera moves 300 m, so a second window is filled in bands and swapped in: the
// frame before the swap and the frame of it, from one place, must be the same picture. After a teleport the ground is
// drawn from the whole map's pair until the new window is in, and after a lost context the pictures are made again.
// A view 70 degrees high is held to the rasterizer to 400 m, past which its triangles are under a pixel and the GPU
// and the rasterizer light them differently; ground farther off is held through a view 10 degrees high.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera, FAR_FROM } from "../../client/core/render/camera.ts";
import { FRAME, SOURCE_WINDOW, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { PICK_TERRAIN, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
const CHUNKS = 64;
/** A channel within this many levels of the rasterizer's is the same colour, as in the depth check. */
const SAME = 6;
/** Of the ground pixels compared, the share that may be more than SAME off. */
const MOST_OFF = 0.002;
/** The frames either side of a swap are compared within this many metres of the camera. */
const NEAR_SWAP = 600;
/** How far a wide view's ground is held to the rasterizer. */
const WIDE = 400;
const TINTS = [12, 16, 17, 18, 7];

/** Hills, and patches of tint some 80 m across, so a sample read from the wrong place shows. */
function hills(): Heightfield {
  const dims = { chunksX: CHUNKS, chunksZ: CHUNKS };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.setSample(i, j, 40 + 25 * Math.sin(x / 300) * Math.cos(z / 260) + 6 * Math.sin(x / 57 + z / 71));
      hf.tint[j * hf.nx + i] = TINTS[(Math.floor(x / 88) * 3 + Math.floor(z / 76) * 7) % TINTS.length]!;
    }
  }
  return hf;
}

/** The rasterizer's picture of a frame: colours, what is under each pixel, and how far off that is. */
interface Picture {
  color: Uint8Array;
  kind: Uint8Array;
  distance: Float32Array;
}

function picture(r: Rasterizer, p: FramePacket, cam: Camera): Picture {
  r.render(p);
  const ray = new Float64Array(3);
  const distance = new Float32Array(W * H);
  for (let at = 0; at < W * H; at++) {
    // From the depth stored back to view depth, in the range it is in (D252), and along the pixel's ray.
    const d = r.depth[at]!;
    const near = d < 0;
    const [n, f] = near ? [cam.near, p.split] : [p.split * FAR_FROM, cam.far];
    const z = near ? d * 2 + 1 : d * 2 - 1;
    cam.ray(((at % W) + 0.5) / W, (Math.floor(at / W) + 0.5) / H, ray);
    distance[at] = d === Infinity ? Infinity : (2 * f * n) / (n - f) / (z + (f + n) / (n - f)) / cam.depth(ray[0]!, ray[1]!, ray[2]!);
  }
  return { color: Uint8Array.from(r.color), kind: r.pickKind.slice(), distance };
}

/** Whether the rasterizer's 3 by 3 pixels about `at` are ground of one colour, away from any edge where the GPU's samples share a pixel. */
function inner(pic: Picture, at: number): boolean {
  if (at % W === 0 || at % W === W - 1 || at < W || at >= W * (H - 1)) return false;
  for (let dy = -W; dy <= W; dy += W) {
    for (let dx = -1; dx <= 1; dx++) {
      const o = at + dy + dx;
      if (pic.kind[o] !== PICK_TERRAIN) return false;
      for (let c = 0; c < 3; c++) if (Math.abs(pic.color[o * 4 + c]! - pic.color[at * 4 + c]!) > 2) return false;
    }
  }
  return true;
}

const off = (a: Uint8Array, b: Uint8Array, at: number): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[at * 4 + c]!)));

/** Ground pixels of a frame against the rasterizer in bands of distance: pixels compared and pixels more than SAME off in each. */
function against(gpu: Uint8Array, pic: Picture, bands: readonly number[]): { n: number[]; off: number[]; worst: number } {
  const out = { n: bands.map(() => 0), off: bands.map(() => 0), worst: 0 };
  for (let at = 0; at < W * H; at++) {
    if (!inner(pic, at)) continue;
    let band = bands.length - 1;
    while (band > 0 && pic.distance[at]! < bands[band]!) band--;
    const o = off(gpu, pic.color, at);
    out.n[band]!++;
    if (o > SAME) out.off[band]!++;
    out.worst = Math.max(out.worst, o);
  }
  return out;
}

/** A frame to hold to the rasterizer. */
interface Held {
  key: string;
  frame: number;
  name: string;
  pic: Picture;
  /** Tiles of it that read the window, and how far off its ground is held to the rasterizer. */
  fine: number;
  within: number;
}

const made = {
  held: [] as Held[],
  /** The swap: the frames either side, whether they have the same tiles, how far the window moved, and the rasterizer's picture. */
  swap: { before: -1, after: -1, same: false, moved: [0, 0], pic: null as Picture | null },
  /** Frames after the teleport until the new window was in. */
  coming: 0,
};

export const terrainCheck: LitCheck = {
  name: "terrain pictures (D253)",

  shots(): Shot[] {
    const reg = compileContent(CORE_CONTENT).registry!;
    const bytes = buildCorePack();
    const pack = parsePack(bytes);
    const hf = hills();
    const structs = new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    const scene = new Scene({ dims: hf.dims, hf, structs }, reg, pack);
    scene.assets.tier = tierOf("medium");
    scene.viewHeight = H;
    const raster = new Rasterizer(W, H, pack, hf);
    const cam = new Camera();
    cam.aspect = W / H;
    const place = (x: number, z: number, yaw: number, pitch: number, up = 60): void => {
      [cam.x, cam.z, cam.y, cam.yaw, cam.pitch] = [x, z, hf.heightAt(x, z) + up, yaw, pitch];
    };
    const build = (shot: Shot, name = ""): FramePacket => {
      scene.now += 1000 / 60;
      const p = scene.build(cam, null);
      // The rasterizer draws no haze (D264), so these frames carry none.
      p.frame[FRAME.haze] = 0;
      shot.add(p, name !== "");
      if (name === "") return p;
      let fine = 0;
      for (let t = 0; t < p.tileCount; t++) if (p.tileSource[t * 4 + 3] === SOURCE_WINDOW) fine++;
      made.held.push({ key: shot.key, frame: shot.frames.length - 1, name, pic: picture(raster, p, cam), fine, within: cam.fovY < 0.5 ? Infinity : WIDE });
      return p;
    };
    const shots: Shot[] = [];

    // Across the map from near its west edge, 80 m up: the window's ground near, the whole map's on to 3.5 km. Then
    // through a view 10 degrees high, so that a quad of the ground 900 m and 3 km off covers several pixels.
    const far = new Shot("terrain-far", W, H, hf, bytes);
    scene.resetUploads();
    place(500, 2048, Math.PI / 2, -0.05, 80);
    build(far);
    build(far, "across 3.5 km of hills");
    for (const [metres, name] of [[900, "900 m off through 10 degrees"], [3000, "3 km off through 10 degrees"]] as const) {
      cam.fovY = (10 * Math.PI) / 180;
      cam.pitch = -Math.atan2(cam.y - hf.heightAt(cam.x + metres, cam.z), metres);
      build(far, name);
    }
    cam.fovY = new Camera().fovY;
    shots.push(far);

    // A window is filled round one place; 300 m east, held still, a second is filled in bands and swapped in.
    const walk = new Shot("terrain-walk", W, H, hf, bytes);
    scene.resetUploads();
    place(1500, 2000, Math.PI / 2 + 0.3, -0.12);
    build(walk);
    build(walk);
    place(1800, 2000, Math.PI / 2 + 0.3, -0.12);
    for (let k = 0; k < 8 && made.swap.after < 0; k++) {
      const q = scene.packet;
      const was = [q.groundWindow[0]!, q.groundWindow[1]!, q.groundWindow[2]!];
      const tiles = String(q.tiles.subarray(0, q.tileCount * 4)) + String(q.tileOrigin.subarray(0, q.tileCount * 2));
      const p = build(walk);
      if (k === 0 || p.groundWindow[0] === was[0]) continue;
      const s = made.swap;
      [s.before, s.after] = [walk.frames.length - 2, walk.frames.length - 1];
      walk.read.push(s.before, s.after);
      s.same = tiles === String(p.tiles.subarray(0, p.tileCount * 4)) + String(p.tileOrigin.subarray(0, p.tileCount * 2));
      s.moved = [p.groundWindow[1]! - was[1]!, p.groundWindow[2]! - was[2]!];
      s.pic = picture(raster, p, cam);
    }
    // 2 km on, the window drawn holds none of the ground in view: it is drawn from the whole map's pair until the new one is in.
    place(3700, 3400, Math.PI + 0.6, -0.1);
    const old = scene.packet.groundWindow[0];
    build(walk, "just after a teleport, with no window round it");
    for (let k = 0; k < 8 && scene.packet.groundWindow[0] === old; k++, made.coming++) build(walk);
    build(walk, "once the window has come");
    shots.push(walk);

    // A lost context: the renderer makes its pictures again, and the frame after fills the window whole.
    const lost = new Shot("terrain-lost", W, H, hf, bytes);
    scene.resetUploads();
    place(2600, 1200, 2.2, -0.1);
    build(lost);
    build(lost);
    lost.loseAt = 2;
    scene.resetUploads();
    build(lost, "after a lost context");
    shots.push(lost);
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    for (const h of made.held) {
      const gpu = back.pixels(h.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const bands = [0, WIDE, 1200];
      const a = against(gpu, h.pic, bands);
      const held = (v: number[]): number => v.reduce((s, x, k) => s + (bands[k]! < h.within ? x : 0), 0);
      const [n, bad] = [held(a.n), held(a.off)];
      const pass = n > 20000 && bad <= n * MOST_OFF;
      ok &&= pass;
      const band = (k: number): string => `${a.n[k]! - a.off[k]!} of ${a.n[k]}`;
      lines.push(`${h.name}, ${h.fine} tiles from the window: ${n - bad} of ${n} ground pixels ${h.within < Infinity ? `to ${h.within} m ` : ""}within ${SAME} of the rasterizer (to ${WIDE} m ${band(0)}, to 1.2 km ${band(1)}, past it ${band(2)}), the worst ${a.worst} off  ${pass ? "ok" : "FAIL"}`);
    }
    lines.push(`after the teleport the new window came ${made.coming + 1} frames on`);

    const s = made.swap;
    const [before, after] = [back.pixels("terrain-walk", s.before), back.pixels("terrain-walk", s.after)];
    if (!before || !after || !s.pic) {
      lines.push(`the swap: NO PICTURE (frames ${s.before} and ${s.after})`);
      return { ok: false, lines };
    }
    let [near, nearChanged, all, changed, worst] = [0, 0, 0, 0, 0];
    for (let at = 0; at < W * H; at++) {
      if (s.pic.kind[at] !== PICK_TERRAIN) continue;
      const o = off(before, after, at);
      [all, changed, worst] = [all + 1, changed + (o > 0 ? 1 : 0), Math.max(worst, o)];
      if (s.pic.distance[at]! < NEAR_SWAP) [near, nearChanged] = [near + 1, nearChanged + (o > 0 ? 1 : 0)];
    }
    const a = against(after, s.pic, [0]);
    const pass = s.same && near > 50000 && nearChanged === 0 && a.off[0]! <= a.n[0]! * MOST_OFF;
    ok &&= pass;
    lines.push(`a window moved ${s.moved.map((m) => m * TERRAIN_CELL).join(" m and ")} m and swapped in, the tiles ${s.same ? "the same" : "NOT THE SAME"}: ${nearChanged} of ${near} ground pixels within ${NEAR_SWAP} m changed, ${changed} of ${all} in the whole frame (the worst by ${worst}); the frame of the swap, ${a.n[0]! - a.off[0]!} of ${a.n[0]} within ${SAME} of the rasterizer  ${pass ? "ok" : "FAIL"}`);
    return { ok, lines };
  },
};
