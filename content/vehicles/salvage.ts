// What a street's wreck gives a survivor who salvages it, and the kinds its lesser looks are. A wreck goes down its rungs,
// the first to the last: its fittings stripped, its cabin and engine gutted, its body cut up. A look the street already
// holds lower (stripped, on its roof, burnt) has only the rungs left to it. server/city-breaks.ts strikes them.
import type { BreaksFacet, SalvageFacet, StructureDef } from "../../shared/content/defs.ts";

export type Rung = "strip" | "gut" | "cut" | "burnt";

/** What a rung of a car gives in all. First guesses, of items there are: a tyre is polymer, a pane crystal, a seat fiber. */
const GIVES: Readonly<Record<Rung, readonly { item: string; count: number }[]>> = {
  strip: [{ item: "core:polymer", count: 10 }, { item: "core:crystal", count: 4 }, { item: "core:electronics", count: 2 }, { item: "core:gasoline", count: 4 }],
  gut: [{ item: "core:ingot", count: 6 }, { item: "core:electronics", count: 4 }, { item: "core:oil", count: 4 }, { item: "core:fiber", count: 8 }],
  cut: [{ item: "core:ore", count: 35 }, { item: "core:ingot", count: 4 }],
  // A fire leaves half the metal and nothing else.
  burnt: [{ item: "core:ore", count: 17 }, { item: "core:ingot", count: 2 }],
};

/** The work one rung of a car takes: eight blows of a metal pick. */
const WORK = 40;

/** How much more a larger wreck gives and takes than a car. */
export const WRECK_SIZES = { car: 1, van: 1.5, heavy: 3 } as const;
export type WreckSize = keyof typeof WRECK_SIZES;

/** The rungs a look has left: every one where it stopped, less its fittings stripped, its body alone on its roof. */
export const rungsOf = (look: "stopped" | "stripped" | "roof" | "burnt"): readonly Rung[] =>
  look === "stopped" ? ["strip", "gut", "cut"] : look === "stripped" ? ["gut", "cut"] : look === "roof" ? ["cut"] : ["burnt"];

/**
 * How a wreck of `size` with `rungs` left is salvaged, in as many rungs as it has `looks` to show (itself and its
 * lesser looks): a rung past its last look would change nothing a player sees, so the rungs over are given with the
 * last. The work is the same in all, shared evenly among the rungs it has.
 */
export function wreckSalvage(rungs: readonly Rung[], size: WreckSize, looks = rungs.length): SalvageFacet {
  const by = WRECK_SIZES[size], n = Math.max(1, Math.min(looks, rungs.length));
  const groups = Array.from({ length: n }, (_, at) => (at < n - 1 ? [rungs[at]!] : rungs.slice(n - 1)));
  const gives = (group: readonly Rung[]) => {
    const sum = new Map<string, number>();
    for (const r of group) for (const y of GIVES[r]) sum.set(y.item, (sum.get(y.item) ?? 0) + y.count);
    return [...sum].map(([item, count]) => ({ item, count: Math.round(count * by) }));
  };
  return { work: (WORK * by * rungs.length) / n, rungs: groups.map((group) => ({ gives: gives(group) })) };
}

/** A wreck's break set is its look: every paint of it shares its lesser looks. */
const setOf = (mesh: string): string => `wreck_${mesh.slice("core:".length)}`;

/** The whole form of the look drawn as `mesh`: the kind a map places. */
export const wreckWhole = (mesh: string): BreaksFacet => ({ set: setOf(mesh), form: "whole", family: "wreck", halves: 1, bears: false });

/** The lesser looks a wreck's row is swapped to, in the order it takes them, and the form each is. */
export const WRECK_FORMS = { stripped: "breach A", shell: "open" } as const;
export type WreckForm = keyof typeof WRECK_FORMS;

/** The id of the kind the look drawn as `mesh` becomes as `form`. It sorts after every id there was, so no index moves. */
export const wreckFormKind = (mesh: string, form: WreckForm): string => `core:zzzzzzzwreck_${mesh.slice("core:".length)}_${form}`;

/** The id of the shape of a look drawn as `mesh` that only salvage leaves, and no map places. It sorts as the kinds do. */
export const wreckFormShape = (mesh: string): string => `core:zzzzzzzwreck_shape_${mesh.slice("core:".length)}`;

/**
 * The kind the look drawn as `mesh` becomes as `form`: drawn and walked as the look `as`. It has no paint of its own:
 * it is dyed as the kind the map placed, and a swap keeps its row's health. Its own health is its body's, for a map
 * that sets one down itself, where it is a plain piece with no rungs.
 */
export function wreckFormDef(mesh: string, form: WreckForm, as: { readonly mesh: string; readonly shape: string; readonly half: readonly [number, number, number]; readonly color: number; readonly hp: number }): StructureDef {
  return {
    type: "structure", class: "static", id: wreckFormKind(mesh, form), mesh: as.mesh, shape: as.shape, half: as.half, color: as.color, hp: as.hp, material: "core:mat_metal",
    breaks: { ...wreckWhole(mesh), form: WRECK_FORMS[form], variant: 0 },
  };
}
