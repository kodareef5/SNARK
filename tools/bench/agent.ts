// Rows for the agent that plays: the way finders, what observe costs, and a tick of the agent while it walks.
// `bun tools/bench/agent.ts` runs these alone.

import { observe } from "../../agent/observe.ts";
import { LayeredFinder } from "../../shared/world/layers.ts";
import { PATH_BUDGET, PathFinder } from "../../shared/world/path.ts";
import { play } from "../../tests/fixtures/agent.ts";
import { flatWorld, provingWorld, sealedRoom } from "../../tests/fixtures/world.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** The median time of one call, in milliseconds. */
function median(runs: number, fn: () => void): number {
  const took: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    took.push(performance.now() - t);
  }
  return took.sort((a, b) => a - b)[runs >> 1]!;
}

export function benchAgent(section: Section, record: Row): void {
  section("Agent (headless): ways across the proving ground, what observe costs, and a tick of an agent walking");
  const w = provingWorld();
  const f = new PathFinder(w, w.reg.move[w.kind("core:survivor")]!);
  record("a way round the 24 m wall", median(50, () => f.find(288, 258, 288, 266)), "ms", 2);
  record("cells that search expanded", f.expanded, "");
  record("a 96 m leg toward a goal 260 m off", median(50, () => f.find(256, 240, 256, 500)), "ms", 5);
  f.find(200, 200, 290, 296);
  record("whether 96 m of way still holds", median(200, () => f.holds(1, 200, 200)), "ms", 0.2);
  // A goal walled in, on ground wide enough that the search stops at its budget and not at the map's edge.
  const wide = flatWorld(4);
  sealedRoom(wide, 128, 128);
  const g = new PathFinder(wide, f.body);
  record(`a search to its budget of ${PATH_BUDGET} cells`, median(20, () => g.find(100.5, 128.5, 128.5, 128.5)), "ms", 25);
  // The search that climbs and swims, which the agent runs a slice a tick.
  const l = new LayeredFinder(w, w.reg.move[w.kind("core:survivor")]!);
  record("a climb from the plaza up the stairs to the slab", median(20, () => l.find(256, 0, 240, 263, 3.6, 292.5)), "ms", 20);
  record("a swim across the pool", median(10, () => l.find(200, 0, 256, 148, NaN, 256)), "ms", 60);
  record("nodes that swim expanded", l.expanded, "");

  const p = play();
  p.run(1000);
  let bytes = 0;
  record("observe, 32 m at 2 m a letter", median(50, () => (bytes = JSON.stringify(observe(p.s, p.agent.remote, 32, 2)).length)), "ms", 5);
  record("the answer", bytes / 1024, "KB", 2);
  record("observe, 96 m at 4 m a letter", median(20, () => observe(p.s, p.agent.remote, 96, 4)), "ms", 40);
  // Ten seconds of walking north from the spawn point, the agent's own tick timed apart from the server's.
  void p.agent.call("go_to", { x: 256, z: 500, wait_s: 0 });
  const ticks: number[] = [];
  p.h.run(10000, (now) => {
    const t = performance.now();
    p.agent.tick(now);
    ticks.push(performance.now() - t);
  });
  ticks.sort((a, b) => a - b);
  record("a tick while walking, median", ticks[ticks.length >> 1]!, "ms", 0.1);
  record("a tick while walking, worst (a leg found)", ticks[ticks.length - 1]!, "ms", 8);
}

if (import.meta.main) {
  benchAgent(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
