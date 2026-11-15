import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import type { RuinRecord } from "./ruins.ts";
import type { StaticPiece } from "./statics.ts";

interface Point { x: number; y: number; z: number; }
interface Segment { a: Point; b: Point; street: boolean; }

// Clearance is applied after all buildings, since a neighbouring facade can overhang an earlier route.
export function clearCirculation(pieces: StaticPiece[], records: RuinRecord[], infrastructure: number): Record<string, number> {
  const grid = new Map<number, Segment[]>();
  const add = (a: Point, b: Point, street: boolean): void => {
    const segment = { a, b, street };
    for (let z = Math.floor((Math.min(a.z, b.z) - 1) / 32); z <= Math.floor((Math.max(a.z, b.z) + 1) / 32); z++) for (let x = Math.floor((Math.min(a.x, b.x) - 1) / 32); x <= Math.floor((Math.max(a.x, b.x) + 1) / 32); x++) {
      const k = x + z * 1024; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(segment);
    }
  };
  for (const r of records) {
    for (const a of r.approaches) {
      const end = { x: a.street.x + (a.door.x - a.street.x) * a.ramp, y: a.door.y, z: a.street.z + (a.door.z - a.street.z) * a.ramp };
      add(a.street, end, true); add(end, a.door, true); add(a.door, a.core, true);
    }
    for (const route of [...r.rooms.filter((r) => r.kind !== "rubble"), ...r.escapes]) for (let i = 1; i < route.points.length; i++) add(route.points[i - 1]!, route.points[i]!, false);
  }
  const removed = new Uint8Array(pieces.length); const tally: Record<string, number> = {};
  for (let i = infrastructure; i < pieces.length; i++) {
    const p = pieces[i]!; const shape = p.kind.split("_")[1] as RuinShape; const [w, h, d] = RUIN_SHAPES[shape];
    if (shape === "step" || shape === "landing") continue;
    const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); const radius = Math.hypot(w, d) / 2;
    let cut = false;
    for (let z = Math.floor((p.z - radius) / 32); z <= Math.floor((p.z + radius) / 32) && !cut; z++) for (let x = Math.floor((p.x - radius) / 32); x <= Math.floor((p.x + radius) / 32) && !cut; x++) for (const route of grid.get(x + z * 1024) ?? []) {
      if (!route.street && ["step", "landing", "floor4", "floor8", "floor16"].includes(shape)) continue;
      const point = (q: Point): number[] => { const dx = q.x - p.x; const dz = q.z - p.z; return [dx * c - dz * s, q.y - p.y, dx * s + dz * c]; };
      const from = point(route.a); const to = point(route.b); const low = [-w / 2 - .46, -h / 2 - 2.05, -d / 2 - .46]; const high = [w / 2 + .46, h / 2 - .38, d / 2 + .46];
      let enter = 0; let leave = 1;
      for (let axis = 0; axis < 3; axis++) {
        const delta = to[axis]! - from[axis]!;
        if (Math.abs(delta) < 1e-8) { if (from[axis]! <= low[axis]! || from[axis]! >= high[axis]!) { leave = -1; break; } }
        else { const t0 = (low[axis]! - from[axis]!) / delta; const t1 = (high[axis]! - from[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (enter <= leave) { cut = true; break; }
    }
    if (cut) { removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1; }
  }
  let write = 0; let recordIndex = 0;
  for (let i = 0; i < pieces.length;) {
    const record = records[recordIndex];
    if (record && i === record.firstPiece) {
      const end = i + record.blocks; record.firstPiece = write;
      for (; i < end; i++) if (!removed[i]) pieces[write++] = pieces[i]!;
      record.blocks = write - record.firstPiece; recordIndex++;
    } else { if (!removed[i]) pieces[write++] = pieces[i]!; i++; }
  }
  pieces.length = write; return tally;
}
