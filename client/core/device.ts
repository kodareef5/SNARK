// The device probe's run. A page opened with ?device=<token> measures the device it is on by itself and reports to
// tools/device.ts: loading, the picture, the simulation's hashes, then each graphics tier in each scene. Here is what is
// measured and in what order, the report, and its table, which the page shows and the terminal prints. What only a
// browser can say comes from the shell (client/shell/device.ts).

import { HumanAnim } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { creatureHash, hullHash, poseHash, simHash, snapHash, tunedHash } from "../../shared/sim/scenarios.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { App } from "./app.ts";
import { DEFAULT_TIER, TIERS, tierOf, type Tier } from "./assets/tiers.ts";
import { DRAW_TEXTURED, type FramePacket } from "./render/packet.ts";
import type { Thing } from "./render/scene.ts";
import { probePasses, provingProbes } from "./selfcheck.ts";
import { stressThings } from "./stress.ts";

/** The proving ground as the self-check sees it; with the stress meshes; and turned round to the thatch and crowd of crowdScene. */
export type SceneName = "plain" | "stress" | "crowd";
export const SCENES: readonly SceneName[] = ["plain", "stress", "crowd"];

export interface Timing {
  /** A phase is measured this long once what it shows has settled. */
  measureMs: number;
  /** How long a phase may take to settle, and loading to reach full detail, before the run goes on without. */
  settleMs: number;
  loadMs: number;
}
export const TIMING: Timing = { measureMs: 5000, settleMs: 10000, loadMs: 60000 };
/** Frames in a row with nothing on its way and nothing waiting to go on the graphics card: settled then. */
const STILL = 30;
/** A phase this slow, in ms a frame, and the tiers above it are not tried. */
const TOO_SLOW = 100;
/** Frames stopped this long while the page is shown, and the run ends. */
const STALL_MS = 15000;

export interface Spread {
  median: number;
  p95: number;
  p99: number;
  worst: number;
}

const tenth = (x: number): number => Math.round(x * 10) / 10;

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
  /** Medians a frame: WebGL draw calls, triangles, and draws the frame asked to have drawn with their materials. */
  drawCalls: number;
  triangles: number;
  textured: number;
  /** Totals over the measured frames, as the frame packet counted them. */
  dropped: number;
  skipped: number;
  /** While the phase settled and ran: bytes fetched over the network, asset requests that failed, and snapshots missed. */
  fetched: number;
  failed: number;
  missed: number;
  /** Times the graphics context was lost, and the tier the game fell to for want of memory, if it did. */
  lost: number;
  fellTo: string | null;
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
  highp: boolean;
  antialias: boolean;
  extensions: string[];
  /** The texture variant the renderer took for this device: "bc", "astc" or "rgba". */
  variant: string;
}

export interface DeviceReport {
  /** Made up by the page. A run is one file in .cache/device. */
  run: string;
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
    snapshots: number;
    missed: number;
    /** The longest time between two frames that brought a snapshot while phases were measured. */
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
  skipped: string[];
  /** Textures the renderer made once the game had started. A material is drawn from them. */
  texturesMade: number;
  /** Stages and phases that began again because the page was hidden. */
  hidden: string[];
  errors: string[];
  /** Set when the page found its own run unfinished as it loaded: the browser had reloaded it, most likely after a crash. */
  reloadedDuring: string | null;
}

export function newReport(run: string): DeviceReport {
  return {
    run, seq: 0, stage: "starting", done: false, device: null, gpu: null, idleFrameMs: null, wakeLock: "not asked",
    link: { httpMs: null, gameMs: null, snapshots: 0, missed: 0, longestGapMs: 0, bytesIn: 0, clockJumps: 0, corrections: 0, undecodable: 0 },
    load: null, probes: null, hashes: null, phases: [], again: null, skipped: [], texturesMade: 0, hidden: [], errors: [], reloadedDuring: null,
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

function deviceOf(g: Record<string, unknown>, features: Record<string, boolean | string | number>): DeviceInfo {
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
const GL = { VENDOR: 0x1f00, VERSION: 0x1f02, MAX_TEXTURE_SIZE: 0x0d33, MAX_ARRAY_TEXTURE_LAYERS: 0x88ff, MAX_SAMPLES: 0x8d57, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c, FRAGMENT_SHADER: 0x8b30, HIGH_FLOAT: 0x8df2, UNMASKED_VENDOR_WEBGL: 0x9245 };

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
    highp: (gl.getShaderPrecisionFormat(GL.FRAGMENT_SHADER, GL.HIGH_FLOAT)?.precision ?? 0) > 0,
    antialias: gl.getContextAttributes()?.antialias === true,
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
  return [["sim", () => simHash(reg)], ["pose", () => poseHash(anim)], ["snap", () => snapHash(reg)], ["creature", () => creatureHash(rigs.values())], ["tuned", () => tunedHash(reg)], ["hull", () => hullHash(reg)]];
}

/**
 * What tools/device.ts stands behind the spawn point, where the crowd scene looks and the others do not. Near, a floor of
 * thatch with a wall down each side: thatch is the one material yet, and only a piece's finest level has it, so it must
 * be near to be drawn with it. Past it, bodies in rows that widen with distance, so a narrow screen has them all in
 * view. A piece's `y` is its height over the ground at `floor`.
 */
export function crowdScene(): { bodies: { species: string; x: number; z: number }[]; floor: { x: number; z: number }; pieces: { id: string; x: number; y: number; z: number; yaw: number }[] } {
  const species = ["core:survivor", "core:parasaur", "core:raptor", "core:grazer"];
  const bodies: { species: string; x: number; z: number }[] = [];
  [4, 6, 8, 8, 10, 12].forEach((n, row) => {
    const d = 17 + row * 6;
    const half = d * 0.28;
    for (let i = 0; i < n; i++) bodies.push({ species: species[bodies.length % species.length]!, x: PROVING_SPAWN.x - half + (2 * half * (i + 0.5)) / n, z: PROVING_SPAWN.z - d });
  });
  const floor = { x: PROVING_SPAWN.x, z: PROVING_SPAWN.z - 11 };
  const pieces: { id: string; x: number; y: number; z: number; yaw: number }[] = [];
  for (const a of [-1.5, 1.5]) {
    for (const b of [-1.5, 1.5]) pieces.push({ id: "core:foundation_thatch", x: floor.x + a, y: 0.1875, z: floor.z + b, yaw: 0 });
    pieces.push({ id: "core:wall_thatch", x: floor.x - 3, y: 1.875, z: floor.z + a, yaw: 16384 }, { id: "core:wall_thatch", x: floor.x + 3, y: 1.875, z: floor.z + a, yaw: 16384 });
  }
  return { bodies, floor, pieces };
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
}

type Stage = "load" | "probes" | "hashes" | "phases" | "again" | "done";

export class DeviceRun {
  readonly report: DeviceReport;
  private readonly side: DeviceSide;
  private readonly timing: Timing;
  private readonly plan: { tier: Tier; scene: SceneName }[];
  private stage: Stage = "load";
  private index = 0;
  /** When the stage or phase began, or -1 for at the next frame. */
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
  private lostCount = 0;
  private lostAt = 0;
  private fetchedAt = 0;
  private failedAt = 0;
  private dropped = 0;
  private skipped = 0;
  private readonly samples = { frame: [] as number[], build: [] as number[], draw: [] as number[], calls: [] as number[], tris: [] as number[], textured: [] as number[] };
  /** Tiers above this index are not tried, for `stopWhy`. */
  private stopAbove = TIERS.length;
  private stopWhy = "";
  private base: { snapshots: number; latest: number } | null = null;
  private phaseBase = { snapshots: 0, latest: 0 };
  private snapTick = 0;
  private snapAt = 0;
  private longestGap = 0;
  private readonly rtt: number[] = [];

  constructor(report: DeviceReport, side: DeviceSide, timing: Timing = TIMING) {
    this.report = report;
    this.side = side;
    this.timing = timing;
    this.plan = TIERS.flatMap((tier) => SCENES.map((scene) => ({ tier, scene })));
  }


  /** Each drawn frame, once it is handed to WebGL. True when the report has news worth sending. */
  frame(now: number, p: FramePacket, buildMs: number, drawMs: number, drawCalls: number, canvas: number[], read: (sx: number, sy: number) => [number, number, number]): boolean {
    if (this.stage === "done") return false;
    const r = this.side.app.scene!.assets.residency;
    const gap = this.last > 0 ? now - this.last : 0;
    this.last = now;
    this.lastFrameAt = this.side.now();
    this.canvas = canvas;
    const quiet = r.flying === 0 && r.waiting === 0 && p.assetUploads.length === 0 && p.texUploads.length === 0 && p.skipped === 0;
    if (quiet && this.still === 0) this.stillSince = now;
    this.still = quiet ? this.still + 1 : 0;
    this.listen(now);
    const news = this.stage === "load" ? this.load(now) : this.stage === "probes" ? this.probes(read) : this.stage === "hashes" ? this.hashes() : this.measure(now, gap, p, buildMs, drawMs, drawCalls);
    if (news) this.sync();
    return news;
  }

  /** The page was hidden: what was under way starts again when it is shown. */
  hidden(): void {
    if (this.stage === "done") return;
    const phase = this.plan[this.index]!;
    this.report.hidden.push(this.stage === "phases" || this.stage === "again" ? `${phase.tier.name} ${phase.scene}` : this.stage);
    if (this.stage === "phases" || this.stage === "again") this.begin();
  }

  /** The page is shown again: the frames' stopping until now does not count. */
  shown(now: number): void {
    this.shownAt = now;
  }

  lost(): void {
    this.lostCount++;
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
    const keep = "\nKeep this page open and the screen on. It takes about two minutes.";
    if (this.stage === "done") return "Done";
    if (this.stage === "load") return `Loading the game: ${Math.round((now - this.side.bootAt) / 1000)} s${keep}`;
    if (this.stage === "probes" || this.stage === "hashes") return `Checking the picture and the simulation${keep}`;
    const { tier, scene } = this.plan[this.index]!;
    const step = this.stage === "again" ? "the first again" : `${this.index + 1} of ${this.plan.length}`;
    const left = this.measuring ? `${Math.max(0, Math.ceil((this.timing.measureMs - (now - this.at)) / 1000))} s left` : "settling";
    return `Measuring ${tier.name}, ${scene} (${step}): ${left}${keep}`;
  }

  private load(now: number): boolean {
    const side = this.side;
    if (!this.report.load) {
      this.show("plain", tierOf(DEFAULT_TIER));
      this.report.stage = "loading";
      this.report.load = { firstFrameMs: tenth(now - side.bootAt), fullDetailMs: 0, settled: false, pageBytes: 0, assetBytes: 0, diskBytes: 0, failed: 0, cache: "" };
      this.at = now;
      this.base = { snapshots: side.app.session.stats.snapshots, latest: side.app.session.latestSnapshot };
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
    this.stage = "probes";
    this.report.stage = "probes";
    return true;
  }

  /** The self-check's probes that are on this screen, read off the picture of the default tier once it has settled. A narrow screen leaves the slope out. */
  private probes(read: (sx: number, sy: number) => [number, number, number]): boolean {
    const { app, reg, pack, hf } = this.side;
    const shown = provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, true).filter((p) => p.sx >= 0 && p.sx < 1 && p.sy >= 0 && p.sy < 1);
    this.report.probes = shown.map((p) => {
      const got = read(p.sx, p.sy);
      return { name: p.name, ok: probePasses(p, got[0], got[1], got[2]), expected: p.rgb, got };
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
    this.stage = "phases";
    this.index = -1;
    this.next();
    return true;
  }

  private measure(now: number, gap: number, p: FramePacket, buildMs: number, drawMs: number, drawCalls: number): boolean {
    if (this.at < 0) this.at = now;
    if (!this.measuring) {
      if (this.still < STILL && now - this.at < this.timing.settleMs) return false;
      this.measuring = true;
      this.settleMs = tenth(now - this.at);
      this.settled = this.still >= STILL;
      this.at = now;
      for (const list of Object.values(this.samples)) list.length = 0;
      this.dropped = this.skipped = 0;
      return false;
    }
    const s = this.samples;
    s.frame.push(gap);
    s.build.push(buildMs);
    s.draw.push(drawMs);
    s.calls.push(drawCalls);
    s.tris.push(p.triangles);
    let textured = 0;
    for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_TEXTURED) !== 0) textured++;
    s.textured.push(textured);
    this.dropped += p.dropped;
    this.skipped += p.skipped;
    if (s.frame.length % 30 === 0) this.rtt.push(tenth((this.side.app.session.stats.rttTicks * 1000) / TICK_RATE));
    if (now - this.at < this.timing.measureMs) return false;
    const phase = this.result();
    if (this.stage === "again") {
      this.report.again = phase;
      this.end();
      return true;
    }
    this.report.phases.push(phase);
    const at = TIERS.findIndex((t) => t.name === phase.tier);
    const why = phase.lost > 0 ? "the graphics context was lost" : phase.fellTo ? `the game fell to ${phase.fellTo} for want of memory` : phase.frameMs.median > TOO_SLOW ? `a frame took ${phase.frameMs.median} ms` : "";
    if (why && at < this.stopAbove) {
      this.stopAbove = at;
      this.stopWhy = `${why} on ${phase.tier}, ${phase.scene}`;
    }
    this.next();
    return true;
  }

  private result(): PhaseReport {
    const { tier, scene } = this.plan[this.index]!;
    const s = this.samples;
    const app = this.side.app;
    const session = app.session;
    const missed = Math.max(0, session.latestSnapshot - this.phaseBase.latest - (session.stats.snapshots - this.phaseBase.snapshots));
    return {
      tier: tier.name, scene, ratio: this.ratio(), canvas: this.canvas, settleMs: this.settleMs, settled: this.settled, frames: s.frame.length,
      frameMs: spread(s.frame), buildMs: spread(s.build), drawMs: spread(s.draw),
      drawCalls: spread(s.calls).median, triangles: spread(s.tris).median, textured: spread(s.textured).median,
      dropped: this.dropped, skipped: this.skipped, fetched: app.scene!.assets.residency.stats.fetched - this.fetchedAt, failed: this.failures() - this.failedAt, missed,
      lost: this.lostCount - this.lostAt, fellTo: app.ui.settings.tier === tier.name ? null : app.ui.settings.tier,
    };
  }

  /** On to the next phase the device can run, and after the last to the first once more. */
  private next(): void {
    for (this.index++; this.index < this.plan.length; this.index++) {
      const { tier } = this.plan[this.index]!;
      const why = tier.texture > this.side.maxTexture ? `its textures are up to ${tier.texture} wide, and this device takes ${this.side.maxTexture}` : TIERS.indexOf(tier) > this.stopAbove ? this.stopWhy : "";
      if (!why) break;
      if (!this.report.skipped.some((line) => line.startsWith(`${tier.name}:`))) this.report.skipped.push(`${tier.name}: ${why}`);
    }
    if (this.index >= this.plan.length) {
      this.stage = "again";
      this.index = 0;
    }
    this.begin();
  }

  private begin(): void {
    const { tier, scene } = this.plan[this.index]!;
    this.report.stage = this.stage === "again" ? `again ${tier.name} ${scene}` : `${tier.name} ${scene}`;
    this.measuring = false;
    this.at = -1;
    this.show(scene, tier);
  }

  private show(scene: SceneName, tier: Tier): void {
    const app = this.side.app;
    app.ui.settings.tier = tier.name;
    app.controls.yaw = scene === "crowd" ? Math.PI : 0;
    app.controls.pitch = 0;
    app.scene!.things = scene === "stress" ? this.stressed() : [];
    this.fetchedAt = app.scene!.assets.residency.stats.fetched;
    this.failedAt = this.failures();
    this.phaseBase = { snapshots: app.session.stats.snapshots, latest: app.session.latestSnapshot };
    this.lostAt = this.lostCount;
    this.still = 0;
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

  /** Device pixels the page draws for one CSS pixel, as client/shell/main.ts works it out from the tier in use. */
  private ratio(): number {
    const most = this.side.app.scene!.assets.tier.pixelRatio;
    return most > 0 ? Math.min(this.side.dpr, most) : this.side.dpr;
  }

  /** Asset requests that failed, to be asked again or given up. */
  private failures(): number {
    const stats = this.side.app.scene!.assets.residency.stats;
    return stats.failed + stats.dead;
  }

  /** Snapshots that arrive, and the longest wait for one while phases are measured, to the frame. */
  private listen(now: number): void {
    const s = this.side.app.session;
    if (s.latestSnapshot === this.snapTick) return;
    if (this.measuring && this.snapAt > 0) this.longestGap = Math.max(this.longestGap, now - this.snapAt);
    this.snapTick = s.latestSnapshot;
    this.snapAt = now;
  }

  private sync(): void {
    const s = this.side.app.session;
    const link = this.report.link;
    if (this.base) {
      link.snapshots = s.stats.snapshots - this.base.snapshots;
      link.missed = Math.max(0, s.latestSnapshot - this.base.latest - link.snapshots);
    }
    link.gameMs = this.rtt.length > 0 ? spread(this.rtt) : null;
    link.longestGapMs = tenth(this.longestGap);
    link.bytesIn = s.stats.bytesIn;
    link.clockJumps = s.stats.clockJumps;
    link.corrections = s.stats.corrections;
    link.undecodable = s.stats.undecodable;
  }

  private end(): void {
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
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Calls `fn` with the time of the next frame. */
  nextFrame(fn: (t: number) => void): void;
  /** A request to the probe's own routes on its server, with the token: a POST of `body` if given. */
  fetch(path: string, body?: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** Session storage. */
  load(): string | null;
  save(text: string): void;
  /** Text in the box over the page, laid out by `style`. */
  show(text: string, style: string): void;
  /** Asks to keep the screen on, and lets it go. */
  wake(): Promise<string>;
  rest(): void;
  /** The page's own fetches so far, as its performance timeline lists them. */
  entries(): { transferSize?: number; encodedBodySize?: number }[];
}

/** What the probe reads of the shell's renderer. A WebGL 2 context is a GlLike with these besides. */
export interface RendererLike {
  gl: GlLike & { createTexture(): unknown; canvas: unknown; drawingBufferWidth: number; drawingBufferHeight: number };
  rendererName: string;
  /** The texture variant it took. */
  format?: string;
  drawCalls: number;
  readPixel(sx: number, sy: number): [number, number, number];
}

/** A line of progress over the bottom of the game, and the whole page at the end. */
const BAR = "position:fixed;left:0;right:0;bottom:0;margin:0;padding:6px 8px;background:rgba(0,0,0,.55);color:#eee;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:10;pointer-events:none";
const PAGE = "position:fixed;inset:0;margin:0;padding:12px;background:#111;color:#eee;font:11px ui-monospace,Menlo,monospace;white-space:pre;overflow:auto;z-index:10";

/**
 * A page's device probe from start to end. Before the game loads it reads the browser, the display and the link; then
 * the run measures the game; at the end the page shows the report. The report is posted after every step and kept in
 * session storage, so a page the browser reloads after a crash reports what it had, and does not run again.
 */
export class DeviceProbe {
  readonly report: DeviceReport;
  private readonly token: string;
  private readonly b: DeviceBrowser;
  private readonly timing: Timing;
  private readonly recovered: boolean;
  private run: DeviceRun | null = null;
  private renderer: RendererLike | null = null;
  private expected: Record<string, string> | null = null;
  /** When the game began to load, or -1 before. */
  private bootAt = -1;
  private progressAt = 0;
  /** Off while the graphics context is lost and made again, whose textures are not the materials'. */
  private counting = true;
  private finished = false;
  private sending: Promise<unknown> = Promise.resolve();

  constructor(token: string, browser: DeviceBrowser, timing: Timing = TIMING) {
    this.token = token;
    this.b = browser;
    this.timing = timing;
    type Saved = { token?: unknown; report?: DeviceReport } | null;
    let saved: Saved = null;
    try {
      saved = JSON.parse(browser.load() ?? "null") as Saved;
    } catch {}
    this.recovered = saved !== null && saved.token === token && saved.report?.done === false;
    this.report = this.recovered ? saved!.report! : newReport(browser.id);
    if (this.recovered) this.report.reloadedDuring = this.report.stage;
  }

  /** Before the game loads. False if it should not load: the page found its run unfinished, and shows what it had. */
  async before(): Promise<boolean> {
    if (this.recovered) {
      this.finish();
      return false;
    }
    this.b.show("Measuring this device. Keep this page open and the screen on. It takes about two minutes.", BAR);
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
    this.report.device = deviceOf(this.b.global, features);
    this.report.idleFrameMs = frames ? spread(frames.slice(1).map((t, i) => t - frames[i]!)).median : null;
    this.report.link.httpMs = pings.length > 0 ? spread(pings) : null;
    this.report.stage = "loading";
    this.bootAt = this.b.now();
    this.post();
    return true;
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
    const pageBytes = (): number => b.entries().reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0);
    this.run = new DeviceRun(this.report, { ...side, dpr: b.dpr, maxTexture: gpu.maxTexture, bootAt: this.bootAt, now: () => b.now(), pageBytes, expected: this.expected }, this.timing);
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

  private lost(): void {
    this.counting = false;
    this.run?.lost();
  }

  error(message: string): void {
    if (this.report.errors.length < 10) this.report.errors.push(`${this.report.stage}: ${message.slice(0, 300)}`);
  }

  /** The game could not start or go on. */
  fail(message: string): void {
    this.error(message);
    this.finish();
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
    this.page("Sending the report.");
    this.post(true);
    try {
      this.b.rest();
    } catch {}
  }

  private page(status: string): void {
    const early = this.report.errors.length > 0 || this.report.reloadedDuring !== null;
    this.b.show(`${early ? "Stopped early" : "Done"}. ${status}\n\n${deviceTable(this.report).join("\n")}`, PAGE);
  }

  /** Posts go one after another, so the server has them in order. The last is tried four times. */
  private post(last = false): void {
    this.report.seq++;
    const body = JSON.stringify(this.report);
    try {
      this.b.save(JSON.stringify({ token: this.token, report: this.report }));
    } catch {}
    const send = async (): Promise<string> => {
      let why = "";
      for (let i = 0; i < (last ? 4 : 1); i++) {
        if (i > 0) await this.b.sleep(2000 * i);
        const status = await this.within(() => this.b.fetch("report", body).then((res) => res.status), 15000, 0);
        if (status === 200) return "";
        why = status === 0 ? "no answer" : `the server answered ${status}`;
      }
      return why;
    };
    this.sending = this.sending
      .then(send)
      .then((why) => last && this.page(why === "" ? "Sent. You can close this page." : `Not sent: ${why}. The numbers are only here, so keep this page or take a screenshot.`))
      .catch(() => {});
  }
}

const yes = (b: unknown): string => (b ? "yes" : "no");
const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);
const secs = (ms: number): string => (ms / 1000).toFixed(1);
const count = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const WIDTHS = [8, 7, 10, 6, 7, 7, 7, 7, 6, 6, 6, 7, 5, 5, 5, 5, 6, 5, 5];
const row = (cells: string[]): string => cells.map((c, i) => (i < 3 ? c.padEnd(WIDTHS[i]!) : c.padStart(WIDTHS[i]!))).join(" ").trimEnd();

function phaseRow(p: PhaseReport, tier = p.tier): string {
  const line = row([tier, p.scene, p.canvas.join("x"), `${secs(p.settleMs)}${p.settled ? "" : "!"}`, String(p.frameMs.median), String(p.frameMs.p95), String(p.frameMs.p99), String(p.frameMs.worst), String(p.buildMs.median), String(p.drawMs.median), count(p.drawCalls), count(p.triangles), count(p.textured), String(p.dropped), String(p.skipped), String(p.lost), mb(p.fetched), String(p.failed), String(p.missed)]);
  return p.fellTo ? `${line}  fell to ${p.fellTo}` : line;
}

/** The report as lines of plain text: on the page when it is done, and in the terminal of tools/device.ts. */
export function deviceTable(r: DeviceReport): string[] {
  const out: string[] = [`SNARK device report ${r.run}: ${r.done ? "done" : `stopped at ${r.stage}`}`];
  if (r.reloadedDuring) out.push(`reloaded  the browser reloaded the page during ${r.reloadedDuring}, as it does after the page crashes`);
  const d = r.device;
  if (d) {
    const f = d.features;
    out.push(`device    ${d.userAgent}`);
    out.push(`screen    ${d.screen.join("x")} CSS pixels, the page ${d.window.join("x")}, ${d.pixelRatio} device pixels to one; ${d.cores} cores${d.memoryGB ? `, ${d.memoryGB} GB` : ""}; ${d.touch} touch points`);
    out.push(`features  workers ${yes(f.workers)}, file storage ${yes(f.opfs)}, decompression ${f.decompress || "none"}, audio worklet ${yes(f.audioWorklet)}, storage quota ${f.quotaMB ?? "?"} MB`);
    out.push(`          opus encode ${yes(f.opusEncode)}, opus decode ${yes(f.opusDecode)}, webtransport ${yes(f.webTransport)}, webgpu ${yes(f.webgpu)}`);
  }
  const g = r.gpu;
  if (g) {
    out.push(`gpu       ${g.renderer} (${g.vendor}), ${g.version}`);
    out.push(`limits    texture ${g.maxTexture}, layers ${g.maxArrayLayers}, samples ${g.maxSamples}, vertex textures ${g.vertexTextures}, highp ${yes(g.highp)}, antialias ${yes(g.antialias)}`);
    out.push(`textures  compressed ${formatsOf(g.extensions).join(" ") || "none"}; float render ${yes(g.extensions.includes("EXT_color_buffer_float"))}, float filter ${yes(g.extensions.includes("OES_texture_float_linear"))}; depth textures yes, as in all WebGL 2; drawn from the ${g.variant} variant`);
  }
  out.push(`display   ${r.idleFrameMs ?? "?"} ms between frames with nothing drawn; wake lock ${r.wakeLock}`);
  const l = r.link;
  const measured = r.phases.reduce((sum, p) => sum + p.missed, 0);
  out.push(`link      request ${l.httpMs ? `${l.httpMs.median} ms, worst ${l.httpMs.worst}` : "?"}; game ${l.gameMs ? `${l.gameMs.median} ms` : "?"}; snapshots ${l.snapshots}, missed ${l.missed} (${measured} while phases settled and ran), longest wait ${l.longestGapMs} ms; ${l.clockJumps} clock jumps, ${l.corrections} corrections`);
  const load = r.load;
  if (load) out.push(`load      first frame ${secs(load.firstFrameMs)} s, full detail ${secs(load.fullDetailMs)} s${load.settled ? "" : " (not reached)"}; page ${mb(load.pageBytes)} MB, assets ${mb(load.assetBytes)} MB, ${mb(load.diskBytes)} MB from disk, ${load.failed} fetches failed; asset cache in ${load.cache}`);
  if (r.probes) {
    const wrong = r.probes.filter((p) => !p.ok);
    out.push(`picture   ${r.probes.length - wrong.length} of ${r.probes.length} probes right (${r.probes.map((p) => p.name).join(" ")})${wrong.map((p) => `; ${p.name} is ${p.got.join(",")}, not ${p.expected.join(",")}`).join("")}`);
  }
  if (r.hashes) {
    const differ = r.hashes.filter((h) => h.got !== h.want);
    out.push(`hashes    ${r.hashes.length - differ.length} of ${r.hashes.length} as the server's${differ.map((h) => `; ${h.name} ${h.got}, server ${h.want ?? "?"}`).join("")}; ${r.hashes.map((h) => `${h.name} ${h.ms} ms`).join(", ")}`);
  }
  const asked = [...new Set(r.phases.filter((p) => p.textured > 0).map((p) => p.tier))];
  out.push(`materials ${asked.length === 0 ? "none asked for" : r.texturesMade > 0 ? `drawn on ${asked.join(", ")}: the renderer made ${r.texturesMade} textures` : `asked for on ${asked.join(", ")}, but the renderer made no textures, so drawn flat`}`);
  out.push(`tiers run ${[...new Set(r.phases.map((p) => p.tier))].join(", ") || "none"}`);
  if (r.phases.length > 0) {
    out.push("");
    out.push(row(["tier", "scene", "canvas", "settle", "median", "p95", "p99", "worst", "build", "draw", "calls", "tris", "mat", "drop", "skip", "lost", "MB", "fail", "miss"]));
    for (const p of r.phases) out.push(phaseRow(p));
    if (r.again) out.push(phaseRow(r.again, "again"));
    out.push("median to worst: ms between frames. settle: s until nothing was on its way, ! if never. build, draw: ms in our code.");
    out.push("calls: WebGL draws. mat: draws with materials. drop, skip: what the frame left out.");
    out.push("MB, fail, miss: fetched, fetches failed and snapshots missed while the phase settled and ran.");
  }
  for (const line of r.skipped) out.push(`not run   ${line}`);
  if (r.hidden.length > 0) out.push(`hidden    started again after the page was hidden: ${r.hidden.join(", ")}`);
  for (const e of r.errors) out.push(`error     ${e}`);
  return out;
}
