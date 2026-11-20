// Layouts: how the Director (or anyone) says what to build without naming every piece. A layout is rooms on a grid of
// the game's foundation cells, with doors, windows, stairs and open sides; the compiler turns it into the ordered list
// of pieces the game's build helper checks and places (protocol.md, "Building"). Cells: i grows east, j south; a level
// is one storey. A side is n, e, s or w; "s1" is the south side's second cell from the west ("e0" the east side's
// first from the north). Pieces are named by form here; the tier's kit (the game's building capability) says which item places each.

import type { PieceForm, PlanPiece, Side } from "./protocol.ts";

/** A piece as a layout lays it out: its item is the tier's, chosen when the plan is made. */
export type Laid = Omit<PlanPiece, "item">;

export interface Room {
  /** The north-west cell. */
  at: [number, number];
  /** Cells east, cells south. */
  size: [number, number];
  /** The storey it stands on (0, the ground). */
  level?: number;
  /** Storeys tall (1). */
  height?: number;
  /** Edges with a doorway and a door: "s1". A door on a wall two rooms share joins them. */
  doors?: string[];
  /** Edges with a doorway and no door. */
  arches?: string[];
  windows?: string[];
  /** Edges left without a wall: "n" (the whole side) or "n2". */
  open?: string[];
  /** No ceiling over it (default: a ceiling, which is the floor of the storey above). */
  roofless?: boolean;
}

export interface Layout {
  name?: string;
  about?: string;
  /** The kit's tier to build in (the game says which it has; "wood" if absent). */
  tier?: string;
  rooms: Room[];
  /** Stairs in a cell, up from a storey to the one above; the ceiling over it is left open. */
  stairs?: { at: [number, number]; level?: number; up: Side }[];
  /** Pillars at cell corners (the north-west corner of the cell named), holding up ceilings away from walls. */
  pillars?: { at: [number, number]; level?: number }[];
  /** Pieces placed as they are, after everything else. */
  extra?: Laid[];
}

export interface Compiled {
  pieces: Laid[];
  /** Cells the footprint covers on the ground: i0, j0, i1, j1 (inclusive). */
  bounds: [number, number, number, number];
  /** Pieces of each form. */
  counts: Partial<Record<PieceForm, number>>;
  /** What the layout says that cannot be: an edge off its room, a door on an open side. */
  problems: string[];
}

const SIDES: Side[] = ["n", "e", "s", "w"];

/** An edge as one key whichever cell it is named from: the north or west side of a cell. */
export function edgeKey(i: number, j: number, level: number, side: Side): string {
  if (side === "e") return `${i + 1},${j},${level},w`;
  if (side === "s") return `${i},${j + 1},${level},n`;
  return `${i},${j},${level},${side}`;
}

/** The cell and side an edge reference names on a room ("s1"), or the whole side ("s"). */
function edgesOf(room: Room, ref: string, level: number): { cell: [number, number]; side: Side }[] | string {
  const m = /^([nesw])(\d+)?$/.exec(ref.trim());
  if (!m) return `"${ref}" is not a side: n, e, s or w, with the cell along it (s0, s1, ...)`;
  const side = m[1] as Side;
  const [i0, j0] = room.at, [w, d] = room.size;
  const along = side === "n" || side === "s" ? w : d;
  const at = (k: number): [number, number] => (side === "n" ? [i0 + k, j0] : side === "s" ? [i0 + k, j0 + d - 1] : side === "w" ? [i0, j0 + k] : [i0 + w - 1, j0 + k]);
  void level;
  if (m[2] === undefined) return Array.from({ length: along }, (_, k) => ({ cell: at(k), side }));
  const k = Number(m[2]);
  if (k >= along) return `"${ref}" is past the end of the room's ${side} side (${along} cells: ${side}0 to ${side}${along - 1})`;
  return [{ cell: at(k), side }];
}

/** Turns a layout into pieces, in an order each can be held up by those before it: storey by storey, floors, then
 * pillars, walls and doorways, doors, stairs, and the ceilings over it. */
export function compile(layout: Layout): Compiled {
  const problems: string[] = [];
  const rooms = layout.rooms ?? [];
  if (!rooms.length) problems.push("a layout needs at least one room");
  const top = Math.max(0, ...rooms.map((r) => (r.level ?? 0) + (r.height ?? 1) - 1));
  // What fills each storey: its cells, and each edge's piece (the last word on an edge wins: a door over a wall).
  const cells = new Map<string, { i: number; j: number; level: number; roofless: boolean }>();
  const edges = new Map<string, Laid & { door?: boolean }>();
  const open = new Set<string>();
  for (const [n, r] of rooms.entries()) {
    const [w, d] = r.size ?? [0, 0];
    if (!(w >= 1 && d >= 1)) problems.push(`room ${n} has no size`);
    for (let h = 0; h < (r.height ?? 1); h++) {
      const level = (r.level ?? 0) + h;
      for (let j = r.at[1]; j < r.at[1] + d; j++) for (let i = r.at[0]; i < r.at[0] + w; i++) {
        const key = `${i},${j},${level}`;
        const roofless = !!r.roofless && h === (r.height ?? 1) - 1;
        cells.set(key, { i, j, level, roofless: (cells.get(key)?.roofless ?? true) && roofless });
      }
      // Walls round the room; a side two rooms share gets one wall.
      for (const side of SIDES) {
        const all = edgesOf(r, side, level) as { cell: [number, number]; side: Side }[];
        for (const e of all) {
          const k = edgeKey(e.cell[0], e.cell[1], level, e.side);
          if (!edges.has(k)) edges.set(k, { form: "wall", cell: e.cell, level, side: e.side });
        }
      }
      const mark = (refs: string[] | undefined, form: PieceForm, door = false) => {
        for (const ref of refs ?? []) {
          // Doors, arches and windows are on the ground storey of a tall room unless written "1:s1" (storey 1).
          const m = /^(\d+):(.*)$/.exec(ref);
          if (m && Number(m[1]) !== h) continue;
          if (!m && h !== 0) continue;
          const es = edgesOf(r, m ? m[2]! : ref, level);
          if (typeof es === "string") {
            problems.push(`room ${n}: ${es}`);
            continue;
          }
          for (const e of es) {
            const k = edgeKey(e.cell[0], e.cell[1], level, e.side);
            if (form === "wall") open.add(k);
            else edges.set(k, { form, cell: e.cell, level, side: e.side, ...(door ? { door: true } : {}) });
          }
        }
      };
      mark(r.open, "wall");
      mark(r.doors, "doorframe", true);
      mark(r.arches, "doorframe");
      mark(r.windows, "windowframe");
    }
  }
  // An edge with a room on both sides of it at that storey and a plain wall: rooms that run into each other with no
  // wall written between them are one space only if a side says open; otherwise the wall stays.
  for (const k of open) edges.delete(k);
  const stairs = (layout.stairs ?? []).map((s) => ({ ...s, level: s.level ?? 0 }));
  const holes = new Set(stairs.map((s) => `${s.at[0]},${s.at[1]},${s.level}`));
  for (const s of stairs) {
    if (!cells.has(`${s.at[0]},${s.at[1]},${s.level}`)) problems.push(`stairs at ${s.at.join(",")} storey ${s.level} are not in a room`);
    if (!cells.has(`${s.at[0]},${s.at[1]},${s.level + 1}`)) problems.push(`stairs at ${s.at.join(",")} storey ${s.level} lead up to no room`);
  }
  const pieces: Laid[] = [];
  const byLevel = (level: number) => [...cells.values()].filter((c) => c.level === level).sort((a, b) => a.j - b.j || a.i - b.i);
  for (let level = 0; level <= top; level++) {
    const here = byLevel(level);
    // The floor: foundations on the ground; above, the ceilings below are the floor, and cells over nothing need one.
    for (const c of here) {
      if (level === 0) pieces.push({ form: "foundation", cell: [c.i, c.j], level: 0 });
      else if (!cells.has(`${c.i},${c.j},${level - 1}`) || cells.get(`${c.i},${c.j},${level - 1}`)!.roofless) {
        if (!holes.has(`${c.i},${c.j},${level - 1}`)) pieces.push({ form: "ceiling", cell: [c.i, c.j], level: level - 1 });
      }
    }
    for (const p of (layout.pillars ?? []).filter((p) => (p.level ?? 0) === level)) pieces.push({ form: "pillar", cell: p.at, level });
    const onEdges = [...edges.values()].filter((e) => e.level === level).sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
    for (const e of onEdges) pieces.push({ form: e.form, cell: e.cell, level, side: e.side! });
    for (const e of onEdges) if (e.door) pieces.push({ form: "door", cell: e.cell, level, side: e.side! });
    for (const s of stairs.filter((s) => s.level === level)) pieces.push({ form: "stairs", cell: s.at, level, up: s.up });
    // The ceiling over this storey: over every cell, but where stairs come up through it or the room is open to the sky.
    for (const c of here) if (!c.roofless && !holes.has(`${c.i},${c.j},${level}`)) pieces.push({ form: "ceiling", cell: [c.i, c.j], level });
  }
  for (const p of layout.extra ?? []) pieces.push(p);
  // A piece written twice (a floor that is also the ceiling below): once.
  const seen = new Set<string>();
  const out = pieces.filter((p) => {
    const k = p.side ? `${edgeKey(p.cell[0], p.cell[1], p.level, p.side)},${p.form === "door" ? "door" : "edge"}` : `${p.cell.join(",")},${p.form === "ceiling" ? p.level + 1 : p.level},${p.form === "ceiling" || p.form === "foundation" ? "floor" : p.form}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const ground = [...cells.values()];
  const bounds: Compiled["bounds"] = ground.length
    ? [Math.min(...ground.map((c) => c.i)), Math.min(...ground.map((c) => c.j)), Math.max(...ground.map((c) => c.i)), Math.max(...ground.map((c) => c.j))]
    : [0, 0, 0, 0];
  const counts: Compiled["counts"] = {};
  for (const p of out) counts[p.form] = (counts[p.form] ?? 0) + 1;
  return { pieces: out, bounds, counts, problems };
}
