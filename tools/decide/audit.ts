// Looks at the scenes before anything is trained on them: for each family, whether a whole-grid search finds a way at all
// (the oracle), how often today's code and the rule arrive and how long they take, and how often the ring is asked. A
// family the oracle cannot cross is impossible; one where today's code arrives and the ring is never asked teaches nothing.
//
//   bun tools/decide/audit.ts [--families trees,deadEnd,...] [--scenes 30] [--first 1] [--out <file>] [--against <file>]
//
// writes .cache/decide/audit.json (or --out) and prints a line a family; `--against` an earlier audit's file says, by family
// and by creature, which scenes each policy now arrives in that it did not, and which it no longer does.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TICK_RATE } from "../../shared/coords.ts";
import { FAMILIES } from "./catalog.ts";
import { scenes, type Family, type Scene } from "./random.ts";
import { LEAVE } from "../../server/decide/decide.ts";
import { K } from "../../server/decide/nav.ts";
import { build, play } from "./setups.ts";

export interface Seen {
  family: string;
  seed: number;
  kind: string;
  /** Metres of the oracle's way once the scene is placed (setups.ts), NaN where no try found one, and the straight line. */
  way: number;
  line: number;
  /** For today's code and the rule: ticks to arrive (-1 for never), ticks stuck or pinned, answers of nav.ring, and in a pair whether it went round. */
  off: { arrived: number; stuck: number; asked: number; round?: boolean; caught?: boolean; apart?: number };
  rule: { arrived: number; stuck: number; asked: number; round?: boolean; caught?: boolean; away?: number; apart?: number };
  /** The oracle at real pace: its seconds and which way it takes. */
  seconds?: number;
  choice?: "cross" | "round";
  /** In a pair, the oracle's seconds by each way (NaN for none found). */
  round?: number;
  cross?: number;
  pair?: { id: number; side: number; fact: string };
  intent?: string;
}

/** One scene seen by the oracle and played under today's code and the rule. */
export function see(s: Scene): Seen {
  const b = build(s), ents = b.lab.world.ents, way = b.way;
  const line = Math.hypot(b.goal.x - ents.x[b.mover]!, b.goal.z - ents.z[b.mover]!);
  b.lab.host.shutdown();
  const run = (policy: "off" | "rule") => {
    const w = build(s), ents = w.lab.world.ents, k = K;
    // In an escape, how squarely each heading the ring picks runs from the threat.
    let away = 0, picks = 0;
    const answered = (_n: number, _tick: number, pick: number) => {
      if (pick >= 0 && w.threat) {
        const dx = ents.x[w.mover]! - w.threat.x, dz = ents.z[w.mover]! - w.threat.z, d = Math.hypot(dx, dz) || 1, a = (pick / k) * 2 * Math.PI;
        away += (Math.sin(a) * dx + Math.cos(a) * dz) / d;
        picks++;
      }
      return LEAVE;
    };
    const t = play(w, { point: "nav.ring", policy, answered });
    const apart = w.threat ? Math.hypot(ents.x[w.mover]! - w.threat.x, ents.z[w.mover]! - w.threat.z) : NaN;
    w.lab.host.shutdown();
    return { arrived: t.arrivedAt, stuck: t.stuckTicks, asked: t.answers, ...(s.pair ? { round: t.round } : {}), ...(s.intent?.kind === "escape" ? { caught: w.caught, away: picks ? away / picks : NaN, apart } : {}) };
  };
  const seen: Seen = { family: s.family, seed: s.seed, kind: s.kind, way, line, off: run("off"), rule: run("rule") };
  if (b.oracle) Object.assign(seen, { seconds: b.oracle.seconds, choice: b.oracle.choice, ...(s.pair ? { round: b.oracle.round, cross: b.oracle.cross } : {}) });
  if (s.pair) seen.pair = { id: s.pair.id, side: s.pair.side, fact: s.pair.fact };
  if (s.intent) seen.intent = s.intent.kind;
  return seen;
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

/** How much slower the other way must be than the oracle's on each side of a pair kept. */
export const PAIR_MARGIN = 1.1;

/** Whether the oracle's way on a side beats the other by PAIR_MARGIN, or the other was not found. */
function clear(s: Seen): boolean {
  const mine = s.choice === "round" ? s.round : s.cross, other = s.choice === "round" ? s.cross : s.round;
  return mine === undefined || other === undefined || other === null || Number.isNaN(other) || other >= PAIR_MARGIN * mine;
}

/** A pair's two sides, kept only where both have a way and the oracle takes a different way on each, by a clear margin. */
export function pairsOf(all: readonly Seen[]): [Seen, Seen][] {
  const by = new Map<string, Seen[]>();
  for (const s of all) if (s.pair) by.set(`${s.family}/${s.pair.id}`, [...(by.get(`${s.family}/${s.pair.id}`) ?? []), s]);
  return [...by.values()].flatMap((v) => {
    const [a, b] = [v.find((s) => s.pair!.side === 0), v.find((s) => s.pair!.side === 1)];
    return a && b && !Number.isNaN(a.way) && !Number.isNaN(b.way) && a.choice !== b.choice && clear(a) && clear(b) ? [[a, b] as [Seen, Seen]] : [];
  });
}

/** Whether `policy` took the oracle's way on a side and arrived. */
export function rightSide(s: Seen, policy: "off" | "rule"): boolean {
  return s[policy].arrived >= 0 && (s[policy].round ? "round" : "cross") === s.choice;
}

/** Lines on the pairs of `all`: how many differ, and for each fact how often each policy is right on both sides. */
export function pairText(all: readonly Seen[]): string[] {
  const kept = pairsOf(all), out: string[] = [];
  const ids = new Set(all.filter((s) => s.pair).map((s) => `${s.family}/${s.pair!.id}`));
  out.push(`pairs: ${kept.length} of ${ids.size} have a way on both sides that differs by ${PAIR_MARGIN} at least`);
  for (const fact of [...new Set(kept.map(([a]) => a.pair!.fact))].sort()) {
    const of = kept.filter(([a]) => a.pair!.fact === fact);
    const both = (p: "off" | "rule") => of.filter(([a, b]) => rightSide(a, p) && rightSide(b, p)).length;
    const sides = (p: "off" | "rule") => of.reduce((n, [a, b]) => n + (rightSide(a, p) ? 1 : 0) + (rightSide(b, p) ? 1 : 0), 0);
    out.push(`  ${of[0]![0].family} ${fact}: the rule right on both sides in ${both("rule")} of ${of.length} (${sides("rule")} of ${2 * of.length} sides), today in ${both("off")} (${sides("off")} sides)`);
  }
  for (const [a, b] of kept) {
    const side = (s: Seen) => `${s.kind.replace("core:", "")} oracle ${s.choice} ${s.seconds?.toFixed(0)} s; today ${s.off.arrived >= 0 ? (s.off.round ? "round" : "cross") : "no"}, rule ${s.rule.arrived >= 0 ? (s.rule.round ? "round" : "cross") + " " + (s.rule.arrived / TICK_RATE).toFixed(0) + " s" : "no"}`;
    out.push(`  ${a.family} ${a.pair!.id} ${a.pair!.fact}: [${side(a)}] | [${side(b)}]`);
  }
  return out;
}

/** Lines on the intent families of `all`: for each family and intent, who arrives (bites, gets clear), how fast, and who was caught. */
export function intentText(all: readonly Seen[]): string[] {
  const out: string[] = [];
  for (const family of [...new Set(all.filter((s) => s.intent).map((s) => s.family))]) {
    for (const intent of ["walk", "chase", "escape"]) {
      const list = all.filter((s) => s.family === family && s.intent === intent && !Number.isNaN(s.way));
      if (!list.length) continue;
      const of = (p: "off" | "rule") => {
        const got = list.filter((s) => s[p].arrived >= 0), caught = list.filter((s) => s[p].caught).length;
        const mean = got.length ? (got.reduce((a, s) => a + s[p].arrived, 0) / got.length / TICK_RATE).toFixed(1) : "–";
        const apart = list.map((s) => s[p].apart ?? NaN).filter((v) => !Number.isNaN(v));
        return `${got.length} in ${mean} s${intent === "escape" ? `, caught ${caught}, ${(apart.reduce((a, v) => a + v, 0) / (apart.length || NaN)).toFixed(1)} m from the threat at the end` : ""}`;
      };
      const asked = list.filter((s) => s.rule.asked > 0).length;
      const aways = list.map((s) => s.rule.away ?? NaN).filter((v) => !Number.isNaN(v));
      const away = intent === "escape" && aways.length ? `; the ring's picks run from the threat by a cosine of ${(aways.reduce((a, v) => a + v, 0) / aways.length).toFixed(2)} on average` : "";
      out.push(`${family} ${intent}: ${list.length} played, ring asked in ${asked}; today ${of("off")}; the rule ${of("rule")}${away}`);
    }
  }
  return out;
}

/** Scenes played in both audits that `policy` now arrives in and did not (gained), and arrived in before and now does not (lost). */
export function against(was: readonly Seen[], now: readonly Seen[], policy: "off" | "rule"): { gained: Seen[]; lost: Seen[] } {
  const before = new Map(was.map((s) => [`${s.family}/${s.seed}`, s]));
  const gained: Seen[] = [], lost: Seen[] = [];
  for (const s of now) {
    const b = before.get(`${s.family}/${s.seed}`);
    if (!b || b.kind !== s.kind) continue;
    const a0 = !Number.isNaN(b.way) && b[policy].arrived >= 0, a1 = !Number.isNaN(s.way) && s[policy].arrived >= 0;
    if (a1 && !a0) gained.push(s);
    if (a0 && !a1) lost.push(s);
  }
  return { gained, lost };
}

/** Lines saying what `against` found: totals, then each scene gained or lost with its family, seed and creature. */
export function againstText(was: readonly Seen[], now: readonly Seen[]): string[] {
  const out: string[] = [];
  for (const p of ["rule", "off"] as const) {
    const { gained, lost } = against(was, now, p);
    const by = (list: Seen[], key: (s: Seen) => string) => [...new Set(list.map(key))].map((k) => `${k} ${list.filter((s) => key(s) === k).length}`).join(", ");
    out.push(`${p === "rule" ? "the rule" : "today"}: gained ${gained.length}, lost ${lost.length}`);
    if (gained.length) out.push(`  gained by family: ${by(gained, (s) => s.family)}; by creature: ${by(gained, (s) => s.kind)}`);
    if (lost.length) out.push(`  lost by family: ${by(lost, (s) => s.family)}; by creature: ${by(lost, (s) => s.kind)}`);
    for (const s of gained) out.push(`  + ${s.family} ${s.seed} ${s.kind}`);
    for (const s of lost) out.push(`  - ${s.family} ${s.seed} ${s.kind}`);
  }
  return out;
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
  writeFileSync(arg("--out") ?? ".cache/decide/audit.json", JSON.stringify(all, null, 1));
  if (all.some((s) => s.pair)) for (const line of pairText(all)) console.log(line);
  if (all.some((s) => s.intent)) for (const line of intentText(all)) console.log(line);
  const was = arg("--against");
  if (was) for (const line of againstText(JSON.parse(readFileSync(was, "utf8")) as Seen[], all)) console.log(line);
}
