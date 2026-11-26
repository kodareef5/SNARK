// What a street through a building leaves standing. The clearance (ruin-clearance.ts) opens the ground storey along a
// passage (passages.ts); this settles what was over it, a building at a time, from the building's own pieces and the
// passage's line alone:
// - A pier stands each side of the opening, a metre outside the street's width, wherever the building's own floor or
//   roof is over that place: the generator's own post, to the underside of what it carries.
// - Where piers or walls stand on both sides and the opening is no wider than PORTAL_SPAN, the storeys above stay and
//   the street runs under them: a portal.
// - Elsewhere what is over the opening is taken away at every storey, a floor slab cut to its 4 m tiles at the edge.
// - What the opening left with no wall or pier within REACH is taken away with it.
// - A building left with no wall or pier of its own loses every piece, and its record its doors, ways and rooms.
// A stair in the opening goes with its route, and a room whose floor went is no room.

import { pieceMiddle, RUIN_SHAPES, ruinKind, type RuinShape } from "../../content/ruins.ts";
import { carry, know } from "./known.ts";
import type { Passage } from "./passages.ts";
import type { RuinRecord } from "./ruins.ts";
import type { StaticPiece } from "./statics.ts";

/** What the clearance leaves over a way: a piece whose foot is this far over it or more. */
export const CLEAR = 2.05;
/** How far past a street's width the clearance takes pieces. */
export const BESIDE = 0.46;
/** A pier's middle past the cleared edge, so the clearance never takes it. */
const PIER_OUT = 0.55;
/** Metres between the places along a passage where its sides are looked at; piers stand at every second, and at a run's ends. */
const STATION = 4;
/** The widest opening, wall to wall, a portal carries storeys over. */
export const PORTAL_SPAN = 12;
/** A piece stands from within SUPPORT_FOOT of its building's base to SUPPORT_TOP over it or higher (audit.ts `standing`). */
const SUPPORT_FOOT = 1.2, SUPPORT_TOP = 2.4;
/** How near a wall or a pier on the plan a piece overhead must be, and how near a wall the opening took it was. */
const REACH = 5, LOST_REACH = 6;
/** The tallest post: the kit's piers stacked. */
const TALLEST = 16;

export interface OpeningTally { buildings: number; piers: number; portals: number; cut: number; unheld: number; emptied: number; stairs: number; rooms: number }

interface Boxed { p: StaticPiece; shape: RuinShape; w: number; h: number; d: number; c: number; s: number; foot: number; top: number }
interface Item { i: number; b: Boxed; part: boolean; dead: boolean }
interface Run { xs: number[]; zs: number[]; at: number[]; half: number; lx: number; lz: number; hx: number; hz: number; onStreet: Passage["onStreet"] }

const STAIRS = new Set(["flight", "step", "landing"]);

function boxed(p: StaticPiece): Boxed | null {
  const shape = p.kind.split("_")[1] as RuinShape, dims = RUIN_SHAPES[shape];
  if (!dims) return null;
  const a = (p.yaw * Math.PI) / 180, mid = pieceMiddle(shape, p.y);
  return { p, shape, w: dims[0], h: dims[1], d: dims[2], c: Math.cos(a), s: Math.sin(a), foot: mid - dims[1] / 2, top: mid + dims[1] / 2 };
}

/** Metres on the plan from (x, z) to a piece's box, 0 within it. */
function planGap(b: Boxed, x: number, z: number): number {
  const dx = x - b.p.x, dz = z - b.p.z;
  return Math.hypot(Math.max(Math.abs(dx * b.c - dz * b.s) - b.w / 2, 0), Math.max(Math.abs(dx * b.s + dz * b.c) - b.d / 2, 0));
}

function runOf(p: Passage): Run {
  const xs = p.points.map((q) => q.x), zs = p.points.map((q) => q.z), at = [0];
  for (let i = 1; i < xs.length; i++) at.push(at[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!));
  return { xs, zs, at, half: p.width / 2, lx: Math.min(...xs), lz: Math.min(...zs), hx: Math.max(...xs), hz: Math.max(...zs), onStreet: p.onStreet };
}

/** The place on a run nearest (x, z): metres from its line and metres along it. */
function onRun(run: Run, x: number, z: number): { d: number; s: number } {
  let d = Infinity, s = 0;
  for (let i = 1; i < run.xs.length; i++) {
    const ax = run.xs[i - 1]!, az = run.zs[i - 1]!, ex = run.xs[i]! - ax, ez = run.zs[i]! - az, l2 = ex * ex + ez * ez;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)), far = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (far < d) [d, s] = [far, run.at[i - 1]! + Math.sqrt(l2) * t];
  }
  return { d, s };
}

/** The point `s` metres along a run and its way there, a unit vector. */
function along(run: Run, s: number): { x: number; z: number; tx: number; tz: number } {
  let i = 1;
  while (i < run.at.length - 1 && run.at[i]! < s) i++;
  const l = run.at[i]! - run.at[i - 1]! || 1, t = (s - run.at[i - 1]!) / l;
  const [ex, ez] = [run.xs[i]! - run.xs[i - 1]!, run.zs[i]! - run.zs[i - 1]!];
  return { x: run.xs[i - 1]! + ex * t, z: run.zs[i - 1]! + ez * t, tx: ex / l, tz: ez / l };
}

/** A floor slab of 8 or 16 m as its 4 m tiles. */
function tilesOf(b: Boxed): StaticPiece[] {
  const n = b.w / 4, out: StaticPiece[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i - (n - 1) / 2) * 4, v = (j - (n - 1) / 2) * 4;
    out.push(carry({ ...b.p, kind: b.p.kind.replace(b.shape, "floor4"), x: b.p.x + u * b.c + v * b.s, z: b.p.z - u * b.s + v * b.c }, b.p));
  }
  return out;
}

/**
 * Settles every building a passage opened. `removed` and `byPassage` say which of `pieces` the clearance took and which
 * of those a passage took; `free` is whether a new piece stands clear of every way. More of `removed` is set, a slab
 * cut at an opening's edge is put in `replacements`, and each building's piers are given back by its place in `records`.
 */
export function settleOpenings(pieces: readonly StaticPiece[], records: RuinRecord[], removed: Uint8Array, byPassage: Uint8Array, replacements: Map<number, StaticPiece[]>, passages: readonly Passage[], free: (p: StaticPiece) => boolean, count: (kind: string) => void): { piers: Map<number, StaticPiece[]>; tally: OpeningTally } {
  const piers = new Map<number, StaticPiece[]>();
  const tally: OpeningTally = { buildings: 0, piers: 0, portals: 0, cut: 0, unheld: 0, emptied: 0, stairs: 0, rooms: 0 };
  if (passages.length === 0) return { piers, tally };
  const runs = passages.map(runOf);
  records.forEach((r, k) => {
    const [from, to] = [r.firstPiece, r.firstPiece + r.blocks];
    let touched = false;
    for (let i = from; i < to && !touched; i++) touched = byPassage[i] === 1;
    if (!touched) return;
    tally.buildings++;
    const base = r.y, reach = Math.hypot(r.width, r.depth) / 2 + 16;
    const near = runs.filter((run) => run.lx <= r.x + reach && run.hx >= r.x - reach && run.lz <= r.z + reach && run.hz >= r.z - reach);
    const stands = (b: Boxed): boolean => b.foot <= base + SUPPORT_FOOT && b.top >= base + SUPPORT_TOP;
    const overhead = (b: Boxed): boolean => b.foot >= base + CLEAR - 0.01;
    const items: Item[] = [], lost: Boxed[] = [], stairsLost: Boxed[] = [], floorsLost: Boxed[] = [];
    for (let i = from; i < to; i++) {
      const b = boxed(pieces[i]!);
      if (!b) continue;
      if (!removed[i]) items.push({ i, b, part: false, dead: false });
      else if (byPassage[i]) {
        if (stands(b)) lost.push(b);
        if (STAIRS.has(b.shape)) stairsLost.push(b);
      }
    }
    const kill = (it: Item): void => {
      if (it.dead) return;
      it.dead = true;
      if (it.b.shape.startsWith("floor") || it.b.shape === "landing") floorsLost.push(it.b);
    };
    // A stair the street took goes whole, with its route.
    const routes = r.routes.length;
    const dropStairs = (): void => {
      r.routes = r.routes.filter((route) => {
        const a = (route.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const inTile = (p: StaticPiece): boolean => Math.abs((p.x - route.x) * c - (p.z - route.z) * s) <= 4.2 && Math.abs((p.x - route.x) * s + (p.z - route.z) * c) <= 4.2;
        if (!stairsLost.some((b) => inTile(b.p)) && !items.some((it) => it.dead && STAIRS.has(it.b.shape) && inTile(it.b.p))) return true;
        for (const it of items) if (STAIRS.has(it.b.shape) && inTile(it.b.p)) kill(it);
        return false;
      });
    };
    dropStairs();
    for (const b of stairsLost) if (b.shape === "landing") floorsLost.push(b);
    const walls = items.filter((it) => !it.dead && stands(it.b));

    // The piers, and where along each run the opening has walls or piers on both sides.
    const made: StaticPiece[] = [], portal: boolean[][] = [];
    const inOpening = (x: number, z: number, more: number): boolean => near.some((run) => onRun(run, x, z).d < run.half + BESIDE + more);
    for (const run of near) {
      const length = run.at[run.at.length - 1]!, n = Math.max(1, Math.round(length / STATION));
      const sides = [-1, 1].map((side) => {
        const roofed: number[] = [], walled: boolean[] = [], at: { x: number; z: number }[] = [];
        for (let j = 0; j < n; j++) {
          const c = along(run, ((j + 0.5) * length) / n), out = run.half + BESIDE + PIER_OUT;
          const [x, z] = [c.x - c.tz * side * out, c.z + c.tx * side * out];
          at.push({ x, z });
          // The lowest of its own pieces over that place, which a pier there would carry.
          let lid = Infinity;
          for (const it of items) if (overhead(it.b) && it.b.foot < lid && planGap(it.b, x, z) === 0) lid = it.b.foot;
          roofed.push(lid - base <= TALLEST + 0.6 ? lid : Infinity);
          walled.push(walls.some((it) => Math.hypot(it.b.p.x - x, it.b.p.z - z) <= 2));
        }
        const placed = roofed.map((lid, j) => {
          if (lid === Infinity || walled[j] || !(j % 2 === 0 || roofed[j - 1] === undefined || roofed[j - 1] === Infinity || roofed[j + 1] === undefined || roofed[j + 1] === Infinity)) return false;
          // No pier in another opening, nor on any street's carriageway.
          if (inOpening(at[j]!.x, at[j]!.z, 0.36) || run.onStreet?.(at[j]!.x, at[j]!.z, 0.4)) return false;
          const height = Math.max(4, Math.ceil((lid - base - 0.3) / 4) * 4), post: StaticPiece[] = [];
          for (let y = 0; y < height;) {
            const h = height - y >= 16 ? 16 : height - y >= 8 ? 8 : 4;
            post.push({ kind: ruinKind(`pier${h}` as RuinShape), x: at[j]!.x, y: base + y + h / 2, z: at[j]!.z, yaw: r.yaw });
            y += h;
          }
          if (!post.every(free)) return false;
          for (const p of post) { know(p, -1, -1, 0); made.push(p); }
          return true;
        });
        return roofed.map((_, j) => walled[j]! || placed[j]! || walled[j - 1] === true || walled[j + 1] === true || placed[j - 1] === true || placed[j + 1] === true);
      });
      const spans = 2 * (run.half + BESIDE) <= PORTAL_SPAN;
      portal.push(sides[0]!.map((held, j) => spans && held && sides[1]![j]!));
    }
    /** Whether (x, z) is over an opening that nothing carries the building across. */
    const open = (x: number, z: number): boolean => near.some((run, q) => {
      const { d, s } = onRun(run, x, z);
      if (d > run.half + BESIDE) return false;
      const n = portal[q]!.length;
      return !portal[q]![Math.min(n - 1, Math.max(0, Math.floor((s / run.at[run.at.length - 1]!) * n)))];
    });
    tally.portals += portal.reduce((sum, list) => sum + list.filter(Boolean).length, 0);

    // What is over an opening nothing carries: a slab by its tiles, any other piece by its middle and its ends.
    const splits = new Map<number, Item[]>();
    for (const it of [...items]) {
      const b = it.b;
      if (!overhead(b)) continue;
      if (b.shape === "floor8" || b.shape === "floor16") {
        const tiles = tilesOf(b), over = tiles.map((t) => open(t.x, t.z));
        if (!over.includes(true)) continue;
        kill(it);
        if (over.includes(false)) {
          const parts = tiles.filter((_, q) => !over[q]).map((t) => ({ i: it.i, b: boxed(t)!, part: true, dead: false }));
          splits.set(it.i, parts);
          items.push(...parts);
        }
        tally.cut++;
        continue;
      }
      const ends = b.w >= b.d ? [[b.c, -b.s, b.w / 2 - 1]] : [[b.s, b.c, b.d / 2 - 1]];
      const [ux, uz, far] = ends[0] as [number, number, number];
      if (open(b.p.x, b.p.z) || (far > 0 && (open(b.p.x + ux * far, b.p.z + uz * far) || open(b.p.x - ux * far, b.p.z - uz * far)))) { kill(it); tally.cut++; }
    }

    dropStairs();
    tally.stairs += routes - r.routes.length;
    // What the opening left with no wall or pier of the building's own in reach.
    const held = [...walls.filter((it) => !it.dead).map((it) => it.b.p), ...made];
    if (lost.length > 0) for (const it of items) {
      if (it.dead || !overhead(it.b) || !lost.some((l) => planGap(it.b, l.p.x, l.p.z) <= LOST_REACH)) continue;
      if (!held.some((h) => planGap(it.b, h.x, h.z) <= REACH)) { kill(it); tally.unheld++; }
    }

    // A building whose walls the opening took, with no wall or pier of its own left, is no building.
    if (held.length === 0 && lost.length > 0) {
      for (let i = from; i < to; i++) {
        if (!removed[i]) { removed[i] = 1; count(pieces[i]!.kind); }
        replacements.delete(i);
      }
      Object.assign(r, { approaches: [], entries: [], rooms: [], escapes: [], routes: [], wings: [], falls: [], height: 0 });
      tally.emptied++;
      return;
    }

    // A room or a way out whose floor went is none.
    const floored = (p: { x: number; y: number; z: number }): boolean => {
      if (p.y <= base + 1) return true;
      const under = (b: Boxed): boolean => Math.abs(b.top - p.y) <= 0.35 && planGap(b, p.x, p.z) <= 0.2;
      return !floorsLost.some(under) || items.some((it) => !it.dead && (it.b.shape.startsWith("floor") || it.b.shape === "landing") && under(it.b));
    };
    const rooms = r.rooms.filter((room) => room.points.every(floored));
    tally.rooms += r.rooms.length - rooms.length;
    r.rooms = rooms;
    r.escapes = r.escapes.filter((e) => e.points.every(floored));

    for (const it of items) if (it.dead && !it.part && !removed[it.i]) { removed[it.i] = 1; count(pieces[it.i]!.kind); }
    for (const [i, parts] of splits) replacements.set(i, parts.filter((it) => !it.dead).map((it) => it.b.p));
    if (made.length > 0) { piers.set(k, made); tally.piers += made.length; }
  });
  return { piers, tally };
}
