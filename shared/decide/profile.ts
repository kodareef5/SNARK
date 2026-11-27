// A profile names a table's columns, so a scorer trained in one place can be used wherever the same table can be filled.
// Every number is in the mover's own units and scaled to a fixed range: lengths in spans (units.ts: its radius, floored by
// the world's grain and by what it covers in a reaction time), ranges in seconds of travel at its pace, angles from its
// facing. Weights carry their profile's name and hash and are refused on any other.

import { hashString } from "./hash.ts";

export interface Profile<S extends string = string, C extends string = string> {
  readonly name: string;
  /** "choice" picks one candidate of several. "yes" has one row and answers with one probability. */
  readonly kind: "choice" | "yes";
  /** The candidates stand in a ring: each is scored beside its neighbour on either side, and the last is next to the first. */
  readonly ring: boolean;
  readonly state: readonly S[];
  readonly columns: readonly C[];
  /**
   * Products of a state number and one of the candidate's own columns, read beside them. The state is the same for every
   * candidate, so through a line of weights it adds the same to each and changes nothing: a product is how the state
   * comes to change which candidate wins.
   */
  readonly crosses: readonly (readonly [S, C])[];
  /** The crosses as places: a state number's, then a column's, for each. */
  readonly crossAt: readonly number[];
  /** Where each state number and each column is, by name. */
  readonly s: { readonly [K in S]: number };
  readonly c: { readonly [K in C]: number };
}

export function profile<const S extends string, const C extends string>(name: string, kind: "choice" | "yes", ring: boolean, state: readonly S[], columns: readonly C[], crosses: readonly (readonly [NoInfer<S>, NoInfer<C>])[] = []): Profile<S, C> {
  const index = <T extends string>(names: readonly T[]) => Object.fromEntries(names.map((n, i) => [n, i])) as { readonly [K in T]: number };
  if (new Set<string>(state).size !== state.length || new Set<string>(columns).size !== columns.length) throw new Error(`profile ${name} names a column twice`);
  const s = index(state), c = index(columns);
  for (const [a, b] of crosses) if (s[a] === undefined || c[b] === undefined) throw new Error(`profile ${name} crosses ${a} with ${b}, and has not both`);
  return { name, kind, ring, state, columns, crosses, crossAt: crosses.flatMap(([a, b]) => [s[a], c[b]]), s, c };
}

/** Numbers a scorer reads for one candidate: the state, its row, in a ring its two neighbours' rows, then the crosses. */
export function inputsOf(p: Profile): number {
  return p.state.length + p.columns.length * (p.ring ? 3 : 1) + p.crosses.length;
}

/** What weights are checked against: the profile's name, kind and column lists, in order. */
export function profileHash(p: Profile): number {
  return hashString([p.name, p.kind, p.ring ? "ring" : "table", p.state.join(","), p.columns.join(","), p.crosses.map(([a, b]) => `${a}*${b}`).join(",")].join("|"));
}
