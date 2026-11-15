import type { Def } from "../../shared/content/defs.ts";
import { crafting, making } from "../craft.ts";

// The weapons program's thrown explosives, and later its clouds (planning/reference/weapons-plan.md, W4 to W6), with how
// each is made. The grenade moved here from content/core.ts unchanged by W0: it still does 788 to bodies and structures
// alike, ARK's figure against wood, until W6 gives it ARK's 175 to bodies and a structure factor of 4.5. Its live prop
// (core:grenade_live) stays in content/core.ts with the other projectile props.

const id = (name: string): string => `core:${name}`;
const needs = (list: readonly (readonly [string, number])[]): { item: string; count: number }[] => list.map(([item, count]) => ({ item: id(item), count }));

export const EXPLOSIVES: readonly Def[] = [
  { type: "item", class: "weapon", id: id("grenade"), stack: 10, weight: 1, color: 7, weapon: { kind: "thrown", damage: 788, type: "explosive", speed: 18, fuse: 5, blast: 5, uses: 1, mesh: id("grenade"), hold: "tool" } },

  // The level is the reference game's.
  ...making("grenade", "Grenade", 42, 20, 1, 8, [["fiber", 15], ["stone", 20], ["gunpowder", 30], ["hide", 5], ["ingot", 2]]),

  // W5's clouds (server/clouds.ts, client/core/render/clouds.ts). Each grenade does no harm of its own and goes off on its
  // fuse into a cloud that stays where it went off.
  //
  // ark.wiki.gg/wiki/Smoke_Grenade (2026-11-15): "Instead of dealing damage", a cloud that obscures what is inside it for
  // "around 40 seconds", "a radius of roughly 3 foundations" (a foundation is 3 m: 9 m), and it does not hide its thrower
  // from wild creatures; a 5 s fuse; weighs 0.5, stacks to 10; level 24 for 18 points, 11.35 xp, made in the inventory
  // of 1 metal ingot, 10 charcoal, 2 wood, 6 hide, 3 flint, 15 fiber, 5 thatch and 5 sparkpowder, after Sparkpowder. Its
  // height and its making time are on no page: 5 m, so it stands over a survivor, and the grenade's 8 s. Charcoal waits for
  // its item (items-ark.md, refined materials), so the recipe leaves it out (DEV131).
  { type: "item", class: "weapon", id: id("grenade_smoke"), label: "smoke grenade", stack: 10, weight: 0.5, color: 2, weapon: { kind: "thrown", speed: 18, fuse: 5, uses: 1, mesh: id("grenade"), hold: "tool", cloud: { prop: id("cloud_smoke"), seconds: 40 } } },
  { type: "prop", class: "cloud", id: id("cloud_smoke"), mesh: "box", color: 2, radius: 9, height: 5 },
  crafting(id("grenade_smoke"), { needs: needs([["ingot", 1], ["wood", 2], ["hide", 6], ["flint", 3], ["fiber", 15], ["thatch", 5], ["sparkpowder", 5]]), seconds: 8, xp: 11.35 }),
  { type: "engram", id: id("engram-grenade_smoke"), label: "Smoke grenade", level: 24, cost: 18, item: id("grenade_smoke"), requires: [id("engram-sparkpowder")] },

  // ark.wiki.gg/wiki/Poison_Grenade (2026-11-15): narcotic gas that "rapidly increases the Torpor of enemy survivors";
  // "creatures are completely immune"; a 2.5 s fuse; in PvE only its thrower and the thrower's tribe (228.2); weighs 1.5,
  // stacks to 10; level 40 for 18 points, 8.25 xp, made at the fabricator of 10 narcotic, 14 charcoal, 5 metal ingot, 18
  // sparkpowder, 12 gunpowder, 5 crystal, 20 fiber and 5 flint, after the smoke grenade and the tripwire narcotic trap. Its
  // torpor, harm, time and reach are on no page (217.2 made it last 15% longer, 218.3 gave 25% more torpor and 20% more
  // reach): 25 torpor a second and no harm, 20 s, 6 m and 4 m high, chosen (DEV132). The gas mask that stops it (Gas Mask)
  // is not built. The fabricator is not built, so it is made in the hand; charcoal and crystal wait for their items (DEV131).
  { type: "item", class: "weapon", id: id("grenade_poison"), label: "poison grenade", stack: 10, weight: 1.5, color: 17, weapon: { kind: "thrown", speed: 18, fuse: 2.5, uses: 1, mesh: id("grenade"), hold: "tool", cloud: { prop: id("cloud_poison"), seconds: 20, buff: id("poisoned") } } },
  { type: "prop", class: "cloud", id: id("cloud_poison"), mesh: "box", color: 17, radius: 6, height: 4 },
  // Given for a little over half a second at a time by the cloud a survivor stands in (server/clouds.ts CLOUD_HOLD).
  { type: "buff", id: id("poisoned"), label: "Poisoned", color: 17, seconds: 0.7, torpor: 25 },
  crafting(id("grenade_poison"), { needs: needs([["narcotic", 10], ["ingot", 5], ["sparkpowder", 18], ["gunpowder", 12], ["fiber", 20], ["flint", 5]]), seconds: 8, xp: 8.25 }),
  { type: "engram", id: id("engram-grenade_poison"), label: "Poison grenade", level: 40, cost: 18, item: id("grenade_poison"), requires: [id("engram-grenade_smoke")] },
];
