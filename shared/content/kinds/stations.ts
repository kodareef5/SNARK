// Stations: structures things are made or changed at, and the fires among them. A station is a structure, so its
// definition is a StructureDef and its class a row of structures.ts. What is here is what only a station has: its fuel,
// what it does while lit, and the columns for them.

import { TICK_RATE } from "../../coords.ts";
import type { Content } from "../defs.ts";
import { f, f32, list, u16, u8, type Checking, type Fields, type Kind } from "../kind.ts";
import type { StructureDef } from "./structures.ts";

/** The longest one piece of fuel may burn or one item take to cook. Thirty days. */
export const MAX_BURN_SECONDS = 30 * 86400;

/** A station's fuel, fire and power (planning/reference/stations-plan.md). Both kinds of a lit pair say the same. */
export interface StationFields {
  /**
   * The only fuel this station burns, and the seconds one piece lasts in it (the fabricator's gasoline, the preserving bin's
   * sparkpowder). Omitted, it burns every item by the item's own `fuel`, as a campfire does.
   */
  readonly burns?: readonly { readonly item: string; readonly seconds: number }[];
  /** False for a fire that does not cook what has `cooks` (M1), as the forge and the preserving bin do not. Omitted, it cooks. */
  readonly cooks?: boolean;
  /**
   * How many times as long things keep in it, as a species' `keeps` (M6): a feeding trough's 4 always, a preserving bin's
   * 10 on its lit kind only. A station whose two kinds keep differently has every spoil clock rescaled at the tick it swaps
   * (server/preserve.ts).
   */
  readonly keeps?: number;
  /**
   * It holds a charge full while this is its kind (ItemDef.charge): a soul vault's lit kind only, so a full soul ball in
   * it loses nothing while it burns, and runs down from full from the tick it goes out (Items.rekeep).
   */
  readonly charges?: boolean;
  /**
   * Its jobs run only while it burns (M5): no job is taken while it is out, and a unit under way when it goes out waits with
   * its ticks left (Job.rest) until it is lit again. Both kinds of a lit pair say it.
   */
  readonly powered?: boolean;
  /** It is not lit while its foot is below the map's sea level (M8). */
  readonly dry?: boolean;
}

// The stations wave's (planning/reference/stations-plan.md, S0). `burns` is read (Registry.stationFuel), `powered`
// (Progression, server/power.ts, S2), `cooks` (the hearth, S1 and S3), `keeps` (server/preserve.ts, S3) and `dry`
// (S1); the rest are stubs, each read once its project builds it.
export const STATION_FIELDS = {
  burns: f("list", "the fuel a station takes and how long each piece burns in it", { refs: { "[].item": "item" } }),
  cooks: f("switch", "whether a lit station cooks raw meat, as a campfire does and a forge does not"),
  keeps: f("number", "GetSpoilingTimeMultiplier of its inventory"),
  charges: f("switch", "a powered cryofridge holding its cryopods' charge"),
  powered: f("switch", "bRequiresPower: its crafting runs only while it is on"),
  dry: f("switch", "not lit, or not working, under water"),
} satisfies Fields<StationFields>;

/** What is wrong with the fuel a station names. */
export function fuelFaults(d: StructureDef, { errors, positive }: Checking): void {
  if (d.burns === undefined) return;
  if (!Array.isArray(d.burns) || d.burns.length === 0) errors.push(`${d.id}: burns names at least one fuel`);
  for (const b of Array.isArray(d.burns) ? d.burns : []) positive(d, "a fuel's seconds", b?.seconds, MAX_BURN_SECONDS);
  if (Array.isArray(d.burns) && new Set(d.burns.map((b) => b?.item)).size !== d.burns.length) errors.push(`${d.id}: burns names each fuel once`);
}

/**
 * What is wrong with the stations wave's fields (planning/reference/stations-plan.md, S0): the two kinds of a lit pair burn,
 * cook, need power and stay dry alike; a fired recipe is made at a fire; what a fuel leaves is another item, and only a
 * fuel leaves anything.
 */
function stationFaults(input: readonly Content[]): string[] {
  const out: string[] = [];
  const structures = new Map(input.flatMap((d) => (d.type === "structure" ? [[d.id, d] as const] : [])));
  const burnt = new Set(input.flatMap((d) => (d.type === "structure" ? (d.burns ?? []).map((b) => b?.item) : d.type === "item" && d.fuel !== undefined ? [d.id] : [])));
  for (const d of input) {
    if (d.type === "structure" && d.lights !== undefined && d.id < d.lights) {
      const other = structures.get(d.lights);
      const same = (a: StructureDef, b: StructureDef): boolean => canonical(a.burns ?? null) === canonical(b.burns ?? null) && (a.cooks ?? true) === (b.cooks ?? true) && (a.powered ?? false) === (b.powered ?? false) && (a.dry ?? false) === (b.dry ?? false);
      if (other && !same(d, other)) out.push(`${d.id}: it and ${d.lights}, lit and out, must agree on burns, cooks, powered and dry`);
    }
    if (d.type !== "item") continue;
    if (d.craft?.fired !== undefined) {
      const at = d.craft.at === undefined ? undefined : structures.get(d.craft.at);
      if (d.craft.fired && at?.lights === undefined) out.push(`${d.id}: only a fire makes a thing by itself, so craft.fired needs craft.at to name a station that lights`);
    }
    if (d.burnsInto !== undefined && (d.burnsInto === d.id || !burnt.has(d.id))) out.push(`${d.id}: burnsInto names another item, and only a fuel has it`);
  }
  return out;
}

/** Key-sorted JSON, so two lists that differ only in the order of their fields are the same text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

const columns = (n: number) => ({
  /** Per structure: 1 where it holds a charge full (ItemDef.charge). */
  charges: u8(n),
  // The stations wave's columns (planning/reference/stations-plan.md, S0). `stationBase`, `stationFuel` and `powered` (S2)
  // are read; the rest are compiled and read by nothing until the project named builds them.
  /**
   * Per structure: the one station it is to what is made at it, the unlit kind of a lit pair and the kind itself otherwise
   * (0 for everything else). `craftAt` holds base kinds, so a fire lit and out is one crafting station (M2).
   */
  stationBase: u16(n),
  /** Per structure that names its own fuel (`burns`): the ticks one of each item burns in it, 0 for what it does not take. Null where it burns every item's own fuel (fuelTicks). */
  stationFuel: list<Uint32Array>(n),
  /** Per structure: 0 for a fire that does not cook (`cooks: false`), else 1. */
  stationCooks: u8(n),
  /** Per structure: how many times as long things keep in it, 1 where not given (M6). Registry.keeps holds the same. */
  structKeeps: f32(n, 1),
  /** Per item made by a fire by itself (`craft.fired`): the station's base kind, else 0. */
  firedAt: u16(n),
  /** S2 and S1, per structure: 1 if its jobs run only while it burns, and 1 if it is not lit below sea level. */
  powered: u8(n),
  dry: u8(n),
});

export const stations: Kind<StructureDef, ReturnType<typeof columns>> = {
  type: "structure",
  survey({ errors, input }) {
    // A station's recipes take from its slots and put the product there, so a station something is made at must have some.
    const stationSlots = new Map(input.flatMap((d) => (d.type === "structure" && d.class === "station" ? [[d.id, d.slots ?? 0] as const] : [])));
    for (const d of input) if (d.type === "item" && d.craft?.at !== undefined && stationSlots.get(d.craft.at) === 0) errors.push(`${d.id}: it is made at "${d.craft.at}", which has no slots to make it from`);
    errors.push(...stationFaults(input));
  },
  columns,
  fill(d, i, reg) {
    if (d.cooks !== false) reg.stationCooks[i] = 1;
    reg.structKeeps[i] = d.keeps ?? 1;
    reg.keeps[i] = reg.structKeeps[i]!;
    if (d.charges) reg.charges[i] = 1;
    if (d.powered) reg.powered[i] = 1;
    if (d.dry) reg.dry[i] = 1;
  },
  link(d, i, reg) {
    if (!d.burns) return;
    const table = (reg.stationFuel[i] = new Uint32Array(reg.defs.length));
    // At least 1 tick, because 0 means it takes no such fuel.
    for (const b of d.burns) table[reg.index.get(b.item)!] = Math.max(1, Math.round(b.seconds * TICK_RATE));
  },
  finish(reg) {
    const n = reg.defs.length;
    // A lit station is its unlit kind to what is made at it, so an item made `at` either is made at both.
    for (let i = 1; i < n; i++) if (reg.defs[i]!.type === "structure") reg.stationBase[i] = reg.burning[i] === 1 && reg.lights[i] !== 0 ? reg.lights[i]! : i;
    for (let i = 1; i < n; i++) {
      if (reg.craftAt[i] !== 0) reg.craftAt[i] = reg.stationBase[reg.craftAt[i]!]!;
      const d = reg.defs[i]!;
      if (d.type === "item" && d.craft?.fired) reg.firedAt[i] = reg.craftAt[i]!;
    }
  },
};
