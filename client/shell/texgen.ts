// The walls' weathering masks drawn on the card as their plan says (client/core/texgen/plan.ts): an RGBA8 array of
// MADE_LAYERS square layers on its unit, drawn by a program of its own into an attached layer and level.
import { MADE_FIRST, MADE_LAYERS, WEATHER_BAYS, WEATHER_GEN_VERTEX, weatherFragment } from "../core/texgen/weather.ts";
import { WeatherPlan } from "../core/texgen/plan.ts";

const U = ["uSeed", "uField", "uSide", "uLut", "uBay", "uFinish"] as const;
export class WeatherMasks {
  texture: WebGLTexture | null = null;
  readonly plan = new WeatherPlan();
  readonly vao: WebGLVertexArrayObject;
  private program: WebGLProgram | null = null;
  private readonly fbo: WebGLFramebuffer | null;
  private at: (WebGLUniformLocation | null)[] = [];
  private readonly timer: object | null;
  private query: WebGLQuery | null = null;
  private timed = 0;
  private readonly gl: WebGL2RenderingContext;
  private readonly unit: number;
  constructor(gl: WebGL2RenderingContext, unit: number) {
    this.gl = gl;
    this.unit = unit;
    this.vao = gl.createVertexArray()!;
    this.fbo = gl.createFramebuffer();
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  /** A frame's work toward masks `side` wide, in `targetMs` of the card's time; true where it drew, so the caller binds again. */
  step(side: number, targetMs: number, anisotropy: (target: number) => void): boolean {
    const gl = this.gl, p = this.plan;
    if (p.ask(side)) {
      gl.deleteTexture(this.texture);
      gl.activeTexture(gl.TEXTURE0 + this.unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, (this.texture = side ? gl.createTexture() : null));
      if (side) {
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 32 - Math.clz32(side), gl.RGBA8, side, side, MADE_LAYERS);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, p.level);
        anisotropy(gl.TEXTURE_2D_ARRAY);
      }
    }
    // The card's time for the last frame timed, where it has come and the card was not disjoint (GPU_DISJOINT_EXT).
    if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(0x8fbb)) p.measured(gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number, this.timed, targetMs);
      gl.deleteQuery(this.query);
      this.query = null;
    }
    if (!this.texture || !this.linked() || !p.frame()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    // TIME_ELAPSED_EXT.
    const timing = this.timer !== null && this.query === null;
    if (timing) gl.beginQuery(0x88bf, (this.query = gl.createQuery()));
    for (let k = 0; k < p.count; k++) {
      const layer = p.draws[k * 4]!, row = p.draws[k * 4 + 1]!, rows = p.draws[k * 4 + 2]!, half = p.draws[k * 4 + 3]!;
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.texture, p.at, layer);
      gl.uniform1i(this.at[1]!, half < 0 ? 1 : half >= 2 ? half : 0);
      gl.uniform1f(this.at[2]!, p.wide);
      if (half < 0) {
        gl.uniform1i(this.at[0]!, p.seeds[layer - WEATHER_BAYS]!);
        gl.uniform4fv(this.at[3]!, p.luts[layer - WEATHER_BAYS]!);
      } else if (half >= 2) gl.uniform1i(this.at[5]!, ((layer - MADE_FIRST) >> 1) + 1);
      else gl.uniform4fv(this.at[4]!, p.tables[layer * 2 + half]!);
      gl.viewport(0, row, p.wide, rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (timing) {
      gl.endQuery(0x88bf);
      this.timed = p.drawn;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (p.whole >= 0) {
      // A pass is whole: the card reads from it and the levels under it are made from it.
      gl.activeTexture(gl.TEXTURE0 + this.unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, p.whole);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
    return true;
  }

  /** Whether the program has linked, begun the first time and not waited for where the card links apart (KHR_parallel_shader_compile). */
  private linked(): boolean {
    const gl = this.gl;
    if (this.at.length) return true;
    if (!this.program) {
      this.program = gl.createProgram()!;
      const texts = [WEATHER_GEN_VERTEX, weatherFragment()];
      for (let k = 0; k < 2; k++) {
        const s = gl.createShader(k ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER)!;
        gl.shaderSource(s, texts[k]!);
        gl.compileShader(s);
        gl.attachShader(this.program, s);
      }
      gl.linkProgram(this.program);
    }
    if (gl.getExtension("KHR_parallel_shader_compile") && !gl.getProgramParameter(this.program, 0x91b1)) return false;
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("weather masks: " + gl.getProgramInfoLog(this.program) + gl.getAttachedShaders(this.program)!.map((s) => gl.getShaderInfoLog(s)).join(""));
    this.at = U.map((name) => gl.getUniformLocation(this.program!, name));
    return true;
  }
}
