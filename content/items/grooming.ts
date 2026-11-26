import type { Def } from "../../shared/content/defs.ts";
import { HAIR_BASE } from "../../shared/pack/palette.ts";

// Scissors and hair dyes (server/people/look.ts). They are given, not made, until their recipes are chosen; every number
// is chosen. A hair dye's colour is one of the look's hair colours (shared/pack/palette.ts).

const dye = (name: string, label: string, hair: number): Def => ({ type: "item", class: "dye", id: `core:hair_dye_${name}`, stack: 10, weight: 0.1, label: `${label} hair dye`, color: HAIR_BASE + hair, groom: { hair } });

export const GROOMING: readonly Def[] = [
  { type: "item", class: "scissors", id: "core:scissors", stack: 1, weight: 0.3, label: "scissors", color: 13, groom: { cut: true } },
  dye("blond", "blond", 0),
  dye("ginger", "ginger", 2),
  dye("brown", "brown", 3),
  dye("black", "black", 6),
  dye("white", "white", 8),
  dye("red", "red", 9),
];
