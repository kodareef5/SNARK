// A `?bench=1` run: the page measures itself and reports to the tool that opened it (tools/bench/gpu.ts, trees.ts). Only a
// bench page fetches this file, so a player's first frame does not wait for it (D873).

import type { MapProgress } from "./mapload.ts";
import { BENCH_FRAMES, PASSES } from "./passes.ts";
import { DRAW_PULLED, DRAW_RANGED, DRAW_TEXTURED, type FramePacket } from "./render/packet.ts";
import { NODE_BUFFERS } from "./render/scene.ts";

/**
 * Frames with nothing on its way before the measured frames begin, and the most ms to wait for them: the whole map
 * comes first, every part of it handed over and the road and streets parts round the body held, then the frames.
 */
const STILL = 60;
export const SETTLE_MS = 180000;

/** Each pass's median and 95th percentile over `frames` (PassClock.take), where passes were timed, and the frame's, in ms; null for none timed. */
export function passSpread(frames: readonly number[][]): Record<string, { median: number; p95: number }> | null {
  if (frames.length === 0) return null;
  const at = (list: number[], q: number): number => Math.round(list.sort((a, b) => a - b)[Math.floor((list.length - 1) * q)]! * 1000) / 1000;
  const columns: [string, number[]][] = frames[0]!.length > 1 ? PASSES.map((name, i) => [name, frames.map((f) => f[i]!)]) : [];
  columns.push(["frame", frames.map((f) => f.reduce((a, b) => a + b, 0))]);
  return Object.fromEntries(columns.map(([name, list]) => [name, { median: at(list, 0.5), p95: at(list, 0.95) }]));
}

/**
 * Of a run that drew every other frame with other effects off (`?ab=`), its frames' ms in order and which were the
 * others: each kind's median, and the median of each other frame less the mean of its own frames either side, which a
 * turning view and a card shared with other work change little; null where no frame was another's.
 */
export function alternateSpread(frames: readonly number[], other: readonly boolean[]): { own: number; other: number; less: number } | null {
  const med = (list: number[]): number => Math.round(list.sort((a, b) => a - b)[(list.length - 1) >> 1]! * 1000) / 1000;
  const less: number[] = [];
  for (let i = 1; i + 1 < frames.length; i++) if (other[i] && !other[i - 1] && !other[i + 1]) less.push(frames[i]! - (frames[i - 1]! + frames[i + 1]!) / 2);
  if (less.length === 0) return null;
  return { own: med(frames.filter((_, i) => !other[i])), other: med(frames.filter((_, i) => other[i])), less: med(less) };
}

/**
 * The triangles a frame submits for trees, rocks and bushes, as the scene counts them: the near store's draws, each its
 * level's triangles (`tris`, by mesh and level) times its instances, and the far store's, each its slot's. A far slot
 * pads a short row with empty triangles, so the far count is the work the card is given, not what shows.
 */
export function nodeTriangles(p: FramePacket, tris: readonly (readonly number[])[]): { near: number; far: number } {
  let near = 0, far = 0;
  for (let d = 0; d < p.drawCount; d++) {
    const b = p.drawBuffer[d]!, n = p.drawInstances[d]!;
    if (b >= NODE_BUFFERS && b < NODE_BUFFERS * 2) near += ((p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.drawIndexCount[d]! / 3 : (tris[p.drawMesh[d]!]?.[p.drawLod[d]!] ?? 0)) * n;
    else if ((p.drawFlags[d]! & DRAW_PULLED) !== 0) far += (p.drawIndexCount[d]! / 3) * n;
  }
  return { near: Math.round(near), far: Math.round(far) };
}

/** What the shell knows of the frame besides the packet: the GL calls, the canvas, the renderer, and bytes on the card. */
export interface Drawn {
  drawCalls: number;
  canvas: number[];
  renderer: string;
  userAgent: string;
  /** Bytes the page holds on the card, and of them textures' (assets/residency.ts ledger, texLedger). */
  card: { bytes: number; textures: number };
  /** The budget's squeeze at the last frame: below none where it spends the room left on finer trees (render/budget.ts). */
  squeeze: number;
  /** How much of the map has come (mapload.ts MapLoader.progress), asked only while the run waits for all of it. */
  map?: () => MapProgress;
}

/** A `?bench=1` run: the page flies itself (App.autopilot), or holds its look with `?still`, and reports frame times and the GPU's time by pass. */
export class BenchRun {
  private readonly intervals: number[] = [];
  private readonly ours: number[] = [];
  private readonly gpu: number[][] = [];
  /** Whether each of `gpu` was drawn with the page's other effects (FramePacket.alternate), which only a clock that times the frame it is told of (`?sync=1`) knows. */
  private readonly other: boolean[] = [];
  /** Each measured frame's counts, for their medians over the turn. */
  private readonly counts: Record<"triangles" | "draws" | "castTriangles" | "castDraws" | "nearNodes" | "farNodes", number[]> = { triangles: [], draws: [], castTriangles: [], castDraws: [], nearNodes: [], farNodes: [] };
  private first = -1;
  private draws = -1;
  private triangles = -1;
  private started = -1;
  private previous = -1;
  private still = 0;
  private done = false;
  /** When the map had all come (ms from the first frame), and how much of it had when the run began. */
  private mapAt = -1;
  private mapThen: MapProgress | null = null;
  /** Frames drawn alike when the run began: STILL, or fewer where it gave up waiting. */
  private began = 0;

  /**
   * The autopilot's clock: a sixtieth of a second for each frame measured so far, 0 before. By frames, not by the time
   * they took, so that every run sees the same view at each of its frames whatever its frame rate: by the time, a run at
   * 30 frames a second turned twice as far as one at 60 before its frames were done, and ended on another view, whose
   * draws and triangles were what it said it drew (659 in one run of a street and 2,152 in another).
   */
  since(_now: number): number {
    return this.started < 0 ? 0 : (this.intervals.length * 1000) / 60;
  }

  /**
   * Each drawn frame, at `now`, our code's `ours` ms of it, and the frames `gpu` timed. Returns the report once, when it
   * is whole: what the renderer drew in the last frame comes from `drawn`.
   */
  frame(now: number, ours: number, gpu: readonly number[][], p: FramePacket, quiet: boolean, drawn: Drawn, tris: readonly (readonly number[])[] = []): ({ frameMs: Record<"median" | "p95" | "p99" | "worst", number> } & Record<string, unknown>) | null {
    if (this.done) return null;
    if (this.first < 0) this.first = now;
    // Still: the whole map come and handed over (the far city made of it, its tops, the road and streets parts round the
    // body), nothing on its way, nothing uploaded, and the view held still drawing what it drew the frame before. A run
    // that began while the map still came measured another scene than the next: the same street drew 710 draws and
    // 2.40 M triangles on the page's clock and 580 and 1.79 M by query, and earlier 659 in one run and 2,152 in another.
    const measuring = this.previous >= 0;
    if (!measuring && this.mapAt < 0) {
      const m = drawn.map?.();
      if (!m || (m.whole && m.left === 0 && m.roads === 0)) this.mapAt = now - this.first;
      this.mapThen = m ?? null;
    }
    const same = p.drawCount === this.draws && p.triangles === this.triangles;
    [this.draws, this.triangles] = [p.drawCount, p.triangles];
    this.still = this.mapAt >= 0 && quiet && same && p.assetUploads.length + p.texUploads.length === 0 ? this.still + 1 : 0;
    if (!measuring && (this.still >= STILL || now - this.first >= SETTLE_MS)) [this.previous, this.started, this.began] = [now, now, this.still];
    if (!measuring) return null;
    this.intervals.push(now - this.previous);
    this.ours.push(ours);
    this.gpu.push(...gpu);
    for (const _ of gpu) this.other.push(p.alternate);
    const nodes = nodeTriangles(p, tris), c = this.counts;
    c.triangles.push(p.triangles);
    c.draws.push(p.drawCount);
    c.castTriangles.push(p.castTriangles);
    c.castDraws.push(p.castDraws);
    c.nearNodes.push(nodes.near);
    c.farNodes.push(nodes.far);
    this.previous = now;
    if (this.intervals.length < BENCH_FRAMES) return null;
    this.done = true;
    const at = (list: number[], q: number): number => Math.round([...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)]! * 100) / 100;
    const f = this.intervals;
    const { map: _, ...shown } = drawn;
    return {
      frames: BENCH_FRAMES,
      settledMs: Math.round(now - this.first - f.reduce((a, b) => a + b, 0)),
      // What the run waited for before its first measured frame: the map whole (when it was, or how much of it had come
      // where the run gave up waiting at SETTLE_MS), and STILL frames of it drawn alike with nothing on its way.
      waited: { mapMs: this.mapAt >= 0 ? Math.round(this.mapAt) : null, map: this.mapThen, stillFrames: this.began, gaveUp: this.began < STILL },
      frameMs: { median: at(f, 0.5), p95: at(f, 0.95), p99: at(f, 0.99), worst: at(f, 1) },
      buildAndSubmitMs: { median: at(this.ours, 0.5), p99: at(this.ours, 0.99) },
      gpuMs: passSpread(this.gpu),
      // Each frame's, in order, which the view's turn makes the same frame for frame from run to run.
      gpuFrames: this.gpu.map((f) => Math.round(f.reduce((a, b) => a + b, 0) * 100) / 100),
      alternate: alternateSpread(this.gpu.map((f) => f.reduce((a, b) => a + b, 0)), this.other),
      // What the last frame drew, which gpu.ts's rows print.
      triangles: p.triangles,
      // The medians over the measured frames: what the frame drew, what the sun's maps took apart from it, and the trees',
      // rocks' and bushes' triangles by store.
      turn: Object.fromEntries(Object.entries(this.counts).map(([k, list]) => [k, at(list, 0.5)])),
      ...shown,
      tier: p.tier,
      // The share of the canvas a side the last frame's scene was drawn at (render/post.ts sceneShare).
      share: p.share,
    };
  }
}
