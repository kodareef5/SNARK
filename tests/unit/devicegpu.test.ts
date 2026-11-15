// The device probe's GPU questions on a context made of numbers: what they read off a readback, the blocks the memory
// step fills its tiles with, the slope fit, the context's state put back, deadlines and a lost context, and what the
// context's compiler refuses, which every program the probe draws with goes through.

import { expect, test } from "bun:test";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { GL, GpuQuestions, PROBE_UNITS, compareKind, filterKind, fitLine, lookFrom, saveState, seamCount, solidBlock, type GpuPlan } from "../../client/core/devicegpu.ts";
import { AIR, SKY_VERTEX } from "../../client/core/render/atmosphere.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FLAT_MESH_VERTEX, LIT_FRAGMENT } from "../../client/core/render/glsl.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { shadowDefines } from "../../client/core/render/shadowtext.ts";
import { SKY_GLSL } from "../../client/core/render/sky.ts";
import { SURFACE_VERTEX, surfaceFragment } from "../../client/core/render/surface.ts";
import { TextureMemory } from "../../client/core/devicescene.ts";
import { decodeAstcBlock } from "../../tools/pack/astc.ts";
import { decodeBc7 } from "../../tools/pack/bc.ts";
import { fakeGl } from "../fixtures/gl.ts";

test("a line is fitted by least squares, with the slope's standard error; too few points or one k give none", () => {
  expect(fitLine([[1, 3], [2, 5], [4, 9], [8, 17]])).toEqual({ slope: 2, error: 0 });
  const noisy = fitLine([[1, 3.2], [2, 4.7], [4, 9.3], [8, 16.8]])!;
  expect(noisy.slope).toBeCloseTo(1.972, 3);
  expect(noisy.error).toBeGreaterThan(0.05);
  expect(fitLine([[1, 1], [2, 2]])).toBeNull();
  expect(fitLine([[4, 1], [4, 2], [4, 3]])).toBeNull();
});

test("a compared lookup between texels reads as filtered or hard, and a 3D texture's sample as filtered or nearest", () => {
  expect(compareKind(128, 64)).toBe("filtered");
  expect(compareKind(0, 0)).toBe("hard");
  expect(compareKind(255, 0)).toBe("hard");
  expect(compareKind(200, 10)).toBe("neither (200 halfway, 10 a quarter of the way, of 255)");
  expect(filterKind([64, 127, 190, 255], [64, 128, 191, 255])).toBe("filters");
  expect(filterKind([0, 255, 255, 255], [64, 128, 191, 255])).toBe("nearest only");
  expect(filterKind([90, 128, 191, 255], [64, 128, 191, 255])).toBe("wrong (90,128,191, not 64,128,191)");
});

test("the memory step's blocks decode to the colour it reads back for, by the repository's own decoders", () => {
  const bc = solidBlock("bc");
  expect(Array.from(decodeBc7(bc.bytes, 4, 4))).toEqual(Array.from({ length: 64 }, (_, i) => bc.rgba[i % 4]!));
  const astc = solidBlock("astc");
  const out = new Uint8Array(64);
  expect(decodeAstcBlock(astc.bytes, 0, false, out)).toBe(true);
  expect(Array.from(out)).toEqual(Array.from({ length: 64 }, (_, i) => astc.rgba[i % 4]!));
  expect(solidBlock("rgba").bytes.length).toBe(64);
});

test("the seam's view is the game camera's, and a turn counts pixels in neither range and pixels the seam crosses", () => {
  const cam = new Camera();
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect, cam.near, cam.far] = [0.7, -0.4, 0.5, 16 / 9, 0.25, 6000];
  cam.update();
  const mine = lookFrom(0.7, -0.4, 0.5, 16 / 9, 0.25, 6000);
  for (let i = 0; i < 16; i++) expect(mine[i]!).toBeCloseTo(cam.viewProj[i]!, 5);
  // Four rows of two pixels: near, near, far, clear.
  const px = Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 128, 0, 255, 0, 128, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  expect(seamCount(px, 2, 4)).toEqual({ gaps: 2, crossing: 2 });
});

test("the fake context draws nothing for a program whose frame block has no buffer, as WebGL does", () => {
  const gl = fakeGl({ drawn: () => void drawn++ });
  let drawn = 0;
  const lit = gl.createProgram();
  const shader = gl.createShader(GL.FRAGMENT_SHADER);
  gl.shaderSource(shader, "layout(std140) uniform Frame { vec4 fSun; };");
  gl.attachShader(lit, shader);
  gl.useProgram(lit);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.uniformBlockBinding(lit, gl.getUniformBlockIndex(lit, "Frame"), 1);
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  gl.bindBufferBase(GL.UNIFORM_BUFFER, 1, gl.createBuffer());
  gl.drawArrays(GL.TRIANGLES, 0, 3);
  expect([gl.invalid, drawn]).toEqual([["a draw by a program whose frame block has no buffer or binding", "a draw by a program whose frame block has no buffer on binding 1"], 1]);
});

test("what the probe changes of a context is put back as it was", () => {
  const gl = fakeGl();
  gl.activeTexture(GL.TEXTURE0 + 3);
  gl.bindTexture(GL.TEXTURE_2D, "bones");
  gl.activeTexture(GL.TEXTURE0 + 9);
  gl.bindTexture(GL.TEXTURE_2D_ARRAY, "shadows");
  gl.activeTexture(GL.TEXTURE0 + 4);
  gl.enable(GL.DEPTH_TEST);
  gl.useProgram("flat");
  const before = new Map(gl.state);
  const restore = saveState(gl);
  for (const u of PROBE_UNITS) {
    gl.activeTexture(GL.TEXTURE0 + u);
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, "probe");
  }
  gl.disable(GL.DEPTH_TEST);
  gl.enable(GL.BLEND);
  gl.useProgram("probe");
  gl.bindFramebuffer(GL.FRAMEBUFFER, "target");
  gl.viewport(0, 0, 4, 4);
  gl.depthRange(0.5, 1);
  gl.blendEquationSeparate(GL.MIN, GL.MIN);
  restore();
  expect(gl.state).toEqual(before);
  expect([gl.isEnabled(GL.DEPTH_TEST), gl.isEnabled(GL.BLEND)]).toEqual([true, false]);
  expect([gl.units.get(GL.TEXTURE0 + 3)!.get(GL.TEXTURE_BINDING_2D), gl.units.get(GL.TEXTURE0 + 9)!.get(GL.TEXTURE_BINDING_2D_ARRAY)]).toEqual(["bones", "shadows"]);
});

/** Compiles and links two texts on the fake context: what it says, empty if it took them. */
function link(vertex: string, fragment: string): string {
  const gl = fakeGl();
  const program = gl.createProgram();
  const said: string[] = [];
  for (const [type, text] of [[GL.VERTEX_SHADER, vertex], [GL.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) said.push(gl.getShaderInfoLog(shader) ?? "");
    gl.attachShader(program, shader);
  }
  if (said.length > 0) return said.join("\n");
  gl.linkProgram(program);
  return gl.getProgramParameter(program, GL.LINK_STATUS) ? "" : (gl.getProgramInfoLog(program) ?? "");
}

test("the fake context refuses the probe's SURFACE pass as the dome left it, and what else a GPU would refuse that it can see", () => {
  // The sky table's lookup where the air now goes: what Chrome said (at line 100 of the text then), and a prototype with no body.
  expect(link(SURFACE_VERTEX, surfaceFragment("astc", SKY_GLSL))).toMatch(/^ERROR: 0:\d+: 'skyFrom' : no matching overloaded function found\nERROR: 'hazed' : function is called but never defined$/);
  expect(link(SURFACE_VERTEX, surfaceFragment("astc", AIR))).toBe("");
  // The shadow lookup's branches are taken as the defines say: SHADOW_SIZE is a name only where shadows are defined.
  const shadows = shadowDefines(tierOf("high").shadows, true);
  const sized = surfaceFragment("astc", AIR).replace("float sunShadow(vec3 rel, vec3 normal) {\n  return 1.0;", "float sunShadow(vec3 rel, vec3 normal) {\n  return SHADOW_SIZE;");
  expect([link(SURFACE_VERTEX, withDefines(surfaceFragment("astc", AIR), shadows)), link(SURFACE_VERTEX, withDefines(sized, shadows))]).toEqual(["", ""]);
  expect(link(SURFACE_VERTEX, sized)).toMatch(/^ERROR: 0:\d+: 'SHADOW_SIZE' : undeclared identifier$/);
  // A name the frame block does not have, a call with an argument too many, and a line before the version.
  expect(link(SKY_VERTEX.replace("fCloudSun.rgb", "fCloudLight.rgb"), LIT_FRAGMENT)).toMatch(/^ERROR: 0:\d+: 'fCloudLight' : undeclared identifier$/);
  expect(link(FLAT_MESH_VERTEX, LIT_FRAGMENT.replace("sunShadow(vRel, n)), vRel)", "sunShadow(vRel, n), 1.0), vRel)"))).toMatch(/'lit' : no matching overloaded function found$/);
  expect(link(FLAT_MESH_VERTEX, withDefines(LIT_FRAGMENT, "#define SHADOWS 1\n"))).toBe("");
  expect(link(FLAT_MESH_VERTEX, "#define SHADOWS 1\n" + LIT_FRAGMENT)).toMatch(/'#version' : must be the text's first line/);
  // Linking: SURFACE's fragment behind FLAT's vertex text, which writes vRel but not the rest, and vColor flat where LIT reads it smooth.
  expect(link(FLAT_MESH_VERTEX, surfaceFragment("rgba", AIR)).split("\n")[0]).toBe("ERROR: 'vNormal' : the fragment reads it as vec3, and the vertex text does not write it");
  expect(link(FLAT_MESH_VERTEX, LIT_FRAGMENT.replace("flat in vec3 vColor;", "in vec3 vColor;"))).toBe("ERROR: 'vColor' : the fragment reads it as vec3, and the vertex text writes it as flat vec3");
});

test("every program of the game's table compiles and links on the fake context, on every tier and texture variant, compared lookups hard or not", () => {
  for (const tier of TIERS) {
    for (const format of ["rgba", "bc", "astc"] as const) {
      for (const [name, make] of Object.entries(PROGRAMS)) {
        for (const hard of [false, true]) {
          const t = make(tier, format, hard);
          expect(`${tier.name} ${format} ${name}: ${link(withDefines(t.vertex, t.defines), withDefines(t.fragment, t.defines))}`).toBe(`${tier.name} ${format} ${name}: `);
        }
      }
    }
  }
});

const PLAN: GpuPlan = { depthSizes: [1024, 2048], checkMs: 3000, passMs: 10000 };

/** A context whose clock moves as the GPU works: a depth pass's draw costs 0.2 ms and any other draw 0.01. Its timer queries read that clock. */
function timedCard(timer = false) {
  let clock = 0;
  let timing = { begun: 0, ms: 0 };
  const gl = fakeGl({
    drawn: (elements) => void (clock += elements ? 0.2 : 0.01),
    with: {
      getExtension: (name: string) => (timer && name === "EXT_disjoint_timer_query_webgl2" ? { TIME_ELAPSED_EXT: GL.TIME_ELAPSED } : null),
      createQuery: () => ({ begun: 0, ms: 0 }),
      beginQuery: (_: number, q: typeof timing) => void ((timing = q).begun = clock),
      endQuery: () => void (timing.ms = clock - timing.begun),
      getQueryParameter: (q: typeof timing, name: number) => (name === GL.QUERY_RESULT_AVAILABLE ? true : q.ms * 1e6),
    },
  });
  return { gl, now: () => clock, tick: (ms: number) => void (clock += ms) };
}

function ask(q: GpuQuestions, each: () => void = () => {}): number {
  let frames = 0;
  while (!q.frame() && frames < 2000) {
    frames++;
    each();
  }
  return frames;
}

test("every question is answered, a pass's cost is the slope of time against passes drawn, and timer queries are read where there are some", () => {
  const card = timedCard(true);
  const before = new Map(card.gl.state);
  const q = new GpuQuestions(card.gl, () => card.gl.createTexture(), card.now, "astc", [390, 844], PLAN);
  const frames = ask(q, () => expect(card.gl.state).toEqual(before));
  expect(frames).toBeLessThan(400);
  const r = q.report;
  expect([r.timers, r.lostDuring]).toEqual([true, null]);
  // The fake reads every pixel back as grey: no answer is a yes, and none is left unasked.
  expect(r.depthRange).toBe("neither (read 128,128,128)");
  expect(r.seam).toEqual({ crossing: 0, overlap: 0, flush: 0 });
  expect([r.depthArray, r.compareArray, r.texture3d]).toEqual(["did not render (read 128 and 128 at texel centres, not 0 and 255)", "not known", "wrong (128,128,128, not 64,128,191)"]);
  // Every pixel opaque: the far blocks' edge kept whole, where the rule keeps half.
  expect(r.farEdge).toEqual({ kept: 1, rule: 0.5 });
  const per = (name: string) => r.passes.find((p) => p.name === name)!;
  for (const p of r.passes) expect(p.note).toBe("");
  // A 100k-triangle pass costs what its draw does, scaled from the field's 100,352 triangles; a full-screen one 0.01 ms over 390 by 844.
  expect(per("depth rigid 1024")).toMatchObject({ slope: 0.199, error: 0, timer: 0.199, k: 128 });
  expect(per("depth skinned 2048").slope).toBe(0.199);
  expect(per("flat")).toMatchObject({ slope: 0.03, timer: 0.03, k: 512 });
  expect(per("9 taps").slope).toBe(0.03);
  // The game's lit programs read noon's frame block: every draw of theirs had its buffer, or the fake would have drawn nothing.
  expect(["lit", "lit haze 3.5 km", "far", "surface", "surface layered", "sky table", "sky 2 layers", "water waves", "lit on the sea", "lit shadowed"].map((n) => per(n).slope)).toEqual(Array(10).fill(0.03));
  expect(card.gl.invalid).toEqual([]);
  // A draw's 0.01 ms on the clock: 1,000 of them are enough to time.
  expect(per("draw")).toMatchObject({ slope: 10, error: 0, k: 1000 });
  // Only the probe's own units were bound on.
  expect([...card.gl.boundOn].every((u) => PROBE_UNITS.includes(u))).toBe(true);
});

test("a question past its deadline says it did not finish, and a lost context names the question it hit and asks no more", () => {
  const slow = timedCard();
  const late = new GpuQuestions(slow.gl, () => slow.gl.createTexture(), slow.now, "bc", [390, 844], PLAN);
  ask(late, () => slow.tick(4000));
  expect([late.report.depthRange, late.report.seam]).toEqual(["neither (read 128,128,128)", "did not finish"]);
  expect(late.report.passes.map((p) => p.note)).toEqual(Array(23).fill("did not finish"));

  const card = timedCard();
  const q = new GpuQuestions(card.gl, () => card.gl.createTexture(), card.now, "rgba", [390, 844], PLAN);
  // On to the first pass, and one frame into it.
  while (q.stage !== "flat") q.frame();
  q.frame();
  card.gl.lose();
  q.lost();
  expect(q.frame()).toBe(true);
  const r = q.report;
  expect(r.lostDuring).toBe("flat");
  expect(r.passes[0]!.note).toBe("lost the context");
  expect(r.passes.slice(1).map((p) => p.note)).toEqual(Array(22).fill("not asked: the context was lost during flat"));

  // Lost in the middle of a question's step: what it read is not its answer.
  const dying: ReturnType<typeof fakeGl> = fakeGl({ read: () => dying.lose() });
  const cut = new GpuQuestions(dying, () => dying.createTexture(), () => 0, "astc", [390, 844], PLAN);
  ask(cut);
  expect([cut.report.lostDuring, cut.report.depthRange, cut.report.nearGap, cut.report.texture3d, cut.report.farEdge]).toEqual(["depth", "lost the context", null, "not asked: the context was lost during depth", "not asked: the context was lost during depth"]);
});

test("the memory step samples every tile and reads back the colour its blocks hold, or says what it read", () => {
  const sampled = (read?: (out: Uint8Array) => void) => {
    const gl = fakeGl(read ? { read } : {});
    const before = new Map(gl.state);
    const mem = new TextureMemory(gl, () => gl.createTexture(), "bc");
    mem.grow(300, 300);
    let frames = 0;
    for (; mem.sweeps === 0 && frames < 10; frames++) mem.touch();
    expect(gl.state).toEqual(before);
    return [frames, mem.read];
  };
  // 120 tiles a frame: 300 in three.
  expect(sampled()).toEqual([3, "right"]);
  expect(sampled((out) => out.fill(0))).toEqual([3, "read back as 0,0,0,0, not 129,129,129,255"]);
});
