// Looks at the scenes before anything is trained on them: for each family, whether a whole-grid search finds a way at all
// (the oracle), how often today's code and the rule arrive and how long they take, and how often the ring is asked. A
// family the oracle cannot cross is impossible; one where today's code arrives and the ring is never asked teaches nothing.
//
//   bun tools/decide/audit.ts [--families trees,deadEnd,...] [--scenes 30] [--first 1]
//
// writes .cache/decide/audit.json and prints a line a family.

import { mkdirSync, writeFileSync } from "node:fs";
import { TICK_RATE } from "../../shared/coords.ts";
import { FAMILIES } from "./catalog.ts";
import { scenes, type Family, type Scene } from "./random.ts";
import { build, play } from "./setups.ts";

export interface Seen {
  family: string;
  seed: number;
  kind: string;
  /** Metres of the oracle's way once the scene is placed (setups.ts), NaN where no try found one, and the straight line. */
  way: number;
  line: number;
  /** For today's code and the rule: ticks to arrive (-1 for never), ticks stuck or pinned, and answers of nav.ring. */
  off: { arrived: number; stuck: number; asked: number };
  rule: { arrived: number; stuck: number; asked: number };
}

/** One scene seen by the oracle and played under today's code and the rule. */
export function see(s: Scene): Seen {
  const b = build(s), ents = b.lab.world.ents, way = b.way;
  const line = Math.hypot(b.goal.x - ents.x[b.mover]!, b.goal.z - ents.z[b.mover]!);
  b.lab.host.shutdown();
  const run = (policy: "off" | "rule") => {
    const w = build(s), t = play(w, { point: "nav.ring", policy });
    w.lab.host.shutdown();
    return { arrived: t.arrivedAt, stuck: t.stuckTicks, asked: t.answers };
  };
  return { family: s.family, seed: s.seed, kind: s.kind, way, line, off: run("off"), rule: run("rule") };
}

/** A family's line: impossible, trivial, and each policy's arrivals and mean ticks to arrive. */
export function summary(all: readonly Seen[]): string {
  const impossible = all.filter((s) => Number.isNaN(s.way)).length, list = all.filter((s) => !Number.isNaN(s.way));
  const n = list.length, pct = (k: number) => `${Math.round((100 * k) / n)}%`;
  const trivial = list.filter((s) => s.off.arrived >= 0 && s.rule.asked === 0).length;
  const asked = list.filter((s) => s.rule.asked > 0).length;
  const anyone = list.filter((s) => s.off.arrived >= 0 || s.rule.arrived >= 0).length;
  const mean = (v: number[]) => (v.length ? (v.reduce((a, b) => a + b, 0) / v.length / TICK_RATE).toFixed(1) : "–");
  const arrived = (p: "off" | "rule") => list.filter((s) => s[p].arrived >= 0);
  return `${all[0]?.family}: ${all.length} scenes, ${impossible} with no way at all; of the ${n} played: trivial ${pct(trivial)}, ring asked ${pct(asked)}; today arrives ${pct(arrived("off").length)} in ${mean(arrived("off").map((s) => s.off.arrived))} s, the rule ${pct(arrived("rule").length)} in ${mean(arrived("rule").map((s) => s.rule.arrived))} s, either ${pct(anyone)}`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const families = (arg("--families")?.split(",") ?? [...FAMILIES, "miami"]) as Family[];
  const n = Number(arg("--scenes") ?? 30), first = Number(arg("--first") ?? 1);
  const all: Seen[] = [];
  for (const f of families) {
    const seen = scenes([f], n, first).map(see);
    all.push(...seen);
    console.log(summary(seen));
  }
  mkdirSync(".cache/decide", { recursive: true });
  writeFileSync(".cache/decide/audit.json", JSON.stringify(all, null, 1));
}
