// A WebGL 2 context made of numbers, for the device probe's tests. It keeps the state the probe saves and puts back,
// hands out objects, and answers readPixels as a test says. A call it does not know does nothing. A draw by a program
// whose texts declare the frame block, with no buffer on the binding that block was given, is invalid in WebGL: it
// draws nothing, and the fake lists it in `invalid`. It compiles and links as far as glsl.ts can tell without types.

import type { GlLike } from "../../client/core/device.ts";
import { GL, type Gl2 } from "../../client/core/devicegpu.ts";
import { compileErrors, linkErrors } from "./glsl.ts";

export type FakeGl = Gl2 & GlLike & { canvas: unknown; drawingBufferWidth: number; drawingBufferHeight: number };

const BINDING: Record<number, number> = { [GL.TEXTURE_2D]: GL.TEXTURE_BINDING_2D, [GL.TEXTURE_2D_ARRAY]: GL.TEXTURE_BINDING_2D_ARRAY, [GL.TEXTURE_3D]: GL.TEXTURE_BINDING_3D };

export interface FakeOptions {
  /** What getParameter answers for numbers the fake does not keep. */
  params?: Record<number, unknown>;
  /** Fills a readback. By default every pixel is 128 grey, opaque. */
  read?: (out: Uint8Array, width: number, height: number) => void;
  /** Methods in place of the fake's own. */
  with?: Partial<Record<keyof FakeGl, unknown>>;
  /** Told of each valid draw: true for drawElements. */
  drawn?: (elements: boolean) => void;
}

export function fakeGl(o: FakeOptions = {}): FakeGl & { units: Map<number, Map<number, unknown>>; boundOn: Set<number>; state: Map<number, unknown>; invalid: string[]; lose(): void } {
  let next = 1;
  let lost = false;
  const make = (): object => ({ id: next++ });
  const state = new Map<number, unknown>([...[GL.CURRENT_PROGRAM, GL.VERTEX_ARRAY_BINDING, GL.ARRAY_BUFFER_BINDING, GL.DRAW_FRAMEBUFFER_BINDING, GL.READ_FRAMEBUFFER_BINDING, GL.RENDERBUFFER_BINDING].map((n): [number, unknown] => [n, null]), [GL.ACTIVE_TEXTURE, GL.TEXTURE0], [GL.VIEWPORT, [0, 0, 390, 844]], [GL.SCISSOR_BOX, [0, 0, 390, 844]], [GL.DEPTH_RANGE, [0, 1]], [GL.COLOR_WRITEMASK, [true, true, true, true]], [GL.COLOR_CLEAR_VALUE, [0, 0, 0, 0]], [GL.DEPTH_FUNC, GL.LESS], [GL.DEPTH_WRITEMASK, true], [GL.BLEND_SRC_RGB, GL.ONE], [GL.BLEND_DST_RGB, 0], [GL.BLEND_SRC_ALPHA, GL.ONE], [GL.BLEND_DST_ALPHA, 0], [GL.BLEND_EQUATION_RGB, GL.FUNC_ADD], [GL.BLEND_EQUATION_ALPHA, GL.FUNC_ADD], [GL.DEPTH_CLEAR_VALUE, 1], [GL.UNIFORM_BUFFER_BINDING, null]]);
  const caps = new Map<number, boolean>();
  const units = new Map<number, Map<number, unknown>>();
  const boundOn = new Set<number>();
  const unit = (): Map<number, unknown> => units.get(state.get(GL.ACTIVE_TEXTURE) as number) ?? units.set(state.get(GL.ACTIVE_TEXTURE) as number, new Map()).get(state.get(GL.ACTIVE_TEXTURE) as number)!;
  const set = (name: number) => (value: unknown): void => void state.set(name, value);
  const texts = new Map<unknown, string>();
  const blocks = new Map<unknown, number>();
  const uniformBuffers = new Map<number, unknown>();
  const invalid: string[] = [];
  const stages = new Map<unknown, number>();
  const shaders = new Map<unknown, { vertex?: string; fragment?: string }>();
  const errors = new Map<unknown, string[]>();
  const draw = (elements: boolean): void => {
    const program = state.get(GL.CURRENT_PROGRAM);
    const binding = blocks.get(program);
    if (/uniform Frame\b/.test(texts.get(program) ?? "") && (binding === undefined || !uniformBuffers.get(binding))) invalid.push(`a draw by a program whose frame block has no buffer${binding === undefined ? " or binding" : ` on binding ${binding}`}`);
    else o.drawn?.(elements);
  };
  const base: Record<string, unknown> = {
    canvas: { addEventListener: () => {} },
    drawingBufferWidth: 390,
    drawingBufferHeight: 844,
    getParameter: (n: number) => {
      const binding = Object.values(BINDING).includes(n);
      if (binding) return unit().get(n) ?? null;
      return state.has(n) ? state.get(n) : (o.params?.[n] ?? (n === GL.DEPTH_BITS ? 24 : 0));
    },
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getContextAttributes: () => ({ antialias: true }),
    getError: () => GL.NO_ERROR,
    isContextLost: () => lost,
    createShader: (type: number) => {
      const s = make();
      stages.set(s, type);
      return s;
    },
    createProgram: make, createFramebuffer: make, createRenderbuffer: make, createTexture: make, createBuffer: make, createVertexArray: make, createQuery: make,
    compileShader: (s: unknown) => void errors.set(s, compileErrors(texts.get(s) ?? "")),
    getShaderParameter: (s: unknown, name: number) => name !== GL.COMPILE_STATUS || (errors.get(s) ?? []).length === 0,
    getShaderInfoLog: (s: unknown) => (errors.get(s) ?? []).join("\n"),
    linkProgram: (p: unknown) => {
      const { vertex, fragment } = shaders.get(p) ?? {};
      errors.set(p, vertex !== undefined && fragment !== undefined ? linkErrors(vertex, fragment) : []);
    },
    getProgramParameter: (p: unknown, name: number) => name !== GL.LINK_STATUS || (errors.get(p) ?? []).length === 0,
    getProgramInfoLog: (p: unknown) => (errors.get(p) ?? []).join("\n"),
    getUniformLocation: () => ({}),
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    getQueryParameter: () => 0,
    activeTexture: set(GL.ACTIVE_TEXTURE),
    bindTexture: (target: number, t: unknown) => {
      unit().set(BINDING[target]!, t);
      boundOn.add((state.get(GL.ACTIVE_TEXTURE) as number) - GL.TEXTURE0);
    },
    isEnabled: (c: number) => caps.get(c) === true,
    enable: (c: number) => void caps.set(c, true),
    disable: (c: number) => void caps.set(c, false),
    useProgram: set(GL.CURRENT_PROGRAM),
    bindVertexArray: set(GL.VERTEX_ARRAY_BINDING),
    bindBuffer: (target: number, b: unknown) => void (target === GL.ARRAY_BUFFER ? state.set(GL.ARRAY_BUFFER_BINDING, b) : target === GL.UNIFORM_BUFFER && state.set(GL.UNIFORM_BUFFER_BINDING, b)),
    bindBufferBase: (target: number, index: number, b: unknown) => void (target === GL.UNIFORM_BUFFER && (uniformBuffers.set(index, b), state.set(GL.UNIFORM_BUFFER_BINDING, b))),
    getIndexedParameter: (name: number, index: number) => (name === GL.UNIFORM_BUFFER_BINDING ? (uniformBuffers.get(index) ?? null) : null),
    shaderSource: (shader: unknown, text: string) => void texts.set(shader, text),
    attachShader: (program: unknown, shader: unknown) => {
      texts.set(program, (texts.get(program) ?? "") + (texts.get(shader) ?? ""));
      shaders.set(program, { ...shaders.get(program), [stages.get(shader) === GL.VERTEX_SHADER ? "vertex" : "fragment"]: texts.get(shader) ?? "" });
    },
    getUniformBlockIndex: (program: unknown, name: string) => (new RegExp(`uniform ${name}\\b`).test(texts.get(program) ?? "") ? 0 : GL.INVALID_INDEX),
    uniformBlockBinding: (program: unknown, _: number, binding: number) => void blocks.set(program, binding),
    drawArrays: () => draw(false),
    drawElements: () => draw(true),
    bindFramebuffer: (target: number, f: unknown) => {
      if (target !== GL.READ_FRAMEBUFFER) state.set(GL.DRAW_FRAMEBUFFER_BINDING, f);
      if (target !== GL.DRAW_FRAMEBUFFER) state.set(GL.READ_FRAMEBUFFER_BINDING, f);
    },
    bindRenderbuffer: (_: number, r: unknown) => void state.set(GL.RENDERBUFFER_BINDING, r),
    viewport: (...v: number[]) => void state.set(GL.VIEWPORT, v),
    scissor: (...v: number[]) => void state.set(GL.SCISSOR_BOX, v),
    depthRange: (...v: number[]) => void state.set(GL.DEPTH_RANGE, v),
    colorMask: (...v: boolean[]) => void state.set(GL.COLOR_WRITEMASK, v),
    clearColor: (...v: number[]) => void state.set(GL.COLOR_CLEAR_VALUE, v),
    depthFunc: set(GL.DEPTH_FUNC),
    depthMask: set(GL.DEPTH_WRITEMASK),
    clearDepth: set(GL.DEPTH_CLEAR_VALUE),
    blendFuncSeparate: (a: number, b: number, c: number, d: number) => [GL.BLEND_SRC_RGB, GL.BLEND_DST_RGB, GL.BLEND_SRC_ALPHA, GL.BLEND_DST_ALPHA].forEach((n, i) => state.set(n, [a, b, c, d][i])),
    blendEquationSeparate: (a: number, b: number) => void (state.set(GL.BLEND_EQUATION_RGB, a), state.set(GL.BLEND_EQUATION_ALPHA, b)),
    // 128, 128, 128, 255 as one little-endian word a pixel.
    readPixels: (_x: number, _y: number, w: number, h: number, _f: number, _t: number, out: Uint8Array) => (o.read ? o.read(out, w, h) : new Uint32Array(out.buffer, out.byteOffset, out.length >> 2).fill(0xff808080)),
    ...o.with,
  };
  const extra = { units, boundOn, state, invalid, lose: () => void (lost = true) };
  return new Proxy(Object.assign(base, extra), { get: (t, k) => (k in t ? t[k as string] : () => undefined) }) as unknown as ReturnType<typeof fakeGl>;
}
