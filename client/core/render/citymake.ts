// A far city tile's level (farcity.ts) as it is made: what it is made from, gathered on the page from the map's statics,
// what is gone and the ground, and the making, a pure function of that. The browser makes levels on a worker of its own
// (client/city), so no busy tile stops a frame; tests and tools make them here, a frame's budget at a time. Either way
// the bytes are the same.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { cellPart, mergedPart, type CityForm, type CityPart, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import { HeightWindow, type Heightfield } from "../../../shared/world/heightfield.ts";

/** What every level of a map's city is made with: its kinds, the ground's scale, and FAR_MESH's bounds its vertices are stored within. */
export interface CityKinds {
  readonly dims: MapDims;
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly color: Uint8Array;
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

/** A level made: what goes on the card (indices, then vertices from the next multiple of 4), and each chunk's run of indices. */
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
  /** Makes for a city of these kinds from now on, forgetting what was asked before. */
  start(kinds: CityKinds): void;
  make(job: CityJob): void;
  /** Levels made since the last call, into `out`. Returns how many. */
  take(out: CityMade[]): number;
  /** Where levels are made on this thread: makes what was asked a chunk at a time until `ms` are spent, the first chunk whatever it takes. */
  run?(ms: number): void;
}

export function cityKinds(city: CityStatics, hf: Heightfield, bounds: { center: readonly number[]; half: readonly number[] }): CityKinds {
  const { dims, halfX, halfY, halfZ, color, plain, walked, look } = city;
  return { dims, halfX, halfY, halfZ, color, plain, walked, look, ground: { cell: hf.cell, nx: hf.nx, nz: hf.nz, minY: hf.minY, stepY: hf.stepY }, center: bounds.center, half: bounds.half };
}

/**
 * What a level of the tile whose chunks with pieces are `chunks` (in its mesh's order) is made from: `level`'s form, with
 * its vertices stored from (ox, oy, oz). `gone` says which pieces of a chunk are gone.
 */
export function cityJob(id: number, city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, chunks: readonly number[], level: { gap: number; least: number; cell: number; tall: number }, ox: number, oy: number, oz: number): CityJob {
  const dims = city.dims;
  let [cx0, cz0, cx1, cz1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of chunks) [cx0, cz0, cx1, cz1] = [Math.min(cx0, chunkCx(dims, c)), Math.min(cz0, chunkCz(dims, c)), Math.max(cx1, chunkCx(dims, c)), Math.max(cz1, chunkCz(dims, c))];
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
  const [kind, yaw, x, y, z] = [new Uint16Array(n), new Uint16Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lost = area.some((c) => gone(c) !== null) ? new Uint8Array(n) : null;
  let at = 0;
  for (const c of area) {
    const [from, to] = [city.first[c]!, city.first[c + 1]!];
    kind.set(city.kind.subarray(from, to), at);
    yaw.set(city.yaw.subarray(from, to), at);
    x.set(city.x.subarray(from, to), at);
    y.set(city.y.subarray(from, to), at);
    z.set(city.z.subarray(from, to), at);
    const g = gone(c);
    if (g) lost!.set(g, at);
    at += to - from;
  }
  // A piece's faces lie well within a chunk of its own; a chunk round the tile's is sent.
  const i0 = Math.max(0, Math.floor(((cx0 - 1) * CHUNK_SIZE) / hf.cell));
  const j0 = Math.max(0, Math.floor(((cz0 - 1) * CHUNK_SIZE) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.floor(((cx1 + 2) * CHUNK_SIZE) / hf.cell) + 1);
  const j1 = Math.min(hf.nz - 1, Math.floor(((cz1 + 2) * CHUNK_SIZE) / hf.cell) + 1);
  const { gap, least, cell, tall } = level;
  return { id, gap, least, cell, tall, chunks: Int32Array.from(chunks), ox, oy, oz, area: Int32Array.from(area), counts, kind, yaw, x, y, z, gone: lost, i0, j0, w: i1 - i0 + 1, heights: hf.window(i0, j0, i1, j1) };
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
    // The pieces sent, as the map's columns hold them: chunk c's from first[c], and none in a chunk not sent.
    const first = new Uint32Array(chunkCount(k.dims) + 1);
    let at = 0;
    let c = 0;
    for (let a = 0; a < job.area.length; a++) {
      for (const end = job.area[a]!; c <= end; c++) first[c] = at;
      at += job.counts[a]!;
    }
    first.fill(at, c);
    const { kind, yaw, x, y, z } = job;
    this.city = { dims: k.dims, first, kind, yaw, x, y, z, halfX: k.halfX, halfY: k.halfY, halfZ: k.halfZ, color: k.color, plain: k.plain, walked: k.walked, look: k.look, count: kind.length, in: (chunk: number) => first[chunk + 1]! - first[chunk]! };
    this.ground = new HeightWindow({ ...k.ground, i0: job.i0, j0: job.j0, w: job.w, heights: job.heights });
    this.gone = (chunk) => (job.gone ? job.gone.subarray(first[chunk]!, first[chunk + 1]!) : null);
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
    const verts = faces * 4;
    const indexBytes = verts > 65535 ? 4 : 2;
    const start = (faces * 6 * indexBytes + 3) & ~3;
    const data = new Uint8Array(start + verts * VERTEX_BYTES);
    const index = indexBytes === 4 ? new Uint32Array(data.buffer, 0, faces * 6) : new Uint16Array(data.buffer, 0, faces * 6);
    const view = new DataView(data.buffer);
    const [ce, h] = [k.center, k.half];
    const q = (v: number, a: number): number => Math.max(-32767, Math.min(32767, Math.round(((v - ce[a]!) / h[a]!) * 32767)));
    const first = new Uint32Array(parts.length);
    const count = new Uint32Array(parts.length);
    let v = 0;
    let n = 0;
    parts.forEach((part, r) => {
      const chunk = job.chunks[r]!;
      const dx = chunkCx(k.dims, chunk) * CHUNK_SIZE - job.ox;
      const dz = chunkCz(k.dims, chunk) * CHUNK_SIZE - job.oz;
      first[r] = n;
      count[r] = part.faces * 6;
      const { pos, color } = part;
      for (let f = 0; f < part.faces; f++, v += 4) {
        index[n++] = v;
        index[n++] = v + 1;
        index[n++] = v + 2;
        index[n++] = v;
        index[n++] = v + 2;
        index[n++] = v + 3;
        for (let e = 0; e < 4; e++) {
          const o = start + (v + e) * VERTEX_BYTES;
          const p = (f * 4 + e) * 3;
          view.setInt16(o, q(pos[p]! + dx, 0), true);
          view.setInt16(o + 2, q(pos[p + 1]! - job.oy, 1), true);
          view.setInt16(o + 4, q(pos[p + 2]! + dz, 2), true);
          data[o + 6] = color[f]!;
        }
      }
    });
    return { id: job.id, data, indexBytes, first, count };
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
