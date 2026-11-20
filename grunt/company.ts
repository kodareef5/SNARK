// Keeping company and keeping house: following someone (the game's follow assist keeps the pace, with a person's
// small unsteadiness and glances), escorting them (following, and fighting what comes at them), and repairing a base
// (the game's repair assist, from spots within its reach of each damaged part).

import type { Run } from "./body.ts";
import { fight } from "./combat.ts";
import { fetch, upkeep as keepUp } from "./haul.ts";
import type { Vec3 } from "./protocol.ts";
import type { SkillContext, SkillResult } from "./skills.ts";

/** Whom to follow: an id, or a name. */
function whom(ctx: SkillContext, v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (ctx.belief.things.has(v)) return v;
  const w = v.toLowerCase();
  return ctx.belief.find((t) => !!t.name && t.name.toLowerCase() === w)[0]?.id ?? null;
}

/** One stretch of following through the assist, or (lost, blocked) a walk to where the target was last seen. */
function* stretch(ctx: SkillContext, id: string, near: number, far: number, seconds: number): Run<"ok" | "lost" | "stopped" | "interrupted"> {
  const b = ctx.belief;
  const last = b.things.get(id)?.pos;
  const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "assist", kind: "follow", target: id, range: [near, far], natural: true, until: { seconds } }], `follow ${id}`), seconds * 1000 + 5000);
  const res = (o?.detail as { result?: string } | undefined)?.result;
  if (o?.status === "completed") return "ok";
  if (o?.status === "interrupted") return "interrupted";
  // Lost from sight or held up: go by the map to where it was last seen, and take it up again from there.
  const to: Vec3 | undefined = b.things.get(id)?.pos ?? last;
  if (!to) return "lost";
  const r = yield* ctx.body.goTo(() => b.things.get(id)?.pos ?? to, far, { ignore: id });
  if (r !== "arrived" && !b.things.has(id)) return "lost";
  return res === "lost" && !b.things.has(id) ? "lost" : "ok";
}

export function* follow(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const id = whom(ctx, args.target);
  if (!id) return { status: "failed", summary: `I can't see ${String(args.target)}` };
  if (!b.assists?.kinds.includes("follow")) return { status: "failed", summary: "this game has no follow assist" };
  const near = Number(args.near ?? 2.5), far = Number(args.far ?? 6);
  const until = (p.until ??= b.now + Number(args.seconds ?? 600) * 1000) as number;
  const who = b.things.get(id)?.name ?? id;
  while (b.now < until) {
    const r = yield* stretch(ctx, id, near, far, Math.max(1, Math.min(60, (until - b.now) / 1000)));
    if (r === "lost") return { status: "blocked", summary: `I lost ${who}`, data: { reason: "lost" } };
    if (r === "interrupted") return { status: "blocked", summary: `following ${who} was interrupted`, data: { reason: "interrupted" } };
  }
  return { status: "done", summary: `I followed ${who} for ${Math.round(Number(args.seconds ?? 600))} s` };
}

/** Escort: follow, and whatever hostile comes within `guard` metres of the one escorted (or of the character) is fought,
 * then the following goes on; done when they reach `to` (x, z) or after `seconds`. */
export function* escort(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief, p = ctx.progress;
  const id = whom(ctx, args.target);
  if (!id) return { status: "failed", summary: `I can't see ${String(args.target)}` };
  const who = b.things.get(id)?.name ?? id;
  const guard = Number(args.guard ?? 20);
  const dest = args.to as { x?: number; z?: number } | undefined;
  const until = (p.until ??= b.now + Number(args.seconds ?? 900) * 1000) as number;
  const t0 = (p.t0 ??= b.now) as number;
  // What died on the way, whether this skill or a reflex fought it.
  const kills = () => b.since(t0, "notice").filter((e) => /^the .+ is dead$/.test(String(e.data.text))).length;
  while (b.now < until) {
    const it = b.things.get(id);
    if (dest && typeof dest.x === "number" && it && Math.hypot(it.pos[0] - dest.x, it.pos[2] - Number(dest.z)) < 8) {
      return { status: "done", summary: `${who} is at ${dest.x}, ${dest.z}, safe; I killed ${kills()} on the way`, data: { killed: kills() } };
    }
    // Anything hostile near either of us: dealt with first.
    const threat = b.find((t) => t.kind === "creature" && t.disposition === "hostile" && (b.distance(t.pos) < guard || (!!it && Math.hypot(t.pos[0] - it.pos[0], t.pos[2] - it.pos[2]) < guard)))[0];
    if (threat) {
      const sub = { ...ctx, progress: {} as Record<string, unknown> };
      const r = yield* fight(sub, { target: threat.id, retreat: 0.35 });
      if (r.status !== "done") return { status: "blocked", summary: `guarding ${who}: ${r.summary}`, data: { reason: "fight" } };
      continue;
    }
    const r = yield* stretch(ctx, id, 3, 7, 3);
    if (r === "lost") return { status: "blocked", summary: `I lost ${who}`, data: { reason: "lost" } };
    if (r === "interrupted") return { status: "blocked", summary: `escorting ${who} was interrupted`, data: { reason: "interrupted" } };
  }
  return { status: "done", summary: `I escorted ${who}; killed ${kills()} on the way`, data: { killed: kills() } };
}

/** Repair: each damaged part of a base it knows of, from a spot near it, through the game's repair assist. */
export function* repair(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  if (!b.assists?.kinds.includes("repair")) return { status: "failed", summary: "this game has no repair assist" };
  const base = typeof args.base === "string" ? args.base : [...b.damaged.values()][0]?.base;
  if (!base) return { status: "done", summary: "nothing I know of is damaged" };
  let mended = 0, fetched = false;
  const spent: Record<string, number> = {};
  for (let round = 0; round < 12; round++) {
    const hurt = [...b.damaged.entries()].filter(([, d]) => d.base === base);
    if (!hurt.length) break;
    const [, first] = hurt.sort((x, y) => b.distance(x[1].pos) - b.distance(y[1].pos))[0]!;
    if (b.distance(first.pos) > 8) yield* ctx.body.goTo(() => first.pos, 6, {});
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "assist", kind: "repair", target: base }], `repair ${base}`), 60_000);
    const d = (o?.detail ?? {}) as { result?: string; repaired?: number; spent?: Record<string, number>; need?: Record<string, number> };
    mended += Number(d.repaired ?? 0);
    for (const [k, v] of Object.entries(d.spent ?? {})) spent[k] = (spent[k] ?? 0) + v;
    yield { ms: 600 };
    if (d.result === "materials" && !fetched && d.need) {
      // Short: what it takes may be in the stores.
      fetched = true;
      if (yield* fetch(ctx, Object.fromEntries(Object.entries(d.need).map(([k, v]) => [k, b.count(k) + v * 20])))) continue;
    }
    if (d.result === "materials") {
      return { status: "blocked", summary: `repaired ${mended} pieces, then ran short: the next takes ${Object.entries(d.need ?? {}).map(([k, v]) => `${v} ${k}`).join(", ")}`, data: { reason: "materials", bill: d.need, mended } };
    }
    if (d.result === "whole") break;
  }
  const left = [...b.damaged.values()].filter((d) => d.base === base).length;
  const cost = Object.entries(spent).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing";
  return left
    ? { status: "blocked", summary: `repaired ${mended} pieces for ${cost}; ${left} more I could not get to`, data: { reason: "reach", mended } }
    : { status: "done", summary: `repaired ${mended} pieces of ${base} for ${cost}`, data: { mended, spent } };
}

/** Looking after the base in one go (grunt/haul.ts upkeep): repairs, the harvesters emptied, a heavy bag stashed. */
export function* upkeep(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  return yield* keepUp(ctx, args, repair);
}
