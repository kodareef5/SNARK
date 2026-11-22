// Damage numbers as detail cards (client/core/render/damage-numbers.ts, digits.ts): the glyphs pack into a card's colour and
// are drawn by their distance, filled and outlined; hits close in place and time add up in one number; a number keeps a
// least height however far off it was struck, is held 1.5 m along the eye's ray so the world never hides it, pops, rises,
// fades and is gone, and none is drawn where the rule or the setting is off.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DAMAGE_BODY, DAMAGE_HEAD, DAMAGE_KILL, DAMAGE_STYLES, DamageNumbers, LIFE_MS, LIVE, PULL, SHORTEST, TALLEST, popOf, screenHeight } from "../../client/core/render/damage-numbers.ts";
import { GLYPH_K, HALF_HEIGHT, STROKE, digitsOf, glyphDistance, glyphsOf, packGlyphs, unpackGlyphs } from "../../client/core/render/digits.ts";
import { DETAIL, DETAIL_DIGITS, DETAIL_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT } from "../../client/core/render/detailtext.ts";

const camera = (): Camera => {
  const c = new Camera();
  c.y = 1.6;
  c.aspect = 16 / 9;
  c.update();
  return c;
};
/** The card of number `n` as written: middle, along, across, colours and misc. */
const card = (d: DamageNumbers, n = 0) => {
  const o = n * DETAIL_FLOATS, f = (d as unknown as { cards: Float32Array; words: Uint32Array }).cards, w = (d as unknown as { words: Uint32Array }).words;
  return { middle: [f[o]!, f[o + 1]!, f[o + 2]!], along: [f[o + DETAIL.along]!, f[o + DETAIL.along + 1]!, f[o + DETAIL.along + 2]!], across: [f[o + DETAIL.across]!, f[o + DETAIL.across + 1]!, f[o + DETAIL.across + 2]!], a: w[o + DETAIL.colourA]!, b: w[o + DETAIL.colourB]!, misc: w[o + DETAIL.misc]! };
};

test("a number's glyphs pack into three bytes and back, thousands past 99,999 as a k", () => {
  for (const n of [7, 1234, 99999]) expect(unpackGlyphs(packGlyphs(glyphsOf(n))).join("")).toBe(String(n));
  expect(glyphsOf(123456)).toEqual([1, 2, 3, GLYPH_K]);
  expect(packGlyphs(glyphsOf(99999))).toBeLessThan(1 << 24);
});

test("the glyphs are thick strokes with a fat outline: an 8's strokes filled, its counters dark, a 1 narrow", () => {
  expect(glyphDistance(8, 0.36, 0.42)).toBeLessThan(STROKE);
  // The counters are not filled: at this weight the outline closes them, dark, as a chunky sprite font's are.
  expect(glyphDistance(8, 0, 0.42)).toBeGreaterThan(STROKE);
  expect(glyphDistance(0, 0, 0)).toBeGreaterThan(STROKE);
  expect(glyphDistance(1, -0.42, -0.2)).toBeGreaterThan(STROKE);
  // Across a stroke: fill, then outline, then nothing.
  const word = packGlyphs([1]), out = [0, 0, 0];
  const at = (x: number): number[] => (digitsOf(word, x, 0, 0.01, out), [...out]);
  const xs = [...Array(41).keys()].map((i) => -1 + i / 20).map((x) => at(x));
  const fill = xs.findIndex((s) => s[1]! > 0.5), edge = xs.findIndex((s) => s[0]! > 0.5);
  expect(edge).toBeGreaterThanOrEqual(0);
  expect(fill).toBeGreaterThan(edge);
  // Both shaders draw them.
  for (const text of [DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT]) expect(text).toContain(`vFlags == ${DETAIL_DIGITS}u`);
});

test("hits close in place and time add up in one number; another place is another; the oldest gives way", () => {
  const d = new DamageNumbers();
  for (let i = 0; i < 8; i++) d.hit(0.05 * i, 1, 5, 12, DAMAGE_BODY, 1000 + i * 10);
  expect(d.alive(1100)).toBe(1);
  expect(d.damage[d.born.indexOf(1070)]).toBe(96);
  d.hit(0, 1, 5, 3, DAMAGE_HEAD, 1100);
  expect(d.alive(1100)).toBe(1);
  expect(d.kind[d.born.indexOf(1100)]).toBe(DAMAGE_HEAD);
  d.hit(2, 1, 5, 3, DAMAGE_BODY, 1110);
  expect(d.alive(1110)).toBe(2);
  // Struck again too late, it is a new one.
  d.hit(0, 1, 5, 3, DAMAGE_BODY, 1600);
  expect(d.alive(1600)).toBe(3);
  for (let i = 0; i < LIVE + 5; i++) d.hit(i * 3, 1, 5, 1, DAMAGE_BODY, 2000 + i);
  expect(d.alive(2000 + LIVE + 5)).toBe(LIVE);
});

test("a number keeps a least height far off, and a kill stands taller", () => {
  expect(screenHeight(0, DAMAGE_BODY)).toBeCloseTo(TALLEST, 6);
  expect(screenHeight(300, DAMAGE_BODY)).toBeCloseTo(SHORTEST, 6);
  expect(screenHeight(2000, DAMAGE_BODY)).toBeCloseTo(SHORTEST, 6);
  expect(screenHeight(0, DAMAGE_KILL)).toBeCloseTo(TALLEST * DAMAGE_STYLES[DAMAGE_KILL]!.size, 6);
  expect(popOf(0, DAMAGE_BODY)).toBeCloseTo(DAMAGE_STYLES[DAMAGE_BODY]!.pop, 6);
  expect(popOf(1000, DAMAGE_BODY)).toBe(1);
});

test("its card stands where the hit shows, 1.5 m off along the eye's ray, at the height asked of it, facing the eye", () => {
  for (const far of [6, 40, 300]) {
    const cam = camera(), d = new DamageNumbers();
    d.hit(1.5, 2, far, 37, DAMAGE_BODY, 1000);
    // Past its pop, at the start of its rise.
    d.build(cam, 1000 + 120);
    expect(d.count).toBe(1);
    const c = card(d);
    const dist = Math.hypot(c.middle[0]!, c.middle[1]!, c.middle[2]!);
    expect(dist).toBeLessThan(PULL + 0.05);
    // On screen where the hit is, within the rise and drift of a tenth of its life.
    const hit = [0, 0, 0], shown = [0, 0, 0];
    cam.project(1.5, 2, far, hit);
    cam.project(cam.x + c.middle[0]!, cam.y + c.middle[1]!, cam.z + c.middle[2]!, shown);
    expect(Math.abs(shown[0]! - hit[0]!)).toBeLessThan(0.01);
    expect(Math.abs(shown[1]! - hit[1]!)).toBeLessThan(0.02);
    // Its height on screen: two glyph units of strokes, as screenHeight says.
    const top = [0, 0, 0], foot = [0, 0, 0], unit = Math.hypot(c.along[0]!, c.along[1]!, c.along[2]!) / HALF_HEIGHT;
    const [ux, uy, uz] = c.along.map((v) => v / Math.hypot(...c.along));
    cam.project(cam.x + c.middle[0]! + ux! * unit, cam.y + c.middle[1]! + uy! * unit, cam.z + c.middle[2]! + uz! * unit, top);
    cam.project(cam.x + c.middle[0]! - ux! * unit, cam.y + c.middle[1]! - uy! * unit, cam.z + c.middle[2]! - uz! * unit, foot);
    expect(foot[1]! - top[1]!).toBeCloseTo(screenHeight(Math.hypot(1.5, 0.4, far), DAMAGE_BODY) * popOf(120, DAMAGE_BODY), 2);
    // Facing the eye: its axes are the camera's right and up.
    expect(Math.abs(c.along[2]!)).toBeLessThan(1e-6);
    expect((c.misc >>> 8) & 255).toBe(DETAIL_DIGITS);
    expect(unpackGlyphs(c.b).join("")).toBe("37");
    expect(c.a & 0xffffff).toBe(0xffa336);
  }
});

test("it pops, rises and fades over its life, then is gone; behind the eye or switched off, nothing is drawn", () => {
  const cam = camera(), d = new DamageNumbers();
  d.hit(0, 1.6, 10, 5, DAMAGE_BODY, 0);
  const at = (t: number) => (d.build(cam, t), d.count ? { shows: (card(d).misc >>> 16) & 255, y: card(d).middle[1]!, size: Math.hypot(...card(d).along) } : null);
  const born = at(0)!, settled = at(400)!, late = at(LIFE_MS * 0.9)!;
  expect(born.size).toBeGreaterThan(settled.size);
  expect(late.y).toBeGreaterThan(settled.y);
  expect(born.shows).toBe(255);
  expect(late.shows).toBeLessThan(100);
  expect(at(LIFE_MS)).toBeNull();
  d.hit(0, 1.6, -10, 5, DAMAGE_BODY, 2000);
  expect(at(2010)).toBeNull();
  d.hit(0, 1.6, 10, 5, DAMAGE_BODY, 3000);
  d.enabled = false;
  expect(at(3010)).toBeNull();
  d.enabled = true;
  expect(at(3010)).not.toBeNull();
  // Written into a frame's details, as Scene does.
  const p = new FramePacket();
  p.beginFrame();
  d.write(p);
  expect(p.detailCount).toBe(1);
});
