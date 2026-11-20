// Monitors judge the moment, each its own concern, and raise signals; none of them moves the body. The arbiter (in
// runtime.ts) decides what a signal does.

import type { Belief } from "./belief.ts";

export interface Signal {
  kind: "danger" | "critical" | "need" | "addressed" | "noticed";
  /** 0 (ignorable) to 1 (act now). */
  urgency: number;
  /** An entity id it is about, if there is one. */
  about?: string;
  /** A world yaw it comes from, for things heard and not seen. */
  yaw?: number;
  detail: Record<string, unknown>;
}

export interface MonitorContext {
  name: string;
  /** Names whose instructions the character follows, beyond anyone who addresses it by name. */
  owners: string[];
}

export type Monitor = (b: Belief, ctx: MonitorContext) => Signal[];

/** Hostile creatures seen near and closing, being hurt, and hunters heard but not seen. */
export const threat: Monitor = (b) => {
  const out: Signal[] = [];
  for (const t of b.find((r) => r.kind === "creature" && r.disposition === "hostile" && b.age(r.seen) < 3000)) {
    const d = b.distance(t.pos);
    if (d > 25) continue;
    let u = Math.max(0, Math.min(1, (25 - d) / 20));
    if (t.tags?.includes("hunting")) u = Math.min(1, u + 0.3);
    out.push({ kind: "danger", urgency: u, about: t.id, detail: { type: t.type, distance: Math.round(d * 10) / 10, hunting: !!t.tags?.includes("hunting") } });
  }
  // Being hurt is danger, unless what did it is known to be gone (dead, used up) since.
  const hurt = b.since(b.now - 2000, "hurt").filter((e) => typeof e.data.by !== "string" || b.things.has(e.data.by) || b.dangers.has(e.data.by));
  if (hurt.length) {
    const by = hurt.at(-1)!.data.by;
    out.push({ kind: "danger", urgency: 1, ...(typeof by === "string" ? { about: by } : {}), detail: { hurt: hurt.reduce((n, e) => n + Number(e.data.amount), 0) } });
  }
  for (const h of b.heard) {
    if (b.now - h.t > 2000 || h.kind !== "creature" || h.loudness < 0.4) continue;
    out.push({ kind: "danger", urgency: 0.4 + h.loudness * 0.3, yaw: h.yaw, detail: { heard: h.what ?? "something", loudness: h.loudness } });
  }
  return out;
};

/** The body's own state: hurt badly, carrying too much, hungry. */
export const body: Monitor = (b) => {
  const out: Signal[] = [];
  if (!b.self) return out;
  if (b.vital("health") < 0.35) out.push({ kind: "critical", urgency: 0.9, detail: { health: b.vital("health") } });
  if (b.weightFraction() > 0.9) out.push({ kind: "need", urgency: 0.5, detail: { need: "unload", weight: b.weightFraction() } });
  if (b.vital("food") < 0.2) out.push({ kind: "need", urgency: 0.4, detail: { need: "eat" } });
  if (b.vital("water") < 0.2) out.push({ kind: "need", urgency: 0.5, detail: { need: "drink" } });
  return out;
};

/** Lines said to the character: by its name, or by someone whose word it follows. */
export const social: Monitor = (b, ctx) => {
  const out: Signal[] = [];
  const name = ctx.name.toLowerCase();
  for (const l of b.chat) {
    if (l.read) continue;
    const named = l.text.toLowerCase().includes(name);
    const owner = ctx.owners.some((o) => o.toLowerCase() === l.from.toLowerCase());
    if (!named && !owner) continue;
    l.read = true;
    out.push({ kind: "addressed", urgency: owner ? 0.8 : 0.6, detail: { from: l.from, text: l.text, channel: l.channel, owner } });
  }
  return out;
};

export const MONITORS: Monitor[] = [threat, body, social];
