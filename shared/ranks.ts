// How far a word reaches: a connection has a rank, and so has a permission group. A higher rank may change what a lower one
// holds and never the other way, which is what keeps a map's and the cluster's admins out of a regular admin's reach.

/** Counts from the moment its holder joins, and manages nothing. */
export const RANK_OPEN = 0;
/** Counts once its holder has given their own password, and manages nothing. Cheats without a password stand here too. */
export const RANK_STAFF = 1;
export const RANK_ADMIN = 2;
/** As the map's own password gives. */
export const RANK_MAP = 3;
/** As the cluster's password gives, on every map. */
export const RANK_CLUSTER = 4;

export const RANK_NAMES: readonly string[] = ["open", "staff", "admin", "map", "cluster"];

/** The rank a word names, or -1. */
export function rankNamed(word: string): number {
  return RANK_NAMES.indexOf(word.toLowerCase());
}

/** Whether one of `rank` may change something of rank `of`. */
export function mayEdit(rank: number, of: number): boolean {
  return rank >= RANK_ADMIN && rank >= of;
}
