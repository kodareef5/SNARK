// The sun's shadow past the cascades (shadowtext.ts): a map over the whole map of the height under which the sun is hidden,
// swept along the sun over the ground and the tops of the city's standing pieces, which a lit program compares a pixel's
// height with past the cascades, and within them for what stands past the chunks the near store holds, whose pieces cast
// into them. A city's shadow at a distance is the shadow of its outline: a building is the column of its 4 m cells' tops
// (shared/world/city.ts cityTops) down to the ground, so an open frame of floors casts as a solid and nothing shades a
// street from under a roof. The cascades still draw the truth near the camera.
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
// It is swept where the far city's levels are made (citymake.ts), on a worker in the browser, and here in tests and tools,
// and the sky's openness (skyopen.ts) is made there from the same solid heights and the ground under them. The camera's
// place on the grid is in the frame block whenever a lit frame has one, for the openness, and the far map is looked up
// only where its texels a metre are positive.

import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { cityReach, cityTops, type CityStatics, type Gone } from "../../../shared/world/city.ts";
import { Heightfield } from "../../../shared/world/heightfield.ts";
import { TACTICAL_CELL, farTopMetres } from "../../../shared/world/tactical.ts";
import type { CityKinds, CityMaker } from "./citymake.ts";
import { CAST_AT, FRAME, ROOF_AT, type FramePacket } from "./packet.ts";
import { SkyOpen, openMeasure, type OpenMap } from "./skyopen.ts";
import type { RoofMap } from "./roofmap.ts";

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
 * `floor`: the ground at each cell's middle, and the top `tops` gives a cell (cityTops), if any, over that; and the
 * ground alone into `under`, where given.
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

/**
 * A map's solid heights: every chunk's, its pieces gone as `gone` says left out; its ground into `under`, where given;
 * and into `bare` the same with the pieces `skip` names left out too, a byte a piece of the map, 1 for one that hides no
 * sky (a landmark's: a ship's masts are not a building's walls).
 */
export function makeSolid(city: CityStatics, hf: Heightfield, gone: (chunk: number) => Gone, under?: Uint16Array, bare?: Uint16Array, skip?: Uint8Array): Uint16Array {
  const out = new Uint16Array(city.dims.chunksX * city.dims.chunksZ * SIDE * SIDE);
  for (let c = 0; c < chunkCount(city.dims); c++) {
    const tops = city.in(c) > 0 ? cityTops(city, c, hf, gone(c)) : null;
    chunkSolid(out, city.dims, hf.minY, c, tops, hf, under);
    if (bare && skip) chunkSolid(bare, city.dims, hf.minY, c, skipping(city, c, skip) ? cityTops(city, c, hf, leftOut(city, c, gone(c), skip)) : tops, hf);
  }
  return out;
}

/** Whether a piece of `chunk` is one `skip` names. */
function skipping(city: CityStatics, chunk: number, skip: Uint8Array): boolean {
  for (let i = city.first[chunk]!; i < city.first[chunk + 1]!; i++) if (skip[i] === 1) return true;
  return false;
}

/** The pieces of `chunk` gone or named by `skip`, a byte each. */
export function leftOut(city: CityStatics, chunk: number, gone: Gone, skip: Uint8Array): Uint8Array {
  const from = city.first[chunk]!;
  return Uint8Array.from(skip.subarray(from, city.first[chunk + 1]!), (k, i) => (k === 1 || gone?.[i] === 1 ? 1 : 0));
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

/** A sweep asked of where levels are made. */
export interface SweepJob {
  readonly id: number;
  /**
   * The map's solid heights and its ground, or null to make them first from `make`; and the solid heights the sky's
   * openness is made from, with a landmark's pieces left out, null where the map has none.
   */
  readonly solid: Uint16Array | null;
  readonly ground: Uint16Array | null;
  readonly bare: Uint16Array | null;
  readonly make: SolidJob | null;
  /** Cells pooled a side, the layer's side, and the sun, or null for no map. */
  readonly k: number;
  readonly size: number;
  readonly sun: readonly number[] | null;
  /** Whether the sky's openness is made too (skyopen.ts openMeasure). */
  readonly open: boolean;
}

/** What a map's solid heights are made from on another thread: its statics as CityStatics holds them, which are gone, and its ground. */
export interface SolidJob {
  readonly first: Uint32Array;
  readonly kind: Uint16Array;
  readonly yaw: Uint16Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** A byte a piece, 1 for gone, or null for none; and 1 for a piece that hides no sky (`makeSolid` skip), or null for none. */
  readonly gone: Uint8Array | null;
  readonly skip: Uint8Array | null;
  readonly heights: Uint16Array;
}

export interface SweepMade {
  readonly id: number;
  readonly solid: Uint16Array;
  readonly ground: Uint16Array;
  readonly bare: Uint16Array | null;
  /** The map, or null where no sun was sent, and how far its highest solid stands over its lowest, in metres. */
  readonly map: Uint16Array | null;
  readonly rise: number;
  readonly open: OpenMap | null;
}

/** Every buffer of a sweep or what it made, to move it to another thread rather than copy it. */
export function sweepBuffers(m: SweepJob | SweepMade): ArrayBuffer[] {
  const all = "map" in m ? [m.solid, m.ground, m.bare, m.map, m.open?.bytes] : [m.solid, m.ground, m.bare, m.make?.first, m.make?.kind, m.make?.yaw, m.make?.x, m.make?.y, m.make?.z, m.make?.gone, m.make?.skip, m.make?.heights];
  return all.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}

/** What a job asks of a map's solid heights, ground and bare heights, `dims` its size, on any thread. */
function sweepOf(dims: MapDims, job: SweepJob, solid: Uint16Array, ground: Uint16Array, bare: Uint16Array | null): SweepMade {
  const nx = dims.chunksX * SIDE, nz = dims.chunksZ * SIDE;
  const map = job.sun ? new Uint16Array(job.size * job.size) : null;
  const rise = job.sun ? sweep(solid, nx, nz, job.k, job.size, job.sun[0]!, job.sun[1]!, job.sun[2]!, map!) : 0;
  return { id: job.id, solid, ground, bare, map, rise, open: job.open ? openMeasure(bare ?? solid, ground, nx, nz, job.k, TOP_CELL, UNIT) : null };
}

/** Does a sweep, on any thread: makes the solid heights first where it was sent them to make from, for a city of `kinds`. */
export function doSweep(kinds: CityKinds, job: SweepJob): SweepMade {
  const d = kinds.dims;
  let solid = job.solid, ground = job.ground, bare = job.bare;
  if (!solid || !ground) {
    const m = job.make!;
    const { first, kind, yaw, x, y, z } = m;
    const city: CityStatics = { dims: d, first, kind, yaw, x, y, z, halfX: kinds.halfX, halfY: kinds.halfY, halfZ: kinds.halfZ, color: kinds.color, plain: kinds.plain, near: kinds.near ?? new Uint8Array(kinds.plain.length), walked: kinds.walked, look: kinds.look, count: kind.length, in: (c: number) => first[c + 1]! - first[c]! };
    const g = kinds.ground;
    const hf = new Heightfield(d, g.cell, g.minY, g.stepY, m.heights, new Uint8Array(0));
    ground = new Uint16Array(d.chunksX * d.chunksZ * SIDE * SIDE);
    bare = m.skip ? new Uint16Array(ground.length) : null;
    solid = makeSolid(city, hf, (c) => (m.gone ? m.gone.subarray(first[c]!, first[c + 1]!) : null), ground, bare ?? undefined, m.skip ?? undefined);
  }
  return sweepOf(d, job, solid, ground, bare);
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

/** Bytes of the first job's copy made in a frame, and the elements of a column copied a step. */
const COPY_BYTES = 1 << 24;
const COPY_SLICE = 1 << 20;

/** Milliseconds from some fixed moment: the page's clock in a browser and under Bun. */
const clock = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

/**
 * The far map of one map's city, and the sky's openness over it (skyopen.ts): made and swept where `maker` makes the far
 * city's levels, else here, and put on the card a frame's allowance of rows at a time. A map is looked up once all of
 * it is on the card, while its sun is near enough the one in the sky.
 */
export class FarShadow {
  /** Sweeps made, and the last one's milliseconds where it was made here. */
  readonly stats = { sweeps: 0, ms: 0 };
  /**
   * The sky's openness, made from the same solid heights, and what stands overhead round the camera, from the same
   * pieces, which the scene gives it from the late script (roofmap.ts), none until then.
   */
  readonly open = new SkyOpen();
  roof: RoofMap | null = null;
  /** Whether the last frame's tier takes the sky's light down under roofs. */
  private roofs = false;
  private readonly goneOf = (chunk: number): Gone => this.standing.goneOf(chunk);
  private readonly city: CityStatics;
  private readonly hf: Heightfield;
  private readonly standing: Standing;
  private readonly maker: CityMaker | null;
  private readonly held: (chunk: number) => boolean;
  /**
   * The solid heights, the ground and the bare heights the openness is made from, while they are here and not away
   * being swept; and whether they have been made. `skip` is a byte a piece, 1 for a landmark's, null for a map with none.
   */
  private solid: Uint16Array | null = null;
  private ground: Uint16Array | null = null;
  private bare: Uint16Array | null = null;
  private readonly skip: Uint8Array | null;
  private made = false;
  private away = false;
  /** The first job's copy of the city and the ground while it is made, and once it is whole until it is sent. */
  private copying: Generator<number, SolidJob> | null = null;
  private copy: SolidJob | null = null;
  private asked = 0;
  /** goneVersion as the solid heights last took it, the chunks to make again, and whether the map was swept before them. */
  private readonly seen: Uint32Array;
  private readonly changed: number[] = [];
  private stale = false;
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

  /**
   * `held` says the near store holds a chunk whole, whose pieces cast into the cascades; `own` is 1 for each kind a
   * landmark of the map brings, whose pieces cast the sun's shadow and hide no sky.
   */
  constructor(city: CityStatics, hf: Heightfield, standing: Standing, maker: CityMaker | null, held: (chunk: number) => boolean, own: Uint8Array | null = null) {
    this.city = city;
    const landmarks = own ? cityReach(city, own).landmarks : null;
    let skip: Uint8Array | null = null;
    for (const c of landmarks?.keys() ?? []) (skip ??= new Uint8Array(city.count)).set(landmarks!.get(c)!, city.first[c]!);
    this.skip = skip;
    this.hf = hf;
    this.standing = standing;
    this.held = held;
    this.maker = maker?.sweep && maker.swept ? maker : null;
    this.seen = new Uint32Array(chunkCount(city.dims));
  }

  /**
   * Whether the sky's openness is all on the card and, on a tier with roofs, the map of what stands overhead round the
   * camera too, so that a frame is lit as it will go on being.
   */
  get whole(): boolean {
    return this.open.whole && (!this.roofs || (this.roof?.whole ?? false));
  }

  /** After a lost context: the layer and the openness's texture are empty, and the latest of each goes on the card again. */
  reset(): void {
    this.layerSize = 0;
    this.open.reset();
    this.roof?.reset();
  }

  /**
   * Each frame, with the unit vector toward the light the cascades are cast from while it casts (the sun, or the moon
   * by night), else null, and the scene's clock in milliseconds: makes the map and the openness again where they are
   * due, puts rows of them on the card from `budget`'s allowance, and says in the frame block where the camera (cx, cy,
   * cz) is on their grid, and whether the map is to be looked up. A frame with no shadow array on the card, as low
   * poly's, leaves the layer empty; one with no shadow maps at all looks nothing up. The map of what stands overhead
   * lights its ground for `daySun`, the sun while it is the light that casts, else null.
   */
  update(p: FramePacket, budget: { readonly left: number; spend(bytes: number): void }, cx: number, cy: number, cz: number, sun: ArrayLike<number> | null, now = 0, daySun = sun): void {
    const f = p.frame;
    f[FRAME.farScale] = 0;
    f[ROOF_AT + 3] = 0;
    this.roofs = p.lit && p.tier.roofs;
    if (this.roofs) this.roof?.update(p, budget, this.city, this.hf, this.goneOf, cx, cz, now, clock, daySun);
    const { cascades, size } = p.tier.shadows;
    if (!p.lit || size <= 0) {
      this.layerSize = 0;
      this.open.upload(p, budget, 0);
      return;
    }
    const cell = farCell(this.city.dims, size);
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
    const swept = casts && (!this.map || this.stale || this.mapCell !== cell || this.mapSize !== size || tipMoves(this.mapSun, sun, this.mapRise) >= REMAKE * cell);
    const open = this.open.due(cell, now);
    if (!this.away && (swept || open) && this.copied()) this.ask(cell, size, swept ? sun : null, open, now);
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
    const d = this.city.dims;
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

  /**
   * Notes the chunks a piece of which has gone since they were last made, and makes them again once the solid heights
   * are here, after which the map and the openness are due again.
   */
  private follow(): void {
    const version = this.standing.goneVersion;
    for (let c = 0; c < version.length; c++) {
      if (version[c] === this.seen[c]) continue;
      this.seen[c] = version[c]!;
      if (this.made) this.changed.push(c);
    }
    const solid = this.solid, bare = this.bare;
    if (!solid || this.changed.length === 0) return;
    for (const c of this.changed) {
      const tops = this.standing.topsOf(c);
      chunkSolid(solid, this.city.dims, this.hf.minY, c, tops, this.hf);
      if (bare) chunkSolid(bare, this.city.dims, this.hf.minY, c, this.city.in(c) > 0 ? cityTops(this.city, c, this.hf, leftOut(this.city, c, this.standing.goneOf(c), this.skip!)) : null, this.hf);
    }
    this.changed.length = 0;
    this.stale = true;
    this.open.changed();
    this.roof?.changed();
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
    const job: SweepJob = { id: ++this.asked, solid: this.made ? this.solid : null, ground: this.made ? this.ground : null, bare: this.made ? this.bare : null, make: this.made ? null : this.copy, k: cell / TOP_CELL, size, sun: sun ? Array.from(sun) : null, open };
    this.solid = this.ground = this.bare = this.copy = null;
    this.made = true;
    if (this.maker) {
      this.maker.sweep!(job);
      return;
    }
    const start = clock();
    const ground = job.ground ?? new Uint16Array(this.city.dims.chunksX * this.city.dims.chunksZ * SIDE * SIDE);
    const bare = job.solid ? job.bare : this.skip ? new Uint16Array(ground.length) : null;
    const solid = job.solid ?? makeSolid(this.city, this.hf, (c) => this.standing.goneOf(c), ground, bare ?? undefined, this.skip ?? undefined);
    const made = sweepOf(this.city.dims, { ...job, open: false }, solid, ground, bare);
    const swept = clock();
    const measure = open ? openMeasure(bare ?? solid, ground, this.city.dims.chunksX * SIDE, this.city.dims.chunksZ * SIDE, job.k, TOP_CELL, UNIT) : null;
    if (sun) this.stats.ms = swept - start;
    this.got({ ...made, open: measure }, clock() - swept);
  }

  /**
   * Whether the first job's copy of what the solid heights are made from is whole, where they are made on another thread:
   * a whole map's city and ground are a quarter of a gigabyte, copied COPY_BYTES a frame.
   */
  private copied(): boolean {
    if (this.made || !this.maker || this.copy) return true;
    const steps = (this.copying ??= this.solidSteps());
    for (let bytes = 0, s = steps.next(); ; s = steps.next()) {
      if (s.done) {
        this.copy = s.value;
        this.copying = null;
        return true;
      }
      if ((bytes += s.value) >= COPY_BYTES) return false;
    }
  }

  /**
   * What the solid heights are made from, copied to go to another thread a slice at a time, each step giving its bytes;
   * what is gone, as it is at the end.
   */
  private *solidSteps(): Generator<number, SolidJob> {
    const c = this.city;
    const copy = function* <T extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(from: T): Generator<number, T> {
      const out = new (from.constructor as new (n: number) => T)(from.length);
      for (let at = 0; at < from.length; at += COPY_SLICE) {
        out.set(from.subarray(at, at + COPY_SLICE), at);
        yield Math.min(COPY_SLICE, from.length - at) * from.BYTES_PER_ELEMENT;
      }
      return out;
    };
    const job = { first: yield* copy(c.first), kind: yield* copy(c.kind), yaw: yield* copy(c.yaw), x: yield* copy(c.x), y: yield* copy(c.y), z: yield* copy(c.z), skip: this.skip ? yield* copy(this.skip) : null, heights: yield* copy(this.hf.heights) };
    let gone: Uint8Array | null = null;
    for (let k = 0; k < chunkCount(c.dims); k++) {
      const g = this.standing.goneOf(k);
      if (g) (gone ??= new Uint8Array(c.count)).set(g, c.first[k]!);
    }
    return { ...job, gone };
  }

  private take(): void {
    const made = this.maker?.swept!() ?? null;
    if (made) this.got(made);
  }

  /** Takes what a job made, `ms` the openness's milliseconds where it was made here. */
  private got(made: SweepMade, ms = 0): void {
    this.solid = made.solid;
    this.ground = made.ground;
    this.bare = made.bare;
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

  /** Rows of the latest map onto the layer, as many as the frame's allowance has room for. */
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
    this.cardSun.set(this.mapSun);
    this.cardCell = this.mapCell;
    this.cardRise = this.mapRise;
  }
}
