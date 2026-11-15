import type { NodeDef } from "../../shared/content/defs.ts";

// The nodes the stations wave's resources come from (planning/reference/stations-plan.md, "What waits on map nodes"): oil
// rocks, crystal, obsidian rocks and clams, as the reference game has them at 1x (ark.wiki.gg, read 2026-11-15: Oil,
// Crystal, Obsidian, Silica Pearls). The pick is the tool of every rock here, as it is of our others (`tool.on: "stone"`);
// a hatchet or a fist gets only what any blow gets. Where a page gives no number, the line says chosen. Each is a grey box
// of its own colour until its art comes, and grows back in the hour every node does (D293). The obsidian that metal rocks
// give is on `core:metal_rock` in content/core.ts. Where they grow: shared/world/proving.ts on the proving ground,
// tools/mapworld/nodes.ts on the city maps.

/** Real minutes, as the hours of 140 seconds that regrowing is written in (content/core.ts has the same). */
const minutes = (n: number): number => (n * 60) / 140;
const REGROW = minutes(60);

export const RESOURCE_NODES: readonly NodeDef[] = [
  // Oil: "harvested from dark stones near oil patches in the ocean by using a Pickaxe"; "The Stone Pick yields 0-1 oil per
  // oil node, while the Metal Pick yields 0-10", which is a hit's, so `flat`: the stone pick's 3 does not multiply it.
  // "The highest density of oil nodes can be found in underwater caves", and they lie "all around the map in the oceans",
  // so it grows under the sea. The stone any blow gets, its 15 hits (a metal rock's) and its size are chosen.
  { type: "node", id: "core:oil_rock", mesh: "box", color: 23, half: [1, 0.6, 0.9], hits: 15, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:oil", min: 0, max: 1, tool: true, flat: true }], xp: 1, size: [0.8, 1.2], sea: "under" },
  // Crystal: "mining white crystals", "best gathered with a metal pick", "stone picks can work but provide a very low drop
  // chance", so with the stone pick a hit gets none or one, not multiplied (`flat`). It is found in mountains and caves and,
  // since 180.0, under the sea ("New Mountain & Underwater Crystal"), so it grows on either. A pale outcrop taller than it
  // is wide. Its 10 hits (a limestone rock's), the stone any blow gets and its size are chosen: about 5 crystal a stone
  // pick a node, where an Ascended data site gives about 8 at its ice caves (wikily.gg, unverified for Evolved).
  { type: "node", id: "core:crystal_rock", mesh: "box", color: 76, half: [0.5, 0.9, 0.5], hits: 10, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:crystal", min: 0, max: 1, tool: true, flat: true }], xp: 1, size: [0.8, 1.2], sea: "either" },
  // Obsidian: "found in caves and on mountains in smooth, black rocks", rich "at and around the summit" of Whitesky Peak and
  // the volcano, gathered best by the metal pick among tools. The page gives no stone-pick figure, so a pick gets it as it
  // gets a metal rock's ore, 1 to 3 a hit times its 3, and any blow stone. Its 15 hits and its size are chosen.
  { type: "node", id: "core:obsidian_rock", mesh: "box", color: 11, half: [0.9, 0.6, 0.8], hits: 15, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 2 }, { item: "core:obsidian", min: 1, max: 3, tool: true }], xp: 1, size: [0.8, 1.2] },
  // Silica pearls: "found in clams, which are usually found in groups of around 5"; "Each clam usually yields between 2 and 4
  // Pearls"; "There is no tool needed to harvest them, they are picked up by hand"; "in the deepest areas of the ocean". So
  // a clam is picked once, by hand, for 2 to 4, and grows under the sea; a swing does nothing to it. Its size is chosen.
  { type: "node", id: "core:clam", mesh: "box", color: 81, half: [0.25, 0.1, 0.2], soft: true, hits: 1, respawnHours: REGROW, yields: [{ item: "core:silica_pearls", min: 2, max: 4 }], xp: 0.5, size: [0.8, 1.25], sea: "under" },
];
