// The scoreboard: every point with a dataset, each entry scored on what is held out (the `pen` family and the Miami
// slice), headed by whole episodes played on those layouts under each policy. Writes .cache/decide/scoreboard.json (the
// Scoreboard type) and a page with nothing outside it, .cache/decide/scoreboard.html, and puts each trained scorer's
// held-out Score in its weights file's `about`.
//
//   bun tools/decide/score.ts [--point <name>] [--layouts 40] [--fresh 0] [--workers 8] [--reading 1s|5s|end] [--note <text>]...
//     [--root .cache/decide] [--held-families a,b --held-first 900001]
//   bun tools/decide/score.ts --headroom <point>     how far the best candidate beats the rule, before any training
//
// One answer is timed in a child pinned to a fast core and to a slow one (taskset -c 2 and -c 20 on this machine).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { combine } from "../../shared/decide/combine.ts";
import { answer, scoreTable, type Model } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import type { EpisodeScore, PointScores, Scoreboard } from "../../shared/decide/scoreboard.ts";
import { Table } from "../../shared/decide/table.ts";
import { readModel, writeModel } from "../../shared/decide/weights.ts";
import { boardHtml } from "./board.ts";
import { FAMILIES, SITUATIONS, catalog } from "./catalog.ts";
import { READINGS, dataDir, readData, revision, type Decision, type Manifest } from "./dataset.ts";
import { examples, type Catalog } from "./fit.ts";
import { Workers, loadModels, status, type Job } from "./generate.ts";
import { scenes, type Family, type Scene } from "./random.ts";
import { episodeScore, headroom, ratePoint, type Trained } from "./rate.ts";

/** Cores this machine calls fast and slow (16 to 31 are its slow ones). */
export const CORES = { fast: 2, slow: 20 } as const;
/** Where the data, models and board are; `--root` names another, as for a second dataset to set beside the first. */
const ROOT = arg("--root") ?? ".cache/decide";

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
  const args = [process.execPath, join(import.meta.dir, "score.ts"), "--time", file, "--point", point, "--root", ROOT];
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

/**
 * The held-out layouts whole episodes are played on, fixed before anything is played: seeds 1 to `per` of each held-out
 * family, and of the held-out maps (the Miami slice), whatever happens in them.
 */
export function layouts(cat: Catalog, per: number): Scene[] {
  return scenes([...cat.split.held, ...cat.split.heldMaps] as Family[], per, 1);
}

/**
 * Every decision of a point of passes made again from its tables with `combine`, each pass scored by whoever scored it
 * in its run (the rule, or the run's trained scorers), by its mix over that scorer's temperature, with the held heading's
 * stick and the mask the answer as made carried: how many, and how many give the pick and probabilities stored. Under the
 * rule, all must, or the board's numbers cannot be trusted.
 */
export function agreement(point: string, manifest: Manifest, decisions: readonly Decision[], cat: Catalog): { checked: number; agreed: number; ruleChecked: number; ruleAgreed: number } {
  const passes = cat.passes?.[point], out = { checked: 0, agreed: 0, ruleChecked: 0, ruleAgreed: 0 };
  if (!passes) return out;
  let from = 0;
  for (const run of manifest.runs) {
    const models = run.under === "rule" ? [] : loadModels(run.under.split(","));
    for (const d of decisions.slice(from, from + run.decisions)) {
      const k = d.tables[0]!.k, tables = d.tables.map((row) => {
        const q = cat.profiles.find((r) => r.name === row.profile)!, t = new Table(k, q.state.length, q.columns.length);
        t.k = k;
        t.state.set(row.state);
        t.rows.set(row.rows);
        t.bias.set(row.bias);
        t.mask.set(row.mask);
        const m = models.find((x) => x.profile === q.name) ?? cat.rules.get(q.name)!;
        scoreTable(m, q, t);
        return { table: t, weight: (passes.mix[q.name] ?? 0) / m.temperature, q };
      });
      const first = tables[0]!, held = first.q.columns.indexOf("held");
      let at = -1;
      for (let c = 0; c < k && held >= 0; c++) if (first.table.rows[c * first.q.columns.length + held] === 1) at = c;
      const into = new Table(k, 0, 1);
      let pick = combine(into, tables, at, passes.stick), close = true;
      if (d.final) {
        for (let c = 0; c < k; c++) if (d.final.mask[c] !== 0) into.mask[c] = 1;
        pick = answer("choice", into, 1);
        for (let c = 0; c < k; c++) if (Math.abs(into.out[c]! - d.final.out[c]!) > 1e-6) close = false;
      }
      const same = pick === d.pick && close;
      out.checked++;
      if (same) out.agreed++;
      if (run.under === "rule") {
        out.ruleChecked++;
        if (same) out.ruleAgreed++;
      }
    }
    from += run.decisions;
  }
  return out;
}

/** Fresh scenes of every family, seeds no dataset holds, for the board's look at each family. */
export const FRESH_FIRST = 1_000_001;

interface Policy {
  name: string;
  policy: "off" | "rule" | "model";
  models: string[];
}

/** Each policy's whole episodes of `scenes`, on `workers` processes. */
async function play(point: string, policies: readonly Policy[], scenes: readonly Scene[], workers: number): Promise<EpisodeScore[]> {
  if (scenes.length === 0) return [];
  const jobs: Job[] = policies.flatMap((pol) => scenes.map((scene): Job => ({ kind: "episode", scene, point, policy: pol.policy, models: pol.models })));
  status({ step: "episodes", point, done: 0, of: jobs.length });
  let done = 0;
  const results = await new Workers(workers).run(jobs, () => {
    if (++done % 20 === 0) status({ step: "episodes", point, done, of: jobs.length });
  });
  for (const d of results) if (d.kind === "error") throw new Error(d.error);
  return policies.map((pol, i) => episodeScore(pol.name, results.slice(i * scenes.length, (i + 1) * scenes.length).flatMap((d) => (d.kind === "episode" ? [d.result] : []))));
}

/**
 * One point's scores, one entry for each profile of its tables; whole episodes are played on `workers` processes, the
 * held-out scenes its decisions came from and `fresh` new scenes of every family.
 */
export async function scorePoint(point: string, o: { layouts: number; workers: number; reading?: number; fresh?: number; held?: { families: Family[]; first: number } }): Promise<PointScores[]> {
  const cat = catalog(point);
  const { manifest, decisions } = readData(dataDir(point, join(ROOT, "data")), cat.profiles);
  const agreed = agreement(point, manifest, decisions, cat);
  if (agreed.checked > 0) console.log(`${point}: ${agreed.agreed} of ${agreed.checked} stored decisions made again with combine give the stored pick (${agreed.ruleAgreed} of ${agreed.ruleChecked} under the rule)`);
  if (agreed.ruleAgreed < agreed.ruleChecked) throw new Error(`${point}: ${agreed.ruleChecked - agreed.ruleAgreed} decisions under the rule do not come out as the server made them: no regret or calibration of them can be trusted`);
  const profiles = manifest.profiles.map((n) => cat.profiles.find((q) => q.name === n.name)!);
  const found = new Map(profiles.map((p) => [p.name, modelsOf(point, p)]));
  const policies: Policy[] = [
    { name: "today", policy: "off", models: [] }, { name: "rule", policy: "rule", models: [] },
    ...[...found.values()].flat().map((f) => ({ name: f.name, policy: "model" as const, models: [f.file] })),
  ];
  const game = !point.startsWith("toy.");
  // The held-out layouts: seeds 1 to `layouts` of the split's held families, or that many of the families named from `first`.
  const fixed = o.held ? scenes(o.held.families, o.layouts, o.held.first) : layouts(cat, o.layouts);
  const episodes = game ? await play(point, policies, fixed, o.workers) : [];
  const fresh = game && o.fresh ? await play(point, policies, scenes([...FAMILIES, "miami", ...SITUATIONS], o.fresh, FRESH_FIRST), o.workers) : [];
  const out: PointScores[] = [];
  for (const p of profiles) {
    const mine = found.get(p.name)!;
    const trained: Trained[] = mine.map((f) => {
      const fast = timed(f.file, point, CORES.fast), slow = timed(f.file, point, CORES.slow);
      return { name: f.name, kind: f.kind, model: f.model, bytes: f.bytes, microsFast: fast.p99, microsSlow: slow.p99, medianFast: fast.median, medianSlow: slow.median };
    });
    const names = new Set(["today", "rule", ...mine.map((f) => f.name)]);
    const scores = ratePoint({ point, profile: p, cat, decisions, reading: o.reading ?? READINGS.length - 1, trained, episodes: episodes.filter((e) => names.has(e.name)) });
    scores.fresh = fresh.filter((e) => names.has(e.name));
    if (agreed.checked > 0) scores.agreement = agreed;
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
    for (const f of mine) {
      const file = JSON.parse(readFileSync(f.file, "utf8")) as { about?: Record<string, unknown> };
      file.about = { ...(file.about ?? {}), on: "held out", score: scores.scores.find((s) => s.name === f.name) };
      writeFileSync(f.file, JSON.stringify(file));
    }
    out.push(scores);
  }
  return out;
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
    const h = headroom(examples(decisions, p, cat.profiles, cat.rules, i, undefined, cat.passes?.[point]), rule);
    console.log(`  at ${r}: the best candidate beats the rule by ${h.toFixed(3)} of the median cost at one decision`);
  });
} else if (import.meta.main) {
  const named = arg("--point");
  const points = named ? [named] : existsSync(join(ROOT, "data")) ? readdirSync(join(ROOT, "data")).filter((d) => existsSync(join(ROOT, "data", d, "manifest.json"))).sort() : [];
  const notes = process.argv.flatMap((a, i) => (a === "--note" ? [process.argv[i + 1]!] : []));
  const board: Scoreboard = { made: new Date().toISOString(), revision: revision(), ...(notes.length ? { notes } : {}), points: [] };
  for (const point of points) {
    status({ step: "score", point, done: 0, of: 1 });
    const reading = READINGS.indexOf((arg("--reading") ?? "end") as (typeof READINGS)[number]);
    const held = arg("--held-families") ? { families: arg("--held-families")!.split(",") as Family[], first: Number(arg("--held-first") ?? 1) } : undefined;
    board.points.push(...(await scorePoint(point, { layouts: Number(arg("--layouts") ?? 40), workers: Number(arg("--workers") ?? 8), reading: reading < 0 ? undefined : reading, fresh: Number(arg("--fresh") ?? 0), held })));
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
