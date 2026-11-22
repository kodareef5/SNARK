// The game: what a game names once. A stub that waits.

import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

/** What a game names once. A stub: these are found by id in code today. */
export interface GameDef extends Named {
  readonly type: "game";
  readonly id: string;
  readonly survivor: string;
  /** What the dead leave, and what a dropped stack lies in. */
  readonly cache: string;
  readonly bag: string;
  readonly levels?: string;
  /** Buffs every survivor always has. */
  readonly buffs?: readonly string[];
}

const FIELDS = {
  survivor: f("text", "", { refs: { "": "species/survivor" } }),
  cache: f("text", "", { refs: { "": "prop/container" } }),
  bag: f("text", "", { refs: { "": "prop/container" } }),
  levels: f("text", "", { refs: { "": "levels" } }),
  buffs: f("list", "AdditionalDefaultBuffs", { refs: { "[]": "buff" }, open: true }),
} satisfies Fields<GameDef>;

export const game: Kind<GameDef> = {
  type: "game",
  fields: FIELDS,
  rows: [
    row("game", "game", FIELDS, { ark: "PrimalGameData", status: "stub", waits: "polish", shelf: "game", must: ["survivor", "cache", "bag"], may: ["levels", "buffs"], doc: "What a game names once: the survivor's species, the death cache, the dropped bag, the standing buffs." }),
  ],
};
