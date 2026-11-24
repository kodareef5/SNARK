// A neutral studio floor and soft cast shadows for catalogue photographs.

import type { ModelView } from "../snap.ts";
import { PICK_SKY } from "../snap/raster.ts";

export type RGB = readonly [number, number, number];

export interface Stage {
  surround: RGB;
  pool: RGB;
  /** The key light's front, upward and leftward components in the camera's frame. */
  key: RGB;
}

export interface Photograph {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface Cutout extends Photograph {
  /** Coverage of the floor's projected shadow before compositing. */
  shadow?: Uint8Array;
}

export const paper: Stage = { surround: [136, 146, 143], pool: [220, 222, 214], key: [0.47, 0.88, 0.53] };
export const stone: Stage = { surround: [128, 123, 112], pool: [221, 212, 192], key: [0.58, 0.78, 0.59] };
export const daylight: Stage = { surround: [100, 114, 127], pool: [196, 211, 219], key: [0.62, 0.86, 0.5] };
export const graphite: Stage = { surround: [65, 72, 78], pool: [155, 166, 172], key: [0.62, 0.76, 0.58] };
export const olive: Stage = { surround: [108, 118, 103], pool: [198, 209, 181], key: [0.48, 0.9, 0.52] };

/** A broad softbox across the back of a seamless stage. */
export function stage(width: number, height: number, tone: Stage, reverse = false): Photograph {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = (reverse ? width - 1 - x : x) / width;
      const dx = (u - 0.38) * 1.24;
      const dy = (v - 0.38) * 0.87;
      const light = Math.exp(-3.1 * (dx * dx + dy * dy));
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[p + c] = Math.round(tone.surround[c]! + (tone.pool[c]! - tone.surround[c]!) * light);
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width, height };
}

function blur(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const across = new Float32Array(mask.length);
  const out = new Uint8Array(mask.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < width + radius; x++) {
      if (x < width) sum += mask[row + x]!;
      if (x >= span) sum -= mask[row + x - span]!;
      if (x >= radius) across[row + x - radius] = sum / span;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height + radius; y++) {
      if (y < height) sum += across[y * width + x]!;
      if (y >= span) sum -= across[(y - span) * width + x]!;
      if (y >= radius) out[(y - radius) * width + x] = Math.round(sum / span);
    }
  }
  return out;
}

/** Project each visible point onto the studio floor opposite the key light. */
export function cast(view: ModelView, width: number, height: number, floor: number, around: number, key: RGB): Uint8Array {
  const { cam, raster } = view;
  const own = new Uint8Array(width * height);
  const a = around * Math.PI / 180;
  const [front, up, left] = key;
  const lightX = (Math.sin(a) * front - Math.cos(a) * left) / up;
  const lightZ = (Math.cos(a) * front + Math.sin(a) * left) / up;
  const m = cam.viewProj;
  const depthA = (cam.far + cam.near) / (cam.far - cam.near);
  const stepX = raster.width / width, stepY = raster.height / height;
  const tangent = Math.tan(cam.fovY / 2);
  const xs = Float64Array.from({ length: width }, (_, x) => ((2 * Math.floor((x + 0.5) * stepX) + 1) / raster.width - 1) * (tangent * cam.aspect) ** 2);
  const floorY = floor - cam.y;
  for (let y = 0; y < height; y++) {
    const py = Math.floor((y + 0.5) * stepY);
    const yy = (1 - (2 * py + 1) / raster.height) * tangent ** 2;
    for (let x = 0; x < width; x++) {
      const px = Math.floor((x + 0.5) * stepX);
      const i = py * raster.width + px;
      if (raster.pickKind[i] === PICK_SKY || !Number.isFinite(raster.depth[i])) continue;
      const depth = m[14]! / (raster.depth[i]! - depthA);
      if (!(depth > 0)) continue;
      const xx = xs[x]!;
      const lift = (m[7]! + m[4]! * xx + m[5]! * yy) * depth - floorY;
      if (lift < -0.01) continue;
      const rx = (m[3]! + m[0]! * xx + m[1]! * yy) * depth - lift * lightX;
      const rz = (m[11]! + m[8]! * xx + m[9]! * yy) * depth - lift * lightZ;
      const projected = m[3]! * rx + m[7]! * floorY + m[11]! * rz;
      if (projected <= 0.05) continue;
      const sx = Math.floor(width * (0.5 + 0.5 * (m[0]! * rx + m[4]! * floorY + m[8]! * rz) / projected));
      const sy = Math.floor(height * (0.5 - 0.5 * (m[1]! * rx + m[5]! * floorY + m[9]! * rz) / projected));
      if (sx < 1 || sy < 1 || sx >= width - 1 || sy >= height - 1) continue;
      const at = sy * width + sx;
      for (let dy = -1; dy <= 1; dy++) own.fill(255, at + dy * width - 1, at + dy * width + 2);
    }
  }
  const penumbra = Math.max(2, Math.floor(Math.min(width, height) * 0.012));
  const edge = blur(own, width, height, 3);
  const broad = blur(edge, width, height, penumbra * 2);
  return Uint8Array.from(edge, (v, k) => Math.round(v * 0.52 + broad[k]! * 0.48));
}

export type Placement = readonly [x: number, y: number, share: number, tilt: number];

/** Composite a photo and its projected shadow into a group stage, or a flat label's contact shadow. */
export function stamp(frame: Photograph, cut: Cutout, [u, v, share, tilt]: Placement): void {
  const { width, height, rgba } = frame;
  const size = Math.min(width, height) * share;
  const mx = u * width, my = v * height;
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  const scale = Math.max(cut.width, cut.height) / size;
  const span = tilt === 0 ? 0.51 : 0.72;
  const margin = size * span + 17;
  const left = Math.max(0, Math.floor(mx - margin)), right = Math.min(width, Math.ceil(mx + margin));
  const top = Math.max(0, Math.floor(my - margin)), bottom = Math.min(height, Math.ceil(my + margin));
  const at = (x: number, y: number): number => {
    const dx = x - mx, dy = y - my;
    const sx = Math.floor((dx * c + dy * s) * scale + cut.width / 2);
    const sy = Math.floor((dy * c - dx * s) * scale + cut.height / 2);
    return sx >= 0 && sy >= 0 && sx < cut.width && sy < cut.height ? sy * cut.width + sx : -1;
  };
  const alphaAt = (x: number, y: number): number => {
    const p = at(x, y);
    return p >= 0 ? cut.rgba[p * 4 + 3]! : 0;
  };
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const p = (y * width + x) * 4;
    const q = at(x, y);
    const shade = (cut.shadow ? cut.shadow[q] ?? 0 : (alphaAt(x - 2, y - 3) + alphaAt(x - 5, y - 7) + alphaAt(x - 8, y - 7)) / 3) / 255;
    const alpha = q >= 0 ? cut.rgba[q * 4 + 3]! / 255 : 0;
    for (let k = 0; k < 3; k++) {
      const base = rgba[p + k]! * (1 - shade * 0.37);
      rgba[p + k] = Math.round(base * (1 - alpha) + (q >= 0 ? cut.rgba[q * 4 + k]! * alpha : 0));
    }
  }
}

/** A plate keeps its original frame and all of the shadow under the model. */
export function finishPlate(cut: Cutout, tone: Stage, reverse = false): Photograph {
  const frame = stage(cut.width, cut.height, tone, reverse);
  const { rgba } = frame;
  for (let i = 0; i < cut.width * cut.height; i++) {
    const at = i * 4;
    const a = cut.rgba[at + 3]! / 255;
    const shadow = 1 - (cut.shadow?.[i] ?? 0) * (0.38 / 255);
    for (let k = 0; k < 3; k++) rgba[at + k] = Math.round(rgba[at + k]! * shadow * (1 - a) + cut.rgba[at + k]! * a);
  }
  return frame;
}
