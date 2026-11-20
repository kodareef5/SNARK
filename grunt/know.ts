// What a player of the game knows without having to learn it in play: how a fight with each creature goes, alone and
// in a pack, with a melee weapon, a bow, or bare hands. A real game supplies its own (its wiki, its data); these are
// the mock world's. The character's own fights, once it has had some, count for more than this.

export interface CreatureLore {
  /** One, for a character at full health with a melee weapon (a hatchet, a pick). */
  armed: string;
  /** One, with a bow and arrows, from range. */
  ranged: string;
  /** One, bare-handed. */
  unarmed: string;
  /** Several together, with a melee weapon; with a bow. */
  pack_armed: string;
  pack_ranged: string;
  /** From the back of a mount that fights (a tame raptor), alone and in a pack. */
  mounted: string;
  pack_mounted: string;
  /** Whether an armed character at full health beats one. */
  beatable: boolean;
}

export const CREATURES: Record<string, CreatureLore> = {
  raptor: {
    armed: "a fair fight: about 6 swings, and it costs about a third of your health",
    ranged: "a good fight from range: about 4 arrows, and it seldom reaches you",
    unarmed: "a losing fight",
    pack_armed: "a losing fight in melee: run, or fight them from range",
    pack_ranged: "fair from range if you keep moving: about 4 arrows each",
    mounted: "a good fight from the saddle: your mount's bite kills it in about 4, and it takes the bites, not you",
    pack_mounted: "fair from the saddle while your mount's health holds: break off below a quarter",
    beatable: true,
  },
};

/** What a player calls each kind of thing in the games grunt has met: a role, and the item names that fill it in each
 * (the mock's first, then SNARK's), best first. */
export const ROLES: Record<"pick" | "hatchet" | "bow" | "arrow" | "food" | "berries", string[]> = {
  pick: ["stone_pick", "pick", "metal_pick"],
  hatchet: ["stone_hatchet", "hatchet", "metal_hatchet"],
  bow: ["bow", "crossbow"],
  arrow: ["arrow", "arrow_stone"],
  food: ["berries", "berry", "meat", "cooked_meat"],
  berries: ["berries", "berry"],
};

/** Melee weapons, best first. */
export const MELEE = [...ROLES.pick, ...ROLES.hatchet, "club"];

/** How many of a role the bag holds, whichever names fill it. */
export function holding(count: (item: string) => number, role: keyof typeof ROLES): number {
  return ROLES[role].reduce((n, item) => n + count(item), 0);
}
