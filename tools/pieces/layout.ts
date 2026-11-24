// Small houses and wall junctions laid out as the game places pieces, for the review sheet and the joint test.

import { DOOR_HEIGHT, FLOOR_THICK, FOUNDATION_THICK, SPAN, WALL_HEIGHT, WALL_THICK } from "../../content/building.ts";

export const TIERS = ["thatch", "wood", "stone", "metal"] as const;
export type TierName = (typeof TIERS)[number];

/** A piece where it stands: its structure id, its middle in metres and its yaw in 1/65,536 turns. */
export interface Placed {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A convex polygon on the ground, as x and z pairs, standing from y0 to y1. */
export interface Prism {
  poly: [number, number][];
  y0: number;
  y1: number;
}

export interface Junction {
  name: string;
  pieces: Placed[];
  /** The point the walls meet at, on the ground. */
  vertex: [number, number];
  /** What a ray may not pass through: each wall's middle sheet near the vertex, and the sheets' meeting. */
  cores: Prism[];
  /** The outside corner a square joint fills, where two walls leave a notch. */
  mitres: Prism[];
  /** The height of the middle of each storey, where it is looked at. */
  looks: number[];
}

/** A wall end at a vertex: the way the wall runs from it, in degrees from +X toward +Z, and whether its outside is to the left of that way. */
export interface WallEnd {
  form: string;
  tier: TierName;
  way: number;
  left: boolean;
  /** The storey it stands on, 0 for the ground. */
  storey?: number;
}

/** A core sheet reaches this far from the vertex and is this thick each side of the wall's middle. */
const REACH = 0.45;
const CORE = 0.03;
/** Left off the foot and top of what is judged, where a sill or a plate stands back from its box. */
const TRIM = 0.06;

const TURN = 65536;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** The id a tier gives a form, or wood's where the tier has none. */
export function pieceId(form: string, tier: TierName, has: (id: string) => boolean): string {
  return has(`core:${form}_${tier}`) ? `core:${form}_${tier}` : `core:${form}_wood`;
}

/** A wall-family piece running `SPAN` from (vx, vz) along `way`, its foot at `foot`. */
export function wallAt(id: string, vx: number, vz: number, way: number, left: boolean, foot: number): Placed {
  const [dx, dz] = [Math.cos(rad(way)), Math.sin(rad(way))];
  // A piece's own +X turns to (cos, -sin) and its outside, +Z, to (sin, cos).
  const yaw = left ? -way : 180 - way;
  return { id, x: vx + (dx * SPAN) / 2, y: foot + WALL_HEIGHT / 2, z: vz + (dz * SPAN) / 2, yaw: Math.round((((yaw % 360) + 360) % 360) / 360 * TURN) % TURN };
}

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 1e-12) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half(p.reverse())];
}

/** The walls that meet at a vertex, with what a ray may not pass and the notch their outside leaves. */
export function junction(name: string, vx: number, vz: number, ends: readonly WallEnd[], has: (id: string) => boolean, foot = 0): Junction {
  const pieces: Placed[] = [];
  const cores: Prism[] = [];
  const mitres: Prism[] = [];
  const storeys = [...new Set(ends.map((e) => e.storey ?? 0))];
  for (const storey of storeys) {
    const here = ends.filter((e) => (e.storey ?? 0) === storey);
    const y0 = foot + storey * WALL_HEIGHT;
    const [lo, hi] = [y0 + TRIM, y0 + WALL_HEIGHT - TRIM];
    const tips: [number, number][] = [];
    for (const e of here) {
      pieces.push(wallAt(pieceId(e.form, e.tier, has), vx, vz, e.way, e.left, y0));
      const [dx, dz] = [Math.cos(rad(e.way)), Math.sin(rad(e.way))];
      const [nx, nz] = [-dz * CORE, dx * CORE];
      cores.push({ poly: [[vx + nx, vz + nz], [vx + dx * REACH + nx, vz + dz * REACH + nz], [vx + dx * REACH - nx, vz + dz * REACH - nz], [vx - nx, vz - nz]], y0: lo, y1: hi });
      tips.push([vx + nx, vz + nz], [vx - nx, vz - nz]);
    }
    if (here.length > 1) cores.push({ poly: hull(tips), y0: lo, y1: hi });
    // Between two neighbours more than a half turn apart, their outer faces carried on meet behind the vertex.
    const ways = here.map((e) => ((e.way % 360) + 360) % 360).sort((a, b) => a - b);
    const half = WALL_THICK / 2;
    ways.forEach((from, k) => {
      const to = ways[(k + 1) % ways.length]!;
      const gap = (to - from + 360) % 360 || 360;
      if (here.length < 2 || gap <= 180.5 || gap >= 359.5) return;
      const [ax, az] = [vx - Math.sin(rad(from)) * half, vz + Math.cos(rad(from)) * half];
      const [bx, bz] = [vx + Math.sin(rad(to)) * half, vz - Math.cos(rad(to)) * half];
      const [ux, uz, wx, wz] = [Math.cos(rad(from)), Math.sin(rad(from)), Math.cos(rad(to)), Math.sin(rad(to))];
      const s = ((bx - ax) * wz - (bz - az) * wx) / (ux * wz - uz * wx);
      mitres.push({ poly: [[vx, vz], [ax, az], [ax + ux * s, az + uz * s], [bx, bz]], y0: lo, y1: hi });
    });
  }
  return { name, pieces, vertex: [vx, vz], cores, mitres, looks: storeys.map((s) => foot + (s + 0.5) * WALL_HEIGHT) };
}

/** The angles two walls are tried at: a straight run and a house's corner. Triangles will add 60, 120 and 150. */
export const ANGLES: readonly number[] = [180, 90];

/** The junctions every tier is judged at, by name: two walls at each of ANGLES, then these. */
export const JUNCTIONS: readonly string[] = [...ANGLES.map((a) => `walls ${a}`), "tee", "cross", "openings 90", "two storeys", "mixed 90"];

/** The tier a tier's mixed corner is shared with: the next one up, and wood for metal. */
export const mixedWith = (tier: TierName): TierName => (tier === "metal" ? "wood" : TIERS[TIERS.indexOf(tier) + 1]!);

/** One of JUNCTIONS for a tier at (vx, vz). Walls face out of the house where it has an inside. */
export function tierJunction(name: string, tier: TierName, vx: number, vz: number, has: (id: string) => boolean): Junction {
  const wall = (way: number, left: boolean, form = "wall", storey = 0, of: TierName = tier): WallEnd => ({ form, tier: of, way, left, storey });
  const angle = /^walls (\d+)$/.exec(name);
  if (angle) return junction(name, vx, vz, [wall(0, false), wall(Number(angle[1]), true)], has);
  if (name === "tee") return junction(name, vx, vz, [wall(0, false), wall(180, true), wall(90, true)], has);
  if (name === "cross") return junction(name, vx, vz, [wall(0, false), wall(90, true), wall(180, true), wall(270, false)], has);
  if (name === "openings 90") return junction(name, vx, vz, [wall(0, false, "doorframe"), wall(90, true, "windowframe")], has);
  if (name === "mixed 90") return junction(name, vx, vz, [wall(0, false), wall(90, true, "wall", 0, mixedWith(tier))], has);
  if (name !== "two storeys") throw new Error(`no junction "${name}"`);
  // A foundation, a corner on it, a ceiling over it and the corner again above.
  const made = junction(name, vx, vz, [wall(0, false), wall(90, true), wall(0, false, "wall", 1), wall(90, true, "wall", 1)], has, FOUNDATION_THICK);
  const cell = (form: string, y: number): Placed => ({ id: pieceId(form, tier, has), x: vx + SPAN / 2, y, z: vz + SPAN / 2, yaw: 0 });
  made.pieces.push(cell("foundation", FOUNDATION_THICK / 2), cell("ceiling", FOUNDATION_THICK + WALL_HEIGHT - FLOOR_THICK / 2));
  return made;
}

/** Every form a tier has, in a row along +X from (x, z), each standing on the ground. */
export function formRow(tier: TierName, x: number, z: number, has: (id: string) => boolean, half: (id: string) => readonly [number, number, number]): Placed[] {
  const out: Placed[] = [];
  let at = x;
  for (const form of ["foundation", "wall", "doorframe", "windowframe", "ceiling", "pillar", "door", "door_open", "stairs"]) {
    const id = `core:${form}_${tier}`;
    if (!has(id)) continue;
    const h = half(id);
    out.push({ id, x: at + h[0], y: h[1], z, yaw: 0 });
    at += h[0] * 2 + 0.6;
  }
  return out;
}

/**
 * A house two cells square: foundations, walls round it with a doorway, its door open, and two windows, a ceiling over
 * half, stairs up to it and a pillar under it.
 */
export function house(tier: TierName, x: number, z: number, has: (id: string) => boolean): Placed[] {
  const id = (form: string): string => pieceId(form, tier, has);
  const out: Placed[] = [];
  const floor = FOUNDATION_THICK;
  for (const i of [0, 1]) for (const j of [0, 1]) out.push({ id: id("foundation"), x: x + SPAN * (i + 0.5), y: floor / 2, z: z + SPAN * (j + 0.5), yaw: 0 });
  // Round the house with the inside on the left: south, east, north, west.
  const sides: [number, number, number, string[]][] = [[x, z, 0, ["doorframe", "windowframe"]], [x + 2 * SPAN, z, 90, ["wall", "wall"]], [x + 2 * SPAN, z + 2 * SPAN, 180, ["wall", "wall"]], [x, z + 2 * SPAN, 270, ["windowframe", "wall"]]];
  for (const [sx, sz, way, forms] of sides) {
    forms.forEach((form, k) => {
      const [dx, dz] = [Math.cos(rad(way)), Math.sin(rad(way))];
      out.push(wallAt(id(form), sx + dx * SPAN * k, sz + dz * SPAN * k, way, false, floor));
    });
  }
  const door = out.find((p) => p.id === id("doorframe"))!;
  out.push({ id: id("door_open"), x: door.x, y: floor + DOOR_HEIGHT / 2, z: door.z, yaw: door.yaw });
  const up = floor + WALL_HEIGHT - FLOOR_THICK / 2;
  for (const i of [0, 1]) out.push({ id: id("ceiling"), x: x + SPAN * (i + 0.5), y: up, z: z + SPAN * 1.5, yaw: 0 });
  out.push({ id: id("stairs"), x: x + SPAN * 1.5, y: floor + WALL_HEIGHT / 2, z: z + SPAN / 2, yaw: 0 });
  out.push({ id: id("pillar"), x: x + SPAN / 2, y: floor + WALL_HEIGHT / 2, z: z + SPAN * 1.5, yaw: 0 });
  return out;
}
