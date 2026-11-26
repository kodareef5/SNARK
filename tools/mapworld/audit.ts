// A built map's audit: scans of the whole map as the server holds it, one JSON line a check. A gate's count must be 0.
//   bun tools/mapworld/audit.ts <map.snmap>

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { isDock, isMoored } from "../../content/docks.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { blankFrame } from "../../shared/world/buildings.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { HIT_PREFIX } from "../../shared/world/bends.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { bendOf, mapHeightfield, parseMap, placeStatics, staticKinds, type MapFile } from "../../shared/world/mapfile.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { CLEAR, rimOver, squaresByBody, squaresOf, wayOut, type Part, type Squares } from "./way-out.ts";

/** A map opened for the checks: its ground, and its statics set down as a server's. */
export interface Audited {
  readonly map: MapFile;
  readonly reg: Registry;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** The map's kinds as content indices. */
  readonly kindOf: Uint16Array;
  readonly sizeX: number;
  readonly sizeZ: number;
}

/** A check's answer: `count` is what a gate holds to 0, the rest says what was counted. */
export interface Check {
  readonly check: string;
  readonly gate: boolean;
  readonly count: number;
  readonly [more: string]: unknown;
}

export function openMap(bytes: Uint8Array): Audited {
  const map = parseMap(bytes);
  const reg = withContent(compileContent(CORE_CONTENT).registry!, map.content?.defs ?? []);
  const hf = mapHeightfield({ ...map, tint: new Uint8Array(0) });
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  return { map, reg, hf, structs, kindOf: staticKinds(map.statics, reg), sizeX: map.dims.chunksX * CHUNK_SIZE, sizeZ: map.dims.chunksZ * CHUNK_SIZE };
}

const at = (x: number, y: number, z: number): string => `${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}`;
const found = new Found();

/** (x, z) in the frame of the static in `row`. */
function into(w: Audited, row: number, x: number, z: number): [number, number] {
  const s = w.map.statics;
  frameOf(s.yaw[row]!, 0);
  const dx = x - s.x[row]!, dz = z - s.z[row]!;
  return [dx * frame.cos - dz * frame.sin, dx * frame.sin + dz * frame.cos];
}

/** Where the last `pieceAt` found its piece. */
const hit = { chunk: 0, slot: 0 };

/**
 * The row of a static, not `self` and wanted by `counts`, one of whose boxes holds (x, z) widened by `r` between y0 and y1;
 * -1 for none. A kind of hulls alone (a ramp, a road deck) has no box and is never found: its bounding box is mostly air.
 */
function pieceAt(w: Audited, x: number, z: number, y0: number, y1: number, r: number, self: number, counts: (row: number, chunk: number, slot: number) => boolean): number {
  const { map, reg, structs, kindOf } = w, s = map.statics, parts = reg.parts!;
  const pad = Math.max(r, 0.05);
  const m = structs.query(x - pad, z - pad, x + pad, z + pad, found, y0, y1);
  for (let q = 0; q < m; q++) {
    const ref = found.refs[q]!, chunk = Math.floor(ref / 65536), slot = ref & 0xffff;
    const row = s.first[chunk]! + slot;
    if (row === self || !counts(row, chunk, slot)) continue;
    const k = kindOf[s.kind[row]!]!;
    const [lx, lz] = into(w, row, x, z);
    for (let p = parts.start[k]! * 6; p < parts.start[k + 1]! * 6; p += 6) {
      const cy = s.y[row]! + parts.box[p + 1]!;
      if (!(cy + parts.box[p + 4]! > y0 && cy - parts.box[p + 4]! < y1 && Math.abs(lx - parts.box[p]!) < parts.box[p + 3]! + r && Math.abs(lz - parts.box[p + 2]!) < parts.box[p + 5]! + r)) continue;
      [hit.chunk, hit.slot] = [chunk, slot];
      return row;
    }
  }
  return -1;
}

/** Pieces whose origin is off the map, and buildings whose frame's middle is, with the pieces theirs. */
export function offMap(w: Audited): Check {
  const { map, sizeX, sizeZ } = w, s = map.statics, b = map.buildings;
  const off = (x: number, z: number): boolean => !(x >= 0 && x <= sizeX && z >= 0 && z <= sizeZ);
  let pieces = 0, buildings = 0, theirs = 0;
  const first: string[] = [];
  for (let r = 0; r < s.length; r++) {
    if (!off(s.x[r]!, s.z[r]!)) continue;
    pieces++;
    if (first.length < 3) first.push(`${s.kinds[s.kind[r]!]} at ${at(s.x[r]!, s.y[r]!, s.z[r]!)}`);
  }
  const fr = blankFrame();
  for (const h of b?.handles() ?? []) {
    b!.frame(h, fr);
    if (!off(fr.x, fr.z)) continue;
    buildings++;
    b!.eachRun(h, (_chunk, _slot, count) => (theirs += count));
    if (first.length < 3) first.push(`${b!.kind(h)} ${b!.id(h)} at ${fr.x.toFixed(1)}, ${fr.z.toFixed(1)}`);
  }
  return { check: "pieces off the map", gate: true, count: pieces + buildings, pieces, buildings, piecesOfThoseBuildings: theirs, first };
}

/**
 * Later copies of a piece: the same kind, place, turn and bend, as the build takes out (twins.ts). The collision boxes
 * the map's reader makes under a bent piece (bends.ts madeHits) are no layer's to place, and one piece makes the same box
 * twice where a chord is a hair longer than its boxes: the two fall within a step of the map's lattice. Those are counted
 * apart and fail nothing.
 */
export function twins(w: Audited): Check {
  const s = w.map.statics;
  const made = s.kinds.map((id) => id.startsWith(HIT_PREFIX));
  const seen = new Set<string>();
  let count = 0, madeBoxesTwice = 0;
  const first: string[] = [];
  for (let c = 0; c + 1 < s.first.length; c++) {
    const [a, e] = [s.first[c]!, s.first[c + 1]!];
    if (e - a < 2) continue;
    seen.clear();
    const bends = s.bends.get(c);
    for (let r = a; r < e; r++) {
      const bend = bends ? bendOf(bends, r - a) : null;
      const key = `${s.kind[r]},${s.x[r]},${s.y[r]},${s.z[r]},${s.yaw[r]}${bend ? `,${bend.join(" ")}` : ""}`;
      if (!seen.has(key)) { seen.add(key); continue; }
      if (made[s.kind[r]!]) { madeBoxesTwice++; continue; }
      count++;
      if (first.length < 3) first.push(`${s.kinds[s.kind[r]!]} at ${at(s.x[r]!, s.y[r]!, s.z[r]!)}`);
    }
  }
  return { check: "pieces placed twice", gate: true, count, of: s.length, madeBoxesTwice, first };
}

const waterGrid = (w: Audited): Squares | null => (w.map.water ? squaresOf(w.map.water, w.map.dims) : null);

/**
 * Bodies that go on from a row's last square into the next row's first with no way between the two on the map: a lake
 * grown across the edge of its array.
 */
export function lakeWraps(w: Audited): Check {
  const g = waterGrid(w);
  if (!g) return { check: "lakes wrapping a map edge", gate: true, count: 0, bodies: 0 };
  const { body, wx, wz } = g;
  const wrapped = new Map<number, string>();
  /** Whether `b`'s squares join (i0, j0) to (i1, j1), by sides and corners. */
  const joined = (b: number, i0: number, j0: number, i1: number, j1: number): boolean => {
    const seen = new Set<number>([j0 * wx + i0]), queue = [j0 * wx + i0];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!, i = k % wx, j = (k - i) / wx;
      if (i === i1 && j === j1) return true;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const [a, c] = [i + di, j + dj];
        if (a < 0 || c < 0 || a >= wx || c >= wz || body[c * wx + a] !== b || seen.has(c * wx + a)) continue;
        seen.add(c * wx + a);
        queue.push(c * wx + a);
      }
    }
    return false;
  };
  for (let j = 0; j + 1 < wz; j++) {
    const b = body[j * wx + wx - 1]!;
    if (b === 0 || wrapped.has(b) || body[(j + 1) * wx] !== b || joined(b, wx - 1, j, 0, j + 1)) continue;
    wrapped.set(b, `body ${b}${w.map.water!.bodies[b - 1]!.name ? ` "${w.map.water!.bodies[b - 1]!.name}"` : ""} at z ${j * w.map.water!.cell}`);
  }
  return { check: "lakes wrapping a map edge", gate: true, count: wrapped.size, bodies: w.map.water!.bodies.length, first: [...wrapped.values()].slice(0, 3) };
}

/**
 * Moored hulls and hulks with a point of the inner nine tenths of one of their boxes inside another piece's box. A dock's
 * pieces do not count: a hull lies against its dock.
 */
export function hullsInPieces(w: Audited): Check {
  const { map, reg, kindOf } = w, s = map.statics, parts = reg.parts!;
  const hull = s.kinds.map((id) => isMoored(id) || id.startsWith("core:hulk_"));
  const solid = s.kinds.map((id) => !isDock(id));
  let hulls = 0, count = 0;
  const first: string[] = [];
  for (let r = 0; r < s.length; r++) {
    if (!hull[s.kind[r]!]) continue;
    hulls++;
    const k = kindOf[s.kind[r]!]!;
    frameOf(s.yaw[r]!, 0);
    const [cos, sin] = [frame.cos, frame.sin];
    const [b0, b1] = [parts.start[k]!, parts.start[k + 1]!];
    const boxes = b0 === b1 ? [0, 0, 0, reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!] : Array.from(parts.box.subarray(b0 * 6, b1 * 6));
    let inside = -1;
    for (let p = 0; p < boxes.length && inside < 0; p += 6) {
      const [bx, by, bz, hx, hy, hz] = [boxes[p]!, boxes[p + 1]!, boxes[p + 2]!, boxes[p + 3]! * 0.9, boxes[p + 4]! * 0.9, boxes[p + 5]! * 0.9];
      const [nx, nz] = [Math.max(1, Math.ceil(hx * 4)), Math.max(1, Math.ceil(hz * 4))];
      for (let j = 0; j <= nz && inside < 0; j++) for (let i = 0; i <= nx && inside < 0; i++) {
        const [lx, lz] = [bx - hx + (2 * hx * i) / nx, bz - hz + (2 * hz * j) / nz];
        inside = pieceAt(w, s.x[r]! + lx * cos + lz * sin, s.z[r]! - lx * sin + lz * cos, s.y[r]! + by - hy, s.y[r]! + by + hy, 0, r, (row) => solid[s.kind[row]!]!);
      }
    }
    if (inside < 0) continue;
    count++;
    if (first.length < 3) first.push(`${s.kinds[s.kind[r]!]} at ${at(s.x[r]!, s.y[r]!, s.z[r]!)} in ${s.kinds[s.kind[inside]!]}`);
  }
  return { check: "hulls inside other pieces", gate: true, count, hulls, first };
}

/** Metres of a body's edge that make it walled, and how far over what it meets its surface must stand there. */
const WALL_METRES = 10, WALL_STEP = 0.25;

/**
 * Bodies whose water ends in a wall: at least WALL_METRES of their wet squares' outer edge where the surface stands more
 * than WALL_STEP over the ground there, or over the water of the square past it.
 */
export function waterWalls(w: Audited): Check {
  const g = waterGrid(w), water = w.map.water;
  if (!g || !water) return { check: "water ending in a wall", gate: false, count: 0, bodies: 0 };
  const { body, wx, wz } = g, cell = water.cell, n = water.bodies.length, sea = w.map.seaLevel;
  const H = (i: number, j: number): number => w.hf.heightAt(i * cell, j * cell);
  const wall = new Float64Array(n + 1), most = new Float32Array(n + 1), wet = new Uint32Array(n + 1), place = new Float64Array(2 * (n + 1));
  for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
    const b = body[j * wx + i]!;
    if (b === 0) continue;
    const S = water.surface[b]!, [h00, h10, h01, h11] = [H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)];
    if (!(Math.min(h00, h10, h01, h11) < S)) continue;
    wet[b]!++;
    for (const [di, dj, edge] of [[1, 0, (h10 + h11) / 2], [-1, 0, (h00 + h01) / 2], [0, 1, (h01 + h11) / 2], [0, -1, (h00 + h10) / 2]] as const) {
      const [a, c] = [i + di, j + dj];
      if (a < 0 || c < 0 || a >= wx || c >= wz || body[c * wx + a] === b || !(edge < S)) continue;
      const next = body[c * wx + a] === 0 ? sea : water.surface[body[c * wx + a]!]!;
      const drop = S - Math.max(edge, next);
      if (!(drop > WALL_STEP)) continue;
      wall[b]! += cell;
      if (drop > most[b]!) [most[b], place[b * 2], place[b * 2 + 1]] = [drop, (i + 0.5) * cell, (j + 0.5) * cell];
    }
  }
  let count = 0, over1 = 0, small = 0, metres = 0, worst = 0;
  for (let b = 1; b <= n; b++) {
    metres += wall[b]!;
    if (wall[b]! < WALL_METRES) continue;
    count++;
    if (most[b]! > 1) over1++;
    if (wet[b]! * cell * cell < 1000) small++;
    if (worst === 0 || wall[b]! * most[b]! > wall[worst]! * most[worst]!) worst = b;
  }
  return { check: "water ending in a wall", gate: false, count, bodies: n, byOverAMetre: over1, wetUnder1000SquareMetres: small, wallMetres: metres,
    worst: worst ? `body ${worst} at ${place[worst * 2]}, ${place[worst * 2 + 1]}: ${wall[worst]} m of wall, ${most[worst]!.toFixed(2)} m at the most` : null };
}

/**
 * Runs of 4 m or more of a street's centre line where a body 0.8 m wide, from 0.6 to 1.8 m over the ground, would stand
 * in a building's piece. `lines` are the centre lines (x, z, x, z...) with their street types, the map's own if not given. A run is in one building.
 */
export function streetsThroughBuildings(w: Audited, lines?: readonly { readonly xz: ArrayLike<number>; readonly type: number }[]): Check {
  const { map, hf, sizeX, sizeZ } = w, b = map.buildings;
  const check = "streets through buildings";
  if (!b) return { check, gate: false, count: 0, samples: 0 };
  if (!lines) {
    const all: { xz: ArrayLike<number>; type: number }[] = [], keys = new Set<string>();
    // A stretch that reaches several sectors is in each one's part.
    for (const p of map.streets ?? []) for (const st of p.part!.stretches) {
      const key = `${st.type},${st.seed},${st.xz[0]},${st.xz[1]},${st.xz.length},${st.xz[st.xz.length - 2]}`;
      if (!keys.has(key)) { keys.add(key); all.push(st); }
    }
    lines = all;
  }
  const [gx, gz] = [Math.ceil(sizeX / 2), Math.ceil(sizeZ / 2)];
  const seen = new Int32Array(gx * gz);
  const byType: number[] = [];
  let samples = 0, blocked = 0, runs = 0, long = 0, metres = 0, longest = 0, where = "";
  lines.forEach((st, k) => {
    let run = 0, of = -1, x0 = 0, z0 = 0;
    const end = (): void => {
      if (run >= 4) { long++; metres += run; byType[st.type] = (byType[st.type] ?? 0) + 1; if (run > longest) [longest, where] = [run, `${x0.toFixed(1)}, ${z0.toFixed(1)}`]; }
      [run, of] = [0, -1];
    };
    for (let q = 0; q + 3 < st.xz.length; q += 2) {
      const [ax, az, bx, bz] = [st.xz[q]!, st.xz[q + 1]!, st.xz[q + 2]!, st.xz[q + 3]!];
      const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(length / 2));
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (x < 0 || z < 0 || x >= sizeX || z >= sizeZ) continue;
        // A place two streets cross is the first one's.
        const cell = Math.floor(z / 2) * gx + Math.floor(x / 2);
        if (seen[cell] !== 0 && seen[cell] !== k + 1) continue;
        seen[cell] = k + 1;
        samples++;
        const y = hf.heightAt(x, z);
        if (pieceAt(w, x, z, y + 0.6, y + 1.8, 0.4, -1, (_row, chunk, slot) => b.buildingOf(chunk, slot) >= 0) < 0) { end(); continue; }
        const h = b.id(b.buildingOf(hit.chunk, hit.slot));
        blocked++;
        if (h !== of) { end(); runs++; [of, x0, z0] = [h, x, z]; }
        run += length / steps;
      }
    }
    end();
  });
  return { check, gate: false, count: long, runsOfAnyLength: runs, metres: Math.round(metres), samples, samplesBlocked: blocked, byStreetType: Array.from(byType, (v) => v ?? 0), longest: longest ? `${longest.toFixed(0)} m from ${where}` : null };
}

/**
 * Ground-storey door canopies whose building's floor stands more than half a metre over or under the ground 1.5 m out
 * from them. A canopy marks a way in whether or not the build laid an approach to it.
 */
export function doorsOffGround(w: Audited): Check {
  const { map, hf, sizeX, sizeZ } = w, s = map.statics, b = map.buildings;
  const check = "doors off the ground";
  if (!b) return { check, gate: false, count: 0, doors: 0 };
  const canopy = s.kinds.map((id) => id.startsWith("core:zruin_zentry"));
  const fr = blankFrame();
  let doors = 0, count = 0, over1 = 0, above = 0, worst = 0, where = "";
  for (let c = 0; c + 1 < s.first.length; c++) for (let r = s.first[c]!; r < s.first[c + 1]!; r++) {
    if (!canopy[s.kind[r]!] || b.storeyOf(c, r - s.first[c]!) !== 0) continue;
    const h = b.buildingOf(c, r - s.first[c]!);
    b.frame(h, fr);
    doors++;
    // Out is the canopy's own +z or -z, whichever leaves its building's middle.
    frameOf(s.yaw[r]!, 0);
    const out = (s.x[r]! - fr.x) * frame.sin + (s.z[r]! - fr.z) * frame.cos < 0 ? -1.5 : 1.5;
    const [x, z] = [Math.max(0, Math.min(sizeX, s.x[r]! + frame.sin * out)), Math.max(0, Math.min(sizeZ, s.z[r]! + frame.cos * out))];
    const d = fr.base - hf.heightAt(x, z);
    if (!(Math.abs(d) > 0.5)) continue;
    count++;
    if (d > 0) above++;
    if (Math.abs(d) > 1) over1++;
    if (Math.abs(d) > Math.abs(worst)) [worst, where] = [d, at(x, fr.base, z)];
  }
  return { check, gate: false, count, doors, floorAboveGround: above, floorBelowGround: count - above, byOverAMetre: over1, worst: count ? `floor at ${where}, ${worst > 0 ? "+" : ""}${worst.toFixed(2)} m from the ground` : null };
}

/**
 * Building pieces no part of which shows: the top of their boxes 0.25 m under the ground at their middle and at the four
 * corners of their kind's box. `atTheMiddle` counts those under at the middle, as the first audit did.
 */
export function piecesUnderGround(w: Audited): Check {
  const { map, reg, hf, structs, kindOf, sizeX, sizeZ } = w, s = map.statics, b = map.buildings;
  const piece = s.kinds.map((id) => /^core:z{1,2}ruin_/.test(id) && !id.startsWith("core:zruin_zentry") && !id.startsWith("core:zzruin_floorroad"));
  let pieces = 0, middle = 0, count = 0, ofNoBuilding = 0, deepest = 0, where = "";
  for (let c = 0; c + 1 < s.first.length; c++) for (let r = s.first[c]!; r < s.first[c + 1]!; r++) {
    if (!piece[s.kind[r]!]) continue;
    pieces++;
    const k = kindOf[s.kind[r]!]!, [x, y, z] = [s.x[r]!, s.y[r]!, s.z[r]!];
    const top = y + structs.top[k]!, g = hf.heightAt(x, z);
    if (!(top < g - 0.25)) continue;
    middle++;
    frameOf(s.yaw[r]!, 0);
    let least = g;
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const [lx, lz] = [ax * reg.halfX[k]!, az * reg.halfZ[k]!];
      least = Math.min(least, hf.heightAt(Math.max(0, Math.min(sizeX, x + lx * frame.cos + lz * frame.sin)), Math.max(0, Math.min(sizeZ, z - lx * frame.sin + lz * frame.cos))));
    }
    if (!(top < least - 0.25)) continue;
    count++;
    if (!b || b.buildingOf(c, r - s.first[c]!) < 0) ofNoBuilding++;
    if (least - top > deepest) [deepest, where] = [least - top, `${s.kinds[s.kind[r]!]} at ${at(x, y, z)}`];
  }
  return { check: "building pieces under the ground", gate: false, count, pieces, atTheMiddle: middle, ofNoBuilding, deepest: count ? `${where}, its top ${deepest.toFixed(2)} m under` : null };
}

/** A body of water as a survivor meets it. */
export interface Swum {
  readonly body: number;
  /** Squares of it with water in them, and the most water over one of their corners. */
  readonly wet: number;
  readonly depth: number;
  /** Whether a survivor set down in a part of it swims. */
  readonly swims: boolean;
  /**
   * Whether it gets out of every part it swims in, or of every part where it swims in none; null where a part was not
   * settled and none caught it: too big to search, or a search that ran past its places.
   */
  readonly out: boolean | null;
  /** How many other bodies' squares touch its own or theirs. */
  readonly touches: number;
  /** Its parts, each walked (way-out.ts). */
  readonly parts: readonly Part[];
}

/** The most wet squares of a body counted among the pits: 10,000 m2 of 2 m squares, a resort's pool or a pond. */
const WALKED_SQUARES = 2500;

const swumOf = new WeakMap<Audited, Swum[]>();

/**
 * Each body with water, as the game's own stepper finds it with every piece standing (way-out.ts): a survivor set down
 * in each of its parts swims or not by the content's swim depth, and from there gets out or does not, by a straight walk
 * or a search of the stepper's moves, onto dry ground that is no body's and CLEAR metres past its own squares.
 */
export function bodiesSwum(w: Audited): Swum[] {
  const had = swumOf.get(w);
  if (had) return had;
  const g = waterGrid(w), water = w.map.water;
  if (!g || !water) return [];
  const { body, wx, wz } = g, n = water.bodies.length, of = squaresByBody(g, n);
  const group = Int32Array.from({ length: n + 1 }, (_, b) => b);
  const root = (b: number): number => { while (group[b] !== b) b = group[b] = group[group[b]!]!; return b; };
  for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
    const b = body[j * wx + i]!;
    if (b === 0) continue;
    for (const o of [i + 1 < wx ? body[j * wx + i + 1]! : 0, j + 1 < wz ? body[(j + 1) * wx + i]! : 0]) if (o !== 0 && o !== b) group[root(o)] = root(b);
  }
  const walk = wayOut({ ...w, water }, g), walked: [number, Part[]][] = [];
  for (let b = 1; b <= n; b++) {
    const parts = of[b]!.length > 0 ? walk(b, of[b]!) : [];
    if (parts.length > 0) walked.push([b, parts]);
  }
  const together = new Map<number, number>();
  for (const [b] of walked) together.set(root(b), (together.get(root(b)) ?? 0) + 1);
  const out = walked.map(([b, parts]): Swum => {
    const swum = parts.filter((p) => p.swims), judged = swum.length > 0 ? swum : parts;
    return { body: b, wet: parts.reduce((sum, p) => sum + p.squares.length, 0), depth: Math.max(...parts.map((p) => p.depth)), swims: swum.length > 0,
      out: judged.some((p) => p.out === false) ? false : judged.some((p) => p.out === null) ? null : true, touches: together.get(root(b))! - 1, parts };
  });
  swumOf.set(w, out);
  return out;
}

/** Pairs of bodies with a square of one beside a square of the other. */
export function touchingPairs(w: Audited): number {
  const g = waterGrid(w);
  if (!g) return 0;
  const { body, wx, wz } = g, pairs = new Set<string>();
  for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
    const b = body[j * wx + i]!;
    if (b === 0) continue;
    for (const o of [i + 1 < wx ? body[j * wx + i + 1]! : 0, j + 1 < wz ? body[(j + 1) * wx + i]! : 0]) if (o !== 0 && o !== b) pairs.add(`${Math.min(b, o)} ${Math.max(b, o)}`);
  }
  return pairs.size;
}

/** The ring two corners out from a body's squares that hold water: its ground's median against the body's surface. */
const PIT = 1;

/**
 * Bodies of up to 10,000 m2 standing in a pit: their surface more than PIT metres under the median of the ground two
 * corners out from their water all round. A pool is a step under the ground round it; one a storey down is a shaft.
 */
export function poolsInPits(w: Audited): Check {
  const g = waterGrid(w), water = w.map.water, check = "water standing in a pit";
  if (!g || !water) return { check, gate: false, count: 0, bodies: 0 };
  const { body, wx, wz } = g, cell = water.cell, { hf, sizeX, sizeZ } = w, across = wx + 1;
  const corners = new Map<number, Set<number>>();
  for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
    const b = body[j * wx + i]!;
    if (b === 0) continue;
    const at = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
    if (!at.some(([u, v]) => hf.heightAt(u! * cell, v! * cell) < water.surface[b]!)) continue;
    let set = corners.get(b);
    if (!set) corners.set(b, (set = new Set()));
    for (const [u, v] of at) set.add(v! * across + u!);
  }
  let bodies = 0, count = 0, deepest = 0, where = "";
  for (const [b, set] of corners) {
    if (set.size > WALKED_SQUARES * 2) continue;
    bodies++;
    const ring = new Set<number>();
    for (const k of set) {
      const u = k % across, v = Math.floor(k / across);
      for (let dv = -2; dv <= 2; dv++) for (let du = -2; du <= 2; du++) {
        if (Math.max(Math.abs(du), Math.abs(dv)) !== 2 || u + du < 0 || v + dv < 0 || u + du > wx || v + dv > wz) continue;
        const at = (v + dv) * across + u + du;
        // Two out from every corner of the water, not only from this one.
        let near = false;
        for (let b1 = -1; b1 <= 1 && !near; b1++) for (let a1 = -1; a1 <= 1 && !near; a1++) near = u + du + a1 >= 0 && u + du + a1 <= wx && set.has(at + b1 * across + a1);
        if (!near) ring.add(at);
      }
    }
    if (ring.size === 0) continue;
    const levels = Float64Array.from(ring, (k) => hf.heightAt(Math.min(sizeX, (k % across) * cell), Math.min(sizeZ, Math.floor(k / across) * cell))).sort();
    const under = levels[levels.length >> 1]! - water.surface[b]!;
    if (!(under > PIT)) continue;
    count++;
    if (under > deepest) { const k = set.values().next().value!; [deepest, where] = [under, `body ${b} at ${(k % across) * cell}, ${Math.floor(k / across) * cell}: its water ${under.toFixed(2)} m under the ground round it`]; }
  }
  return { check, gate: false, count, bodies, deepest: count ? where : null };
}

/** A rim this far over a swum body's water makes it a sunk pool, and this far a deep one. */
const SUNK = 1, SUNK_DEEP = 3;

/**
 * Sunk pools: bodies a survivor swims in whose rim, the corners of their wet squares that stand out of the water, lies
 * over SUNK metres above it at the median. Every pool found with no way out was one of these.
 */
export function sunkPools(w: Audited): Check {
  const g = waterGrid(w), water = w.map.water, check = "sunk pools";
  if (!g || !water) return { check, gate: false, count: 0, swimmable: 0 };
  const of = squaresByBody(g, water.bodies.length), walked = { ...w, water };
  let swimmable = 0, count = 0, over3 = 0, deepest = 0, where = "";
  for (const s of bodiesSwum(w)) {
    if (!s.swims) continue;
    swimmable++;
    const rim = rimOver(walked, g, s.body, of[s.body]!);
    const over = rim.length > 0 ? rim[rim.length >> 1]! : 0;
    if (!(over > SUNK)) continue;
    count++;
    if (over > SUNK_DEEP) over3++;
    if (over > deepest) [deepest, where] = [over, `body ${s.body} at ${s.parts[0]!.x.toFixed(0)}, ${s.parts[0]!.z.toFixed(0)}: its rim ${over.toFixed(2)} m over its water`];
  }
  return { check, gate: false, count, swimmable, overThreeMetres: over3, deepest: count ? where : null };
}

/**
 * Water a survivor swims in and gets out of. The gate counts bodies with a part it swims in and does not get out of, the
 * pieces standing: a pool it would be caught in. Of those, the ones the ground alone lets it out of are caught by a
 * piece. Parts neither a walk nor the search settled, and shallower water it did not walk out of, are counted apart and
 * fail nothing: a puddle in a walled room is no trap.
 */
export function swimming(w: Audited): Check {
  const all = bodiesSwum(w), water = w.map.water;
  const swum = all.filter((s) => s.swims), caught = swum.filter((s) => s.out === false);
  let byPieces = 0;
  const first: string[] = [];
  if (caught.length > 0 && water) {
    const g = waterGrid(w)!, of = squaresByBody(g, water.bodies.length), walk = wayOut({ ...w, water }, g);
    const bare = new StructureStore(w.map.dims, w.reg.halfX, w.reg.halfY, w.reg.halfZ, null, w.reg.parts);
    for (const s of caught) {
      const p = s.parts.find((q) => q.swims && q.out === false)!;
      // The same part with no piece standing: is it the ground's or a piece's?
      const alone = walk(s.body, of[s.body]!, bare).find((q) => q.squares[0] === p.squares[0]);
      const pieces = alone !== undefined && alone.out === true;
      if (pieces) byPieces++;
      if (first.length < 3) first.push(`body ${s.body} at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}: ${p.squares.length * water.cell ** 2} m2, ${p.depth.toFixed(2)} m deep, ${pieces ? "out with no piece standing" : "caught by the ground"}`);
    }
  }
  const parts = swum.flatMap((s) => s.parts.filter((p) => p.swims));
  return { check: "water to swim in with no way out", gate: true, count: caught.length, bodiesWithWater: all.length, swimmable: swum.length, swimmableWalkedOut: swum.filter((s) => s.out === true).length,
    caughtByPieces: byPieces, parts: parts.length, outBySearch: parts.filter((p) => p.by === "search").length, outIntoTheSea: parts.filter((p) => p.by === "sea").length, notSettled: swum.filter((s) => s.out === null).length,
    wading: all.length - swum.length, wadingNotWalkedOut: all.filter((s) => !s.swims && s.out === false).length, clearMetres: CLEAR, touchingPairs: touchingPairs(w), first };
}

/** Every check, the gates first. */
export function audit(w: Audited): Check[] {
  return [offMap(w), twins(w), lakeWraps(w), hullsInPieces(w), swimming(w), waterWalls(w), poolsInPits(w), sunkPools(w), streetsThroughBuildings(w), doorsOffGround(w), piecesUnderGround(w)];
}

if (import.meta.main) {
  const path = process.argv.slice(2).find((a) => a.endsWith(".snmap"));
  if (!path) throw new Error("A map .snmap argument is required");
  const file = readFileSync(path);
  const w = openMap(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
  console.log(JSON.stringify({ map: w.map.id, hash: w.map.hash, statics: w.map.statics.length, buildings: w.map.buildings?.count ?? 0 }));
  let failed = false;
  for (const run of [offMap, twins, lakeWraps, hullsInPieces, swimming, waterWalls, poolsInPits, sunkPools, streetsThroughBuildings, doorsOffGround, piecesUnderGround]) {
    const start = performance.now();
    const c = run(w);
    const ok = !c.gate || c.count === 0;
    failed ||= !ok;
    console.log(JSON.stringify({ ...c, ...(c.gate ? { ok } : {}), seconds: Number(((performance.now() - start) / 1000).toFixed(1)) }));
  }
  if (failed) process.exitCode = 1;
}
