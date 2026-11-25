// How a screen on a prop is shaded (client/core/render/screen-shade.ts), through the program's twin: LED dots close up
// that are as bright on the whole as the plain picture, a line that sweeps the new picture down, a tube's scanlines,
// the mean colour far off; and the program's texts compile and link on every tier.
import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { FACE, FACE_CRT, FACE_FLOATS, FACE_LED, FACE_LEVELS, FACE_TOP, FACE_TOP_BEFORE } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT, withDefines } from "../../client/core/render/programs.ts";
import { CRT_DEPTH, CRT_LINES, FACE_FRAGMENT, FACE_VERTEX, LED_FILL, LED_PITCH, faceLight, wordColour, type FaceRead } from "../../client/core/render/screen-shade.ts";
import { drawsLight } from "../../client/core/render/post.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";

const SUN = [0, 1, 0];
/** A face `wide` by `high` metres, its picture in layer 0 and the one before in layer 1, wiped `wipe` of the way. */
function quad(flags: number, wipe = 1, wide = 14.8, high = 4.85): { f: Float32Array; w: Uint32Array } {
  const f = new Float32Array(FACE_FLOATS), w = new Uint32Array(f.buffer);
  f.set([wide, 0, 0], FACE.across);
  f.set([0, high, 0], FACE.up);
  f.set([1, 1, 0, 0], FACE.crop);
  f.set([1, 1, 0, 0], FACE.cropBefore);
  f[FACE.layer] = 0;
  f[FACE.before] = 1;
  f[FACE.wipe] = wipe;
  f[FACE.bright] = 1;
  w[FACE.flags] = flags | ((FACE_LEVELS - 1) << FACE_TOP) | ((FACE_LEVELS - 1) << FACE_TOP_BEFORE);
  w[FACE.mean] = 0xff204060;
  w[FACE.meanBefore] = 0xff000000;
  return { f, w };
}
/** Layer 0 a plain grey of 0.5, layer 1 white, whatever the level. */
const reads: number[] = [];
const read: FaceRead = (layer, _s, _t, lod, out) => {
  reads.push(lod);
  out[0] = out[1] = out[2] = layer === 0 ? 0.5 : 1;
};
const light = (q: { f: Float32Array; w: Uint32Array }, u: number, v: number, metres: number): number[] => {
  const out = [0, 0, 0];
  faceLight(q.f, q.w, 0, { u, v, metres }, SUN, read, out);
  return out;
};

test("close up an LED face is a grid of dots, as bright on the whole as its plain picture", () => {
  const q = quad(FACE_LED), dots = Math.round(14.8 / LED_PITCH), rows = Math.round(4.85 / LED_PITCH);
  // A dot's middle is brighter than the picture; the panel between dots gives back a little of the day.
  const middle = light(q, 10.5 / dots, 7.5 / rows, 0.002)[0]!, between = light(q, 10 / dots, 7 / rows, 0.002)[0]!;
  expect(middle).toBeCloseTo(0.5 / (Math.PI * LED_FILL * LED_FILL), 4);
  expect(between).toBeLessThan(0.06);
  // Over a cell the dots average out to the picture.
  let sum = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) sum += light(q, (10 + (i + 0.5) / 20) / dots, (7 + (j + 0.5) / 20) / rows, 0.002)[0]!;
  expect(sum / 400).toBeGreaterThan(0.45);
  expect(sum / 400).toBeLessThan(0.58);
  // Where a dot spans under a pixel and a half the grid is gone, and so is its pattern.
  expect(light(q, 10 / dots, 7 / rows, LED_PITCH)).toEqual([0.5, 0.5, 0.5]);
});

test("a dot shows the picture at its middle and nothing finer than itself", () => {
  reads.length = 0;
  const q = quad(FACE_LED);
  light(q, 0.3, 0.6, 0.001);
  // A layer's 360 rows over 4.85 m, its denser way: a dot of LED_PITCH spans about 6 of them.
  expect(reads[0]!).toBeCloseTo(Math.log2((LED_PITCH * 360) / 4.85), 5);
  // A layer whose levels were made to the first alone, as a clip's frame seen near, is read no further.
  q.w[FACE.flags] = FACE_LED | (1 << FACE_TOP);
  light(q, 0.3, 0.6, 0.001);
  expect(reads[1]).toBe(1);
});

test("far off a face is its picture's mean colour, and with no picture it is that colour too", () => {
  reads.length = 0;
  const q = quad(FACE_LED), mean = [0, 0, 0];
  wordColour(0xff204060, mean);
  const far = light(q, 0.4, 0.4, 2);
  for (let c = 0; c < 3; c++) expect(far[c]!).toBeCloseTo(mean[c]!, 6);
  expect(reads.length).toBe(0);
  q.f[FACE.layer] = -1;
  const none = light(q, 0.4, 0.4, 0.2);
  for (let c = 0; c < 3; c++) expect(none[c]!).toBeCloseTo(mean[c]!, 6);
  // Its brightness is the level by exposure and how much it shows.
  q.f[FACE.bright] = 2;
  expect(light(q, 0.4, 0.4, 0.2)[0]!).toBeCloseTo(2 * mean[0]!, 6);
});

test("a change sweeps down an LED face behind a line of light, and fades on a TV", () => {
  const led = quad(FACE_LED, 0.5), tv = quad(0, 0.5, 1, 0.5625);
  // The new picture above the line, the one before under it, away from the line.
  expect(light(led, 0.5, 0.95, 0.2)[0]!).toBeCloseTo(0.5, 3);
  expect(light(led, 0.5, 0.1, 0.2)[0]!).toBeCloseTo(1, 3);
  // On the line, light.
  expect(light(led, 0.5, 1 - (0.5 * 1.1 - 0.05), 0.2)[2]!).toBeGreaterThan(1.5);
  expect(light(tv, 0.5, 0.95, 0.001)[0]!).toBeCloseTo(0.75, 6);
  expect(light(tv, 0.5, 0.1, 0.001)[0]!).toBeCloseTo(0.75, 6);
});

test("a tube has scanlines close up, which give way to an even dimming far off", () => {
  const q = quad(FACE_CRT, 1, 0.4, 0.3), line = 1 / CRT_LINES;
  expect(light(q, 0.5, 10 * line, 0.0001)[0]!).toBeCloseTo(0.5, 3);
  expect(light(q, 0.5, 10.5 * line, 0.0001)[0]!).toBeCloseTo(0.5 * (1 - CRT_DEPTH), 3);
  expect(light(q, 0.5, 10.5 * line, 0.01)[0]!).toBeCloseTo(0.5 * (1 - CRT_DEPTH / 2), 6);
});

test("the program's texts compile and link on every tier, reading the faces' unit", () => {
  for (const tier of TIERS) {
    for (const lit of [false, true]) {
      const text = PROGRAMS.screens!(tier, "rgba", false, lit);
      expect([text.vertex, text.fragment, text.samplers]).toEqual([FACE_VERTEX, FACE_FRAGMENT, { uFaces: UNIT.faces }]);
      expect(text.defines.includes("LIGHT_TARGET")).toBe(drawsLight(tier, lit));
      const vertex = withDefines(text.vertex, text.defines), fragment = withDefines(text.fragment, text.defines);
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)]).toEqual([]);
    }
  }
  expect(UNIT.faces).toBe(30);
});
