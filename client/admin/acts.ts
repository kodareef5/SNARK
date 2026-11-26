// A world's Admin log page: who did what, and when, from <world>/admin/acts.json. What it shows is made in
// client/core/admin/acts.ts; this is the page's wiring. It holds every act it was given while the tab is open.

import { adminContext } from "./shell.ts";
import type { Act } from "../../shared/acts.ts";
import type { ActsAnswer } from "../../shared/admin-acts.ts";
import { RANK_NAMES, RANK_STAFF } from "../../shared/ranks.ts";
import { KINDS, KIND_WORDS, actsAsked, actsHtml, countText, mergeActs, moreAfter, nextAfter, shownActs, type ActFilter } from "../core/admin/acts.ts";
import { esc } from "../core/admin/format.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
let held: Act[] = [];
let drawn = "";
/** Counts each tick or untick of the box, so an answer to the question before it is let go. */
let asking = 0;

function say(text: string, kind = "dim"): void {
  $("msg").textContent = text;
  $("msg").className = kind;
}

function filter(): ActFilter {
  const kind = $<HTMLSelectElement>("kind").value;
  return {
    who: $<HTMLInputElement>("who").value,
    rank: Number($<HTMLSelectElement>("rank").value),
    words: $<HTMLInputElement>("words").value.trim(),
    kind: (KINDS as readonly string[]).includes(kind) ? (kind as ActFilter["kind"]) : "",
  };
}

function draw(): void {
  const shown = shownActs(held, filter());
  const html = actsHtml(shown);
  if (html !== drawn) $("acts").innerHTML = drawn = html;
  $("count").textContent = countText(shown.length, held.length);
}

async function pull(): Promise<void> {
  const ctx = await adminContext();
  for (;;) {
    const at = asking;
    const r = await fetch(ctx.api(actsAsked(nextAfter(held), $<HTMLInputElement>("open").checked)), { cache: "no-store" });
    if (!r.ok) throw Error(`The log answered ${r.status}.`);
    const { acts } = (await r.json()) as ActsAnswer;
    if (at !== asking) return;
    held = mergeActs(held, acts);
    draw();
    if (!moreAfter(acts.length)) return;
  }
}

/** Asks for what is new, and says why not where the world did not answer. */
async function ask(): Promise<void> {
  try {
    await pull();
    say("");
  } catch (e) {
    const why = e instanceof Error && e.message.startsWith("The log") ? e.message : "The world did not answer.";
    say(`${why} Trying again.`, "bad");
  }
}

async function poll(): Promise<void> {
  await ask();
  setTimeout(() => void poll(), 3000);
}

// The open commands of the past are asked for from the start, so the page lets go of what it holds.
$("open").onchange = () => {
  asking++;
  held = [];
  draw();
  void ask();
};

$("rank").innerHTML = `<option value="-1">Any rank</option>` +
  RANK_NAMES.slice(RANK_STAFF).map((name, i) => `<option value="${i + RANK_STAFF}">${esc(name)} and above</option>`).join("");
$("kind").innerHTML = `<option value="">Every kind</option>` + KINDS.map((k) => `<option value="${k}">${esc(KIND_WORDS[k])}</option>`).join("");
for (const id of ["who", "words"]) $(id).oninput = draw;
for (const id of ["rank", "kind"]) $(id).onchange = draw;
say("Loading…");
draw();
void poll();
