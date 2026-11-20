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
    beatable: true,
  },
};

/** Melee weapons, best first. */
export const MELEE = ["stone_pick", "stone_hatchet"];
