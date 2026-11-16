import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { wreckLook } from "../../content/vehicles/wrecks.ts";
import type { Def, ShapeBox } from "../../shared/content/defs.ts";
import { hullPoint, type HullDef } from "../../shared/world/convex.ts";
import type { StaticPiece } from "./statics.ts";

interface Point { x: number; y: number; z: number; }
/** A piece's bounding box in its own frame: its full size, and where its middle lies from its origin. */
export interface Extent { size: readonly [number, number, number]; at: readonly [number, number, number]; }

const extents = new Map<string, Extent>();
let content: Map<string, Def> | null = null;
const bounds = (boxes: readonly ShapeBox[], hulls: readonly HullDef[] = []): Extent => {
  const points = [...boxes.flatMap((b) => [[0, 1, 2].map((a) => b.at[a]! - b.half[a]!), [0, 1, 2].map((a) => b.at[a]! + b.half[a]!)]), ...hulls.flatMap((h) => h.corners.map((c) => hullPoint(c, h.sixty === true)))];
  const lo = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]!))); const hi = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]!)));
  return { size: [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!], at: [(hi[0]! + lo[0]!) / 2, (hi[1]! + lo[1]!) / 2, (hi[2]! + lo[2]!) / 2] };
};
/** A kit piece is a box about its origin; a wreck stands on its origin, its boxes the content's shape; any other static is its content's shape or box. */
export function extentOf(kind: string): Extent {
  const known = extents.get(kind); if (known) return known;
  const look = wreckLook(kind); let out: Extent;
  if (look) out = bounds(look.boxes);
  else if (kind.startsWith("core:zruin_")) out = { size: RUIN_SHAPES[kind.split("_")[1] as RuinShape], at: [0, 0, 0] };
  else {
    content ??= new Map(CORE_CONTENT.map((d) => [d.id, d]));
    const def = content.get(kind); const shape = def?.type === "structure" && def.shape ? content.get(def.shape) : undefined;
    if (shape?.type === "shape") out = bounds(shape.boxes, shape.hulls);
    else if (def?.type === "structure") out = { size: [def.half[0] * 2, def.half[1] * 2, def.half[2] * 2], at: [0, 0, 0] };
    else throw new Error(`no static of the kind ${kind}`);
  }
  extents.set(kind, out); return out;
}
/** The middle of a piece's box in the world. */
export function middleOf(p: StaticPiece): Point {
  const { at } = extentOf(p.kind); const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
  return { x: p.x + at[0] * c + at[2] * s, y: p.y + at[1], z: p.z - at[0] * s + at[2] * c };
}

export function obstructs(piece: StaticPiece, points: readonly Point[], pad = .7): boolean {
  const [w, h, d] = extentOf(piece.kind).size; const m = middleOf(piece);
  const angle = piece.yaw * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
  const local = (q: Point): number[] => [(q.x - m.x) * c - (q.z - m.z) * s, q.y - m.y, (q.x - m.x) * s + (q.z - m.z) * c];
  for (let i = 1; i < points.length; i++) {
    const a = local(points[i - 1]!); const b = local(points[i]!);
    const low = [-w / 2 - pad, -h / 2 - 2.2, -d / 2 - pad]; const high = [w / 2 + pad, h / 2 - .12, d / 2 + pad];
    let enter = 0; let leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const delta = b[axis]! - a[axis]!;
      if (Math.abs(delta) < 1e-8) { if (a[axis]! <= low[axis]! || a[axis]! >= high[axis]!) { leave = -1; break; } }
      else { const t0 = (low[axis]! - a[axis]!) / delta; const t1 = (high[axis]! - a[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
    }
    if (enter <= leave) return true;
  }
  return false;
}

/** A box in the world: its middle, its turn in degrees as a piece's, and its full size along its own x, y and z. */
export interface Box { x: number; y: number; z: number; yaw: number; size: readonly [number, number, number]; }
export const boxOf = (p: StaticPiece): Box => ({ ...middleOf(p), yaw: p.yaw, size: extentOf(p.kind).size });

/** Whether two boxes, the first grown by `gap` round its sides, meet: their footprints overlap and their heights do. */
export function meets(a: Box, b: Box, gap = 0): boolean {
  if (a.y + a.size[1] / 2 <= b.y - b.size[1] / 2 || b.y + b.size[1] / 2 <= a.y - a.size[1] / 2) return false;
  const reach = Math.hypot(a.size[0], a.size[2]) / 2 + Math.hypot(b.size[0], b.size[2]) / 2 + gap * 1.5;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return false;
  // A box's own axes run as a piece's: x along (cos, -sin) and z along (sin, cos) of its yaw.
  const axes = (r: Box): [number, number][] => { const t = r.yaw * Math.PI / 180; return [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]]; };
  const [aa, ba] = [axes(a), axes(b)];
  const half = (r: Box, ax: [number, number][], grow: number, [nx, nz]: [number, number]): number => (r.size[0] / 2 + grow) * Math.abs(ax[0]![0] * nx + ax[0]![1] * nz) + (r.size[2] / 2 + grow) * Math.abs(ax[1]![0] * nx + ax[1]![1] * nz);
  for (const n of [...aa, ...ba]) if (Math.abs((a.x - b.x) * n[0] + (a.z - b.z) * n[1]) >= half(a, aa, gap, n) + half(b, ba, 0, n)) return false;
  return true;
}

export function obstacleIndex(pieces: readonly StaticPiece[]): { add: (p: StaticPiece) => void; blocked: (points: readonly Point[]) => boolean; hits: (box: Box, gap?: number) => boolean; count: (x: number, z: number, radius: number) => number } {
  const bins = new Map<number, { p: StaticPiece; box: Box }[]>();
  const add = (p: StaticPiece): void => {
    const box = boxOf(p); const radius = Math.hypot(box.size[0], box.size[2]) / 2 + 1;
    for (let z = Math.floor((box.z - radius) / 64); z <= Math.floor((box.z + radius) / 64); z++) for (let x = Math.floor((box.x - radius) / 64); x <= Math.floor((box.x + radius) / 64); x++) {
      const k = x + z * 1024; if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push({ p, box });
    }
  };
  for (const p of pieces) add(p);
  const blocked = (points: readonly Point[]): boolean => {
    const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x));
    const minZ = Math.min(...points.map((p) => p.z)); const maxZ = Math.max(...points.map((p) => p.z));
    for (let z = Math.floor(minZ / 64); z <= Math.floor(maxZ / 64); z++) for (let x = Math.floor(minX / 64); x <= Math.floor(maxX / 64); x++) for (const { p } of bins.get(x + z * 1024) ?? []) if (obstructs(p, points)) return true;
    return false;
  };
  /** Whether a piece already set down meets the box grown by `gap`. */
  const hits = (box: Box, gap = 0): boolean => {
    const radius = Math.hypot(box.size[0], box.size[2]) / 2 + gap;
    for (let z = Math.floor((box.z - radius) / 64); z <= Math.floor((box.z + radius) / 64); z++) for (let x = Math.floor((box.x - radius) / 64); x <= Math.floor((box.x + radius) / 64); x++) {
      for (const q of bins.get(x + z * 1024) ?? []) if (meets(box, q.box, gap)) return true;
    }
    return false;
  };
  /** How many pieces have their middle within `radius` of the point. */
  const count = (x: number, z: number, radius: number): number => {
    const seen = new Set<StaticPiece>();
    for (let bz = Math.floor((z - radius) / 64); bz <= Math.floor((z + radius) / 64); bz++) for (let bx = Math.floor((x - radius) / 64); bx <= Math.floor((x + radius) / 64); bx++) {
      for (const { p, box } of bins.get(bx + bz * 1024) ?? []) if (Math.hypot(box.x - x, box.z - z) < radius) seen.add(p);
    }
    return seen.size;
  };
  return { add, blocked, hits, count };
}
