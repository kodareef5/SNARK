// The sun's shadow past the cascades (shadowtext.ts): a map over the whole map of the height under which the sun is hidden,
// swept along the sun over the ground and the tops of the city's standing pieces, which a lit program compares a pixel's
// height with. A city's shadow at a distance is the shadow of its outline: a building is the column of its 4 m cells'
// tops (shared/world/city.ts cityTops) down to the ground, so an open frame of floors casts as a solid and nothing shades
// a street from under a roof. The cascades still draw the truth near the camera.
//
// - Solid heights: a map's 4 m cells, each the ground at its middle or the top of the pieces standing in it, made once the
//   statics come, a chunk made again when a piece of it that stood is gone.
// - The sweep: lines along the sun, one through each cell of a column, each keeping the highest the sun is hidden at as
//   it crosses the columns away from the sun, lower by the sun's climb at each. A cell takes the line nearest its middle
//   before that line meets the cell itself, so a cell never shades itself. Made again when the tallest shadow's tip would
//   have moved half a cell.
// - The map is a 16-bit layer of the shadow array after the cascades', stored as depth from a ceiling FAR_SPAN over the
//   ground's floor, so a compared lookup with LEQUAL says lit where a pixel stands at or over it, filtered by the card.
//
// It is swept where the far city's levels are made (citymake.ts), on a worker in the browser, and here in tests and tools.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { cityTops, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import { Heightfield } from "../../../shared/world/heightfield.ts";
import { TACTICAL_CELL, farTopMetres } from "../../../shared/world/tactical.ts";
import type { CityKinds, CityMaker } from "./citymake.ts";
import { FRAME, type FramePacket } from "./packet.ts";

/** Metres a side of the cells solid heights are made in: the tops' own (shared/world/tactical.ts). */
export const TOP_CELL = TACTICAL_CELL;
const SIDE = CHUNK_SIZE / TOP_CELL;
/** Metres over the ground's floor (Heightfield minY) the map's heights reach: 16-bit steps of 3.1 cm. */
export const FAR_SPAN = 2048;
const UNIT = FAR_SPAN / 65535;
/**
 * Where a lookup is taken, in the map's cells: moved out across the ground along a surface's normal, and toward the
 * sun along its rays, so a wall meets the street before it and not its own building's cells, and the ground the cell
 * before its own. A wall stands in the outermost of its building's cells (cityTops fills a cell whose middle a piece
 * grown by half a cell reaches), within half a cell of its middle, so a cell and a half out leaves the filter's reach.
 */
export const FAR_OUT = 1.5;
export const FAR_LEAD = 1;
/** Metres a lookup is raised: half the coarsest step of a top (tactical.ts farTopByte), which may stand over what is drawn. */
export const FAR_RISE = 1;
/** The least of the sun's way along the ground a lookup's lead is divided by, so it stays finite with the sun overhead. */
export const FLAT_LEAST = 0.05;
/**
 * In cells: the map is made again when its tallest shadow's tip would lie this far from where the map has it, and is
 * looked up while it lies within the second, as it is when the sun comes up on yesterday's.
 */
export const REMAKE = 0.5;
export const STALE = 2;

/** The cell of the far map of a map of `dims` on a layer `size` texels a side: TOP_CELL, or a multiple of it where the map is wider. */
export function farCell(dims: MapDims, size: number): number {
  return TOP_CELL * Math.max(1, Math.ceil((Math.max(dims.chunksX, dims.chunksZ) * SIDE) / size));
}

/** Metres over the floor as the map's 16-bit steps. */
const units = (m: number): number => Math.max(0, Math.min(65535, Math.round(m / UNIT)));

/**
 * Writes the solid heights of `chunk`'s cells into `out`, a map's TOP_CELL cells `SIDE * chunksX` a row, in UNITs over
 * `floor`: the ground at each cell's middle, and the top `tops` gives a cell (cityTops), if any, over that.
 */
export function chunkSolid(out: Uint16Array, dims: MapDims, floor: number, chunk: number, tops: Uint8Array | null, ground: Pick<Heightfield, "heightAt">): void {
  const row = dims.chunksX * SIDE;
  const i0 = chunkCx(dims, chunk) * SIDE, j0 = chunkCz(dims, chunk) * SIDE;
  for (let c = 0; c < SIDE * SIDE; c++) {
    const i = i0 + (c % SIDE), j = j0 + Math.floor(c / SIDE);
    const g = ground.heightAt((i + 0.5) * TOP_CELL, (j + 0.5) * TOP_CELL);
    out[j * row + i] = units((tops && tops[c]! > 0 ? g + farTopMetres(tops[c]!) : g) - floor);
  }
}

/** A map's solid heights: every chunk's, its pieces gone as `gone` says left out. */
export function makeSolid(city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone): Uint16Array {
  const out = new Uint16Array(city.dims.chunksX * city.dims.chunksZ * SIDE * SIDE);
  for (let c = 0; c < chunkCount(city.dims); c++) chunkSolid(out, city.dims, hf.minY, c, city.in(c) > 0 ? cityTops(city, c, hf, gone(c)) : null, hf);
  return out;
}

/** Scratch for a sweep over cells coarser than TOP_CELL, and its lines. */
let pooled = new Uint16Array(0);
let lines = new Float64Array(0);

/**
 * Sweeps the far map for a unit vector toward the sun into `out`, `size` texels a side: texel (i, j) the cell of
 * `k` TOP_CELL cells a side from (i, j) times that, its swept height as depth from the ceiling, 65535 for none and for
 * texels past the map. `solid` is `nx` by `nz` TOP_CELL cells, a coarse cell taking the highest of its own. Returns how
 * far the highest solid stands over the lowest, in metres.
 */
export function sweep(solid: Uint16Array, nx: number, nz: number, k: number, size: number, sx: number, sy: number, sz: number, out: Uint16Array): number {
  const gx = Math.ceil(nx / k), gz = Math.ceil(nz / k);
  let grid = solid;
  if (k > 1) {
    if (pooled.length < gx * gz) pooled = new Uint16Array(gx * gz);
    grid = pooled;
    grid.fill(0, 0, gx * gz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const at = Math.floor(j / k) * gx + Math.floor(i / k);
        if (solid[j * nx + i]! > grid[at]!) grid[at] = solid[j * nx + i]!;
      }
    }
  }
  let lo = 65535, hi = 0;
  for (let c = 0; c < gx * gz; c++) {
    if (grid[c]! < lo) lo = grid[c]!;
    if (grid[c]! > hi) hi = grid[c]!;
  }
  out.fill(65535);
  const flat = Math.hypot(sx, sz);
  if (sy <= 0 || flat < 1e-9) return (hi - lo) * UNIT;
  // Columns cross the axis the sun lies most along, from its side; a line moves `slope` cells across a column.
  const alongX = Math.abs(sx) >= Math.abs(sz);
  const a = alongX ? sx : sz, b = alongX ? sz : sx;
  const major = alongX ? gx : gz, minor = alongX ? gz : gx;
  const slope = b / a;
  const drop = (TOP_CELL * k * sy) / Math.abs(a) / UNIT;
  // Steps through `grid` and `out` along a column (i) and across it (j).
  const di = alongX ? 1 : gx, dj = alongX ? gx : 1;
  const oi = alongX ? 1 : size, oj = alongX ? size : 1;
  const span = minor + 2 * major;
  if (lines.length < span) lines = new Float64Array(span);
  lines.fill(-Infinity, 0, span);
  for (let n = 0; n < major; n++) {
    const i = a > 0 ? major - 1 - n : n;
    // The cells of column i are on lines j + q: the line nearest each one's middle.
    const q = Math.round(-slope * i) + major;
    for (let j = 0; j < minor; j++) {
      const h = lines[j + q]!;
      out[i * oi + j * oj] = h <= 0 ? 65535 : h >= 65535 ? 0 : 65535 - Math.round(h);
      const s = grid[i * di + j * dj]!;
      lines[j + q] = (h > s ? h : s) - drop;
    }
  }
  return (hi - lo) * UNIT;
}

/** How far the tip of a shadow cast `rise` metres down moves between suns `a` and `b`, unit vectors toward them, in metres. */
export function tipMoves(a: ArrayLike<number>, b: ArrayLike<number>, rise: number): number {
  if (a[1]! <= 0 || b[1]! <= 0) return Infinity;
  return rise * Math.hypot(a[0]! / a[1]! - b[0]! / b[1]!, a[2]! / a[1]! - b[2]! / b[1]!);
}

/**
 * How much of the sun the far map gives a camera-relative point with that normal, 0 to 1: the twin of SHADOW_GLSL's
 * `farShadow`, a compared lookup filtered over the four texels about it. `map` is the layer, `size` a side, and the
 * frame block says where the camera is on it and where the sun is.
 */
export function farLookup(map: Uint16Array, size: number, frame: Float32Array, rx: number, ry: number, rz: number, nx: number, nz: number): number {
  const scale = frame[FRAME.farScale]!;
  if (scale <= 0) return 1;
  const sx = -frame[FRAME.moon]!, sy = -frame[FRAME.moon + 1]!, sz = -frame[FRAME.moon + 2]!;
  const lead = FAR_LEAD / (scale * Math.max(Math.hypot(sx, sz), FLAT_LEAST));
  const px = rx + (nx * FAR_OUT) / scale + sx * lead, py = ry + sy * lead, pz = rz + (nz * FAR_OUT) / scale + sz * lead;
  const tx = px * scale + frame[FRAME.farAt]!, tz = pz * scale + frame[FRAME.farAt + 1]!;
  const ref = Math.max(0, Math.min(1, frame[FRAME.farDepth]! - (py + FAR_RISE) / FAR_SPAN));
  const bx = Math.floor(tx - 0.5), bz = Math.floor(tz - 0.5);
  const fx = tx - 0.5 - bx, fz = tz - 0.5 - bz;
  const lit = (i: number, j: number): number => (ref <= map[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))]! / 65535 ? 1 : 0);
  return (lit(bx, bz) * (1 - fx) + lit(bx + 1, bz) * fx) * (1 - fz) + (lit(bx, bz + 1) * (1 - fx) + lit(bx + 1, bz + 1) * fx) * fz;
}

/** A sweep asked of where levels are made. */
export interface SweepJob {
  readonly id: number;
  /** The map's solid heights, or null to make them first from `make`. */
  readonly solid: Uint16Array | null;
  readonly make: SolidJob | null;
  /** Cells pooled a side, the layer's side, and the sun. */
  readonly k: number;
  readonly size: number;
  readonly sun: readonly number[];
}

/** What a map's solid heights are made from on another thread: its statics as CityStatics holds them, which are gone, and its ground. */
export interface SolidJob {
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** A byte a piece, 1 for gone, or null for none. */
  readonly gone: Uint8Array | null;
  readonly heights: Uint16Array;
}

export interface SweepMade {
  readonly id: number;
  readonly solid: Uint16Array;
  readonly map: Uint16Array;
  /** How far its highest solid stands over its lowest, in metres. */
  readonly rise: number;
}

/** Every buffer of a sweep or what it made, to move it to another thread rather than copy it. */
export function sweepBuffers(m: SweepJob | SweepMade): ArrayBuffer[] {
  const all = "map" in m ? [m.solid, m.map] : [m.solid, m.make?.first, m.make?.kind, m.make?.yaw, m.make?.x, m.make?.y, m.make?.z, m.make?.gone, m.make?.heights];
  return all.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}

/** Does a sweep, on any thread: makes the solid heights first where it was sent them to make from, for a city of `kinds`. */
export function doSweep(kinds: CityKinds, job: SweepJob): SweepMade {
  const d = kinds.dims;
  let solid = job.solid;
  if (!solid) {
    const m = job.make!;
    const { first, kind, yaw, x, y, z } = m;
    const city: CityStatics = { dims: d, first, kind, yaw, x, y, z, halfX: kinds.halfX, halfY: kinds.halfY, halfZ: kinds.halfZ, color: kinds.color, plain: kinds.plain, walked: kinds.walked, look: kinds.look, count: kind.length, in: (c: number) => first[c + 1]! - first[c]! };
    const g = kinds.ground;
    const hf = new Heightfield(d, g.cell, g.minY, g.stepY, m.heights, new Uint8Array(0));
    solid = makeSolid(city, hf, (c) => (m.gone ? m.gone.subarray(first[c]!, first[c + 1]!) : null));
  }
  const map = new Uint16Array(job.size * job.size);
  const rise = sweep(solid, d.chunksX * SIDE, d.chunksZ * SIDE, job.k, job.size, job.sun[0]!, job.sun[1]!, job.sun[2]!, map);
  return { id: job.id, solid, map, rise };
}

/** What stands of the map's pieces, as the far city follows it (farcity.ts goneOf, goneVersion, topsOf). */
export interface Standing {
  goneOf(chunk: number): Gone;
  readonly goneVersion: Uint32Array;
  topsOf(chunk: number): Uint8Array | null;
}

/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

/**
 * The far map of one map's city: made and swept where `maker` makes the far city's levels, else here, and put on the
 * card a frame's allowance of rows at a time. A map is looked up once all of it is on the card, while its sun is near
 * enough the one in the sky.
 */
export class FarShadow {
  /** Sweeps made, and the last one's milliseconds where it was made here. */
  readonly stats = { sweeps: 0, ms: 0 };
  private readonly city: CityStatics;
  private readonly hf: Heightfield;
  private readonly standing: Standing;
  private readonly maker: CityMaker | null;
  /** The solid heights, while they are here and not away being swept; and whether they have been made. */
  private solid: Uint16Array | null = null;
  private made = false;
  private away = false;
  private asked = 0;
  /** goneVersion as the solid heights last took it, and the chunks to make again. */
  private readonly seen: Uint32Array;
  private readonly changed: number[] = [];
  /** The latest map, with the sun, cell, side and rise it was made for; and the sun, cell and side of the one asked for. */
  private map: Uint16Array | null = null;
  private readonly mapSun = new Float64Array(3);
  private mapCell = 0;
  private mapSize = 0;
  private mapRise = 0;
  private readonly askedSun = new Float64Array(3);
  private askedCell = 0;
  private askedSize = 0;
  /** The layer: its side and the cascades before it, the next row of the latest map to put on it, and the last map wholly on it. */
  private layerSize = 0;
  private layerAt = -1;
  private row = 0;
  private onCard = false;
  private readonly cardSun = new Float64Array(3);
  private cardCell = 0;
  private cardRise = 0;

  constructor(city: CityStatics, hf: Heightfield, standing: Standing, maker: CityMaker | null) {
    this.city = city;
    this.hf = hf;
    this.standing = standing;
    this.maker = maker?.sweep && maker.swept ? maker : null;
    this.seen = new Uint32Array(chunkCount(city.dims));
  }

  /** After a lost context: the layer is empty, and the latest map goes on it again. */
  reset(): void {
    this.layerSize = 0;
  }

  /**
   * Each frame, with the unit vector toward the sun while it casts, else null: makes the map again where it is due, puts
   * rows of it on the card from `budget`'s allowance, and says in the frame block where the camera (cx, cy, cz) is on it,
   * or that there is none to look up. A frame with no shadow array on the card, as low poly's, leaves the layer empty.
   */
  update(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, cx: number, cy: number, cz: number, sun: ArrayLike<number> | null): void {
    const f = p.frame;
    f[FRAME.farScale] = 0;
    const { cascades, size } = p.tier.shadows;
    if (!p.lit || cascades <= 0 || size <= 0) {
      this.layerSize = 0;
      return;
    }
    if (size !== this.layerSize || cascades !== this.layerAt) {
      this.layerSize = size;
      this.layerAt = cascades;
      this.row = 0;
      this.onCard = false;
    }
    if (!sun) return;
    const cell = farCell(this.city.dims, size);
    this.take();
    this.follow();
    if (!this.away && (!this.map || this.changed.length > 0 || this.mapCell !== cell || tipMoves(this.mapSun, sun, this.mapRise) >= REMAKE * cell)) this.ask(cell, size, sun);
    this.take();
    this.upload(p, budget);
    if (!this.onCard || tipMoves(this.cardSun, sun, this.cardRise) > STALE * this.cardCell) return;
    f[FRAME.farAt] = cx / this.cardCell;
    f[FRAME.farAt + 1] = cz / this.cardCell;
    f[FRAME.farScale] = 1 / this.cardCell;
    f[FRAME.farDepth] = (this.hf.minY + FAR_SPAN - cy) / FAR_SPAN;
  }

  /** Notes the chunks a piece of which has gone since they were last made, and makes them again while the solid heights are here. */
  private follow(): void {
    const version = this.standing.goneVersion;
    for (let c = 0; c < version.length; c++) {
      if (version[c] === this.seen[c]) continue;
      this.seen[c] = version[c]!;
      if (this.made) this.changed.push(c);
    }
    const solid = this.solid;
    if (!solid) return;
    for (const c of this.changed) chunkSolid(solid, this.city.dims, this.hf.minY, c, this.standing.topsOf(c), this.hf);
  }

  private ask(cell: number, size: number, sun: ArrayLike<number>): void {
    this.changed.length = 0;
    this.away = true;
    this.askedSun[0] = sun[0]!;
    this.askedSun[1] = sun[1]!;
    this.askedSun[2] = sun[2]!;
    this.askedCell = cell;
    this.askedSize = size;
    const job: SweepJob = { id: ++this.asked, solid: this.made ? this.solid : null, make: this.made ? null : this.solidJob(), k: cell / TOP_CELL, size, sun: Array.from(sun) };
    this.solid = null;
    this.made = true;
    if (this.maker) {
      this.maker.sweep!(job);
      return;
    }
    const start = clock();
    const solid = job.solid ?? makeSolid(this.city, this.hf, (c) => this.standing.goneOf(c));
    const map = new Uint16Array(size * size);
    const rise = sweep(solid, this.city.dims.chunksX * SIDE, this.city.dims.chunksZ * SIDE, job.k, size, sun[0]!, sun[1]!, sun[2]!, map);
    this.stats.ms = clock() - start;
    this.got({ id: job.id, solid, map, rise });
  }

  /** What the solid heights are made from, copied to go to another thread: here they are made from the city as it is. */
  private solidJob(): SolidJob | null {
    if (!this.maker) return null;
    const c = this.city;
    let gone: Uint8Array | null = null;
    for (let k = 0; k < chunkCount(c.dims); k++) {
      const g = this.standing.goneOf(k);
      if (g) (gone ??= new Uint8Array(c.count)).set(g, c.first[k]!);
    }
    return { first: c.first.slice(), kind: c.kind.slice(), yaw: c.yaw.slice(), x: c.x.slice(), y: c.y.slice(), z: c.z.slice(), gone, heights: this.hf.heights.slice() };
  }

  private take(): void {
    const made = this.maker?.swept!() ?? null;
    if (made) this.got(made);
  }

  private got(made: SweepMade): void {
    this.solid = made.solid;
    this.away = false;
    if (made.id !== this.asked) return;
    this.map = made.map;
    this.mapSun.set(this.askedSun);
    this.mapCell = this.askedCell;
    this.mapSize = this.askedSize;
    this.mapRise = made.rise;
    this.row = 0;
    this.stats.sweeps++;
  }

  /** Rows of the latest map onto the layer, as many as the frame's allowance has room for. */
  private upload(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }): void {
    const map = this.map, size = this.mapSize;
    if (!map || size !== this.layerSize || this.row >= size) return;
    const rows = Math.min(size - this.row, Math.floor(budget.left / (size * 2)));
    if (rows <= 0) return;
    p.farMap = map;
    p.farRow = this.row;
    p.farRows = rows;
    budget.spend(rows * size * 2);
    this.row += rows;
    if (this.row < size) return;
    this.onCard = true;
    this.cardSun.set(this.mapSun);
    this.cardCell = this.mapCell;
    this.cardRise = this.mapRise;
  }
}
