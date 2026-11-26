// The Admin log page's parts that need no browser (client/admin/acts.ts): holding the acts the world answers with, in
// order and once each, what the next question asks for, the filters, and each row's words and HTML.

import { openOnly, type Act, type ActKind, type ActVia } from "../../../shared/acts.ts";
import { ACTS_PAGE } from "../../../shared/admin-acts.ts";
import { RANK_NAMES } from "../../../shared/ranks.ts";
import { counted, esc } from "./format.ts";

/** The acts held and those an answer brought, oldest first, each sequence number once; a later copy replaces an earlier. */
export function mergeActs(held: readonly Act[], got: readonly Act[]): Act[] {
  const bySeq = new Map<number, Act>();
  for (const act of held) bySeq.set(act.seq, act);
  for (const act of got) bySeq.set(act.seq, act);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The `after` of the next question: the highest sequence number held, 0 for none. */
export function nextAfter(held: readonly Act[]): number {
  let after = 0;
  for (const act of held) after = Math.max(after, act.seq);
  return after;
}

/** The page's question: the acts after `after`, with the open commands too when its box is ticked. */
export const actsAsked = (after: number, open: boolean): string => `acts.json?after=${after}${open ? "&open=1" : ""}`;

/** Whether an answer of `count` acts may have left more behind it, so the page asks again at once. */
export const moreAfter = (count: number): boolean => count >= ACTS_PAGE;

export const KINDS: readonly ActKind[] = ["command", "sign-in", "change", "refused"];
export const KIND_WORDS: Record<ActKind, string> = { command: "Commands", "sign-in": "Sign-ins", change: "Permission changes", refused: "Refused attempts" };
const KIND_CHIPS: Record<ActKind, string> = { command: "", "sign-in": "sign-in", change: "permissions", refused: "refused" };
export const OPEN_TITLE = "Run with what everyone may do: creative mode for all, or an open group's permission. No password was given.";
export const VIA_WORDS: Record<ActVia, string> = { session: "In game", page: "On a page", operator: "At the terminal", module: "By a module" };

export interface ActFilter {
  /** Letters of the name or digits of the ID. */
  who: string;
  /** The lowest rank shown, -1 for any. */
  rank: number;
  /** Words that what was done holds, every one. */
  words: string;
  /** One kind, or "" for every kind. */
  kind: ActKind | "";
}

export const NO_FILTER: ActFilter = { who: "", rank: -1, words: "", kind: "" };

export function actMatches(act: Act, f: ActFilter): boolean {
  if (f.kind !== "" && act.kind !== f.kind) return false;
  if (f.rank >= 0 && act.rank < f.rank) return false;
  const who = f.who.trim().toLowerCase();
  if (who !== "" && !act.name.toLowerCase().includes(who) && !(act.id !== "" && act.id.includes(who))) return false;
  const what = act.what.toLowerCase();
  return f.words.toLowerCase().split(/\s+/).every((word) => what.includes(word));
}

/** The acts a filter shows, newest first. */
export function shownActs(held: readonly Act[], f: ActFilter): Act[] {
  return held.filter((act) => actMatches(act, f)).reverse();
}

/** A name in round brackets was typed beside a shared password, and names no survivor the server checked. */
export const typedName = (name: string): boolean => /^\(.*\)$/.test(name);
export const TYPED = "Typed with a shared password. Not a verified survivor.";

const two = (n: number): string => String(n).padStart(2, "0");

/** Wall-clock time in the viewer's own zone, to the second: "2026-11-25 09:04:05". */
export function whenText(at: number, tick: number): string {
  if (at <= 0) return `tick ${tick}`;
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export interface ActRow {
  seq: number;
  when: string;
  name: string;
  /** The name cell's title: why the name is not a survivor's, or "". */
  nameTitle: string;
  id: string;
  rank: string;
  how: string;
  /** What kind of act, where it is not a command. */
  kind: string;
  /** A command run with what everyone may do, shown only with the page's box ticked. */
  open: boolean;
  what: string;
  from: string;
}

/** An act in the words of its row. */
export function actRow(act: Act): ActRow {
  return {
    seq: act.seq,
    when: whenText(act.at, act.tick),
    name: act.name === "" ? "Not known" : act.name,
    nameTitle: typedName(act.name) ? TYPED : "",
    id: act.id,
    rank: RANK_NAMES[act.rank] ?? "not known",
    how: VIA_WORDS[act.via],
    kind: KIND_CHIPS[act.kind],
    open: openOnly(act),
    what: act.what,
    from: act.from,
  };
}

/** The table's rows as HTML, everything the server gave escaped. */
export function actsHtml(acts: readonly Act[]): string {
  return acts.map((act) => {
    const r = actRow(act);
    const title = r.nameTitle === "" ? "" : ` title="${esc(r.nameTitle)}" class="typed"`;
    const id = r.id === "" ? "" : `<span class="dim id">${esc(r.id)}</span>`;
    const kind = r.kind === "" ? "" : `<span class="chip">${esc(r.kind)}</span> `;
    const open = r.open ? `<span class="chip open" title="${esc(OPEN_TITLE)}">open</span> ` : "";
    return `<tr${r.open ? ` class="open"` : ""}><td class="when">${esc(r.when)}</td><td class="who"><span${title}>${esc(r.name)}</span>${id}</td><td>${esc(r.rank)}</td>` +
      `<td>${esc(r.how)}</td><td class="what">${open}${kind}${esc(r.what)}</td><td class="from">${esc(r.from)}</td></tr>`;
  }).join("");
}

/** How many acts the table shows of those held. */
export function countText(shown: number, all: number): string {
  if (all === 0) return "No acts yet";
  return shown === all ? counted(all, "act") : `${shown.toLocaleString("en")} of ${counted(all, "act")}`;
}
