// What the device probe and the game's own start ask of a WebGL 2 context (render/shadowfilter.ts), and how either puts
// the context back as it found it.

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
  uniform4fv(at: Obj, value: Float32Array): void;
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
  RGBA: 0x1908, RGBA8: 0x8058, R16UI: 0x8234, RED_INTEGER: 0x8d94, SRGB8_ALPHA8: 0x8c43, RGBA32F: 0x8814, DEPTH_COMPONENT: 0x1902, DEPTH_COMPONENT16: 0x81a5, DEPTH_COMPONENT24: 0x81a6, DEPTH_COMPONENT32F: 0x8cac,
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

/** What a compared lookup halfway between a texel in front of the reference and one behind it read: filtered, or a hard 0 or 1. */
export function compareKind(half: number, quarter: number): string {
  if (Math.abs(half - 128) <= 24 && Math.abs(quarter - 64) <= 24) return "filtered";
  if (half <= 2 || half >= 253) return "hard";
  return `neither (${half} halfway, ${quarter} a quarter of the way, of 255)`;
}
