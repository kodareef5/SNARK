// The eight key panoramas with the sky the table gives in place of today's flat one, the land drawn as low poly draws
// it, and three swatches at the bottom left: a grey 128 card under the table's light, upright toward the light,
// upright away from it, and lying face up. With --sheet, the eight halved and laid out two across in one picture.
// With --points, the colours at every key's points as the game shows them, for the art director's measure.
// Run: bun tools/sky/preview.ts [--out DIR] [--sheet FILE] [--points FILE]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FRAME as F, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { cardTakes, domeLight, shownSky, skyFrame, sunDirection, sunHeight, theSky, type Sky } from "../../client/core/render/sky.ts";
import { encodePng } from "../snap/png.ts";
import { HEIGHT, KEYS, WIDTH, render } from "./base.ts";
import { basePoints, tableAt } from "./fit.ts";

/**
 * What the base pictures' grey 128 cards show under the sky's light at an hour: upright toward the light's heading,
 * upright away from it, and face up. The light is the sun, or with `moon` the moon.
 */
export function cardColours(sky: Sky, hour: number, moon: boolean): { lit: number[]; shaded: number[]; up: number[] } {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, frame);
  const e = frame[F.exposure]!;
  const v = (at: number) => [frame[at]!, frame[at + 1]!, frame[at + 2]!];
  const light = v(moon ? F.moonColor : F.sunColor);
  const l = v(moon ? F.moon : F.sun);
  const above = v(F.skyAbove);
  const below = v(F.skyBelow);
  const across = Math.hypot(l[0]!, l[2]!);
  const face = (n: number[]) => {
    const takes = cardTakes(n, n, l);
    const out = [0, 0, 0];
    shownSky([0, 1, 2].map((k) => (light[k]! * takes.light + (below[k]! + (above[k]! - below[k]!) * (0.5 + 0.5 * n[1]!)) * takes.sky) * e), out);
    return out;
  };
  return { lit: face([l[0]! / across, 0, l[2]! / across]), shaded: face([-l[0]! / across, 0, -l[2]! / across]), up: face([0, 1, 0]) };
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
  const sheetFile = arg("sheet");
  const W = WIDTH / 2, H = HEIGHT / 2;
  const sheet = new Uint8ClampedArray(W * 2 * H * 4 * 4);
  const shown = [0, 0, 0];
  for (const [n, key] of KEYS.entries()) {
    const sun = [0, 0, 0];
    sunDirection(key.hour, sun);
    const frame = new Float32Array(FRAME_FLOATS);
    skyFrame(key.hour, sky, frame);
    const k = frame[F.skyScale]! * frame[F.exposure]!;
    const r = render(key, (dir, c) => {
      domeLight(sky.table, sun, dir, shown);
      shownSky([shown[0]! * k, shown[1]! * k, shown[2]! * k], c);
    });
    const cards = cardColours(sky, key.hour, key.moon);
    [cards.lit, cards.shaded, cards.up].forEach((c, i) => {
      for (let y = HEIGHT - 70; y < HEIGHT - 10; y++) for (let x = 10 + i * 70; x < 70 + i * 70; x++) r.pixels.set([c[0]!, c[1]!, c[2]!, 255], (y * WIDTH + x) * 4);
    });
    writeFileSync(join(out, `${key.name}.png`), encodePng(WIDTH, HEIGHT, r.pixels));
    const ox = (n % 2) * W, oy = Math.floor(n / 2) * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) s += r.pixels[((y * 2 + a) * WIDTH + x * 2 + b) * 4 + c]!;
      sheet[((oy + y) * W * 2 + ox + x) * 4 + c] = s / 4;
    }
    console.log(`${key.name.padEnd(10)} sun ${sunHeight(key.hour).toFixed(1)}  cards lit ${cards.lit.map(Math.round)} shaded ${cards.shaded.map(Math.round)} up ${cards.up.map(Math.round)}`);
  }
  if (sheetFile) writeFileSync(resolve(sheetFile), encodePng(W * 2, H * 4, sheet));
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
