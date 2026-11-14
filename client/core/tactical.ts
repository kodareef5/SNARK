// The client's part of the map: what the server has sent of structures and friends beyond the view, where the terrain's
// picture comes from, and the pictures the minimap and the map screen show, composed of terrain, structure cells and grid.

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import type { MapExtent } from "../../shared/world/coords.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { Cells, Marks, OWNER_OTHER, TACTICAL_CELL, levelSide, readCells, readMarks } from "../../shared/world/tactical.ts";
import type { UiImage } from "./ui/nodes.ts";

/** Structure cells by chunk, kept for as long as the session lasts, and the latest marks. */
export class MapStore {
  /** A chunk with no filled cell has no entry. */
  readonly chunks = new Map<number, Cells>();
  readonly marks = new Marks();
  /** Counts changes to the cells. */
  version = 0;
  private hf: Heightfield | null = null;
  private scratch = new Cells();

  /** S_TACTICAL after its type. */
  readCells(r: BitReader, hf: Heightfield): void {
    this.hf = hf;
    const got = this.scratch;
    const chunk = readCells(r, got);
    if (chunk < 0 || chunk >= hf.dims.chunksX * hf.dims.chunksZ) return;
    this.version++;
    const was = this.chunks.get(chunk);
    if (got.teamCount === 0) {
      this.chunks.delete(chunk);
      return;
    }
    this.chunks.set(chunk, got);
    this.scratch = was ?? new Cells();
  }

  /** S_MARKS after its type. */
  readMarks(r: BitReader, hf: Heightfield): void {
    readMarks(r, hf, this.marks);
  }

  /**
   * What is known to stand at (x, z): 0 for nothing, else the cell's palette colour in the second byte over its CELL_ byte
   * (shared/world/tactical.ts). The cell may be 4, 8, 16 or 32 m wide, as the server last sent its chunk.
   */
  cellAt(x: number, z: number): number {
    const at = this.find(x, z);
    return at < 0 ? 0 : (this.found!.tint[at]! << 8) | this.found!.info[at]!;
  }

  /** The team whose structure stands at (x, z). 0 for none, for nobody's, and for a team the chunk does not name. */
  teamAt(x: number, z: number): number {
    const at = this.find(x, z);
    return at < 0 ? 0 : (this.found!.teams[(this.found!.info[at]! >> 3) & 7] ?? 0);
  }

  private found: Cells | null = null;

  /** Index of the filled cell at (x, z) in `found`, or -1. */
  private find(x: number, z: number): number {
    const hf = this.hf;
    if (!hf || x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return -1;
    const chunk = chunkAt(hf.dims, x, z);
    const cells = this.chunks.get(chunk);
    if (!cells) return -1;
    const size = TACTICAL_CELL << cells.level;
    const at = Math.floor((z - chunkCz(hf.dims, chunk) * CHUNK_SIZE) / size) * levelSide(cells.level) + Math.floor((x - chunkCx(hf.dims, chunk) * CHUNK_SIZE) / size);
    this.found = cells;
    return cells.info[at] === 0 ? -1 : at;
  }
}

/** The map has this many zooms. Zoom 0 is the whole map in one tile, and each next has twice as many tiles a side. */
export const ZOOMS = 4;

/** A square picture `size` pixels a side, a word to a pixel with its bytes in the order red, green, blue, alpha. North is up and east is right. */
export interface Tile {
  readonly size: number;
  readonly rgba: Uint32Array;
}

/**
 * Where the terrain's picture comes from: a pyramid of tiles. At zoom z the map's square (its longer side each way, from its
 * north-west corner) is 2^z tiles a side, and tile (col, row) counts east and south from that corner. Tiles may be any size.
 * The pictures hold terrain only. Pictures baked ahead of time will replace the ones made here.
 */
export interface TileSource {
  /** Counts the tiles that have come, so a picture knows to be drawn again. */
  readonly version: number;
  /** The tile, or null while it is not here. Asking is how a source learns that a tile is wanted. */
  tile(zoom: number, col: number, row: number): Tile | null;
  /** Called once a frame. A source makes or takes in at most one tile in it. */
  step(): void;
}

/** Where there is no map and where no tile has come yet. */
const VOID = 0xff30241a;
const RELIEF_SIZE = 256;
const RELIEF_KEPT = 24;

/** Paints one tile of the pyramid from the heightfield: each sample's colour, shaded by its slope with the light from the north-west, and water over what lies under the sea. */
export function paintRelief(hf: Heightfield, palette: Uint8Array, zoom: number, col: number, row: number, size: number, out: Uint32Array): void {
  const side = Math.max(hf.sizeX, hf.sizeZ) / (1 << zoom);
  // The slope is taken over about a pixel, so a far zoom shows the broad shape of the land.
  const reach = Math.max(1, Math.round(side / size / hf.cell));
  for (let py = 0; py < size; py++) {
    const z = hf.sizeZ - (row + (py + 0.5) / size) * side;
    const j = Math.max(0, Math.min(hf.nz - 1 - reach, Math.floor(z / hf.cell)));
    for (let px = 0; px < size; px++) {
      const x = hf.sizeX - (col + (px + 0.5) / size) * side;
      if (x < 0 || z < 0) {
        out[py * size + px] = VOID;
        continue;
      }
      const i = Math.max(0, Math.min(hf.nx - 1 - reach, Math.floor(x / hf.cell)));
      const tint = hf.tint[j * hf.nx + i]! * 4;
      const h = hf.sample(i, j);
      const relief = (hf.sample(Math.min(hf.nx - 1, i + reach), j) - h + hf.sample(i, Math.min(hf.nz - 1, j + reach)) - h) / (reach * hf.cell);
      const shade = Math.max(0.55, Math.min(1.3, 0.9 + relief * 0.35));
      let r = palette[tint]! * shade;
      let g = palette[tint + 1]! * shade;
      let b = palette[tint + 2]! * shade;
      if (h < hf.seaLevel) {
        // Deeper water is more of the water's colour.
        const k = Math.min(0.9, 0.55 + (hf.seaLevel - h) * 0.08);
        r += (40 - r) * k;
        g += (92 - g) * k;
        b += (140 - b) * k;
      }
      out[py * size + px] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    }
  }
}

/** Plain tiles made here from the heightfield, one a frame, the least lately used forgotten past RELIEF_KEPT. */
export class ReliefTiles implements TileSource {
  version = 0;
  private readonly hf: Heightfield;
  private readonly palette: Uint8Array;
  private readonly kept = new Map<number, { tile: Tile; used: number }>();
  /** The finest tile asked for and not had since the last step, or -1. */
  private wanted = -1;
  private uses = 0;

  constructor(hf: Heightfield, palette: Uint8Array) {
    this.hf = hf;
    this.palette = palette;
  }

  /** How many tiles it holds. */
  get held(): number {
    return this.kept.size;
  }

  tile(zoom: number, col: number, row: number): Tile | null {
    const key = (zoom << 16) | (row << 8) | col;
    const had = this.kept.get(key);
    if (had) {
      had.used = ++this.uses;
      return had.tile;
    }
    if (zoom > this.wanted >> 16) this.wanted = key;
    return null;
  }

  step(): void {
    const key = this.wanted;
    if (key < 0) return;
    this.wanted = -1;
    let rgba: Uint32Array | null = null;
    if (this.kept.size >= RELIEF_KEPT) {
      let oldest = -1;
      for (const [k, e] of this.kept) if (oldest < 0 || e.used < this.kept.get(oldest)!.used) oldest = k;
      rgba = this.kept.get(oldest)!.tile.rgba;
      this.kept.delete(oldest);
    }
    rgba ??= new Uint32Array(RELIEF_SIZE * RELIEF_SIZE);
    paintRelief(this.hf, this.palette, key >> 16, key & 255, (key >> 8) & 255, RELIEF_SIZE, rgba);
    this.kept.set(key, { tile: { size: RELIEF_SIZE, rgba }, used: ++this.uses });
    this.version++;
  }
}

/**
 * A square window on the map. (u0, v0) is its north-west corner and (du, dv) its size, as fractions of the map: longitude
 * and latitude over 100. A new one shows the whole of a square map.
 */
export class MapView {
  zoom = 0;
  u0 = 0;
  v0 = 0;
  du = 1;
  dv = 1;

  /** One tile of `zoom` wide, with (u, v) at its middle where the map's square allows, on whole pixels of a picture `px` wide. */
  place(map: MapExtent, zoom: number, u: number, v: number, px: number): void {
    const whole = Math.max(map.sizeX, map.sizeZ);
    const side = whole / (1 << zoom);
    const pixel = side / px;
    const fit = (middle: number): number => Math.round(Math.min(whole - side, Math.max(0, middle - side / 2)) / pixel) * pixel;
    this.zoom = zoom;
    this.u0 = fit(u * map.sizeX) / map.sizeX;
    this.v0 = fit(v * map.sizeZ) / map.sizeZ;
    this.du = side / map.sizeX;
    this.dv = side / map.sizeZ;
  }
}

/** The whole of a square map, for a screen with no picture of its own. */
export const WHOLE_MAP = new MapView();

/** Degrees between the grid's lines at each zoom. Every tenth is drawn stronger. */
const GRID_STEP: readonly number[] = [10, 10, 5, 1];
/** The digits 0 to 9, three pixels by five, a bit to a pixel from the top left. */
const DIGITS: readonly number[] = [0x7b6f, 0x2c97, 0x73e7, 0x73cf, 0x5bc9, 0x79cf, 0x79ef, 0x7249, 0x7bef, 0x7bcf];

/** Darkens a pixel by `a` 256ths. */
function darken(out: Uint32Array, o: number, a: number): void {
  const c = out[o]!;
  const k = 256 - a;
  out[o] = 0xff000000 | (((((c >> 16) & 255) * k) >> 8) << 16) | (((((c >> 8) & 255) * k) >> 8) << 8) | (((c & 255) * k) >> 8);
}

/** A cell's colour: its piece's, lighter the taller it stands, and tinged green for the reader's own tribe (1) or red for another (2). */
function cellColour(palette: Uint8Array, tint: number, band: number, whose: number): number {
  const lift = 0.78 + band * 0.045;
  let r = palette[tint * 4]! * lift;
  let g = palette[tint * 4 + 1]! * lift;
  let b = palette[tint * 4 + 2]! * lift;
  if (whose !== 0) {
    r += ((whose === 1 ? 70 : 235) - r) * 0.45;
    g += ((whose === 1 ? 225 : 70) - g) * 0.45;
    b += ((whose === 1 ? 110 : 60) - b) * 0.45;
  }
  return 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
}

/** A picture of the map as a screen shows it: terrain, then structure cells, then the grid and its numbers. */
export class MapPicture {
  /** Made anew at the size asked for, so its pixels are the screen's and a line is never lost to scaling. */
  readonly image: UiImage = { width: 0, height: 0, data: new Uint8ClampedArray(0), version: 0 };
  readonly view = new MapView();
  private rgba: Uint32Array = new Uint32Array(0);
  private cols: Int32Array = new Int32Array(0);
  /** What it was last drawn from: the cells' version, the tiles' and the reader's team. */
  private cellsAt = -1;
  private tilesAt = -1;
  private team = -1;

  /** Looks at (u, v) at `zoom`, and draws the picture again if what it shows has changed. */
  draw(hf: Heightfield, palette: Uint8Array, tiles: TileSource, store: MapStore | null, team: number, zoom: number, u: number, v: number, px: number): void {
    const view = this.view;
    const image = this.image;
    const [wasZoom, wasU, wasV] = [view.zoom, view.u0, view.v0];
    view.place(hf, zoom, u, v, px);
    const cells = store ? store.version : 0;
    if (image.width === px && view.zoom === wasZoom && view.u0 === wasU && view.v0 === wasV && this.cellsAt === cells && this.tilesAt === tiles.version && this.team === team) return;
    if (image.width !== px) {
      image.width = image.height = px;
      image.data = new Uint8ClampedArray(px * px * 4);
      this.rgba = new Uint32Array(image.data.buffer);
      this.cols = new Int32Array(px);
    }
    this.terrain(hf, tiles);
    // A tile asked for just now comes at a later step, and then the picture is drawn again.
    this.cellsAt = cells;
    this.tilesAt = tiles.version;
    this.team = team;
    if (store) this.cells(hf, palette, store, team);
    this.grid();
    image.version++;
  }

  private terrain(hf: Heightfield, tiles: TileSource): void {
    const N = this.image.width;
    const out = this.rgba;
    const view = this.view;
    const cols = this.cols;
    const whole = Math.max(hf.sizeX, hf.sizeZ);
    const n = 1 << view.zoom;
    const side = whole / n;
    const pixel = side / N;
    const e0 = view.u0 * hf.sizeX;
    const s0 = view.v0 * hf.sizeZ;
    const col0 = Math.min(n - 1, Math.floor(e0 / side + 1e-6));
    const row0 = Math.min(n - 1, Math.floor(s0 / side + 1e-6));
    for (let row = row0; row <= Math.min(n - 1, row0 + 1); row++) {
      for (let col = col0; col <= Math.min(n - 1, col0 + 1); col++) {
        // The part of the picture this tile covers.
        const x0 = Math.max(0, Math.round((col * side - e0) / pixel));
        const x1 = Math.min(N, Math.round(((col + 1) * side - e0) / pixel));
        const y0 = Math.max(0, Math.round((row * side - s0) / pixel));
        const y1 = Math.min(N, Math.round(((row + 1) * side - s0) / pixel));
        if (x0 >= x1 || y0 >= y1) continue;
        // Until the tile comes, the nearest coarser one that is here stands in for it.
        let z = view.zoom;
        let c = col;
        let r = row;
        let t = tiles.tile(z, c, r);
        while (!t && z > 0) {
          z--;
          c >>= 1;
          r >>= 1;
          t = tiles.tile(z, c, r);
        }
        if (!t) {
          for (let py = y0; py < y1; py++) out.fill(VOID, py * N + x0, py * N + x1);
          continue;
        }
        const span = whole / (1 << z);
        const size = t.size;
        for (let px = x0; px < x1; px++) cols[px] = Math.min(size - 1, Math.floor(((e0 + (px + 0.5) * pixel - c * span) / span) * size));
        for (let py = y0; py < y1; py++) {
          const from = Math.min(size - 1, Math.floor(((s0 + (py + 0.5) * pixel - r * span) / span) * size)) * size;
          let o = py * N + x0;
          for (let px = x0; px < x1; px++) out[o++] = t.rgba[from + cols[px]!]!;
        }
      }
    }
  }

  private cells(hf: Heightfield, palette: Uint8Array, store: MapStore, team: number): void {
    const N = this.image.width;
    const out = this.rgba;
    const view = this.view;
    // Pixels to a metre. East is -X and south is -Z, so a cell's far corner in the world is its near one in the picture.
    const scale = N / (view.du * hf.sizeX);
    const e0 = view.u0 * hf.sizeX;
    const s0 = view.v0 * hf.sizeZ;
    for (const [chunk, cells] of store.chunks) {
      const east = hf.sizeX - chunkCx(hf.dims, chunk) * CHUNK_SIZE - e0;
      const south = hf.sizeZ - chunkCz(hf.dims, chunk) * CHUNK_SIZE - s0;
      if (east <= 0 || south <= 0 || (east - CHUNK_SIZE) * scale >= N || (south - CHUNK_SIZE) * scale >= N) continue;
      const n = levelSide(cells.level);
      const size = TACTICAL_CELL << cells.level;
      for (let j = 0; j < n; j++) {
        let y0 = Math.round((south - (j + 1) * size) * scale);
        let y1 = Math.max(y0 + 1, Math.round((south - j * size) * scale));
        if (y0 < 0) y0 = 0;
        if (y1 > N) y1 = N;
        for (let i = 0; i < n; i++) {
          const v = cells.info[j * n + i]!;
          if (v === 0) continue;
          let x0 = Math.round((east - (i + 1) * size) * scale);
          let x1 = Math.max(x0 + 1, Math.round((east - i * size) * scale));
          if (x0 < 0) x0 = 0;
          if (x1 > N) x1 = N;
          if (x0 >= x1) continue;
          const owner = (v >> 3) & 7;
          const whose = owner === OWNER_OTHER ? -1 : cells.teams[owner]!;
          const colour = cellColour(palette, cells.tint[j * n + i]!, v & 7, whose === 0 ? 0 : whose === team ? 1 : 2);
          for (let py = y0; py < y1; py++) out.fill(colour, py * N + x0, py * N + x1);
        }
      }
    }
  }

  /** Lines of latitude and longitude across the map, and their numbers along the picture's top and left. */
  private grid(): void {
    const N = this.image.width;
    const out = this.rgba;
    const view = this.view;
    const step = GRID_STEP[view.zoom]!;
    const big = Math.max(1, Math.round(N / 320));
    const edge = (f: number): number => Math.max(0, Math.min(N, Math.round(f * N)));
    // The map's own rectangle. One that is not square leaves part of the picture empty.
    const left = edge(-view.u0 / view.du);
    const right = edge((1 - view.u0) / view.du);
    const top = edge(-view.v0 / view.dv);
    const bottom = edge((1 - view.v0) / view.dv);
    // Where the lines stand close, as on a small minimap, every second one is numbered.
    const sparse = ((step / 100 / view.du) * N < 20 * big ? 2 : 1) * step;
    for (let k = Math.max(0, Math.ceil((view.u0 * 100) / step - 1e-6)); k * step <= 100; k++) {
      const px = Math.round((((k * step) / 100 - view.u0) / view.du) * N);
      if (px >= N) break;
      for (let py = top; py < bottom; py++) darken(out, py * N + px, (k * step) % 10 === 0 ? 110 : 56);
      if ((k * step) % sparse === 0) this.number(k * step, px + 2, top + 2, big);
    }
    for (let k = Math.max(0, Math.ceil((view.v0 * 100) / step - 1e-6)); k * step <= 100; k++) {
      const py = Math.round((((k * step) / 100 - view.v0) / view.dv) * N);
      if (py >= N) break;
      for (let px = left; px < right; px++) darken(out, py * N + px, (k * step) % 10 === 0 ? 110 : 56);
      // The top row belongs to the longitudes.
      if ((k * step) % sparse === 0 && py - top > 7 * big) this.number(k * step, left + 2, py + 2, big);
    }
  }

  /** Writes a whole number in white on a dark shadow, its top left at (x, y), `big` pixels to a dot. Left out if it would not fit. */
  private number(value: number, x: number, y: number, big: number): void {
    const N = this.image.width;
    const text = String(value);
    if (x < 0 || y < 0 || x + text.length * 4 * big + big > N || y + 6 * big > N) return;
    for (const [shift, colour] of [[big, 0xff000000], [0, 0xffffffff]] as const) {
      for (let d = 0; d < text.length; d++) {
        const bits = DIGITS[text.charCodeAt(d) - 48]!;
        for (let dot = 0; dot < 15; dot++) {
          if (((bits >> (14 - dot)) & 1) === 0) continue;
          const px = x + shift + (d * 4 + (dot % 3)) * big;
          const py = y + shift + Math.floor(dot / 3) * big;
          for (let q = 0; q < big; q++) this.rgba.fill(colour, (py + q) * N + px, (py + q) * N + px + big);
        }
      }
    }
  }
}

/** The map as one client shows it: the minimap's picture and zoom, and the map screen's picture, zoom and the place it looks at. */
export class Chart {
  readonly tiles: TileSource;
  readonly mini = new MapPicture();
  readonly full = new MapPicture();
  miniZoom: number;
  fullZoom = 0;
  /** The middle of the map screen's window, as fractions of the map. */
  fullU = 0.5;
  fullV = 0.5;
  private readonly hf: Heightfield;
  private readonly palette: Uint8Array;

  /** `tiles` is the terrain's picture: the plain one made from the heightfield unless a baked one is given. */
  constructor(hf: Heightfield, palette: Uint8Array, tiles: TileSource = new ReliefTiles(hf, palette)) {
    this.hf = hf;
    this.palette = palette;
    this.tiles = tiles;
    // The minimap starts at the zoom whose window is nearest half a kilometre.
    this.miniZoom = Math.max(0, Math.min(ZOOMS - 1, Math.round(Math.log2(Math.max(hf.sizeX, hf.sizeZ) / 512))));
  }

  /** The minimap, with (u, v) at its middle. A reader that may not be shown where it is gets the whole map. */
  drawMini(store: MapStore | null, team: number, u: number, v: number, px: number, located: boolean): void {
    this.mini.draw(this.hf, this.palette, this.tiles, store, team, located ? this.miniZoom : 0, u, v, px);
  }

  drawFull(store: MapStore | null, team: number, px: number): void {
    this.full.draw(this.hf, this.palette, this.tiles, store, team, this.fullZoom, this.fullU, this.fullV, px);
  }

  /** Puts (u, v) at the middle of the map screen, as near as the map's edge allows. It stays the place looked at through every zoom. */
  look(u: number, v: number): void {
    this.fullU = u;
    this.fullV = v;
  }

  zoomFull(turn: number): void {
    this.fullZoom = Math.max(0, Math.min(ZOOMS - 1, this.fullZoom + turn));
  }

  /**
   * Minus and Equal step the minimap out and in through its zooms. While the map screen is `open` they step it, and the
   * arrows move it a quarter of its window. Returns true if the key is the map's.
   */
  key(code: string, down: boolean, open: boolean): boolean {
    const turn = code === "Equal" ? 1 : code === "Minus" ? -1 : 0;
    if (turn !== 0) {
      if (down && open) this.zoomFull(turn);
      else if (down) this.miniZoom = Math.max(0, Math.min(ZOOMS - 1, this.miniZoom + turn));
      return true;
    }
    const east = code === "ArrowRight" ? 1 : code === "ArrowLeft" ? -1 : 0;
    const south = code === "ArrowDown" ? 1 : code === "ArrowUp" ? -1 : 0;
    if (!open || (east === 0 && south === 0)) return false;
    // From the middle of the window as it stands, so a step away from the map's edge moves at once.
    const view = this.full.view;
    if (down) this.look(view.u0 + view.du * (0.5 + east / 4), view.v0 + view.dv * (0.5 + south / 4));
    return true;
  }
}
