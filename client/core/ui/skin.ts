// One shared sheet holds glass and status silhouettes. Values crop the sheet; they never make new pictures.

import { K_IMAGE, type UiFrame, type UiImage, type UiNode } from "./nodes.ts";
import { S_LABEL } from "./style.ts";
import { devicePixels } from "./device-art.ts";
export { PAD_X, PAD_Y, PAD_WIDTH, PAD_HEIGHT, RING_X, RING_Y, STICK_Y } from "./device-art.ts";

export const IMAGE_SKIN = 32;
export const SKIN_WIDTH = 512;
export const SKIN_HEIGHT = 448;
export const ICON_SIZE = 64;
export const GLASS_X = 0;
export const GLASS_Y = 256;
export const GLASS_SIZE = 64;
export const GLASS_INSET = 8;
export const VITAL_KINDS = 7;
export const ICE = 0xa6e3f4;
export const WARNING = 0xf2a477;

declare const __HUD_ATLAS_URL__: string;
/** Bundled builds name a hashed sheet. Headless consumers use the same deterministic fallback pixels. */
export const SKIN_URL = typeof __HUD_ATLAS_URL__ === "string" ? __HUD_ATLAS_URL__ : "";

const CROSS = [0.36,0.12, 0.64,0.12, 0.64,0.36, 0.88,0.36, 0.88,0.64, 0.64,0.64, 0.64,0.88, 0.36,0.88, 0.36,0.64, 0.12,0.64, 0.12,0.36, 0.36,0.36];
const BOLT = [0.50,0.09, 0.78,0.09, 0.59,0.40, 0.81,0.40, 0.29,0.93, 0.42,0.58, 0.20,0.58];
const HOURGLASS = [0.24,0.14, 0.76,0.14, 0.73,0.34, 0.57,0.5, 0.73,0.66, 0.76,0.86, 0.24,0.86, 0.27,0.66, 0.43,0.5, 0.27,0.34];
const WEIGHT = [0.28,0.33, 0.72,0.33, 0.83,0.84, 0.17,0.84];

function polygon(x: number, y: number, p: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[i]!, ay = p[i + 1]!, bx = p[j]!, by = p[j + 1]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
}

/** Stable source geometry, shared by exported art and fallback rendering. */
export function vitalShape(kind: number, x: number, y: number): boolean {
  if (kind === 0) return polygon(x, y, CROSS);
  if (kind === 1) return polygon(x, y, BOLT);
  if (kind === 2) return ellipse(x, y, .60, .37, .25, .25) || polygon(x, y, [.48,.48,.60,.60,.32,.84,.23,.75]) || ellipse(x,y,.22,.81,.09,.07) || ellipse(x,y,.28,.88,.07,.07);
  if (kind === 3) return y > .09 && y < .90 && Math.abs(x - .5) < (y < .60 ? (y - .09) * .58 : Math.sqrt(Math.max(0, .09 - (y - .60) ** 2)));
  if (kind === 4) return ellipse(x,y,.29,.61,.18,.27) || ellipse(x,y,.71,.61,.18,.27) || (Math.abs(x-.5) < .04 && y>.12 && y<.56) || polygon(x,y,[.5,.4,.72,.61,.67,.67,.5,.52,.33,.67,.28,.61]);
  if (kind === 5) return polygon(x, y, HOURGLASS);
  return polygon(x,y,WEIGHT) || (ellipse(x,y,.5,.30,.14,.17) && !ellipse(x,y,.5,.30,.07,.09));
}

let fallback: UiImage | null = null;
/** One bounded allocation per process, independent of how often values change. */
export function skinPixels(): UiImage {
  if (fallback) return fallback;
  const data = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  const put = (x: number, y: number, ink: number, a: number): void => {
    const at = (y * SKIN_WIDTH + x) * 4;
    data[at] = ink >> 16; data[at + 1] = (ink >> 8) & 255; data[at + 2] = ink & 255; data[at + 3] = a;
  };
  for (let kind = 0; kind < VITAL_KINDS; kind++) for (let py = 0; py < ICON_SIZE; py++) for (let px = 0; px < ICON_SIZE; px++) {
    let coverage = 0, edge = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const x = (px + (sx + .5) / 2) / ICON_SIZE, y = (py + (sy + .5) / 2) / ICON_SIZE;
      if (!vitalShape(kind,x,y)) continue;
      coverage++;
      const d = 1.8 / ICON_SIZE;
      if (!vitalShape(kind,x-d,y) || !vitalShape(kind,x+d,y) || !vitalShape(kind,x,y-d) || !vitalShape(kind,x,y+d)) edge++;
    }
    const x = kind * ICON_SIZE;
    put(x + px, py, 0x142e40, coverage * 210 / 4);
    put(x + px, py + 64, ICE, coverage * 220 / 4);
    put(x + px, py + 128, WARNING, coverage * 240 / 4);
    put(x + px, py + 192, 0xc8edf7, edge * 245 / 4);
  }
  for (let y = 0; y < GLASS_SIZE; y++) for (let x = 0; x < GLASS_SIZE; x++) {
    if (x + y < 5 || (63 - x) + (63 - y) < 5) continue;
    const edge = x === 0 || y === 0 || x === 63 || y === 63 || x + y === 5 || (63-x)+(63-y) === 5;
    put(GLASS_X + x, GLASS_Y + y, edge ? 0x86b8ce : 0x102c42, edge ? (y < 32 ? 170 : 80) : 154 - y / 2);
  }
  devicePixels(data,SKIN_WIDTH);
  fallback = { width: SKIN_WIDTH, height: SKIN_HEIGHT, data, version: 1 };
  return fallback;
}

/** A page shows the sheet's file, which it preloads. Headless consumers, and a page that cannot decode the file, draw the stand-in. */
export function installSkin(f: UiFrame): UiImage {
  return f.images[IMAGE_SKIN] ??= SKIN_URL ? { width: SKIN_WIDTH, height: SKIN_HEIGHT, data: new Uint8ClampedArray(0), version: 0, url: SKIN_URL } : { ...skinPixels() };
}

export function skinPart(f: UiFrame, key: number, x: number, y: number, w: number, h: number, sx: number, sy: number, sw: number, sh: number): UiNode {
  installSkin(f);
  const n = f.add(key, K_IMAGE, x, y, w, h, S_LABEL);
  n.image = IMAGE_SKIN;
  n.sx = sx; n.sy = sy; n.sw = sw; n.sh = sh;
  return n;
}

/** Nine fixed-corner slices preserve hairline edges at every panel size. Keys live outside interactive node ranges. */
export function glass(f: UiFrame, key: number, x: number, y: number, w: number, h: number, alpha = 1): void {
  const d = Math.min(5, w / 3, h / 3);
  const sizesX = [d, w - d * 2, d], sizesY = [d, h - d * 2, d];
  const source = [0, GLASS_INSET, GLASS_SIZE - GLASS_INSET];
  const size = [GLASS_INSET, GLASS_SIZE - GLASS_INSET * 2, GLASS_INSET];
  let dy = y;
  for (let row = 0; row < 3; row++) {
    let dx = x;
    for (let col = 0; col < 3; col++) {
      skinPart(f, 2000000 + key * 16 + row * 3 + col, dx, dy, sizesX[col]!, sizesY[row]!, GLASS_X + source[col]!, GLASS_Y + source[row]!, size[col]!, size[row]!).alpha = alpha;
      dx += sizesX[col]!;
    }
    dy += sizesY[row]!;
  }
}
