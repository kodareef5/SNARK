// The built-in populations: who the city's crowds and the bots are made of, until admins edit their own. Weights follow
// the look's lists: skin tones lightest first; hair styles bald, buzzed, parted, long, buns; hair colours blond, dark
// blond, ginger, brown, dark brown, near black, black, grey, white, dyed red; eyes brown, dark brown, blue, green, grey,
// amber. An edit raises the revision.

import type { PopulationDef } from "../../shared/content/kinds/populations.ts";

const cloth = (...pieces: string[]) => pieces.map((p) => `core:cloth_${p}`);

/** Everyone about the city: all ages and builds, both sexes alike. */
export const CITY: PopulationDef = {
  type: "population", id: "people:city", label: "City crowd", revision: 1,
  women: 0.5,
  skin: [1, 2, 3, 3, 3, 3, 3, 2, 2, 1],
  eyes: [5, 3, 1, 1, 1, 0.5],
  hair: { men: [1, 5, 4, 1, 0], women: [0, 1, 2, 5, 3] },
  hairColors: [1, 1, 0.5, 3, 3, 3, 2, 0, 0, 0.3],
  streak: 0.05, grey: [0.3, 0.9],
  beard: { men: 0.3, women: 0 },
  build: [-0.4, 0.4],
  face: 0.35,
  age: [-0.7, 0.7], weight: [-0.5, 0.6], muscle: [-0.4, 0.5],
  hairLength: [0, 0.5], beardLength: [0, 0.6],
};

/** Young people on the sand: slim and fit, long and fair hair, in little but swimwear. */
export const BEACH: PopulationDef = {
  type: "population", id: "people:beach", label: "Young beachgoers", revision: 1,
  women: 0.55,
  skin: [1, 2, 3, 4, 4, 3, 2, 2, 1, 1],
  eyes: [3, 2, 2, 1, 1, 1],
  hair: { men: [0, 4, 3, 3, 0], women: [0, 0, 1, 6, 3] },
  hairColors: [4, 3, 1, 2, 1, 1, 0.5, 0, 0, 0.5],
  streak: 0.15,
  beard: { men: 0.15, women: 0 },
  build: [-0.3, 0.3],
  regions: { waist: [-0.6, 0], torso_depth: [-0.5, 0.1], shoulders: [0, 0.6], leg_length: [0, 0.6], neck_size: [-0.4, 0.1] },
  face: 0.3,
  age: [-0.95, -0.45], weight: [-0.6, 0], muscle: [0.1, 0.7],
  hairLength: [0.2, 0.8], beardLength: [0, 0.3],
  outfits: [{ wear: cloth("pants"), weight: 3 }, { wear: cloth("shirt", "pants"), weight: 1 }, { wear: cloth("hat", "pants"), weight: 1 }],
};

/** Older people at work: greying, heavier about the middle, short hair and beards. */
export const WORKERS: PopulationDef = {
  type: "population", id: "people:workers", label: "Older workers", revision: 1,
  women: 0.35,
  skin: [1, 2, 3, 3, 3, 3, 3, 2, 2, 1],
  eyes: [5, 3, 1, 1, 2, 0.5],
  hair: { men: [3, 5, 3, 0, 0], women: [0, 1, 4, 2, 3] },
  hairColors: [0.5, 1, 0.5, 3, 4, 3, 2, 0, 0, 0],
  grey: [-0.1, 0.6],
  beard: { men: 0.6, women: 0 },
  build: [-0.3, 0.4],
  regions: { waist: [0.2, 0.9], torso_depth: [0.1, 0.8], torso_width: [0, 0.6], neck_size: [0, 0.6], hips: [0, 0.6], leg_length: [-0.5, 0.1] },
  face: 0.45,
  age: [0.35, 0.95], weight: [0.1, 0.8], muscle: [-0.2, 0.4],
  hairLength: [0, 0.2], beardLength: [0.1, 0.7],
};

/** Visitors: fairer skin and eyes, every age, the older ones grey. */
export const TOURISTS: PopulationDef = {
  type: "population", id: "people:tourists", label: "Tourists", revision: 1,
  women: 0.5,
  skin: [4, 4, 3, 2, 1, 1, 0.5, 0.5, 0.3, 0.2],
  eyes: [2, 1, 3, 2, 2, 0.5],
  hair: { men: [2, 4, 4, 1, 0], women: [0, 1, 3, 4, 3] },
  hairColors: [3, 3, 1, 3, 2, 1, 0.5, 0, 0, 0.2],
  grey: [0.2, 0.85],
  beard: { men: 0.25, women: 0 },
  build: [-0.4, 0.5],
  face: 0.35,
  age: [-0.6, 0.8], weight: [-0.3, 0.7], muscle: [-0.5, 0.3],
  hairLength: [0, 0.4], beardLength: [0, 0.5],
};

/** The bots: anyone at all, as a creator's random look is. */
export const SURVIVORS: PopulationDef = {
  type: "population", id: "people:survivors", label: "Survivors", revision: 1,
  women: 0.5,
  skin: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  eyes: [1, 1, 1, 1, 1, 1],
  complexions: [1, 1, 1, 1, 1, 1, 1, 1],
  hair: { men: [1, 1, 1, 1, 1], women: [1, 1, 1, 1, 1] },
  hairColors: [1, 1, 1, 1, 1, 1, 1, 0.5, 0.3, 1],
  streak: 0.25, grey: [0.5, 1],
  beard: { men: 0.5, women: 0.05 },
  brows: [1, 1, 1, 1, 1, 1, 1, 1],
  build: [-0.7, 0.7],
  face: 0.4,
  age: [-0.6, 0.6], weight: [-0.5, 0.5], muscle: [-0.4, 0.6],
  hairLength: [0, 0.6], beardLength: [0, 0.6],
};

export const POPULATIONS: readonly PopulationDef[] = [CITY, BEACH, WORKERS, TOURISTS, SURVIVORS];
