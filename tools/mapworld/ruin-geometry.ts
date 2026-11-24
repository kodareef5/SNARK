import { finished, pieceMiddle, RUIN_SHAPES, ruinKind, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { STOREY, STOREY_SLACK } from "../../shared/world/buildings.ts";
import { carry, know } from "./known.ts";
import type { Footprint, Site, StaticPiece } from "./statics.ts";

export type Point = readonly [number, number];
export interface Tile { u: number; v: number; i: number; j: number; }
export interface Frame {
  x: number; z: number; yaw: number; c: number; s: number; rings: Point[][];
  width: number; depth: number;
}
export function inRing(u: number, v: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!; const b = ring[j]!;
    if ((a[1] > v) !== (b[1] > v) && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export const inside = (f: Frame, u: number, v: number): boolean => inRing(u, v, f.rings[0]!) && !f.rings.slice(1).some((r) => inRing(u, v, r));

export function frameOf(f: Footprint, site: Site): Frame {
  const rings = f.building.rings.map((r) => r.map(([e, n]) => site.toLattice(e!, n!)));
  const ring = rings[0]!;
  let yaw = 0; let longest = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i]![0] - ring[i - 1]![0]; const dz = ring[i]![1] - ring[i - 1]![1];
    if (dx * dx + dz * dz > longest) { longest = dx * dx + dz * dz; yaw = Math.atan2(-dz, dx); }
  }
  // Canonical half-turn keeps neighbouring rectangles' fronts consistent.
  yaw = ((yaw % Math.PI) + Math.PI) % Math.PI;
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const raw = rings.map((r) => r.map(([x, z]) => [x * c - z * s, x * s + z * c] as Point));
  const us = raw[0]!.map((p) => p[0]); const vs = raw[0]!.map((p) => p[1]);
  const loU = Math.min(...us); const hiU = Math.max(...us); const loV = Math.min(...vs); const hiV = Math.max(...vs);
  const u = (loU + hiU) / 2; const v = (loV + hiV) / 2;
  return { x: u * c + v * s, z: -u * s + v * c, yaw: yaw * 180 / Math.PI, c, s,
    width: hiU - loU, depth: hiV - loV, rings: raw.map((r) => r.map(([x, z]) => [x - u, z - v])) };
}
export const worldPoint = (f: Frame, u: number, v: number): Point => [f.x + u * f.c + v * f.s, f.z - u * f.s + v * f.c];

export function tilesOf(f: Frame, bay: number): Tile[] {
  const out: Tile[] = [];
  const cols = Math.floor(f.width / bay); const rows = Math.floor(f.depth / bay);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = (i - (cols - 1) / 2) * bay; const v = (j - (rows - 1) / 2) * bay;
    const h = bay / 2 - .02;
    // Sample edges as well as corners, and reject even small courtyards wholly enclosed by a tile.
    if (![-h, 0, h].every((x) => [-h, 0, h].every((z) => inside(f, u + x, v + z)))) continue;
    if (f.rings.slice(1).some((r) => r.some(([x, z]) => Math.abs(x - u) < h && Math.abs(z - v) < h))) continue;
    out.push({ u, v, i, j });
  }
  return out;
}
export const tileKey = (i: number, j: number): string => `${i},${j}`;
export const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
interface Entry { x: number; y: number; z: number; yaw: number; coreX: number; coreZ: number; crossing?: boolean; }

export class Mason {
  readonly assemblies: StaticPiece[][] = [];
  readonly pieces: StaticPiece[] = [];
  readonly clear: { x: number; z: number; radius: number }[] = [];
  readonly routes: { x: number; y: number; z: number; yaw: number; floors: number }[] = [];
  readonly entries: Entry[] = [];
  readonly alternatives: { entry: Entry; support: Point; path: { x: number; y: number; z: number }[] }[] = [];
  readonly escapes: { bidirectional?: boolean; points: { x: number; y: number; z: number }[] }[] = [];
  readonly rooms: { kind: string; points: { x: number; y: number; z: number }[] }[] = [];
  readonly falls: { mode: string; u: number; v: number }[] = [];
  readonly wings: { tiles: number; height: number; u: number; v: number }[] = [];
  /** Orbs the layout asks for (shared/world/orb.ts): the axis, the heading in degrees as a piece's, the radius and the centre's height over the base. */
  readonly orbs: { x: number; z: number; yaw: number; radius: number; centre: number }[] = [];
  readonly frame: Frame;
  readonly base: number;
  /** The grid its storeys were stacked on: metres a bay (0 where nothing was stacked) and tiles across and deep. */
  bay = 0; cols = 0; rows = 0;
  /** The most storeys a stack of it has, and the most of them walked; whether a stair reaches a roof. */
  floors = 0; walked = 0; roof = false;
  /** Its stairs' tiles: a core's, or the escape's beside one. */
  readonly stairsAt: { i: number; j: number; floors: number; escape: boolean }[] = [];
  /** The tile and storey of what is put next, as the layout has them in hand: -1 for none, and for a storey told by the piece's foot. */
  private ti = -1; private tj = -1; private ts = -1;
  /** The kind of a car of a family (street.cars.looks) standing at x, z; set by the pass that sets cars down. */
  pick?: (x: number, z: number, family: string) => string;
  constructor(frame: Frame, base: number) { this.frame = frame; this.base = base; }
  point(u: number, v: number): Point { return worldPoint(this.frame, u, v); }
  /** The grid a stack is laid on. */
  grid(bay: number): void { this.bay = bay; this.cols = Math.floor(this.frame.width / bay); this.rows = Math.floor(this.frame.depth / bay); }
  /** What is put from now on is tile `t`'s, or no tile's, at `storey` or at the storey its foot is in. */
  at(t: { i: number; j: number } | null, storey = -1): void { this.ti = t ? t.i : -1; this.tj = t ? t.j : -1; this.ts = storey; }
  /** What is put from now on is at `storey`, or with -1 at the storey its foot is in. */
  level(storey: number): void { this.ts = storey; }
  private keep(piece: StaticPiece, foot: number): void {
    this.pieces.push(piece);
    // A slab's foot is under a storey's floor, so it is the lid of the storey below.
    know(piece, this.ti, this.tj, this.ts >= 0 ? this.ts : Math.min(254, Math.max(0, Math.floor((foot + STOREY_SLACK) / STOREY))));
  }
  put(shape: RuinShape, u: number, y: number, v: number, finish: RuinFinish = "concrete", turn = 0): void {
    const [x, z] = worldPoint(this.frame, u, v);
    // A shape the kit has in no such finish (a floor plate is concrete) is concrete.
    this.keep({ kind: ruinKind(shape, finished(shape, finish) ? finish : "concrete"), x, y: this.base + y, z, yaw: ((this.frame.yaw + turn) % 360 + 360) % 360 }, pieceMiddle(shape, y) - RUIN_SHAPES[shape][1] / 2);
  }
  /** An orb on the base with its axis at (u, v): it lays no piece of the kit, and the build gives it its shell. */
  orb(u: number, v: number, radius: number, centre: number, turn = 0): void {
    const [x, z] = worldPoint(this.frame, u, v);
    this.orbs.push({ x, z, yaw: ((this.frame.yaw + turn) % 360 + 360) % 360, radius, centre });
  }
  /** A car standing on y, nose along v turned by `turn`, so 90 puts it along +u; its kind is `pick`'s for the family there. */
  car(family: string, u: number, y: number, v: number, turn = 0): void {
    if (!this.pick) throw new Error(`a car of "${family}" where no pass picks cars`);
    const [x, z] = worldPoint(this.frame, u, v);
    this.keep({ kind: this.pick(x, z, family), x, y: this.base + y, z, yaw: ((this.frame.yaw + turn) % 360 + 360) % 360 }, y);
  }
  /** An assembly's part: a box of the kit in a finish, or a car of the family its finish names. */
  part(shape: RuinShape | "car", u: number, y: number, v: number, finish: string, turn = 0): void {
    if (shape === "car") this.car(finish, u, y, v, turn); else this.put(shape, u, y, v, finish as RuinFinish, turn);
  }
  cover(u: number, v: number, radius: number): void {
    const [x, z] = worldPoint(this.frame, u, v); this.clear.push({ x, z, radius });
  }
  floor(t: Point, y: number, bay: number, finish: RuinFinish = "concrete"): void { this.put(bay === 16 ? "floor16" : bay === 8 ? "floor8" : "floor4", t[0], y - .2, t[1], finish); }
  post(u: number, bottom: number, v: number, height: number): void {
    for (let y = 0; y < height - .01;) {
      const h = height - y >= 16 ? 16 : height - y >= 8 ? 8 : 4;
      this.put(h === 16 ? "pier16" : h === 8 ? "pier8" : "pier4", u, bottom + y + h / 2, v);
      y += h;
    }
  }
  stairs(t: Tile, floors: number): void {
    // Banyan prop roots reach beyond their planting cell into the stair approach.
    this.cover(t.u, t.v, 20);
    this.at(t);
    this.stairsAt.push({ i: t.i, j: t.j, floors, escape: false });
    this.floor([t.u, t.v], 0, 8);
    for (let f = 0; f < floors; f++) {
      const dir = f % 2 === 0 ? 1 : -1;
      const u = t.u + (f % 2 === 0 ? -1.5 : 1.5);
      this.put("flight", u, f * 4 + 2, t.v - dir * .5, "concrete", dir > 0 ? 0 : 180);
      this.put("landing", t.u, (f + 1) * 4 - .2, t.v + dir * 3);
    }
    const [x, z] = worldPoint(this.frame, t.u, t.v);
    this.routes.push({ x, y: this.base, z, yaw: this.frame.yaw, floors });
  }
  stairExit(t: Tile, floors: number, core: Tile): void {
    this.stairs(t, floors);
    this.stairsAt[this.stairsAt.length - 1]!.escape = true;
    const dir = floors % 2 === 0 ? -1 : 1; const lane = floors % 2 === 0 ? -1.5 : 1.5;
    const points = [[core.u + lane, floors * 4, core.v + dir * 5.5], [t.u + lane, floors * 4, t.v + dir * 5.5], [t.u + lane, floors * 4, t.v + dir * 3.25]];
    for (let f = floors - 1; f >= 0; f--) {
      const d = f % 2 === 0 ? 1 : -1; const u = t.u + (f % 2 === 0 ? -1.5 : 1.5);
      points.push([u, (f + 1) * 4, t.v + d * 3.25], [u, f * 4, t.v - d * (f ? 3.25 : 3.5)]);
    }
    this.escapes.push({ bidirectional: true, points: points.map(([u, y, v]) => { const [x, z] = this.point(u!, v!); return { x, y: this.base + y!, z }; }) });
  }
}

export function pieceRadius(p: StaticPiece): number {
  const name = p.kind.split("_")[1] as RuinShape;
  const shape = RUIN_SHAPES[name];
  return shape ? Math.hypot(shape[0], shape[2]) / 2 : 0;
}

export function compactWalls(m: Mason): void {
  const candidates = new Map<string, number>(); const removed = new Set<number>();
  const output = m.pieces;
  for (let i = 0; i < output.length; i++) {
    const p = output[i]!;
    const shape = p.kind.split("_")[1]; if (shape !== "zpanel8" && shape !== "zshaft8") continue;
    const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    const u = p.x * c - p.z * s; const v = p.x * s + p.z * c;
    const key = (at: number): string => `${p.kind},${p.y.toFixed(3)},${p.yaw.toFixed(3)},${at.toFixed(3)},${v.toFixed(3)}`;
    const previous = candidates.get(key(u - 8)) ?? candidates.get(key(u + 8));
    if (previous !== undefined && !removed.has(previous)) {
      const q = output[previous]!;
      output[i] = carry({ ...p, kind: p.kind.replace(shape, shape === "zpanel8" ? "zpanel16" : "zshaft16"), x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, p);
      removed.add(previous);
    } else candidates.set(key(u), i);
  }
  if (removed.size) { const kept = output.filter((_, i) => !removed.has(i)); output.length = 0; for (const p of kept) output.push(p); }
}

export function reserveRoutes(m: Mason): number {
  const paths = [...m.rooms.filter((r) => r.kind !== "rubble"), ...m.escapes].map((r) => r.points);
  const entryPaths = m.entries.filter((e) => e.crossing).map((e) => [{ x: e.x, y: e.y, z: e.z }, { x: e.coreX, y: e.y, z: e.coreZ }]);
  for (const r of m.routes) {
    const a = r.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    const point = (u: number, y: number, v: number): { x: number; y: number; z: number } => ({ x: r.x + u * c + v * s, y: r.y + y, z: r.z - u * s + v * c });
    for (let f = 0; f < r.floors; f++) {
      const dir = f % 2 === 0 ? 1 : -1; const u = f % 2 === 0 ? -1.5 : 1.5;
      paths.push([point(u, f * 4, -dir * 3.25), point(u, (f + 1) * 4, dir * 2.25), point(u, (f + 1) * 4, dir * 3.25), point(-u, (f + 1) * 4, dir * 3.25)]);
    }
    const dir = r.floors % 2 === 0 ? -1 : 1;
    paths.push([point(dir * 1.5, r.floors * 4, dir * 3.25), point(dir * 1.5, r.floors * 4, dir * 5.5)]);
  }
  const removable = new Set(["fin4", "fin8", "fin16", "crown", "zcore", "zroof8", "zroof16", "zpitch4", "zpitch8", "zpitch16", "zbalcony", "sill8", "sill4", "zshrub", "zrooftree"]);
  const before = m.pieces.length;
  const kept = m.pieces.filter((p) => {
    const name = p.kind.split("_")[1] as RuinShape;
    if (["flight", "step", "landing", "floor4", "floor8", "floor16"].includes(name)) return true;
    if (!removable.has(name) && !entryPaths.length) return true;
    const [w, h, d] = RUIN_SHAPES[name]; const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    const mid = pieceMiddle(name, p.y);
    for (const points of [...(removable.has(name) ? paths : []), ...entryPaths]) for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!; const to = points[i]!; const length = Math.hypot(to.x - from.x, to.z - from.z);
      if (Math.min(from.y, to.y) + .4 >= mid + h / 2 || Math.max(from.y, to.y) + 2.2 <= mid - h / 2) continue;
      if (Math.min(from.x, to.x) - w - d > p.x || Math.max(from.x, to.x) + w + d < p.x || Math.min(from.z, to.z) - w - d > p.z || Math.max(from.z, to.z) + w + d < p.z) continue;
      for (let n = 0; n <= Math.ceil(length * 2); n++) {
        const t = n / Math.max(1, Math.ceil(length * 2)); const y = from.y + (to.y - from.y) * t;
        if (mid + h / 2 <= y + .4 || mid - h / 2 >= y + 2.2) continue;
        const dx = from.x + (to.x - from.x) * t - p.x; const dz = from.z + (to.z - from.z) * t - p.z;
        if (Math.abs(dx * c - dz * s) < w / 2 + .5 && Math.abs(dx * s + dz * c) < d / 2 + .5) return false;
      }
    }
    return true;
  });
  const present = new Set(kept);
  for (const group of m.assemblies) if (group.some((p) => !present.has(p))) for (const p of group) present.delete(p);
  m.pieces.length = 0; for (const p of kept) if (present.has(p)) m.pieces.push(p); return before - m.pieces.length;
}
