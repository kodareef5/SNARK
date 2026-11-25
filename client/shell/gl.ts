// WebGL2 executor for frame packets. It decides nothing: tiles, batches, levels of detail, materials and colours all
// arrive in the packet. Keep it that way, because logic added here cannot be tested.

import { captureWidth, type StreetImage } from "../core/render/street-finish.ts";
import {
  moved, ATLAS_ROWS, ATLAS_WIDTH, BEND_BUFFERS, BEND_BYTES, BONES_PER_ROW, DETAIL_FLOATS, DRAW_BENT, DRAW_BLEND, DRAW_CUTOUT, DRAW_DETAILS, DRAW_FIRE,
  DRAW_RANGED, DRAW_TEXTURED, DRAW_TWO_SIDED, DRAW_WATER, FRAME, FRAME_FLOATS, FramePacket, MAX_CASCADES, MAX_CASTERS, MAX_DRAWS, SOURCE_MAP,
  SOURCE_WINDOW, STEP_BODY, STEP_FAR, STEP_FAR_SEE, STREET_SIDE, STREET_TILE_BYTES, STREET_TILE_SIDE, TILE_CASTS, TRANSIENT_BUFFER, boneRows,
  quadIndices, stepOf, type TextureUpload,
} from "../core/render/packet.ts";
import { MASK_LAYER, MASK_MATERIALS, SURFACE_NAMES, SURFACE_PREFIX } from "../../content/surfaces.ts";
import { SKY_MATERIAL } from "../core/render/atmosphere.ts";
import { DetailAtlas, type ReadAtlas } from "./detail-atlas.ts";
import { PIECE_KEYS, PIECE_ROWS } from "../core/render/pieces.ts";
import { PROGRAM, PROGRAMS, UNIFORMS, UNIT, drawProgram, tierPrograms, type ProgramText } from "../core/render/programs.ts";
import {
  AT_DRAW, AT_FRAME, AT_TILES, Drawn, SEND_1F, SEND_1I, SEND_2F, SEND_3F, SEND_3FV, SEND_FLOATS, SHELL_UNIFORMS, type UniformRow,
} from "../core/render/uniforms.ts";
import { made, type Made } from "./texgen.ts";
import type { Orders, Texgen } from "../core/texgen/engine.ts";
import { PASS_CASTERS, PASS_DOME, PASS_FAR_SEE, PASS_FINISH, PASS_MAKING, PASS_OF_STEP, PASS_UPLOADS, type PassClock, type PassCpu } from "../core/passes.ts";
import { comparedLookup } from "../core/render/shadowfilter.ts";
import {
  BLOOM_FORMAT, LIGHT_FORMATS, LIGHT_SAMPLES, bloomLevels, drawsLight, levelShift, passExtent, sceneSize, tapShift,
} from "../core/render/post.ts";
import { POLYGON_OFFSET, shadowLayer, shadowLayers } from "../core/render/shadowtext.ts";
import { SKY_SIZE, SKY_SLICES, theSky } from "../core/render/sky.ts";
import { NEUTRAL, lampsOn } from "../core/render/surface.ts";
import { SKIRT_BEHIND, coarseArea, coarseGround, groundSize, tileMesh, type GroundSize } from "../core/render/terrain.ts";
import type { AssetUpload } from "../core/assets/residency.ts";
import type { Tier } from "../core/assets/tiers.ts";
import type { Manifest, ManifestMesh } from "../../shared/pack/manifest.ts";
import { finishTable, type FinishTable } from "../../shared/pack/finish.ts";
import {
  INSTANCE_BYTES, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, detailsAtlas, textureOf, type Pack, type PackMaterial,
} from "../../shared/pack/pack.ts";
import { MAP_ROLES, TEXTURE_ROLES, type TextureFormat } from "../../shared/pack/texture.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { roadSamples } from "../../shared/world/roadframe.ts";

/** A row a program's texts declare (uniforms.ts): where it is, and where `held` keeps what it was last sent, or sent for. */
interface Held {
  row: UniformRow;
  at: WebGLUniformLocation;
  slot: number;
}

interface Program {
  program: WebGLProgram;
  /** Its texts until its link is checked, the first time it is drawn with, and null after. */
  text: ProgramText | null;
  /** Its rows (programs.ts UNIFORMS), and from when its link is checked those its texts declare, by when each is set. */
  rows: readonly UniformRow[];
  frame: Held[];
  draw: Held[];
  tiles: Held[];
  held: Float64Array;
  /** Where each of the shell's own uniforms is (U), and what each holds as it was set. */
  at: (WebGLUniformLocation | null)[];
  last: Float64Array;
  /** The step or cascade, and the frame, whose uniforms it holds. */
  view: number;
  serial: number;
  /** The bounds uCenter and uHalf were set from: a level's own or its mesh's. */
  bounds: object | null;
}

/**
 * The uniforms the shell sets by code (uniforms.ts SHELL_UNIFORMS), by their place in a program's `at` and `last`.
 * uOffset's three numbers end `last`.
 */
const own = (name: (typeof SHELL_UNIFORMS)[number]): number => SHELL_UNIFORMS.indexOf(name);
const U = {
  viewProj: own("uViewProj"),
  from: own("uFrom"),
  worldReady: own("uWorldReady"),
  texgenReady: own("uTexgenReady"),
  pass: own("uPass"),
  extent: own("uExtent"),
  center: own("uCenter"),
  half: own("uHalf"),
  offset: own("uOffset"),
} as const;
const NO_FLOATS = new Float64Array(0);
const NO_ROWS: readonly UniformRow[] = [];

interface MeshLod {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexCount: number;
  /** UNSIGNED_SHORT, or UNSIGNED_INT for a level of more than 65,535 vertices, and the bytes of one index. */
  type: number;
  indexBytes: number;
  /** The bounds its vertices are stored within where they are not its mesh's. */
  bounds: AssetUpload["bounds"] | null;
  /** Its surface and skin entries once they have come, and whether there are skin entries. */
  surface: WebGLBuffer | null;
  skin: boolean;
  /** The buffer and first instance its instance attributes point at, and whether a stream of bends does too (attributes 13 and 14). */
  buffer: WebGLBuffer | null;
  entityIds: boolean;
  first: number;
  bent: boolean;
}

/**
 * The formats of each variant for a base colour, a normal map and the rest: the sRGB and linear BC7 of
 * EXT_texture_compression_bptc and the BC5 of EXT_texture_compression_rgtc, the ASTC of WEBGL_compressed_texture_astc
 * under the side of its blocks, and SRGB8_ALPHA8, RG8 and RGBA8.
 */
const FORMATS: Readonly<Record<string | number, readonly number[]>> = {
  bc: [0x8e8d, 0x8dbd, 0x8e8c],
  4: [0x93d0, 0x93b0, 0x93b0],
  5: [0x93d2, 0x93b2, 0x93b2],
  6: [0x93d4, 0x93b4, 0x93b4],
  8: [0x93d7, 0x93b7, 0x93b7],
  rgba: [0x8c43, 0x822b, 0x8058],
};
/** The most ms a want of memory goes unknown on a card that never catches up with the page between two frames. */
const ASK_MOST_MS = 5000;
const RUNS = Math.max(MAX_DRAWS, MAX_CASTERS);
/** KHR_parallel_shader_compile's query of whether a program has linked, which does not wait. */
const COMPLETION_STATUS = 0x91b1;

export class GlRenderer {
  readonly gl: WebGL2RenderingContext;
  /** GPU and driver as reported by the browser. */
  rendererName = "unknown";
  /** The texture variants this device takes, best first, and the one it is sent: the best, or the one `?texfmt=` names. */
  formats: TextureFormat[] = [];
  format: TextureFormat = "rgba";
  drawCalls = 0;
  /** Whether part of an instance buffer is written in place (packet.ts BufferUpload `from`). Off, the whole buffer goes up again. */
  partial = true;
  /** Errors other than a want of memory after a frame's uploads. There should be none. */
  errors = 0;
  /** What compared lookups give on this device (shadowfilter.ts). Where they come back "hard" the shadow lookup filters for itself. */
  shadowLookup = "";
  /** The light target's format and samples (post.ts), or 0 where the device has none. */
  light = 0;
  private samples = 0;
  /** The most anisotropy the card filters with, 0 for none: asked once, since asking waits for the card. */
  private mostAnisotropy = 0;
  /**
   * What the light target is made of, `w` by `h`: the scene's framebuffer, multisampled, then its resolved copy's and
   * each bloom level's, with their textures; `drawn`, its corner the frame's scene fills; a pass's read (passExtent).
   */
  private post = {
    size: "",
    w: 0,
    h: 0,
    drawn: [0, 0] as [number, number],
    extent: new Float32Array(4),
    fbs: [] as WebGLFramebuffer[],
    tex: [] as WebGLTexture[],
    bufs: [] as WebGLRenderbuffer[],
  };
  /** The sun's shadow maps: a 16-bit depth layer a cascade and the far map's after them, a target on each cascade's, and their side. */
  private shadow = { texture: null as WebGLTexture | null, targets: [] as WebGLFramebuffer[], size: 0 };
  /** The sky's openness (skyopen.ts) on its unit, and its cells across times 65536 and down. */
  private open = { texture: null as WebGLTexture | null, size: 0 };
  /** An orb's screen picture on UNIT.screen (core/video/player.ts): its texture with every level, and its size. */
  private screen = { texture: null as WebGLTexture | null, w: 0, h: 0 };
  private boneRows = 0;
  /**
   * Each tier's programs by number, as client/core/render/programs.ts numbers them, all begun when a frame of that tier
   * first comes, `warmed`, whose are `made`; one linked for each name and text, which copies of a tier share.
   */
  private readonly programs = new Map<Tier, Program[]>();
  private readonly linked = new Map<string, Program>();
  private warmed: Tier | null = null;
  private made: Program[] = [];
  /** Each tier's programs as `ready` asks after them, and whether the card links away from the page. */
  private readonly asked = new Map<Tier, Program[]>();
  private parallel = false;
  /** Where the frame's GPU time goes (passes.ts), if anything times it. */
  passes: PassClock | null = null;
  /** The page's own time in each pass, which each draw fills while the debug bar reads it (passes.ts PassCpu). */
  cpu: PassCpu | null = null;
  /** The pass the page's clock is in for `cpu`, -1 for none, and since when. */
  private cpuPass = -1;
  private cpuFrom = 0;
  /** A pixel for each map a material lacks or has not been sent, made the first time a frame draws with materials. */
  private neutral: WebGLTexture[] = [];
  private current: Program | null = null;
  /**
   * The frame's number, and that of its step or cascade, `view`, by which a program's `last` knows what it was set
   * for; the view-projection of the step or cascade, from `matrixAt`, and the view depth its see-through draws start at.
   */
  private serial = 0;
  private view = 0;
  private matrix = new Float32Array(16);
  private matrixAt = 0;
  private from = 0;
  /** The opaque step begun last has yet to draw its terrain tiles (packet.ts groundAt). */
  private groundLeft = false;
  /** The vertex array and the array buffer bound. */
  private vao: WebGLVertexArrayObject | null = null;
  private arrayBuffer: WebGLBuffer | null = null;
  /**
   * Where the browser draws many runs of indices in one call; and for a call, each run's indices, then their first
   * bytes, then their instances, RUNS apart.
   */
  private multi: WEBGL_multi_draw | null = null;
  private readonly runs = new Int32Array(RUNS * 3);
  /** The levels the card holds, by slot. A frame packet says which to take on and which to let go. */
  private readonly levels = new Map<number, MeshLod>();
  /** The level of each surface the card holds, by the surface's slot. */
  private readonly surfaces = new Map<number, number>();
  /** The copy of each texture drawn with, by its index in the manifest, and a copy being filled. */
  readonly textures = new Map<number, WebGLTexture>();
  private readonly making = new Map<number, WebGLTexture>();
  /** What units 4 to 8 and the layer's hold, as far as this frame has bound them, and the material and how many of its maps were bound last. */
  private readonly bound: (WebGLTexture | null)[] = [];
  private mapped: PackMaterial | undefined | null = null;
  private mappedRoles = 0;
  /** 1 once every world finish's maps are on the card, this frame. */
  private worldReady = 0;
  /** The textures the card makes (texgen.ts) and their engine, once `makeWith` has its programs ready. */
  private gen!: Made;
  private texgen: Texgen | null = null;
  private readonly anisotropyOf = (target: number): void => void (this.warmed && this.anisotropy(target));
  /** What the rows of a program's uniforms read (uniforms.ts): the frame, and the draw being drawn; and where a row's floats are put. */
  private readonly drawn: Drawn;
  private readonly scratch = new Float64Array(4);
  /**
   * The world finishes' maps by role, each an array of a layer a finish, its side and the finest level drawn; and each
   * world texture's role * 32 + layer.
   */
  private world: (WebGLTexture | null)[] = [];
  private worldSide = [0, 0, 0];
  private worldBase = [-1, -1, -1];
  private readonly worldLayer = new Map<number, number>();
  private blending = false;
  /** Whether what is blended is taken as light already weighed by how much of it shows (`set`). */
  private weighed = false;
  private culling = false;
  private covering = false;
  private offsetting = false;
  /** The ms this frame took to hand the card the assets' levels, surfaces and texture rows, and to drop theirs it let go. */
  uploadMs = 0;
  /** Slots, and textures, this frame found uploads could not be given memory for. The shell tells core. */
  readonly failed: number[] = [];
  readonly failedTextures: number[] = [];
  /** What was uploaded since the card was last asked for an error, and the frames that uploaded. */
  private readonly unaskedSlots: number[] = [];
  private readonly unaskedTextures: number[] = [];
  /** A fence at the end of the frame `askFrame`, set while uploads go unasked; when the first unasked one was made. */
  private asking: WebGLSync | null = null;
  private askFrame = 0;
  private unaskedSince = -1;
  private readonly buffers = new Map<number, WebGLBuffer>();
  /** The indices levels of quads share (packet.ts quadIndices), by the bytes of one, and the bytes each holds: asking the card waits for it. */
  private readonly quads: WebGLBuffer[] = [];
  private readonly quadBytes: number[] = [];
  private transient!: WebGLBuffer;
  private ids!: WebGLBuffer;
  private streetTexture: WebGLTexture | null = null;
  private readonly streetImages: (StreetImage | null)[] = [null, null];
  private readonly streetRevisions = [-1, -1];
  private streetWidth = 0;
  private readonly noReflection = new Float32Array(1);
  private tileVao!: WebGLVertexArrayObject;
  /** Small details: their atlas, bound to its unit for their draws alone, and their particles' buffer and vertex array. */
  private readonly detailAtlas: DetailAtlas | null;
  private detailVao!: WebGLVertexArrayObject;
  private detailBuffer!: WebGLBuffer;
  private tileBuffer!: WebGLBuffer;
  /** The tile mesh's indices, and those of its ground, which come before its skirts'. */
  private tileIndexCount = 0;
  private tileGround = 0;
  private readonly tileData = new Float32Array(1024 * 6);
  /** The frame block, bound to the point every lit program's block "Frame" reads. */
  private frame!: WebGLBuffer;
  private readonly hf: Heightfield;
  /** The terrain's pictures (terrain.ts), and the window's pair, heights then tints. */
  private readonly ground: GroundSize;
  private windows: WebGLTexture[] = [];
  /** The heightfield's changes the whole map's pair on the card holds. */
  private mapSeen = 0;
  private readonly materials: readonly PackMaterial[];
  /** Each mesh's bounds and what its stored texture coordinates span, as the manifest has them once its page has come. */
  private readonly meshes: readonly ManifestMesh[];
  /** The palette and the landmarks' finishes, on the palette's unit, and each mesh's row of them (shared/pack/finish.ts). */
  private readonly finish: FinishTable;
  /** The material whose pictures the dome draws over the sky, if the pack has it. */
  private readonly sky: PackMaterial | undefined;
  private readonly forced: string | null;

  private readonly transparentStage: boolean;
  constructor(canvas: HTMLCanvasElement, pack: Pack, hf: Heightfield, manifest: Manifest, forced: string | null = null, transparentStage = false, readAtlas?: ReadAtlas) {
    this.transparentStage = transparentStage;
    const gl = canvas.getContext("webgl2", { alpha: transparentStage, antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    const atlas = pack.header.details?.atlas;
    this.detailAtlas = atlas ? new DetailAtlas(gl, atlas, detailsAtlas(pack), manifest.files.find(f => f.role === "details"), readAtlas) : null;
    this.hf = hf;
    this.ground = groundSize(hf);
    this.materials = manifest.materials ?? [];
    // The masks (the road's) are the packed array's layers after the finishes'; their base colour and normal are never
    // drawn. A world material that is neither, such as an older pack's painted weathering, has no layer and is not held.
    for (const m of this.materials) {
      if (!m.id.startsWith(SURFACE_PREFIX)) continue;
      const mask = (MASK_MATERIALS as readonly string[]).indexOf(m.id);
      const finish = (SURFACE_NAMES as readonly string[]).indexOf(m.id.slice(SURFACE_PREFIX.length));
      const layer = mask >= 0 ? MASK_LAYER + mask : finish;
      if (layer >= 0) [m.base, m.normal, m.mro].forEach((t, r) => (mask < 0 || r === 2) && this.worldLayer.set(t, r * 32 + layer));
    }
    this.sky = this.materials.find((m) => m.id === SKY_MATERIAL);
    this.meshes = manifest.meshes;
    this.finish = finishTable(pack.palette, manifest);
    this.drawn = new Drawn(pack, hf, this.ground, this.materials, this.meshes, this.finish.row);
    this.forced = forced;
    this.init();
  }

  /** Called again after a lost context is restored. */
  init(): void {
    const gl = this.gl;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    this.rendererName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const has = (...names: string[]): boolean => names.every((n) => gl.getExtension(n) !== null);
    this.formats = [
      ...(has("EXT_texture_compression_bptc", "EXT_texture_compression_rgtc") ? ["bc" as const] : []),
      ...(has("WEBGL_compressed_texture_astc") ? ["astc" as const] : []),
      "rgba",
    ];
    this.format = this.formats.find((f) => f === this.forced) ?? this.formats[0]!;
    this.shadowLookup = comparedLookup(gl);
    this.mostAnisotropy = gl.getExtension("EXT_texture_filter_anisotropic") ? (gl.getParameter(0x84ff) as number) : 0;
    const most = (f: number): number => {
      if (!gl.getExtension("EXT_color_buffer_float")) return 0;
      return (gl.getInternalformatParameter(gl.RENDERBUFFER, f, gl.SAMPLES) as Int32Array | null)?.[0] ?? 0;
    };
    this.light = LIGHT_FORMATS.find((f) => most(f) > 0) ?? 0;
    this.samples = this.light && Math.min(LIGHT_SAMPLES, most(this.light));
    this.post = { size: "", w: 0, h: 0, drawn: [0, 0], extent: this.post.extent, fbs: [], tex: [], bufs: [] };
    this.shadow = { texture: null, targets: [], size: 0 };
    this.open = { texture: null, size: 0 };
    this.screen = { texture: null, w: 0, h: 0 };
    this.programs.clear();
    this.linked.clear();
    this.neutral = [];
    this.world = [null, null, null];
    this.gen = made(gl, UNIT.texgen);
    this.worldSide = [0, 0, 0];
    this.current = this.warmed = this.mapped = this.vao = this.arrayBuffer = null;
    // Where the browser can, programs compile and link away from the page, which asks after one only to draw with it.
    this.parallel = gl.getExtension("KHR_parallel_shader_compile") !== null;
    this.asked.clear();
    this.multi = gl.getExtension("WEBGL_multi_draw");
    this.buffers.clear();
    this.quads.length = this.quadBytes.length = 0;
    this.asking = null;
    this.textures.clear();
    this.making.clear();
    this.surfaces.clear();
    this.blending = this.culling = this.covering = this.offsetting = this.weighed = false;
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
    // A level without skin entries leaves the SURFACE program's four bones at this, which must be whole numbers.
    gl.vertexAttribI4ui(10, 0, 0, 0, 0);
    gl.vertexAttribI4ui(15, 0, 0, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (
      unit: number,
      internal: number,
      w: number,
      h: number,
      format: number,
      type: number,
      data: ArrayBufferView | null,
      filter: number = gl.NEAREST,
    ): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      return t;
    };
    const g = this.ground, coarse = coarseGround(this.hf);
    this.mapSeen = this.hf.changes.length;
    texture(UNIT.palette, gl.RGBA8, 256, this.finish.height, gl.RGBA, gl.UNSIGNED_BYTE, this.finish.pixels);
    texture(UNIT.heights, gl.R16UI, g.width[SOURCE_MAP]!, g.height[SOURCE_MAP]!, gl.RED_INTEGER, gl.UNSIGNED_SHORT, coarse.heights);
    texture(UNIT.tint, gl.R8UI, g.width[SOURCE_MAP]!, g.height[SOURCE_MAP]!, gl.RED_INTEGER, gl.UNSIGNED_BYTE, coarse.tint);
    const ww = g.width[SOURCE_WINDOW]!, wh = g.height[SOURCE_WINDOW]!;
    this.windows = [0, 1].map((k) => {
      return texture(UNIT.windowHeights + k, k ? gl.R8UI : gl.R16UI, ww, wh, gl.RED_INTEGER, k ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, null);
    });
    texture(UNIT.road, gl.RGBA8UI, roadSamples(ww), roadSamples(wh), gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
    // The streets round the camera (core/render/streets.ts): their distances filtered, their kinds read as they are.
    texture(UNIT.streets, gl.RGBA8, STREET_SIDE, STREET_SIDE, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    texture(UNIT.streetKinds, gl.RGBA8UI, STREET_SIDE, STREET_SIDE, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
    // The states of the near chunks' pieces (core/render/pieces.ts), which the vertex texts read.
    texture(UNIT.pieces, gl.RGBA8UI, PIECE_KEYS, PIECE_ROWS, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
    // What stands overhead (roof.ts), filtered, on its unit alone: each map is put on it as it comes.
    texture(UNIT.roof, gl.RGBA8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    // An orb's screen reads black until its first picture comes.
    texture(UNIT.screen, gl.SRGB8_ALPHA8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    // Each bone is three texels of four floats, read by exact texel. The texture stays bound on its unit, as tall as the tier's bones.
    texture(UNIT.bones, gl.RGBA32F, BONES_PER_ROW * 3, (this.boneRows = 1), gl.RGBA, gl.FLOAT, null);
    texture(UNIT.atlas, gl.RGBA32F, ATLAS_WIDTH, ATLAS_ROWS, gl.RGBA, gl.FLOAT, null);
    // The sky table, filtered between its texels and held at its edges, stays bound on its unit too.
    gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
    gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SLICES, 0, gl.RGBA, gl.UNSIGNED_BYTE, theSky().table);
    const table = [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
    ] as const;
    for (const p of table) gl.texParameteri(gl.TEXTURE_3D, p[0], p[1]);

    // A lost context took every level with it. Core sends them again.
    this.levels.clear();
    this.transient = gl.createBuffer()!;
    this.ids = gl.createBuffer()!;
    gl.vertexAttribI4ui(12, 0, 0, 0, 0);
    this.streetTexture = null;
    this.streetWidth = 0;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, (this.frame = gl.createBuffer()!));
    gl.bufferData(gl.UNIFORM_BUFFER, FRAME_FLOATS * 4, gl.DYNAMIC_DRAW);

    // The terrain is one tile's mesh (terrain.ts), drawn once per tile. Its skirts are drawn behind the ground.
    const mesh = tileMesh();
    this.tileIndexCount = mesh.indices.length;
    this.tileGround = mesh.ground;
    this.vertexArray((this.tileVao = gl.createVertexArray()!));
    this.array(gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_BYTE, 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.array((this.tileBuffer = gl.createBuffer()!));
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(2, 1);
    // A particle is a card of four corners drawn from the vertex's index, its numbers as packet.ts DETAIL lays them out.
    this.vertexArray((this.detailVao = gl.createVertexArray()!));
    this.array((this.detailBuffer = gl.createBuffer()!));
    for (let a = 0; a < 7; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    this.vertexArray(null);
    this.detailAtlas?.init();
    gl.enable(gl.DEPTH_TEST);
  }

  /** A draw of small details: its run of the frame's particles, cut out with the opaque or blended, with the atlas on its unit. */
  private details(p: FramePacket, d: number): void {
    const gl = this.gl;
    const blend = (p.drawFlags[d]! & DRAW_BLEND) !== 0;
    const prog = this.use(PROGRAM.details, p);
    this.set(blend, false, !blend, false, blend);
    this.drawn.flags = p.drawFlags[d]!;
    this.give(prog, prog.draw);
    gl.activeTexture(gl.TEXTURE0 + UNIT.details);
    gl.bindTexture(gl.TEXTURE_2D, this.detailAtlas?.texture ?? null);
    this.vertexArray(this.detailVao);
    this.array(this.detailBuffer);
    const stride = DETAIL_FLOATS * 4, at = p.drawFirst[d]! * stride;
    for (let a = 0; a < 4; a++) gl.vertexAttribPointer(a, a === 3 ? 1 : 3, gl.FLOAT, false, stride, at + a * 12);
    gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, stride, at + 40);
    gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, stride, at + 44);
    gl.vertexAttribIPointer(6, 4, gl.UNSIGNED_BYTE, stride, at + 48);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.drawInstances[d]!);
    this.drawCalls++;
  }

  /**
   * One vertex array for a level of detail, its buffers made the size of the whole by its first piece and each piece
   * written where it belongs (residency.ts AssetUpload). Instance attributes are pointed per draw.
   */
  private take(u: AssetUpload): void {
    const gl = this.gl;
    const indexBytes = u.quads ? 0 : u.indexCount * u.indexBytes, vertices = (indexBytes + 3) & ~3;
    const at = u.at ?? 0, end = at + u.data.length, from = Math.max(at, vertices);
    let lod = this.levels.get(u.slot);
    if (at === 0) {
      lod = {
        vao: gl.createVertexArray()!,
        buffers: u.quads ? [gl.createBuffer()!] : [gl.createBuffer()!, gl.createBuffer()!],
        indexCount: u.indexCount,
        type: u.indexBytes === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        indexBytes: u.indexBytes,
        bounds: u.bounds ?? null,
        surface: null,
        skin: false,
        buffer: null,
        entityIds: false,
        first: 0,
        bent: false,
      };
      this.levels.set(u.slot, lod);
      this.vertexArray(lod.vao);
      this.array(lod.buffers[0]!);
      gl.bufferData(gl.ARRAY_BUFFER, (u.whole ?? end) - vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.SHORT, true, VERTEX_BYTES, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 6);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribIPointer(6, 1, gl.UNSIGNED_BYTE, VERTEX_BYTES, 7);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, u.quads ? (this.quads[u.indexBytes] ??= gl.createBuffer()!) : lod.buffers[1]!);
      if (!u.quads) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBytes, gl.STATIC_DRAW);
      else if ((this.quadBytes[u.indexBytes] ?? 0) < u.indexCount * u.indexBytes) {
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices(u.indexCount, u.indexBytes), gl.STATIC_DRAW);
        this.quadBytes[u.indexBytes] = u.indexCount * u.indexBytes;
      }
      for (let a = 2; a <= 5; a++) {
        gl.enableVertexAttribArray(a);
        gl.vertexAttribDivisor(a, 1);
      }
      if (u.piece) {
        this.array(lod.buffers[lod.buffers.push(gl.createBuffer()!) - 1]!);
        gl.bufferData(gl.ARRAY_BUFFER, u.piece, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(15);
        gl.vertexAttribIPointer(15, 1, gl.UNSIGNED_INT, 4, 0);
      }
    } else if (!lod) return;
    this.vertexArray(lod.vao);
    if (at < indexBytes) gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, at, u.data, 0, Math.min(end, indexBytes) - at);
    if (end <= from) return;
    this.array(lod.buffers[0]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, from - vertices, u.data, from - at, end - from);
  }

  /** A level's surface entries, and on a body its skin entries, as attributes 7 to 11 of the level's vertex array, made and written as a level is. */
  private takeSurface(u: AssetUpload): void {
    const lod = this.levels.get(u.of!);
    const at = u.at ?? 0;
    if (!lod || (at > 0 && !lod.surface)) return;
    const gl = this.gl;
    if (at === 0) {
      const whole = u.whole ?? u.data.length, skinAt = u.skinAt ?? whole;
      this.surfaces.set(u.slot, u.of!);
      lod.surface = gl.createBuffer()!;
      lod.skin = whole > skinAt;
      this.vertexArray(lod.vao);
      this.array(lod.surface);
      gl.bufferData(gl.ARRAY_BUFFER, whole, gl.STATIC_DRAW);
      gl.vertexAttribPointer(7, 2, gl.UNSIGNED_SHORT, true, SURFACE_BYTES, 0);
      gl.vertexAttribPointer(8, 4, gl.INT_2_10_10_10_REV, true, SURFACE_BYTES, 4);
      gl.vertexAttribPointer(9, 4, gl.INT_2_10_10_10_REV, true, SURFACE_BYTES, 8);
      if (lod.skin) {
        gl.vertexAttribIPointer(10, 4, gl.UNSIGNED_BYTE, SKIN_BYTES, skinAt);
        gl.vertexAttribPointer(11, 4, gl.UNSIGNED_BYTE, true, SKIN_BYTES, skinAt + 4);
      }
      for (let a = 7; a < (lod.skin ? 12 : 10); a++) gl.enableVertexAttribArray(a);
      this.vertexArray(null);
    }
    this.array(lod.surface);
    gl.bufferSubData(gl.ARRAY_BUFFER, at, u.data);
  }

  /** A level, or a surface alone: a surface goes before its level, which is drawn flat until it has one again. */
  private drop(slot: number): void {
    const gl = this.gl;
    const of = this.surfaces.get(slot);
    const lod = this.levels.get(of ?? slot);
    this.surfaces.delete(slot);
    if (!lod) return;
    if (of !== undefined) {
      this.vertexArray(lod.vao);
      for (let a = 7; a < 12; a++) gl.disableVertexAttribArray(a);
      this.vertexArray(null);
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
    const internal = FORMATS[u.format === "astc" ? u.block! : u.format]![u.role === "base" || u.role === "layer" ? 0 : u.role === "normal" ? 1 : 2]!;
    const w = this.worldLayer.get(u.slot);
    if (w !== undefined) return this.fillWorld(u, w >> 5, w & 31, internal);
    let copy = this.making.get(u.slot);
    gl.activeTexture(gl.TEXTURE0 + UNIT.maps);
    if (u.size === 1 && u.row === 0) {
      gl.deleteTexture(copy ?? null);
      this.making.set(u.slot, (copy = gl.createTexture()!));
      gl.bindTexture(gl.TEXTURE_2D, copy);
      gl.texStorage2D(gl.TEXTURE_2D, 32 - Math.clz32(u.top), internal, u.top, u.top);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      this.anisotropy(gl.TEXTURE_2D);
    } else if (copy) gl.bindTexture(gl.TEXTURE_2D, copy);
    else return;
    // The picture `size` across is as many halvings below the top as `size` is below `top`.
    const level = Math.clz32(u.size) - Math.clz32(u.top);
    const pixels = u.role === "normal" ? gl.RG : gl.RGBA;
    if (u.format === "rgba") gl.texSubImage2D(gl.TEXTURE_2D, level, 0, u.row, u.size, u.rows, pixels, gl.UNSIGNED_BYTE, u.data);
    else gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, u.row, u.size, u.rows, internal, u.data);
    if (!u.last) return;
    gl.deleteTexture(this.textures.get(u.slot) ?? null);
    this.textures.set(u.slot, copy);
    this.making.delete(u.slot);
  }

  /** Reads the texture bound to `target` for the angle it is seen at, as far as the frame's tier asks and the card offers. */
  private anisotropy(target: number): void {
    if (this.mostAnisotropy > 0) this.gl.texParameterf(target, 0x84fe, Math.max(1, Math.min(this.warmed!.anisotropy, this.mostAnisotropy)));
  }

  /** Rows of a world finish's picture into its layer of its role's array, which is made at the side the frame asks when first written. */
  private fillWorld(u: TextureUpload, role: number, layer: number, internal: number): void {
    const gl = this.gl, side = this.worldSide[role]!, level = Math.clz32(u.size) - Math.clz32(side);
    if (side === 0 || level < 0) return;
    gl.activeTexture(gl.TEXTURE0 + UNIT.maps + role);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.world[role] ?? (this.world[role] = gl.createTexture()));
    if (this.worldBase[role] === -2) {
      const layers = role === 2 ? MASK_LAYER + MASK_MATERIALS.length : SURFACE_NAMES.length;
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 32 - Math.clz32(side), internal, side, side, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      this.anisotropy(gl.TEXTURE_2D_ARRAY);
      this.worldBase[role] = -1;
    }
    const pixels = u.role === "normal" ? gl.RG : gl.RGBA;
    if (u.format === "rgba") gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, u.row, layer, u.size, u.rows, 1, pixels, gl.UNSIGNED_BYTE, u.data);
    else gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, u.row, layer, u.size, u.rows, 1, internal, u.data);
  }

  /** A texture leaves the card whole: the copy drawn with and a copy being filled. */
  private forget(t: number): void {
    this.gl.deleteTexture(this.textures.get(t) ?? null);
    this.gl.deleteTexture(this.making.get(t) ?? null);
    this.textures.delete(t);
    this.making.delete(t);
  }

  /** Program `n` of the frame's tier, begun the first time it is asked for. */
  private program(n: number, light = this.light > 0, tier = this.warmed!): Program {
    const text = Object.values(PROGRAMS)[n]!(tier, this.format, this.shadowLookup === "hard", light);
    const key = n + text.defines + text.vertex + text.fragment;
    const made = this.linked.get(key) ?? this.linked.set(key, this.link(text, UNIFORMS[n]!)).get(key)!;
    return light === this.light > 0 && tier === this.warmed ? (this.made[n] = made) : made;
  }

  /**
   * Whether every program a frame of `tier` draws with has linked, with the copies a step to no light target draws,
   * beginning any not begun. Where the card links away from the page (KHR_parallel_shader_compile) asking waits for
   * nothing, so a new tier or a governor's step can be drawn once it is ready; elsewhere it is ready at once, and its
   * first frame waits for the links as it always did.
   */
  ready(tier: Tier): boolean {
    if (!this.parallel) return true;
    let progs = this.asked.get(tier);
    if (!progs) {
      const lights = drawsLight(tier, this.light) ? [true, false] : [this.light > 0];
      progs = tierPrograms(tier).flatMap((n) => lights.map((light) => this.program(n, light, tier)));
      this.asked.set(tier, progs);
    }
    return progs.every((prog) => !prog.text || this.gl.getProgramParameter(prog.program, COMPLETION_STATUS));
  }

  /** Begins the programs of the tier being drawn that a late file has just brought (programs.ts LATE), so their first draw waits for less. */
  /**
   * An orb's screen picture, a video's frame or a poster, on UNIT.screen as sRGB, so a read gives linear light: made
   * again with all its levels at a new size, and its levels made from it where `mips` asks.
   */
  private screenPicture(source: TexImageSource, w: number, h: number, mips: boolean): void {
    const gl = this.gl;
    if (w <= 0 || h <= 0) return;
    gl.activeTexture(gl.TEXTURE0 + UNIT.screen);
    if (w !== this.screen.w || h !== this.screen.h) {
      gl.deleteTexture(this.screen.texture);
      gl.bindTexture(gl.TEXTURE_2D, (this.screen = { texture: gl.createTexture(), w, h }).texture);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.SRGB8_ALPHA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else gl.bindTexture(gl.TEXTURE_2D, this.screen.texture);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    } catch {
      this.errors++;
    }
  }

  late(): void {
    this.asked.clear();
    if (!this.warmed) return;
    for (const n of tierPrograms(this.warmed)) if (!this.made[n]) this.program(n);
    if (drawsLight(this.warmed, this.light)) for (const n of tierPrograms(this.warmed)) this.program(n, false);
  }

  /** Job `k`'s program of the textures the card makes, once linked; none while it links, and none for good where it failed. */
  private readonly job = (k: number, o: Orders = this.texgen!.orders): WebGLProgram | null => {
    const gl = this.gl, text = o.programs[k]!;
    const prog = this.linked.get(text.fragment) ?? this.linked.set(text.fragment, this.link(text, NO_ROWS)).get(text.fragment)!;
    if (prog.text && this.parallel && !gl.getProgramParameter(prog.program, COMPLETION_STATUS)) return null;
    if (prog.text && !gl.getProgramParameter(prog.program, gl.LINK_STATUS)) return (o.broken = true), this.errors++, null;
    prog.text = null;
    return prog.program;
  };

  /** Makes textures on the card with `engine` once each of its programs has linked and drawn a pixel, between frames, with the state the making draws in. */
  async makeWith(engine: Texgen): Promise<void> {
    const o = engine.warm();
    while (!o.broken && (this.set(false, false, false), this.gen.draw(o, (k) => this.job(k, o), this.anisotropyOf), o.drawn < o.count)) await new Promise((go) => setTimeout(go, 16));
    this.current = null;
    this.vao = this.gen.vao;
    this.texgen = engine;
  }

  /** Binds a vertex array unless it is bound. */
  private vertexArray(vao: WebGLVertexArrayObject | null): void {
    if (vao !== this.vao) this.gl.bindVertexArray((this.vao = vao));
  }

  /** Binds an array buffer unless it is bound. */
  private array(buffer: WebGLBuffer | null): void {
    if (buffer !== this.arrayBuffer) this.gl.bindBuffer(this.gl.ARRAY_BUFFER, (this.arrayBuffer = buffer));
  }

  /**
   * Sets each of `rows` of `prog`, the program in use, from what `drawn` says, unless the program holds it already: a
   * number that is the one last sent, and floats or an array last sent for the same key (uniforms.ts). It makes nothing.
   */
  private give(prog: Program, rows: readonly Held[]): void {
    const gl = this.gl, c = this.drawn, last = prog.held, out = this.scratch;
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i]!, row = h.row, k = h.slot, send = row.send;
      if (row.value !== null) {
        const v = row.value(c);
        if (last[k] === v) continue;
        last[k] = v;
        if (send === SEND_1F) gl.uniform1f(h.at, v);
        else if (send === SEND_1I) gl.uniform1i(h.at, v);
        else gl.uniform1ui(h.at, v);
        continue;
      }
      if (row.key !== null) {
        const key = row.key(c);
        if (last[k] === key) continue;
        if (row.array !== null) {
          const a = row.array(c) as Float32List | null;
          if (a === null) continue;
          last[k] = key;
          if (send === SEND_3FV) gl.uniform3fv(h.at, a);
          else gl.uniform4fv(h.at, a);
          continue;
        }
        last[k] = key;
        row.fill!(c, out);
      } else {
        row.fill!(c, out);
        let same = true;
        for (let j = 0; j < SEND_FLOATS[send]!; j++) {
          if (last[k + j] !== out[j]) same = false;
          last[k + j] = out[j]!;
        }
        if (same) continue;
      }
      if (send === SEND_2F) gl.uniform2f(h.at, out[0]!, out[1]!);
      else if (send === SEND_3F) gl.uniform3f(h.at, out[0]!, out[1]!, out[2]!);
      else gl.uniform4f(h.at, out[0]!, out[1]!, out[2]!, out[3]!);
    }
  }

  /**
   * Finds the place of each of a linked program's rows that its texts declare, once, and sorts them by when they are
   * set; a row that starts with a number is given it. A row of one number, or with a key, keeps one number in `held`.
   */
  private find(prog: Program): void {
    const gl = this.gl;
    const starts: Held[] = [];
    let slots = 0;
    for (const row of prog.rows) {
      const at = gl.getUniformLocation(prog.program, row.name);
      if (at === null) continue;
      const held = { row, at, slot: slots };
      slots += row.fill !== null && row.key === null ? SEND_FLOATS[row.send]! : 1;
      if (row.start !== null) starts.push(held);
      if (row.at === AT_FRAME) prog.frame.push(held);
      else if (row.at === AT_DRAW) prog.draw.push(held);
      else if (row.at === AT_TILES) prog.tiles.push(held);
    }
    prog.held = new Float64Array(slots).fill(NaN);
    for (const h of starts) gl.uniform1f(h.at, (prog.held[h.slot] = h.row.start!));
  }

  /** Sets float uniform `k` of the shell's own of `prog`, the program in use, unless it has none or holds `v` already. */
  private uniform(prog: Program, k: number, v: number): void {
    if (prog.last[k] === v || prog.at[k] === null) return;
    prog.last[k] = v;
    this.gl.uniform1f(prog.at[k]!, v);
  }

  /**
   * Blending, culling, alpha to coverage and polygon offset, each changed only when a draw needs it otherwise. `weighed`
   * blends a colour that is light already weighed by how much of it shows, as fire and the small details give theirs.
   */
  private set(blend: boolean, cull: boolean, cover: boolean, offset = false, weighed = false): void {
    const gl = this.gl;
    if (blend && weighed !== this.weighed) gl.blendFuncSeparate((this.weighed = weighed) ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
    if (offset !== this.offsetting) {
      if ((this.offsetting = offset)) gl.enable(gl.POLYGON_OFFSET_FILL);
      else gl.disable(gl.POLYGON_OFFSET_FILL);
    }
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
    }
  }

  /**
   * Makes program `n` current, the first time after checking its link, which waits for it, finding its uniforms and
   * pointing its samplers at their units; and sets what its draws share where the step or the frame has changed since
   * it last drew: the frame's uniforms are set here and nowhere else.
   */
  private use(n: number, p: FramePacket): Program {
    const gl = this.gl;
    const prog = this.made[n] ?? this.program(n);
    const at = prog.at;
    if (prog.text) {
      if (!gl.getProgramParameter(prog.program, gl.LINK_STATUS)) {
        const shaders = gl.getAttachedShaders(prog.program)!.map((s) => gl.getShaderInfoLog(s)).join("");
        throw new Error("program: " + gl.getProgramInfoLog(prog.program) + shaders);
      }
      gl.useProgram((this.current = prog).program);
      for (const s in prog.text.samplers) gl.uniform1i(gl.getUniformLocation(prog.program, s), prog.text.samplers[s]!);
      for (let k = 0; k < SHELL_UNIFORMS.length; k++) at[k] = gl.getUniformLocation(prog.program, SHELL_UNIFORMS[k]!);
      this.find(prog);
      const block = gl.getUniformBlockIndex(prog.program, "Frame");
      if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(prog.program, block, 0);
      prog.text = null;
    }
    if (this.current !== prog) gl.useProgram((this.current = prog).program);
    if (p.lit) {
      this.uniform(prog, U.worldReady, this.worldReady);
      this.uniform(prog, U.texgenReady, this.texgen?.ready ?? 0);
    }
    if (prog.view === this.view) return prog;
    prog.view = this.view;
    gl.uniformMatrix4fv(at[U.viewProj]!, false, this.matrix, this.matrixAt, 16);
    this.uniform(prog, U.from, this.from);
    if (prog.serial === this.serial) return prog;
    prog.serial = this.serial;
    this.give(prog, prog.frame);
    return prog;
  }

  /**
   * The first `roles` of a material's maps (TEXTURE_ROLES: its five, then its layer) on their units, or the neutral
   * pixel of each it lacks or has not been sent, unless they are bound already.
   */
  private maps(mat: PackMaterial | undefined, roles: number): void {
    if (mat === this.mapped && roles <= this.mappedRoles) return;
    const gl = this.gl;
    if (this.neutral.length === 0) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.maps);
      this.bound.length = 0;
      this.neutral = TEXTURE_ROLES.map((role) => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        const internal = role === "base" || role === "layer" ? gl.SRGB8_ALPHA8 : gl.RGBA8;
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.from(NEUTRAL[role]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        return t;
      });
    }
    for (let r = 0; r < roles; r++) {
      const t = mat ? textureOf(mat, TEXTURE_ROLES[r]!) : -1;
      const texture = (t >= 0 && this.textures.get(t)) || this.neutral[r]!;
      if (this.bound[r] === texture) continue;
      gl.activeTexture(gl.TEXTURE0 + (r < MAP_ROLES.length ? UNIT.maps + r : UNIT.layer));
      gl.bindTexture(gl.TEXTURE_2D, (this.bound[r] = texture));
    }
    this.mapped = mat;
    this.mappedRoles = roles;
  }

  private streetEnvironment(p: FramePacket): void {
    const gl = this.gl;
    if (!p.tier.reflectionHz) {
      if (this.streetTexture) gl.deleteTexture(this.streetTexture);
      this.streetTexture = null;
      this.streetImages.fill(null);
      this.streetWidth = 0;
      return;
    }
    const width = captureWidth(p.tier.reflectionHz), target = gl.TEXTURE_2D_ARRAY;
    let dirty = this.streetWidth !== width;
    if (dirty) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.street);
      this.streetTexture ??= gl.createTexture();
      if (!this.streetTexture) return;
      gl.bindTexture(target, this.streetTexture);
      gl.texImage3D(target, 0, gl.SRGB8_ALPHA8, width, width >> 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      this.streetWidth = width;
      this.streetImages.fill(null);
    }
    for (let i = 0; i < 2; i++) {
      const img = i ? p.previousStreet : p.street;
      if (!img) continue;
      const layer = img.revision & 1;
      if (this.streetImages[layer] === img && this.streetRevisions[layer] === img.revision) continue;
      gl.activeTexture(gl.TEXTURE0 + UNIT.street);
      gl.texSubImage3D(target, 0, 0, 0, layer, width, width >> 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, img.pixels);
      this.streetImages[layer] = img;
      this.streetRevisions[layer] = img.revision;
      dirty = true;
    }
    if (dirty) gl.generateMipmap(target);
  }

  draw(p: FramePacket): void {
    const gl = this.gl, cpu = this.cpu;
    if (cpu) {
      cpu.began = performance.now();
      cpu.start.fill(NaN);
      cpu.ms.fill(0);
      this.cpuPass = -1;
    }
    this.streetEnvironment(p);
    this.drawCalls = 0;
    this.serial++;
    const c = this.drawn;
    c.p = p;
    c.serial = this.serial;
    c.lightTarget = drawsLight(p.tier, this.light);
    this.failed.length = this.failedTextures.length = 0;
    if (p.tier !== this.warmed) {
      this.made = this.programs.get(p.tier) ?? [];
      this.programs.set((this.warmed = p.tier), this.made);
      for (const n of tierPrograms(p.tier)) if (!this.made[n]) this.program(n);
      // The governor's step to no light target draws the same tier with these, which a step should not wait to link.
      if (drawsLight(p.tier, this.light)) for (const n of tierPrograms(p.tier)) this.program(n, false);
      for (let r = 0; r < this.world.length; r++) {
        const t = this.world[r];
        if (!t) continue;
        gl.activeTexture(gl.TEXTURE0 + UNIT.maps + r);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        this.anisotropy(gl.TEXTURE_2D_ARRAY);
      }
      if (this.gen.texture) {
        gl.activeTexture(gl.TEXTURE0 + UNIT.texgen);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.gen.texture);
        this.anisotropy(gl.TEXTURE_2D_ARRAY);
      }
    }
    // What the card makes is drawn before anything of the frame; a clock timing the frame times it as its first pass,
    // and it is not timed apart.
    this.set(false, false, false);
    this.mark(PASS_MAKING);
    if (this.texgen && this.gen.draw(this.texgen.frame(p.texgenSide, p.tier, !this.passes?.on, (p.texgenHolds = this.texgen.holds, p.texgenWant)), this.job, this.anisotropyOf)) {
      this.current = null;
      this.vao = this.gen.vao;
    }
    for (let r = 0; r < 3; r++) if (p.worldSide[r] !== this.worldSide[r]) {
      gl.deleteTexture(this.world[r] ?? null);
      this.world[r] = null;
      this.worldSide[r] = p.worldSide[r]!;
      this.worldBase[r] = -2;
    }
    this.mark(PASS_UPLOADS);
    // Running out of memory shows as an error after the fact, and asking makes the page wait for the card to have done all
    // it was given, which on a busy card is frames of work. So it is asked before this frame's uploads, where the card
    // had finished the last frame by the time this one began, or after ASK_MOST_MS; a want of memory fails everything
    // uploaded since the last ask.
    const now = performance.now();
    const caught = this.asking !== null && gl.getSyncParameter(this.asking, gl.SYNC_STATUS) === gl.SIGNALED;
    const asked = (caught && this.askFrame === this.serial - 1) || (this.unaskedSince >= 0 && now - this.unaskedSince >= ASK_MOST_MS);
    if ((caught || asked) && this.asking) {
      gl.deleteSync(this.asking);
      this.asking = null;
    }
    const error = asked ? gl.getError() : gl.NO_ERROR;
    if (error === gl.OUT_OF_MEMORY) {
      for (const slot of this.unaskedSlots) {
        this.drop(slot);
        this.failed.push(slot);
      }
      for (const t of this.unaskedTextures) {
        this.forget(t);
        this.failedTextures.push(t);
      }
    } else if (error !== gl.NO_ERROR) this.errors++;
    if (asked) {
      this.unaskedSlots.length = this.unaskedTextures.length = 0;
      this.unaskedSince = -1;
    }
    const uploading = performance.now();
    for (const slot of p.assetDrops) this.drop(slot);
    for (const u of p.assetUploads) {
      if (u.of === undefined) this.take(u);
      else this.takeSurface(u);
    }
    for (const t of p.texDrops) this.forget(t);
    for (const u of p.texUploads) this.fill(u);
    this.uploadMs = performance.now() - uploading;
    for (const u of p.assetUploads) this.unaskedSlots.push(u.slot);
    for (const u of p.texUploads) if (!this.unaskedTextures.includes(u.slot)) this.unaskedTextures.push(u.slot);
    if (this.unaskedSince < 0 && this.unaskedSlots.length + this.unaskedTextures.length > 0) this.unaskedSince = now;
    // The whole map's pair again where a fill changed the ground since it went on the card; a hold changes none of it.
    for (const c = this.hf.changes; this.mapSeen < c.length; this.mapSeen += 4) {
      if (!this.hf.filled[this.mapSeen / 4]) continue;
      const a = coarseArea(this.hf, c[this.mapSeen]!, c[this.mapSeen + 1]!, c[this.mapSeen + 2]!, c[this.mapSeen + 3]!);
      gl.activeTexture(gl.TEXTURE0 + UNIT.heights);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, a.i, a.j, a.w, a.h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, a.heights);
      gl.activeTexture(gl.TEXTURE0 + UNIT.tint);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, a.i, a.j, a.w, a.h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, a.tint);
    }
    // The terrain window's rectangles core put together (terrain.ts), each at its texels, and the window on its units.
    const drawn = p.groundWindow[0]!, parts = p.groundParts;
    for (let k = 0; k < 2; k++) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.windowHeights + k);
      gl.bindTexture(gl.TEXTURE_2D, this.windows[k]!);
      const type = k ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, from = k ? p.groundTint : p.groundHeights;
      for (let n = 0; n < p.groundPartCount * 5; n += 5) gl.texSubImage2D(gl.TEXTURE_2D, 0, parts[n]!, parts[n + 1]!, parts[n + 2]!, parts[n + 3]!, gl.RED_INTEGER, type, from, parts[n + 4]!);
      if (drawn < 0) gl.bindTexture(gl.TEXTURE_2D, null);
    }
    // The roads' frame's rectangles of the window drawn (terrain.ts followRoad).
    if (p.roadPartCount > 0) gl.activeTexture(gl.TEXTURE0 + UNIT.road);
    for (let n = 0; n < p.roadPartCount * 5; n += 5) gl.texSubImage2D(gl.TEXTURE_2D, 0, p.roadParts[n]!, p.roadParts[n + 1]!, p.roadParts[n + 2]!, p.roadParts[n + 3]!, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, p.roadBytes, p.roadParts[n + 4]! * 4);
    // The streets' tiles of this frame, each into its place in the pictures round the camera.
    for (let t = 0; t < p.streetTiles * 2; t++) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.streets + (t & 1));
      const x = p.streetAt[t & ~1]!, y = p.streetAt[(t & ~1) + 1]!;
      const format = t & 1 ? gl.RGBA_INTEGER : gl.RGBA, from = t & 1 ? p.streetKinds : p.streetDist;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, STREET_TILE_SIDE, STREET_TILE_SIDE, format, gl.UNSIGNED_BYTE, from, (t >> 1) * STREET_TILE_BYTES);
    }
    // The pieces' states that changed, each a run of one row's texels.
    if (p.pieceUploads > 0) gl.activeTexture(gl.TEXTURE0 + UNIT.pieces);
    for (let k = 0; k < p.pieceUploads * 3; k += 3) {
      const row = p.pieceRuns[k]!, from = p.pieceRuns[k + 1]!;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, from, row, p.pieceRuns[k + 2]!, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, p.pieces, (row * PIECE_KEYS + from) * 4);
    }
    // The facades' atlases on their units while the frame names them; none is read until each it names has come (facade.ts).
    for (let k = 0; k < p.facadeSlots.length; k++) {
      const t = p.facadeSlots[k]!, texture = t >= 0 ? this.textures.get(t) : undefined;
      if (t >= 0 && !texture) p.frame[FRAME.facade + 1] = 0;
      gl.activeTexture(gl.TEXTURE0 + UNIT.facade + k);
      gl.bindTexture(gl.TEXTURE_2D, texture ?? null);
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.frame);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, p.frame);
    if (p.street && !this.streetTexture) gl.bufferSubData(gl.UNIFORM_BUFFER, (FRAME.reflection + 3) * 4, this.noReflection);
    c.night = lampsOn(p.frame);
    c.exposure = p.frame[FRAME.exposure]!;

    // Resource changes first, in order.
    for (const u of p.uploads) {
      let buffer = this.buffers.get(u.buffer);
      // Part of a buffer the card holds (a piece's state), where the buffer is the size it was; else the whole of it.
      const part = buffer !== undefined && this.partial && u.bytes !== undefined && u.from !== undefined;
      if (!buffer) this.buffers.set(u.buffer, (buffer = gl.createBuffer()!));
      this.array(buffer);
      if (part) gl.bufferSubData(gl.ARRAY_BUFFER, u.from!, u.data, u.from!, u.bytes!);
      else gl.bufferData(gl.ARRAY_BUFFER, u.data, gl.STATIC_DRAW);
    }
    for (const id of p.drops) {
      gl.deleteBuffer(this.buffers.get(id) ?? null);
      this.buffers.delete(id);
    }
    // The length of a view is in its elements, and none would mean the whole of it.
    if (p.transientCount > 0) {
      this.array(this.transient);
      if (p.lit) {
        this.array(this.ids);
        gl.bufferData(gl.ARRAY_BUFFER, p.transientIds, gl.DYNAMIC_DRAW, 0, p.transientCount);
        this.array(this.transient);
      }
      gl.bufferData(gl.ARRAY_BUFFER, p.transient, gl.DYNAMIC_DRAW, 0, p.transientCount * INSTANCE_BYTES);
    }
    if (p.detailCount > 0) {
      this.array(this.detailBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, p.details, gl.DYNAMIC_DRAW, 0, p.detailCount * DETAIL_FLOATS);
    }
    if (p.atlasRows > 0) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.atlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ATLAS_WIDTH, p.atlasRows, gl.RGBA, gl.FLOAT, p.atlas);
    }
    // The sky's openness on its unit, made again at a size it has not, let go while a frame has none, and its rows.
    gl.activeTexture(gl.TEXTURE0 + UNIT.open);
    const open = p.openWidth * 65536 + p.openHeight;
    if (open !== this.open.size) {
      gl.deleteTexture(this.open.texture);
      gl.bindTexture(gl.TEXTURE_2D, (this.open = { texture: open > 0 ? gl.createTexture() : null, size: open }).texture);
      if (open > 0) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, p.openWidth, p.openHeight);
      const read = [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ] as const;
      for (const q of read) if (open > 0) gl.texParameteri(gl.TEXTURE_2D, q[0], q[1]);
    }
    if (p.openRows > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, p.openRow, p.openWidth, p.openRows, gl.RGBA, gl.UNSIGNED_BYTE, p.openMap);
    if (p.screenFresh && p.screenSource) this.screenPicture(p.screenSource as TexImageSource, p.screenWidth, p.screenHeight, p.screenMips);
    // What stands overhead and the ground's colour (roof.ts) on its unit, one layer over the other, each map whole.
    if (p.roofMap.length > 0) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.roof);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, p.roofSide, p.roofMap.length / (4 * p.roofSide), 0, gl.RGBA, gl.UNSIGNED_BYTE, p.roofMap);
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT.bones);
    if (boneRows(p.tier.bones) !== this.boneRows) {
      this.boneRows = boneRows(p.tier.bones);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, BONES_PER_ROW * 3, this.boneRows, 0, gl.RGBA, gl.FLOAT, null);
    }
    if (p.boneCount > 0) {
      const rows = Math.ceil(p.boneCount / BONES_PER_ROW);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BONES_PER_ROW * 3, rows, gl.RGBA, gl.FLOAT, p.bones);
    }

    this.bound.length = 0;
    this.mapped = null;
    // 0 with no finishes; 3 with none of their maps yet, drawn as their means; 2 with the base colours alone, drawn the
    // far path's way; 1 to 2 as the rest come up (`early`).
    let base = true, full = true;
    for (let r = 0; r < 3; r++) {
      if (r > 0 && p.worldSide[r] === 0) continue;
      if (p.worldLevel[r]! < 0 || this.worldBase[r]! < -1) {
        full = false;
        if (r === 0) base = false;
      } else if (p.worldLevel[r] !== this.worldBase[r]) {
        gl.activeTexture(gl.TEXTURE0 + UNIT.maps + r);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.world[r]!);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, (this.worldBase[r] = p.worldLevel[r]!));
      }
    }
    this.worldReady = p.worldSide[0] === 0 ? 0 : base ? 1 + (full ? p.worldEarly : 1) : p.worldComing ? 3 : 0;
    const finish = drawsLight(p.tier, this.light);
    const samples = Math.min(this.samples, p.lightSamples), [tw, th] = sceneSize(gl.drawingBufferWidth, gl.drawingBufferHeight, finish ? p.room : 1);
    // A frame drawn without it every other frame (FramePacket.alternate) leaves it for the frames either side.
    if (this.post.size !== (finish ? `${tw} ${th} ${samples}` : "") && (finish || !p.alternate)) this.targets(finish ? tw : 0, th, samples);
    this.shadows(p, finish ? this.post.fbs[0]! : null);
    // Into the light target, the scene goes in the corner its share fills, which the finish takes up to the canvas.
    gl.viewport(0, 0, ...(this.post.drawn = sceneSize(gl.drawingBufferWidth, gl.drawingBufferHeight, finish ? p.share : 1)));
    const sky = finish ? p.sky : p.skyShown;
    gl.clearColor(sky[0]!, sky[1]!, sky[2]!, this.transparentStage ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // A sight's window: nothing outside it is shaded (packet.ts window, D1077).
    const win = p.window, dw = this.post.drawn[0], dh = this.post.drawn[1];
    if (win[2]! > 0) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(win[0]! * dw), Math.floor(win[1]! * dh), Math.ceil((win[2]! - win[0]!) * dw), Math.ceil((win[3]! - win[1]!) * dh));
    }
    let step = -1;
    for (let d = 0; d < p.drawCount; d++) {
      const s = stepOf(p, d);
      while (step < s) this.step(p, ++step);
      if (this.groundLeft && d >= p.groundAt[step]!) this.step(p, step, true);
      const flags = p.drawFlags[d]!;
      if ((flags & DRAW_DETAILS) !== 0) {
        this.details(p, d);
        continue;
      }
      const textured = (flags & DRAW_TEXTURED) !== 0;
      const lod = this.levels.get(p.drawSlot[d]!);
      const buffer = this.instances(p.drawBuffer[d]!);
      if (!lod || !buffer || (textured && !lod.surface)) continue;
      // A see-through draw blends, shows both faces and leaves depth alone. Others may come after it, so every draw says.
      const blend = (flags & DRAW_BLEND) !== 0;
      const m = p.drawMaterial[d]!;
      const layer = p.drawLayer[d]!;
      c.d = d;
      c.flags = flags;
      c.mesh = p.drawMesh[d]!;
      c.m = m;
      c.material = this.materials[m];
      c.skinned = lod.skin;
      const prog = this.use(drawProgram(p, d, c.material), p);
      const fire = (flags & DRAW_FIRE) !== 0;
      this.set(blend, (textured || !blend || fire) && (flags & DRAW_TWO_SIDED) === 0, (flags & DRAW_CUTOUT) !== 0, false, fire);
      this.give(prog, prog.draw);
      // A material's maps, and with a layer its layer; the sea's waves are a material's.
      if (textured) this.maps(c.material, layer > 0 ? TEXTURE_ROLES.length : MAP_ROLES.length);
      else if ((flags & DRAW_WATER) !== 0) this.maps(c.material, MAP_ROLES.length);
      const bends = (flags & DRAW_BENT) !== 0 ? this.buffers.get(p.drawBuffer[d]! + BEND_BUFFERS) : undefined;
      this.bind(prog, lod, buffer, p.drawMesh[d]!, p.drawFirst[d]!, p.drawOffset, d, bends);
      if (textured || (flags & DRAW_RANGED) !== 0) {
        d = this.ranges(lod, p.drawFirstIndex, p.drawIndexCount, p.drawInstances[d]!, p.drawJoined, null, 0, d, p.drawCount);
      } else gl.drawElementsInstanced(gl.TRIANGLES, lod.indexCount, lod.type, 0, p.drawInstances[d]!);
      this.drawCalls++;
    }
    // The terrain and the dome are drawn when there is no draw after them.
    while (step < STEP_FAR_SEE) this.step(p, ++step);
    gl.disable(gl.SCISSOR_TEST);
    if (finish) this.toCanvas(p);
    // Every draw ends in the state the next begins from, as the mirror of it says, whatever another user of the context
    // (the device page) puts back between. The next frame's clear writes depth.
    this.set(false, false, false);
    gl.depthRange(0, 1);
    this.vertexArray(null);
    this.array(null);
    gl.useProgram((this.current = null));
    if (this.unaskedSince >= 0 && this.asking === null) {
      this.asking = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      this.askFrame = this.serial;
    }
    this.mark(-1);
    this.detailAtlas?.afterDraw(performance.now());
  }

  /** Pass `pass` begins, or for -1 the frame's draws end: on the card's clock, and on the page's while the bar reads it. */
  private mark(pass: number): void {
    const cpu = this.cpu;
    if (cpu) {
      const now = performance.now(), open = this.cpuPass;
      if (open >= 0) cpu.ms[open]! += now - this.cpuFrom;
      if (pass >= 0 && Number.isNaN(cpu.start[pass]!)) cpu.start[pass] = now - cpu.began;
      if (pass < 0) cpu.ended = now;
      this.cpuPass = pass;
      this.cpuFrom = now;
    }
    if (pass < 0) this.passes?.end();
    else this.passes?.mark(pass);
  }

  /**
   * Draws run `d` of `lod`'s indices, `first` and `count` of them, and where the browser draws many in a call the runs
   * after it that `joined` marks, those in cascade `bit` of `cascades` if it is given, in the same call. The last it drew.
   */
  private ranges(
    lod: MeshLod,
    first: Uint32Array,
    count: Uint32Array,
    instances: number,
    joined: Uint8Array,
    cascades: Uint8Array | null,
    bit: number,
    d: number,
    end: number,
  ): number {
    const gl = this.gl, runs = this.runs;
    let last = d, n = 0;
    if (this.multi && d + 1 < end && joined[d + 1] === 1) {
      for (let e = d; e < end && (e === d || joined[e] === 1); last = e++) {
        if (cascades && (cascades[e]! & bit) === 0) continue;
        runs[n] = count[e]!;
        runs[RUNS + n] = first[e]! * lod.indexBytes;
        runs[RUNS * 2 + n++] = instances;
      }
    }
    if (n > 1) this.multi!.multiDrawElementsInstancedWEBGL(gl.TRIANGLES, runs, 0, lod.type, runs, RUNS, runs, RUNS * 2, n);
    else gl.drawElementsInstanced(gl.TRIANGLES, count[d]!, lod.type, first[d]! * lod.indexBytes, instances);
    return last;
  }

  /** The buffer of instances a draw or caster names. */
  private instances(id: number): WebGLBuffer | undefined {
    return id === TRANSIENT_BUFFER ? this.transient : this.buffers.get(id);
  }

  /**
   * Binds a level and the instances from `first` of `buffer` for a program, with the offset at `offsets[i * 3]`, and of a
   * bent draw its bends from the same place of `bends`, as far as they are not bound so.
   */
  private bind(
    prog: Program,
    lod: MeshLod,
    buffer: WebGLBuffer,
    mesh: number,
    first: number,
    offsets: Float32Array,
    i: number,
    bends?: WebGLBuffer,
  ): void {
    const gl = this.gl;
    const u = prog.at, last = prog.last, info = lod.bounds ?? this.meshes[mesh]!;
    if (prog.bounds !== info && u[U.center]) {
      prog.bounds = info;
      gl.uniform3f(u[U.center]!, info.center[0], info.center[1], info.center[2]);
      gl.uniform3f(u[U.half]!, info.half[0], info.half[1], info.half[2]);
    }
    const o = i * 3;
    if (moved(last, U.offset, offsets, o, 3)) gl.uniform3f(u[U.offset]!, offsets[o]!, offsets[o + 1]!, offsets[o + 2]!);
    this.vertexArray(lod.vao);
    const entityIds = !!lod.surface && buffer === this.transient && this.warmed?.lit === true;
    if (lod.buffer === buffer && lod.first === first && lod.entityIds === entityIds) return;
    lod.entityIds = entityIds;
    lod.buffer = buffer;
    lod.first = first;
    this.array(buffer);
    // WebGL2 has no base instance, so the range is selected by offsetting the pointers.
    const at = first * INSTANCE_BYTES;
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_BYTES, at);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, true, INSTANCE_BYTES, at + 12);
    gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 14);
    gl.vertexAttribIPointer(5, 2, gl.UNSIGNED_BYTE, INSTANCE_BYTES, at + 18);
    if (entityIds) {
      this.array(this.ids);
      gl.enableVertexAttribArray(12);
      gl.vertexAttribDivisor(12, 1);
      gl.vertexAttribIPointer(12, 1, gl.UNSIGNED_INT, 4, first * 4);
    } else gl.disableVertexAttribArray(12);
    // A level's draws are all bent or none are; one bound bent and then not leaves the stream off.
    for (let a = 13; a < 15 && (bends || lod.bent); a++) {
      if (!bends) {
        gl.disableVertexAttribArray(a);
        continue;
      }
      this.array(bends);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
      gl.vertexAttribPointer(a, 4, gl.SHORT, false, BEND_BYTES, first * BEND_BYTES + (a - 13) * 8);
    }
    lod.bent = bends !== undefined;
  }

  /**
   * The shadow maps, made for the tier and kept bound on their unit, and each map the frame draws into its layer
   * (shadowtext.ts `shadowLayer`), a cascade's from the light it is cast from or the street lamp's from its lens: the
   * ground that casts into it, then its casters, back faces only unless a material shows both. Every layer has a target,
   * the far map's too, which nothing draws into.
   */
  private shadows(p: FramePacket, into: WebGLFramebuffer | null): void {
    const gl = this.gl;
    const map = this.shadow;
    const cascades = p.lit ? p.tier.shadows.cascades : 0, size = p.lit ? p.tier.shadows.size : 0, layers = p.lit ? shadowLayers(p.tier.shadows) : 0;
    this.mark(PASS_CASTERS);
    if (map.size !== size || map.targets.length !== layers) {
      gl.deleteTexture(map.texture);
      for (const t of map.targets.splice(0)) gl.deleteFramebuffer(t);
      map.size = size;
      gl.activeTexture(gl.TEXTURE0 + UNIT.shadow);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, (map.texture = cascades > 0 ? gl.createTexture() : null));
      if (cascades > 0) {
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT16, size, size, layers);
        const filter = this.shadowLookup === "hard" ? gl.NEAREST : gl.LINEAR;
        const read = [
          [gl.TEXTURE_MIN_FILTER, filter],
          [gl.TEXTURE_MAG_FILTER, filter],
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE],
          [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL],
        ] as const;
        for (const q of read) gl.texParameteri(gl.TEXTURE_2D_ARRAY, q[0], q[1]);
      }
      for (let k = 0; k < layers; k++) {
        const target = gl.createFramebuffer()!;
        map.targets.push(target);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, map.texture, 0, k);
      }
    }
    // Rows of the far shadow's map (farshadow.ts), in the layer after the cascades'.
    gl.activeTexture(gl.TEXTURE0 + UNIT.shadow);
    if (p.farRows > 0) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, p.farRow, cascades, size, p.farRows, 1, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, p.farMap);
    }
    gl.viewport(0, 0, size, size);
    gl.polygonOffset(POLYGON_OFFSET[0], POLYGON_OFFSET[1]);
    gl.cullFace(gl.FRONT);
    for (let k = 0; k <= MAX_CASCADES; k++) {
      if ((p.cascadesDrawn & (1 << k)) === 0) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, map.targets[shadowLayer(k, cascades)]!);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.view = this.serial * 16 + 8 + k;
      this.matrix = p.maps;
      this.matrixAt = k * 16;
      this.tiles(p, TILE_CASTS << k, PROGRAM.depthTerrain, PROGRAM.depthTerrainWindow);
      for (let e = 0; e < p.casterCount; e++) {
        if ((p.casterCascades[e]! & (1 << k)) === 0) continue;
        const lod = this.levels.get(p.casterSlot[e]!), buffer = this.instances(p.casterBuffer[e]!);
        if (!lod || !buffer) continue;
        const flags = p.casterFlags[e]!;
        const cutout = (flags & DRAW_CUTOUT) !== 0, both = (flags & DRAW_TWO_SIDED) !== 0;
        const c = this.drawn;
        c.d = e;
        c.flags = flags;
        c.mesh = p.casterMesh[e]!;
        c.m = p.casterMaterial[e]!;
        c.material = this.materials[c.m];
        c.skinned = lod.skin;
        const prog = this.use(cutout ? PROGRAM.depthCutout : PROGRAM.depth, p);
        this.set(false, !both, false, both);
        this.give(prog, prog.draw);
        // The cut-out caster's program reads the base colour alone.
        if (cutout) this.maps(c.material, 1);
        const bends = (flags & DRAW_BENT) !== 0 ? this.buffers.get(p.casterBuffer[e]! + BEND_BUFFERS) : undefined;
        this.bind(prog, lod, buffer, p.casterMesh[e]!, p.casterFirst[e]!, p.casterOffset, e, bends);
        if ((flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0) {
          const instances = p.casterInstances[e]!;
          e = this.ranges(lod, p.casterFirstIndex, p.casterIndexCount, instances, p.casterJoined, p.casterCascades, 1 << k, e, p.casterCount);
        } else gl.drawElementsInstanced(gl.TRIANGLES, lod.indexCount, lod.type, 0, p.casterInstances[e]!);
        this.drawCalls++;
      }
    }
    this.set(false, this.culling, false);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into);
  }

  /**
   * The light target for a canvas `w` by `h` and `samples` (post.ts), with every level of bloom the canvas has, of which
   * a frame draws as many as it says; made again from nothing, and none for `w` 0. With no samples the scene is drawn
   * into its texture, `fbs[0]` and `fbs[1]` alike.
   */
  private targets(w: number, h: number, samples: number): void {
    const gl = this.gl, t = this.post, levels = bloomLevels(h, 1);
    for (const f of new Set(t.fbs.splice(0))) gl.deleteFramebuffer(f);
    for (const x of t.tex.splice(0)) gl.deleteTexture(x);
    for (const b of t.bufs.splice(0)) gl.deleteRenderbuffer(b);
    t.size = w > 0 ? `${w} ${h} ${samples}` : ""; t.w = w; t.h = h;
    for (let k = samples > 0 ? -1 : 0; k <= levels && w > 0; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, (t.fbs[k + 1] = gl.createFramebuffer()!));
      // The scene's colour and depth where it has samples, its depth alone where it is drawn into its texture.
      for (let r = k < 0 ? 0 : k === 0 && samples === 0 ? 1 : 2; r < 2; r++) {
        gl.bindRenderbuffer(gl.RENDERBUFFER, t.bufs[t.bufs.length] = gl.createRenderbuffer()!);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, k < 0 ? samples : 0, r ? gl.DEPTH_COMPONENT24 : this.light, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, r ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.bufs.at(-1)!);
      }
      if (k < 0) continue;
      gl.activeTexture(gl.TEXTURE0 + UNIT.details);
      gl.bindTexture(gl.TEXTURE_2D, t.tex[k] = gl.createTexture()!);
      gl.texStorage2D(gl.TEXTURE_2D, 1, k > 0 ? BLOOM_FORMAT : this.light, Math.max(1, w >> levelShift(k)), Math.max(1, h >> levelShift(k)));
      const read = [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ] as const;
      for (const p of read) gl.texParameteri(gl.TEXTURE_2D, p[0], p[1]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex[k]!, 0);
    }
    t.fbs[0] ??= t.fbs[1]!;
  }

  /** The finish (post.ts): the scene resolved, bloom's chain down and then up, adding, and the finish into the canvas. */
  private toCanvas(p: FramePacket): void {
    const gl = this.gl, t = this.post, levels = Math.min(p.frame[FRAME.levels]!, t.tex.length - 1), [w, h] = this.post.drawn;
    this.mark(PASS_FINISH);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbs[0]!);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbs[1]!);
    if (t.fbs[0] !== t.fbs[1]) gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, t.fbs[0] !== t.fbs[1] ? [gl.COLOR_ATTACHMENT0, gl.DEPTH_ATTACHMENT] : [gl.DEPTH_ATTACHMENT]);
    this.set(false, false, false);
    gl.disable(gl.DEPTH_TEST);
    this.vertexArray(null);
    for (let k = 1; k <= levels; k++) this.pass(p, PROGRAM.bloomDown, k - 1, k);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let k = levels - 1; k >= 1; k--) this.pass(p, PROGRAM.bloomUp, k + 1, k);
    gl.disable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
    this.weighed = false;
    gl.activeTexture(gl.TEXTURE0 + UNIT.layer);
    gl.bindTexture(gl.TEXTURE_2D, t.tex[Math.min(1, levels)]!);
    this.pass(p, PROGRAM.finish, 0, -1);
    gl.enable(gl.DEPTH_TEST);
  }

  /**
   * A pass of the finish with program `n`, from level `from` (0 the scene) into level `to`'s corner the scene fills, or
   * into the whole canvas for -1.
   */
  private pass(p: FramePacket, n: number, from: number, to: number): void {
    const gl = this.gl, t = this.post, [w, h] = this.post.drawn, cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    const prog = this.use(n, p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to < 0 ? null : t.fbs[to + 1]!);
    gl.viewport(0, 0, to < 0 ? cw : Math.max(1, w >> levelShift(to)), to < 0 ? ch : Math.max(1, h >> levelShift(to)));
    gl.activeTexture(gl.TEXTURE0 + UNIT.details);
    gl.bindTexture(gl.TEXTURE_2D, t.tex[from]!);
    const tw = Math.max(1, t.w >> tapShift(from, to)), th = Math.max(1, t.h >> tapShift(from, to));
    gl.uniform4f(prog.at[U.pass]!, 1 / tw, 1 / th, from === 0 ? 1 : 0, w < cw || h < ch ? 1 : 0);
    gl.uniform4fv(prog.at[U.extent]!, passExtent(w, h, t.w, t.h, from, to, this.post.extent));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls++;
  }

  /**
   * Begins a step of the frame (packet.ts): its view-projection and part of the depth buffer, after the terrain tiles of
   * the step before where it had not drawn them. The viewer's body goes over a depth clear, with its own near plane. With
   * `tiles`, draws the step's terrain tiles in its range where `groundAt` puts them.
   */
  private step(p: FramePacket, s: number, tiles = false): void {
    if (this.groundLeft) this.tiles(p, 1 << (tiles ? s : s - 1), PROGRAM.terrain, PROGRAM.terrainWindow);
    this.groundLeft = false;
    if (tiles) return;
    const gl = this.gl;
    const far = s === STEP_FAR || s === STEP_FAR_SEE;
    const half = p.split > 0 && s !== STEP_BODY;
    this.view = this.serial * 16 + s;
    this.mark(s === STEP_FAR_SEE && (p.lit || p.frame[FRAME.eyes + 3]! > 0) ? PASS_DOME : PASS_OF_STEP[s]!);
    this.matrix = s === STEP_BODY ? p.nearViewProj : far && half ? p.farViewProj : p.viewProj;
    this.matrixAt = 0;
    this.from = s === STEP_FAR_SEE ? p.split : 0;
    gl.depthRange(half && far ? 0.5 : 0, half && !far ? 0.5 : 1);
    if (s === STEP_BODY) {
      this.set(false, true, false);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    // A lit frame's dome goes at the far end of the view, where the opaque steps left it.
    if (s === STEP_FAR_SEE && !this.transparentStage && (p.lit || p.frame[FRAME.eyes + 3]! > 0)) {
      this.use(PROGRAM.sky, p);
      if (p.lit) this.maps(this.sky, MAP_ROLES.length);
      this.set(false, false, false);
      this.vertexArray(null);
      gl.depthFunc(gl.LEQUAL);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthFunc(gl.LESS);
      this.drawCalls++;
      this.mark(PASS_FAR_SEE);
    }
    this.groundLeft = s <= STEP_FAR;
  }

  /**
   * The terrain tiles whose `tilePass` has `bit`, with program `map`, and `window` for those on the window's units: a
   * draw for the tiles that read each pair of pictures, with corner and stride in its samples, and spacing and size. The
   * view draws the ground's faces turned to it and both of its skirts'; a cascade the faces turned from the sun.
   */
  private tiles(p: FramePacket, bit: number, map: number, window: number): void {
    const gl = this.gl;
    const data = this.tileData;
    for (let source = SOURCE_MAP; source <= SOURCE_WINDOW; source++) {
      let n = 0;
      for (let t = 0; t < p.tileCount; t++) {
        if ((p.tilePass[t]! & bit) === 0 || p.tileSource[t * 4 + 3] !== source) continue;
        data[n * 6] = p.tiles[t * 4]!;
        data[n * 6 + 1] = p.tiles[t * 4 + 1]!;
        data[n * 6 + 2] = p.tiles[t * 4 + 2]!;
        data[n * 6 + 3] = p.tileSource[t * 4 + 2]!;
        data[n * 6 + 4] = p.tileSource[t * 4]!;
        data[n * 6 + 5] = p.tileSource[t * 4 + 1]!;
        n++;
      }
      if (n === 0) continue;
      const prog = this.use(source === SOURCE_MAP ? map : window, p);
      this.give(prog, prog.tiles);
      this.set(false, true, false);
      this.vertexArray(this.tileVao);
      this.array(this.tileBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW, 0, n * 6);
      gl.drawElementsInstanced(gl.TRIANGLES, this.tileGround, gl.UNSIGNED_SHORT, 0, n);
      this.drawCalls++;
      // The skirts hide gaps between tiles from the view. Cast, they would stand under the ground.
      if (map !== PROGRAM.terrain) continue;
      this.set(false, false, false, true);
      gl.polygonOffset(0, SKIRT_BEHIND);
      gl.drawElementsInstanced(gl.TRIANGLES, this.tileIndexCount - this.tileGround, gl.UNSIGNED_SHORT, this.tileGround * 2, n);
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

  /** Compiles and links the texts as given, with the defines after their first line, the #version line, asking nothing of either until `use`. */
  private link(text: ProgramText, rows: readonly UniformRow[]): Program {
    const gl = this.gl;
    const program = gl.createProgram()!;
    for (const type of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER]) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, (type === gl.VERTEX_SHADER ? text.vertex : text.fragment).replace("\n", "\n" + text.defines));
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    const last = new Float64Array(SHELL_UNIFORMS.length + 2).fill(NaN);
    return { program, text, rows, frame: [], draw: [], tiles: [], held: NO_FLOATS, at: [], last, view: -1, serial: -1, bounds: null };
  }
}
