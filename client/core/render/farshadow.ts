// The sun's shadow past the cascades (shadowtext.ts): a map over the whole map of the height under which the sun is hidden,
// swept along the sun over the ground and the tops of the city's standing pieces, which a lit program compares a pixel's
// height with past the cascades, and within them for what stands past the chunks the near store holds, whose pieces cast
// into them. A city's shadow at a distance is the shadow of its outline: a building is the column of its 4 m cells' tops
// (shared/world/city.ts cityTops) down to the ground, so an open frame of floors casts as a solid and nothing shades a
// street from under a roof. The cascades still draw the truth near the camera.
//
// - Solid heights: over each cell of the far map's grid (farCell, TOP_CELL cells pooled), the highest of its 4 m cells,
//   each the ground at its middle or the top of the pieces standing in it, and the mean of their ground. A chunk's tops
//   are the map's own (mapfile.ts MapTops, as they come), what the far city says stands once a piece of it is gone, and
//   its statics' only where those are held and it has a piece that floats (city.ts floatingKinds, which casts nothing)
//   or a landmark's (which hides no sky). They are made on the page a few chunks a frame, and a chunk is made again when
//   its tops come, its ground comes or a piece of it that stood is gone. Nothing of the city or the ground is copied.
// - The sweep: lines along the sun, one through each cell of a column, each keeping the highest the sun is hidden at as
//   it crosses the columns away from the sun, lower by the sun's climb at each. A cell takes the line nearest its middle
//   before that line meets the cell itself, so a cell never shades itself. Made again when the tallest shadow's tip would
//   have moved half a cell.
// - The map is a 16-bit layer of the shadow array after the cascades', stored as depth from a ceiling FAR_SPAN over the
//   ground's floor, so a compared lookup with LEQUAL says lit where a pixel stands at or over it, filtered by the card.
//   It is let go once it is all on the card, and swept again where the card loses it.
//
// It is swept where the far city's levels are made (citymake.ts), on a worker in the browser, and here in tests and tools,
// and the sky's openness (skyopen.ts) is made there from the same solid heights and the ground under them. The camera's
// place on the grid is in the frame block whenever a lit frame has one, for the openness, and the far map is looked up
// only where its texels a metre are positive.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { cityTops, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { TACTICAL_CELL, farTopMetres } from "../../../shared/world/tactical.ts";
import type { HeldTops } from "./blocks.ts";
import type { CityMaker } from "./citymake.ts";
import { CAST_AT, FRAME, ROOF_AT, type FramePacket } from "./packet.ts";
import { SkyOpen, openMeasure, type OpenMap } from "./skyopen.ts";
import type { RoofMap } from "./roofmap.ts";
import type { TopFix } from "./topfix.ts";

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
/**
 * Chunks of solid heights made a frame, the same whatever the machine: about 2 ms on the Linux box under load, so
 * Miami's 65,025 are made in about 500 frames.
 */
export const SOLID_CHUNKS = 128;

/** The cell of the far map of a map of `dims` on a layer `size` texels a side: TOP_CELL, or a multiple of it where the map is wider. */
export function farCell(dims: MapDims, size: number): number {
  return TOP_CELL * Math.max(1, Math.ceil((Math.max(dims.chunksX, dims.chunksZ) * SIDE) / size));
}

/** Metres over the floor as the map's 16-bit steps. */
const units = (m: number): number => Math.max(0, Math.min(65535, Math.round(m / UNIT)));

/**
 * Writes the solid heights of `chunk`'s cells into `out`, a map's TOP_CELL cells `SIDE * chunksX` a row, in UNITs over
 * `floor`: the ground at each cell's middle, and the top `tops` gives a cell (cityTops), if any, over that; and the
 * ground alone into `under`, where given. The far shadow's own cells are these pooled (FarShadow); tests and tools take these.
 */
export function chunkSolid(out: Uint16Array, dims: MapDims, floor: number, chunk: number, tops: Uint8Array | null, ground: Pick<Heightfield, "heightAt">, under?: Uint16Array): void {
  const row = dims.chunksX * SIDE;
  const i0 = chunkCx(dims, chunk) * SIDE, j0 = chunkCz(dims, chunk) * SIDE;
  for (let c = 0; c < SIDE * SIDE; c++) {
    const i = i0 + (c % SIDE), j = j0 + Math.floor(c / SIDE);
    const g = ground.heightAt((i + 0.5) * TOP_CELL, (j + 0.5) * TOP_CELL);
    out[j * row + i] = units((tops && tops[c]! > 0 ? g + farTopMetres(tops[c]!) : g) - floor);
    if (under) under[j * row + i] = units(g - floor);
  }
}

/** A map's solid heights at TOP_CELL from its statics, every chunk's, its pieces gone as `gone` says left out; its ground into `under`, where given. */
export function makeSolid(city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, under?: Uint16Array): Uint16Array {
  const out = new Uint16Array(city.dims.chunksX * city.dims.chunksZ * SIDE * SIDE);
  for (let c = 0; c < chunkCount(city.dims); c++) chunkSolid(out, city.dims, hf.minY, c, city.in(c) > 0 ? cityTops(city, c, hf, gone(c)) : null, hf, under);
  return out;
}

/** Scratch for a sweep over cells coarser than TOP_CELL, and its lines. */
let pooled = new Uint16Array(0);
let lines = new Float64Array(0);

/**
 * Sweeps the far map for a unit vector toward the sun into `out`, `size` texels a side: texel (i, j) the cell of
 * `k` cells a side from (i, j) times that, its swept height as depth from the ceiling, 65535 for none and for texels
 * past the map. `solid` is `nx` by `nz` cells `cell` metres a side, a coarse cell taking the highest of its own. Returns
 * how far the highest solid stands over the lowest, in metres.
 */
export function sweep(solid: Uint16Array, nx: number, nz: number, k: number, size: number, sx: number, sy: number, sz: number, out: Uint16Array, cell = TOP_CELL): number {
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
  const drop = (cell * k * sy) / Math.abs(a) / UNIT;
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
 * frame block says where the camera is on it and where the light the cascades are cast from is (fCast: the sun by day,
 * the moon by night, which the map is then swept toward).
 */
export function farLookup(map: Uint16Array, size: number, frame: Float32Array, rx: number, ry: number, rz: number, nx: number, nz: number): number {
  const scale = frame[FRAME.farScale]!;
  if (scale <= 0) return 1;
  const sx = frame[CAST_AT]!, sy = frame[CAST_AT + 1]!, sz = frame[CAST_AT + 2]!;
  const lead = FAR_LEAD / (scale * Math.max(Math.hypot(sx, sz), FLAT_LEAST));
  const px = rx + (nx * FAR_OUT) / scale + sx * lead, py = ry + sy * lead, pz = rz + (nz * FAR_OUT) / scale + sz * lead;
  const tx = px * scale + frame[FRAME.farAt]!, tz = pz * scale + frame[FRAME.farAt + 1]!;
  const ref = Math.max(0, Math.min(1, frame[FRAME.farDepth]! - (py + FAR_RISE) / FAR_SPAN));
  const bx = Math.floor(tx - 0.5), bz = Math.floor(tz - 0.5);
  const fx = tx - 0.5 - bx, fz = tz - 0.5 - bz;
  const lit = (i: number, j: number): number => (ref <= map[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))]! / 65535 ? 1 : 0);
  return (lit(bx, bz) * (1 - fx) + lit(bx + 1, bz) * fx) * (1 - fz) + (lit(bx, bz + 1) * (1 - fx) + lit(bx + 1, bz + 1) * fx) * fz;
}

/**
 * How far along the ground from a camera-relative point toward the sun its ray leaves the box of the chunks the near
 * store holds whole (FRAME nearFromX and the rest), where it meets that box, else 0: within the cascades the far map is
 * looked up that far on along the ray, past what casts into them. The twin of SHADOW_GLSL's `farBeyond`.
 */
export function nearLead(frame: Float32Array, rx: number, rz: number): number {
  const sx = frame[CAST_AT]!, sz = frame[CAST_AT + 2]!;
  const flat = Math.max(Math.hypot(sx, sz), FLAT_LEAST);
  let dx = sx / flat, dz = sz / flat;
  if (Math.abs(dx) < 1e-6) dx = 1e-6;
  if (Math.abs(dz) < 1e-6) dz = 1e-6;
  const x0 = frame[FRAME.nearFromX]!, z0 = frame[FRAME.nearFromZ]!, x1 = frame[FRAME.nearToX]!, z1 = frame[FRAME.nearToZ]!;
  if (x0 > x1) return 0;
  const ax = (x0 - rx) / dx, bx = (x1 - rx) / dx, az = (z0 - rz) / dz, bz = (z1 - rz) / dz;
  const leave = Math.min(Math.max(ax, bx), Math.max(az, bz));
  return leave >= Math.max(Math.min(ax, bx), Math.min(az, bz), 0) ? leave : 0;
}

/**
 * The twin of `farBeyond`: the far map looked up for a camera-relative point within the cascades, past the near store's
 * chunks along its ray to the sun.
 */
export function farBeyondLookup(map: Uint16Array, size: number, frame: Float32Array, rx: number, ry: number, rz: number, nx: number, nz: number): number {
  const sx = frame[CAST_AT]!, sy = frame[CAST_AT + 1]!, sz = frame[CAST_AT + 2]!;
  const along = nearLead(frame, rx, rz) / Math.max(Math.hypot(sx, sz), FLAT_LEAST);
  return farLookup(map, size, frame, rx + sx * along, ry + sy * along, rz + sz * along, nx, nz);
}

/** A sweep asked of where levels are made: the solid heights and their ground, nothing else of the map. */
export interface SweepJob {
  readonly id: number;
  /** The grid's solid heights and the mean of its ground, `w` by `h` cells `cell` metres a side. */
  readonly solid: Uint16Array;
  readonly ground: Uint16Array;
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  /** The cells whose heights the sky's openness takes otherwise, a landmark's pieces left out, and those heights; null for none. */
  readonly bareAt: Uint32Array | null;
  readonly bareTo: Uint16Array | null;
  /** The layer's side, and the sun, or null for no map. */
  readonly size: number;
  readonly sun: readonly number[] | null;
  /** Whether the sky's openness is made too (skyopen.ts openMeasure). */
  readonly open: boolean;
}

export interface SweepMade {
  readonly id: number;
  readonly solid: Uint16Array;
  readonly ground: Uint16Array;
  /** The map, or null where no sun was sent, and how far its highest solid stands over its lowest, in metres. */
  readonly map: Uint16Array | null;
  readonly rise: number;
  readonly open: OpenMap | null;
}

/** Every buffer of a sweep or what it made, to move it to another thread rather than copy it. */
export function sweepBuffers(m: SweepJob | SweepMade): ArrayBuffer[] {
  const all = "map" in m ? [m.solid, m.ground, m.map, m.open?.bytes] : [m.solid, m.ground, m.bareAt, m.bareTo];
  return all.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}

/** Does a sweep, on any thread. */
export function doSweep(job: SweepJob): SweepMade {
  const { solid, ground, w, h, cell } = job;
  const map = job.sun ? new Uint16Array(job.size * job.size) : null;
  const rise = job.sun ? sweep(solid, w, h, 1, job.size, job.sun[0]!, job.sun[1]!, job.sun[2]!, map!, cell) : 0;
  return { id: job.id, solid, ground, map, rise, open: job.open ? openOf(job) : null };
}

/** The sky's openness of a job's grid: from its solid heights, the cells it names taken at their bare heights. */
function openOf(job: SweepJob): OpenMap {
  let top = job.solid;
  if (job.bareAt && job.bareAt.length > 0) {
    top = job.solid.slice();
    for (let n = 0; n < job.bareAt.length; n++) top[job.bareAt[n]!] = job.bareTo![n]!;
  }
  return openMeasure(top, job.ground, job.w, job.h, 1, job.cell, UNIT);
}

/** What stands of the map's pieces, as the far city follows it (farcity.ts goneOf, goneVersion, topsOf). */
export interface Standing {
  goneOf(chunk: number): Gone;
  readonly goneVersion: Uint32Array;
  topsOf(chunk: number): Uint8Array | null;
}

/**
 * Chunks either side of the camera's looked at for those the near store holds whole: the server's window of three and
 * the one more it lets go at (server/game.ts structRadius), and room for a camera away from its body.
 */
const NEAR_SCAN = 6;

/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

/**
 * Milliseconds the map goes without another piece gone before it is swept again for those that went, and the longest it
 * waits while they keep going: a building that comes down wave by wave is swept for once, as the far city's tiles past
 * the eye's own are made (farcity.ts QUIET_FAR, WAIT_FAR).
 */
export const SWEEP_QUIET = 2000;
export const SWEEP_WAIT = 10000;

/** A chunk's tops as the solid heights take them and as the sky's openness does, null for none. */
interface ChunkTops {
  readonly solid: Uint8Array | null;
  readonly bare: Uint8Array | null;
}

/** A chunk's TOP_CELL cells in UNITs over the floor: solid heights, bare heights and ground; and whether any bare one differs. */
interface ChunkCells {
  readonly solid: Uint16Array;
  readonly bare: Uint16Array;
  readonly ground: Uint16Array;
  odd: boolean;
}

const cells = (): ChunkCells => ({ solid: new Uint16Array(SIDE * SIDE), bare: new Uint16Array(SIDE * SIDE), ground: new Uint16Array(SIDE * SIDE), odd: false });

/**
 * The far map of one map's city, and the sky's openness over it (skyopen.ts): its solid heights made here a few chunks a
 * frame, swept where `maker` makes the far city's levels, else here, and put on the card a frame's allowance of rows at a
 * time. A map is looked up once all of it is on the card, while its sun is near enough the one in the sky. It is made
 * from the map's tops and ground from the start and kept as the statics are handed over (`hand`).
 */
export class FarShadow {
  /** Sweeps made, and the last one's milliseconds where it was made here; chunks of solid heights made, and their milliseconds. */
  readonly stats = { sweeps: 0, ms: 0, chunks: 0, solidMs: 0 };
  /**
   * The sky's openness, made from the same solid heights, and what stands overhead round the camera, from the statics
   * once held, which the scene gives it from the late script (roofmap.ts), none until then.
   */
  readonly open = new SkyOpen();
  roof: RoofMap | null = null;
  /** Whether the last frame's tier takes the sky's light down under roofs. */
  private roofs = false;
  private readonly dims: MapDims;
  private readonly hf: Heightfield;
  private readonly tops: HeldTops | null;
  private readonly maker: CityMaker | null;
  private readonly held: (chunk: number) => boolean;
  /** 1 by content index for a kind a landmark brings, which hides no sky, and for one that stands in the air, which casts nothing. */
  private readonly own: Uint8Array | null;
  private readonly floating: Uint8Array | null;
  /** The statics and what stands of them, once handed over; the chunks of them with a piece that floats, and with a landmark's. */
  private statics: CityStatics | null = null;
  private standing: Standing | null = null;
  private readonly floats = new Set<number>();
  private readonly marks = new Set<number>();
  /** The statics' squares as last taken in (CityStatics.news). */
  private seenSquares = new Uint32Array(0);
  /** The tops made of what stands where the map's are wrong past the statics held, and their count of changes taken in. */
  fix: TopFix | null = null;
  private seenFix = 0;
  /** Chunks last made from what the far city says stands, made again when another far city takes over. */
  private readonly fromStanding = new Set<number>();
  /**
   * The grid's solid heights and its ground, while they are here and not away being swept; its TOP_CELL cells pooled a
   * side and its cells across and down; and the cells whose bare heights differ, which the openness takes.
   */
  private solid: Uint16Array | null = null;
  private ground: Uint16Array | null = null;
  private readonly bare = new Map<number, number>();
  /** Per chunk 1 where its bare heights differed when last made. */
  private readonly oddChunk: Uint8Array;
  private k = 0;
  private w = 0;
  private h = 0;
  /** Per chunk 1 while it waits to be made, how many wait, and where the making looks next. */
  private readonly dirty: Uint8Array;
  private pending = 0;
  private cursor = 0;
  /** Whether the whole grid is being made, as at first and for another cell, and whether it was ever all made. */
  private rebuild = false;
  private made = false;
  private away = false;
  private asked = 0;
  /** goneVersion, the tops' count of parts and each chunk's, and the ground's changes, as the solid heights last took them. */
  private seen: Uint32Array;
  private seenTops = 0;
  private readonly seenCame: Uint32Array;
  private seenGround = 0;
  /** Whether the map is to be swept again for chunks made since, and when the last and the first of them were. */
  private stale = false;
  private staleAt = 0;
  private staleFrom = 0;
  /** The latest map until it is all on the card, with the sun, cell, side and rise it was made for; and the sun, cell and side of the one asked for. */
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
  /** Scratch: the cells of a chunk being made, and with them those of the neighbours its grid's cells reach into. */
  private readonly own4 = cells();
  private readonly near4 = new Map<number, ChunkCells>();

  /**
   * `tops` are the map's tops as they come, or null for a map without; `held` says the near store holds a chunk whole,
   * whose pieces cast into the cascades; `own` is 1 for each kind a landmark of the map brings, whose pieces cast the
   * sun's shadow and hide no sky; `floating` is 1 for each kind that stands in the air with nothing under it (city.ts
   * floatingKinds), which casts no far shadow.
   */
  constructor(dims: MapDims, hf: Heightfield, tops: HeldTops | null, maker: CityMaker | null, held: (chunk: number) => boolean, own: Uint8Array | null = null, floating: Uint8Array | null = null) {
    this.dims = dims;
    this.hf = hf;
    this.tops = tops;
    this.maker = maker?.sweep && maker.swept ? maker : null;
    this.held = held;
    this.own = own;
    this.floating = floating;
    const chunks = chunkCount(dims);
    this.dirty = new Uint8Array(chunks);
    this.oddChunk = new Uint8Array(chunks);
    this.seen = new Uint32Array(chunks);
    this.seenCame = new Uint32Array(chunks);
  }

  /**
   * The map's statics, and the far city that follows what stands of them, handed over: those made from the far city before
   * are made again, and the squares of the statics as they are set in and let go (`follow`).
   */
  hand(statics: CityStatics, standing: Standing): void {
    for (const c of this.fromStanding) this.mark(c);
    this.fromStanding.clear();
    if (statics !== this.statics) {
      for (const c of this.floats) this.mark(c);
      for (const c of this.marks) this.mark(c);
      this.floats.clear();
      this.marks.clear();
      this.seenSquares = new Uint32Array(statics.size);
    }
    this.statics = statics;
    this.standing = standing;
    this.seen = new Uint32Array(this.dirty.length);
    this.follow();
  }

  /**
   * Takes in each square of the statics set in or let go since last: its chunks with a piece that floats or a landmark's
   * are made again, as are those that had one, and on a map without tops every chunk of it.
   */
  private follow(): void {
    const s = this.statics;
    s?.news(this.seenSquares, (sq, held) => {
      for (let cz = sq.cz0; cz < sq.cz1; cz++) {
        for (let cx = sq.cx0; cx < sq.cx1; cx++) {
          const c = cz * this.dims.chunksX + cx;
          const had = this.floats.delete(c), marked = this.marks.delete(c);
          if (had || marked || !this.tops) this.mark(c);
          const t = held ? s.rows(c) : null;
          for (let i = t?.from(c) ?? 0; t && i < t.to(c); i++) {
            if (this.floating?.[t.kind[i]!] === 1) this.floats.add(c);
            if (this.own?.[t.kind[i]!] === 1) this.marks.add(c);
          }
          if (this.floats.has(c) || this.marks.has(c)) this.mark(c);
        }
      }
    });
  }

  /**
   * Whether the sky's openness is all on the card and, on a tier with roofs, the map of what stands overhead round the
   * camera too, so that a frame is lit as it will go on being.
   */
  get whole(): boolean {
    return this.open.whole && (!this.roofs || (this.roof?.whole ?? false));
  }

  /** After a lost context: the layer and the openness's texture are empty, and each is made and put on the card again. */
  reset(): void {
    this.layerSize = 0;
    this.open.reset();
    this.roof?.reset();
  }

  /**
   * What stands of a chunk as the far map and the map of what stands overhead take it: as the far city follows it, and
   * with every piece that stands in the air with nothing under it (city.ts floatingKinds) taken as gone, since both are
   * made of columns from the ground up.
   */
  private readonly goneOf = (chunk: number): Gone => {
    const gone = this.standing?.goneOf(chunk) ?? null;
    return this.floats.has(chunk) ? this.leftOut(chunk, gone, this.floating!) : gone;
  };

  /** The pieces of `chunk` gone, or of a kind `kinds` names, a byte each. */
  private leftOut(chunk: number, gone: Gone, kinds: Uint8Array): Uint8Array {
    const t = this.statics!.rows(chunk)!;
    return Uint8Array.from(t.kind.subarray(t.from(chunk), t.to(chunk)), (k, i) => (kinds[k] === 1 || gone?.[i] === 1 ? 1 : 0));
  }

  /**
   * Each frame, with the unit vector toward the light the cascades are cast from while it casts (the sun, or the moon
   * by night), else null, and the scene's clock in milliseconds: makes chunks of the solid heights that wait, makes the
   * map and the openness again where they are due, puts rows of them on the card from `budget`'s allowance, and says in
   * the frame block where the camera (cx, cy, cz) is on their grid, and whether the map is to be looked up. A frame with
   * no shadow array on the card, as low poly's, leaves the layer empty; one with no shadow maps at all looks nothing up.
   * The map of what stands overhead lights its ground for `daySun`, the sun while it is the light that casts, else null.
   */
  update(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, cx: number, cy: number, cz: number, sun: ArrayLike<number> | null, now = 0, daySun = sun): void {
    const f = p.frame;
    f[FRAME.farScale] = 0;
    f[ROOF_AT + 3] = 0;
    this.roofs = p.lit && p.tier.roofs;
    if (this.roofs && this.statics) this.roof?.update(p, budget, this.statics, this.hf, this.goneOf, cx, cz, now, clock, daySun);
    const { cascades, size } = p.tier.shadows;
    if (!p.lit || size <= 0) {
      this.layerSize = 0;
      this.open.upload(p, budget, 0);
      return;
    }
    const cell = farCell(this.dims, size);
    if (cascades <= 0) this.layerSize = 0;
    else if (size !== this.layerSize || cascades !== this.layerAt) {
      this.layerSize = size;
      this.layerAt = cascades;
      this.row = 0;
      this.onCard = false;
    }
    const casts = cascades > 0 && sun !== null;
    this.take();
    this.follow();
    this.notice();
    if (!this.away) this.makeSome(cell / TOP_CELL, now);
    const quiet = this.stale && (now - this.staleAt >= SWEEP_QUIET || now - this.staleFrom >= SWEEP_WAIT);
    // A map let go once on the card is swept again where the card has lost it.
    const lost = this.mapSize > 0 && !this.map && !this.onCard;
    const swept = casts && (this.mapSize === 0 || lost || quiet || this.mapCell !== cell || this.mapSize !== size || tipMoves(this.mapSun, sun, this.mapRise) >= REMAKE * cell);
    const open = this.open.due(cell, now);
    if (!this.away && this.made && this.pending === 0 && this.k === cell / TOP_CELL && (swept || open)) this.ask(cell, size, swept ? sun : null, open, now);
    this.take();
    if (cascades > 0) this.upload(p, budget);
    this.open.upload(p, budget, cell);
    const looked = casts && this.onCard && tipMoves(this.cardSun, sun, this.cardRise) <= STALE * this.cardCell;
    const at = looked ? this.cardCell : cell;
    f[FRAME.farAt] = cx / at;
    f[FRAME.farAt + 1] = cz / at;
    f[FRAME.farScale] = (looked ? 1 : -1) / at;
    f[FRAME.farDepth] = (this.hf.minY + FAR_SPAN - cy) / FAR_SPAN;
    if (looked) this.near(f, cx, cz);
  }

  /** Writes the box of the chunks the near store holds whole about the camera, camera-relative, or one with none in it. */
  private near(f: Float32Array, cx: number, cz: number): void {
    const d = this.dims;
    const ci = Math.floor(cx / CHUNK_SIZE), cj = Math.floor(cz / CHUNK_SIZE);
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
    for (let j = Math.max(0, cj - NEAR_SCAN); j <= Math.min(d.chunksZ - 1, cj + NEAR_SCAN); j++) {
      for (let i = Math.max(0, ci - NEAR_SCAN); i <= Math.min(d.chunksX - 1, ci + NEAR_SCAN); i++) {
        if (!this.held(j * d.chunksX + i)) continue;
        i0 = Math.min(i0, i);
        j0 = Math.min(j0, j);
        i1 = Math.max(i1, i);
        j1 = Math.max(j1, j);
      }
    }
    const none = i0 > i1;
    f[FRAME.nearFromX] = none ? 1 : i0 * CHUNK_SIZE - cx;
    f[FRAME.nearFromZ] = none ? 1 : j0 * CHUNK_SIZE - cz;
    f[FRAME.nearToX] = none ? -1 : (i1 + 1) * CHUNK_SIZE - cx;
    f[FRAME.nearToZ] = none ? -1 : (j1 + 1) * CHUNK_SIZE - cz;
  }

  private mark(c: number): void {
    if (this.dirty[c] === 1) return;
    this.dirty[c] = 1;
    this.pending++;
  }

  /** Marks the chunks to make again: those a piece of which has gone, whose tops have come, or whose ground has changed. */
  private notice(): void {
    const version = this.standing?.goneVersion;
    let gone = false;
    for (let c = 0; version && c < version.length; c++) {
      if (version[c] === this.seen[c]) continue;
      this.seen[c] = version[c]!;
      this.mark(c);
      gone = true;
    }
    const fix = this.fix;
    if (fix && fix.version !== this.seenFix) {
      for (const [c, f] of fix.fixes) if (f.stamp > this.seenFix) this.mark(c);
      this.seenFix = fix.version;
    }
    if (gone && this.made) this.roof?.changed();
    const tops = this.tops;
    if (tops && tops.version !== this.seenTops) {
      this.seenTops = tops.version;
      for (let c = 0; c < this.seenCame.length; c++) {
        if (tops.came[c] === this.seenCame[c]) continue;
        this.seenCame[c] = tops.came[c]!;
        this.mark(c);
      }
    }
    const ch = this.hf.changes, d = this.dims;
    for (; this.seenGround < ch.length; this.seenGround += 4) {
      const x0 = Math.max(0, ch[this.seenGround]!), z0 = Math.max(0, ch[this.seenGround + 1]!);
      const x1 = Math.min(d.chunksX, ch[this.seenGround + 2]!), z1 = Math.min(d.chunksZ, ch[this.seenGround + 3]!);
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.mark(z * d.chunksX + x);
    }
  }

  /**
   * Makes up to SOLID_CHUNKS of the chunks that wait, on a grid of `k` TOP_CELL cells a cell, the whole grid again where
   * it is of another: the map is then swept for them once they have been quiet a moment (SWEEP_QUIET), and the openness
   * made again by its own rule.
   */
  private makeSome(k: number, now: number): void {
    if (this.k !== k) {
      const nx = this.dims.chunksX * SIDE, nz = this.dims.chunksZ * SIDE;
      this.k = k;
      this.w = Math.ceil(nx / k);
      this.h = Math.ceil(nz / k);
      this.solid = new Uint16Array(this.w * this.h);
      this.ground = new Uint16Array(this.w * this.h);
      this.bare.clear();
      this.oddChunk.fill(0);
      this.dirty.fill(1);
      this.pending = this.dirty.length;
      this.rebuild = true;
    }
    if (this.pending === 0) return;
    const start = clock();
    let n = 0;
    for (; this.pending > 0 && n < SOLID_CHUNKS; this.cursor++) {
      if (this.cursor >= this.dirty.length) this.cursor = 0;
      const c = this.cursor;
      if (this.dirty[c] === 0) continue;
      this.dirty[c] = 0;
      this.pending--;
      this.makeChunk(c);
      n++;
    }
    this.stats.chunks += n;
    this.stats.solidMs += clock() - start;
    if (this.made && !this.rebuild) {
      if (!this.stale) this.staleFrom = now;
      this.stale = true;
      this.staleAt = now;
      this.open.changed();
    }
    if (this.pending > 0) return;
    this.rebuild = false;
    this.made = true;
  }

  /**
   * The grid's cells chunk `chunk`'s TOP_CELL cells lie in, made again: each the highest of its TOP_CELL cells' solid
   * heights, and of their bare heights where those differ, and the mean of their ground, rounded, which is what a sweep
   * and the openness over TOP_CELL cells pooled to it take. A cell that reaches into the next chunk takes that one's too.
   */
  private makeChunk(chunk: number): void {
    const k = this.k, cx = this.dims.chunksX, w = this.w;
    const i0 = chunkCx(this.dims, chunk) * SIDE, j0 = chunkCz(this.dims, chunk) * SIDE;
    const own = this.cellsOf(chunk, this.own4);
    const solid = this.solid!, ground = this.ground!;
    if (SIDE % k === 0) {
      // A chunk's bare heights are looked at where they differ now or did when it was last made.
      const odd = own.odd || this.oddChunk[chunk] === 1;
      this.oddChunk[chunk] = own.odd ? 1 : 0;
      const os = own.solid, ob = own.bare, og = own.ground;
      for (let J = j0 / k; J < (j0 + SIDE) / k; J++) {
        for (let I = i0 / k; I < (i0 + SIDE) / k; I++) {
          let top = 0, bare = 0, sum = 0;
          for (let j = J * k - j0; j < J * k - j0 + k; j++) {
            for (let at = j * SIDE + I * k - i0, end = at + k; at < end; at++) {
              if (os[at]! > top) top = os[at]!;
              if (ob[at]! > bare) bare = ob[at]!;
              sum += og[at]!;
            }
          }
          solid[J * w + I] = top;
          ground[J * w + I] = Math.round(sum / (k * k));
          if (odd) this.bareCell(J * w + I, top, bare);
        }
      }
      return;
    }
    this.near4.clear();
    this.near4.set(chunk, own);
    const nx = cx * SIDE, nz = this.dims.chunksZ * SIDE;
    let last = chunk, t = own;
    for (let J = Math.floor(j0 / k); J < Math.min(this.h, Math.ceil((j0 + SIDE) / k)); J++) {
      for (let I = Math.floor(i0 / k); I < Math.min(w, Math.ceil((i0 + SIDE) / k)); I++) {
        let top = 0, bare = 0, sum = 0, n = 0;
        for (let j = J * k; j < Math.min(nz, J * k + k); j++) {
          const cj = Math.floor(j / SIDE);
          for (let i = I * k; i < Math.min(nx, I * k + k); i++) {
            const ci = Math.floor(i / SIDE), c = cj * cx + ci;
            if (c !== last) {
              last = c;
              const got = this.near4.get(c);
              if (got) t = got;
              else this.near4.set(c, (t = this.cellsOf(c, cells())));
            }
            const at = (j - cj * SIDE) * SIDE + (i - ci * SIDE);
            if (t.solid[at]! > top) top = t.solid[at]!;
            if (t.bare[at]! > bare) bare = t.bare[at]!;
            sum += t.ground[at]!;
            n++;
          }
        }
        solid[J * w + I] = top;
        ground[J * w + I] = Math.round(sum / n);
        this.bareCell(J * w + I, top, bare);
      }
    }
  }

  /** Keeps a cell's bare height where it differs from its solid height. */
  private bareCell(cell: number, top: number, bare: number): void {
    if (bare !== top) this.bare.set(cell, bare);
    else if (this.bare.size > 0) this.bare.delete(cell);
  }

  /** `chunk`'s TOP_CELL cells' solid heights, bare heights and ground, into `out`. */
  private cellsOf(chunk: number, out: ChunkCells): ChunkCells {
    const { solid, bare } = this.topsOf(chunk);
    const hf = this.hf, floor = hf.minY;
    const x0 = chunkCx(this.dims, chunk) * CHUNK_SIZE + TOP_CELL / 2, z0 = chunkCz(this.dims, chunk) * CHUNK_SIZE + TOP_CELL / 2;
    const odd = (out.odd = solid !== bare);
    const os = out.solid, ob = out.bare, og = out.ground;
    for (let j = 0, at = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++, at++) {
        const g = hf.heightAt(x0 + i * TOP_CELL, z0 + j * TOP_CELL);
        const s = solid ? solid[at]! : 0;
        const gu = units(g - floor);
        const su = s > 0 ? units(g + farTopMetres(s) - floor) : gu;
        og[at] = gu;
        os[at] = su;
        if (!odd) {
          ob[at] = su;
          continue;
        }
        const b = bare ? bare[at]! : 0;
        ob[at] = b === s ? su : b > 0 ? units(g + farTopMetres(b) - floor) : gu;
      }
    }
    return out;
  }

  /**
   * `chunk`'s tops: its statics' where they are held and it has a piece that floats or a landmark's, the far city's
   * where a piece of it is gone, else the map's own as they have come, else its statics' where held.
   */
  private topsOf(chunk: number): ChunkTops {
    const s = this.statics;
    if (s && s.in(chunk) > 0 && (this.floats.has(chunk) || this.marks.has(chunk))) {
      const gone = this.goneOf(chunk);
      const solid = cityTops(s, chunk, this.hf, gone);
      return { solid, bare: this.marks.has(chunk) ? cityTops(s, chunk, this.hf, this.leftOut(chunk, gone, this.own!)) : solid };
    }
    if (this.standing && this.standing.goneOf(chunk) !== null) {
      this.fromStanding.add(chunk);
      const solid = this.standing.topsOf(chunk);
      return { solid, bare: solid };
    }
    const fix = s?.holds(chunk) ? null : this.fix?.fixOf(chunk);
    if (fix) return { solid: fix.solid ?? fix.blocks, bare: fix.blocks };
    const held = this.tops && this.tops.came[chunk]! > 0 ? this.tops.top(chunk) : null;
    const solid = held ?? (s && s.in(chunk) > 0 ? cityTops(s, chunk, this.hf, null) : null);
    return { solid, bare: solid };
  }

  /** Asks for the map for `sun` where it is not null, and for the openness with `open`, where levels are made, else here. */
  private ask(cell: number, size: number, sun: ArrayLike<number> | null, open: boolean, now: number): void {
    this.away = true;
    if (sun) {
      this.stale = false;
      this.askedSun[0] = sun[0]!;
      this.askedSun[1] = sun[1]!;
      this.askedSun[2] = sun[2]!;
      this.askedCell = cell;
      this.askedSize = size;
    }
    if (open) this.open.asked(cell, now);
    const bareAt = this.bare.size > 0 ? Uint32Array.from(this.bare.keys()) : null;
    const bareTo = bareAt ? Uint16Array.from(this.bare.values()) : null;
    const job: SweepJob = { id: ++this.asked, solid: this.solid!, ground: this.ground!, w: this.w, h: this.h, cell, bareAt, bareTo, size, sun: sun ? Array.from(sun) : null, open };
    this.solid = this.ground = null;
    if (this.maker) {
      this.maker.sweep!(job);
      return;
    }
    const start = clock();
    const made = doSweep({ ...job, open: false });
    const swept = clock();
    const measure = open ? openOf(job) : null;
    if (sun) this.stats.ms = swept - start;
    this.got({ ...made, open: measure }, clock() - swept);
  }

  private take(): void {
    const made = this.maker?.swept!() ?? null;
    if (made) this.got(made);
  }

  /** Takes what a job made, `ms` the openness's milliseconds where it was made here. */
  private got(made: SweepMade, ms = 0): void {
    this.solid = made.solid;
    this.ground = made.ground;
    this.away = false;
    if (made.id !== this.asked) return;
    if (made.open) this.open.got(made.open, ms);
    if (!made.map) return;
    this.map = made.map;
    this.mapSun.set(this.askedSun);
    this.mapCell = this.askedCell;
    this.mapSize = this.askedSize;
    this.mapRise = made.rise;
    this.row = 0;
    this.stats.sweeps++;
  }

  /** Rows of the latest map onto the layer, as many as the frame's allowance has room for; the map let go once all are. */
  private upload(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }): void {
    const map = this.map, size = this.mapSize;
    if (!map || size !== this.layerSize || this.row >= size) return;
    const rows = Math.min(size - this.row, Math.floor(budget.left / (size * 2)));
    if (rows <= 0) return;
    p.farMap = map.subarray(this.row * size, (this.row + rows) * size);
    p.farRow = this.row;
    p.farRows = rows;
    budget.spend(rows * size * 2);
    this.row += rows;
    if (this.row < size) return;
    this.onCard = true;
    this.map = null;
    this.cardSun.set(this.mapSun);
    this.cardCell = this.mapCell;
    this.cardRise = this.mapRise;
  }
}
