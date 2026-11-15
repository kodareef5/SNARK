import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import type { StaticPiece } from "./statics.ts";

interface Point { x: number; y: number; z: number; }

export function obstructs(piece: StaticPiece, points: readonly Point[], pad = .7): boolean {
  const [w, h, d] = RUIN_SHAPES[piece.kind.split("_")[1] as RuinShape];
  const angle = piece.yaw * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
  const local = (q: Point): number[] => [(q.x - piece.x) * c - (q.z - piece.z) * s, q.y - piece.y, (q.x - piece.x) * s + (q.z - piece.z) * c];
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

export function obstacleIndex(pieces: readonly StaticPiece[]): { add: (p: StaticPiece) => void; blocked: (points: readonly Point[]) => boolean } {
  const bins = new Map<number, StaticPiece[]>();
  const add = (p: StaticPiece): void => {
    const [w, , d] = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape]; const radius = Math.hypot(w, d) / 2 + 1;
    for (let z = Math.floor((p.z - radius) / 64); z <= Math.floor((p.z + radius) / 64); z++) for (let x = Math.floor((p.x - radius) / 64); x <= Math.floor((p.x + radius) / 64); x++) {
      const k = x + z * 1024; if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push(p);
    }
  };
  for (const p of pieces) add(p);
  const blocked = (points: readonly Point[]): boolean => {
    const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x));
    const minZ = Math.min(...points.map((p) => p.z)); const maxZ = Math.max(...points.map((p) => p.z));
    for (let z = Math.floor(minZ / 64); z <= Math.floor(maxZ / 64); z++) for (let x = Math.floor(minX / 64); x <= Math.floor(maxX / 64); x++) for (const p of bins.get(x + z * 1024) ?? []) if (obstructs(p, points)) return true;
    return false;
  };
  return { add, blocked };
}
