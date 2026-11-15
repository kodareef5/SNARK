// The device probe. A page opened with ?device=<token> asks which test to run, then measures the device it is on by
// itself and reports to tools/device.ts. Every test loads the game, reads the self-check's probes and runs the
// simulation's hashes. Then the quick look asks the GPU questions round 8 leans on (devicegpu.ts) and measures each
// graphics tier in three light scenes; the load ladder adds bodies, building pieces, triangles and draws a rung at a time
// until frames break, then texture memory, sampled as it is drawn, until the device refuses it; the soak turns through a
// heavy scene for ten minutes; the terrain flight, on a server of its own, flies over its 8 km map and then stands far
// bases round the middle a rung at a time. What it adds is in devicescene.ts, and the table and pages it shows in
// devicetext.ts. What only a browser can say comes from the shell (client/shell/device.ts).

import { HumanAnim } from "../../shared/anim/pose.ts";
import { creatureAnims } from "../../shared/anim/creature.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { creatureHash, hullHash, nodeHash, poseHash, simHash, snapHash, tunedHash } from "../../shared/sim/scenarios.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { FarCells, writeFar } from "../../shared/world/tactical.ts";
import type { App } from "./app.ts";
import { DEFAULT_TIER, TIERS, tierOf, type Tier } from "./assets/tiers.ts";
import { FrameTimer, GpuQuestions, type Gl2, type GpuReport } from "./devicegpu.ts";
import { BodyCopies, LOOK, TextureMemory, farBases, farSpots, rocks } from "./devicescene.ts";
import { FAR_NODE_BUFFERS } from "./render/farnodes.ts";
import { donePage, progressText, startPage } from "./devicetext.ts";
import { DRAW_TEXTURED, FRAME, SOURCE_WINDOW, type FramePacket } from "./render/packet.ts";
import { groundSize } from "./render/terrain.ts";
import type { Thing } from "./render/scene.ts";
import { probePasses, provingProbes } from "./selfcheck.ts";
import { stressThings } from "./stress.ts";

/** The terrain flight runs on a server of its own, on the 8 km map (tools/device.ts --terrain); the others on the proving ground. */
export type Mode = "quick" | "ladder" | "soak" | "terrain";
export const MODES: readonly Mode[] = ["quick", "ladder", "soak", "terrain"];

/**
 * The quick look's scenes: the proving ground as the self-check sees it; with the stress meshes; turned round to the
 * crowd; on a tier of two depth ranges (D252), the crowd again in one; and on a lit tier that casts, the crowd again with
 * no shadows: each to set against the crowd.
 */
export type SceneName = "plain" | "stress" | "crowd" | "crowd1" | "crowd0";
export const SCENES: readonly SceneName[] = ["plain", "stress", "crowd"];
export const scenesOf = (tier: Tier): readonly SceneName[] => [...SCENES, ...(tier.split > 0 ? ["crowd1" as const] : []), ...(tier.lit && tier.shadows.cascades > 0 ? ["crowd0" as const] : [])];

/**
 * What the ladder adds, a rung at a time. Bodies: copies of the crowd, posed. Pieces: stone and wood houses the server
 * builds, with their materials near. Triangles: rocks near, each a draw. Draws: rocks far, each a draw of few triangles.
 */
export type Axis = "bodies" | "triangles" | "draws" | "pieces";
export const AXES: readonly Axis[] = ["bodies", "triangles", "draws", "pieces"];
/** Each axis's last rung is the most the engine takes: a view of 2,048 bodies, 4,096 draws a frame, the base's 4,096 pieces. */
export const RUNGS: Readonly<Record<Axis, readonly number[]>> = { bodies: [25, 50, 100, 200, 400, 800, 1600, 2048], triangles: [8, 16, 32, 64, 128, 256, 512, 1024], draws: [256, 512, 1024, 2048, 3600], pieces: [64, 128, 256, 512, 1024, 2048, 4096] };
/** Texture memory the ladder takes at the end, in megabytes, until the device refuses it or it is all held. */
export const MEMORY_MB: readonly number[] = [128, 256, 512, 768, 1024, 1536, 2048, 3072, 4096];

export interface Timing {
  /** A phase or rung is measured this long once what it shows has settled. */
  measureMs: number;
  rungMs: number;
  /** How long a step may take to settle, or a held amount of texture memory to be sampled, and loading to reach full detail, before the run goes on without. */
  settleMs: number;
  loadMs: number;
  /** How long the soak turns, and how long a held amount of texture memory is watched. */
  soakMs: number;
  holdMs: number;
  /** How long the terrain flight flies on each tier, and how often it jumps. */
  flightMs: number;
  teleportMs: number;
}
export const TIMING: Timing = { measureMs: 5000, rungMs: 1500, settleMs: 10000, loadMs: 60000, soakMs: 600000, holdMs: 1500, flightMs: 60000, teleportMs: 10000 };
/** The terrain flight: its tiers, how fast and how high it flies, how fast it turns, and the least jump. */
const FLIGHT_TIERS = ["medium", "lowpoly"];
export const FLIGHT_TIER_COUNT = FLIGHT_TIERS.length;
const FLIGHT_SPEED = 100;
const FLIGHT_UP = 60;
const FLIGHT_TURN = (2 * Math.PI) / 30;
const JUMP = 2000;
/**
 * After the flights, base chunks drawn as far blocks at medium, from none to as many as the far blocks' benchmark
 * draws, within FAR_REACH of the map's middle (D257); the camera FAR_UP over the ground there, turning once round every
 * FAR_TURN_MS. Then the map's wood (D259). The proving ground is too small for either, so they are on the terrain map.
 */
export const FAR_CHUNKS: readonly number[] = [0, 130, 480];
const FAR_REACH = 2000;
const FAR_UP = 30;
const FAR_TURN_MS = 2000;
/** The wood's rungs, one a tier the device takes, are seen from eye height. */
const EYE_UP = 1.7;
/** Frames in a row with nothing on its way and nothing waiting to go on the graphics card: settled then. */
const STILL = 30;
/** A quick phase this slow, in ms a frame, and the tiers above it are not tried. */
const TOO_SLOW = 100;
/** Frames stopped this long while the page is shown, and the run ends. */
const STALL_MS = 15000;
/** A rung holds the display's rate when its median frame is within this share of the display's, and its 95th within the next. */
const HOLD_MEDIAN = 1.12;
const HOLD_P95 = 1.5;
/** A frame this many display intervals or longer is long: the screen missed two or more. */
export const LONG = 3;
/** Texture memory taken a frame, in megabytes, so that frames keep coming while it grows. */
const MEMORY_STEP = 16;
/** Frames the picture probes wait for one drawn with a plain sky. */
const PLAIN_FRAMES = 30;

export interface Spread {
  median: number;
  p95: number;
  p99: number;
  worst: number;
}

const tenth = (x: number): number => Math.round(x * 10) / 10;

/** Draws a frame asked to have drawn with their materials. */
function texturedDraws(p: FramePacket): number {
  let n = 0;
  for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_TEXTURED) !== 0) n++;
  return n;
}

/** Rounded to a tenth. Nothing gives zeros. */
export function spread(values: readonly number[]): Spread {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => (s.length === 0 ? 0 : tenth(s[Math.floor((s.length - 1) * q)]!));
  return { median: at(0.5), p95: at(0.95), p99: at(0.99), worst: at(1) };
}

export interface PhaseReport {
  tier: string;
  scene: SceneName;
  /** Device pixels the page drew for one CSS pixel at this tier, and the canvas in device pixels. */
  ratio: number;
  canvas: number[];
  settleMs: number;
  settled: boolean;
  frames: number;
  /** Between frames, as the browser called for them. */
  frameMs: Spread;
  /** In our own code: building the frame and the interface, and handing the frame to WebGL. */
  buildMs: Spread;
  drawMs: Spread;
  /**
   * The GPU's ms for a frame by timer query, median, or null where there are none. In crowd0 where there are some, its
   * frames have shadows and none by turns, and `gpuOff` is the median of those with none.
   */
  gpuMs: number | null;
  gpuOff: number | null;
  /** Medians a frame: WebGL draw calls, triangles, draws the frame asked to have drawn with their materials, and bones posed. */
  drawCalls: number;
  triangles: number;
  textured: number;
  bones: number;
  /** Totals over the measured frames, as the frame packet counted them. */
  dropped: number;
  skipped: number;
  /** While the step settled and ran: bytes fetched over the network, asset requests that failed, and snapshots missed. */
  fetched: number;
  failed: number;
  missed: number;
  /** Times the graphics context was lost, and the tier the game fell to for want of memory, if it did. */
  lost: number;
  fellTo: string | null;
}

/** One rung of the ladder: `n` of `axis` on `tier`, and whether frames kept the display's rate. */
export interface RungReport {
  tier: string;
  axis: Axis;
  n: number;
  held: boolean;
  /** Where a rung that broke spent its frame: "our code", "the GPU", or "lost" for a lost context. Empty if it held or is invalid. */
  limit: string;
  /** Why the rung's frames do not stand for its load, so it neither held nor broke. Empty if they do. */
  invalid: string;
  canvas: number[];
  settled: boolean;
  frameMs: Spread;
  /** Medians: our code's ms, draw calls, triangles, bones posed and draws with materials. */
  buildMs: number;
  drawMs: number;
  calls: number;
  tris: number;
  bones: number;
  mat: number;
  fetched: number;
  missed: number;
}

export interface MemoryReport {
  variant: string;
  /** Megabytes of textures the game itself held on the card besides, when the step ended. */
  gameMB: number;
  /** The most held, sampled and watched with frames still coming, and the amount at which the device refused, or null if it never did. */
  heldMB: number;
  failedMB: number | null;
  /** The first amount whose frames did not keep the display's rate (D246's test), or null. */
  slowMB: number | null;
  how: string;
  /** For each amount held: its frames while every tile was sampled, our code's ms a frame in sampling, and whether it kept the rate. */
  rungs: { mb: number; frameMs: number; p95: number; worst: number; oursMs: number; held: boolean }[];
}

export interface SoakReport {
  tier: string;
  /** What the soak turned through, and where the amounts came from: "defaults", or half what the ladder held on this page. */
  load: { bodies: number; pieces: number; near: number; far: number; stress: boolean };
  from: string;
  /** Whether it turned through the terrain map's wood, and the sun's cascades the tier casts into, 0 for none: lit tiers cast by default. */
  wood: boolean;
  cascades: number;
  minutesWanted: number;
  /** Each minute's frames, with `long` the frames of LONG display intervals or more while the page was shown, and `mat` the most draws with materials in one. */
  minutes: { minute: number; frames: number; frameMs: Spread; long: number; buildMs: number; drawMs: number; missed: number; mat: number }[];
  /** Times the page was hidden, and how long in all. The soak's clock stops while it is. */
  hidden: number;
  hiddenMs: number;
}

/** One tier's terrain flight (D253): frames, and those that carried rows of the terrain window against those that did not. */
export interface FlightReport {
  tier: string;
  frames: number;
  frameMs: Spread;
  /** Frames that carried window rows, the worst of them, and the median of frames that carried none. */
  windowFrames: number;
  windowWorst: number;
  plainMedian: number;
  /** Medians of our code's ms handing the frame to WebGL, and of the GPU's ms for the frame by timer query (null without), with rows and without. */
  drawWindow: number;
  drawPlain: number;
  gpuWindow: number | null;
  gpuPlain: number | null;
  /** For each jump, frames until the new window was in (-1 if not before the next), and the mean of TerrainLod.coarser over those frames. */
  fills: number[];
  coarser: number;
}

/** A rung on the terrain map, held or not as a ladder's rung is. */
export interface TerrainRung {
  held: boolean;
  limit: string;
  invalid: string;
  settled: boolean;
  frameMs: Spread;
  /** Medians: our code's ms, draw calls and triangles, and the GPU's ms for a frame by timer query (null without). */
  buildMs: number;
  drawMs: number;
  calls: number;
  tris: number;
  gpuMs: number | null;
}

/** Far bases (D257): base chunks drawn as blocks at medium. */
export interface FarRung extends TerrainRung {
  /** Base chunks asked for, and those placed: none where the near store held a chunk whole or the far feed had sent cells. */
  asked: number;
  chunks: number;
  /** Far draws a frame, median. */
  farDraws: number;
}

/** The wood (D259): far trees, rocks and bushes out to a tier's reach, its trees' in metres. */
export interface WoodRung extends TerrainRung {
  tier: string;
  reach: number;
  /** Far node draws a frame, median. */
  nodeDraws: number;
}

export interface TerrainReport {
  /** The map's side in metres, the terrain pictures' bytes (groundSize) and all the card has reserved for what is not an asset. */
  side: number;
  groundBytes: number;
  reservedBytes: number;
  minutesWanted: number;
  flights: FlightReport[];
  far: FarRung[];
  wood: WoodRung[];
}

export interface DeviceInfo {
  userAgent: string;
  screen: number[];
  window: number[];
  pixelRatio: number;
  cores: number;
  memoryGB: number | null;
  touch: number;
  features: Record<string, boolean | string | number>;
}

export interface GpuInfo {
  vendor: string;
  renderer: string;
  version: string;
  maxTexture: number;
  maxArrayLayers: number;
  maxSamples: number;
  vertexTextures: number;
  /** Textures a draw may read in its fragments and in all, colour targets it may write at once, and the most anisotropy, 0 for none. */
  textureUnits: number;
  combinedUnits: number;
  drawBuffers: number;
  anisotropy: number;
  /** A uniform block's most bytes, blocks a vertex and a fragment program may read, bindings, and the step a block's offset is in. */
  uniformBytes: number;
  uniformBlocks: number[];
  uniformBindings: number;
  uniformAlign: number;
  highp: boolean;
  antialias: boolean;
  /** Bits of the canvas's depth buffer. Two depth ranges (D252) are worked out for 24. */
  depthBits: number;
  extensions: string[];
  /** The texture variant the renderer took for this device: "bc", "astc" or "rgba". */
  variant: string;
}

export interface DeviceReport {
  /** Made up by the page. A run is one file in .cache/device. */
  run: string;
  mode: Mode;
  /** Counts the page's posts, so a late one cannot overwrite a newer. */
  seq: number;
  stage: string;
  done: boolean;
  device: DeviceInfo | null;
  gpu: GpuInfo | null;
  /** Between frames before the game started, with nothing drawn: the display's rate, or the most the browser allows. */
  idleFrameMs: number | null;
  wakeLock: string;
  link: {
    /** Round trips of a small request. */
    httpMs: Spread | null;
    /** The game's own measure of its round trip, which counts whole ticks. */
    gameMs: Spread | null;
    /** Snapshots from the first this page had: received, and missed in all, while the game loaded, and while the page was hidden. */
    snapshots: number;
    missed: number;
    missedLoading: number;
    missedHidden: number;
    /** What the server says it held back, for every page it serves: unreliable messages it skipped because too much was waiting to go, and snapshots too large to send. */
    server: { skipped: number; overflows: number } | null;
    /** The longest time between two frames that brought a snapshot while steps were measured. */
    longestGapMs: number;
    bytesIn: number;
    clockJumps: number;
    corrections: number;
    undecodable: number;
  };
  load: {
    /** From when the game began to load. */
    firstFrameMs: number;
    fullDetailMs: number;
    settled: boolean;
    /** The page and what it fetched itself; the asset worker's parts from the network and from its disk cache. */
    pageBytes: number;
    assetBytes: number;
    diskBytes: number;
    /** Asset requests that failed by then. */
    failed: number;
    /** Where the asset worker keeps parts between visits: "disk", "memory" or "none". */
    cache: string;
  } | null;
  probes: { name: string; ok: boolean; expected: number[]; got: number[] }[] | null;
  hashes: { name: string; got: string; want: string | null; ms: number }[] | null;
  phases: PhaseReport[];
  /** The first phase once more at the end. A phone that has grown warm runs slower. */
  again: PhaseReport | null;
  ladder: { display: number; rungs: RungReport[]; memory: MemoryReport | null } | null;
  soak: SoakReport | null;
  terrain: TerrainReport | null;
  /** The quick look's answers to what round 8's depth, sky and shadows lean on (devicegpu.ts). */
  gpuTests: GpuReport | null;
  skipped: string[];
  /** Textures the renderer made once the game had started. A material is drawn from them. */
  texturesMade: number;
  /** Stages and phases that began again because the page was hidden. */
  hidden: string[];
  errors: string[];
  /** Set when the page found its own run unfinished as it loaded: the browser had reloaded it, most likely after a crash. */
  reloadedDuring: string | null;
}

export function newReport(run: string, mode: Mode = "quick"): DeviceReport {
  return {
    run, mode, seq: 0, stage: "starting", done: false, device: null, gpu: null, idleFrameMs: null, wakeLock: "not asked",
    link: { httpMs: null, gameMs: null, snapshots: 0, missed: 0, missedLoading: 0, missedHidden: 0, server: null, longestGapMs: 0, bytesIn: 0, clockJumps: 0, corrections: 0, undecodable: 0 },
    load: null, probes: null, hashes: null, phases: [], again: null, ladder: null, soak: null, terrain: null, gpuTests: null, skipped: [], texturesMade: 0, hidden: [], errors: [], reloadedDuring: null,
  };
}

/** Settles as what `f` starts does, or with `or` if it throws, fails or takes longer than `ms`. */
export type Within = <T>(f: () => Promise<T>, ms: number, or: T) => Promise<T>;

/**
 * What the engine leans on that a browser may lack, read off its global object: the asset cache's workers, private file
 * storage and decompression, voice chat's audio worklet and Opus, and the transports and graphics a later round may use.
 */
export async function featuresOf(g: Record<string, unknown>, within: Within): Promise<Record<string, boolean | string | number>> {
  const fn = (name: string): boolean => typeof g[name] === "function";
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  const storage = (nav.storage ?? {}) as { getDirectory?: unknown; estimate?: () => Promise<{ quota?: number }> };
  const Decompress = g.DecompressionStream as (new (format: string) => unknown) | undefined;
  const opus = { codec: "opus", sampleRate: 48000, numberOfChannels: 1 };
  const codec = async (name: string, config: object): Promise<boolean> => fn(name) && (await within(() => (g[name] as { isConfigSupported(c: object): Promise<{ supported?: boolean }> }).isConfigSupported(config), 2000, null))?.supported === true;
  const quota = (await within(() => storage.estimate!(), 2000, null))?.quota;
  return {
    workers: fn("Worker"),
    opfs: typeof storage.getDirectory === "function",
    decompress: ["gzip", "deflate", "deflate-raw", "brotli", "zstd"].filter((format) => {
      try {
        return Decompress !== undefined && new Decompress(format) !== null;
      } catch {
        return false;
      }
    }).join(" "),
    audioWorklet: fn("AudioWorkletNode"),
    opusEncode: await codec("AudioEncoder", { ...opus, bitrate: 24000 }),
    opusDecode: await codec("AudioDecoder", opus),
    webTransport: fn("WebTransport"),
    webgpu: nav.gpu !== undefined,
    wakeLock: nav.wakeLock !== undefined,
    quotaMB: quota ? Math.round(quota / 1048576) : "?",
  };
}

export function deviceOf(g: Record<string, unknown>, features: Record<string, boolean | string | number>): DeviceInfo {
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  const screen = (g.screen ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  return { userAgent: String(nav.userAgent ?? ""), screen: [n(screen.width), n(screen.height)], window: [n(g.innerWidth), n(g.innerHeight)], pixelRatio: n(g.devicePixelRatio), cores: n(nav.hardwareConcurrency), memoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null, touch: n(nav.maxTouchPoints), features };
}

/** What gpuOf asks of a WebGL 2 context. GL holds WebGL's own numbers for what it is asked. */
export interface GlLike {
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
  getSupportedExtensions(): string[] | null;
  getShaderPrecisionFormat(shader: number, type: number): { precision: number } | null;
  getContextAttributes(): { antialias?: boolean } | null;
}
const GL = { VENDOR: 0x1f00, VERSION: 0x1f02, MAX_TEXTURE_SIZE: 0x0d33, MAX_ARRAY_TEXTURE_LAYERS: 0x88ff, MAX_SAMPLES: 0x8d57, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c, MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d, MAX_DRAW_BUFFERS: 0x8824, MAX_ANISOTROPY: 0x84ff, FRAGMENT_SHADER: 0x8b30, HIGH_FLOAT: 0x8df2, UNMASKED_VENDOR_WEBGL: 0x9245, MAX_UNIFORM_BLOCK_SIZE: 0x8a30, MAX_VERTEX_UNIFORM_BLOCKS: 0x8a2b, MAX_FRAGMENT_UNIFORM_BLOCKS: 0x8a2d, MAX_UNIFORM_BUFFER_BINDINGS: 0x8a2f, UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8a34, DEPTH_BITS: 0x0d56 };

export function gpuOf(gl: GlLike, renderer: string, variant = "rgba"): GpuInfo {
  const n = (name: number): number => Number(gl.getParameter(name));
  return {
    vendor: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info") ? GL.UNMASKED_VENDOR_WEBGL : GL.VENDOR)),
    renderer,
    version: String(gl.getParameter(GL.VERSION)),
    maxTexture: n(GL.MAX_TEXTURE_SIZE),
    maxArrayLayers: n(GL.MAX_ARRAY_TEXTURE_LAYERS),
    maxSamples: n(GL.MAX_SAMPLES),
    vertexTextures: n(GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    textureUnits: n(GL.MAX_TEXTURE_IMAGE_UNITS),
    combinedUnits: n(GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    drawBuffers: n(GL.MAX_DRAW_BUFFERS),
    // Asked only once the extension is on, or the question is an error.
    anisotropy: gl.getExtension("EXT_texture_filter_anisotropic") ? n(GL.MAX_ANISOTROPY) : 0,
    highp: (gl.getShaderPrecisionFormat(GL.FRAGMENT_SHADER, GL.HIGH_FLOAT)?.precision ?? 0) > 0,
    antialias: gl.getContextAttributes()?.antialias === true,
    uniformBytes: n(GL.MAX_UNIFORM_BLOCK_SIZE),
    uniformBlocks: [n(GL.MAX_VERTEX_UNIFORM_BLOCKS), n(GL.MAX_FRAGMENT_UNIFORM_BLOCKS)],
    uniformBindings: n(GL.MAX_UNIFORM_BUFFER_BINDINGS),
    uniformAlign: n(GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT),
    depthBits: n(GL.DEPTH_BITS),
    extensions: gl.getSupportedExtensions() ?? [],
    variant,
  };
}

/** The compressed texture families a list of WebGL extensions takes. The pack's bc variant needs bc4-5 and bc6-7. */
export function formatsOf(extensions: readonly string[]): string[] {
  const named: [string, string][] = [["WEBGL_compressed_texture_s3tc", "bc1-3"], ["EXT_texture_compression_rgtc", "bc4-5"], ["EXT_texture_compression_bptc", "bc6-7"], ["WEBGL_compressed_texture_astc", "astc"], ["WEBGL_compressed_texture_etc", "etc2"]];
  return named.filter(([ext]) => extensions.includes(ext)).map(([, name]) => name);
}

/**
 * The scenarios of shared/sim/scenarios.ts on a client's content and boot pack. The server runs the same on the pack it
 * serves, so equal hashes mean this JavaScript engine simulates, poses and builds exactly as the server's does.
 */
export function deviceScenarios(reg: Registry, pack: Pack): [string, () => string][] {
  const anim = new HumanAnim(pack.clips);
  const rigs = buildRigs(pack.header.rigs, pack.clips);
  const creatures = creatureAnims(reg, (d) => rigs.get(d.mesh)).filter((a) => a !== null);
  return [["sim", () => simHash(reg)], ["pose", () => poseHash(anim)], ["snap", () => snapHash(reg)], ["creature", () => creatureHash(creatures)], ["tuned", () => tunedHash(reg)], ["hull", () => hullHash(reg)], ["node", () => nodeHash(reg)]];
}

/** What a step shows. The pieces are the server's to build; the rest is added on the page. */
export interface Load {
  tier: Tier;
  yaw: number;
  stress: boolean;
  bodies: number;
  pieces: number;
  near: number;
  far: number;
  /** Drawn in one depth range on a tier of two, with no shadows on a tier that casts, and with no far trees, rocks or bushes. */
  oneRange?: boolean;
  noShadows?: boolean;
  noWood?: boolean;
  /** With noShadows, shadows and none by turns, frame by frame. */
  byTurns?: boolean;
}

interface Step {
  kind: "phase" | "again" | "rung";
  load: Load;
  scene?: SceneName;
  axis?: Axis;
  n?: number;
}

const bare = (tier: Tier, yaw: number): Load => ({ tier, yaw, stress: false, bodies: 0, pieces: 0, near: 0, far: 0 });

/** The rung of `axis` with `n` on `tier`. */
export function rungLoad(tier: Tier, axis: Axis, n: number): Load {
  const load = bare(tier, axis === "bodies" ? LOOK.bodies : axis === "pieces" ? LOOK.pieces : LOOK.rocks);
  if (axis === "triangles") load.near = n;
  else if (axis === "draws") load.far = n;
  else load[axis] = n;
  return load;
}

/**
 * A rung's verdict (D246). A lost context is a result. Otherwise its frames count only if it drew everything it was
 * given, settled, fetched all it asked for and kept its tier; if not, it is invalid and neither held nor broke.
 */
export function judgeRung(p: PhaseReport, display: number): { held: boolean; limit: string; invalid: string } {
  if (p.lost > 0) return { held: false, limit: "lost", invalid: "" };
  const why = [p.dropped > 0 ? `${p.dropped} things dropped` : "", p.skipped > 0 ? `${p.skipped} draws skipped` : "", p.failed > 0 ? `${p.failed} fetches failed` : "", p.fellTo ? `the game fell to ${p.fellTo}` : "", p.settled ? "" : "never settled"];
  const invalid = why.filter((w) => w !== "").join(", ");
  if (invalid) return { held: false, limit: "", invalid };
  const held = p.frameMs.median <= display * HOLD_MEDIAN && p.frameMs.p95 <= display * HOLD_P95;
  return { held, limit: held ? "" : p.buildMs.median + p.drawMs.median >= p.frameMs.median * 0.75 ? "our code" : "the GPU", invalid };
}

/** The tiers a device whose textures go up to `maxTexture` wide can take. */
const takes = (maxTexture: number): Tier[] => TIERS.filter((t) => t.texture <= maxTexture);

/**
 * The ladder's order: for each tier the device can take, each axis a rung at a time from the lightest. The rung after
 * one that did not hold is the next axis's first: the ladder stops climbing at the first rung that breaks, and a lost
 * context ends the tier and those above it.
 */
export class LadderPlan {
  private readonly tiers: Tier[];
  private tier = 0;
  private axis = 0;
  private rung = -1;

  constructor(maxTexture: number) {
    this.tiers = takes(maxTexture);
  }

  /** The next rung after one that `held` or not (broke or invalid), or was `lost`. Null at the end. */
  next(held: boolean, lost: boolean): { tier: Tier; axis: Axis; n: number } | null {
    if (lost) this.tier = this.tiers.length;
    else if (this.rung >= 0 && !held) [this.axis, this.rung] = [this.axis + 1, -1];
    for (;;) {
      if (this.tier >= this.tiers.length) return null;
      const axis = AXES[this.axis];
      if (axis === undefined) [this.tier, this.axis, this.rung] = [this.tier + 1, 0, -1];
      else if (++this.rung < RUNGS[axis].length) return { tier: this.tiers[this.tier]!, axis, n: RUNGS[axis][this.rung]! };
      else [this.axis, this.rung] = [this.axis + 1, -1];
    }
  }
}

/** Half of what the ladder held on `tier` for each axis, a rung down, or `fallback` where it did not climb. */
export function soakLoad(rungs: readonly RungReport[] | null, tier: string): { load: Omit<Load, "tier" | "yaw">; from: string } {
  const fallback = { stress: true, bodies: 200, pieces: 1024, near: 16, far: 512 };
  const held = (axis: Axis): number => Math.max(0, ...(rungs ?? []).filter((r) => r.tier === tier && r.axis === axis && r.held).map((r) => r.n));
  if (!rungs || !AXES.some((a) => held(a) > 0)) return { load: fallback, from: "defaults" };
  const half = (axis: Axis): number => [...RUNGS[axis]].reverse().find((n) => n <= held(axis) / 2) ?? 0;
  return { load: { stress: true, bodies: half("bodies"), pieces: half("pieces"), near: half("triangles"), far: half("draws") }, from: `half what the ladder held on ${tier}` };
}

/** What the run needs from the page. */
export interface DeviceSide {
  app: App;
  pack: Pack;
  reg: Registry;
  hf: Heightfield;
  /** The browser's device pixels for one CSS pixel. */
  dpr: number;
  /** The widest texture the device takes. A tier with wider ones is not tried. */
  maxTexture: number;
  /** When the game began to load, on the clock of `now`. */
  bootAt: number;
  now(): number;
  /** Bytes the page and what it fetched itself have taken so far. */
  pageBytes(): number;
  /** The server's hashes of deviceScenarios, by name. */
  expected: Record<string, string> | null;
  /** Bodies added on the page, which the run sets the number of. */
  bodies: BodyCopies;
  /** Asks the probe's server to stand `n` pieces in its base. Resolves with how many stand, or null if it would not. */
  base(n: number): Promise<number | null>;
  /** Texture memory for the ladder's last step, in the renderer's variant. Null where the renderer gives none. */
  memory: TextureMemory | null;
  /** The GPU questions, made when the quick look comes to them, once the canvas has its size. Null where the renderer gives none. */
  questions: (() => GpuQuestions) | null;
  /** The GPU's time for whole frames where the browser has timer queries; null where the renderer gives none. */
  frames: FrameTimer | null;
  /** The display's interval between frames, which a rung holds or not. */
  display: number;
  /** Whether the page's server is the terrain flight's, on its 8 km map, where the soak turns through the wood. */
  terrainMap: boolean;
}

type Stage = "load" | "probes" | "hashes" | "gpu" | "steps" | "memory" | "soak" | "terrain" | "done";

export class DeviceRun {
  readonly report: DeviceReport;
  private readonly side: DeviceSide;
  private readonly timing: Timing;
  private readonly mode: Mode;
  private stage: Stage = "load";
  private step: Step | null = null;
  /** The quick look's phases, in order, and the one under way. */
  private readonly plan: { tier: Tier; scene: SceneName }[];
  private index = -1;
  private readonly ladder: LadderPlan;
  /** When the step began, or -1 for at the next frame. */
  private at = 0;
  private measuring = false;
  private settleMs = 0;
  private settled = false;
  private still = 0;
  private stillSince = 0;
  private last = 0;
  private lastFrameAt = 0;
  private shownAt = 0;
  private canvas: number[] = [0, 0];
  private stress: Thing[] | null = null;
  private plainWait = 0;
  private lostCount = 0;
  private lostAt = 0;
  private fetchedAt = 0;
  private failedAt = 0;
  private dropped = 0;
  private skipped = 0;
  private readonly samples = { frame: [] as number[], build: [] as number[], draw: [] as number[], calls: [] as number[], tris: [] as number[], textured: [] as number[], bones: [] as number[], gpu: [] as number[], gpuOff: [] as number[] };
  /** Tiers above this index are not tried in the quick look, for `stopWhy`. */
  private stopAbove = TIERS.length;
  private stopWhy = "";
  /** The base's pieces as the server last said, and whether it is still to say; the client's count of structures, and how long it has stood. */
  private pieces = 0;
  private asking = false;
  private structs = -1;
  private structsStill = 0;
  /** Snapshot counts: from the first snapshot, at the step's start, and when the page was hidden. */
  private base: { snapshots: number; latest: number } | null = null;
  private stepBase = { snapshots: 0, latest: 0 };
  private hiddenBase: { snapshots: number; latest: number } | null = null;
  private snapTick = 0;
  private snapAt = 0;
  private longestGap = 0;
  private readonly rtt: number[] = [];
  /** The memory step's amount under way, how long it has held it, and the sweeps over every tile when it began to. */
  private memoryRung = 0;
  private heldSince = -1;
  private sweepsAt = 0;
  /** The load whose tier the scene's build changes: in one depth range, with no shadows, with no far wood. */
  private drawn: Load | null = null;
  /** Whether the frame last built was drawn with no shadows. */
  private shadowless = false;
  /** Where the terrain flight puts the camera, if it does. */
  private fly: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  /** The terrain flight under way: its tier, clock, heading, jumps, and the jump whose window is awaited. */
  private flight: { tier: number; ms: number; heading: number; jumps: number; wait: { frames: number; coarser: number } | null; fills: number[]; coarser: number[]; rows: boolean[]; gpu: { ms: number; tag: boolean }[] } | null = null;
  /** The terrain rung under way: its index, whether it is the wood's, and its frames' far draws and GPU times. */
  private rungs: { k: number; wood: boolean; draws: number[]; gpu: number[] } | null = null;
  /** The chunks far bases may stand in, the cells of each kind, and how many stand. */
  private bases: { spots: number[]; cells: FarCells[]; placed: number } | null = null;
  private wrapped: object | null = null;
  /** The quick look's GPU questions, while they are asked. */
  private questions: GpuQuestions | null = null;
  /** The soak's amounts, clock and minute under way. */
  private readonly soakFrom: { load: Omit<Load, "tier" | "yaw">; from: string };
  private soakMs = 0;
  private hiddenAt = -1;
  /** From the page being hidden until the first frame after it is shown again: the soak's clock leaves that time out. */
  private away = false;

  /** `skipLoad` for a test begun on a page whose game is loaded already. `held` is a ladder's rungs from before, for the soak. */
  constructor(report: DeviceReport, side: DeviceSide, mode: Mode, timing: Timing = TIMING, skipLoad = false, held: readonly RungReport[] | null = null) {
    this.report = report;
    this.side = side;
    this.timing = timing;
    this.mode = mode;
    this.plan = TIERS.flatMap((tier) => scenesOf(tier).map((scene) => ({ tier, scene })));
    this.ladder = new LadderPlan(side.maxTexture);
    this.soakFrom = soakLoad(held, this.soakTier().name);
    if (mode === "ladder") report.ladder = { display: side.display, rungs: [], memory: null };
    if (skipLoad) {
      this.lastFrameAt = side.now();
      this.ask();
    }
  }

  /** Each drawn frame, once it is handed to WebGL. True when the report has news worth sending. */
  frame(now: number, p: FramePacket, buildMs: number, drawMs: number, drawCalls: number, canvas: number[], read: (sx: number, sy: number) => [number, number, number]): boolean {
    if (this.stage === "done") return false;
    const app = this.side.app;
    const r = app.scene!.assets.residency;
    const gap = this.last > 0 ? now - this.last : 0;
    this.last = now;
    this.lastFrameAt = this.side.now();
    this.canvas = canvas;
    const count = app.session.world?.structs.count ?? 0;
    this.structsStill = count === this.structs ? this.structsStill + 1 : 0;
    this.structs = count;
    const quiet = r.flying === 0 && r.waiting === 0 && p.assetUploads.length === 0 && p.texUploads.length === 0 && p.skipped === 0 && !this.asking && this.structsStill >= STILL;
    if (quiet && this.still === 0) this.stillSince = now;
    this.still = quiet ? this.still + 1 : 0;
    this.listen(now);
    let news = false;
    if (this.stage === "load") news = this.load(now);
    else if (this.stage === "probes") news = this.probes(p, read);
    else if (this.stage === "hashes") news = this.hashes();
    else if (this.stage === "gpu") news = this.gpu();
    else if (this.stage === "steps") news = this.measure(now, gap, p, buildMs, drawMs, drawCalls);
    else if (this.stage === "memory") news = this.memory(now, gap);
    else if (this.stage === "soak") news = this.soak(now, gap, p, buildMs, drawMs);
    else if (this.stage === "terrain") news = this.rungs ? this.rungFrame(now, gap, p, buildMs, drawMs, drawCalls) : this.terrain(now, gap, p, drawMs);
    if (news) this.sync();
    return news;
  }

  /** The page was hidden: what was under way starts again when it is shown, but the soak and the memory step go on. */
  hidden(): void {
    if (this.stage === "done") return;
    const s = this.side.app.session;
    this.hiddenBase = { snapshots: s.stats.snapshots, latest: s.latestSnapshot };
    this.hiddenAt = this.side.now();
    this.away = true;
    this.report.hidden.push(this.report.stage);
    if (this.stage === "steps") this.show();
  }

  /** The page is shown again: the frames' stopping until now does not count. */
  shown(now: number): void {
    this.shownAt = now;
    if (this.stage === "soak" && this.hiddenAt >= 0) {
      this.report.soak!.hidden++;
      this.report.soak!.hiddenMs = Math.round(this.report.soak!.hiddenMs + now - this.hiddenAt);
    }
    this.hiddenAt = -1;
  }

  lost(): void {
    this.lostCount++;
    this.questions?.lost();
  }

  /** About once a second while the page is shown. True if the run had to end, because nothing was drawn for too long. */
  watch(now: number): boolean {
    if (this.stage === "done") return false;
    const first = this.lastFrameAt === 0;
    const quiet = now - Math.max(first ? this.side.bootAt : this.lastFrameAt, this.shownAt);
    if (quiet < (first ? this.timing.loadMs : STALL_MS)) return false;
    this.fail(`${first ? "nothing was drawn" : "the frames stopped"} for ${Math.round(quiet / 1000)} s: ${this.side.app.hud.status || "no reason given"}`);
    return true;
  }

  fail(why: string): void {
    this.report.errors.push(`${this.report.stage}: ${why}`);
    this.end();
  }

  /** A line or two for the page while the run goes on. */
  progress(now: number): string {
    const left = this.measuring ? `${Math.max(0, Math.ceil((this.timing.measureMs - (now - this.at)) / 1000))} s left` : "settling";
    return progressText(this.mode, this.report.stage, this.stage === "steps" && this.mode === "quick" ? left : this.stage === "soak" ? `${Math.floor(this.soakMs / 60000)} of ${this.timing.soakMs / 60000} minutes` : "");
  }

  private load(now: number): boolean {
    const side = this.side;
    if (!this.report.load) {
      this.apply(bare(tierOf(DEFAULT_TIER), 0));
      this.report.stage = "loading";
      this.report.load = { firstFrameMs: tenth(now - side.bootAt), fullDetailMs: 0, settled: false, pageBytes: 0, assetBytes: 0, diskBytes: 0, failed: 0, cache: "" };
      this.at = now;
      return true;
    }
    if (this.still < STILL && now - this.at < this.timing.loadMs) return false;
    const r = side.app.scene!.assets.residency;
    const load = this.report.load;
    load.settled = this.still >= STILL;
    load.fullDetailMs = tenth((load.settled ? this.stillSince : now) - side.bootAt);
    load.pageBytes = side.pageBytes();
    load.assetBytes = r.stats.fetched;
    load.diskBytes = r.stats.cached;
    load.failed = this.failures();
    load.cache = r.cache?.mode ?? "none";
    // The probes look at the proving ground, which the terrain server's map is not.
    this.stage = this.side.terrainMap ? "hashes" : "probes";
    this.report.stage = this.stage;
    return true;
  }

  /**
   * The self-check's probes that are on this screen, read off the picture of the default tier once it has settled. A
   * narrow screen leaves the slope out. The picture is drawn with a plain sky, as the self-check draws it (no haze,
   * nothing over the table), so its colours are the twins'; the frame after the sky is made plain is read, or after
   * PLAIN_FRAMES whatever was drawn.
   */
  private probes(p: FramePacket, read: (sx: number, sy: number) => [number, number, number]): boolean {
    const { app, reg, pack, hf } = this.side;
    const scene = app.scene!;
    const plain = !p.lit || (p.frame[FRAME.haze] === 0 && p.frame[FRAME.skyDetail] === 0);
    scene.plainSky = true;
    if (!plain && ++this.plainWait < PLAIN_FRAMES) return false;
    scene.plainSky = app.plainSky;
    const shown = provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, true, scene.packet).filter((q) => q.sx >= 0 && q.sx < 1 && q.sy >= 0 && q.sy < 1);
    this.report.probes = shown.map((q) => {
      const got = read(q.sx, q.sy);
      return { name: q.name, ok: probePasses(q, got[0], got[1], got[2]), expected: q.rgb, got };
    });
    this.stage = "hashes";
    this.report.stage = "hashes";
    return true;
  }

  private hashes(): boolean {
    const side = this.side;
    this.report.hashes = deviceScenarios(side.reg, side.pack).map(([name, run]) => {
      const t = side.now();
      const got = run();
      return { name, got, want: side.expected?.[name] ?? null, ms: tenth(side.now() - t) };
    });
    this.ask();
    return true;
  }

  /** The quick look asks the GPU questions first, where the renderer gives them. The other tests begin at once. */
  private ask(): void {
    const make = this.side.questions;
    if (this.mode !== "quick" || !make) return this.begin();
    this.questions = make();
    this.report.gpuTests = this.questions.report;
    this.stage = "gpu";
    this.report.stage = "gpu questions";
  }

  /** A step of the GPU questions after the game's frame. News when one is answered. */
  private gpu(): boolean {
    const q = this.questions!;
    const was = q.stage;
    if (q.frame()) {
      this.questions = null;
      this.begin();
      return true;
    }
    if (q.stage === was) return false;
    this.report.stage = `gpu ${q.stage}`;
    return true;
  }

  /** The test's own part begins: the first step, the soak, or the end. Snapshots missed until now were missed loading. */
  private begin(): void {
    const s = this.side.app.session;
    if (this.base) this.report.link.missedLoading = this.missedSince(this.base);
    this.base ??= s.latestSnapshot > 0 ? { snapshots: s.stats.snapshots, latest: s.latestSnapshot } : null;
    if (this.mode === "terrain") {
      const hf = this.side.hf;
      const r = this.side.app.scene!.assets.residency;
      this.report.terrain = { side: (hf.nx - 1) * hf.cell, groundBytes: groundSize(hf).bytes, reservedBytes: r.reserved, minutesWanted: (this.timing.flightMs * FLIGHT_TIERS.length) / 60000, flights: [], far: [], wood: [] };
      this.stage = "terrain";
      return this.takeOff(0);
    }
    if (this.mode === "soak") {
      // On the terrain map the soak turns through its wood among the far bases, with nothing else added.
      const tier = this.soakTier();
      const wood = this.side.terrainMap;
      const load = wood ? { stress: false, bodies: 0, pieces: 0, near: 0, far: 0 } : this.soakFrom.load;
      const from = wood ? `the terrain map's wood and ${FAR_CHUNKS.at(-1)} far base chunks round its middle, nothing else` : this.soakFrom.from;
      this.report.soak = { tier: tier.name, load, from, wood, cascades: tier.lit ? tier.shadows.cascades : 0, minutesWanted: this.timing.soakMs / 60000, minutes: [], hidden: 0, hiddenMs: 0 };
      this.stage = "soak";
      this.report.stage = "soak";
      this.apply({ ...load, tier, yaw: 0 });
      if (wood) {
        this.middle(EYE_UP, 0);
        this.placeFar(FAR_CHUNKS.at(-1)!);
      }
      this.at = -1;
      return;
    }
    this.stage = "steps";
    this.next(null);
  }

  private measure(now: number, gap: number, p: FramePacket, buildMs: number, drawMs: number, drawCalls: number): boolean {
    // The GPU's time for each frame, where there are timer queries; none is open while the GPU questions are asked.
    const frames = this.side.frames;
    frames?.tick(!this.shadowless);
    if (this.at < 0) this.at = now;
    const step = this.step!;
    const measureMs = step.kind === "rung" ? this.timing.rungMs : this.timing.measureMs;
    if (!this.measuring) {
      if (this.still < STILL && now - this.at < this.timing.settleMs) return false;
      this.measuring = true;
      this.settleMs = tenth(now - this.at);
      this.settled = this.still >= STILL;
      this.at = now;
      for (const list of Object.values(this.samples)) list.length = 0;
      this.dropped = this.skipped = 0;
      frames?.take();
      return false;
    }
    this.sample(gap, buildMs, drawMs, drawCalls, p);
    for (const t of frames?.take() ?? []) (t.tag ? this.samples.gpu : this.samples.gpuOff).push(t.ms);
    if (now - this.at < measureMs) return false;
    const phase = this.result();
    if (step.kind === "again") {
      this.report.again = phase;
      this.next(null);
    } else if (step.kind === "phase") {
      this.report.phases.push(phase);
      this.next(phase);
    } else {
      const { held, limit, invalid } = judgeRung(phase, this.side.display);
      this.report.ladder!.rungs.push({ tier: phase.tier, axis: step.axis!, n: step.n!, held, limit, invalid, canvas: phase.canvas, settled: phase.settled, frameMs: phase.frameMs, buildMs: phase.buildMs.median, drawMs: phase.drawMs.median, calls: phase.drawCalls, tris: phase.triangles, bones: phase.bones, mat: phase.textured, fetched: phase.fetched, missed: phase.missed });
      this.nextRung(held, phase.lost > 0);
    }
    return true;
  }

  private sample(gap: number, buildMs: number, drawMs: number, drawCalls: number, p: FramePacket): void {
    const s = this.samples;
    s.frame.push(gap);
    s.build.push(buildMs);
    s.draw.push(drawMs);
    s.calls.push(drawCalls);
    s.tris.push(p.triangles);
    s.bones.push(p.boneCount);
    s.textured.push(texturedDraws(p));
    this.dropped += p.dropped;
    this.skipped += p.skipped;
    if (s.frame.length % 30 === 0) this.rtt.push(tenth((this.side.app.session.stats.rttTicks * 1000) / TICK_RATE));
  }

  private result(): PhaseReport {
    const load = this.step!.load;
    const s = this.samples;
    const app = this.side.app;
    return {
      tier: load.tier.name, scene: this.step!.scene ?? "plain", ratio: this.ratio(), canvas: this.canvas, settleMs: this.settleMs, settled: this.settled, frames: s.frame.length,
      frameMs: spread(s.frame), buildMs: spread(s.build), drawMs: spread(s.draw), gpuMs: s.gpu.length > 0 ? spread(s.gpu).median : null, gpuOff: s.gpuOff.length > 0 ? spread(s.gpuOff).median : null,
      drawCalls: spread(s.calls).median, triangles: spread(s.tris).median, textured: spread(s.textured).median, bones: spread(s.bones).median,
      dropped: this.dropped, skipped: this.skipped, fetched: app.scene!.assets.residency.stats.fetched - this.fetchedAt, failed: this.failures() - this.failedAt, missed: this.missedSince(this.stepBase),
      lost: this.lostCount - this.lostAt, fellTo: app.ui.settings.tier === load.tier.name ? null : app.ui.settings.tier,
    };
  }

  /** The quick look's next phase the device can run, then the first once more, then the end. */
  private next(last: PhaseReport | null): void {
    if (this.mode === "ladder") return this.nextRung(true, false);
    if (last) {
      const at = TIERS.findIndex((t) => t.name === last.tier);
      const why = last.lost > 0 ? "the graphics context was lost" : last.fellTo ? `the game fell to ${last.fellTo} for want of memory` : last.frameMs.median > TOO_SLOW ? `a frame took ${last.frameMs.median} ms` : "";
      if (why && at < this.stopAbove) [this.stopAbove, this.stopWhy] = [at, `${why} on ${last.tier}, ${last.scene}`];
    }
    if (this.step?.kind === "again") return this.end();
    for (this.index++; this.index < this.plan.length; this.index++) {
      const { tier } = this.plan[this.index]!;
      const why = tier.texture > this.side.maxTexture ? `its textures are up to ${tier.texture} wide, and this device takes ${this.side.maxTexture}` : TIERS.indexOf(tier) > this.stopAbove ? this.stopWhy : "";
      if (!why) break;
      if (!this.report.skipped.some((line) => line.startsWith(`${tier.name}:`))) this.report.skipped.push(`${tier.name}: ${why}`);
    }
    const again = this.index >= this.plan.length;
    const { tier, scene } = this.plan[again ? 0 : this.index]!;
    const load = bare(tier, scene.startsWith("crowd") ? LOOK.crowd : 0);
    load.stress = scene === "stress";
    load.oneRange = scene === "crowd1";
    load.noShadows = scene === "crowd0";
    // Where the GPU's frames are timed, the crowd's shadows go on and off by turns, so its time each way is set side by side.
    load.byTurns = load.noShadows && this.side.frames?.on === true;
    this.go({ kind: again ? "again" : "phase", load, scene }, `${again ? "again " : ""}${tier.name} ${scene}`);
  }

  private nextRung(held: boolean, lost: boolean): void {
    const rung = this.ladder.next(held, lost);
    if (!rung) {
      this.apply(bare(tierOf(DEFAULT_TIER), 0));
      this.side.frames?.stop();
      this.stage = this.side.memory ? "memory" : "done";
      if (this.side.memory) this.report.ladder!.memory = { variant: this.report.gpu?.variant ?? "rgba", gameMB: 0, heldMB: 0, failedMB: null, slowMB: null, how: "", rungs: [] };
      return this.stage === "done" ? this.end() : void (this.report.stage = `memory ${MEMORY_MB[0]} MB`);
    }
    this.go({ kind: "rung", load: rungLoad(rung.tier, rung.axis, rung.n), axis: rung.axis, n: rung.n }, `${rung.tier.name} ${rung.axis} ${rung.n}`);
  }

  private go(step: Step, name: string): void {
    this.step = step;
    this.report.stage = name;
    this.show();
  }

  /**
   * Whether the scene draws in one depth range on a tier of two, with no shadows on a tier that casts, and with no far
   * trees, rocks or bushes. The game sets the tier on its scene each frame, so the scene's build is wrapped once to put
   * a copy with no split, no cascades or no reach for them in its place. A copy a tier and change, since the renderer
   * keeps its programs by the tier.
   */
  private variant(load: Load): void {
    const scene = this.side.app.scene!;
    this.drawn = load;
    if (this.wrapped === scene) return;
    this.wrapped = scene;
    const build = scene.build.bind(scene);
    const copies = new Map<Tier, Map<number, Tier>>();
    scene.build = (cam, remote) => {
      const t = scene.assets.tier;
      const l = this.drawn;
      this.shadowless = l?.noShadows === true && t.shadows.cascades > 0 && (!l.byTurns || !this.shadowless);
      const change = (l?.oneRange && t.split > 0 ? 1 : 0) | (this.shadowless ? 2 : 0) | (l?.noWood ? 4 : 0);
      if (change !== 0) {
        const mine = copies.get(t) ?? copies.set(t, new Map()).get(t)!;
        const copy = mine.get(change) ?? { ...t, ...(change & 1 ? { split: 0 } : {}), ...(change & 2 ? { shadows: { ...t.shadows, cascades: 0 } } : {}), ...(change & 4 ? { reach: { ...t.reach, trees: 0, rocks: 0, bushes: 0 } } : {}) };
        scene.assets.tier = mine.set(change, copy).get(change)!;
      }
      // The flight moves the camera as it builds; the body stays where the server has it.
      if (this.fly) [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [this.fly.x, this.fly.y, this.fly.z, this.fly.yaw, this.fly.pitch];
      return build(cam, remote);
    };
  }

  /**
   * The terrain flight on its `k`th tier: the camera FLIGHT_UP over the ground, FLIGHT_SPEED a second, turning, and
   * every teleportMs at a spot JUMP or more away (a third of the map's side on a smaller map). Once the tier has
   * settled, flightMs of frames are measured.
   */
  private takeOff(k: number): void {
    const name = FLIGHT_TIERS[k];
    if (name === undefined) return this.terrainRung(0);
    this.apply({ ...bare(tierOf(name), 0), noWood: true });
    this.flight = { tier: k, ms: 0, heading: 0, jumps: 0, wait: null, fills: [], coarser: [], rows: [], gpu: [] };
    this.place(this.spot(0));
    [this.measuring, this.at] = [false, -1];
    this.report.stage = `terrain ${name}`;
  }

  /** The jump `n`'s spot: points spread by the golden ratio over the map less 300 m round, the first far enough from the last. */
  private spot(n: number): { x: number; z: number } {
    const side = this.report.terrain!.side;
    const from = this.fly ?? { x: side / 2, z: side / 2 };
    const [least, edge] = [Math.min(JUMP, side / 3), Math.min(300, side / 4)];
    for (let i = n * 7; ; i++) {
      const x = edge + ((i * 0.618034 + 0.3) % 1) * (side - 2 * edge);
      const z = edge + ((i * 0.754878 + 0.6) % 1) * (side - 2 * edge);
      if (Math.hypot(x - from.x, z - from.z) >= least || i > n * 7 + 500) return { x, z };
    }
  }

  private place(at: { x: number; z: number }): void {
    const f = this.flight!;
    const hf = this.side.hf;
    const side = this.report.terrain!.side;
    const [x, z] = [Math.min(Math.max(at.x, 0), side), Math.min(Math.max(at.z, 0), side)];
    this.fly = { x, y: Math.max(hf.heightAt(x, z), hf.seaLevel) + FLIGHT_UP, z, yaw: f.heading, pitch: -0.3 };
  }

  private terrain(now: number, gap: number, p: FramePacket, drawMs: number): boolean {
    const f = this.flight!;
    const g = p.groundWindow;
    const rows = g[3]! >= 0;
    this.side.frames?.tick(rows);
    if (this.at < 0) this.at = now;
    if (!this.measuring) {
      if (this.still < STILL && now - this.at < this.timing.settleMs) return false;
      this.measuring = true;
      for (const list of Object.values(this.samples)) list.length = 0;
      this.side.frames?.take();
      return false;
    }
    if (gap <= 0) return false;
    if (this.away) {
      if (this.hiddenAt < 0) this.away = false;
      return false;
    }
    const s = this.samples;
    s.frame.push(gap);
    s.draw.push(drawMs);
    f.rows.push(rows);
    f.gpu.push(...(this.side.frames?.take() ?? []));
    // The jump's new window is in once the window drawn lies near where one round the camera, as it was for this frame,
    // would: held inside the map, so a spot near its edge counts too.
    const hf = this.side.hf;
    const w = groundSize(hf).width[SOURCE_WINDOW]!;
    const near = (at: number, corner: number, n: number): boolean => Math.abs(corner - Math.min(Math.max(at / hf.cell - (w - 1) / 2, 0), n - w)) < w / 4;
    if (f.wait) {
      f.wait.frames++;
      f.wait.coarser += this.side.app.scene!.terrain.coarser;
      if (g[0]! >= 0 && near(this.fly!.x, g[1]!, hf.nx) && near(this.fly!.z, g[2]!, hf.nz)) {
        f.fills.push(f.wait.frames);
        f.coarser.push(f.wait.coarser / f.wait.frames);
        f.wait = null;
      }
    }
    f.ms += gap;
    f.heading = (f.heading + (FLIGHT_TURN * gap) / 1000) % (2 * Math.PI);
    const jump = Math.floor(f.ms / this.timing.teleportMs) > f.jumps && f.ms < this.timing.flightMs;
    if (jump) {
      f.jumps++;
      if (f.wait) f.fills.push(-1);
      f.wait = { frames: 0, coarser: 0 };
      this.place(this.spot(f.jumps));
    } else this.place({ x: this.fly!.x + Math.sin(f.heading) * FLIGHT_SPEED * (gap / 1000), z: this.fly!.z + Math.cos(f.heading) * FLIGHT_SPEED * (gap / 1000) });
    if (f.ms < this.timing.flightMs) return false;
    if (f.wait) f.fills.push(-1);
    const pick = (list: number[], with_: boolean): number[] => list.filter((_, i) => f.rows[i] === with_);
    const gpu = (tag: boolean): number | null => (this.side.frames?.on ? spread(f.gpu.filter((x) => x.tag === tag).map((x) => x.ms)).median : null);
    const windowed = pick(s.frame, true);
    this.report.terrain!.flights.push({
      tier: FLIGHT_TIERS[f.tier]!, frames: s.frame.length, frameMs: spread(s.frame),
      windowFrames: windowed.length, windowWorst: spread(windowed).worst, plainMedian: spread(pick(s.frame, false)).median,
      drawWindow: spread(pick(s.draw, true)).median, drawPlain: spread(pick(s.draw, false)).median, gpuWindow: gpu(true), gpuPlain: gpu(false),
      fills: f.fills, coarser: tenth(f.coarser.reduce((a, b) => a + b, 0) / Math.max(1, f.coarser.length)),
    });
    this.takeOff(f.tier + 1);
    return true;
  }

  /**
   * The terrain map's `k`th rung after its flights, each round the map's middle: at medium, FAR_CHUNKS of far bases
   * with the wood not drawn past the near field, 30 m up; then on each tier the device takes, the wood out to the
   * tier's reach, at eye height. After the last the bases are taken away and the test ends.
   */
  private terrainRung(k: number): void {
    const steps = [...FAR_CHUNKS.map((n) => ({ wood: false, tier: tierOf("medium"), n })), ...takes(this.side.maxTexture).map((tier) => ({ wood: true, tier, n: 0 }))];
    const step = steps[k];
    if (!step) {
      this.rungs = null;
      return this.end();
    }
    this.rungs = { k, wood: step.wood, draws: [], gpu: [] };
    const load = { ...bare(step.tier, 0), noWood: !step.wood };
    this.step = { kind: "rung", load };
    this.apply(load);
    this.middle(step.wood ? EYE_UP : FAR_UP, step.wood ? 0 : -0.02);
    this.placeFar(step.n);
    [this.measuring, this.at] = [false, -1];
    this.report.stage = `terrain ${step.wood ? `wood ${step.tier.name}` : `far ${step.n}`}`;
  }

  /** The camera over the map's middle, where the body stands, `up` metres over the ground. */
  private middle(up: number, pitch: number): void {
    const hf = this.side.hf;
    const mid = ((hf.nx - 1) * hf.cell) / 2;
    this.fly = { x: mid, y: Math.max(hf.heightAt(mid, mid), hf.seaLevel) + up, z: mid, yaw: 0, pitch };
  }

  /**
   * Bases in the first `n` of the far bases' chunks, and none in the rest of those that had some: the castle, the pile
   * and the huts by turns, handed to the session's far store as the far feed hands them, within FAR_REACH of the map's
   * middle; not where the near store holds a chunk whole, which is drawn as its pieces, nor where the feed sent cells.
   */
  private placeFar(n: number): void {
    const s = this.side.app.session;
    const world = s.world;
    if (!world || (n === 0 && !this.bases)) return;
    const mid = ((this.side.hf.nx - 1) * this.side.hf.cell) / 2;
    const b = (this.bases ??= { spots: farSpots(world.dims, mid, mid, FAR_REACH, (chunk) => world.far.complete(chunk) || s.far.chunks.has(chunk)), cells: farBases(this.side.reg), placed: 0 });
    const want = Math.min(n, b.spots.length);
    const none = new FarCells();
    const w = new BitWriter(1024);
    const r = new BitReader();
    for (let i = Math.min(want, b.placed); i < Math.max(want, b.placed); i++) {
      w.reset();
      writeFar(w, b.spots[i]!, i < want ? b.cells[i % b.cells.length]! : none);
      r.reset(w.bytes());
      s.far.read(r, world.dims);
    }
    b.placed = want;
  }

  /** A frame of a terrain rung: the camera turning; settled, then measured for rungMs and judged as a ladder's rung. */
  private rungFrame(now: number, gap: number, p: FramePacket, buildMs: number, drawMs: number, drawCalls: number): boolean {
    const g = this.rungs!;
    const frames = this.side.frames;
    frames?.tick(true);
    if (this.at < 0) this.at = now;
    this.fly!.yaw = (this.fly!.yaw + (2 * Math.PI * gap) / FAR_TURN_MS) % (2 * Math.PI);
    if (!this.measuring) {
      if (this.still < STILL && now - this.at < this.timing.settleMs) return false;
      this.measuring = true;
      this.settleMs = tenth(now - this.at);
      this.settled = this.still >= STILL;
      this.at = now;
      for (const list of [...Object.values(this.samples), g.draws, g.gpu]) list.length = 0;
      this.dropped = this.skipped = 0;
      frames?.take();
      return false;
    }
    this.sample(gap, buildMs, drawMs, drawCalls, p);
    // The far bases' draws, or the far trees', rocks' and bushes'.
    let draws = 0;
    for (let d = 0; d < p.drawCount; d++) if (g.wood ? p.drawBuffer[d]! >= FAR_NODE_BUFFERS && p.drawBuffer[d]! < FAR_NODE_BUFFERS * 2 : p.drawFade[d]! > 0) draws++;
    g.draws.push(draws);
    g.gpu.push(...(frames?.take() ?? []).map((t) => t.ms));
    if (now - this.at < this.timing.rungMs) return false;
    const phase = this.result();
    const { held, limit, invalid } = judgeRung(phase, this.side.display);
    const frame = { held, limit, invalid, settled: phase.settled, frameMs: phase.frameMs, buildMs: phase.buildMs.median, drawMs: phase.drawMs.median, calls: phase.drawCalls, tris: phase.triangles, gpuMs: frames?.on ? spread(g.gpu).median : null };
    const tier = this.step!.load.tier;
    if (g.wood) this.report.terrain!.wood.push({ tier: tier.name, reach: tier.reach.trees, ...frame, nodeDraws: spread(g.draws).median });
    else this.report.terrain!.far.push({ asked: FAR_CHUNKS[g.k]!, chunks: this.bases?.placed ?? 0, ...frame, farDraws: spread(g.draws).median });
    this.terrainRung(g.k + 1);
    return true;
  }
  /** Begins the step under way afresh. */
  private show(): void {
    this.measuring = false;
    this.at = -1;
    if (this.step) this.apply(this.step.load);
  }

  private apply(load: Load): void {
    const { app, hf, bodies } = this.side;
    app.ui.settings.tier = load.tier.name;
    app.controls.yaw = load.yaw;
    app.controls.pitch = 0;
    const assets = app.scene!.assets;
    app.scene!.things = [...(load.stress ? this.stressed() : []), ...(load.near + load.far > 0 ? rocks(assets.table, hf, load.near, load.far) : [])];
    bodies.n = load.bodies;
    this.variant(load);
    if (load.pieces !== this.pieces) {
      this.asking = true;
      this.pieces = load.pieces;
      void this.side.base(load.pieces).then((n) => {
        this.asking = false;
        if (n === null) this.report.errors.length < 10 && this.report.errors.push(`${this.report.stage}: the server would not build the base`);
      });
    }
    this.fetchedAt = assets.residency.stats.fetched;
    this.failedAt = this.failures();
    this.stepBase = { snapshots: app.session.stats.snapshots, latest: app.session.latestSnapshot };
    this.lostAt = this.lostCount;
    this.still = 0;
  }

  /** The texture memory step: a megabyte at a time toward each amount, which is then watched with frames coming. */
  private memory(now: number, gap: number): boolean {
    const mem = this.side.memory!;
    const report = this.report.ladder!.memory!;
    const want = MEMORY_MB[this.memoryRung];
    const finish = (how: string, failed: number | null): boolean => {
      [report.how, report.failedMB, report.gameMB] = [how, failed, Math.round(this.side.app.scene!.assets.residency.texLedger / 1048576)];
      mem.free();
      this.end();
      return true;
    };
    if (want === undefined) return finish(`held all ${report.heldMB} MB`, null);
    const state = mem.grow(want, MEMORY_STEP);
    if (state === "out of memory" || state === "context lost" || this.lostCount > this.lostAt) return finish(state === "growing" || state === "held" ? "context lost" : state, want);
    if (state === "growing") return false;
    const t = this.side.now();
    mem.touch();
    const ours = this.side.now() - t;
    if (mem.read !== "" && mem.read !== "right") return finish(`the textures ${mem.read}`, want);
    if (this.heldSince < 0) {
      [this.heldSince, this.sweepsAt] = [now, mem.sweeps];
      this.samples.frame.length = this.samples.build.length = 0;
      return false;
    }
    this.samples.frame.push(gap);
    this.samples.build.push(ours);
    // Held for its time, and every tile sampled in it: two sweeps ended means one ran wholly inside.
    const sampled = mem.sweeps - this.sweepsAt >= 2;
    if (!sampled && now - this.heldSince > this.timing.settleMs) return finish(`did not finish: every texture was not sampled within ${this.timing.settleMs / 1000} s`, want);
    if (now - this.heldSince < this.timing.holdMs || !sampled) return false;
    const frames = spread(this.samples.frame);
    const held = frames.median <= this.side.display * HOLD_MEDIAN && frames.p95 <= this.side.display * HOLD_P95;
    report.heldMB = want;
    report.rungs.push({ mb: want, frameMs: frames.median, p95: frames.p95, worst: frames.worst, oursMs: spread(this.samples.build).median, held });
    if (!held) report.slowMB ??= want;
    this.heldSince = -1;
    this.memoryRung++;
    // Said before it is tried, so a page the browser has to reload says which amount it was trying.
    this.report.stage = `memory ${MEMORY_MB[this.memoryRung] ?? want} MB`;
    return true;
  }

  /** The soak: the camera turns once a minute through every scene at once, and each minute is measured by itself. */
  private soak(now: number, gap: number, p: FramePacket, buildMs: number, drawMs: number): boolean {
    const report = this.report.soak!;
    if (this.at < 0) this.at = now;
    if (!this.measuring) {
      if (this.still < STILL && now - this.at < this.timing.settleMs * 2) return false;
      this.measuring = true;
      for (const list of Object.values(this.samples)) list.length = 0;
      this.stepBase = { snapshots: this.side.app.session.stats.snapshots, latest: this.side.app.session.latestSnapshot };
      return false;
    }
    if (gap <= 0) return false;
    // The page's own events say when it was hidden: any frame then, and the first after, is left out. A long frame
    // while it was shown is a stall, and counts.
    if (this.away) {
      if (this.hiddenAt < 0) this.away = false;
      return false;
    }
    this.soakMs += gap;
    this.side.app.controls.yaw = ((this.soakMs / 60000) * 2 * Math.PI) % (2 * Math.PI);
    if (this.fly) this.fly.yaw = this.side.app.controls.yaw;
    const s = this.samples;
    s.frame.push(gap);
    s.build.push(buildMs);
    s.draw.push(drawMs);
    s.textured.push(texturedDraws(p));
    const minute = report.minutes.length;
    if (this.soakMs < (minute + 1) * 60000 && this.soakMs < this.timing.soakMs) return false;
    const long = s.frame.filter((g) => g >= this.side.display * LONG).length;
    report.minutes.push({ minute: minute + 1, frames: s.frame.length, frameMs: spread(s.frame), long, buildMs: spread(s.build).median, drawMs: spread(s.draw).median, missed: this.missedSince(this.stepBase), mat: Math.max(0, ...s.textured) });
    for (const list of Object.values(s)) list.length = 0;
    this.stepBase = { snapshots: this.side.app.session.stats.snapshots, latest: this.side.app.session.latestSnapshot };
    if (this.soakMs >= this.timing.soakMs) this.end();
    else this.report.stage = `soak minute ${minute + 2}`;
    return true;
  }

  /** The soak's tier: high, or the finest under it the device can take. */
  private soakTier(): Tier {
    const can = takes(this.side.maxTexture);
    return can.find((t) => t.name === "high") ?? can.at(-1) ?? tierOf(DEFAULT_TIER);
  }

  /** Device pixels the page draws for one CSS pixel, as client/shell/main.ts works it out from the tier in use. */
  private ratio(): number {
    const most = this.side.app.scene!.assets.tier.pixelRatio;
    return most > 0 ? Math.min(this.side.dpr, most) : this.side.dpr;
  }

  /** The stress scene, less the three meshes it lists wrongly on purpose: they are for the probe, and never settle. */
  private stressed(): Thing[] {
    if (this.stress) return this.stress;
    const { app, hf } = this.side;
    const assets = app.scene!.assets;
    const wrong = new Set(["stress:bad_hash", "stress:bad_range", "stress:bad_short"].map((id) => assets.table.find(id)));
    const made = stressThings(assets, hf, PROVING_SPAWN, hf.heightAt(PROVING_SPAWN.x, PROVING_SPAWN.z) + 1.62);
    return (this.stress = made.things.filter((t) => !wrong.has(t.mesh)));
  }

  /** Asset requests that failed, to be asked again or given up. */
  private failures(): number {
    const stats = this.side.app.scene!.assets.residency.stats;
    return stats.failed + stats.dead;
  }

  /** Snapshots the server ticked through since `from` that this page did not get. */
  private missedSince(from: { snapshots: number; latest: number }): number {
    const s = this.side.app.session;
    return from.latest === 0 ? 0 : Math.max(0, s.latestSnapshot - from.latest - (s.stats.snapshots - from.snapshots));
  }

  /**
   * Snapshots as they arrive, and the longest wait for one while a step is measured, to the frame. The count starts at the
   * first snapshot: a page can draw its first frame before one has come, and counting from tick 0 would count every tick
   * the server ran before the page joined.
   */
  private listen(now: number): void {
    const s = this.side.app.session;
    if (s.latestSnapshot === this.snapTick) return;
    this.base ??= { snapshots: s.stats.snapshots, latest: s.latestSnapshot };
    if (this.stepBase.latest === 0) this.stepBase = { snapshots: s.stats.snapshots, latest: s.latestSnapshot };
    if (this.hiddenBase) {
      this.report.link.missedHidden += this.missedSince(this.hiddenBase);
      this.hiddenBase = null;
    }
    if (this.measuring && this.snapAt > 0) this.longestGap = Math.max(this.longestGap, now - this.snapAt);
    this.snapTick = s.latestSnapshot;
    this.snapAt = now;
  }

  private sync(): void {
    const s = this.side.app.session;
    const link = this.report.link;
    if (this.base) {
      link.snapshots = s.stats.snapshots - this.base.snapshots;
      link.missed = this.missedSince(this.base);
    }
    link.gameMs = this.rtt.length > 0 ? spread(this.rtt) : null;
    link.longestGapMs = tenth(this.longestGap);
    link.bytesIn = s.stats.bytesIn;
    link.clockJumps = s.stats.clockJumps;
    link.corrections = s.stats.corrections;
    link.undecodable = s.stats.undecodable;
  }

  private end(): void {
    this.side.frames?.stop();
    this.placeFar(0);
    this.fly = null;
    this.apply(bare(tierOf(DEFAULT_TIER), 0));
    this.sync();
    this.stage = "done";
    this.report.stage = "done";
    this.report.done = true;
  }
}

/** What the probe needs of a browser: client/shell/device.ts hands it the page's. Anything here may throw or fail, and the probe goes on. */
export interface DeviceBrowser {
  /** The page's global object, for what the browser has. */
  global: Record<string, unknown>;
  /** A fresh run's name: sixteen hex digits. */
  id: string;
  dpr: number;
  /** A parameter of the page's address: `mode` starts a test without a tap, and `minutes` sets the soak's length. */
  query(name: string): string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Calls `fn` with the time of the next frame. */
  nextFrame(fn: (t: number) => void): void;
  /** A request to the probe's own routes on its server, with the token: a POST of `body` if given. */
  fetch(path: string, body?: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** Session storage. */
  load(): string | null;
  save(text: string): void;
  /** HTML in the box over the page, laid out by `style`. A button in it with a data-mode starts that test. */
  show(html: string, style: string): void;
  /** Asks to keep the screen on, and lets it go. */
  wake(): Promise<string>;
  rest(): void;
  /** The page's own fetches so far, as its performance timeline lists them. */
  entries(): { transferSize?: number; encodedBodySize?: number }[];
}

/** What the probe reads of the shell's renderer. A WebGL 2 context is a GlLike with these besides. */
export interface RendererLike {
  gl: GlLike & Gl2 & { canvas: unknown; drawingBufferWidth: number; drawingBufferHeight: number };
  rendererName: string;
  /** The texture variant it took. */
  format?: string;
  drawCalls: number;
  readPixel(sx: number, sy: number): [number, number, number];
}

/** A line of progress over the bottom of the game, and the whole page before and after. */
const BAR = "position:fixed;left:0;right:0;bottom:0;margin:0;padding:6px 8px;background:rgba(0,0,0,.55);color:#eee;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:10;pointer-events:none";
const PAGE = "position:fixed;inset:0;margin:0;padding:16px;background:#111;color:#eee;font:15px -apple-system,system-ui,sans-serif;white-space:normal;overflow:auto;z-index:10";

/**
 * A page's device probe from start to end. Before the game loads it reads the browser, the display and the link, and
 * shows which device it takes itself to be on and the tests to tap; the tap also asks to keep the screen on. The game
 * loads only once a test is chosen, so a page opened on the wrong device starts nothing. When a test is done, another
 * may be tapped on the same page. The report is posted after every step and kept in session storage, so a page the
 * browser reloads after a crash reports what it had, and does not run again until a test is tapped.
 */
export class DeviceProbe {
  report: DeviceReport;
  private readonly token: string;
  private readonly b: DeviceBrowser;
  private readonly timing: Timing;
  private readonly recovered: boolean;
  /** The tests this page's server offers, which its link names in `tests`: the terrain flight on its own map, or the rest. */
  private readonly offered: readonly Mode[];
  private run: DeviceRun | null = null;
  private side: DeviceSide | null = null;
  private renderer: RendererLike | null = null;
  private expected: Record<string, string> | null = null;
  /** The mode tapped, and what takes it to the game once the page has read the browser. */
  private mode: Mode | null = null;
  private choose: (mode: Mode) => void = () => {};
  private readonly chosen = new Promise<Mode>((r) => (this.choose = r));
  /** When the game began to load, or -1 before. */
  private bootAt = -1;
  private progressAt = 0;
  /** Off while the graphics context is lost and made again, whose textures are not the materials'. */
  private counting = true;
  private finished = false;
  private runs = 0;
  /** The last ladder's rungs on this page, for a soak after it. */
  private held: RungReport[] | null = null;
  /** The server's counts of what it held back, when this run's first post was answered. */
  private serverFrom: { skipped: number; overflows: number } | null = null;
  private sending: Promise<unknown> = Promise.resolve();

  constructor(token: string, browser: DeviceBrowser, timing: Timing = TIMING) {
    this.token = token;
    this.b = browser;
    const minutes = Number(browser.query("minutes"));
    this.timing = minutes >= 1 && minutes <= 60 ? { ...timing, soakMs: minutes * 60000 } : timing;
    type Saved = { token?: unknown; report?: DeviceReport } | null;
    let saved: Saved = null;
    try {
      saved = JSON.parse(browser.load() ?? "null") as Saved;
    } catch {}
    this.recovered = saved !== null && saved.token === token && saved.report?.done === false;
    const named = (browser.query("tests") ?? "").split(",");
    this.offered = MODES.filter((m) => (named[0] === "" ? m !== "terrain" : named.includes(m)));
    this.report = this.recovered ? saved!.report! : newReport(browser.id);
    if (this.recovered) this.report.reloadedDuring = this.report.stage;
  }

  /**
   * Before the game loads: what the browser has, a quiet measure of the display and the link, and the test to run. A page
   * that found its run unfinished shows what it had first. Resolves true once a test is chosen.
   */
  async before(): Promise<boolean> {
    if (this.recovered) this.finish();
    else this.b.show(startPage(this.report, this.b.global, this.offered), PAGE);
    void this.wake();
    const within: Within = (f, ms, or) => this.within(f, ms, or);
    const pings: number[] = [];
    const [features, expected, frames] = await Promise.all([
      featuresOf(this.b.global, within),
      within(() => this.ask("hashes"), 5000, null),
      within(() => this.frames(31), 3000, null),
      (async () => {
        for (let i = 0; i < 8; i++) {
          const t = this.b.now();
          if ((await within(() => this.ask("ping"), 5000, null)) !== true) break;
          pings.push(this.b.now() - t);
        }
      })(),
    ]);
    this.expected = expected !== null && typeof expected === "object" ? (expected as Record<string, string>) : null;
    const device = deviceOf(this.b.global, features);
    const idle = frames ? spread(frames.slice(1).map((t, i) => t - frames[i]!)).median : null;
    const http = pings.length > 0 ? spread(pings) : null;
    const auto = this.offered.find((m) => m === this.b.query("mode"));
    if (auto) this.start(auto);
    const mode = await this.chosen;
    if (this.recovered) this.report = newReport(this.nextId(), mode);
    this.report.mode = mode;
    this.finished = false;
    [this.report.device, this.report.idleFrameMs, this.report.link.httpMs] = [device, idle, http];
    this.report.stage = "loading";
    this.bootAt = this.b.now();
    this.post();
    return true;
  }

  /** A test was tapped, or named in the address. On a page done with one test, the next begins with the game as it is. */
  start(name: string): void {
    const mode = this.offered.find((m) => m === name);
    if (!mode) return;
    if (this.mode === null) {
      [this.mode, this.finished] = [mode, false];
      void this.wake();
      this.b.show(progressText(mode, "starting", ""), BAR);
      return this.choose(mode);
    }
    if (!this.finished || !this.side) return;
    const before = this.report;
    this.report = { ...newReport(this.nextId(), mode), device: before.device, gpu: before.gpu, idleFrameMs: before.idleFrameMs, wakeLock: before.wakeLock, texturesMade: before.texturesMade };
    this.report.link.httpMs = before.link.httpMs;
    [this.finished, this.serverFrom, this.mode] = [false, null, mode];
    void this.wake();
    this.run = new DeviceRun(this.report, this.side, mode, this.timing, true, this.held);
    this.b.show(progressText(mode, this.report.stage, ""), BAR);
    this.post();
  }

  /**
   * Once the renderer is made, and after the shell's own listeners for a lost context. The run begins with the first
   * frame. The renderer makes a material's texture as its pictures arrive, and so every texture it makes from here on
   * counts, except those init() makes again for a restored context, which it does before this hears of it.
   */
  attach(side: { app: App; pack: Pack; reg: Registry; hf: Heightfield }, renderer: RendererLike): void {
    const gl = renderer.gl;
    const gpu = (this.report.gpu = gpuOf(gl, renderer.rendererName, renderer.format));
    const create = gl.createTexture.bind(gl);
    gl.createTexture = () => ((this.report.texturesMade += this.counting ? 1 : 0), create());
    const canvas = gl.canvas as { addEventListener(type: string, fn: () => void): void };
    canvas.addEventListener("webglcontextlost", () => this.lost());
    canvas.addEventListener("webglcontextrestored", () => (this.counting = true));
    this.renderer = renderer;
    const b = this.b;
    this.side = {
      ...side,
      dpr: b.dpr,
      maxTexture: gpu.maxTexture,
      bootAt: this.bootAt,
      now: () => b.now(),
      pageBytes: () => b.entries().reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0),
      expected: this.expected,
      bodies: new BodyCopies(side.app.session, side.hf),
      base: (n) => this.within(() => b.fetch(`base/${n}`, "").then((res) => (res.ok ? (res.json() as Promise<{ pieces: number }>) : null)).then((r) => r?.pieces ?? null), 20000, null),
      memory: new TextureMemory(gl, create, gpu.variant),
      questions: () => new GpuQuestions(gl, create, () => b.now(), gpu.variant, [gl.drawingBufferWidth, gl.drawingBufferHeight]),
      frames: new FrameTimer(gl),
      display: this.report.idleFrameMs ?? 16.7,
      terrainMap: this.offered.includes("terrain"),
    };
    this.run = new DeviceRun(this.report, this.side, this.mode ?? "quick", this.timing);
  }

  /** After each frame is handed to WebGL. The frame began at `t0` and was built by `built`, on the clock of `now()`. */
  frame(now: number, p: FramePacket, t0: number, built: number): void {
    const run = this.run;
    const r = this.renderer!;
    if (!run || this.finished) return;
    if (run.frame(now, p, built - t0, this.b.now() - built, r.drawCalls, [r.gl.drawingBufferWidth, r.gl.drawingBufferHeight], (x, y) => r.readPixel(x, y))) this.post();
    if (this.report.done) this.finish();
    else if (now - this.progressAt > 500) {
      this.progressAt = now;
      this.b.show(run.progress(now), BAR);
    }
  }

  visible(shown: boolean): void {
    if (!shown) return this.run?.hidden();
    this.run?.shown(this.b.now());
    void this.wake();
  }

  /** A touch. A browser that wants one before it keeps the screen on is asked again. */
  touched(): void {
    if (this.report.wakeLock !== "held") void this.wake();
  }

  /** About once a second while the page is shown. */
  watch(): void {
    if (this.finished || this.bootAt < 0) return;
    const now = this.b.now();
    if (this.run) {
      if (this.run.watch(now)) this.finish();
    } else if (now - this.bootAt > this.timing.loadMs) this.fail("the game did not start");
  }

  error(message: string): void {
    if (this.report.errors.length < 10) this.report.errors.push(`${this.report.stage}: ${message.slice(0, 300)}`);
  }

  /** The game could not start or go on. */
  fail(message: string): void {
    this.error(message);
    this.finish();
  }

  private lost(): void {
    this.counting = false;
    this.run?.lost();
  }

  /** A run's name after the page's first: its first fourteen digits and a count. */
  private nextId(): string {
    return this.b.id.slice(0, 14) + (++this.runs).toString(16).padStart(2, "0");
  }

  /** JSON from the probe's server, or null. */
  private ask(path: string): Promise<unknown> {
    return this.b.fetch(path).then((res) => (res.ok ? res.json() : null));
  }

  /** The times of the next `n` frames. */
  private frames(n: number): Promise<number[]> {
    return new Promise((done) => {
      const at: number[] = [];
      const step = (t: number): void => (at.push(t) < n ? this.b.nextFrame(step) : done(at));
      this.b.nextFrame(step);
    });
  }

  private within<T>(f: () => Promise<T>, ms: number, or: T): Promise<T> {
    return Promise.race([Promise.resolve().then(f).catch(() => or), this.b.sleep(ms).then(() => or)]);
  }

  private async wake(): Promise<void> {
    if (this.finished) return;
    try {
      this.report.wakeLock = await this.b.wake();
    } catch (e) {
      this.report.wakeLock = `not held: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.report.done = true;
    if (this.report.mode === "ladder" && this.report.ladder) this.held = this.report.ladder.rungs;
    this.page("Sending the report.");
    this.post(true);
    try {
      this.b.rest();
    } catch {}
  }

  private page(status: string): void {
    this.b.show(donePage(this.report, this.b.global, status, this.offered), PAGE);
  }

  /** Posts go one after another, so the server has them in order. The last is tried four times. */
  private post(last = false): void {
    this.report.seq++;
    const report = this.report;
    const body = JSON.stringify(report);
    try {
      this.b.save(JSON.stringify({ token: this.token, report }));
    } catch {}
    const send = async (): Promise<string> => {
      let why = "";
      for (let i = 0; i < (last ? 4 : 1); i++) {
        if (i > 0) await this.b.sleep(2000 * i);
        const res = await this.within(() => this.b.fetch("report", body), 15000, null);
        if (res?.ok) {
          // The server says what it has held back so far, for every page.
          const told = (await this.within(() => res.json() as Promise<{ skipped?: number; overflows?: number }>, 5000, null)) ?? {};
          if (typeof told.skipped === "number" && typeof told.overflows === "number" && report === this.report) {
            this.serverFrom ??= { skipped: told.skipped, overflows: told.overflows };
            report.link.server = { skipped: told.skipped - this.serverFrom.skipped, overflows: told.overflows - this.serverFrom.overflows };
          }
          return "";
        }
        why = res ? `the server answered ${res.status}` : "no answer";
      }
      return why;
    };
    this.sending = this.sending
      .then(send)
      .then((why) => last && report === this.report && this.page(why === "" ? "Sent." : `Not sent: ${why}. The numbers are only here, so keep this page or take a screenshot.`))
      .catch(() => {});
  }
}
