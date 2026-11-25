// The Screens page's monitors for billboards, TVs and laptops: the setting as flat quads and the face with its picture,
// an LED dot grid for a billboard, and the light it throws round it. Part of the stage's bundle (screens-stage.ts),
// which owns the WebGL context and the pictures' textures. The maths is in client/core/admin/screens-faces.ts.

import { faceScene, fitPicture, ledDots, type FaceQuad, type FlatType } from "../core/admin/screens-faces.ts";
import { SCREEN_TYPES } from "../../shared/video/clip.ts";

const FLAT_VERTEX = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aCol;
out vec3 vCol;
void main() { vCol = aCol; gl_Position = vec4(aPos, 0., 1.); }`;

const FLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.); }`;

const FACE_VERTEX = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
out vec2 vUv;
void main() { vUv = aUv; gl_Position = vec4(aPos, 0., 1.); }`;

/** The face: its picture in linear light (an sRGB texture), LEDs as round dots, the wipe from the top, and the light it throws past its edge. */
const FACE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPic;
uniform vec4 uMap;
uniform vec2 uDots, uReach;
uniform vec3 uSpill;
uniform float uHas, uWipe, uGlow, uSheen, uLod;
out vec4 o;
vec3 toSrgb(vec3 c) { c = clamp(c, 0., 1.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
void main() {
  vec2 q = clamp(vUv, 0., 1.);
  float away = length((vUv - q) / uReach);
  if (away > 0.) {
    // Past the edge: light added over what is there, falling off to nothing at the reach.
    float g = uGlow * uHas * exp(-away * 3.) * (1. - smoothstep(.6, 1., away));
    o = vec4(uSpill * g, 0.);
    return;
  }
  vec2 cell = vUv;
  float lit = 1.;
  vec3 c = vec3(.004, .005, .006);
  if (uDots.x > 0.) {
    vec2 at = vUv * uDots;
    cell = (floor(at) + .5) / uDots;
    // Round LEDs with a little light between them, so the picture still reads through the grid.
    lit = .35 + .65 * (1. - smoothstep(.28, .5, length(fract(at) - .5)));
    c = mix(vec3(.002), vec3(.012, .013, .015), lit);
  }
  if (uHas > .5 && vUv.y <= uWipe) {
    vec2 p = cell * uMap.xy + uMap.zw;
    vec3 pic = any(lessThan(p, vec2(0.))) || any(greaterThan(p, vec2(1.))) ? vec3(0.) : textureLod(uPic, p, uDots.x > 0. ? uLod : 0.).rgb;
    c = uDots.x > 0. ? c + pic * lit * 1.3 : pic;
  }
  if (uHas > .5 && uWipe < 1.) c += vec3(.5) * (1. - smoothstep(0., .015, abs(vUv.y - uWipe)));
  // The sky or the room seen in the glass, more at the top.
  c += vec3(uSheen) * (1. - vUv.y * .8);
  o = vec4(toSrgb(c), 1.);
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [kind, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const s = gl.createShader(kind)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`A screen's shader did not compile: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`A screen's shader did not link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** What a face shows: the picture's texture and size (none for a dark face), fill or fit, the wipe's share and the light it throws. */
export interface FacePicture {
  readonly tex: WebGLTexture | null;
  readonly width: number;
  readonly height: number;
  readonly fill: boolean;
  readonly wipe: number;
  readonly spill: readonly number[];
}

/** Draws a flat type's monitor into the bound framebuffer, `w` by `h` pixels. */
export class FaceDrawer {
  private readonly flat: WebGLProgram;
  private readonly face: WebGLProgram;
  private readonly flatVao: WebGLVertexArrayObject;
  private readonly flatBuf: WebGLBuffer;
  private readonly faceVao: WebGLVertexArrayObject;
  private readonly faceBuf: WebGLBuffer;
  private readonly at = new Map<string, WebGLUniformLocation | null>();
  private verts = new Float32Array(0);
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.flat = compile(gl, FLAT_VERTEX, FLAT_FRAGMENT);
    this.face = compile(gl, FACE_VERTEX, FACE_FRAGMENT);
    [this.flatVao, this.flatBuf] = this.vao([[0, 2, 0], [1, 3, 2]], 5);
    [this.faceVao, this.faceBuf] = this.vao([[0, 2, 0], [1, 2, 2]], 4);
  }

  private vao(attrs: readonly (readonly [number, number, number])[], stride: number): [WebGLVertexArrayObject, WebGLBuffer] {
    const gl = this.gl, vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [loc, size, offset] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    gl.bindVertexArray(null);
    return [vao, buf];
  }

  private u(name: string): WebGLUniformLocation | null {
    let loc = this.at.get(name);
    if (loc === undefined) this.at.set(name, (loc = this.gl.getUniformLocation(this.face, name)));
    return loc;
  }

  draw(type: FlatType, w: number, h: number, hour: number, pic: FacePicture, blank: WebGLTexture): void {
    const gl = this.gl, scene = faceScene(type, w / h, hour);
    // The backdrop up the whole canvas, then the parts, two triangles each.
    const quads: FaceQuad[] = [{ at: [-1, -1, 1, -1, 1, 1, -1, 1], top: scene.back.top, foot: scene.back.foot }, ...scene.parts];
    if (this.verts.length < quads.length * 30) this.verts = new Float32Array(quads.length * 30);
    let n = 0;
    for (const q of quads) {
      for (const corner of [0, 1, 2, 0, 2, 3]) {
        const c = corner >= 2 ? q.top : q.foot;
        this.verts.set([q.at[corner * 2]!, q.at[corner * 2 + 1]!, c[0]!, c[1]!, c[2]!], n);
        n += 5;
      }
    }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.flat);
    gl.bindVertexArray(this.flatVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.flatBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n / 5);
    // The face, drawn out past its edge as far as its light reaches.
    const f = scene.face, [rx, ry] = scene.reach, fw = f.x1 - f.x0, fh = f.y1 - f.y0;
    const x0 = f.x0 - rx * fw, x1 = f.x1 + rx * fw, y0 = f.y0 - ry * fh, y1 = f.y1 + ry * fh;
    // Its uv runs down from the top, as the picture's rows do.
    gl.bindVertexArray(this.faceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x0, y0, -rx, 1 + ry, x1, y0, 1 + rx, 1 + ry, x1, y1, 1 + rx, -ry,
      x0, y0, -rx, 1 + ry, x1, y1, 1 + rx, -ry, x0, y1, -rx, -ry,
    ]), gl.DYNAMIC_DRAW);
    gl.useProgram(this.face);
    const has = pic.tex && pic.width > 0, map = fitPicture(has ? pic.width / pic.height : 1, SCREEN_TYPES[type].aspect, pic.fill);
    const facePx = (fw / 2) * w, dots = scene.led ? ledDots(facePx, (fh / 2) * h) : [0, 0];
    gl.uniform1i(this.u("uPic"), 0);
    gl.uniform4f(this.u("uMap"), map.sx, map.sy, map.ox, map.oy);
    gl.uniform2f(this.u("uDots"), dots[0]!, dots[1]!);
    gl.uniform2f(this.u("uReach"), rx, ry);
    gl.uniform3f(this.u("uSpill"), pic.spill[0]!, pic.spill[1]!, pic.spill[2]!);
    gl.uniform1f(this.u("uHas"), has ? 1 : 0);
    gl.uniform1f(this.u("uWipe"), pic.wipe);
    gl.uniform1f(this.u("uGlow"), scene.glow);
    gl.uniform1f(this.u("uSheen"), scene.sheen);
    // Each LED reads the mip level about its own size, so it shows the picture's mean there.
    gl.uniform1f(this.u("uLod"), dots[0]! > 0 && has ? Math.max(0, Math.log2((pic.width * map.sx) / dots[0]!)) : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, has ? pic.tex : blank);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
