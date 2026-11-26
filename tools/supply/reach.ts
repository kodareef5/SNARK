// `bun run supply -- reach`: where every item comes from, and what has no source (planning/workstreams/loot.md).
//
//   bun run supply -- reach              what has no way in, what is found but cannot be made, what only drops give
//   bun run supply -- reach core:pelt    one item's ways, and what each still lacks
//   bun run supply -- reach --all        every item on a line
//
// `bun run supply -- flow <map.snmap>`: what stands on a built map that could hold loot, counted.

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { FOUND_NOT_MADE, NEVER_FOUND, WAITING } from "../../content/loot/waiting.ts";
import { starterBook } from "../../content/supply/starter.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { lacks, open, reachOf, type Reach, type Way } from "../../shared/supply/reach.ts";
import { parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";

/** The game's own items against its starter drop book: what the lists in content/loot/waiting.ts are held to. */
export function coreReach(defs: readonly Def[] = CORE_CONTENT): { all: Reach; land: Reach } {
  const reg = compileContent(defs).registry!;
  const catalog = catalogOf(reg);
  return { all: reachOf(defs, starterBook(), (id) => !catalog.byId.get(id)?.never), land: reachOf(defs) };
}

/** Items in three groups: with no way in, found in drops with a recipe nobody can follow, and given by drops alone. */
export function gaps({ all, land }: { all: Reach; land: Reach }): { none: string[]; notMade: [string, string[]][]; dropsOnly: string[] } {
  const none: string[] = [];
  const notMade: [string, string[]][] = [];
  const dropsOnly: string[] = [];
  for (const [item, ways] of all.ways) {
    if (!all.reached.has(item)) none.push(item);
    else if (!land.reached.has(item)) {
      const recipe = ways.find((w) => w.how === "made");
      if (recipe) notMade.push([item, lacks(land, recipe)]);
      else dropsOnly.push(item);
    }
  }
  return { none, notMade, dropsOnly };
}

const says = (reach: Reach, w: Way): string => `${w.how} ${w.from}${open(reach, w) ? "" : ` (lacks ${lacks(reach, w).join(", ")})`}`;

export function reachCommand(args: readonly string[]): void {
  const both = coreReach();
  const { all } = both;
  const one = args.find((a) => !a.startsWith("--"));
  if (one !== undefined) {
    const ways = all.ways.get(one);
    if (!ways) return void console.log(`no item ${one}`);
    console.log(`${one}: ${all.reached.has(one) ? "can be come by" : "cannot be come by"}`);
    // A table for each tier and class is a long list; drops are told by their count.
    const drops = ways.filter((w) => w.how === "dropped");
    for (const w of ways) if (w.how !== "dropped") console.log(`  ${says(all, w)}`);
    if (drops.length > 0) console.log(`  dropped by ${drops.length} tables: ${drops.slice(0, 8).map((w) => w.from).join(" ")}${drops.length > 8 ? " ..." : ""}`);
    return;
  }
  if (args.includes("--all")) {
    for (const [item, ways] of all.ways) {
      const kinds = [...new Set(ways.filter((w) => open(all, w)).map((w) => w.how))];
      console.log(`${item.padEnd(34)} ${kinds.length > 0 ? kinds.join(", ") : "NO SOURCE"}`);
    }
    return;
  }
  const { none, notMade, dropsOnly } = gaps(both);
  const why = (id: string): string => NEVER_FOUND[id] ?? WAITING[id] ?? "NOT LISTED in content/loot/waiting.ts";
  console.log(`${all.ways.size} items, ${all.reached.size} that can be come by`);
  console.log(`\nno way into the world (${none.length}):`);
  for (const id of none) console.log(`  ${id.padEnd(30)} ${id in NEVER_FOUND ? "never" : "waits"}: ${why(id)}`);
  console.log(`\nfound in drops, with a recipe nobody can follow (${notMade.length}):`);
  for (const [id, lack] of notMade) console.log(`  ${id.padEnd(30)} lacks ${lack.join(", ")}${id in FOUND_NOT_MADE ? "" : "  NOT LISTED"}`);
  console.log(`\ngiven by drops alone (${dropsOnly.length}):`);
  for (const id of dropsOnly) console.log(`  ${id}`);
  const hows = new Map<string, number>();
  for (const ways of all.ways.values()) for (const how of new Set(ways.map((w) => w.how))) hows.set(how, (hows.get(how) ?? 0) + 1);
  console.log(`\nitems by way: ${[...hows].sort((a, b) => b[1] - a[1]).map(([how, n]) => `${how} ${n}`).join(", ")}`);
}

/** What a static could hold loot as, until statics say so themselves (`holds`, phase 2 of the plan). */
const HOLDERS: readonly (readonly [string, RegExp])[] = [
  ["bin", /^core:zzstreet_bin/],
  ["mailbox", /^core:zzstreet_mailbox/],
  ["newspaper box", /^core:zzstreet_newsbox/],
  ["pay station", /^core:zzstreet_paystation/],
  ["moored hull", /^core:zzzzhull_/],
  ["harbour hulk", /^core:hulk_/],
];
const ROOM = /^core:zruin_(zbed|zcounter|zcore|zcover)_/;
const HEIGHTS: readonly (readonly [string, number])[] = [["ground", 0], ["storeys 1 to 4", 4], ["5 to 14", 14], ["15 and up", Infinity]];

export function flowCommand(args: readonly string[]): void {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) return void console.log("bun run supply -- flow <map.snmap>");
  const map = parseMap(new Uint8Array(readFileSync(file)), false);
  const reg = withContent(compileContent(CORE_CONTENT).registry!, map.content?.defs ?? []);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const count = new Map<string, number>();
  const add = (key: string): void => void count.set(key, (count.get(key) ?? 0) + 1);
  let statics = 0;
  for (let c = 0; c < structs.chunks.length; c++) {
    const t = structs.chunks[c];
    if (!t) continue;
    for (let slot = 0; slot < t.high; slot++) {
      const kind = t.kind[slot]!;
      if (kind === 0) continue;
      statics++;
      const id = reg.ids[kind]!;
      if (reg.salvageYield[kind]) add("street wreck");
      for (const [name, like] of HOLDERS) if (like.test(id)) add(name);
      const room = ROOM.exec(id);
      const b = room && map.buildings ? map.buildings.buildingOf(c, slot) : -1;
      if (room && b >= 0) {
        const storey = map.buildings!.storeyOf(c, slot);
        add(`room ${room[1]!.slice(1)}, ${map.buildings!.kind(b)}, ${HEIGHTS.find(([, most]) => storey <= most)![0]}`);
        add(`room ${room[1]!.slice(1)}`);
      }
    }
  }
  for (const v of map.vehicles ?? []) add(`found vehicle ${v.kind}`);
  const km2 = (map.dims.chunksX * map.dims.chunksZ * 64 * 64) / 1e6;
  console.log(`${file}: ${statics} statics on a map of ${km2.toFixed(0)} km²`);
  const rows = [...count].sort((a, b) => (a[0].startsWith("room") === b[0].startsWith("room") ? b[1] - a[1] : a[0].startsWith("room") ? 1 : -1));
  for (const [name, n] of rows) console.log(`  ${String(n).padStart(8)}  ${(n / km2).toFixed(1).padStart(7)} a km²  ${name}`);
}
