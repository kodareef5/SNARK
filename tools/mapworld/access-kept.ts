// Whether a change to the build took a building's last way from a street: two builds of one place compared by their
// reports (reports/<ruins>/buildings.json, which each build writes into its work folder).
//   bun tools/mapworld/access-kept.ts <work folder before> <work folder after>
// Exits 1 where a building that had an approach has none. A building only one of the two built is told and fails nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { World } from "./ground.ts";

/** What the comparison reads of a building's record. */
export interface Approached { id: number; name: string | null; approaches: readonly unknown[] }

/** The buildings with an approach in `before` and none in `after`, and those with one that `after` does not hold. */
export function approachesLost(before: readonly Approached[], after: readonly Approached[]): { lost: Approached[]; missing: Approached[] } {
  const now = new Map(after.map((r) => [r.id, r]));
  const had = before.filter((r) => r.approaches.length > 0);
  return { lost: had.filter((r) => now.get(r.id)?.approaches.length === 0), missing: had.filter((r) => !now.has(r.id)) };
}

if (import.meta.main) {
  const [before, after] = process.argv.slice(2).map((folder) => {
    const world = JSON.parse(readFileSync(join(folder, "world/world.json"), "utf8")) as World;
    return JSON.parse(readFileSync(join(folder, "reports", world.ruins?.report ?? "ruins", "buildings.json"), "utf8")) as Approached[];
  });
  if (!before || !after) throw new Error("Two work folders are required: before, then after");
  const { lost, missing } = approachesLost(before, after);
  const count = (rows: readonly Approached[]): number => rows.filter((r) => r.approaches.length > 0).length;
  console.log(JSON.stringify({ check: "buildings that lost their last approach", count: lost.length, withApproachBefore: count(before), withApproachAfter: count(after), notBuiltAfter: missing.length, first: lost.slice(0, 5).map((r) => `${r.id}${r.name ? ` ${r.name}` : ""}`) }));
  if (lost.length > 0) process.exitCode = 1;
}
