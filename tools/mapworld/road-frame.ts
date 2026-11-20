// The roads' frame a map carries for drawing (shared/world/roadframe.ts), from the road pieces of the street data
// (street-graph.ts): at every 4 m sample within a few metres of a carriageway on the ground, how far across its centre
// line the sample is, signed, how far along it from its piece's start, the carriageway's half width, and its lanes, one
// way or not, and how worn a road of its class is. A client draws wheel paths, oil and repairs along the lanes by it.
//
// Where carriageways cross, a sample on more than one holds the widest's frame, and of two as wide the nearer centre
// line's, the earlier piece's where they are as near: the through road's lanes run on over the crossing, and the lesser
// road's end at its edge. A sample off every carriageway but within ROAD_VERGE of one holds the nearest's, so that what
// is drawn between samples is still the road's up to its edge. Bridges and tunnels are not on the ground and have none.

import { ROAD_CELL, ROAD_WRAP, roadAcross, roadAlong, roadHalf, roadLanes, roadSamples, type MapRoad } from "../../shared/world/roadframe.ts";
import { binKey } from "./raster.ts";
import type { Piece, StreetGraph } from "./street-graph.ts";

/** Metres past a carriageway's edge its frame reaches. */
export const ROAD_VERGE = 3;
/** Classes (TIGER MTFCC) and kinds (OSM highway) that carry no traffic: walkways, stairs, bicycle and bridle paths. */
const NOT_DRIVEN = new Set(["S1710", "S1720", "S1820", "S1830", "footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor"]);
/** The frame's most offset either way, a step inside what a byte holds, and so the widest half it keeps. */
const FARTHEST = 15.5;
const BIN = 32;

/** How worn a road is, 0 to 7, by its kind or, where the data has none, its class. */
export function roadWear(p: Piece): number {
  const kind = (p.highway ?? "").replace(/_link$/, "");
  if (kind === "motorway" || kind === "trunk" || p.mtfcc === "S1100") return 6;
  if (kind === "primary" || p.mtfcc === "S1200") return 5;
  if (kind === "secondary") return 4;
  if (kind === "tertiary" || p.mtfcc === "S1630") return 3;
  if (kind === "service" || ["S1640", "S1730", "S1740", "S1780"].includes(p.mtfcc)) return 1;
  return 2;
}

interface Stretch { ax: number; az: number; ex: number; ez: number; length: number; half: number; start: number; line: number; lanes: number }

/**
 * The frame of a map `nx` by `nz` ground samples whose x and z are lattice x0 and z0 at its first sample, from the road
 * pieces of `graph`, row by row from z = 0.
 */
export function roadFrame(graph: Pick<StreetGraph, "segments" | "pieces">, nx: number, nz: number, x0: number, z0: number): MapRoad {
  const stretches: Stretch[] = [];
  let before: Stretch | null = null;
  for (const s of graph.segments) {
    const piece = graph.pieces[s.line]!;
    if (NOT_DRIVEN.has(s.mtfcc) || NOT_DRIVEN.has(piece.highway ?? "") || piece.bridge || piece.tunnel) {
      before = null;
      continue;
    }
    const [ex, ez] = [s.bx - s.ax, s.bz - s.az];
    const length = Math.sqrt(ex * ex + ez * ez);
    // A piece's stretches follow on, so "along" runs on from one to the next.
    const last: Stretch | null = before;
    const on = last !== null && last.line === s.line && Math.abs(last.ax + last.ex - s.ax) + Math.abs(last.az + last.ez - s.az) < 0.05;
    const start: number = last !== null && on ? (last.start + last.length) % ROAD_WRAP : 0;
    const lanes = roadLanes(piece.lanes, piece.oneway !== 0, piece.oneway < 0, roadWear(piece));
    before = { ax: s.ax, az: s.az, ex, ez, length, half: Math.min(s.half, FARTHEST - ROAD_VERGE), start, line: s.line, lanes };
    stretches.push(before);
  }
  const bins = new Map<number, Stretch[]>();
  for (const s of stretches) {
    const reach = s.half + ROAD_VERGE;
    const [lx, hx] = [Math.min(s.ax, s.ax + s.ex) - reach, Math.max(s.ax, s.ax + s.ex) + reach];
    const [lz, hz] = [Math.min(s.az, s.az + s.ez) - reach, Math.max(s.az, s.az + s.ez) + reach];
    for (let bz = Math.floor(lz / BIN); bz <= Math.floor(hz / BIN); bz++) {
      for (let bx = Math.floor(lx / BIN); bx <= Math.floor(hx / BIN); bx++) {
        const k = binKey(bx, bz);
        (bins.get(k) ?? bins.set(k, []).get(k)!).push(s);
      }
    }
  }
  const [w, d] = [roadSamples(nx), roadSamples(nz)];
  const out = { across: new Uint8Array(w * d), along: new Uint8Array(w * d), half: new Uint8Array(w * d), lanes: new Uint8Array(w * d) };
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      const [x, z] = [x0 + i * ROAD_CELL, z0 + j * ROAD_CELL];
      let best: Stretch | null = null, inside = false, near = Infinity;
      for (const s of bins.get(binKey(Math.floor(x / BIN), Math.floor(z / BIN))) ?? []) {
        const t = Math.max(0, Math.min(1, ((x - s.ax) * s.ex + (z - s.az) * s.ez) / (s.length * s.length)));
        const off = Math.hypot(x - s.ax - s.ex * t, z - s.az - s.ez * t);
        if (off > s.half + ROAD_VERGE) continue;
        const on = off <= s.half;
        const better = best === null || (on && !inside) || (on === inside && (on && s.half !== best.half ? s.half > best.half : off < near - 1e-6 || (Math.abs(off - near) <= 1e-6 && s.line < best.line)));
        if (!better) continue;
        best = s;
        inside = on;
        near = off;
      }
      if (!best) continue;
      const [rx, rz] = [x - best.ax, z - best.az], k = j * w + i;
      out.across[k] = roadAcross(Math.max(-FARTHEST, Math.min(FARTHEST, (rz * best.ex - rx * best.ez) / best.length)));
      out.along[k] = roadAlong(best.start + (rx * best.ex + rz * best.ez) / best.length);
      out.half[k] = roadHalf(best.half);
      out.lanes[k] = best.lanes;
    }
  }
  return out;
}
