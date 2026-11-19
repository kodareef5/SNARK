// `bun tools/play.ts [file.jsonl ...]`: a development world's record of play (server/playlog.ts), told a session at a
// time. Without a file it reads the newest in var/play. For each session: the minutes played on foot and driving; the
// corrections a minute by what was behind them, with the largest of each; clock jumps, snapshots that came late and
// stretches not predicted, each with its cause; the long frames and what the page was doing in them; and, where the two
// ends disagreed, a table of the fields that differed and what the page held there. Then one line says which it is: the
// network, the page stalling, the server stalling, or the two ends disagreeing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { TICK_RATE } from "../shared/coords.ts";
import type { PlayCorrection, PlayFrame, PlayReport } from "../client/core/diagnostics.ts";

/** What the server wrote beside a report (server/playlog.ts `view`). */
export interface ServerView {
  ticks: number;
  snapshots: number;
  skipped: number;
  bytes: number;
  waiting: number;
  margin: [number, number] | null;
  lead: [number, number] | null;
  guessed: number;
  longest: number;
  /** Ticks it had no input for: the tick, ticks since its newest input, and how many ticks before the tick the input came (0 or less: after it ran), or null for not within ARRIVAL_TICKS. */
  guesses: [number, number, number | null][];
  late: number;
  long: number;
  given: number;
  /** Its ticks that ran late or long or followed ticks given up: the tick, ms late, ms long, and ticks given up just before. */
  loop: [number, number, number, number][];
}

export interface Line {
  at: string;
  slot: number;
  page: PlayReport;
  server: ServerView;
}

export const CAUSES = ["page", "line", "server", "unheld", "disagree"] as const;
export type Cause = (typeof CAUSES)[number];
const SAID: Record<Cause, string> = {
  page: "1 the page stalled",
  line: "2 the line held inputs back",
  server: "3 the server ran late",
  unheld: "4 not predicted (ground not held)",
  disagree: "5 the two ends disagree",
};
const VERDICT: Record<Cause, string> = { page: "the page stalls", line: "network", server: "the server stalls", unheld: "not predicted while the map's ground comes", disagree: "the two ends disagree" };

/** A server tick this many ms late was stalled: the snapshots of its catching up report margins far too high. */
const SERVER_LATE_MS = 50;
/**
 * Ticks before a guessed input that a stalled server tick is looked for in: the page's clock steers on the margins of the
 * last three seconds (client/core/session.ts), so those of a stall slow it for as long, and its inputs come late.
 */
const SERVER_BEFORE = 3 * TICK_RATE;
/** Ticks from a session's first in which its clock finds its margin: what is corrected then is told apart. */
export const JOIN_TICKS = 2 * TICK_RATE;
/** Ticks after a long frame within which a clock jump, or a snapshot that came late, is put down to it. */
const AFTER_FRAME = 2 * TICK_RATE;

export interface Session {
  name: string;
  joined: number;
  lines: Line[];
}

/** The lines grouped by session (a name and its welcome's tick), in the order each began. */
export function sessions(lines: readonly Line[]): Session[] {
  const by = new Map<string, Session>();
  for (const l of lines) {
    const key = `${l.page.name}@${l.page.joined}`;
    if (!by.has(key)) by.set(key, { name: l.page.name, joined: l.page.joined, lines: [] });
    by.get(key)!.lines.push(l);
  }
  for (const s of by.values()) s.lines.sort((a, b) => a.page.n - b.page.n);
  return [...by.values()];
}

export interface Judged {
  /** Each correction that was a misprediction (not a change of seat) after the session's first JOIN_TICKS, with its cause; and those before. */
  corrections: { c: PlayCorrection; cause: Cause }[];
  joining: PlayCorrection[];
  jumps: { t: number; by: number; behind: boolean; cause: Cause; after250: boolean }[];
  gaps: { t: number; ms: number; cause: Cause }[];
  frames: PlayFrame[];
}

/** Says what was behind each correction, clock jump and late snapshot of a session. */
export function judge(s: Session): Judged {
  const guessed = new Map<number, number>();
  const serverLate = new Set<number>();
  const pageLate = new Set<number>();
  const unheld: [number, number][] = [];
  const frames: PlayFrame[] = [];
  for (const { page, server } of s.lines) {
    for (const [t, since] of server.guesses) guessed.set(t, since);
    for (const [t, late, , given] of server.loop) if (late > SERVER_LATE_MS || given > 0) serverLate.add(t);
    for (const f of page.frameList) {
      frames.push(f);
      for (let t = f.t; t < f.t + f.n + f.skip; t++) pageLate.add(t);
    }
    unheld.push(...page.unheldList);
  }
  // A frame over 250 ms also slips the page's clock by the rest (client/core/session.ts takes at most 250 ms a frame), so
  // its inputs stay late after it, until the margin is back.
  for (const f of frames) for (let t = f.t; t <= Math.min(f.back, f.t + AFTER_FRAME); t++) pageLate.add(t);
  const any = (from: number, to: number, set: { has(t: number): boolean }): boolean => {
    for (let t = from; t <= to; t++) if (set.has(t)) return true;
    return false;
  };
  const corrections: Judged["corrections"] = [], joining: PlayCorrection[] = [];
  const settled = s.lines[0]!.page.from + JOIN_TICKS;
  for (const { page } of s.lines) {
    for (const c of page.corrections) {
      if (c.what === "seat") continue;
      if (c.t < settled) {
        joining.push(c);
        continue;
      }
      let cause: Cause;
      // The server's input at the tick compared from also counts: what goes down on the next tick is told from it.
      const guesses: number[] = [];
      for (let t = c.since; t <= c.t; t++) if (guessed.has(t)) guesses.push(t);
      if (c.resumed || unheld.some(([a, b]) => a <= c.t && b > c.since)) cause = "unheld";
      else if (guesses.some((g) => pageLate.has(g))) cause = "page";
      else if (guesses.some((g) => any(g - SERVER_BEFORE, g, serverLate))) cause = "server";
      else if (guesses.length > 0) cause = "line";
      else if (any(c.since + 1, c.t, pageLate)) cause = "page";
      else cause = "disagree";
      corrections.push({ c, cause });
    }
  }
  const before = (t: number, f: PlayFrame): boolean => f.t <= t && t - f.t <= AFTER_FRAME;
  const jumps: Judged["jumps"] = [];
  const gaps: Judged["gaps"] = [];
  for (const { page } of s.lines) {
    for (const j of page.jumpList) {
      if (j.t < settled) continue;
      // A page that stalls makes its inputs late, never early; a server that falls behind makes them early.
      const stalls = j.behind ? frames.filter((f) => before(j.t, f)) : [];
      const cause: Cause = stalls.length > 0 ? "page" : any(j.t - AFTER_FRAME, j.t, serverLate) ? "server" : "line";
      jumps.push({ ...j, cause, after250: stalls.some((f) => f.ms > 250) });
    }
    for (const g of page.gaps) {
      if (g.t < settled) continue;
      const cause: Cause = frames.some((f) => before(g.t, f)) ? "page" : any(g.t - g.ticks, g.t, serverLate) ? "server" : "line";
      gaps.push({ t: g.t, ms: g.ms, cause });
    }
  }
  return { corrections, joining, jumps, gaps, frames };
}

const f1 = (v: number): string => v.toFixed(1);
const place = (c: PlayCorrection): string => `${Math.round(c.x)}, ${Math.round(c.z)}`;

/** The text the tool prints for one session. */
export function describe(s: Session): string[] {
  const out: string[] = [];
  const say = (line: string): void => void out.push(line);
  const j = judge(s);
  const pages = s.lines.map((l) => l.page), servers = s.lines.map((l) => l.server);
  const sum = (of: (p: PlayReport) => number): number => pages.reduce((n, p) => n + of(p), 0);
  const kinds = new Map<string, number>();
  for (const p of pages) for (const [k, n] of Object.entries(p.kinds)) kinds.set(k, (kinds.get(k) ?? 0) + n);
  const ticks = sum((p) => p.ticks), minutes = ticks / TICK_RATE / 60;
  const per = (n: number): string => (minutes > 0 ? f1(n / minutes) : "-");
  const foot = (kinds.get("") ?? 0) / TICK_RATE / 60;
  const driven = [...kinds].filter(([k]) => k !== "").map(([k, n]) => `${f1(n / TICK_RATE / 60)} ${k}`);
  say(`session "${s.name}" joined at tick ${s.joined}, ${s.lines[0]!.at} to ${s.lines.at(-1)!.at}: ${f1(minutes)} minutes played, ${f1(foot)} on foot${driven.length ? `, driving ${driven.join(", ")}` : ", none driving"}`);
  // The server falling behind comes first: each time, every page's clock jumps.
  const behindAt = servers.flatMap((v) => v.loop.filter((x) => x[3] > 0));
  const given = behindAt.reduce((n, x) => n + x[3], 0);
  say(`  the server fell behind ${behindAt.length} time${behindAt.length === 1 ? "" : "s"} and gave up ${given} tick${given === 1 ? "" : "s"}${behindAt.length ? ` (at ticks ${behindAt.slice(0, 8).map((x) => x[0]).join(", ")}${behindAt.length > 8 ? ", ..." : ""})` : ""}; its longest tick ${Math.max(0, ...servers.map((v) => v.long))} ms, the latest ${Math.max(0, ...servers.map((v) => v.late))} ms late`);

  // The line, as both ends saw it.
  const margins = pages.map((p) => p.margin).filter((m) => m[0] <= m[1]);
  const leads = servers.map((v) => v.lead).filter((l): l is [number, number] => l !== null);
  const guessed = servers.reduce((n, v) => n + v.guessed, 0);
  const lateIn = servers.reduce((n, v) => n + v.guesses.filter(([, since, lead]) => since < 255 && lead !== null && lead <= 0).length, 0);
  say(`  the line: margins ${margins.length ? `${Math.min(...margins.map((m) => m[0]))} to ${Math.max(...margins.map((m) => m[1]))}` : "none"} ticks, inputs came ${leads.length ? `${Math.min(...leads.map((l) => l[0]))} to ${Math.max(...leads.map((l) => l[1]))}` : "-"} ticks ahead of their tick, round trip last ${pages.at(-1)!.rtt} ticks; the server went without ${guessed} inputs (${per(guessed)} a minute), ${lateIn} of them came after their tick, the longest stretch ${Math.max(0, ...servers.map((v) => v.longest))} ticks`);

  // Corrections by cause.
  const moved = sum((p) => p.moved), state = sum((p) => p.state), seats = sum((p) => p.seats);
  const kept = j.corrections.length + j.joining.length, counted = moved + state;
  say(`  corrections: ${moved} that moved the body and ${state} of other state alone (${per(counted)} a minute); ${seats} changes of seat, which nothing predicts${kept < counted ? `; ${counted - kept} beyond what the reports kept are not judged` : ""}`);
  if (j.joining.length > 0) say(`    ${j.joining.length} of them in its first ${JOIN_TICKS / TICK_RATE} s, while its clock found its margin, are not counted below`);
  say(`    ${"cause".padEnd(36)} ${"a minute".padStart(9)} ${"moved".padStart(6)} ${"state".padStart(6)}   largest`);
  for (const cause of CAUSES) {
    const of = j.corrections.filter((x) => x.cause === cause);
    const m = of.filter((x) => x.c.what === "moved");
    const big = of.reduce<PlayCorrection | null>((b, x) => (!b || x.c.d > b.d ? x.c : b), null);
    say(`    ${SAID[cause].padEnd(36)} ${per(of.length).padStart(9)} ${String(m.length).padStart(6)} ${String(of.length - m.length).padStart(6)}   ${big ? `${big.d.toFixed(3)} m at tick ${big.t}, ${place(big)}${big.kind ? `, ${big.kind}` : ""}` : "-"}`);
  }

  // Stretches drawn late.
  const unheld = sum((p) => p.unheld);
  const behind = j.jumps.filter((x) => x.behind).length;
  const jumpCauses = CAUSES.map((c) => [c, j.jumps.filter((x) => x.cause === c).length] as const).filter(([, n]) => n > 0);
  say(`  clock jumps: ${j.jumps.length} (${behind} with inputs late, ${j.jumps.length - behind} early${j.jumps.length ? `, the largest ${Math.max(...j.jumps.map((x) => Math.abs(x.by)))} ticks` : ""})${jumpCauses.length ? `: ${jumpCauses.map(([c, n]) => `${n} ${VERDICT[c]}`).join(", ")}` : ""}`);
  const gapCauses = CAUSES.map((c) => [c, j.gaps.filter((x) => x.cause === c).length] as const).filter(([, n]) => n > 0);
  say(`  snapshots that came 300 ms or more after the one before, while the page drew: ${j.gaps.length}${j.gaps.length ? `, the longest ${Math.max(...j.gaps.map((g) => g.ms))} ms` : ""}${gapCauses.length ? `: ${gapCauses.map(([c, n]) => `${n} ${VERDICT[c]}`).join(", ")}` : ""}`);
  say(`  not predicted (the ground within reach not held): ${f1(unheld / TICK_RATE)} s in ${pages.reduce((n, p) => n + p.unheldList.length, 0)} stretches`);

  // Long frames and what the page did in them.
  const over250 = j.frames.filter((f) => f.ms > 250);
  const costly = over250.filter((f) => j.jumps.some((x) => x.behind && x.t >= f.t && x.t - f.t <= AFTER_FRAME)).length;
  say(`  long frames: ${sum((p) => p.long)} of ${sum((p) => p.frames)} came 50 ms or more after the one before, ${sum((p) => p.over100)} over 100 ms, ${sum((p) => p.over250)} over 250 ms; the longest ${Math.max(0, ...pages.map((p) => p.worst))} ms; ${sum((p) => p.skipped)} ticks skipped`);
  if (over250.length > 0) say(`  the page stalled ${over250.length} times past 250 ms, ${costly === over250.length ? "each costing a clock jump" : `${costly} of them costing a clock jump`}`);
  const worst = [...j.frames].sort((a, b) => b.ms - a.ms).slice(0, 6);
  for (const f of worst) {
    const did = [f.ground ? `${f.ground} ground parts landed` : "", f.handed ? "statics handed over" : "", f.got ? `${Math.round(f.got / 1024)} KB of art came` : "", f.up + f.tex + f.buf ? `${f.up} levels, ${f.tex} textures and ${f.buf} buffers put on the card` : "", f.flying ? `${f.flying} requests under way` : ""].filter(Boolean);
    say(`    ${String(f.ms).padStart(5)} ms at tick ${f.t}: the page's own code ${f.own} ms of it${did.length ? `; ${did.join(", ")}` : ""}; ${f.n} ticks sampled late${f.skip ? `, ${f.skip} skipped` : ""}; the margin after ${f.after === 127 ? "not told" : f.after}${f.back ? `, on time again from tick ${f.back}` : ""}`);
  }

  // The server's side.
  const loop = servers.flatMap((v) => v.loop);
  const seconds = servers.reduce((n, v) => n + v.ticks, 0) / TICK_RATE;
  say(`  the server: its tick at most ${Math.max(0, ...servers.map((v) => v.long))} ms long and ${Math.max(0, ...servers.map((v) => v.late))} ms late, ${loop.length} ticks listed late or long, ${servers.reduce((n, v) => n + v.given, 0)} given up; it sent ${seconds > 0 ? Math.round(servers.reduce((n, v) => n + v.snapshots, 0) / seconds) : 0} snapshots and ${seconds > 0 ? Math.round(servers.reduce((n, v) => n + v.bytes, 0) / seconds / 1024) : 0} KB a second, skipped ${servers.reduce((n, v) => n + v.skipped, 0)}, at most ${Math.round(Math.max(0, ...servers.map((v) => v.waiting)) / 1024)} KB waiting behind the socket`);

  // Disagreements, field by field.
  const disagree = j.corrections.filter((x) => x.cause === "disagree").map((x) => x.c);
  if (disagree.length > 0) {
    const fields = new Map<string, { n: number; most: number }>();
    for (const c of disagree) {
      for (const [name, a, b] of c.fields) {
        const e = fields.get(name) ?? { n: 0, most: 0 };
        e.n++;
        if (typeof a === "number" && typeof b === "number") e.most = Math.max(e.most, Math.abs(a - b));
        fields.set(name, e);
      }
    }
    say(`  where the two ends disagreed: ${disagree.length} corrections, fields that differed:`);
    say(`    ${"field".padEnd(20)} ${"times".padStart(6)}   largest difference`);
    for (const [name, e] of [...fields].sort((a, b) => b[1].n - a[1].n)) say(`    ${name.padEnd(20)} ${String(e.n).padStart(6)}   ${e.most}`);
    for (const c of [...disagree].sort((a, b) => b.d - a.d).slice(0, 8)) {
      say(`    tick ${c.t} (from ${c.since}), ${c.kind || "on foot"} at ${place(c)}, ${c.d.toFixed(3)} m: the chunk ${c.whole ? "whole" : "not whole"} with ${c.rows} rows, statics ${c.statics ? "from the page's map" : "as sent"}; ${c.fields.map(([n, a, b]) => `${n} ${a} / ${b}`).join(", ")}`);
    }
  }

  // What else the page did, by the page's clock from the session's first report.
  const t0 = pages[0]!.t0;
  const notes = pages.flatMap((p) => p.notes);
  if (notes.length > 0) {
    say(`  what else the page did:`);
    for (const [tick, at, text] of notes.slice(0, 40)) say(`    ${f1((at - t0) / 1000).padStart(7)} s, tick ${tick}: ${text}`);
    if (notes.length > 40) say(`    and ${notes.length - 40} more`);
  }

  // The weight of the record itself.
  const bytes = s.lines.reduce((n, l) => n + JSON.stringify(l.page).length, 0), ms = sum((p) => p.ms);
  say(`  the record: ${s.lines.length} reports, ${Math.round(bytes / s.lines.length)} bytes each on average, ${ms > 0 ? Math.round(bytes / (ms / 1000)) : 0} bytes a second`);
  say(`  verdict: ${verdict(j, over250.length)}`);
  return out;
}

/** Which it is, in words a reader who knows nothing of the code can take. */
export function verdict(j: Judged, stalls: number): string {
  const weight = new Map<Cause, number>(CAUSES.map((c) => [c, 0]));
  for (const x of j.corrections) weight.set(x.cause, weight.get(x.cause)! + 1);
  for (const x of j.jumps) weight.set(x.cause, weight.get(x.cause)! + 1);
  for (const x of j.gaps) weight.set(x.cause, weight.get(x.cause)! + 1);
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return stalls > 0 ? `the page stalls, though nothing was corrected for it` : "nothing went wrong: the two ends agreed and the line kept up";
  const [top, n] = [...weight].sort((a, b) => b[1] - a[1])[0]!;
  const rest = [...weight].filter(([c, m]) => c !== top && m > 0).map(([c, m]) => `${m} ${VERDICT[c]}`);
  return `${VERDICT[top]} (${n} of ${total} corrections, clock jumps and late snapshots${rest.length ? `; the rest: ${rest.join(", ")}` : ""})`;
}

/** The lines of a file the server wrote. */
export function readLines(file: string): Line[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Line);
}

if (import.meta.main) {
  const named = process.argv.slice(2);
  const folder = resolve(import.meta.dir, "../var/play");
  const files = named.length > 0 ? named : !existsSync(folder) ? [] : readdirSync(folder).filter((f) => f.endsWith(".jsonl")).map((f) => join(folder, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).slice(-1);
  if (files.length === 0) throw new Error(`no record of play in ${folder}: a page on a world started with --dev writes one there`);
  for (const s of sessions(files.flatMap(readLines))) console.log(describe(s).join("\n") + "\n");
}
