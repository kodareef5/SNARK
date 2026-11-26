// The people bench's cells, the order they are run in, and what their runs come to (tools/bench/people.ts): apart from
// the bench so a test can read them without a server or a browser.

import { CROWD_LOOKS, CROWD_SCENES, type CrowdLooks, type CrowdScene } from "../../client/core/people-crowd.ts";

/**
 * One cell: a scene and its looks on a tier, and the view it is held at. "empty" is a view with no crowd, which the
 * crowds held at that view are set against: the portrait's, which looks down, and the one the other two share.
 */
export interface Cell {
  scene: CrowdScene | "empty";
  looks: CrowdLooks | null;
  tier: string;
  view: CrowdScene;
}

const viewOf = (scene: CrowdScene): CrowdScene => (scene === "portrait" ? "portrait" : "near");
export const cellName = (c: Cell): string => `${c.scene === "empty" ? `empty, ${c.view === "portrait" ? "portrait" : "crowd"} view` : `${c.scene} ${c.looks}`} ${c.tier}`;

/** Every cell for `tiers`: the two empty views, then each scene in each kind of looks. */
export function cells(tiers: readonly string[]): Cell[] {
  const out: Cell[] = [];
  for (const tier of tiers) {
    for (const view of ["portrait", "near"] as const) out.push({ scene: "empty", looks: null, tier, view });
    for (const scene of CROWD_SCENES) for (const looks of CROWD_LOOKS) out.push({ scene, looks, tier, view: viewOf(scene) });
  }
  return out;
}

/** The order the cells are run in, round by round: all of them each round, round `k` starting `k` cells on. */
export function rounds(list: readonly Cell[], runs: number): Cell[][] {
  return Array.from({ length: runs }, (_, k) => list.map((_, i) => list[(i + k) % list.length]!));
}

/** The page's address for a cell: the bench, its tier, the view held, and the crowd. */
export function address(port: number, c: Cell): string {
  return `http://127.0.0.1:${port}/?bench=1&name=bench&tier=${c.tier}&still&look=${c.view}${c.scene === "empty" ? "" : `&people=${c.scene}&looks=${c.looks}`}`;
}

/** What one run reports, of what the page sent (bench-run.ts BenchRun.frame). */
export interface RunNumbers {
  gpuMedian: number;
  gpuP95: number;
  frameMs: number;
  cpuMs: number;
  cpuP99: number;
  glDraws: number;
  draws: number;
  triangles: number;
  bones: number;
  dropped: number;
  posed: number;
  fresh: number;
  cardBytes: number;
  textureBytes: number;
  gaveUp: boolean;
}

/** A page's report as the numbers a run keeps; a time not measured (no timer query) is NaN. */
export function numbersOf(r: Record<string, any>): RunNumbers {
  const turn = r.turn ?? {};
  return {
    gpuMedian: r.gpuMs?.frame?.median ?? NaN,
    gpuP95: r.gpuMs?.frame?.p95 ?? NaN,
    frameMs: r.frameMs?.median ?? NaN,
    cpuMs: r.buildAndSubmitMs?.median ?? NaN,
    cpuP99: r.buildAndSubmitMs?.p99 ?? NaN,
    glDraws: r.drawCalls ?? NaN,
    draws: turn.draws ?? NaN,
    triangles: turn.triangles ?? NaN,
    bones: turn.bones ?? NaN,
    dropped: turn.dropped ?? NaN,
    posed: turn.posed ?? NaN,
    fresh: turn.fresh ?? NaN,
    cardBytes: r.card?.bytes ?? NaN,
    textureBytes: r.card?.textures ?? NaN,
    gaveUp: r.waited?.gaveUp === true,
  };
}

export type Metric = Exclude<keyof RunNumbers, "gaveUp">;
export const METRICS: readonly Metric[] = ["gpuMedian", "gpuP95", "frameMs", "cpuMs", "cpuP99", "glDraws", "draws", "triangles", "bones", "dropped", "posed", "fresh", "cardBytes", "textureBytes"];

/** The least, the median and the most of a list; NaN for all three where it holds no number. */
export function spread(list: readonly number[]): { min: number; median: number; max: number } {
  const v = list.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { min: NaN, median: NaN, max: NaN };
  return { min: v[0]!, median: v.length % 2 === 1 ? v[v.length >> 1]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2, max: v[v.length - 1]! };
}

export interface CellSummary {
  name: string;
  cell: Cell;
  runs: number;
  /** Runs that measured before the scene was still, which gave up waiting (bench-run.ts STILL). */
  gaveUp: number;
  stats: Record<Metric, { min: number; median: number; max: number }>;
  /** What the crowd adds to its empty view on the same tier, by medians; null for an empty view or where it was not run. */
  added: Record<"gpuMedian" | "cpuMs" | "glDraws" | "draws" | "triangles" | "cardBytes", number> | null;
}

/** Each cell's ranges over its runs, in the order of `list`, and what each crowd adds to its tier's empty view. */
export function summarise(list: readonly Cell[], results: ReadonlyMap<string, readonly RunNumbers[]>): CellSummary[] {
  const out = list.map((cell): CellSummary => {
    const runs = results.get(cellName(cell)) ?? [];
    const stats = Object.fromEntries(METRICS.map((m) => [m, spread(runs.map((r) => r[m]))])) as CellSummary["stats"];
    return { name: cellName(cell), cell, runs: runs.length, gaveUp: runs.filter((r) => r.gaveUp).length, stats, added: null };
  });
  for (const s of out) {
    const empty = out.find((e) => e.cell.scene === "empty" && e.cell.tier === s.cell.tier && e.cell.view === s.cell.view);
    if (s.cell.scene === "empty" || !empty || empty.runs === 0 || s.runs === 0) continue;
    const less = (m: Metric): number => s.stats[m].median - empty.stats[m].median;
    s.added = { gpuMedian: less("gpuMedian"), cpuMs: less("cpuMs"), glDraws: less("glDraws"), draws: less("draws"), triangles: less("triangles"), cardBytes: less("cardBytes") };
  }
  return out;
}

const range = (s: { min: number; max: number }, digits: number, scale = 1): string => {
  if (!Number.isFinite(s.min)) return "n/a";
  const [a, b] = [(s.min / scale).toFixed(digits), (s.max / scale).toFixed(digits)];
  return a === b ? a : `${a} to ${b}`;
};
const signed = (v: number, digits: number, scale = 1): string => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v / scale).toFixed(digits)}` : "n/a");

/** The table of `summaries`, as Markdown: one row a cell, ranges over its runs, then what the crowd adds. */
export function table(summaries: readonly CellSummary[]): string {
  const head = ["Cell", "Runs", "GPU ms, median", "GPU ms, p95", "Our ms", "GL draws", "Packet draws", "Triangles, k", "Bones", "Posed", "Dropped", "Card MB", "Textures MB", "Added: GPU ms", "Added: draws", "Added: k triangles"];
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const s of summaries) {
    const t = s.stats, a = s.added;
    lines.push(`| ${[
      s.name, `${s.runs}${s.gaveUp ? ` (${s.gaveUp} not still)` : ""}`, range(t.gpuMedian, 2), range(t.gpuP95, 2), range(t.cpuMs, 2), range(t.glDraws, 0), range(t.draws, 0),
      range(t.triangles, 0, 1000), range(t.bones, 0), range(t.posed, 0), range(t.dropped, 0), range(t.cardBytes, 1, 1 << 20), range(t.textureBytes, 1, 1 << 20),
      a ? signed(a.gpuMedian, 2) : "", a ? signed(a.draws, 0) : "", a ? signed(a.triangles, 0, 1000) : "",
    ].join(" | ")} |`);
  }
  return lines.join("\n");
}
