// What a map shows of a chunk's structures without their pieces: a summary of 16 by 16 cells of 4 m, baked by one pure
// function of the chunk's table, with coarser copies of 8, 16 and 32 m cells derived from it. Also the marks of friends far
// away. Their wire layouts are documented at S_TACTICAL and S_MARKS in shared/net/protocol.ts.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import type { MapExtent } from "./coords.ts";
import type { Heightfield } from "./heightfield.ts";
import type { ChunkTable } from "./structures.ts";

/** Metres to a cell at level 0. Each level doubles it. */
export const TACTICAL_CELL = 4;
export const TACTICAL_LEVELS = 4;
/** Cells along a chunk's side at level 0. */
const SIDE = 16;
/** Where each level's cells start in a summary: 256 cells, then 64, 16 and 4. */
export const LEVEL_AT: readonly number[] = [0, 256, 320, 336];
const CELLS = 340;

/** A cell's second byte: the height band in the low 3 bits, the owner in the next 3, then CELL_FILLED. */
export const CELL_FILLED = 64;
/** The owner of a cell whose team has no place among the chunk's seven. */
export const OWNER_OTHER = 7;
export const MAX_TEAMS = 7;
/** The top of a cell's tallest piece above the ground is in the first band it does not pass, or the last. */
const BAND_TOPS: readonly number[] = [1, 4, 8, 16, 32, 64];
/** A piece no wider than this is put in the cell of its centre. A wider one fills every cell it reaches. */
const SMALL_HALF = TACTICAL_CELL / 2;
const YAW_TO_RAD = TAU / YAW_UNITS;

/** Cells along a chunk's side at `level`. */
export function levelSide(level: number): number {
  return SIDE >> level;
}

/**
 * The level whose cells suit a map window `metres` across: the size nearest a 256th of it, which is a pixel of a minimap
 * and four of a map screen. On an 8 km map its four zooms take the four levels, and a map under 1.5 km uses only the finest.
 */
export function levelFor(metres: number): number {
  let level = 0;
  // Between one size and the next, the nearer is decided at 1.41 times the smaller.
  while (level < TACTICAL_LEVELS - 1 && (TACTICAL_CELL << level) * 1.41 < metres / 256) level++;
  return level;
}

export class Summary {
  /** Counts the bakes that changed it. 0 is never baked. */
  version = 0;
  /** Per cell, level after level: the palette colour of its tallest piece, and the byte described at CELL_FILLED. */
  readonly tint = new Uint8Array(CELLS);
  readonly info = new Uint8Array(CELLS);
  /** The teams its cells belong to. A cell's owner is an index into these. */
  readonly teams = new Uint32Array(MAX_TEAMS);
  teamCount = 0;
  /** Filled cells at level 0. */
  filled = 0;

  /** Index of `team` among its teams, or -1. */
  teamIndex(team: number): number {
    for (let i = 0; i < this.teamCount; i++) if (this.teams[i] === team) return i;
    return -1;
  }

  /** True if both hold the same cells and teams. Versions are not compared. */
  same(o: Summary): boolean {
    if (this.teamCount !== o.teamCount || this.filled !== o.filled) return false;
    for (let i = 0; i < this.teamCount; i++) if (this.teams[i] !== o.teams[i]) return false;
    // The coarser levels follow from the first.
    for (let c = 0; c < SIDE * SIDE; c++) if (this.tint[c] !== o.tint[c] || this.info[c] !== o.info[c]) return false;
    return true;
  }

  copy(o: Summary): void {
    this.tint.set(o.tint);
    this.info.set(o.info);
    this.teams.set(o.teams);
    this.teamCount = o.teamCount;
    this.filled = o.filled;
  }
}

/** Per content index: a structure's half extents and its palette colour. */
export interface PieceShapes {
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly tint: Uint8Array;
}

// Scratch for a bake: per cell, the top of its tallest piece and that piece's slot.
const top = new Float32Array(SIDE * SIDE);
const who = new Int32Array(SIDE * SIDE);

/**
 * Summarises the chunk whose corner is (x0, z0) into `out`, every level. The same table gives the same summary on any
 * machine. A piece is counted in its own chunk only, so a wide one is cut at the chunk's edge. `out.version` is left alone.
 */
export function bakeChunk(t: ChunkTable | null, x0: number, z0: number, shapes: PieceShapes, hf: Heightfield, out: Summary): void {
  who.fill(-1);
  if (t) {
    const { kind, x, y, z } = t;
    const { halfX, halfY, halfZ } = shapes;
    const inv = 1 / TACTICAL_CELL;
    for (let s = 0, high = t.high; s < high; s++) {
      const k = kind[s]!;
      if (k === 0) continue;
      const h = y[s]! + halfY[k]!;
      const hx = halfX[k]!;
      const hz = halfZ[k]!;
      const px = x[s]! - x0;
      const pz = z[s]! - z0;
      if (hx <= SMALL_HALF && hz <= SMALL_HALF) {
        let cx = (px * inv) | 0;
        let cz = (pz * inv) | 0;
        if (cx < 0) cx = 0;
        else if (cx >= SIDE) cx = SIDE - 1;
        if (cz < 0) cz = 0;
        else if (cz >= SIDE) cz = SIDE - 1;
        const c = cz * SIDE + cx;
        if (who[c]! < 0 || h > top[c]!) {
          top[c] = h;
          who[c] = s;
        }
        continue;
      }
      // A wide piece fills the cells whose centres its turned box reaches, grown by half a cell.
      const a = t.yaw[s]! * YAW_TO_RAD;
      const sn = detSin(a);
      const cs = detCos(a);
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
      const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      const cx0 = Math.max(0, Math.floor((px - ex) * inv));
      const cx1 = Math.min(SIDE - 1, Math.floor((px + ex) * inv));
      const cz0 = Math.max(0, Math.floor((pz - ez) * inv));
      const cz1 = Math.min(SIDE - 1, Math.floor((pz + ez) * inv));
      for (let cz = cz0; cz <= cz1; cz++) {
        const dz = (cz + 0.5) * TACTICAL_CELL - pz;
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = (cx + 0.5) * TACTICAL_CELL - px;
          if (Math.abs(dx * cs - dz * sn) >= hx + SMALL_HALF || Math.abs(dx * sn + dz * cs) >= hz + SMALL_HALF) continue;
          const c = cz * SIDE + cx;
          if (who[c]! < 0 || h > top[c]!) {
            top[c] = h;
            who[c] = s;
          }
        }
      }
    }
  }
  const { tint, info, teams } = out;
  let teamCount = 0;
  let filled = 0;
  for (let c = 0; c < SIDE * SIDE; c++) {
    const s = who[c]!;
    if (s < 0) {
      tint[c] = 0;
      info[c] = 0;
      continue;
    }
    const above = top[c]! - hf.heightAt(x0 + ((c % SIDE) + 0.5) * TACTICAL_CELL, z0 + (Math.floor(c / SIDE) + 0.5) * TACTICAL_CELL);
    let band = 0;
    while (band < BAND_TOPS.length && above > BAND_TOPS[band]!) band++;
    const team = t!.owner[s]!;
    let owner = 0;
    while (owner < teamCount && teams[owner] !== team) owner++;
    if (owner === teamCount) {
      if (teamCount < MAX_TEAMS) teams[teamCount++] = team;
      else owner = OWNER_OTHER;
    }
    tint[c] = shapes.tint[t!.kind[s]!]!;
    info[c] = CELL_FILLED | (owner << 3) | band;
    filled++;
  }
  teams.fill(0, teamCount);
  out.teamCount = teamCount;
  out.filled = filled;
  coarsen(out);
}

/** Fills levels 1 and up from level 0. A coarse cell is the tallest of the four under it, the first of them if they tie. */
function coarsen(s: Summary): void {
  const { tint, info } = s;
  for (let l = 1; l < TACTICAL_LEVELS; l++) {
    const n = SIDE >> l;
    const from = LEVEL_AT[l - 1]!;
    const to = LEVEL_AT[l]!;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let best = 0;
        let colour = 0;
        for (let q = 0; q < 4; q++) {
          const c = from + (j * 2 + (q >> 1)) * n * 2 + i * 2 + (q & 1);
          const v = info[c]!;
          if (v !== 0 && (best === 0 || (v & 7) > (best & 7))) {
            best = v;
            colour = tint[c]!;
          }
        }
        tint[to + j * n + i] = colour;
        info[to + j * n + i] = best;
      }
    }
  }
}

/** Makes `out` the summary of `src` as it would be with only the cells of the team at index `owner`. */
export function onlyTeam(src: Summary, owner: number, out: Summary): void {
  let filled = 0;
  for (let c = 0; c < SIDE * SIDE; c++) {
    const v = src.info[c]!;
    const mine = v !== 0 && ((v >> 3) & 7) === owner;
    out.tint[c] = mine ? src.tint[c]! : 0;
    out.info[c] = mine ? CELL_FILLED | (v & 7) : 0;
    if (mine) filled++;
  }
  out.teams.fill(0);
  out.teams[0] = src.teams[owner]!;
  out.teamCount = filled > 0 ? 1 : 0;
  out.filled = filled;
  coarsen(out);
}

/** One level of one chunk, as a client holds it. */
export class Cells {
  level = 0;
  /** levelSide(level) squared of each are in use, row by row from the chunk's corner. */
  readonly tint = new Uint8Array(SIDE * SIDE);
  readonly info = new Uint8Array(SIDE * SIDE);
  readonly teams = new Uint32Array(MAX_TEAMS);
  teamCount = 0;
}

/** Writes S_TACTICAL's fields after its type: one level of a chunk's summary. */
export function writeCells(w: BitWriter, chunk: number, s: Summary, level: number): void {
  w.u16(chunk);
  w.bits(level, 2);
  w.bits(s.teamCount, 3);
  for (let i = 0; i < s.teamCount; i++) w.varint(s.teams[i]!);
  const side = SIDE >> level;
  const n = side * side;
  const at = LEVEL_AT[level]!;
  const lengthBits = 8 - 2 * level;
  const { tint, info } = s;
  for (let c = 0; c < n; ) {
    const v = info[at + c]!;
    const colour = tint[at + c]!;
    let run = 1;
    while (c + run < n && info[at + c + run] === v && tint[at + c + run] === colour) run++;
    w.bits(run - 1, lengthBits);
    w.bool(v !== 0);
    if (v !== 0) {
      w.u8(colour);
      w.bits(v & 63, 6);
    }
    c += run;
  }
}

/** Reads what writeCells wrote. Returns the chunk, or -1 if the message is malformed, and then `out` holds nothing of use. */
export function readCells(r: BitReader, out: Cells): number {
  const chunk = r.u16();
  const level = r.bits(2);
  const teamCount = r.bits(3);
  for (let i = 0; i < MAX_TEAMS; i++) out.teams[i] = i < teamCount ? r.varint() : 0;
  const side = SIDE >> level;
  const n = side * side;
  const lengthBits = 8 - 2 * level;
  let c = 0;
  while (c < n && !r.overflow) {
    const run = r.bits(lengthBits) + 1;
    const filled = r.bool();
    const colour = filled ? r.u8() : 0;
    const v = filled ? CELL_FILLED | r.bits(6) : 0;
    const owner = (v >> 3) & 7;
    if (c + run > n || (filled && owner >= teamCount && owner !== OWNER_OTHER)) return -1;
    out.tint.fill(colour, c, c + run);
    out.info.fill(v, c, c + run);
    c += run;
  }
  if (r.overflow) return -1;
  out.level = level;
  out.teamCount = teamCount;
  return chunk;
}

/** Kinds of mark: one of the reader's tribe, a creature of that tribe, and any other survivor. */
export const MARK_MATE = 0;
export const MARK_TAME = 1;
export const MARK_OTHER = 2;
/** A message's count is one byte. */
export const MAX_MARKS = 255;
/** Whether survivors of other tribes are marked: never, while in view, or anywhere. */
export const PLAYERS_OFF = 0;
export const PLAYERS_VIEW = 1;
export const PLAYERS_ALL = 2;
/** A mark's position is a share of the map each way, in this many steps. */
const MARK_STEPS = 16384;

function markShare(v: number, size: number): number {
  const q = Math.floor((v / size) * MARK_STEPS);
  return q < 0 ? 0 : q >= MARK_STEPS ? MARK_STEPS - 1 : q;
}

/** 36 bits. `yaw` is in stored yaw units. */
export function writeMark(w: BitWriter, kind: number, x: number, z: number, yaw: number, map: MapExtent): void {
  w.bits(kind, 3);
  w.bits(markShare(x, map.sizeX), 14);
  w.bits(markShare(z, map.sizeZ), 14);
  w.bits((yaw & 0xffff) >>> 11, 5);
}

/** What S_MARKS last said. */
export class Marks {
  count = 0;
  readonly kind = new Uint8Array(MAX_MARKS);
  /** Metres, to the middle of a step: within 0.25 m on an 8 km map. */
  readonly x = new Float32Array(MAX_MARKS);
  readonly z = new Float32Array(MAX_MARKS);
  /** Thirty-seconds of a turn, as a yaw. */
  readonly heading = new Uint8Array(MAX_MARKS);
  /** Which of them is the reader itself, or 255. */
  self = 255;
  /** The map zoom the server holds for the reader, and its PLAYERS_ rule. */
  zoom = 0;
  players = PLAYERS_OFF;
  /** Counts the messages read. */
  version = 0;
}

/** S_MARKS's fields before its marks: the reader's own place among them (255 for none), the zoom held for it, the players rule, the count. */
export function writeMarksHead(w: BitWriter, self: number, zoom: number, players: number, count: number): void {
  w.u8(self);
  w.bits(zoom, 2);
  w.bits(players, 2);
  w.u8(count);
}

/** Reads S_MARKS after its type. False if it is malformed, and then `out` is unchanged. */
export function readMarks(r: BitReader, map: MapExtent, out: Marks): boolean {
  const self = r.u8();
  const zoom = r.bits(2);
  const players = r.bits(2);
  const count = r.u8();
  if (count > MAX_MARKS || count * 36 > r.remainingBits) return false;
  for (let i = 0; i < count; i++) {
    out.kind[i] = r.bits(3);
    out.x[i] = ((r.bits(14) + 0.5) / MARK_STEPS) * map.sizeX;
    out.z[i] = ((r.bits(14) + 0.5) / MARK_STEPS) * map.sizeZ;
    out.heading[i] = r.bits(5);
  }
  out.count = count;
  out.self = self;
  out.zoom = zoom;
  out.players = players;
  out.version++;
  return true;
}
