// The Server tab's Decide section, an admin's: who decides each of the movers' small choices and what each point did
// since the last ask, the decide part's time, the caps, and what the decider knows of the mover the survivor faces or
// stands by. The server says it only while the Server tab shows (debug.ts poll), so it costs nothing otherwise.

import type { DecideState, ServerState } from "../../../shared/debug.ts";
import type { Draw } from "./draw.ts";
import { D_MONO, D_MONO_DIM, D_MONO_WARN } from "./styles.ts";
import { count, ms } from "./words.ts";

export const DECIDE_LINE = 17;

export interface DecideLine {
  text: string;
  /** 0 plain, 1 quieter, 2 a warning. */
  tone: number;
}

type Counted = "put" | "answered" | "cut" | "backPut" | "backCut";

/** What the section says of answer `s`, against the answer before it where that had the decider too. */
export function decideLines(s: ServerState, before: ServerState | null): DecideLine[] {
  const d = s.decide;
  if (!d) return [];
  const was = before?.decide ? before : null, since = was ? "since the last ask" : "since the start";
  const at = s.parts.names.indexOf("decide"), ticks = s.parts.ticks - (was ? was.parts.ticks : 0);
  const spent = at < 0 ? 0 : s.parts.all[at]! - (was ? (was.parts.all[at] ?? 0) : 0);
  const out: DecideLine[] = [
    { text: `${ms(ticks > 0 ? spent / ticks : 0)} a tick ${since}, worst ${ms(d.worst)} · caps ${d.caps.join(" / ")} · most ${d.most} near, ${d.backMost} background · ${count(d.overflow)} cut for a full tick`, tone: d.overflow > 0 ? 2 : 1 },
  ];
  if (d.points.length === 0) out.push({ text: "No decision points in this world.", tone: 1 });
  for (const p of d.points) {
    const q = was?.decide!.points.find((o) => o.name === p.name), less = (k: Counted) => p[k] - (q?.[k] ?? 0);
    const cut = less("cut"), backCut = less("backCut");
    const words = p.policy === "off" ? "off" : `${p.policy} · put ${count(less("put"))}, ${count(less("backPut"))} background · answered ${count(less("answered"))} · cut ${count(cut)}${backCut > 0 ? `, ${count(backCut)} background` : ""}`;
    out.push({ text: `${p.name} ${words}`, tone: p.policy === "off" ? 1 : cut > backCut ? 2 : 0 });
  }
  out.push({ text: moverText(d.mover), tone: d.mover ? 0 : 1 });
  return out;
}

/**
 * The section in three lines, for the drawer's foot: the time and the caps, every point in short ("answered/put", then
 * what the background put and what was cut where there was any), and the mover. Empty where the server said nothing.
 */
export function decideBrief(s: ServerState, before: ServerState | null): DecideLine[] {
  const full = decideLines(s, before), d = s.decide;
  if (!d || full.length === 0) return [];
  const was = before?.decide ? before.decide : null;
  let tone = 1;
  const points = d.points.map((p) => {
    if (p.policy === "off") return `${p.name} off`;
    const q = was?.points.find((o) => o.name === p.name), less = (k: Counted) => p[k] - (q?.[k] ?? 0);
    const cut = less("cut"), back = less("backPut");
    tone = cut > less("backCut") ? 2 : tone === 2 ? 2 : 0;
    return `${p.name} ${p.policy} ${count(less("answered"))}/${count(less("put"))}${back > 0 ? `, ${count(back)} background` : ""}${cut > 0 ? `, cut ${count(cut)}` : ""}`;
  });
  return [full[0]!, { text: points.length > 0 ? points.join(" · ") : "No decision points in this world.", tone }, full.at(-1)!];
}

/** The mover the survivor is by, as the decider describes it. */
export function moverText(m: DecideState["mover"]): string {
  if (!m) return "No mover near you that the decider can describe.";
  const about = Object.entries(m.about).map(([k, v]) => `${k} ${typeof v === "number" ? Math.round(v * 100) / 100 : JSON.stringify(v)}`).join(", ");
  return `mover ${m.e}, ${m.metres} m off: ${about}`;
}

/** Lays the lines out from `y`, as many as `rows` holds, and returns the room taken. */
export function layDecide(draw: Draw, lines: readonly DecideLine[], x: number, y: number, w: number, rows: number): number {
  let at = y;
  for (let i = 0; i < lines.length && i < rows; i++, at += DECIDE_LINE) {
    const l = lines[i]!;
    draw.text(x, at, w, l.tone === 2 ? D_MONO_WARN : l.tone === 1 ? D_MONO_DIM : D_MONO, l.text);
  }
  return at - y;
}
