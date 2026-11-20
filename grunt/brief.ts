// The brief: before every model call, the situation as it is now, and the knowledge that matters for it. Cards are
// small pieces of guidance, facts and options, each with a test for when it is relevant; the brief takes the most
// relevant that fit a budget and writes them from live facts (real ids, numbers, the exact calls to make). It goes at
// the end of the request and is never kept in the transcript, so the cached prefix stays as it was.

import { compass } from "./belief.ts";
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
const activeGoals = (s: Situation) => s.goals.filter((g) => g.status === "active");

/** Thatch and wood a tree gives, and fiber a bush, from the character's own harvests where it has any. */
function yields(s: Situation): { tree: Record<string, number>; bush: Record<string, number> } {
  const out = { tree: { wood: 30, thatch: 10 } as Record<string, number>, bush: { fiber: 12 } as Record<string, number> };
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
    relevance: (s) => {
      const runs = s.rt.tasks.filter((t) => t.by === "arbiter" && t.skill === "flee" && t.started > s.rt.belief.now - 180000).length;
      return blockedBy(s, "danger").length || runs >= 2 ? 0.95 : 0;
    },
    text: (s) => {
      const b = s.rt.belief;
      const t = blockedBy(s, "danger").at(-1);
      const d = (t?.result?.data?.danger as { id?: string; type?: string } | undefined) ?? (() => {
        const f = s.rt.tasks.filter((x) => x.by === "arbiter" && x.skill === "flee").at(-1);
        const id = String(f?.args.from ?? "");
        return { id, type: b.things.get(id)?.type ?? b.dangers.get(id)?.type };
      })();
      const it = d.id ? b.things.get(d.id) : undefined;
      const won = s.rt.fights.filter((f) => f.foe === d.type && f.won);
      const armed = ["stone_hatchet", "stone_pick"].some((w) => b.slotOf(w) !== null);
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
      const steps = [
        trees > 0 ? `game_do harvest {"kind": "tree", "count": ${trees * (y.tree.wood ?? 30)}} (about ${trees} trees: wood and thatch come together; you know of ${seen.tree})` : "",
        bushes > 0 ? `game_do harvest {"kind": "bush", "count": ${need("fiber")}} (about ${bushes} bushes; you know of ${seen.bush})` : "",
        `game_do {"resume": "${t.id}"} to build`,
      ].filter(Boolean);
      return `To build, gather in this order, one task at a time, each when the last is done:\n${steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}${seen.tree < trees || seen.bush < bushes ? "\nYou know of too few: look_around, or walk somewhere new, to find more." : ""}`;
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

/** The brief for this moment: the most relevant cards, in the library's order, within a budget of characters. */
export function brief(s: Situation, cards: Card[] = CARDS, budget = 2400): { text: string; cards: string[] } {
  const scored = cards.map((c, i) => ({ c, i, r: c.relevance(s) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r || a.i - b.i);
  const chosen: { i: number; id: string; text: string }[] = [];
  let used = 0;
  for (const x of scored) {
    const text = x.c.text(s);
    if (used + text.length > budget && chosen.length) continue;
    chosen.push({ i: x.i, id: x.c.id, text });
    used += text.length;
  }
  chosen.sort((a, b) => a.i - b.i);
  return { text: `[brief: the situation now, for this decision. It is not from a player.]\n${chosen.map((c) => c.text).join("\n")}`, cards: chosen.map((c) => c.id) };
}
