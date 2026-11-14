// Turns the settings that change content into a Tuning (shared/content/tuning.ts). Names are content ids (DEV81). An entry that names
// something this build does not have, or that makes no sense, is skipped and reported. It never stops the server.

import type { Registry } from "../../shared/content/registry.ts";
import type { Tuning } from "../../shared/content/tuning.ts";
import { field, isList, toNumber, toSwitch, unquote, type IniList, type IniNode } from "./ini.ts";
import type { Lists } from "./lists.ts";
import type { Rules } from "./rules.ts";
import { rowOf } from "./catalog.ts";
import type { StatName } from "../../shared/sim/genome.ts";

/** ARK's player settings apply to this species, and its creature settings to every other. */
const SURVIVOR = "core:survivor";

const words = (n: IniNode | undefined): string => (typeof n === "string" ? unquote(n) : "");
const number = (n: IniNode | undefined): number => (typeof n === "string" ? toNumber(n) : NaN);
const flag = (n: IniNode | undefined): boolean => typeof n === "string" && toSwitch(n) === true;

/** ARK's index order for stats, under this engine's names. */
export const ARK_STATS: readonly StatName[] = ["health", "stamina", "torpidity", "oxygen", "food", "water", "temperature", "weight", "melee", "speed", "fortitude", "crafting"];

/**
 * Each factor is the value over ARK's default, so a server at ARK's defaults changes nothing. With `zeroIsOne` a 0 is read
 * as 1, as ARK does for the per-level multipliers. A stat whose default is 0, or that is left at its default, is skipped.
 */
function factors(rules: Rules, name: string, zeroIsOne: boolean): Record<string, number> {
  const defaults = rowOf(name)!.def as readonly number[];
  const values = rules.indexed(name);
  const out: Record<string, number> = {};
  ARK_STATS.forEach((stat, i) => {
    const d = defaults[i]!;
    const v = values[i] === 0 && zeroIsOne ? 1 : values[i]!;
    if (d > 0 && v > 0 && v !== d) out[stat] = v / d;
  });
  return out;
}

/** Returns the level table, or a string saying why the line is not one. `[0]` is what level 2 takes, since level 1 takes nothing. */
function ramp(entry: IniList): number[] | string {
  const xp = [0];
  for (const item of entry.items) {
    const at = /^ExperiencePointsForLevel\[(\d+)\]$/i.exec(item.key);
    const v = number(item.value);
    if (!at) return `"${item.key}" is not ExperiencePointsForLevel[n]`;
    if (Number(at[1]) !== xp.length - 1) return `its levels are not in order at [${at[1]}]`;
    if (!(v > xp[xp.length - 1]!)) return `[${at[1]}] does not take more than the level before it`;
    xp.push(v);
  }
  return xp.length < 2 ? "it names no level" : xp;
}

/** `passed` lists what was skipped, in words. `lists` counts the names of content this build does not have. */
export function tuningOf(rules: Rules, lists: Lists, reg: Registry): { tuning: Tuning; passed: string[] } {
  const passed: string[] = [];
  const stacks: Record<string, { n: number; plain?: boolean }> = {};
  for (const entry of rules.list("ConfigOverrideItemMaxQuantity")) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "ItemClassString"));
    const q = field(entry, "Quantity");
    const n = isList(q) ? number(field(q, "MaxItemQuantity")) : NaN;
    if (lists.index("ConfigOverrideItemMaxQuantity", name, "item") === 0) continue;
    if (!(n >= 1)) passed.push(`ConfigOverrideItemMaxQuantity: ${name} wants a MaxItemQuantity of at least 1`);
    else stacks[name] = isList(q) && flag(field(q, "bIgnoreMultiplier")) ? { n, plain: true } : { n };
  }

  const costs: Record<string, { item: string; count: number }[]> = {};
  for (const entry of rules.list("ConfigOverrideItemCraftingCosts")) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "ItemClassString"));
    const of = field(entry, "BaseCraftingResourceRequirements");
    if (lists.index("ConfigOverrideItemCraftingCosts", name, "item") === 0) continue;
    const needs: { item: string; count: number }[] = [];
    for (const one of isList(of) ? of.items : []) {
      if (!isList(one.value)) continue;
      const item = words(field(one.value, "ResourceItemTypeString"));
      const count = number(field(one.value, "BaseResourceRequirement"));
      if (lists.index("ConfigOverrideItemCraftingCosts", item, "item") === 0) continue;
      if (!(count > 0)) passed.push(`ConfigOverrideItemCraftingCosts: ${name} wants more than none of ${item}`);
      else needs.push({ item, count });
    }
    if (reg.recipeOf[reg.index.get(name)!] === null) passed.push(`ConfigOverrideItemCraftingCosts: nothing here makes ${name}`);
    else if (needs.length === 0) passed.push(`ConfigOverrideItemCraftingCosts: ${name} must be made of something`);
    else costs[name] = needs;
  }

  const engrams: Record<string, { level?: number; cost?: number; hidden?: boolean; auto?: number }> = {};
  for (const entry of rules.list("OverrideNamedEngramEntries")) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "EngramClassName"));
    const level = number(field(entry, "EngramLevelRequirement"));
    const cost = number(field(entry, "EngramPointsCost"));
    for (const id of lists.ids("OverrideNamedEngramEntries", name, "engram")) engrams[id] = { ...(level >= 0 ? { level } : {}), ...(cost >= 0 ? { cost } : {}), ...(flag(field(entry, "EngramHidden")) ? { hidden: true } : {}) };
  }
  for (const entry of rules.list("EngramEntryAutoUnlocks")) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "EngramClassName"));
    const level = number(field(entry, "LevelToAutoUnlock"));
    const ids = lists.ids("EngramEntryAutoUnlocks", name, "engram");
    if (ids.length === 0) continue;
    if (!(level >= 0)) passed.push(`EngramEntryAutoUnlocks: ${name} wants a LevelToAutoUnlock`);
    else for (const id of ids) engrams[id] = { ...engrams[id], auto: level };
  }

  // The first line is survivors', the second tames'.
  const tables: (number[] | undefined)[] = [];
  rules.list("LevelExperienceRampOverrides").forEach((entry, k) => {
    if (k > 1 || !isList(entry)) return;
    const made = ramp(entry);
    if (typeof made === "string") passed.push(`LevelExperienceRampOverrides, line ${k + 1}: ${made}`);
    else tables[k] = made;
  });

  // The creature stamina drain is the general case. Survivors are the one species with a separate setting.
  const stamina = rules.num("DinoCharacterStaminaDrainMultiplier");
  const own = rules.num("PlayerCharacterStaminaDrainMultiplier");
  const points = rules.numbers("OverridePlayerLevelEngramPoints");
  // Creatures are the general case. The survivor settings replace the creatures' for survivors, even when left at their defaults.
  const wild = factors(rules, "PerLevelStatsMultiplier_DinoWild", true);
  const tamed = factors(rules, "PerLevelStatsMultiplier_DinoTamed", true);
  const spent = factors(rules, "PerLevelStatsMultiplier_Player", true);
  const base = factors(rules, "PlayerBaseStatMultipliers", false);
  const some = (o: Record<string, number>): boolean => Object.keys(o).length > 0;
  const creatures = { ...(some(wild) ? { wild } : {}), ...(some(tamed) ? { tamed } : {}) };
  const people = { ...(some(spent) ? { tamed: spent } : {}), ...(some(base) ? { base } : {}) };
  const tuning: Tuning = {
    stack: rules.num("ItemStackSizeMultiplier"),
    stacks,
    costs,
    engrams,
    autoAll: rules.on("bAutoUnlockAllEngrams"),
    onlyNamed: rules.on("bOnlyAllowSpecifiedEngrams"),
    ...(tables[0] ? { xp: tables[0] } : {}),
    ...(tables[1] ? { tameXp: tables[1] } : {}),
    most: rules.num("OverrideMaxExperiencePointsPlayer"),
    tameMost: rules.num("OverrideMaxExperiencePointsDino"),
    ...(points.length > 0 ? { points: [...points] } : {}),
    stamina,
    ...(own !== stamina ? { staminaOf: { [SURVIVOR]: own } } : {}),
    ...(some(wild) || some(tamed) ? { gains: creatures } : {}),
    ...(some(wild) || some(tamed) || some(spent) || some(base) ? { gainsOf: { [SURVIVOR]: people } } : {}),
    spoil: rules.num("GlobalSpoilingTimeMultiplier"),
    fuel: rules.num("FuelConsumptionIntervalMultiplier"),
    nodeHits: rules.num("HarvestHealthMultiplier"),
  };
  return { tuning, passed };
}

/** The value of ARK's later maps. With ARK's default offset it gives wild creatures up to level 150. */
export const MAP_DIFFICULTY = 5;

/** The offset goes through ARK's formula for the map unless OverrideOfficialDifficulty is above 0. */
export function difficultyOf(rules: Rules): number {
  const said = rules.num("OverrideOfficialDifficulty");
  return said > 0 ? said : Math.max(0, rules.num("DifficultyOffset") * (MAP_DIFFICULTY - 0.5) + 0.5);
}

/** `step` is 1 to 30. */
export function wildLevel(step: number, difficulty: number): number {
  return Math.max(1, Math.floor(step * difficulty));
}
