// A far city tile's level (farcity.ts) as it is made: what it is made from, gathered on the page from the map's statics,
// what is gone and the ground, and the making, a pure function of that. The browser makes levels on workers of its own
// (ThreadedCityMaker, client/city), so no busy tile stops a frame; tests and tools make them here, a frame's budget at a
// time. Either way the bytes are the same.

import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { CityPieces, CityStatics, cellPart, cornerByte, mergedPart, type CityForm, type CityPart, type Gone } from "../../../shared/world/city.ts";
import { HeightWindow, type Heightfield } from "../../../shared/world/heightfield.ts";
import { blocksBuffers, type BlocksJob, type BlocksMade } from "./blocks.ts";
import { sweepBuffers, type SweepJob, type SweepMade } from "./farshadow.ts";
import { quadBytes } from "./packet.ts";

/**
 * What every level of a map's city is made with: its kinds, each one's middle extent in metres, the ground's scale, and
 * FAR_MESH's bounds its vertices are stored within.
 */
export interface CityKinds {
  readonly dims: MapDims;
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly middle: Float32Array;
  readonly color: Uint8Array;
  readonly under?: Uint8Array;
  readonly near?: Uint8Array;
  readonly plain: Uint8Array;
  readonly walked: CityForm;
  readonly look: CityForm;
  readonly ground: { readonly cell: number; readonly nx: number; readonly nz: number; readonly minY: number; readonly stepY: number };
  readonly center: readonly number[];
  readonly half: readonly number[];
}

/** A tile's level to make: a CityLevel's form, and only what that needs of the map. */
export interface CityJob {
  readonly id: number;
  readonly gap: number;
  readonly least: number;
  readonly cell: number;
  readonly tall: number;
  readonly thin: number;
  /** The tile's chunks with pieces, in the order its mesh holds them, and where its vertices are stored from in the world. */
  readonly chunks: Int32Array;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  /** The chunks whose pieces are sent, in order, and how many each: the tile's, and for boxes those round them, whose pieces hide their faces. */
  readonly area: Int32Array;
  readonly counts: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** A byte a piece sent, 1 for gone, or null for none gone. */
  readonly gone: Uint8Array | null;
  /** The ground's samples under the tile and a chunk round it, from sample (i0, j0), `w` a row. */
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly heights: Uint16Array;
}

/** A level made: what goes on the card, its vertices, drawn with the quads' indices (packet.ts quadIndices), and each chunk's run of those. */
export interface CityMade {
  readonly id: number;
  readonly data: Uint8Array;
  readonly indexBytes: 2 | 4;
  readonly first: Uint32Array;
  readonly count: Uint32Array;
}

/** Where levels are made. */
export interface CityMaker {
  /** Called as each level asked for is made, where they are made on another thread. */
  onMade: (() => void) | null;
  /** How many levels it may be asked for ahead of what it has made, where they are made on other threads. */
  readonly flights?: number;
  /** Makes for a city of these kinds from now on, forgetting what was asked before. */
  start(kinds: CityKinds): void;
  make(job: CityJob): void;
  /** Levels made since the last call, into `out`. Returns how many. */
  take(out: CityMade[]): number;
  /** Where levels are made on this thread: makes what was asked a chunk at a time until `ms` are spent, the first chunk whatever it takes. */
  run?(ms: number): void;
  /**
   * Where levels are made on other threads: sweeps the far shadow's map there (farshadow.ts), which needs nothing of the
   * city's kinds and may be asked for before `start`, and gives back the one swept since the last call, or null. A maker
   * without them leaves the sweep to the page.
   */
  sweep?(job: SweepJob): void;
  swept?(): SweepMade | null;
  /**
   * Where levels are made on other threads: makes a tile of the city's blocks there (blocks.ts makeBlocks), which needs
   * nothing of the city's kinds and may be asked for before `start`, and gives back one made since the last call, or
   * null. A maker without them leaves the blocks to the page.
   */
  blocks?(job: BlocksJob): void;
  built?(): BlocksMade | null;
}

/** Whether levels made with `a` are made alike with `b`: the same tables of one registry, the same ground's scale and bounds. */
function sameKinds(a: CityKinds, b: CityKinds): boolean {
  const tables = ["dims", "halfX", "halfY", "halfZ", "color", "under", "near", "plain", "walked", "look"] as const;
  return tables.every((k) => a[k] === b[k]) && JSON.stringify([a.ground, a.center, a.half]) === JSON.stringify([b.ground, b.center, b.half]);
}

export function cityKinds(city: CityStatics, hf: Heightfield, bounds: { center: readonly number[]; half: readonly number[] }): CityKinds {
  const { dims, halfX, halfY, halfZ, color, under, plain, near, walked, look } = city;
  const middle = Float32Array.from(halfX, (hx, k) => 2 * (hx + halfY[k]! + halfZ[k]! - Math.max(hx, halfY[k]!, halfZ[k]!) - Math.min(hx, halfY[k]!, halfZ[k]!)));
  return { dims, halfX, halfY, halfZ, middle, color, under, plain, near, walked, look, ground: { cell: hf.cell, nx: hf.nx, nz: hf.nz, minY: hf.minY, stepY: hf.stepY }, center: bounds.center, half: bounds.half };
}

/**
 * What a level of the tile whose chunks with pieces are `chunks` (in its mesh's order) is made from: `level`'s form, with
 * its vertices stored from (ox, oy, oz). `gone` says which pieces of a chunk are gone.
 */
export function cityJob(id: number, city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, chunks: readonly number[], level: { gap: number; least: number; cell: number; tall: number; thin?: number }, ox: number, oy: number, oz: number): CityJob {
  const dims = city.dims;
  let cx0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cz1 = -Infinity;
  for (const c of chunks) {
    cx0 = Math.min(cx0, chunkCx(dims, c));
    cz0 = Math.min(cz0, chunkCz(dims, c));
    cx1 = Math.max(cx1, chunkCx(dims, c));
    cz1 = Math.max(cz1, chunkCz(dims, c));
  }
  // Cells are made of a chunk's own pieces; boxes hide each other across a chunk's edge.
  const area: number[] = [];
  if (level.cell > 0) area.push(...chunks);
  else {
    for (let cz = Math.max(0, cz0 - 1); cz <= Math.min(dims.chunksZ - 1, cz1 + 1); cz++) {
      for (let cx = Math.max(0, cx0 - 1); cx <= Math.min(dims.chunksX - 1, cx1 + 1); cx++) if (city.in(cz * dims.chunksX + cx) > 0) area.push(cz * dims.chunksX + cx);
    }
  }
  const counts = Uint32Array.from(area, (c) => city.in(c));
  const n = counts.reduce((sum, k) => sum + k, 0);
  const kind = new Uint16Array(n), yaw = new Uint16Array(n), x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const lost = area.some((c) => gone(c) !== null) ? new Uint8Array(n) : null;
  let at = 0;
  for (const c of area) {
    const t = city.rows(c)!, from = t.from(c), to = t.to(c);
    kind.set(t.kind.subarray(from, to), at);
    yaw.set(t.yaw.subarray(from, to), at);
    x.set(t.x.subarray(from, to), at);
    y.set(t.y.subarray(from, to), at);
    z.set(t.z.subarray(from, to), at);
    const g = gone(c);
    if (g) lost!.set(g, at);
    at += to - from;
  }
  // A piece's faces lie well within a chunk of its own; a chunk round the tile's is sent.
  const i0 = Math.max(0, Math.floor(((cx0 - 1) * CHUNK_SIZE) / hf.cell));
  const j0 = Math.max(0, Math.floor(((cz0 - 1) * CHUNK_SIZE) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.floor(((cx1 + 2) * CHUNK_SIZE) / hf.cell) + 1);
  const j1 = Math.min(hf.nz - 1, Math.floor(((cz1 + 2) * CHUNK_SIZE) / hf.cell) + 1);
  const { gap, least, cell, tall, thin = 0 } = level;
  return { id, gap, least, cell, tall, thin, chunks: Int32Array.from(chunks), ox, oy, oz, area: Int32Array.from(area), counts, kind, yaw, x, y, z, gone: lost, i0, j0, w: i1 - i0 + 1, heights: hf.window(i0, j0, i1, j1) };
}

/** Every buffer of a job, or of what was made, to move it to another thread rather than copy it. */
export function buffersOf(m: CityJob | CityMade): ArrayBuffer[] {
  const all = "area" in m ? [m.chunks, m.area, m.counts, m.kind, m.yaw, m.x, m.y, m.z, m.gone, m.heights] : [m.data, m.first, m.count];
  return all.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}

/** The level `job` asks for: every chunk of its tile in order, its faces quantized within FAR_MESH's bounds from the job's origin. */
export function makeLevel(k: CityKinds, job: CityJob): CityMade {
  const making = new LevelMaking(k, job);
  while (!making.done) making.step();
  return making.finish();
}

/** A level being made, a chunk's faces at a time, then put together. */
export class LevelMaking {
  private readonly k: CityKinds;
  private readonly job: CityJob;
  private readonly city: CityStatics;
  private readonly ground: HeightWindow;
  private readonly gone: (chunk: number) => Gone;
  private readonly parts: CityPart[] = [];

  constructor(k: CityKinds, job: CityJob) {
    this.k = k;
    this.job = job;
    // The pieces sent, chunk by chunk of the area, and none in a chunk not sent.
    const { kind } = job;
    const t = new CityPieces(job.area, job.counts, job);
    this.city = CityStatics.of({ ...k, near: k.near ?? new Uint8Array(k.plain.length) }, t);
    this.ground = new HeightWindow({ ...k.ground, i0: job.i0, j0: job.j0, w: job.w, heights: job.heights });
    const gone = (chunk: number): Gone => (job.gone ? job.gone.subarray(t.from(chunk), t.to(chunk)) : null);
    // Pieces thinner across than the level's `thin` are left out as gone ones are: neither drawn nor hiding a face.
    const thin = new Map<number, Uint8Array>();
    this.gone = job.thin <= 0 ? gone : (chunk) => {
      let g = thin.get(chunk);
      if (!g) {
        const was = gone(chunk);
        g = new Uint8Array(t.to(chunk) - t.from(chunk)).map((_, i) => (was?.[i] === 1 || k.middle[kind[t.from(chunk) + i]!]! < job.thin ? 1 : 0));
        thin.set(chunk, g);
      }
      return g;
    };
  }

  get done(): boolean {
    return this.parts.length === this.job.chunks.length;
  }

  /** Makes the faces of the next chunk. */
  step(): void {
    const job = this.job;
    const chunk = job.chunks[this.parts.length]!;
    this.parts.push(job.cell > 0 ? cellPart(this.city, chunk, this.ground, this.gone(chunk), job.cell, job.tall) : mergedPart(this.city, chunk, this.ground, this.gone, job.gap, job.least));
  }

  /** The level, once every chunk's faces are made. */
  finish(): CityMade {
    const { k, job, parts } = this;
    const faces = parts.reduce((n, part) => n + part.faces, 0);
    const data = new Uint8Array(faces * 4 * VERTEX_BYTES);
    const view = new DataView(data.buffer);
    const ce = k.center, h = k.half;
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - ce[a]!) / h[a]!) * 32767)));
    const first = new Uint32Array(parts.length);
    const count = new Uint32Array(parts.length);
    let v = 0;
    parts.forEach((part, r) => {
      const chunk = job.chunks[r]!;
      const dx = chunkCx(k.dims, chunk) * CHUNK_SIZE - job.ox;
      const dz = chunkCz(k.dims, chunk) * CHUNK_SIZE - job.oz;
      first[r] = (v / 4) * 6;
      count[r] = part.faces * 6;
      const { pos, color, edges } = part;
      for (let f = 0; f < part.faces; f++, v += 4) {
        for (let e = 0; e < 4; e++) {
          const o = (v + e) * VERTEX_BYTES;
          const p = (f * 4 + e) * 3;
          view.setInt16(o, q(pos[p]! + dx, 0), true);
          view.setInt16(o + 2, q(pos[p + 1]! - job.oy, 1), true);
          view.setInt16(o + 4, q(pos[p + 2]! + dz, 2), true);
          data[o + 6] = color[f]!;
          data[o + 7] = cornerByte(e, edges[f]!);
        }
      }
    });
    return { id: job.id, data, indexBytes: quadBytes(faces), first, count };
  }
}

/** Threads for a machine of `cores` logical cores: a core each left to the page and the other workers, and at most three. */
export const cityThreads = (cores = 4): number => Math.max(1, Math.min(3, cores - 2));

/** Levels a thread is asked for ahead of what it has made: it never waits on the page, and a tile come nearer soon goes first. */
export const CITY_AHEAD = 3;

/** A thread levels are made on, as a worker running client/city/city-worker.ts is: sent the kinds, then jobs and sweeps, each answered with what it made. */
export interface CityThread {
  onmessage: ((m: { data: CityMade | SweepMade | BlocksMade }) => void) | null;
  postMessage(m: { kinds: CityKinds | null } | { job: CityJob } | { sweep: SweepJob } | { blocks: BlocksJob }, transfer?: ArrayBuffer[]): void;
}

/**
 * Makes levels on `count` threads that `open` starts when the first level is asked for, each level asked of the one with
 * the fewest in hand, since every level is made alone from what it is sent.
 */
export class ThreadedCityMaker implements CityMaker {
  onMade: (() => void) | null = null;
  readonly flights: number;
  private readonly open: () => CityThread;
  private readonly count: number;
  private readonly threads: CityThread[] = [];
  /** Levels asked of each thread and not yet back. */
  private readonly asked: number[] = [];
  private kinds: CityKinds | null = null;
  private readonly done: CityMade[] = [];
  private readonly sweeps: SweepMade[] = [];
  private readonly blocksMade: BlocksMade[] = [];

  constructor(open: () => CityThread, count: number) {
    this.open = open;
    this.count = count;
    this.flights = count * CITY_AHEAD;
  }

  start(kinds: CityKinds): void {
    // A city handed over again of the same kinds: the threads hold them, and sending them again takes tens of milliseconds.
    const same = this.kinds !== null && sameKinds(this.kinds, kinds);
    this.kinds = kinds;
    this.done.length = 0;
    if (!same) for (const thread of this.threads) thread.postMessage({ kinds });
  }

  make(job: CityJob): void {
    this.threads[this.least()]!.postMessage({ job }, buffersOf(job));
  }

  sweep(job: SweepJob): void {
    this.threads[this.least()]!.postMessage({ sweep: job }, sweepBuffers(job));
  }

  swept(): SweepMade | null {
    return this.sweeps.shift() ?? null;
  }

  blocks(job: BlocksJob): void {
    this.threads[this.least()]!.postMessage({ blocks: job }, blocksBuffers(job));
  }

  built(): BlocksMade | null {
    return this.blocksMade.shift() ?? null;
  }

  /** The thread with the fewest in hand, started with the rest if they are not, counted as having one more. */
  private least(): number {
    while (this.threads.length < this.count) {
      const n = this.threads.length;
      const thread = this.open();
      thread.onmessage = (m) => {
        this.asked[n]!--;
        if ("map" in m.data) return void this.sweeps.push(m.data);
        if ("blocks" in m.data) return void this.blocksMade.push(m.data);
        this.done.push(m.data);
        this.onMade?.();
      };
      thread.postMessage({ kinds: this.kinds });
      this.threads.push(thread);
      this.asked.push(0);
    }
    const n = this.asked.indexOf(Math.min(...this.asked));
    this.asked[n]!++;
    return n;
  }

  take(out: CityMade[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}

/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

/** Makes levels on this thread in the order asked, a chunk at a time: for tests, tools, and where there are no workers. */
export class InlineCityMaker implements CityMaker {
  onMade: (() => void) | null = null;
  private kinds: CityKinds | null = null;
  private readonly making: LevelMaking[] = [];
  private readonly done: CityMade[] = [];

  start(kinds: CityKinds): void {
    this.kinds = kinds;
    this.making.length = this.done.length = 0;
  }

  make(job: CityJob): void {
    this.making.push(new LevelMaking(this.kinds!, job));
  }

  run(ms: number): void {
    const start = clock();
    do {
      const m = this.making[0];
      if (!m) return;
      m.step();
      if (!m.done) continue;
      this.done.push(m.finish());
      this.making.shift();
    } while (clock() - start < ms);
  }

  take(out: CityMade[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
