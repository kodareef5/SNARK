// The particles of things breaking: dust, chips, glass and sparks. No asset owns a break, so their numbers are here,
// written as a sheet's are, and their pictures are the pack's own: its dust puffs and a shard. details.ts makes them
// (`breakBurst`) and holds them to their share of the pool; break-effects.ts says how many a break is given.

import { FLAT_SHAPES, effectOf, type DetailEffect, type DetailPicture } from "../../../shared/pack/details.ts";

/** The parts of a break's burst, in the order of `breakEffects`. */
export const BREAK_DUST = 0, BREAK_CHIPS = 1, BREAK_GLASS = 2, BREAK_SPARKS = 3;
/** A break's burst keeps its whole count within this many metres of the eye: a wall is seen from farther than a feather. */
export const BREAK_NEAR = 30;
/** The share of a tier's pool the particles of breaks may hold. */
export const BREAK_SHARE = 0.25;

/**
 * The four effects, their pictures `puffs` for the dust and, for the bits, the pack's shard, else a grain, else the puffs.
 * Dust and chips are given their colour by each burst; glass and sparks keep the one here.
 */
export function breakEffects(pictures: readonly DetailPicture[], puffs: readonly number[]): DetailEffect[] {
  const grain = FLAT_SHAPES.indexOf("grain");
  let shard = pictures.findIndex((p) => p.id.includes("shard"));
  if (shard < 0) shard = pictures.findIndex((p) => p.flat === grain);
  const bits = shard < 0 ? puffs : [shard];
  const of = (id: string, list: readonly number[], raw: Record<string, unknown>): DetailEffect => effectOf(`break/${id}`, { ...raw, pictures: list.map(String) }, Number);
  const tumble = { sway: 0.01, hz: 2, rock: 1.2, turn: 5 };
  return [
    of("dust", puffs, { shape: { sphere: 1.3 }, speed: [0.4, 1.8], up: 0.3, size: [0.9, 1.5], grow: 2.6, life: [1.6, 2.8], fade: 1.2, drag: 2.2, gravity: -0.03, wind: 0.8, flutter: { turn: 0.3 }, colour: [176, 170, 160], vary: 0.07, face: "camera", pass: "blend", reach: 150 }),
    of("chips", bits, { shape: { sphere: 0.9 }, speed: [2, 6], up: 0.45, size: [0.06, 0.2], aspect: 0.75, life: [1, 1.8], fade: 0.4, drag: 0.3, gravity: 1, fall: 14, wind: 0.1, flutter: tumble, settle: 2, colour: [150, 146, 138], vary: 0.14, face: "free", pass: "cutout", reach: 60 }),
    of("glass", bits, { shape: { sphere: 0.9 }, speed: [1.5, 5], up: 0.35, size: [0.04, 0.14], aspect: 0.5, life: [0.9, 1.6], fade: 0.3, drag: 0.3, gravity: 1, fall: 14, wind: 0.1, flutter: tumble, settle: 1.5, colour: [196, 222, 228], vary: 0.05, face: "free", pass: "cutout", reach: 50 }),
    of("sparks", bits, { shape: { sphere: 0.3 }, speed: [4, 9], up: 0.5, size: [0.02, 0.05], aspect: 0.4, life: [0.25, 0.55], fade: 0.2, drag: 0.5, gravity: 0.6, flutter: tumble, colour: [255, 196, 96], face: "free", pass: "cutout", lit: false, reach: 40 }),
  ];
}
