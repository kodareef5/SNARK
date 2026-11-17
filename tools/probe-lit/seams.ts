// Seams in the ground on a GPU, a check of tools/probe-lit.ts. A tile's skirt meets the ground along the tile's border,
// and where the depth buffer could not tell them apart it showed through as a dark dotted line (terrain.ts
// SKIRT_BEHIND). Rolling ground is seen through long lenses from 30 m up, 800 m off and 300 m off, which medium draws
// in its near range, at low poly and at medium. The software rasterizer draws no skirts, and no ground pixel may be far
// darker than every pixel about it in the rasterizer's picture. A control moves every other tile 30 cm, so that cracks
// open along their borders and the skirts show through them: at low poly, where a skirt is lit by its own face, the
// check must find those. A lit tier lights a skirt by the normal of the ground it hangs from, so there the same cracks
// must show nothing.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { TILE_QUADS, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_TERRAIN, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/**
 * A ground pixel is dark where the GPU's channels sum to less than this share of the darkest of the rasterizer's 3 by
 * 3 about it. One sample in four of a skirt in shadow makes a pixel about 0.9 of the ground's.
 */
const DARK = 0.95;
/** Of the ground pixels in a view, the share that may be dark. */
const MOST_DARK = 0.0001;

/** Rolling ground of one tint, 4 km a side. */
function rolling(): Heightfield {
  const hf = new Heightfield({ chunksX: 64, chunksZ: 64 }, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.setSample(i, j, 40 + 25 * Math.sin(x / 300) * Math.cos(z / 260) + 6 * Math.sin(x / 57 + z / 71));
    }
  }
  hf.tint.fill(12);
  return hf;
}

interface Picture {
  color: Uint8Array;
  kind: Uint8Array;
}

interface Held {
  key: string;
  frame: number;
  name: string;
  pic: Picture;
  /** A control, which must fail. */
  control: boolean;
  /** Cracks are open in it and must not show. */
  cracked: boolean;
}

const made = { held: [] as Held[] };

/** Ground pixels whose 3 by 3 neighbours are ground in the rasterizer: how many, and how many the GPU has dark. */
function dark(gpu: Uint8Array, pic: Picture): { n: number; dark: number } {
  const out = { n: 0, dark: 0 };
  const sum = (px: Uint8Array, at: number): number => px[at * 4]! + px[at * 4 + 1]! + px[at * 4 + 2]!;
  for (let y = 1; y < H - 1; y++) {
    next: for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      let least = Infinity;
      for (let dy = -W; dy <= W; dy += W) {
        for (let dx = -1; dx <= 1; dx++) {
          if (pic.kind[at + dy + dx] !== PICK_TERRAIN) continue next;
          least = Math.min(least, sum(pic.color, at + dy + dx));
        }
      }
      out.n++;
      if (sum(gpu, at) < least * DARK) out.dark++;
    }
  }
  return out;
}

/** Pictures side by side, a row of them a line, with a gap of 4 pixels. */
function sheet(rows: Uint8Array[][]): Uint8Array {
  const cols = Math.max(...rows.map((r) => r.length));
  const [sw, sh] = [cols * (W + 4) - 4, rows.length * (H + 4) - 4];
  const out = new Uint8Array(sw * sh * 4).fill(255);
  rows.forEach((row, r) => row.forEach((px, c) => {
    for (let y = 0; y < H; y++) out.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((r * (H + 4) + y) * sw + c * (W + 4)) * 4);
  }));
  return encodePng(sw, sh, out);
}

export const seamsCheck: LitCheck = {
  name: "seams in the ground",

  shots(): Shot[] {
    const reg = compileContent(CORE_CONTENT).registry!;
    const bytes = buildCorePack();
    const pack = parsePack(bytes);
    const hf = rolling();
    const shots: Shot[] = [];
    for (const tier of ["lowpoly", "medium"]) {
      const structs = new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
      const scene = new Scene({ dims: hf.dims, hf, structs }, reg, pack);
      scene.assets.tier = tierOf(tier);
      // The rasterizer draws no haze (D264), so these frames carry none.
      scene.plainSky = true;
      scene.viewHeight = H;
      const raster = new Rasterizer(W, H, pack, hf);
      const cam = new Camera();
      cam.aspect = W / H;
      const shot = new Shot(`seams-${tier}`, W, H, hf, bytes);
      const build = (name: string, change?: (p: FramePacket) => void): void => {
        scene.now += 1000 / 60;
        const p = scene.build(cam, null);
        raster.render(p);
        change?.(p);
        shot.add(p, true);
        const lit = scene.assets.tier.lit;
        made.held.push({ key: shot.key, frame: shot.frames.length - 1, name: `${tier}, ${name}`, pic: { color: Uint8Array.from(raster.color), kind: raster.pickKind.slice() }, control: change !== undefined && !lit, cracked: change !== undefined && lit });
      };
      /** From `up` metres over the ground at (x, z), looks along +x at the ground `metres` on, through a lens `span` metres high there. */
      const look = (x: number, z: number, metres: number, up: number, span: number): void => {
        [cam.x, cam.z, cam.y, cam.yaw] = [x, z, hf.heightAt(x, z) + up, Math.PI / 2];
        cam.pitch = -Math.atan2(cam.y - hf.heightAt(x + metres, z), metres);
        cam.fovY = 2 * Math.atan(span / 2 / metres);
      };
      // The first frame fills the window.
      look(1400, 2048, 800, 30, 80);
      scene.now += 1000 / 60;
      shot.add(scene.build(cam, null));
      build("800 m off through a lens 80 m high, from 30 m up");
      build("the same with every other tile moved 30 cm", (p) => {
        for (let t = 0; t < p.tileCount; t++) if (((p.tileOrigin[t * 2]! + p.tileOrigin[t * 2 + 1]!) / (TILE_QUADS * p.tiles[t * 4 + 3]!)) % 2 === 1) p.tiles[t * 4]! += 0.3;
      });
      look(1400, 2048, 300, 30, 30);
      build("300 m off through a lens 30 m high, from 30 m up");
      shots.push(shot);
    }
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
      const d = dark(gpu, h.pic);
      const clean = d.dark <= d.n * MOST_DARK;
      const pass = d.n > 50000 && clean !== h.control;
      ok &&= pass;
      lines.push(`${h.name}: ${d.dark} of ${d.n} ground pixels far darker than the rasterizer's${h.control ? ", which the check must find" : h.cracked ? ", where a skirt is lit as its ground and a crack must not show" : ""}  ${pass ? "ok" : "FAIL"}`);
    }
    const folder = process.env.PROBE_PICTURES;
    if (folder) {
      const blank = new Uint8Array(W * H * 4);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "seams.png"), sheet(made.held.map((h) => [h.pic.color, back.pixels(h.key, h.frame) ?? blank])));
      lines.push(`pictures in ${folder}: seams.png (${made.held.map((h) => h.name).join("; ")}; rasterizer, GPU)`);
    }
    return { ok, lines };
  },
};
