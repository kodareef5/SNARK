// What the guide says of each thing a player meets, from the compiled content alone: creatures, characters, vehicles,
// and the things a player makes or finds, each made thing one entry with its engram and the structure it places.
// Everything is derived, so a definition added to the content has its entry, and its links both ways, with no edit here.

import { CORE_CONTENT } from "../../content/core.ts";
import { torporDrain, torporMax } from "../../server/survival.ts";
import { defaultLook, lookColors } from "../../shared/anim/look.ts";
import type { Def, EngramDef, ItemDef, NodeDef, SpeciesDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { Genome, STAT_NAMES, type StatName } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { piecesNeeded, narcoticsNeeded, tameSeconds } from "../../shared/sim/taming.ts";
import { iconSubjects, type IconFraming } from "../pack/icons.ts";
import type { Subject } from "./posters.ts";

export type Kind = "creatures" | "characters" | "vehicles" | "items";
export const KINDS: readonly Kind[] = ["creatures", "items", "vehicles", "characters"];

/** Another entry by its id, shown as a link where the guide has it, with words after it. */
export interface Ref {
  id: string;
  note?: string;
}
export type Cell = string | Ref;
export interface Table {
  title: string;
  head: Cell[];
  rows: Cell[][];
  note?: string;
}
export interface Fact {
  label: string;
  value: Cell[];
}

export interface Entry {
  id: string;
  kind: Kind;
  label: string;
  group: string;
  facts: Fact[];
  tables: Table[];
  related: { relation: string; refs: Ref[] }[];
  /** The console line that makes one, from the command it names. */
  console: string | null;
  /** The owners whose sounds the entry plays. */
  owners: string[];
  picture: Omit<Subject, "key"> | null;
}

/** The levels a wild creature's tables are given at: ARK's at its default difficulty, 1 to 150. */
export const LEVELS = [1, 30, 60, 90, 120, 150];
const GAME_HOUR = GAME_HOUR_TICKS / TICK_RATE;

export const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const words = (id: string): string => sentence(id.slice(id.indexOf(":") + 1).replace(/[_/-]+/g, " "));
const labelOf = (d: Def): string => sentence(("label" in d && d.label) || words(d.id));

/** A number as a player reads it: grouped, and to `digits` places with trailing zeros dropped. */
export function num(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Seconds as days, hours, minutes and seconds, the two largest that are not zero. */
export function time(seconds: number): string {
  const s = Math.round(seconds);
  const parts = [[Math.floor(s / 86400), "d"], [Math.floor(s / 3600) % 24, "h"], [Math.floor(s / 60) % 60, "min"], [s % 60, "s"]] as const;
  const first = parts.findIndex(([n]) => n > 0);
  if (first < 0) return "0 s";
  return parts.slice(first, first + 2).filter(([n]) => n > 0).map(([n, u]) => `${n} ${u}`).join(" ");
}

const pct = (share: number): string => `${num(share * 100, 1)}%`;
const per = (n: number, unit = ""): string => `+${num(n, 2)}${unit}`;

const STAT_LABELS: Readonly<Record<StatName, string>> = {
  health: "Health", stamina: "Stamina", oxygen: "Oxygen", food: "Food", water: "Water", weight: "Weight",
  melee: "Melee damage", speed: "Movement speed", torpidity: "Torpidity", fortitude: "Fortitude",
  crafting: "Crafting skill", temperature: "Temperature",
};
/** Stats given as a share of the base: 1 is 100%. */
const SHARE_STATS: ReadonlySet<StatName> = new Set(["melee", "speed", "crafting"]);
const TEMPER = { hunts: "Aggressive", defends: "Neutral", flees: "Passive" } as const;
const ITEM_GROUPS: Readonly<Record<string, string>> = {
  resource: "Resource", consumable: "Consumable", weapon: "Weapon", ammo: "Ammunition", attachment: "Attachment",
  armor: "Armor", saddle: "Saddle", vehicle: "Vehicle", egg: "Egg", feces: "Feces", structure: "Structure",
};
const STRUCTURE_GROUPS: Readonly<Record<string, string>> = { piece: "Building", container: "Storage", station: "Crafting station", bed: "Bed" };

/** A wild creature of `level` with every point in health: torpor counts every wild level alike. */
function wild(level: number): Genome {
  const g = new Genome();
  g.wild[0] = level - 1;
  return g;
}

function statTable(d: SpeciesDef, survivor: boolean): Table | null {
  const rows: Cell[][] = [];
  for (const stat of STAT_NAMES) {
    const curve = d.stats?.[stat];
    if (!curve) continue;
    const [base, wildGain, tamedGain] = curve;
    const share = SHARE_STATS.has(stat);
    const shown = (n: number): string => (share ? pct(n) : num(n, 1));
    const gain = (g: number): string => (g === 0 ? "" : share ? per(base * g * 100, "%") : `${per(base * g)} (${pct(g)})`);
    rows.push(survivor ? [STAT_LABELS[stat], shown(base), gain(tamedGain)] : [STAT_LABELS[stat], shown(base), gain(wildGain), tamedGain === 0 ? "" : `+${pct(tamedGain)}`]);
  }
  if (rows.length === 0) return null;
  const note = survivor ? "A point spent on a stat at a level-up adds what its row says." : "A wild level adds to the base; a level gained when tamed adds to what the wild levels made.";
  return { title: "Stats", head: survivor ? ["Stat", "Base", "A point"] : ["Stat", "Base", "Wild level", "Tamed level"], rows, note };
}

function tamingTable(d: SpeciesDef, defs: readonly Def[]): Table | null {
  if (!d.taming || !d.eats?.length || !d.stats?.torpidity) return null;
  const doses = defs.filter((x): x is ItemDef => x.type === "item" && x.dose !== undefined);
  const head: Cell[] = ["Level", "Torpor", "Wakes after", ...d.eats.map((f) => ({ id: f.item })), ...doses.map((x) => ({ id: x.id }))];
  const rows = LEVELS.map((level): Cell[] => {
    const most = torporMax(d, wild(level));
    const drain = torporDrain(d, wild(level));
    const eats = d.eats!.map((f) => {
      const pieces = piecesNeeded(d.taming!, level, f.affinity, 1);
      return { pieces, seconds: tameSeconds(d.taming!, pieces, f.food) };
    });
    const longest = Math.max(...eats.map((e) => e.seconds));
    const fed = eats.map((e) => `${e.pieces} in ${time(e.seconds)}`);
    const kept = doses.map((x) => String(narcoticsNeeded(most, drain, longest, x.dose!.torpor, x.dose!.seconds)));
    return [String(level), num(most, 0), time(most / drain), ...fed, ...kept];
  });
  const note = "Knocked out, then fed one food alone, at a taming speed of 1: how many, and how long. The doses keep it down through the slowest.";
  return { title: "Taming", head, rows, note };
}

function dropTable(d: SpeciesDef | NodeDef, tools: readonly ItemDef[]): Table | null {
  if (d.type === "species") {
    if (!d.drops?.length) return null;
    const total = d.drops.reduce((n, x) => n + (x.weight ?? 1), 0);
    const rows = d.drops.map((x): Cell[] => {
      const favoured = tools.filter((t) => t.tool!.on === x.favoured);
      return [{ id: x.item }, x.min === x.max ? String(x.min) : `${x.min} to ${x.max}`, pct((x.weight ?? 1) / total), ...(favoured.length ? favoured.map((t): Cell => ({ id: t.id })) : [""])];
    });
    const note = d.corpse ? `A grown body takes ${num(d.corpse.health)} harvest damage before it is used up, a roll for every ${num(d.corpse.roll)}. A favoured tool picks its drop half as often again.` : undefined;
    return { title: "Harvesting", head: ["Gives", "A roll", "Share", "More with"], rows, ...(note ? { note } : {}) };
  }
  return null;
}

/** The console line that makes one of `id` with the command `name`, which must be registered. */
export type ConsoleLine = (name: string, id: string) => string;

export interface CatalogueInput {
  defs?: readonly Def[];
  console?: ConsoleLine;
  /** Authored views of pieces' pictures, by mesh id. */
  framing?: ReadonlyMap<string, IconFraming>;
  /** Meshes the game's build has. */
  meshes?: ReadonlySet<string>;
}

/** The guide's entries, in label order within each kind. */
export function buildCatalogue(input: CatalogueInput = {}): Entry[] {
  const defs = input.defs ?? CORE_CONTENT;
  const compiled = compileContent(defs);
  if (!compiled.registry) throw new Error(`the content does not compile: ${compiled.errors.join("; ")}`);
  const reg = compiled.registry;
  const line = input.console ?? ((name: string, id: string) => `${name} ${id}`);
  const has = (mesh: string): boolean => (input.meshes ? input.meshes.has(mesh) : mesh !== "box" && mesh !== "shape");
  const byId = new Map(defs.map((d) => [d.id, d]));
  const of = <T extends Def["type"]>(type: T): Extract<Def, { type: T }>[] => defs.filter((d): d is Extract<Def, { type: T }> => d.type === type);
  const items = of("item");
  const tools = items.filter((d) => d.tool);
  const engramOf = new Map(of("engram").map((e: EngramDef) => [e.item, e]));
  const placer = new Map<string, ItemDef>();
  for (const d of items) for (const s of d.places ?? []) if (!placer.has(s)) placer.set(s, d);
  // A station is named by the structure it is: the guide has the item that places it.
  const made = (id: string): string => placer.get(id)?.id ?? id;
  const icons = new Map(iconSubjects(reg.defs, has).map((s) => [s.owner, s]));
  const entries = new Map<string, Entry>();
  const add = (e: Entry): void => void entries.set(e.id, e);

  for (const d of of("species")) {
    const creature = d.class === "creature";
    if (!["creature", "survivor", "civilian", "vehicle"].includes(d.class) || !has(d.mesh === "core:human" ? "core:human_m/head" : d.mesh)) continue;
    const kind: Kind = creature ? "creatures" : d.class === "vehicle" ? "vehicles" : "characters";
    const e: Entry = { id: d.id, kind, label: labelOf(d), group: creature ? (d.fly ? "Flyer" : "Creature") : kind === "vehicles" ? sentence(d.vehicle?.movement ?? "car") : "Human", facts: [], tables: [], related: [], console: null, owners: [d.id], picture: null };
    const fact = (label: string, ...value: Cell[]): void => void e.facts.push({ label, value });
    if (d.mesh === "core:human") {
      const colors = new Uint8Array(6);
      lookColors(defaultLook(), colors);
      e.picture = { meshes: ["head", "torso", "hands", "legs", "feet", "hair/buzzed"].map((p) => `core:human_m/${p}`), colors: [...colors], body: true };
    } else {
      const regions = d.regions?.map((r) => r?.colors[0]?.[0] ?? 0);
      e.picture = { meshes: [d.mesh], colors: regions ?? [], body: true };
    }
    if (kind === "vehicles") {
      const v = d.vehicle!;
      const spec = v.spec as unknown as Record<string, number>;
      fact("Top speed", `${num(spec.maxForward! * 3.6, 0)} km/h`);
      if (spec.maxReverse) fact("Reverse", `${num(spec.maxReverse * 3.6, 0)} km/h`);
      if (spec.climbSpeed) fact("Climbs at", `${num(spec.climbSpeed, 1)} m/s`);
      fact("Seats", String(v.seats.length));
      if (v.doors.length) fact("Doors", String(v.doors.length));
      if (spec.fuelCapacity) fact("Fuel tank", `${num(spec.fuelCapacity)} units`, `, ${time(spec.fuelCapacity / spec.fuelPerSecond!)} at full throttle`);
      fact("Health", num(d.stats?.health?.[0] ?? 0));
      if (d.slots) fact("Inventory", `${d.slots} slots`);
      if (d.stats?.weight) fact("Carries", `${num(d.stats.weight[0])} kg`);
      fact("Mass", `${num(spec.mass ?? d.mass ?? 0)} kg`);
      e.console = line("spawn", d.id);
    } else {
      if (creature) {
        fact("Temperament", TEMPER[d.temper ?? "flees"]);
        fact("Tameable", d.taming && d.stats?.torpidity ? "By knockout" : "No");
        const saddle = items.find((s) => s.saddle?.fits === d.id);
        fact("Rideable", ...(saddle ? ["With a ", { id: saddle.id }] : ["No"]));
        if (d.breeds) {
          const egg = d.breeds.egg ? byId.get(d.breeds.egg) : undefined;
          fact("Breeds", ...(egg?.type === "prop" && egg.item ? ["Lays a ", { id: egg.item }] : ["Bears live young"]));
          fact(d.breeds.egg ? "Incubation" : "Gestation", time(d.breeds.incubate));
          fact("Maturation", time(d.breeds.mature));
        }
      }
      fact("Speed", `${num(d.walkSpeed, 1)} m/s walking, ${num(d.walkSpeed * d.sprintMul, 1)} sprinting`);
      if (d.fly) fact("Flies", "Yes");
      const takes = Object.entries(d.takes ?? {}).map(([type, x]) => `${sentence(type)} ×${num(x)}`);
      const zones = Object.entries(d.zones ?? {}).map(([zone, x]) => `${sentence(zone)} hits ×${num(x)}`);
      if (takes.length || zones.length) fact("Damage taken", [...takes, ...zones].join(", "));
      if (d.killXp) fact("Experience for a kill", `${num(d.killXp)} at level 1, a tenth more a level`);
      const stats = statTable(d, d.class === "survivor");
      if (stats) e.tables.push(stats);
      const taming = creature ? tamingTable(d, defs) : null;
      if (taming) e.tables.push(taming);
      const drops = dropTable(d, tools);
      if (drops) e.tables.push(drops);
      if (creature) e.console = line("spawn", d.id);
    }
    add(e);
  }

  for (const d of items) {
    const engram = engramOf.get(d.id);
    const placed = (d.places ?? []).map((s) => byId.get(s)).filter((s): s is StructureDef => s?.type === "structure");
    const first = placed[0];
    const group = first ? (STRUCTURE_GROUPS[first.class] ?? "Structure") : (ITEM_GROUPS[d.class] ?? sentence(d.class));
    const e: Entry = { id: d.id, kind: "items", label: labelOf(engram ?? d), group, facts: [], tables: [], related: [], console: line("give", d.id), owners: [d.id, ...placed.map((s) => s.id)], picture: null };
    const fact = (label: string, ...value: Cell[]): void => void e.facts.push({ label, value });
    const icon = icons.get(d.id);
    if (icon) e.picture = { meshes: [icon.mesh], colors: icon.colors, body: false, framing: input.framing?.get(icon.mesh) ?? input.framing?.get(icon.mesh.replace(/\/dropped$/, "")) ?? null };
    fact("Weight", `${num(d.weight ?? 0.1)} kg`);
    fact("Stack", String(d.stack));
    if (d.spoilHours !== undefined) fact("Spoils in", time(d.spoilHours * GAME_HOUR));
    if (d.eat) fact("Eaten", [d.eat.food && `${num(d.eat.food)} food`, d.eat.water && `${num(d.eat.water)} water`, d.eat.health && `${num(d.eat.health)} health`].filter(Boolean).join(", "));
    if (d.dose) fact("Fed to a creature", `${num(d.dose.torpor)} torpor over ${time(d.dose.seconds)}`);
    if (d.fuel) fact("Burns for", time(d.fuel));
    if (d.tool) fact("Tool", `Works ${d.tool.on} at ${num(d.tool.power)}× bare hands, ${d.tool.uses} uses`);
    if (d.wear) fact("Armor", `${num(d.wear.armor)} on the ${d.wear.slot}, ${d.wear.uses} durability`);
    if (d.saddle) fact("Saddle", `${num(d.saddle.armor)} armor, ${d.saddle.seats.length} ${d.saddle.seats.length === 1 ? "seat" : "seats"} on a `, { id: d.saddle.fits });
    if (d.deploys) fact("Deploys a", { id: d.deploys });
    const w = d.weapon;
    if (w) {
      if (w.damage) fact("Damage", `${num(w.damage)}${w.type ? ` ${w.type}` : ""}`);
      if (w.reach) fact("Reach", `${num(w.reach)} m`);
      if (w.clip) fact("Magazine", `${w.clip}, ${num(w.reload ?? 0)} s to reload`);
      if (w.interval) fact("Rate of fire", `${num(1 / w.interval, 1)} a second`);
      fact("Durability", `${w.uses} uses`);
      if (w.melee) fact("Strikes for", `${num(w.melee.damage)} damage`);
      const ammo = (w.ammo ?? []).map((a) => byId.get(a)).filter((a): a is ItemDef => a?.type === "item" && a.ammo !== undefined);
      if (ammo.length) e.tables.push({ title: "Ammunition", head: ["Fires", "Damage"], rows: ammo.map((a): Cell[] => [{ id: a.id }, `${num(a.ammo!.damage * (w.power ?? 1))}${a.ammo!.pellets ? ` × ${a.ammo!.pellets} pellets` : ""} ${a.ammo!.type}`]) });
      if (w.fits?.length) e.related.push({ relation: "Takes", refs: w.fits.map((id) => ({ id })) });
    }
    if (d.ammo && !w) fact("Damage", `${num(d.ammo.damage)}${d.ammo.pellets ? ` × ${d.ammo.pellets} pellets` : ""} ${d.ammo.type}`);
    if (first) {
      fact("Health", num(first.hp));
      const size = first.half.map((h) => num(h * 2, 1)).join(" × ");
      fact("Size", `${size} m`);
      const material = first.material ? byId.get(first.material) : undefined;
      if (material?.type === "material") {
        const takes = Object.entries(material.takes ?? {}).map(([type, x]) => `${type} ×${num(x)}`);
        if (takes.length) fact("Harmed by", takes.join(", "));
        const days = first.decayDays ?? material.decayDays;
        if (days) fact("Decays", `after ${num(days)} days unvisited`);
      }
      if (first.slots) fact("Holds", `${first.slots} stacks`);
      if (first.keeps) fact("Keeps food", `${num(first.keeps)}× as long`);
      if (first.burns?.length) fact("Burns", ...first.burns.flatMap((b, k): Cell[] => [...(k ? [", "] : []), { id: b.item }, ` for ${time(b.seconds)}`]));
      if (first.bed) fact("Respawn", first.once ? "Once, for whoever set it down" : `Every ${time(first.wait ?? 0)}`);
      if (placed.length > 1) e.related.push({ relation: "Also set as", refs: placed.slice(1).map((s) => ({ id: s.id, note: labelOf(s) })) });
    }
    if (d.craft) {
      const c = d.craft;
      e.tables.push({
        title: "Crafting",
        head: ["Ingredient", "Count"],
        rows: c.needs.map((n): Cell[] => [{ id: n.item }, String(n.count)]),
        note: `${c.count && c.count > 1 ? `Makes ${c.count} in` : "Takes"} ${time(c.seconds)}${c.xp ? ` and gives ${num(c.xp)} experience` : ""}.`,
      });
      if (c.at) fact(c.fired ? "Made in" : "Crafted at", { id: made(c.at) });
      else fact("Crafted", "In the hands");
      if (c.level) fact("Needs level", String(c.level));
    }
    if (engram) {
      fact("Engram", `Level ${engram.level}, ${engram.cost} ${engram.cost === 1 ? "point" : "points"}${engram.auto !== undefined ? `, learnt at level ${engram.auto}` : ""}`);
    }
    if (d.cooks) fact("Cooks into", { id: d.cooks.into }, ` over ${time(d.cooks.seconds)}`);
    if (d.spoilsInto) fact("Spoils into", { id: d.spoilsInto });
    if (d.burnsInto) fact("Leaves", { id: d.burnsInto }, " when burnt");
    add(e);
  }

  // The other way round: what uses each thing, and where it is found.
  const back = (id: string, relation: string, ref: Ref): void => {
    const e = entries.get(id);
    if (!e) return;
    let group = e.related.find((r) => r.relation === relation);
    if (!group) e.related.push((group = { relation, refs: [] }));
    if (!group.refs.some((r) => r.id === ref.id && r.note === ref.note)) group.refs.push(ref);
  };
  for (const d of items) {
    for (const n of d.craft?.needs ?? []) back(n.item, "Used to craft", { id: d.id });
    if (d.craft?.at) back(made(d.craft.at), "Crafts", { id: d.id });
    for (const a of d.weapon?.ammo ?? []) back(a, "Fired by", { id: d.id });
    for (const f of d.weapon?.fits ?? []) back(f, "Fits", { id: d.id });
    if (d.cooks) back(d.cooks.into, "Cooked from", { id: d.id });
    if (d.spoilsInto) back(d.spoilsInto, "Spoiled from", { id: d.id });
    if (d.deploys) back(d.deploys, "Built from", { id: d.id });
    if (d.saddle) back(d.saddle.fits, "Ridden with", { id: d.id });
  }
  for (const s of of("species")) {
    for (const x of s.drops ?? []) back(x.item, "Harvested from", { id: s.id });
    for (const f of s.eats ?? []) back(f.item, "Tames", { id: s.id });
    if (s.feces) back(s.feces, "Left by", { id: s.id });
  }
  for (const n of of("node")) {
    for (const item of new Set(n.yields.map((y) => y.item))) {
      const [bare, tool] = [n.yields.some((y) => y.item === item && !y.tool), n.yields.some((y) => y.item === item && y.tool)];
      back(item, "Gathered from", bare && tool ? { id: n.id, note: "more with a tool" } : tool ? { id: n.id, note: "with a tool" } : { id: n.id });
    }
  }
  return KINDS.flatMap((k) => [...entries.values()].filter((e) => e.kind === k).sort((a, b) => a.label.localeCompare(b.label)));
}

/** What each entry and node is called, for words beside a link. */
export function namesOf(entries: readonly Entry[], defs: readonly Def[] = CORE_CONTENT): Map<string, string> {
  const out = new Map(defs.filter((d) => d.type === "node" || d.type === "structure").map((d) => [d.id, labelOf(d)]));
  for (const e of entries) out.set(e.id, e.label);
  return out;
}
