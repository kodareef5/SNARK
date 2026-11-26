// Where things are on the strand sheet (paint.ts): the core's streaks across the left of it, then a cell for each kind
// of card, each running the sheet's whole height from root (v = 0) to tip (v = 1).

/** The share of the sheet's width the core's streaks take. */
export const CORE_U = 0.5;
export const CARD_KINDS = ["fine", "clumps", "coils", "stubble"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
/** The sheet as equal cells across, each card's one, for mips that keep each card's coverage on its own. */
export const SHEET_CELLS = CARD_KINDS.length / (1 - CORE_U);

/** The u range of a kind of card's cell, a texel in from each side so a mip does not reach its neighbour. */
export function cardCell(kind: CardKind): [number, number] {
  const k = CARD_KINDS.indexOf(kind);
  const w = (1 - CORE_U) / CARD_KINDS.length;
  return [CORE_U + k * w + 1 / 1024, CORE_U + (k + 1) * w - 1 / 1024];
}
