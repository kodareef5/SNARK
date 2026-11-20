// The mock world's buildings: pieces on bases (a grid of 3 m cells, storeys of 3 m, turned in quarter turns), the
// pieces each tier has as SNARK's content does (content/building.ts: one wall item places wall, doorframe and
// windowframe; thatch lacks windowframes, pillars and stairs), what holds what up, and the build helper's checks
// (grunt/protocol.md, "Building"). SNARK's own rules differ in detail (sockets, support by distance); the mock keeps
// their shape.

import type { Building, PieceForm, PieceVerdict, Plan, PlanPiece, Side } from "../../grunt/protocol.ts";
import { CLIFF, DEEP, type Terrain } from "./terrain.ts";

export const CELL = 3, STOREY = 3;
/** How far the helper places from the character, and how fast: more than a player's reach and pace, but not without
 * limit (a player's reach in SNARK is 12 m; a careful player places a piece every two or three seconds). */
export const BUILD_REACH = 24, BUILD_RATE = 2, MAX_PLAN = 80;

const FORMS: Record<string, PieceForm[]> = {
  thatch: ["foundation", "wall", "doorframe", "ceiling", "door"],
  wood: ["foundation", "wall", "doorframe", "windowframe", "ceiling", "door", "pillar", "stairs"],
  stone: ["foundation", "wall", "doorframe", "windowframe", "ceiling", "door", "pillar", "stairs"],
};
/** The item that places a form: the wall's places the frames too. */
const itemOf = (form: PieceForm, tier: string) => `piece_${form === "doorframe" || form === "windowframe" ? "wall" : form}_${tier}`;
export const KIT: Building["tiers"] = Object.fromEntries(Object.entries(FORMS).map(([tier, forms]) => [tier, Object.fromEntries(forms.map((f) => [f, itemOf(f, tier)]))]));
export const PIECE_ITEMS = [...new Set(Object.values(KIT).flatMap((k) => Object.values(k) as string[]))];

/** SNARK's recipes for the pieces (content/building.ts, MAKING), five seconds each. */
export const PIECE_RECIPES: Record<string, { needs: Record<string, number>; seconds: number }> = {
  piece_foundation_thatch: { needs: { thatch: 20, wood: 6, fiber: 15 }, seconds: 5 },
  piece_wall_thatch: { needs: { thatch: 10, wood: 2, fiber: 7 }, seconds: 5 },
  piece_ceiling_thatch: { needs: { thatch: 15, wood: 4, fiber: 10 }, seconds: 5 },
  piece_door_thatch: { needs: { thatch: 7, wood: 2, fiber: 4 }, seconds: 5 },
  piece_foundation_wood: { needs: { wood: 80, thatch: 20, fiber: 15 }, seconds: 5 },
  piece_wall_wood: { needs: { wood: 40, thatch: 10, fiber: 7 }, seconds: 5 },
  piece_ceiling_wood: { needs: { wood: 60, thatch: 15, fiber: 10 }, seconds: 5 },
  piece_door_wood: { needs: { wood: 20, thatch: 7, fiber: 4 }, seconds: 5 },
  piece_pillar_wood: { needs: { wood: 40, thatch: 10, fiber: 7 }, seconds: 5 },
  piece_stairs_wood: { needs: { wood: 60, thatch: 15, fiber: 10 }, seconds: 5 },
  piece_foundation_stone: { needs: { stone: 80, wood: 40, thatch: 30 }, seconds: 5 },
  piece_wall_stone: { needs: { stone: 40, wood: 20, thatch: 15 }, seconds: 5 },
  piece_ceiling_stone: { needs: { stone: 60, wood: 30, thatch: 20 }, seconds: 5 },
  piece_door_stone: { needs: { stone: 20, wood: 10, thatch: 7 }, seconds: 5 },
  piece_pillar_stone: { needs: { stone: 40, wood: 20, thatch: 15 }, seconds: 5 },
  piece_stairs_stone: { needs: { stone: 60, wood: 30, thatch: 20 }, seconds: 5 },
};

export const BUILDING: Building = { cell: CELL, storey: STOREY, reach: BUILD_REACH, rate: BUILD_RATE, max_pieces: MAX_PLAN, tiers: KIT };

/** Where a piece is: which base, and where on its grid. */
export interface PieceAt {
  form: PieceForm;
  tier: string;
  base: string;
  cell: [number, number];
  level: number;
  side?: Side;
  up?: Side;
  /** In the world: the slab's direction (0 along x, π/2 along z) and its height. */
  yaw: number;
  y: number;
  open?: boolean;
}

export interface Base {
  id: string;
  x: number;
  z: number;
  turns: number;
}

/** A base a plan is laid on, and where the plan's cell 0, 0 is on the base's grid. */
export type Laid = Base & { off: [number, number] };
const shift = <T extends { cell: [number, number] }>(p: T, off: [number, number]): T => ({ ...p, cell: [p.cell[0] + off[0], p.cell[1] + off[1]] });

/** What the checks need of the world. */
export interface Site {
  terrain: Terrain | null;
  bounds: [number, number, number, number] | null;
  /** Things in the world: their place, size, whether they block, a body (the character, creatures, players). */
  things(): Iterable<{ id: string; x: number; z: number; r: number; blocks: boolean; kind: string; piece?: PieceAt }>;
  me: { id: string; x: number; y: number; z: number };
}

const SIDES: Side[] = ["n", "e", "s", "w"];
const OUT: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const turn = (s: Side, turns: number): Side => SIDES[(SIDES.indexOf(s) + turns) % 4]!;
/** A vector on a base's grid, in the world: each quarter turn clockwise seen from above (x east, z south). */
const rot = (dx: number, dz: number, turns: number): [number, number] => {
  for (let t = 0; t < turns; t++) [dx, dz] = [-dz, dx];
  return [dx, dz];
};

/** The slots a piece takes on its base, one key each: a floor at a height (a ceiling is the floor above it), an edge
 * at a storey, a door in an edge, a pillar at a corner, stairs in a cell. */
export function slot(p: { form: PieceForm; cell: [number, number]; level: number; side?: Side }): string {
  const [i, j] = p.cell;
  if (p.form === "foundation") return `f${i},${j},0`;
  if (p.form === "ceiling") return `f${i},${j},${p.level + 1}`;
  if (p.form === "pillar") return `p${i},${j},${p.level}`;
  if (p.form === "stairs") return `c${i},${j},${p.level}`;
  const side = p.side ?? "n";
  const [ei, ej, es] = side === "e" ? [i + 1, j, "w"] : side === "s" ? [i, j + 1, "n"] : [i, j, side];
  return `${p.form === "door" ? "d" : "e"}${ei},${ej},${p.level},${es}`;
}

const WALLISH = new Set<PieceForm>(["wall", "doorframe", "windowframe"]);

export class Structures {
  readonly bases = new Map<string, Base>();
  private n = 0;

  /** The tier an item places a form in, or null if no tier's does. */
  tierOf(form: PieceForm, item: string): string | null {
    for (const [tier, kit] of Object.entries(KIT)) if (kit[form] === item) return tier;
    return null;
  }

  /** Where a piece of a plan goes in the world: its centre, height and, for a slab, its direction. */
  place(base: Base, p: { form: PieceForm; cell: [number, number]; level: number; side?: Side }): { x: number; z: number; y: number; yaw: number } {
    let dx = p.cell[0] * CELL, dz = p.cell[1] * CELL;
    if (p.side) (dx += (OUT[p.side][0] * CELL) / 2), (dz += (OUT[p.side][1] * CELL) / 2);
    if (p.form === "pillar") (dx -= CELL / 2), (dz -= CELL / 2);
    const [wx, wz] = rot(dx, dz, base.turns);
    const y = (p.form === "ceiling" ? p.level + 1 : p.level) * STOREY;
    const world = p.side ? turn(p.side, base.turns) : "n";
    return { x: base.x + wx, z: base.z + wz, y, yaw: p.side && (world === "e" || world === "w") ? Math.PI / 2 : 0 };
  }

  /** The base a plan goes on: the one named; or, laid at a point, a base of the same turn whose grid the point is on
   * and which stands near (new pieces snap to a base already there, as a player's do); or a new one. */
  baseOf(plan: Plan, things: Iterable<{ x: number; z: number; piece?: PieceAt }> = []): Laid | null {
    if ("base" in plan.anchor) {
      const b = this.bases.get(plan.anchor.base);
      return b ? { ...b, off: [0, 0] } : null;
    }
    const [x, z] = plan.anchor.at, turns = (((plan.anchor.turns ?? 0) % 4) + 4) % 4;
    const near = new Set<string>();
    for (const t of things) if (t.piece && Math.hypot(t.x - x, t.z - z) < 40) near.add(t.piece.base);
    for (const id of near) {
      const b = this.bases.get(id)!;
      if (b.turns !== turns) continue;
      // The point on the base's grid: back through the base's turns, in cells.
      let [dx, dz] = [x - b.x, z - b.z];
      for (let t = 0; t < (4 - turns) % 4; t++) [dx, dz] = [-dz, dx];
      const [ci, cj] = [dx / CELL, dz / CELL];
      if (Math.abs(ci - Math.round(ci)) < 0.1 && Math.abs(cj - Math.round(cj)) < 0.1) return { ...b, off: [Math.round(ci), Math.round(cj)] };
    }
    return { id: "", x, z, turns, off: [0, 0] };
  }

  newBase(b: Base): Base {
    const id = `b:${++this.n}`;
    const base = { ...b, id };
    this.bases.set(id, base);
    return base;
  }

  /** Checks a plan's pieces in order, each as though those before it that can go had gone. `live`: the character's
   * reach counts (building now, not planning). */
  check(site: Site, plan: Plan, live: boolean): { verdicts: { status: PieceVerdict; by?: string }[]; base: Laid | null } {
    const things = [...site.things()];
    const base = this.baseOf(plan, things);
    if (!base) return { verdicts: plan.pieces.map(() => ({ status: "blocked" as const, by: "no such base" })), base: null };
    const slots = new Map<string, { form: PieceForm; tier: string }>();
    for (const t of things) if (t.piece && t.piece.base === base.id) slots.set(slot(t.piece), { form: t.piece.form, tier: t.piece.tier });
    const verdicts = plan.pieces.map((q) => {
      const p = shift(q, base.off);
      const v = this.one(site, things, base, slots, p, live);
      // In the character's own way is for now only (it steps aside to build): what follows may stand on it.
      if (v.status === "ok" || (v.status === "blocked" && v.by === site.me.id)) slots.set(slot(p), { form: p.form, tier: this.tierOf(p.form, p.item)! });
      return v;
    });
    return { verdicts, base };
  }

  private one(site: Site, things: ReturnType<Site["things"]> extends Iterable<infer T> ? T[] : never, base: Base, slots: Map<string, { form: PieceForm; tier: string }>, p: PlanPiece, live: boolean): { status: PieceVerdict; by?: string } {
    const tier = this.tierOf(p.form, p.item);
    if (!tier) return { status: "not_in_tier", by: `${p.item} does not place a ${p.form}` };
    const taken = slots.get(slot(p));
    if (taken) return taken.form === p.form && taken.tier === tier ? { status: "built" } : { status: "occupied", by: `${taken.form} (${taken.tier})` };
    const at = this.place(base, p);
    if (live && Math.hypot(at.x - site.me.x, at.z - site.me.z, at.y - site.me.y) > BUILD_REACH) return { status: "too_far" };
    const [i, j] = p.cell, L = p.level;
    const floor = (ci: number, cj: number, h: number) => slots.has(`f${ci},${cj},${h}`);
    const wallish = (ci: number, cj: number, level: number, side: Side) => {
      const s = slots.get(slot({ form: "wall", cell: [ci, cj], level, side }));
      return !!s && WALLISH.has(s.form);
    };
    const ground = (x: number, z: number) => {
      if (site.bounds && (x < site.bounds[0] || z < site.bounds[1] || x > site.bounds[2] || z > site.bounds[3])) return false;
      const k = site.terrain?.at(x, z) ?? 0;
      return k !== CLIFF && k !== DEEP;
    };
    switch (p.form) {
      case "foundation": {
        for (const [ox, oz] of [[0, 0], [-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]] as const) {
          if (!ground(at.x + ox, at.z + oz)) return { status: "terrain" };
        }
        for (const t of things) {
          if (t.piece?.form === "foundation" && Math.hypot(t.x - at.x, t.z - at.z) < CELL * 0.9) return { status: "occupied", by: t.id };
          if (t.piece) continue;
          const body = t.kind === "creature" || t.kind === "player" || t.kind === "vehicle";
          if (!t.blocks && !body) continue;
          if (Math.abs(t.x - at.x) < CELL / 2 + t.r && Math.abs(t.z - at.z) < CELL / 2 + t.r) return { status: "blocked", by: t.id };
        }
        if (Math.abs(site.me.x - at.x) < CELL / 2 + 0.4 && Math.abs(site.me.z - at.z) < CELL / 2 + 0.4 && site.me.y < 1) return { status: "blocked", by: site.me.id };
        return { status: "ok" };
      }
      case "wall":
      case "doorframe":
      case "windowframe": {
        const side = p.side ?? "n";
        const [oi, oj] = [i + OUT[side][0], j + OUT[side][1]];
        if (!(floor(i, j, L) || floor(oi, oj, L) || (L > 0 && wallish(i, j, L - 1, side)))) return { status: "no_support" };
        // The character in the slab's way.
        const along = at.yaw === 0 ? Math.abs(site.me.x - at.x) : Math.abs(site.me.z - at.z);
        const across = at.yaw === 0 ? Math.abs(site.me.z - at.z) : Math.abs(site.me.x - at.x);
        if (along < CELL / 2 + 0.4 && across < 0.5 && Math.abs(site.me.y - at.y) < 2) return { status: "blocked", by: site.me.id };
        return { status: "ok" };
      }
      case "door": {
        const s = slots.get(slot({ form: "wall", cell: p.cell, level: L, side: p.side ?? "n" }));
        return s?.form === "doorframe" ? { status: "ok" } : { status: "no_support", by: "no doorframe there" };
      }
      case "pillar": {
        const around: [number, number][] = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]];
        if ((L === 0 && ground(at.x, at.z)) || around.some(([ci, cj]) => floor(ci, cj, L)) || slots.has(`p${i},${j},${L - 1}`)) return { status: "ok" };
        return { status: "no_support" };
      }
      case "stairs": {
        if (!floor(i, j, L)) return { status: "no_support" };
        if (floor(i, j, L + 1)) return { status: "occupied", by: "the ceiling over it" };
        return { status: "ok" };
      }
      case "ceiling": {
        // Held up by a wall on one of its edges or a pillar at a corner, or by ceilings beside it that are, within two
        // cells (SNARK lets a ceiling reach 6.5 m from what stands straight up).
        const held = (ci: number, cj: number) =>
          SIDES.some((s) => wallish(ci, cj, L, s)) || [[ci, cj], [ci + 1, cj], [ci, cj + 1], [ci + 1, cj + 1]].some(([pi, pj]) => slots.has(`p${pi},${pj},${L}`));
        if (held(i, j)) return { status: "ok" };
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
          if (Math.abs(di) + Math.abs(dj) > 2 || (!di && !dj)) continue;
          if (floor(i + di, j + dj, L + 1) && held(i + di, j + dj)) {
            // Joined to it through ceilings.
            if (Math.abs(di) + Math.abs(dj) === 1 || floor(i + Math.sign(di), j, L + 1) || floor(i, j + Math.sign(dj), L + 1)) return { status: "ok" };
          }
        }
        return { status: "no_support" };
      }
    }
    return { status: "blocked" };
  }
}
