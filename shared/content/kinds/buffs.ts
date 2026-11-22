// Buffs: what acts on a body for a time (server/buffs.ts).

import { DAMAGE_TYPES } from "../../sim/damage.ts";
import { f, icon, row, stub, type Fields, type Kind, type Named } from "../kind.ts";
import type { DamageType } from "./damage.ts";

/**
 * Something that acts on a body for a time, such as burning or a dose of narcotic. A body may have several at once.
 * A buff is never stepped. Its end tick is known when it begins, its effect on vitals is a change of rate, and its
 * multipliers are read when needed.
 */
export interface BuffDef extends Named {
  readonly type: "buff";
  readonly id: string;
  readonly label: string;
  /** Palette index of its mark in the interface. */
  readonly color: number;
  /** Seconds it lasts when its giver does not say. Omitted, it lasts until removed. */
  readonly seconds?: number;
  /** When given again while active, "refresh" (the default) restarts its time and "stack" adds another with its own end. */
  readonly again?: "refresh" | "stack";
  /** Health per second (negative harms) and torpor per second while it lasts. */
  readonly health?: number;
  readonly torpor?: number;
  /** The kind of damage its harm to health is, scaled by what the body takes of that kind. Omitted, none scales it. */
  readonly damage?: DamageType;
  /** Multipliers on the body's speed, the damage it deals and the damage it takes. */
  readonly speed?: number;
  readonly dealt?: number;
  readonly taken?: number;
  /** The body cannot move. */
  readonly root?: boolean;
  /** Nothing harms the body. */
  readonly immune?: boolean;
  /** A beneficial buff, shown apart from harmful ones. */
  readonly good?: boolean;
  // The bola's fields (planning/reference/weapons-plan.md, M6), read where a hit gives the buff (server/entangle.ts).
  /** The species it takes, the survivor's among them if it takes survivors; omitted, any. ARK's bola names its list (Bola). */
  readonly only?: readonly string[];
  /** Seconds it lasts on a survivor, in place of `seconds` (the bola's 25 against a creature's 30). */
  readonly survivorSeconds?: number;
  /**
   * A buff given as it ends, if the body is one that buff takes, and while that one lasts this one is not given again:
   * the bola's 10 s of grace (patch 240.5).
   */
  readonly after?: string;
}

const FIELDS = {
  label: f("text"),
  color: f("number"),
  seconds: f("number", "DeactivateAfterTime"),
  again: f("text"),
  health: f("number", "ValuesToAddPerSecond"),
  torpor: f("number", "ValuesToAddPerSecond"),
  damage: f("text"),
  speed: f("number", "CharacterMultiplier"),
  dealt: f("number", "CharacterMultiplier"),
  taken: f("number", "CharacterMultiplier"),
  root: f("switch"),
  immune: f("switch"),
  good: stub("polish", "switch"),
  // Built by W4 of planning/reference/weapons-plan.md (server/entangle.ts gives a buff that names them).
  only: f("list", "the species a bola takes (Bola)", { refs: { "[]": "species" } }),
  survivorSeconds: f("number", "a bola's time on a survivor"),
  after: f("text", "", { refs: { "": "buff" } }),
} satisfies Fields<BuffDef>;

export const buffs: Kind<BuffDef> = {
  type: "buff",
  fields: FIELDS,
  rows: [
    row("buff", "buff", FIELDS, { ark: "Buff_", shelf: "buffs", must: ["label", "color"], may: ["seconds", "again", "health", "torpor", "damage", "speed", "dealt", "taken", "root", "immune", "good", "only", "survivorSeconds", "after"], slots: { icon, effect: { asset: "effect", need: "may", from: "{id}/effect", fallback: ["none"] } }, doc: "Acts on a body for a time." }),
  ],
  check(d, { errors, positive }) {
    if (d.seconds !== undefined) positive(d, "seconds", d.seconds, 86400);
    if (d.survivorSeconds !== undefined) positive(d, "survivorSeconds", d.survivorSeconds, 86400);
    if (d.after === d.id) errors.push(`${d.id}: after must name another buff`);
    for (const [name, v] of [["speed", d.speed], ["dealt", d.dealt], ["taken", d.taken]] as const) {
      if (v !== undefined && !(v >= 0 && v <= 100)) errors.push(`${d.id}: ${name} must be from 0 to 100`);
    }
    if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    if (d.damage !== undefined && !DAMAGE_TYPES.includes(d.damage)) errors.push(`${d.id}: damage must name a kind of damage`);
  },
};
