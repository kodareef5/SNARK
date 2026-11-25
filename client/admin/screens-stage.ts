// The Screens page's stage, its own bundle: one WebGL context that draws the Vegas ball with the game's own shader
// (client/core/admin/screens-stage.ts) and copies each picture into the page's canvases, the monitors and the tiles.
// The page loads it as a module script, which leaves its exports on the page.

import { STAGE_FLAT_FRAGMENT, STAGE_SITE, STAGE_TIER, STAGE_VERTEX, STAGE_VIEWS, StageFrame, liveKey, liveLook, lookWords, newStageCamera, nextWords, stageCamera, stageGround, stageOrbFragment, stageSky, stageSphere, stageTiles, takeBody, targetKey, targetLook, type StageLook, type StagePicture, type StageView } from "../core/admin/screens-stage.ts";
import { mustSeek, syncRate } from "../core/video/player.ts";

/** A texture the ball reads its picture from, and what was last put in it. */
export class PictureSlot {
  tex: WebGLTexture | null = null;
  width = 0;
  height = 0;
  source: unknown = null;
  time = -1;

  get picture(): StagePicture | null {
    return this.width > 0 ? { width: this.width, height: this.height, levels: Math.floor(Math.log2(Math.max(this.width, this.height))) } : null;
  }
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [kind, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const s = gl.createShader(kind)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`The ball's shader did not compile: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`The ball's shader did not link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** The stage: draws a view of the ball into a canvas of the page. */
export class Stage {
  private readonly canvas = document.createElement("canvas");
  private readonly gl: WebGL2RenderingContext;
  private readonly orb: WebGLProgram;
  private readonly flat: WebGLProgram;
  private readonly sphere: { vao: WebGLVertexArrayObject; count: number };
  private readonly ground: { vao: WebGLVertexArrayObject; count: number };
  private readonly sky: WebGLVertexArrayObject;
  private readonly ubo: WebGLBuffer;
  private readonly blank: WebGLTexture;
  private readonly cam = newStageCamera();

  constructor() {
    const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: false, depth: true, premultipliedAlpha: false });
    if (!gl) throw new Error("This browser has no WebGL 2, so it cannot draw the ball.");
    this.gl = gl;
    this.orb = compile(gl, STAGE_VERTEX, stageOrbFragment());
    this.flat = compile(gl, STAGE_VERTEX, STAGE_FLAT_FRAGMENT);
    const mesh = stageSphere();
    this.sphere = { vao: this.vao(mesh.positions, mesh.indices), count: mesh.indices.length };
    const disc = stageGround();
    this.ground = { vao: this.vao(disc), count: disc.length / 3 };
    this.sky = this.vao(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]));
    // The frame block as the game lays it out: its size is the program's, which is never less than the lanes it reads.
    const block = gl.getUniformBlockIndex(this.orb, "Frame");
    gl.uniformBlockBinding(this.orb, block, 0);
    this.ubo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, gl.getActiveUniformBlockParameter(this.orb, block, gl.UNIFORM_BLOCK_DATA_SIZE) as number, gl.DYNAMIC_DRAW);
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  private vao(positions: Float32Array, indices?: Uint16Array): WebGLVertexArrayObject {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * Puts `source` (a playing video or a poster) in `slot` where it is a new picture: a video's new frame, or a
   * poster not yet put there. A video with no frame yet leaves the slot as it was.
   */
  upload(slot: PictureSlot, source: HTMLVideoElement | HTMLImageElement): void {
    const gl = this.gl, video = source instanceof HTMLVideoElement;
    const w = video ? source.videoWidth : source.naturalWidth, h = video ? source.videoHeight : source.naturalHeight;
    if (w <= 0 || h <= 0 || (video && source.readyState < 2)) return;
    const time = video ? source.currentTime : 0;
    if (slot.source === source && slot.time === time && slot.width === w) return;
    if (slot.width !== w || slot.height !== h) {
      // A texture's storage is fixed once made, so a picture of another size gets a texture of its own.
      if (slot.tex) gl.deleteTexture(slot.tex);
      slot.tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, slot.tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.SRGB8_ALPHA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      slot.width = w;
      slot.height = h;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    slot.source = source;
    slot.time = time;
  }

  /**
   * Draws the ball into `target` as `frame` writes it for `look`, seen from `view` at `bearing`, at the world's clock
   * `seconds` and `hour` and the ball's brightness `gain`, its clip's picture in `slot`.
   */
  draw(target: HTMLCanvasElement, frame: StageFrame, look: StageLook, view: StageView, bearing: number, seconds: number, hour: number, gain: number, slot: PictureSlot | null, still = false): void {
    const gl = this.gl, w = target.width, h = target.height;
    if (w <= 0 || h <= 0) return;
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    const cam = stageCamera(view, bearing, w / h, this.cam);
    const picture = look.clip && slot ? slot.picture : null;
    frame.write(look, cam, seconds, hour, gain, picture, h, still);
    const sky = stageSky(hour), s = STAGE_SITE;
    const bx = s.x - cam.eye[0]!, by = s.y + s.centre - cam.eye[1]!, bz = s.z - cam.eye[2]!;
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // The sky behind it all, then the ground, then the ball.
    gl.useProgram(this.flat);
    const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(this.flat, name);
    gl.uniformMatrix4fv(at("uViewProj"), false, cam.viewProj);
    gl.uniform1f(at("uHeight"), h);
    gl.uniform1f(at("uClip"), 1);
    gl.uniform3fv(at("uTop"), sky.top);
    gl.uniform3fv(at("uFoot"), sky.foot);
    gl.uniform4f(at("uBall"), 0, 0, 0, 1);
    gl.depthMask(false);
    gl.bindVertexArray(this.sky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.uniform1f(at("uClip"), 0);
    gl.uniform3fv(at("uTop"), sky.ground);
    gl.uniform4f(at("uBall"), bx, by, bz, 1);
    gl.bindVertexArray(this.ground.vao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, this.ground.count);
    gl.useProgram(this.orb);
    const ot = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(this.orb, name);
    gl.uniformMatrix4fv(ot("uViewProj"), false, cam.viewProj);
    gl.uniform4f(ot("uBall"), bx, by, bz, s.radius);
    gl.uniform1f(ot("uClip"), 0);
    gl.uniform1i(ot("uScreen"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, picture && slot?.tex ? slot.tex : this.blank);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frame.frame);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
    gl.bindVertexArray(this.sphere.vao);
    gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    // GL's rows run up from the bottom, as the copy's source rect does.
    target.getContext("2d")!.drawImage(this.canvas, 0, this.canvas.height - h, w, h, 0, 0, w, h);
  }
}

/** A clip's video kept in step with where it should be, `want` seconds in: nudged when near, sought when far. */
export function keepInStep(v: HTMLVideoElement, want: number): void {
  if (v.readyState < 1 || !Number.isFinite(want)) return;
  const drift = want - v.currentTime;
  if (mustSeek(drift)) v.currentTime = Math.max(0, want);
  else v.playbackRate = syncRate(drift);
  if (v.paused) void v.play().catch(() => undefined);
}

const screensStage = { Stage, PictureSlot, StageFrame, STAGE_VIEWS, STAGE_TIER, keepInStep, liveKey, liveLook, lookWords, nextWords, stageTiles, takeBody, targetKey, targetLook };
export type ScreensStage = typeof screensStage;
(globalThis as { screensStage?: ScreensStage }).screensStage = screensStage;
