// WebGL2 executor for frame packets. It decides nothing: tiles, batches, levels of detail and colours all arrive
// in the packet. Keep it that way, because logic added here cannot be tested.

import { BONES_PER_ROW, BONE_ROWS, DRAW_BLEND, DRAW_NEAR, DRAW_PLAIN, DRAW_SKINNED, FramePacket, TILE_QUADS, TRANSIENT_BUFFER } from "../core/render/packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE, WATER_ALPHA } from "../core/render/shading.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, lodIndices, lodVertices, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

const f = (n: number): string => n.toFixed(4);

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRel;
flat in vec3 vColor;
uniform vec3 uSun, uSky, uCamMod;
uniform vec2 uFog;
uniform float uSolid, uAlpha, uLight;
out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  float light = (${f(AMBIENT)} + ${f(DIFFUSE)} * max(dot(n, uSun), 0.0)) * uLight;
  vec3 w = vRel + uCamMod - n * ${f(CHECK_INSET)};
  if (uSolid < 0.5) w.y = 0.0;
  float d = length(vRel);
  float shade = 1.0;
  vec3 a = floor(w);
  vec3 b = floor(w / ${f(CHECK_COARSE_SIZE)});
  if (uSolid < 1.5) {
    if (mod(a.x + a.y + a.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_FINE)} * max(0.0, 1.0 - d / ${f(CHECK_FINE_FADE)});
    if (mod(b.x + b.y + b.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_COARSE)} * max(0.0, 1.0 - d / ${f(CHECK_COARSE_FADE)});
  }
  float fog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = vec4(mix(vColor * light * shade, uSky, fog * fog), uAlpha);
}`;

const MESH_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in uint aColor;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
layout(location=6) in uint aBone;
uniform mat4 uViewProj;
uniform vec3 uOffset, uCenter, uHalf;
uniform float uSkin;
uniform sampler2D uPalette;
uniform highp sampler2D uBones;
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
  if (uSkin > 0.5) {
    // A body with bones: the instance names its first bone where a rigid one has its yaw.
    int n = (int(iYaw * 65535.0 + 0.5) + int(aBone)) * 3;
    ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
    vec4 v = vec4(l + iPos, 1.0);
    p = vec3(dot(texelFetch(uBones, at, 0), v), dot(texelFetch(uBones, at + ivec2(1, 0), 0), v), dot(texelFetch(uBones, at + ivec2(2, 0), 0), v));
  } else {
    float t = iYaw * 6.283185307;
    float s = sin(t), c = cos(t);
    p = vec3(c * l.x + s * l.z, l.y, c * l.z - s * l.x) + iPos + uOffset;
  }
  uint i = aColor;
  if (i >= ${REGION_BASE}u) { uint r = i - ${REGION_BASE}u; i = r < 4u ? iRegA[r] : iRegB[r - 4u]; }
  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const TERRAIN_VERTEX = `#version 300 es
layout(location=0) in uvec4 aGrid;
layout(location=1) in vec4 iTile;
layout(location=2) in vec2 iOrigin;
uniform mat4 uViewProj;
uniform highp usampler2D uHeight, uTint;
uniform sampler2D uPalette;
uniform vec4 uField;
uniform vec2 uLast;
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec2 ij = min(iOrigin + vec2(aGrid.xy) * iTile.w, uLast);
  ivec2 at = ivec2(ij);
  float h = uField.x + float(texelFetch(uHeight, at, 0).r) * uField.y - uField.w;
  vec2 d = (ij - iOrigin) * uField.z;
  vec3 p = vec3(iTile.x + d.x, h - float(aGrid.z) * iTile.z * 2.0, iTile.y + d.y);
  vColor = texelFetch(uPalette, ivec2(int(texelFetch(uTint, at, 0).r), 0), 0).rgb;
  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

interface MeshLod {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

export class GlRenderer {
  readonly gl: WebGL2RenderingContext;
  /** GPU and driver as reported by the browser. */
  rendererName = "unknown";
  drawCalls = 0;
  private mesh!: Program;
  private terrain!: Program;
  private meshLods: MeshLod[][] = [];
  private readonly buffers = new Map<number, WebGLBuffer>();
  private transient!: WebGLBuffer;
  private tileVao!: WebGLVertexArrayObject;
  private tileBuffer!: WebGLBuffer;
  private tileIndexCount = 0;
  private readonly tileData = new Float32Array(1024 * 6);
  private readonly pack: Pack;
  private readonly hf: Heightfield;

  constructor(canvas: HTMLCanvasElement, pack: Pack, hf: Heightfield) {
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.pack = pack;
    this.hf = hf;
    this.init();
  }

  /** Called again after a lost context is restored. */
  init(): void {
    const gl = this.gl;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.rendererName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.mesh = this.link(MESH_VERTEX);
    this.terrain = this.link(TERRAIN_VERTEX);
    this.buffers.clear();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (unit: number, internal: number, w: number, h: number, format: number, type: number, data: ArrayBufferView | null): void => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    };
    const hf = this.hf;
    texture(0, gl.RGBA8, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pack.palette);
    texture(1, gl.R16UI, hf.nx, hf.nz, gl.RED_INTEGER, gl.UNSIGNED_SHORT, hf.heights);
    texture(2, gl.R8UI, hf.nx, hf.nz, gl.RED_INTEGER, gl.UNSIGNED_BYTE, hf.tint);
    // Each bone is three texels of four floats, read by exact texel. The texture stays bound on unit 3, which draw() relies on.
    texture(3, gl.RGBA32F, BONES_PER_ROW * 3, BONE_ROWS, gl.RGBA, gl.FLOAT, null);

    // One vertex array per level of detail. Instance attributes are pointed per draw.
    this.meshLods = this.pack.header.meshes.map((m) =>
      m.lods.map((lod) => {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, lodVertices(this.pack, lod), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.SHORT, true, VERTEX_BYTES, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 6);
        gl.enableVertexAttribArray(6);
        gl.vertexAttribIPointer(6, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 7);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lodIndices(this.pack, lod), gl.STATIC_DRAW);
        for (let a = 2; a <= 5; a++) {
          gl.enableVertexAttribArray(a);
          gl.vertexAttribDivisor(a, 1);
        }
        return { vao, indexCount: lod.indexCount };
      }),
    );
    this.transient = gl.createBuffer()!;

    // The terrain is one 32 x 32 grid with a skirt, drawn once per tile.
    const row = TILE_QUADS + 1;
    const verts: number[] = [];
    const index: number[] = [];
    for (let z = 0; z < row; z++) for (let x = 0; x < row; x++) verts.push(x, z, 0, 0);
    for (let z = 0; z < TILE_QUADS; z++) {
      for (let x = 0; x < TILE_QUADS; x++) {
        const a = z * row + x;
        // Same split and colour corner as the collision surface and the reference rasterizer.
        index.push(a + row + 1, a + 1, a, a + row, a + row + 1, a);
      }
    }
    // The skirt repeats the border vertices and drops them, which hides gaps between tiles of different detail.
    const edge = (x: number, z: number): number => (verts.push(x, z, 1, 0), verts.length / 4 - 1);
    for (let i = 0; i < TILE_QUADS; i++) {
      for (const [x0, z0, x1, z1] of [[i, 0, i + 1, 0], [i, TILE_QUADS, i + 1, TILE_QUADS], [0, i, 0, i + 1], [TILE_QUADS, i, TILE_QUADS, i + 1]] as const) {
        const a = z0 * row + x0;
        const b = z1 * row + x1;
        const c = edge(x0, z0);
        const d = edge(x1, z1);
        index.push(a, b, c, b, d, c);
      }
    }
    this.tileIndexCount = index.length;
    this.tileVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.tileVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, Uint8Array.from(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_BYTE, 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint16Array.from(index), gl.STATIC_DRAW);
    this.tileBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  draw(p: FramePacket): void {
    const gl = this.gl;
    const hf = this.hf;
    this.drawCalls = 0;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(p.sky[0]!, p.sky[1]!, p.sky[2]!, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const common = (prog: Program, solid: number): void => {
      gl.useProgram(prog.program);
      gl.uniformMatrix4fv(prog.uniform("uViewProj"), false, p.viewProj);
      gl.uniform3fv(prog.uniform("uSun"), p.sun);
      gl.uniform3fv(prog.uniform("uSky"), p.sky);
      gl.uniform2f(prog.uniform("uFog"), p.fogStart, p.fogEnd);
      // Checker parity repeats every 16 m, so a small remainder keeps float precision.
      gl.uniform3f(prog.uniform("uCamMod"), p.camX % 16, p.camY % 16, p.camZ % 16);
      gl.uniform1f(prog.uniform("uSolid"), solid);
      gl.uniform1f(prog.uniform("uAlpha"), 1);
      gl.uniform1f(prog.uniform("uLight"), p.light);
      gl.uniform1i(prog.uniform("uPalette"), 0);
    };

    if (p.tileCount > 0) {
      common(this.terrain, 0);
      gl.uniform1i(this.terrain.uniform("uHeight"), 1);
      gl.uniform1i(this.terrain.uniform("uTint"), 2);
      gl.uniform4f(this.terrain.uniform("uField"), hf.minY, hf.stepY, hf.cell, p.camY);
      gl.uniform2f(this.terrain.uniform("uLast"), hf.nx - 1, hf.nz - 1);
      const data = this.tileData;
      for (let t = 0; t < p.tileCount; t++) {
        data.set(p.tiles.subarray(t * 4, t * 4 + 4), t * 6);
        data[t * 6 + 4] = p.tileOrigin[t * 2]!;
        data[t * 6 + 5] = p.tileOrigin[t * 2 + 1]!;
      }
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.tileVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, p.tileCount * 6), gl.DYNAMIC_DRAW);
      gl.drawElementsInstanced(gl.TRIANGLES, this.tileIndexCount, gl.UNSIGNED_SHORT, 0, p.tileCount);
      this.drawCalls++;
    }

    // Resource changes first, in order.
    for (const u of p.uploads) {
      let buffer = this.buffers.get(u.buffer);
      if (!buffer) this.buffers.set(u.buffer, (buffer = gl.createBuffer()!));
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, u.data, gl.STATIC_DRAW);
    }
    for (const id of p.drops) {
      gl.deleteBuffer(this.buffers.get(id) ?? null);
      this.buffers.delete(id);
    }
    if (p.transientCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.transient);
      gl.bufferData(gl.ARRAY_BUFFER, p.transient.subarray(0, p.transientCount * INSTANCE_BYTES), gl.DYNAMIC_DRAW);
    }

    if (p.boneCount > 0) {
      const rows = Math.ceil(p.boneCount / BONES_PER_ROW);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BONES_PER_ROW * 3, rows, gl.RGBA, gl.FLOAT, p.bones);
    }

    common(this.mesh, 1);
    gl.uniform1i(this.mesh.uniform("uBones"), 3);
    gl.enable(gl.CULL_FACE);
    const offset = this.mesh.uniform("uOffset");
    const center = this.mesh.uniform("uCenter");
    const half = this.mesh.uniform("uHalf");
    const solid = this.mesh.uniform("uSolid");
    const skin = this.mesh.uniform("uSkin");
    const opaque = (): void => {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.uniform1f(this.mesh.uniform("uAlpha"), 1);
    };
    let blending = false;
    let near = false;
    for (let d = 0; d < p.drawCount; d++) {
      const m = p.drawMesh[d]!;
      const flags = p.drawFlags[d]!;
      // See-through draws come after the opaque ones. They blend, show both faces and leave depth alone.
      if (!blending && (flags & DRAW_BLEND) !== 0) {
        blending = true;
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.uniform1f(this.mesh.uniform("uAlpha"), WATER_ALPHA);
      }
      // The viewer's own body comes last, over everything, with its own near plane.
      if (!near && (flags & DRAW_NEAR) !== 0) {
        near = true;
        opaque();
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(this.mesh.uniform("uViewProj"), false, p.nearViewProj);
      }
      gl.uniform1f(solid, (flags & DRAW_PLAIN) !== 0 ? 2 : 1);
      gl.uniform1f(skin, (flags & DRAW_SKINNED) !== 0 ? 1 : 0);
      const lods = this.meshLods[m]!;
      const lod = lods[Math.min(p.drawLod[d]!, lods.length - 1)]!;
      const buffer = p.drawBuffer[d] === TRANSIENT_BUFFER ? this.transient : this.buffers.get(p.drawBuffer[d]!);
      if (!buffer) continue;
      const info = this.pack.header.meshes[m]!;
      gl.uniform3fv(center, info.center);
      gl.uniform3fv(half, info.half);
      gl.uniform3f(offset, p.drawOffset[d * 3]!, p.drawOffset[d * 3 + 1]!, p.drawOffset[d * 3 + 2]!);
      gl.bindVertexArray(lod.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // WebGL2 has no base instance, so the range is selected by offsetting the pointers.
      const at = p.drawFirst[d]! * INSTANCE_BYTES;
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_BYTES, at);
      gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, true, INSTANCE_BYTES, at + 12);
      gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 14);
      gl.vertexAttribIPointer(5, 2, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 18);
      gl.drawElementsInstanced(gl.TRIANGLES, lod.indexCount, gl.UNSIGNED_SHORT, 0, p.drawInstances[d]!);
      this.drawCalls++;
    }
    if (blending && !near) opaque();
    gl.bindVertexArray(null);
  }

  /** `sx` and `sy` are 0..1, origin top-left. */
  readPixel(sx: number, sy: number): [number, number, number] {
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(sx * gl.drawingBufferWidth), Math.floor((1 - sy) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0]!, out[1]!, out[2]!];
  }

  private link(vertex: string): Program {
    const gl = this.gl;
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program: " + gl.getProgramInfoLog(program));
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      uniform(name) {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
        return cache.get(name)!;
      },
    };
  }
}
