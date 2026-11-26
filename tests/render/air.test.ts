// The air on the lit tiers (D265, D266): haze in closed form against a sum along the ray, the end of the view meeting
// the dome, the frame block the scene fills for the dome, clouds that take the hour's light, and a low layer whose
// tiles do not repeat.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { AIR, BREAK, HAZE_DENSITY, HAZE_HEIGHT, LOW, SHADE, SKY_FRAGMENT, SKY_MATERIAL, STAR_CELLS, STAR_SHARE, airFrame, brokenRead, cloudLights, cloudLit, dip, hazeAmount, hazed, skyHash, viewFade, type CloudLights } from "../../client/core/render/atmosphere.ts";
import { LIT_FRAGMENT } from "../../client/core/render/glsl.ts";
import { FRAME, FRAME_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { domeLight, hazeColor, hourOfSun, luminance, shownSky, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { shown, skyShown, srgbToLinear } from "../../client/core/render/surface.ts";
import { apart } from "../../tools/sky/fit.ts";
import { packedMips, readPicture } from "../../tools/pack/image.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { sceneSet, sceneWorld } from "../fixtures/sceneworld.ts";

const sky = theSky();

/** A frame block for an hour, with the air filled as the scene fills it, the camera `eye` metres over the sea. */
function frameAt(hour: number, eye = 2, plain = false): Float32Array {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, f);
  airFrame(f, sky, hour, 0, 0, 0, 4000, 2, plain);
  f[FRAME.eyeHeight] = eye;
  return f;
}

test("haze is its density summed along the ray in closed form, to within 0.1% of a 1,000-step sum, and is 2%, 10% and 36% at 200 m, 1 km and 4 km along the sea", () => {
  for (const eye of [0, 2, 40, 600]) {
    for (const dist of [10, 300, 4000]) {
      for (const dy of [-0.3, -0.01, 0, 1e-5, 0.002, 0.05, 0.5, 1]) {
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += HAZE_DENSITY * Math.exp(-(eye + ((i + 0.5) / 1000) * dist * dy) / HAZE_HEIGHT) * (dist / 1000);
        const depth = -Math.log(1 - hazeAmount(HAZE_DENSITY, HAZE_HEIGHT, eye, dist, dy));
        expect(Math.abs(depth / sum - 1)).toBeLessThan(0.001);
      }
    }
  }
  expect([200, 1000, 4000].map((d) => Math.round(hazeAmount(HAZE_DENSITY, HAZE_HEIGHT, 0, d, 0) * 100))).toEqual([2, 10, 36]);
  expect(hazeAmount(0, HAZE_HEIGHT, 0, 4000, 0)).toBe(0);
});

test("haze mixes light toward the table 3 degrees up in the ray's direction, and at the end of the view it is the dome there", () => {
  const f = frameAt(17);
  const sun = [0, 0, 0];
  trueSun(f, sun);
  const light = [0.3, 0.2, 0.1];
  const out = [0, 0, 0];
  const air = [0, 0, 0];
  // 300 m off, level: the formula's share of the haze's colour, and no end yet.
  const rel = [300 * Math.cos(1), -2, 300 * Math.sin(1)];
  hazed(out, light, rel, f, sky.table, sun);
  const dist = Math.hypot(...rel);
  const a = hazeAmount(HAZE_DENSITY, HAZE_HEIGHT, 2, dist, rel[1]! / dist);
  hazeColor(sky.table, sun, rel.map((v) => v / dist), f[FRAME.skyScale]!, air);
  for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(light[k]! + (air[k]! - light[k]!) * a, 6);
  // At the end of the view, whatever was there is the dome in its direction, so land meets the sky behind it.
  const far = [4000, -30, 50];
  hazed(out, light, far, f, sky.table, sun);
  domeLight(sky.table, sun, far.map((v) => v / Math.hypot(...far)), air);
  for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(air[k]! * f[FRAME.skyScale]!, 6);
  expect([viewFade(3200, 4000, 3100), viewFade(3200, 4000, 3600), viewFade(0, 0, 9000)]).toEqual([0, 0.5, 0]);
  // A plain frame hazes nothing.
  hazed(out, light, far, frameAt(17, 2, true), sky.table, sun);
  expect(out).toEqual(light);
});

test("the dome's air in the frame block: haze, the view's end, what is drawn over the table, where the camera is over each layer, and the sun the low layer sees", () => {
  const f = frameAt(12);
  expect([f[FRAME.haze], f[FRAME.hazeHeight], f[FRAME.skyDetail], f[FRAME.ends], f[FRAME.ends + 1]]).toEqual([HAZE_DENSITY, HAZE_HEIGHT, 3, 3200, 4000].map(Math.fround));
  const plain = frameAt(12, 2, true);
  expect([plain[FRAME.haze], plain[FRAME.skyDetail], plain[FRAME.ends], plain[FRAME.ends + 1]]).toEqual([0, 0, 0, 0]);
  // Each layer's place in its tile wraps, and moves with the wind and the camera.
  const moved = new Float32Array(FRAME_FLOATS);
  airFrame(moved, sky, 12, 1000, -250, 60, 4000, 2, false);
  for (let k = 0; k < 4; k++) expect(moved[FRAME.clouds + k]! >= 0 && moved[FRAME.clouds + k]! < 1).toBe(true);
  expect(moved[FRAME.clouds]).toBeCloseTo((((-(1000 + LOW.wind[0] * 60) / LOW.span) % 1) + 1) % 1, 5);
  // At noon the low layer sees the sun as the ground does; as the sun sets it sees it lit a while longer.
  for (let k = 0; k < 3; k++) expect(f[FRAME.cloudSun + k]).toBeCloseTo(f[FRAME.sunColor + k]!, 2);
  const sunset = frameAt(hourOfSun(0, true));
  const lum = (frame: Float32Array, at: number): number => luminance([frame[at]!, frame[at + 1]!, frame[at + 2]!]);
  expect(lum(sunset, FRAME.cloudSun)).toBeGreaterThan(2 * lum(sunset, FRAME.sunColor));
  expect(dip(LOW)).toBeCloseTo(1.24, 2);
});

artTest("the clouds take the hour's light from the table: overhead, their mean at noon and at sunset is within 3 (OKLab x 100) of the art director's lit clouds", () => {
  const picture = packedMips(readPicture(new URL("../../assets/source/core/sky/clouds/low.png", import.meta.url).pathname))[6]!;
  const keys = JSON.parse(readFileSync(new URL("../../assets/source/core/sky/keys/points.json", import.meta.url), "utf8")).keys as Record<string, Record<string, number[]>>;
  /** A key's colour as light.py takes it back to light: sRGB undone, then the shoulder over 0.8. */
  const toLight = (c: readonly number[]): number[] => {
    const l = c.map((v) => srgbToLinear(v / 255));
    const p = Math.min(Math.max(...l), 0.995);
    return p > 0.8 ? l.map((v) => (v * (0.04 / (1 - p) - 0.2 + 0.8)) / p) : l;
  };
  /** The mean of the picture's clouds overhead, as shown, under `l` and in front of `behind`. */
  const mean = (l: CloudLights, behind: readonly number[]): number[] => {
    const [sum, out] = [[0, 0, 0], [0, 0, 0]];
    let weight = 0;
    for (let i = 0; i < picture.length; i += 4) {
      const cover = picture[i]! / 255;
      cloudLit(out, picture[i + 1]! / 255, LOW.depth, 0, 0, [0, 1, 0], behind, l);
      for (let k = 0; k < 3; k++) sum[k]! += out[k]! * cover;
      weight += cover;
    }
    const shown3 = [0, 0, 0];
    shownSky(sum.map((s) => s / weight), shown3);
    return shown3;
  };
  // light.py's lights, set by eye to sit with each key, and its fill from the key's sky; the sun at 66.7 and 1 degree up.
  for (const [hour, key, light, up] of [[12, "noon", [1, 0.95, 0.86], 66.7], [hourOfSun(0, true), "sunset", [1, 0.4, 0.16], 1]] as const) {
    const f = frameAt(hour);
    const sun = [0, 0, 0];
    trueSun(f, sun);
    const ours = cloudLights(f, sky.table, sun);
    const [high, top] = [toLight(keys[key]!.high!), toLight(keys[key]!.zenith!)];
    const flat = Math.hypot(ours.way[0]!, ours.way[2]!);
    const e = (up * Math.PI) / 180;
    const theirs: CloudLights = { light: [...light], fill: high.map((h, k) => (0.6 * (h + top[k]!)) / 2), way: [(ours.way[0]! / flat) * Math.cos(e), Math.sin(e), (ours.way[2]! / flat) * Math.cos(e)], relief: 0 };
    // Ours fills a cloud with the sky behind it as the light gets low; light.py with its fill alone.
    const behind = [0, 0, 0];
    domeLight(sky.table, sun, [0, 1, 0], behind);
    const shownBehind = behind.map((b) => b * f[FRAME.skyScale]! * f[FRAME.exposure]!);
    expect(apart(mean(ours, shownBehind), mean(theirs, theirs.fill.map((v) => v / SHADE.lift)))).toBeLessThan(3);
  }
});

artTest("the low layer's heaps lie differently in every tile and cover as much of the sky as the art director's picture", () => {
  const mips = packedMips(readPicture(new URL("../../assets/source/core/sky/clouds/low.png", import.meta.url).pathname));
  // The picture `side` pixels across, read between its pixels as a card does, wrapping.
  const read = (u: number, v: number, side: number): number[] => {
    const p = mips[Math.log2(side)]!;
    const x = (u - Math.floor(u)) * side - 0.5;
    const y = (v - Math.floor(v)) * side - 0.5;
    const [x0, y0] = [Math.floor(x), Math.floor(y)];
    const at = (i: number, j: number, c: number): number => p[((((j % side) + side) % side) * side + (((i % side) + side) % side)) * 4 + c]! / 255;
    return [0, 1].map((c) => (at(x0, y0, c) * (x0 + 1 - x) + at(x0 + 1, y0, c) * (x - x0)) * (y0 + 1 - y) + (at(x0, y0 + 1, c) * (x0 + 1 - x) + at(x0 + 1, y0 + 1, c) * (x - x0)) * (y - y0));
  };
  const n = 9000;
  const [plain, broken, plainNext, brokenNext] = [[], [], [], []] as number[][];
  for (let i = 0; i < n; i++) {
    // Spread over 3 by 3 tiles, golden-ratio steps.
    const [u, v] = [(i * 0.6180339887) % 3, (i * 0.7548776662) % 3];
    plain.push(read(u, v, 256)[0]!);
    plainNext.push(read(u + 1, v, 256)[0]!);
    broken.push(brokenRead(read, u, v, 256)[0]);
    brokenNext.push(brokenRead(read, u + 1, v, 256)[0]);
  }
  const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
  const correlation = (a: number[], b: number[]): number => {
    const [ma, mb] = [mean(a), mean(b)];
    let [ab, aa, bb] = [0, 0, 0];
    for (let i = 0; i < a.length; i++) [ab, aa, bb] = [ab + (a[i]! - ma) * (b[i]! - mb), aa + (a[i]! - ma) ** 2, bb + (b[i]! - mb) ** 2];
    return ab / Math.sqrt(aa * bb);
  };
  // A tile's neighbour is itself as the picture is; broken up, it is hardly like it.
  expect(correlation(plain, plainNext)).toBeCloseTo(1, 6);
  expect(correlation(broken, brokenNext)).toBeLessThan(0.45);
  expect(Math.abs(mean(broken) / mean(plain) - 1)).toBeLessThan(0.08);
  expect(BREAK.keep * 0.9).toBeLessThan(BREAK.wear);
});

test("the stars and the dither come of an even hash: a star in 1 cell in 40, with no more neighbours than chance, placed apart from whether it is there", () => {
  // Sums for a correlation: n, a, b, ab, aa, bb.
  const sums = (): number[] => [0, 0, 0, 0, 0, 0];
  const add = (s: number[], a: number, b: number): void => void [1, a, b, a * b, a * a, b * b].forEach((x, k) => (s[k]! += x));
  const correlation = ([n, a, b, ab, aa, bb]: number[]): number => (n! * ab! - a! * b!) / Math.sqrt((n! * aa! - a! * a!) * (n! * bb! - b! * b!));
  const side = STAR_CELLS;
  const cells = 6 * side * side;
  const bins = new Array<number>(16).fill(0);
  const placed = sums();
  let [stars, pairs, mean] = [0, 0, 0];
  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const h = skyHash(x, y, face);
        mean += h / cells;
        bins[Math.min(15, Math.floor(h * 16))]!++;
        if (h <= STAR_SHARE && ++stars && x + 1 < side && skyHash(x + 1, y, face) <= STAR_SHARE) pairs++;
        // Where a star sits in its cell is read 7 on in each whole number.
        add(placed, h, skyHash(x + 7, y + 7, face + 7));
      }
    }
  }
  expect(Math.abs(mean - 0.5)).toBeLessThan(0.003);
  for (const b of bins) expect(Math.abs(b / (cells / 16) - 1)).toBeLessThan(0.06);
  expect(Math.abs(stars / (cells * STAR_SHARE) - 1)).toBeLessThan(0.06);
  expect(pairs).toBeLessThan(2 * stars * STAR_SHARE);
  expect(Math.abs(correlation(placed))).toBeLessThan(0.02);
  // The dither over a 1080p frame: no lean and no grain from one pixel to the next.
  const [dither, beside] = [sums(), sums()];
  for (let y = 0; y < 1080; y++) {
    for (let x = 0; x < 1920; x++) {
      const h = skyHash(x, y, 3);
      add(dither, h, 0);
      if (x + 1 < 1920) add(beside, h, skyHash(x + 1, y, 3));
    }
  }
  expect(Math.abs(dither[1]! / dither[0]! - 0.5)).toBeLessThan(0.001);
  expect(Math.abs(correlation(beside))).toBeLessThan(0.01);
  expect(SKY_FRAGMENT.includes("uint h = v.x * 1664525u + v.y * 22695477u + v.z * 2654435761u;")).toBe(true);
});

test("LIT, SURFACE and the dome read the air; the dome's text is written from the same numbers", () => {
  const medium = tierOf("medium");
  for (const name of ["flat", "terrain", "seeThrough", "far", "sky"]) expect(PROGRAMS[name]!(medium, "bc").fragment.includes(AIR)).toBe(true);
  expect(PROGRAMS.surface!(medium, "astc").fragment.includes(AIR)).toBe(true);
  expect(LIT_FRAGMENT).toContain("vec3 localLight = room * skyLight(geometric) * roomOpen;");
  expect(LIT_FRAGMENT).toContain("localLight += tekFieldLight(");
  expect(LIT_FRAGMENT).toContain("shown(lit(albedo, orm * vec3(open, 1.0, 1.0), n, v, mirrored, sunShadow(vRel, geometric)) + localLight, vRel)");
  expect(PROGRAMS.seeThrough!(medium, "bc").fragment).toContain("through(albedo, orm, n, vFinish.w, shade) + localLight, vRel)");
  expect(SKY_FRAGMENT.includes(`* ${Math.cos(BREAK.turn)}`) || SKY_FRAGMENT.includes(String(Math.cos(BREAK.turn)))).toBe(true);
  for (const part of [SKY_FRAGMENT]) expect([part.split("{").length, part.split("(").length]).toEqual([part.split("}").length, part.split(")").length]);
});

test("the rasterizer's light is fogged under water only: above it, the air is the GPU's (D264)", () => {
  const p = new FramePacket();
  p.lit = true;
  skyFrame(12, sky, p.frame);
  [p.fogStart, p.fogEnd] = [10, 20];
  p.sky.set([0, 0, 1]);
  skyShown(p);
  const out = [0, 0, 0];
  p.frame[FRAME.eyeHeight] = 5;
  shown(out, [0.2, 0.2, 0.2], 1000, p);
  expect(out[2]).toBeLessThan(0.6);
  p.frame[FRAME.eyeHeight] = -1;
  shown(out, [0.2, 0.2, 0.2], 1000, p);
  expect(out).toEqual([0, 0, 1]);
  // So a probe that holds the GPU to the rasterizer draws a plain sky: by 30 m the haze lifts a dark leaf by whole levels.
  const leaf = [0.012, 0.02, 0.008];
  const lift = (dist: number, plain: boolean): number => {
    const f = frameAt(12, 2, plain);
    const [sun, air, clear] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    trueSun(f, sun);
    hazed(air, leaf, [0, dist * 0.4, -dist * Math.sqrt(0.84)], f, sky.table, sun);
    p.frame.set(f);
    shown(clear, leaf, dist, p);
    shown(out, air, dist, p);
    return Math.max(...out.map((v, k) => (v - clear[k]!) * 255));
  };
  expect([lift(10, false), lift(20, true)]).toEqual([0, 0]);
  expect(lift(30, false)).toBeGreaterThan(4);
});

test("on a lit tier the scene fills the air and asks for the sky's pictures each frame; plain, or on low poly, it does neither", () => {
  // The fixture's tube material stands as the sky's: it is drawn nowhere, so only the dome asks for its pictures.
  const set = sceneSet();
  const tube = set.manifest.materials!.findIndex((m) => m.id === "test:tube/hide");
  const asSky = { ...set, manifest: { ...set.manifest, materials: set.manifest.materials!.map((m, i) => (i === tube ? { ...m, id: SKY_MATERIAL } : m)) } };
  const textures = (w: ReturnType<typeof sceneWorld>): number => {
    let n = 0;
    for (let f = 0; f < 20; f++) n += w.frame(100, false).texUploads.length;
    return n;
  };
  const lit = sceneWorld({}, {}, asSky);
  expect(textures(lit)).toBeGreaterThan(0);
  const p = lit.frame(100, false);
  expect([p.frame[FRAME.haze], p.frame[FRAME.skyDetail]]).toEqual([Math.fround(HAZE_DENSITY), 1 + tierOf("medium").clouds]);
  const plain = sceneWorld({}, {}, asSky);
  plain.scene.plainSky = true;
  expect(textures(plain)).toBe(0);
  expect([plain.frame(100, false).frame[FRAME.haze], plain.frame(100, false).frame[FRAME.skyDetail]]).toEqual([0, 0]);
  const low = sceneWorld({}, tierOf("lowpoly"), asSky);
  expect(textures(low)).toBe(0);
  expect(low.frame(100, false).frame[FRAME.haze]).toBe(0);
});
