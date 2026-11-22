// Levels: the experience each level takes and the engram points it gives.

import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

export const MAX_LEVELS = 10000;

/** Experience needed to reach each level (index 0 is level 1), and the engram points gained on reaching it. */
export interface LevelsDef extends Named {
  readonly type: "levels";
  readonly id: string;
  readonly xp: readonly number[];
  readonly engramPoints: readonly number[];
  /** The most experience a survivor may have. Defaults to what the last level takes. */
  readonly most?: number;
  /** A separate table and cap for tamed creatures. Omitted, they use the survivors'. */
  readonly tame?: { readonly xp: readonly number[]; readonly most?: number };
}

const FIELDS = {
  xp: f("list", "LevelExperienceRampOverrides"),
  engramPoints: f("list", "OverridePlayerLevelEngramPoints"),
  most: f("number", "OverrideMaxExperiencePointsPlayer"),
  tame: f("facet", "the tames' ramp"),
} satisfies Fields<LevelsDef>;

export const levels: Kind<LevelsDef> = {
  type: "levels",
  fields: FIELDS,
  rows: [
    row("levels", "levels", FIELDS, { ark: "the level ramp of the game data", shelf: "rules", must: ["xp", "engramPoints"], may: ["most", "tame"], doc: "The experience each level takes and the engram points it gives." }),
  ],
  check(d, { errors }) {
    for (const [name, xp] of [["xp", d.xp], ["tame.xp", d.tame?.xp]] as const) {
      if (xp !== undefined && (xp.length < 2 || xp.length > MAX_LEVELS || xp[0] !== 0 || xp.some((v, i) => i > 0 && !(v > xp[i - 1]!)))) errors.push(`${d.id}: ${name} must start at 0 and rise, for at most ${MAX_LEVELS} levels`);
    }
    if (d.engramPoints.length !== d.xp.length) errors.push(`${d.id}: engramPoints must have one entry per level`);
    if ((d.most !== undefined && !(d.most > 0)) || (d.tame?.most !== undefined && !(d.tame.most > 0))) errors.push(`${d.id}: the most experience must be above 0`);
  },
};
