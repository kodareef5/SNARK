import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's thrown explosives, and later its clouds (planning/reference/weapons-plan.md, W4 to W6), with how
// each is made. The grenade moved here from content/core.ts unchanged by W0: it still does 788 to bodies and structures
// alike, ARK's figure against wood, until W6 gives it ARK's 175 to bodies and a structure factor of 4.5. Its live prop
// (core:grenade_live) stays in content/core.ts with the other projectile props.

const id = (name: string): string => `core:${name}`;

export const EXPLOSIVES: readonly Def[] = [
  // ark.wiki.gg, Grenade, infobox and text, 2026-11-15: weight 0.5, stacksize 10; it "detonates 5 seconds after the pin is
  // pulled". Its damage and reach (175 within 6 m to bodies) are W6's, with the structure factor of D435; until then the
  // 788 within 5 m stands (DEV31).
  { type: "item", class: "weapon", id: id("grenade"), stack: 10, weight: 0.5, color: 7, weapon: { kind: "thrown", damage: 788, type: "explosive", speed: 18, fuse: 5, blast: 5, uses: 1, mesh: id("grenade"), hold: "tool" } },

  // From the same infobox on 2026-11-15: requiredlevel 38, engrampoints 20, the ingredients and the Crafting XP shown (its
  // craftingxp 11.4 times the global 4 of patches 253.0 and 313.5). Its 4 oil wait for oil (DEV130); it is made at the smithy,
  // not built (DEV126); the page gives no craftingtime (DEV125). The level, points and oil were in its revision of 2018 too.
  ...making("grenade", "Grenade", 38, 20, 1, 8, [["fiber", 15], ["stone", 20], ["gunpowder", 30], ["hide", 5], ["ingot", 2]], 45.6),
];
