// A built map's audit: scans of the whole map as the server holds it, one JSON line a check. A gate's count must be 0.
//   bun tools/mapworld/audit.ts <map.snmap>

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { isDock, isMoored } from "../../content/docks.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { Body, MODE_SWIM, stepBody } from "../../shared/sim/character.ts";
import { blankFrame } from "../../shared/world/buildings.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { HIT_PREFIX } from "../../shared/world/bends.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { bendOf, mapHeightfield, parseMap, placeStatics, staticKinds, type MapFile } from "../../shared/world/mapfile.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";

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

/** The bodies' numbers a square, row by row from z = 0, and the squares along x and z. */
function waterGrid(w: Audited): { body: Uint16Array; wx: number; wz: number } | null {
  const water = w.map.water, dims = w.map.dims;
  if (!water) return null;
  const side = water.side, [wx, wz] = [dims.chunksX * side, dims.chunksZ * side];
  const body = new Uint16Array(wx * wz);
  for (let c = 0; c < water.block.length; c++) {
    const from = water.block[c]!;
    if (from < 0) continue;
    const cx = c % dims.chunksX, cz = Math.floor(c / dims.chunksX);
    for (let j = 0; j < side; j++) body.set(water.squares.subarray(from + j * side, from + (j + 1) * side), (cz * side + j) * wx + cx * side);
  }
  return { body, wx, wz };
}

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
  /** Whether a survivor set down at its deepest corner swims. */
  readonly swims: boolean;
  /** Whether it then walks out onto dry ground; null for a body too big to be walked here. */
  readonly out: boolean | null;
  /** How many other bodies' squares touch its own or theirs: with them it is one water. */
  readonly touches: number;
}

/** The most wet squares of a body whose way out is walked: 10,000 m2 of 2 m squares, a resort.s pool or a pond. */
const WALKED_SQUARES = 2500;
/** Ways out tried of each kind, from the best; the ticks a walk to one place may take; the metres past the rim it aims. */
const WAYS_OUT = 12, OUT_TICKS = 1500, PAST_RIM = 5;
/** Corners a survivor is set down at to see whether it swims: the deepest, then others as deep. */
const STARTS = 8;

/**
 * Each body with water, as the game's own stepper finds it: a survivor set down at one of its deepest corners swims or not by
 * the content's swim depth, and from there walks out: over a stretch of rim two corners wide, toward the lowest corners
 * of its rim, or along the eight winds, until it stands on ground that is no body's water. Bodies that touch are one
 * water: it walks on through the next and over that one's rim.
 */
export function bodiesSwum(w: Audited): Swum[] {
  const g = waterGrid(w), water = w.map.water;
  if (!g || !water) return [];
  const { body, wx, wz } = g, cell = water.cell, n = water.bodies.length, { hf, structs, reg, sizeX, sizeZ } = w;
  const wet = new Uint32Array(n + 1), depth = new Float32Array(n + 1), deep = new Float64Array(2 * (n + 1));
  const rims: number[][] = [];
  // Bodies whose squares touch are one water: a survivor out of one into the next is out of neither.
  const group = Int32Array.from({ length: n + 1 }, (_, b) => b);
  const root = (b: number): number => { while (group[b] !== b) b = group[b] = group[group[b]!]!; return b; };
  for (let j = 0; j < wz; j++) for (let i = 0; i < wx; i++) {
    const b = body[j * wx + i]!;
    if (b === 0) continue;
    for (const o of [i + 1 < wx ? body[j * wx + i + 1]! : 0, j + 1 < wz ? body[(j + 1) * wx + i]! : 0]) if (o !== 0 && o !== b) group[root(o)] = root(b);
    const S = water.surface[b]!, corners = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, c]) => [a! * cell, c! * cell, hf.heightAt(a! * cell, c! * cell)] as const);
    if (!corners.some(([, , h]) => h < S)) continue;
    wet[b]!++;
    for (const [x, z, h] of corners) {
      if (S - h > depth[b]!) [depth[b], deep[b * 2], deep[b * 2 + 1]] = [S - h, x, z];
      // A corner out of the water is rim: kept for a body small enough to be walked.
      if (h >= S && wet[b]! <= WALKED_SQUARES) (rims[b] ??= []).push(h, x, z);
    }
  }
  const members = new Map<number, number[]>();
  for (let b = 1; b <= n; b++) {
    if (wet[b] === 0) continue;
    const at = root(b);
    members.set(at, [...(members.get(at) ?? []), b]);
  }
  const across = wx + 1;
  /** A body's corners, wet and dry, by their place on the corners' lattice. */
  const cornersOf = (b: number): { wetAt: Map<number, number>; dryAt: Map<number, number> } => {
    const S = water.surface[b]!, wetAt = new Map<number, number>(), dryAt = new Map<number, number>();
    const box = water.box.subarray(b * 4, b * 4 + 4);
    for (let j = Math.max(0, Math.floor(box[1]! / cell)); j < Math.min(wz, Math.ceil(box[3]! / cell)); j++) for (let i = Math.max(0, Math.floor(box[0]! / cell)); i < Math.min(wx, Math.ceil(box[2]! / cell)); i++) {
      if (body[j * wx + i] !== b) continue;
      const at = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([u, v]) => [v! * across + u!, hf.heightAt(u! * cell, v! * cell)] as const);
      if (at.some(([, h]) => h < S)) for (const [k, h] of at) (h < S ? wetAt : dryAt).set(k, h);
    }
    return { wetAt, dryAt };
  };
  /**
   * A body's ways out over its rim, each the places to walk to in turn: where the rim is two corners wide and level,
   * from the least step up to it, to a square inside the water before it and then straight out, as a ladder is climbed.
   */
  const made = new Map<number, [number, number][][]>();
  const overRim = (b: number, { wetAt, dryAt }: ReturnType<typeof cornersOf>): [number, number][][] => {
    let ways = made.get(b);
    if (ways) return ways;
    made.set(b, (ways = []));
    const pairs: { score: number; k: number; e: number; d: number }[] = [];
    for (const [k, h] of wetAt) for (const e of [1, -1, across, -across]) {
      const d = Math.abs(e) === 1 ? across : 1, [h2, r, r2] = [wetAt.get(k + d), dryAt.get(k + e), dryAt.get(k + d + e)];
      if (h2 !== undefined && r !== undefined && r2 !== undefined) pairs.push({ score: Math.max(r, r2) - Math.min(h, h2) + Math.abs(r - r2) + Math.abs(h - h2), k, e, d });
    }
    pairs.sort((p, q) => p.score - q.score || p.k - q.k || p.e - q.e);
    const taken: { k: number; e: number }[] = [];
    for (const { k, e, d } of pairs) {
      if (taken.length === WAYS_OUT) break;
      // One a stretch of rim: not within two corners of one taken on the same side.
      if (taken.some((o) => o.e === e && Math.abs((o.k % across) - (k % across)) <= 2 && Math.abs(Math.floor(o.k / across) - Math.floor(k / across)) <= 2)) continue;
      taken.push({ k, e });
      const [ex, ez] = [Math.abs(e) === 1 ? e : 0, Math.abs(e) === 1 ? 0 : Math.sign(e)];
      const [mx, mz] = [((k % across) + (d === 1 ? 0.5 : 0)) * cell, (Math.floor(k / across) + (d === 1 ? 0 : 0.5)) * cell];
      ways.push([[mx - ex * cell, mz - ez * cell], [mx + ex * (cell + PAST_RIM), mz + ez * (cell + PAST_RIM)]]);
    }
    return ways;
  };
  const world = { hf, structs }, params = reg.move[reg.index.get("core:survivor")!]!;
  const set = (b: Body, x: number, y: number, z: number): void => { Object.assign(b, new Body()); [b.x, b.y, b.z] = [x, y, z]; };
  /** Out of the water: on ground no body's squares hold and the sea does not cover. */
  const isOut = (b: Body): boolean => water.bodyAt(b.x, b.z) === 0 && !(hf.heightAt(b.x, b.z) < hf.seaLevel);
  const out: Swum[] = [], walker = new Body();
  for (let b = 1; b <= n; b++) {
    if (wet[b] === 0) continue;
    const S = water.surface[b]!, together = members.get(root(b))!, small = wet[b]! <= WALKED_SQUARES;
    const own = small ? cornersOf(b) : { wetAt: new Map<number, number>(), dryAt: new Map<number, number>() };
    // Set down at its deepest corner; where a piece stands or lies there, rubble in a pool, at the next of its deepest.
    const starts: [number, number][] = [[deep[b * 2]!, deep[b * 2 + 1]!]];
    for (const [k, h] of own.wetAt) if (starts.length < STARTS && S - h > depth[b]! - 0.1) starts.push([(k % across) * cell, Math.floor(k / across) * cell]);
    let [x0, z0] = starts[0]!, swims = false;
    for (const [x, z] of starts) {
      set(walker, x, S - params.height / 2, z);
      for (let t = 0; t < 60; t++) stepBody(world, walker, 0, 0, 0, 0, 0, params, TICK_DT);
      if (walker.mode !== MODE_SWIM) continue;
      [x0, z0, swims] = [x, z, true];
      break;
    }
    let left: boolean | null = null;
    if (small) {
      // Over its own rim first, then over the rim of each body it touches, through that body's water.
      const ways = [...overRim(b, own)];
      for (const o of together) if (o !== b && wet[o]! <= WALKED_SQUARES) ways.push(...overRim(o, cornersOf(o)));
      // Then its rim's corners from the lowest, one a place, and the eight winds, for water that stands over its shore.
      const r = rims[b] ?? [], order = Array.from({ length: r.length / 3 }, (_, k) => k).sort((p, q) => r[p * 3]! - r[q * 3]!);
      const tried = new Set<number>();
      for (const k of order) {
        const [x, z] = [r[k * 3 + 1]!, r[k * 3 + 2]!], far = Math.hypot(x - x0, z - z0) || 1;
        if (tried.size < WAYS_OUT && !tried.has(x * 65536 + z) && tried.add(x * 65536 + z)) ways.push([[x + ((x - x0) / far) * PAST_RIM, z + ((z - z0) / far) * PAST_RIM]]);
      }
      for (let wind = 0; wind < 8; wind++) ways.push([[x0 + Math.sin((wind * Math.PI) / 4) * 128, z0 + Math.cos((wind * Math.PI) / 4) * 128]]);
      left = false;
      for (const way of ways) {
        set(walker, x0, S - params.height / 2, z0);
        for (const [k, [px, pz]] of way.entries()) {
          // On the map; a place on the way is reached within a step, the last is walked at until out.
          const [tx, tz] = [Math.max(0, Math.min(sizeX, px)), Math.max(0, Math.min(sizeZ, pz))], close = k + 1 < way.length ? 0.4 : 0.2;
          for (let t = 0; t < OUT_TICKS && !left && Math.hypot(walker.x - tx, walker.z - tz) > close; t++) {
            const yaw = Math.round((Math.atan2(tx - walker.x, tz - walker.z) * 65536) / (2 * Math.PI)) & 65535;
            stepBody(world, walker, 0, 100, yaw, 0, 0, params, TICK_DT);
            // Dry ground within its squares may be a ledge under a rim it cannot climb; the next body's water is water.
            left = t > 10 && isOut(walker);
          }
        }
        if (left) break;
      }
    }
    out.push({ body: b, wet: wet[b]!, depth: depth[b]!, swims, out: left, touches: together.length - 1 });
  }
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

/**
 * Water a survivor swims in and gets out of. The gate counts bodies of up to 10,000 m2 it swims in, from whose deepest
 * corner no walk over the rim or along the eight winds reaches dry ground that is no body's: a pool it would be caught in. Shallower water
 * it did not walk out of is counted apart and fails nothing: a puddle in a walled room is no trap.
 */
export function swimming(w: Audited): Check {
  const all = bodiesSwum(w);
  const swum = all.filter((s) => s.swims), caught = swum.filter((s) => s.out === false);
  const name = (s: Swum): string => `body ${s.body}, ${s.wet * w.map.water!.cell ** 2} m2, ${s.depth.toFixed(2)} m deep`;
  return { check: "water to swim in with no way out", gate: true, count: caught.length, bodiesWithWater: all.length, swimmable: swum.length, swimmableWalkedOut: swum.filter((s) => s.out === true).length, wading: all.length - swum.length,
    wadingNotWalkedOut: all.filter((s) => !s.swims && s.out === false).length, tooBigToWalk: all.filter((s) => s.out === null).length, touchingPairs: touchingPairs(w), first: caught.slice(0, 3).map(name) };
}

/** Every check, the gates first. */
export function audit(w: Audited): Check[] {
  return [offMap(w), twins(w), lakeWraps(w), hullsInPieces(w), swimming(w), buildingsUnsupported(w), waterWalls(w), poolsInPits(w), streetsThroughBuildings(w), doorsOffGround(w), piecesUnderGround(w), piecesHanging(w)];
}

if (import.meta.main) {
  const path = process.argv.slice(2).find((a) => a.endsWith(".snmap"));
  if (!path) throw new Error("A map .snmap argument is required");
  const file = readFileSync(path);
  const w = openMap(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
  console.log(JSON.stringify({ map: w.map.id, hash: w.map.hash, statics: w.map.statics.length, buildings: w.map.buildings?.count ?? 0 }));
  let failed = false;
  for (const run of [offMap, twins, lakeWraps, hullsInPieces, swimming, buildingsUnsupported, waterWalls, poolsInPits, streetsThroughBuildings, doorsOffGround, piecesUnderGround, piecesHanging]) {
    const start = performance.now();
    const c = run(w);
    const ok = !c.gate || c.count === 0;
    failed ||= !ok;
    console.log(JSON.stringify({ ...c, ...(c.gate ? { ok } : {}), seconds: Number(((performance.now() - start) / 1000).toFixed(1)) }));
  }
  if (failed) process.exitCode = 1;
}

/** A building as the support checks see it: its pieces that stand from the ground, those overhead and those of them that hang. */
export interface Stood { id: number; kind: string; x: number; z: number; width: number; depth: number; pieces: number; supports: number; overhead: number; hanging: number }

/**
 * Every building's standing. The ground under a piece is the land or the water's surface, whichever is higher. A
 * support is a building's piece that stands from within 1.2 m of that ground to 2.4 m over it or higher: a wall, a
 * pier, a stair. A piece is overhead where its foot is 2 m or more over the ground and no higher than 4.6 m over its
 * building's base: the beams, slabs and roofs straight over the ground storey. An overhead piece hangs where no
 * support, any building's, is within 6 m of its box on the plan.
 */
export function standing(w: Audited): Stood[] {
  const HELD_WITHIN = 6;
  const { map, reg, hf, kindOf, sizeX, sizeZ } = w, s = map.statics, b = map.buildings, parts = reg.parts!;
  const stood = new Map<number, Stood>();
  if (!b) return [];
  const low = new Float32Array(s.kinds.length), high = new Float32Array(s.kinds.length);
  s.kinds.forEach((_, i) => {
    const k = kindOf[i]!;
    let [lo, hi] = [Infinity, -Infinity];
    for (let p = parts.start[k]!; p < parts.start[k + 1]!; p++) { lo = Math.min(lo, parts.box[p * 6 + 1]! - parts.box[p * 6 + 4]!); hi = Math.max(hi, parts.box[p * 6 + 1]! + parts.box[p * 6 + 4]!); }
    [low[i], high[i]] = [lo === Infinity ? -reg.halfY[k]! : lo, hi === -Infinity ? reg.halfY[k]! : hi];
  });
  const fr = blankFrame();
  const supports = new Map<number, number[]>(), over: { row: number; of: Stood }[] = [];
  for (const h of b.handles()) {
    b.frame(h, fr);
    const id = b.id(h);
    const rec = stood.get(id) ?? stood.set(id, { id, kind: b.kind(h), x: fr.x, z: fr.z, width: fr.width, depth: fr.depth, pieces: 0, supports: 0, overhead: 0, hanging: 0 }).get(id)!;
    b.eachRun(h, (chunk, slot, count) => {
      const a = s.first[chunk]! + slot;
      for (let r = a; r < a + count; r++) {
        rec.pieces++;
        const ki = s.kind[r]!, [px, pz] = [Math.min(sizeX - 0.01, Math.max(0, s.x[r]!)), Math.min(sizeZ - 0.01, Math.max(0, s.z[r]!))];
        // A wharf's building stands from the water's surface, not from the bed under it.
        const g = Math.max(hf.heightAt(px, pz), hf.waterAt(px, pz));
        const [foot, top] = [s.y[r]! + low[ki]!, s.y[r]! + high[ki]!];
        if (foot <= g + 1.2 && top >= g + 2.4) {
          const c = Math.floor(s.z[r]! / 8) * 65536 + Math.floor(s.x[r]! / 8);
          (supports.get(c) ?? supports.set(c, []).get(c)!).push(s.x[r]!, s.z[r]!);
          rec.supports++;
        } else if (foot >= g + 2 && foot <= fr.base + 4.6) { over.push({ row: r, of: rec }); rec.overhead++; }
      }
    });
  }
  for (const o of over) {
    const r = o.row, k = kindOf[s.kind[r]!]!, [x, z] = [s.x[r]!, s.z[r]!], [hx, hz] = [reg.halfX[k]!, reg.halfZ[k]!];
    frameOf(s.yaw[r]!, 0);
    const [c0, s0] = [frame.cos, frame.sin], far = Math.hypot(hx, hz) + HELD_WITHIN;
    let held = false;
    for (let cz = Math.floor((z - far) / 8); cz <= Math.floor((z + far) / 8) && !held; cz++) for (let cx = Math.floor((x - far) / 8); cx <= Math.floor((x + far) / 8) && !held; cx++) {
      const at = supports.get(cz * 65536 + cx);
      for (let q = 0; at && q < at.length && !held; q += 2) {
        const dx = at[q]! - x, dz = at[q + 1]! - z;
        held = Math.hypot(Math.max(Math.abs(dx * c0 - dz * s0) - hx, 0), Math.max(Math.abs(dx * s0 + dz * c0) - hz, 0)) <= HELD_WITHIN;
      }
    }
    if (!held) o.of.hanging++;
  }
  return [...stood.values()];
}

/** Buildings with four or more pieces overhead and no piece of their own that stands from the ground. */
export function buildingsUnsupported(w: Audited): Check {
  const stood = standing(w), bare = stood.filter((v) => v.supports === 0 && v.overhead >= 4);
  return { check: "buildings with no support of their own", gate: true, count: bare.length, buildings: stood.length, first: bare.slice(0, 3).map((v) => `${v.kind} ${v.id} at ${v.x.toFixed(0)}, ${v.z.toFixed(0)}, ${v.width.toFixed(0)} by ${v.depth.toFixed(0)} m, ${v.overhead} pieces overhead`) };
}

/** Overhead pieces with no support within 6 m: a ruined city has some, by its fallen bays and hanging slabs. */
export function piecesHanging(w: Audited): Check {
  const stood = standing(w), count = stood.reduce((n, v) => n + v.hanging, 0), overhead = stood.reduce((n, v) => n + v.overhead, 0);
  const four = stood.filter((v) => v.hanging >= 4);
  return { check: "overhead pieces with no support within 6 m", gate: false, count, overhead, perThousand: overhead ? Number(((count / overhead) * 1000).toFixed(2)) : 0, buildingsWith4: four.length, buildingsAllHanging: four.filter((v) => v.hanging === v.overhead).length };
}
