// The admin page's first line: is the server well, in a word and one line, from the last seconds of the loop and the state
// of the save and the world. The worst thing wrong leads; the rest follow as reasons.

import type { Stats } from "../../../shared/admin.ts";
import { counted, msText, spanText } from "./format.ts";

export const WELL = 0;
export const STRAINED = 1;
export const FAILING = 2;

/** Seconds of the loop the verdict looks at. */
export const RECENT_SECONDS = 10;

export interface Verdict {
  level: number;
  word: string;
  line: string;
  reasons: string[];
}

/** The loop over its last RECENT_SECONDS whole seconds: ticks a second, the median second's median tick, the worst tick and start, ticks given up. */
export function recentLoop(s: Stats): { perSecond: number; typical: number; worst: number; late: number; dropped: number; seconds: number } {
  const c = s.ticks.seconds;
  const from = Math.max(0, c.at.length - RECENT_SECONDS);
  const n = c.at.length - from;
  if (n === 0) return { perSecond: 0, typical: 0, worst: 0, late: 0, dropped: 0, seconds: 0 };
  const p50 = c.p50.slice(from).sort((a, b) => a - b);
  const sum = (k: "ticks" | "dropped"): number => c[k].slice(from).reduce((a, b) => a + b, 0);
  return { perSecond: sum("ticks") / n, typical: p50[(n - 1) >> 1]!, worst: Math.max(...c.worst.slice(from)), late: Math.max(...c.late.slice(from)), dropped: sum("dropped"), seconds: n };
}

export function verdict(s: Stats): Verdict {
  const loop = recentLoop(s);
  const budget = s.ticks.budget;
  const found: [number, string][] = [];
  const f = s.save?.failing;
  if (f) found.push([FAILING, `the save has failed for ${spanText(f.seconds * 1000)} (${f.code}); what happens now is lost if it stops`]);
  if (loop.seconds > 0 && (loop.dropped > 0 || loop.perSecond < s.ticks.rate * 0.8)) found.push([FAILING, `falling behind: ${loop.perSecond.toFixed(1)} ticks a second of ${s.ticks.rate}${loop.dropped > 0 ? `, ${counted(loop.dropped, "tick")} given up` : ""}`]);
  else if (loop.late > budget * 2) found.push([STRAINED, `ticks start up to ${msText(loop.late)} late`]);
  if (loop.typical > budget * 0.5) found.push([STRAINED, `ticks take ${msText(loop.typical)} of their ${msText(budget)}`]);
  else if (loop.worst > budget * 2) found.push([STRAINED, `the slowest tick took ${msText(loop.worst)}, twice its ${msText(budget)} and more`]);
  const b = s.bodies;
  const room = b.max - b.reserve;
  if (b.count >= room * 0.9) found.push([STRAINED, `${b.count.toLocaleString("en")} bodies of the ${room.toLocaleString("en")} the world has room for`]);
  if (b.refused > 0) found.push([STRAINED, `${counted(b.refused, "body", "bodies")} refused for want of room since the start`]);
  if (loop.seconds === 0) found.push([STRAINED, "no tick has been timed yet"]);
  // Whose the long ticks were says whether the server or the machine it runs on is to be looked at.
  const { own, core, page } = s.ticks.long;
  if (found.length > 0 && own + core + page > 0) found.push([WELL, `of the ticks over ${msText(budget)} in the last two minutes, ${own} were the server's own work, ${core} waited for a core and ${page} for pages`]);
  found.sort((a, c) => c[0] - a[0]);
  const level = found[0]?.[0] ?? WELL;
  const word = level === FAILING ? (f ? "Not saving" : "Falling behind") : level === STRAINED ? "Strained" : "Healthy";
  const line = `ticks ${msText(loop.typical)} typical, ${msText(loop.worst)} at worst of ${msText(budget)} · ${loop.late <= budget ? "on time" : `${msText(loop.late)} late`} · ${counted(s.online.now, "survivor")} online`;
  return { level, word, line, reasons: found.map((x) => x[1]) };
}
