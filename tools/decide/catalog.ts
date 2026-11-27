// What the lab knows of a point by its name: the profiles its tables may be of, their hand rules, and which families
// and maps train it, stop it and are held out. The toy's points start "toy."; every other is the game's.

import type { Model } from "../../shared/decide/forward.ts";
import { PROFILES } from "../../shared/decide/profiles.ts";
import { RULES } from "../../shared/decide/rules.ts";
import type { Catalog, Split } from "./fit.ts";
import { TOY_CATALOG } from "./toy.ts";

/** The game's families (setups.ts). `pen` and the Miami slice are held out; `blocker` stops training and fits the temperature. */
export const FAMILIES = ["trees", "deadEnd", "pen", "water", "blocker", "crowd"] as const;
export const SPLIT: Split = { held: ["pen"], heldMaps: ["miami"], validation: ["blocker"] };

export const GAME_CATALOG: Catalog = { profiles: PROFILES, rules: new Map<string, Model>(RULES.map((m) => [m.profile, m])), split: SPLIT };

export function catalog(point: string): Catalog {
  return point.startsWith("toy.") ? TOY_CATALOG : GAME_CATALOG;
}
