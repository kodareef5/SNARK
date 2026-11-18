import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Grid } from "./base.ts";
import { inRing, type Point } from "./ruin-geometry.ts";

export interface Way {
  id: number; kind: "road_bridge" | "rail_bridge" | "pier" | "breakwater" | "bridge_outline";
  name: string | null; class: string | null; lanes: number | null; layer: number | null;
  width_m: number | null; closed: boolean; length_m: number; points: Point[];
  /** OpenStreetMap's bridge:structure, where it is mapped. */
  structure?: string | null;
}
export interface Path { way: Way; points: Point[]; width: number; outline: boolean; }
export const readWays = (source: string): Way[] => {
  const file = join(source, "blocks/ways.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Way[] : [];
};
export function widthOf(w: Way): number {
  if (w.width_m && w.width_m > 0) return Math.max(4, Math.min(24, Math.ceil(w.width_m / 4) * 4));
  if (w.kind === "rail_bridge" || w.kind === "pier" || w.kind === "breakwater" || /footway|cycleway|pedestrian|path/.test(w.class ?? "")) return 4;
  return Math.max(8, Math.min(24, Math.ceil(((w.lanes ?? (/motorway|trunk/.test(w.class ?? "") ? 3 : 2)) * 3.3 + 1) / 4) * 4));
}
export function pathsOf(ways: Way[], grid: Grid): { paths: Path[]; outlines: { id: number; status: string }[] } {
  const paths: Path[] = []; const outlines: { id: number; status: string }[] = [];
  const lines = ways.filter((w) => !w.closed);
  for (const way of [...ways].sort((a, b) => a.id - b.id)) {
    let points = way.points; let width = widthOf(way);
    if (way.closed && way.kind !== "rail_bridge") {
      if (way.kind === "bridge_outline" && lines.some((l) => l.points.some(([e, n]) => inRing(e, n, way.points)))) {
        outlines.push({ id: way.id, status: "envelope of mapped centreline; no duplicate deck" }); continue;
      }
      // Closed piers and unmatched outlines use the long axis of their minimum-edge frame.
      let dx = 1; let dz = 0; let longest = 0;
      for (let i = 1; i < points.length; i++) { const x = points[i]![0] - points[i - 1]![0]; const z = points[i]![1] - points[i - 1]![1]; const d = Math.hypot(x, z); if (d > longest) { longest = d; dx = x / d; dz = z / d; } }
      const us = points.map(([x, z]) => x * dx + z * dz); const vs = points.map(([x, z]) => -x * dz + z * dx);
      const u0 = Math.min(...us); const u1 = Math.max(...us); const v = (Math.min(...vs) + Math.max(...vs)) / 2;
      width = Math.max(4, Math.min(24, Math.floor((Math.max(...vs) - Math.min(...vs)) / 4) * 4));
      points = [[u0 * dx - v * dz, u0 * dz + v * dx], [u1 * dx - v * dz, u1 * dz + v * dx]];
      outlines.push({ id: way.id, status: "long-axis deck within polygon envelope" });
    }
    const engine = points.map(([e, n]) => [grid.east + grid.x0 - e, n - (grid.south - grid.z0)] as Point);
    const low = [grid.x0, grid.z0]; const high = [grid.x1, grid.z1];
    // Clip each segment to the map with an inset for the box extents.
    let run: Point[] = [];
    for (let i = 1; i < engine.length; i++) {
      const a = engine[i - 1]!; const b = engine[i]!; const d = [b[0] - a[0], b[1] - a[1]];
      let lo = 0; let hi = 1; const edge = Math.max(10, width);
      for (let axis = 0; axis < 2; axis++) {
        if (Math.abs(d[axis]!) < 1e-8) { if (a[axis]! < low[axis]! + edge || a[axis]! > high[axis]! - edge) hi = -1; }
        else { const t0 = (low[axis]! + edge - a[axis]!) / d[axis]!; const t1 = (high[axis]! - edge - a[axis]!) / d[axis]!; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
      }
      if (hi <= lo) { if (run.length > 1) paths.push({ way, points: run, width, outline: way.closed }); run = []; continue; }
      const start: Point = [a[0] + d[0]! * lo, a[1] + d[1]! * lo]; const end: Point = [a[0] + d[0]! * hi, a[1] + d[1]! * hi];
      if (run.length && Math.hypot(run.at(-1)![0] - start[0], run.at(-1)![1] - start[1]) > .01) { paths.push({ way, points: run, width, outline: way.closed }); run = []; }
      if (!run.length) run.push(start); run.push(end);
    }
    if (run.length > 1) paths.push({ way, points: run, width, outline: way.closed });
  }
  return { paths, outlines };
}

export function cutBridgeWater(paths: Path[], height: Float32Array, water: Uint8Array, grid: Grid): number {
  const { nx, x0, z0, x1, z1 } = grid; let cut = 0;
  const shore = water.slice();
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  for (const p of paths) {
    if (!/bridge/.test(p.way.kind)) continue;
    for (let k = 1; k < p.points.length; k++) {
      const a = p.points[k - 1]!; const b = p.points[k]!; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len; const dz = (b[1] - a[1]) / len; const radius = p.width / 2 + 4;
      for (let s = 0; s <= len; s += 2) {
        const x = a[0] + dx * s; const z = a[1] + dz * s;
        const reach = (side: number): number => {
          for (let distance = radius + 4; distance <= 80; distance += 4) {
            const px = x - dz * distance * side; const pz = z + dx * distance * side;
            if (px < x0 || pz < z0 || px > x1 || pz > z1) break;
            if (shore[at(px, pz)]) return distance;
          }
          return 0;
        };
        const left = reach(-1); const right = reach(1); const across = left > 0 && right > 0;
        for (let offset = across ? -left : -radius; offset <= (across ? right : radius); offset += 2) {
          const i = at(x - dz * offset, z + dx * offset);
          if (i < 0 || i >= height.length || (!water[i] && !across)) continue;
          if (height[i]! > -3) { height[i] = -3; cut++; }
          water[i] = 1;
        }
      }
    }
  }
  return cut;
}
