// Materials: what each type of damage does to what is built of one, and how long that lasts unvisited.

import { DAMAGE_TYPES } from "../../sim/damage.ts";
import { f, row, type Fields, type Kind, type Named } from "../kind.ts";
import type { DamageType } from "./damage.ts";

/** Multiplier on each type of damage a structure of this material takes. A type not given does no damage. */
export interface MaterialDef extends Named {
  readonly type: "material";
  readonly id: string;
  readonly takes: { readonly [T in DamageType]?: number };
  /** Days a structure of it may go unvisited by its owners before anyone may demolish it. Omitted, never. */
  readonly decayDays?: number;
}

const FIELDS = {
  takes: f("facet", "the structure settings' damage by type"),
  decayDays: f("number", "DecayDestructionPeriodMultiplier"),
} satisfies Fields<MaterialDef>;

export const materials: Kind<MaterialDef> = {
  type: "material",
  fields: FIELDS,
  rows: [
    row("material", "material", FIELDS, { ark: "StructureSettings and its tier", shelf: "materials", must: ["takes"], may: ["decayDays"], doc: "What each type of damage does to what is built of it, and how long it lasts unvisited." }),
  ],
  check(d, { errors }) {
    for (const [type, v] of Object.entries(d.takes)) {
      if (!(DAMAGE_TYPES as readonly string[]).includes(type) || !(v >= 0)) errors.push(`${d.id}: takes.${type} must name a kind of damage and not be negative`);
    }
  },
};
