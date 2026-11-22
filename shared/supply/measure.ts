// Every table of a book measured by rolling it (planning/workstreams/supply.md, "Balance has a unit"): as designed, with
// the things it waits for counted at their guesses; as it is today; and ringed. The supply tool prints these, the tests
// hold the starter book to them, and the admin page shows them, all from this one sum.

import { tableKey, type SupplyBook } from "./book.ts";
import { withFuture, type Catalog } from "./catalog.ts";
import { compileBook, type Compiled } from "./compile.ts";
import { simulate, type SimStats } from "./simulate.ts";

export const MEASURE_ROLLS = 6000;
export const MEASURE_SEED = 20261121;

export interface Cell {
  readonly key: string;
  readonly target: number;
  readonly designed: SimStats;
  readonly today: SimStats;
  readonly ringed: SimStats;
  readonly dormant: boolean;
}

/** Every table of `book` measured as designed (its future items counted), as it is today, and ringed. */
export function measure(book: SupplyBook, catalog: Catalog, rolls = MEASURE_ROLLS, seed = MEASURE_SEED): { cells: Cell[]; today: Compiled; designed: Compiled } {
  const today = compileBook(book, catalog);
  const designed = compileBook(book, withFuture(catalog, book));
  const cells: Cell[] = [];
  for (const tier of book.tiers) {
    for (const cls of book.classes) {
      const key = tableKey(tier.key, cls.key);
      const d = designed.tables.get(key);
      const t = today.tables.get(key);
      if (!d || !t) continue;
      cells.push({ key, target: tier.target, designed: simulate(designed, d, false, rolls, seed), today: simulate(today, t, false, rolls, seed), ringed: simulate(designed, d, true, rolls, seed), dormant: t.dormant });
    }
  }
  return { cells, today, designed };
}
