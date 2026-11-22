// `bun run supply`: the starter drop book judged against the game as it is (planning/workstreams/supply.md).
//
//   bun run supply                 every table's worth against its tier's target, as designed and today
//   bun run supply -- waiting      what the book names that the game does not have, and how often each would drop
//   bun run supply -- fit          scale each kit's ballast line to its target and write content/supply/fit.ts
//   bun run supply -- table blue/arms [--ringed] [--rolls N] [--seed N]    one table in full
//
// The same figures are the admin page's and the tests' (shared/supply/simulate.ts).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../content/core.ts";
import { starterBook } from "../content/supply/starter.ts";
import { compileContent } from "../shared/content/registry.ts";
import { QUALITY_NAMES } from "../shared/sim/items.ts";
import { bookFaults } from "../shared/supply/book.ts";
import { catalogOf, withFuture, type Catalog } from "../shared/supply/catalog.ts";
import { compileBook } from "../shared/supply/compile.ts";
import { MEASURE_ROLLS, MEASURE_SEED, measure } from "../shared/supply/measure.ts";
import { simulate } from "../shared/supply/simulate.ts";

const ROOT = join(import.meta.dir, "..");
const ROLLS = MEASURE_ROLLS;
const SEED = MEASURE_SEED;

export { measure, type Cell } from "../shared/supply/measure.ts";

/** What each kit's ballast line is multiplied by to bring its table, as designed, to its target. */
export function fit(catalog: Catalog, rolls = ROLLS): { scales: Record<string, number>; stuck: string[] } {
  const scales: Record<string, number> = {};
  const stuck: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const book = starterBook(scales);
    const { cells, designed } = measure(book, catalog, rolls);
    for (const cell of cells) {
      const [tier, cls] = cell.key.split("/") as [string, string];
      const kit = `kit.${cls}.${tier}`;
      const line = book.sets[kit]?.entries.find((e) => e.ballast);
      if (!line) continue;
      // The ballast is one thing at no quality, so what it adds to the mean is its count times its worth.
      const each = designed.worth.of(line.items[0]!);
      const now = ((line.min + line.max) / 2) * each;
      const rest = cell.designed.mean - now;
      const wanted = cell.target - rest;
      const scale = (scales[kit] ?? 1) * Math.min(8, Math.max(0.15, wanted / Math.max(1e-9, now)));
      scales[kit] = Math.round(Math.min(30, Math.max(0.05, scale)) * 1000) / 1000;
      if (pass === 3 && Math.abs(cell.designed.mean - cell.target) > cell.target * 0.1 && !stuck.includes(cell.key)) stuck.push(cell.key);
    }
  }
  return { scales, stuck };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reg = compileContent(CORE_CONTENT).registry!;
  const catalog = catalogOf(reg);
  const book = starterBook();
  const faults = bookFaults(book);
  if (faults.length > 0) {
    for (const f of faults) console.log(`${f.path}: ${f.message}`);
    process.exit(1);
  }
  const what = args[0] ?? "report";
  if (what === "sites") {
    await (await import("./supply/sites.ts")).sitesCommand(args.slice(1));
    process.exit(0);
  }
  const pct = (v: number, of: number): string => `${Math.round((v / of) * 100)}%`.padStart(4);
  if (what === "fit") {
    const { scales, stuck } = fit(catalog);
    const lines = Object.entries(scales).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `  "${k}": ${v},`);
    writeFileSync(
      join(ROOT, "content/supply/fit.ts"),
      `// What \`bun run supply -- fit\` found: for each kit, what its ballast line is multiplied by to bring its table to its\n// tier's target as designed (with the items the book waits for counted at their guesses). Written by the tool; run it\n// again after changing content/supply/starter.ts or what an item costs.\nexport const FIT: Readonly<Record<string, number>> = {\n${lines.join("\n")}\n};\n`,
    );
    console.log(`content/supply/fit.ts: ${lines.length} kits fitted${stuck.length > 0 ? `; not within a tenth of target whatever the ballast: ${stuck.join(", ")}` : ""}`);
  } else if (what === "waiting") {
    const { today, designed } = measure(book, catalog, 1);
    // How often each waiting thing would come, over every table weighted alike.
    const often = new Map<string, number>();
    const tables = [...designed.tables.values()];
    for (const t of tables) for (const item of simulate(designed, t, false, 2000, SEED).items) if (designed.catalog.byId.get(item.id)?.future) often.set(item.id, (often.get(item.id) ?? 0) + item.rolls / 2000 / tables.length);
    console.log(`${today.report.waiting.length} things the book names and the game does not have:`);
    for (const w of [...today.report.waiting].sort((a, b) => (often.get(b.id) ?? 0) - (often.get(a.id) ?? 0))) {
      const f = book.future[w.id];
      console.log(`  ${w.id.padEnd(30)} ${w.why.padEnd(8)} ${(f ? `${f.ark}, level ${f.level}, worth ${f.worth ?? "?"}` : "").padEnd(46)} in ${String(w.sets.length).padStart(2)} sets, ${((often.get(w.id) ?? 0) * 100).toFixed(2).padStart(5)}% of drops`);
    }
  } else if (what === "table") {
    const key = args[1] ?? "";
    const rolls = Number(flag("rolls") ?? ROLLS);
    const c = compileBook(book, args.includes("--designed") ? withFuture(catalog, book) : catalog);
    const t = c.tables.get(key);
    if (!t) {
      console.log(`no table ${key}; there are: ${[...c.tables.keys()].join(" ")}`);
      process.exit(1);
    }
    const s = simulate(c, t, args.includes("--ringed"), rolls, Number(flag("seed") ?? SEED));
    const target = book.tiers[t.tier]?.target ?? 0;
    console.log(`${key}${args.includes("--ringed") ? ", ringed" : ""}: ${rolls} rolls; target ${target}; mean ${s.mean.toFixed(0)}, least ${s.min.toFixed(0)}, 5% ${s.p5.toFixed(0)}, median ${s.median.toFixed(0)}, 95% ${s.p95.toFixed(0)}, most ${s.max.toFixed(0)}; jackpots ${(s.jackpotShare * 100).toFixed(1)}% of rolls, ${s.jackpotMean.toFixed(0)} a roll; at most ${s.stacksMost} stacks; blueprints ${(s.blueprintShare * 100).toFixed(1)}% of things`);
    console.log(`  quality of what has one: ${s.quality.map((q, i) => `${QUALITY_NAMES[i]} ${(q * 100).toFixed(0)}%`).join(", ")}`);
    for (const item of s.items) console.log(`  ${item.id.padEnd(30)} in ${((item.rolls / rolls) * 100).toFixed(1).padStart(5)}% of rolls, ${(item.count / Math.max(1, item.rolls)).toFixed(1).padStart(6)} a time${item.blueprints > 0 ? `, ${((item.blueprints / item.rolls) * 100).toFixed(0)}% as a blueprint` : ""}`);
  } else {
    const { cells, today } = measure(book, catalog);
    console.log(`the starter book against ${catalog.byId.size} items: ${today.report.waiting.length} waiting, ${today.report.dormant.length} dormant, ${today.report.lints.length} lints`);
    console.log("each cell: mean as designed (of target), least roll (of target) | mean today | ringed over plain");
    for (const tier of book.tiers) {
      console.log(`${tier.name}, level ${tier.level}, target ${tier.target}`);
      for (const cell of cells.filter((c) => c.key.startsWith(`${tier.key}/`))) {
        console.log(`  ${cell.key.slice(tier.key.length + 1).padEnd(11)} ${cell.designed.mean.toFixed(0).padStart(6)} ${pct(cell.designed.mean, cell.target)}  least ${pct(cell.designed.min, cell.target)} | today ${cell.today.mean.toFixed(0).padStart(6)} ${pct(cell.today.mean, cell.target)}${cell.dormant ? " dormant" : ""} | ringed x${(cell.ringed.mean / cell.designed.mean).toFixed(2)}${cell.designed.jackpotShare > 0 ? ` | jackpot ${(cell.designed.jackpotShare * 100).toFixed(1)}%` : ""} | ${cell.designed.stacksMost} stacks`);
      }
    }
    for (const l of today.report.lints) console.log(`lint ${l.path}: ${l.message}`);
  }
}
