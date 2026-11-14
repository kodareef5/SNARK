// The ground is one surface. What the reference rasterizer draws is what heightAt reports and what a ray meets, face by face.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { TerrainLod } from "../../client/core/render/terrain.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { HIT_NONE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { PICK_SKY, PICK_TERRAIN, Rasterizer } from "../../tools/snap/raster.ts";
import { flatWorld, provingWorld, type TestWorld } from "../fixtures/world.ts";

const W = 160;
const H = 90;

/**
 * Draws the ground alone from (x, y, z), then casts a ray through the middle of every pixel. Returns the pixels where the two
 * disagree: on whether there is ground, on how far away it is, on its height, or on which way the face there turns.
 */
function disagreements(w: TestWorld, x: number, y: number, z: number, yaw: number, pitch: number): string[] {
  const hf = w.hf;
  const cam = new Camera();
  cam.x = x;
  cam.y = y;
  cam.z = z;
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.aspect = W / H;
  cam.update();
  const packet = new FramePacket();
  packet.viewProj.set(cam.viewProj);
  packet.camX = x;
  packet.camY = y;
  packet.camZ = z;
  packet.sun.set([0, 1, 0]);
  packet.fogStart = 1e6;
  packet.fogEnd = 2e6;
  new TerrainLod(hf).select(cam, packet, 4000);
  const raster = new Rasterizer(W, H, { palette: defaultPalette() } as unknown as Pack, hf);
  raster.render(packet);

  const m = cam.viewProj;
  const out: string[] = [];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      // The camera-relative direction that projects to the middle of this pixel, with w = 1.
      const nx = ((px + 0.5) / W) * 2 - 1;
      const ny = 1 - ((py + 0.5) / H) * 2;
      const a = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[3]!, m[7]!, m[11]!];
      const det3 = (b: number[]): number => b[0]! * (b[4]! * b[8]! - b[5]! * b[7]!) - b[1]! * (b[3]! * b[8]! - b[5]! * b[6]!) + b[2]! * (b[3]! * b[7]! - b[4]! * b[6]!);
      const det = det3(a);
      const col = (k: number): number => det3(a.map((v, i) => (i % 3 === k ? [nx, ny, 1][Math.floor(i / 3)]! : v))) / det;
      let dx = col(0);
      let dy = col(1);
      let dz = col(2);
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      const at = py * W + px;
      const kind = castWorld(w, x, y, z, dx, dy, dz, 400);
      const where = `pixel ${px},${py}`;
      if (raster.pickKind[at] === PICK_SKY) {
        if (kind !== HIT_NONE) out.push(`${where}: sky drawn, ground met at ${rayHit.t.toFixed(3)}`);
        continue;
      }
      expect(raster.pickKind[at]).toBe(PICK_TERRAIN);
      if (kind !== HIT_TERRAIN) {
        out.push(`${where}: ground drawn, none met`);
        continue;
      }
      // How far along the ray the depth drawn is.
      const p = m[2]! * dx + m[6]! * dy + m[10]! * dz;
      const q = m[3]! * dx + m[7]! * dy + m[11]! * dz;
      const drawn = m[14]! / (raster.depth[at]! * q - p);
      const t = rayHit.t;
      if (Math.abs(drawn - t) > 0.004 + t * 2e-5) out.push(`${where}: ground drawn at ${drawn.toFixed(4)}, met at ${t.toFixed(4)}`);
      const hx = x + dx * t;
      const hy = y + dy * t;
      const hz = z + dz * t;
      if (Math.abs(hy - hf.heightAt(hx, hz)) > 1e-6) out.push(`${where}: met at height ${hy}, heightAt says ${hf.heightAt(hx, hz)}`);
      // The face drawn there, split as the mesh is, from (i, j) to (i + 1, j + 1). Points on an edge belong to either face.
      const fx = hx / hf.cell;
      const fz = hz / hf.cell;
      const i = Math.min(hf.nx - 2, Math.floor(fx));
      const j = Math.min(hf.nz - 2, Math.floor(fz));
      const u = fx - i;
      const v = fz - j;
      if (u < 1e-6 || v < 1e-6 || u > 1 - 1e-6 || v > 1 - 1e-6 || Math.abs(u - v) < 1e-6) continue;
      const rise = 1 / hf.cell;
      const sx = (u >= v ? hf.sample(i + 1, j) - hf.sample(i, j) : hf.sample(i + 1, j + 1) - hf.sample(i, j + 1)) * rise;
      const sz = (u >= v ? hf.sample(i + 1, j + 1) - hf.sample(i + 1, j) : hf.sample(i, j + 1) - hf.sample(i, j)) * rise;
      const n = Math.hypot(sx, 1, sz);
      const off = Math.hypot(rayHit.nx + sx / n, rayHit.ny - 1 / n, rayHit.nz + sz / n);
      if (off > 1e-9) out.push(`${where}: the face drawn turns ${(-sx / n).toFixed(4)}, ${(1 / n).toFixed(4)}, ${(-sz / n).toFixed(4)}, the ray reports ${rayHit.nx.toFixed(4)}, ${rayHit.ny.toFixed(4)}, ${rayHit.nz.toFixed(4)}`);
    }
  }
  return out;
}

test("what is drawn is the ground: a ray through any pixel meets the face drawn there, as far off, as high and turned the same way", () => {
  // Folds a cell wide: every other sample half a metre up, so each cell's two triangles meet in a crease along the diagonal they
  // are split by, and the other split would draw a ridge there instead.
  const folds = flatWorld(2);
  for (let j = 0; j < folds.hf.nz; j++) for (let i = 0; i < folds.hf.nx; i++) folds.hf.setSample(i, j, (i + j) % 2 === 0 ? 0 : 0.5);
  const problems: string[] = [];
  const look = (w: TestWorld, x: number, y: number, z: number, yaw: number, pitch: number): void => {
    const found = disagreements(w, x, y, z, yaw, pitch);
    if (found.length > 0) problems.push(`from ${x}, ${y}, ${z} at ${yaw}, ${pitch}: ${found.length} pixels, first ${found[0]}`);
  };
  // Across the folds low down, where every ray grazes their crests; then down onto them.
  look(folds, 20, 1.4, 21, 0.9, -0.05);
  look(folds, 64, 2, 64, 2.5, -0.2);
  look(folds, 40, 6, 30, 0.3, -0.9);
  // Out over the edge of the map, where nothing is drawn.
  look(folds, 64, 3, 120, 0.2, -0.1);
  look(folds, 125, 2, 6, 1.9, 0);
  // The proving ground: its slopes and its rolling ground.
  const proving: TestWorld = { ...provingWorld(), structs: flatWorld(8).structs };
  look(proving, 220, 6, 282, 0.1, -0.15);
  look(proving, 330, 9, 330, 0.7, -0.2);
  expect(problems).toEqual([]);
});
