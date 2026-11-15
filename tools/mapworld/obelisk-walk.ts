// A survivor walks from a spawn point to the front of each obelisk's terminal: bun tools/mapworld/obelisk-walk.ts <file.snmap>
//
// The way is found on the map's 2 m samples, from the terminal's front out to the nearest spawn point, around water deeper
// than a wade, ground too steep to climb and every static piece and node in the way, each grown by the body's radius and
// half a sample so that a straight step between two free samples touches none. The survivor's own capsule then walks it
// as the server steps a body, through the statics and the nodes of the chunks round it, and must stop on the ground at
// the terminal's front. The names are the build's (var/maps/<name>/stats.json) where it has them.

import { existsSync, readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_DT, chunkAt } from "../../shared/coords.ts";
import { Body, MODE_WALK, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField, nodeForms, type NodeSpot } from "../../shared/world/nodes.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { PROVING_ID, PROVING_OBELISK } from "../../shared/world/proving.ts";
import { StructureStore, type PartTable } from "../../shared/world/structures.ts";

/** Water a survivor wades rather than swims, in metres. */
const WADE = 0.5;

const path = process.argv[2];
if (!path) {
  console.error("bun tools/mapworld/obelisk-walk.ts <file.snmap>");
  process.exit(2);
}
const t0 = performance.now();
const map = parseMap(new Uint8Array(readFileSync(path)));
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg = compiled.registry;
const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg);
const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const { nx, nz, cell } = hf;

// What blocks the way. A piece reaches its store's spread out from its middle, and from the lowest to the highest of its
// boxes up and down; it is in the way of a sample where it stands over the ground there by more than a step and under a head.
const blocked = new Uint8Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (hf.sample(i, j) < hf.seaLevel - WADE) blocked[j * nx + i] = 1;
const pad = params.radius + cell / 2;
const span = (parts: PartTable, halfY: Float32Array): [Float32Array, Float32Array] => {
  const low = new Float32Array(halfY.length);
  const high = new Float32Array(halfY.length);
  for (let k = 0; k < halfY.length; k++) {
    [low[k], high[k]] = [-halfY[k]!, halfY[k]!];
    for (let p = parts.start[k]! * 6; p < parts.start[k + 1]! * 6; p += 6) {
      low[k] = Math.min(low[k]!, parts.box[p + 1]! - parts.box[p + 4]!);
      high[k] = Math.max(high[k]!, parts.box[p + 1]! + parts.box[p + 4]!);
    }
  }
  return [low, high];
};
const stamp = (x: number, y: number, z: number, out: number, low: number, high: number): void => {
  const r = out + pad;
  for (let j = Math.max(0, Math.ceil((z - r) / cell)); j <= Math.min(nz - 1, Math.floor((z + r) / cell)); j++) {
    for (let i = Math.max(0, Math.ceil((x - r) / cell)); i <= Math.min(nx - 1, Math.floor((x + r) / cell)); i++) {
      if ((i * cell - x) ** 2 + (j * cell - z) ** 2 > r * r) continue;
      const g = hf.sample(i, j);
      if (y + high > g + params.stepUp && y + low < g + params.height) blocked[j * nx + i] = 1;
    }
  }
};
const [pieceLow, pieceHigh] = span(reg.parts, reg.halfY);
for (const s of map.statics) {
  const k = reg.index.get(s.kind)!;
  stamp(s.x, s.y, s.z, structs.spread[k]!, pieceLow[k]!, pieceHigh[k]!);
}
let nodeCount = 0;
if (source) {
  const f = nodeForms(reg);
  const reach = new StructureStore(map.dims, f.halfX, f.halfY, f.halfZ, f.soft, f.parts).spread;
  const [nodeLow, nodeHigh] = span(f.parts, f.halfY);
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  for (let c = 0; c < map.dims.chunksX * map.dims.chunksZ; c++) {
    for (let s = 0; s < source.perChunk; s++) {
      source.at(c, s, spot);
      if (spot.kind === 0 || f.soft[spot.form] === 1) continue;
      stamp(spot.x, spot.y, spot.z, reach[spot.form]!, nodeLow[spot.form]!, nodeHigh[spot.form]!);
      nodeCount++;
    }
  }
}
// A step to a neighbour climbs no more than the steepest walkable slope allows, or a step up.
const tan = Math.sqrt(1 - params.slopeCos ** 2) / params.slopeCos;
const rise = [Math.max(params.stepUp, cell * tan) * 0.9, Math.max(params.stepUp, cell * Math.SQRT2 * tan) * 0.9];
console.log(`${map.id}: ${map.statics.length} static pieces and ${nodeCount} standing nodes in the way, ${(blocked.reduce((a, b) => a + b, 0) / blocked.length * 100).toFixed(1)}% of samples closed, in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Dijkstra out from the samples before a terminal to the first spawn point's sample.
const dist = new Float32Array(nx * nz);
const prev = new Int32Array(nx * nz);
let heapKey = new Float32Array(1 << 20);
let heapVal = new Int32Array(1 << 20);
let heapSize = 0;
const push = (key: number, val: number): void => {
  if (heapSize === heapKey.length) {
    const [k, v] = [new Float32Array(heapSize * 2), new Int32Array(heapSize * 2)];
    k.set(heapKey);
    v.set(heapVal);
    [heapKey, heapVal] = [k, v];
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKey[p]! <= key) break;
    heapKey[i] = heapKey[p]!;
    heapVal[i] = heapVal[p]!;
    i = p;
  }
  heapKey[i] = key;
  heapVal[i] = val;
};
const pop = (): number => {
  const top = heapVal[0]!;
  const key = heapKey[--heapSize]!;
  const val = heapVal[heapSize]!;
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && heapKey[c + 1]! < heapKey[c]!) c++;
    if (heapKey[c]! >= key) break;
    heapKey[i] = heapKey[c]!;
    heapVal[i] = heapVal[c]!;
    i = c;
  }
  heapKey[i] = key;
  heapVal[i] = val;
  return top;
};
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
/** Free samples from the spawn point's to one before the terminal, or null if no spawn point can be reached. */
const wayTo = (starts: readonly number[], spawns: ReadonlyMap<number, number>): { cells: number[]; spawn: number } | null => {
  dist.fill(Infinity);
  heapSize = 0;
  for (const s of starts) {
    dist[s] = 0;
    prev[s] = -1;
    push(0, s);
  }
  while (heapSize > 0) {
    const d0 = heapKey[0]!;
    const at = pop();
    if (d0 > dist[at]!) continue;
    const spawn = spawns.get(at);
    if (spawn !== undefined) {
      const cells: number[] = [];
      for (let c = at; c >= 0; c = prev[c]!) cells.push(c);
      return { cells, spawn };
    }
    const i = at % nx;
    const j = (at - i) / nx;
    const h = hf.sample(i, j);
    for (let s = 0; s < 8; s++) {
      const [di, dj] = STEPS[s]!;
      const [ni, nj] = [i + di, j + dj];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const to = nj * nx + ni;
      if (blocked[to]) continue;
      // No cutting a corner past a closed sample.
      if (di !== 0 && dj !== 0 && (blocked[j * nx + ni] || blocked[nj * nx + i])) continue;
      if (Math.abs(hf.sample(ni, nj) - h) > rise[di !== 0 && dj !== 0 ? 1 : 0]!) continue;
      const d = d0 + (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) * cell;
      if (d < dist[to]!) {
        dist[to] = d;
        prev[to] = at;
        push(d, to);
      }
    }
  }
  return null;
};
/** Whether every sample on the line between two samples is free. */
const clearLine = (a: number, b: number): boolean => {
  const [ai, aj, bi, bj] = [a % nx, Math.floor(a / nx), b % nx, Math.floor(b / nx)];
  const n = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
  for (let s = 0; s <= n; s++) {
    const i = Math.round(ai + ((bi - ai) * s) / Math.max(1, n));
    const j = Math.round(aj + ((bj - aj) * s) / Math.max(1, n));
    if (blocked[j * nx + i]) return false;
  }
  return true;
};

// The spawn points' samples: each the nearest free one to its point.
const nearestFree = (x: number, z: number, most: number): number => {
  let best = -1;
  let near = Infinity;
  for (let j = Math.max(0, Math.floor((z - most) / cell)); j <= Math.min(nz - 1, Math.ceil((z + most) / cell)); j++) {
    for (let i = Math.max(0, Math.floor((x - most) / cell)); i <= Math.min(nx - 1, Math.ceil((x + most) / cell)); i++) {
      const d = (i * cell - x) ** 2 + (j * cell - z) ** 2;
      if (d <= most * most && d < near && !blocked[j * nx + i]) [best, near] = [j * nx + i, d];
    }
  }
  return best;
};
const spawnAt = new Map<number, number>();
map.spawns.forEach((s, k) => {
  const at = nearestFree(s.x, s.z, 4);
  if (at >= 0) spawnAt.set(at, k);
  else console.log(`     spawn point ${s.name} has no free sample within 4 m`);
});

const stats = path.replace(/\.snmap$/, "/stats.json");
const named: { name: string; x: number; z: number }[] = map.id === PROVING_ID ? [PROVING_OBELISK] : existsSync(stats) ? ((JSON.parse(readFileSync(stats, "utf8")) as { obelisks?: { name: string; x: number; z: number }[] }).obelisks ?? []) : [];
const terminal = reg.index.get(TRAVEL_TERMINAL)!;
const terminals = map.statics.filter((s) => s.kind === TRAVEL_TERMINAL);
if (terminals.length === 0) console.log(`${map.id} has no obelisk`);
let failed = 0;
for (const [n, t] of terminals.entries()) {
  const name = named.find((o) => Math.hypot(o.x - t.x, o.z - t.z) < 12)?.name ?? `obelisk ${n + 1}`;
  const a = ((t.yaw & 0xffff) / 65536) * 2 * Math.PI;
  const [fx, fz] = [Math.sin(a), Math.cos(a)];
  // Where a survivor stands to use it: its body a hand's breadth from the terminal's face.
  const off = reg.halfZ[terminal]! + params.radius + 0.3;
  const front = { x: t.x + fx * off, z: t.z + fz * off };
  const facing = `${Math.round((((t.yaw & 0xffff) / 65536) * 360) % 360)} degrees`;
  // The way ends at the free samples before the terminal, within 4 m of its front.
  const starts: number[] = [];
  for (let j = Math.floor((front.z - 4) / cell); j <= Math.ceil((front.z + 4) / cell); j++) {
    for (let i = Math.floor((front.x - 4) / cell); i <= Math.ceil((front.x + 4) / cell); i++) {
      const [dx, dz] = [i * cell - front.x, j * cell - front.z];
      if (i >= 0 && j >= 0 && i < nx && j < nz && dx * dx + dz * dz <= 16 && dx * fx + dz * fz > -0.5 && !blocked[j * nx + i]) starts.push(j * nx + i);
    }
  }
  const way = starts.length > 0 ? wayTo(starts, spawnAt) : null;
  const head = `${name.padEnd(22)} terminal at ${t.x.toFixed(1)}, ${t.z.toFixed(1)} facing ${facing}`;
  if (!way) {
    failed++;
    console.log(`FAIL ${head}: ${starts.length === 0 ? "no free ground before it" : "no way on foot to any spawn point"}`);
    continue;
  }
  const spawn = map.spawns[way.spawn]!;
  const cells = way.cells;
  const length = cells.reduce((sum, c, i) => (i === 0 ? 0 : sum + Math.hypot((c % nx) - (cells[i - 1]! % nx), Math.floor(c / nx) - Math.floor(cells[i - 1]! / nx)) * cell), 0);

  // The walk: from the spawn point's sample along the way, steering at the farthest sample of the next few in clear line.
  const b = new Body();
  [b.x, b.z] = [(cells[0]! % nx) * cell, Math.floor(cells[0]! / nx) * cell];
  b.y = hf.heightAt(b.x, b.z) + 0.2;
  let held = chunkAt(map.dims, b.x, b.z);
  nodes?.retain(held, 1, 1, () => false);
  const step = (toX: number, toZ: number, move: number): void => {
    const yaw = Math.round((Math.atan2(toX - b.x, toZ - b.z) * 65536) / (2 * Math.PI)) & 0xffff;
    stepBody(world, b, 0, move, yaw, 0, 0, params, TICK_DT);
    const chunk = chunkAt(map.dims, b.x, b.z);
    if (chunk !== held) {
      nodes?.retain(chunk, 1, 1, () => false);
      nodes?.retain(held, 1, -1, () => false);
      held = chunk;
    }
  };
  for (let tick = 0; tick < 30; tick++) step(b.x, b.z + 1, 0);
  let k = 0;
  let ticks = 0;
  let why = "";
  let mark = [b.x, b.z, 0];
  const limit = Math.ceil((length / (params.walkSpeed * 0.5) + 30) / TICK_DT);
  const cx = (c: number): number => (c % nx) * cell;
  const cz = (c: number): number => Math.floor(c / nx) * cell;
  while (k < cells.length - 1 || Math.hypot(b.x - cx(cells[k]!), b.z - cz(cells[k]!)) > 1) {
    // Past the farthest of the next few samples it has come within reach of, since it steers past those between.
    for (let m = Math.min(cells.length - 1, k + 12); m >= k; m--) {
      if (Math.hypot(b.x - cx(cells[m]!), b.z - cz(cells[m]!)) < 1.5) {
        k = Math.min(cells.length - 1, m + 1);
        break;
      }
    }
    const here = Math.round(b.z / cell) * nx + Math.round(b.x / cell);
    let aim = k;
    for (let m = Math.min(cells.length - 1, k + 12); m > k; m--) {
      if (clearLine(here, cells[m]!)) {
        aim = m;
        break;
      }
    }
    step(cx(cells[aim]!), cz(cells[aim]!), 127);
    ticks++;
    if (ticks - mark[2]! >= 90) {
      if (Math.hypot(b.x - mark[0]!, b.z - mark[1]!) < 1) {
        why = `stuck at ${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)}, ${Math.round(Math.hypot(b.x - front.x, b.z - front.z))} m short`;
        break;
      }
      mark = [b.x, b.z, ticks];
    }
    if (ticks > limit) {
      why = `out of time at ${b.x.toFixed(1)}, ${b.z.toFixed(1)}`;
      break;
    }
  }
  // Then straight to the front, and stand.
  for (let tick = 0; !why && tick < 300 && Math.hypot(b.x - front.x, b.z - front.z) > 0.15; tick++, ticks++) step(front.x, front.z, 60);
  for (let tick = 0; tick < 30; tick++) step(t.x, t.z, 0);
  nodes?.retain(held, 1, -1, () => false);
  const miss = Math.hypot(b.x - front.x, b.z - front.z);
  const ground = hf.heightAt(b.x, b.z);
  if (!why && (miss > 0.5 || !b.grounded || b.mode !== MODE_WALK || Math.abs(b.y - ground) > 0.6)) why = `stopped ${miss.toFixed(1)} m from its front at y ${b.y.toFixed(1)} over ground at ${ground.toFixed(1)}`;
  if (why) failed++;
  console.log(`${why ? "FAIL" : "ok  "} ${head}: from ${spawn.name}, ${Math.round(length)} m of way, ${why || `walked in ${Math.round(ticks * TICK_DT)} s to ${miss.toFixed(2)} m of its front at y ${b.y.toFixed(1)}`}`);
}
console.log(`${terminals.length - failed} of ${terminals.length} reached in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed > 0 ? 1 : 0);
