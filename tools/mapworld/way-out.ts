// Water a survivor swims in and its way out, walked by the game's stepper with the pieces standing: the walk the map's
// audit gates on (audit.ts).

import type { Registry } from "../../shared/content/registry.ts";
import { TICK_DT, type MapDims } from "../../shared/coords.ts";
import { Body, MODE_SWIM, stepBody } from "../../shared/sim/character.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import type { MapWater } from "../../shared/world/water.ts";

/** Metres past a body's own squares a survivor stands before it is out: a ledge between the water and a wall is not out. */
export const CLEAR = 12;
/** The most wet squares of a part that is searched: 10,000 m2 of 2 m squares. A larger one is only walked straight. */
const SEARCHED_SQUARES = 2500;
/** Places a search reaches before it gives up, and the metres it goes on past a body's box where it met other water. */
const NODES = 60000, WIDER = 130;

/** What a survivor walks in: the ground with its water, the pieces standing, and the content's survivor. */
export interface Walked {
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  readonly water: MapWater;
  readonly reg: Registry;
  readonly sizeX: number;
  readonly sizeZ: number;
  /** Told the box a search goes on into past a body's own, before it does: a caller that sets pieces down as needed. */
  readonly wider?: (x0: number, z0: number, x1: number, z1: number) => void;
}

/** The bodies' numbers a square, row by row from z = 0, and the squares along x and z. */
export interface Squares {
  readonly body: Uint16Array;
  readonly wx: number;
  readonly wz: number;
}

/** A map's water as squares over the whole map. */
export function squaresOf(water: MapWater, dims: MapDims): Squares {
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

/** Each body's squares, by its number. */
export function squaresByBody(g: Squares, bodies: number): number[][] {
  const of: number[][] = Array.from({ length: bodies + 1 }, () => []);
  for (let k = 0; k < g.body.length; k++) if (g.body[k] !== 0) of[g.body[k]!]!.push(k);
  return of;
}

/** A part of a body: wet squares that touch by a side or a corner. */
export interface Part {
  /** Its wet squares, their middle, and the most water over a corner of one. */
  readonly squares: readonly number[];
  readonly x: number;
  readonly z: number;
  readonly depth: number;
  /** Whether a survivor set down in it swims. */
  readonly swims: boolean;
  /**
   * Whether it then gets out: by a straight walk, by the search, or into the sea. Null where neither settled it: a part
   * too big to search that no straight walk left, or a search that ran past its places.
   */
  readonly out: boolean | null;
  readonly by: "walk" | "search" | "sea" | "";
}

/** A body's corners that stand out of its water, the rim, as metres over its surface: each once. */
export function rimOver(w: Walked, g: Squares, b: number, own: readonly number[]): number[] {
  const cell = w.water.cell, S = w.water.surface[b]!, { wx } = g, dry = new Map<number, number>();
  for (const k of own) {
    const i = k % wx, j = (k - i) / wx;
    const at = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, c]) => [c! * (wx + 1) + a!, w.hf.heightAt(a! * cell, c! * cell)] as const);
    if (at.some(([, h]) => h < S)) for (const [c, h] of at) if (h >= S) dry.set(c, h - S);
  }
  return [...dry.values()].sort((p, q) => p - q);
}

type Near = (x: number, z: number) => boolean;

/**
 * The walk out of each part of a body of the squares `g`, as `(b, own, structs)` with the body's squares `own`. A survivor is set down at up
 * to three places of a part (the middle of its square furthest from its edge, its deepest, its own middle), each only
 * where it swims, and the part is left where one of them gets out: standing, not swimming, on ground no water covers, in
 * no body's square, CLEAR metres past the body's own squares. First straight walks at its rim's corners and the sixteen
 * winds, then a search over a 1 m lattice of the stepper's own moves, each carried on from the state it arrived in. It
 * never jumps. A part no survivor swims in is walked straight from its deepest place and not searched.
 * `structs` stands in for the world's pieces where given: an empty store asks whether the ground alone lets it out.
 */
export function wayOut(w: Walked, g: Squares): (b: number, own: readonly number[], structs?: StructureStore) => Part[] {
  const { hf, water, reg, sizeX, sizeZ } = w, cell = water.cell;
  const params = reg.move[reg.index.get("core:survivor")!]!;
  const fresh = new Body(), walker = new Body();
  const set = (b: Body, x: number, y: number, z: number): void => { b.copy(fresh); [b.x, b.y, b.z] = [x, y, z]; };
  const yawTo = (b: Body, tx: number, tz: number): number => Math.round((Math.atan2(tx - b.x, tz - b.z) * 65536) / (2 * Math.PI)) & 65535;
  const isOut = (b: Body, near: Near): boolean => b.grounded && b.mode !== MODE_SWIM && water.bodyAt(b.x, b.z) === 0 && !(hf.heightAt(b.x, b.z) < hf.waterAt(b.x, b.z)) && !near(b.x, b.z);
  /** In the sea's water, in no body's square and clear of its own body: no pool, and no dry ground either. */
  const inSea = (b: Body, near: Near): boolean => water.bodyAt(b.x, b.z) === 0 && hf.heightAt(b.x, b.z) < hf.waterAt(b.x, b.z) && !near(b.x, b.z);
  let world = { hf, structs: w.structs }, seaSeen = false;

  /** Walks straight at a place until out, there, stuck or out of ticks. */
  const walkTo = (b: Body, tx: number, tz: number, ticks: number, near: Near): boolean => {
    let [lx, lz] = [b.x, b.z];
    for (let t = 0; t < ticks; t++) {
      if (Math.hypot(tx - b.x, tz - b.z) < 0.2) return false;
      stepBody(world, b, 0, 127, yawTo(b, tx, tz), 0, 0, params, TICK_DT);
      if (t > 10 && isOut(b, near)) return true;
      if (t % 30 === 29 && !seaSeen && inSea(b, near)) seaSeen = true;
      if (t % 120 === 119) {
        if (Math.hypot(b.x - lx, b.z - lz) < 0.15) return false;
        [lx, lz] = [b.x, b.z];
      }
    }
    return false;
  };

  /**
   * From each place reached, eight walks of a metre, the farthest from the start first. True for out, false for every
   * place reached and none out, null where it ran past NODES places or went on past the box.
   */
  const search = (from: Body, near: Near, x0: number, z0: number, x1: number, z1: number): boolean | null => {
    const seen = new Set<number>(), key = (b: Body): number => Math.round(b.z) * 65536 + Math.round(b.x);
    const heap: { d: number; b: Body }[] = [];
    const push = (b: Body): void => {
      const node = { d: Math.hypot(b.x - from.x, b.z - from.z), b };
      let i = heap.push(node) - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.d >= node.d) break; heap[i] = heap[p]!; i = p; }
      heap[i] = node;
    };
    const pop = (): Body => {
      const top = heap[0]!, last = heap.pop()!;
      if (heap.length > 0) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1]!.d > heap[c]!.d) c++; if (heap[c]!.d <= last.d) break; heap[i] = heap[c]!; i = c; }
        heap[i] = last;
      }
      return top.b;
    };
    const first = new Body();
    first.copy(from);
    seen.add(key(first));
    push(first);
    let pruned = false;
    while (heap.length > 0) {
      const at = pop(), k0 = key(at);
      for (const [dx, dz] of [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]] as const) {
        walker.copy(at);
        const [tx, tz] = [Math.round(at.x) + dx, Math.round(at.z) + dz];
        for (let t = 0; t < 50 && Math.hypot(tx - walker.x, tz - walker.z) > 0.2; t++) {
          stepBody(world, walker, 0, 127, yawTo(walker, tx, tz), 0, 0, params, TICK_DT);
          if (isOut(walker, near)) return true;
        }
        // In the air it comes down first.
        for (let t = 0; t < 90 && !walker.grounded && walker.mode !== MODE_SWIM; t++) { stepBody(world, walker, 0, 0, walker.yaw, 0, 0, params, TICK_DT); if (isOut(walker, near)) return true; }
        const k = key(walker);
        if (!seaSeen && inSea(walker, near)) seaSeen = true;
        if (k === k0 || seen.has(k) || !(walker.grounded || walker.mode === MODE_SWIM)) continue;
        // Past the box and not out, it is in other water: the search is not settled there.
        if (walker.x < x0 || walker.z < z0 || walker.x > x1 || walker.z > z1) { pruned = true; continue; }
        seen.add(k);
        if (seen.size > NODES) return null;
        const kept = new Body();
        kept.copy(walker);
        push(kept);
      }
    }
    return pruned ? null : false;
  };

  return (b, own, structs) => {
    world = { hf, structs: structs ?? w.structs };
    const { body: grid, wx, wz } = g, S = water.surface[b]!;
    const H = (i: number, j: number): number => hf.heightAt(i * cell, j * cell);
    const wetAt = new Set<number>();
    for (const k of own) { const i = k % wx, j = (k - i) / wx; if (Math.min(H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)) < S) wetAt.add(k); }
    if (wetAt.size === 0) return [];
    const partOf = new Map<number, number>(), parts: number[][] = [];
    for (const k of wetAt) {
      if (partOf.has(k)) continue;
      const list = [k];
      partOf.set(k, parts.length);
      for (let q = 0; q < list.length; q++) {
        const i = list[q]! % wx, j = (list[q]! - i) / wx;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const o = (j + dj) * wx + i + di;
          if (i + di < 0 || i + di >= wx || !wetAt.has(o) || partOf.has(o)) continue;
          partOf.set(o, parts.length);
          list.push(o);
        }
      }
      parts.push(list);
    }
    // The squares within CLEAR of the body's, as a mask over its box grown by as much.
    let [a0, c0, a1, c1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const k of own) { const i = k % wx, j = (k - i) / wx; a0 = Math.min(a0, i); a1 = Math.max(a1, i); c0 = Math.min(c0, j); c1 = Math.max(c1, j); }
    let near: Near | null = null;
    const nearOf = (): Near => {
      const m = Math.ceil(CLEAR / cell) + 1, [i0, j0] = [a0 - m, c0 - m], [mw, mh] = [a1 - a0 + 1 + 2 * m, c1 - c0 + 1 + 2 * m];
      const mask = new Uint8Array(mw * mh), offs: number[] = [];
      for (let dj = -m; dj <= m; dj++) for (let di = -m; di <= m; di++) if (Math.hypot(Math.max(Math.abs(di) - 1, 0), Math.max(Math.abs(dj) - 1, 0)) * cell < CLEAR) offs.push(di, dj);
      for (const k of own) {
        const i = k % wx, j = (k - i) / wx;
        const edge = i === 0 || j === 0 || i === wx - 1 || j === wz - 1 || grid[k - 1] !== b || grid[k + 1] !== b || grid[k - wx] !== b || grid[k + wx] !== b;
        if (!edge) { mask[(j - j0) * mw + i - i0] = 1; continue; }
        for (let q = 0; q < offs.length; q += 2) mask[(j + offs[q + 1]! - j0) * mw + i + offs[q]! - i0] = 1;
      }
      return (x, z) => {
        const i = Math.floor(x / cell) - i0, j = Math.floor(z / cell) - j0;
        return i >= 0 && j >= 0 && i < mw && j < mh && mask[j * mw + i] === 1;
      };
    };
    const [bx0, bz0, bx1, bz1] = [a0 * cell, c0 * cell, (a1 + 1) * cell, (c1 + 1) * cell], reach = CLEAR + 8;
    const box = [Math.max(0, bx0 - reach), Math.max(0, bz0 - reach), Math.min(sizeX, bx1 + reach), Math.min(sizeZ, bz1 + reach)] as const;
    const across = wx + 1, place = (k: number): [number, number] => [(k % across) * cell, Math.floor(k / across) * cell];
    const mid = (k: number): [number, number] => [((k % wx) + 0.5) * cell, (Math.floor(k / wx) + 0.5) * cell];
    const found: Part[] = [];
    for (const list of parts) {
      // Its corners: the wet from the deepest, the dry its rim from the lowest.
      const corner = new Map<number, number>();
      let [cx, cz] = [0, 0];
      for (const k of list) {
        const i = k % wx, j = (k - i) / wx;
        cx += (i + 0.5) * cell; cz += (j + 0.5) * cell;
        for (const [a, c] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]] as const) corner.set(c * across + a, H(a, c));
      }
      [cx, cz] = [cx / list.length, cz / list.length];
      const wet = [...corner].filter(([, h]) => h < S).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      const rim = [...corner].filter(([, h]) => h >= S).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      const depth = S - wet[0]![1], big = list.length > SEARCHED_SQUARES;
      // Where it is set down: the middle of its square furthest from its edge, the first of its deepest places that
      // swims (corners, then middles, where a piece lies on the corners), and the square nearest its own middle.
      const inPart = new Set(list), layer = new Map<number, number>();
      let ring = list.filter((k) => [k - 1, k + 1, k - wx, k + wx].some((o) => !inPart.has(o)));
      for (let d = 0; ring.length > 0; d++) {
        for (const k of ring) layer.set(k, d);
        ring = [...new Set(ring.flatMap((k) => [k - 1, k + 1, k - wx, k + wx]))].filter((o) => inPart.has(o) && !layer.has(o));
      }
      const inner = [...list].sort((p, q) => layer.get(q)! - layer.get(p)! || hf.heightAt(...mid(p)) - hf.heightAt(...mid(q)) || p - q)[0]!;
      const central = [...list].sort((p, q) => Math.hypot(mid(p)[0] - cx, mid(p)[1] - cz) - Math.hypot(mid(q)[0] - cx, mid(q)[1] - cz) || p - q)[0]!;
      const deepest: [number, number][] = [...wet.slice(0, 6).map(([k]) => place(k)), ...list.map(mid).sort((p, q) => hf.heightAt(p[0], p[1]) - hf.heightAt(q[0], q[1])).slice(0, 4)];
      const swumAt: { x: number; z: number; body: Body }[] = [];
      const settle = (x: number, z: number): void => {
        set(walker, x, S - params.height / 2, z);
        for (let t = 0; t < 60; t++) stepBody(world, walker, 0, 0, 0, 0, 0, params, TICK_DT);
      };
      const tryStart = (x: number, z: number): boolean => {
        if (swumAt.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) return false;
        settle(x, z);
        if (walker.mode !== MODE_SWIM) return false;
        const body = new Body();
        body.copy(walker);
        swumAt.push({ x, z, body });
        return true;
      };
      tryStart(...mid(inner));
      for (const [x, z] of deepest) if (tryStart(x, z)) break;
      tryStart(...mid(central));
      near ??= nearOf();
      const waysFrom = (x0: number, z0: number): [number, number][] => {
        // The rim's corners from the lowest and spread round it (for a big part the nearest), then sixteen winds.
        const picks = new Set<number>();
        const lowest = big ? [...rim].sort((p, q) => Math.hypot(place(p[0])[0] - x0, place(p[0])[1] - z0) - Math.hypot(place(q[0])[0] - x0, place(q[0])[1] - z0)).slice(0, 16) : rim.slice(0, 32);
        for (const [k] of lowest) picks.add(k);
        if (!big) for (let q = 0; q < 32; q++) if (rim.length > 0) picks.add(rim[Math.floor((q * rim.length) / 32)]![0]);
        const ways: [number, number][] = [];
        for (const k of picks) { const [x, z] = place(k), far = Math.hypot(x - x0, z - z0) || 1; ways.push([x + ((x - x0) / far) * (CLEAR + 5), z + ((z - z0) / far) * (CLEAR + 5)]); }
        const span = Math.hypot(bx1 - bx0, bz1 - bz0) + CLEAR + 5;
        for (let wind = 0; wind < 16; wind++) ways.push([x0 + Math.sin((wind * Math.PI) / 8) * span, z0 + Math.cos((wind * Math.PI) / 8) * span]);
        return ways;
      };
      const walks = (x0: number, z0: number): boolean => {
        for (const [px, pz] of waysFrom(x0, z0)) {
          const [tx, tz] = [Math.max(0.5, Math.min(sizeX - 0.5, px)), Math.max(0.5, Math.min(sizeZ - 0.5, pz))];
          settle(x0, z0);
          if (walkTo(walker, tx, tz, Math.max(900, Math.ceil(Math.hypot(tx - x0, tz - z0) * 20)), near!)) return true;
        }
        return false;
      };
      const part = { squares: list, x: cx, z: cz, depth };
      if (swumAt.length === 0) {
        // Waded: walked straight from its deepest place, and not searched.
        const [x0, z0] = deepest[0]!;
        seaSeen = false;
        const left = walks(x0, z0);
        found.push({ ...part, swims: false, out: left || seaSeen, by: left ? "walk" : seaSeen ? "sea" : "" });
        continue;
      }
      let out: boolean | null = false, by: Part["by"] = "";
      for (const { x, z, body } of swumAt) {
        seaSeen = false;
        let searched: "walk" | boolean | null = walks(x, z) ? "walk" : big ? null : search(body, near, ...box);
        if (searched === null && !big) {
          const far = [Math.max(0, box[0] - WIDER), Math.max(0, box[1] - WIDER), Math.min(sizeX, box[2] + WIDER), Math.min(sizeZ, box[3] + WIDER)] as const;
          w.wider?.(...far);
          searched = search(body, near, ...far);
        }
        if (searched || seaSeen) { [out, by] = [true, searched === "walk" ? "walk" : searched ? "search" : "sea"]; break; }
        if (searched === null) out = null;
      }
      found.push({ ...part, swims: true, out, by });
    }
    return found;
  };
}
