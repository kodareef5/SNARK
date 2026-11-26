// What a body on four-bone skin mirrors (surface.ts BODY_ROUGH): the sky's light, not the sky table's horizon haze.
import { expect, test } from "bun:test";
import { AIR } from "../../client/core/render/atmosphere.ts";
import { FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { domeLight, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { BODY_BELOW, BODY_MIRROR_GLSL, BODY_ROUGH, bodyBlur, bodyMirror, skyFrom, skyLight, surfaceFragment } from "../../client/core/render/surface.ts";

const sky = theSky();
const frame = new Float32Array(FRAME_FLOATS);
skyFrame(11, sky, frame);
const sun = [0, 0, 0];
trueSun(frame, sun);
const look = (view: ArrayLike<number>, out: number[] | Float32Array | Float64Array): void => domeLight(sky.table, sun, view as number[], out);
const luma = (c: number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** A way `degrees` over the horizon, turned `round` radians about the up axis. */
const way = (degrees: number, round: number): number[] => {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(round), Math.sin(a), Math.cos(a) * Math.sin(round)];
};
/** What the table holds along `r`, the sky's light that way, and what a body as rough as `rough` mirrors there. */
function mirrors(r: number[], rough: number): { table: number[]; light: number[]; body: number[] } {
  const table = [0, 0, 0], light = [0, 0, 0], body = [0, 0, 0];
  skyFrom(table, frame, r, look);
  skyLight(light, frame, r);
  skyFrom(body, frame, r, look);
  bodyMirror(body, frame, r, rough);
  return { table, light, body };
}

test("a limb turned down mirrors the ground's light, not the horizon the table holds", () => {
  for (const round of [0, 1.5, Math.PI]) {
    for (const degrees of [-60, -20, -(BODY_BELOW * 180) / Math.PI]) {
      // Even an eye's smoothness: below the horizon there is no sky to mirror.
      const { table, light, body } = mirrors(way(degrees, round), 0.12);
      for (let c = 0; c < 3; c++) expect(body[c]!).toBeCloseTo(light[c]!, 5);
      expect(luma(body)).toBeLessThan(0.5 * luma(table));
    }
  }
});

test("skin as rough as MakeHuman's mirrors the sky's light, with no horizon band", () => {
  for (const rough of [0.56, 0.59, 0.65]) expect(bodyBlur(rough, 0.3)).toBe(1);
  // Over the band the table is up to 2.5 times the sky's light: on a curve, a pale stripe.
  const band = [0, 5, 10].map((degrees) => mirrors(way(degrees, 0), 0.59));
  expect(Math.max(...band.map((m) => luma(m.table) / luma(m.light)))).toBeGreaterThan(2);
  for (const m of band) for (let c = 0; c < 3; c++) expect(m.body[c]!).toBeCloseTo(m.light[c]!, 5);
});

test("a smooth eye keeps the sky table over the horizon", () => {
  expect(bodyBlur(BODY_ROUGH[0], 0.3)).toBe(0);
  const { table, body } = mirrors(way(20, 0), 0.12);
  for (let c = 0; c < 3; c++) expect(body[c]!).toBeCloseTo(table[c]!, 6);
});

test("SURFACE turns only a four-bone body's mirror, by the same numbers", () => {
  const text = surfaceFragment("bc", AIR);
  expect(text.includes(BODY_MIRROR_GLSL)).toBe(true);
  expect(text).toContain("if (uSkin > 2.5) mirror = mix(mirror, skyLight(ray), bodyBlur(mro.g, ray.y));");
  for (const n of [...BODY_ROUGH, BODY_BELOW]) expect(BODY_MIRROR_GLSL).toContain(String(n));
});
