// The two depth ranges on a GPU (D252). From 1.4 km up, 0.3 m of sea over flat ground 2 km off, in front of which a
// slab floats in the near range: the far range must keep the sea over the ground, and the slab must hide the ground,
// which it does only if the device honours depthRange. Over a slope, 60 frames turning: no pixel along the seam may
// show the clear colour, which is all a gap between the ranges would show. The sea across the seam: no band blended
// twice, but for the one row whose pixels the far range keeps (D252 as L6 amended it). Pictures are held to the
// software rasterizer drawing the same frames.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { PASS_FAR, PASS_NEAR, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { WATER_ALPHA } from "../../client/core/render/shading.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { PICK_STRUCTURE, PICK_TERRAIN, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const SPLIT = tierOf("medium").split;
/** A channel within this many levels of the rasterizer's is the same colour. */
const SAME = 6;
/** Of a pixel's colour, the share that is the clear colour, past which it shows a gap. */
const GAP = 0.25;
const SLOPE = Math.tan((5 * Math.PI) / 180);
const TURNS = 60;
const SEA_YAWS = [-Math.PI / 2 - Math.PI / 6, -Math.PI / 2, -Math.PI / 2 + Math.PI / 6];
const [FAR_W, FAR_H] = [640, 360];
const [SEAM_W, SEAM_H] = [480, 270];

interface World {
  hf: Heightfield;
  structs: StructureStore;
  scene: Scene;
  cam: Camera;
}

/** A square map `chunks` on a side with its ground at `height`, seen at medium through a scene of the core pack. */
function world(reg: Registry, pack: Pack, chunks: number, height: (x: number, z: number) => number, width: number, h: number): World {
  const dims = { chunksX: chunks, chunksZ: chunks };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, height(i * hf.cell, j * hf.cell));
  hf.tint.fill(12);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack);
  scene.assets.tier = tierOf("medium");
  // The rasterizer draws no haze (D264), so these frames carry none.
  scene.plainSky = true;
  scene.viewHeight = h;
  const cam = new Camera();
  cam.aspect = width / h;
  return { hf, structs, scene, cam };
}

/**
 * Sends everything again, as to a new renderer, and builds frames into `shot` until nothing has been sent for three,
 * reading the last. The rasterizer is given what each sends.
 */
function settle(w: World, shot: Shot, raster: Rasterizer): FramePacket {
  let p: FramePacket | null = null;
  w.scene.resetUploads();
  for (let quiet = 0, k = 0; quiet < 3 && k < 300; k++) {
    w.scene.now += 1000 / 60;
    p = w.scene.build(w.cam, null);
    quiet = p.assetUploads.length + p.uploads.length + p.texUploads.length > 0 ? 0 : quiet + 1;
    shot.add(p, quiet === 3);
    const [draws, tiles] = [p.drawCount, p.tileCount];
    p.drawCount = p.tileCount = 0;
    raster.render(p);
    [p.drawCount, p.tileCount] = [draws, tiles];
  }
  return p!;
}

/** The rasterizer's picture of a frame and what is under each pixel. */
interface Picture {
  color: Uint8Array;
  kind: Uint8Array;
  id: Uint32Array;
  depth: Float32Array;
}

function picture(r: Rasterizer, p: FramePacket): Picture {
  r.render(p);
  return { color: Uint8Array.from(r.color), kind: r.pickKind.slice(), id: r.pickId.slice(), depth: r.depth.slice() };
}

/** Whether the 3 by 3 pixels about `at` are one thing in the rasterizer's picture, so that no edge, where the GPU's samples share a pixel, is near. */
function inner(pic: Picture, width: number, at: number): boolean {
  for (let dy = -width; dy <= width; dy += width) for (let dx = -1; dx <= 1; dx++) if (pic.kind[at + dy + dx] !== pic.kind[at] || pic.id[at + dy + dx] !== pic.id[at]) return false;
  return true;
}

const median = (xs: Uint8Array): number => xs.sort()[xs.length >> 1]!;

/** The most a channel of the GPU's pixel `at` is off the rasterizer's. */
const off = (gpu: Uint8Array, pic: Picture, at: number): number => Math.max(...[0, 1, 2].map((c) => Math.abs(gpu[at * 4 + c]! - pic.color[at * 4 + c]!)));

/** Makes the far range's view-projection begin at the split itself, with no overlap, to see what the overlap closes. */
function flush(m: Float32Array, near: number, far: number): void {
  const a = (far + near) / (near - far);
  [m[2], m[6], m[10], m[14]] = [-a * m[3]!, -a * m[7]!, -a * m[11]!, (2 * far * near) / (near - far)];
}

/** Pixels that are the clear colour, or more than GAP of the way to it from the middle colour of their row. */
function gaps(gpu: Uint8Array, width: number, height: number, sky: readonly number[]): number {
  let n = 0;
  const row = [0, 1, 2].map(() => new Float64Array(width));
  for (let y = 0; y < height; y++) {
    const mid = [0, 1, 2].map((c) => {
      for (let x = 0; x < width; x++) row[c]![x] = gpu[(y * width + x) * 4 + c]!;
      return row[c]!.sort()[width >> 1]!;
    });
    const to = [0, 1, 2].map((c) => sky[c]! - mid[c]!);
    const length = to.reduce((s, v) => s + v * v, 0);
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const clear = [0, 1, 2].every((c) => Math.abs(gpu[at + c]! - sky[c]!) <= 1);
      const toward = [0, 1, 2].reduce((s, c) => s + (gpu[at + c]! - mid[c]!) * to[c]!, 0) / length;
      if (clear || toward > GAP) n++;
    }
  }
  return n;
}

/**
 * The sea near the seam, against the rasterizer: pixels within 6 rows of where a column passes from the near range's
 * depth to the far's, away from the shore, where the GPU's samples share a pixel between sea and land. A pixel is
 * counted doubled when it is off by more than 0.6 of what a second blend of the sea would put it off by. `rows` is the
 * most doubled in any one column.
 */
function seaBand(gpu: Uint8Array, pic: Picture, dry: Picture): { band: number; strays: number; doubled: number; rows: number; worst: number; least: number } {
  const twice = (i: number): number => Math.max(...[0, 1, 2].map((c) => (1 - WATER_ALPHA) * Math.abs(pic.color[i * 4 + c]! - dry.color[i * 4 + c]!)));
  const wet = (i: number): boolean => [-SEAM_W, 0, SEAM_W].every((dy) => [-1, 0, 1].every((dx) => twice(i + dy + dx) > 2 * SAME));
  const out = { band: 0, strays: 0, doubled: 0, rows: 0, worst: 0, least: Infinity };
  for (let x = 1; x < SEAM_W - 1; x++) {
    let seam = -1;
    for (let y = SEAM_H - 1; y > 0 && seam < 0; y--) if (pic.depth[y * SEAM_W + x]! < 0 && pic.depth[(y - 1) * SEAM_W + x]! >= 0) seam = y;
    if (seam < 0) continue;
    let doubled = 0;
    for (let y = Math.max(1, seam - 6); y < Math.min(SEAM_H - 1, seam + 6); y++) {
      const i = y * SEAM_W + x;
      if (!inner(pic, SEAM_W, i) || !wet(i)) continue;
      const o = off(gpu, pic, i);
      out.band++;
      out.least = Math.min(out.least, twice(i));
      out.worst = Math.max(out.worst, o);
      if (o > SAME) out.strays++;
      if (o > twice(i) * 0.6) doubled++;
    }
    out.doubled += doubled;
    out.rows = Math.max(out.rows, doubled);
  }
  return out;
}

/** What the shots knew, for the judging. */
const made = {
  /** The rasterizer's two ranges at 24 bits, and the frame each far shot read. */
  far: null as Picture | null,
  read: new Map<string, number>(),
  sky: [0, 0, 0],
  /** Pixels the seam crosses from the next, over all turns, and the fewest tiles in both ranges in a frame. */
  crossing: 0,
  both: Infinity,
  sea: [] as { pic: Picture; dry: Picture; frame: number }[],
  /** The frames of the sea with nothing dropped. */
  kept: [] as number[],
};

export const depthCheck: LitCheck = {
  name: "two depth ranges (D252)",

  shots(): Shot[] {
    const reg = compileContent(CORE_CONTENT).registry!;
    const bytes = buildCorePack();
    const pack = parsePack(bytes);
    const shots: Shot[] = [];

    // From 1.4 km up and 45 degrees down onto ground 2 km off, along a view 10 degrees high, with a slab of 4 by 4
    // foundations floating 200 m along the view.
    const far = world(reg, pack, 32, () => -0.3, FAR_W, FAR_H);
    far.hf.seaLevel = 0;
    const cam = far.cam;
    [cam.x, cam.y, cam.z, cam.pitch, cam.fovY] = [1024, 2000 * Math.SQRT1_2, 200, -Math.PI / 4, (10 * Math.PI) / 180];
    const foundation = reg.index.get("core:foundation")!;
    for (let i = 0; i < 16; i++) far.structs.add(foundation, cam.x - 4.5 + (i % 4) * 3, cam.y - 200 * Math.SQRT1_2, cam.z + 200 * Math.SQRT1_2 - 4.5 + (i >> 2) * 3, 0, 0, 1);
    const raster = new Rasterizer(FAR_W, FAR_H, pack, far.hf);
    raster.depthBits = 24;
    for (const [key, split] of [["depth-far", SPLIT], ["depth-far-one", 0]] as const) {
      far.scene.assets.tier = { ...tierOf("medium"), split };
      const shot = new Shot(key, FAR_W, FAR_H, far.hf, bytes);
      const p = settle(far, shot, raster);
      // Both are held to the two ranges.
      if (split > 0) made.far = picture(raster, p);
      made.read.set(key, shot.read[0] ?? -1);
      shots.push(shot);
    }
    made.sky = [...far.scene.packet.sky].map((v) => Math.round(v * 255));

    // 150 m over a slope of 5 degrees, looking 28 degrees down along a view 30 degrees high, turning: the split crosses
    // the view in every direction, and nothing but the slope is in view.
    const ground = (x: number): number => 200 + SLOPE * (x - 1536);
    const slope = world(reg, pack, 48, ground, SEAM_W, SEAM_H);
    const sc = slope.cam;
    [sc.x, sc.y, sc.z, sc.pitch, sc.fovY] = [1536, ground(1536) + 150, 1536, (-28 * Math.PI) / 180, (30 * Math.PI) / 180];
    const ray = new Float64Array(3);
    /** The view depth on the slope at the middle of a pixel. */
    const along = (x: number, y: number): number => {
      sc.ray((x + 0.5) / SEAM_W, (y + 0.5) / SEAM_H, ray);
      const t = (sc.y - ground(sc.x)) / (SLOPE * ray[0]! - ray[1]!);
      if (!(t > 0) || Math.abs(sc.x + ray[0]! * t - 1536) > 1500 || Math.abs(sc.z + ray[2]! * t - 1536) > 1500) throw new Error("the seam's view shows more than the slope");
      return t * sc.depth(ray[0]!, ray[1]!, ray[2]!);
    };
    for (const [key, open] of [["depth-seam", false], ["depth-seam-flush", true]] as const) {
      const shot = new Shot(key, SEAM_W, SEAM_H, slope.hf, bytes);
      slope.scene.resetUploads();
      for (let k = 0; k < TURNS; k++) {
        sc.yaw = (k / TURNS) * 2 * Math.PI;
        const p = slope.scene.build(sc, null);
        if (open) flush(p.farViewProj, SPLIT, sc.far);
        shot.add(p, true);
        if (open) continue;
        let both = 0;
        for (let t = 0; t < p.tileCount; t++) if ((p.tilePass[t]! & ((1 << PASS_NEAR) | (1 << PASS_FAR))) === ((1 << PASS_NEAR) | (1 << PASS_FAR))) both++;
        made.both = Math.min(made.both, both);
        for (let x = 0; x < SEAM_W; x++) for (let y = 0; y + 1 < SEAM_H; y++) if (along(x, y) > SPLIT !== along(x, y + 1) > SPLIT) made.crossing++;
      }
      shots.push(shot);
    }

    // The sea over the foot of the slope, its shore 300 m downhill: looking downhill the split crosses it. Each frame is
    // drawn dry first, for what a band blended twice would look like.
    const sea = new Rasterizer(SEAM_W, SEAM_H, pack, slope.hf);
    const shot = new Shot("depth-sea", SEAM_W, SEAM_H, slope.hf, bytes);
    slope.hf.seaLevel = ground(1536 - 300);
    sc.yaw = SEA_YAWS[1]!;
    settle(slope, shot, sea);
    for (const yaw of SEA_YAWS) {
      sc.yaw = yaw;
      slope.hf.seaLevel = -Infinity;
      let p = slope.scene.build(sc, null);
      shot.add(p);
      const dry = picture(sea, p);
      slope.hf.seaLevel = ground(1536 - 300);
      p = slope.scene.build(sc, null);
      made.sea.push({ pic: picture(sea, p), dry, frame: shot.frames.length });
      shot.add(p, true);
    }
    shots.push(shot);
    // The same with nothing dropped: a split of 1 m in the frame block leaves the far range's see-through draws whole.
    const kept = new Shot("depth-sea-kept", SEAM_W, SEAM_H, slope.hf, bytes);
    settle(slope, kept, sea);
    for (const yaw of SEA_YAWS) {
      sc.yaw = yaw;
      const p = slope.scene.build(sc, null);
      p.split = 1;
      made.kept.push(kept.frames.length);
      kept.add(p, true);
    }
    shots.push(kept);
    return shots;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = back.device.depthBits >= 24;
    lines.push(`the depth buffer has ${back.device.depthBits} bits${ok ? "" : ", fewer than the 24 the two ranges are worked out for  FAIL"}`);

    // The sea over the ground, and the slab in front of it. Were depthRange not honoured the far ground would be drawn
    // over the slab, so a pixel of the slab is shown when it is nearer the rasterizer's colour than the ground's middle
    // one. Within SAME of it is closer: where an edge of the slab's checker crosses a row of pixels, the GPU and the
    // rasterizer may take either side of it.
    const pic = made.far!;
    const sea = [0, 1, 2].map((c) => median(pic.color.filter((_, i) => i % 4 === c && pic.kind[i >> 2] === PICK_TERRAIN)));
    for (const [key, frame] of made.read) {
      const gpu = back.pixels(key, frame);
      if (!gpu) {
        lines.push(`${key}: NO PICTURE`);
        ok = false;
        continue;
      }
      let [ground, groundOff, slab, shown, slabSame] = [0, 0, 0, 0, 0];
      for (let i = FAR_W + 1; i < pic.kind.length - FAR_W - 1; i++) {
        if (!inner(pic, FAR_W, i)) continue;
        const o = off(gpu, pic, i);
        if (pic.kind[i] === PICK_TERRAIN) [ground, groundOff] = [ground + 1, groundOff + (o > SAME ? 1 : 0)];
        if (pic.kind[i] !== PICK_STRUCTURE) continue;
        const fromSea = Math.max(...[0, 1, 2].map((c) => Math.abs(gpu[i * 4 + c]! - sea[c]!)));
        [slab, shown, slabSame] = [slab + 1, shown + (o < fromSea ? 1 : 0), slabSame + (o <= SAME ? 1 : 0)];
      }
      if (key === "depth-far") {
        const pass = ground > 50000 && groundOff <= ground * 0.001 && slab > 500 && shown === slab;
        ok &&= pass;
        lines.push(`0.3 m of sea over ground 2 km off: ${ground - groundOff} of ${ground} pixels of it as the rasterizer has them with two ranges at 24 bits; a slab in the near range over it: ${shown} of ${slab} pixels of it shown (${slabSame} within ${SAME} of the rasterizer), so depthRange is honoured  ${pass ? "ok" : "FAIL"}`);
      } else lines.push(`the same frame with one range, for comparison: the sea lost over ${groundOff} of ${ground} pixels (${((groundOff / ground) * 100).toFixed(0)}%)`);
    }

    // The seam on the slope.
    for (const key of ["depth-seam", "depth-seam-flush"]) {
      let [gap, missing] = [0, 0];
      for (let k = 0; k < TURNS; k++) {
        const gpu = back.pixels(key, k);
        if (gpu) gap += gaps(gpu, SEAM_W, SEAM_H, made.sky);
        else missing++;
      }
      if (key === "depth-seam") {
        const pass = missing === 0 && gap === 0 && made.both > 0;
        ok &&= pass;
        lines.push(`the seam on a 5 degree slope over ${TURNS} turning frames, crossing ${made.crossing} pixels, at least ${made.both} tiles a frame in both ranges: ${gap} pixels showing the clear colour  ${pass ? "ok" : "FAIL"}`);
      } else lines.push(`the same with the far range starting at the split, with no overlap, for comparison: ${gap} pixels showing the clear colour`);
    }

    // The sea across the seam, and with nothing dropped for comparison.
    made.sea.forEach(({ pic, dry, frame }, k) => {
      const [gpu, whole] = [back.pixels("depth-sea", frame), back.pixels("depth-sea-kept", made.kept[k]!)];
      if (!gpu || !whole) {
        lines.push(`depth-sea ${k}: NO PICTURE`);
        ok = false;
        return;
      }
      const b = seaBand(gpu, pic, dry);
      // The near range is cut at the split sample by sample and a fragment is dropped whole, so the far range keeps a
      // pixel whose samples reach past the split, and its samples between where the far range begins and the split are
      // blended twice (D252 as L6 amended it, where they had been left undrawn): one row, no more.
      const pass = b.band > 200 && b.rows <= 1 && b.strays <= SEAM_W;
      ok &&= pass;
      lines.push(`the sea across the seam, ${["left of", "straight", "right of"][k]} downhill: ${b.band} pixels within 6 rows of it, where a band blended twice would be ${b.least.toFixed(0)} or more off; ${b.doubled} that far off, at most ${b.rows} in a column, ${b.strays} more than ${SAME} off, the worst ${b.worst}; with nothing dropped, for comparison, ${seaBand(whole, pic, dry).doubled}  ${pass ? "ok" : "FAIL"}`);
    });
    return { ok, lines };
  },
};
