// Spawns: which creatures live in a place, in what share and in what groups. A map's spawn zones name these.

import { FEATURES, type Feature } from "../../features.ts";
import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

/** Which creatures live in a place, in what share and in what groups. A spawn zone of a map names one. */
export interface SpawnsDef extends Named {
  readonly type: "spawns";
  readonly id: string;
  /**
   * What a region adds when it holds too few: one entry, drawn by weight, and its group of creatures. Each of the group comes
   * with its chance, 1 where not given, and stands at its offset from the place found, in metres along x and z.
   */
  readonly entries: readonly {
    readonly name?: string;
    readonly weight: number;
    readonly group: readonly string[];
    readonly chances?: readonly number[];
    readonly offsets?: readonly (readonly [number, number])[];
    /** The feature it waits for: kept with its numbers, and left out of the table until its package takes this away. */
    readonly waits?: Feature;
  }[];
  /** The most of a region's creatures that may be of one species, as a share from 0 to 1 of the number it holds. `waits` as an entry's. */
  readonly limits?: readonly { readonly species: string; readonly share: number; readonly waits?: Feature }[];
}

const FIELDS = {
  entries: f("list", "NPCSpawnEntries", { refs: { "[].group[]": "species/creature" }, open: true }),
  limits: f("list", "NPCSpawnLimits", { refs: { "[].species": "species/creature" } }),
} satisfies Fields<SpawnsDef>;

export const spawns: Kind<SpawnsDef> = {
  type: "spawns",
  fields: FIELDS,
  rows: [
    row("spawns", "spawns", FIELDS, { ark: "NPCSpawnEntriesContainer", shelf: "spawns", must: ["entries"], may: ["limits"], doc: "Which creatures live in a place, in what share and in what groups. A map's spawn zones name these." }),
  ],
  check(d, { errors }) {
    for (const e of d.entries) {
      const n = Array.isArray(e.group) ? e.group.length : 0;
      if (!(e.weight >= 0) || n === 0) errors.push(`${d.id}: an entry needs a weight of at least 0 and a group of at least one`);
      if (e.chances !== undefined && (!Array.isArray(e.chances) || e.chances.length !== n || e.chances.some((c) => !(c >= 0 && c <= 1)))) errors.push(`${d.id}: an entry's chances are one for each of its group, each from 0 to 1`);
      if (e.offsets !== undefined && (!Array.isArray(e.offsets) || e.offsets.length !== n || e.offsets.some((o) => !(Math.abs(o[0]) <= 64 && Math.abs(o[1]) <= 64)))) errors.push(`${d.id}: an entry's offsets are one for each of its group, each within 64 m`);
    }
    for (const l of d.limits ?? []) if (!(l.share >= 0 && l.share <= 1)) errors.push(`${d.id}: the limit of ${l.species} must be a share from 0 to 1`);
    for (const w of [...d.entries, ...(d.limits ?? [])]) if (w.waits !== undefined && !(w.waits in FEATURES)) errors.push(`${d.id}: "${w.waits}" is not a feature an entry or limit may wait for`);
  },
};
