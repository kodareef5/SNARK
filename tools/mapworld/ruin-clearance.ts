import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { CellLists, SLACK } from "./cell-lists.ts";
import { binKey } from "./raster.ts";
import type { RuinRecord } from "./ruins.ts";
import type { StaticPiece } from "./statics.ts";
import type { RoadEntrance } from "./bridge-earthwork.ts";
import { carry, knownOf } from "./known.ts";
import type { Passage } from "./passages.ts";
import { BESIDE, CLEAR, settleOpenings } from "./ruin-openings.ts";

interface Point { x: number; y: number; z: number; }
/** A line the clearance opens along: a street's, a passage's through a building, or a way of the record at `owner` to its door. */
interface Segment { a: Point; b: Point; street: boolean; passage: boolean; owner: number; way: number; }
/** What a passage leaves over it of a building's taller pieces: a storey, to the underside of its beams. */
const STOREY_CLEAR = 3.3;
/** More ways to its doors than any record has, to number a record's way in one number. */
const WAYS = 4096;

// Clearance is applied after all buildings, since a neighbouring facade can overhang an earlier route.
export function clearCirculation(pieces: StaticPiece[], records: RuinRecord[], infrastructure: number, assemblies: readonly StaticPiece[][] = [], decks: readonly { deck: readonly (Point & { gap: boolean })[]; entrances?: readonly RoadEntrance[] }[] = [], passages: readonly Passage[] = [], dropped: ReadonlySet<StaticPiece> = new Set()): Record<string, number> {
  const segments: Segment[] = [];
  const add = (a: Point, b: Point, street: boolean, passage = false, owner = -1, way = -1): void => { segments.push({ a, b, street, passage, owner, way }); };
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
  // A street through a building (passages.ts) is cleared as a runout is, across its whole width: the ground storey
  // opens along it, and what stays over it is settled below (ruin-openings.ts).
  for (const p of passages) for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1]!, b = p.points[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) continue;
    const tracks = Math.max(1, Math.ceil(p.width));
    for (let t = 0; t <= tracks; t++) {
      const side = -p.width / 2 + (p.width * t) / tracks;
      const dx = -(b.z - a.z) / length * side, dz = (b.x - a.x) / length * side;
      add({ x: a.x + dx, y: a.y, z: a.z + dz }, { x: b.x + dx, y: b.y, z: b.z + dz }, true, true);
    }
  }
  for (const [k, r] of records.entries()) {
    for (const [n, a] of r.approaches.entries()) {
      const end = { x: a.street.x + (a.door.x - a.street.x) * a.ramp, y: a.door.y, z: a.street.z + (a.door.z - a.street.z) * a.ramp };
      add(a.street, end, true, false, k, n); add(end, a.door, true, false, k, n); add(a.door, a.core, true);
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
  // The routes in 8 m cells by their boxes: a piece reads those whose box comes near its own.
  let west = Infinity, north = Infinity, east = -Infinity, south = -Infinity;
  for (const { a, b } of segments) { west = Math.min(west, a.x, b.x); east = Math.max(east, a.x, b.x); north = Math.min(north, a.z, b.z); south = Math.max(south, a.z, b.z); }
  const cells = new CellLists(segments.length ? east - west + 2 : 0, segments.length ? south - north + 2 : 0, 8, west - 1, north - 1);
  const boxOf = ({ a, b }: Segment): [number, number, number, number] => [Math.min(a.x, b.x) - SLACK, Math.min(a.z, b.z) - SLACK, Math.max(a.x, b.x) + SLACK, Math.max(a.z, b.z) + SLACK];
  for (const g of segments) cells.countBox(...boxOf(g));
  cells.lay();
  segments.forEach((g, i) => cells.putBox(...boxOf(g), i));
  const removed = new Uint8Array(pieces.length); const tally: Record<string, number> = {};
  const replacements = new Map<number, StaticPiece[]>();
  // What crossed the piece last asked of: a passage, and another record's way to its door (its place in `records`).
  let passed = false, neighbour = -1;
  // The ways to a door that a neighbour's standing piece was found in, each as its record's place and its own among them.
  const inWay = new Set<number>();
  /**
   * Whether a way crosses `p`, a piece of the record at `of` (-1, no record's). With `only` 1, a passage; with 2, nothing is
   * cleared: each other record's way to its door that crosses it is noted in `inWay`.
   */
  const blocked = (p: StaticPiece, of = -1, only = 0): boolean => {
    const shape = p.kind.split("_")[1] as RuinShape; const [w, h, d] = RUIN_SHAPES[shape];
    const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    // The box widened .46 m a side lies within half its two sides and .92 m of its middle: a line past that misses it.
    const far = (w + d) / 2 + 2 * BESIDE + SLACK;
    passed = false; neighbour = -1;
    return cells.some(p.x, p.z, far, (k) => {
      const route = segments[k]!;
      if ((only === 1 && !route.passage) || (only === 2 && (route.owner < 0 || route.owner === of))) return false;
      if ((route.a.x < p.x - far && route.b.x < p.x - far) || (route.a.x > p.x + far && route.b.x > p.x + far) || (route.a.z < p.z - far && route.b.z < p.z - far) || (route.a.z > p.z + far && route.b.z > p.z + far)) return false;
      if (!route.street && route.a.y === route.b.y && shape.startsWith("floor") && Math.abs(p.y + h / 2 - route.a.y) < .12) return false;
      const point = (q: Point): number[] => { const dx = q.x - p.x; const dz = q.z - p.z; return [dx * c - dz * s, q.y - p.y, dx * s + dz * c]; };
      // A passage clears a building's taller pieces a storey high; its slabs and beams over that stay, the deck over the street.
      const clear = route.passage && of >= 0 && h > 1 ? STOREY_CLEAR : CLEAR;
      const from = point(route.a); const to = point(route.b); const low = [-w / 2 - BESIDE, -h / 2 - clear, -d / 2 - BESIDE]; const high = [w / 2 + BESIDE, h / 2 - (route.street ? .38 : .12), d / 2 + BESIDE];
      let enter = 0; let leave = 1;
      for (let axis = 0; axis < 3; axis++) {
        const delta = to[axis]! - from[axis]!;
        if (Math.abs(delta) < 1e-8) { if (from[axis]! <= low[axis]! || from[axis]! >= high[axis]!) { leave = -1; break; } }
        else { const t0 = (low[axis]! - from[axis]!) / delta; const t1 = (high[axis]! - from[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (!(enter <= leave)) return false;
      if (only === 2) { inWay.add(route.owner * WAYS + route.way); return false; }
      // A passage is noted and the look goes on: another way may cross the piece too.
      if (route.passage) { passed = true; return false; }
      if (route.owner >= 0 && route.owner !== of) neighbour = route.owner;
      return true;
    }) || passed;
  };
  const cutFloor = (p: StaticPiece): StaticPiece[] => {
    if (!blocked(p)) return [p];
    const shape = p.kind.split("_")[1] as RuinShape;
    if (shape !== "floor8" && shape !== "floor16") return [];
    const side = RUIN_SHAPES[shape][0] / 2; const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    return [-side / 2, side / 2].flatMap((u) => [-side / 2, side / 2].flatMap((v) => cutFloor(carry({ ...p, kind: p.kind.replace(shape, side === 8 ? "floor8" : "floor4"), x: p.x + u * c + v * s, z: p.z - u * s + v * c }, p))));
  };
  // A way to a door that a neighbour's wall, fin or pier stands in is given up before anything is cleared for it:
  // cleared, it would cut that building open. What was laid for it goes with it.
  const standing = (p: StaticPiece, shape: RuinShape, of: number): boolean => /^(wall|fin|pier|zpanel|zshaft)/.test(shape) && p.y - RUIN_SHAPES[shape][1] / 2 <= records[of]!.y + 1.2;
  for (let i = 0, at = 0; i < pieces.length; i++) {
    while (at < records.length && i >= records[at]!.firstPiece + records[at]!.blocks) at++;
    if (at >= records.length) break;
    if (i < records[at]!.firstPiece) continue;
    const p = pieces[i]!; const shape = p.kind.split("_")[1] as RuinShape;
    if (standing(p, shape, at)) blocked(p, at, 2);
  }
  if (inWay.size > 0) {
    const laid = new Set<StaticPiece>(dropped), given = new Map<number, Set<number>>();
    for (const key of inWay) { const k = Math.floor(key / WAYS); if (!given.has(k)) given.set(k, new Set()); given.get(k)!.add(key % WAYS); }
    for (const [k, ways] of given) {
      const r = records[k]!;
      for (const n of ways) {
        const a = r.approaches[n]!, ex = a.door.x - a.street.x, ez = a.door.z - a.street.z, l2 = ex * ex + ez * ez || 1;
        // Its ramp and slabs: the record's pieces no tile placed, along its line.
        for (let i = r.firstPiece; i < r.firstPiece + r.blocks; i++) {
          const p = pieces[i]!; const shape = p.kind.split("_")[1]!;
          if (knownOf(p) !== null || !(shape.startsWith("ramp") || shape === "floor4")) continue;
          const t = ((p.x - a.street.x) * ex + (p.z - a.street.z) * ez) / l2;
          if (t >= 0 && t <= 1 && Math.hypot(p.x - a.street.x - ex * t, p.z - a.street.z - ez * t) <= 1.2) laid.add(p);
        }
      }
      r.approaches = r.approaches.filter((_, n) => !ways.has(n));
    }
    console.log(`ruins: ${inWay.size} ways to a door given up, of ${given.size} buildings: a neighbour's wall, fin or pier stood in each`);
    return clearCirculation(pieces, records, infrastructure, assemblies, decks, passages, laid);
  }
  // Which pieces a passage took, and how many walls, fins and piers another building's way to its door took.
  const byPassage = new Uint8Array(pieces.length);
  let sliced = 0, at = 0; const slicedOf = new Set<number>();
  for (let i = 0; i < pieces.length; i++) {
    while (at < records.length && i >= records[at]!.firstPiece + records[at]!.blocks) at++;
    const of = at < records.length && i >= records[at]!.firstPiece ? at : -1;
    const p = pieces[i]!; const shape = p.kind.split("_")[1] as RuinShape;
    if (dropped.has(p)) { removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1; continue; }
    // A stair stands in every way but a street through its own building; a ramp to a door stands in that too.
    const stair = shape === "flight" || shape === "step" || shape === "landing";
    if (shape.startsWith("ramp") || (stair && of < 0)) continue;
    if (i < infrastructure && shape.startsWith("floor")) continue;
    if (!blocked(p, of, stair ? 1 : 0)) continue;
    removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1;
    if (passed) byPassage[i] = 1;
    else if (neighbour >= 0 && of >= 0 && standing(p, shape, of)) { sliced++; slicedOf.add(of); }
    if (shape === "floor8" || shape === "floor16") replacements.set(i, cutFloor(p));
  }
  const grouped = new Map<StaticPiece, number>();
  for (const group of assemblies) for (const p of group) grouped.set(p, -1);
  for (const [i, p] of pieces.entries()) if (grouped.has(p)) grouped.set(p, i);
  // An assembly goes whole with any of its parts.
  const whole = (): void => {
    for (const group of assemblies) if (group.some((p) => (grouped.get(p) ?? -1) < 0 || removed[grouped.get(p)!])) for (const p of group) {
      const i = grouped.get(p)!; if (i >= 0 && !removed[i]) { removed[i] = 1; tally[p.kind] = (tally[p.kind] ?? 0) + 1; }
    }
  };
  whole();
  // What each street through a building leaves standing over it, and beside it.
  const opened = settleOpenings(pieces, records, removed, byPassage, replacements, passages, (p) => !blocked(p, 0), (kind) => { tally[kind] = (tally[kind] ?? 0) + 1; });
  const o = opened.tally;
  if (o.buildings > 0) {
    whole();
    console.log(`ruins: ${o.buildings} buildings opened along a street: ${o.piers} piers stood, ${o.portals * 4} m of street carried under storeys; ${o.cut} pieces over an open street and ${o.unheld} left with no wall or pier taken away; ${o.emptied} buildings emptied; ${o.stairs} stairs and ${o.rooms} rooms gone with their floors`);
  }
  if (sliced > 0) console.log(`ruins: ${sliced} walls, fins and piers of ${slicedOf.size} buildings taken by a neighbour's way to its door`);
  const kept: StaticPiece[] = []; let recordIndex = 0;
  const append = (i: number): void => { if (!removed[i]) kept.push(pieces[i]!); else if (replacements.has(i)) kept.push(...replacements.get(i)!); };
  for (let i = 0; i < pieces.length;) {
    const record = records[recordIndex];
    if (record && i === record.firstPiece) {
      const end = i + record.blocks; record.firstPiece = kept.length;
      for (; i < end; i++) append(i);
      for (const p of opened.piers.get(recordIndex) ?? []) kept.push(p);
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
