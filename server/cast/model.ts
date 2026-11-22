// The planner's language model: one OpenRouter chat call at a time, off the tick, asking for JSON, within budgets (calls
// and tokens an hour), cut off after a few failures in a row for a while, and never needed: with no key, no model, an
// error or a spent budget the rules' choices stand and the city goes on. A call is told who is calling by a generic name
// only, never the server's or anybody's.

export interface ModelReply {
  text: string;
  tokens: { in: number; out: number };
  cost: number;
  ms: number;
}

/** What asks the model: a system prompt and a user message, an answer as text (JSON) or a thrown error. */
export type Ask = (system: string, user: string, maxTokens: number) => Promise<ModelReply>;

export interface Budget {
  callsPerHour: number;
  tokensPerHour: number;
}

/** OpenRouter's chat completions with a key and a model id. */
export function openRouter(key: string, model: string, timeoutMs = 25_000): Ask {
  return async (system, user, maxTokens) => {
    const t0 = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-title": "SNARK Cast" },
        body: JSON.stringify({
          model, max_tokens: maxTokens, temperature: 0.7, response_format: { type: "json_object" }, usage: { include: true },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!res.ok) throw new Error(`openrouter ${res.status}`);
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
      return {
        text: j.choices?.[0]?.message?.content ?? "",
        tokens: { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 },
        cost: j.usage?.cost ?? 0,
        ms: Math.round(performance.now() - t0),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Keeps calls within budget, one in flight, and stops asking for a while after failures. */
export class ModelGate {
  ask: Ask | null;
  budget: Budget;
  /** Counts for the admin page: calls made, failed, refused by the budget; tokens and dollars this hour and all told. */
  readonly counts = { calls: 0, failed: 0, refused: 0, tokens: 0, cost: 0 };
  private readonly hour: { t: number; tokens: number }[] = [];
  private busy = false;
  private failures = 0;
  private offUntil = 0;

  constructor(ask: Ask | null, budget: Budget) {
    this.ask = ask;
    this.budget = budget;
  }

  /** Whether a call may go now (ms is the wall clock). */
  ready(now: number): boolean {
    if (!this.ask || this.busy || now < this.offUntil) return false;
    while (this.hour.length && this.hour[0]!.t < now - 3_600_000) this.hour.shift();
    const tokens = this.hour.reduce((n, h) => n + h.tokens, 0);
    return this.hour.length < this.budget.callsPerHour && tokens < this.budget.tokensPerHour;
  }

  /** Cost this hour, in dollars, and calls. */
  thisHour(now: number): { calls: number; tokens: number } {
    while (this.hour.length && this.hour[0]!.t < now - 3_600_000) this.hour.shift();
    return { calls: this.hour.length, tokens: this.hour.reduce((n, h) => n + h.tokens, 0) };
  }

  /** Asks if allowed; resolves to null when not, or on failure. */
  async call(system: string, user: string, maxTokens: number, now: number): Promise<ModelReply | null> {
    if (!this.ready(now)) {
      this.counts.refused++;
      return null;
    }
    this.busy = true;
    const slot = { t: now, tokens: 0 };
    this.hour.push(slot);
    try {
      const r = await this.ask!(system, user, maxTokens);
      slot.tokens = r.tokens.in + r.tokens.out;
      this.counts.calls++;
      this.counts.tokens += slot.tokens;
      this.counts.cost += r.cost;
      this.failures = 0;
      return r;
    } catch {
      this.counts.failed++;
      if (++this.failures >= 3) {
        this.offUntil = now + 10 * 60_000;
        this.failures = 0;
      }
      return null;
    } finally {
      this.busy = false;
    }
  }
}
