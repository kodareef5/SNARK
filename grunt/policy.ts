// Decision points: narrow questions with explicit candidates, answered by a policy. Rules, a language model asked the
// one question, a decision model: every policy answers the same way, and nothing else knows which one did.

export interface DecisionInput {
  /** Which question: `harvest.target`, `harvest.next`, `arbiter.interrupt`, `threat.respond`, ... */
  point: string;
  candidates: string[];
  /** What the question is about, as plain data: the policy's whole view of the moment. */
  state: Record<string, unknown>;
}

export interface Choice {
  choice: string;
  scores?: Record<string, number>;
  why?: string;
}

export interface DecisionPolicy {
  readonly name: string;
  decide(input: DecisionInput): Choice | Promise<Choice>;
}

export type Rule = (input: DecisionInput) => Choice | undefined;

/** Rules by point. A point with no rule, or a rule with no answer, takes the first candidate. */
export class RulesPolicy implements DecisionPolicy {
  readonly name: string;
  private readonly rules: Record<string, Rule>;

  constructor(rules: Record<string, Rule> = DEFAULT_RULES, name = "rules") {
    this.rules = rules;
    this.name = name;
  }

  decide(input: DecisionInput): Choice {
    const c = this.rules[input.point]?.(input);
    if (c && input.candidates.includes(c.choice)) return c;
    return { choice: input.candidates[0]!, why: c ? `rule chose ${c.choice}, not a candidate` : "first candidate" };
  }
}

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

/** The rules every skill starts with, so that it works and is tested before any model answers its questions. */
export const DEFAULT_RULES: Record<string, Rule> = {
  // The nearest that is not near a remembered danger; none, and the skill stops for the Director to decide.
  "harvest.target": (i) => {
    const safe = (i.state.candidates as { id: string; danger_m: number | null }[] | undefined)?.find((c) => c.danger_m === null || c.danger_m >= 22);
    return safe ? { choice: safe.id, why: "nearest away from danger" } : { choice: "stop", why: "every one left is near a danger" };
  },
  "harvest.next": (i) => {
    if (num(i.state.weight) > 0.95) return { choice: "stop", why: "too heavy to carry more" };
    if (i.state.target_gone) return { choice: "next_target", why: "the target is used up" };
    if (num(i.state.yield_last) === 0 && num(i.state.misses) >= 3) return { choice: "next_target", why: "three swings gave nothing" };
    return { choice: "continue", why: "it still gives" };
  },
  "arbiter.interrupt": (i) => {
    const u = num(i.state.urgency);
    if (u >= 0.6) return { choice: "interrupt", scores: { interrupt: u, continue: 1 - u }, why: `${i.state.signal} at ${u.toFixed(2)}` };
    return { choice: "continue", scores: { interrupt: u, continue: 1 - u }, why: "not urgent enough" };
  },
  // Whom to fight next: what hunts the character first, the nearest of those; nothing left, stop.
  "fight.next": (i) => {
    const c = (i.state.candidates as { id: string; distance: number; hunting: boolean }[] | undefined) ?? [];
    const best = [...c].sort((a, b) => Number(b.hunting) - Number(a.hunting) || a.distance - b.distance)[0];
    return best ? { choice: best.id, why: best.hunting ? "the nearest that hunts me" : "the nearest" } : { choice: "stop", why: "none left" };
  },
  // With what: a bow while there are arrows and it is not already at the character's throat; else the best blade.
  "fight.weapon": (i) => (i.state.mount ? { choice: "mount", why: "from the saddle" } : i.state.bow === true && num(i.state.distance, 99) > 4 ? { choice: "bow", why: "from range" } : { choice: "melee", why: i.state.bow ? "too close for the bow" : "no bow" }),
  // The quickest way; the options come timed.
  "travel.mode": (i) => {
    const o = (i.state.options as { id: string; seconds: number }[] | undefined) ?? [];
    const best = [...o].sort((a, b) => a.seconds - b.seconds)[0];
    return best ? { choice: best.id, scores: Object.fromEntries(o.map((x) => [x.id, x.seconds])), why: `quickest: about ${best.seconds} s` } : { choice: i.candidates[0]! };
  },
  "threat.respond": (i) => {
    if (i.state.mounted === true && num(i.state.mount_health, 1) < 0.3) return { choice: "flee", why: "my mount is badly hurt" };
    if (i.state.mounted === true && num(i.state.pack, 1) <= 3) return { choice: "fight", why: "my mount fights" };
    // Guarding someone: an armed guard stands and fights what it can, rather than leave them to it.
    if (i.state.guarding === true && i.state.armed && num(i.state.health, 1) >= 0.4 && num(i.state.pack, 1) <= 2) return { choice: "fight", why: "I'm guarding someone" };
    if (!i.state.armed) return { choice: "flee", why: "nothing to fight with" };
    // A bow and breath to keep moving: shoot it, keeping range, rather than run (a pack of more than three: run).
    if (i.state.ranged === true && num(i.state.health, 1) >= 0.5 && num(i.state.stamina, 1) >= 0.4 && num(i.state.pack, 1) <= 3) return { choice: "fight", why: "I can shoot it from range" };
    if (num(i.state.pack, 1) >= 2) return { choice: "flee", why: "too many to fight hand to hand" };
    if (num(i.state.health, 1) < 0.3) return { choice: "flee", why: "too hurt to fight" };
    const d = num(i.state.distance, 99), stamina = num(i.state.stamina, 1);
    if (d <= 6 && stamina < 0.35) return { choice: "fight", why: "it is close and I can't outrun it" };
    if (d <= 2 && num(i.state.its_health, 1) < 0.5) return { choice: "fight", why: "it is close and already hurt" };
    // The same creature back for the third time, one known to be beaten: end it while fresh rather than run again.
    if (num(i.state.chased, 0) >= 2 && i.state.beatable === true && num(i.state.health, 1) >= 0.7 && stamina >= 0.5) return { choice: "fight", why: "it keeps coming back, and I can beat it while I'm fresh" };
    return { choice: "flee", why: "I can still outrun it" };
  },
};
