// The sun's shadow maps as numbers and text (shadowtext.ts, shadowfilter.ts): the taps share a lookup out over the
// texels as the filter's kernel says, a pixel hands over to the next cascade in even steps and the farthest fades out,
// the lit programs carry the tier's shadows, the maps' bytes come off the card's budget, the rasterizer lights as if
// in the sun, and the game asks the device what its compared lookups give and leaves the context as it was.
import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { GL } from "../../client/core/devicegpu.ts";
import { ladder } from "../../client/core/governor.ts";
import { tierWithout } from "../../client/core/passes.ts";
import { FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { FRAME, FRAME_FLOATS, MAX_CASCADES } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT } from "../../client/core/render/programs.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { comparedLookup } from "../../client/core/render/shadowfilter.ts";
import { DEPTH_VERTEX, EDGE, axisWeights, clampDepth, handOver, shadowBytes, shadowCascade, shadowKernel } from "../../client/core/render/shadowtext.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { lit } from "../../client/core/render/surface.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { fakeGl } from "../fixtures/gl.ts";
import { corePack } from "../fixtures/pack.ts";

test("the taps share a lookup out over the texels as the kernel says, for 1, 4 and 9 taps", () => {
  const out = new Float64Array(6);
  for (const m of [1, 2, 3]) {
    for (let k = 0; k < 40; k++) {
      const s = k / 40;
      axisWeights(m, s, out);
      for (let j = 0; j < 2 * m; j++) expect(out[j]!).toBeCloseTo(shadowKernel(m, j - m + 1 - s), 12);
      expect(out.subarray(0, 2 * m).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  }
  // A tent a texel either side, a tent two either side, and a bell three either side.
  expect([1, 2, 3].map((m) => [shadowKernel(m, 0), shadowKernel(m, m)])).toEqual([[1, 0], [0.5, 0], [4 / 12, 0]]);
});

test("over the last tenth of its sphere a pixel hands over to the next cascade in sixteenths, and the farthest fades out", () => {
  const spheres = [0, 0, 5, 10, 0, 0, 30, 40];
  const share = (z: number, k: number): number => Math.abs(z - spheres[k * 4 + 2]!) / spheres[k * 4 + 3]!;
  expect(new Set(Array.from({ length: 16 }, (_, i) => handOver(i & 3, i >> 2))).size).toBe(16);
  for (const t of [0.5, 0.9, 0.925, 0.95, 0.975, 0.999]) {
    const z = 5 + t * 10;
    let next = 0;
    for (let i = 0; i < 16; i++) next += shadowCascade(0, 0, z, spheres, 2, i & 3, i >> 2).cascade;
    expect(next / 16).toBeCloseTo(Math.max(0, (t - 1 + EDGE) / EDGE), 1);
  }
  expect(shadowCascade(0, 0, 60, spheres, 2, 0, 0)).toEqual({ cascade: 1, fade: 0 });
  expect(shadowCascade(0, 0, 68, spheres, 2, 0, 0).fade).toBeCloseTo((share(68, 1) - 1 + EDGE) / EDGE, 9);
  expect(shadowCascade(0, 0, 71, spheres, 2, 0, 0).cascade).toBe(-1);
  expect(shadowCascade(0, 0, 7, spheres, 0, 0, 0).cascade).toBe(-1);
});

test("the lit tiers look the sun's shadow up as their tier says, with the same texts down the governor's steps, a device that compares hard in the shader, and casters keep the view's heights", () => {
  for (const tier of TIERS) {
    for (const name of ["flat", "terrain", "seeThrough", "far", "surface"]) {
      const p = PROGRAMS[name]!(tier, "rgba");
      if (!tier.lit) {
        if (name !== "surface") expect([p.defines, "uShadow" in p.samplers]).toEqual(["", false]);
        continue;
      }
      const { taps, size } = tier.shadows;
      expect(p.defines).toBe(`#define SHADOW_CASCADES ${MAX_CASCADES}\n#define SHADOW_TAPS ${Math.sqrt(taps)}\n#define SHADOW_SIZE ${size}.0\n`);
      expect(p.samplers.uShadow).toBe(UNIT.shadow);
      expect(PROGRAMS[name]!(tier, "rgba", true).defines).toEndWith("#define SHADOW_HARD\n");
      // One cascade fewer, none, or shadows turned off: the lookup stops at the frame's cascades, and nothing is compiled again.
      for (const touch of [false, true]) {
        const top = forTouch(tier, touch);
        const steps = [...ladder(top, 2).map((l) => l.tier), tierWithout(top, new Set(["shadows" as const]))];
        expect(steps.some((t) => t.shadows.cascades === 0)).toBe(true);
        for (const t of steps) expect(PROGRAMS[name]!(t, "rgba")).toEqual(PROGRAMS[name]!(top, "rgba"));
      }
    }
  }
  // What lies sunward of a cascade is flattened onto its near face; the ground is placed by the view's own text.
  expect(DEPTH_VERTEX).toContain("gl_Position.z = max(gl_Position.z, -gl_Position.w);\n}");
  expect(clampDepth(FLAT_TERRAIN_VERTEX).startsWith(FLAT_TERRAIN_VERTEX.slice(0, -2))).toBe(true);
  expect(PROGRAMS.depthTerrainWindow!(tierOf("medium"), "rgba").samplers.uHeight).toBe(UNIT.windowHeights);
});

test("a tier's maps are a 16-bit layer a cascade, 16, 24 and 32 MB, and come off the card's budget on the lit tiers", () => {
  expect(TIERS.map((t) => shadowBytes(t.shadows) / 2 ** 20)).toEqual([0, 16, 24, 32]);
  const reg = compileContent(CORE_CONTENT).registry!;
  const dims = { chunksX: 1, chunksZ: 1 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  const scene = new Scene({ dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) }, reg, corePack());
  const cam = new Camera();
  [cam.x, cam.y, cam.z] = [32, 2, 32];
  const reserved = (tier: string): number => {
    scene.assets.tier = tierOf(tier);
    scene.build(cam, null);
    return scene.assets.residency.reserved;
  };
  expect(reserved("medium") - reserved("lowpoly")).toBe(shadowBytes(tierOf("medium").shadows));
});

test("the rasterizer lights as if in the sun, and a pixel out of it loses the sun's own light and nothing else", () => {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(10, theSky(), frame);
  const [albedo, mro, n, v, mirror] = [[0.4, 0.3, 0.2], [1, 0.5, 0], [0, 1, 0], [0.6, 0.8, 0], [0.2, 0.3, 0.5]];
  const [a, b, c] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  lit(a, albedo, mro, n, v, frame, mirror);
  lit(b, albedo, mro, n, v, frame, mirror, 1);
  expect(a).toEqual(b);
  lit(b, albedo, mro, n, v, frame, mirror, 0);
  frame.fill(0, FRAME.sunColor, FRAME.sunColor + 3);
  lit(c, albedo, mro, n, v, frame, mirror);
  expect(b).toEqual(c);
  expect(a[0]!).toBeGreaterThan(b[0]! * 1.5);
});

test("the game asks what compared lookups give as the device probe does, and leaves the context as it found it", () => {
  const answer = (pixels: number[]) => {
    const gl = fakeGl({ read: (out) => pixels.forEach((r, i) => out.set([r, 0, 0, 255], i * 4)) });
    const kind = comparedLookup(gl);
    return { kind, depth: gl.state.get(GL.DEPTH_CLEAR_VALUE), program: gl.state.get(GL.CURRENT_PROGRAM), framebuffer: gl.state.get(GL.DRAW_FRAMEBUFFER_BINDING) };
  };
  expect(answer([128, 64, 0, 255])).toEqual({ kind: "filtered", depth: 1, program: null, framebuffer: null });
  expect(answer([255, 255, 0, 255]).kind).toBe("hard");
  expect(answer([0, 0, 0, 0]).kind).toStartWith("did not render");
});
