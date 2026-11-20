// What a player of the game knows without having to learn it in play: how a fight with each creature goes. A real
// game supplies its own (its wiki, its data); these are the mock world's. The character's own fights, once it has
// had some, count for more than this.

export interface CreatureLore {
  /** A fight for a character at full health with a melee weapon (a hatchet, a pick). */
  armed: string;
  /** The same, bare-handed. */
  unarmed: string;
  /** Whether an armed character at full health beats one. */
  beatable: boolean;
}

export const CREATURES: Record<string, CreatureLore> = {
  raptor: { armed: "a fair fight: about 7 swings, and it costs about a third of your health", unarmed: "a losing fight", beatable: true },
};

export const WEAPONS = ["stone_pick", "stone_hatchet"];
