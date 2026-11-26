// Paints the garments' maps by script, nothing taken from any picture: each print sheet's base colour, normal and packed
// map, its fabric's weave (weave.ts) filtered down to the sheet's texels and its seams pressed in; and each cut's masks
// on each body, from the regions the cut gives its points (build.ts). The cuts are built on the bodies of the cooked
// human-bodies pack, so it is run after that pack is cooked once, and the pack cooked again after it. Writes beside the
// human-bodies asset, in garments/.
//
//   bun assets/source/core/humans/garments/paint.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CUTS, SHEETS, type Fabric, type SheetName } from "../../../../../shared/people/cuts.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { encodePng } from "../../../../../tools/pack/image.ts";
import { unpackMeshes } from "../../../../../tools/pack/write.ts";
import { madeCuts } from "./make.ts";
import { hash, WEAVES, type Tile } from "./weave.ts";

const HERE = import.meta.dir;
export const MAPS = resolve(HERE, "../human-bodies/garments");
const PACK = resolve(HERE, "../human-bodies/human-bodies.snpk");

/** Sides of a sheet's base colour and normal, and of every cut's masks. */
export const SHEET_SIDE: Readonly<Record<SheetName, number>> = { top: 1024, bottom: 1024, shoes: 512, cap: 512, apron: 1024 };
export const MASK_SIDE = 256;
/** The fabric each sheet is woven of. */
const FABRIC: Readonly<Record<SheetName, Fabric>> = { top: "jersey", bottom: "denim", shoes: "canvas", cap: "canvas", apron: "canvas" };
/** How high a thread stands, in metres, and a seam's groove's half width and depth. */
const RELIEF = 0.00018;
const SEAM = 0.0016;
const GROOVE = 0.0004;
const MEAN = 0.5;

const fromLinear = (l: number): number => Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.min(1, Math.max(0, l)), 1 / 2.4) - 0.055) * 255);

/** The seams pressed into a sheet, as lines on it: each panel's own seams, where its cloth is sewn. */
function seamsOf(sheet: SheetName): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const rect = (name: string) => SHEETS[sheet].panels.find((p) => p.name === name)!.rect;
  const down = (u: number, [, v, , h]: readonly number[]): void => void out.push([u, v!, u, v! + h!]);
  if (sheet === "top") {
    const t = rect("torso");
    for (const s of [0, 0.5, 1]) down(t[0] + s * t[2], t);
    for (const name of ["left sleeve", "right sleeve"]) {
      const r = rect(name);
      down(r[0] + 0.002, r);
      down(r[0] + r[2] - 0.002, r);
    }
  }
  if (sheet === "bottom") for (const name of ["left leg", "right leg"]) {
    const r = rect(name);
    for (const s of [0.004, 0.5, 0.996]) down(r[0] + s * r[2], r);
  }

  return out;
}

/** Sums of a tile's values over every rectangle from its corner, a texel more each way, for box filters that wrap. */
function summed(t: Tile, value: Float32Array): Float64Array {
  const n = t.side, out = new Float64Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[(y + 1) * (n + 1) + x + 1] = value[y * n + x]! + out[y * (n + 1) + x + 1]! + out[(y + 1) * (n + 1) + x]! - out[y * (n + 1) + x]!;
  return out;
}

/** The mean of a tile's value over the box from x0, y0 of `k` texels a side, the tile repeating. */
function boxMean(t: Tile, sat: Float64Array, x0: number, y0: number, k: number): number {
  const n = t.side;
  const at = (x: number, y: number): number => {
    // The sum over [0, x) x [0, y) of the repeating tile, for any x, y.
    const qx = Math.floor(x / n), qy = Math.floor(y / n);
    const rx = x - qx * n, ry = y - qy * n;
    const ix = Math.floor(rx), iy = Math.floor(ry);
    const s = (a: number, b: number): number => sat[b * (n + 1) + a]!;
    const whole = s(n, n);
    const col = (a: number): number => s(a, n), row = (b: number): number => s(n, b);
    const part = s(ix, iy) + (rx - ix) * (s(ix + 1, iy) - s(ix, iy)) + (ry - iy) * (s(ix, iy + 1) - s(ix, iy));
    return qx * qy * whole + qx * row(iy) + qy * col(ix) + part;
  };
  const sum = at(x0 + k, y0 + k) - at(x0, y0 + k) - at(x0 + k, y0) + at(x0, y0);
  return sum / (k * k);
}

interface Maps {
  side: number;
  base: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
}

/** A sheet's base colour, normal and packed map: its weave filtered to its texels, with its seams and a gentle unevenness. */
export function paintSheet(sheet: SheetName): Maps {
  const side = SHEET_SIDE[sheet];
  const metres = SHEETS[sheet].metres;
  const tile = WEAVES[FABRIC[sheet]]();
  const soleTile = WEAVES.rubber();
  const texel = metres / side;
  const prep = (t: Tile) => {
    const n = t.side, px = t.metres / n;
    const nx = new Float32Array(n * n), ny = new Float32Array(n * n), nz = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const h = (a: number, b: number): number => t.height[((b + n) % n) * n + ((a + n) % n)]!;
      const dx = ((h(x + 1, y) - h(x - 1, y)) * RELIEF) / (2 * px), dv = ((h(x, y + 1) - h(x, y - 1)) * RELIEF) / (2 * px);
      const l = Math.hypot(dx, dv, 1);
      // Up the picture is against v.
      [nx[y * n + x], ny[y * n + x], nz[y * n + x]] = [-dx / l, dv / l, 1 / l];
    }
    return { t, k: texel / px, sat: [t.light, nx, ny, nz, t.rough, t.height].map((v) => summed(t, v)) };
  };
  const cloth = prep(tile), rubber = prep(soleTile);
  const seams = seamsOf(sheet);
  const soles = SHEETS[sheet].panels.filter((p) => p.name.endsWith("sole")).map((p) => p.rect);
  const base = new Uint8Array(side * side * 3), normal = new Uint8Array(side * side * 3), orm = new Uint8Array(side * side * 3);
  const light = new Float32Array(side * side);
  const values: number[][] = [];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const u = (x + 0.5) / side, v = (y + 0.5) / side;
    const onSole = soles.some((r) => u >= r[0] && u <= r[0] + r[2] && v >= r[1] && v <= r[1] + r[3]);
    const { t, k, sat } = onSole ? rubber : cloth;
    const tx = ((u * metres) / t.metres) * t.side - k / 2, ty = ((v * metres) / t.metres) * t.side - k / 2;
    const kk = Math.max(1, k);
    const [l, nx, ny, nz, r] = sat.slice(0, 5).map((s) => boxMean(t, s, tx, ty, kk));
    const len = Math.hypot(nx!, ny!, nz!);
    // What the texel's normal loses to its weave roughens it.
    let rough = Math.min(1, Math.sqrt(r! * r! + (1 - len) / Math.max(len, 1e-3)));
    let n = [nx! / len, ny! / len, nz! / len];
    let ao = 1;
    // Seams: a groove pressed along each, the normal leaning into it and a little shadow in it.
    for (const [u0, v0, u1, v1] of seams) {
      const du = u1 - u0, dv = v1 - v0;
      const s = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv)));
      const ex = (u - (u0 + s * du)) * metres, ey = (v - (v0 + s * dv)) * metres;
      const d = Math.hypot(ex, ey);
      if (d >= SEAM || d === 0) continue;
      const slope = (2 * GROOVE * (1 - d / SEAM)) / SEAM;
      n = [n[0]! - (slope * ex) / d, n[1]! + (slope * ey) / d, n[2]!];
      const nl = Math.hypot(n[0]!, n[1]!, n[2]!);
      n = n.map((c) => c / nl);
      ao = Math.min(ao, 0.72 + 0.28 * (d / SEAM));
      rough = Math.min(1, rough + 0.03);
    }
    // Large, soft unevenness of the dye and the cloth.
    const wob = 0.97 + 0.06 * smoothNoise(u * metres * 12, v * metres * 12, 3);
    light[y * side + x] = l! * wob * (0.85 + 0.15 * ao);
    values.push([n[0]!, n[1]!, n[2]!, ao, rough]);
  }
  let mean = 0;
  for (const l of light) mean += l / light.length;
  for (let i = 0; i < side * side; i++) {
    const g = fromLinear(Math.min(1, (MEAN * light[i]!) / mean));
    base.set([g, g, g], i * 3);
    const [nx, ny, nz, ao, rough] = values[i]!;
    normal.set([Math.round((nx! * 0.5 + 0.5) * 255), Math.round((ny! * 0.5 + 0.5) * 255), Math.round((nz! * 0.5 + 0.5) * 255)], i * 3);
    orm.set([Math.round(ao! * 255), Math.round(rough! * 255), 0], i * 3);
  }
  return { side, base, normal, orm };
}

/** Smooth value noise that repeats every `period` cells. */
function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const s = (t: number): number => t * t * (3 - 2 * t);
  const h = (a: number, b: number): number => hash(a, b, seed);
  const top = h(x0, y0) * (1 - s(fx)) + h(x0 + 1, y0) * s(fx), bottom = h(x0, y0 + 1) * (1 - s(fx)) + h(x0 + 1, y0 + 1) * s(fx);
  return top * (1 - s(fy)) + bottom * s(fy) - 0.5;
}

/** The region masks of a cut on a body, from its triangles on the sheet: each texel the region most of it is. */
export function paintMasks(uvs: ArrayLike<number>, indices: ArrayLike<number>, regions: ArrayLike<number>, side = MASK_SIDE): { mask: Uint8Array; mask2: Uint8Array } {
  // Main where nothing is laid, so filtering at a panel's edge does not bleed undyed cloth.
  const region = new Uint8Array(side * side);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const c = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const p = c.map((v) => [uvs[v * 2]! * side - 0.5, uvs[v * 2 + 1]! * side - 0.5]);
    const x0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0]!)))), x1 = Math.min(side - 1, Math.ceil(Math.max(...p.map((q) => q[0]!))));
    const y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1]!)))), y1 = Math.min(side - 1, Math.ceil(Math.max(...p.map((q) => q[1]!))));
    const [a, b, d] = p as [number[], number[], number[]];
    const area = (b[0]! - a[0]!) * (d[1]! - a[1]!) - (b[1]! - a[1]!) * (d[0]! - a[0]!);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w1 = ((x - a[0]!) * (d[1]! - a[1]!) - (y - a[1]!) * (d[0]! - a[0]!)) / area;
      const w2 = ((b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!)) / area;
      const w0 = 1 - w1 - w2;
      // A texel half outside still takes the triangle, so a thin band is not lost.
      if (w0 < -0.25 || w1 < -0.25 || w2 < -0.25) continue;
      const w = [0, 1, 2].map((k) => w0 * regions[c[0]! * 3 + k]! + w1 * regions[c[1]! * 3 + k]! + w2 * regions[c[2]! * 3 + k]!);
      const r = w.indexOf(Math.max(...w));
      if (r > region[y * side + x]!) region[y * side + x] = r;
    }
  }
  // Main, accent and trim are regions 1, 4 and 5: green of the first mask, green and blue of the second.
  const mask = new Uint8Array(side * side * 3), mask2 = new Uint8Array(side * side * 3);
  for (let i = 0; i < side * side; i++) {
    const r = region[i]!;
    if (r === 0) mask[i * 3 + 1] = 255;
    else mask2[i * 3 + (r === 1 ? 1 : 2)] = 255;
  }
  return { mask, mask2 };
}

const rgb = (side: number, data: Uint8Array): Uint8Array => encodePng({ width: side, height: side, channels: 3, depth: 8, data });

if (import.meta.main) {
  mkdirSync(MAPS, { recursive: true });
  const t0 = performance.now();
  for (const sheet of Object.keys(SHEETS) as SheetName[]) {
    if (!Object.values(CUTS).some((c) => c.sheet === sheet)) continue;
    const m = paintSheet(sheet);
    writeFileSync(join(MAPS, `${sheet}-base.png`), rgb(m.side, m.base));
    writeFileSync(join(MAPS, `${sheet}-normal.png`), rgb(m.side, m.normal));
    writeFileSync(join(MAPS, `${sheet}-orm.png`), rgb(m.side, m.orm));
    console.log(`${sheet}: ${m.side} px, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  const pack = parsePack(new Uint8Array(readFileSync(PACK)));
  const meshes = unpackMeshes(pack);
  for (const [sex, made] of madeCuts(meshes, pack.header.rigs)) for (const [cut, m] of made) {
    const { mask, mask2 } = paintMasks(m.body.uvs, m.body.indices, m.regions);
    writeFileSync(join(MAPS, `${cut}-${sex}-mask.png`), rgb(MASK_SIDE, mask));
    writeFileSync(join(MAPS, `${cut}-${sex}-mask2.png`), rgb(MASK_SIDE, mask2));
    console.log(`${cut} ${sex}: masks`);
  }
  console.log(`painted in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
