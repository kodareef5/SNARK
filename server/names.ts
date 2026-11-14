// A survivor's name is who it is. Two names that differ only by capitals or spacing are two survivors, so nothing is kept or
// decided by a name with its capitals taken off. A name a player types is matched here.

export const NAME_NONE = -1;
export const NAME_UNCLEAR = -2;

const loose = (name: string): string => name.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which of `names` a typed name means: the one that is exactly it, or else the only one that differs from it by capitals and
 * spacing alone. Returns its index, NAME_NONE, or NAME_UNCLEAR if several could be meant and none is exact.
 */
export function meant(names: readonly string[], typed: string): number {
  const exact = names.indexOf(typed);
  if (exact >= 0) return exact;
  const wanted = loose(typed);
  let found = NAME_NONE;
  for (let i = 0; i < names.length; i++) {
    if (loose(names[i]!) !== wanted) continue;
    if (found !== NAME_NONE) return NAME_UNCLEAR;
    found = i;
  }
  return found;
}
