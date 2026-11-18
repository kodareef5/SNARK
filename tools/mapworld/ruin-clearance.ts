import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { binKey } from "./raster.ts";
import type { RuinRecord } from "./ruins.ts";
import type { StaticPiece } from "./statics.ts";
import type { RoadEntrance } from "./bridge-earthwork.ts";

interface Point { x: number; y: number; z: number; }
interface Segment { a: Point; b: Point; street: boolean; }

// Clearance is applied after all buildings, since a neighbouring facade can overhang an earlier route.
export function clearCirculation(pieces: StaticPiece[], records: RuinRecord[], infrastructure: number, assemblies: readonly StaticPiece[][] = [], decks: readonly { deck: readonly (Point & { gap: boolean })[]; entrances?: readonly RoadEntrance[] }[] = []): Record<string, number> {
  const grid = new Map<number, Segment[]>();
  const add = (a: Point, b: Point, street: boolean): void => {
    const segment = { a, b, street };
    for (let z = Math.floor((Math.min(a.z, b.z) - 1) / 32); z <= Math.floor((Math.max(a.z, b.z) + 1) / 32); z++) for (let x = Math.floor((Math.min(a.x, b.x) - 1) / 32); x <= Math.floor((Math.max(a.x, b.x) + 1) / 32); x++) {
      const k = binKey(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(segment);
    }
  };
  for (const r of decks) for (let i = 1; i < r.deck.length; i++) if (!r.deck[i - 1]!.gap && !r.deck[i]!.gap) add(r.deck[i - 1]!, r.deck[i]!, false);
  // Not every facade/post uses the layout's tile mask. Apply the existing vertical clearance to the actual dry
  // road runout as well; retain piers below it and genuine lower passages. Parallel tracks cover the driving width.
  for (const r of decks) for (const e of r.entrances ?? []) for (let i = 1; i < (e.runout?.length ?? 0); i++) {
    const a = e.runout![i - 1]!, b = e.runout![i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let side = -e.width / 2; side <= e.width / 2; side++) {
      const dx = -(b.z - a.z) / length * side, dz = (b.x - a.x) / length * side;
      add({ x: a.x + dx, y: a.y, z: a.z + dz }, { x: b.x + dx, y: b.y, z: b.z + dz }, true);
    }
  }
  for (const r of records) {
    for (const a of r.approaches) {
      const end = { x: a.street.x + (a.door.x - a.street.x) * a.ramp, y: a.door.y, z: a.street.z + (a.door.z - a.street.z) * a.ramp };
      add(a.street, end, true); add(end, a.door, true); add(a.door, a.core, true);
    }
    for (const route of [...r.rooms.filter((r) => r.kind !== "rubble"), ...r.escapes]) for (let i = 1; i < route.points.length; i++) add(route.points[i - 1]!, route.points[i]!, false);
    for (const route of r.routes) {
      const a = route.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
      const point = (u: number, y: number, v: number): Point => ({ x: route.x + u * c + v * s, y: route.y + y, z: route.z - u * s + v * c });
      for (let f = 0; f < route.floors; f++) {
        const dir = f % 2 === 0 ? 1 : -1; const u = f % 2 === 0 ? -1.5 : 1.5;
        add(point(u, f * 4, -dir * 3.25), point(u, (f + 1) * 4, dir * 2.25), false);
        add(point(u, (f + 1) * 4, dir * 2.25), point(u, (f + 1) * 4, dir * 3.25), false);
        add(point(u, (f + 1) * 4, dir * 3.25), point(-u, (f + 1) * 4, dir * 3.25), false);
      }
      const dir = route.floors % 2 === 0 ? -1 : 1;
      add(point(dir * 1.5, route.floors * 4, dir * 3.25), point(dir * 1.5, route.floors * 4, dir * 5.5), false);
    }
  }
  const removed = new Uint8Array(pieces.length); const tally: Record<string, number> = {};
  const replacements = new Map<number, StaticPiece[]>();
  const blocked = (p: StaticPiece): boolean => {
    const shape = p.kind.split("_")[1] as RuinShape; const [w, h, d] = RUIN_SHAPES[shape];
    const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); const radius = Math.hypot(w, d) / 2;
    for (let z = Math.floor((p.z - radius) / 32); z <= Math.floor((p.z + radius) / 32); z++) for (let x = Math.floor((p.x - radius) / 32); x <= Math.floor((p.x + radius) / 32); x++) for (const route of grid.get(binKey(x, z)) ?? []) {
      if (!route.street && route.a.y === route.b.y && shape.startsWith("floor") && Math.abs(p.y + h / 2 - route.a.y) < .12) continue;
      const point = (q: Point): number[] => { const dx = q.x - p.x; const dz = q.z - p.z; return [dx * c - dz * s, q.y - p.y, dx * s + dz * c]; };
      const from = point(route.a); const to = point(route.b); const low = [-w / 2 - .46, -h / 2 - 2.05, -d / 2 - .46]; const high = [w / 2 + .46, h / 2 - (route.street ? .38 : .12), d / 2 + .46];
      let enter = 0; let leave = 1;
      for (let axis = 0; axis < 3; axis++) {
        const delta = to[axis]! - from[axis]!;
        if (Math.abs(delta) < 1e-8) { if (from[axis]! <= low[axis]! || from[axis]! >= high[axis]!) { leave = -1; break; } }
        else { const t0 = (low[axis]! - from[axis]!) / delta; const t1 = (high[axis]! - from[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (enter <= leave) return true;
    }
    return false;
  };
  const cutFloor = (p: StaticPiece): StaticPiece[] => {
    if (!blocked(p)) return [p];
    const shape = p.kind.split("_")[1] as RuinShape;
    if (shape !== "floor8" && shape !== "floor16") return [];
    const side = RUIN_SHAPES[shape][0] / 2; const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    return [-side / 2, side / 2].flatMap((u) => [-side / 2, side / 2].flatMap((v) => cutFloor({ ...p, kind: p.kind.replace(shape, side === 8 ? "floor8" : "floor4"), x: p.x + u * c + v * s, z: p.z - u * s + v * c })));
  };
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!; const shape = p.kind.split("_")[1] as RuinShape;
    if (shape === "flight" || shape === "step" || shape === "landing" || shape.startsWith("ramp")) continue;
    if (i < infrastructure && shape.startsWith("floor")) continue;
    if (!blocked(p)) continue;
    removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1;
    if (shape === "floor8" || shape === "floor16") replacements.set(i, cutFloor(p));
  }
  const grouped = new Map<StaticPiece, number>();
  for (const group of assemblies) for (const p of group) grouped.set(p, -1);
  for (const [i, p] of pieces.entries()) if (grouped.has(p)) grouped.set(p, i);
  for (const group of assemblies) if (group.some((p) => (grouped.get(p) ?? -1) < 0 || removed[grouped.get(p)!])) for (const p of group) {
    const i = grouped.get(p)!; if (i >= 0 && !removed[i]) { removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1; }
  }
  const kept: StaticPiece[] = []; let recordIndex = 0;
  const append = (i: number): void => { if (!removed[i]) kept.push(pieces[i]!); else if (replacements.has(i)) kept.push(...replacements.get(i)!); };
  for (let i = 0; i < pieces.length;) {
    const record = records[recordIndex];
    if (record && i === record.firstPiece) {
      const end = i + record.blocks; record.firstPiece = kept.length;
      for (; i < end; i++) append(i);
      record.blocks = kept.length - record.firstPiece; recordIndex++;
    } else append(i++);
  }
  pieces.length = 0; for (const p of kept) pieces.push(p); return tally;
}

/** A removed foothold leaves a breach to walk through, not an imaginary step in the route record. */
export function reconcileRubble(pieces: readonly StaticPiece[], records: RuinRecord[]): number {
  const grid = new Map<number, StaticPiece[]>(); let changed = 0;
  for (const p of pieces) {
    const [w, , d] = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape]; const radius = Math.hypot(w, d) / 2;
    for (let z = Math.floor((p.z - radius - 1) / 64); z <= Math.floor((p.z + radius + 1) / 64); z++) for (let x = Math.floor((p.x - radius - 1) / 64); x <= Math.floor((p.x + radius + 1) / 64); x++) {
      const k = binKey(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(p);
    }
  }
  for (const r of records) for (const route of r.rooms) if (route.kind === "rubble") {
    const fits = route.points.every((point) => {
      let support = point.y === r.y; let blocked = false;
      for (const p of grid.get(binKey(Math.floor(point.x / 64), Math.floor(point.z / 64))) ?? []) {
        const [w, h, d] = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape];
        const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
        const dx = point.x - p.x; const dz = point.z - p.z;
        if (Math.abs(dx * c - dz * s) > w / 2 + .2 || Math.abs(dx * s + dz * c) > d / 2 + .2) continue;
        if (Math.abs(p.y + h / 2 - point.y) < .05) support = true;
        if (p.y + h / 2 > point.y + .2 && p.y - h / 2 < point.y + 2) blocked = true;
      }
      return support && !blocked;
    });
    if (!fits) { route.kind = "breach"; for (const p of route.points) p.y = r.y; changed++; }
  }
  return changed;
}
