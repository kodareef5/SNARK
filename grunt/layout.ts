// Layouts: how the Director (or anyone) says what to build without naming every piece. A layout is rooms on a grid of
// the game's foundation cells, with doors, windows, stairs and open sides; the compiler turns it into the ordered list
// of pieces the game's build helper checks and places (protocol.md, "Building"). Cells: i grows east, j south; a level
// is one storey. A side is n, e, s or w; "s1" is the south side's second cell from the west ("e0" the east side's
// first from the north). Pieces are named by form here; the tier's kit (the game's building capability) says which item places each.

import type { PieceForm, PlanPiece, Side } from "./protocol.ts";

/** A piece as a layout lays it out: its item is the tier's, chosen when the plan is made (a thing names its own). */
export type Laid = Omit<PlanPiece, "item"> & { item?: string };

/** Forms set in a frame, which take the frame's place on the edge or floor ("door" slots). */
const IN_FRAME = new Set(["door", "gate", "behemoth_gate", "trapdoor"]);
/** Forms that are a floor: a cell's floor at a storey (a ceiling is the floor above its storey). */
const FLOORS = new Set(["foundation", "ceiling", "hatchframe", "sloped_roof", "triangle_foundation", "triangle_ceiling"]);
/** The storey a floor form is the floor of. */
const floorLevel = (p: Laid) => (p.form === "foundation" || p.form === "triangle_foundation" ? p.level : p.level + 1);

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
  /** Its roof: ceilings (flat, the default), or sloped roof pieces where the game has them (else flat). */
  roof?: "flat" | "sloped";
  /** On a roofless top storey: railings in place of walls, on every side (true) or the edges named. */
  railings?: boolean | string[];
  /** Cells of its top ceiling with a hatch (a hatch frame and a trapdoor), for a ladder up. */
  hatches?: [number, number][];
}

/** A fence round an area of cells, on the ground, with no floor: gates on the edges named, as a room's doors. */
export interface Fence {
  at: [number, number];
  size: [number, number];
  gates?: string[];
  /** A gate for a survivor and most creatures ("dino", the default) or for the largest ("behemoth"). */
  gate_size?: "dino" | "behemoth";
  /** Edges left open. */
  open?: string[];
}

/** A thing set down on a floor: a box, a vault, a bed, a station. */
export interface Furnishing {
  item: string;
  cell: [number, number];
  level?: number;
  /** Where on the cell: against a side, or `c` its middle (the default). */
  spot?: Side | "c";
}

export interface Layout {
  name?: string;
  about?: string;
  /** The kit's tier to build in (the game says which it has; "wood" if absent). */
  tier?: string;
  rooms: Room[];
  /** Stairs in a cell, up from a storey to the one above; the ceiling over it is left open. A ramp or a ladder
   * where the game has them. */
  stairs?: { at: [number, number]; level?: number; up: Side; kind?: "stairs" | "ramp" | "ladder" }[];
  /** Fences round areas of ground, with gates. */
  fences?: Fence[];
  /** Things set down on the floors once the rooms stand. */
  furnish?: Furnishing[];
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

/** The forms a compiled layout uses. */
export function formsOf(c: Compiled): string[] {
  return [...new Set(c.pieces.map((p) => p.form))];
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
  if (!rooms.length && !layout.extra?.length && !layout.fences?.length) problems.push("a layout needs at least one room");
  const top = Math.max(0, ...rooms.map((r) => (r.level ?? 0) + (r.height ?? 1) - 1));
  // What fills each storey: its cells, and each edge's piece (the last word on an edge wins: a door over a wall).
  const cells = new Map<string, { i: number; j: number; level: number; roofless: boolean }>();
  const edges = new Map<string, Laid & { door?: boolean }>();
  const open = new Set<string>();
  const hatches = new Set<string>();
  /** Cells roofed with sloped pieces, and the way each rises (toward the ridge). */
  const sloped = new Map<string, Side>();
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
      // A roofless top storey with railings: railings where its walls would be (doors and windows stay).
      if (r.railings && r.roofless && h === (r.height ?? 1) - 1) {
        for (const ref of r.railings === true ? SIDES : r.railings) {
          const es = edgesOf(r, ref, level);
          if (typeof es === "string") {
            problems.push(`room ${n}: ${es}`);
            continue;
          }
          for (const e of es) {
            const k = edgeKey(e.cell[0], e.cell[1], level, e.side);
            if (edges.get(k)?.form === "wall") edges.set(k, { form: "railing", cell: e.cell, level, side: e.side });
          }
        }
      }
    }
    const topLevel = (r.level ?? 0) + (r.height ?? 1) - 1;
    for (const [i, j] of r.hatches ?? []) {
      if (i < r.at[0] || j < r.at[1] || i >= r.at[0] + w || j >= r.at[1] + d) problems.push(`room ${n}: a hatch at ${i},${j} is not over the room`);
      else hatches.add(`${i},${j},${topLevel}`);
    }
    if (r.roof === "sloped" && !r.roofless) {
      for (let j = r.at[1]; j < r.at[1] + d; j++) for (let i = r.at[0]; i < r.at[0] + w; i++) sloped.set(`${i},${j},${topLevel}`, j - r.at[1] < d / 2 ? "s" : "n");
    }
  }
  // An edge with a room on both sides of it at that storey and a plain wall: rooms that run into each other with no
  // wall written between them are one space only if a side says open; otherwise the wall stays.
  for (const k of open) edges.delete(k);
  // Fences: on the ground round their areas, where no room's wall already stands; gates where named.
  const fenced: (Laid & { gate?: string })[] = [];
  for (const [n, f] of (layout.fences ?? []).entries()) {
    const area: Room = { at: f.at, size: f.size };
    if (!(f.size?.[0] >= 1 && f.size?.[1] >= 1)) problems.push(`fence ${n} has no size`);
    const gates = new Map<string, true>(), gaps = new Set<string>();
    for (const [list, into] of [[f.gates ?? [], gates], [f.open ?? [], gaps]] as const) {
      for (const ref of list) {
        const es = edgesOf(area, ref, 0);
        if (typeof es === "string") {
          problems.push(`fence ${n}: ${es}`);
          continue;
        }
        for (const e of es) into instanceof Map ? into.set(edgeKey(e.cell[0], e.cell[1], 0, e.side), true) : into.add(edgeKey(e.cell[0], e.cell[1], 0, e.side));
      }
    }
    const big = f.gate_size === "behemoth";
    for (const side of SIDES) {
      for (const e of edgesOf(area, side, 0) as { cell: [number, number]; side: Side }[]) {
        const k = edgeKey(e.cell[0], e.cell[1], 0, e.side);
        if (edges.has(k) || gaps.has(k) || fenced.some((x) => edgeKey(x.cell[0], x.cell[1], 0, x.side!) === k)) continue;
        if (gates.has(k)) fenced.push({ form: big ? "behemoth_gateway" : "gateway", cell: e.cell, level: 0, side: e.side, gate: big ? "behemoth_gate" : "gate" });
        else fenced.push({ form: "fence", cell: e.cell, level: 0, side: e.side });
      }
    }
  }
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
    // Fences go up with the ground storey, their gates after their gateways.
    if (level === 0) {
      for (const f of fenced) pieces.push({ form: f.form, cell: f.cell, level: 0, side: f.side! });
      for (const f of fenced) if (f.gate) pieces.push({ form: f.gate, cell: f.cell, level: 0, side: f.side! });
    }
    for (const s of stairs.filter((s) => s.level === level)) pieces.push({ form: s.kind ?? "stairs", cell: s.at, level, up: s.up });
    // The ceiling over this storey: over every cell, but where stairs come up through it or the room is open to the sky;
    // a hatch frame (and its trapdoor) where a hatch is; sloped roof pieces on a sloped roof.
    for (const c of here) {
      const key = `${c.i},${c.j},${level}`;
      if (c.roofless || holes.has(key)) continue;
      if (hatches.has(key)) pieces.push({ form: "hatchframe", cell: [c.i, c.j], level }, { form: "trapdoor", cell: [c.i, c.j], level });
      else if (sloped.has(key)) pieces.push({ form: "sloped_roof", cell: [c.i, c.j], level, up: sloped.get(key)! });
      else pieces.push({ form: "ceiling", cell: [c.i, c.j], level });
    }
  }
  // Things on the floors, once every storey stands.
  for (const [n, t] of (layout.furnish ?? []).entries()) {
    const level = t.level ?? 0;
    if (!cells.has(`${t.cell[0]},${t.cell[1]},${level}`)) problems.push(`furnishing ${n} (${t.item}) at ${t.cell.join(",")} storey ${level} is not in a room`);
    else pieces.push({ form: "thing", item: t.item, cell: t.cell, level, spot: t.spot ?? "c" });
  }
  for (const p of layout.extra ?? []) pieces.push(p);
  // A piece written twice (a floor that is also the ceiling below): once.
  const seen = new Set<string>();
  const out = pieces.filter((p) => {
    const k = p.form === "thing" ? `thing,${p.item},${p.cell.join(",")},${p.level},${p.spot}`
      : p.side ? `${edgeKey(p.cell[0], p.cell[1], p.level, p.side)},${IN_FRAME.has(p.form) ? "door" : "edge"}`
      : FLOORS.has(p.form) ? `${p.cell.join(",")},${floorLevel(p)},floor${p.half ?? ""}`
      : `${p.cell.join(",")},${p.level},${IN_FRAME.has(p.form) ? "door" : p.form}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const ground = [...cells.values(), ...fenced.map((f) => ({ i: f.cell[0], j: f.cell[1] })), ...(layout.extra ?? []).map((x) => ({ i: x.cell[0], j: x.cell[1] }))];
  const bounds: Compiled["bounds"] = ground.length
    ? [Math.min(...ground.map((c) => c.i)), Math.min(...ground.map((c) => c.j)), Math.max(...ground.map((c) => c.i)), Math.max(...ground.map((c) => c.j))]
    : [0, 0, 0, 0];
  const counts: Compiled["counts"] = {};
  for (const p of out) counts[p.form] = (counts[p.form] ?? 0) + 1;
  return { pieces: out, bounds, counts, problems };
}
