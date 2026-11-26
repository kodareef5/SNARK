// The build's last look at its pools, with every piece standing (build.ts). The settling (lakes.ts settleRims) makes each
// pool's way out on the ground alone; here a survivor walks it past the walls, fences and wrecks set down since, by the
// walk the map's audit gates on (way-out.ts). Where pieces stand in every way out of a part of a pool, in this order: a
// ladder is cut at a stretch of rim no piece stands on; else the street's small pieces in the way are taken (`givesWay`,
// never a building's); else the part, and with its last part the pool, is taken out and its ground restored.

import { streetKind } from "../../content/street.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, type MapDims } from "../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { madeOn } from "../../shared/world/mapfile.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { MapWater } from "../../shared/world/water.ts";
import { toYaw } from "../map/layers.ts";
import type { Grid } from "./base.ts";
import { knownOf } from "./known.ts";
import { ladderClear, lakeSquares, restorePool, rimmed, settleRims, type LakeRules, type Lakes, type PoolGround } from "./lakes.ts";
import type { StaticPiece } from "./statics.ts";
import { CLEAR, squaresByBody, wayOut, type Part, type Squares } from "./way-out.ts";

/**
 * Pieces that give way to a pool's way out: the street's furniture, the fences among it, and the wrecks left along it,
 * where no building owns them. Roof plant is its roof's, and a wall, a sill or a floor is never taken.
 */
export const givesWay = (piece: StaticPiece): boolean =>
  (knownOf(piece)?.owner ?? -1) < 0 && ((piece.kind.startsWith(streetKind("")) && !piece.kind.startsWith(streetKind("roof"))) || /^core:(zzzzroad_|compact_|tanker_|box_trailer)/.test(piece.kind));

/** Metres past a pool's box its walk is searched in (way-out.ts), and so the pieces set down for it. */
const PAST = CLEAR + 8;
/** A kind reaching further than this from its middle is set down wherever it stands: a landmark, not a wall. */
const WIDE = 32;
/** Metres over a stretch of rim, from above a step up to over a head, in which a piece makes it no place for a ladder. */
const OVER_RIM = [0.55, 1.9] as const;
/** Times every pool is walked again after ground changed, before what is still caught is taken out unasked. */
const ROUNDS = 4;

/** What the look did, in pools. `taken` are places in the statics given, to leave out of the map. */
export interface PoolsOpened {
  swum: number;
  caught: number;
  laddered: number;
  cleared: number;
  /** Pools taken out whole or in part. */
  takenOut: number;
  notSettled: number;
  readonly taken: Set<number>;
  readonly kinds: Map<string, number>;
  /** A line a pool it changed, with where it lies in the map's metres. */
  readonly did: string[];
}

export function openedLine(o: PoolsOpened): string {
  const kinds = [...o.kinds].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).map(([k, c]) => `${c} ${k.replace("core:", "")}`).join(", ");
  return `${o.swum} swum, ${o.caught} with no way out past the pieces; a ladder cut clear of the pieces in ${o.laddered}; pieces taken from the way in ${o.cleared} (${o.taken.size}${kinds ? `: ${kinds}` : ""}); ${o.takenOut} taken out whole or in part, their ground restored; ${o.notSettled} not settled`;
}

/**
 * Walks each rimmed pool of `lakes` a survivor swims in on `height`, with `statics` standing (in lattice metres:
 * `grid.x0` and `z0` off the map's), and mends those it is caught in. `height`, `lakes` and `pools` change as settleRims
 * changes them, and it settles them again after any change. `sea` is the sea's level, -Infinity for none.
 */
export function openPools(lakes: Lakes, rules: LakeRules | false | undefined, height: Float32Array, grid: Grid, minY: number, stepY: number, sea: number, pools: PoolGround, reg: Registry, statics: readonly StaticPiece[]): PoolsOpened {
  const { nx, nz, sizeX, sizeZ } = grid, N = nx * nz, cell = TERRAIN_CELL;
  const dims: MapDims = { chunksX: sizeX / CHUNK_SIZE, chunksZ: sizeZ / CHUNK_SIZE }, chunks = dims.chunksX * dims.chunksZ;
  const done: PoolsOpened = { swum: 0, caught: 0, laddered: 0, cleared: 0, takenOut: 0, notSettled: 0, taken: new Set(), kinds: new Map(), did: [] };
  const judged = (b: number): boolean => rimmed(lakes.bodies[b - 1]!.kind);
  let any = false;
  for (const i of pools.beds.keys()) if (lakes.body[i] !== 0) { any = true; break; }
  if (!any) return done;

  // The ground as the map will hold it: engine sample (si, sj) is the build's (nx - 1 - si, nz - 1 - sj), its place N - 1 - i.
  const heights = new Uint16Array(N);
  const units = (i: number): number => Math.max(0, Math.min(65535, Math.round((height[i]! - minY) / stepY)));
  const sync = (changed: Iterable<number>): void => { for (const i of changed) heights[N - 1 - i] = units(i); };
  for (let i = 0; i < N; i++) heights[N - 1 - i] = units(i);
  const hf = new Heightfield(dims, cell, minY, stepY, heights, new Uint8Array(0));
  hf.seaLevel = sea;
  /** A sample's place in the map's metres. */
  const placeOf = (i: number): [number, number] => [(nx - 1 - (i % nx)) * cell, (nz - 1 - Math.floor(i / nx)) * cell];

  // The pieces by the chunk they stand in, set down for a walk only where one comes: a city's are millions.
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const chunkOf = (p: StaticPiece): number => {
    const [x, z] = [p.x - grid.x0, p.z - grid.z0];
    return x >= 0 && z >= 0 && x < sizeX && z < sizeZ ? Math.floor(z / CHUNK_SIZE) * dims.chunksX + Math.floor(x / CHUNK_SIZE) : -1;
  };
  const first = new Uint32Array(chunks + 1), order = new Uint32Array(statics.length);
  for (const p of statics) { const c = chunkOf(p); if (c >= 0) first[c + 1]!++; }
  for (let c = 0; c < chunks; c++) first[c + 1]! += first[c]!;
  const fill = first.slice(0, chunks);
  statics.forEach((p, k) => { const c = chunkOf(p); if (c >= 0) order[fill[c]!++] = k; });
  const refOf = new Map<number, number>(), pieceOf = new Map<number, number>(), loaded = new Uint8Array(chunks);
  const put = (k: number): void => {
    const p = statics[k]!, kind = reg.index.get(p.kind) ?? 0;
    const ref = structs.add(kind, p.x - grid.x0, p.y, p.z - grid.z0, toYaw(p.yaw), 0, reg.maxHp[kind]!);
    if (ref < 0) return;
    refOf.set(k, ref);
    pieceOf.set(ref, k);
  };
  /** A piece with the collision a bent one makes under it, as a map's reader makes it. */
  const set = (k: number): void => {
    put(k);
    const p = statics[k]!;
    if (p.bend) madeOn(dims, p.kind, Math.round((p.x - grid.x0) * STRUCT_UNITS), Math.round(p.y * STRUCT_UNITS), Math.round((p.z - grid.z0) * STRUCT_UNITS), toYaw(p.yaw), Int16Array.from(p.bend), (kind, ux, uy, uz, yaw) => {
      const made = reg.index.get(kind) ?? 0;
      structs.add(made, ux / STRUCT_UNITS, uy / STRUCT_UNITS, uz / STRUCT_UNITS, yaw, 0, reg.maxHp[made]!);
    });
  };
  const reach = (p: StaticPiece): number => { const kind = reg.index.get(p.kind) ?? 0; return Math.hypot(reg.halfX[kind] ?? 0, reg.halfZ[kind] ?? 0); };
  const wide = new Set<number>();
  let widest = 0;
  statics.forEach((p, k) => {
    const r = reach(p);
    if (r > WIDE) { wide.add(k); if (chunkOf(p) >= 0) set(k); } else widest = Math.max(widest, r);
  });
  /** Sets down the pieces that reach into a box, each once. */
  const stand = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let cz = Math.max(0, Math.floor((z0 - widest) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z1 + widest) / CHUNK_SIZE)); cz++) for (let cx = Math.max(0, Math.floor((x0 - widest) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x1 + widest) / CHUNK_SIZE)); cx++) {
      const c = cz * dims.chunksX + cx;
      if (loaded[c]) continue;
      loaded[c] = 1;
      for (let q = first[c]!; q < first[c + 1]!; q++) if (!wide.has(order[q]!)) set(order[q]!);
    }
  };

  // The water as the map will hold it, made again when a pool goes.
  let g: Squares = { body: new Uint16Array(0), wx: sizeX / cell, wz: sizeZ / cell }, of: number[][] = [];
  let walk!: ReturnType<typeof wayOut>;
  const wet = (): void => {
    g = { body: lakeSquares(lakes, grid, cell), wx: sizeX / cell, wz: sizeZ / cell };
    of = squaresByBody(g, lakes.bodies.length);
    const water = MapWater.fromGrid(dims, minY, stepY, cell, lakes.bodies.map((b) => ({ name: b.name, level: Math.round((b.surface - minY) / stepY) })), g.body);
    hf.water = water;
    walk = wayOut({ hf, structs, water, reg, sizeX, sizeZ, wider: stand }, g);
  };
  /** The box of a body's squares, in metres. */
  const boxOf = (b: number): [number, number, number, number] => {
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const k of of[b]!) { const i = k % g.wx, j = (k - i) / g.wx; x0 = Math.min(x0, i * cell); x1 = Math.max(x1, (i + 1) * cell); z0 = Math.min(z0, j * cell); z1 = Math.max(z1, (j + 1) * cell); }
    return [x0, z0, x1, z1];
  };
  /** A body's parts as a survivor finds them, the pieces a straight walk of it may meet standing. */
  const walked = (b: number): Part[] => {
    if (of[b]!.length === 0) return [];
    const [x0, z0, x1, z1] = boxOf(b), far = PAST + Math.hypot(x1 - x0, z1 - z0);
    stand(x0 - far, z0 - far, x1 + far, z1 + far);
    return walk(b, of[b]!);
  };
  /** The build's samples of body `b` at the corners of a part's squares. */
  const samplesOf = (b: number, part: Part): number[] => {
    const own = new Set<number>();
    for (const k of part.squares) {
      const i = k % g.wx, j = (k - i) / g.wx;
      for (const [a, c] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]] as const) { const at = N - 1 - (c * nx + a); if (lakes.body[at] === b) own.add(at); }
    }
    return [...own].sort((p, q) => p - q);
  };
  const found = new Found(), outOf = new Set<number>();
  const lift = (k: number): void => { const ref = refOf.get(k)!; structs.remove(ref); refOf.delete(k); pieceOf.delete(ref); };

  wet();
  for (let round = 0; round <= ROUNDS; round++) {
    let moved = false;
    for (let b = 1; b <= lakes.bodies.length; b++) {
      if (!judged(b) || of[b]!.length === 0) continue;
      const parts = walked(b), swum = parts.filter((p) => p.swims), caught = swum.filter((p) => p.out === false);
      if (round === 0) {
        if (swum.length > 0) done.swum++;
        if (caught.length === 0 && swum.some((p) => p.out === null)) done.notSettled++;
        if (caught.length > 0) done.caught++;
      }
      let left = parts.length;
      for (const part of caught) {
        const inPart = new Set(part.squares), where = `${part.x.toFixed(0)}, ${part.z.toFixed(0)}`;
        /** Whether this part is still one a survivor is caught in. */
        const still = (): boolean => walked(b).some((p) => p.swims && p.out === false && p.squares.some((k) => inPart.has(k)));
        const own = samplesOf(b, part);
        // A ladder where no piece stands over the rim, while a round is left to walk it again in.
        if (round < ROUNDS && own.length > 0 && ladderClear(lakes, rules, height, grid, pools, own, {
          free: (rim, top) => {
            const at = rim.map(placeOf);
            return !structs.any(Math.min(at[0]![0], at[1]![0]) - 1, Math.min(at[0]![1], at[1]![1]) - 1, Math.max(at[0]![0], at[1]![0]) + 1, Math.max(at[0]![1], at[1]![1]) + 1, top + OVER_RIM[0], top + OVER_RIM[1]);
          },
          sync,
          works: () => !still(),
        })) {
          done.laddered++;
          done.did.push(`pool at ${where}: a ladder cut where no piece stands`);
          moved = true;
          continue;
        }
        // The street's small pieces by it: all away, and where that lets it out, each back that is not in the way.
        const near: number[] = [], [x0, z0, x1, z1] = boxOf(b);
        if (round < ROUNDS) {
          const m = structs.query(x0 - PAST, z0 - PAST, x1 + PAST, z1 + PAST, found);
          for (let q = 0; q < m; q++) { const k = pieceOf.get(found.refs[q]!); if (k !== undefined && givesWay(statics[k]!)) near.push(k); }
        }
        // From the farthest: what stands at the water is what is in the way.
        const far = (k: number): number => Math.hypot(statics[k]!.x - grid.x0 - part.x, statics[k]!.z - grid.z0 - part.z);
        near.sort((p, q) => far(q) - far(p) || p - q);
        for (const k of near) lift(k);
        if (near.length > 0 && !still()) {
          const gone: number[] = [];
          for (const k of near) {
            put(k);
            if (!still()) continue;
            lift(k);
            gone.push(k);
          }
          for (const k of gone) { done.taken.add(k); done.kinds.set(statics[k]!.kind, (done.kinds.get(statics[k]!.kind) ?? 0) + 1); }
          done.cleared++;
          done.did.push(`pool at ${where}: ${gone.map((k) => statics[k]!.kind.replace("core:", "")).join(", ")} taken from its way out`);
          continue;
        }
        for (const k of near) put(k);
        // No way past what stands: the part goes back to ground, and with its last part the pool.
        const whole = --left === 0;
        const out = whole ? [...pools.beds.keys()].filter((i) => lakes.body[i] === b) : own;
        const round1 = new Set<number>();
        for (const i of out) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const j = i + dr * nx + dc; if (j >= 0 && j < N) round1.add(j); }
        restorePool(lakes, height, grid, pools, out, whole);
        sync(round1);
        if (!outOf.has(b)) done.takenOut++;
        outOf.add(b);
        done.did.push(`pool at ${where}: ${whole ? "taken out" : "the caught part of it taken out"}, ${out.length} samples back to ground`);
        moved = true;
        wet();
      }
    }
    if (!moved) break;
    // Ground changed: settled once more as the rule has it, and every pool walked again.
    settleRims(lakes, rules, height, grid, minY, stepY, pools);
    for (let i = 0; i < N; i++) heights[N - 1 - i] = units(i);
    wet();
  }
  return done;
}
