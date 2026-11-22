// Engrams: learned with points at a level, for good. Its one item can then be made.

import type { Content } from "../defs.ts";
import { f, icon, row, stub, type Fields, type Kind, type Named } from "../kind.ts";

export interface EngramDef extends Named {
  readonly type: "engram";
  readonly id: string;
  readonly label: string;
  /** Level needed to learn it, and what it costs in engram points. */
  readonly level: number;
  readonly cost: number;
  /** The item it unlocks the making of. One engram, one item, as in ARK. */
  readonly item: string;
  /** It is not offered, so nobody can learn it. A survivor that already knows it keeps it. */
  readonly hidden?: boolean;
  /** A survivor that reaches this level learns it automatically and for free. */
  readonly auto?: number;
  // Stubs, read by nothing yet.
  /** Engrams that must be known first. */
  readonly requires?: readonly string[];
  /** The set of maps that offer it. */
  readonly group?: string;
  /** The boss whose defeat gives it, in place of points. */
  readonly from?: string;
}

const FIELDS = {
  label: f("text"),
  level: f("number", "RequiredCharacterLevel"),
  cost: f("number", "RequiredEngramPoints"),
  item: f("text", "BluePrintEntry", { refs: { "": "item" } }),
  hidden: f("switch", "EngramHidden"),
  auto: f("number", "EngramEntryAutoUnlocks"),
  requires: stub("polish", "list", "EngramRequirementSets", { refs: { "[]": "engram" } }),
  group: stub("maps", "text", "EngramGroup"),
  from: stub("bosses", "text", "a boss's unlock", { refs: { "": "species/creature" } }),
} satisfies Fields<EngramDef>;

/** The items that can be made, and the engram that unlocks each of those met so far. */
const craftedItems = (input: readonly Content[]): Set<string> => new Set(input.flatMap((d) => (d.type === "item" && d.craft ? [d.id] : [])));
const taughtItems = (): Map<string, string> => new Map();

export const engrams: Kind<EngramDef> = {
  type: "engram",
  fields: FIELDS,
  rows: [
    row("engram", "engram", FIELDS, { ark: "EngramEntry_", shelf: "engrams", must: ["label", "level", "cost", "item"], may: ["hidden", "auto", "requires", "group", "from"], slots: { icon: { ...icon, fallback: ["{item}/icon", "swatch"] } }, doc: "Learned with points at a level, for good. Its one item can then be made." }),
  ],
  check(d, { errors, positive }) {
    positive(d, "level", d.level, 1000);
    if (!(d.cost >= 0)) errors.push(`${d.id}: cost must not be negative`);
    if (d.auto !== undefined && !(d.auto >= 0 && d.auto <= 1000)) errors.push(`${d.id}: auto must be a level from 0 to 1000`);
  },
  among(d, { errors, once }) {
    if (typeof d.item !== "string") return;
    const crafted = once(craftedItems), taught = once(taughtItems);
    if (!crafted.has(d.item)) errors.push(`${d.id}: "${d.item}" cannot be made, so there is nothing to learn`);
    const other = taught.get(d.item);
    if (other !== undefined) errors.push(`${d.id}: ${other} already unlocks "${d.item}"`);
    taught.set(d.item, d.id);
  },
};
