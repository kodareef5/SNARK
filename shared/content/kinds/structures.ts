// Structures: anything built or standing in the world that is not alive. A wall is a row in a chunk's table, not an entity.

import { REGION_BASE } from "../../pack/palette.ts";
import { DAMAGE_TYPES } from "../../sim/damage.ts";
import type { VehicleSurface } from "../../sim/vehicle.ts";
import { validVehicleSurface } from "../../world/vehicle-surface.ts";
import { hullTable, type HullDef } from "../../world/convex.ts";
import type { Def } from "../defs.ts";
import { ID, drawnFaults, f, f32, i8, list, mesh, row, u16, u8, type Fields, type Kind, type Named } from "../kind.ts";
import { materialsById } from "./materials.ts";
import { MAX_STRUCTURE_HALF, PIECE_ROLES, shapeHalf, shapesById, type ShapeDef } from "./shapes.ts";
import { STATION_FIELDS, fuelFaults, type StationFields } from "./stations.ts";

/** Parts a moving static may move, and the farthest one may stand from it in metres. */
export const MAX_MOVING_PARTS = 32;
export const MAX_MOVING_REACH = 128;

/**
 * Where a moving part stands from its static's origin, in the static's frame: offset in metres, then a turn as a unit
 * quaternion (x, y, z, w), then a scale along the part's own axes. A turn or a scale left out is none. A part `away` at
 * one end is put away there and not drawn while it rests there: a headsail rolled on its stay, which a roll stands for.
 */
export interface PartPlacement {
  readonly at: readonly [number, number, number];
  readonly turn?: readonly [number, number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly away?: true;
}

/**
 * Using the static moves its parts from one placement to the other over `seconds`, and back if used again, from where they
 * stand: a door with a travel time. Each part is a mesh of the pack, drawn as one piece and walked by nothing. A new
 * world has each at `from`. `say` is what using it does toward each state, the second and then the first, which the
 * prompt shows.
 */
export interface MotionFacet {
  readonly seconds: number;
  readonly parts: readonly { readonly mesh: string; readonly from: PartPlacement; readonly to: PartPlacement }[];
  readonly say: readonly [string, string];
}

export interface StructureDef extends Named, StationFields {
  /** A static whose parts move between two placements when it is used. */
  readonly motion?: MotionFacet;
  /** Grip/resistance of its supporting faces; shared vehicle prediction reads this independently of artwork. */
  readonly vehicleSurface?: VehicleSurface;
  readonly type: "structure";
  readonly class: "piece" | "container" | "station" | "bed" | "static" | "defence";
  readonly id: string;
  /**
   * "box" for one made from its half extents, "shape" for one made from its shape's boxes, or a mesh of the pack. A mesh of
   * the pack with a shape is drawn at the shape's origin and walked as its boxes, so its origin may be on the ground under it.
   * "none" for a static drawn as nothing: a landmark's collision, which its cells draw.
   */
  readonly mesh: string;
  readonly color: number;
  /** A fixed palette colour for its faces that look down, drawn as its form (shared/world/city.ts): a slab's darker soffit. */
  readonly under?: number;
  /**
   * A material made from a recipe by the page (content/texgen/finishes.ts) that its faces wear, drawn as its form, in
   * place of its colour's painted finish: its colour dyes it and its painted finish weathers it. Its name in the recipes.
   */
  readonly recipe?: string;
  /** Drawn near only: a street piece or a building's small kit, left out of the far city's lattice and mass levels. */
  readonly near?: true;
  /**
   * Drawn bent along the street by its instance's bend (shared/world/bends.ts): a static of a pack's mesh, walked as
   * nothing, which the collision pieces a map lays under it are walked as; its shape is the box of the piece as modelled.
   */
  readonly bent?: true;
  /**
   * Paint on the ground: each vertex of its mesh is drawn its own height over the ground under it, wherever the frame holds
   * the ground's samples (packet.ts DRAW_GROUND), and it casts no shadow. It follows the ground alone, not what stands on it.
   */
  readonly paint?: true;
  /**
   * Its mesh's levels are chosen as if it stood this many times as far off (1 to 16; client/core/render/scene.ts): for
   * scenery of many alike that a heavy mesh draws, a marina's moored hulls, finest only close by.
   */
  readonly coarse?: number;
  /**
   * Fixed palette colours of its mesh's colour regions after the first, which `color` gives: up to five, as a moored hull
   * takes its vessel's stripe and upholstery. Without it those regions draw as the missing colour.
   */
  readonly colors?: readonly number[];
  /** Half extents in metres of the box that holds all of it, centred on the structure's position. Without a shape, this box is its collider. */
  readonly half: readonly [number, number, number];
  /** A shape id, if it is more than one box or not centred on its origin. `half` must equal the box that holds the shape. */
  readonly shape?: string;
  readonly hp: number;
  /** A material id. The material says what each type of damage does to it. Omitted, nothing harms it. */
  readonly material?: string;
  /** Stacks it holds. */
  readonly slots?: number;
  /** Using it turns it into this other structure in the same place. A door and its open form name each other. */
  readonly opens?: string;
  /** Only its tribe may use it until the tribe unlocks it. Omitted, anyone may. */
  readonly locked?: boolean;
  /** When it loses its support it drops whole onto the ground under it instead of breaking. */
  readonly falls?: boolean;
  /** Days it lasts unvisited, in place of its material's. */
  readonly decayDays?: number;
  /** A fire. Lighting it turns it into this other structure in the same place, and putting that one out turns it back. */
  readonly lights?: string;
  /** The burning one of such a pair. */
  readonly lit?: boolean;
  /** Its tribe may respawn at it. */
  readonly bed?: boolean;
  /** A bed's seconds, after a survivor rises at it, before anyone may again. */
  readonly wait?: number;
  /** A sleeping bag: only the survivor who set it down may rise at it, and it is gone once one has. */
  readonly once?: boolean;
  /** It is set only on a foundation or a ceiling, never on open ground. */
  readonly floor?: boolean;
  /** Where a survivor rises from a bed, from its middle and turned with it. On top of it unless given. */
  readonly rise?: readonly [number, number, number];
}

const FIELDS = {
  motion: f("facet", "a door's swing, with a travel time"),
  vehicleSurface: f("facet"),
  mesh: f("text"),
  color: f("number"),
  under: f("number", "the colour of its faces that look down"),
  recipe: f("text", "a material made from a recipe its faces wear, which its colour dyes"),
  near: f("switch", "drawn near only, left out of the far city's lattice and mass"),
  paint: f("switch", "paint on the ground: each vertex drawn its own height over the ground under it, casting no shadow"),
  bent: f("switch", "drawn bent along the street by its instance's bend, walked as nothing: a bent kerb"),
  coarse: f("number", "its mesh's levels chosen as if it stood this many times as far off, 1 to 16: scenery of many alike"),
  colors: f("list", "the colours of its mesh's regions after the first, as a moored hull its vessel's"),
  half: f("vec3"),
  shape: f("text", "SnapPoints", { refs: { "": "shape" } }),
  hp: f("number", "Health"),
  material: f("text", "StructureSettingsClass", { refs: { "": "material" } }),
  slots: f("number", "an inventory component"),
  opens: f("text", "", { refs: { "": "structure" } }),
  locked: f("switch"),
  falls: f("switch"),
  decayDays: f("number", "DecayDestructionPeriod"),
  lights: f("text", "", { refs: { "": "structure" } }),
  lit: f("switch"),
  bed: f("switch"),
  wait: f("number"),
  once: f("switch"),
  floor: f("switch"),
  rise: f("vec3"),
  ...STATION_FIELDS,
} satisfies Fields<StructureDef>;

const BUILT = ["mesh", "color", "half", "hp"] as const;
const STRUCTURE_SLOTS = { mesh: mesh("must", "{mesh}", "{id}", "shape"), destroyed: mesh("may", "{id}/destroyed", "none"), preview: mesh("may", "{id}/preview", "#mesh") };

function motionFaults(d: StructureDef): string[] {
  const t = d.motion!, out: string[] = [];
  const at = (v: unknown, n: number, ok: (x: number) => boolean): boolean => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && ok(x));
  const placed = (p: PartPlacement | undefined): boolean => !!p && at(p.at, 3, (x) => Math.abs(x) <= MAX_MOVING_REACH) && (p.turn === undefined || (at(p.turn, 4, Number.isFinite) && Math.abs(Math.hypot(...p.turn) - 1) < 1e-4)) && (p.scale === undefined || at(p.scale, 3, (x) => x > 0 && x <= 16)) && (p.away === undefined || p.away === true);
  if (d.class !== "static" || d.opens !== undefined || d.slots !== undefined || d.locked !== undefined || d.material !== undefined) out.push(`${d.id}: a moving static is a public one that nothing harms, with no door, lock or slots`);
  if (!(t.seconds >= 0.5 && t.seconds <= 600)) out.push(`${d.id}: a motion takes 0.5 to 600 seconds`);
  if (!Array.isArray(t.say) || t.say.length !== 2 || t.say.some((w) => typeof w !== "string" || w.length < 1 || w.length > 40)) out.push(`${d.id}: a motion says what it does toward each state, in at most 40 characters`);
  if (!Array.isArray(t.parts) || t.parts.length < 1 || t.parts.length > MAX_MOVING_PARTS) out.push(`${d.id}: a motion moves 1 to ${MAX_MOVING_PARTS} parts`);
  else for (const p of t.parts) if (typeof p?.mesh !== "string" || !ID.test(p.mesh) || !placed(p.from) || !placed(p.to)) out.push(`${d.id}: a moving part is a mesh with two placements within ${MAX_MOVING_REACH} m, each turn a unit quaternion and each scale from 0 to 16`);
  return out;
}

const columns = (n: number) => ({
  /** Per structure: the multiplier on each DMG_ type, from its material. Null for everything else, and for a structure nothing harms. */
  structTakes: list<Float32Array>(n),
  /** Per structure with a shape: an index into PIECE_ROLES. -1 for everything else. */
  role: i8(n, -1),
  /** Per structure: 1 if it is a wall with a doorway. */
  doorway: u8(n),
  /** Per structure: the item that places it (0 if none), its full health, and the days it lasts unvisited (0 means for ever). */
  pieceItem: u16(n),
  maxHp: f32(n),
  decayDays: f32(n),
  /** Per structure: the stacks it holds, the structure it becomes when used (0 for none), whether it starts locked, and whether it drops whole. */
  structSlots: u16(n),
  opens: u16(n),
  /** Per static: what using it moves, and over how long (StructureDef.motion), or null. */
  motion: list<MotionFacet>(n),
  lockedAtFirst: u8(n),
  fallsWhole: u8(n),
  /** Per structure: the structure it becomes when lit or put out (0 if it is no fire), whether it is the burning one, and whether it is a bed. */
  lights: u16(n),
  burning: u8(n),
  isBed: u8(n),
});

/** The convex parts of the structure at `k`. A bent piece has none: it is walked as the pieces laid under it. */
const hullsOf = (defs: readonly (Def | null)[], shapes: ReadonlyMap<string, ShapeDef>) => (k: number): readonly HullDef[] => {
  const d = defs[k];
  return d?.type === "structure" && d.shape !== undefined && !d.bent ? (shapes.get(d.shape)!.hulls ?? []) : [];
};

export const structures: Kind<StructureDef, ReturnType<typeof columns>> = {
  type: "structure",
  fields: FIELDS,
  rows: [
    row("structure", "structure", FIELDS, { abstract: true, ark: "APrimalStructure", shelf: "structures", doc: "Anything built or standing in the world that is not alive." }),
    row("structure/piece", "structure", FIELDS, { parent: "structure", ark: "a structure with snap points", shelf: "structures/pieces", must: [...BUILT, "shape", "material"], may: ["opens", "locked", "decayDays", "falls", "vehicleSurface"], slots: STRUCTURE_SLOTS, doc: "A foundation, wall, ceiling, pillar, door or stair: it joins others and holds them up." }),
    row("structure/container", "structure", FIELDS, { parent: "structure", ark: "an item container", shelf: "structures/containers", must: [...BUILT, "slots"], may: ["shape", "material", "decayDays", "locked", "falls", "keeps"], slots: STRUCTURE_SLOTS, doc: "Holds stacks: a box, a vault." }),
    row("structure/station", "structure", FIELDS, { parent: "structure/container", ark: "a crafting inventory with its engrams and speed", status: "partial", waits: "stations", shelf: "structures/stations", must: BUILT, may: ["shape", "material", "decayDays", "locked", "falls", "slots", "lights", "lit", "burns", "cooks", "keeps", "charges", "powered", "dry"], slots: STRUCTURE_SLOTS, doc: "Things are made or changed at it. An item whose craft names it in `at` is made from what lies in it, for whoever queued it, and lands in it; a lit station and the same station out are one station to that. One that `lights` burns fuel while lit: every item's own `fuel`, or only what it names in `burns`, at its own times. A `powered` one (the fabricator) makes things only while it burns: it takes no job while out, and a unit under way when its fuel runs out waits with its ticks left until it is lit again. A fire makes its `fired` recipes by itself while it burns, and cooks what has `cooks` unless `cooks` is false. How fast it makes things waits: every station makes at the recipe's seconds." }),
    row("structure/bed", "structure", FIELDS, { parent: "structure", ark: "a bed", shelf: "structures/beds", must: [...BUILT, "bed"], may: ["shape", "material", "decayDays", "falls", "wait", "once", "floor", "rise"], slots: STRUCTURE_SLOTS, doc: "Its tribe may come back to life at it, after its wait, and travel to it from another; a sleeping bag once, and only for whoever set it down." }),
    row("structure/static", "structure", FIELDS, { parent: "structure", ark: "level geometry, ours", shelf: "structures/static", must: BUILT, may: ["material", "shape", "vehicleSurface", "opens", "motion", "under", "recipe", "near", "paint", "coarse", "colors", "bent"], slots: { mesh: mesh("must", "{mesh}", "{id}", "box", "shape") }, doc: "Part of a map: set there with the world and joined to nothing. A ruin's piece may say the darker colour its faces looking down are drawn in, and a material made from a recipe its faces wear in place of its colour's painted finish, and a street piece or a building's small kit that it is drawn near only, and road paint that it is drawn on the ground, and scenery of many alike that its mesh's levels are chosen coarser and the colours of its mesh's other regions. With a shape it may be sloped, or drawn as a mesh of the pack, a wreck's, at the shape's origin, or as nothing where a landmark's cells draw it, or bent along the street by its instance's bend and walked as nothing (a bent kerb). A pair that opens each other is a public door. One with a motion moves its parts between two placements when used, as sails are set and struck." }),
    row("structure/defence", "structure", FIELDS, { parent: "structure", ark: "turrets and spikes", status: "stub", waits: "defences", shelf: "structures/defences", must: BUILT, may: ["shape", "material", "decayDays", "falls", "slots"], slots: STRUCTURE_SLOTS, doc: "Harms what comes near it." }),
  ],
  check(d, cx) {
    const { errors, positive } = cx;
    if (d.under !== undefined && !(Number.isInteger(d.under) && d.under > 0 && d.under < REGION_BASE)) errors.push(`${d.id}: under must be a fixed palette colour`);
    if (d.near !== undefined && d.near !== true) errors.push(`${d.id}: near is true or left out`);
    if (d.paint !== undefined && d.paint !== true) errors.push(`${d.id}: paint is true or left out`);
    if (d.coarse !== undefined && !(d.coarse >= 1 && d.coarse <= 16)) errors.push(`${d.id}: coarse is from 1 to 16`);
    if (d.colors !== undefined && !(Array.isArray(d.colors) && d.colors.length <= 5 && d.colors.every((c) => Number.isInteger(c) && c > 0 && c < REGION_BASE))) errors.push(`${d.id}: colors are up to five fixed palette colours`);
    if (d.motion !== undefined) errors.push(...motionFaults(d));
    if (d.vehicleSurface !== undefined && !validVehicleSurface(d.vehicleSurface)) errors.push(`${d.id}: invalid vehicleSurface grip/resistance`);
    positive(d, "half[0]", d.half[0], MAX_STRUCTURE_HALF);
    positive(d, "half[1]", d.half[1], MAX_STRUCTURE_HALF);
    positive(d, "half[2]", d.half[2], MAX_STRUCTURE_HALF);
    positive(d, "hp", d.hp, 1e9);
    // A mesh of the pack may come with a shape, which it is walked and seen far off as, its origin the mesh's.
    if (d.mesh === "shape" && d.shape === undefined) errors.push(`${d.id}: a mesh of "shape" needs a shape`);
    if (d.mesh === "box" && d.shape !== undefined) errors.push(`${d.id}: a mesh of "box" is its half extents, and takes no shape`);
    if (d.mesh === "none" && (d.class !== "static" || d.shape === undefined)) errors.push(`${d.id}: only a static with a shape is drawn as nothing`);
    if (d.bent !== undefined && (d.bent !== true || d.class !== "static" || d.shape === undefined || ["box", "shape", "none"].includes(d.mesh))) errors.push(`${d.id}: only a static of a pack's mesh with a shape is drawn bent`);
    fuelFaults(d, cx);
    if (d.keeps !== undefined) positive(d, "keeps", d.keeps, 1000);
    drawnFaults(d, cx);
  },
  among(d, { errors, once }) {
    if (d.shape === undefined) return;
    const shape = once(shapesById).get(d.shape);
    const holds = shape ? shapeHalf(shape.boxes, shape.hulls, shape.look) : null;
    if (holds && holds.some((v, a) => Math.abs(v - d.half[a]!) > 1e-6)) errors.push(`${d.id}: half must be [${holds.join(", ")}], the box that holds ${d.shape}`);
  },
  columns,
  fill(d, i, reg, { boxes, once }) {
    reg.halfX[i] = d.half[0];
    reg.halfY[i] = d.half[1];
    reg.halfZ[i] = d.half[2];
    // Collision parts are the shape's boxes, or else the one box.
    const shape = d.shape !== undefined ? once(shapesById).get(d.shape)! : null;
    // A bent piece is walked as the pieces laid under it, and has none of its own.
    if (d.bent) {
      // Nothing.
    } else if (shape) {
      // A map's static is joined to nothing, so it is no building piece whatever its shape's role: nothing snaps to it,
      // and it is never judged for support, as a static of one box is not.
      if (d.class !== "static") reg.role[i] = PIECE_ROLES.indexOf(shape.role);
      if (shape.doorway) reg.doorway[i] = 1;
      for (const b of shape.boxes) boxes.push(b.at[0], b.at[1], b.at[2], b.half[0], b.half[1], b.half[2]);
    } else boxes.push(0, 0, 0, d.half[0], d.half[1], d.half[2]);
    if (d.vehicleSurface) reg.parts.vehicleSurface[i] = Object.freeze({ ...d.vehicleSurface });
    reg.maxHp[i] = d.hp;
    reg.structSlots[i] = d.slots ?? 0;
    if (d.locked) reg.lockedAtFirst[i] = 1;
    if (d.falls) reg.fallsWhole[i] = 1;
    if (d.lit) reg.burning[i] = 1;
    if (d.bed) reg.isBed[i] = 1;
    if (d.motion) reg.motion[i] = d.motion;
    const m = d.material !== undefined ? once(materialsById).get(d.material)! : null;
    if (m) reg.structTakes[i] = Float32Array.from(DAMAGE_TYPES, (t) => m.takes[t] ?? 0);
    reg.decayDays[i] = d.decayDays ?? m?.decayDays ?? 0;
  },
  link(d, i, reg) {
    if (d.opens !== undefined) reg.opens[i] = reg.index.get(d.opens)!;
    if (d.lights !== undefined) reg.lights[i] = reg.index.get(d.lights)!;
  },
  finish(reg, { once }) {
    const n = reg.defs.length;
    // Convex parts, only if some shape has them, so content without them is compiled as it always was.
    const hulls = hullsOf(reg.defs, once(shapesById));
    if (reg.defs.some((_, k) => hulls(k).length > 0)) reg.parts.hulls = hullTable(n, hulls);
    // An open door maps back to the closed door's item.
    for (let i = 1; i < n; i++) if (reg.opens[i] !== 0 && reg.pieceItem[reg.opens[i]!] === 0) reg.pieceItem[reg.opens[i]!] = reg.pieceItem[i]!;
    // A burning fire maps back to the unlit fire's item.
    for (let i = 1; i < n; i++) if (reg.lights[i] !== 0 && reg.pieceItem[reg.lights[i]!] === 0) reg.pieceItem[reg.lights[i]!] = reg.pieceItem[i]!;
  },
};
