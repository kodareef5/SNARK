// Types of harm. Six are named in code (DamageType); a definition of one is a stub that waits.

import { row, stub, type Fields, type Kind, type Named } from "../kind.ts";

/** Species and structure materials each give a multiplier per type. */
export type DamageType = "melee" | "pierce" | "bullet" | "fire" | "explosive" | "energy";

/** A type of harm. A stub: the six the engine knows are named in code (`DamageType`). */
export interface DamageDef extends Named {
  readonly type: "damage";
  readonly id: string;
  readonly label?: string;
  /** Torpor given, as a multiple of the damage done. */
  readonly torpor?: number;
  /** The share of the damage, 0 to 1, that armor does not reduce. */
  readonly trueShare?: number;
  readonly melee?: boolean;
}

const FIELDS = {
  label: stub("polish", "text"),
  torpor: stub("polish", "number", "DamageTorpidityIncreaseMultiplier"),
  trueShare: stub("polish", "number", "PercentTrueDamage"),
  melee: stub("polish", "switch", "bIsMeleeDamage"),
} satisfies Fields<DamageDef>;

export const damage: Kind<DamageDef> = {
  type: "damage",
  fields: FIELDS,
  rows: [
    row("damage", "damage", FIELDS, { ark: "DmgType_", status: "partial", waits: "polish", shelf: "damage", may: ["label", "torpor", "trueShare", "melee"], doc: "A type of harm. Six are named in code: melee, pierce, bullet, fire, explosive, energy." }),
  ],
};
