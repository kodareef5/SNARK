import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuinFinish, RuinShape } from "../../content/ruins.ts";
import type { Footprint } from "./statics.ts";
import type { Facts } from "./labels.ts";
import { rand3 } from "./raster.ts";

export interface Recipe {
  bay: number; height: number; retain: number; holes: number; wall: number; accent: RuinFinish; feature: string; play: string;
}
interface Modifier { match: string; accent?: RuinFinish; finish?: RuinFinish; feature?: string; retain?: number; holes?: number; meaning: string; }
export interface Form { plan?: string; marker?: string; terrace?: number; setbacks?: number; shell: string; inside: string; roof: string; front: string; windowEvery: number; }
export interface Assembly { role: string; clearance?: string; passage?: [number, number][]; parts: [RuinShape, number, number, number, RuinFinish | "finish", number?][]; }
export interface Damage { radius: number; retain: number; layers: number; plates?: RuinShape[]; front?: RuinShape; }
interface Choice { id: string; when: { kind?: string[]; recipe?: string[]; district?: string[]; name?: string; areaAbove?: number; areaBelow?: number; heightAbove?: number; heightBelow?: number; waterBelow?: number; waterAbove?: number; builtBefore?: number; neighboursAbove?: number; trades?: string[] }; form?: string; finish?: RuinFinish; collapse?: string[]; }
export interface Composition { operations: ({ op: "stack" | "parts" | "front" | "ribs" | "tower" | "arena" | "portal" | "ring" | "dome"; rect?: number[]; exclude?: number[]; height?: number | null; offset?: number; feature?: string; form?: Form; playable?: number; coreU?: number; hall?: boolean; fromTop?: boolean; parts?: Assembly["parts"]; finish?: RuinFinish; rear?: boolean; width?: number } & Round)[]; }
/** A ring of pieces round a centre, or a dome of such rings: in the footprint's metres, from the ground's height. */
export interface Round { at?: [number, number]; radius?: number; heights?: number[]; y?: number; drum?: number; shape?: RuinShape; arc?: [number, number]; }
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
  street: { spacing: number; chance: number; assemblies: string[]; yardAssemblies: string[]; clusterSpacing: number; clusterChance: number; junctionAssemblies: string[]; edgeAssemblies: string[]; yardClusters: string[] };
  version: number; seed: number; budgets: { maxChunk: number; maxCity: number; maxPlayableFloors: number; maxHeight: number };
  categories: Record<string, string>; recipes: Record<string, Recipe>;
  styles: Modifier[]; periods: Modifier[]; materials: Modifier[]; character: Modifier[];
  eras: { before: number; retain: number; feature: string; meaning: string }[];
  districts: Record<string, { finish: RuinFinish[]; fallback: string; lowRiseFeature?: string; lowRiseBelow?: number; wall?: number; holes?: number; infill?: RuinFinish; }>;
}
export interface Rule {
  event?: { travel: [number, number]; exposure: number; shelter: number };
  party?: number[];
  roofGrowth?: number;
  recipe: string; height: number; finish: RuinFinish; feature: string; holes: number; wall: number; bay: number;
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
  const random = rand3(f.building.id, v.seed, 1);
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
  const height = name === "park" ? 0 : Math.min(v.budgets.maxHeight, Math.max(4, Math.floor(facts.height * retain / 4) * 4));
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
    if (choice.collapse) collapse = choice.collapse[Math.floor(rand3(f.building.id, v.seed, 91) * choice.collapse.length)]!;
    matched.push(choice.id);
  }
  return { recipe: name, height, formName, form: v.forms?.[formName], collapse, damage: v.damage?.[collapse], assemblies: v.assemblies, interiors: v.interiors, compositions: v.compositions, finish, feature, holes: Math.min(.45, d.holes ?? holes), wall: d.wall ?? recipe.wall, infill: d.infill, bay: recipe.bay, matched,
    provisional: facts.kindFrom !== "label" || !["osm", "usa_structures", "reviewed_source"].includes(facts.heightFrom) || !!p?.estimated?.length };
}
