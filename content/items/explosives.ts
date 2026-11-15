import type { Def } from "../../shared/content/defs.ts";
import { making } from "../craft.ts";

// The weapons program's thrown explosives, and later its clouds (planning/reference/weapons-plan.md, W4 to W6), with how
// each is made. The grenade moved here from content/core.ts unchanged by W0: it still does 788 to bodies and structures
// alike, ARK's figure against wood, until W6 gives it ARK's 175 to bodies and a structure factor of 4.5. Its live prop
// (core:grenade_live) stays in content/core.ts with the other projectile props.

const id = (name: string): string => `core:${name}`;

export const EXPLOSIVES: readonly Def[] = [
  { type: "item", class: "weapon", id: id("grenade"), stack: 10, weight: 1, color: 7, weapon: { kind: "thrown", damage: 788, type: "explosive", speed: 18, fuse: 5, blast: 5, uses: 1, mesh: id("grenade"), hold: "tool" } },

  // The level is the reference game's.
  ...making("grenade", "Grenade", 42, 20, 1, 8, [["fiber", 15], ["stone", 20], ["gunpowder", 30], ["hide", 5], ["ingot", 2]]),
];
