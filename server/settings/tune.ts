// The settings that change what content says, as a tuning.
//
// ARK's keys in, shared/content/tuning.ts's data out: stack sizes, what
// things are made of, engrams, the level tables, how fast a body tires, how
// long things keep and burn, how much a node takes. Names are content ids
// (DEV81). An entry naming something this build does not have, or that makes
// no sense, is passed over and said: it never stops the server.

import type { Registry } from "../../shared/content/registry.ts";
import type { Tuning } from "../../shared/content/tuning.ts";
import { field, isList, toNumber, toSwitch, unquote, type IniList, type IniNode } from "./ini.ts";
import type { Lists } from "./lists.ts";
import type { Rules } from "./rules.ts";

/** The species survivors are: ARK's settings for players are about it, and those for creatures about every other. */
const SURVIVOR = "core:survivor";

const words = (n: IniNode | undefined): string => (typeof n === "string" ? unquote(n) : "");
const number = (n: IniNode | undefined): number => (typeof n === "string" ? toNumber(n) : NaN);
const flag = (n: IniNode | undefined): boolean => typeof n === "string" && toSwitch(n) === true;

/** A line of `(ExperiencePointsForLevel[0]=5,ExperiencePointsForLevel[1]=20,…)` as a level table, or why it is not one. `[0]` is what level 2 takes: level 1 takes nothing. */
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

/**
 * The tuning the rules ask for, and what of them was passed over, in words.
 * Names of content this build does not have are counted by `lists`.
 */
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
    if (lists.index("OverrideNamedEngramEntries", name, "engram") === 0) continue;
    const level = number(field(entry, "EngramLevelRequirement"));
    const cost = number(field(entry, "EngramPointsCost"));
    engrams[name] = { ...(level >= 0 ? { level } : {}), ...(cost >= 0 ? { cost } : {}), ...(flag(field(entry, "EngramHidden")) ? { hidden: true } : {}) };
  }
  for (const entry of rules.list("EngramEntryAutoUnlocks")) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "EngramClassName"));
    const level = number(field(entry, "LevelToAutoUnlock"));
    if (lists.index("EngramEntryAutoUnlocks", name, "engram") === 0) continue;
    if (!(level >= 0)) passed.push(`EngramEntryAutoUnlocks: ${name} wants a LevelToAutoUnlock`);
    else engrams[name] = { ...engrams[name], auto: level };
  }

  // The first line is survivors', the second tames'.
  const tables: (number[] | undefined)[] = [];
  rules.list("LevelExperienceRampOverrides").forEach((entry, k) => {
    if (k > 1 || !isList(entry)) return;
    const made = ramp(entry);
    if (typeof made === "string") passed.push(`LevelExperienceRampOverrides, line ${k + 1}: ${made}`);
    else tables[k] = made;
  });

  // What tires a creature is the general case; survivors are the one species with a setting of their own.
  const stamina = rules.num("DinoCharacterStaminaDrainMultiplier");
  const own = rules.num("PlayerCharacterStaminaDrainMultiplier");
  const points = rules.numbers("OverridePlayerLevelEngramPoints");
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
    spoil: rules.num("GlobalSpoilingTimeMultiplier"),
    fuel: rules.num("FuelConsumptionIntervalMultiplier"),
    nodeHits: rules.num("HarvestHealthMultiplier"),
  };
  return { tuning, passed };
}
