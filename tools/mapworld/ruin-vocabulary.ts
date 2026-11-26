import { readFileSync } from "node:fs";
import { join } from "node:path";
import { madeFinish, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import type { Footprint } from "./statics.ts";
import type { Cars } from "./street-cars.ts";
import type { ReturnRules } from "./corners.ts";
import type { BentRules } from "./bent-walks.ts";
import type { Harbours } from "../boat/sites.ts";
import type { Facts } from "./labels.ts";
import { rand3 } from "./raster.ts";
import { seedOf } from "./building-id.ts";

export interface Recipe {
  bay: number; height: number; retain: number; holes: number; wall: number; accent: RuinFinish; feature: string; play: string;
}
interface Modifier { match: string; accent?: RuinFinish; finish?: RuinFinish; feature?: string; retain?: number; holes?: number; meaning: string; }
export interface Form { plan?: string; marker?: string; terrace?: number; setbacks?: number; shell: string; inside: string; roof: string; front: string; windowEvery: number; facade?: Facade; }
/**
 * The modules of an 8 m bay's outer walls, the same in every bay of a storey: the ground floor's (`gate` at a way in, else
 * an open way in as before, and `shutter` in one bay of four), the floors' and the top storey's (`groundTop` where the
 * ground floor is the top, else the ground floor's under a parapet), four storeys at once above the playable floors
 * (`stack`, `stackTop`). With `ends`, a long block's short ends are blank walls.
 */
export interface Facade { ground: RuinShape; floor: RuinShape; top: RuinShape; groundTop?: RuinShape; gate?: RuinShape; shutter?: RuinShape; stack: RuinShape; stackTop: RuinShape; ends?: boolean; }
/**
 * A part is a box of the kit in a finish ("finish" for the building's), or "car" and the family of cars it is one of. A
 * street assembly with `kerb` is set that far in from the kerb along the street (ruins.ts makeStreetPieces).
 */
export interface Assembly { role: string; clearance?: string; passage?: [number, number][]; kerb?: number; parts: [RuinShape | "car", number, number, number, RuinFinish | "finish" | string, number?][]; }
export interface Damage { radius: number; retain: number; layers: number; plates?: RuinShape[]; front?: RuinShape; }
interface Choice { id: string; when: { kind?: string[]; recipe?: string[]; district?: string[]; name?: string; areaAbove?: number; areaBelow?: number; heightAbove?: number; heightBelow?: number; waterBelow?: number; waterAbove?: number; builtBefore?: number; neighboursAbove?: number; trades?: string[] }; form?: string; finish?: RuinFinish; collapse?: string[]; }
export interface Composition { operations: ({ op: "stack" | "parts" | "front" | "ribs" | "tower" | "arena" | "portal" | "ring" | "dome" | "pyramid" | "wheel" | "vault" | "lattice" | "orb"; rect?: number[]; exclude?: number[]; height?: number | null; offset?: number; feature?: string; form?: Form; playable?: number; coreU?: number; hall?: boolean; fromTop?: boolean; parts?: Assembly["parts"]; finish?: RuinFinish; rear?: boolean; width?: number } & Round)[]; }
/**
 * A ring of pieces round a centre, or a dome of such rings: in the footprint's metres, from the ground's height. `radii`
 * makes the ring an ellipse along u and v; `rise` is a dome's height over its springing (its radius unless given);
 * `below` carries the dome's sphere down past the foot of its drum for that many metres, narrowing; `half` is a
 * pyramid's or a lattice's half widths at its foot; `turn` is the yaw of a wheel's plane and `cabins` how many hang
 * round its rim. A lattice narrows to `tip` half widths at its top along a curve of power `profile`, with a ring of
 * beams `every` metres and floors at its `decks`. An orb is a sphere of `radius` whose centre is `y` over the ground and
 * whose picture is turned by `turn`: no piece of the kit, but a site and a shell of its own (shared/world/orb.ts).
 */
export interface Round { at?: [number, number]; radius?: number; radii?: [number, number]; heights?: number[]; y?: number; drum?: number; rise?: number; below?: number; shape?: RuinShape; arc?: [number, number]; half?: [number, number]; turn?: number; cabins?: number; tip?: number; profile?: number; every?: number; decks?: number[]; }
export interface Vocabulary {
  circulation: { ordinary: number; tower: number; tall: number; towerAbove: number; tallAbove: number };
  sightlines?: { place: string; from: [number, number]; length: number; width: number }[];
  event: { travel: [number, number]; reach: number; shelter: number; cell: number; bands: { below: number; modes: string[] }[] };
  growth: { zones: Record<string, { bare?: number; kinds?: Record<string, number> }>; roofChance: number; lowAroundPlace: Record<string, number>; canopy: Record<string, [number, number]>; canopyBase: Record<string, number> };
  frontage: { gap: number; angle: number };
  interiors: Record<string, { divider: RuinShape | null; back: RuinShape | null; parts: Assembly["parts"] }>;
  damage: Record<string, Damage>;
  compositions: Record<string, Composition>;
  forms: Record<string, Form>; choices: Choice[]; assemblies: Record<string, Assembly>;
  street: { spacing: number; chance: number; assemblies: string[]; yardAssemblies: string[]; clusterSpacing: number; clusterChance: number; junctionAssemblies: string[]; edgeAssemblies: string[]; yardClusters: string[]; cars: Cars; walks?: Walks };
  harbours: Harbours;
  version: number; seed: number; budgets: { maxChunk: number; maxCity: number; maxPlayableFloors: number; maxHeight: number };
  categories: Record<string, string>; recipes: Record<string, Recipe>;
  styles: Modifier[]; periods: Modifier[]; materials: Modifier[]; character: Modifier[];
  eras: { before: number; retain: number; feature: string; meaning: string }[];
  districts: Record<string, { finish: RuinFinish[]; fallback: string; lowRiseFeature?: string; lowRiseBelow?: number; wall?: number; holes?: number; infill?: RuinFinish; }>;
}
/**
 * A street's walk and curb (ruins.ts makeWalks): the road classes that have them, the walk's depth from the curb's face,
 * one run of 32 m in `gutterEvery` with a gutter, how far the ground under a piece may rise or fall (m), how far past a
 * road's half width a junction keeps its corners open, and one walk in `boxEvery` with a utility box at its back;
 * `returns`, the corners where two streets meet, rounded on the ground and given curb returns (corners.ts).
 */
/**
 * With `bent`, where the map has the streets' lines, the street's edge is bent sections laid on their kerb lines
 * (bent-walks.ts) in place of the walk kit and its returns, but on the street types it leaves `without`: every city has
 * it from the shared rules, and a city's `rules.json` turns it off with `"street": {"walks": {"bent": false}}`.
 */
export interface Walks { classes: string[]; width: number; gutterEvery: number; flat: number; fromJunction: number; boxEvery: number; returns?: ReturnRules; bent?: BentRules | false }
export interface Rule {
  event?: { travel: [number, number]; exposure: number; shelter: number };
  party?: number[];
  roofGrowth?: number;
  recipe: string; /** The building's own draw for its roof (content/ruins.ts pitchFinish). */ roofDraw?: number; height: number; finish: RuinFinish; feature: string; holes: number; wall: number; bay: number;
  compositions?: Record<string, Composition>;
  interiors?: Vocabulary["interiors"];
  damage?: Damage;
  form?: Form; formName?: string; collapse?: string; assemblies?: Record<string, Assembly>;
  infill?: RuinFinish;
  matched: string[]; provisional: boolean;
}
/** Objects extend by key; ordered rule lists extend by id. A disabled id removes an inherited rule. */
export function extendRules(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(patch) && [...base, ...patch].every((r) => r && typeof r === "object" && "id" in r)) {
    const rules = new Map(base.map((r) => [r.id, r]));
    for (const r of patch) {
      if (r.enabled === false) rules.delete(r.id);
      else rules.set(r.id, extendRules(rules.get(r.id), r));
    }
    return [...rules.values()];
  }
  if (base && patch && typeof base === "object" && typeof patch === "object" && !Array.isArray(base) && !Array.isArray(patch)) {
    const result = { ...base } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) result[key] = extendRules(result[key], value);
    return result;
  }
  return patch;
}

export const vocabulary = (source: string): Vocabulary => extendRules(
  JSON.parse(readFileSync(join(import.meta.dir, "rules/default.json"), "utf8")),
  JSON.parse(readFileSync(join(source, "ruins/vocabulary.json"), "utf8")),
) as Vocabulary;

export function ruleFor(f: Footprint, v: Vocabulary, facts: Facts, context = { water: Infinity, neighbours: 0 }): Rule {
  const d = v.districts[f.district?.name ?? ""] ?? v.districts.default!;
  const seed = seedOf(f.building.id); const random = rand3(seed, v.seed, 1);
  let name = v.categories[facts.kind] ?? "fabric";
  // A use label describes the ground tenant; a measured high-rise still needs a tower mass.
  if (facts.height > 32 && !["arena", "hall", "utility", "theatre"].includes(name)) name = "tower";
  if (name === "apartment" && facts.height <= 8 && f.building.area < 320) name = "house";
  const recipe = v.recipes[name]!;
  let finish = d.finish[Math.floor(random * d.finish.length)]!;
  let feature = recipe.feature; let retain = recipe.retain; let holes = recipe.holes;
  const matched: string[] = [];
  const apply = (rule: Modifier, name: string): void => {
    finish = rule.accent ?? rule.finish ?? finish; feature = rule.feature ?? feature;
    retain = rule.retain ?? retain; holes += rule.holes ?? 0; matched.push(name);
  };
  const p = facts.research;
  if (p?.built && p.built > 0) {
    const era = v.eras.find((r) => p.built! < r.before);
    if (era) { retain = era.retain; feature = era.feature; matched.push(`era < ${era.before}`); }
  }
  const period = v.periods.find((r) => new RegExp(r.match, "i").test(p?.era ?? ""));
  if (period && !p?.built) apply(period, `era: ${period.match}`);
  const mat = v.materials.find((m) => new RegExp(m.match, "i").test((p?.materials ?? []).join(" ")));
  if (mat) apply(mat, `material: ${mat.match}`);
  for (const tag of v.character) if (new RegExp(tag.match, "i").test(p?.character?.join(" ") ?? "")) apply(tag, `character: ${tag.match}`);
  const style = v.styles.find((s) => new RegExp(s.match, "i").test(p?.style ?? ""));
  if (style) apply(style, `style: ${style.match}`);
  if (!style && d.lowRiseFeature && facts.height <= (d.lowRiseBelow ?? 24)) feature = d.lowRiseFeature;
  let height = name === "park" ? 0 : Math.min(v.budgets.maxHeight, Math.max(4, Math.floor(facts.height * retain / 4) * 4));
  let formName = "fabric"; let collapse = "shear";
  for (const choice of v.choices ?? []) {
    const w = choice.when;
    if (w.kind && !w.kind.includes(facts.kind) || w.recipe && !w.recipe.includes(name) || w.district && !w.district.includes(f.district?.name ?? "")) continue;
    if (w.name && !new RegExp(w.name, "i").test([facts.label.name, ...facts.label.also].join(" "))) continue;
    if (w.areaAbove !== undefined && f.building.area <= w.areaAbove || w.areaBelow !== undefined && f.building.area > w.areaBelow) continue;
    if (w.heightAbove !== undefined && facts.height <= w.heightAbove || w.heightBelow !== undefined && facts.height > w.heightBelow) continue;
    if (w.waterBelow !== undefined && context.water >= w.waterBelow || w.waterAbove !== undefined && context.water <= w.waterAbove) continue;
    if (w.builtBefore !== undefined && (!p?.built || p.built >= w.builtBefore) || w.neighboursAbove !== undefined && context.neighbours <= w.neighboursAbove) continue;
    if (w.trades && !w.trades.some((trade) => Object.keys(facts.label.uses ?? {}).some((use) => use.includes(trade)))) continue;
    if (choice.form) formName = choice.form;
    if (choice.finish) finish = choice.finish;
    if (choice.collapse) collapse = choice.collapse[Math.floor(rand3(seed, v.seed, 91) * choice.collapse.length)]!;
    matched.push(choice.id);
  }
  // Some buildings of a painted finish wear one the page makes from a recipe in its colour (content/ruins.ts MADE_FINISHES).
  // What the tool knows of a building is its use (the recipe's name, from its label or its size) and its real height.
  const painted = finish;
  finish = madeFinish(finish as RuinFinish, name, Math.max(1, Math.round(facts.height / 4)), rand3(seed, v.seed, 77), rand3(seed, v.seed, 78));
  if (finish !== painted) matched.push(`made: ${finish}`);
  // A shop's storeys are rounded, not cut short: a 7 m frontage is a shop with rooms above.
  if (v.forms?.[formName]?.facade?.ground === "zstore") height = Math.min(v.budgets.maxHeight, Math.max(4, Math.round(facts.height * retain / 4) * 4));
  return { recipe: name, roofDraw: rand3(seed, v.seed, 79), height, formName, form: v.forms?.[formName], collapse, damage: v.damage?.[collapse], assemblies: v.assemblies, interiors: v.interiors, compositions: v.compositions, finish, feature, holes: Math.min(.45, d.holes ?? holes), wall: d.wall ?? recipe.wall, infill: d.infill, bay: recipe.bay, matched,
    provisional: facts.kindFrom !== "label" || !["osm", "usa_structures", "reviewed_source"].includes(facts.heightFrom) || !!p?.estimated?.length };
}
