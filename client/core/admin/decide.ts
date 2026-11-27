// The Decider page's parts that are not its wiring (client/admin/decide.ts): the points and their policies, the scorers,
// the recent answers drawn as rings of headings, a map of where they were, and the lab's scoreboard, as HTML strings.

import { POLICY_NAMES, STAR, policyText, readPolicy, withPolicy, type AnsweredJson, type DecideJson, type ProfileJson } from "../../../shared/admin-decide.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import type { EpisodeScore, LabStatus, Reliability, Score, Scoreboard } from "../../../shared/decide/scoreboard.ts";
import { toPixel } from "../drops/place.ts";
import { bytesText, esc, msText } from "./format.ts";

export { policyText, readPolicy, withPolicy };

/** Colours of the rungs of trouble: calm, wary, stuck, a patient escape. */
export const RUNG_COLOURS = ["#3c7fb8", "#c9a227", "#d06a2c", "#a33127"] as const;
export const RUNG_NAMES = ["calm", "wary", "stuck", "escape"] as const;
/** The answers shown as rings or tables, newest first. */
const SHOWN = 12;
const COSTS = ["yes or no", "probes", "rings"];

// ---- Policies ------------------------------------------------------------------------------------------------------

/** Each point's row: its name, the policy DecidePolicy names for it ("" where `*` decides), and the policy it has. */
export function policyRows(s: Pick<DecideJson, "points" | "settings">): { name: string; own: string; now: string }[] {
  const table = readPolicy(s.settings.DecidePolicy);
  return [...s.points.map((p) => ({ name: p.name, own: table.get(p.name) ?? "", now: p.policy })), { name: STAR, own: table.get(STAR) ?? "", now: table.get(STAR) ?? "off" }];
}

function policySelect(point: string, own: string): string {
  const follow = point === STAR ? "off (nothing named)" : `as ${STAR}`;
  return `<select data-point="${esc(point)}" aria-label="Policy of ${esc(point)}"><option value=""${own === "" ? " selected" : ""}>${follow}</option>` +
    POLICY_NAMES.map((p) => `<option${p === own ? " selected" : ""}>${p}</option>`).join("") + "</select>";
}

/** The points' table: a policy to choose for each and for `*`, and what each was asked and did. */
export function pointsHtml(s: DecideJson): string {
  const rows = policyRows(s).map((r) => {
    const p = s.points.find((q) => q.name === r.name), c = p?.counts;
    const cells = c ? [c.put, c.answered, c.applied, c.cut, c.backCut, c.stale, c.fell, c.logged, c.closed].map((v) => `<td>${v.toLocaleString("en")}</td>`).join("") : '<td colspan="9" class="dim">every point not named</td>';
    return `<tr><td>${esc(r.name)}</td><td>${policySelect(r.name, r.own)}</td><td class="${r.now === "off" ? "dim" : ""}">${esc(r.now)}</td>${cells}</tr>`;
  }).join("");
  const head = ["Point", "Set to", "Has", "Put", "Answered", "Applied", "Cut", "Of them background", "Stale", "Fell to the rule", "Logged", "Closed"];
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** The caps, the queue, the log and the decide part's time, as tiles. */
export function tilesHtml(s: DecideJson): string {
  const each = s.part.ticks > 0 ? s.part.all / s.part.ticks : 0;
  const t: [string, string][] = [
    ...s.caps.map((cap, i): [string, string] => [`Cap on ${COSTS[i] ?? `cost ${i}`}`, `${cap} a tick`]),
    ["Most a tick held", `${s.most} near, ${s.backMost} background`], ["Cut for a full tick", s.overflow.toLocaleString("en")],
    ["Decide part, a tick", msText(each)], ["Its worst tick", msText(s.part.worst)],
    ["Log", s.log ? `${bytesText(s.log.bytes)}, ${s.log.written.toLocaleString("en")} lines${s.log.dropped ? `, ${s.log.dropped} dropped` : ""}` : "none on this world"],
    ["One answer logged in", s.settings.DecideSample > 0 ? String(s.settings.DecideSample) : "none logged"], ["Log a day at most", `${s.settings.DecideLogMegabytes} MB`],
  ];
  return t.map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
}

// ---- Scores --------------------------------------------------------------------------------------------------------

/** The lab's score in a weights file's `about`: the score itself, or under `score`. */
export function scoreOf(about: Record<string, unknown> | null | undefined): Score | null {
  const s = (about && typeof about.score === "object" ? about.score : about) as Partial<Score> | null | undefined;
  return s && typeof s === "object" && s.gate && typeof s.gate.pass === "boolean" ? (s as Score) : null;
}

/** The gate's verdict in words: "pass", or "fail: " and each reason. */
export function gateText(gate: Score["gate"] | null | undefined): string {
  if (!gate) return "not scored";
  if (gate.pass) return "pass";
  return gate.why.length > 0 ? `fail: ${gate.why.join("; ")}` : "fail";
}

/** A share of the rule's regret: "62% of the rule's". */
export function regretText(ratio: number): string {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}% of the rule's` : "–";
}

/** Expected calibration error to three places. */
export function eceText(ece: number): string {
  return Number.isFinite(ece) ? ece.toFixed(3) : "–";
}

/** Microseconds an answer takes on a fast core and a slow one. */
export function microsText(fast: number, slow: number): string {
  const one = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  return `${one(fast)} / ${one(slow)} µs`;
}

/** When a file's `about` says it was made, as a date, or "". */
export function madeText(about: Record<string, unknown> | null | undefined): string {
  const v = about?.made ?? about?.at ?? about?.date;
  return typeof v === "string" ? v.slice(0, 10) : "";
}

function gateCell(gate: Score["gate"] | null | undefined): string {
  return `<td class="${gate?.pass ? "well" : "bad"}">${esc(gateText(gate))}</td>`;
}

function ruleText(rule: ProfileJson["rule"]): string {
  if (!rule) return '<span class="dim">no line of weights</span>';
  const top = [...rule.weights].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  return esc(top.map(([n, w]) => `${n} ${w > 0 ? "+" : ""}${w}`).join(", ") + (rule.weights.length > top.length ? ", …" : ""));
}

/** Each profile: its hand rule, and its trained scorer with what the lab said of it. Then the files refused. */
export function scorersHtml(s: DecideJson): string {
  const rows = s.profiles.map((p) => {
    const t = p.trained, sc = scoreOf(t?.about);
    const trained = !t ? '<td colspan="7" class="dim">none loaded: the rule decides</td>'
      : !sc ? `<td>${t.hidden === 0 ? "a line" : `${t.hidden} hidden`}</td><td colspan="5" class="dim">its file says no score</td><td>${esc(madeText(t.about))}</td>`
      : `<td>${t.hidden === 0 ? "a line" : `${t.hidden} hidden`}</td><td>${regretText(sc.regretRatio)}</td><td>${eceText(sc.ece)}</td><td>${microsText(sc.microsFast, sc.microsSlow)}</td><td>${bytesText(sc.bytes)}</td>${gateCell(sc.gate)}<td>${esc(madeText(t.about))}</td>`;
    return `<tr><td>${esc(p.name)} <span class="dim">${p.ring ? "ring" : p.kind}</span></td><td class="dim">${ruleText(p.rule)}</td>${trained}</tr>`;
  }).join("");
  const head = ["Profile", "Hand rule", "Trained", "Regret", "ECE", "Latency", "Size", "Gate", "Made"];
  const refused = s.refused.length ? `<p class="bad">Refused: ${s.refused.map(esc).join("<br>")}</p>` : "";
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>${refused}`;
}

// ---- Rings ---------------------------------------------------------------------------------------------------------

/** Degrees clockwise from north where heading `i` of `k` begins and ends: heading 0 looks north. */
export function wedgeAngles(k: number, i: number): [number, number] {
  const step = 360 / k;
  return [(i - 0.5) * step, (i + 0.5) * step];
}

/** The point `r` from (cx, cy) at `deg` clockwise from north, on a picture whose y runs down. */
export function pointAt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.round((cx + r * Math.sin(a)) * 100) / 100, Math.round((cy - r * Math.cos(a)) * 100) / 100];
}

/** The SVG path of heading `i` of `k`: a wedge of the ring between radii `r0` and `r1`. */
export function wedgePath(k: number, i: number, cx: number, cy: number, r0: number, r1: number): string {
  const [a, b] = wedgeAngles(k, i), large = b - a > 180 ? 1 : 0;
  const [x0, y0] = pointAt(cx, cy, r1, a), [x1, y1] = pointAt(cx, cy, r1, b), [x2, y2] = pointAt(cx, cy, r0, b), [x3, y3] = pointAt(cx, cy, r0, a);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/**
 * One ring: `out` what each heading is shaded by (a chance, or a pass's share of the score above its least), `mask` 1
 * where a heading may not be taken, `pick` the heading chosen or -1, `says` what each heading's wedge tells on a hover.
 */
export interface Ring {
  label: string;
  out: readonly number[];
  mask: readonly number[];
  pick: number;
  says?: readonly string[];
}

const signed = (v: number): string => `${v >= 0 ? "+" : ""}${(Math.round(v * 100) / 100).toFixed(2)}`;
const percent = (p: number): string => `${Math.round(p * 100)}%`;

/** A pass as its share of the answer: each heading's score times what the pass counted for, shaded above the least. */
export function passRing(t: AnsweredJson["tables"][number], pick: number): Ring {
  const w = t.weight ?? 1, share = t.score.map((v) => v * w);
  const open = share.filter((_, i) => !t.mask[i]), least = open.length ? Math.min(...open) : 0;
  return {
    label: t.weight !== undefined ? `${t.profile} ×${Math.round(w * 100) / 100}` : t.profile, pick, mask: t.mask,
    out: share.map((v, i) => (t.mask[i] ? 0 : v - least)), says: share.map((v) => `adds ${signed(v)}`),
  };
}

/** The answer as the server made it: each heading's chance, from the final table it chose by. Null where it sent none. */
export function answerRing(a: AnsweredJson): Ring | null {
  const f = a.final;
  if (!f) return null;
  return { label: "answer", out: f.out, mask: f.mask, pick: a.pick, says: f.out.map((p, i) => `${percent(p)}, score ${signed((f.score[i] ?? 0) + (f.bias[i] ?? 0))}`) };
}

/** Why the heading chosen won: what each pass added to it, then the bonus for the heading held and any author's bias. */
export function whyText(a: AnsweredJson): string {
  const f = a.final, i = a.pick;
  if (!f || i < 0 || i >= f.k) return "";
  const parts = a.tables.filter((t) => t.weight !== undefined && t.k === f.k).map((t) => `${t.profile} ${signed((t.score[i] ?? 0) * t.weight!)}`);
  if (f.bias[i]) parts.push(`held and bias ${signed(f.bias[i]!)}`);
  return `heading ${i}: ${parts.join(", ")} = ${signed((f.score[i] ?? 0) + (f.bias[i] ?? 0))}, a ${percent(f.out[i] ?? 0)} chance`;
}

/** A ring as inline SVG: a wedge for each heading shaded by its probability, a masked one greyed, the pick outlined. */
export function ringSvg(ring: Ring, size = 96): string {
  const k = ring.out.length, c = size / 2, r1 = c - 3, r0 = c * 0.38, most = Math.max(1e-6, ...ring.out);
  const wedges = ring.out.map((p, i) => {
    const d = wedgePath(k, i, c, c, r0, r1), masked = ring.mask[i] !== 0;
    const fill = masked ? 'fill="#9aa7b4" fill-opacity="0.35"' : `fill="#1957a5" fill-opacity="${(0.06 + 0.94 * (p / most)).toFixed(2)}"`;
    return `<path d="${d}" ${fill} stroke="#ffffff" stroke-width="1"><title>heading ${i}: ${masked ? "masked" : esc(ring.says?.[i] ?? percent(p))}</title></path>`;
  }).join("");
  const pick = ring.pick >= 0 && ring.pick < k ? `<path d="${wedgePath(k, ring.pick, c, c, r0, r1)}" fill="none" stroke="#a33127" stroke-width="2.5"/>` : "";
  const [nx, ny] = pointAt(c, c, r0 - 6, 0);
  return `<figure class="ring"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(ring.label)}">${wedges}${pick}<text x="${nx}" y="${ny + 3}" font-size="9" text-anchor="middle" fill="#4e6277">N</text></svg><figcaption>${esc(ring.label)}</figcaption></figure>`;
}

function tableHtml(t: AnsweredJson["tables"][number], pick: number): string {
  if (t.k === 1) return `<p>${esc(t.profile)}: <b>${Math.round((t.out[0] ?? 0) * 100)}%</b> <span class="dim">score ${t.score[0] ?? 0}</span></p>`;
  const rows = Array.from({ length: t.k }, (_, i) => `<tr${i === pick ? ' class="warn"' : ""}><td>${i}${i === pick ? " ◂" : ""}</td><td>${t.score[i]}</td><td>${t.bias[i]}</td><td>${t.mask[i] ? "masked" : ""}</td><td>${Math.round((t.out[i] ?? 0) * 100)}%</td></tr>`).join("");
  return `<table class="candidates"><caption>${esc(t.profile)}</caption><thead><tr><th>Candidate</th><th>Score</th><th>Bias</th><th></th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The recent answers, newest first: rings where the profile is one, a table of candidates where not. */
export function recentHtml(s: DecideJson): string {
  if (s.recent.length === 0) return '<p class="dim">No answers in the last ten seconds: a point must be on, and a mover must ask.</p>';
  const ringed = new Set(s.profiles.filter((p) => p.ring).map((p) => p.name));
  return s.recent.slice(-SHOWN).reverse().map((a) => {
    const rings = a.tables.filter((t) => ringed.has(t.profile)), plain = a.tables.filter((t) => !ringed.has(t.profile));
    // A pass added into an answer is drawn as its share of it; one that is the answer is drawn by its own chances.
    const all = rings.map((t): Ring => (a.final ? passRing(t, a.pick) : { label: t.profile, out: t.out, mask: t.mask, pick: a.pick }));
    const made = answerRing(a);
    if (made) all.push(made);
    const why = whyText(a);
    const where = a.x !== undefined && a.z !== undefined ? ` at ${Math.round(a.x)}, ${Math.round(a.z)}` : "";
    const other = a.other !== undefined ? `, the other would take ${a.other}` : "";
    return `<div class="answer"><p><b>${esc(a.point)}</b> <span style="color:${RUNG_COLOURS[a.rung] ?? "#555"}">${RUNG_NAMES[a.rung] ?? a.rung}</span>${esc(where)} · tick ${a.t} · ${esc(a.policy)} took ${a.pick}${esc(other)}</p>` +
      `<div class="rings">${all.map((r) => ringSvg(r)).join("")}</div>${why ? `<p class="dim">${esc(why)}</p>` : ""}${plain.map((t) => tableHtml(t, a.pick)).join("")}</div>`;
  }).join("");
}

/** Where the recent answers were, north up as the other admin maps draw it, each dot by its rung. */
export function mapSvg(s: DecideJson, side = 320): string {
  const w = { sizeX: s.size.x, sizeZ: s.size.z };
  const dots = s.recent.filter((a) => a.x !== undefined && a.z !== undefined).map((a) => {
    const [x, y] = toPixel(w, a.x!, a.z!, side);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${RUNG_COLOURS[a.rung] ?? "#555"}"><title>${esc(a.point)}, ${RUNG_NAMES[a.rung] ?? a.rung}, tick ${a.t}</title></circle>`;
  }).join("");
  const key = RUNG_NAMES.map((n, i) => `<span><i style="background:${RUNG_COLOURS[i]}"></i>${n}</span>`).join(" ");
  return `<svg class="where" viewBox="0 0 ${side} ${side}" role="img" aria-label="Where the recent answers were"><rect width="${side}" height="${side}" fill="#18314a"/>${dots}</svg><p class="key">${key}</p>`;
}

// ---- The lab -------------------------------------------------------------------------------------------------------

/** A reliability chart: what was said against how often it happened, each band's dot by its answers, and the line they should keep to. */
export function reliabilitySvg(bands: readonly Reliability[], side = 72): string {
  const most = Math.max(1, ...bands.map((b) => b.answers));
  const dots = bands.map((b) => `<circle cx="${(b.said * side).toFixed(1)}" cy="${((1 - b.happened) * side).toFixed(1)}" r="${(1.5 + 2.5 * Math.sqrt(b.answers / most)).toFixed(1)}" fill="#1957a5"/>`).join("");
  return `<svg viewBox="0 0 ${side} ${side}" width="${side}" height="${side}" role="img" aria-label="Reliability"><rect width="${side}" height="${side}" fill="#eef3f8"/><line x1="0" y1="${side}" x2="${side}" y2="0" stroke="#9aa7b4"/>${dots}</svg>`;
}

/** What a lab run is doing, as a line. */
export function statusText(st: LabStatus | null): string {
  if (!st) return "No lab run has said what it is doing.";
  if (st.step === "idle") return `The lab is idle (said at ${st.at}).`;
  return `The lab is at ${st.step}${st.point ? ` for ${st.point}` : ""}: ${st.done.toLocaleString("en")} of ${st.of.toLocaleString("en")} (said at ${st.at}).`;
}

/** Whole episodes as a table: each policy's arrivals, seconds, ticks stuck, cost and the decide part's time. */
function episodesHtml(title: string, rows: readonly EpisodeScore[] | undefined): string {
  if (!rows || rows.length === 0) return "";
  const body = rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.arrived.toLocaleString("en")} of ${r.scenes.toLocaleString("en")}</td><td>${(r.ticks / TICK_RATE).toFixed(1)} s</td>` +
    `<td>${Math.round(r.stuckTicks).toLocaleString("en")}</td><td>${Math.round(r.cost).toLocaleString("en")}</td><td>${r.decideMicros < 10 ? r.decideMicros.toFixed(1) : Math.round(r.decideMicros)} µs</td></tr>`).join("");
  return `<div class="scroll"><table><caption>${esc(title)}</caption><thead><tr><th>Policy</th><th>Arrived</th><th>Mean time</th><th>Ticks stuck</th><th>Mean cost</th><th>Decide, 99th</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * The lab's scoreboard: its notes, then for each point the whole episodes on layouts held out (the headline), how many
 * stored answers `combine` made again, and each entry's single decisions and gate.
 */
export function labHtml(board: Scoreboard | null): string {
  if (!board) return '<p class="dim">This checkout has no scoreboard (.cache/decide/scoreboard.json): run the lab to make one.</p>';
  const head = ["Entry", "Decisions", "Regret", "Worst family", "Where the rule is wrong", "ECE", "Reliability", "Latency", "Size", "Gate"];
  const points = board.points.map((p) => {
    const rows = p.scores.map((sc) => `<tr><td>${esc(sc.name)} <span class="dim">${esc(sc.kind)}</span></td><td>${sc.decisions.toLocaleString("en")} in ${sc.scenes.toLocaleString("en")} scenes</td>` +
      `<td>${sc.regret.toFixed(2)} ticks, ${regretText(sc.regretRatio)}${sc.interval ? ` (${Math.round(sc.interval[0] * 100)} to ${Math.round(sc.interval[1] * 100)}%)` : ""}</td><td>${regretText(sc.worstFamily)}</td><td>${regretText(sc.disagreeRatio)}</td><td>${eceText(sc.ece)}</td>` +
      `<td>${reliabilitySvg(sc.reliability)}</td><td>${microsText(sc.microsFast, sc.microsSlow)}</td><td>${bytesText(sc.bytes)}</td>${gateCell(sc.gate)}</tr>`).join("");
    const a = p.agreement;
    const again = a ? `<p class="dim">Stored answers made again as the server makes them: ${a.agreed.toLocaleString("en")} of ${a.checked.toLocaleString("en")}.</p>` : "";
    const decisions = p.scores.length ? `<div class="scroll"><table><caption>Single decisions</caption><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : "";
    return `<h3>${esc(p.point)} <span class="dim">${esc(p.profile)}, headroom at one decision ${Math.round(p.headroom * 100)}% of the median cost</span></h3>` +
      `${episodesHtml("Whole episodes on layouts held out", p.episodes)}${episodesHtml("Fresh scenes of every family", p.fresh)}${again}${decisions}`;
  }).join("");
  const notes = board.notes?.length ? `<ul class="dim">${board.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  return `<p class="dim">Made ${esc(board.made)} at ${esc(board.revision)}.</p>${notes}${points}`;
}
