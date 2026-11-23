// A building set down by hand on a flat map, piece by piece on its frame's tiles, with the map's buildings section made
// for it: the smallest thing the support rule and a collapse can be tried on.

import { ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import type { GameOptions } from "../../server/game.ts";
import type { HostOptions } from "../../server/host.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Pieces, gather, judge, pins } from "../../shared/world/bearing.ts";
import { Buildings, STOREY, type BuildingRow, type BuildingStair } from "../../shared/world/buildings.ts";
import { placeStatics, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { city, type City, type CityPiece } from "./city.ts";
import { flatMap } from "./map.ts";
import { coreRegistry } from "./world.ts";

/** The sides of a tile: toward -v, +u, +v and -u. */
export const SIDE_FRONT = 0, SIDE_RIGHT = 1, SIDE_BACK = 2, SIDE_LEFT = 3;
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** A frame of `cols` by `rows` tiles of `bay` metres round (x, z), unturned, its floor on the ground, and the pieces put on it. */
export class Sketch {
  readonly cols: number;
  readonly rows: number;
  readonly bay: number;
  readonly x: number;
  readonly z: number;
  readonly pieces: CityPiece[] = [];
  readonly stairs: BuildingStair[] = [];
  storeys = 1;
  playable = 1;

  constructor(cols: number, rows: number, bay = 8, x = 96, z = 96) {
    this.cols = cols;
    this.rows = rows;
    this.bay = bay;
    this.x = x;
    this.z = z;
  }

  /** A piece (du, dv) metres from tile (i, j)'s middle with its foot `up` metres over the ground. Returns its number. */
  put(shape: RuinShape, finish: RuinFinish, i: number, j: number, up: number, du = 0, dv = 0, quarter = false): number {
    const u = (i - (this.cols - 1) / 2) * this.bay + du, v = (j - (this.rows - 1) / 2) * this.bay + dv;
    this.pieces.push({ shape, finish, x: this.x + u, z: this.z + v, up, yaw: quarter ? 16384 : 0 });
    return this.pieces.length - 1;
  }

  /** A slab over tile (i, j) at `level`, its top on the level's floor. */
  slab(i: number, j: number, level: number, shape: RuinShape = this.bay === 4 ? "floor4" : "floor8", finish: RuinFinish = "concrete"): number {
    return this.put(shape, finish, i, j, level * STOREY - 0.4);
  }

  /** A piece along a side of tile (i, j), its foot `lift` metres over storey `storey`'s floor. */
  edge(shape: RuinShape, finish: RuinFinish, i: number, j: number, side: number, storey: number, lift = 0): number {
    const [dx, dz] = SIDES[side]!;
    return this.put(shape, finish, i, j, storey * STOREY + lift, (dx * this.bay) / 2, (dz * this.bay) / 2, dx !== 0);
  }

  /** A pier on the corner of tile (i, j) toward +u and +v, standing on storey `storey`'s floor. */
  pier(i: number, j: number, storey: number, shape: RuinShape = "pier4"): number {
    return this.put(shape, "concrete", i, j, storey * STOREY, this.bay / 2, this.bay / 2);
  }

  /** A stair's tile. */
  stair(i: number, j: number, floors: number): void {
    this.stairs.push({ i, j, floors, escape: false });
  }

  /** The building's row for a map. */
  row(id = 1000): BuildingRow {
    return {
      id, kind: "office", recipe: "tower", form: "office", district: "Downtown", collapse: "shear", storeys: this.storeys, playable: this.playable, roof: false, named: false, name: "Sketch", address: null,
      x: this.x, z: this.z, yaw: 0, bay: this.bay, cols: this.cols, rows: this.rows, width: this.cols * this.bay, depth: this.rows * this.bay, base: 0, stairs: this.stairs,
    };
  }
}

export interface Built {
  /** The pieces in the map's order, the place among them of each piece put, and the rest of a map that holds them. */
  readonly statics: MapStatic[];
  readonly at: number[];
  readonly more: Partial<MapData> & { buildings: Buildings };
  readonly ordered: CityPiece[];
}

/** The sketch's pieces in a map's order (a building's are together, storeys ascending) and the map's buildings. */
export function builtSketch(s: Sketch, chunks = 4): Built {
  const reg = coreRegistry();
  const feet = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).low;
  const storey = (p: CityPiece): number => Math.max(0, Math.floor(((p.up ?? 0) + 1 / 16) / STOREY));
  const order = s.pieces.map((_, k) => k).sort((a, b) => storey(s.pieces[a]!) - storey(s.pieces[b]!) || a - b);
  const at: number[] = [];
  order.forEach((k, n) => (at[k] = n));
  const ordered = order.map((k) => s.pieces[k]!);
  const statics = ordered.map((p): MapStatic => {
    const kind = ruinKind(p.shape, p.finish);
    if (!reg.index.has(kind)) throw new Error(`the kit has no ${p.shape} in ${p.finish}`);
    return { kind, x: p.x, y: (p.up ?? 0) - feet[reg.index.get(kind)!]!, z: p.z, yaw: p.yaw ?? 0 };
  });
  const dims = { chunksX: chunks, chunksZ: chunks };
  const buildings = Buildings.of(dims, [s.row()], statics, new Int32Array(statics.length), Uint8Array.from(ordered, storey));
  return { statics, at, ordered, more: { buildings } };
}

/** A sketch set down in a store of its own, with no server: its pieces gathered, and the ref of each piece put. */
export interface Stood {
  readonly structs: StructureStore;
  readonly buildings: Buildings;
  readonly handle: number;
  readonly refs: number[];
  /** The verdict of each piece put, as `judge` gives it with the building's pins, for the store as it stands. */
  judge(): number[];
  /** The pins of each piece put. */
  pins(): number[];
}

export function stood(s: Sketch, chunks = 4): Stood {
  const reg = coreRegistry();
  const built = builtSketch(s, chunks);
  const map = flatMap(chunks, { statics: built.statics, ...built.more });
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const buildings = built.more.buildings;
  const handle = buildings.byId(1000);
  const placed = gather(buildings, [handle], structs, reg, true);
  const pin = new Uint8Array(placed.n);
  pins(placed, pin, new Uint8Array(placed.n));
  const where = new Map<number, number>();
  for (let k = 0; k < placed.n; k++) where.set(placed.ref[k]!, k);
  const refs = s.pieces.map((p, k) => {
    const st = built.statics[built.at[k]!]!;
    const chunk = Math.floor(st.z / CHUNK_SIZE) * chunks + Math.floor(st.x / CHUNK_SIZE);
    const t = structs.chunks[chunk]!;
    for (let slot = 0; slot < t.mapped; slot++) if (Math.abs(t.x[slot]! - st.x) < 0.01 && Math.abs(t.z[slot]! - st.z) < 0.01 && Math.abs(t.y[slot]! - st.y) < 0.01 && reg.ids[structs.mapKind(chunk, slot)] === st.kind) return chunk * 65536 + slot;
    throw new Error(`no ${p.shape} at ${st.x}, ${st.z}`);
  });
  const now = new Pieces();
  return {
    structs, buildings, handle, refs,
    judge: () => {
      gather(buildings, [handle], structs, reg, false, now);
      const out = new Uint8Array(now.n);
      judge(now, out, pin);
      return refs.map((ref) => out[where.get(ref)!]!);
    },
    pins: () => refs.map((ref) => pin[where.get(ref)!]!),
  };
}

/** A server on a flat map that holds the sketch as a building. `refs` are in the order the pieces were put. */
export function sketchCity(s: Sketch, chunks = 4, host: HostOptions = {}, game: Partial<GameOptions> = {}): City {
  const built = builtSketch(s, chunks);
  const c = city(built.ordered, chunks, host, game, built.more);
  return { ...c, refs: s.pieces.map((_, k) => c.refs[built.at[k]!]!) };
}
