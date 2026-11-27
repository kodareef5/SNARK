// The scoreboard: every point with a dataset, each entry scored on what is held out (the `pen` family and the Miami
// slice), headed by whole episodes played on those layouts under each policy. Writes .cache/decide/scoreboard.json (the
// Scoreboard type) and a page with nothing outside it, .cache/decide/scoreboard.html, and puts each trained scorer's
// held-out Score in its weights file's `about`.
//
//   bun tools/decide/score.ts [--point <name>] [--episodes 40] [--workers 8] [--reading 1s|5s|end]
//   bun tools/decide/score.ts --headroom <point>     how far the best candidate beats the rule, before any training
//
// One answer is timed in a child pinned to a fast core and to a slow one (taskset -c 2 and -c 20 on this machine).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { answer, scoreTable, type Model } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import type { EpisodeScore, PointScores, Scoreboard } from "../../shared/decide/scoreboard.ts";
import { Table } from "../../shared/decide/table.ts";
import { readModel, writeModel } from "../../shared/decide/weights.ts";
import { boardHtml } from "./board.ts";
import { catalog } from "./catalog.ts";
import { READINGS, dataDir, readData, revision, type Decision } from "./dataset.ts";
import { examples, roleOf, type Catalog } from "./fit.ts";
import { Workers, status, type Job } from "./generate.ts";
import { draw, type Family } from "./random.ts";
import { episodeScore, headroom, ratePoint, type Trained } from "./rate.ts";

/** Cores this machine calls fast and slow (16 to 31 are its slow ones). */
export const CORES = { fast: 2, slow: 20 } as const;
const ROOT = ".cache/decide";

/** Median and 99th percentile, in microseconds, of one answer of `m` over the tables of `ds`. */
export function timeAnswers(m: Model, p: Profile, ds: readonly Decision[], answers = 20000): { median: number; p99: number } {
  const rows = ds.flatMap((d) => d.tables.filter((t) => t.profile === p.name));
  if (rows.length === 0) return { median: NaN, p99: NaN };
  const most = Math.max(...rows.map((r) => r.k)), t = new Table(most, p.state.length, p.columns.length);
  const times = new Float64Array(answers);
  for (let warm = 0; warm < 2; warm++) {
    for (let i = 0; i < answers; i++) {
      const r = rows[i % rows.length]!;
      t.k = r.k;
      t.state.set(r.state);
      t.rows.set(r.rows);
      t.bias.set(r.bias);
      t.mask.set(r.mask);
      const from = performance.now();
      scoreTable(m, p, t);
      answer(p.kind, t, m.temperature);
      times[i] = (performance.now() - from) * 1000;
    }
  }
  times.sort();
  return { median: times[answers >> 1]!, p99: times[Math.floor(answers * 0.99)]! };
}

/** Times a weights file in a child pinned to `core`; unpinned where taskset is missing. */
function timed(file: string, point: string, core: number): { median: number; p99: number; pinned: boolean } {
  const args = [process.execPath, join(import.meta.dir, "score.ts"), "--time", file, "--point", point];
  const has = Bun.spawnSync(["which", "taskset"], { stdout: "pipe" }).exitCode === 0;
  const r = Bun.spawnSync(has ? ["taskset", "-c", String(core), ...args] : args, { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return { median: NaN, p99: NaN, pinned: has };
  return { ...(JSON.parse(r.stdout.toString()) as { median: number; p99: number }), pinned: has };
}

function modelsOf(point: string, p: Profile): { file: string; model: Model; bytes: number; name: string; kind: "linear" | "hidden" }[] {
  const dir = join(ROOT, "models", point);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => {
    const file = join(dir, f), m = readModel(JSON.parse(readFileSync(file, "utf8")), p);
    if (typeof m === "string") return [];
    return [{ file, model: m, bytes: statSync(file).size, name: f.replace(/\.json$/, ""), kind: m.hidden > 0 ? "hidden" as const : "linear" as const }];
  });
}

/** The held-out scenes the decisions came from, at most `most`, for whole episodes. */
function heldScenes(ds: readonly Decision[], cat: Catalog, most: number): ReturnType<typeof draw>[] {
  const seen = new Set<string>(), out: ReturnType<typeof draw>[] = [];
  for (const d of ds) {
    const key = `${d.family}/${d.seed}`;
    if (roleOf(cat.split, d.family, d.map) !== "held" || seen.has(key)) continue;
    seen.add(key);
    out.push(draw(d.family as Family, d.seed));
    if (out.length >= most) break;
  }
  return out;
}

/** One point's scores; whole episodes are played on `workers` processes. */
export async function scorePoint(point: string, o: { episodes: number; workers: number; reading?: number }): Promise<PointScores> {
  const cat = catalog(point);
  const { manifest, decisions } = readData(dataDir(point, join(ROOT, "data")), cat.profiles);
  const p = cat.profiles.find((q) => q.name === manifest.profiles[0]?.name)!;
  const found = modelsOf(point, p);
  const trained: Trained[] = found.map((f) => {
    const fast = timed(f.file, point, CORES.fast), slow = timed(f.file, point, CORES.slow);
    return { name: f.name, kind: f.kind, model: f.model, bytes: f.bytes, microsFast: fast.p99, microsSlow: slow.p99, medianFast: fast.median, medianSlow: slow.median };
  });
  let episodes: EpisodeScore[] = [];
  const held = point.startsWith("toy.") ? [] : heldScenes(decisions, cat, o.episodes);
  if (held.length > 0) {
    const policies: { name: string; policy: "off" | "rule" | "model"; models: string[] }[] = [
      { name: "today", policy: "off", models: [] }, { name: "rule", policy: "rule", models: [] },
      ...found.map((f) => ({ name: f.name, policy: "model" as const, models: [f.file] })),
    ];
    const jobs: Job[] = policies.flatMap((pol) => held.map((scene): Job => ({ kind: "episode", scene, point, policy: pol.policy, models: pol.models })));
    status({ step: "episodes", point, done: 0, of: jobs.length });
    let done = 0;
    const results = await new Workers(o.workers).run(jobs, () => {
      if (++done % 20 === 0) status({ step: "episodes", point, done, of: jobs.length });
    });
    episodes = policies.map((pol, i) => episodeScore(pol.name, results.slice(i * held.length, (i + 1) * held.length).flatMap((d) => (d.kind === "episode" ? [d.result] : []))));
  }
  const scores = ratePoint({ point, profile: p, cat, decisions, reading: o.reading ?? READINGS.length - 1, trained, episodes });
  // The rule is timed as the trained are, from a file of its own outside the models.
  const rule = cat.rules.get(p.name), ruled = scores.scores.find((s) => s.name === "rule");
  if (rule && ruled) {
    const file = join(ROOT, "rules", `${p.name}.json`);
    mkdirSync(join(ROOT, "rules"), { recursive: true });
    writeFileSync(file, JSON.stringify(writeModel(rule)));
    const fast = timed(file, point, CORES.fast), slow = timed(file, point, CORES.slow);
    Object.assign(ruled, { microsFast: fast.p99, microsSlow: slow.p99, medianFast: fast.median, medianSlow: slow.median, bytes: statSync(file).size });
  }
  // Each trained scorer's file keeps its held-out score.
  for (const f of found) {
    const file = JSON.parse(readFileSync(f.file, "utf8")) as { about?: Record<string, unknown> };
    file.about = { ...(file.about ?? {}), on: "held out", score: scores.scores.find((s) => s.name === f.name) };
    writeFileSync(f.file, JSON.stringify(file));
  }
  return scores;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main && process.argv.includes("--time")) {
  const file = arg("--time")!, point = arg("--point")!, cat = catalog(point);
  const { manifest, decisions } = readData(dataDir(point, join(ROOT, "data")), cat.profiles);
  const raw = JSON.parse(readFileSync(file, "utf8")) as { profile: string };
  const p = cat.profiles.find((q) => q.name === raw.profile) ?? cat.profiles.find((q) => q.name === manifest.profiles[0]?.name)!;
  const m = readModel(raw, p);
  if (typeof m === "string") throw new Error(m);
  console.log(JSON.stringify(timeAnswers(m, p, decisions)));
} else if (import.meta.main && process.argv.includes("--headroom")) {
  const point = arg("--headroom")!, cat = catalog(point);
  const { manifest, decisions } = readData(dataDir(point, join(ROOT, "data")), cat.profiles);
  const p = cat.profiles.find((q) => q.name === manifest.profiles[0]?.name)!;
  const rule = cat.rules.get(p.name) ?? null;
  console.log(`${point}: ${decisions.length} decisions from ${new Set(manifest.scenes.map((s) => `${s.family}/${s.seed}`)).size} scenes`);
  READINGS.forEach((r, i) => {
    const h = headroom(examples(decisions, p, cat.profiles, cat.rules, i), rule);
    console.log(`  at ${r}: the best candidate beats the rule by ${h.toFixed(3)} of the median cost${h < 0.05 ? ": under 0.05, no model is worth training for it" : ""}`);
  });
} else if (import.meta.main) {
  const named = arg("--point");
  const points = named ? [named] : existsSync(join(ROOT, "data")) ? readdirSync(join(ROOT, "data")).filter((d) => existsSync(join(ROOT, "data", d, "manifest.json"))).sort() : [];
  const board: Scoreboard = { made: new Date().toISOString(), revision: revision(), points: [] };
  for (const point of points) {
    status({ step: "score", point, done: 0, of: 1 });
    const reading = READINGS.indexOf((arg("--reading") ?? "end") as (typeof READINGS)[number]);
    board.points.push(await scorePoint(point, { episodes: Number(arg("--episodes") ?? 40), workers: Number(arg("--workers") ?? 8), reading: reading < 0 ? undefined : reading }));
  }
  writeFileSync(join(ROOT, "scoreboard.json"), JSON.stringify(board, null, 1));
  writeFileSync(join(ROOT, "scoreboard.html"), boardHtml(board));
  status({ step: "idle", point: "", done: points.length, of: points.length });
  for (const p of board.points) {
    console.log(`${p.point} (${p.profile}): headroom ${p.headroom.toFixed(3)}`);
    for (const e of p.episodes) console.log(`  episodes, ${e.name}: arrived ${e.arrived} of ${e.scenes}, mean cost ${e.cost.toFixed(0)}, decide p99 ${e.decideMicros.toFixed(1)} µs`);
    for (const s of p.scores) console.log(`  ${s.name}: regret ${s.regretRatio.toFixed(3)} of the rule's on ${s.decisions} decisions${s.kind === "linear" || s.kind === "hidden" ? `; ${s.gate.pass ? "passes" : `fails: ${s.gate.why.join("; ")}`}` : ""}`);
  }
  console.log(join(ROOT, "scoreboard.html"));
}
