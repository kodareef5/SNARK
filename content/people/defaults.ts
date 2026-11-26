// The built-in populations: who the city's crowds and the bots are made of, until admins edit their own. Weights follow
// the look's lists: skin tones lightest first; hair styles bald, buzzed, parted, long, buns, fade, coils, tied; hair
// colours blond, dark blond, ginger, brown, dark brown, near black, black, grey, white, dyed red; eyes brown, dark
// brown, blue, green, grey, amber.

import type { Outfit, PopulationDef } from "../../shared/content/kinds/populations.ts";

// Colours a piece is dyed from, as palette numbers (shared/pack/palette.ts): 10 white, 11 black, 22 to 81 the dyes in
// five rows of twelve hues, dark to light, then the natural tones.
const TEES = [10, 10, 11, 84, 87, 89, 105, 30, 41, 34, 22, 38, 47, 65, 77];
const BRIGHT = [10, 46, 47, 48, 52, 53, 58, 64, 65, 69, 70, 72, 76, 81];
const MUTED = [10, 11, 84, 85, 87, 98, 105, 116, 129, 30, 22, 41, 137, 163];
const RUGGED = [11, 84, 87, 96, 98, 117, 128, 138, 148, 156, 164, 172, 179];
const HOODIES = [11, 84, 87, 89, 30, 22, 29, 34, 137, 117];
const DENIM = [29, 29, 41, 30, 82, 85, 88];
const SHORTS = [121, 123, 124, 166, 168, 129, 30, 41, 11, 85];
const SWIM = [41, 53, 34, 46, 47, 40, 52, 58, 64, 69, 30, 11, 10];
const SHOES = [10, 10, 10, 11, 11, 87, 105, 30, 34];
const APRONS = [10, 10, 122, 11, 30, 22, 139, 174];

/** An outfit of garments by their names in the core content, each with the colours it is dyed from. */
const dress = (weight: number, ...pieces: (readonly [garment: string, dyes: readonly number[]])[]): Outfit => ({
  wear: pieces.map(([g]) => `core:${g}`), weight, dyes: pieces.map(([, d]) => d),
});

/** Everyone about the city: all ages and builds, both sexes alike. */
export const CITY: PopulationDef = {
  type: "population", id: "core:people_city", label: "City crowd",
  women: 0.5,
  skin: [1, 2, 3, 3, 3, 3, 3, 2, 2, 1],
  eyes: [5, 3, 1, 1, 1, 0.5],
  hair: { men: [1, 4, 3, 1, 0, 4, 2, 0.5], women: [0, 1, 2, 4, 2, 1, 2, 3] },
  hairColors: [1, 1, 0.5, 3, 3, 3, 2, 0, 0, 0.3],
  streak: 0.05, grey: [0.3, 0.9],
  beard: { men: 0.3, women: 0 },
  build: [-0.4, 0.4],
  face: 0.55,
  age: [-0.7, 0.7], weight: [-0.5, 0.6], muscle: [-0.4, 0.5],
  hairLength: [0, 0.5], beardLength: [0, 0.6],
  outfits: [
    dress(4, ["tee", TEES], ["jeans", DENIM], ["trainers", SHOES]),
    dress(2, ["loose_tee", TEES], ["jeans", DENIM], ["trainers", SHOES]),
    dress(2, ["tee", BRIGHT], ["shorts", SHORTS], ["trainers", SHOES]),
    dress(2, ["hoodie", HOODIES], ["jeans", DENIM], ["trainers", SHOES]),
    dress(1, ["loose_tee", BRIGHT], ["shorts", SHORTS], ["trainers", SHOES]),
  ],
};

/** Young people on the sand: slim and fit, long and fair hair, in little but swimwear and shorts, often barefoot. */
export const BEACH: PopulationDef = {
  type: "population", id: "core:people_beach", label: "Young beachgoers",
  women: 0.55,
  skin: [1, 2, 3, 4, 4, 3, 2, 2, 1, 1],
  eyes: [3, 2, 2, 1, 1, 1],
  hair: { men: [0, 3, 3, 3, 0, 3, 1, 1], women: [0, 0, 1, 5, 2, 0, 1, 3] },
  hairColors: [4, 3, 1, 2, 1, 1, 0.5, 0, 0, 0.5],
  streak: 0.15,
  beard: { men: 0.15, women: 0 },
  build: [-0.3, 0.3],
  regions: { waist: [-0.6, 0], torso_depth: [-0.5, 0.1], shoulders: [0, 0.6], leg_length: [0, 0.6], neck_size: [-0.4, 0.1] },
  face: 0.5,
  age: [-0.95, -0.45], weight: [-0.6, 0], muscle: [0.1, 0.7],
  hairLength: [0.2, 0.8], beardLength: [0, 0.3],
  outfits: [
    dress(4, ["shorts", SWIM]),
    dress(2, ["tee", BRIGHT], ["shorts", SWIM]),
    dress(2, ["loose_tee", BRIGHT], ["shorts", SWIM], ["trainers", SHOES]),
    dress(1, ["shorts", SWIM], ["trainers", SHOES]),
  ],
};

/** Older people at work: greying, heavier about the middle, short hair and beards. */
export const WORKERS: PopulationDef = {
  type: "population", id: "core:people_workers", label: "Older workers",
  women: 0.35,
  skin: [1, 2, 3, 3, 3, 3, 3, 2, 2, 1],
  eyes: [5, 3, 1, 1, 2, 0.5],
  hair: { men: [3, 4, 3, 0, 0, 3, 1, 0], women: [0, 1, 4, 2, 2, 0, 1, 2] },
  hairColors: [0.5, 1, 0.5, 3, 4, 3, 2, 0, 0, 0],
  grey: [-0.1, 0.6],
  beard: { men: 0.6, women: 0 },
  build: [-0.3, 0.4],
  regions: { waist: [0.2, 0.9], torso_depth: [0.1, 0.8], torso_width: [0, 0.6], neck_size: [0, 0.6], hips: [0, 0.6], leg_length: [-0.5, 0.1] },
  face: 0.7,
  age: [0.35, 0.95], weight: [0.1, 0.8], muscle: [-0.2, 0.4],
  hairLength: [0, 0.2], beardLength: [0.1, 0.7],
  outfits: [
    dress(3, ["tee", MUTED], ["jeans", DENIM], ["trainers", SHOES]),
    dress(3, ["hoodie", HOODIES], ["jeans", DENIM], ["trainers", SHOES]),
    dress(2, ["loose_tee", MUTED], ["jeans", DENIM], ["trainers", SHOES]),
    dress(2, ["tee", MUTED], ["apron", APRONS], ["jeans", DENIM], ["trainers", SHOES]),
  ],
};

/** Visitors: fairer skin and eyes, every age, the older ones grey. */
export const TOURISTS: PopulationDef = {
  type: "population", id: "core:people_tourists", label: "Tourists",
  women: 0.5,
  skin: [4, 4, 3, 2, 1, 1, 0.5, 0.5, 0.3, 0.2],
  eyes: [2, 1, 3, 2, 2, 0.5],
  hair: { men: [2, 3, 4, 1, 0, 3, 1, 0], women: [0, 1, 3, 4, 2, 0, 1, 3] },
  hairColors: [3, 3, 1, 3, 2, 1, 0.5, 0, 0, 0.2],
  grey: [0.2, 0.85],
  beard: { men: 0.25, women: 0 },
  build: [-0.4, 0.5],
  face: 0.55,
  age: [-0.6, 0.8], weight: [-0.3, 0.7], muscle: [-0.5, 0.3],
  hairLength: [0, 0.4], beardLength: [0, 0.5],
  outfits: [
    dress(4, ["tee", BRIGHT], ["shorts", SHORTS], ["trainers", SHOES]),
    dress(3, ["loose_tee", BRIGHT], ["shorts", SHORTS], ["trainers", SHOES]),
    dress(2, ["tee", TEES], ["jeans", DENIM], ["trainers", SHOES]),
    dress(1, ["hoodie", HOODIES], ["shorts", SHORTS], ["trainers", SHOES]),
  ],
};

/** The bots: anyone at all, as a creator's random look is. */
export const SURVIVORS: PopulationDef = {
  type: "population", id: "core:people_survivors", label: "Survivors",
  women: 0.5,
  skin: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  eyes: [1, 1, 1, 1, 1, 1],
  complexions: [1, 1, 1, 1, 1, 1, 1, 1],
  hair: { men: [1, 1, 1, 1, 1, 1, 1, 1], women: [1, 1, 1, 1, 1, 1, 1, 1] },
  hairColors: [1, 1, 1, 1, 1, 1, 1, 0.5, 0.3, 1],
  streak: 0.25, grey: [0.5, 1],
  beard: { men: 0.5, women: 0.05 },
  brows: [1, 1, 1, 1, 1, 1, 1, 1],
  build: [-0.7, 0.7],
  face: 0.6,
  age: [-0.6, 0.6], weight: [-0.5, 0.5], muscle: [-0.4, 0.6],
  hairLength: [0, 0.6], beardLength: [0, 0.6],
  outfits: [
    dress(3, ["tee", RUGGED], ["jeans", DENIM], ["trainers", SHOES]),
    dress(3, ["hoodie", RUGGED], ["jeans", DENIM], ["trainers", SHOES]),
    dress(2, ["loose_tee", RUGGED], ["jeans", DENIM], ["trainers", SHOES]),
    dress(1, ["tee", RUGGED], ["shorts", SHORTS], ["trainers", SHOES]),
  ],
};

// Cast's roles dressed alike: a crowd's people in a uniform or a gang's colours, drawn from the seed as anyone else's.
const RED = [22, 34, 46];
const TEAL = [28, 40, 52];
const DARK = [11, 82, 30];
/** A gang's young members, in its colours. */
const gang = (id: string, label: string, colours: readonly number[]): PopulationDef => ({
  ...CITY, id, label, women: 0.3, age: [-0.85, 0], hairLength: [0, 0.3],
  outfits: [
    dress(2, ["tee", colours], ["jeans", DARK], ["trainers", SHOES]),
    dress(1, ["hoodie", colours], ["jeans", DARK], ["trainers", SHOES]),
    dress(1, ["hoodie", DARK], ["jeans", DENIM], ["trainers", colours]),
  ],
});

/** Officers on the beat: the city's people in navy, under the flak their role puts on. */
export const POLICE: PopulationDef = {
  ...CITY, id: "core:people_police", label: "Police", age: [-0.6, 0.5],
  outfits: [dress(1, ["tee", [30]], ["jeans", [30]], ["trainers", [11]])],
};
export const SOUTHSIDE = gang("core:people_southside", "Southside gang", RED);
export const BAYFRONT = gang("core:people_bayfront", "Bayfront gang", TEAL);
/** Older workers at a cart or a stall, each in an apron. */
export const VENDORS: PopulationDef = {
  ...WORKERS, id: "core:people_vendors", label: "Street vendors",
  outfits: [dress(1, ["tee", MUTED], ["apron", APRONS], ["jeans", DENIM], ["trainers", SHOES])],
};

export const POPULATIONS: readonly PopulationDef[] = [CITY, BEACH, WORKERS, TOURISTS, SURVIVORS, POLICE, SOUTHSIDE, BAYFRONT, VENDORS];
