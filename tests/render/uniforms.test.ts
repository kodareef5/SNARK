// A program's uniforms are rows a shell walks (client/core/render/uniforms.ts). The shell has no tests, so these hold
// the rows to the texts, and what each row reads to what the shell's own lines read before them.
import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_HEAT_SHIFT, DRAW_PLAIN, DRAW_PULLED, DRAW_SKINNED, DRAW_TEXTURED, FRAME, FramePacket, HEAT_WARM, SOURCE_WINDOW } from "../../client/core/render/packet.ts";
import { PROGRAM, PROGRAMS, UNIFORMS } from "../../client/core/render/programs.ts";
import { WATER_ALPHA } from "../../client/core/render/shading.ts";
import { LAYER_LEVELS } from "../../client/core/render/surface.ts";
import { AT_DRAW, AT_FRAME, AT_LINK, AT_TILES, Drawn, SEND_1F, SEND_1UI, SEND_3FV, SEND_4FV, SEND_FLOATS, SHELL_UNIFORMS, type UniformRow } from "../../client/core/render/uniforms.ts";
import { CELL } from "../../shared/pack/details.ts";
import { TEXTURE_FORMATS } from "../../shared/pack/texture.ts";

/** Uniforms a program declares and nothing sets: they hold 0, the world's own heat and no span, from when it links. */
const LEFT: Record<string, readonly string[]> = { sky: ["uHeat"], details: ["uHeat"], terrain: ["uHeat"], terrainWindow: ["uHeat"], depth: ["uUv"] };

test("every uniform a program declares is a row of its list, or one of the shell's own", () => {
  const own: readonly string[] = SHELL_UNIFORMS;
  for (const tier of TIERS) for (const format of TEXTURE_FORMATS) for (const light of [false, true]) {
    for (const [name, make] of Object.entries(PROGRAMS)) {
      const text = make(tier, format, false, light), rows = UNIFORMS[PROGRAM[name as keyof typeof PROGRAM]]!.map((r) => r.name);
      const declared = [...(text.vertex + text.fragment).matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([^;{]+);/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim().replace(/\[.*\]/, "")));
      const unset = declared.filter((u) => !(u in text.samplers) && !rows.includes(u) && !own.includes(u) && !(LEFT[name] ?? []).includes(u));
      expect(`${tier.name} ${name}: ${unset.join(" ")}`).toBe(`${tier.name} ${name}: `);
    }
  }
});

test("a row has the reader its kind of send takes, and only a row of one float starts with a number", () => {
  for (const row of new Set(UNIFORMS.flat())) {
    // A row set when its program links alone has its start and no reader.
    const kind = row.at === AT_LINK ? "start" : row.send <= SEND_1UI ? "value" : row.send >= SEND_3FV ? "array" : "fill";
    expect([row.name, row.value !== null, row.fill !== null, row.array !== null]).toEqual([row.name, kind === "value", kind === "fill", kind === "array"]);
    if (kind === "array") expect(row.key).not.toBeNull();
    if (kind === "fill") expect(SEND_FLOATS[row.send]).toBeGreaterThan(1);
    if (row.start !== null) expect(row.send).toBe(SEND_1F);
    expect([AT_LINK, AT_FRAME, AT_DRAW, AT_TILES]).toContain(row.at);
    if (kind === "start") expect(row.start).not.toBeNull();
  }
});

/** What rows read, over a pack of one rig, two meshes and two materials. */
function drawn(): Drawn {
  const pack = { header: { rigs: [{ rest: Array.from({ length: 120 }, (_, k) => k) }], details: { atlas: { side: 512 } } } };
  const materials = [{ tint: [0.1, 0.2, 0.3], grey: 0.4, cutoff: 0.5, sheet: 0.25, emissive: 2, flags: 0 }, { tint: [1, 1, 1], grey: 0, cutoff: 0, emissive: 0, flags: 0 }];
  const meshes = [{ uv: [0.5, 0.25, 2, 4], rig: 0 }, {}];
  const c = new Drawn(pack as never, { minY: -7, stepY: 0.125 } as never, { width: [100, 300], height: [200, 400], cell: [8, 1], bytes: 0 }, materials as never, meshes as never, Uint8Array.of(0, 3));
  c.p = new FramePacket();
  return c;
}
const rowOf = (program: keyof typeof PROGRAM, name: string, at = AT_DRAW): UniformRow => UNIFORMS[PROGRAM[program]]!.find((r) => r.name === name && r.at === at)!;
const floats = (row: UniformRow, c: Drawn): number[] => {
  const out = new Float64Array(4).fill(NaN);
  row.fill!(c, out);
  return [...out.subarray(0, SEND_FLOATS[row.send])];
};

test("a draw's rows read its columns of the packet, its flags, its mesh and its material", () => {
  const c = drawn(), p = c.p;
  c.d = 5;
  c.mesh = 1;
  c.flags = DRAW_PLAIN | (HEAT_WARM << DRAW_HEAT_SHIFT);
  p.drawFade[5] = 120;
  p.drawFixture[5] = -1;
  p.drawEffect.set(Float32Array.of(1, 2, 3, 4), 20);
  expect(["uFade", "uHeat", "uFixture", "uSolid", "uAlpha"].map((n) => rowOf("far", n).value!(c))).toEqual([120, HEAT_WARM, -1, 2 + 3, 1]);
  expect(floats(rowOf("far", "uEffect"), c)).toEqual([1, 2, 3, 4]);
  // Chequered unless plain, or on a lit frame sized or pulled; see-through only where its mesh has no finishes.
  c.flags = DRAW_PULLED | DRAW_BLEND;
  expect([rowOf("flat", "uSolid").value!(c), rowOf("flat", "uAlpha").value!(c)]).toEqual([1, 1]);
  p.lit = true;
  c.mesh = 0;
  expect([rowOf("flat", "uSolid").value!(c), rowOf("flat", "uAlpha").value!(c)]).toEqual([2, WATER_ALPHA]);
  expect(rowOf("flat", "uAlpha").start).toBe(1);

  c.flags = DRAW_TEXTURED | DRAW_SKINNED;
  c.m = 0;
  c.material = c.materials[0];
  p.drawLayer[5] = 16;
  p.drawWear[5] = 2;
  p.drawWheelBones[5] = 0;
  const wheels = rowOf("surface", "uWheelCenters");
  expect([wheels.key!(c), wheels.array!(c)]).toEqual([0, null]);
  p.drawWheelBones[5] = 9;
  expect(wheels.array!(c)).toEqual(Float32Array.from({ length: 96 }, (_, k) => k));
  expect(floats(rowOf("surface", "uTint"), c)).toEqual([0.1, 0.2, 0.3]);
  expect(rowOf("surface", "uTint").key!(c)).toBe(0);
  expect(["uGrey", "uCutoff", "uSheet", "uEmissive", "uWheelBones"].map((n) => rowOf("surface", n).value!(c))).toEqual([0.4, 0, 0.25, 2, 9]);
  expect(["uLevel", "uWear"].map((n) => rowOf("surfaceLayer", n).value!(c))).toEqual([16 / LAYER_LEVELS, 2]);
  expect(rowOf("surface", "uUv").array!(c)).toEqual([0.5, 0.25, 2, 4]);
  // A draw reads its level's skin entries only with a material; a caster whenever the level has them.
  c.skinned = true;
  expect([rowOf("surface", "uSkin").value!(c), rowOf("depth", "uSkin").value!(c)]).toEqual([3, 3]);
  c.flags = DRAW_SKINNED | DRAW_CUTOUT;
  c.mesh = 1;
  expect([rowOf("flat", "uSkin").value!(c), rowOf("depthCutout", "uSkin").value!(c), rowOf("depthCutout", "uCutoff").value!(c)]).toEqual([1, 3, 0.5]);
  expect(rowOf("depthCutout", "uUv").array!(c)).toEqual([0, 0, 1, 1]);
});

test("a frame's rows read the packet once a frame, and the ground's rows the pair of pictures their program reads", () => {
  const c = drawn(), p = c.p;
  c.serial = 41;
  p.camX = 35;
  p.camY = 20;
  p.camZ = -3;
  p.fogStart = 10;
  p.fogEnd = 90;
  p.cascadeCount = 3;
  p.sky.set(Float32Array.of(1, 2, 3));
  p.skyShown.set(Float32Array.of(4, 5, 6));
  p.frame[FRAME.exposure] = 1;
  const frame = (name: string): UniformRow => rowOf("flat", name, AT_FRAME);
  expect([floats(frame("uFog"), c), floats(frame("uCamMod"), c), floats(frame("uWorldEye"), c), floats(frame("uField"), c)]).toEqual([[10, 90], [3, 4, -3], [35, 20, -3], [-7, 0.125, 8, 20]]);
  expect([frame("uFog").key!(c), frame("uSun").key!(c), frame("uCascades").value!(c)]).toEqual([41, 41, 3]);
  expect(frame("uSun").array!(c)).toBe(p.sun);
  expect(frame("uSky").array!(c)).toBe(p.skyShown);
  c.lightTarget = true;
  expect(frame("uSky").array!(c)).toBe(p.sky);
  expect([frame("uWorldPhase").send, frame("uSurfaceCity").send]).toEqual([SEND_3FV, SEND_4FV]);

  expect(floats(rowOf("terrain", "uField", AT_TILES), c)).toEqual([-7, 0.125, 8, 20]);
  expect(floats(rowOf("terrainWindow", "uField", AT_TILES), c)).toEqual([-7, 0.125, 1, 20]);
  expect([floats(rowOf("terrain", "uLast", AT_TILES), c), floats(rowOf("depthTerrainWindow", "uLast", AT_TILES), c)]).toEqual([[99, 199], [300 - 1, 400 - 1]]);
  expect([rowOf("terrain", "uSolid", AT_TILES).value!(c), rowOf("terrain", "uAlpha", AT_LINK).start, SOURCE_WINDOW]).toEqual([0, 1, 1]);
  c.flags = DRAW_BLEND;
  expect(["uBlend", "uCells"].map((n) => rowOf("details", n).value!(c))).toEqual([1, 512 / CELL]);
});
