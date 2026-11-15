// Where survivors arrive and leave, and where wild creatures live. Spawn points and obelisks are named in the world file
// near a place, and each is set on the nearest dry, level, open ground (of the kind a spawn point asks for). Regions are
// found from the ground: dodos and parasaurs on each stretch of beach, and the jungle's herds and hunters in the
// hammocks, the gardens and the ruins.

import type { Registry } from "../../shared/content/registry.ts";
import type { ObeliskPlace } from "../../shared/world/obelisks.ts";
import { S, type Ground, type World } from "./ground.ts";
import type { StaticPiece } from "./statics.ts";

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

/** Per sample, 1 where a static piece stands over it at any height: a square round its middle as wide as its turned box. */
export function staticCover(pieces: readonly StaticPiece[], reg: Registry, n: number, size: number): Uint8Array {
  const cover = new Uint8Array(n * n);
  for (const p of pieces) {
    const k = reg.index.get(p.kind);
    if (k === undefined) continue;
    // In samples, and half a sample more so that a piece smaller than a sample still covers the one nearest it.
    const r = Math.hypot(reg.halfX[k]!, reg.halfZ[k]!) / 2 + 0.5;
    const c = (size - p.x) / 2;
    const w = (size - p.z) / 2;
    for (let row = Math.max(0, Math.ceil(w - r)); row <= Math.min(n - 1, Math.floor(w + r)); row++) {
      for (let col = Math.max(0, Math.ceil(c - r)); col <= Math.min(n - 1, Math.floor(c + r)); col++) cover[row * n + col] = 1;
    }
  }
  return cover;
}

/** Samples from an obelisk's middle to where its user stands before the terminal: 7 m (shared/world/obelisks.ts). */
const STAND = 3.5;

/**
 * Each obelisk the world file names, on the nearest ground where it stands level and its user has room: open, dry ground
 * level to a quarter metre under the obelisk turned any way, and to half a metre round the terminal and before it, with no
 * static piece within 10 m of its middle or 6 m of where its user stands. The terminal turns toward the place named.
 */
export function placeObelisks(ground: Ground, world: World, toSample: (lon: number, lat: number) => [number, number], size: number, cover: Uint8Array): ObeliskPlace[] {
  const { n, height, surface } = ground;
  // Every sample within `reach` of (c, r) is open dry ground within `level` of `h`, and none within `room` has a piece.
  const clear = (c: number, r: number, h: number, reach: number, level: number, room: number): boolean => {
    const [c0, r0] = [Math.round(c), Math.round(r)];
    for (let dr = -room; dr <= room; dr++) {
      for (let dc = -room; dc <= room; dc++) {
        const d2 = dr * dr + dc * dc;
        if (d2 > room * room) continue;
        const col = c0 + dc;
        const row = r0 + dr;
        if (col < 0 || row < 0 || col >= n || row >= n) return false;
        const i = row * n + col;
        if (cover[i]) return false;
        if (d2 <= reach * reach && (!OPEN.has(surface[i]!) || height[i]! < 0.4 || Math.abs(height[i]! - h) > level)) return false;
      }
    }
    return true;
  };
  return (world.obelisks ?? []).map((o) => {
    const [c0, r0] = toSample(o.at[0], o.at[1]).map(Math.round) as [number, number];
    const [fc, fr] = toSample(o.face[0], o.face[1]);
    for (let ring = 0; ring < 150; ring++) {
      let best: [number, number, number] | null = null;
      let near = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          const d = dr * dr + dc * dc;
          if (d >= near || c < 8 || r < 8 || c >= n - 8 || r >= n - 8) continue;
          // Toward the place it faces, in whole degrees as a spawn point turns: east is -x on the map.
          const degrees = Math.round((Math.atan2(-(fc - c), -(fr - r)) * 180) / Math.PI);
          const a = (degrees * Math.PI) / 180;
          const h = height[r * n + c]!;
          if (!clear(c, r, h, 3, 0.25, 5) || !clear(c - Math.sin(a) * STAND, r - Math.cos(a) * STAND, h, 2, 0.5, 3)) continue;
          near = d;
          best = [c, r, degrees];
        }
      }
      if (!best) continue;
      const [c, r, degrees] = best;
      return { name: o.name, x: size - c * 2, z: size - r * 2, yaw: Math.round((((degrees + 360) % 360) / 360) * 65536) & 0xffff };
    }
    throw new Error(`no ground fit for the obelisk "${o.name}" within 300 m of where it is named`);
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
