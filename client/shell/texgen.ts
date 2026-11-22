// The walls' weathering masks made on the card (client/core/texgen/weather.ts): an array of WEATHER_LAYERS square
// layers as wide as the frame asks (FramePacket weatherSide), drawn by a program of their own a band of rows at a time,
// a frame's share of the card's time at a time. Every layer is drawn first at an eighth of the side, which the card reads
// from as soon as it is whole, so the weathering shows within a few frames; then at the whole side, which it reads from
// once that is whole. Nothing is fetched: the recipe is in the page. A lost context, or a new side, makes them again.

import { WEATHER_BAYS, WEATHER_GEN_VERTEX, WEATHER_LAYERS, bayFeatures, baySeed, fieldLut, fieldSeed, weatherFragment } from "../core/texgen/weather.ts";
import { WEATHER_RECIPE } from "../../content/texgen/weather.ts";

/** EXT_disjoint_timer_query_webgl2's names, which WebGL2 does not define. */
const TIME_ELAPSED = 0x88bf, GPU_DISJOINT = 0x8fbb;
/** Frames over which the walls' weathering comes up once the masks are made, as the finishes come up (world-surfaces.ts WORLD_RISE). */
export const WEATHER_RISE = 20;
/** Levels under the widest that the first pass is drawn at: an eighth of the side, a 64th of the work. */
const COARSE = 3;
/** Pixels a frame draws before the card's time has been measured, and the least and most it ever draws. */
const FIRST_PIXELS = 1 << 16, LEAST_PIXELS = 1 << 13, MOST_PIXELS = 1 << 21;

export class WeatherMasks {
  /** The array, on its unit while it lives; its side; the level being drawn, and its next layer and row. */
  texture: WebGLTexture | null = null;
  side = 0;
  private level = 0;
  private layer = 0;
  private row = 0;
  /** Whether a whole pass is on the card to be read, and whether the widest is; frames since the first, up to WEATHER_RISE. */
  private shown = false;
  private done = false;
  private risen = 0;
  private program: WebGLProgram | null = null;
  private fbo: WebGLFramebuffer | null = null;
  readonly vao: WebGLVertexArrayObject;
  private at: { seed: WebGLUniformLocation | null; field: WebGLUniformLocation | null; side: WebGLUniformLocation | null; lut: WebGLUniformLocation | null; bay: WebGLUniformLocation | null } | null = null;
  /** Each bay layer's two variants' tables (bayFeatures), the top storey's then the bottom's, made once. */
  private readonly tables = Array.from({ length: WEATHER_BAYS * 2 }, (_, k) => bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, k >> 1, k & 1)));
  /** Pixels a frame may draw, and the milliseconds of the card's that should take; the query under way and the pixels it times. */
  private pixels = FIRST_PIXELS;
  private readonly timer: object | null;
  private query: WebGLQuery | null = null;
  private timed = 0;
  /** Milliseconds the card took for the masks in all, for the bench. */
  spentMs = 0;
  private readonly gl: WebGL2RenderingContext;
  private readonly unit: number;
  private readonly parallel: boolean;
  private readonly targetMs: () => number;

  /** `unit` holds the array; `targetMs` is how much of a frame the card may spend on it. */
  constructor(gl: WebGL2RenderingContext, unit: number, targetMs: () => number) {
    this.gl = gl;
    this.unit = unit;
    this.targetMs = targetMs;
    this.vao = gl.createVertexArray()!;
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.parallel = gl.getExtension("KHR_parallel_shader_compile") !== null;
  }

  /** From 0 while the masks are being made to 1 once they have risen. */
  get ready(): number {
    return this.risen / WEATHER_RISE;
  }

  /**
   * A frame's work toward masks `side` wide: a new side lets the old go and begins again; then bands of rows of the
   * layer being made, within the frame's share of the card's time. True where it drew, so the caller binds again what
   * it changed: the program, the vertex array, the framebuffer and the viewport.
   */
  step(side: number, anisotropy: (target: number) => void): boolean {
    const gl = this.gl;
    if (side !== this.side) {
      gl.deleteTexture(this.texture);
      this.texture = null;
      this.side = side;
      this.layer = this.row = this.risen = 0;
      this.level = Math.max(0, Math.min(COARSE, 31 - Math.clz32(side) - 6));
      if (side > 0) {
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, (this.texture = gl.createTexture()));
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 32 - Math.clz32(side), gl.RGBA8, side, side, WEATHER_LAYERS);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, this.level);
        anisotropy(gl.TEXTURE_2D_ARRAY);
      }
    }
    if (!this.texture) return false;
    // Once the coarse pass is in, the weathering comes up from it while the widest level is made.
    if (this.shown) this.risen = Math.min(WEATHER_RISE, this.risen + 1);
    if (this.done) return false;
    if (!this.ensureProgram()) return false;
    this.measure();
    const wide = side >> this.level, half = wide >> 1;
    const rows = Math.max(1, Math.min(wide, Math.floor(this.pixels / wide)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const at = this.at!;
    const timing = this.timer !== null && this.query === null;
    if (timing) gl.beginQuery(TIME_ELAPSED, (this.query = gl.createQuery()));
    let drawn = 0;
    for (let left = rows; left > 0 && this.layer < WEATHER_LAYERS; ) {
      const layer = this.layer, field = layer >= WEATHER_BAYS;
      if (this.row === 0) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, this.level, layer);
        gl.uniform1i(at.field, field ? 1 : 0);
        gl.uniform1f(at.side, wide);
        if (field) {
          gl.uniform1i(at.seed, fieldSeed(WEATHER_RECIPE, layer - WEATHER_BAYS));
          gl.uniform4fv(at.lut, fieldLut(fieldSeed(WEATHER_RECIPE, layer - WEATHER_BAYS)));
        }
      }
      // A bay's two halves are two variants, each drawn with its own table.
      if (!field && (this.row === 0 || this.row === half)) gl.uniform4fv(at.bay, this.tables[layer * 2 + (this.row === 0 ? 0 : 1)]!);
      const n = Math.min(left, (field || this.row >= half ? wide : half) - this.row);
      gl.viewport(0, this.row, wide, n);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawn += n * wide;
      left -= n;
      this.row += n;
      if (this.row >= wide) {
        this.row = 0;
        this.layer++;
      }
    }
    if (timing) {
      gl.endQuery(TIME_ELAPSED);
      this.timed = drawn;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.layer >= WEATHER_LAYERS) {
      // A pass is whole: the levels under it are made from it, and the card reads from it on. The coarse pass is drawn
      // first so that the weathering shows at once; the widest after it, a layer at a time.
      gl.activeTexture(gl.TEXTURE0 + this.unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, this.level);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      this.shown = true;
      if (this.level === 0) this.done = true;
      else {
        this.level = 0;
        this.layer = 0;
      }
    }
    return true;
  }

  /** Lets everything go, as a lost context has; the next step makes it all again. */
  lost(): void {
    this.texture = this.program = this.fbo = this.query = null;
    this.at = null;
    this.side = this.layer = this.row = this.risen = this.level = 0;
    this.shown = this.done = false;
  }

  /** Whether the program has linked, beginning it the first time; where the card links apart, it is not waited for. */
  private ensureProgram(): boolean {
    const gl = this.gl;
    if (!this.program) {
      const shader = (type: number, text: string): WebGLShader => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, text);
        gl.compileShader(s);
        return s;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, shader(gl.VERTEX_SHADER, WEATHER_GEN_VERTEX));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, weatherFragment()));
      gl.linkProgram(program);
      this.program = program;
      this.fbo = gl.createFramebuffer();
    }
    if (this.at) return true;
    // KHR_parallel_shader_compile's COMPLETION_STATUS_KHR.
    if (this.parallel && !gl.getProgramParameter(this.program, 0x91b1)) return false;
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(this.program) + gl.getAttachedShaders(this.program)!.map((s) => gl.getShaderInfoLog(s)).join("");
      throw new Error("weather masks: " + log);
    }
    this.at = { seed: gl.getUniformLocation(this.program, "uSeed"), field: gl.getUniformLocation(this.program, "uField"), side: gl.getUniformLocation(this.program, "uSide"), lut: gl.getUniformLocation(this.program, "uLut"), bay: gl.getUniformLocation(this.program, "uBay") };
    return true;
  }

  /** Takes the last query's time, where it has come and the card was not disjoint, and sizes a frame's share by it. */
  private measure(): void {
    const gl = this.gl;
    if (!this.query || !gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
    const ns = gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number;
    if (!gl.getParameter(GPU_DISJOINT) && ns > 0 && this.timed > 0) {
      this.spentMs += ns / 1e6;
      this.pixels = Math.max(LEAST_PIXELS, Math.min(MOST_PIXELS, Math.round((this.timed * this.targetMs() * 1e6) / ns)));
    }
    gl.deleteQuery(this.query);
    this.query = null;
  }
}
