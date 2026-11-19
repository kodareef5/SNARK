// The touch controls' sheet: glass buttons, the stick and a set of glyphs, one picture fetched only by a page that is
// touched. The build names the painted sheet (tools/ui/touch-art.ts cuts it from generated sources); without it, and
// in every headless consumer, the stand-in below is drawn and the buttons carry words instead of glyphs.

import type { UiImage } from "./nodes.ts";

export const IMAGE_TOUCH = 33;
/**
 * The sheet is cut for a phone's own pixels: the largest button's body is 76 units, which at a unit's least size and
 * three device pixels to one is 182, and a part's body here is 184.
 */
export const TOUCH_WIDTH = 1536;
export const TOUCH_HEIGHT = 912;
/** A round or square part's cell, a side; its body spans BODY of it and the rest is its glow. */
export const PART = 256;
export const BODY = 0.72;
/** Parts along the top row, by column: each lit one follows its own at rest. */
export const P_ROUND = 0, P_ROUND_LIT = 1, P_RING = 2, P_KNOB = 3, P_SQUARE = 4, P_SQUARE_LIT = 5;
/**
 * The pill at rest and lit, side by side under the parts. Its body is BODY of the cell's height and PILL_BODY wide,
 * centred, and an end's slice (PILL_CAP) holds the whole of its round end, so the middle between is straight.
 */
export const PILL_Y = 256, PILL_W = 576, PILL_H = 144, PILL_CAP = 144, PILL_BODY = 396;
/** Glyphs, twelve to a row, each within GLYPH of its cell. */
export const ICON_Y = 400, ICON = 128, ICON_COLUMNS = 12, GLYPH = 0.66;
export const I_ATTACK = 0, I_JUMP = 1, I_AIM = 2, I_CROUCH = 3, I_RELOAD = 4, I_MORE = 5, I_MENU = 6, I_BAG = 7, I_CHARACTER = 8, I_CHAT = 9, I_MIC = 10, I_USE = 11;
export const I_VIEW = 12, I_WHISTLE = 13, I_BUILD = 14, I_DRIVE = 15, I_UP = 16, I_DOWN = 17, I_LEFT = 18, I_RIGHT = 19, I_LIGHTS = 21, I_EXIT = 22, I_WINGS = 23;
export const I_ROTATE = 24, I_SNAP = 25, I_VARIANT = 26, I_PLACE = 27, I_CANCEL = 28, I_MAP = 29, I_MIC_OFF = 30, I_PRONE = 31;
export const I_BRAKE = 32, I_ANCHOR = 33, I_PROPELLER = 34, I_ROTOR = 35, I_FUEL = 36, I_REPAIR = 37, I_GEAR = 38, I_MELEE = 39, I_ORBIT = 40, I_SPRINT = 41, I_CREATURE = 42, I_SEND = 43;
export const I_PLUS = 44, I_MINUS = 45, I_ZOOM = 46, I_HOME = 47;
export const ICONS = 48;

declare const __TOUCH_ATLAS_URL__: string;
/** The painted sheet's address in a bundled build that has one; "" where the stand-in is drawn. */
export const TOUCH_URL = typeof __TOUCH_ATLAS_URL__ === "string" ? __TOUCH_ATLAS_URL__ : "";

let standIn: UiImage | null = null;
/** Plain rings and discs in the HUD's blues, made once: enough to play by, and to test with. */
export function touchPixels(): UiImage {
  if (standIn) return standIn;
  const data = new Uint8ClampedArray(TOUCH_WIDTH * TOUCH_HEIGHT * 4);
  const put = (x: number, y: number, edge: number, body: number, lit: boolean): void => {
    const a = Math.min(1, body * (lit ? 0.62 : 0.4) + edge * 0.9), p = (y * TOUCH_WIDTH + x) * 4;
    if (a <= 0) return;
    const mix = (edge * 0.9) / a;
    data[p] = (lit ? 40 : 14) + (166 - 14) * mix; data[p + 1] = (lit ? 150 : 44) + (227 - 44) * mix; data[p + 2] = (lit ? 200 : 72) + (244 - 72) * mix; data[p + 3] = a * 255;
  };
  const cover = (d: number): number => Math.max(0, Math.min(1, 0.5 - d));
  for (let part = 0; part <= P_SQUARE_LIT; part++) for (let y = 0; y < PART; y++) for (let x = 0; x < PART; x++) {
    const dx = x + 0.5 - PART / 2, dy = y + 0.5 - PART / 2, r = (PART * BODY) / 2;
    // A square's distance is a rounded box's; the rest are circles.
    const corner = r * 0.3, qx = Math.abs(dx) - r + corner, qy = Math.abs(dy) - r + corner;
    const d = part >= P_SQUARE ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner : Math.hypot(dx, dy) - r;
    const inside = cover(d), rim = inside - cover(d + 4);
    put(part * PART + x, y, rim, part === P_RING ? 0 : inside - rim, part === P_ROUND_LIT || part === P_SQUARE_LIT || part === P_KNOB);
  }
  for (let lit = 0; lit < 2; lit++) for (let y = 0; y < PILL_H; y++) for (let x = 0; x < PILL_W; x++) {
    const r = (PILL_H * BODY) / 2, half = PILL_BODY / 2 - r;
    const d = Math.hypot(Math.max(Math.abs(x + 0.5 - PILL_W / 2) - half, 0), y + 0.5 - PILL_H / 2) - r;
    const inside = cover(d), rim = inside - cover(d + 3);
    put(lit * PILL_W + x, PILL_Y + y, rim, inside - rim, lit === 1);
  }
  return (standIn = { width: TOUCH_WIDTH, height: TOUCH_HEIGHT, data, version: 1, smooth: true });
}
