// Street corners: where two streets meet, the kerb turns the corner on an arc, as a real curb return does, where the road
// burn (tools/mapdata/prepare.py) leaves a mitre and the sidewalks a straight join. For each corner between two
// neighbouring ways of a junction (street-graph.ts) whose streets are both of the rule's classes, this works out the arc:
// its radius at the curb's face from the wider street's width (rules/default.json street.walks.returns), shrunk where
// the streets leave no room, its centre and its two ends on the kerbs. The ground is painted round it (roundGround), and
// where the corner is within a few degrees of a right angle a curb return piece of that radius (content/curbs.ts) is
// planned there, which the walks (ruins.ts makeWalks) set down and end their straight runs at, and the street furniture
// stands on or behind (street-furniture.ts).
//
// Every place is in lattice metres (base.ts Grid). A way's direction (dx, dz) points out of the junction; the ways of a
// node turn counter-clockwise as atan2(dz, dx) grows, and `rot` turns a direction a quarter that way.

import { CURB_RETURN, RETURN_RADII, curbReturnKind, isCurbReturn, returnMiddle, returnRadius, returnTop } from "../../content/curbs.ts";
import type { Grid } from "./base.ts";
import { binKey } from "./raster.ts";
import { nodeKey, streetGraph, type StreetGraph } from "./street-graph.ts";
import type { StaticPiece } from "./statics.ts";

export interface ReturnRules {
  /** The classes (TIGER MTFCC) both streets at a corner must be of for it to be rounded, and one of them of `walked`'s. */
  classes: string[];
  walked: string[];
  /** The radius at the curb's face, in metres, by the wider street's half width: the first [most half width, radius] it is within. */
  radius: [number, number][];
  /** The least radius a corner is rounded to where its streets leave too little room for the rule's. */
  least: number;
  /** The corner angles, in degrees, that are rounded at all. */
  angles: [number, number];
  /** Degrees either side of a right angle within which a corner is given a return piece. */
  within: number;
}

/** One way out of the corner's junction: its direction, its piece (street-graph.ts lines), its half width and how long its first stretch runs straight. */
export interface CornerArm { dx: number; dz: number; line: number; half: number; straight: number }

export interface Corner {
  /** The junction, and where the two kerbs would meet. */
  x: number; z: number; px: number; pz: number;
  /** The way the corner turns from, and the next one counter-clockwise, which it turns to; the angle between them in radians. */
  a: CornerArm; b: CornerArm; angle: number;
  /** The arc: its centre and its radius at the curb's face, and the directions from its centre to its two ends, on a's kerb and on b's. */
  cx: number; cz: number; radius: number; ax: number; az: number; bx: number; bz: number;
  /** How far the arc's centre is from the kerbs' corner. */
  reach: number;
  /** Metres along each way from the junction to where its straight walk begins: past the piece's straight end's middle, or the arc's end. */
  alongA: number; alongB: number;
  /** The return piece planned here: its kind, its middle and its turn in degrees, as a static's; null where none is. */
  piece: { kind: string; x: number; z: number; yaw: number } | null;
}

const rot = (x: number, z: number): [number, number] => [-z, x];

/** The corners of a street graph by `rules`, in the order of its nodes and their ways. */
export function planCorners(graph: StreetGraph, rules: ReturnRules): Corner[] {
  // Each node's stretches by its key, to find how far a way out of it runs straight.
  const touching = new Map<number, { dx: number; dz: number; line: number; length: number }[]>();
  for (const s of graph.segments) {
    const ex = s.bx - s.ax, ez = s.bz - s.az, length = Math.hypot(ex, ez);
    if (length < 0.01) continue;
    for (const [x, z, sign] of [[s.ax, s.az, 1], [s.bx, s.bz, -1]] as const) {
      const k = nodeKey(x, z); let list = touching.get(k); if (!list) touching.set(k, (list = []));
      list.push({ dx: (sign * ex) / length, dz: (sign * ez) / length, line: s.line, length });
    }
  }
  const radiusFor = (half: number): number => rules.radius.find(([most]) => half <= most)?.[1] ?? rules.radius.at(-1)![1];
  const lo = (rules.angles[0] * Math.PI) / 180, hi = (rules.angles[1] * Math.PI) / 180, within = (rules.within * Math.PI) / 180;
  const out: Corner[] = [];
  for (const n of graph.nodes) {
    if (n.ways.length < 3) continue;
    const arm = (k: number): CornerArm | null => {
      const w = n.ways[k]!; const piece = graph.pieces[w.line]!;
      if (!rules.classes.includes(piece.mtfcc)) return null;
      const s = touching.get(n.key)?.find((t) => t.line === w.line && t.dx * w.dx + t.dz * w.dz > 0.999);
      return { dx: w.dx, dz: w.dz, line: w.line, half: piece.half, straight: s?.length ?? 0 };
    };
    for (let i = 0; i < n.ways.length; i++) {
      const a = arm(i), b = arm((i + 1) % n.ways.length);
      if (!a || !b || !(rules.walked.includes(graph.pieces[a.line]!.mtfcc) || rules.walked.includes(graph.pieces[b.line]!.mtfcc))) continue;
      let angle = Math.atan2(b.dz, b.dx) - Math.atan2(a.dz, a.dx);
      if (angle <= 0) angle += 2 * Math.PI;
      if (angle < lo || angle > hi) continue;
      const sin = a.dx * b.dz - a.dz * b.dx;
      const px = n.x + (a.dx * b.half + b.dx * a.half) / sin, pz = n.z + (a.dz * b.half + b.dz * a.half) / sin;
      const ul = Math.hypot(a.dx + b.dx, a.dz + b.dz), ux = (a.dx + b.dx) / ul, uz = (a.dz + b.dz) / ul;
      // Into the block from each kerb.
      const [nax, naz] = rot(a.dx, a.dz); const [nbx, nbz] = [b.dz, -b.dx];
      // How far along each way the kerbs' corner is, and how far the walk may begin: half the way's straight stretch, so
      // a corner at its far end has the other half.
      const pa = (px - n.x) * a.dx + (pz - n.z) * a.dz, pb = (px - n.x) * b.dx + (pz - n.z) * b.dz;
      const roomA = a.straight / 2 - pa, roomB = b.straight / 2 - pb;
      const wanted = radiusFor(Math.max(a.half, b.half));
      const base = { x: n.x, z: n.z, px, pz, a, b, angle };
      // A piece, its arc's ends on both kerbs and set on the corner's middle line, the largest radius not over the
      // rule's that leaves its walks room; the angle it misses a right angle by is left at its ends' joints.
      let planned: Corner | null = null;
      if (Math.abs(angle - Math.PI / 2) <= within) {
        // Its frame's x and z, a quarter apart either side of the middle line.
        const [rx, rz] = rot(ux, uz);
        const xx = (ux - rx) / Math.SQRT2, xz = (uz - rz) / Math.SQRT2, zx = (ux + rx) / Math.SQRT2, zz = (uz + rz) / Math.SQRT2;
        for (const radius of [...RETURN_RADII].filter((r) => r <= wanted).sort((p, q) => q - p)) {
          // Where its frame's corner stands on the middle line, so that its end along x lies on a's kerb.
          const q = (-radius * (xx * nax + xz * naz)) / (ux * nax + uz * naz);
          const ox = px + q * ux, oz = pz + q * uz;
          const ta = (ox + radius * xx - n.x) * a.dx + (oz + radius * xz - n.z) * a.dz;
          const tb = (ox + radius * zx - n.x) * b.dx + (oz + radius * zz - n.z) * b.dz;
          if (ta + CURB_RETURN.joint > a.straight / 2 || tb + CURB_RETURN.joint > b.straight / 2) continue;
          const [m] = returnMiddle(radius);
          const yaw = ((Math.atan2(-xz, xx) * 180) / Math.PI + 360) % 360;
          const cx = ox + radius * (xx + zx), cz = oz + radius * (xz + zz);
          planned = {
            ...base, cx, cz, radius, ax: -zx, az: -zz, bx: -xx, bz: -xz, reach: Math.hypot(cx - px, cz - pz),
            alongA: ta + CURB_RETURN.joint / 2, alongB: tb + CURB_RETURN.joint / 2,
            piece: { kind: curbReturnKind(radius), x: ox + m * (xx + zx), z: oz + m * (xz + zz), yaw },
          };
          break;
        }
      }
      if (!planned) {
        // The ground alone: the arc tangent to both kerbs, as large as the rule wants and the streets leave room for.
        const tan = Math.tan(angle / 2);
        const radius = Math.min(wanted, roomA * tan, roomB * tan);
        if (radius < rules.least) continue;
        const reach = radius / Math.sin(angle / 2), cx = px + reach * ux, cz = pz + reach * uz;
        planned = { ...base, cx, cz, radius, ax: -nax, az: -naz, bx: -nbx, bz: -nbz, reach, alongA: pa + radius / tan, alongB: pb + radius / tan, piece: null };
      }
      out.push(planned);
    }
  }
  return out;
}

const cache = new Map<string, Corner[]>();
/** The corners of a work folder's streets, worked out once a folder. */
export function cornersOf(site: { source: string; toLattice: (e: number, n: number) => [number, number] }, rules: ReturnRules): Corner[] {
  let c = cache.get(site.source);
  if (!c) { c = planCorners(streetGraph(site), rules); cache.set(site.source, c); }
  return c;
}

/** Whether the point lies between the arc's two ends as seen from its centre, and how far from its centre. */
function inArc(c: Corner, x: number, z: number): number {
  const vx = x - c.cx, vz = z - c.cz;
  const turn = c.ax * c.bz - c.az * c.bx;
  const s1 = c.ax * vz - c.az * vx, s2 = vx * c.bz - vz * c.bx;
  return (turn >= 0 ? s1 >= 0 && s2 >= 0 : s1 <= 0 && s2 <= 0) ? Math.hypot(vx, vz) : -1;
}

/** How far into the curb, from its face, the painted road reaches under a return: half a sample's worth less than the face, so the edge between the ground's samples lies under the piece. */
export const PAINT_IN = 0.5;
/** How far behind the curb's face the painted sidewalk runs round a corner: the made sidewalks' far edge (tools/mapdata/streets.py). */
export const PAINT_WALK = 3;

/**
 * Paints the ground round each corner: its samples outside the arc and short of the kerbs' corner become street
 * (roads.png's 1) and those within PAINT_WALK behind the curb's face sidewalk (use.png's 1), where `free` lets a sample
 * change (not water, nor a building, nor a crossing). Changes `roads` and `use` in place, and says how many samples of each.
 */
export function roundGround(corners: readonly Corner[], grid: Grid, roads: Uint8Array, use: Uint8Array, free: (i: number) => boolean): { road: number; walk: number } {
  const { nx, nz, x1, z1, cell } = grid;
  let road = 0, walk = 0;
  for (const c of corners) {
    const reach = c.reach + 1;
    const c0 = Math.max(0, Math.floor((x1 - c.cx - reach) / cell)), c1 = Math.min(nx - 1, Math.ceil((x1 - c.cx + reach) / cell));
    const r0 = Math.max(0, Math.floor((z1 - c.cz - reach) / cell)), r1 = Math.min(nz - 1, Math.ceil((z1 - c.cz + reach) / cell));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const i = row * nx + col;
      if (roads[i] !== 0 || !free(i)) continue;
      const r = inArc(c, x1 - col * cell, z1 - row * cell);
      if (r < 0) continue;
      if (r > c.radius - PAINT_IN && r <= reach) { roads[i] = 1; road++; }
      else if (r >= c.radius - PAINT_WALK && r <= c.radius - PAINT_IN && use[i] !== 1) { use[i] = 1; walk++; }
    }
  }
  return { road, walk };
}

/** The corners by 32 m bins, and the one whose rounded-off ground, outside its arc and short of its kerbs' corner, holds a point. */
export function filletIndex(corners: readonly Corner[]): (x: number, z: number) => Corner | null {
  const bins = new Map<number, Corner[]>();
  for (const c of corners) for (let bz = Math.floor((c.cz - c.reach - 1) / 32); bz <= Math.floor((c.cz + c.reach + 1) / 32); bz++) for (let bx = Math.floor((c.cx - c.reach - 1) / 32); bx <= Math.floor((c.cx + c.reach + 1) / 32); bx++) {
    const k = binKey(bx, bz); let list = bins.get(k); if (!list) bins.set(k, (list = [])); list.push(c);
  }
  return (x, z) => {
    for (const c of bins.get(binKey(Math.floor(x / 32), Math.floor(z / 32))) ?? []) {
      const r = inArc(c, x, z);
      if (r > c.radius && r <= c.reach + 1) return c;
    }
    return null;
  };
}

/**
 * The walk's top at (x, z) on a return piece as set down, or null off it: on its arc between the face and the walk's
 * back, the ramp's fall taken, or on its straight ends; `drop`, how far under the walk's full height the ramp has it.
 */
export function onReturn(p: StaticPiece, x: number, z: number): { top: number; drop: number } | null {
  const radius = returnRadius(p.kind); const [m] = returnMiddle(radius);
  const a = (p.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  // In the piece's corner frame: its x is the world's (c, -s) and its z (s, c), its corner m back along both from its middle.
  const dx = x - p.x, dz = z - p.z;
  const lx = dx * c - dz * s + m, lz = dx * s + dz * c + m;
  const road = p.y - CURB_RETURN.height / 2;
  const { walk, joint } = CURB_RETURN;
  if ((lx >= radius && lx <= radius + joint && lz >= 0 && lz <= walk) || (lz >= radius && lz <= radius + joint && lx >= 0 && lx <= walk)) return { top: road + CURB_RETURN.height - 0.006, drop: 0 };
  const ex = lx - radius, ez = lz - radius, r = Math.hypot(ex, ez);
  if (r < radius - walk || r > radius || ex > 0 || ez > 0) return null;
  const top = returnTop(radius, Math.atan2(-ex, -ez), r);
  return { top: road + top, drop: CURB_RETURN.height - top };
}

/** The return pieces among `placed`, by 16 m bins, and the one a point stands on with its top there. */
export function returnIndex(placed: readonly StaticPiece[]): (x: number, z: number) => { top: number; drop: number } | null {
  const bins = new Map<number, StaticPiece[]>();
  for (const p of placed) {
    if (!isCurbReturn(p.kind)) continue;
    const reach = returnRadius(p.kind) / 2 + 2;
    for (let bz = Math.floor((p.z - reach) / 16); bz <= Math.floor((p.z + reach) / 16); bz++) for (let bx = Math.floor((p.x - reach) / 16); bx <= Math.floor((p.x + reach) / 16); bx++) {
      const k = binKey(bx, bz); let list = bins.get(k); if (!list) bins.set(k, (list = [])); list.push(p);
    }
  }
  return (x, z) => {
    for (const p of bins.get(binKey(Math.floor(x / 16), Math.floor(z / 16))) ?? []) { const on = onReturn(p, x, z); if (on) return on; }
    return null;
  };
}
