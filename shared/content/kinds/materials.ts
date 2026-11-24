// Materials: what each type of damage does to what is built of one, and how long that lasts unvisited.

import { DAMAGE_TYPES } from "../../sim/damage.ts";
import type { Content } from "../defs.ts";
import { f, f32, list, row, type Fields, type Kind, type Named } from "../kind.ts";
import type { DamageType } from "./damage.ts";

/** Multiplier on each type of damage a structure of this material takes. A type not given does no damage. */
export interface MaterialDef extends Named {
  readonly type: "material";
  readonly id: string;
  readonly takes: { readonly [T in DamageType]?: number };
  /** Days a structure of it may go unvisited by its owners before anyone may demolish it. Omitted, never. */
  readonly decayDays?: number;
  /** A city material: the health of one half of a piece built of it. A piece's is this times its halves and its family's toughness. */
  readonly health?: number;
  /** The energy in joules a ramming body spends to break through one half. Omitted, nothing rams through it. */
  readonly ram?: number;
  /** What one half's heap of it gives in all, mined out: each an item and how many. */
  readonly heap?: readonly { readonly item: string; readonly count: number }[];
  /** The stability of a built piece of it that stands by itself (shared/world/support.ts). Omitted, 4. */
  readonly stability?: number;
}

/** Every material by its id. */
export const materialsById = (input: readonly Content[]): Map<string, MaterialDef> => new Map(input.flatMap((d) => (d.type === "material" ? [[d.id, d] as const] : [])));

const FIELDS = {
  takes: f("facet", "the structure settings' damage by type"),
  decayDays: f("number", "DecayDestructionPeriodMultiplier"),
  health: f("number"),
  ram: f("number"),
  heap: f("list", "", { refs: { "[].item": "item" } }),
  stability: f("number"),
} satisfies Fields<MaterialDef>;

const columns = (n: number) => ({
  /** Per material: the health of one half of a city piece of it, and the joules that ram through one half. 0 for none. */
  halfHealth: f32(n),
  ramEnergy: f32(n),
  /** Per material: what one half's heap gives in all, each an item's index and a count. Null for one that leaves nothing. */
  heapYield: list<readonly { readonly item: number; readonly count: number }[]>(n),
});

export const materials: Kind<MaterialDef, ReturnType<typeof columns>> = {
  type: "material",
  fields: FIELDS,
  rows: [
    row("material", "material", FIELDS, { ark: "StructureSettings and its tier", shelf: "materials", must: ["takes"], may: ["decayDays", "health", "ram", "heap", "stability"], doc: "What each type of damage does to what is built of it, and how long it lasts unvisited. It may say how firmly a piece of it stands by itself, which is how far it may be built out from what holds it. A city material also says the health of one half of a piece, the energy that rams through one, and what its heap gives." }),
  ],
  check(d, { errors }) {
    for (const [type, v] of Object.entries(d.takes)) {
      if (!(DAMAGE_TYPES as readonly string[]).includes(type) || !(v >= 0)) errors.push(`${d.id}: takes.${type} must name a kind of damage and not be negative`);
    }
    if (d.health !== undefined && !(d.health > 0)) errors.push(`${d.id}: health is more than 0`);
    if (d.ram !== undefined && !(d.ram > 0)) errors.push(`${d.id}: ram is more than 0 joules`);
    if (d.stability !== undefined && !(Number.isInteger(d.stability) && d.stability >= 1 && d.stability <= 15)) errors.push(`${d.id}: stability is a whole number from 1 to 15`);
    for (const y of d.heap ?? []) if (!(Number.isInteger(y?.count) && y.count > 0)) errors.push(`${d.id}: a heap gives a whole number of an item, more than 0`);
  },
  columns,
  fill(d, i, reg) {
    reg.halfHealth[i] = d.health ?? 0;
    reg.ramEnergy[i] = d.ram ?? 0;
  },
  link(d, i, reg) {
    if (d.heap && d.heap.length > 0) reg.heapYield[i] = d.heap.map((y) => ({ item: reg.index.get(y.item)!, count: y.count }));
  },
};
