// What the wiki says of each thing a player meets, from the compiled content and the landmarks alone: creatures, characters,
// vehicles, the things a player makes or finds (each made thing one entry with its engram and the structure it places),
// the trees, rocks and plants they gather from, the statuses that act on a body, and the landmarks maps place.
// Everything is derived, so a definition added to the content has its entry, and its links both ways, with no edit here.

import { CORE_CONTENT } from "../../content/core.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import { rated, tamingRows, type TamingInput } from "../../client/core/wiki/rates.ts";
import { num, time } from "../../client/core/wiki/format.ts";
import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { HAIR_STYLES, LOOK_HAIR, LOOK_SEX, SEX_IDS, defaultLook, lookColors } from "../../shared/anim/look.ts";
import type { Def, EngramDef, ItemDef, NodeDef, ShapeDef, SpeciesDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { STAT_NAMES, type StatName } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import type { Landmark } from "../../shared/world/landmark.ts";
import { iconSubjects, type IconFraming } from "../pack/icons.ts";
import type { Subject } from "./posters.ts";

export { num, time };

export type Kind = "creatures" | "characters" | "vehicles" | "items" | "resources" | "statuses" | "landmarks";
export const KINDS: readonly Kind[] = ["creatures", "items", "resources", "vehicles", "landmarks", "statuses", "characters"];

/** Another entry by its id, shown as a link where the wiki has it, with words after it. */
export interface Ref {
  id: string;
  note?: string;
}
/** A figure a server's settings change: its kind and inputs (client/core/wiki/rates.ts), and what it is at their defaults. */
export interface Rated {
  rate: string;
  v: string;
  text: string;
}
export type Cell = string | Ref | Rated;
export interface Table {
  title: string;
  head: Cell[];
  rows: Cell[][];
  note?: Cell[];
  /** A taming table, worked out again on the page for the server's taming speed and difficulty. */
  taming?: TamingInput;
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
  /** What it is in a line, under its name on its card, where its group says too little. */
  line?: string;
}

const GAME_HOUR = GAME_HOUR_TICKS / TICK_RATE;

export const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const words = (id: string): string => sentence(id.slice(id.indexOf(":") + 1).replace(/[_/-]+/g, " "));
const labelOf = (d: Def): string => sentence(("label" in d && d.label) || words(d.id));
/** A figure as it reads at the defaults, with what the page needs to work it out for another server. */
const rate = (kind: string, v: number | string): Rated => ({ rate: kind, v: String(v), text: rated(kind, String(v)) });

const pct = (share: number): string => `${num(share * 100, 1)}%`;
const per = (n: number, unit = ""): string => `+${num(n, 2)}${unit}`;
/** Seconds as the wiki writes a short time: tenths below a minute. */
const brief = (s: number): string => (s < 60 ? `${num(s, 1)} s` : time(s));

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
/** A node is grouped by what works it; one with no material is picked by hand. */
const NODE_GROUPS: Readonly<Record<string, string>> = { wood: "Tree", stone: "Rock" };

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
  return { title: "Stats", head: survivor ? ["Stat", "Base", "A point"] : ["Stat", "Base", "Wild level", "Tamed level"], rows, note: [note] };
}

function tamingTable(d: SpeciesDef, defs: readonly Def[]): Table | null {
  if (!d.taming || !d.eats?.length || !d.stats?.torpidity) return null;
  const doses = defs.filter((x): x is ItemDef => x.type === "item" && x.dose !== undefined);
  const head: Cell[] = ["Level", "Torpor", "Wakes after", ...d.eats.map((f) => ({ id: f.item })), ...doses.map((x) => ({ id: x.id }))];
  const taming: TamingInput = {
    p: d.taming,
    torpor: [d.stats.torpidity[0], d.stats.torpidity[1], d.torporDrain ?? 1],
    eats: d.eats.map((f) => [f.affinity, f.food] as const),
    doses: doses.map((x) => [x.dose!.torpor, x.dose!.seconds] as const),
  };
  const note = "Knocked out, then fed one food alone: how many, and how long. The doses keep it down through the slowest.";
  return { title: "Taming", head, rows: tamingRows(taming), note: [note], taming };
}

function dropTable(d: SpeciesDef, tools: readonly ItemDef[]): Table | null {
  if (!d.drops?.length) return null;
  const total = d.drops.reduce((n, x) => n + (x.weight ?? 1), 0);
  const rows = d.drops.map((x): Cell[] => {
    const favoured = tools.filter((t) => t.tool!.on === x.favoured);
    return [{ id: x.item }, rate("body", `${x.min} ${x.max}`), pct((x.weight ?? 1) / total), ...(favoured.length ? favoured.map((t): Cell => ({ id: t.id })) : [""])];
  });
  const note: Cell[] = d.corpse
    ? ["A grown body takes ", rate("health", d.corpse.health), ` harvest damage before it is used up, a roll for every ${num(d.corpse.roll)}. A favoured tool picks its drop half as often again.`]
    : [];
  return { title: "Harvesting", head: ["Gives", "A roll", "Share", "More with"], rows, ...(note.length ? { note } : {}) };
}

/** What one hit on a node gives of each item, by hand and with each tool that works it. */
function yieldTable(d: NodeDef, tools: readonly ItemDef[]): Table {
  const working = d.material === undefined ? [] : tools.filter((t) => t.tool!.on === d.material);
  const ways: [Cell, number][] = [[d.material === undefined ? "A pick" : "By hand", 0], ...working.map((t): [Cell, number] => [{ id: t.id }, t.tool!.power])];
  const items = [...new Set(d.yields.map((y) => y.item))];
  const rows = items.map((item): Cell[] => [
    { id: item },
    ...ways.map(([, power]): Cell => {
      const got = d.yields.filter((y) => y.item === item && (power > 0 || !y.tool));
      const by = (y: NodeDef["yields"][number]): number => (power === 0 || y.flat ? 1 : power);
      return got.length ? rate("node", got.map((y) => `${y.min * by(y)} ${y.max * by(y)}`).join(",")) : "";
    }),
  ]);
  const note = d.material === undefined ? "What one pick gives." : "What one hit gives. A tool that works it multiplies all but what only it gets.";
  return { title: d.material === undefined ? "Picking" : "Gathering", head: ["Gives", ...ways.map(([h]) => h)], rows, note: [note] };
}

/** The console line that makes one of `id` with the command `name`, which must be registered. */
export type ConsoleLine = (name: string, id: string) => string;

export interface CatalogueInput {
  defs?: readonly Def[];
  landmarks?: readonly Landmark[];
  console?: ConsoleLine;
  /** Authored views of pieces' pictures, by mesh id. */
  framing?: ReadonlyMap<string, IconFraming>;
  /** Meshes the game's build has. */
  meshes?: ReadonlySet<string>;
}

/** The wiki's entries, in label order within each kind. */
export function buildCatalogue(input: CatalogueInput = {}): Entry[] {
  const defs = input.defs ?? CORE_CONTENT;
  const compiled = compileContent(defs);
  if (!compiled.registry) throw new Error(`the content does not compile: ${compiled.errors.join("; ")}`);
  const reg = compiled.registry;
  const line = input.console ?? ((name: string, id: string) => `${name} ${id}`);
  const has = (mesh: string): boolean => (input.meshes ? input.meshes.has(mesh) : mesh !== "box" && mesh !== "shape" && mesh !== "none");
  const byId = new Map(defs.map((d) => [d.id, d]));
  const of = <T extends Def["type"]>(type: T): Extract<Def, { type: T }>[] => defs.filter((d): d is Extract<Def, { type: T }> => d.type === type);
  const items = of("item");
  const tools = items.filter((d) => d.tool);
  const engramOf = new Map(of("engram").map((e: EngramDef) => [e.item, e]));
  const placer = new Map<string, ItemDef>();
  for (const d of items) for (const s of d.places ?? []) if (!placer.has(s)) placer.set(s, d);
  // A station is named by the structure it is: the wiki has the item that places it.
  const made = (id: string): string => placer.get(id)?.id ?? id;
  const icons = new Map(iconSubjects(reg.defs, has).map((s) => [s.owner, s]));
  const entries = new Map<string, Entry>();
  const add = (e: Entry): Entry => (entries.set(e.id, e), e);
  const entry = (id: string, kind: Kind, label: string, group: string, picture: Entry["picture"] = null, owners: string[] = []): Entry =>
    add({ id, kind, label, group, facts: [], tables: [], related: [], console: null, owners, picture });
  const facts = (e: Entry) => (label: string, ...value: Cell[]): void => void e.facts.push({ label, value });

  for (const d of of("species")) {
    const creature = d.class === "creature";
    if (!["creature", "survivor", "civilian", "vehicle"].includes(d.class)) continue;
    const kind: Kind = creature ? "creatures" : d.class === "vehicle" ? "vehicles" : "characters";
    let picture: NonNullable<Entry["picture"]>;
    if (d.skeleton === "human") {
      // A new survivor as the game makes one: its body's parts and its hair.
      const look = defaultLook();
      const colors = new Uint8Array(6);
      lookColors(look, colors);
      const body = `${d.mesh}_${SEX_IDS[look[LOOK_SEX]!]}`;
      picture = { meshes: [...SLOT_NAMES, `hair/${HAIR_STYLES[look[LOOK_HAIR]!]!.id}`].map((p) => `${body}/${p}`), colors: [...colors], body: true };
    } else picture = { meshes: [d.mesh], colors: d.regions?.map((r) => r?.colors[0]?.[0] ?? 0) ?? [], body: true };
    // A species with no art of its own is a stand-in, and not in the wiki (coverage.ts).
    if (!picture.meshes.every(has)) continue;
    const group = creature ? (d.fly ? "Flyer" : "Creature") : kind === "vehicles" ? sentence(d.vehicle?.movement ?? "car") : "Human";
    const e = entry(d.id, kind, labelOf(d), group, picture, [d.id]);
    const fact = facts(e);
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
          fact(d.breeds.egg ? "Incubation" : "Gestation", rate("hatch", d.breeds.incubate));
          fact("Maturation", rate("mature", d.breeds.mature));
        }
      }
      fact("Speed", `${num(d.walkSpeed, 1)} m/s walking, ${num(d.walkSpeed * d.sprintMul, 1)} sprinting`);
      if (d.fly) fact("Flies", "Yes");
      const takes = Object.entries(d.takes ?? {}).map(([type, x]) => `${sentence(type)} ×${num(x)}`);
      const zones = Object.entries(d.zones ?? {}).map(([zone, x]) => `${sentence(zone)} hits ×${num(x)}`);
      if (takes.length || zones.length) fact("Damage taken", [...takes, ...zones].join(", "));
      if (d.killXp) fact("Experience for a kill", rate("killxp", d.killXp), " at level 1, a tenth more a level");
      const stats = statTable(d, d.class === "survivor");
      if (stats) e.tables.push(stats);
      const taming = creature ? tamingTable(d, defs) : null;
      if (taming) e.tables.push(taming);
      const drops = dropTable(d, tools);
      if (drops) e.tables.push(drops);
      if (creature) e.console = line("spawn", d.id);
    }
  }

  for (const d of items) {
    const engram = engramOf.get(d.id);
    const placed = (d.places ?? []).map((s) => byId.get(s)).filter((s): s is StructureDef => s?.type === "structure");
    const first = placed[0];
    const group = first ? (STRUCTURE_GROUPS[first.class] ?? "Structure") : (ITEM_GROUPS[d.class] ?? sentence(d.class));
    const icon = icons.get(d.id);
    const picture = icon ? { meshes: [icon.mesh], colors: icon.colors, body: false, framing: input.framing?.get(icon.mesh) ?? input.framing?.get(icon.mesh.replace(/\/dropped$/, "")) ?? null } : null;
    const e = entry(d.id, "items", labelOf(engram ?? d), group, picture, [d.id, ...placed.map((s) => s.id)]);
    e.console = line("give", d.id);
    const fact = facts(e);
    fact("Weight", `${num(d.weight ?? 0.1)} kg`);
    // A thing that wears out or holds rounds keeps its stack of one (shared/content/tuning.ts).
    const single = (d.weapon !== undefined || d.wear !== undefined || d.tool !== undefined) && d.weapon?.kind !== "thrown";
    fact("Stack", d.stack > 1 && !single ? rate("stack", d.stack) : String(d.stack));
    if (d.spoilHours !== undefined) fact("Spoils in", rate("spoil", d.spoilHours * GAME_HOUR));
    if (d.eat) fact("Eaten", [d.eat.food && `${num(d.eat.food)} food`, d.eat.water && `${num(d.eat.water)} water`, d.eat.health && `${num(d.eat.health)} health`].filter(Boolean).join(", "));
    if (d.dose) fact("Fed to a creature", `${num(d.dose.torpor)} torpor over ${time(d.dose.seconds)}`);
    if (d.fuel) fact("Burns for", time(d.fuel));
    if (d.tool) fact("Tool", `Works ${d.tool.on} at ${num(d.tool.power)}× bare hands, ${d.tool.uses} uses`);
    if (d.wear) fact("Armor", `${num(d.wear.armor)} on the ${d.wear.slot}, ${d.wear.uses} durability`);
    if (d.saddle) fact("Saddle", `${num(d.saddle.armor)} armor, ${d.saddle.seats.length} ${d.saddle.seats.length === 1 ? "seat" : "seats"} on a `, { id: d.saddle.fits });
    if (d.deploys) fact("Deploys a", { id: d.deploys });
    const gives = [d.ammo?.buff, d.weapon?.cloud?.buff, ...(d.use?.buffs ?? [])].filter((b): b is string => b !== undefined);
    if (gives.length) fact("Gives", ...gives.flatMap((id, k): Cell[] => [...(k ? [", "] : []), { id }]));
    const w = d.weapon;
    if (w) {
      if (w.damage) fact("Damage", `${num(w.damage)}${w.type ? ` ${w.type}` : ""}`);
      if (w.reach) fact("Reach", `${num(w.reach)} m`);
      if (w.clip) fact("Magazine", `${w.clip}, ${num(w.reload ?? 0)} s to reload`);
      if (w.interval) fact("Rate of fire", `${num(1 / w.interval, 1)} a second`);
      fact("Durability", `${w.uses} uses`);
      if (w.melee) fact("Strikes for", `${num(w.melee.damage)} damage`);
      const ammo = (w.ammo ?? []).map((a) => byId.get(a)).filter((a): a is ItemDef => a?.type === "item" && a.ammo !== undefined);
      const hit = (a: ItemDef): string => `${num(a.ammo!.damage * (w.power ?? 1))}${a.ammo!.pellets ? ` × ${a.ammo!.pellets} pellets` : ""} ${a.ammo!.type}`;
      if (ammo.length) e.tables.push({ title: "Ammunition", head: ["Fires", "Damage"], rows: ammo.map((a): Cell[] => [{ id: a.id }, hit(a)]) });
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
        note: [`${c.count && c.count > 1 ? `Makes ${c.count} in` : "Takes"} ${time(c.seconds)}`, ...(c.xp ? [" and gives ", rate("craftxp", c.xp), " experience"] : []), "."],
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
  }

  for (const d of of("node")) {
    // The first individual a node names is its usual one.
    const mesh = d.variants?.[0]?.mesh ?? d.mesh;
    const e = entry(d.id, "resources", labelOf(d), d.material === undefined ? "Picked by hand" : (NODE_GROUPS[d.material] ?? sentence(d.material)), has(mesh) ? { meshes: [mesh], colors: [], body: true, sides: 1 } : null);
    const fact = facts(e);
    const working = tools.filter((t) => t.tool!.on === d.material);
    if (d.material === undefined) fact("Gathered", "By hand, with the use key");
    else fact("Worked with", ...(working.length ? working.flatMap((t, k): Cell[] => [...(k ? [", "] : []), { id: t.id }]) : ["Bare hands"]));
    fact("Used up after", rate("hits", d.hits), d.material === undefined ? " picks" : " hits");
    fact("Grows back", rate("respawn", d.respawnHours * GAME_HOUR), " after it is used up");
    fact("Experience", rate("harvestxp", d.xp), d.material === undefined ? " a pick" : " a hit");
    if (d.sea) fact("Grows", d.sea === "under" ? "Under the sea" : "On land or under the sea");
    if (d.soft) fact("Walked through", "Yes");
    e.tables.push(yieldTable(d, tools));
  }

  for (const d of of("buff")) {
    const e = entry(d.id, "statuses", labelOf(d), d.good ? "Helps" : "Harms");
    const fact = facts(e);
    const lasts = d.seconds === undefined ? "Until it is taken away" : brief(d.seconds);
    fact("Lasts", lasts, d.survivorSeconds !== undefined ? `, ${brief(d.survivorSeconds)} on a survivor` : "");
    if (d.again === "stack") fact("Given again", "Each lasts its own time, one on another");
    if (d.health) fact("Health", `${d.health > 0 ? "+" : ""}${num(d.health, 2)} a second${d.damage ? `, as ${d.damage} damage` : ""}`);
    if (d.torpor) fact("Torpor", `${d.torpor > 0 ? "+" : ""}${num(d.torpor, 2)} a second`);
    if (d.speed !== undefined) fact("Speed", pct(d.speed));
    if (d.dealt !== undefined) fact("Damage dealt", pct(d.dealt));
    if (d.taken !== undefined) fact("Damage taken", pct(d.taken));
    if (d.root) fact("Moves", "Not at all");
    if (d.immune) fact("Harmed", "By nothing");
    if (d.only?.length) fact("Only on", ...d.only.flatMap((id, k): Cell[] => [...(k ? [", "] : []), { id }]));
    if (d.after) fact("Afterwards", { id: d.after });
  }

  for (const l of input.landmarks ?? LANDMARKS) landmarkEntry(l, entry, facts);

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
    for (const b of [d.ammo?.buff, d.weapon?.cloud?.buff, ...(d.use?.buffs ?? [])]) if (b) back(b, "Given by", { id: d.id });
  }
  for (const s of of("species")) {
    for (const x of s.drops ?? []) back(x.item, "Harvested from", { id: s.id });
    for (const f of s.eats ?? []) back(f.item, "Tames", { id: s.id });
    if (s.feces) back(s.feces, "Left by", { id: s.id });
    for (const b of s.buffs ?? []) back(b, "Always on", { id: s.id });
  }
  for (const n of of("node")) {
    for (const item of new Set(n.yields.map((y) => y.item))) {
      const [bare, tool] = [n.yields.some((y) => y.item === item && !y.tool), n.yields.some((y) => y.item === item && y.tool)];
      back(item, "Gathered from", bare && tool ? { id: n.id, note: "more with a tool" } : tool ? { id: n.id, note: "with a tool" } : { id: n.id });
    }
    for (const t of tools) if (t.tool!.on === n.material) back(t.id, "Works", { id: n.id });
  }
  for (const b of of("buff")) {
    for (const s of b.only ?? []) back(s, "Can be", { id: b.id });
    if (b.after) back(b.after, "Follows", { id: b.id });
  }
  for (const l of input.landmarks ?? LANDMARKS) for (const v of l.vehicles) back(v.kind, "Moored at", { id: l.name });
  return KINDS.flatMap((k) => [...entries.values()].filter((e) => e.kind === k).sort((a, b) => a.label.localeCompare(b.label)));
}

/**
 * A landmark's entry, by its name: its doors and what moves when used, the vehicles it brings, and its picture drawn from its
 * own meshes where its pieces stand. No size: what is walked of it takes in its gangway and masts, and the content does not
 * say which pieces are the thing itself.
 */
function landmarkEntry(l: Landmark, entry: (id: string, kind: Kind, label: string, group: string, picture?: Entry["picture"]) => Entry, facts: (e: Entry) => (label: string, ...value: Cell[]) => void): void {
  const defs = new Map(l.defs.map((d) => [d.id, d]));
  const placed = l.pieces.map((p) => ({ p, d: defs.get(p.kind) as StructureDef }));
  const meshes = [...new Set(placed.map(({ d }) => d.mesh).filter((m) => m !== "none"))];
  const places = placed.filter(({ d }) => d.mesh !== "none").map(({ p, d }) => [meshes.indexOf(d.mesh), ...p.at, p.yaw] as [number, number, number, number, number]);
  const e = entry(l.name, "landmarks", sentence(l.name), "Landmark", meshes.length ? { meshes, colors: [], body: true, places } : null);
  const fact = facts(e);
  const doors = placed.filter(({ d }) => d.opens && d.shape && (defs.get(d.shape) as ShapeDef | undefined)?.role === "door").length;
  if (doors) fact("Doors", `${doors} that open and close`);
  const moving = placed.filter(({ d }) => d.motion);
  for (const { d } of moving) fact(words(d.id), `${sentence(d.motion!.say[0])} or ${d.motion!.say[1]}, over ${time(d.motion!.seconds)}`);
  if (placed.every(({ d }) => d.material === undefined)) fact("Harmed by", "Nothing");
  if (l.vehicles.length) fact("Brings", ...l.vehicles.flatMap((v, k): Cell[] => [...(k ? [", "] : []), { id: v.kind }]));
  const parts = [...moving.map(({ d }) => words(d.id)), ...(doors ? [`${doors} doors`] : []), ...l.vehicles.map((v) => `a ${words(v.kind).toLowerCase()}`)];
  e.line = parts.length ? parts.join(" · ") : "Landmark";
}

/** What each entry and node is called, for words beside a link. */
export function namesOf(entries: readonly Entry[], defs: readonly Def[] = CORE_CONTENT): Map<string, string> {
  const out = new Map(defs.filter((d) => d.type === "node" || d.type === "structure").map((d) => [d.id, labelOf(d)]));
  for (const e of entries) out.set(e.id, e.label);
  return out;
}
