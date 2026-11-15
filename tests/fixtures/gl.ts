// A WebGL 2 context made of numbers, for the device probe's tests. It keeps the state the probe saves and puts back,
// hands out objects, and answers readPixels as a test says. A call it does not know does nothing.

import type { GlLike } from "../../client/core/device.ts";
import { GL, type Gl2 } from "../../client/core/devicegpu.ts";

export type FakeGl = Gl2 & GlLike & { canvas: unknown; drawingBufferWidth: number; drawingBufferHeight: number };

const BINDING: Record<number, number> = { [GL.TEXTURE_2D]: GL.TEXTURE_BINDING_2D, [GL.TEXTURE_2D_ARRAY]: GL.TEXTURE_BINDING_2D_ARRAY, [GL.TEXTURE_3D]: GL.TEXTURE_BINDING_3D };

export interface FakeOptions {
  /** What getParameter answers for numbers the fake does not keep. */
  params?: Record<number, unknown>;
  /** Fills a readback. By default every pixel is 128 grey, opaque. */
  read?: (out: Uint8Array, width: number, height: number) => void;
  /** Methods in place of the fake's own. */
  with?: Partial<Record<keyof FakeGl, unknown>>;
}

export function fakeGl(o: FakeOptions = {}): FakeGl & { units: Map<number, Map<number, unknown>>; boundOn: Set<number>; state: Map<number, unknown>; lose(): void } {
  let next = 1;
  let lost = false;
  const make = (): object => ({ id: next++ });
  const state = new Map<number, unknown>([...[GL.CURRENT_PROGRAM, GL.VERTEX_ARRAY_BINDING, GL.ARRAY_BUFFER_BINDING, GL.DRAW_FRAMEBUFFER_BINDING, GL.READ_FRAMEBUFFER_BINDING, GL.RENDERBUFFER_BINDING].map((n): [number, unknown] => [n, null]), [GL.ACTIVE_TEXTURE, GL.TEXTURE0], [GL.VIEWPORT, [0, 0, 390, 844]], [GL.SCISSOR_BOX, [0, 0, 390, 844]], [GL.DEPTH_RANGE, [0, 1]], [GL.COLOR_WRITEMASK, [true, true, true, true]], [GL.COLOR_CLEAR_VALUE, [0, 0, 0, 0]], [GL.DEPTH_FUNC, GL.LESS], [GL.DEPTH_WRITEMASK, true], [GL.BLEND_SRC_RGB, GL.ONE], [GL.BLEND_DST_RGB, 0], [GL.BLEND_SRC_ALPHA, GL.ONE], [GL.BLEND_DST_ALPHA, 0], [GL.BLEND_EQUATION_RGB, GL.FUNC_ADD], [GL.BLEND_EQUATION_ALPHA, GL.FUNC_ADD], [GL.DEPTH_CLEAR_VALUE, 1]]);
  const caps = new Map<number, boolean>();
  const units = new Map<number, Map<number, unknown>>();
  const boundOn = new Set<number>();
  const unit = (): Map<number, unknown> => units.get(state.get(GL.ACTIVE_TEXTURE) as number) ?? units.set(state.get(GL.ACTIVE_TEXTURE) as number, new Map()).get(state.get(GL.ACTIVE_TEXTURE) as number)!;
  const set = (name: number) => (value: unknown): void => void state.set(name, value);
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
    createShader: make, createProgram: make, createFramebuffer: make, createRenderbuffer: make, createTexture: make, createBuffer: make, createVertexArray: make, createQuery: make,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
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
    bindBuffer: (target: number, b: unknown) => void (target === GL.ARRAY_BUFFER && state.set(GL.ARRAY_BUFFER_BINDING, b)),
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
  const extra = { units, boundOn, state, lose: () => void (lost = true) };
  return new Proxy(Object.assign(base, extra), { get: (t, k) => (k in t ? t[k as string] : () => undefined) }) as unknown as ReturnType<typeof fakeGl>;
}
