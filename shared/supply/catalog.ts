// What a drop book is read against: the game's items, as little of each as the book needs. The server makes one from its
// registry and sends it to the admin page as it is, so the page resolves, values and rolls a book exactly as the server
// does without holding the content.

import type { EngramDef, ItemDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import type { SupplyBook } from "./book.ts";

export interface CatalogItem {
  id: string;
  /** The content index, which a roll gives back. A future item's is past the last of the game's. */
  index: number;
  label: string;
  /** The item's class: weapon, armor, saddle, structure, resource and so on. */
  cls: string;
  /** Its engram's level, 0 for an item with none. */
  level: number;
  stack: number;
  /** Whether it may be a blueprint. */
  blueprint: boolean;
  /** Whether quality changes what it does: only then may a book give it one. */
  quality: boolean;
  /** What one crafting uses up, and how many it makes. */
  needs?: [string, number][];
  makes?: number;
  /** It stands for a record, or is waste: loot never mints it. */
  never?: boolean;
  /** Not in the game: counted only in the "as designed" figures, from the book's future list. */
  future?: boolean;
}

export interface Catalog {
  byId: Map<string, CatalogItem>;
  byIndex: (CatalogItem | undefined)[];
  /** Ids that are no longer defined, and what each now is. */
  renamed: Map<string, string[]>;
  /** May-be-a-blueprint by content index, as the roll reads it. */
  blueprints: Uint8Array;
}

/** A catalogue of `items`, each at its own index. */
export function catalogFrom(items: readonly CatalogItem[], renamed: readonly (readonly [string, readonly string[]])[] = []): Catalog {
  const byId = new Map<string, CatalogItem>();
  const byIndex: (CatalogItem | undefined)[] = [];
  let most = 0;
  for (const item of items) {
    byId.set(item.id, item);
    byIndex[item.index] = item;
    if (item.index > most) most = item.index;
  }
  const blueprints = new Uint8Array(most + 1);
  for (const item of items) if (item.blueprint) blueprints[item.index] = 1;
  return { byId, byIndex, renamed: new Map(renamed.map(([from, to]) => [from, [...to]])), blueprints };
}

/** The game's items as a catalogue. */
export function catalogOf(reg: Registry): Catalog {
  const engram = new Map<string, EngramDef>();
  for (const d of reg.defs) if (d?.type === "engram") engram.set(d.item, d);
  // A fertilised egg and a full soul ball each stand for a record (Inventory.ref): minted without one they are broken.
  const never = new Set<number>();
  for (const k of reg.propFertile) if (k !== 0) never.add(k);
  for (let i = 0; i < reg.ballEmpty.length; i++) if (reg.ballEmpty[i] !== 0) never.add(i);
  const items: CatalogItem[] = [];
  for (let i = 1; i < reg.defs.length; i++) {
    const d = reg.defs[i];
    if (d?.type !== "item") continue;
    const item = d as ItemDef;
    const craft = item.craft;
    items.push({
      id: item.id,
      index: i,
      label: item.label ?? item.id.slice(item.id.indexOf(":") + 1),
      cls: item.class,
      level: engram.get(item.id)?.level ?? 0,
      stack: item.stack,
      blueprint: reg.blueprints[i] === 1,
      // Quality is a slot's, and a slot of many is one quality; what wears out one at a time is what quality improves
      // (server/items.ts maxDur, server/combat.ts). A saddle's is lost when it is put on, so it does not count yet; a
      // soul ball's uses are never spent.
      quality: reg.uses[i]! > 0 && item.stack === 1 && item.class !== "ball",
      ...(craft ? { needs: craft.needs.map((n) => [n.item, n.count] as [string, number]), makes: craft.count ?? 1 } : {}),
      ...(never.has(i) || item.class === "feces" ? { never: true } : {}),
    });
  }
  const renamed: [string, string[]][] = [];
  for (const [from, to] of reg.redirects) renamed.push([from, to.map((k) => reg.ids[k]!)]);
  return catalogFrom(items, renamed);
}

/**
 * `catalog` with the book's future items added as if they were in the game, each at an index past the game's last: what
 * the "as designed" figures are worked out against. A future item the game has since gained is the game's.
 */
export function withFuture(catalog: Catalog, book: SupplyBook): Catalog {
  const items = [...catalog.byId.values()];
  let next = catalog.byIndex.length;
  for (const [id, f] of Object.entries(book.future)) {
    if (catalog.byId.has(id)) continue;
    items.push({ id, index: next++, label: f.ark, cls: f.cls ?? "resource", level: f.level, stack: f.quality ? 1 : 100, blueprint: f.blueprint !== false, quality: f.quality === true, future: true });
  }
  return catalogFrom(items, [...catalog.renamed]);
}
