// Where survivors arrive and where wild creatures live. Spawn points are named in the world file near a place, and each
// is set on the nearest dry, level, open ground of the kind it asks for. Regions are found from the ground: dodos and
// parasaurs on each stretch of beach, and the jungle's herds and hunters in the hammocks, the gardens and the ruins.

import { S, type Ground, type World } from "./ground.ts";

export interface Spawn {
  readonly name: string;
  /** Engine metres: x grows west from the south-east corner, z north. */
  readonly x: number;
  readonly z: number;
  /** Degrees from north, turning toward +x. */
  readonly yaw: number;
}

export interface Region {
  readonly spawns: string;
  readonly count: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

const SAND = new Set<number>([S.BEACH, S.DUNE]);
const OPEN = new Set<number>([S.OPEN, S.GREEN, S.COURT, S.STREET, S.YARD, S.DUNE, S.BEACH, S.CANOPY]);
const BLOCKING = new Set<number>([S.HEAP, S.WALL, S.POOL, S.FORD, S.DECK, S.MARSH, S.MANGROVE]);

export function placeSpawns(ground: Ground, world: World, toSample: (lon: number, lat: number) => [number, number], size: number): Spawn[] {
  const { n, height, surface } = ground;
  const fits = (col: number, row: number, kinds: ReadonlySet<number>): boolean => {
    const i = row * n + col;
    if (!kinds.has(surface[i]!) || height[i]! < 0.4) return false;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= n || c >= n) return false;
        const j = r * n + c;
        if (Math.abs(height[j]! - height[i]!) > 0.5 || BLOCKING.has(surface[j]!) || height[j]! < 0.1) return false;
      }
    }
    return true;
  };
  return world.spawns.map((s) => {
    const [c0, r0] = toSample(s.at[0], s.at[1]).map(Math.round) as [number, number];
    const kinds = s.ground === "sand" ? SAND : OPEN;
    for (let ring = 0; ring < 150; ring++) {
      let best: [number, number] | null = null;
      let near = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 3 || r < 3 || c >= n - 3 || r >= n - 3 || !fits(c, r, kinds)) continue;
          const d = dr * dr + dc * dc;
          if (d < near) {
            near = d;
            best = [c, r];
          }
        }
      }
      if (!best) continue;
      const [c, r] = best;
      const [fc, fr] = toSample(s.face[0], s.face[1]);
      // Toward the place it faces: east is -x on the map, so the turn is from north toward the west.
      const dx = -(fc - c);
      const dz = -(fr - r);
      const yaw = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
      return { name: s.name, x: size - c * 2, z: size - r * 2, yaw: Math.round(yaw) };
    }
    throw new Error(`no ground fit for the spawn point "${s.name}" within 300 m of where it is named`);
  });
}

export function placeRegions(ground: Ground, size: number): Region[] {
  const { n, surface, height } = ground;
  const out: Region[] = [];
  const cells = (span: number, take: (s: number) => boolean, minArea: number, emit: (x: number, z: number, area: number) => void): void => {
    for (let r0 = 0; r0 < n; r0 += span) {
      for (let c0 = 0; c0 < n; c0 += span) {
        let m = 0;
        let sc = 0;
        let sr = 0;
        for (let r = r0; r < Math.min(n, r0 + span); r++) {
          for (let c = c0; c < Math.min(n, c0 + span); c++) {
            const i = r * n + c;
            if (!take(surface[i]!) || height[i]! < 0.3) continue;
            m++;
            sc += c;
            sr += r;
          }
        }
        if (m * 4 < minArea) continue;
        emit(size - (sc / m) * 2, size - (sr / m) * 2, m * 4);
      }
    }
  };
  cells(64, (s) => SAND.has(s) || s === S.WET_SAND, 2000, (x, z, area) => out.push({ spawns: "core:spawns_beach", count: Math.max(2, Math.min(8, Math.round(area / 3000))), x, z, radius: Math.round(Math.max(30, Math.min(90, Math.sqrt(area / Math.PI) * 1.3))) }));
  cells(192, (s) => s === S.CANOPY || s === S.GREEN || s === S.MANGROVE, 25000, (x, z, area) => out.push({ spawns: "core:spawns_jungle", count: Math.max(2, Math.min(9, Math.round(area / 10000))), x, z, radius: 160 }));
  cells(192, (s) => s === S.HEAP || s === S.FLOOR || s === S.SPILL || s === S.COURT, 40000, (x, z) => out.push({ spawns: "core:spawns_jungle", count: 2, x, z, radius: 150 }));
  return out.map((r) => ({ ...r, x: Math.round(r.x * 2) / 2, z: Math.round(r.z * 2) / 2 }));
}
