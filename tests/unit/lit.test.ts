// The lit tiers' light (D263, D264): the tone curve, the greys D155 holds the frame block to, the dyes, and LIT drawn
// beside SURFACE.
import { expect, test } from "bun:test";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { FLAT_FRAGMENT, LIT_FRAGMENT, LIT_MESH_FRAGMENT, LIT_TERRAIN_FRAGMENT } from "../../client/core/render/glsl.ts";
import { DRAW_BLEND, FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT } from "../../client/core/render/programs.ts";
import { SKY_GLSL, skyFrame, theSky } from "../../client/core/render/sky.ts";
import { KNEE, LIGHT, lit, linearToSrgb, shown, srgbToLinear, tone } from "../../client/core/render/surface.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { finishTable } from "../../shared/pack/finish.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { PICK_ENTITY } from "../../tools/snap/raster.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { Stage, picture, squareMesh } from "../fixtures/stage.ts";

const W = 160;
const H = 90;
const palette = defaultPalette();
const byte = (light: number): number => Math.round(255 * linearToSrgb(Math.min(Math.max(light, 0), 1)));

/** The hue of a colour as HSV has it, in degrees. */
function hue(c: readonly number[]): number {
  const [r, g, b] = c as [number, number, number];
  return (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI;
}

test("the tone curve keeps what is under its knee, meets the line there with slope 1, keeps hue above it and stays under 1", () => {
  const out = [0, 0, 0];
  tone(out, [KNEE, 0.3, 0.05]);
  expect(out).toEqual([KNEE, 0.3, 0.05]);
  // Either side of the knee a grey climbs as fast as the light does.
  for (const h of [1e-3, 1e-5]) {
    tone(out, [KNEE + h, KNEE + h, KNEE + h]);
    expect((out[0]! - KNEE) / h).toBeCloseTo(1, 2);
  }
  let last = 0;
  for (let light = KNEE; light < 64; light *= 1.01) {
    tone(out, [light, light, light]);
    expect([out[0]! > last, out[0]! < 1]).toEqual([true, true]);
    last = out[0]!;
  }
  // A bright saturated colour keeps its hue and goes toward white the brighter it is.
  for (const c of [[1.2, 0.3, 0.1], [0.9, 2.5, 0.4], [6, 1, 3]]) {
    tone(out, c);
    expect(Math.abs(hue(out) - hue(c))).toBeLessThan(1e-9);
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(Math.max(...c) - Math.min(...c));
  }
  // The shader's curve is written from the same knee, and LIT reads the shared light.
  expect([LIGHT.includes(`peak <= ${KNEE}`), LIT_FRAGMENT.includes(LIGHT)]).toEqual([true, true]);
});

test("the lit tiers draw flat meshes with LIT and their finishes and the ground with its own lit text, the dome from the table and SURFACE mirroring it; low poly keeps FLAT", () => {
  for (const tier of TIERS) {
    expect([PROGRAMS.flat!(tier, "rgba").fragment, PROGRAMS.terrain!(tier, "rgba").fragment]).toEqual(tier.lit ? [LIT_MESH_FRAGMENT, LIT_TERRAIN_FRAGMENT] : [FLAT_FRAGMENT, FLAT_FRAGMENT]);
    expect(PROGRAMS.flat!(tier, "rgba").vertex.includes("vFinish")).toBe(tier.lit);
  }
  const medium = tierOf("medium");
  for (const name of ["sky", "surface"]) expect([PROGRAMS[name]!(medium, "bc").fragment.includes(SKY_GLSL), PROGRAMS[name]!(medium, "bc").samplers.uSkyTable]).toEqual([true, UNIT.sky]);
});

/** A lit packet at noon with no fog. */
function noon(): FramePacket {
  const p = new FramePacket();
  p.lit = true;
  skyFrame(12, theSky(), p.frame);
  [p.fogStart, p.fogEnd] = [1e6, 2e6];
  return p;
}

/** The luminance of display values, as a display value. */
const shade = (c: ArrayLike<number>): number => 255 * linearToSrgb(0.2126 * srgbToLinear(c[0]! / 255) + 0.7152 * srgbToLinear(c[1]! / 255) + 0.0722 * srgbToLinear(c[2]! / 255));

test("at noon a mid-grey rough surface sunlit and seen head on shows 128, and one standing in its own shade a luminance of 70, bluer (D155 on the lit tiers)", () => {
  const p = noon();
  const grey = srgbToLinear(128 / 255);
  const sun = [...p.frame.subarray(FRAME.sun, FRAME.sun + 3)];
  const out = [0, 0, 0];
  const rgb = [0, 0, 0];
  lit(out, [grey, grey, grey], [1, 1, 0], sun, sun, p.frame, [0, 0, 0]);
  shown(rgb, out, 10, p);
  for (const c of rgb) expect(Math.abs(c * 255 - 128)).toBeLessThan(0.5);
  const back = [0, 0, -1];
  lit(out, [grey, grey, grey], [1, 1, 0], back, back, p.frame, [0, 0, 0]);
  shown(rgb, out, 10, p);
  const inShade = rgb.map((c) => c * 255);
  expect(Math.abs(shade(inShade) - 70)).toBeLessThan(0.5);
  expect(inShade[2]!).toBeGreaterThan(inShade[0]!);
  // Drawn: a square of palette grey standing with its back to the noon sun, flat and with its materials.
  const stage = new Stage(parsePack(buildPack([squareMesh("test:grey", 1, ["base"])], palette)), W, H);
  stage.raster.skyTable = theSky().table;
  [stage.cam.x, stage.cam.y, stage.cam.z] = [0, 0.5, -1.2];
  const middle = ((H / 2) * W + W / 2) * 4;
  for (const flat of [true, false]) {
    stage.begin();
    skyFrame(12, theSky(), stage.packet.frame);
    stage.texture(0, "base", [Uint8Array.of(128, 128, 128, 255)]);
    stage.add("test:grey", 0, { x: 0, y: 0, z: 0, yaw: Math.PI, flat });
    const pixels = stage.render();
    expect([stage.raster.pickKind[middle / 4], ...pixels.subarray(middle, middle + 3)]).toEqual([PICK_ENTITY, ...inShade.map(Math.round)]);
  }
});

test("sunlit and seen head on at noon, no dye is moved more than a step by the tone curve", () => {
  const p = noon();
  const sun = [...p.frame.subarray(FRAME.sun, FRAME.sun + 3)];
  const out = [0, 0, 0];
  const rgb = [0, 0, 0];
  let worst = 0;
  for (let dye = 22; dye <= 81; dye++) {
    const albedo = [0, 1, 2].map((c) => srgbToLinear(palette[dye * 4 + c]! / 255));
    lit(out, albedo, [1, 1, 0], sun, sun, p.frame, [0, 0, 0]);
    shown(rgb, out, 10, p);
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(Math.round(rgb[c]! * 255) - byte(out[c]!)));
  }
  expect(worst).toBe(1);
});

/** The square of one colour, flat in palette colour `color` and with its materials a base colour of that colour, fully rough. */
function block(color: number): Pack {
  const mesh = squareMesh("test:block", 1, ["base", "mro"]);
  mesh.lods[0]!.colors.fill(color);
  return parsePack(buildPack([mesh], palette));
}

test("a block drawn flat on a lit tier is that block with a base colour of its colour at roughness 1, within 2 steps", () => {
  const sunUp = Math.cos(Math.atan(0.43));
  let worst = 0;
  for (const color of [15, 22, 46, 10]) {
    const stage = new Stage(block(color), W, H);
    stage.raster.skyTable = theSky().table;
    [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch] = [0.6, 1.1, 1.3, Math.PI - 0.4, -0.3];
    // The noon sun, a low sun from the side, and the sun behind the block.
    for (const sun of [[0, sunUp, Math.sqrt(1 - sunUp * sunUp)], [0.9, 0.1, 0.42], [0.2, 0.5, -0.84]]) {
      const draw = (flat: boolean): Uint8ClampedArray => {
        stage.begin();
        skyFrame(12, theSky(), stage.packet.frame);
        stage.packet.frame.set(sun.map((v) => v / Math.hypot(...sun)), FRAME.sun);
        const rgb = [...palette.subarray(color * 4, color * 4 + 3)];
        stage.textures("test:block/", { base: picture(64, () => [...rgb, 255]), mro: picture(64, () => [255, 255, 0, 255]) });
        stage.add("test:block", 0, { x: 0, y: 0, z: 0, flat });
        return stage.render().slice();
      };
      const [flat, textured] = [draw(true), draw(false)];
      let covered = 0;
      for (let i = 0; i < W * H; i++) {
        if (stage.raster.pickKind[i] !== PICK_ENTITY) continue;
        covered++;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(flat[i * 4 + c]! - textured[i * 4 + c]!));
      }
      expect(covered).toBeGreaterThan(1500);
    }
  }
  expect(worst).toBeLessThanOrEqual(2);
});

test("a landmark's flat draw in a colour its art states is lit as that finish's picture is, gloss, metal and sheet, within 2 steps", () => {
  const sunUp = Math.cos(Math.atan(0.43));
  // Navy paint, brushed steel and sailcloth: each its own colour, occlusion, roughness, metalness and sheet, on palette colour 46.
  const finishes = [[22, 32, 43, 247, 71, 51, 0], [177, 185, 189, 247, 56, 235, 0], [235, 232, 221, 246, 199, 0, 179]];
  let worst = 0, behind = 0;
  for (const [r, g, b, o, rough, metal, sheet] of finishes as number[][]) {
    const mesh = squareMesh("yacht:block", 1, ["base", "mro"], { sheet: sheet! / 255 });
    mesh.lods[0]!.colors.fill(46);
    const pack = parsePack(buildPack([mesh], palette, [], [], null, [{ name: "yacht", pieces: [], counts: [[], []], finishes: [46, r!, g!, b!, o!, rough!, metal!, sheet!, 255] }]));
    const stage = new Stage(pack, W, H);
    stage.raster.skyTable = theSky().table;
    [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch] = [0.6, 1.1, 1.3, Math.PI - 0.4, -0.3];
    for (const sun of [[0, sunUp, Math.sqrt(1 - sunUp * sunUp)], [0.9, 0.1, 0.42], [0.2, 0.5, -0.84]]) {
      const draw = (flat: boolean): Uint8ClampedArray => {
        stage.begin();
        skyFrame(12, theSky(), stage.packet.frame);
        stage.packet.frame.set(sun.map((v) => v / Math.hypot(...sun)), FRAME.sun);
        stage.textures("yacht:block/", { base: picture(64, () => [r!, g!, b!, 255]), mro: picture(64, () => [o!, rough!, metal!, 255]) });
        stage.add("yacht:block", 0, { x: 0, y: 0, z: 0, flat });
        return stage.render().slice();
      };
      const [flat, textured] = [draw(true), draw(false)];
      for (let i = 0; i < W * H; i++) {
        if (stage.raster.pickKind[i] !== PICK_ENTITY) continue;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(flat[i * 4 + c]! - textured[i * 4 + c]!));
      }
      // The sun behind the sailcloth: its face toward the eye shows the light that comes through.
      if (sheet && sun[2]! < 0) {
        const lit = flat.findIndex((_, i) => i % 4 === 0 && stage.raster.pickKind[i / 4] === PICK_ENTITY);
        behind = shade(flat.subarray(lit, lit + 3));
      }
    }
  }
  expect(worst).toBeLessThanOrEqual(2);
  expect(behind).toBeGreaterThan(150);
  expect(finishTable(palette, { meshes: [{ id: "core:rock" }, { id: "yacht:block" }], landmarks: [{ name: "yacht", pieces: [], counts: [[], []], finishes: [46, 1, 2, 3, 4, 5, 6, 7, 255] }] }).row).toEqual(Uint8Array.from([0, 1]));
});

test("a line's finish is lit alike whichever way its faces turn, and drawn see-through shows its share of itself over what lies behind", () => {
  const mesh = squareMesh("yacht:wire", 1, []);
  mesh.lods[0]!.colors.fill(46);
  const draw = (share: number, flags: number, yaw = 0): Uint8ClampedArray => {
    const pack = parsePack(buildPack([mesh], palette, [], [], null, [{ name: "yacht", pieces: [], counts: [[], []], finishes: [46, 99, 105, 108, 247, 178, 31, 0, share] }]));
    const stage = new Stage(pack, W, H);
    [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch] = [0, 0.5, 1.5, Math.PI, 0];
    stage.begin();
    if (flags >= 0) stage.add("yacht:wire", 0, { x: 0, y: 0, z: 0, yaw, flat: true, flags });
    return stage.render().slice();
  };
  const middle = ((H / 2) * W + W / 2) * 4;
  const at = (picture: Uint8ClampedArray): number[] => Array.from(picture.subarray(middle, middle + 3));
  // A line's finish (a share under 255) turned half away from the eye is lit as it is facing it; a finish with none is not.
  const [line, turned, plain, plainTurned] = [draw(254, 0), draw(254, 0, 0.9), draw(255, 0), draw(255, 0, 0.9)];
  for (let c = 0; c < 3; c++) expect(Math.abs(turned[middle + c]! - line[middle + c]!)).toBeLessThanOrEqual(1);
  expect(at(plainTurned)).not.toEqual(at(plain));
  const [behind, half] = [draw(254, -1), draw(127, DRAW_BLEND)];
  for (let c = 0; c < 3; c++) expect(Math.abs(half[middle + c]! - (behind[middle + c]! + (line[middle + c]! - behind[middle + c]!) * (127 / 255)))).toBeLessThanOrEqual(1);
  expect(Math.abs(line[middle]! - behind[middle]!)).toBeGreaterThan(40);
});
