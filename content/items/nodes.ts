import type { NodeDef, ShapeBox } from "../../shared/content/defs.ts";

// The nodes the stations wave's resources come from (planning/reference/stations-plan.md, "What waits on map nodes"): oil
// rocks, crystal, obsidian rocks and clams, as the reference game has them at 1x (ark.wiki.gg, read 2026-11-15: Oil,
// Crystal, Obsidian, Silica Pearls). The pick is the tool of every rock here, as it is of our others (`tool.on: "stone"`);
// a hatchet or a fist gets only what any blow gets. Each node grows back in an hour. The obsidian that metal rocks
// give is on `core:metal_rock` in content/core.ts. Where they grow: shared/world/proving.ts on the proving ground,
// tools/mapworld/nodes.ts on the city maps.

/** Real minutes, as the hours of 140 seconds that regrowing is written in (content/core.ts has the same). */
const minutes = (n: number): number => (n * 60) / 140;
const REGROW = minutes(60);

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ShapeBox =>
  ({ at: [x, y, z], half: [hx, hy, hz] });

function variant(name: string, boxes: ShapeBox[], mined: ShapeBox[]): NonNullable<NodeDef["variants"]>[number] {
  const mesh = `core:${name}`;
  return { mesh, boxes, depleted: { mesh: `${mesh}_depleted`, boxes: mined } };
}

const OIL_ROCKS = [
  variant("oil_rock_1", [
    box(0, .24, .04, .75, .24, .42), box(-.045, .25, .04, .405, .25, .69),
    box(-.05, .365, .005, .53, .365, .415), box(-.21, .51, .02, .22, .51, .25),
  ], [
    box(0, .0775, .03, .75, .0775, .44), box(-.035, .085, .04, .425, .085, .67),
    box(-.025, .14, .095, .355, .14, .355), box(.66, .05, .49, .13, .05, .14),
  ]),
  variant("oil_rock_2", [
    box(-.025, .20, -.055, .735, .20, .285), box(.01, .225, -.045, .38, .225, .605),
    box(.055, .36, -.06, .535, .36, .42), box(.305, .495, -.15, .205, .495, .30),
  ], [
    box(-.04, .075, -.025, .72, .075, .315), box(.09, .08, -.025, .39, .08, .595),
    box(.28, .133, -.24, .29, .133, .27), box(-.71, .058, .34, .13, .058, .16),
  ]),
];

const CRYSTAL_ROCKS = [
  variant("crystal_rock_1", [
    box(-.035, .092, -.012, .327, .092, .259), box(-.146, .835, -.072, .108, .675, .096),
    box(.172, .669, .018, .093, .520, .089), box(-.057, .428, .167, .074, .285, .092),
  ], [
    box(-.030, .070, -.005, .327, .070, .257),
    box(-.124, .212, -.057, .109, .104, .092), box(.096, .171, -.014, .088, .084, .085),
  ]),
  variant("crystal_rock_2", [
    box(.002, .084, .016, .293, .084, .261), box(.053, .527, .032, .110, .394, .111),
    box(-.176, .415, -.164, .106, .283, .098), box(.213, .367, .181, .101, .236, .101),
  ], [
    box(.011, .065, .014, .294, .065, .270), box(.028, .201, .016, .110, .106, .110),
    box(-.147, .149, -.132, .097, .083, .086), box(.164, .153, .135, .083, .089, .078),
  ]),
];

const OBSIDIAN_ROCKS = [
  variant("obsidian_rock_1", [
    box(-.275, .245, -.055, .465, .245, .435), box(-.495, .435, -.10, .245, .435, .30),
    box(.455, .27, -.065, .305, .27, .285), box(.175, .12, .455, .335, .12, .225),
  ], [
    box(-.225, .085, -.055, .475, .085, .445), box(-.39, .125, -.065, .23, .125, .295),
    box(.465, .08, -.025, .305, .08, .295), box(.165, .06, .485, .275, .06, .185),
  ]),
  variant("obsidian_rock_2", [
    box(.125, .23, -.095, .635, .23, .385), box(.30, .38, -.165, .35, .38, .325),
    box(-.445, .235, .32, .275, .235, .28), box(.41, .16, .415, .27, .16, .165),
  ], [
    box(.14, .08, -.105, .64, .08, .385), box(.34, .115, -.12, .30, .115, .34),
    box(-.445, .075, .33, .265, .075, .27), box(.425, .0625, .44, .275, .0625, .15),
  ]),
];

const CLAMS = [
  variant("clam_1", [
    box(-.006, .044, .071, .194, .044, .064), box(.014, .086, -.056, .197, .079, .074),
  ], [
    box(-.013, .037, .080, .193, .037, .071), box(.011, .042, -.070, .195, .042, .079),
  ]),
  variant("clam_2", [
    box(.005, .035, .032, .202, .035, .119), box(-.011, .108, -.046, .171, .080, .079),
    box(-.019, .033, -.138, .117, .032, .026),
  ], [
    box(.016, .035, .064, .195, .035, .097), box(-.013, .031, -.088, .168, .031, .088),
  ]),
];

export const RESOURCE_NODES: readonly NodeDef[] = [
  // Oil: "harvested from dark stones near oil patches in the ocean by using a Pickaxe"; "The Stone Pick yields 0-1 oil per
  // oil node, while the Metal Pick yields 0-10", which is a hit's, so `flat`: the stone pick's 3 does not multiply it.
  // "The highest density of oil nodes can be found in underwater caves", and they lie "all around the map in the oceans",
  // so it grows under the sea. The stone any blow gets, its 15 hits (a metal rock's) and its size are chosen.
  { type: "node", id: "core:oil_rock", mesh: "box", variants: OIL_ROCKS, color: 23, half: [1, 0.6, 0.9], hits: 15, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:oil", min: 0, max: 1, tool: true, flat: true }], xp: 1, size: [0.8, 1.2], sea: "under" },
  // Crystal: "mining white crystals", "best gathered with a metal pick", "stone picks can work but provide a very low drop
  // chance", so with the stone pick a hit gets none or one, not multiplied (`flat`). It is found in mountains and caves and,
  // since 180.0, under the sea ("New Mountain & Underwater Crystal"), so it grows on either. A pale outcrop taller than it
  // is wide. Its 10 hits (a limestone rock's), the stone any blow gets and its size are chosen: about 5 crystal a stone
  // pick a node, where an Ascended data site gives about 8 at its ice caves (wikily.gg, unverified for Evolved).
  { type: "node", id: "core:crystal_rock", mesh: "box", variants: CRYSTAL_ROCKS, color: 76, half: [0.5, 0.9, 0.5], hits: 10, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:crystal", min: 0, max: 1, tool: true, flat: true }], xp: 1, size: [0.8, 1.2], sea: "either" },
  // Obsidian: "found in caves and on mountains in smooth, black rocks", rich "at and around the summit" of Whitesky Peak and
  // the volcano, gathered best by the metal pick among tools. The page gives no stone-pick figure, so a pick gets it as it
  // gets a metal rock's ore, 1 to 3 a hit times its 3, and any blow stone. Its 15 hits and its size are chosen.
  { type: "node", id: "core:obsidian_rock", mesh: "box", variants: OBSIDIAN_ROCKS, color: 11, half: [0.9, 0.6, 0.8], hits: 15, respawnHours: REGROW, material: "stone", yields: [{ item: "core:stone", min: 1, max: 2 }, { item: "core:obsidian", min: 1, max: 3, tool: true }], xp: 1, size: [0.8, 1.2] },
  // Silica pearls: "found in clams, which are usually found in groups of around 5"; "Each clam usually yields between 2 and 4
  // Pearls"; "There is no tool needed to harvest them, they are picked up by hand"; "in the deepest areas of the ocean". So
  // a clam is picked once, by hand, for 2 to 4, and grows under the sea; a swing does nothing to it. Its size is chosen.
  { type: "node", id: "core:clam", mesh: "box", variants: CLAMS, color: 81, half: [0.25, 0.1, 0.2], soft: true, hits: 1, respawnHours: REGROW, yields: [{ item: "core:silica_pearls", min: 2, max: 4 }], xp: 0.5, size: [0.8, 1.25], sea: "under" },
];
