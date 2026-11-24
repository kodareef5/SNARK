// Fire with no texture read (client/core/render/fire-light.ts): the ramp, a rocket's flame and a fireball's lobe, the
// card's own text run against its TypeScript twin, the meshes they are drawn on, and the program that draws them.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { CONE_TURN, FIRE_GLSL, FIRE_VERTEX_FLOATS, coneRadius, coneSlope, fireFlat, fireRamp, flameLight, flamePhase, flameVertex, lobeBands, lobeLight, lobeNoise, lobeSwell, lobeVertex, putFlame, putLobe, FLAME_TURN_MS, type FireSun } from "../../client/core/render/fire-light.ts";
import { smokeOf } from "../../client/core/render/detailtext.ts";
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
  return new Function("tiled", `${helpers}\n${js}\nreturn { fireRamp, flameLight, lobeLight };`)(tiled);
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

test("the card's text and its twin agree at sampled points: the ramp, a flame, and a lobe with the noise and with bands, for a display and for a light target", () => {
  for (const target of [false, true]) {
    for (const lit of [false, true]) {
      for (const noise of [false, true]) {
        const glsl = compiled([...(target ? ["LIGHT_TARGET"] : []), ...(lit ? ["FIRE_LIT"] : []), ...(noise ? ["FIRE_NOISE"] : [])]);
        const out = [0, 0, 0, 0];
        for (let k = 0; k < 400; k++) {
          const t = spread(k, 0.0731);
          const hot = glsl.fireRamp!(t) as number[];
          ramp(t).forEach((v, c) => expect(hot[c]!).toBeCloseTo(v, 9));
          // A flame: round it, along it, how it faces, its power, ignition, seed, how nearly down it the eye looks, the phase, its length.
          const flame = [spread(k, 0.618), 1.1 * spread(k, 0.377), spread(k, 0.233) * 1.2 - 0.1, spread(k, 0.91), spread(k, 0.53), spread(k, 0.147), spread(k, 0.71), 6.283 * spread(k, 0.29), 0.3 + 2 * spread(k, 0.83)] as const;
          flameLight(out, ...flame, target);
          (glsl.flameLight!(...flame) as number[]).forEach((v, c) => expect(v).toBeCloseTo(out[c]!, 6));
          // A lobe: its cell, how it faces, its age, heat, seed, soot's shade, how much shows, and the light on it.
          const lobe = [16 * spread(k, 0.618), 16 * spread(k, 0.377) - 2, spread(k, 0.233) * 1.2 - 0.1, spread(k, 0.91), 0.5 + 0.5 * spread(k, 0.53), spread(k, 0.147), 0.1 * spread(k, 0.71), spread(k, 0.29), 2 * spread(k, 0.83), 2 * spread(k, 0.43), 2 * spread(k, 0.57)] as const;
          lobeLight(out, ...lobe, noise, target, lit);
          (glsl.lobeLight!(...lobe) as number[]).forEach((v, c) => expect(v).toBeCloseTo(out[c]!, 6));
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

test("a lobe begins white, cools through fire to soot with glowing cracks, opens into holes and is gone", () => {
  // Over the face of a lobe at an age: its mean light, how much of it shows, and the share of it that glows.
  const face = (age: number, noise: boolean, seed = 0.4): { red: number; blue: number; cover: number; glowing: number } => {
    const out = [0, 0, 0, 0];
    let [red, blue, cover, glowing, n] = [0, 0, 0, 0, 0];
    for (let u = 0; u < 4; u += 0.13) for (let v = 0; v < 4; v += 0.13) {
      lobeLight(out, u, v, 0.8, age, 1, seed, 0.04, 1, 1, 1, 1, noise, true, true);
      red += out[0]!;
      blue += out[2]!;
      cover += out[3]!;
      if (out[0]! > 0.5) glowing++;
      n++;
    }
    return { red: red / n, blue: blue / n, cover: cover / n, glowing: glowing / n };
  };
  for (const noise of [true, false]) {
    const [flash, fire, cracks, holes, gone] = [face(0.02, noise), face(0.25, noise), face(0.5, noise), face(0.8, noise), face(1, noise)];
    expect(flash.blue).toBeGreaterThan(2);
    expect([fire.red > 1, fire.blue < 0.5 * flash.blue, fire.glowing > 0.8]).toEqual([true, true, true]);
    expect([cracks.glowing > 0.02, cracks.glowing < 0.6, cracks.red < 0.5 * fire.red]).toEqual([true, true, true]);
    expect([holes.cover < 0.75 * cracks.cover, holes.cover > 0, holes.glowing < cracks.glowing]).toEqual([true, true, true]);
    expect(gone).toEqual({ red: 0, blue: 0, cover: 0, glowing: 0 });
  }
  // Its edge is soft: nothing where its surface is edge-on, and less than whole a little in from there.
  const out = [0, 0, 0, 0];
  lobeLight(out, 1.3, 2.1, 0, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, true, true, true);
  expect(out).toEqual([0, 0, 0, 0]);
  lobeLight(out, 1.3, 2.1, 0.12, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, true, true, true);
  expect([out[3]! > 0, out[3]! < 0.4]).toEqual([true, true]);
  // What it shows is weighed by how much of it shows, and hides no more than that.
  lobeLight(out, 1.3, 2.1, 0.9, 0.3, 1, 0.4, 0.04, 0.5, 1, 1, 1, true, true, true);
  const half = [...out];
  lobeLight(out, 1.3, 2.1, 0.9, 0.3, 1, 0.4, 0.04, 1, 1, 1, 1, true, true, true);
  half.forEach((v, c) => expect(v).toBeCloseTo(out[c]! / 2, 9));
  // Two seeds are two fires; the noise and the bands both stay within 0 and 1.
  let differ = 0;
  for (let k = 0; k < 200; k++) {
    const [u, v] = [16 * spread(k, 0.61), 16 * spread(k, 0.37)];
    if (Math.abs(lobeNoise(u, v, 0.2) - lobeNoise(u, v, 0.7)) > 0.05) differ++;
    for (const n of [lobeNoise(u, v, 0.2), lobeBands(u, v, 0.2), lobeBands(u, v, 0.9)]) expect([n >= 0, n <= 1]).toEqual([true, true]);
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
  putLobe(bytes, 0, 0, 2, 12, 2, 0.33, 0.6, 0.04, 0.8, 1);
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
  expect([fireFlat[0]!, fireFlat[1], fireFlat[4]!].map((v) => Math.round(v! * 100) / 100)).toEqual([0.33, 1, 0.8]);
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
      expect([text.defines.includes("FIRE_LIT"), text.defines.includes("FIRE_NOISE"), text.defines.includes("LIGHT_TARGET"), Object.keys(text.samplers)]).toEqual([tier.lit, tier.bursts.noise, light && tier.post !== null, []]);
      // No texture is read, and both texts name what they hand each other alike.
      expect(text.fragment.includes("texture(")).toBe(false);
      for (const name of ["vUv", "vFacing", "vLight", "vA", "vB"]) expect([text.vertex.includes(name), text.fragment.includes(name)]).toEqual([true, true]);
    }
  }
  // Low poly and a phone draw one lobe in bands; the rest three with the noise.
  expect(TIERS.map((t) => [t.name, t.bursts.lobes, t.bursts.noise, t.bursts.particles])).toEqual([["lowpoly", 1, false, 20], ["medium", 3, true, 60], ["high", 3, true, 100], ["ultra", 3, true, 160]]);
  expect(["medium", "high"].map((name) => forTouch(tierOf(name), true).bursts)).toEqual([{ particles: 60, lobes: 1, noise: false }, { particles: 100, lobes: 1, noise: false }]);
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
