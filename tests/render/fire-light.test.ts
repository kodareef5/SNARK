// Fire with no texture read (client/core/render/fire-light.ts): the ramp, a rocket's flame and a fireball's lobe, the
// card's own text run against its TypeScript twin, the meshes they are drawn on, and the program that draws them.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { BLAZE_TURN_MS, CONE_TURN, FIRE_GLSL, blazeLight, blazeNoise, blazePhase, blazeVertex, putBlaze, FIRE_VERTEX_FLOATS, coneRadius, coneSlope, fireFlat, fireRamp, flameLight, flamePhase, flameVertex, lobeBands, lobeLight, lobeNoise, lobeSwell, lobeVertex, putFlame, putLobe, FLAME_TURN_MS, type FireSun } from "../../client/core/render/fire-light.ts";
import { DETAIL_LIT_FRAGMENT, scorchOf, smokeOf } from "../../client/core/render/detailtext.ts";
import { FIRE_FRAGMENT, fireShown } from "../../client/core/render/fire-light.ts";
import { tone } from "../../client/core/render/surface.ts";
import { DRAW_BLEND, DRAW_FIRE, DRAW_PLAIN, FRAME, FRAME_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAM, PROGRAMS, drawProgram, tierPrograms } from "../../client/core/render/programs.ts";
import { tiled } from "../../client/core/texgen/noise.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { fireMeshes } from "../../tools/pack/fire.ts";

const ramp = (t: number): number[] => {
  const out = [0, 0, 0];
  fireRamp(t, out);
  return out;
};

/**
 * The fire's GLSL as JavaScript, with `defines` taken as defined: its functions are written with numbers alone and one
 * vector made at the end, so each line is the same arithmetic in either language.
 */
function compiled(defines: readonly string[]): Record<string, (...v: number[]) => number[] | number> {
  const lines: string[] = [];
  // Which branch of each open #ifdef is kept.
  const open: boolean[] = [];
  for (const line of FIRE_GLSL.split("\n")) {
    const word = line.trim();
    if (word.startsWith("#ifdef")) open.push(defines.includes(word.slice(7).trim()));
    else if (word === "#else") open.push(!open.pop()!);
    else if (word === "#endif") open.pop();
    else if (open.every((kept) => kept)) lines.push(line);
  }
  const js = lines.join("\n")
    .replace(/^(?:float|vec3|vec4) (\w+)\(([^)]*)\) \{$/gm, (_, name: string, params: string) => `function ${name}(${params.replace(/\b(?:float|int) /g, "")}) {`)
    .replace(/^(\s*)(?:float|int|vec3) (\w+) =/gm, "$1let $2 =")
    .replace(/\bvec[34]\(/g, "vec(")
    .replace(/\.r\b/g, "[0]").replace(/\.g\b/g, "[1]").replace(/\.b\b/g, "[2]")
    .replace(/\b(sin|cos|sqrt|exp|floor|min|max)\(/g, "Math.$1(")
    .replace(/\bint\(/g, "Math.trunc(");
  const helpers = `
    const vec = (...v) => v;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fract = (v) => v - Math.floor(v);
    const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };`;
  return new Function("tiled", `${helpers}\n${js}\nreturn { fireRamp, flameLight, lobeLight, blazeLight };`)(tiled);
}

/** Numbers spread over 0 to 1 that never repeat a row. */
const spread = (k: number, by: number): number => (k * by + 0.137) % 1;

test("the ramp runs from nothing for soot through deep red, orange and yellow to white", () => {
  expect(ramp(0)).toEqual([0, 0, 0]);
  expect(ramp(-1)).toEqual([0, 0, 0]);
  expect(ramp(2)).toEqual(ramp(1));
  // Deep red: red alone. Orange: some green, no blue. Yellow: green near red, little blue. White: all three, and bright.
  const [red, orange, yellow, white] = [ramp(0.2), ramp(0.5), ramp(0.75), ramp(1)];
  expect([red[1]! < 0.1 * red[0]!, orange[1]! > 0.2 * orange[0]! && orange[2]! < 0.05 * orange[0]!, yellow[1]! > 0.5 * yellow[0]! && yellow[2]! < 0.2 * yellow[0]!, white[2]! > 0.5 * white[0]! && white[0]! > 5]).toEqual([true, true, true, true]);
  // Hotter is never dimmer, in any channel.
  for (let t = 0; t < 1; t += 0.01) for (let c = 0; c < 3; c++) expect(ramp(t + 0.01)[c]!).toBeGreaterThanOrEqual(ramp(t)[c]!);
});

test("the card's text and its twin agree: the ramp, a flame, a lobe and a blaze, by noise, light and target", () => {
  for (const target of [false, true]) {
    for (const lit of [false, true]) {
      for (const noise of [0, 1, 2]) {
        const glsl = compiled([...(target ? ["LIGHT_TARGET"] : []), ...(lit ? ["FIRE_LIT"] : []), ...(noise > 0 ? ["FIRE_NOISE"] : []), ...(noise > 1 ? ["FIRE_FINE"] : [])]);
        const out = [0, 0, 0, 0];
        for (let k = 0; k < 400; k++) {
          const t = spread(k, 0.0731);
          const hot = glsl.fireRamp!(t) as number[];
          ramp(t).forEach((v, c) => expect(hot[c]!).toBeCloseTo(v, 9));
          // A flame: round it, along it, how it faces, its power, ignition, seed, how nearly down it the eye looks, the phase, its length.
          const flame = [spread(k, 0.618), 1.1 * spread(k, 0.377), spread(k, 0.233) * 1.2 - 0.1, spread(k, 0.91), spread(k, 0.53), spread(k, 0.147), spread(k, 0.71), 6.283 * spread(k, 0.29), 0.3 + 2 * spread(k, 0.83)] as const;
          flameLight(out, ...flame, target);
          (glsl.flameLight!(...flame) as number[]).forEach((v, c) => expect(v).toBeCloseTo(out[c]!, 6));
          // A lobe: its cell, how it faces, how far it is over the ground, its age, heat, seed, soot's shade, how much shows, and the light on it.
          const lobe = [16 * spread(k, 0.618), 16 * spread(k, 0.377) - 2, spread(k, 0.233) * 1.2 - 0.1, 0.6 * spread(k, 0.67) - 0.1, spread(k, 0.91), 0.5 + 0.5 * spread(k, 0.53), spread(k, 0.147), 0.1 * spread(k, 0.71), spread(k, 0.29), 2 * spread(k, 0.83), 2 * spread(k, 0.43), 2 * spread(k, 0.57)] as const;
          lobeLight(out, ...lobe, noise, target, lit);
          (glsl.lobeLight!(...lobe) as number[]).forEach((v, c) => expect(v).toBeCloseTo(out[c]!, 6));
          // A blaze: across it, up it, how it faces, how much shows, its seed, how nearly from over it, its clock at a pace of three, and the light on it.
          const blaze = [2 * spread(k, 0.618) - 1, spread(k, 0.377), spread(k, 0.233) * 1.2 - 0.1, spread(k, 0.91), spread(k, 0.147), spread(k, 0.71), 3 * 6.283 * spread(k, 0.29), 2 * spread(k, 0.83), 2 * spread(k, 0.43), 2 * spread(k, 0.57)] as const;
          blazeLight(out, ...blaze, noise, target, lit);
          (glsl.blazeLight!(...blaze) as number[]).forEach((v, c) => expect(v).toBeCloseTo(out[c]!, 6));
        }
      }
    }
  }
});

test("a flame is hottest at its nozzle's middle, gone by its tip and at its edge, longer lit as its motor lights, and never shows more than it has power", () => {
  const at = (around: number, along: number, facing: number, power = 1, ignite = 0, axial = 0, phase = 1): number[] => {
    const out = [0, 0, 0, 0];
    flameLight(out, around, along, facing, power, ignite, 0.3, axial, phase, 0.9, false);
    return out;
  };
  const sum = (v: number[]): number => v[0]! + v[1]! + v[2]!;
  expect(at(0.3, 1, 1)[3]).toBe(0);
  expect(at(0.3, 0.3, 0.02)[3]!).toBeLessThan(0.02);
  expect(sum(at(0.3, 0.05, 1))).toBeGreaterThan(2 * sum(at(0.3, 0.6, 1)));
  expect(at(0.3, 0.2, 1, 0)).toEqual([0, 0, 0, 0]);
  expect(at(0.3, 0.2, 1, 0.5)[3]!).toBeCloseTo(at(0.3, 0.2, 1, 1)[3]! / 2, 9);
  expect(sum(at(0.3, 0.5, 0.8, 1, 1))).toBeGreaterThan(sum(at(0.3, 0.5, 0.8, 1, 0)));
  // Seen down its length it is alight where its side, seen so, would be at its edge and dark, to its tip.
  expect(at(0.3, 0.9, 0.05, 1, 0, 1)[3]!).toBeGreaterThan(0.5);
  // Its blue is white heat: only at the nozzle's middle.
  expect([at(0.3, 0.02, 1)[2]! > 0.5, at(0.3, 0.5, 1)[2]! < 0.2, at(0.3, 0.2, 0.3)[2]! < 0.05]).toEqual([true, true, true]);
  for (let k = 0; k < 500; k++) {
    const v = at(spread(k, 0.61), spread(k, 0.37), spread(k, 0.23), spread(k, 0.9), spread(k, 0.5), spread(k, 0.7), 6.28 * spread(k, 0.29));
    expect([v[3]! >= 0, v[3]! <= 1, v.every((c) => c >= 0 && Number.isFinite(c))]).toEqual([true, true, true]);
  }
  // The phase comes round with no jump: the same light a whole turn on.
  expect(at(0.3, 0.4, 0.8, 1, 0, 0, flamePhase(123))).toEqual(at(0.3, 0.4, 0.8, 1, 0, 0, flamePhase(123 + FLAME_TURN_MS)));
  expect(flamePhase(FLAME_TURN_MS - 1) + flamePhase(1)).toBeCloseTo(2 * Math.PI, 3);
});

test("a blaze is whole and hot at its foot, tears into tongues past its height, cools to red and soot, and comes round", () => {
  const out = [0, 0, 0, 0];
  // Over its face between two heights, as shares of its cone: its mean cover, red and green, and the share that is soot.
  const band = (from: number, to: number, noise: number, axial = 0): { cover: number; red: number; green: number; soot: number } => {
    let [cover, red, green, soot, n] = [0, 0, 0, 0, 0];
    for (let along = from; along < to; along += 0.01) for (let across = -0.9; across <= 0.9; across += 0.05) for (const phase of [0.3, 2.1, 4.4]) {
      blazeLight(out, across, along, 0.85 * Math.sqrt(1 - across * across), 1, 0.37, axial, phase, 1, 1, 1, noise, false, true);
      cover += out[3]!;
      red += out[0]!;
      green += out[1]!;
      if (out[3]! > 0.05 && out[0]! < 0.1 * out[3]!) soot++;
      n++;
    }
    return { cover: cover / n, red: red / n, green: green / n, soot: soot / n };
  };
  for (const noise of [0, 1, 2]) {
    // Its height is the cone's to 0.69: BLAZE_REACH is 1.45.
    const [foot, middle, tip, past] = [band(0.1, 0.25, noise), band(0.3, 0.45, noise), band(0.62, 0.72, noise), band(0.9, 1, noise)];
    expect([noise, foot.cover > 0.65, middle.cover > 0.45, tip.cover > 0.04, tip.cover < 0.5, past.cover < 0.12]).toEqual([noise, true, true, true, true, true]);
    // Yellow at its foot, redder toward its tip, and soot only up there.
    expect([foot.green / foot.red > 0.6, tip.green / Math.max(tip.red, 1e-6) < foot.green / foot.red, foot.soot < 0.02]).toEqual([true, true, true]);
    // Seen from over it, its tip is its middle and is not eaten away as it is from the side.
    expect(band(0.62, 0.72, noise, 1).cover).toBeGreaterThan(1.5 * tip.cover);
    for (let k = 0; k < 200; k++) {
      const args = [2 * spread(k, 0.61) - 1, spread(k, 0.37), spread(k, 0.23), 1, spread(k, 0.71), spread(k, 0.53)] as const;
      blazeLight(out, ...args, 6.283 * spread(k, 0.29), 1, 1, 1, noise, true, true);
      expect([out[3]! >= 0, out[3]! <= 1, out.every((c) => c >= 0 && Number.isFinite(c))]).toEqual([true, true, true]);
      // A whole turn on at a pace of three, its noise has risen whole periods of its cells and it is where it began.
      const now = [...out];
      blazeLight(out, ...args, 6.283 * spread(k, 0.29) + 2 * Math.PI * 3, 1, 1, 1, noise, true, true);
      now.forEach((v, c) => expect(out[c]!).toBeCloseTo(v, 4));
      expect(blazeNoise(args[0], args[1] * 3, 5.5 + 16, 0.4, noise)).toBeCloseTo(blazeNoise(args[0], args[1] * 3, 5.5, 0.4, noise), 6);
    }
  }
  // Half shown is half of it, and none is nothing.
  blazeLight(out, 0.1, 0.15, 0.9, 1, 0.3, 0, 1, 1, 1, 1, 2, false, true);
  const whole = [...out];
  blazeLight(out, 0.1, 0.15, 0.9, 0.5, 0.3, 0, 1, 1, 1, 1, 2, false, true);
  expect(out[3]!).toBeCloseTo(whole[3]! / 2, 9);
  blazeLight(out, 0.1, 0.15, 0.9, 0, 0.3, 0, 1, 1, 1, 1, 2, false, true);
  expect(out).toEqual([0, 0, 0, 0]);
  expect([blazePhase(0), blazePhase(BLAZE_TURN_MS), blazePhase(-1) > 6.28]).toEqual([0, 0, true]);
});

test("a blaze's twenty bytes hold it whole, and its vertex twin stands the cone up over its foot, facing out and leaning", () => {
  const bytes = new Uint8Array(INSTANCE_BYTES * 2);
  const out = new Float64Array(FIRE_VERTEX_FLOATS);
  const frame = new Float32Array(FRAME_FLOATS);
  frame.set([0, 1, 0], FRAME.sun);
  frame.set([2, 2, 2, 0.5], FRAME.sunColor);
  const env: FireSun = { lit: true, frame, sun: [0, 1, 0], light: 1 };
  // A blaze 2 m high and 1.2 m wide, its foot 10 m ahead and a metre down, with no wind.
  putBlaze(bytes, 1, 0, -1, 10, 2, 1.2, 0, 0, 0.8, 2, 0.25);
  const at = INSTANCE_BYTES;
  expect([bytes[at + 14], bytes[at + 15], bytes[at + 16], bytes[at + 17], bytes[at + 18], bytes[at + 19]]).toEqual([48, 58, 128, 128, 204, 2]);
  blazeVertex(out, 0, 0, 0, bytes, at, 0, env);
  expect([out[0], out[1], out[2]].map((v) => Math.round(v! * 1e4) / 1e4)).toEqual([0, -1, 10]);
  // Its tip is its cone's height over its foot, give or take its flutter and sway; with no wind it does not lean.
  blazeVertex(out, 0, 0, 1, bytes, at, 0, env);
  expect([Math.abs(out[1]! + 1 - 2 * 1.45) < 0.4, Math.abs(out[0]!) < 0.5, Math.abs(out[2]! - 10) < 0.5]).toEqual([true, true, true]);
  expect([fireFlat[0]!, fireFlat[2]!, fireFlat[5]!].map((v) => Math.round(v * 100) / 100)).toEqual([0.8, 0.25, 2]);
  // Its side toward the eye faces the eye and the far side away.
  blazeVertex(out, 0, coneRadius(0.3), 0.3, bytes, at, 0, env);
  const toward = out[5]!;
  blazeVertex(out, 0, -coneRadius(0.3), 0.3, bytes, at, 0, env);
  expect([toward > 0.6, out[5]! < -0.6]).toEqual([true, true]);
  // Stood up, the cone is turned and not mirrored: its faces' windings still face out, so the back ones are culled.
  const cone = fireMeshes()[0]!.lods[0]!;
  let outward = 0, faces = 0;
  for (let t = 0; t < cone.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = cone.indices[t + k]! * 3;
      blazeVertex(out, cone.positions[i]!, cone.positions[i + 1]!, cone.positions[i + 2]!, bytes, at, 0, env);
      return [out[0]!, out[1]! + 1, out[2]! - 10] as const;
    });
    const [a, b, c] = [v[0]!, v[1]!, v[2]!];
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const mx = (a[0]! + b[0]! + c[0]!) / 3, mz = (a[2]! + b[2]! + c[2]!) / 3;
    if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-9 || Math.hypot(mx, mz) < 1e-3) continue;
    faces++;
    if (n[0]! * mx + n[2]! * mz > 0) outward++;
  }
  expect(outward / faces).toBeGreaterThan(0.95);
  // Leaning toward +x, its tip is carried that way, and its middle less.
  putBlaze(bytes, 0, 0, -1, 10, 2, 1.2, 1, 0, 0.8, 2, 0.25);
  blazeVertex(out, 0, 0, 1, bytes, 0, 0, env);
  const tip = out[0]!;
  blazeVertex(out, 0, 0, 0.5, bytes, 0, 0, env);
  expect([tip > 1.2, out[0]! > 0.2, out[0]! < tip]).toEqual([true, true, true]);
});

test("a lobe begins white, cools through fire to soot with glowing cracks, opens into holes and is gone", () => {
  // Over the face of a lobe at an age: its mean light, how much of it shows, and the share of it that glows.
  const face = (age: number, noise: number, seed = 0.4): { red: number; blue: number; cover: number; glowing: number } => {
    const out = [0, 0, 0, 0];
    let [red, blue, cover, glowing, n] = [0, 0, 0, 0, 0];
    for (let u = 0; u < 4; u += 0.13) for (let v = 0; v < 4; v += 0.13) {
      lobeLight(out, u, v, 0.8, 1, age, 1, seed, 0.04, 1, 1, 1, 1, noise, true, true);
      red += out[0]!;
      blue += out[2]!;
      cover += out[3]!;
      if (out[0]! > 0.5) glowing++;
      n++;
    }
    return { red: red / n, blue: blue / n, cover: cover / n, glowing: glowing / n };
  };
  for (const noise of [2, 1, 0]) {
    const [flash, fire, cracks, holes, gone] = [face(0.02, noise), face(0.25, noise), face(0.5, noise), face(0.8, noise), face(1, noise)];
    expect(flash.blue).toBeGreaterThan(2);
    expect([fire.red > 1, fire.blue < 0.5 * flash.blue, fire.glowing > 0.7]).toEqual([true, true, true]);
    expect([cracks.glowing > 0.02, cracks.glowing < 0.6, cracks.red < 0.5 * fire.red]).toEqual([true, true, true]);
    expect([holes.cover < 0.75 * cracks.cover, holes.cover > 0, holes.glowing < cracks.glowing]).toEqual([true, true, true]);
    expect(gone).toEqual({ red: 0, blue: 0, cover: 0, glowing: 0 });
  }
  // Its edge is soft: nothing where its surface is edge-on, and less than whole a little in from there.
  const out = [0, 0, 0, 0];
  lobeLight(out, 1.3, 2.1, 0, 1, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, 2, true, true);
  expect(out).toEqual([0, 0, 0, 0]);
  lobeLight(out, 1.3, 2.1, 0.12, 1, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, 2, true, true);
  expect([out[3]! > 0, out[3]! < 0.4]).toEqual([true, true]);
  // What it shows is weighed by how much of it shows, and hides no more than that.
  lobeLight(out, 1.3, 2.1, 0.9, 1, 0.3, 1, 0.4, 0.04, 0.5, 1, 1, 1, 2, true, true);
  const half = [...out];
  lobeLight(out, 1.3, 2.1, 0.9, 1, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, 2, true, true);
  half.forEach((v, c) => expect(v).toBeCloseTo(out[c]! / 2, 9));
  // It fades into the ground it stands on: nothing at the ground, whole a third of its radius over it.
  lobeLight(out, 1.3, 2.1, 0.9, 0, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, 2, true, true);
  expect(out).toEqual([0, 0, 0, 0]);
  lobeLight(out, 1.3, 2.1, 0.9, 0.15, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, 2, true, true);
  expect([out[3]! > 0, out[3]! < half[3]! * 2]).toEqual([true, true]);
  // Two seeds are two fires; the noise and the bands both stay within 0 and 1.
  let differ = 0;
  for (let k = 0; k < 200; k++) {
    const [u, v] = [16 * spread(k, 0.61), 16 * spread(k, 0.37)];
    if (Math.abs(lobeNoise(u, v, 0.2) - lobeNoise(u, v, 0.7)) > 0.05) differ++;
    for (const n of [lobeNoise(u, v, 0.2), lobeNoise(u, v, 0.2, false), lobeBands(u, v, 0.2), lobeBands(u, v, 0.9)]) expect([n >= 0, n <= 1]).toEqual([true, true]);
  }
  expect(differ).toBeGreaterThan(120);
});

test("an instance's twenty bytes carry a flame and a lobe whole, and the vertex twin places and faces them", () => {
  const bytes = new Uint8Array(INSTANCE_BYTES * 2);
  const out = new Float64Array(FIRE_VERTEX_FLOATS);
  // A flame 0.9 m long blowing along -x, its nozzle 10 m ahead.
  putFlame(bytes, 1, 0, 1, 10, -1, 0, 0, 0.9, 1, 0, 0.25);
  flameVertex(out, 0, 0, 0, 0, bytes, INSTANCE_BYTES, 0);
  expect([out[0], out[1], out[2]]).toEqual([0, 1, 10]);
  flameVertex(out, 0, 0, 1, 0, bytes, INSTANCE_BYTES, 0);
  // Its tip is its length away along its way, give or take its flutter and its wag.
  expect([out[0]! < -0.75 && out[0]! > -1.05, Math.abs(out[1]! - 1) < 0.08, Math.abs(out[2]! - 10) < 0.08]).toEqual([true, true, true]);
  expect([fireFlat[0], fireFlat[1]]).toEqual([1, 0]);
  expect(fireFlat[2]!).toBeCloseTo(0.25, 4);
  // The side of it turned to the eye faces the eye, and the far side faces away.
  flameVertex(out, -coneRadius(0.3), 0, 0.3, 0.5, bytes, INSTANCE_BYTES, 0);
  const toward = out[5]!;
  flameVertex(out, coneRadius(0.3), 0, 0.3, 0, bytes, INSTANCE_BYTES, 0);
  expect([toward > 0.9, out[5]! < -0.9, out[3], out[4]]).toEqual([true, true, 0, 0.3]);
  // As its motor lights it is longer.
  putFlame(bytes, 0, 0, 1, 10, -1, 0, 0, 0.9, 1, 1, 0.25);
  flameVertex(out, 0, 0, 1, 0, bytes, 0, 0);
  expect(out[0]!).toBeLessThan(-1.4);
  // The cone's outline is a unit at its widest and closes at its tip, and its slope is that outline's.
  let widest = 0;
  for (let t = 0; t <= 1; t += 0.001) {
    widest = Math.max(widest, coneRadius(t));
    expect(coneSlope(t)).toBeCloseTo((coneRadius(t + 1e-5) - coneRadius(t - 1e-5)) / 2e-5, 3);
  }
  expect([Math.abs(widest - 1) < 1e-3, coneRadius(1)]).toEqual([true, 0]);

  // A lobe 2 m in radius 12 m ahead, a third through its life, in an afternoon's light.
  const frame = new Float32Array(FRAME_FLOATS);
  frame.set([0, 1, 0], FRAME.sun);
  frame.set([2, 2, 2, 0.5], FRAME.sunColor);
  const env: FireSun = { lit: true, frame, sun: [0, 1, 0], light: 1 };
  putLobe(bytes, 0, 0, 2, 12, 2, 0.33, 0.6, 1, 0.8);
  let [least, most] = [Infinity, 0];
  for (const mesh of fireMeshes().filter((m) => m.id === "core:fire_lobe")) {
    const p = mesh.lods[0]!.positions;
    for (let i = 0; i < p.length; i += 3) {
      lobeVertex(out, p[i]!, p[i + 1]!, p[i + 2]!, bytes, 0, env);
      const r = Math.hypot(out[0]!, out[1]! - 2, out[2]! - 12);
      least = Math.min(least, r);
      most = Math.max(most, r);
      // Its outline boils by a third at most, and a point on the side turned to the eye faces it.
      if (p[i + 2]! < -0.9) expect(out[5]!).toBeGreaterThan(0.5);
      if (p[i + 2]! > 0.9) expect(out[5]!).toBeLessThan(-0.5);
    }
  }
  expect([least > 2 * 0.7, most < 2 * 1.3, most > least * 1.1]).toEqual([true, true, true]);
  expect([fireFlat[0]!, fireFlat[1]!].map((v) => Math.round(v * 100) / 100)).toEqual([0.33, 0.8]);
  // The ground is a metre under its middle, half its radius: a point at its foot is under it, one at its top two and a half radii... over it.
  lobeVertex(out, 0, -1, 0, bytes, 0, env);
  expect([out[9]! < 0, out[9]! > -0.8]).toEqual([true, true]);
  lobeVertex(out, 0, 1, 0, bytes, 0, env);
  expect([out[9]! > 1.2, out[9]! < 1.8]).toEqual([true, true]);
  // With no ground under it, no point of it is near one.
  putLobe(bytes, 1, 0, 2, 12, 2, 0.33, 0.6, Infinity, 0.8);
  lobeVertex(out, 0, -1, 0, bytes, INSTANCE_BYTES, env);
  expect(out[9]!).toBeGreaterThan(50);
  putLobe(bytes, 0, 0, 2, 12, 2, 0.33, 0.6, 1, 0.8);
  // The top of it, in the sun, is lit more than its underside.
  lobeVertex(out, 0, 1, 0, bytes, 0, env);
  const top = out[6]!;
  lobeVertex(out, 0, -1, 0, bytes, 0, env);
  expect(top).toBeGreaterThan(1.5 * out[6]!);
  // It swells fast and then slowly on, and is never smaller later.
  for (let a = 0; a < 1; a += 0.01) expect(lobeSwell(a + 0.01)).toBeGreaterThanOrEqual(lobeSwell(a));
  expect([lobeSwell(0) < 0.3, lobeSwell(0.16) > 0.95]).toEqual([true, true]);
});

test("the fire's meshes are a lathed cone with its turn in its colour bytes and a ball of 320 triangles, each with coarser levels", () => {
  // No level stands a hand's width off the finest, as the pack holds every mesh to.
  for (const mesh of fireMeshes()) for (const level of mesh.lods) expect(level.error!).toBeLessThan(0.1);
  const [cone, lobe] = fireMeshes();
  expect([cone!.id, lobe!.id]).toEqual(["core:fire_cone", "core:fire_lobe"]);
  expect(cone!.lods.map((l) => l.indices.length / 3)).toEqual([204, 54, 20]);
  expect(lobe!.lods.map((l) => l.indices.length / 3)).toEqual([320, 80]);
  for (const level of cone!.lods) {
    let seam = 0;
    for (let i = 0; i < level.colors.length; i++) {
      const [x, y, z] = [level.positions[i * 3]!, level.positions[i * 3 + 1]!, level.positions[i * 3 + 2]!];
      // Where a vertex is round the cone is its colour byte, to the seam's far side, which is a whole turn.
      const around = level.colors[i]! / CONE_TURN;
      if (z < 1) expect(Math.atan2(y, x)).toBeCloseTo(around > 0.5 ? (around - 1) * 2 * Math.PI : around * 2 * Math.PI, 2);
      expect(Math.hypot(x, y)).toBeCloseTo(coneRadius(z), 5);
      if (level.colors[i] === CONE_TURN) seam++;
      expect(level.colors[i]!).toBeLessThan(240);
    }
    expect(seam).toBeGreaterThan(2);
  }
  // Every face of the ball looks outward, so its back faces are the ones left out.
  for (const level of lobe!.lods) {
    const p = level.positions;
    for (let t = 0; t < level.indices.length; t += 3) {
      const [a, b, c] = [level.indices[t]! * 3, level.indices[t + 1]! * 3, level.indices[t + 2]! * 3];
      const n = [(p[b + 1]! - p[a + 1]!) * (p[c + 2]! - p[a + 2]!) - (p[b + 2]! - p[a + 2]!) * (p[c + 1]! - p[a + 1]!), (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!), (p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (p[c]! - p[a]!)];
      expect(n[0]! * p[a]! + n[1]! * p[a + 1]! + n[2]! * p[a + 2]!).toBeGreaterThan(0);
    }
    for (let i = 0; i < p.length; i += 3) expect(Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!)).toBeCloseTo(1, 5);
  }
});

test("a draw of fire takes the fire program on every tier, which reads the noise only where the tier pays for it", () => {
  const p = new FramePacket();
  p.drawFlags[0] = DRAW_BLEND | DRAW_PLAIN | DRAW_FIRE;
  expect(drawProgram(p, 0, undefined)).toBe(PROGRAM.fire);
  p.split = 384;
  expect(drawProgram(p, 0, undefined)).toBe(PROGRAM.fire);
  for (const tier of TIERS) {
    expect(tierPrograms(tier)).toContain(PROGRAM.fire);
    for (const light of [false, true]) {
      const text = PROGRAMS.fire!(tier, "rgba", false, light);
      expect([text.defines.includes("FIRE_LIT"), text.defines.includes("FIRE_NOISE"), text.defines.includes("FIRE_FINE"), text.defines.includes("LIGHT_TARGET"), Object.keys(text.samplers)]).toEqual([tier.lit, tier.bursts.noise > 0, tier.bursts.noise > 1, light && tier.post !== null, []]);
      // No texture is read, and both texts name what they hand each other alike.
      expect(text.fragment.includes("texture(")).toBe(false);
      for (const name of ["vUv", "vFacing", "vLift", "vLight", "vA"]) expect([text.vertex.includes(name), text.fragment.includes(name)]).toEqual([true, true]);
    }
  }
  // Low poly and a phone draw one lobe in bands; medium three with one octave of the noise, high and ultra with two.
  expect(TIERS.map((t) => [t.name, t.bursts.lobes, t.bursts.noise, t.bursts.particles])).toEqual([["lowpoly", 1, 0, 20], ["medium", 3, 1, 60], ["high", 3, 2, 100], ["ultra", 3, 2, 160]]);
  expect(["medium", "high"].map((name) => forTouch(tierOf(name), true).bursts)).toEqual([{ particles: 60, lobes: 1, noise: 0 }, { particles: 100, lobes: 1, noise: 0 }]);
});

test("a thick puff of smoke is whole at its middle, nothing at its card's edge, and each seed's outline is its own", () => {
  const out = [0, 0, 0];
  for (const seed of [0, 0.3, 0.77]) {
    smokeOf(0, 0, seed, out);
    expect(out[0]).toBe(1);
    for (let k = 0; k < 64; k++) {
      // Round the card's edge, and round a circle a little inside it.
      const a = (k / 64) * 2 * Math.PI;
      smokeOf(Math.cos(a) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), Math.sin(a) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), seed, out);
      expect(out[0]!).toBeLessThan(0.02);
      expect([out[2]! >= 0.44, out[2]! <= 1]).toEqual([true, true]);
    }
  }
  let differ = 0;
  for (let k = 0; k < 100; k++) {
    const [x, y] = [spread(k, 0.61) * 1.4 - 0.7, spread(k, 0.37) * 1.4 - 0.7];
    smokeOf(x, y, 0.2, out);
    const a = out[0]!;
    smokeOf(x, y, 0.7, out);
    if (Math.abs(a - out[0]!) > 0.03) differ++;
  }
  expect(differ).toBeGreaterThan(30);
});

test("a puff that billows has its outline broken into folds, still never shows its card, and the text is the twin's", () => {
  const out = [0, 0, 0];
  {
    for (const seed of [0, 0.3, 0.77]) {
      smokeOf(0, 0, seed, out, 1, 0, true);
      expect(out[0]!).toBeGreaterThan(0.85);
      // Round a circle most of the way out, a plain puff's edge is all but even; a billowing one's comes and goes.
      const ring = Array.from({ length: 72 }, (_, k) => {
        const a = (k / 72) * 2 * Math.PI;
        smokeOf(0.62 * Math.cos(a), 0.62 * Math.sin(a), seed, out, 1, 0, true);
        return out[0]!;
      });
      expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.5);
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * 2 * Math.PI, m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        smokeOf(Math.cos(a) / m, Math.sin(a) / m, seed, out, 1, 0, true);
        expect(out[0]!).toBeLessThan(0.02);
        expect([out[2]! >= 0.44, out[2]! <= 1]).toEqual([true, true]);
      }
    }
  }
  // A rope's length is as it was: the noise is a puff's alone.
  smokeOf(0.1, 0.3, 0.3, out, 8, 0, true);
  const rope = [...out];
  smokeOf(0.1, 0.3, 0.3, out, 8);
  expect(out).toEqual(rope);
  // High and ultra read the noise, at the twin's cells and weights; medium, low poly and a phone keep the plain puff.
  for (const tier of [...TIERS, forTouch(tierOf("high"), true)]) {
    const text = PROGRAMS.details!(tier, "rgba", false, tier.post !== null);
    expect([tier.name, text.defines.includes("#define SMOKE_NOISE\n")]).toEqual([tier.name, tier.lit && tier.bursts.noise > 1]);
  }
  expect(TIERS.filter((t) => t.lit && t.bursts.noise > 1).map((t) => t.name)).toEqual(["high", "ultra"]);
  expect(DETAIL_LIT_FRAGMENT).toContain("float n = tiled(2.4 * c.x + 8.0 + 7.0 * fract(seed * 3.7), 2.4 * c.y + 8.0 + 7.0 * fract(seed * 9.1), 16, 16, k + 3);");
  expect(DETAIL_LIT_FRAGMENT).toContain("lump = 0.35 * lump + 0.65 * n;\n    r += 0.22 * (0.5 - n);");
});

test("a length of a rope of smoke runs the whole of its card, ends thinned into the next, and tears where it is thinnest; a scorch is a patch with rays", () => {
  const out = [0, 0, 0];
  // Along its middle it is there from end to end but for the last of it, and nothing at its card's sides.
  let whole = 0;
  for (let y = -0.8; y <= 0.8; y += 0.05) {
    let most = 0;
    for (let x = -0.4; x <= 0.4; x += 0.05) {
      smokeOf(x, y, 0.3, out, 8);
      most = Math.max(most, out[0]!);
    }
    if (most > 0.95) whole++;
    for (const x of [-1, 1]) {
      smokeOf(x, y, 0.3, out, 8);
      expect(out[0]!).toBeLessThan(0.02);
    }
  }
  expect(whole).toBeGreaterThan(30);
  for (const x of [-0.5, 0, 0.5]) for (const y of [-1, 1]) {
    smokeOf(x, y, 0.3, out, 8);
    expect(out[0]!).toBeLessThan(0.02);
  }
  // Torn, less of it shows, and wholly torn none.
  const shows = (torn: number): number => {
    let sum = 0;
    for (let x = -1; x <= 1; x += 0.1) for (let y = -1; y <= 1; y += 0.1) {
      smokeOf(x, y, 0.3, out, 8, torn);
      sum += out[0]!;
    }
    return sum;
  };
  expect([shows(0.5) < 0.8 * shows(0), shows(0.5) > 0, shows(1) < 0.05 * shows(0)]).toEqual([true, true, true]);
  // A scorch: whole at its middle, nothing at its card's edge, and rays that reach past its patch some ways and not others.
  expect(scorchOf(0, 0, 0.4)).toBe(1);
  let [reached, bare] = [0, 0];
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * 2 * Math.PI;
    expect(scorchOf(Math.cos(a), Math.sin(a), 0.4)).toBe(0);
    if (scorchOf(0.55 * Math.cos(a), 0.55 * Math.sin(a), 0.4) > 0.1) reached++;
    else bare++;
  }
  expect([reached > 1, bare > 45]).toEqual([true, true]);
  expect(scorchOf(0.3, 0.2, 0.1)).not.toBe(scorchOf(0.3, 0.2, 0.6));
});

test("into a light target fire is the light the finish shows as a display tier shows it, hue and dark cracks kept", () => {
  const coded = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const shown = [0, 0, 0], light = [0, 0, 0], toned = [0, 0, 0];
    fireRamp(t, shown);
    fireShown(shown, false);
    fireRamp(t, light);
    fireShown(light, true);
    tone(toned, light);
    // What the finish's tone curve and coding make of the light is what a display tier draws, within a sixteenth.
    for (let c = 0; c < 3; c++) expect(Math.abs(coded(Math.min(1, toned[c]!)) - shown[c]!)).toBeLessThan(0.0625);
    // Only what is near white heat is past where bloom begins (post.ts BLOOM_FROM, 2), and soot's edge is dark red, not salmon.
    if (t < 0.78 || t > 0.88) expect(Math.max(...light) > 2).toBe(t > 0.88);
  }
  // The hour's grade is undone for fire and for a glow, in the fire's text and in the details'.
  expect(FIRE_FRAGMENT.split("#ifdef LIGHT_TARGET").at(-1)!.includes("/ max(fGrade.rgb")).toBe(true);
  expect(/d = max\(mix\(vec3\(dot\(d,/.test(DETAIL_LIT_FRAGMENT)).toBe(true);
});
