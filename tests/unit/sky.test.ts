// The sky on lit tiers: the sun's path, the table the dome, haze and light come from, and the exposure that keeps a grey
// card as bright as low poly shows it.
import { expect, test } from "bun:test";
import { FRAME as F, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { KNEE, cardTakes, SKY_SIZE, aroundOf, domeLight, elevationOf, flatCard, heightOf, hourOfSun, luminance, decodeTexel, encodeTexel, sampleSky, shownSky, skyFrame, sunDirection, sunHeight, sunTravel, texelAt, theSky, tone } from "../../client/core/render/sky.ts";
import { linearToSrgb } from "../../client/core/render/surface.ts";
import { SkyBuilder } from "../../tools/sky/build.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { sceneWorld } from "../fixtures/sceneworld.ts";

const sky = theSky();
const frameAt = (hour: number): Float32Array => {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, f);
  return f;
};
/** The dome as the screen shows it at an hour, looking `elevation` degrees up and `around` degrees round from the sun. */
const dome = (hour: number, elevation: number, around: number): number[] => {
  const s = [0, 0, 0];
  sunDirection(hour, s);
  const a = Math.atan2(s[2]!, s[0]!) + (around * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const c = [0, 0, 0];
  domeLight(sky.table, s, [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)], c);
  const f = frameAt(hour);
  const out = [0, 0, 0];
  shownSky(c.map((v) => v * f[F.skyScale]! * f[F.exposure]!), out);
  return out;
};

test("the sun rises in the east, stands where low poly's does at noon, sets in the west, and moves in steps of 0.05 degrees", () => {
  const at = (hour: number): number[] => {
    const s = [0, 0, 0];
    sunDirection(hour, s);
    return s;
  };
  // East is -X: the compass's heading of a camera looking along -X is 90.
  expect(at(6).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-1, 0, 0]);
  expect(at(18).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
  const noon = at(12);
  const flat = Math.hypot(0, 1, 0.43);
  expect(noon[0]).toBeCloseTo(0, 9);
  expect(noon[1]).toBeCloseTo(1 / flat, 9);
  expect(noon[2]).toBeCloseTo(0.43 / flat, 9);
  expect(sunHeight(12)).toBeCloseTo(66.73, 2);
  for (const hour of [0.3, 7.77, 13.01, 19.5]) expect((sunTravel(hour) / 0.05) % 1).toBeCloseTo(0, 6);
  // Two moments within a step share a direction.
  expect(at(9)).toEqual(at(9 + 0.001));
  for (const h of [2, 15, 35, -8]) expect(sunHeight(hourOfSun(h, true))).toBeCloseTo(h, 1);
});

test("the noon zenith is bluer than the horizon, and the noon horizon does not wash out", () => {
  const blueness = (c: number[]): number => c[2]! / (c[0]! + c[1]! + c[2]!);
  const zenith = dome(12, 89, 180);
  const horizon = dome(12, 3, 180);
  expect(blueness(zenith)).toBeGreaterThan(blueness(horizon) + 0.01);
  // Still blue at the horizon, not white.
  expect(horizon[2]! - horizon[0]!).toBeGreaterThan(30);
});

test("with the sun 5 degrees up its light's red beats green beats blue", () => {
  const f = frameAt(hourOfSun(5, false));
  const [r, g, b] = [f[F.sunColor]!, f[F.sunColor + 1]!, f[F.sunColor + 2]!];
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
});

test("the table is even about the sun's azimuth", () => {
  let seed = 3;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const hour = rnd() * 24;
    const s = [0, 0, 0];
    sunDirection(hour, s);
    const v = [rnd() * 2 - 1, rnd(), rnd() * 2 - 1];
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    // The view mirrored through the upright plane the sun lies in.
    const n = [-s[2]!, 0, s[0]!].map((x) => x / Math.hypot(s[0]!, s[2]!));
    const d = (v[0]! * n[0]! + v[2]! * n[2]!) / l;
    const w = [v[0]! / l - 2 * d * n[0]!, v[1]! / l, v[2]! / l - 2 * d * n[2]!];
    const a = [0, 0, 0], b = [0, 0, 0];
    domeLight(sky.table, s, v.map((x) => x / l), a);
    domeLight(sky.table, s, w, b);
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 6);
  }
});

test("a grey card facing up in the open, lit as surfaces are, shows within 3 steps of low poly's at every quarter hour; exposure is 1 at noon", () => {
  expect(frameAt(12)[F.exposure]).toBeCloseTo(1, 5);
  let worst = 0;
  for (let q = 0; q < 96; q++) {
    const hour = q / 4;
    const f = frameAt(hour);
    const lum = (at: number): number => luminance([f[at]!, f[at + 1]!, f[at + 2]!]);
    const sun = [f[F.sun]!, f[F.sun + 1]!, f[F.sun + 2]!];
    const bySun = cardTakes([0, 1, 0], [0, 1, 0], sun);
    const byMoon = cardTakes([0, 1, 0], [0, 1, 0], [f[F.moon]!, f[F.moon + 1]!, f[F.moon + 2]!]);
    const light = lum(F.sunColor) * bySun.light + lum(F.moonColor) * byMoon.light + lum(F.skyAbove) * bySun.sky;
    const shows = 255 * linearToSrgb(light * f[F.exposure]!);
    worst = Math.max(worst, Math.abs(shows - flatCard(hour)));
  }
  expect(worst).toBeLessThanOrEqual(3);
});

test("the committed table is what the tool makes, and its bytes hold the sky to within a step on screen", () => {
  const b = new SkyBuilder();
  const z = 12;
  const s = b.slice(z);
  let most = 0;
  for (let i = 0; i < SKY_SIZE * SKY_SIZE * 4; i++) most = Math.max(most, Math.abs(s.bytes[i]! - sky.table[texelAt(0, 0, z) + i]!));
  expect(most).toBeLessThanOrEqual(1);
  for (let i = 0; i < s.lights.length; i++) expect(Math.abs(s.lights[i]! - sky.lights[z * s.lights.length + i]!)).toBeLessThanOrEqual(Math.abs(s.lights[i]!) * 1e-5 + 1e-12);
  // Each texel, decoded as a graphics card samples it at its middle, against the sky the tool made there, both on screen.
  const height = heightOf(z / (SKY_SIZE - 1));
  const exact = new Float64Array(3);
  const got = [0, 0, 0], a = [0, 0, 0], c = [0, 0, 0];
  let step = 0;
  for (let y = 0; y < SKY_SIZE; y++) {
    for (let x = 0; x < SKY_SIZE; x++) {
      b.domeAt(height, elevationOf(y / (SKY_SIZE - 1)), aroundOf(x / (SKY_SIZE - 1)), exact);
      shownSky(Array.from(exact, (v) => v * s.exposure), a);
      sampleSky(sky.table, x / (SKY_SIZE - 1), y / (SKY_SIZE - 1), z / (SKY_SIZE - 1), got);
      shownSky(got, c);
      for (let k = 0; k < 3; k++) step = Math.max(step, Math.abs(a[k]! - c[k]!));
    }
  }
  expect(step).toBeLessThanOrEqual(1);
});

test("a texel's bytes hold a colour to within a step on screen, from the dark to a hundred times the knee", () => {
  let seed = 11;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bytes = new Uint8Array(4);
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const peak = 0.002 * 50000 ** rnd();
    const v = [rnd(), rnd(), rnd()];
    const m = Math.max(...v);
    const colour = v.map((x) => (x / m) * peak);
    encodeTexel(colour, bytes, 0);
    decodeTexel(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, c);
    shownSky(colour, a);
    shownSky(c, b);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k]! - b[k]!));
  }
  expect(worst).toBeLessThanOrEqual(1);
});

test("the tone curve leaves light under its knee and bends smoothly above it", () => {
  const out = [0, 0, 0];
  tone([0.5, 0.3, 0.1], out);
  expect(out).toEqual([0.5, 0.3, 0.1]);
  const at = (v: number): number => {
    tone([v, v, v], out);
    return out[0]!;
  };
  expect(at(KNEE + 1e-6)).toBeCloseTo(KNEE, 5);
  expect((at(KNEE + 1e-4) - at(KNEE)) / 1e-4).toBeCloseTo(1, 2);
  expect(at(100)).toBeLessThan(1);
  expect(at(100)).toBeGreaterThan(0.99);
});

test("on a lit tier the scene fills the frame block's sky for its hour, and on low poly leaves it", () => {
  const w = sceneWorld();
  w.scene.hour = 9.5;
  const p = w.frame(100, false);
  const f = frameAt(9.5);
  for (const at of [F.sun, F.sunColor, F.moon, F.moonColor, F.skyAbove, F.skyBelow]) for (let k = 0; k < 4; k++) expect(p.frame[at + k]).toBe(f[at + k]!);
  const low = sceneWorld({}, tierOf("lowpoly"));
  expect(low.frame(100, false).frame[F.exposure]).toBe(0);
});

test("through twilight the sun's slot carries the afterglow from 2 degrees up toward the sunken sun, never brighter than the sky above, gone 12 degrees down, casting nothing", () => {
  const lum = (f: Float32Array, at: number): number => luminance([f[at]!, f[at + 1]!, f[at + 2]!]);
  const dusk = frameAt(hourOfSun(-8, true));
  const sun = [-dusk[F.moon]!, -dusk[F.moon + 1]!, -dusk[F.moon + 2]!];
  expect((Math.asin(dusk[F.sun + 1]!) * 180) / Math.PI).toBeCloseTo(2, 5);
  expect(Math.atan2(dusk[F.sun + 2]!, dusk[F.sun]!)).toBeCloseTo(Math.atan2(sun[2]!, sun[0]!), 5);
  expect(lum(dusk, F.sunColor)).toBeGreaterThan(0.05 * lum(dusk, F.skyAbove));
  expect(lum(dusk, F.sunColor)).toBeLessThanOrEqual(lum(dusk, F.skyAbove));
  expect(dusk[F.casting]).toBe(0);
  // The glow is the dome's colour low toward the sun: warm.
  expect(dusk[F.sunColor]!).toBeGreaterThan(dusk[F.sunColor + 2]!);
  const late = frameAt(hourOfSun(-12.5, true));
  expect(lum(late, F.sunColor)).toBeLessThan(0.01 * lum(late, F.skyAbove));
  // By day the slot is the sun itself.
  const day = frameAt(10);
  const s = [0, 0, 0];
  sunDirection(10, s);
  for (let k = 0; k < 3; k++) expect(day[F.sun + k]).toBeCloseTo(s[k]!, 6);
});

test("at noon a grey card sunlit and seen head on shows 128, and one in its own shade 70 (D155)", () => {
  const f = frameAt(12);
  const v = (at: number): number[] => [f[at]!, f[at + 1]!, f[at + 2]!];
  const l = v(F.sun);
  const head = cardTakes(l, l, l);
  const up = 0.5 + 0.5 * l[1]!;
  const sun = v(F.sunColor), above = v(F.skyAbove), below = v(F.skyBelow);
  const on = [0, 1, 2].map((k) => sun[k]! * head.light + (above[k]! * up + below[k]! * (1 - up)) * head.sky);
  for (const c of on) expect(255 * linearToSrgb(c * f[F.exposure]!)).toBeCloseTo(128, 1);
  const n = [-l[0]!, 0, -l[2]!].map((x, _, a) => x / Math.hypot(a[0]!, a[2]!));
  const shade = cardTakes(n, n, l);
  const shaded = [0, 1, 2].map((k) => ((above[k]! + below[k]!) / 2) * shade.sky * f[F.exposure]!);
  expect(255 * linearToSrgb(luminance(shaded))).toBeCloseTo(70, 0);
});
