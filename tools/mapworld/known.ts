// What the build knows of a piece beyond its place: the building it is a piece of, and the tile and storey its maker had
// in hand when it placed it. Kept beside the piece, not on it, so a piece is in every file and every test what it was. A
// copy of a piece is told to carry it (`carry`). The map's buildings section is made from it (tools/mapworld/buildings.ts).

/** A storey not said, of a piece no layout placed: told by its height over its building's base when the pieces are put in order. */
export const STOREY_UNSAID = 255;
/** The most a tile's column or row may be. */
const MOST_TILE = 2046;

export interface Known {
  /** Its building's place among the site's (Site.buildings), or -1. */
  readonly owner: number;
  /** Its tile, or -1 for a piece placed by no tile. */
  readonly i: number;
  readonly j: number;
  /** Its storey, the ground's 0, a slab the lid of the storey under it; or STOREY_UNSAID. */
  readonly storey: number;
}

const kept = new WeakMap<object, number>();

/** Tile and storey in 31 bits, an owner over them. */
const pack = (owner: number, i: number, j: number, storey: number): number => (owner + 1) * 2147483648 + (((i + 1) << 19) | ((j + 1) << 8) | storey);

/** Says of `piece` the tile and storey it was placed at, and with `owner` whose it is. */
export function know(piece: object, i: number, j: number, storey: number, owner = -1): void {
  const tile = i >= 0 && j >= 0 && i <= MOST_TILE && j <= MOST_TILE;
  kept.set(piece, pack(owner, tile ? i : -1, tile ? j : -1, Math.max(0, Math.min(STOREY_UNSAID, storey))));
}

/** Says whose `piece` is, keeping what else is known of it. */
export function own(piece: object, owner: number): void {
  const was = kept.get(piece);
  kept.set(piece, was === undefined ? pack(owner, -1, -1, STOREY_UNSAID) : (owner + 1) * 2147483648 + (was % 2147483648));
}

/** `copy` knows what `from` does. */
export function carry<T extends object>(copy: T, from: object): T {
  const was = kept.get(from);
  if (was !== undefined) kept.set(copy, was);
  return copy;
}

/** What is known of `piece`, or null. */
export function knownOf(piece: object): Known | null {
  const v = kept.get(piece);
  if (v === undefined) return null;
  const low = v % 2147483648;
  return { owner: Math.floor(v / 2147483648) - 1, i: ((low >> 19) & 2047) - 1, j: ((low >> 8) & 2047) - 1, storey: low & 255 };
}
