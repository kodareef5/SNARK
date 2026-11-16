// Public facts and relationships are projected explicitly from the game's authoritative catalogue.

import { CORE_CONTENT } from "../../content/core.ts";
import { classOf, classRow } from "../../shared/content/classes.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { EntryKind, GuideEntry, GuideFact, GuideServer, GuideSetting } from "../../shared/pages/types.ts";
import { PUBLIC_SETTINGS, validatePublicSnapshot } from "../../shared/pages/validate.ts";
import { CATALOG, rowOf } from "../../server/settings/catalog.ts";

export const words = (text: string): string => text.replace(/^.*:/, "").replace(/[_/\-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
const valueOf = (value: number | boolean): string => typeof value === "boolean" ? value ? "On" : "Off" : String(Math.round(value * 10000) / 10000);
const labelOf = (d: Def): string => words("label" in d && d.label ? d.label : d.id);

function kindOf(d: Def): EntryKind | null {
  if (d.type === "item") return "items";
  if (d.type === "engram") return "engrams";
  if (d.type === "structure") return "structures";
  if (d.type !== "species") return null;
  return d.class === "creature" ? "creatures" : d.class === "vehicle" ? "vehicles" : "characters";
}

function itemModel(d: ItemDef, byId: ReadonlyMap<string, Def>): string | undefined {
  const explicit = d.weapon?.mesh ?? d.ammo?.mesh;
  if (explicit) return explicit;
  const placed = d.places?.[0] ? byId.get(d.places[0]) : undefined;
  return placed?.type === "structure" && placed.mesh !== "box" && placed.mesh !== "shape" ? placed.mesh : undefined;
}

/** A definition added to a supported class receives its page and backlinks without a separate wiki row. */
export function buildCatalogue(defs: readonly Def[] = CORE_CONTENT): GuideEntry[] {
  const compiled = compileContent(defs);
  if (!compiled.registry) throw new Error(`cannot publish invalid content: ${compiled.errors.join("; ")}`);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const entries = new Map<string, GuideEntry>();
  for (const d of defs) {
    const kind = kindOf(d);
    if (!kind) continue;
    const cls = classRow(classOf(d));
    const e: GuideEntry = { id: d.id, kind, classId: classOf(d), label: labelOf(d), description: cls?.doc ?? "A registered content definition.", status: cls?.status ?? "partial", tags: [], facts: [], links: [] };
    const fact = (label: string, value: number | boolean | string | undefined, unit?: string): void => {
      if (value !== undefined) e.facts.push({ label, value: typeof value === "string" ? value : valueOf(value), ...(unit ? { unit } : {}) });
    };
    const link = (id: string | undefined, relation: string): void => {
      const target = id ? byId.get(id) : undefined;
      if (target && kindOf(target)) e.links.push({ id: target.id, label: labelOf(target), relation });
    };
    e.tags.push(words("class" in d ? d.class : d.type));
    if (d.type === "species") {
      if (d.mesh !== "box" && d.mesh !== "shape") e.modelId = d.mesh;
      fact("Body height", d.height, "m"); fact("Walk speed", d.walkSpeed, "m/s");
      fact("Sprint speed", d.walkSpeed * d.sprintMul, "m/s"); fact("Inventory", d.slots, "slots");
      fact("Health at base level", d.stats?.health?.[0]); fact("Stamina at base level", d.stats?.stamina?.[0]);
      fact("Weight capacity at base level", d.stats?.weight?.[0], "kg"); fact("Mass", d.mass, "kg");
      if (d.class === "creature") {
        fact("Temperament", d.temper ?? "flees"); fact("Tameable", d.taming !== undefined); fact("Base melee damage", d.fists);
        if (d.taming) e.tags.push("Tameable");
        if (d.breeds) { e.tags.push("Breedable"); fact("Maturation", d.breeds.mature, "s"); fact("Incubation / gestation", d.breeds.incubate, "s"); }
      }
      for (const food of d.eats ?? []) link(food.item, "Eats");
      for (const drop of d.drops ?? []) link(drop.item, `Yields ${drop.min}${drop.max !== drop.min ? `–${drop.max}` : ""}`);
      if (d.vehicle) e.tags.push("Drivable");
    } else if (d.type === "item") {
      e.modelId = itemModel(d, byId);
      fact("Weight", d.weight ?? 0.1, "kg"); fact("Stack size", d.stack); fact("Spoils after", d.spoilHours, "game hours");
      if (d.eat) { fact("Food restored", d.eat.food); fact("Water restored", d.eat.water); fact("Health restored", d.eat.health); }
      fact("Fuel duration", d.fuel, "s"); fact("Tool power", d.tool?.power, "×"); fact("Durability", d.tool?.uses ?? d.weapon?.uses);
      if (d.weapon) { fact("Weapon damage", d.weapon.damage); fact("Melee reach", d.weapon.reach, "m"); fact("Fire interval", d.weapon.interval, "s"); for (const id of d.weapon.ammo ?? []) link(id, "Ammunition"); for (const id of d.weapon.fits ?? []) link(id, "Attachment"); }
      if (d.ammo) fact("Ammunition damage", d.ammo.damage);
      if (d.saddle) { fact("Saddle armor", d.saddle.armor); fact("Seats", d.saddle.seats.length); link(d.saddle.fits, "Fits"); }
      if (d.craft) {
        e.tags.push("Craftable"); fact("Crafting time", d.craft.seconds, "s"); fact("Crafting experience", d.craft.xp);
        for (const ingredient of d.craft.needs) link(ingredient.item, `Needs ${ingredient.count}`);
        link(d.craft.at, "Crafted at");
      }
      for (const id of d.places ?? []) link(id, "Places");
      link(d.cooks?.into, "Cooks into"); link(d.spoilsInto, "Spoils into"); link(d.burnsInto, "Leaves after burning");
    } else if (d.type === "engram") {
      fact("Required level", d.level); fact("Engram points", d.cost); fact("Offered", !d.hidden);
      if (d.auto !== undefined) fact("Automatically learned at", d.auto, "level");
      link(d.item, "Unlocks");
      const item = byId.get(d.item);
      if (item?.type === "item") e.modelId = itemModel(item, byId) ?? item.id;
      // Prerequisites are currently a declared stub, so keep their status explicit.
      for (const id of d.requires ?? []) link(id, "Declared prerequisite (planned)");
      if (d.hidden) e.tags.push("Hidden");
    } else if (d.type === "structure") {
      if (d.mesh !== "box" && d.mesh !== "shape") e.modelId = d.mesh;
      fact("Health", d.hp); fact("Width", d.half[0] * 2, "m"); fact("Height", d.half[1] * 2, "m"); fact("Depth", d.half[2] * 2, "m");
      fact("Inventory", d.slots, "slots"); fact("Preservation", d.keeps, "×");
      if (d.class === "static") e.tags.push("World scenery");
    }
    entries.set(e.id, e);
  }
  const inverse: Record<string, string> = { "Unlocks": "Unlocked by", "Crafted at": "Crafts", "Places": "Placed by", "Fits": "Equipment", "Eats": "Eaten by", "Ammunition": "Used by", "Attachment": "Fits weapon", "Cooks into": "Cooked from", "Spoils into": "Spoils from" };
  for (const e of entries.values()) for (const link of [...e.links]) {
    const relation = link.relation.startsWith("Needs ") ? "Used to craft" : link.relation.startsWith("Yields ") ? "Gathered from" : inverse[link.relation];
    if (relation) entries.get(link.id)?.links.push({ id: e.id, label: e.label, relation });
  }
  for (const e of entries.values()) e.links = e.links.filter((l, i, a) => a.findIndex((x) => x.id === l.id && x.relation === l.relation) === i).sort((a, b) => a.relation.localeCompare(b.relation) || a.label.localeCompare(b.label));
  return [...entries.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function setting(key: string, value: number | boolean): GuideSetting {
  const row = rowOf(key);
  if (!row || (row.kind !== "float" && row.kind !== "int" && row.kind !== "bool")) throw new Error(`public setting ${key} has no supported catalogue row`);
  if ((row.kind === "bool") !== (typeof value === "boolean") || (typeof value === "number" && (value < row.min || value > row.max || (row.kind === "int" && !Number.isInteger(value))))) throw new Error(`public setting ${key} is outside its catalogue range`);
  return { key, label: words(key), value: valueOf(value), default: valueOf(row.def as number | boolean), group: row.group, description: row.doc };
}

/** Without a runtime snapshot, show engine defaults and unknown occupancy, never an invented live server. */
export function buildServers(snapshot?: unknown): GuideServer[] {
  if (snapshot !== undefined) {
    const maps = new Set(CORE_CONTENT.filter((d) => d.type === "map").map((d) => d.id));
    return validatePublicSnapshot(snapshot).servers.map((s) => {
      if (!maps.has(s.mapId)) throw new Error(`public snapshot map ${s.mapId} is not in this content revision`);
      const facts: GuideFact[] = [{ label: "Players at capture", value: String(s.players.length) }];
      if (s.stats.uptimeSeconds !== undefined) facts.push({ label: "Uptime at capture", value: valueOf(s.stats.uptimeSeconds), unit: "s" });
      if (s.stats.tickMilliseconds !== undefined) facts.push({ label: "Tick duration at capture", value: valueOf(s.stats.tickMilliseconds), unit: "ms" });
      if (s.stats.saveMilliseconds !== undefined) facts.push({ label: "Save duration at capture", value: valueOf(s.stats.saveMilliseconds), unit: "ms" });
      return { id: s.id, label: s.label, mapId: s.mapId, sampledAt: s.sampledAt, players: s.players, capacity: s.capacity, settings: Object.entries(s.settings).map(([k, v]) => setting(k, v)), facts };
    });
  }
  const defaults = PUBLIC_SETTINGS.flatMap((name) => {
    const row = CATALOG.find((r) => r.name === name && r.status === "live");
    return row && (typeof row.def === "number" || typeof row.def === "boolean") ? [setting(name, row.def)] : [];
  });
  return CORE_CONTENT.filter((d) => d.type === "map").map((d) => ({ id: d.id.split(":")[1]!, label: labelOf(d), mapId: d.id, sampledAt: null, players: [], capacity: null, settings: defaults.map((s) => ({ ...s })), facts: [{ label: "Snapshot", value: "Not connected" }, { label: "Settings shown", value: "Engine defaults" }] }));
}
