// WebGL2 executor for frame packets. It decides nothing: tiles, batches, levels of detail, materials and colours all
// arrive in the packet. Keep it that way, because logic added here cannot be tested.

import { BONES_PER_ROW, BONE_ROWS, DRAW_BLEND, DRAW_CUTOUT, DRAW_PLAIN, DRAW_TEXTURED, DRAW_TWO_SIDED, FramePacket, SOURCE_MAP, SOURCE_WINDOW, STEP_BODY, STEP_FAR, STEP_FAR_SEE, TILE_QUADS, TRANSIENT_BUFFER, stepOf, type TextureUpload } from "../core/render/packet.ts";
import { PROGRAMS, UNIT, type ProgramText } from "../core/render/programs.ts";
import { WATER_ALPHA } from "../core/render/shading.ts";
import { NEUTRAL, skinMode, skyLight } from "../core/render/surface.ts";
import { coarseGround, groundSize, type GroundSize } from "../core/render/terrain.ts";
import type { AssetUpload } from "../core/assets/residency.ts";
import { DEFAULT_TIER, tierOf, type Tier } from "../core/assets/tiers.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, type Pack, type PackMaterial } from "../../shared/pack/pack.ts";
import { TEXTURE_ROLES, type TextureFormat } from "../../shared/pack/texture.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
  /** The step its shared uniforms were last set for, and the alpha a flat draw last gave it. */
  pass: number;
  alpha: number;
}

interface MeshLod {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexCount: number;
  /** UNSIGNED_SHORT, or UNSIGNED_INT for a level of more than 65,535 vertices, and the bytes of one index. */
  type: number;
  indexBytes: number;
  /** Its surface and skin entries once they have come, and whether there are skin entries. */
  surface: WebGLBuffer | null;
  skin: boolean;
}

/**
 * The formats of each variant for a base colour, a normal map and the rest: the sRGB and linear BC7 of
 * EXT_texture_compression_bptc and the BC5 of EXT_texture_compression_rgtc, the ASTC 4x4 of
 * WEBGL_compressed_texture_astc, and SRGB8_ALPHA8, RG8 and RGBA8.
 */
const FORMATS: Readonly<Record<TextureFormat, readonly number[]>> = {
  bc: [0x8e8d, 0x8dbd, 0x8e8c],
  astc: [0x93d0, 0x93b0, 0x93b0],
  rgba: [0x8c43, 0x822b, 0x8058],
};

export class GlRenderer {
  readonly gl: WebGL2RenderingContext;
  /** GPU and driver as reported by the browser. */
  rendererName = "unknown";
  /** The texture variants this device takes, best first, and the one it is sent: the best, or the one `?texfmt=` names. */
  formats: TextureFormat[] = [];
  format: TextureFormat = "rgba";
  drawCalls = 0;
  /** Errors other than a want of memory after a frame's uploads. There should be none. */
  errors = 0;
  /** Each tier's programs by name, as client/core/render/programs.ts lists them, made as a frame of that tier first asks. */
  private readonly programs = new Map<Tier, Map<string, Program>>();
  /** A pixel for each map a material lacks or has not been sent, made the first time a frame draws with materials. */
  private neutral: WebGLTexture[] = [];
  private current: Program | null = null;
  /** Counts the steps drawn (packet.ts), and holds the view-projection of this one and the view depth its see-through draws start at. */
  private pass = 0;
  private matrix = new Float32Array(16);
  private from = 0;
  /** The levels the card holds, by slot. A frame packet says which to take on and which to let go. */
  private readonly levels = new Map<number, MeshLod>();
  /** The level of each surface the card holds, by the surface's slot. */
  private readonly surfaces = new Map<number, number>();
  /** The copy of each texture drawn with, by its index in the manifest, and a copy being filled. */
  readonly textures = new Map<number, WebGLTexture>();
  private readonly making = new Map<number, WebGLTexture>();
  /** What units 4 to 8 hold, as far as this frame has bound them. */
  private readonly bound: (WebGLTexture | null)[] = [];
  private blending = false;
  private culling = false;
  private covering = false;
  /** Slots, and textures, this frame's uploads could not be given memory for. The shell tells core. */
  readonly failed: number[] = [];
  readonly failedTextures: number[] = [];
  private readonly buffers = new Map<number, WebGLBuffer>();
  private transient!: WebGLBuffer;
  private tileVao!: WebGLVertexArrayObject;
  private tileBuffer!: WebGLBuffer;
  private tileIndexCount = 0;
  private readonly tileData = new Float32Array(1024 * 6);
  private readonly sky = new Float32Array(3);
  private readonly pack: Pack;
  private readonly hf: Heightfield;
  /** The terrain's pictures (terrain.ts), and the two copies of the window's pair, heights then tints. */
  private readonly ground: GroundSize;
  private windows: WebGLTexture[] = [];
  private readonly materials: readonly PackMaterial[];
  /** What each mesh's stored texture coordinates span, four numbers a mesh. */
  private readonly uv: Float32Array;
  private readonly forced: string | null;

  constructor(canvas: HTMLCanvasElement, pack: Pack, hf: Heightfield, manifest: Manifest, forced: string | null = null) {
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.pack = pack;
    this.hf = hf;
    this.ground = groundSize(hf);
    this.materials = manifest.materials ?? [];
    this.uv = Float32Array.from(manifest.meshes.flatMap((m) => m.uv ?? [0, 0, 1, 1]));
    this.forced = forced;
    this.init();
  }

  /** Called again after a lost context is restored. */
  init(): void {
    const gl = this.gl;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.rendererName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const has = (...names: string[]): boolean => names.every((n) => gl.getExtension(n) !== null);
    this.formats = [...(has("EXT_texture_compression_bptc", "EXT_texture_compression_rgtc") ? ["bc" as const] : []), ...(has("WEBGL_compressed_texture_astc") ? ["astc" as const] : []), "rgba"];
    this.format = this.formats.find((f) => f === this.forced) ?? this.formats[0]!;
    this.programs.clear();
    this.neutral = [];
    this.current = null;
    // The flat programs are made at once, so a device that cannot compile them says so at boot.
    this.program("flat", tierOf(DEFAULT_TIER));
    this.program("terrain", tierOf(DEFAULT_TIER));
    this.buffers.clear();
    this.textures.clear();
    this.making.clear();
    this.surfaces.clear();
    this.blending = this.culling = this.covering = false;
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
    // A level without skin entries leaves the SURFACE program's four bones at this, which must be whole numbers.
    gl.vertexAttribI4ui(10, 0, 0, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (unit: number, internal: number, w: number, h: number, format: number, type: number, data: ArrayBufferView | null): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    const [g, coarse] = [this.ground, coarseGround(this.hf)];
    texture(UNIT.palette, gl.RGBA8, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pack.palette);
    texture(UNIT.heights, gl.R16UI, g.width[SOURCE_MAP]!, g.height[SOURCE_MAP]!, gl.RED_INTEGER, gl.UNSIGNED_SHORT, coarse.heights);
    texture(UNIT.tint, gl.R8UI, g.width[SOURCE_MAP]!, g.height[SOURCE_MAP]!, gl.RED_INTEGER, gl.UNSIGNED_BYTE, coarse.tint);
    this.windows = [0, 1, 0, 1].map((k) => texture(UNIT.windowHeights + k, k ? gl.R8UI : gl.R16UI, g.width[SOURCE_WINDOW]!, g.height[SOURCE_WINDOW]!, gl.RED_INTEGER, k ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, null));
    // Each bone is three texels of four floats, read by exact texel. The texture stays bound on its unit.
    texture(UNIT.bones, gl.RGBA32F, BONES_PER_ROW * 3, BONE_ROWS, gl.RGBA, gl.FLOAT, null);

    // A lost context took every level with it. Core sends them again.
    this.levels.clear();
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

  /** One vertex array for a level of detail. Instance attributes are pointed per draw. */
  private take(u: AssetUpload): void {
    const gl = this.gl;
    const indexBytes = u.indexCount * u.indexBytes;
    const vao = gl.createVertexArray()!;
    const buffers = [gl.createBuffer()!, gl.createBuffer()!];
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]!);
    gl.bufferData(gl.ARRAY_BUFFER, u.data.subarray((indexBytes + 3) & ~3), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.SHORT, true, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 6);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribIPointer(6, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 7);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers[1]!);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, u.data.subarray(0, indexBytes), gl.STATIC_DRAW);
    for (let a = 2; a <= 5; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    this.levels.set(u.slot, { vao, buffers, indexCount: u.indexCount, type: u.indexBytes === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, indexBytes: u.indexBytes, surface: null, skin: false });
  }

  /** A level's surface entries, and on a body its skin entries, as attributes 7 to 11 of the level's vertex array. */
  private takeSurface(u: AssetUpload): void {
    const lod = this.levels.get(u.of!);
    if (!lod) return;
    const gl = this.gl;
    const skinAt = u.skinAt ?? u.data.length;
    this.surfaces.set(u.slot, u.of!);
    lod.surface = gl.createBuffer()!;
    lod.skin = u.data.length > skinAt;
    gl.bindVertexArray(lod.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lod.surface);
    gl.bufferData(gl.ARRAY_BUFFER, u.data, gl.STATIC_DRAW);
    gl.vertexAttribPointer(7, 2, gl.UNSIGNED_SHORT, true, SURFACE_BYTES, 0);
    gl.vertexAttribPointer(8, 4, gl.INT_2_10_10_10_REV, true, SURFACE_BYTES, 4);
    gl.vertexAttribPointer(9, 4, gl.INT_2_10_10_10_REV, true, SURFACE_BYTES, 8);
    if (lod.skin) {
      gl.vertexAttribIPointer(10, 4, gl.UNSIGNED_BYTE, SKIN_BYTES, skinAt);
      gl.vertexAttribPointer(11, 4, gl.UNSIGNED_BYTE, true, SKIN_BYTES, skinAt + 4);
    }
    for (let a = 7; a < (lod.skin ? 12 : 10); a++) gl.enableVertexAttribArray(a);
    gl.bindVertexArray(null);
  }

  /** A level, or a surface alone: a surface goes before its level, which is drawn flat until it has one again. */
  private drop(slot: number): void {
    const gl = this.gl;
    const of = this.surfaces.get(slot);
    const lod = this.levels.get(of ?? slot);
    this.surfaces.delete(slot);
    if (!lod) return;
    if (of !== undefined) {
      gl.bindVertexArray(lod.vao);
      for (let a = 7; a < 12; a++) gl.disableVertexAttribArray(a);
      gl.bindVertexArray(null);
    } else {
      gl.deleteVertexArray(lod.vao);
      for (const b of lod.buffers) gl.deleteBuffer(b);
      this.levels.delete(slot);
    }
    gl.deleteBuffer(lod.surface);
    lod.surface = null;
    lod.skin = false;
  }

  /**
   * Rows of one picture of a texture, the smallest picture first. The first row of the one-pixel picture begins a copy
   * with room for every picture, and the last row puts that copy in place of the one drawn with.
   */
  private fill(u: TextureUpload): void {
    const gl = this.gl;
    const internal = FORMATS[u.format][u.role === "base" ? 0 : u.role === "normal" ? 1 : 2]!;
    let copy = this.making.get(u.slot);
    gl.activeTexture(gl.TEXTURE0 + UNIT.maps);
    if (u.size === 1 && u.row === 0) {
      gl.deleteTexture(copy ?? null);
      this.making.set(u.slot, (copy = gl.createTexture()!));
      gl.bindTexture(gl.TEXTURE_2D, copy);
      gl.texStorage2D(gl.TEXTURE_2D, 32 - Math.clz32(u.top), internal, u.top, u.top);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else if (copy) gl.bindTexture(gl.TEXTURE_2D, copy);
    else return;
    // The picture `size` across is as many halvings below the top as `size` is below `top`. A block row is four pixel rows.
    const level = Math.clz32(u.size) - Math.clz32(u.top);
    if (u.format === "rgba") gl.texSubImage2D(gl.TEXTURE_2D, level, 0, u.row, u.size, u.rows, u.role === "normal" ? gl.RG : gl.RGBA, gl.UNSIGNED_BYTE, u.data);
    else gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, u.row * 4, u.size, Math.min(u.rows * 4, u.size - u.row * 4), internal, u.data);
    if (!u.last) return;
    gl.deleteTexture(this.textures.get(u.slot) ?? null);
    this.textures.set(u.slot, copy);
    this.making.delete(u.slot);
  }

  /** A texture leaves the card whole: the copy drawn with and a copy being filled. */
  private forget(t: number): void {
    this.gl.deleteTexture(this.textures.get(t) ?? null);
    this.gl.deleteTexture(this.making.get(t) ?? null);
    this.textures.delete(t);
    this.making.delete(t);
  }

  /** The tier's program of this name, made the first time it is asked for. */
  private program(name: string, tier: Tier): Program {
    const made = this.programs.get(tier) ?? this.programs.set(tier, new Map()).get(tier)!;
    let prog = made.get(name);
    if (!prog) made.set(name, (prog = this.link(PROGRAMS[name]!(tier, this.format))));
    return prog;
  }

  /** Blending, culling and alpha to coverage, each changed only when a draw needs it otherwise. */
  private set(blend: boolean, cull: boolean, cover: boolean): void {
    const gl = this.gl;
    if (blend !== this.blending) {
      if ((this.blending = blend)) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      gl.depthMask(!blend);
    }
    if (cull !== this.culling) {
      if ((this.culling = cull)) gl.enable(gl.CULL_FACE);
      else gl.disable(gl.CULL_FACE);
    }
    if (cover !== this.covering) {
      if ((this.covering = cover)) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      else gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      // The coverage is in alpha, which would show through the page.
      gl.colorMask(true, true, true, !cover);
    }
  }

  /** Makes a program current, and the first time a step of the frame uses it sets what all its draws share: the frame's uniforms are set here and nowhere else. */
  private use(name: string, p: FramePacket): Program {
    const gl = this.gl;
    const prog = this.program(name, p.tier);
    if (this.current !== prog) gl.useProgram((this.current = prog).program);
    if (prog.pass === this.pass) return prog;
    prog.pass = this.pass;
    prog.alpha = 1;
    gl.uniformMatrix4fv(prog.uniform("uViewProj"), false, this.matrix);
    gl.uniform1f(prog.uniform("uFrom"), this.from);
    gl.uniform3fv(prog.uniform("uSun"), p.sun);
    gl.uniform3fv(prog.uniform("uSky"), p.sky);
    gl.uniform3fv(prog.uniform("uSkyLight"), this.sky);
    gl.uniform2f(prog.uniform("uFog"), p.fogStart, p.fogEnd);
    // Checker parity repeats every 16 m, so a small remainder keeps float precision.
    gl.uniform3f(prog.uniform("uCamMod"), p.camX % 16, p.camY % 16, p.camZ % 16);
    gl.uniform1f(prog.uniform("uAlpha"), 1);
    gl.uniform1f(prog.uniform("uLight"), p.light);
    return prog;
  }

  /** A textured draw's material: its tint, grey and cutoff, what its mesh's texture coordinates span, and its maps on their five units. */
  private material(prog: Program, p: FramePacket, d: number): void {
    const gl = this.gl;
    const mat = this.materials[p.drawMaterial[d]!]!;
    gl.uniform3fv(prog.uniform("uTint"), mat.tint);
    gl.uniform1f(prog.uniform("uGrey"), mat.grey);
    gl.uniform1f(prog.uniform("uCutoff"), (p.drawFlags[d]! & DRAW_CUTOUT) !== 0 ? mat.cutoff : 0);
    gl.uniform4fv(prog.uniform("uUv"), this.uv, p.drawMesh[d]! * 4, 4);
    if (this.neutral.length === 0) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.maps);
      this.bound.length = 0;
      this.neutral = TEXTURE_ROLES.map((role) => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, role === "base" ? gl.SRGB8_ALPHA8 : gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.from(NEUTRAL[role]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        return t;
      });
    }
    for (let r = 0; r < TEXTURE_ROLES.length; r++) {
      const t = mat[TEXTURE_ROLES[r]!];
      const texture = (t >= 0 && this.textures.get(t)) || this.neutral[r]!;
      if (this.bound[r] === texture) continue;
      gl.activeTexture(gl.TEXTURE0 + UNIT.maps + r);
      gl.bindTexture(gl.TEXTURE_2D, (this.bound[r] = texture));
    }
  }

  draw(p: FramePacket): void {
    const gl = this.gl;
    this.drawCalls = 0;
    this.failed.length = this.failedTextures.length = 0;
    for (const slot of p.assetDrops) this.drop(slot);
    for (const u of p.assetUploads) {
      if (u.of === undefined) this.take(u);
      else this.takeSurface(u);
    }
    for (const t of p.texDrops) this.forget(t);
    for (const u of p.texUploads) this.fill(u);
    // Running out of memory shows as an error after the fact. It is asked for only in a frame that uploaded, since
    // asking makes the card catch up.
    const error = p.assetUploads.length + p.texUploads.length > 0 ? gl.getError() : gl.NO_ERROR;
    if (error === gl.OUT_OF_MEMORY) {
      for (const u of p.assetUploads) {
        this.drop(u.slot);
        this.failed.push(u.slot);
      }
      for (const u of p.texUploads) {
        if (this.failedTextures.includes(u.slot)) continue;
        this.forget(u.slot);
        this.failedTextures.push(u.slot);
      }
    } else if (error !== gl.NO_ERROR) this.errors++;
    // Rows of a copy of the terrain window, from the heightfield as it lies, and the copy drawn with on its units.
    const [drawn, , , copy, i, j, row, rows] = p.groundWindow;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.hf.nx);
    for (let k = 0; k < 2; k++) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.windowHeights + k);
      if (copy >= 0) {
        gl.bindTexture(gl.TEXTURE_2D, this.windows[copy * 2 + k]!);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, this.ground.width[SOURCE_WINDOW]!, rows, gl.RED_INTEGER, k ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, k ? this.hf.tint : this.hf.heights, (j + row) * this.hf.nx + i);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.windows[drawn * 2 + k] ?? null);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(p.sky[0]!, p.sky[1]!, p.sky[2]!, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    skyLight(this.sky, p);

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
      gl.activeTexture(gl.TEXTURE0 + UNIT.bones);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BONES_PER_ROW * 3, rows, gl.RGBA, gl.FLOAT, p.bones);
    }

    this.bound.length = 0;
    // The step being drawn, and the draw whose level and instances are bound. The sections of a level follow one another and share them.
    let step = -1;
    let held = -1;
    for (let d = 0; d < p.drawCount; d++) {
      // A step's terrain binds its own vertex array.
      const s = stepOf(p, d);
      if (step < s) held = -1;
      while (step < s) this.step(p, ++step);
      const flags = p.drawFlags[d]!;
      const textured = (flags & DRAW_TEXTURED) !== 0;
      const lod = this.levels.get(p.drawSlot[d]!);
      const buffer = p.drawBuffer[d] === TRANSIENT_BUFFER ? this.transient : this.buffers.get(p.drawBuffer[d]!);
      if (!lod || !buffer || (textured && !lod.surface)) continue;
      // A see-through draw blends, shows both faces and leaves depth alone. Others may come after it, so every draw says.
      const blend = (flags & DRAW_BLEND) !== 0;
      const prog = this.use(textured ? "surface" : blend && p.split > 0 ? "seeThrough" : "flat", p);
      this.set(blend, !blend && (flags & DRAW_TWO_SIDED) === 0, (flags & DRAW_CUTOUT) !== 0);
      gl.uniform1f(prog.uniform("uSkin"), skinMode(flags, textured && lod.skin));
      if (textured) this.material(prog, p, d);
      else {
        gl.uniform1f(prog.uniform("uSolid"), (flags & DRAW_PLAIN) !== 0 ? 2 : 1);
        const alpha = blend ? WATER_ALPHA : 1;
        if (prog.alpha !== alpha) gl.uniform1f(prog.uniform("uAlpha"), (prog.alpha = alpha));
      }
      if (held < 0 || p.drawSlot[d] !== p.drawSlot[held] || p.drawBuffer[d] !== p.drawBuffer[held] || p.drawFirst[d] !== p.drawFirst[held] || textured !== ((p.drawFlags[held]! & DRAW_TEXTURED) !== 0)) {
        held = d;
        const info = this.pack.header.meshes[p.drawMesh[d]!]!;
        gl.uniform3fv(prog.uniform("uCenter"), info.center);
        gl.uniform3fv(prog.uniform("uHalf"), info.half);
        gl.uniform3f(prog.uniform("uOffset"), p.drawOffset[d * 3]!, p.drawOffset[d * 3 + 1]!, p.drawOffset[d * 3 + 2]!);
        gl.bindVertexArray(lod.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        // WebGL2 has no base instance, so the range is selected by offsetting the pointers.
        const at = p.drawFirst[d]! * INSTANCE_BYTES;
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_BYTES, at);
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, true, INSTANCE_BYTES, at + 12);
        gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 14);
        gl.vertexAttribIPointer(5, 2, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 18);
      }
      if (textured) gl.drawElementsInstanced(gl.TRIANGLES, p.drawIndexCount[d]!, lod.type, p.drawFirstIndex[d]! * lod.indexBytes, p.drawInstances[d]!);
      else gl.drawElementsInstanced(gl.TRIANGLES, lod.indexCount, lod.type, 0, p.drawInstances[d]!);
      this.drawCalls++;
    }
    // The terrain and the dome are drawn when there is no draw after them.
    while (step < STEP_FAR_SEE) this.step(p, ++step);
    // The next frame's clear writes depth and every channel.
    this.set(false, this.culling, false);
    gl.depthRange(0, 1);
    gl.bindVertexArray(null);
  }

  /**
   * Begins a step of the frame (packet.ts): its view-projection and part of the depth buffer, and in an opaque step the
   * terrain tiles in its range. The viewer's body goes over a depth clear, with its own near plane.
   */
  private step(p: FramePacket, s: number): void {
    const gl = this.gl;
    const far = s === STEP_FAR || s === STEP_FAR_SEE;
    const half = p.split > 0 && s !== STEP_BODY;
    this.pass++;
    this.matrix = s === STEP_BODY ? p.nearViewProj : far ? p.farViewProj : p.viewProj;
    this.from = s === STEP_FAR_SEE ? p.split : 0;
    gl.depthRange(half && far ? 0.5 : 0, half && !far ? 0.5 : 1);
    if (s === STEP_BODY) {
      this.set(false, true, false);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    if (s > STEP_FAR) return;
    // A draw for the tiles that read each pair of pictures: corner and stride in its samples, and its spacing and size.
    const [data, g] = [this.tileData, this.ground];
    for (let source = SOURCE_MAP; source <= SOURCE_WINDOW; source++) {
      let n = 0;
      for (let t = 0; t < p.tileCount; t++) {
        if ((p.tilePass[t]! & (1 << s)) === 0 || p.tileSource[t * 4 + 3] !== source) continue;
        data.set(p.tiles.subarray(t * 4, t * 4 + 3), n * 6);
        data[n * 6 + 3] = p.tileSource[t * 4 + 2]!;
        data[n * 6 + 4] = p.tileSource[t * 4]!;
        data[n * 6 + 5] = p.tileSource[t * 4 + 1]!;
        n++;
      }
      if (n === 0) continue;
      const prog = this.use(source === SOURCE_MAP ? "terrain" : "terrainWindow", p);
      gl.uniform1f(prog.uniform("uSolid"), 0);
      gl.uniform4f(prog.uniform("uField"), this.hf.minY, this.hf.stepY, g.cell[source]!, p.camY);
      gl.uniform2f(prog.uniform("uLast"), g.width[source]! - 1, g.height[source]! - 1);
      this.set(false, false, false);
      gl.bindVertexArray(this.tileVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 6), gl.DYNAMIC_DRAW);
      gl.drawElementsInstanced(gl.TRIANGLES, this.tileIndexCount, gl.UNSIGNED_SHORT, 0, n);
      this.drawCalls++;
    }
  }

  /** `sx` and `sy` are 0..1, origin top-left. */
  readPixel(sx: number, sy: number): [number, number, number] {
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.readPixels(Math.floor(sx * gl.drawingBufferWidth), Math.floor((1 - sy) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0]!, out[1]!, out[2]!];
  }

  /** Compiles the texts as given, with the defines after their first line, the #version line, and points each sampler at its unit. */
  private link(text: ProgramText): Program {
    const gl = this.gl;
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, text.vertex], [gl.FRAGMENT_SHADER, text.fragment]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source.replace("\n", "\n" + text.defines));
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program: " + gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name in text.samplers) gl.uniform1i(gl.getUniformLocation(program, name), text.samplers[name]!);
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      pass: -1,
      alpha: 1,
      uniform(name) {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
        return cache.get(name)!;
      },
    };
  }
}
