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
  "build.spot": (i) => (i.state.valid && Number(i.state.off_m) <= 0.5 ? { choice: "place", why: "the preview is valid where it should be" } : { choice: "skip", why: `the preview ${i.state.valid ? `is ${i.state.off_m} m off` : `is refused: ${i.state.reason}`}` }),
  "threat.respond": (i) => {
    if (!i.state.armed) return { choice: "flee", why: "nothing to fight with" };
    if (num(i.state.health, 1) < 0.3) return { choice: "flee", why: "too hurt to fight" };
    const d = num(i.state.distance, 99), stamina = num(i.state.stamina, 1);
    if (d <= 6 && stamina < 0.35) return { choice: "fight", why: "it is close and I can't outrun it" };
    if (d <= 2 && num(i.state.its_health, 1) < 0.5) return { choice: "fight", why: "it is close and already hurt" };
    return { choice: "flee", why: "I can still outrun it" };
  },
};
