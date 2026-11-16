// What a frame spends before and after a change, view by view and tier by tier, from views.ts's rendering.json files:
// bun tools/mapworld/cost.ts <out.json> <tier>=<before folder>,<after folder>...
// Writes each view's draws and triangles beside its tier's budget, and the largest change.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Rendered { name: string; draws: number; triangles: number; budget: { draws: number; triangles: number }; dropped: number }
const [out, ...pairs] = process.argv.slice(2);
if (!out || pairs.length === 0) { console.error("bun tools/mapworld/cost.ts <out.json> <tier>=<before folder>,<after folder>..."); process.exit(2); }
const read = (folder: string): Rendered[] => (JSON.parse(readFileSync(join(folder, "rendering.json"), "utf8")) as { views: Rendered[] }).views;
const tiers = pairs.map((pair) => {
  const [tier, folders] = pair.split("="); const [before, after] = folders!.split(",").map(read);
  const views = after!.map((a) => {
    const b = before!.find((v) => v.name === a.name)!;
    return { name: a.name, draws: [b.draws, a.draws], triangles: [b.triangles, a.triangles], dropped: [b.dropped, a.dropped], within: a.draws <= a.budget.draws && a.triangles <= a.budget.triangles };
  });
  return { tier, budget: after![0]!.budget, views, mostTriangles: Math.max(...views.map((v) => v.triangles[1]!)), mostDraws: Math.max(...views.map((v) => v.draws[1]!)), addedTriangles: Math.max(...views.map((v) => v.triangles[1]! - v.triangles[0]!)), addedDraws: Math.max(...views.map((v) => v.draws[1]! - v.draws[0]!)) };
});
writeFileSync(out, `${JSON.stringify({ about: "Draws and triangles of each view's frame, [before, after]; `within` is the after frame inside the tier's budget.", tiers }, null, 2)}\n`);
for (const t of tiers) console.log(`${t.tier.padEnd(8)} most ${t.mostDraws} of ${t.budget.draws} draws, ${(t.mostTriangles / 1000).toFixed(0)} k of ${(t.budget.triangles / 1000).toFixed(0)} k triangles; at most ${t.addedDraws} draws and ${(t.addedTriangles / 1000).toFixed(0)} k triangles more than before`);
