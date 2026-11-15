// The device probe's GPU questions, which round 8's depth ranges, sky table and shadow maps lean on: the depth the
// screen has and whether depthRange is honoured; whether compared lookups filter or give a hard 0 or 1; whether a
// 16-bit depth array renders and an RGBA8 3D texture filters; what share of the far blocks' dithered edge is kept; and
// what a pass costs the GPU. They are asked of the page's own WebGL 2 context after the game's frame, into targets of
// their own, and the context's state is put back as it was. The full-screen passes draw the game's own programs, from
// the table the renderer links (programs.ts), so a change to one changes the probe with it. Times come from timer
// queries where the browser has them, and otherwise from the slope of time against a pass drawn k times, timed across a
// readback that waits for the GPU; the fit's standard error says how noisy it was. Each question has a deadline and
// says "did not finish" past it, and a lost context ends them, naming the one it hit.

import { tierOf, type Tier } from "./assets/tiers.ts";
import { airFrame } from "./render/atmosphere.ts";
import { FAR_FROM } from "./render/camera.ts";
import { fadeKeeps } from "./render/far.ts";
import { FRAME, FRAME_FLOATS } from "./render/packet.ts";
import { PROGRAMS, withDefines, type ProgramText } from "./render/programs.ts";
import { SKY_SIZE, SKY_SLICES, skyFrame, theSky, trueSun } from "./render/sky.ts";
import type { TextureFormat } from "../../shared/pack/texture.ts";

type Obj = unknown;

/** What the GPU questions and the memory step ask of a WebGL 2 context. The numbers are WebGL's own (GL). */
export interface Gl2 {
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
  getError(): number;
  isContextLost(): boolean;
  createShader(type: number): Obj;
  shaderSource(shader: Obj, source: string): void;
  compileShader(shader: Obj): void;
  getShaderParameter(shader: Obj, name: number): unknown;
  getShaderInfoLog(shader: Obj): string | null;
  deleteShader(shader: Obj): void;
  createProgram(): Obj;
  attachShader(program: Obj, shader: Obj): void;
  linkProgram(program: Obj): void;
  getProgramParameter(program: Obj, name: number): unknown;
  getProgramInfoLog(program: Obj): string | null;
  useProgram(program: Obj): void;
  deleteProgram(program: Obj): void;
  getUniformLocation(program: Obj, name: string): Obj;
  getUniformBlockIndex(program: Obj, name: string): number;
  uniformBlockBinding(program: Obj, block: number, binding: number): void;
  bindBufferBase(target: number, index: number, buffer: Obj): void;
  getIndexedParameter(name: number, index: number): unknown;
  uniform1i(at: Obj, x: number): void;
  uniform1f(at: Obj, x: number): void;
  uniform2f(at: Obj, x: number, y: number): void;
  uniform3f(at: Obj, x: number, y: number, z: number): void;
  uniformMatrix4fv(at: Obj, transpose: boolean, value: Float32Array): void;
  createFramebuffer(): Obj;
  bindFramebuffer(target: number, framebuffer: Obj): void;
  framebufferTexture2D(target: number, attachment: number, textarget: number, texture: Obj, level: number): void;
  framebufferTextureLayer(target: number, attachment: number, texture: Obj, level: number, layer: number): void;
  framebufferRenderbuffer(target: number, attachment: number, renderbuffertarget: number, renderbuffer: Obj): void;
  checkFramebufferStatus(target: number): number;
  deleteFramebuffer(framebuffer: Obj): void;
  createRenderbuffer(): Obj;
  bindRenderbuffer(target: number, renderbuffer: Obj): void;
  renderbufferStorage(target: number, internal: number, width: number, height: number): void;
  deleteRenderbuffer(renderbuffer: Obj): void;
  createTexture(): Obj;
  deleteTexture(texture: Obj): void;
  bindTexture(target: number, texture: Obj): void;
  activeTexture(unit: number): void;
  texStorage2D(target: number, levels: number, internal: number, width: number, height: number): void;
  texStorage3D(target: number, levels: number, internal: number, width: number, height: number, depth: number): void;
  texSubImage2D(target: number, level: number, x: number, y: number, width: number, height: number, format: number, type: number, data: ArrayBufferView | null): void;
  texSubImage3D(target: number, level: number, x: number, y: number, z: number, width: number, height: number, depth: number, format: number, type: number, data: ArrayBufferView | null): void;
  compressedTexSubImage2D(target: number, level: number, x: number, y: number, width: number, height: number, format: number, data: ArrayBufferView): void;
  texParameteri(target: number, name: number, value: number): void;
  generateMipmap(target: number): void;
  createBuffer(): Obj;
  bindBuffer(target: number, buffer: Obj): void;
  bufferData(target: number, data: ArrayBufferView, usage: number): void;
  deleteBuffer(buffer: Obj): void;
  createVertexArray(): Obj;
  bindVertexArray(vao: Obj): void;
  deleteVertexArray(vao: Obj): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
  vertexAttribIPointer(index: number, size: number, type: number, stride: number, offset: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  clear(mask: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clearDepth(depth: number): void;
  enable(cap: number): void;
  disable(cap: number): void;
  isEnabled(cap: number): boolean;
  depthFunc(func: number): void;
  depthMask(flag: boolean): void;
  depthRange(near: number, far: number): void;
  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void;
  blendFuncSeparate(srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number): void;
  blendEquationSeparate(rgb: number, alpha: number): void;
  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, out: ArrayBufferView): void;
  createQuery(): Obj;
  beginQuery(target: number, query: Obj): void;
  endQuery(target: number): void;
  getQueryParameter(query: Obj, name: number): unknown;
  deleteQuery(query: Obj): void;
}

export const GL = {
  NO_ERROR: 0, OUT_OF_MEMORY: 0x0505, TRIANGLES: 4, FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
  FRAMEBUFFER: 0x8d40, READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9, RENDERBUFFER: 0x8d41, FRAMEBUFFER_COMPLETE: 0x8cd5,
  COLOR_ATTACHMENT0: 0x8ce0, DEPTH_ATTACHMENT: 0x8d00,
  TEXTURE_2D: 0x0de1, TEXTURE_3D: 0x806f, TEXTURE_2D_ARRAY: 0x8c1a, TEXTURE0: 0x84c0,
  RGBA: 0x1908, RGBA8: 0x8058, SRGB8_ALPHA8: 0x8c43, RGBA32F: 0x8814, DEPTH_COMPONENT: 0x1902, DEPTH_COMPONENT16: 0x81a5, DEPTH_COMPONENT24: 0x81a6, DEPTH_COMPONENT32F: 0x8cac,
  ASTC_4X4: 0x93b0, BPTC: 0x8e8c,
  TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE_WRAP_R: 0x8072, NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812f,
  TEXTURE_COMPARE_MODE: 0x884c, TEXTURE_COMPARE_FUNC: 0x884d, COMPARE_REF_TO_TEXTURE: 0x884e, NONE: 0, LEQUAL: 0x0203, LESS: 0x0201,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8a11, UNIFORM_BUFFER_BINDING: 0x8a28, INVALID_INDEX: 0xffffffff, STATIC_DRAW: 0x88e4,
  COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
  DEPTH_TEST: 0x0b71, BLEND: 0x0be2, CULL_FACE: 0x0b44, SCISSOR_TEST: 0x0c11, POLYGON_OFFSET_FILL: 0x8037, SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
  SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1, FUNC_ADD: 0x8006, MIN: 0x8007,
  CURRENT_PROGRAM: 0x8b8d, VERTEX_ARRAY_BINDING: 0x85b5, ARRAY_BUFFER_BINDING: 0x8894, DRAW_FRAMEBUFFER_BINDING: 0x8ca6, READ_FRAMEBUFFER_BINDING: 0x8caa, RENDERBUFFER_BINDING: 0x8ca7,
  VIEWPORT: 0x0ba2, SCISSOR_BOX: 0x0c10, ACTIVE_TEXTURE: 0x84e0, DEPTH_RANGE: 0x0b70, DEPTH_FUNC: 0x0b74, DEPTH_WRITEMASK: 0x0b72, COLOR_WRITEMASK: 0x0c23,
  BLEND_SRC_RGB: 0x80c9, BLEND_DST_RGB: 0x80c8, BLEND_SRC_ALPHA: 0x80cb, BLEND_DST_ALPHA: 0x80ca, BLEND_EQUATION_RGB: 0x8009, BLEND_EQUATION_ALPHA: 0x883d, COLOR_CLEAR_VALUE: 0x0c22, DEPTH_CLEAR_VALUE: 0x0b73,
  TEXTURE_BINDING_2D: 0x8069, TEXTURE_BINDING_3D: 0x806a, TEXTURE_BINDING_2D_ARRAY: 0x8c1d, DEPTH_BITS: 0x0d56,
  TIME_ELAPSED: 0x88bf, GPU_DISJOINT: 0x8fbb, QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867,
} as const;

/** The uniform buffer binding the probe reads a frame block from: the renderer's is 0. */
export const PROBE_BLOCK = 1;
/** Units the probe may bind its own textures on. The renderer's own on 0 to 3 are never touched, and these are put back. */
export const PROBE_UNITS: readonly number[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const CAPS = [GL.DEPTH_TEST, GL.BLEND, GL.CULL_FACE, GL.SCISSOR_TEST, GL.POLYGON_OFFSET_FILL, GL.SAMPLE_ALPHA_TO_COVERAGE];
const TEXTURE_TARGETS: [number, number][] = [[GL.TEXTURE_2D, GL.TEXTURE_BINDING_2D], [GL.TEXTURE_2D_ARRAY, GL.TEXTURE_BINDING_2D_ARRAY], [GL.TEXTURE_3D, GL.TEXTURE_BINDING_3D]];

/**
 * What the probe changes of a context, read so it can be put back: the returned function does that. `targets` is how
 * many of the 2D, 2D array and 3D bindings to keep on each of PROBE_UNITS.
 */
export function saveState(gl: Gl2, targets = 3): () => void {
  const p = (name: number): unknown => gl.getParameter(name);
  const unit = p(GL.ACTIVE_TEXTURE) as number;
  const bound = PROBE_UNITS.map((u) => {
    gl.activeTexture(GL.TEXTURE0 + u);
    return TEXTURE_TARGETS.slice(0, targets).map(([, binding]) => p(binding));
  });
  const caps = CAPS.map((c) => gl.isEnabled(c));
  const [program, vao, array, draw, read, rb] = [GL.CURRENT_PROGRAM, GL.VERTEX_ARRAY_BINDING, GL.ARRAY_BUFFER_BINDING, GL.DRAW_FRAMEBUFFER_BINDING, GL.READ_FRAMEBUFFER_BINDING, GL.RENDERBUFFER_BINDING].map(p);
  const [block, uniforms] = [gl.getIndexedParameter(GL.UNIFORM_BUFFER_BINDING, PROBE_BLOCK), p(GL.UNIFORM_BUFFER_BINDING)];
  const view = p(GL.VIEWPORT) as ArrayLike<number>;
  const box = p(GL.SCISSOR_BOX) as ArrayLike<number>;
  const range = p(GL.DEPTH_RANGE) as ArrayLike<number>;
  const mask = p(GL.COLOR_WRITEMASK) as ArrayLike<boolean>;
  const clear = p(GL.COLOR_CLEAR_VALUE) as ArrayLike<number>;
  const [func, depthMask, srcRgb, dstRgb, srcAlpha, dstAlpha, eqRgb, eqAlpha, clearDepth] = [GL.DEPTH_FUNC, GL.DEPTH_WRITEMASK, GL.BLEND_SRC_RGB, GL.BLEND_DST_RGB, GL.BLEND_SRC_ALPHA, GL.BLEND_DST_ALPHA, GL.BLEND_EQUATION_RGB, GL.BLEND_EQUATION_ALPHA, GL.DEPTH_CLEAR_VALUE].map(p) as number[];
  return () => {
    PROBE_UNITS.forEach((u, i) => {
      gl.activeTexture(GL.TEXTURE0 + u);
      bound[i]!.forEach((t, k) => gl.bindTexture(TEXTURE_TARGETS[k]![0], t));
    });
    gl.activeTexture(unit);
    CAPS.forEach((c, i) => (caps[i] ? gl.enable(c) : gl.disable(c)));
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(GL.ARRAY_BUFFER, array);
    // Binding a range sets the general binding too, so it goes first.
    gl.bindBufferBase(GL.UNIFORM_BUFFER, PROBE_BLOCK, block);
    gl.bindBuffer(GL.UNIFORM_BUFFER, uniforms);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, draw);
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, read);
    gl.bindRenderbuffer(GL.RENDERBUFFER, rb);
    if (view) gl.viewport(view[0]!, view[1]!, view[2]!, view[3]!);
    if (box) gl.scissor(box[0]!, box[1]!, box[2]!, box[3]!);
    if (range) gl.depthRange(range[0]!, range[1]!);
    if (mask) gl.colorMask(mask[0]!, mask[1]!, mask[2]!, mask[3]!);
    if (clear) gl.clearColor(clear[0]!, clear[1]!, clear[2]!, clear[3]!);
    gl.depthFunc(func!);
    gl.depthMask(Boolean(depthMask));
    gl.blendFuncSeparate(srcRgb!, dstRgb!, srcAlpha!, dstAlpha!);
    gl.blendEquationSeparate(eqRgb!, eqAlpha!);
    gl.clearDepth(clearDepth!);
  };
}

/** A program from two texts, or an error carrying what the compiler said. */
export function compile(gl: Gl2, vertex: string, fragment: string): Obj {
  const program = gl.createProgram();
  for (const [type, text] of [[GL.VERTEX_SHADER, vertex], [GL.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) throw new Error(`shader: ${(gl.getShaderInfoLog(shader) ?? "").slice(0, 200)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, GL.LINK_STATUS)) throw new Error(`program: ${(gl.getProgramInfoLog(program) ?? "").slice(0, 200)}`);
  return program;
}

/** A framebuffer of the attachments given, or an error if the context will not draw to it. */
export function framebuffer(gl: Gl2, attach: (target: number) => void, what: string): Obj {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
  attach(GL.FRAMEBUFFER);
  const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
  if (status !== GL.FRAMEBUFFER_COMPLETE) throw new Error(`${what} is not a target this device draws to (status 0x${status.toString(16)})`);
  return fb;
}

/** A 2D texture of `levels`, filtered as given, bound on the active unit. `create` makes the texture. */
export function texture2d(gl: Gl2, internal: number, width: number, height: number, filter: number = GL.NEAREST, levels = 1, create: () => Obj = () => gl.createTexture()): Obj {
  const t = create();
  gl.bindTexture(GL.TEXTURE_2D, t);
  gl.texStorage2D(GL.TEXTURE_2D, levels, internal, width, height);
  gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter === GL.LINEAR_MIPMAP_LINEAR ? GL.LINEAR : filter);
  return t;
}

/** One triangle over the whole target, made from the vertex's index: no buffers. */
export const FULL_SCREEN = `vec2 corner() { return vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); }`;

/**
 * A 4x4 block of one colour in the variant the renderer draws from, and the colour it decodes to. BC7 mode 6 with both
 * ends at 64 and their p-bits set is 129 grey; an ASTC void-extent block of 0x8080 is 128 grey; RGBA8 is four pixels' bytes.
 */
export function solidBlock(variant: string): { bytes: Uint8Array; rgba: number[] } {
  if (variant === "bc") {
    const out = new Uint8Array(16);
    let at = 0;
    const put = (value: number, bits: number): void => {
      for (let i = 0; i < bits; i++, at++) if ((value >> i) & 1) out[at >> 3]! |= 1 << (at & 7);
    };
    put(1 << 6, 7);
    for (let c = 0; c < 6; c++) put(64, 7);
    put(127, 7);
    put(127, 7);
    put(1, 1);
    put(1, 1);
    return { bytes: out, rgba: [129, 129, 129, 255] };
  }
  if (variant === "astc") return { bytes: Uint8Array.from([0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xff, 0xff]), rgba: [128, 128, 128, 255] };
  return { bytes: Uint8Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : 128)), rgba: [128, 128, 128, 255] };
}

/** A straight line through (k, ms) by least squares: its slope, and the slope's standard error. Null with fewer than three points or one k. */
export function fitLine(points: readonly (readonly [number, number])[]): { slope: number; error: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const mk = points.reduce((s, [k]) => s + k, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [k, y] of points) [sxx, sxy] = [sxx + (k - mk) ** 2, sxy + (k - mk) * (y - my)];
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const rest = points.reduce((s, [k, y]) => s + (y - my - slope * (k - mk)) ** 2, 0);
  return { slope, error: Math.sqrt(rest / (n - 2) / sxx) };
}

/** What a compared lookup halfway between a texel in front of the reference and one behind it read: filtered, or a hard 0 or 1. */
export function compareKind(half: number, quarter: number): string {
  if (Math.abs(half - 128) <= 24 && Math.abs(quarter - 64) <= 24) return "filtered";
  if (half <= 2 || half >= 253) return "hard";
  return `neither (${half} halfway, ${quarter} a quarter of the way, of 255)`;
}

/** What a sample of an RGBA8 3D texture between texels read, against what linear filtering gives (within 3 of 255). */
export function filterKind(got: readonly number[], want: readonly number[]): string {
  if (got.every((v, i) => Math.abs(v - want[i]!) <= 3)) return "filters";
  if (got.slice(0, 3).every((v) => v <= 2 || v >= 253)) return "nearest only";
  return `wrong (${got.slice(0, 3).join(",")}, not ${want.slice(0, 3).join(",")})`;
}

/** The answers. Each starts as "did not finish" and is set once its question is answered. */
export interface GpuReport {
  /** "honoured", "ignored", or why it was not found out. */
  depthRange: string;
  /**
   * D1's seam over 60 turning frames: pixels the seam crossed, and pixels left the clear colour with the far range from
   * FAR_FROM of the split, as the game draws, and from the split itself. A string until it is answered.
   */
  seam: { crossing: number; overlap: number; flush: number } | string;
  /** The least of a list of gaps two quads must have to be drawn in order: in the near range at 380 m, the far at 2 km. Null if none. */
  nearGap: number | null;
  farGap: number | null;
  /** Whether a 16-bit depth array renders, and what compared lookups in it and in a plain 16-bit depth texture give. */
  depthArray: string;
  compareArray: string;
  compare2d: string;
  texture3d: string;
  /** The share of a wall in the middle of the far blocks' fade that the GPU kept, and the share the rule (far.ts fadeKeeps) keeps. A string until it is answered. */
  farEdge: { kept: number; rule: number } | string;
  timers: boolean;
  passes: PassTime[];
  /** The question during which the context was lost, or null. */
  lostDuring: string | null;
  /** The target the full-screen passes drew to, in pixels. */
  screen: number[];
}

export interface PassTime {
  name: string;
  /** What a number is for: "100k triangles" or "megapixel" in ms, or "draw" in µs on the main thread. */
  per: string;
  timer: number | null;
  slope: number | null;
  error: number | null;
  /** How many passes the slope's longest sample drew. */
  k: number;
  /** Empty when measured, else why not: "did not finish", "lost the context", or what failed. */
  note: string;
}

export function newGpuReport(): GpuReport {
  const dnf = "did not finish";
  return { depthRange: dnf, seam: dnf, nearGap: null, farGap: null, depthArray: dnf, compareArray: dnf, compare2d: dnf, texture3d: dnf, farEdge: dnf, timers: false, passes: [], lostDuring: null, screen: [0, 0] };
}

/**
 * A full-screen pass of one of the game's programs as `tier` draws it: on a wall `wall` metres off, or the dome looking
 * up toward the sun; under noon's frame block with `layers` of cloud, or plain (no haze, nothing over the table). A
 * lit program looks the sun's shadow up only when `shadowed`, in the depth passes' array, whose first cascade the frame
 * block puts the wall in.
 */
export interface ScreenPass {
  name: string;
  program: string;
  tier: Tier["name"];
  wall?: number;
  layers: number;
  plain: boolean;
  shadowed?: boolean;
}

/** LIT with its shadow lookup, against LIT without it: what shadows cost a pixel. */
export const SHADOWED_PASS: ScreenPass = { name: "lit shadowed", program: "flat", tier: "medium", wall: 12, layers: 0, plain: true, shadowed: true };

/**
 * The full-screen passes. LIT is hazed at 500 m and 3.5 km, where haze costs most (D266); the far blocks' program has
 * its fade's discard, against LIT; the dome is timed with the table alone and with 0, 1 and 2 cloud layers (D265).
 */
export const SCREEN_PASSES: readonly ScreenPass[] = [
  { name: "flat", program: "flat", tier: "lowpoly", wall: 12, layers: 0, plain: true },
  { name: "lit", program: "flat", tier: "medium", wall: 12, layers: 0, plain: true },
  { name: "lit haze 500 m", program: "flat", tier: "medium", wall: 500, layers: 0, plain: false },
  { name: "lit haze 3.5 km", program: "flat", tier: "medium", wall: 3500, layers: 0, plain: false },
  { name: "far", program: "far", tier: "medium", wall: 12, layers: 0, plain: true },
  { name: "surface", program: "surface", tier: "medium", layers: 0, plain: true },
  { name: "sky table", program: "sky", tier: "medium", layers: 0, plain: true },
  { name: "sky", program: "sky", tier: "medium", layers: 0, plain: false },
  { name: "sky 1 layer", program: "sky", tier: "medium", layers: 1, plain: false },
  { name: "sky 2 layers", program: "sky", tier: "medium", layers: 2, plain: false },
];

/** Gaps tried, in metres, nearest first, and where. The near range ends at the split, the far begins at 98% of it. */
export const NEAR_GAPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 2, 20];
export const FAR_GAPS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 30];
const SPLIT = 384;
const VIEW_END = 6000;
/** A timed block of passes aims at this long, and draws at most this many. */
const AIM_MS = 16;
const MOST_K = 512;
/** Triangles in a depth pass: quads on a grid this many a side. */
const GRID = 224;
const PASS_TRIANGLES = GRID * GRID * 2;

/** The sizes asked about and how long each question may take, in ms. */
export interface GpuPlan {
  depthSizes: readonly number[];
  checkMs: number;
  passMs: number;
}
export const GPU_PLAN: GpuPlan = { depthSizes: [1024, 2048], checkMs: 3000, passMs: 10000 };

const MAT_VERTEX = `#version 300 es
uniform mat4 uM;
uniform float uZ;
${FULL_SCREEN}
void main() {
  vec2 c = corner();
  gl_Position = uM * vec4(c * 4000.0, -uZ, 1.0);
}`;
/** What FLAT's, LIT's and the far blocks' fragments take from their vertices, on a wall `metres` off filling the target, 16 m across at 12 m. */
const wallVertex = (metres: number): string => `#version 300 es
${FULL_SCREEN}
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec2 c = corner();
  vRel = vec3(c * 8.0, -12.0) * ${(metres / 12).toFixed(4)};
  vColor = vec3(0.6, 0.55, 0.5);
  gl_Position = vec4(c, 0.0, 1.0);
}`;
/** The same on a wall 4 m across `metres` off, which is as far off as that across all of it. */
const edgeVertex = (metres: number): string => `#version 300 es
${FULL_SCREEN}
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec2 c = corner();
  vRel = vec3(c * 2.0, -${metres.toFixed(2)});
  vColor = vec3(0.6, 0.55, 0.5);
  gl_Position = vec4(c, 0.0, 1.0);
}`;
/** What SURFACE's fragment takes from its vertices, on the wall 12 m off, its maps a texel a pixel. */
const SURFACE_VERTEX = `#version 300 es
${FULL_SCREEN}
uniform vec2 uSize;
out vec3 vRel, vNormal;
out vec4 vTangent;
out vec2 vUv;
flat out mat3 vDye, vDye2;
void main() {
  vec2 c = corner();
  vRel = vec3(c * 8.0, -12.0);
  vNormal = normalize(vec3(c * 0.3, 1.0));
  vTangent = vec4(1.0, 0.0, 0.0, 1.0);
  vUv = (c * 0.5 + 0.5) * uSize / 512.0;
  vDye = mat3(1.0);
  vDye2 = mat3(1.0);
  gl_Position = vec4(c, 0.0, 1.0);
}`;
/** Clouds of about 40% cover, drawn into a layer's picture: red the cover and green the thickness, as the sky's pictures have them. */
const CLOUD_FRAGMENT = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 o;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.0) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = gl_FragCoord.xy / 64.0;
  float v = 0.5 * noise(p) + 0.25 * noise(p * 2.0) + 0.125 * noise(p * 4.0) + 0.0625 * noise(p * 8.0);
  float cover = smoothstep(0.42, 0.62, v);
  o = vec4(cover, cover * v, 0.0, 1.0);
}`;
/** The hour, the view's end, the eye's height over the sea and the tier whose reach and fade the full-screen passes are drawn under. */
const HOUR = 12;
const AIR_VIEW = 4000;
const EYE = 10;
const MEDIUM = tierOf("medium");
/** The side of the sky's pictures, as medium has them, and of the target the far blocks' edge is read from. */
const SKY_MAP = 1024;
const EDGE = 64;
const COLOUR_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 uColour;
out vec4 o;
void main() { o = vec4(uColour, 1.0); }`;

/** A perspective projection, column-major as GL takes it, looking down -z from `near` to `far` with a field this wide. */
function perspective(near: number, far: number): Float32Array {
  const m = new Float32Array(16);
  [m[0], m[5], m[10], m[11], m[14]] = [1, 1, (far + near) / (near - far), -1, (2 * far * near) / (near - far)];
  return m;
}

/** A view-projection from the origin as the game's camera turns (yaw 0 faces +Z, pitch up), with its depth rows as camera.ts sets them. */
export function lookFrom(yaw: number, pitch: number, fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const l = Math.hypot(f[2]!, f[0]!);
  const r = [-f[2]! / l, 0, f[0]! / l];
  const u = [r[1]! * f[2]! - r[2]! * f[1]!, r[2]! * f[0]! - r[0]! * f[2]!, r[0]! * f[1]! - r[1]! * f[0]!];
  const [b, a] = [1 / Math.tan(fovY / 2), (far + near) / (near - far)];
  const m = new Float32Array(16);
  for (let c = 0; c < 3; c++) [m[c * 4], m[c * 4 + 1], m[c * 4 + 2], m[c * 4 + 3]] = [(b / aspect) * r[c]!, b * u[c]!, -a * f[c]!, f[c]!];
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** D1's seam shot (tools/probe-lit/depth.ts): its target, how high over the slope, the slope, the view and the turns. */
const [SEAM_W, SEAM_H] = [480, 270];
const SEAM_UP = 150;
const SEAM_SLOPE = Math.tan((5 * Math.PI) / 180);
const SEAM_PITCH = (-28 * Math.PI) / 180;
const SEAM_FOV = (30 * Math.PI) / 180;
const SEAM_TURNS = 60;

/** What a turn of the seam read back: pixels left the clear colour (blue), and pixels whose next row up is in the other range. */
export function seamCount(px: Uint8Array, width: number, height: number): { gaps: number; crossing: number } {
  let [gaps, crossing] = [0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (px[at + 2]! > 128) gaps++;
      else if (y + 1 < height && px[at + 2 + width * 4]! <= 128 && px[at + 1]! > 192 !== px[at + 1 + width * 4]! > 192) crossing++;
    }
  }
  return { gaps, crossing };
}

/**
 * The questions, one after another, each a few frames. `frame` is called once a frame after the game has drawn, and
 * says true when every question is answered or given up.
 */
export class GpuQuestions {
  readonly report = newGpuReport();
  private readonly gl: Gl2;
  private readonly now: () => number;
  private readonly variant: TextureFormat;
  private readonly plan: GpuPlan;
  /** Each question: how it is asked, how long it may take, and what it says if it is not answered, or `over` an answer it gave. */
  private readonly tasks: { name: string; run: () => Generator<void, void, void>; ms: number; fail: (why: string, over?: boolean) => void }[] = [];
  private index = -1;
  private task: Generator<void, void, void> | null = null;
  private startedAt = 0;
  private lostFlag = false;
  private readonly made: { kind: string; obj: Obj }[] = [];
  private fence: Obj = null;
  private readonly fencePixel = new Uint8Array(4);
  private empty: Obj = null;
  private timer: { TIME_ELAPSED_EXT?: number } | null = null;
  private readonly create: () => Obj;

  /** `create` makes a texture without the probe counting it among the renderer's. `screen` is the canvas in pixels. */
  constructor(gl: Gl2, create: () => Obj, now: () => number, variant: string, screen: number[], plan: GpuPlan = GPU_PLAN) {
    this.gl = gl;
    this.create = create;
    this.now = now;
    this.variant = variant === "astc" || variant === "bc" ? variant : "rgba";
    this.plan = plan;
    this.report.screen = [Math.max(1, Math.floor(screen[0]!)), Math.max(1, Math.floor(screen[1]!))];
    const r = this.report;
    const set = (fields: (keyof GpuReport)[]) => (why: string, over = false): void => {
      for (const f of fields) if (over || r[f] === "did not finish") (r as unknown as Record<string, unknown>)[f] = why;
      if (over && fields.includes("depthRange")) r.nearGap = r.farGap = null;
    };
    this.tasks.push({ name: "depth", run: () => this.depth(), ms: plan.checkMs, fail: set(["depthRange"]) });
    this.tasks.push({ name: "seam", run: () => this.seam(), ms: plan.passMs, fail: set(["seam"]) });
    this.tasks.push({ name: "compared lookups", run: () => this.compared(), ms: plan.checkMs, fail: set(["depthArray", "compareArray", "compare2d"]) });
    this.tasks.push({ name: "3D texture", run: () => this.texture3d(), ms: plan.checkMs, fail: set(["texture3d"]) });
    this.tasks.push({ name: "far edge", run: () => this.farEdge(), ms: plan.checkMs, fail: set(["farEdge"]) });
    for (const spec of SCREEN_PASSES) this.addPass(spec.name, "megapixel", () => this.screenPass(spec));
    // What shadow maps cost: depth into a 16-bit array as a cascade is drawn, LIT looking the shadow up in it, and
    // compared taps in it full screen.
    for (const size of plan.depthSizes) {
      for (const skinned of [false, true]) {
        const name = `depth ${skinned ? "skinned" : "rigid"} ${size}`;
        this.addPass(name, "100k triangles", () => this.depthPass(size, skinned));
      }
    }
    this.addPass(SHADOWED_PASS.name, "megapixel", () => this.screenPass(SHADOWED_PASS));
    for (const taps of [1, 4, 9]) this.addPass(`${taps} ${taps === 1 ? "tap" : "taps"}`, "megapixel", () => this.tapsPass(taps));
    const draw: PassTime = { name: "draw", per: "draw", timer: null, slope: null, error: null, k: 0, note: "did not finish" };
    r.passes.push(draw);
    this.tasks.push({ name: "draw", run: () => this.drawCost(draw), ms: plan.checkMs, fail: failPass(draw) });
  }

  /** The context was lost: the question under way is named, and the rest are not asked. */
  lost(): void {
    this.lostFlag = true;
  }

  get stage(): string {
    return this.tasks[this.index]?.name ?? "";
  }

  /** One step of the question under way, after the game's frame. True once every question is answered or given up. */
  frame(): boolean {
    const gl = this.gl;
    if (this.index >= this.tasks.length) return true;
    // The question under way, which a lost context is put on even if it ended in the frame the context went.
    const ran = Math.max(0, this.index);
    if (this.lostFlag || gl.isContextLost()) return this.end(ran);
    const restore = saveState(gl);
    try {
      // Every texture the probe makes or binds goes on a unit of its own.
      gl.activeTexture(GL.TEXTURE0 + 15);
      if (this.index < 0) this.begin();
      else this.step();
    } catch (e) {
      // Only what every question needs can fail here: each question's own failure is caught in step().
      for (const t of this.tasks) t.fail(`failed: ${message(e)}`);
      this.index = this.tasks.length;
    } finally {
      restore();
    }
    if (gl.isContextLost()) return this.end(ran);
    if (this.index >= this.tasks.length) this.free();
    return this.index >= this.tasks.length;
  }

  private step(): void {
    const t = this.tasks[this.index]!;
    if (!this.task) [this.task, this.startedAt] = [t.run(), this.now()];
    let ended = false;
    if (this.now() - this.startedAt > t.ms) {
      this.task.return();
      ended = true;
    } else {
      try {
        ended = this.task.next().done === true;
      } catch (e) {
        t.fail(`failed: ${message(e)}`);
        ended = true;
      }
    }
    if (ended) [this.task, this.index] = [null, this.index + 1];
  }

  private begin(): void {
    const gl = this.gl;
    this.index = 0;
    this.timer = (gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT?: number } | null) ?? null;
    this.report.timers = this.timer !== null;
    this.empty = this.keep("vao", gl.createVertexArray());
    const t = this.texture(GL.RGBA8, 1, 1);
    this.fence = this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, t, 0), "a 1x1 RGBA8 texture"));
  }

  /** A 2D texture of the probe's, made without the probe counting it among the renderer's. */
  private texture(internal: number, width: number, height: number, filter: number = GL.NEAREST, levels = 1): Obj {
    return this.keep("texture", texture2d(this.gl, internal, width, height, filter, levels, this.create));
  }

  /** The context was lost during the question at `at`: its answer, whatever it read, is that, and the rest are not asked. */
  private end(at: number): true {
    const during = this.tasks[at]!.name;
    this.report.lostDuring = during;
    this.tasks[at]!.fail("lost the context", true);
    for (const t of this.tasks.slice(at + 1)) t.fail(`not asked: the context was lost during ${during}`);
    this.index = this.tasks.length;
    this.made.length = 0;
    return true;
  }

  private addPass(name: string, per: string, make: () => { bind(): void; draw(): void; scale: number }): void {
    const pass: PassTime = { name, per, timer: null, slope: null, error: null, k: 0, note: "did not finish" };
    this.report.passes.push(pass);
    this.tasks.push({ name, run: () => this.timePass(pass, make), ms: this.plan.passMs, fail: failPass(pass) });
  }

  private keep<T>(kind: string, obj: T): T {
    this.made.push({ kind, obj });
    return obj;
  }

  private free(): void {
    const gl = this.gl;
    for (const { kind, obj } of this.made.splice(0)) {
      if (kind === "texture") gl.deleteTexture(obj);
      else if (kind === "framebuffer") gl.deleteFramebuffer(obj);
      else if (kind === "renderbuffer") gl.deleteRenderbuffer(obj);
      else if (kind === "buffer") gl.deleteBuffer(obj);
      else if (kind === "vao") gl.deleteVertexArray(obj);
      else if (kind === "program") gl.deleteProgram(obj);
    }
  }

  /** Waits for everything the GPU was given: a readback of a pixel it has to draw last. */
  private sync(): void {
    const gl = this.gl;
    gl.bindFramebuffer(GL.FRAMEBUFFER, this.fence);
    gl.viewport(0, 0, 1, 1);
    gl.disable(GL.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, this.fencePixel);
  }

  private program(vertex: string, fragment: string): Obj {
    return this.keep("program", compile(this.gl, vertex, fragment));
  }

  /**
   * Quads drawn into a target of the screen's depth, a cell of it each. First whether depthRange is honoured, as D1's
   * probe asks it: a slab 200 m off in the near range must hide ground 2 km off in the far, drawn after it, which it
   * does only in 0 to 0.5 against 0.5 to 1. Then pairs of quads a gap apart at 380 m in the near range and at 2 km in
   * the far, each pair drawn both ways round.
   */
  private *depth(): Generator<void, void, void> {
    const gl = this.gl;
    // The screen's depth, which the game's frame left bound.
    const bits = Number(gl.getParameter(GL.DEPTH_BITS)) || 0;
    const internal = bits >= 32 ? GL.DEPTH_COMPONENT32F : bits >= 24 ? GL.DEPTH_COMPONENT24 : GL.DEPTH_COMPONENT16;
    const cells = 1 + 2 * (NEAR_GAPS.length + FAR_GAPS.length);
    const colour = this.texture(GL.RGBA8, cells, 1);
    const depth = this.keep("renderbuffer", gl.createRenderbuffer());
    gl.bindRenderbuffer(GL.RENDERBUFFER, depth);
    gl.renderbufferStorage(GL.RENDERBUFFER, internal, cells, 1);
    const fb = this.keep("framebuffer", framebuffer(gl, (f) => {
      gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, colour, 0);
      gl.framebufferRenderbuffer(f, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    }, `a ${bits}-bit depth target`));
    const prog = this.program(MAT_VERTEX, COLOUR_FRAGMENT);
    gl.useProgram(prog);
    gl.bindVertexArray(this.empty);
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LESS);
    gl.depthMask(true);
    gl.disable(GL.BLEND);
    gl.disable(GL.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.enable(GL.SCISSOR_TEST);
    const [m, z, c] = ["uM", "uZ", "uColour"].map((n) => gl.getUniformLocation(prog, n));
    const quad = (proj: Float32Array, range: [number, number], dist: number, red: boolean): void => {
      gl.depthRange(range[0], range[1]);
      gl.uniformMatrix4fv(m, false, proj);
      gl.uniform1f(z, dist);
      gl.uniform3f(c, red ? 1 : 0, red ? 0 : 1, 0);
      gl.drawArrays(GL.TRIANGLES, 0, 3);
    };
    const cell = (at: number): void => {
      gl.viewport(at, 0, 1, 1);
      gl.scissor(at, 0, 1, 1);
      gl.depthRange(0, 1);
      gl.clearColor(0, 0, 1, 1);
      gl.clearDepth(1);
      gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    };
    gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
    type Pair = [Float32Array, [number, number], number, number];
    const [near, far] = [perspective(0.25, SPLIT), perspective(SPLIT * FAR_FROM, VIEW_END)];
    cell(0);
    quad(near, [0, 0.5], 200, true);
    quad(far, [0.5, 1], 2000, false);
    const pairs: Pair[] = [...NEAR_GAPS.map((g): Pair => [near, [0, 0.5], 380, g]), ...FAR_GAPS.map((g): Pair => [far, [0.5, 1], 2000, g])];
    pairs.forEach(([proj, range, at, gap], i) => {
      // The nearer quad is red, drawn first in one cell and last in the next. Red in both says the gap tells them apart.
      cell(1 + i * 2);
      quad(proj, range, at - gap / 2, true);
      quad(proj, range, at + gap / 2, false);
      cell(2 + i * 2);
      quad(proj, range, at + gap / 2, false);
      quad(proj, range, at - gap / 2, true);
    });
    gl.disable(GL.SCISSOR_TEST);
    gl.depthRange(0, 1);
    const px = new Uint8Array(cells * 4);
    gl.readPixels(0, 0, cells, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    const red = (i: number): boolean => px[i * 4]! > 200 && px[i * 4 + 1]! < 50;
    const green = (i: number): boolean => px[i * 4 + 1]! > 200 && px[i * 4]! < 50;
    this.report.depthRange = red(0) ? "honoured" : green(0) ? "ignored" : `neither (read ${Array.from(px.subarray(0, 3)).join(",")})`;
    const least = (gaps: number[], from: number): number | null => gaps.find((_, i) => red(from + i * 2) && red(from + i * 2 + 1)) ?? null;
    this.report.nearGap = least(NEAR_GAPS, 1);
    this.report.farGap = least(FAR_GAPS, 1 + NEAR_GAPS.length * 2);
    yield;
  }

  /**
   * A 16-bit depth array, 4 by 4 by 2, as round 8's shadow maps are: its second layer drawn with the left half at 0.25
   * and the right at 0.75. Then lookups compared with 0.5 halfway between a texel of each half and a quarter of the way,
   * read back: a filtered edge reads about 128 and 64 of 255, a hard one 0 or 255. The same for a plain 2D depth texture.
   */
  private *compared(): Generator<void, void, void> {
    const gl = this.gl;
    // Depth -0.5 is 0.25 once in the range 0 to 1; the right half is left at the clear's 0.75.
    const write = this.program(`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), -0.5, 1.0); }`, `#version 300 es
precision highp float;
void main() { if (gl_FragCoord.x > 2.0) discard; }`);
    const read = (array: boolean): Obj => this.program(`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, `#version 300 es
precision highp float;
precision highp ${array ? "sampler2DArrayShadow" : "sampler2DShadow"};
uniform ${array ? "sampler2DArrayShadow" : "sampler2DShadow"} uMap;
out vec4 o;
void main() {
  float x = gl_FragCoord.x < 1.0 ? 0.5 : gl_FragCoord.x < 2.0 ? 0.4375 : gl_FragCoord.x < 3.0 ? 0.125 : 0.875;
  o = vec4(texture(uMap, ${array ? "vec4(x, 0.5, 1.0, 0.5)" : "vec3(x, 0.5, 0.5)"}), 0.0, 0.0, 1.0);
}`);
    const out = this.texture(GL.RGBA8, 4, 1);
    const outFb = this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, out, 0), "a 4x1 RGBA8 texture"));
    const ask = (array: boolean): string => {
      try {
        return this.compare(array, write, read(array), outFb);
      } catch (e) {
        return `failed: ${message(e)}`;
      }
    };
    const inArray = ask(true);
    const rendered = !/^(did not render|failed)/.test(inArray);
    this.report.depthArray = rendered ? "renders" : inArray;
    this.report.compareArray = rendered ? inArray : "not known";
    this.report.compare2d = ask(false);
    yield;
  }

  /** One compared lookup's answer, in a 16-bit depth array or a plain 2D depth texture: `write` draws its left half, `prog` reads it. */
  private compare(array: boolean, write: Obj, prog: Obj, outFb: Obj): string {
    const gl = this.gl;
    const target = array ? GL.TEXTURE_2D_ARRAY : GL.TEXTURE_2D;
    const map = this.keep("texture", this.create());
    gl.activeTexture(GL.TEXTURE0 + 14);
    gl.bindTexture(target, map);
    if (array) gl.texStorage3D(target, 1, GL.DEPTH_COMPONENT16, 4, 4, 2);
    else gl.texStorage2D(target, 1, GL.DEPTH_COMPONENT16, 4, 4);
    for (const [name, value] of [[GL.TEXTURE_MIN_FILTER, GL.LINEAR], [GL.TEXTURE_MAG_FILTER, GL.LINEAR], [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE], [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE], [GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE], [GL.TEXTURE_COMPARE_FUNC, GL.LEQUAL]]) gl.texParameteri(target, name!, value!);
    const fb = this.keep("framebuffer", framebuffer(gl, (f) => (array ? gl.framebufferTextureLayer(f, GL.DEPTH_ATTACHMENT, map, 0, 1) : gl.framebufferTexture2D(f, GL.DEPTH_ATTACHMENT, GL.TEXTURE_2D, map, 0)), `a 16-bit depth ${array ? "array" : "texture"}`));
    gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
    gl.viewport(0, 0, 4, 4);
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LESS);
    gl.depthMask(true);
    gl.depthRange(0, 1);
    gl.disable(GL.SCISSOR_TEST);
    gl.clearDepth(0.75);
    gl.clear(GL.DEPTH_BUFFER_BIT);
    gl.useProgram(write);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, "uMap"), 14);
    gl.bindFramebuffer(GL.FRAMEBUFFER, outFb);
    gl.viewport(0, 0, 4, 1);
    gl.disable(GL.DEPTH_TEST);
    gl.disable(GL.BLEND);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(16);
    gl.readPixels(0, 0, 4, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    // The texel centres either side read 0 and 255 whatever the filter: if not, the map did not render.
    if (px[8]! > 2 || px[12]! < 253) return `did not render (read ${px[8]} and ${px[12]} at texel centres, not 0 and 255)`;
    return compareKind(px[0]!, px[4]!);
  }

  /**
   * D1's seam: 150 m over a 5 degree slope, looking 28 degrees down along a view 30 degrees high, 480 by 270, turned
   * through 60 frames. The slope, 16 m quads 3 km across, is drawn in both ranges, bright green in the near and dark in
   * the far; a pixel left the clear blue lies in neither. Once with the far range from FAR_FROM of the split, as the
   * game draws it, and once from the split itself. Six turns a frame.
   */
  private *seam(): Generator<void, void, void> {
    const gl = this.gl;
    const bits = Number(gl.getParameter(GL.DEPTH_BITS)) || 0;
    const colour = this.texture(GL.RGBA8, SEAM_W, SEAM_H);
    const depth = this.keep("renderbuffer", gl.createRenderbuffer());
    gl.bindRenderbuffer(GL.RENDERBUFFER, depth);
    gl.renderbufferStorage(GL.RENDERBUFFER, bits >= 32 ? GL.DEPTH_COMPONENT32F : bits >= 24 ? GL.DEPTH_COMPONENT24 : GL.DEPTH_COMPONENT16, SEAM_W, SEAM_H);
    const fb = this.keep("framebuffer", framebuffer(gl, (f) => {
      gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, colour, 0);
      gl.framebufferRenderbuffer(f, GL.DEPTH_ATTACHMENT, GL.RENDERBUFFER, depth);
    }, "the seam's target"));
    const side = 188;
    const pos = new Float32Array((side + 1) * (side + 1) * 3);
    const index = new Uint32Array(side * side * 6);
    for (let j = 0; j <= side; j++) for (let i = 0; i <= side; i++) pos.set([i * 16 - 1504, -SEAM_UP + SEAM_SLOPE * (i * 16 - 1504), j * 16 - 1504], (j * (side + 1) + i) * 3);
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const a = j * (side + 1) + i;
        index.set([a, a + 1, a + side + 1, a + 1, a + side + 2, a + side + 1], (j * side + i) * 6);
      }
    }
    const vao = this.keep("vao", gl.createVertexArray());
    gl.bindVertexArray(vao);
    gl.bindBuffer(GL.ARRAY_BUFFER, this.keep("buffer", gl.createBuffer()));
    gl.bufferData(GL.ARRAY_BUFFER, pos, GL.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, GL.FLOAT, false, 12, 0);
    gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, this.keep("buffer", gl.createBuffer()));
    gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, index, GL.STATIC_DRAW);
    const prog = this.program(`#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uM;
void main() { gl_Position = uM * vec4(aPos, 1.0); }`, COLOUR_FRAGMENT);
    const [m, c] = ["uM", "uColour"].map((n) => gl.getUniformLocation(prog, n));
    const px = new Uint8Array(SEAM_W * SEAM_H * 4);
    const out = { crossing: 0, overlap: 0, flush: 0 };
    for (const from of [FAR_FROM, 1]) {
      for (let k = 0; k < SEAM_TURNS; k++) {
        const yaw = (k / SEAM_TURNS) * 2 * Math.PI;
        gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
        gl.viewport(0, 0, SEAM_W, SEAM_H);
        for (const cap of [GL.SCISSOR_TEST, GL.BLEND, GL.CULL_FACE]) gl.disable(cap);
        gl.enable(GL.DEPTH_TEST);
        gl.depthFunc(GL.LESS);
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
        gl.depthRange(0, 1);
        gl.clearColor(0, 0, 1, 1);
        gl.clearDepth(1);
        gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        for (const [range, start, end, green] of [[[0, 0.5], 0.25, SPLIT, 1], [[0.5, 1], SPLIT * from, VIEW_END, 0.5]] as const) {
          gl.depthRange(range[0], range[1]);
          gl.uniformMatrix4fv(m, false, lookFrom(yaw, SEAM_PITCH, SEAM_FOV, SEAM_W / SEAM_H, start, end));
          gl.uniform3f(c, 0, green, 0);
          gl.drawElements(GL.TRIANGLES, index.length, GL.UNSIGNED_INT, 0);
        }
        gl.depthRange(0, 1);
        gl.readPixels(0, 0, SEAM_W, SEAM_H, GL.RGBA, GL.UNSIGNED_BYTE, px);
        const turn = seamCount(px, SEAM_W, SEAM_H);
        if (from === 1) out.flush += turn.gaps;
        else [out.overlap, out.crossing] = [out.overlap + turn.gaps, out.crossing + turn.crossing];
        if (k % 6 === 5) yield;
      }
    }
    this.report.seam = out;
  }

  /** An RGBA8 3D texture 2 a side, red, green and blue on along x, y and z, sampled between texels with linear filtering. */
  private *texture3d(): Generator<void, void, void> {
    const gl = this.gl;
    const t = this.keep("texture", this.create());
    gl.activeTexture(GL.TEXTURE0 + 14);
    gl.bindTexture(GL.TEXTURE_3D, t);
    gl.texStorage3D(GL.TEXTURE_3D, 1, GL.RGBA8, 2, 2, 2);
    const data = new Uint8Array(32);
    for (let i = 0; i < 8; i++) data.set([(i & 1) * 255, ((i >> 1) & 1) * 255, ((i >> 2) & 1) * 255, 255], i * 4);
    gl.texSubImage3D(GL.TEXTURE_3D, 0, 0, 0, 0, 2, 2, 2, GL.RGBA, GL.UNSIGNED_BYTE, data);
    for (const name of [GL.TEXTURE_MIN_FILTER, GL.TEXTURE_MAG_FILTER]) gl.texParameteri(GL.TEXTURE_3D, name, GL.LINEAR);
    for (const name of [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T, GL.TEXTURE_WRAP_R]) gl.texParameteri(GL.TEXTURE_3D, name, GL.CLAMP_TO_EDGE);
    const prog = this.program(`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uTable;
out vec4 o;
void main() { o = texture(uTable, vec3(0.375, 0.5, 0.625)); }`);
    const out = this.texture(GL.RGBA8, 1, 1);
    gl.bindFramebuffer(GL.FRAMEBUFFER, this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, out, 0), "a 1x1 RGBA8 texture")));
    gl.viewport(0, 0, 1, 1);
    gl.disable(GL.DEPTH_TEST);
    gl.disable(GL.BLEND);
    gl.disable(GL.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, "uTable"), 14);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, px);
    // Texel centres are at 0.25 and 0.75, so 0.375 is a quarter of the way and 0.625 three quarters.
    this.report.texture3d = filterKind(Array.from(px), [64, 128, 191, 255]);
    yield;
  }

  /**
   * A pass timed by the slope: a block of k passes timed across a readback, k doubling until the block takes AIM_MS,
   * then four ks up to it five times over, and a line fitted by least squares; the slope's standard error is the
   * spread. Where there are timer queries, the longest block is timed by them too.
   */
  private *timePass(pass: PassTime, make: () => { bind(): void; draw(): void; scale: number }): Generator<void, void, void> {
    const gl = this.gl;
    const p = make();
    yield;
    const timed = (k: number): number => {
      this.sync();
      const t0 = this.now();
      p.bind();
      for (let i = 0; i < k; i++) p.draw();
      this.sync();
      return this.now() - t0;
    };
    // k doubles, within a frame while the frame has taken little. The faster of two blocks counts, so one stall does not stop it.
    let k = 1;
    for (let spent = 0; ; k *= 2) {
      const ms = Math.min(timed(k), timed(k));
      // A pass that alone takes this long is not drawn twice in a frame: one is the answer.
      if (k === 1 && ms >= 100) {
        [pass.slope, pass.k, pass.note] = [round(ms * p.scale), 1, `one pass took ${Math.round(ms)} ms, so it was timed once`];
        return;
      }
      if (ms >= AIM_MS || k >= MOST_K) break;
      spent += ms;
      if (spent > 2 * AIM_MS) {
        spent = 0;
        yield;
      }
    }
    yield;
    // Two blocks a frame, the lighter two and then the heavier, five times over. The line goes through each k's median,
    // so a block another program's work stalled does not move it.
    const ks = k >= 4 ? [k / 4, k / 2, (3 * k) / 4, k] : [1, 2, 3];
    const times: number[][] = ks.map(() => []);
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i < ks.length; i += 2) {
        for (let j = i; j < Math.min(i + 2, ks.length); j++) times[j]!.push(timed(ks[j]!));
        yield;
      }
    }
    const fit = fitLine(ks.map((kk, i) => [kk, median(times[i]!)]));
    pass.k = Math.max(...ks);
    if (fit) [pass.slope, pass.error] = [round(fit.slope * p.scale), round(fit.error * p.scale)];
    // Where there are timer queries, the block of the longest k three times: the slope's check, on a desktop.
    const ext = this.timer;
    if (ext?.TIME_ELAPSED_EXT !== undefined) {
      const queries: Obj[] = [];
      const times: number[] = [];
      try {
        for (let i = 0; i < 3; i++) {
          queries.push(gl.createQuery());
          p.bind();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, queries[i]);
          for (let j = 0; j < pass.k; j++) p.draw();
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          yield;
        }
        // Results come some frames later, and none of a frame the GPU says was disjoint counts.
        for (let next = 0, tries = 0; next < queries.length && tries < 60; tries++) {
          const disjoint = Boolean(gl.getParameter(GL.GPU_DISJOINT));
          for (; next < queries.length && gl.getQueryParameter(queries[next], GL.QUERY_RESULT_AVAILABLE); next++) {
            const ns = Number(gl.getQueryParameter(queries[next], GL.QUERY_RESULT));
            if (!disjoint && ns > 0) times.push(ns / 1e6 / pass.k);
          }
          if (next < queries.length) yield;
        }
      } finally {
        for (const q of queries) gl.deleteQuery(q);
      }
      if (times.length > 0) pass.timer = round(median(times) * p.scale);
    }
    pass.note = "";
  }

  /**
   * A field of GRID x GRID small quads at depths of their own, rigid or each vertex on four bones, drawn into a 16-bit
   * depth array `size` square: a pass a layer, by turns, so that each is a render pass that clears and stores its map
   * as a cascade does.
   */
  private depthPass(size: number, skinned: boolean): { bind(): void; draw(): void; scale: number } {
    const gl = this.gl;
    const map = this.depthMap(size);
    const mesh = this.field(skinned);
    const prog = this.program(`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in uvec4 aBones;
layout(location=2) in vec4 aWeights;
uniform highp sampler2D uBones;
${skinned ? `mat3x4 bone(uint i) {
  int n = int(i) * 3;
  return mat3x4(texelFetch(uBones, ivec2(n, 0), 0), texelFetch(uBones, ivec2(n + 1, 0), 0), texelFetch(uBones, ivec2(n + 2, 0), 0));
}` : ""}
void main() {
  ${skinned ? "mat3x4 m = bone(aBones.x) * aWeights.x + bone(aBones.y) * aWeights.y + bone(aBones.z) * aWeights.z + bone(aBones.w) * aWeights.w;\n  gl_Position = vec4(vec4(aPos, 1.0) * m, 1.0);" : "gl_Position = vec4(aPos, 1.0);"}
}`, `#version 300 es
precision mediump float;
void main() {}`);
    const bones = skinned ? this.bones() : null;
    let layer = 0;
    return {
      scale: 100000 / PASS_TRIANGLES,
      bind: () => {
        gl.viewport(0, 0, size, size);
        gl.disable(GL.SCISSOR_TEST);
        gl.disable(GL.BLEND);
        gl.disable(GL.CULL_FACE);
        gl.enable(GL.DEPTH_TEST);
        gl.depthFunc(GL.LESS);
        gl.depthMask(true);
        gl.depthRange(0, 1);
        gl.clearDepth(1);
        gl.useProgram(prog);
        if (bones) {
          gl.activeTexture(GL.TEXTURE0 + 13);
          gl.bindTexture(GL.TEXTURE_2D, bones);
          gl.uniform1i(gl.getUniformLocation(prog, "uBones"), 13);
        }
        gl.bindVertexArray(mesh);
      },
      draw: () => {
        layer = 1 - layer;
        gl.bindFramebuffer(GL.FRAMEBUFFER, map.fbs[layer]);
        gl.clear(GL.DEPTH_BUFFER_BIT);
        gl.drawElements(GL.TRIANGLES, PASS_TRIANGLES * 3, GL.UNSIGNED_INT, 0);
      },
    };
  }

  private readonly maps = new Map<number, { texture: Obj; fbs: Obj[] }>();

  /** A 16-bit depth array of two layers `size` square, as a shadow map of two cascades, and a target on each layer. */
  private depthMap(size: number): { texture: Obj; fbs: Obj[] } {
    const had = this.maps.get(size);
    if (had) return had;
    const gl = this.gl;
    const texture = this.keep("texture", this.create());
    gl.activeTexture(GL.TEXTURE0 + 9);
    gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, GL.DEPTH_COMPONENT16, size, size, 2);
    for (const [name, value] of [[GL.TEXTURE_MIN_FILTER, GL.LINEAR], [GL.TEXTURE_MAG_FILTER, GL.LINEAR], [GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE], [GL.TEXTURE_COMPARE_FUNC, GL.LEQUAL]]) gl.texParameteri(GL.TEXTURE_2D_ARRAY, name!, value!);
    const fbs = [0, 1].map((layer) => this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTextureLayer(f, GL.DEPTH_ATTACHMENT, texture, 0, layer), `a 16-bit depth array ${size} square`)));
    const made = { texture, fbs };
    this.maps.set(size, made);
    return made;
  }

  private fields: [Obj, Obj] = [null, null];

  /** The depth passes' mesh: quads a little smaller than their cells, each at a depth of its own, with four bones a vertex. */
  private field(skinned: boolean): Obj {
    const had = this.fields[skinned ? 1 : 0];
    if (had) return had;
    const gl = this.gl;
    const quads = GRID * GRID;
    const pos = new Float32Array(quads * 12);
    const skin = new Uint8Array(quads * 32);
    const index = new Uint32Array(quads * 6);
    let seed = 0x9e3779b9;
    const random = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
    for (let q = 0; q < quads; q++) {
      const [x, y] = [((q % GRID) / GRID) * 2 - 1, (Math.floor(q / GRID) / GRID) * 2 - 1];
      const z = random() * 1.8 - 0.9;
      const w = (2 / GRID) * 0.8;
      pos.set([x, y, z, x + w, y, z, x, y + w, z, x + w, y + w, z], q * 12);
      for (let v = 0; v < 4; v++) skin.set([q % 64, (q + 7) % 64, (q + 19) % 64, (q + 41) % 64, 128, 64, 32, 31], (q * 4 + v) * 8);
      index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    }
    const vao = this.keep("vao", gl.createVertexArray());
    gl.bindVertexArray(vao);
    const buffer = (target: number, data: ArrayBufferView): void => {
      gl.bindBuffer(target, this.keep("buffer", gl.createBuffer()));
      gl.bufferData(target, data, GL.STATIC_DRAW);
    };
    buffer(GL.ARRAY_BUFFER, pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, GL.FLOAT, false, 12, 0);
    if (skinned) {
      buffer(GL.ARRAY_BUFFER, skin);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 4, GL.UNSIGNED_BYTE, 8, 0);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, GL.UNSIGNED_BYTE, true, 8, 4);
    }
    buffer(GL.ELEMENT_ARRAY_BUFFER, index);
    gl.bindVertexArray(null);
    this.fields[skinned ? 1 : 0] = vao;
    return vao;
  }

  private boneTexture: Obj = null;

  /** 64 bones as the renderer keeps them, three RGBA32F texels each: rows of a matrix, here a small shift. */
  private bones(): Obj {
    if (this.boneTexture) return this.boneTexture;
    const gl = this.gl;
    const data = new Float32Array(64 * 12);
    for (let b = 0; b < 64; b++) data.set([1, 0, 0, (b % 8) * 0.001, 0, 1, 0, 0, 0, 0, 1, 0], b * 12);
    const t = (this.boneTexture = this.texture(GL.RGBA32F, 64 * 3, 1));
    gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 64 * 3, 1, GL.RGBA, GL.FLOAT, data);
    return t;
  }

  private screenTarget: Obj = null;

  /** An RGBA8 target the size of the screen, which full-screen passes draw to. */
  private screen(): Obj {
    if (this.screenTarget) return this.screenTarget;
    const gl = this.gl;
    const [w, h] = this.report.screen;
    const t = this.texture(GL.RGBA8, w!, h!);
    return (this.screenTarget = this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, t, 0), `an RGBA8 texture ${w} by ${h}`)));
  }

  /**
   * A full-screen pass of a fragment text. It blends, so that a GPU which shades only the last opaque fragment of a
   * pixel still shades every pass.
   */
  private fullScreen(prog: Obj, uniforms: () => void): { bind(): void; draw(): void; scale: number } {
    const gl = this.gl;
    const fb = this.screen();
    const [w, h] = this.report.screen;
    return {
      scale: 1e6 / (w! * h!),
      bind: () => {
        gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
        gl.viewport(0, 0, w!, h!);
        gl.disable(GL.DEPTH_TEST);
        gl.disable(GL.SCISSOR_TEST);
        gl.disable(GL.CULL_FACE);
        gl.enable(GL.BLEND);
        gl.blendFuncSeparate(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE);
        gl.blendEquationSeparate(GL.FUNC_ADD, GL.FUNC_ADD);
        gl.colorMask(true, true, true, true);
        gl.useProgram(prog);
        gl.bindVertexArray(this.empty);
        uniforms();
      },
      draw: () => gl.drawArrays(GL.TRIANGLES, 0, 3),
    };
  }

  /**
   * The game's program `name` on `tier`, linked as the renderer links it (client/shell/gl.ts): its defines after the
   * #version line, with the shadow lookup filtering for itself where this device's compared lookups came back hard,
   * each sampler pointed at its unit, and its frame block on the probe's binding. `vertex` in place of the game's draws
   * it full screen; it must write what the fragment text reads.
   */
  private linked(name: string, tier: Tier, vertex?: string): { prog: Obj; text: ProgramText } {
    const gl = this.gl;
    const made = PROGRAMS[name];
    if (!made) throw new Error(`the renderer has no program "${name}"`);
    const text = made(tier, this.variant, this.report.compareArray === "hard");
    const prog = this.program(withDefines(vertex ?? text.vertex, text.defines), withDefines(text.fragment, text.defines));
    gl.useProgram(prog);
    for (const sampler in text.samplers) gl.uniform1i(gl.getUniformLocation(prog, sampler), text.samplers[sampler]!);
    const block = gl.getUniformBlockIndex(prog, "Frame");
    if (block !== GL.INVALID_INDEX) gl.uniformBlockBinding(prog, block, PROBE_BLOCK);
    return { prog, text };
  }

  /** A pass of SCREEN_PASSES, with every uniform its program may read set as the renderer would, and its textures bound. */
  private screenPass(spec: ScreenPass): { bind(): void; draw(): void; scale: number } {
    const gl = this.gl;
    const tier = tierOf(spec.tier);
    const vertex = spec.program === "sky" ? undefined : spec.program === "surface" ? SURFACE_VERTEX : wallVertex(spec.wall ?? 12);
    const { prog, text } = this.linked(spec.program, tier, vertex);
    const frame = this.frameBlock(spec.layers, spec.plain, spec.shadowed === true);
    const inputs = this.inputs(text);
    const [w, h] = this.report.screen;
    const at = (n: string): Obj => gl.getUniformLocation(prog, n);
    // The dome looks 14 degrees up toward the sun, as the lit probe times it.
    const sun = [0, 0, 0];
    trueSun(this.frameData(0, false, false), sun);
    const look = lookFrom(Math.atan2(sun[0]!, sun[2]!), (14 * Math.PI) / 180, 1.2217, w! / h!, 0.25, AIR_VIEW);
    return this.fullScreen(prog, () => {
      frame();
      inputs();
      gl.uniform3f(at("uSun"), 0.3, 0.8, 0.52);
      gl.uniform3f(at("uSky"), 0.6, 0.75, 0.9);
      gl.uniform3f(at("uCamMod"), 3.5, 1.6, 7.25);
      gl.uniform2f(at("uFog"), 300, 600);
      gl.uniform1f(at("uSolid"), 1);
      gl.uniform1f(at("uAlpha"), 0.5);
      gl.uniform1f(at("uLight"), 1);
      gl.uniform1f(at("uFade"), tier.reach.bases);
      gl.uniform2f(at("uSize"), w!, h!);
      gl.uniform3f(at("uTint"), 1, 1, 1);
      gl.uniform1f(at("uCutoff"), 0);
      gl.uniform1i(at("uCascades"), spec.shadowed ? tier.shadows.cascades : 0);
      gl.uniformMatrix4fv(at("uViewProj"), false, look);
    });
  }

  private readonly frames = new Map<string, { data: Float32Array; buffer: Obj }>();

  /**
   * Noon's frame block with the air as atmosphere.ts fills it for `layers` of cloud, or plain; medium's fade for the far
   * blocks; and with `shadowed` medium's cascades round the wall 12 m off: the first holds it, its map seen square on.
   */
  private frameData(layers: number, plain: boolean, shadowed: boolean): Float32Array {
    const key = `${layers} ${plain} ${shadowed}`;
    const had = this.frames.get(key);
    if (had) return had.data;
    const data = new Float32Array(FRAME_FLOATS);
    skyFrame(HOUR, theSky(), data);
    airFrame(data, theSky(), HOUR, 0, 0, 0, AIR_VIEW, layers, plain);
    data[FRAME.eyeHeight] = EYE;
    data[FRAME.fade] = MEDIUM.fade;
    for (let k = 0; shadowed && k < MEDIUM.shadows.cascades; k++) {
      // A sphere twice the wall's reach, and its map 20 m across at the wall's depth, 40 m deep.
      data.set([0, 0, -12, 20 * (k + 1)], FRAME.spheres + k * 4);
      data.set([0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.05, 0, 0, 0, 0.6, 1], FRAME.cascades + k * 16);
    }
    this.frames.set(key, { data, buffer: null });
    return data;
  }

  /** That frame block in a buffer, made once: a function that binds it on the probe's binding, which bind() calls. */
  private frameBlock(layers: number, plain: boolean, shadowed: boolean): () => void {
    const gl = this.gl;
    const data = this.frameData(layers, plain, shadowed);
    const made = this.frames.get(`${layers} ${plain} ${shadowed}`)!;
    if (!made.buffer) {
      made.buffer = this.keep("buffer", gl.createBuffer());
      gl.bindBuffer(GL.UNIFORM_BUFFER, made.buffer);
      gl.bufferData(GL.UNIFORM_BUFFER, data, GL.STATIC_DRAW);
    }
    return () => gl.bindBufferBase(GL.UNIFORM_BUFFER, PROBE_BLOCK, made.buffer);
  }

  /**
   * The probe's textures for a program's samplers, by name: the sky table, SURFACE's five maps, the sky's moon and cloud
   * layers, and the depth passes' largest array as the shadow maps. A function that binds each on the unit the program
   * reads it from, one of the probe's own; a sampler the probe has nothing for reads what the renderer left there.
   */
  private inputs(text: ProgramText): () => void {
    const gl = this.gl;
    const bound: [number, number, Obj][] = [];
    const surface = ["uBase", "uNormal", "uMro", "uMask", "uMask2"];
    const sky = ["uMoon", "uLow", "uHigh"];
    for (const [name, unit] of Object.entries(text.samplers)) {
      if (!PROBE_UNITS.includes(unit)) continue;
      if (name === "uSkyTable") bound.push([unit, GL.TEXTURE_3D, this.table()]);
      else if (name === "uShadow") bound.push([unit, GL.TEXTURE_2D_ARRAY, this.depthMap(Math.max(...this.plan.depthSizes)).texture]);
      else if (surface.includes(name)) bound.push([unit, GL.TEXTURE_2D, this.surfaceTextures()[surface.indexOf(name)]]);
      else if (sky.includes(name)) bound.push([unit, GL.TEXTURE_2D, this.skyMaps()[sky.indexOf(name)]]);
    }
    return () => {
      for (const [unit, target, t] of bound) {
        gl.activeTexture(GL.TEXTURE0 + unit);
        gl.bindTexture(target, t);
      }
    };
  }

  private skyTable: Obj = null;

  /** The sky table, 32 a side, as the renderer makes it. */
  private table(): Obj {
    if (this.skyTable) return this.skyTable;
    const gl = this.gl;
    const t = (this.skyTable = this.keep("texture", this.create()));
    gl.bindTexture(GL.TEXTURE_3D, t);
    gl.texStorage3D(GL.TEXTURE_3D, 1, GL.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SLICES);
    gl.texSubImage3D(GL.TEXTURE_3D, 0, 0, 0, 0, SKY_SIZE, SKY_SIZE, SKY_SLICES, GL.RGBA, GL.UNSIGNED_BYTE, theSky().table);
    for (const name of [GL.TEXTURE_MIN_FILTER, GL.TEXTURE_MAG_FILTER]) gl.texParameteri(GL.TEXTURE_3D, name, GL.LINEAR);
    for (const name of [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T, GL.TEXTURE_WRAP_R]) gl.texParameteri(GL.TEXTURE_3D, name, GL.CLAMP_TO_EDGE);
    return t;
  }

  private surfaceMaps: Obj[] | null = null;

  /** SURFACE's five maps, 512 square and mipmapped, of noise. */
  private surfaceTextures(): Obj[] {
    if (this.surfaceMaps) return this.surfaceMaps;
    const gl = this.gl;
    return (this.surfaceMaps = [0, 1, 2, 3, 4].map((r) => {
      const t = this.texture(r === 0 ? GL.SRGB8_ALPHA8 : GL.RGBA8, 512, 512, GL.LINEAR_MIPMAP_LINEAR, 10);
      const data = new Uint8Array(512 * 512 * 4);
      for (let i = 0; i < data.length; i++) data[i] = (Math.imul(i + r * 7919, 2654435761) >>> 24) & 0xff;
      gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 512, 512, GL.RGBA, GL.UNSIGNED_BYTE, data);
      gl.generateMipmap(GL.TEXTURE_2D);
      return t;
    }));
  }

  private skyPictures: Obj[] | null = null;

  /** The sky's moon and two cloud layers, as large as medium has them and mipmapped: the clouds drawn in, the moon black. */
  private skyMaps(): Obj[] {
    if (this.skyPictures) return this.skyPictures;
    const gl = this.gl;
    const levels = Math.log2(SKY_MAP) + 1;
    const moon = this.texture(GL.SRGB8_ALPHA8, SKY_MAP, SKY_MAP, GL.LINEAR_MIPMAP_LINEAR, levels);
    const fill = this.program(`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, CLOUD_FRAGMENT);
    const layers = [0, 1].map((k) => {
      const t = this.texture(GL.RGBA8, SKY_MAP, SKY_MAP, GL.LINEAR_MIPMAP_LINEAR, levels);
      gl.bindFramebuffer(GL.FRAMEBUFFER, this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, t, 0), `a cloud layer's picture ${SKY_MAP} square`)));
      gl.viewport(0, 0, SKY_MAP, SKY_MAP);
      for (const cap of [GL.BLEND, GL.DEPTH_TEST, GL.SCISSOR_TEST, GL.CULL_FACE]) gl.disable(cap);
      gl.colorMask(true, true, true, true);
      gl.useProgram(fill);
      gl.uniform1f(gl.getUniformLocation(fill, "uSeed"), k);
      gl.bindVertexArray(this.empty);
      gl.drawArrays(GL.TRIANGLES, 0, 3);
      gl.bindTexture(GL.TEXTURE_2D, t);
      gl.generateMipmap(GL.TEXTURE_2D);
      return t;
    });
    return (this.skyPictures = [moon, ...layers]);
  }

  /**
   * The far blocks' dithered edge (D258): the far program on a wall in the middle of the last tenth of medium's reach,
   * where the rule keeps half of every 4 by 4 block, drawn into a target EDGE square and read back.
   */
  private *farEdge(): Generator<void, void, void> {
    const gl = this.gl;
    const gone = MEDIUM.reach.bases;
    const at = gone * (1 - MEDIUM.fade / 2);
    const { prog, text } = this.linked("far", MEDIUM, edgeVertex(at));
    const frame = this.frameBlock(0, true, false);
    const inputs = this.inputs(text);
    const out = this.texture(GL.RGBA8, EDGE, EDGE);
    gl.bindFramebuffer(GL.FRAMEBUFFER, this.keep("framebuffer", framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, out, 0), `an RGBA8 texture ${EDGE} square`)));
    gl.viewport(0, 0, EDGE, EDGE);
    for (const cap of [GL.BLEND, GL.DEPTH_TEST, GL.SCISSOR_TEST, GL.CULL_FACE, GL.SAMPLE_ALPHA_TO_COVERAGE]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    frame();
    inputs();
    for (const [name, value] of [["uSolid", 1], ["uAlpha", 1], ["uFade", gone]] as const) gl.uniform1f(gl.getUniformLocation(prog, name), value);
    gl.uniform3f(gl.getUniformLocation(prog, "uSky"), 0.6, 0.75, 0.9);
    gl.uniform2f(gl.getUniformLocation(prog, "uFog"), 1e6, 2e6);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    const px = new Uint8Array(EDGE * EDGE * 4);
    gl.readPixels(0, 0, EDGE, EDGE, GL.RGBA, GL.UNSIGNED_BYTE, px);
    let [kept, rule] = [0, 0];
    for (let y = 0; y < EDGE; y++) {
      for (let x = 0; x < EDGE; x++) {
        if (px[(y * EDGE + x) * 4 + 3]! >= 128) kept++;
        if (fadeKeeps(at, gone, MEDIUM.fade, x, y)) rule++;
      }
    }
    this.report.farEdge = { kept: round(kept / (EDGE * EDGE)), rule: round(rule / (EDGE * EDGE)) };
    yield;
  }

  /** Compared lookups in the 2,048 depth array the depth passes drew, `taps` of them a pixel on a grid a texel apart. */
  private tapsPass(taps: number): { bind(): void; draw(): void; scale: number } {
    const gl = this.gl;
    const size = Math.max(...this.plan.depthSizes);
    const map = this.depthMap(size);
    const side = Math.round(Math.sqrt(taps));
    const prog = this.program(`#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, `#version 300 es
precision highp float;
precision highp sampler2DArrayShadow;
uniform sampler2DArrayShadow uShadow;
uniform vec2 uSize;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float ref = 0.5 + 0.4 * sin(uv.x * 37.0 + uv.y * 23.0);
  float lit = 0.0;
  for (int y = 0; y < ${side}; y++) for (int x = 0; x < ${side}; x++) lit += texture(uShadow, vec4(uv + (vec2(x, y) - ${((side - 1) / 2).toFixed(1)}) / ${size.toFixed(1)}, 0.0, ref));
  o = vec4(vec3(lit / ${taps.toFixed(1)}), 0.5);
}`);
    const [w, h] = this.report.screen;
    return this.fullScreen(prog, () => {
      gl.activeTexture(GL.TEXTURE0 + 9);
      gl.bindTexture(GL.TEXTURE_2D_ARRAY, map.texture);
      gl.uniform1i(gl.getUniformLocation(prog, "uShadow"), 9);
      gl.uniform2f(gl.getUniformLocation(prog, "uSize"), w!, h!);
    });
  }

  /**
   * The main thread's time for a draw as the renderer issues one, by the clock with no readback inside: a uniform, a
   * vertex array, a buffer and two pointers into it, and the draw. The count doubles from 1,000 until a block takes
   * half of AIM_MS, as a coarse clock needs, and then five blocks are timed; the error is half their spread.
   */
  private *drawCost(pass: PassTime): Generator<void, void, void> {
    const gl = this.gl;
    const prog = this.program(`#version 300 es
layout(location=0) in vec3 aPos;
uniform vec3 uOffset;
void main() { gl_Position = vec4(aPos * 0.001 + uOffset, 1.0); }`, COLOUR_FRAGMENT);
    const vaos = [0, 1].map(() => {
      const vao = this.keep("vao", gl.createVertexArray());
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(0);
      return vao;
    });
    const buf = this.keep("buffer", gl.createBuffer());
    gl.bindBuffer(GL.ARRAY_BUFFER, buf);
    gl.bufferData(GL.ARRAY_BUFFER, new Float32Array(9 * 64), GL.STATIC_DRAW);
    gl.bindVertexArray(null);
    const at = gl.getUniformLocation(prog, "uOffset");
    const block = (n: number): number => {
      this.sync();
      gl.useProgram(prog);
      const t0 = this.now();
      for (let i = 0; i < n; i++) {
        gl.uniform3f(at, (i % 7) * 0.01, 0, 0);
        gl.bindVertexArray(vaos[i & 1]);
        gl.bindBuffer(GL.ARRAY_BUFFER, buf);
        gl.vertexAttribPointer(0, 3, GL.FLOAT, false, 12, (i % 64) * 36);
        gl.vertexAttribPointer(0, 3, GL.FLOAT, false, 12, (i % 64) * 36);
        gl.drawArrays(GL.TRIANGLES, 0, 3);
      }
      const ms = this.now() - t0;
      this.sync();
      return ms;
    };
    let n = 1000;
    while (n < 64000 && block(n) < AIM_MS / 2) {
      n *= 2;
      yield;
    }
    const each: number[] = [];
    for (let r = 0; r < 5; r++) {
      each.push((block(n) * 1000) / n);
      yield;
    }
    [pass.slope, pass.error, pass.k, pass.note] = [round(median(each)), round((Math.max(...each) - Math.min(...each)) / 2), n, ""];
  }
}

/**
 * The GPU's time for whole frames, by timer query where there is one: a query from the end of one frame to the end of
 * the next holds everything the next frame gave the GPU. `tick` ends the query under way, marked with `tag`, and
 * begins the next; `take` hands over the times that have come, with their marks. Nothing where there are no timers.
 */
export class FrameTimer {
  readonly on: boolean;
  private readonly gl: Gl2;
  private readonly elapsed: number;
  private open: Obj = null;
  private readonly waiting: { q: Obj; tag: boolean }[] = [];

  constructor(gl: Gl2) {
    this.gl = gl;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT?: number } | null;
    this.elapsed = ext?.TIME_ELAPSED_EXT ?? 0;
    this.on = this.elapsed !== 0;
  }

  tick(tag: boolean): void {
    if (!this.on || this.gl.isContextLost()) return;
    if (this.open) {
      this.gl.endQuery(this.elapsed);
      this.waiting.push({ q: this.open, tag });
    }
    this.open = this.gl.createQuery();
    this.gl.beginQuery(this.elapsed, this.open);
  }

  take(): { ms: number; tag: boolean }[] {
    const out: { ms: number; tag: boolean }[] = [];
    const disjoint = this.on && Boolean(this.gl.getParameter(GL.GPU_DISJOINT));
    while (this.waiting.length > 0 && this.gl.getQueryParameter(this.waiting[0]!.q, GL.QUERY_RESULT_AVAILABLE)) {
      const { q, tag } = this.waiting.shift()!;
      if (!disjoint) out.push({ ms: Number(this.gl.getQueryParameter(q, GL.QUERY_RESULT)) / 1e6, tag });
      this.gl.deleteQuery(q);
    }
    return out;
  }

  stop(): void {
    if (this.open && !this.gl.isContextLost()) this.gl.endQuery(this.elapsed);
    for (const { q } of this.waiting.splice(0)) this.gl.deleteQuery(q);
    if (this.open) this.gl.deleteQuery(this.open);
    this.open = null;
  }
}

/** A pass's note once it is not answered, or `over` its numbers, which a lost context leaves in doubt. */
const failPass = (pass: PassTime) => (why: string, over = false): void => {
  if (over) [pass.timer, pass.slope, pass.error] = [null, null, null];
  if (over || pass.note === "did not finish") pass.note = why;
};
const round = (x: number): number => Math.round(x * 1000) / 1000;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor((s.length - 1) / 2)]!;
}

/** The frame block's bytes, which a lit program's uniform block must hold. */
export const FRAME_BLOCK_BYTES = FRAME_FLOATS * 4;
