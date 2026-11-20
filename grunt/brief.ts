// The brief: before every model call, the situation as it is now, and the knowledge that matters for it. Cards are
// small pieces of guidance, facts and options, each with a test for when it is relevant; the brief takes the most
// relevant that fit a budget and writes them from live facts (real ids, numbers, the exact calls to make). It goes at
// the end of the request and is never kept in the transcript, so the cached prefix stays as it was.

import type { Agenda } from "./agenda.ts";
import { compass } from "./belief.ts";
import { MELEE } from "./know.ts";
import type { Report, Runtime, Task } from "./runtime.ts";
import { SKILLS } from "./skills.ts";

export interface Goal {
  id: string;
  text: string;
  status: "active" | "done" | "dropped";
  note?: string;
  at: number;
}

export interface Situation {
  /** The character's own agenda, if it has one. */
  agenda?: Agenda;
  rt: Runtime;
  goals: Goal[];
  /** The last tool call that failed, and why. */
  lastError?: { tool: string; args: unknown; message: string };
  /** When the character last said anything (game clock), to tell unanswered lines from answered ones. */
  lastSaid: number;
}

export interface Card {
  id: string;
  /** 0 (not now) to 1 (must be in the brief). */
  relevance(s: Situation): number;
  text(s: Situation): string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const recent = (s: Situation, ms: number, ...kinds: Report["kind"][]) => s.rt.reports.filter((r) => r.t >= s.rt.belief.now - ms && kinds.includes(r.kind));
const blockedBy = (s: Situation, reason: string): Task[] => s.rt.tasks.filter((t) => t.status === "blocked" && t.result?.data?.reason === reason);

/** The threat that keeps getting in the way, if it is still there: a task it blocks, or two runs from it lately. */
function recurring(s: Situation): { id: string; type?: string; task?: Task } | null {
  const b = s.rt.belief;
  const alive = (id: string) => !!id && (b.things.has(id) || (b.dangers.has(id) && b.now - b.dangers.get(id)!.t < 60000));
  const t = blockedBy(s, "danger").filter((x) => alive(String((x.result?.data?.danger as { id?: string } | undefined)?.id ?? ""))).at(-1);
  if (t) {
    const d = t.result!.data!.danger as { id: string; type?: string };
    return { id: d.id, ...(d.type ? { type: d.type } : {}), task: t };
  }
  const runs = new Map<string, number>();
  for (const f of s.rt.tasks) if (f.by === "arbiter" && f.skill === "flee" && f.started > b.now - 180000) runs.set(String(f.args.from ?? ""), (runs.get(String(f.args.from ?? "")) ?? 0) + 1);
  for (const [id, n] of runs) if (n >= 2 && alive(id)) return { id, type: b.things.get(id)?.type ?? b.dangers.get(id)?.type };
  return null;
}
const activeGoals = (s: Situation) => s.goals.filter((g) => g.status === "active");

/** Thatch and wood a tree gives, and fiber a bush, from the character's own harvests where it has any. */
function yields(s: Situation): { tree: Record<string, number>; bush: Record<string, number> } {
  const out = { tree: { wood: 150, thatch: 50 } as Record<string, number>, bush: { fiber: 48 } as Record<string, number> };
  for (const t of s.rt.tasks) {
    if (t.skill !== "harvest" || !t.progress.targets) continue;
    const kind = String(t.args.kind ?? "tree") as "tree" | "bush";
    if (!(kind in out)) continue;
    const g = (t.progress.gained ?? {}) as Record<string, number>;
    const n = Number(t.progress.targets);
    for (const [k, v] of Object.entries(g)) out[kind][k] = Math.round(v / n);
  }
  return out;
}

export const CARDS: Card[] = [
  {
    // The character's own to-dos (not the standing chores, which come by themselves when it is idle).
    id: "agenda",
    relevance: (s) => (s.agenda?.todos.some((t) => t.status === "open" && t.from !== "standing") ? 0.5 : 0),
    text: (s) => `Your agenda (game_agenda): ${s.agenda!.todos.filter((t) => t.status === "open" && t.from !== "standing").sort((a, b) => a.priority - b.priority).slice(0, 5).map((t) => `${t.id} (${t.priority}): ${t.text}`).join("; ")}.`,
  },
  {
    // Working with a tribe: the jobs others have taken, so this one takes another.
    id: "tribe",
    relevance: (s) => (s.rt.claims().length ? 0.7 : 0),
    text: (s) => `Taken in the tribe's chat (leave these to them, or join to help): ${s.rt.claims().map((c) => `${c.by}: "${c.job}" (${Math.round((s.rt.belief.now - c.t) / 1000)} s ago)`).join("; ")}.`,
  },
  {
    id: "goal",
    relevance: (s) => (s.goals.length ? 1 : 0),
    text: (s) => {
      const a = activeGoals(s);
      const lines = a.length ? a.map((g) => `- ${g.id}: "${g.text}"${g.note ? ` (${g.note})` : ""}`) : ["- none active; the last was done or dropped"];
      return `Goal${a.length > 1 ? "s" : ""} (from your instructions; mark one met or dropped with game_goal):\n${lines.join("\n")}`;
    },
  },
  {
    id: "self",
    relevance: () => 1,
    text: (s) => {
      const b = s.rt.belief, me = b.self;
      if (!me) return "You: not seen yet.";
      const stamina = b.vital("stamina");
      return `You: health ${pct(b.vital("health"))}, stamina ${pct(stamina)}${stamina < 0.3 ? " (too tired to outrun anything)" : ""}, holding ${me.held?.item ?? "nothing"}, carrying ${pct(b.weightFraction())} of your limit, at ${me.pos[0].toFixed(0)}, ${me.pos[2].toFixed(0)}.`;
    },
  },
  {
    id: "doing",
    relevance: () => 1,
    text: (s) => {
      const c = s.rt.current;
      const doing = c ? `${c.skill} ${c.id} (${c.by === "arbiter" ? "a reflex: leave it" : "yours"})` : "nothing: you are idle";
      const aside = s.rt.waiting.map((t) => `${t.skill} ${t.id}`);
      const blocked = s.rt.tasks.filter((t) => t.status === "blocked").slice(-2).map((t) => `${t.skill} ${t.id} (${t.result?.summary ?? ""})`);
      return `Doing: ${doing}.${aside.length ? ` Put aside, coming back by itself: ${aside.join(", ")}.` : ""}${blocked.length ? ` Blocked: ${blocked.join("; ")}.` : ""}`;
    },
  },
  {
    id: "threats",
    relevance: (s) => (s.rt.belief.find((t) => t.disposition === "hostile" && s.rt.belief.age(t.seen) < 60000).length ? 0.9 : 0),
    text: (s) => {
      const b = s.rt.belief;
      const list = b.find((t) => t.disposition === "hostile" && b.age(t.seen) < 60000).slice(0, 3)
        .map((t) => `${t.type} ${t.id}, ${Math.round(b.distance(t.pos))} m ${compass(b.yawTo(t.pos))}, ${t.health !== undefined ? pct(t.health) : "?"} health${t.tags?.includes("hunting") ? ", hunting you" : ""}${b.age(t.seen) > 3000 ? `, seen ${Math.round(b.age(t.seen) / 1000)} s ago` : ""}`);
      return `Threats: ${list.join("; ")}.`;
    },
  },
  {
    id: "recurring-threat",
    // The same creature has made the character run more than once, or has blocked a task: it is a problem to remove.
    relevance: (s) => (recurring(s) ? 0.95 : 0),
    text: (s) => {
      const b = s.rt.belief;
      const d = recurring(s)!;
      const t = d.task;
      const it = d.id ? b.things.get(d.id) : undefined;
      const won = s.rt.fights.filter((f) => f.foe === d.type && f.won);
      const armed = MELEE.some((w) => b.slotOf(w) !== null);
      const odds = won.length
        ? `You have beaten ${won.length} ${d.type} before, in about ${won.at(-1)!.swings} swings, losing ${won.at(-1)!.health_lost} health.`
        : `You have not fought a ${d.type ?? "creature"} yet; ${it?.health !== undefined ? `it is at ${pct(it.health)} health` : "its strength is unknown"}.`;
      const advice = !armed ? "You have no weapon: avoid it, or gather elsewhere."
        : b.vital("health") < 0.5 ? "You are hurt: fighting now is a risk; gather somewhere else, or wait."
          : `Waiting it out has not worked. With a weapon, full health${b.vital("stamina") < 0.5 ? "" : " and stamina"}, fighting it on purpose is usually best: game_do fight {"target": "${d.id}"}${t ? `, then game_do {"resume": "${t.id}"}` : ""}.`;
      return `The ${d.type ?? "threat"} ${d.id ?? ""} keeps getting in the way. ${odds} ${advice}`;
    },
  },
  {
    id: "materials",
    relevance: (s) => (blockedBy(s, "materials").length ? 0.95 : 0),
    text: (s) => {
      const t = blockedBy(s, "materials").at(-1)!;
      const bill = (t.result?.data?.bill ?? {}) as Record<string, number>;
      const b = s.rt.belief, y = yields(s);
      const need = (item: string) => Math.max(0, (bill[item] ?? 0) - b.count(item));
      const trees = Math.max(Math.ceil(need("wood") / (y.tree.wood ?? 30)), Math.ceil(need("thatch") / (y.tree.thatch ?? 10)));
      const bushes = Math.ceil(need("fiber") / (y.bush.fiber ?? 12));
      const seen = { tree: b.find((x) => x.type === "tree").length, bush: b.find((x) => x.type === "bush").length };
      return `To build: 1. game_do gather {"items": ${JSON.stringify(bill)}} (one task for the whole list: about ${trees} trees and ${bushes} bushes; you know of ${seen.tree} trees and ${seen.bush} bushes), 2. when it is done, game_do {"resume": "${t.id}"}.${seen.tree < trees || seen.bush < bushes ? " You know of too few: explore or walk somewhere new to find more first." : ""}`;
    },
  },
  {
    id: "unanswered",
    relevance: (s) => (recent(s, 120000, "addressed").some((r) => r.t > s.lastSaid) ? 1 : 0),
    text: (s) => {
      const lines = recent(s, 120000, "addressed").filter((r) => r.t > s.lastSaid).map((r) => `- ${r.text} (${Math.round((s.rt.belief.now - r.t) / 1000)} s ago)`);
      return `Waiting for your answer:\n${lines.join("\n")}\nAnswer with game_say, and do what is asked if it is yours to do (walk_to takes the speaker's id).`;
    },
  },
  {
    id: "persona",
    // Who the character is, so what it says in chat sounds like the one its idle shows.
    relevance: (s) => (s.rt.idler.persona.name !== "stoic" ? 0.15 : 0),
    text: (s) => `Your persona: ${s.rt.idler.persona.name}, ${s.rt.idler.persona.about}. Your idle moves on its own; speak in chat as this one would, and use game_do emote or perform to answer someone in kind.`,
  },
  {
    id: "idle",
    relevance: (s) => (!s.rt.current && !s.rt.waiting.length && activeGoals(s).length ? 0.8 : 0),
    text: (s) => `You are idle and a goal is not marked met. If it is met, report it as asked and mark it with game_goal; if not, start the next step now.`,
  },
  {
    id: "tool-error",
    relevance: (s) => (s.lastError ? 0.9 : 0),
    text: (s) => {
      const e = s.lastError!;
      const skill = (e.args as { skill?: string } | undefined)?.skill;
      const params = skill && SKILLS[skill] ? ` ${skill} takes: ${JSON.stringify(SKILLS[skill].params)}.` : "";
      return `Your last ${e.tool} failed: ${e.message}.${params}`;
    },
  },
  {
    id: "heavy",
    relevance: (s) => (s.rt.belief.weightFraction() > 0.85 ? 0.6 : 0),
    text: () => "You carry nearly your limit: past it you slow to a crawl. Craft materials into what you need, or put things in a box.",
  },
];

/** Cards that set the scene for the others, and say little on their own: game_look already shows the same. */
export const FRAME = new Set(["goal", "self", "doing"]);

/** The brief for this moment: the most relevant cards, in the library's order, within a budget of characters. Empty
 * when no card but the frame applies: a brief that only repeats game_look is cost and no help (measured). */
export function brief(s: Situation, cards: Card[] = CARDS, budget = 2400): { text: string; cards: string[]; parts: { id: string; text: string }[] } {
  const scored = cards.map((c, i) => ({ c, i, r: c.relevance(s) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r || a.i - b.i);
  if (!scored.some((x) => !FRAME.has(x.c.id))) return { text: "", cards: [], parts: [] };
  const chosen: { i: number; id: string; text: string }[] = [];
  let used = 0;
  for (const x of scored) {
    const text = x.c.text(s);
    if (used + text.length > budget && chosen.length) continue;
    chosen.push({ i: x.i, id: x.c.id, text });
    used += text.length;
  }
  chosen.sort((a, b) => a.i - b.i);
  return { text: `${BRIEF_HEAD}\n${chosen.map((c) => c.text).join("\n")}`, cards: chosen.map((c) => c.id), parts: chosen.map(({ id, text }) => ({ id, text })) };
}

const BRIEF_HEAD = "[brief: the situation now, for this decision. It is not from a player.]";

/** What a game message should carry of the brief: only cards new or changed since the last delivery, with the frame
 * (goal, body, task) when any situational card is among them. Messages are kept, so a card the model has seen
 * unchanged is not sent again, and the conversation only grows at its end (which keeps the provider's cache). */
export class BriefDelivery {
  private readonly sent = new Map<string, string>();

  next(s: Situation, cards: Card[] = CARDS): { text: string; cards: string[] } {
    const b = brief(s, cards);
    const fresh = b.parts.filter((p) => this.sent.get(p.id) !== p.text);
    const situational = fresh.filter((p) => !FRAME.has(p.id));
    for (const p of b.parts) if (!FRAME.has(p.id)) this.sent.set(p.id, p.text);
    for (const id of [...this.sent.keys()]) if (!b.cards.includes(id)) this.sent.delete(id);
    if (!situational.length) return { text: "", cards: [] };
    const out = b.parts.filter((p) => FRAME.has(p.id) || situational.includes(p));
    return { text: `${BRIEF_HEAD}\n${out.map((p) => p.text).join("\n")}`, cards: out.map((p) => p.id) };
  }
}
