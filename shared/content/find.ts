// What a name typed at the console or written in a settings file means. Both look names up here and nowhere else.

import type { Def } from "./defs.ts";
import type { Registry } from "./registry.ts";

export interface Found {
  /** Everything the name means. More than one only where an id was split by a rename. */
  readonly kinds: readonly number[];
  /** The ids of the several definitions the name alone fits. It then means none of them. */
  readonly could: readonly string[];
  /** The name is an id that is no longer defined. */
  readonly renamed: boolean;
}

const NONE: Found = { kinds: [], could: [], renamed: false };

/**
 * A definition is named by its id, by an id it once had, by an alias, or by its id's own name ("spear" for "core:spear")
 * where one definition alone answers to that. With `type`, only definitions of that family are meant. Case is ignored.
 */
export function find(reg: Registry, name: string, type?: Def["type"]): Found {
  const word = name.toLowerCase();
  const fits = (k: number): boolean => type === undefined || reg.defs[k]!.type === type;
  const id = reg.index.get(word);
  if (id !== undefined) return fits(id) ? { kinds: [id], could: [], renamed: false } : NONE;
  const now = reg.redirects.get(word);
  if (now !== undefined) return { kinds: now.filter(fits), could: [], renamed: true };
  if (word === "" || word.includes(":")) return NONE;
  const answer = new Set<number>();
  const alias = reg.aliases.get(word);
  if (alias !== undefined && fits(alias)) answer.add(alias);
  for (let k = 1; k < reg.ids.length; k++) if (fits(k) && reg.ids[k]!.endsWith(word) && reg.ids[k]!.length - word.length - 1 === reg.ids[k]!.indexOf(":")) answer.add(k);
  if (answer.size === 1) return { kinds: [...answer], could: [], renamed: false };
  return answer.size === 0 ? NONE : { kinds: [], could: [...answer].map((k) => reg.ids[k]!), renamed: false };
}
