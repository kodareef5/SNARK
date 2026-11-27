// What the lab knows of a point by its name: the profiles its tables may be of, their hand rules, how it adds its passes,
// and which families and maps train it, stop it and are held out. The toy's points start "toy."; every other is the game's.

import { MIX_FAR, MIX_MID, MIX_NEAR, STICK } from "../../server/decide/nav.ts";
import type { Model } from "../../shared/decide/forward.ts";
import { PROFILES, RING_FAR, RING_MID, RING_NEAR } from "../../shared/decide/profiles.ts";
import { RULES } from "../../shared/decide/rules.ts";
import type { Catalog, Split } from "./fit.ts";
import { TOY_CATALOG } from "./toy.ts";

/** The game's families (setups.ts). `pen` and the Miami slice are held out; `blocker` stops training and fits the temperature. */
export const FAMILIES = ["trees", "deadEnd", "pen", "water", "blocker", "crowd"] as const;
export const SPLIT: Split = { held: ["pen"], heldMaps: ["miami"], validation: ["blocker"] };

/** The stuck ladder's points (server/decide/nav.ts), found by name on a host's decider and always decided together. */
export const NAV_POINTS: readonly string[] = ["nav.snag", "nav.ring", "nav.reach", "nav.probe", "nav.do"];

export const GAME_CATALOG: Catalog = {
  profiles: PROFILES, rules: new Map<string, Model>(RULES.map((m) => [m.profile, m])), split: SPLIT,
  passes: { "nav.ring": { mix: { [RING_FAR.name]: MIX_FAR, [RING_MID.name]: MIX_MID, [RING_NEAR.name]: MIX_NEAR }, stick: STICK } },
};

export function catalog(point: string): Catalog {
  return point.startsWith("toy.") ? TOY_CATALOG : GAME_CATALOG;
}
