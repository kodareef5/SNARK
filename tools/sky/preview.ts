// The eight key panoramas as the lit tiers draw them, the dome from the table and the land lit by its light, with
// three swatches at the bottom left: a grey 128 card under the table's light, upright toward the light, upright away
// from it, and lying face up. With --sheet, the eight halved and laid out two across in one picture; with --pairs,
// each key halved beside the table's; with --views, the player's views of named keys (100 degrees across, 10 up,
// toward the light and away), the key's beside the table's. With --strips, the dome toward the sun at every quarter
// hour from an hour before sunset to an hour after, and from an hour before sunrise to an hour after. With --points,
// the colours at every key's points as the game shows them, for the art director's measure.
// Run: bun tools/sky/preview.ts [--out DIR] [--sheet FILE] [--pairs FILE] [--views FILE --keys a,b] [--strips FILE] [--points FILE]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FRAME as F, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { domeLight, shownSky, skyFrame, sunDirection, sunHeight, theSky, type Sky } from "../../client/core/render/sky.ts";
import { readPng, type Image } from "../pack/png-read.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import { encodePng } from "../snap/png.ts";
import { HEIGHT, KEYS, MIDDLE, WIDTH, direction, headingOf, render } from "./base.ts";
import { basePoints, cardColours, tableAt } from "./fit.ts";
import { KEYS_DIR } from "./keys.ts";

/**
 * A view `fov` degrees across, `pitch` up, toward `heading`, of a picture's colour by direction, into `out` at (ox, oy)
 * of a picture `stride` wide.
 */
function viewOf(colour: (dir: number[], out: number[]) => void, heading: number, pitch: number, fov: number, w: number, h: number, out: Uint8ClampedArray, ox: number, oy: number, stride: number): void {
  const f = direction(heading, pitch), r = direction(heading + 90, 0);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const t = Math.tan((fov / 2) * (Math.PI / 180));
  const c = [0, 0, 0];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = ((2 * (i + 0.5)) / w - 1) * t, y = (1 - (2 * (j + 0.5)) / h) * t * (h / w);
      const d = [0, 1, 2].map((k) => f[k]! + x * r[k]! + y * u[k]!);
      const l = Math.hypot(d[0]!, d[1]!, d[2]!);
      colour(d.map((v) => v / l), c);
      out.set([c[0]!, c[1]!, c[2]!, 255], ((oy + j) * stride + ox + i) * 4);
    }
  }
}

/** A panorama's colour in a direction, between its pixels. */
function panorama(img: Image | { width: number; height: number; channels: number; data: Uint8ClampedArray }): (dir: number[], out: number[]) => void {
  return (dir, out) => {
    const { heading, elevation } = headingOf(dir[0]!, dir[1]!, dir[2]!);
    const px = (0.5 + (((((heading - MIDDLE) % 360) + 540) % 360) - 180) / 360) * img.width - 0.5;
    const py = Math.max(0, Math.min(img.height - 1.001, ((90 - elevation) / 180) * img.height - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    for (let k = 0; k < 3; k++) {
      const g = (x: number, y: number): number => img.data[(y * img.width + (((x % img.width) + img.width) % img.width)) * img.channels + k]!;
      out[k] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    }
  };
}

/** The dome alone at an hour as the game shows it, the ground under the horizon plain. */
function dome(sky: Sky, hour: number): (dir: number[], out: number[]) => void {
  const sun = [0, 0, 0];
  sunDirection(hour, sun);
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, frame);
  const k = frame[F.skyScale]! * frame[F.exposure]!;
  const c = [0, 0, 0];
  return (dir, out) => {
    if (dir[1]! >= 0) {
      domeLight(sky.table, sun, dir, c);
      shownSky(c.map((v) => v * k), out);
    } else out.splice(0, 3, 34, 36, 40);
  };
}

/** Writes `text` at (x, y) of a picture `width` wide, white on a dark band. */
function label(pixels: Uint8ClampedArray, width: number, text: string, x: number, y: number): void {
  for (let py = y - 2; py < y + GLYPH_HEIGHT + 2; py++) for (let px = x - 2; px < x + text.length * (GLYPH_WIDTH + 1) + 1; px++) pixels.set([20, 22, 26, 255], (py * width + px) * 4);
  [...text].forEach((ch, i) => {
    for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) pixels.set([240, 240, 240, 255], ((y + row) * width + x + i * (GLYPH_WIDTH + 1) + col) * 4);
  });
}

/** A picture halved. */
function halve(pixels: Uint8ClampedArray, w: number, h: number, out: Uint8ClampedArray, ox: number, oy: number, stride: number): void {
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) s += pixels[((y * 2 + a) * w + x * 2 + b) * 4 + c]!;
    out[((oy + y) * stride + ox + x) * 4 + c] = s / 4;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = resolve(arg("out") ?? "artifacts/sky");
  mkdirSync(out, { recursive: true });
  const sky = theSky();
  const W = WIDTH / 2, H = HEIGHT / 2;
  const sheet = new Uint8ClampedArray(W * 2 * H * 4 * 4);
  const pairs = new Uint8ClampedArray(W * 2 * H * 8 * 4);
  const drawn = new Map<string, Uint8ClampedArray>();
  const strips = arg("strips");
  for (const [n, key] of strips && !arg("sheet") && !arg("pairs") && !arg("views") ? [] : KEYS.entries()) {
    const r = render(key, true);
    const cards = cardColours(sky, key.hour, key.moon);
    [cards.lit, cards.shaded, cards.up].forEach((c, i) => {
      for (let y = HEIGHT - 70; y < HEIGHT - 10; y++) for (let x = 10 + i * 70; x < 70 + i * 70; x++) r.pixels.set([c[0]!, c[1]!, c[2]!, 255], (y * WIDTH + x) * 4);
    });
    writeFileSync(join(out, `${key.name}.png`), encodePng(WIDTH, HEIGHT, r.pixels));
    drawn.set(key.name, r.pixels);
    halve(r.pixels, WIDTH, HEIGHT, sheet, (n % 2) * W, Math.floor(n / 2) * H, W * 2);
    const own = readPng(join(KEYS_DIR, `${key.name}.png`));
    const keyPixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < WIDTH * HEIGHT; i++) keyPixels.set([own.data[i * own.channels]!, own.data[i * own.channels + 1]!, own.data[i * own.channels + 2]!, 255], i * 4);
    halve(keyPixels, WIDTH, HEIGHT, pairs, 0, n * H, W * 2);
    halve(r.pixels, WIDTH, HEIGHT, pairs, W, n * H, W * 2);
    console.log(`${key.name.padEnd(10)} sun ${sunHeight(key.hour).toFixed(1)}  cards lit ${cards.lit.map(Math.round)} shaded ${cards.shaded.map(Math.round)} up ${cards.up.map(Math.round)}`);
  }
  if (arg("sheet")) writeFileSync(resolve(arg("sheet")!), encodePng(W * 2, H * 4, sheet));
  if (arg("pairs")) writeFileSync(resolve(arg("pairs")!), encodePng(W * 2, H * 8, pairs));
  const views = arg("views");
  if (views) {
    const cams = JSON.parse(readFileSync(join(KEYS_DIR, "views/cameras.json"), "utf8"));
    const names = (arg("keys") ?? "golden,sunset,dusk,dawn").split(",");
    const [w, h] = [640, 360];
    const px = new Uint8ClampedArray(w * 2 * h * names.length * 2 * 4);
    names.forEach((name, n) => {
      const own = panorama(readPng(join(KEYS_DIR, `${name}.png`)));
      const ours = panorama({ width: WIDTH, height: HEIGHT, channels: 4, data: drawn.get(name)! });
      (["toward", "away"] as const).forEach((side, s) => {
        const c = cams[name][side];
        viewOf(own, c.heading, c.elevation, c.horizontalFOV, w, h, px, 0, (n * 2 + s) * h, w * 2);
        viewOf(ours, c.heading, c.elevation, c.horizontalFOV, w, h, px, w, (n * 2 + s) * h, w * 2);
        label(px, w * 2, `${name} ${side}: key`, 8, (n * 2 + s) * h + 8);
        label(px, w * 2, `${name} ${side}: table`, w + 8, (n * 2 + s) * h + 8);
      });
    });
    writeFileSync(resolve(views), encodePng(w * 2, h * names.length * 2, px));
  }
  if (strips) {
    const [w, h, rows] = [320, 180, 9];
    const px = new Uint8ClampedArray(w * 2 * h * rows * 4);
    [18, 6].forEach((middle, col) => {
      for (let q = 0; q < rows; q++) {
        const hour = middle - 1 + q / 4;
        const sun = [0, 0, 0];
        sunDirection(hour, sun);
        viewOf(dome(sky, hour), headingOf(sun[0]!, sun[1]!, sun[2]!).heading, 10, 100, w, h, px, col * w, q * h, w * 2);
        const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
        label(px, w * 2, `${hh}:${String(mm).padStart(2, "0")} sun ${sunHeight(hour).toFixed(1)}`, col * w + 6, q * h + 6);
      }
    });
    writeFileSync(resolve(strips), encodePng(w * 2, h * rows, px));
  }
  const pointsFile = arg("points");
  if (pointsFile) {
    const keys: Record<string, unknown> = {};
    for (const key of basePoints()) {
      const frame = new Float32Array(FRAME_FLOATS);
      skyFrame(key.hour, sky, frame);
      const moon = key.lightBy === "moon";
      const dome = tableAt(sky, key);
      const cards = cardColours(sky, key.hour, moon);
      const round = (c: readonly number[]): number[] => c.map((v) => Math.round(v));
      keys[key.name] = {
        hour: key.hour,
        lightHeight: moon ? -sunHeight(key.hour) : sunHeight(key.hour),
        exposure: +frame[F.exposure]!.toFixed(4),
        ...Object.fromEntries(Object.entries(dome).map(([n, c]) => [n, round(c)])),
        lit: round(cards.lit),
        shaded: round(cards.shaded),
        up: round(cards.up),
      };
    }
    writeFileSync(resolve(pointsFile), JSON.stringify({ about: "The sky table at each key's points as the game shows it, through the tone curve, in sRGB, and the grey cards under its light; from tools/sky/preview.ts.", keys }, null, 2) + "\n");
  }
}
