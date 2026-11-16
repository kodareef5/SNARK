// What a player can look up in the game's own menus, as resources: what is made of what and where, what each item is, and
// what each creature eats and carries. Read from the content the server tuned, so the numbers are the server's.

import type { ClientSession } from "../client/core/session.ts";
import type { EngramDef, ItemDef, SpeciesDef } from "../shared/content/defs.ts";
import type { ResourceDef } from "./mcp.ts";
import { shortName } from "./observe.ts";

export const RESOURCES: ResourceDef[] = [
  { uri: "snark://guide", name: "guide", title: "How to play through these tools", description: "Ids, places, and the steps of taming, riding, flying, driving, building, stations and shooting.", mimeType: "text/markdown" },
  { uri: "snark://recipes", name: "recipes", title: "Recipes", description: "Everything that can be made: from what, where (hands or a station), the level and points its engram takes, and whether you know it.", mimeType: "application/json" },
  { uri: "snark://items", name: "items", title: "Items", description: "Every item: kind, weight, stack, what eating it gives, how long it burns, what it is worn on, and what a weapon fires.", mimeType: "application/json" },
  { uri: "snark://creatures", name: "creatures", title: "Creatures", description: "Every species: whether it hunts, whether it can be tamed and on what, its saddle, and whether it flies or is a vehicle.", mimeType: "application/json" },
];

const label = (d: { id: string; label?: string } | null | undefined): string => shortName(d?.id);

/** The text of a resource, or null. */
export function readResource(s: ClientSession, uri: string, guide: string): string | null {
  const reg = s.registry;
  const name = (k: number): string => label(reg.defs[k] as ItemDef | null);
  if (uri === "snark://guide") return guide;
  if (uri === "snark://recipes") {
    const engram = new Map<string, number>();
    reg.defs.forEach((d, k) => d?.type === "engram" && engram.set((d as EngramDef).item, k));
    const out: Record<string, unknown> = {};
    reg.defs.forEach((d, k) => {
      const needs = reg.recipeOf[k];
      if (d?.type !== "item" || !needs) return;
      const item = d as ItemDef;
      const parts: Record<string, number> = {};
      for (let i = 0; i + 1 < needs.length; i += 2) parts[name(needs[i]!)] = needs[i + 1]!;
      const e = engram.get(item.id);
      const def = e !== undefined ? (reg.defs[e] as EngramDef) : null;
      out[name(k)] = {
        needs: parts,
        ...(reg.recipeMakes[k]! > 1 ? { makes: reg.recipeMakes[k] } : {}),
        at: reg.craftAt[k] !== 0 ? name(reg.craftAt[k]!) : "hands",
        ...(item.craft?.fired ? { fired: "made by the station's fire by itself while it burns and these lie in it" } : {}),
        ...(item.craft ? { seconds: item.craft.seconds } : {}),
        ...(def ? { level: def.level, points: def.cost, known: s.progress.engrams.includes(e!) } : {}),
      };
    });
    return JSON.stringify(out);
  }
  if (uri === "snark://items") {
    const out: Record<string, unknown> = {};
    reg.defs.forEach((d, k) => {
      if (d?.type !== "item") return;
      const item = d as ItemDef;
      out[name(k)] = {
        class: item.class,
        weight: reg.weight[k],
        stack: reg.stack[k],
        ...(item.eat ? { eat: item.eat } : {}),
        ...(item.fuel ? { burns_s: item.fuel } : {}),
        ...(item.cooks ? { cooks_into: shortName(item.cooks.into) } : {}),
        ...(item.wear ? { worn_on: item.wear.slot, armor: item.wear.armor } : {}),
        ...(item.tool ? { tool_for: item.tool.on } : {}),
        ...(item.weapon ? { weapon: item.weapon.kind, ...(item.weapon.ammo ? { fires: item.weapon.ammo.map(shortName), holds: item.weapon.clip ?? 1 } : {}), ...(item.weapon.fits ? { takes: item.weapon.fits.map(shortName) } : {}) } : {}),
        ...(item.attachment ? { attachment: item.attachment } : {}),
        ...(item.dose ? { torpor: item.dose.torpor } : {}),
        ...(item.saddle ? { saddle_for: shortName(item.saddle.fits) } : {}),
        ...(item.places ? { builds: item.places.map(shortName) } : {}),
      };
    });
    return JSON.stringify(out);
  }
  if (uri === "snark://creatures") {
    const saddles = new Map<number, string>();
    reg.defs.forEach((d, k) => reg.saddleFits[k] && saddles.set(reg.saddleFits[k]!, name(k)));
    const out: Record<string, unknown> = {};
    reg.defs.forEach((d, k) => {
      if (d?.type !== "species") return;
      const sp = d as SpeciesDef;
      if (sp.class === "survivor") return;
      const eats = reg.eats[k];
      const foods: string[] = [];
      for (let i = 0; eats && i + 2 < eats.length; i += 3) foods.push(name(eats[i]!));
      out[label(sp)] = {
        ...(sp.class === "vehicle" ? { vehicle: true } : { temper: ["flees", "defends", "hunts"][reg.temper[k]!] ?? "flees" }),
        ...(reg.taming[k] ? { tames: true, eats: foods } : {}),
        ...(saddles.has(k) ? { saddle: saddles.get(k) } : {}),
        ...(reg.flies[k] ? { flies: true } : {}),
        ...(reg.carriable[k] ? { carried_in_arms: true } : {}),
      };
    });
    return JSON.stringify(out);
  }
  return null;
}
