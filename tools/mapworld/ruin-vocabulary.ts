import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuinFinish } from "../../content/miami-ruins.ts";
import type { Footprint } from "./statics.ts";
import type { Facts } from "./labels.ts";
import { rand3 } from "./raster.ts";

export interface Recipe {
  bay: number; height: number; retain: number; holes: number; wall: number; accent: RuinFinish; feature: string; play: string;
}
interface Modifier { match: string; accent?: RuinFinish; finish?: RuinFinish; feature?: string; retain?: number; holes?: number; meaning: string; }
export interface Vocabulary {
  version: number; seed: number; budgets: { maxChunk: number; maxCity: number; maxPlayableFloors: number; maxHeight: number };
  categories: Record<string, string>; recipes: Record<string, Recipe>;
  styles: Modifier[]; periods: Modifier[]; materials: Modifier[]; character: Modifier[];
  eras: { before: number; retain: number; feature: string; meaning: string }[];
  districts: Record<string, { finish: RuinFinish[]; fallback: string; lowRiseFeature?: string; lowRiseBelow?: number; }>;
}
export interface Rule {
  recipe: string; height: number; finish: RuinFinish; feature: string; holes: number; wall: number; bay: number;
  matched: string[]; provisional: boolean;
}
export const vocabulary = (source: string): Vocabulary => JSON.parse(readFileSync(join(source, "ruins/vocabulary.json"), "utf8")) as Vocabulary;

export function ruleFor(f: Footprint, v: Vocabulary, facts: Facts): Rule {
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
  return { recipe: name, height, finish, feature, holes: Math.min(.45, holes), wall: recipe.wall, bay: recipe.bay, matched,
    provisional: facts.kindFrom !== "label" || !["osm", "usa_structures"].includes(facts.heightFrom) || !!p?.estimated?.length };
}
