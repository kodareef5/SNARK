// Where a kerb is let down flush with the road (shared/world/streets.ts drops), worked out once the streets are fitted and
// typed (plan.ts): the stretches of each kerb line that a crossing of the walk network meets, where a drive or a service
// road ends at a kerb without meeting its street's carriageway, and a ramp in the middle of each corner's arc with a walk
// that no crossing meets. A drive or an alley that meets its street's carriageway at a corner is let down there by the
// kerb lines themselves (streets.ts cornerDrops), from the part's own lines.

import { DROP_CROSSING, DROP_DRIVE, DROP_RAMP, kerbLines, kerbOf, walkOf, type KerbLine, type StreetCorner, type StreetSectors, type StreetsPart, type Stretch } from "../../../shared/world/streets.ts";
import type { Crossing } from "../street-graph.ts";

/** How far either side of where a crossing meets a kerb it is let down, past its own half width. */
const CROSSING_MARGIN = 0.3;
/** How far on from a service road's end a kerb it is let down for may be, and the least and most it is let down over. */
const DRIVE_REACH = 10, DRIVE_LEAST = 3, DRIVE_MOST = 7;
/** A corner's ramp: how long, and how long its arc must be to have one. */
const RAMP = 1.5, RAMP_ARC = 3;

/** A part held, with the map's own index of each of its stretches and corners. */
export interface HeldPart { readonly part: StreetsPart; readonly stretches: readonly number[]; readonly corners: readonly number[] }

/**
 * Every kerb's drops, by the map's stretch and side (`stretch * 2 + side`) and by its corner, from the held parts, the
 * walk network's crossings (in the map's metres) and which stretches have flush kerbs on both sides (a service road, an
 * alley, a drive), with how many of each kind.
 */
export function dropsOf(held: StreetSectors, parts: readonly HeldPart[], crossings: readonly Crossing[], flushStretches: ReadonlySet<number>, stretches: readonly Stretch[]): { sides: Map<number, number[]>; corners: Map<number, number[]>; count: Record<string, number> } {
  const sides = new Map<number, number[]>(), corners = new Map<number, number[]>();
  const count = { crossings: 0, drives: 0, ramps: 0 };
  // Every kerb line, each with whose it is, and its segments binned by 16 m.
  const lines: { line: KerbLine; key: number; corner: boolean }[] = [];
  for (const h of parts) for (const line of kerbLines(held, h.part)) lines.push({ line, key: line.corner >= 0 ? h.corners[line.corner]! : h.stretches[line.stretch]! * 2 + line.side, corner: line.corner >= 0 });
  const bins = new Map<string, [number, number][]>();
  const bin = (x: number, z: number): string => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  lines.forEach((l, i) => {
    for (let q = 1; q < l.line.stations.length; q++) {
      const key = bin((l.line.xz[q * 2 - 2]! + l.line.xz[q * 2]!) / 2, (l.line.xz[q * 2 - 1]! + l.line.xz[q * 2 + 1]!) / 2);
      (bins.get(key) ?? bins.set(key, []).get(key)!).push([i, q]);
    }
  });
  const put = (l: (typeof lines)[number], from: number, to: number, kind: number): void => {
    const into = l.corner ? corners : sides;
    (into.get(l.key) ?? into.set(l.key, []).get(l.key)!).push(Math.max(0, from), to, kind);
  };
  /** Where the segment from (ax, az) to (bx, bz) meets a kerb line: each line met, its station there and the sine of the angle between them. */
  const meets = (ax: number, az: number, bx: number, bz: number): { l: (typeof lines)[number]; s: number; sine: number; t: number }[] => {
    const found: { l: (typeof lines)[number]; s: number; sine: number; t: number }[] = [], seen = new Set<string>();
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
    for (let k = 0; k <= steps; k++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = ax + ((bx - ax) * k) / steps + dx * 16, z = az + ((bz - az) * k) / steps + dz * 16;
      for (const [i, q] of bins.get(bin(x, z)) ?? []) {
        if (seen.has(`${i},${q}`)) continue;
        seen.add(`${i},${q}`);
        const line = lines[i]!.line, px = line.xz[q * 2 - 2]!, pz = line.xz[q * 2 - 1]!, ex = line.xz[q * 2]! - px, ez = line.xz[q * 2 + 1]! - pz;
        const fx = bx - ax, fz = bz - az, d = fx * ez - fz * ex;
        if (Math.abs(d) < 1e-9) continue;
        const t = ((px - ax) * ez - (pz - az) * ex) / d, u = ((px - ax) * fz - (pz - az) * fx) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const s = line.stations[q - 1]! + (line.stations[q]! - line.stations[q - 1]!) * u;
        found.push({ l: lines[i]!, s, sine: Math.abs(d) / (Math.hypot(fx, fz) * Math.hypot(ex, ez)), t });
      }
    }
    return found;
  };
  // A crossing: where it meets a kerb at a fair angle, let down over its width.
  for (const c of crossings) for (const m of meets(c.ax, c.az, c.bx, c.bz)) {
    if (m.sine < 0.5) continue;
    put(m.l, m.s - c.half - CROSSING_MARGIN, m.s + c.half + CROSSING_MARGIN, DROP_CROSSING);
    count.crossings++;
  }
  // A service road that ends short of a street: the first kerb on from its end, let down over its width.
  const ends = new Map<string, number>();
  const endKey = (x: number, z: number): string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  stretches.forEach((s) => {
    for (const q of [0, s.xz.length - 2]) ends.set(endKey(s.xz[q]!, s.xz[q + 1]!), (ends.get(endKey(s.xz[q]!, s.xz[q + 1]!)) ?? 0) + 1);
  });
  for (const k of flushStretches) {
    const s = stretches[k]!, n = s.xz.length;
    for (const [q, r] of [[n - 2, n - 4], [0, 2]] as const) {
      if ((ends.get(endKey(s.xz[q]!, s.xz[q + 1]!)) ?? 0) > 1) continue;
      const x = s.xz[q]!, z = s.xz[q + 1]!, ex = x - s.xz[r]!, ez = z - s.xz[r + 1]!, l = Math.hypot(ex, ez) || 1;
      const hit = meets(x - (ex / l) * 2, z - (ez / l) * 2, x + (ex / l) * DRIVE_REACH, z + (ez / l) * DRIVE_REACH).filter((m) => !m.l.corner && m.sine > 0.5).sort((a, b) => a.t - b.t)[0];
      if (!hit) continue;
      const half = Math.max(DRIVE_LEAST, Math.min(DRIVE_MOST, s.sides[0].kerb + s.sides[1].kerb)) / 2;
      put(hit.l, hit.s - half, hit.s + half, DROP_DRIVE);
      count.drives++;
    }
  }
  // A corner's ramp in the middle of its arc, where it has a walk and no crossing meets it.
  for (const l of lines) {
    if (!l.corner || corners.has(l.key) || walkOf(l.line.kinds) === 0 || l.line.verge >= 0.5 || kerbOf(l.line.kinds) === 1) continue;
    const a = l.line.stations[0]!, b = l.line.stations[l.line.stations.length - 1]!;
    if (b - a < RAMP_ARC) continue;
    put(l, (a + b - RAMP) / 2, (a + b + RAMP) / 2, DROP_RAMP);
    count.ramps++;
  }
  // Each kerb's in the order of its stations, those that overlap made one (a crossing's kind kept over another's).
  for (const into of [sides, corners]) for (const [key, d] of into) {
    const list = Array.from({ length: d.length / 3 }, (_, k) => [d[k * 3]!, d[k * 3 + 1]!, d[k * 3 + 2]!] as [number, number, number]).sort((x, y) => x[0] - y[0]);
    const merged: [number, number, number][] = [];
    for (const m of list) {
      const last = merged[merged.length - 1];
      if (last && m[0] <= last[1] + 0.5) {
        last[1] = Math.max(last[1], m[1]);
        last[2] = Math.min(last[2], m[2]);
      } else merged.push([...m]);
    }
    into.set(key, merged.flat());
  }
  return { sides, corners, count };
}

/** A stretch with its sides' drops, where it has some. */
export function withDrops(s: Stretch, k: number, sides: ReadonlyMap<number, number[]>): Stretch {
  const left = sides.get(k * 2), right = sides.get(k * 2 + 1);
  return left || right ? { ...s, drops: [left ? Float64Array.from(left) : null, right ? Float64Array.from(right) : null] } : s;
}

/** A corner with its drops, where it has some. */
export function cornerWithDrops<T extends StreetCorner>(c: T, k: number, corners: ReadonlyMap<number, number[]>): T {
  const d = corners.get(k);
  return d ? { ...c, drops: Float64Array.from(d) } : c;
}
