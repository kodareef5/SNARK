// Where each item comes from (planning/workstreams/loot.md): every way the content and a drop book put one in the
// world, and which items a survivor can come by at all. Pure, so the tool, the tests and the wiki read it alike.

import type { Def, ItemDef } from "../content/defs.ts";
import type { SupplyBook } from "./book.ts";

/** How an item is come by. The first seven need nothing first; the rest need the item or station they name. */
export type How = "harvested" | "gathered" | "mined" | "salvaged" | "laid" | "left" | "dropped" | "made" | "cooked" | "spoiled" | "burnt" | "young" | "caught";

export interface Way {
  how: How;
  /** What gives it: a species, node, material, wreck or station, a drop table's key, or the item it comes of. */
  from: string;
  /** Items that must be had first. */
  needs: readonly string[];
}

export interface Reach {
  /** Every item's ways, none for an item with no way at all. */
  ways: Map<string, Way[]>;
  /** The items a survivor can come by, starting with nothing. */
  reached: Set<string>;
}

/** The sets a book's tables can draw, with the tables that draw each. */
function drawn(book: SupplyBook): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (set: string | undefined, table: string): void => {
    if (!set) return;
    const tables = out.get(set) ?? [];
    if (!tables.includes(table)) tables.push(table);
    out.set(set, tables);
  };
  for (const [key, table] of Object.entries(book.tables)) {
    for (const slot of table.slots) for (const from of slot.from) add(from.set, key);
    const tier = book.tiers.find((t) => t.key === table.tier);
    add(tier?.staple, key);
    add(tier?.floor, key);
    add(book.classes.find((c) => c.key === table.cls)?.fill, key);
  }
  return out;
}

/** Every way `defs` and `book` give each item. A drop gives only what `gives` allows, where it is passed. */
export function reachOf(defs: readonly Def[], book?: SupplyBook, gives: (item: string) => boolean = () => true): Reach {
  const ways = new Map<string, Way[]>();
  const items = defs.filter((d): d is ItemDef => d.type === "item");
  for (const d of items) ways.set(d.id, []);
  const way = (item: string, how: How, from: string, needs: readonly string[] = []): void => {
    const list = ways.get(item);
    if (list && !list.some((w) => w.how === how && w.from === from)) list.push({ how, from, needs });
  };
  // The item that sets down each station, or its lit form.
  const placer = new Map<string, string>();
  for (const d of items) for (const s of d.places ?? []) placer.set(s, d.id);
  for (const d of defs) if (d.type === "structure" && d.lights !== undefined && placer.has(d.id)) placer.set(d.lights, placer.get(d.id)!);
  const eggs = new Map<string, { item?: string; fertile?: string }>();
  for (const d of defs) if (d.type === "prop" && (d.item !== undefined || d.fertile !== undefined)) eggs.set(d.id, d);

  for (const d of items) {
    // A station no item sets down is a need nothing meets.
    if (d.craft) way(d.id, "made", d.craft.at ?? "hand", [...d.craft.needs.map((n) => n.item), ...(d.craft.at ? [placer.get(d.craft.at) ?? d.craft.at] : [])]);
    if (d.cooks) way(d.cooks.into, "cooked", d.id, [d.id]);
    if (d.spoilsInto !== undefined) way(d.spoilsInto, "spoiled", d.id, [d.id]);
    if (d.burnsInto !== undefined) way(d.burnsInto, "burnt", d.id, [d.id]);
    if (d.youngFor !== undefined) way(d.id, "young", d.youngFor, [d.youngFor]);
    if (d.ball?.full !== undefined) way(d.ball.full, "caught", d.id, [d.id]);
  }
  for (const d of defs) {
    if (d.type === "species") {
      for (const x of d.drops ?? []) way(x.item, "harvested", d.id);
      if (d.feces !== undefined) way(d.feces, "left", d.id);
      const egg = d.breeds?.egg === undefined ? undefined : eggs.get(d.breeds.egg);
      if (egg?.item !== undefined) way(egg.item, "laid", d.id);
      if (egg?.fertile !== undefined) way(egg.fertile, "laid", d.id);
    } else if (d.type === "node") for (const y of d.yields) way(y.item, "gathered", d.id);
    else if (d.type === "material") for (const y of d.heap ?? []) way(y.item, "mined", d.id);
    else if (d.type === "structure") for (const rung of d.salvage?.rungs ?? []) for (const y of rung.gives) way(y.item, "salvaged", d.id);
  }
  if (book) {
    const tables = drawn(book);
    for (const [key, set] of Object.entries(book.sets)) {
      const from = tables.get(key);
      if (!from) continue;
      for (const entry of set.entries) for (const item of entry.items) if (gives(item)) for (const table of from) way(item, "dropped", table);
    }
  }

  const reached = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [item, list] of ways) {
      if (reached.has(item) || !list.some((w) => w.needs.every((n) => reached.has(n)))) continue;
      reached.add(item);
      grew = true;
    }
  }
  return { ways, reached };
}

/** Whether `way` can be taken with what is reached. */
export const open = (reach: Reach, way: Way): boolean => way.needs.every((n) => reach.reached.has(n));

/** What a way that cannot be taken still lacks. */
export const lacks = (reach: Reach, way: Way): string[] => way.needs.filter((n) => !reach.reached.has(n));
