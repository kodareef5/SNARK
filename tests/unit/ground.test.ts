// The ground is one surface. What the reference rasterizer draws is what heightAt reports and what a ray meets, face by face.
// On a lit frame it is lit by the normal of its heights, and its cover is chosen a pixel from the picture its tile reads.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { TerrainLod } from "../../client/core/render/terrain.ts";
import { GROUND_WANDER } from "../../client/core/render/world-surfaces.ts";
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

test("on a lit frame the ground is lit by the normal of its heights, blended across each triangle: under a low sun no facet shows, and a bank still reads as one", () => {
  // Ground rolling by 2 m over 9 to 13 m, and a bank 6 m high over 6 m across it at x = 120, all of one grass.
  const w = flatWorld(4);
  const hf = w.hf;
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.setSample(i, j, 2 * Math.sin(x / 9) * Math.cos(z / 13) + 6 * Math.min(Math.max((x - 120) / 6, 0), 1));
      hf.tint[j * hf.nx + i] = 12;
    }
  }
  const [w2, h2] = [2 * W, 2 * H];
  const cam = new Camera();
  [cam.x, cam.z, cam.yaw, cam.pitch, cam.aspect] = [96, 128, Math.PI / 2, -0.2, w2 / h2];
  cam.y = hf.heightAt(cam.x, cam.z) + 3;
  cam.update();
  const p = new FramePacket();
  p.lit = true;
  skyFrame(12, theSky(), p.frame);
  // A sun 10 degrees up behind the camera, which the bank faces.
  p.frame.set([-Math.cos(0.17), Math.sin(0.17), 0], FRAME.sun);
  p.viewProj.set(cam.viewProj);
  [p.camX, p.camY, p.camZ, p.fogStart, p.fogEnd] = [cam.x, cam.y, cam.z, 1e6, 2e6];
  new TerrainLod(hf).select(cam, p, 4000);
  const raster = new Rasterizer(w2, h2, { palette: defaultPalette() } as unknown as Pack, hf);
  raster.render(p);
  const c = raster.color;
  // How far off along the view a pixel's depth is.
  const along = (at: number): number => (2 * cam.far * cam.near) / (cam.far + cam.near - raster.depth[at]! * (cam.far - cam.near));
  // Neighbouring pixels of ground at about the same distance differ by a few levels at most, the most where the bank's
  // light turns over the quad at its top. Lit by its faces, the ground stepped by 51 levels from one face to the next here.
  let pairs = 0;
  let worst = 0;
  for (let at = 0; at < w2 * h2 - 1; at++) {
    if (at % w2 === w2 - 1 || raster.pickKind[at] !== PICK_TERRAIN || raster.pickKind[at + 1] !== PICK_TERRAIN) continue;
    if (Math.abs(along(at) - along(at + 1)) > 0.02 * along(at)) continue;
    pairs++;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[at * 4 + k]! - c[(at + 1) * 4 + k]!));
  }
  expect(pairs).toBeGreaterThan(w2 * h2 * 0.4);
  expect(worst).toBeLessThanOrEqual(10);
  // The bank's face, turned to the sun, is far brighter than the ground before it.
  const shade = (x: number, z: number): number => {
    const out = [0, 0, 0];
    expect(cam.project(x, hf.heightAt(x, z), z, out)).toBe(true);
    const at = Math.floor(out[1]! * h2) * w2 + Math.floor(out[0]! * w2);
    expect(raster.pickKind[at]).toBe(PICK_TERRAIN);
    return c[at * 4]! + c[at * 4 + 1]! + c[at * 4 + 2]!;
  };
  expect(shade(123, 128) - shade(110, 128)).toBeGreaterThan(60);
});

/** A lit frame at noon of the ground of `hf` alone from `cam`, drawn `w` by `h` with the terrain's level of detail at `detail`. */
function litGround(hf: TestWorld["hf"], cam: Camera, w: number, h: number, detail = 2.5): Rasterizer {
  cam.aspect = w / h;
  cam.update();
  const p = new FramePacket();
  p.lit = true;
  skyFrame(12, theSky(), p.frame);
  p.viewProj.set(cam.viewProj);
  [p.camX, p.camY, p.camZ, p.fogStart, p.fogEnd] = [cam.x, cam.y, cam.z, 1e6, 2e6];
  const lod = new TerrainLod(hf);
  lod.detail = detail;
  lod.select(cam, p, 4000);
  const raster = new Rasterizer(w, h, { palette: defaultPalette() } as unknown as Pack, hf);
  raster.render(p);
  return raster;
}

test("on a lit frame the ground's cover is chosen a pixel: an edge across the samples runs within a fraction of a metre of the line between the covers and never steps", () => {
  // Grass east of the diagonal, asphalt on it and west of it, on level ground: halfway between them is the line x - z = 1 m.
  const hf = flatWorld(2).hf;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.tint[j * hf.nx + i] = i > j ? 12 : 4;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [64, 14, 64, 0, -Math.PI / 2 + 1e-3];
  const [w2, h2] = [2 * W, 2 * H];
  const raster = litGround(hf, cam, w2, h2);
  const ray = [0, 0, 0];
  // In each row, where the cover first turns from asphalt to grass, and how far that is across the line.
  const across: number[] = [];
  for (let py = 0; py < h2; py++) {
    for (let px = 1; px < w2; px++) {
      const grass = (at: number): boolean => raster.color[at * 4 + 1]! > raster.color[at * 4 + 2]!;
      if (grass(py * w2 + px - 1) === grass(py * w2 + px)) continue;
      cam.ray(px / w2, (py + 0.5) / h2, ray);
      const t = -cam.y / ray[1]!;
      across.push((cam.x + ray[0]! * t - (cam.z + ray[2]! * t) - 1) / Math.SQRT2);
      break;
    }
  }
  expect(across.length).toBeGreaterThan(h2 * 0.9);
  // A pixel here is 11 cm. The curve through the cells is within 12 cm of the line, and the wander moves it smoothly by up
  // to GROUND_WANDER along each axis. Where each quad took its first corner's colour, the stair stepped 1.39 m between rows.
  let [most, jump] = [0, 0];
  for (let k = 0; k < across.length; k++) {
    most = Math.max(most, Math.abs(across[k]!));
    if (k > 0) jump = Math.max(jump, Math.abs(across[k]! - across[k - 1]!));
  }
  expect(most).toBeLessThan(0.12 + GROUND_WANDER * Math.SQRT2);
  expect(most).toBeGreaterThan(0.25);
  expect(jump).toBeLessThan(0.3);
});

test("on a lit frame the ground's cover does not change as a tile splits: tiles of any size read their picture's every sample", () => {
  // Level ground of covers in patches and single samples, which a coarser tile would skip.
  const hf = flatWorld(16).hf;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.tint[j * hf.nx + i] = (i * 7 + j * 13) % 29 === 0 ? 1 : Math.floor(i / 9 + j / 14) % 3 === 0 ? 4 : 12;
  const [w2, h2] = [2 * W, 2 * H];
  const look = (y: number, pitch: number, detail: number): Rasterizer => {
    const cam = new Camera();
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [200, y, 200, 0.7, pitch];
    return litGround(hf, cam, w2, h2, detail);
  };
  // From 700 m up every tile reads the whole map's picture, from 30 m up those within 320 m read the window's.
  for (const [y, pitch, within] of [[700, -0.9, Infinity], [30, -0.25, 300]] as const) {
    const [fine, coarse] = [look(y, pitch, 2.5), look(y, pitch, 1.25)];
    const { near, far } = new Camera();
    let [compared, changed] = [0, 0];
    for (let at = 0; at < w2 * h2; at++) {
      if (fine.pickKind[at] !== PICK_TERRAIN) continue;
      if ((2 * far * near) / (far + near - fine.depth[at]! * (far - near)) > within) continue;
      compared++;
      if ([0, 1, 2].some((c) => fine.color[at * 4 + c] !== coarse.color[at * 4 + c])) changed++;
    }
    // Where each quad took its first corner's colour, 5,937 of the 21,214 pixels seen from 700 m changed.
    expect([compared > w2 * h2 * 0.3, fine.trianglesDrawn > coarse.trianglesDrawn, changed]).toEqual([true, true, 0]);
  }
});
