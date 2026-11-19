// Builds the small UI sheet independently of world materials. Source art and fonts never ship at their source size.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { GLASS_SIZE, GLASS_X, GLASS_Y, SKIN_WIDTH, skinPixels } from "../../client/core/ui/skin.ts";
import { readPng } from "../pack/png-read.ts";
import { partHash } from "../pack/manifest.ts";
import { encodePng } from "../snap/png.ts";
import { TOUCH_SHEET, TOUCH_SHIPPED } from "./touch-art.ts";
import { VITALS_SOURCE, paintVitals } from "./vitals-art.ts";

export function uiSheet(): ReturnType<typeof skinPixels> {
  const base = skinPixels();
  const glass = resolve(import.meta.dir, "../../assets/source/ui/glass-source.png");
  if (!existsSync(glass) && !existsSync(VITALS_SOURCE)) return base;
  const image = { ...base, data: base.data.slice() };
  // The vitals' generated glyphs, over the shapes drawn by rule.
  if (existsSync(VITALS_SOURCE)) paintVitals(image.data, readPng(VITALS_SOURCE));
  if (!existsSync(glass)) return image;
  const source = readPng(glass);
  // Sample only the clean central surface. Average in premultiplied alpha to keep its transparent edge colours out.
  for (let y = 1; y < GLASS_SIZE - 1; y++) for (let x = 1; x < GLASS_SIZE - 1; x++) {
    if (x + y <= 5 || (63-x)+(63-y) <= 5) continue;
    const at = ((GLASS_Y + y) * SKIN_WIDTH + GLASS_X + x) * 4;
    let r = 0, g = 0, b = 0, a = 0, count = 0;
    const x0 = Math.floor(source.width * (.25 + x / GLASS_SIZE * .5)), x1 = Math.floor(source.width * (.25 + (x + 1) / GLASS_SIZE * .5));
    const y0 = Math.floor(source.height * (.25 + y / GLASS_SIZE * .5)), y1 = Math.floor(source.height * (.25 + (y + 1) / GLASS_SIZE * .5));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const p = (py * source.width + px) * source.channels, alpha = source.channels === 4 ? source.data[p + 3]! / 255 : 1;
      r += source.data[p]! * alpha; g += source.data[p + 1]! * alpha; b += source.data[p + 2]! * alpha; a += alpha; count++;
    }
    if (a > 0) {
      image.data[at] = 8 + r / a * .22; image.data[at + 1] = 22 + g / a * .22; image.data[at + 2] = 36 + b / a * .22;
      image.data[at + 3] = 105 + a / count * 85;
    }
  }
  return image;
}

/** `touch` is the touch controls' painted sheet, "" where it is not installed: a page fetches it only once it is touched. */
export function buildUiAssets(dist: string): { atlas: string; touch: string; font: string; bytes: number; decodedBytes: number } {
  mkdirSync(join(dist, "assets"), { recursive: true });
  const sheet = uiSheet(), png = encodePng(sheet.width, sheet.height, sheet.data);
  const atlasName = `assets/hud.${partHash(png)}.png`;
  writeFileSync(join(dist, atlasName), png);
  // The touch sheet as tools/ui/touch-art.ts left it: the smaller copy where it made one.
  let touch = "";
  const shipped = [TOUCH_SHIPPED, TOUCH_SHEET].find((file) => existsSync(file));
  if (shipped) {
    const sheet = readFileSync(shipped);
    touch = `assets/touch.${partHash(sheet)}.${shipped.endsWith(".webp") ? "webp" : "png"}`;
    writeFileSync(join(dist, touch), sheet);
  }
  const fontSource = resolve(import.meta.dir, "../../assets/raw/fonts/barlow");
  const fontFile = join(fontSource, "BarlowSemiCondensed-Medium.ttf");
  if (!existsSync(fontFile)) return { atlas: atlasName, touch, font: "", bytes: png.length, decodedBytes: sheet.data.byteLength };
  const font = readFileSync(fontFile), fontName = `assets/hud-font.${partHash(font)}.ttf`;
  writeFileSync(join(dist, fontName), font);
  const compressed = brotliCompressSync(font);
  writeFileSync(join(dist, `${fontName}.br`), compressed);
  copyFileSync(join(fontSource, "OFL.txt"), join(dist, "assets/hud-font-license.txt"));
  return { atlas: atlasName, touch, font: fontName, bytes: png.length + compressed.length, decodedBytes: sheet.data.byteLength };
}
