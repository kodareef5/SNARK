// Generates and labels a point's decisions on the lab world, across worker processes kept alive so each loads the
// content once. A worker is retired and replaced after RETIRE_JOBS scenes or once it holds RETIRE_BYTES. Results are
// written in the order of the scenes, so one command gives the same bytes on any number of workers.
//
//   bun tools/decide/generate.ts --point lab.ring [--scenes 40] [--first 1] [--families trees,deadEnd,...]
//     [--workers 8] [--seeds 3] [--under <weights.json>[,<more.json>]] [--fresh]
//
// `--scenes` is per family, and the held-out family and the Miami slice are generated too, for the scoreboard. `--under`
// plays every other answer by trained scorers, so the decisions are from states they get into themselves. Progress goes
// to .cache/decide/status.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Model } from "../../shared/decide/forward.ts";
import { PROFILES } from "../../shared/decide/profiles.ts";
import type { LabStatus } from "../../shared/decide/scoreboard.ts";
import { readModel } from "../../shared/decide/weights.ts";
import { FAMILIES } from "./catalog.ts";
import { Writer, dataDir, pack, revision, unpack } from "./dataset.ts";
import { labelScene } from "./label.ts";
import { draw, scenes, type Family, type Scene } from "./random.ts";
import type { EpisodeResult } from "./rate.ts";
import { episode, gameReplayer, type Hooks } from "./setups.ts";

export const MOST_WORKERS = 20;
export const RETIRE_JOBS = 300;
export const RETIRE_BYTES = 2 * 1024 ** 3;

/** A job for a worker: label one scene's decision, or play one whole episode. */
export type Job =
  | { kind: "label"; scene: Scene; point: string; seeds: number; models: string[] }
  | { kind: "episode"; scene: Scene; point: string; policy: Hooks["policy"]; models: string[] };

export type Done =
  | { kind: "label"; yes: boolean; decision: string | null; runs: number; thrown: number; noReseed: number; seconds: number; rss: number }
  | { kind: "episode"; result: EpisodeResult; rss: number }
  | { kind: "error"; error: string; rss: number };

/** Trained scorers from their files, each checked against its profile. */
export function loadModels(files: readonly string[]): Model[] {
  return files.map((f) => {
    const file = JSON.parse(readFileSync(f, "utf8")) as { profile?: string };
    const p = PROFILES.find((q) => q.name === file.profile);
    const m = p ? readModel(file, p) : `made for ${String(file.profile)}, which is no profile here`;
    if (typeof m === "string") throw new Error(`${f}: ${m}`);
    return m;
  });
}

/** Runs one job where it is called: what a worker does with each message. */
export function work(job: Job): Done {
  const rss = () => process.memoryUsage().rss, from = performance.now();
  try {
    const models = loadModels(job.models);
    if (job.kind === "episode") return { kind: "episode", result: episode(job.scene, job.point, job.policy, models), rss: rss() };
    const under = { policy: models.length ? "model" as const : "rule" as const, models };
    const l = labelScene(gameReplayer(job.point, under), job.scene, { seed: job.scene.seed, family: job.scene.family, map: job.scene.map }, { kind: (a) => PROFILES.find((q) => q.name === a.tables[0]?.profile)?.kind ?? "choice", seeds: job.seeds, today: true });
    return { kind: "label", yes: l.kind === "yes", decision: l.decision ? pack(l.decision) : null, runs: l.runs, thrown: l.thrown, noReseed: l.noReseed, seconds: (performance.now() - from) / 1000, rss: rss() };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err), rss: rss() };
  }
}

interface Slot {
  proc: ReturnType<typeof Bun.spawn>;
  jobs: number;
  busy: number;
}

/** Worker processes, each running jobs one at a time; `run` hands out a list and gives the answers back in its order. */
export class Workers {
  readonly size: number;
  /** Workers started in all, and retired. */
  started = 0;
  retired = 0;
  private readonly waiting = new Map<Slot, (d: Done) => void>();

  constructor(size: number) {
    this.size = Math.max(1, Math.min(MOST_WORKERS, size));
  }

  private spawn(): Slot {
    const slot: Slot = { proc: null as unknown as Slot["proc"], jobs: 0, busy: 0 };
    slot.proc = Bun.spawn([process.execPath, join(import.meta.dir, "generate.ts"), "--worker"], {
      stdio: ["ignore", "ignore", "inherit"],
      ipc: (message) => {
        const done = this.waiting.get(slot);
        this.waiting.delete(slot);
        done?.(message as Done);
      },
      onExit: (_p, code) => {
        const done = this.waiting.get(slot);
        this.waiting.delete(slot);
        done?.({ kind: "error", error: `a worker stopped with code ${code}`, rss: 0 });
      },
    });
    this.started++;
    return slot;
  }

  private ask(slot: Slot, job: Job): Promise<Done> {
    return new Promise((resolve) => {
      this.waiting.set(slot, resolve);
      slot.proc.send(job);
    });
  }

  /** Every job's answer, in their order; `each` hears of each as it comes. */
  async run(jobs: readonly Job[], each?: (i: number, d: Done) => void): Promise<Done[]> {
    const out: Done[] = new Array(jobs.length);
    let next = 0;
    const lane = async (): Promise<void> => {
      let slot = this.spawn();
      while (next < jobs.length) {
        const i = next++;
        let d = await this.ask(slot, jobs[i]!);
        slot.jobs++;
        // A worker that died is replaced and its job tried once more.
        if (d.kind === "error" && d.rss === 0) {
          slot = this.spawn();
          d = await this.ask(slot, jobs[i]!);
          slot.jobs++;
        }
        out[i] = d;
        each?.(i, d);
        if (slot.jobs >= RETIRE_JOBS || d.rss > RETIRE_BYTES) {
          slot.proc.kill();
          this.retired++;
          slot = this.spawn();
        }
      }
      slot.proc.kill();
    };
    await Promise.all(Array.from({ length: Math.min(this.size, jobs.length) }, lane));
    return out;
  }
}

/** Writes what a lab run is doing, for whoever watches. */
export function status(s: Omit<LabStatus, "at">, file = ".cache/decide/status.json"): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...s, at: new Date().toISOString() } satisfies LabStatus));
}

export interface GenerateOptions {
  point: string;
  families: readonly Family[];
  scenes: number;
  first: number;
  workers: number;
  seeds: number;
  under: string[];
  fresh: boolean;
  root?: string;
}

/** Labels one decision of each scene and adds them to the point's dataset. */
export async function generate(o: GenerateOptions): Promise<{ decisions: number; none: number; thrown: number; noReseed: number; runs: number; busy: number; seconds: number; errors: string[] }> {
  const from = performance.now();
  const list = scenes(o.families, o.scenes, o.first);
  const jobs: Job[] = list.map((scene) => ({ kind: "label", scene, point: o.point, seeds: o.seeds, models: o.under }));
  const note = { made: new Date().toISOString(), revision: revision(), under: o.under.length ? o.under.join(",") : "rule" };
  // Made with the first decision, which says whether the point is a choice or a yes.
  let w: Writer | null = null;
  let scenesSeen = 0, none = 0;
  const pool = new Workers(o.workers);
  let done = 0, written = 0, runs = 0, last = 0, busy = 0;
  const kept = new Map<number, Done>(), errors: string[] = [];
  const flush = () => {
    for (let d = kept.get(written); d; d = kept.get(written)) {
      kept.delete(written++);
      scenesSeen++;
      if (d.kind === "error") errors.push(d.error);
      else if (d.kind === "label") {
        runs += d.runs;
        busy += d.seconds;
        if (d.decision) {
          w ??= new Writer(dataDir(o.point, join(o.root ?? ".cache/decide", "data")), o.point, d.yes ? "yes" : "choice", PROFILES, note, o.fresh);
          w.run.thrown += d.thrown;
          w.run.noReseed += d.noReseed;
          w.add(unpack(d.decision));
        } else none++;
      }
    }
  };
  status({ step: "generate", point: o.point, done: 0, of: jobs.length });
  await pool.run(jobs, (i, d) => {
    kept.set(i, d);
    done++;
    flush();
    if (performance.now() - last > 3000) {
      last = performance.now();
      w?.save();
      status({ step: "label", point: o.point, done, of: jobs.length });
    }
  });
  flush();
  const ww = w as Writer | null;
  if (ww) {
    ww.run.scenes = scenesSeen;
    ww.run.none = none;
    ww.save();
  }
  status({ step: "idle", point: o.point, done, of: jobs.length });
  return { decisions: ww?.run.decisions ?? 0, none, thrown: ww?.run.thrown ?? 0, noReseed: ww?.run.noReseed ?? 0, runs, busy, seconds: (performance.now() - from) / 1000, errors };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main && process.argv.includes("--worker")) {
  process.on("message", (job: Job) => process.send!(work(job)));
} else if (import.meta.main) {
  const point = arg("--point");
  if (!point) {
    console.error("usage: bun tools/decide/generate.ts --point <name> [--scenes 40] [--first 1] [--families a,b] [--workers 8] [--seeds 3] [--under weights.json] [--fresh]");
    process.exit(2);
  }
  const families = (arg("--families")?.split(",") ?? [...FAMILIES, "miami"]) as Family[];
  for (const f of families) draw(f, 1);
  const under = arg("--under")?.split(",") ?? [];
  for (const f of under) if (!existsSync(f)) throw new Error(`no weights file ${f}`);
  const r = await generate({ point, families, scenes: Number(arg("--scenes") ?? 40), first: Number(arg("--first") ?? 1), workers: Number(arg("--workers") ?? 8), seeds: Number(arg("--seeds") ?? 3), under, fresh: process.argv.includes("--fresh") });
  console.log(`${point}: ${r.decisions} decisions from ${r.runs} plays in ${r.seconds.toFixed(1)} s; ${r.none} scenes gave no answer, ${r.thrown} replays thrown away, ${r.noReseed} run with no reseed; a play took ${((1000 * r.busy) / Math.max(1, r.runs)).toFixed(0)} ms of a worker's time`);
  for (const e of r.errors.slice(0, 5)) console.error(e);
  if (r.errors.length) process.exit(1);
}
