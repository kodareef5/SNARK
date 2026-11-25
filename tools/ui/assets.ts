// Builds the small UI sheet independently of world materials. Source art and fonts never ship at their source size.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
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
export function buildUiAssets(dist: string): { atlas: string; touch: string; faces: HudFace[]; bytes: number; decodedBytes: number } {
  mkdirSync(join(dist, "assets"), { recursive: true });
  const sheet = uiSheet(), png = encodePng(sheet.width, sheet.height, sheet.data, 9);
  // Keep transparent RGB as well as coverage. The world and the wiki sample this same sheet.
  const webp = spawnSync("cwebp", ["-quiet", "-exact", "-lossless", "-m", "6", "-o", "-", "--", "-"], { input: png });
  const useWebp = webp.status === 0 && webp.stdout.length > 0 && webp.stdout.length < png.length;
  const atlas = useWebp ? webp.stdout : png;
  const atlasName = `assets/hud.${partHash(atlas)}.${useWebp ? "webp" : "png"}`;
  writeFileSync(join(dist, atlasName), atlas);
  // The touch sheet as tools/ui/touch-art.ts left it: the smaller copy where it made one.
  let touch = "";
  const shipped = [TOUCH_SHIPPED, TOUCH_SHEET].find((file) => existsSync(file));
  if (shipped) {
    const sheet = readFileSync(shipped);
    touch = `assets/touch.${partHash(sheet)}.${shipped.endsWith(".webp") ? "webp" : "png"}`;
    writeFileSync(join(dist, touch), sheet);
  }
  const faces = hudFaces();
  for (const f of faces) writeFileSync(join(dist, f.url), f.bytes);
  copyFileSync(join(FONT_SOURCE, "OFL.txt"), join(dist, "assets/hud-font-license.txt"));
  return { atlas: atlasName, touch, faces, bytes: atlas.length + faces[0]!.bytes.length, decodedBytes: sheet.data.byteLength };
}

const FONT_SOURCE = resolve(import.meta.dir, "../../assets/raw/fonts/barlow");

/** A part of the HUD's face: its file's bytes, the address the game and the title both ask for it at, and its characters. */
export interface HudFace { bytes: Buffer; url: string; range: string }

/**
 * The face's WOFF2 parts that tools/ui/font-subset.py made, Latin first. Where the face itself is here and has changed
 * since, the parts are stale and the build stops.
 */
export function hudFaces(): HudFace[] {
  const list = JSON.parse(readFileSync(join(FONT_SOURCE, "faces.json"), "utf8")) as { face: string; sha256: string; faces: { file: string; range: string }[] };
  const face = join(FONT_SOURCE, list.face);
  if (existsSync(face) && new Bun.CryptoHasher("sha256").update(readFileSync(face)).digest("hex") !== list.sha256) {
    throw new Error(`${list.face} has changed since its parts were made: run tools/ui/font-subset.py (see its first lines)`);
  }
  return list.faces.map((f) => {
    const bytes = readFileSync(join(FONT_SOURCE, f.file));
    return { bytes, url: `assets/hud-font-${f.file.replace(/\.woff2$/, "")}.${partHash(bytes)}.woff2`, range: f.range };
  });
}

/** The @font-face rules of `family` over the face's parts, with the rule's other descriptors. */
export function fontFaces(family: string, faces: readonly HudFace[], descriptors: string): string {
  return faces.map((f) => `@font-face { font-family: ${family}; src: url("${f.url}") format("woff2"); unicode-range: ${f.range}; ${descriptors} }`).join("\n");
}
