// Pure functions of their inputs and a seeded Rng. Offspring inherit wild and mutated points, never tamed ones.
// Wild plus mutated points in one stat saturate at 255, where the reference game overflows (see quality/deviations.md).

import type { Rng } from "../rng.ts";

export const STAT_NAMES = ["health", "stamina", "oxygen", "food", "water", "weight", "melee", "speed", "torpidity", "fortitude", "crafting", "temperature"] as const;
export type StatName = (typeof STAT_NAMES)[number];
export const STAT_COUNT = STAT_NAMES.length;
export const COLOR_REGIONS = 6;
export const POINT_CAP = 255;

/** Stats that wild levels can land in. Points in speed do nothing for a wild creature, as in the reference. */
export const WILD_STATS = [0, 1, 2, 3, 5, 6, 7];
/** Chance that offspring take the higher of the two parents' points in a stat. */
export const HIGHER_STAT_CHANCE = 0.55;
export const MUTATION_ROLLS = 3;
export const MUTATION_CHANCE = 0.025;
export const MUTATION_POINTS = 2;
export const MUTATION_LIMIT = 20;

/**
 * The gains are what a level is worth at the reference game's defaults. perTamed is the raw gain times TAMED_GAIN.
 * A server's settings scale each gain from there (shared/content/tuning.ts).
 */
export type StatCurve = readonly [base: number, perWild: number, perTamed: number];

/** The reference game's defaults of `PerLevelStatsMultiplier_DinoTamed`. Every other stat's is 1. */
export const TAMED_GAIN: Readonly<Partial<Record<StatName, number>>> = { health: 0.2, melee: 0.17 };

export class Genome {
  readonly wild = new Uint8Array(STAT_COUNT);
  readonly mutated = new Uint8Array(STAT_COUNT);
  readonly tamed = new Uint8Array(STAT_COUNT);
  readonly colors = new Uint8Array(COLOR_REGIONS);
  /** Mutations in the mother's and the father's ancestry. */
  mutMat = 0;
  mutPat = 0;
  /** Persistent ids of the parents, 0 for a wild-born creature. */
  mother = 0;
  father = 0;
  female = false;

  get level(): number {
    let n = 1;
    for (let s = 0; s < STAT_COUNT; s++) n += this.wild[s]! + this.mutated[s]! + this.tamed[s]!;
    return n;
  }
}

export function statValue(curve: StatCurve, g: Genome, stat: number): number {
  return curve[0] * (1 + (g.wild[stat]! + g.mutated[stat]!) * curve[1]) * (1 + g.tamed[stat]! * curve[2]);
}

/** Spreads level - 1 points at random over WILD_STATS. */
export function rollWild(rng: Rng, level: number, regionColors: readonly number[]): Genome {
  const g = new Genome();
  for (let n = level - 1; n > 0; n--) {
    const s = WILD_STATS[rng.int(WILD_STATS.length)]!;
    if (g.wild[s]! < POINT_CAP) g.wild[s]!++;
  }
  for (let r = 0; r < COLOR_REGIONS; r++) g.colors[r] = regionColors[rng.int(regionColors.length)]!;
  g.female = rng.int(2) === 0;
  return g;
}

/** Returns false at the cap. */
export function spendPoint(g: Genome, stat: number): boolean {
  if (g.tamed[stat]! >= POINT_CAP) return false;
  g.tamed[stat]!++;
  return true;
}

/** `mutationColors` is the set of palette indices a mutation may pick. */
export function breed(mother: Genome, father: Genome, motherPid: number, fatherPid: number, rng: Rng, mutationColors: readonly number[]): Genome {
  const child = new Genome();
  child.mother = motherPid;
  child.father = fatherPid;
  child.female = rng.int(2) === 0;

  // Each stat comes whole from one parent, wild points and mutated points together.
  for (let s = 0; s < STAT_COUNT; s++) {
    const m = mother.wild[s]! + mother.mutated[s]!;
    const f = father.wild[s]! + father.mutated[s]!;
    const takeHigher = rng.float() < HIGHER_STAT_CHANCE;
    const fromMother = m === f ? rng.int(2) === 0 : m > f === takeHigher;
    const src = fromMother ? mother : father;
    child.wild[s] = src.wild[s]!;
    child.mutated[s] = src.mutated[s]!;
  }
  for (let r = 0; r < COLOR_REGIONS; r++) child.colors[r] = (rng.int(2) === 0 ? mother : father).colors[r]!;

  child.mutMat = mother.mutMat + mother.mutPat;
  child.mutPat = father.mutMat + father.mutPat;
  for (let roll = 0; roll < MUTATION_ROLLS; roll++) {
    // Draw everything first so the random stream does not depend on outcomes.
    const strongerDraw = rng.float();
    const tieDraw = rng.int(2);
    const stat = WILD_STATS[rng.int(WILD_STATS.length)]!;
    const region = rng.int(COLOR_REGIONS);
    const color = mutationColors[rng.int(mutationColors.length)]!;
    const hit = rng.float() < MUTATION_CHANCE;
    // The source is the parent stronger in that stat with probability HIGHER_STAT_CHANCE.
    const m = mother.wild[stat]! + mother.mutated[stat]!;
    const f = father.wild[stat]! + father.mutated[stat]!;
    const fromMother = m === f ? tieDraw === 0 : m > f === strongerDraw < HIGHER_STAT_CHANCE;
    const source = fromMother ? mother : father;
    if (!hit || source.mutMat + source.mutPat >= MUTATION_LIMIT) continue;
    const room = POINT_CAP - child.wild[stat]! - child.mutated[stat]!;
    if (room <= 0) continue;
    child.mutated[stat]! += room < MUTATION_POINTS ? room : MUTATION_POINTS;
    child.colors[region] = color;
    if (fromMother) child.mutMat++;
    else child.mutPat++;
  }
  return child;
}
