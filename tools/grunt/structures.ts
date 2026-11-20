// The mock world's buildings: pieces on bases (a grid of 3 m cells, storeys of 3 m, turned in quarter turns), the
// pieces each tier has (SNARK's content/building.ts for what SNARK has: one wall item places wall, doorframe and
// windowframe; thatch lacks windowframes, pillars and stairs), what holds what up, and the build helper's checks
// (grunt/protocol.md, "Building"). The mock also has the pieces SNARK is still to grow (fences and gates, railings,
// sloped roofs, hatches, ramps and ladders, triangles), so a builder that learns pieces from the game's form list is
// tested on them first. Every rule here is by a form's class of place (FormSpec.place), never by its name.

import type { Building, FormSpec, PieceForm, PieceVerdict, Plan, PlanPiece, Side } from "../../grunt/protocol.ts";
import { CLIFF, DEEP, type Terrain } from "./terrain.ts";

export const CELL = 3, STOREY = 3;
/** How far the helper places from the character, and how fast: more than a player's reach and pace, but not without
 * limit (a player's reach in SNARK is 12 m; a careful player places a piece every two or three seconds). */
export const BUILD_REACH = 24, BUILD_RATE = 2, MAX_PLAN = 120;
/** Seconds after placing in which a piece is taken back whole. */
export const PICKUP_S = 30;

/** Every form the mock has, by its class of place. */
export const SPECS: FormSpec[] = [
  { form: "foundation", place: "floor", ground: true },
  { form: "triangle_foundation", place: "floor", ground: true, shape: "triangle" },
  { form: "ceiling", place: "floor" },
  { form: "triangle_ceiling", place: "floor", shape: "triangle" },
  { form: "sloped_roof", place: "floor" },
  { form: "hatchframe", place: "floor" },
  { form: "wall", place: "edge" },
  { form: "doorframe", place: "edge" },
  { form: "windowframe", place: "edge" },
  { form: "railing", place: "edge" },
  { form: "fence", place: "edge", ground: true },
  { form: "gateway", place: "edge", ground: true },
  { form: "behemoth_gateway", place: "edge", ground: true },
  { form: "door", place: "in_frame", frame: "doorframe" },
  { form: "gate", place: "in_frame", frame: "gateway" },
  { form: "behemoth_gate", place: "in_frame", frame: "behemoth_gateway" },
  { form: "trapdoor", place: "in_frame", frame: "hatchframe" },
  { form: "pillar", place: "corner" },
  { form: "stairs", place: "centre" },
  { form: "ramp", place: "centre" },
  { form: "ladder", place: "centre" },
  // Things set down on a floor (boxes, beds, fires): one form, the item says which (THINGS).
  { form: "thing", place: "thing" },
];
const SPEC = new Map(SPECS.map((s) => [s.form, s]));
export const specOf = (form: string): FormSpec | undefined => SPEC.get(form);

const SQUARE = ["foundation", "wall", "doorframe", "ceiling", "door"];
const MORE = ["windowframe", "pillar", "stairs", "ramp", "ladder", "fence", "gateway", "gate", "behemoth_gateway", "behemoth_gate", "railing", "sloped_roof", "hatchframe", "trapdoor", "triangle_foundation", "triangle_ceiling"];
const FORMS: Record<string, PieceForm[]> = { thatch: [...SQUARE, "fence", "gateway", "gate", "sloped_roof"], wood: [...SQUARE, ...MORE], stone: [...SQUARE, ...MORE] };
/** The item that places a form: the wall's places the frames too. */
const itemOf = (form: PieceForm, tier: string) => `piece_${form === "doorframe" || form === "windowframe" ? "wall" : form}_${tier}`;
export const KIT: Building["tiers"] = Object.fromEntries(Object.entries(FORMS).map(([tier, forms]) => [tier, Object.fromEntries(forms.map((f) => [f, itemOf(f, tier)]))]));
export const PIECE_ITEMS = [...new Set(Object.values(KIT).flatMap((k) => Object.values(k) as string[]))];

/** What a thing set down on a floor is: a container holds things; it blocks a body if it is big. */
export const THINGS: Record<string, { container: number; r: number; blocks: boolean; needs: Record<string, number> }> = {
  storage_box: { container: 30, r: 0.5, blocks: true, needs: { wood: 25, thatch: 10, fiber: 10 } },
  vault: { container: 120, r: 0.7, blocks: true, needs: { stone: 120, wood: 40, flint: 20 } },
  bed: { container: 0, r: 0.9, blocks: false, needs: { wood: 30, thatch: 40, fiber: 40 } },
  campfire: { container: 0, r: 0.6, blocks: false, needs: { stone: 16, wood: 2, thatch: 12, flint: 1 } },
  sleeping_bag: { container: 0, r: 0.8, blocks: false, needs: { fiber: 60, thatch: 20 } },
};

/** SNARK's recipes for the pieces it has (content/building.ts, MAKING), five seconds each; the rest scaled from them. */
const BASE: Record<string, Record<string, Record<string, number>>> = {
  thatch: { foundation: { thatch: 20, wood: 6, fiber: 15 }, wall: { thatch: 10, wood: 2, fiber: 7 }, ceiling: { thatch: 15, wood: 4, fiber: 10 }, door: { thatch: 7, wood: 2, fiber: 4 } },
  wood: { foundation: { wood: 80, thatch: 20, fiber: 15 }, wall: { wood: 40, thatch: 10, fiber: 7 }, ceiling: { wood: 60, thatch: 15, fiber: 10 }, door: { wood: 20, thatch: 7, fiber: 4 }, pillar: { wood: 40, thatch: 10, fiber: 7 }, stairs: { wood: 60, thatch: 15, fiber: 10 } },
  stone: { foundation: { stone: 80, wood: 40, thatch: 30 }, wall: { stone: 40, wood: 20, thatch: 15 }, ceiling: { stone: 60, wood: 30, thatch: 20 }, door: { stone: 20, wood: 10, thatch: 7 }, pillar: { stone: 40, wood: 20, thatch: 15 }, stairs: { stone: 60, wood: 30, thatch: 20 } },
};
/** A piece SNARK does not have yet, priced as one it has: [the one, how many times]. */
const LIKE: Record<string, [string, number]> = {
  fence: ["wall", 0.5], gateway: ["wall", 2], gate: ["door", 2], behemoth_gateway: ["wall", 6], behemoth_gate: ["door", 6], railing: ["wall", 0.5],
  sloped_roof: ["ceiling", 1], hatchframe: ["ceiling", 1], trapdoor: ["door", 1], ramp: ["ceiling", 1], ladder: ["door", 1], triangle_foundation: ["foundation", 0.5],
  triangle_ceiling: ["ceiling", 0.5], windowframe: ["wall", 1], pillar: ["wall", 1], stairs: ["ceiling", 1],
};
export const PIECE_RECIPES: Record<string, { needs: Record<string, number>; seconds: number }> = {};
for (const [tier, forms] of Object.entries(FORMS)) {
  for (const form of forms) {
    const item = itemOf(form, tier);
    if (PIECE_RECIPES[item]) continue;
    const own = BASE[tier]![form];
    const [like, times] = LIKE[form] ?? ["wall", 1];
    const needs = own ?? Object.fromEntries(Object.entries(BASE[tier]![like]!).map(([m, n]) => [m, Math.max(1, Math.round(n * times))]));
    PIECE_RECIPES[item] = { needs, seconds: 5 };
  }
}
for (const [item, t] of Object.entries(THINGS)) PIECE_RECIPES[item] = { needs: t.needs, seconds: 3 };

/** Each form's health when whole, as SNARK's where SNARK has it. */
export const PIECE_HP: Record<string, number> = {
  foundation: 15000, triangle_foundation: 15000, wall: 10000, doorframe: 10000, windowframe: 10000, ceiling: 10000, triangle_ceiling: 10000, stairs: 10000, ramp: 10000,
  pillar: 6250, door: 6250, fence: 6000, gateway: 12000, gate: 8000, behemoth_gateway: 30000, behemoth_gate: 20000, railing: 4000, sloped_roof: 10000,
  hatchframe: 10000, trapdoor: 6250, ladder: 2000, thing: 2000,
};

export const BUILDING: Building = {
  cell: CELL, storey: STOREY, reach: BUILD_REACH, rate: BUILD_RATE, max_pieces: MAX_PLAN, tiers: KIT, forms: SPECS, pickup_s: PICKUP_S, things: Object.keys(THINGS),
};

/** Where a piece is: which base, and where on its grid. */
export interface PieceAt {
  form: PieceForm;
  tier: string;
  /** A thing: the item it is. */
  item?: string;
  base: string;
  cell: [number, number];
  level: number;
  side?: Side;
  up?: Side;
  half?: Side;
  spot?: Side | "c";
  /** In the world: the slab's direction (0 along x, π/2 along z) and its height. */
  yaw: number;
  y: number;
  open?: boolean;
  /** When it was placed (world ms): picked up whole within PICKUP_S. */
  at: number;
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
/** A floor form's height on the grid: the storey it is the floor of (a ceiling is the floor of the one above). */
const floorOf = (p: { form: PieceForm; level: number }) => (specOf(p.form)?.ground ? p.level : p.level + 1);

/** The slots a piece takes on its base, one key each, by its class of place: a floor at a height (a triangle's half
 * of one), an edge at a storey, what fills a frame, a corner, a cell's middle, a thing's spot. */
export function slot(p: { form: PieceForm; cell: [number, number]; level: number; side?: Side; half?: Side; spot?: string; item?: string }): string {
  const [i, j] = p.cell;
  const spec = specOf(p.form);
  const edge = (side: Side) => {
    const [ei, ej, es] = side === "e" ? [i + 1, j, "w"] : side === "s" ? [i, j + 1, "n"] : [i, j, side];
    return `${ei},${ej},${p.level},${es}`;
  };
  if (p.form === "thing") return `t${i},${j},${p.level},${p.spot ?? "c"}`;
  switch (spec?.place) {
    case "floor":
      return `f${i},${j},${floorOf(p)}${p.half ?? ""}`;
    case "corner":
      return `p${i},${j},${p.level}`;
    case "centre":
      return `c${i},${j},${p.level}`;
    case "in_frame":
      return p.side ? `d${edge(p.side)}` : `d${i},${j},${p.level + 1}`;
    default:
      return `e${edge(p.side ?? "n")}`;
  }
}

/** Edge forms that hold up a ceiling beside or a wall above them (a fence, a gateway or a railing does not). */
const HOLDS = new Set(["wall", "doorframe", "windowframe"]);

export class Structures {
  readonly bases = new Map<string, Base>();
  private n = 0;

  /** The tier an item places a form in, or null if no tier's does. */
  tierOf(form: PieceForm, item: string): string | null {
    if (form === "thing") return THINGS[item] ? "thing" : null;
    for (const [tier, kit] of Object.entries(KIT)) if (kit[form] === item) return tier;
    return null;
  }

  /** Where a piece of a plan goes in the world: its centre, height and, for a slab, its direction. */
  place(base: Base, p: { form: PieceForm; cell: [number, number]; level: number; side?: Side; half?: Side; spot?: string }): { x: number; z: number; y: number; yaw: number } {
    const spec = specOf(p.form);
    let dx = p.cell[0] * CELL, dz = p.cell[1] * CELL;
    if (p.side && spec?.place !== "floor") (dx += (OUT[p.side][0] * CELL) / 2), (dz += (OUT[p.side][1] * CELL) / 2);
    if (p.half) (dx += (OUT[p.half][0] * CELL) * 0.66), (dz += (OUT[p.half][1] * CELL) * 0.66);
    if (spec?.place === "corner") (dx -= CELL / 2), (dz -= CELL / 2);
    if (p.form === "thing" && p.spot && p.spot !== "c") (dx += OUT[p.spot as Side][0] * 0.9), (dz += OUT[p.spot as Side][1] * 0.9);
    const [wx, wz] = rot(dx, dz, base.turns);
    const y = (spec?.place === "floor" ? floorOf(p) : p.level) * STOREY;
    const world = p.side ? turn(p.side, base.turns) : "n";
    return { x: base.x + wx, z: base.z + wz, y, yaw: p.side && (world === "e" || world === "w") ? Math.PI / 2 : 0 };
  }

  /** The base a plan goes on: the one named; or, laid at a point, a base of the same turn whose grid the point is on
   * and which stands near (new pieces snap to a base already there, as a player's do); or a new one. */
  baseOf(plan: Plan, things: Iterable<{ id?: string; x: number; z: number; piece?: PieceAt }> = []): Laid | null {
    if ("base" in plan.anchor) {
      // A base by its id, or by the id of any piece of it (a door seen is enough).
      const want = plan.anchor.base;
      let b = this.bases.get(want);
      if (!b) for (const t of things) if (t.id === want && t.piece) b = this.bases.get(t.piece.base);
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
  check(site: Site, plan: Plan, live: boolean): { verdicts: { status: PieceVerdict; by?: string; fix?: string }[]; base: Laid | null } {
    const things = [...site.things()];
    const base = this.baseOf(plan, things);
    if (!base) return { verdicts: plan.pieces.map(() => ({ status: "blocked" as const, by: "no such base" })), base: null };
    const slots = new Map<string, { form: PieceForm; tier: string; id: string }>();
    for (const t of things) if (t.piece && t.piece.base === base.id) slots.set(slot(t.piece), { form: t.piece.form, tier: t.piece.tier, id: t.id });
    const verdicts = plan.pieces.map((q) => {
      const p = shift(q, base.off);
      const v = this.one(site, things, base, slots, p, live);
      // In the character's own way is for now only (it steps aside to build): what follows may stand on it.
      if (v.status === "ok" || (v.status === "blocked" && v.by === site.me.id)) slots.set(slot(p), { form: p.form, tier: this.tierOf(p.form, p.item)!, id: "planned" });
      return v;
    });
    return { verdicts, base };
  }

  private one(site: Site, things: ReturnType<Site["things"]> extends Iterable<infer T> ? T[] : never, base: Base, slots: Map<string, { form: PieceForm; tier: string; id: string }>, p: PlanPiece, live: boolean): { status: PieceVerdict; by?: string; fix?: string } {
    const spec = p.form === "thing" ? ({ form: "thing", place: "thing" } as FormSpec) : specOf(p.form);
    if (!spec) return { status: "not_in_game", fix: `this game has no ${p.form}` };
    const tier = this.tierOf(p.form, p.item);
    if (!tier) return { status: "not_in_tier", by: `${p.item} does not place a ${p.form}` };
    const taken = slots.get(slot(p));
    if (taken) return taken.form === p.form && taken.tier === tier ? { status: "built", by: taken.id } : { status: "occupied", by: taken.id === "planned" ? `${taken.form} (${taken.tier})` : taken.id, fix: "another piece is there: replace swaps it" };
    const at = this.place(base, p);
    if (live && Math.hypot(at.x - site.me.x, at.z - site.me.z, at.y - site.me.y) > BUILD_REACH) return { status: "too_far" };
    const [i, j] = p.cell, L = p.level;
    const floor = (ci: number, cj: number, h: number) => slots.has(`f${ci},${cj},${h}`);
    const holds = (ci: number, cj: number, level: number, side: Side) => {
      const s = slots.get(slot({ form: "wall", cell: [ci, cj], level, side }));
      return !!s && HOLDS.has(s.form);
    };
    const ground = (x: number, z: number) => {
      if (site.bounds && (x < site.bounds[0] || z < site.bounds[1] || x > site.bounds[2] || z > site.bounds[3])) return false;
      const k = site.terrain?.at(x, z) ?? 0;
      return k !== CLIFF && k !== DEEP;
    };
    /** What stands in a square about (x, z): a thing or a body (the character's own included). */
    const inWay = (x: number, z: number, half: number): string | null => {
      for (const t of things) {
        if (t.piece) continue;
        const body = t.kind === "creature" || t.kind === "player" || t.kind === "vehicle";
        if (!t.blocks && !body) continue;
        if (Math.abs(t.x - x) < half + t.r && Math.abs(t.z - z) < half + t.r) return t.id;
      }
      if (Math.abs(site.me.x - x) < half + 0.4 && Math.abs(site.me.z - z) < half + 0.4 && site.me.y < 1) return site.me.id;
      return null;
    };
    switch (spec.place) {
      case "floor": {
        const tri = spec.shape === "triangle";
        if (tri && !p.half) return { status: "blocked", fix: "a triangle names the side of the square it stands against (half)" };
        if (spec.ground) {
          const r = tri ? 0.7 : 1.3;
          for (const [ox, oz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]] as const) if (!ground(at.x + ox, at.z + oz)) return { status: "terrain", fix: "water or a cliff there: another site" };
          for (const t of things) if (t.piece && specOf(t.piece.form)?.ground && specOf(t.piece.form)?.place === "floor" && t.piece.base !== base.id && Math.hypot(t.x - at.x, t.z - at.z) < CELL * 0.9) return { status: "occupied", by: t.id };
          const by = inWay(at.x, at.z, tri ? 0.75 : CELL / 2);
          return by ? { status: "blocked", by } : { status: "ok" };
        }
        // A triangle floor rests against the square floor it is a half of, at the same height.
        if (tri) return floor(i, j, floorOf(p)) || holds(i, j, L, p.half!) ? { status: "ok" } : { status: "no_support" };
        // Held up by a wall on one of its edges or a pillar at a corner, or by floors beside it that are, within two
        // cells (SNARK lets a ceiling reach 6.5 m from what stands straight up).
        const h = floorOf(p);
        const held = (ci: number, cj: number) =>
          SIDES.some((s) => holds(ci, cj, L, s)) || [[ci, cj], [ci + 1, cj], [ci, cj + 1], [ci + 1, cj + 1]].some(([pi, pj]) => slots.has(`p${pi},${pj},${L}`));
        if (held(i, j)) return { status: "ok" };
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
          if (Math.abs(di) + Math.abs(dj) > 2 || (!di && !dj)) continue;
          if (floor(i + di, j + dj, h) && held(i + di, j + dj) && (Math.abs(di) + Math.abs(dj) === 1 || floor(i + Math.sign(di), j, h) || floor(i, j + Math.sign(dj), h))) return { status: "ok" };
        }
        return { status: "no_support", fix: "nothing holds it up: a wall or pillar near it" };
      }
      case "edge": {
        const side = p.side ?? "n";
        if (spec.ground) {
          // A fence or a gateway stands on the ground by itself, along a cell's edge.
          if (!ground(at.x, at.z)) return { status: "terrain" };
          const by = inWay(at.x, at.z, 0.6);
          return by ? { status: "blocked", by } : { status: "ok" };
        }
        const [oi, oj] = [i + OUT[side][0], j + OUT[side][1]];
        if (!(floor(i, j, L) || floor(oi, oj, L) || (L > 0 && holds(i, j, L - 1, side)))) return { status: "no_support" };
        // The character in the slab's way.
        const along = at.yaw === 0 ? Math.abs(site.me.x - at.x) : Math.abs(site.me.z - at.z);
        const across = at.yaw === 0 ? Math.abs(site.me.z - at.z) : Math.abs(site.me.x - at.x);
        if (along < CELL / 2 + 0.4 && across < 0.5 && Math.abs(site.me.y - at.y) < 2) return { status: "blocked", by: site.me.id };
        return { status: "ok" };
      }
      case "in_frame": {
        const s = slots.get(p.side ? slot({ form: "wall", cell: p.cell, level: L, side: p.side }) : `f${i},${j},${L + 1}`);
        return s?.form === spec.frame ? { status: "ok" } : { status: "no_support", by: `no ${spec.frame} there` };
      }
      case "corner": {
        const around: [number, number][] = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]];
        if ((L === 0 && ground(at.x, at.z)) || around.some(([ci, cj]) => floor(ci, cj, L)) || slots.has(`p${i},${j},${L - 1}`)) return { status: "ok" };
        return { status: "no_support" };
      }
      case "centre": {
        if (!floor(i, j, L)) return { status: "no_support" };
        if (floor(i, j, L + 1)) return { status: "occupied", by: "the floor over it" };
        return { status: "ok" };
      }
      case "thing": {
        if (!floor(i, j, L)) return { status: "no_support", fix: "a thing goes on a floor" };
        return { status: "ok" };
      }
    }
    return { status: "blocked" };
  }
}
