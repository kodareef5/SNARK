// What a loadout may hold, as the admin page needs it to offer choices: the game's items with what each may be given
// as, and the species a tame entry may name. The server makes one from its registry and the page reads it as it is.

import type { ItemDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { QUALITY_NAMES } from "../sim/items.ts";
import { catalogOf, type CatalogItem } from "../supply/catalog.ts";

export interface LoadoutItem extends CatalogItem {
  /** Whether it is armor, which alone may be worn. */
  wear: boolean;
  /** For a weapon: the rounds it may come loaded with and the attachments that fit it. */
  ammo: string[];
  fits: string[];
}

export interface LoadoutSpecies {
  id: string;
  label: string;
  /** Whether a saddle is made for it. */
  saddle: boolean;
}

export interface LoadoutCatalog {
  items: LoadoutItem[];
  species: LoadoutSpecies[];
  /** The names of the qualities, lowest first: an entry's quality is an index into them. */
  quality: string[];
}

const words = (id: string): string => id.slice(id.indexOf(":") + 1).replace(/_/g, " ");

/** The game's items and creatures as a loadout may name them. An item that stands for a record is left out. */
export function loadoutCatalog(reg: Registry): LoadoutCatalog {
  const record = new Set<number>();
  for (const k of reg.propFertile) if (k !== 0) record.add(k);
  for (let i = 1; i < reg.defs.length; i++) if (reg.ballEmpty[i] !== 0) record.add(i);
  const items: LoadoutItem[] = [];
  for (const item of catalogOf(reg).byIndex) {
    if (!item || record.has(item.index)) continue;
    const weapon = (reg.defs[item.index] as ItemDef).weapon;
    items.push({ ...item, wear: reg.wearSlot[item.index]! >= 0, ammo: [...(weapon?.ammo ?? [])], fits: [...(weapon?.fits ?? [])] });
  }
  const saddled = new Set<number>();
  for (let i = 1; i < reg.defs.length; i++) if (reg.saddleFits[i] !== 0) saddled.add(reg.saddleFits[i]!);
  const species: LoadoutSpecies[] = [];
  for (let i = 1; i < reg.defs.length; i++) {
    const d = reg.defs[i];
    if (d?.type !== "species" || d.class !== "creature") continue;
    species.push({ id: d.id, label: (d as { label?: string }).label ?? words(d.id), saddle: saddled.has(i) });
  }
  return { items, species, quality: [...QUALITY_NAMES] };
}
