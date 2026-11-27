// The scoreboard's arithmetic and its page: regret, log loss, Brier, calibration in bands, intervals by bootstrap over
// scenes, and the gate a trained scorer must pass to decide in a game. Imports only the engine's types, so the pipeline
// can leave with it.

import type { EpisodeScore, PointScores, Reliability, Score, Scoreboard } from "../../shared/decide/scoreboard.ts";
import { Rng } from "../../shared/rng.ts";

/** One decision as one entry answered it. For a "yes" point regret is its log loss, and the rule's is the rule's. */
export interface Graded {
  group: string;
  family: string;
  map: string;
  /** Cost above the best candidate's, in ticks. */
  regret: number;
  ruleRegret: number;
  /** The best candidate is not the rule's pick (for a yes: the two say opposite things). */
  disagree: boolean;
  logLoss: number;
  brier: number;
  /** The probability given to its pick, and how often that pick was best (for a yes: the probability and the outcome). */
  said: number;
  happened: number;
}

/** What a trained scorer must reach on held-out scenes (planning: the decider's gates). */
export const GATE = {
  regretRatio: 0.75,
  intervalTop: 0.9,
  worstFamily: 1.1,
  ece: 0.05,
  /** The state hidden must cost at least this share of its gain in log loss over uniform. */
  blindState: 0.1,
  decisions: 2000,
  scenes: 200,
  /** One answer's 99th percentile on a fast core, in microseconds, and the weights file's size. */
  micros: 25,
  bytes: 64 * 1024,
} as const;

const BANDS = 10;
/** The game's tick rate (shared/coords.ts), written here so the board imports nothing of the game. */
const TICKS_A_SECOND = 30;

/** Expected calibration error over `bands` equal bands of probability, and the bands. */
export function eceOf(said: readonly number[], happened: readonly number[], bands = BANDS): { ece: number; reliability: Reliability[] } {
  const n = new Float64Array(bands), s = new Float64Array(bands), h = new Float64Array(bands);
  for (let i = 0; i < said.length; i++) {
    const p = said[i]!;
    if (Number.isNaN(p)) continue;
    const b = Math.min(bands - 1, Math.max(0, Math.floor(p * bands)));
    n[b]!++;
    s[b] = s[b]! + p;
    h[b] = h[b]! + happened[i]!;
  }
  const total = n.reduce((a, v) => a + v, 0);
  let ece = 0;
  const reliability: Reliability[] = [];
  for (let b = 0; b < bands; b++) {
    if (n[b] === 0) continue;
    const said = s[b]! / n[b]!, happened = h[b]! / n[b]!;
    ece += (n[b]! / total) * Math.abs(said - happened);
    reliability.push({ said, happened, answers: n[b]! });
  }
  return { ece: total > 0 ? ece : NaN, reliability };
}

/** Σ a over Σ b, with 0 over 0 as 1: an entry no worse than a perfect rule matches it. */
export function ratio(a: number, b: number): number {
  if (b > 0) return a / b;
  return a > 0 ? Infinity : 1;
}

const sum = (g: readonly Graded[], f: (x: Graded) => number): number => g.reduce((s, x) => s + f(x), 0);

/** The share of the rule's regret, and its 95% interval from `rounds` resamples of whole scenes. */
export function regretInterval(g: readonly Graded[], rounds = 1000, seed = 1): [number, number] {
  const groups = new Map<string, [number, number]>();
  for (const x of g) {
    const v = groups.get(x.group) ?? [0, 0];
    v[0] += x.regret;
    v[1] += x.ruleRegret;
    groups.set(x.group, v);
  }
  const list = [...groups.values()];
  if (list.length === 0) return [NaN, NaN];
  const rng = new Rng(seed), out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    let a = 0, b = 0;
    for (let i = 0; i < list.length; i++) {
      const v = list[rng.int(list.length)]!;
      a += v[0];
      b += v[1];
    }
    out.push(ratio(a, b));
  }
  out.sort((x, y) => x - y);
  return [out[Math.floor(rounds * 0.025)]!, out[Math.min(rounds - 1, Math.floor(rounds * 0.975))]!];
}

/** A Score from graded decisions. The ablations, timings, size and gate are filled by whoever knows them. */
export function summarize(name: string, kind: Score["kind"], g: readonly Graded[], o: { seed?: number } = {}): Score {
  const regret = sum(g, (x) => x.regret), rule = sum(g, (x) => x.ruleRegret);
  const families = new Map<string, Graded[]>();
  for (const x of g) {
    const key = x.map === "flat" || x.map === "" ? x.family : `${x.map}/${x.family}`;
    families.set(key, [...(families.get(key) ?? []), x]);
  }
  let worst = -Infinity;
  for (const f of families.values()) worst = Math.max(worst, ratio(sum(f, (x) => x.regret), sum(f, (x) => x.ruleRegret)));
  const apart = g.filter((x) => x.disagree);
  const { ece, reliability } = eceOf(g.map((x) => x.said), g.map((x) => x.happened));
  const n = g.length || NaN;
  return {
    name, kind, decisions: g.length, scenes: new Set(g.map((x) => x.group)).size,
    regret: regret / n, regretRatio: ratio(regret, rule), interval: regretInterval(g, 1000, o.seed ?? 1),
    worstFamily: g.length ? worst : NaN, disagreeRatio: ratio(sum(apart, (x) => x.regret), sum(apart, (x) => x.ruleRegret)),
    logLoss: sum(g, (x) => x.logLoss) / n, brier: sum(g, (x) => x.brier) / n, ece, reliability,
    blind: { state: NaN, columns: NaN, shuffled: NaN }, microsFast: NaN, microsSlow: NaN, medianFast: NaN, medianSlow: NaN, bytes: 0,
    gate: { pass: false, why: [] },
  };
}

/** The rule may decide where it loses no whole episodes to today's code. */
export function ruleGate(rule?: EpisodeScore, today?: EpisodeScore): { pass: boolean; why: string[] } {
  if (!rule || !today) return { pass: true, why: [] };
  const why = rule.arrived < today.arrived ? [`whole episodes: the rule arrives in ${rule.arrived} of ${rule.scenes}, today's code in ${today.arrived}`] : [];
  return { pass: why.length === 0, why };
}

/** The 95% interval of the mean of `diff`, from `rounds` resamples. */
export function meanInterval(diff: readonly number[], rounds = 1000, seed = 1): [number, number] {
  if (diff.length === 0) return [NaN, NaN];
  const rng = new Rng(seed), out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    let a = 0;
    for (let i = 0; i < diff.length; i++) a += diff[rng.int(diff.length)]!;
    out.push(a / diff.length);
  }
  out.sort((x, y) => x - y);
  return [out[Math.floor(rounds * 0.025)]!, out[Math.min(rounds - 1, Math.floor(rounds * 0.975))]!];
}

/** Layouts both played, by family and seed: the rule's arrivals the scorer lost and those it gained, and its cost less the rule's on each. */
export function against(mine: EpisodeScore, rule: EpisodeScore): { lost: number; gained: number; diff: number[] } {
  const by = new Map((rule.layouts ?? []).map((l) => [`${l.family}/${l.seed}`, l]));
  let lost = 0, gained = 0;
  const diff: number[] = [];
  for (const l of mine.layouts ?? []) {
    const r = by.get(`${l.family}/${l.seed}`);
    if (!r || Number.isNaN(l.route) || l.route === null) continue;
    if (r.arrived && !l.arrived) lost++;
    if (l.arrived && !r.arrived) gained++;
    if (l.cost !== undefined && r.cost !== undefined && Number.isFinite(l.cost) && Number.isFinite(r.cost)) diff.push(l.cost - r.cost);
  }
  return { lost, gained, diff };
}

/** Why whole episodes on the held-out layouts fail a scorer against the rule: fewer arrivals overall or in a family, more lost than gained, or no clear saving in cost. */
export function episodeWhy(mine: EpisodeScore, rule: EpisodeScore, seed = 1): string[] {
  const why: string[] = [], f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  if (mine.arrived < rule.arrived) why.push(`whole episodes: it arrives in ${mine.arrived} of ${mine.scenes}, the rule in ${rule.arrived}`);
  for (const [family, r] of Object.entries(rule.families ?? {})) {
    const m = mine.families?.[family];
    if (m && m.arrived < r.arrived) why.push(`whole episodes: in ${family} it arrives in ${m.arrived} of ${m.scenes}, the rule in ${r.arrived}`);
  }
  const { lost, gained, diff } = against(mine, rule);
  if (lost > gained) why.push(`whole episodes: it loses ${lost} of the rule's arrivals and gains ${gained}`);
  const [, top] = meanInterval(diff, 1000, seed);
  if (!(mine.cost < rule.cost)) why.push(`whole episodes: its mean cost ${f(mine.cost)} is not under the rule's ${f(rule.cost)}`);
  else if (!(top < 0)) why.push(`whole episodes: the interval of its cost less the rule's reaches ${f(top)}, not under 0`);
  return why;
}

/** The gate's verdict on a trained scorer, with every reason it fails. ECE counts only where `calibrated`: a point whose probability is read. */
export function gateOf(s: Score, o: { hasState: boolean; calibrated?: boolean; mine?: EpisodeScore; rule?: EpisodeScore; today?: EpisodeScore; seed?: number }): { pass: boolean; why: string[] } {
  const why: string[] = [];
  const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
  if (s.decisions < GATE.decisions || s.scenes < GATE.scenes) {
    why.push(`not measurable: ${s.decisions} decisions from ${s.scenes} scenes held out, and ${GATE.decisions} from ${GATE.scenes} are needed`);
  }
  if (!(s.regretRatio <= GATE.regretRatio)) why.push(`regret is ${f(s.regretRatio)} of the rule's, above ${GATE.regretRatio}`);
  if (!(s.interval[1] < GATE.intervalTop)) why.push(`the interval's top is ${f(s.interval[1])}, not under ${GATE.intervalTop}`);
  if (!(s.worstFamily <= GATE.worstFamily)) why.push(`its worst held-out family is ${f(s.worstFamily)} of the rule's, above ${GATE.worstFamily}`);
  if (o.calibrated !== false && !(s.ece <= GATE.ece)) why.push(`ECE is ${f(s.ece)}, above ${GATE.ece}`);
  if (o.hasState && !(s.blind.state >= GATE.blindState)) why.push(`hiding the state costs only ${f(s.blind.state)} of its gain over uniform, under ${GATE.blindState}: it does not read the state`);
  if (Number.isFinite(s.microsFast) && s.microsFast > GATE.micros) why.push(`one answer takes ${f(s.microsFast, 1)} µs at the 99th percentile, above ${GATE.micros}`);
  if (s.bytes > GATE.bytes) why.push(`its weights are ${s.bytes} bytes, above ${GATE.bytes}`);
  if (o.mine && o.rule) {
    why.push(...episodeWhy(o.mine, o.rule, o.seed));
    if (o.today && o.mine.arrived < o.today.arrived) why.push(`whole episodes: it arrives in ${o.mine.arrived} of ${o.mine.scenes}, today's code in ${o.today.arrived}`);
  } else why.push("no whole episodes were played");
  return { pass: why.length === 0, why };
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (v: number, d = 3): string => (v === undefined || Number.isNaN(v) ? "–" : Number.isFinite(v) ? v.toFixed(d) : v > 0 ? "∞" : "−∞");

/** A reliability chart: each band's probability against how often it came true, the diagonal perfect. */
function chart(r: readonly Reliability[]): string {
  const S = 120, pad = 14, at = (v: number) => pad + v * S, up = (v: number) => pad + S - v * S;
  const most = Math.max(1, ...r.map((b) => b.answers));
  const dots = r.map((b) => `<circle cx="${at(b.said).toFixed(1)}" cy="${up(b.happened).toFixed(1)}" r="${(2 + 4 * Math.sqrt(b.answers / most)).toFixed(1)}" class="dot"><title>said ${num(b.said, 2)}, happened ${num(b.happened, 2)}, ${b.answers} answers</title></circle>`).join("");
  const line = r.length > 1 ? `<polyline points="${r.map((b) => `${at(b.said).toFixed(1)},${up(b.happened).toFixed(1)}`).join(" ")}" class="trace"/>` : "";
  return `<svg viewBox="0 0 ${S + 2 * pad} ${S + 2 * pad}" width="148" height="148" role="img" aria-label="reliability"><rect x="${pad}" y="${pad}" width="${S}" height="${S}" class="frame"/><line x1="${at(0)}" y1="${up(0)}" x2="${at(1)}" y2="${up(1)}" class="diag"/>${line}${dots}<text x="${pad}" y="${S + 2 * pad - 2}" class="axis">said →</text><text x="2" y="${pad - 4}" class="axis">came true ↑</text></svg>`;
}

function episodes(list: readonly EpisodeScore[]): string {
  if (list.length === 0) return `<p class="muted">No whole episodes were played.</p>`;
  const families = [...new Set(list.flatMap((e) => Object.keys(e.families ?? {})))].sort();
  const share = (e: EpisodeScore, f: string) => {
    const v = e.families?.[f];
    return v ? `${Math.round((100 * v.arrived) / v.scenes)}%<br><span class="muted">of ${v.scenes}</span>` : "–";
  };
  const rows = list.map((e) => `<tr><th>${esc(e.name)}</th><td>${e.arrived} of ${e.scenes}</td><td>${num(e.ticks, 0)}</td><td>${num(e.healthLost, 3)}</td><td>${num(e.stuckTicks, 0)}</td><td>${num(e.searches, 1)} / ${num(e.cells, 0)}</td><td>${num(e.cost, 0)}</td><td>${num(e.decideMicros, 1)}</td>${families.map((f) => `<td>${share(e, f)}</td>`).join("")}</tr>`).join("");
  return `<div class="wide"><table><thead><tr><th>policy</th><th>arrived</th><th>ticks</th><th>health lost</th><th>stuck ticks</th><th>searches / cells</th><th>cost</th><th>decide p99 µs</th>${families.map((f) => `<th>${esc(f)} arrived</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** One row a layout: its way, and under each policy whether it arrived (in seconds), and the decider's answers acted on. */
function layouts(list: readonly EpisodeScore[]): string {
  const first = list[0]?.layouts;
  if (!first?.length) return "";
  const rows = first.map((l, i) => {
    const cells = list.map((e) => {
      const x = e.layouts?.[i];
      if (!x || Number.isNaN(x.route) || x.route === null) return `<td class="muted">not played</td>`;
      return `<td class="${x.arrived ? "pass" : "fail"}">${x.arrived ? `${num(x.ticks / TICKS_A_SECOND, 0)} s` : "no"}<br><span class="muted">${x.acted} acted${x.healthLost > 0 ? `, −${num(x.healthLost, 2)}` : ""}</span></td>`;
    }).join("");
    return `<tr><th>${esc(l.family)} ${l.seed}</th><td>${l.route === null || Number.isNaN(l.route) ? "none" : `${num(l.route, 0)} m`}</td>${cells}</tr>`;
  }).join("");
  return `<details><summary>Each layout</summary><div class="wide"><table><thead><tr><th>layout</th><th>way</th>${list.map((e) => `<th>${esc(e.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function scores(list: readonly Score[]): string {
  const rows = list.map((s) => `<tr><th>${esc(s.name)}<br><span class="muted">${s.kind}</span></th><td>${num(s.regret, 1)}</td><td>${num(s.regretRatio)}<br><span class="muted">${num(s.interval[0], 2)} to ${num(s.interval[1], 2)}</span></td><td>${num(s.worstFamily)}</td><td>${num(s.disagreeRatio)}</td><td>${num(s.logLoss)}</td><td>${num(s.brier)}</td><td>${num(s.ece)}</td><td>${num(s.blind.state, 2)} / ${num(s.blind.columns, 2)} / ${num(s.blind.shuffled, 2)}</td><td>${num(s.medianFast, 2)} / ${num(s.microsFast, 2)}<br><span class="muted">${num(s.medianSlow, 2)} / ${num(s.microsSlow, 2)}</span></td><td>${s.bytes || "–"}</td><td class="${s.gate.pass ? "pass" : "fail"}">${s.gate.pass ? "passes" : "fails"}</td></tr>`).join("");
  return `<div class="wide"><table><thead><tr><th>entry</th><th>regret, ticks</th><th>of the rule's</th><th>worst family</th><th>where they disagree</th><th>log loss</th><th>Brier</th><th>ECE</th><th>blind: state / columns / shuffled</th><th>µs, median / p99: fast core<br>slow core</th><th>bytes</th><th>gate</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function point(p: PointScores): string {
  const trained = p.scores.filter((s) => s.kind !== "baseline");
  const verdicts = trained.map((s) => `<li><b>${esc(s.name)}</b>: ${s.gate.pass ? "passes the gate" : `fails: ${s.gate.why.map(esc).join("; ")}`}</li>`).join("");
  const charts = p.scores.filter((s) => s.reliability.length > 0).map((s) => `<figure>${chart(s.reliability)}<figcaption>${esc(s.name)}, ECE ${num(s.ece)}</figcaption></figure>`).join("");
  const fresh = p.fresh?.length ? `<h3>Whole episodes on fresh scenes of every family</h3><p class="muted">Seeds no dataset holds; the families trained on are here too, so this is a look at the scenes, not the gate.</p>${episodes(p.fresh)}` : "";
  return `<section><h2>${esc(p.point)} <span class="muted">${esc(p.profile)}</span></h2>${p.agreement ? `<p>Stored decisions made again from their passes with <code>combine</code>: <b>${p.agreement.agreed} of ${p.agreement.checked}</b> give the pick stored (${p.agreement.ruleAgreed} of ${p.agreement.ruleChecked} under the rule).</p>` : ""}<p>Headroom: at one decision, the best candidate beats the rule by <b>${num(p.headroom)}</b> of the median cost. It is information, not a bar: gains compound over an episode.</p><h3>Whole episodes on held-out layouts</h3><p class="muted">The same seeds of each held-out family and map, fixed before anything was played.</p>${episodes(p.episodes)}${layouts(p.episodes)}${fresh}<h3>Single decisions, held out</h3>${scores(p.scores)}${verdicts ? `<ul>${verdicts}</ul>` : ""}<h3>Reliability</h3><div class="charts">${charts || `<p class="muted">Nothing to chart.</p>`}</div></section>`;
}

/** The board as one page with nothing outside it: no scripts, fonts or pictures fetched. */
export function boardHtml(b: Scoreboard): string {
  const style = `:root{--bg:#fbfbf9;--fg:#1d1d1b;--muted:#6b6b66;--line:#d8d8d2;--accent:#2f6f9f;--pass:#2e7d32;--fail:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecece8;--muted:#a0a09a;--line:#3a3a37;--accent:#7fb2dc;--pass:#81c784;--fail:#ef9a9a}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:16px}
h1{font-size:1.4rem}h2{font-size:1.15rem;border-top:1px solid var(--line);padding-top:1rem}h3{font-size:1rem;margin-bottom:.3rem}
.muted{color:var(--muted);font-weight:normal;font-size:.85em}.wide{overflow-x:auto}table{border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right;vertical-align:top;white-space:nowrap}th:first-child{text-align:left}
.note{border-left:3px solid var(--fail);padding-left:8px}.pass{color:var(--pass)}.fail{color:var(--fail)}.charts{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0}figcaption{font-size:.8rem;color:var(--muted)}
svg .frame{fill:none;stroke:var(--line)}svg .diag{stroke:var(--muted);stroke-dasharray:3 3}svg .trace{fill:none;stroke:var(--accent)}svg .dot{fill:var(--accent);opacity:.8}svg .axis{fill:var(--muted);font-size:9px}`;
  const body = b.points.length ? b.points.map(point).join("") : `<p class="muted">No point has data yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decider scoreboard</title><style>${style}</style></head><body><h1>Decider scoreboard</h1><p class="muted">Made ${esc(b.made)} at ${esc(b.revision)}. Every number is on scenes held out of training. Regret is in ticks above the best candidate; intervals are by bootstrap over scenes.</p>${(b.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join("")}${body}</body></html>`;
}
