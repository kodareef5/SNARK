import { RUIN_SHAPES, ruinKind, type RuinFinish, type RuinShape } from "../../content/miami-ruins.ts";
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
  const rings = f.building.rings.map((r) => r.map(([e, n]) => site.toEngine(e!, n!)));
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

export class Mason {
  readonly pieces: StaticPiece[] = [];
  readonly clear: { x: number; z: number; radius: number }[] = [];
  readonly routes: { x: number; y: number; z: number; yaw: number; floors: number }[] = [];
  readonly frame: Frame;
  readonly base: number;
  constructor(frame: Frame, base: number) { this.frame = frame; this.base = base; }
  put(shape: RuinShape, u: number, y: number, v: number, finish: RuinFinish = "concrete", turn = 0): void {
    const [x, z] = worldPoint(this.frame, u, v);
    this.pieces.push({ kind: ruinKind(shape, finish), x, y: this.base + y, z, yaw: ((this.frame.yaw + turn) % 360 + 360) % 360 });
  }
  cover(u: number, v: number, radius: number): void {
    const [x, z] = worldPoint(this.frame, u, v); this.clear.push({ x, z, radius });
  }
  floor(t: Point, y: number, bay: number): void { this.put(bay === 16 ? "floor16" : bay === 8 ? "floor8" : "floor4", t[0], y - .2, t[1]); }
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
    this.floor([t.u, t.v], 0, 8);
    for (let f = 0; f < floors; f++) {
      const dir = f % 2 === 0 ? 1 : -1;
      const u = t.u + (f % 2 === 0 ? -1.5 : 1.5);
      for (let n = 0; n < 10; n++) this.put("step", u, f * 4 + (n + 1) * .4 - .2, t.v + dir * (-2.25 + n * .5));
      this.put("landing", t.u, (f + 1) * 4 - .2, t.v + dir * 3.25);
    }
    const [x, z] = worldPoint(this.frame, t.u, t.v);
    this.routes.push({ x, y: this.base, z, yaw: this.frame.yaw, floors });
  }
}

export function pieceRadius(p: StaticPiece): number {
  const name = p.kind.split("_")[1] as RuinShape;
  const shape = RUIN_SHAPES[name];
  return shape ? Math.hypot(shape[0], shape[2]) / 2 : 0;
}
