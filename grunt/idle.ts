// What a character does with nobody telling it anything, and how it answers others: rules over the game's emotes
// (capabilities.emotes), weighted by its persona (grunt/persona.ts), never a model call. Idle, it glances about as it
// always did, and now and then plays a move that fits who is near and how things are: a wave for its own people, a stare
// or a stalk for a stranger if it is menacing, a dance or a workout alone if playful, a sit or a lie-down after a long
// wait, a victory dance after a kill. Answering, it waves back at a wave, says yes (or no) to a high five or a hug, and
// joins a dance near it if playful. Each choice is traced. Routines (grunt/routines.ts) are the longer ones, run as the
// `perform` skill so any order takes over from them.

import type { Belief, Remembered } from "./belief.ts";
import type { Run } from "./body.ts";
import type { Action, EmoteSpec, Vec3 } from "./protocol.ts";
import { type Persona, Rng } from "./persona.ts";
import { ROUTINE, ROUTINES, type Routine, type Step } from "./routines.ts";
import type { SkillContext, SkillResult } from "./skills.ts";

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

/** The game's emote of a name, or its first of a tag (one of `tags`, in order), avoiding `recent` where it can. */
export function emoteFor(list: readonly EmoteSpec[], want: string | readonly string[], recent: readonly string[] = [], rng?: Rng): EmoteSpec | null {
  if (typeof want === "string") {
    const named = list.find((e) => e.name === want);
    if (named) return named;
    want = [want];
  }
  for (const tag of want) {
    const all = list.filter((e) => e.tags.includes(tag) && !e.pair);
    if (!all.length) continue;
    const fresh = all.filter((e) => !recent.includes(e.name));
    const from = fresh.length ? fresh : all;
    return rng ? from[Math.floor(rng.next() * from.length)]! : from[0]!;
  }
  return null;
}

// --- Routines, as a skill ------------------------------------------------------------------------------------------

/** Plays a routine's steps (or `steps` given), aimed at `target` where a step needs someone. */
export function* perform(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const b = ctx.belief;
  const routine = typeof args.routine === "string" ? ROUTINE.get(args.routine) : null;
  if (typeof args.routine === "string" && !routine) return { status: "failed", summary: `no routine ${args.routine}; there are ${ROUTINES.map((r) => r.name).join(", ")}` };
  const steps = (routine?.steps ?? (Array.isArray(args.steps) ? (args.steps as Step[]) : null));
  if (!steps?.length) return { status: "failed", summary: "a routine or steps, please" };
  const target = typeof args.target === "string" ? args.target : null;
  if (routine?.needs === "target" && (!target || !b.things.has(target))) return { status: "failed", summary: `${routine.name} is for someone: a target` };
  const list = b.emotes ?? [];
  const played: string[] = [];
  const at = (): Vec3 | null => (target ? (b.things.get(target)?.pos ?? null) : null);
  for (const step of steps) {
    if ("emote" in step) {
      const e = emoteFor(list, [step.emote], played) ?? emoteFor(list, step.emote);
      if (!e) continue;
      const pairWith = e.pair && target ? { target } : {};
      if (e.pair && !target) continue;
      const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "emote", name: e.name, ...pairWith, ...(e.loop ? { seconds: step.seconds ?? 6 } : {}) }], `perform ${e.name}`), ((e.loop ? step.seconds ?? 6 : e.seconds ?? 3) + 4) * 1000);
      if (o?.status === "completed") played.push(e.name);
      if (e.loop) yield { ms: (step.seconds ?? 6) * 1000 };
      else if (e.pair) yield { ms: 6000 };
    } else if ("look" in step) {
      const p = at();
      const self = b.self?.yaw ?? 0;
      const yaw = p ? b.yawTo(p) : self;
      yield* ctx.body.turnTo(step.look === "away" ? yaw + Math.PI * 0.7 : step.look === "about" ? self + (Math.random() - 0.5) * 2 : yaw);
    } else if ("approach" in step) {
      if (!at()) continue;
      if (step.slow) {
        for (let k = 0; k < 30 && at() && b.distance(at()!) > step.approach; k++) {
          yield* ctx.body.turnTo(b.yawTo(at()!));
          yield* ctx.body.settle(ctx.body.act([{ control: "move", forward: 0.35, strafe: 0, duration_ms: 700 }], "creep"), 1500);
        }
      } else yield* ctx.body.goTo(at, step.approach, {});
    } else if ("retreat" in step) {
      const p = at();
      if (!p) continue;
      const [dx, dz] = [b.pos[0] - p[0], b.pos[2] - p[2]];
      const d = Math.hypot(dx, dz) || 1;
      const away: Vec3 = [p[0] + (dx / d) * step.retreat, b.pos[1], p[2] + (dz / d) * step.retreat];
      yield* ctx.body.goTo(() => away, 1, {});
    } else if ("crouch" in step) ctx.body.act([{ control: "crouch", on: step.crouch }], "perform");
    else if ("say" in step) ctx.body.act([{ control: "chat", channel: "local", text: step.say }], "perform");
    else yield { ms: step.wait };
  }
  return { status: "done", summary: `${routine ? routine.name : "the routine"}${played.length ? `: ${played.join(", ")}` : ""}`, data: { played } };
}

/** One emote, at someone for a pair (asking them, or answering their ask), or joining a dance. */
export function* emote(ctx: SkillContext, args: Record<string, unknown>): Run<SkillResult> {
  const list = ctx.belief.emotes;
  if (!list?.length) return { status: "failed", summary: "this game has no emotes" };
  const target = typeof args.target === "string" ? args.target : undefined;
  if (args.stop === true) {
    ctx.body.act([{ control: "emote", stop: true }], "emote stop");
    return { status: "done", summary: "stopped" };
  }
  if (typeof args.join === "string") {
    const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "emote", join: args.join }], "join"), 3000);
    return o?.status === "completed" ? { status: "done", summary: `joined ${args.join}'s dance` } : { status: "failed", summary: `could not join: ${o?.code ?? "no answer"}` };
  }
  const want = String(args.name ?? args.tag ?? "");
  const e = emoteFor(list, want, [], new Rng(ctx.belief.now | 0));
  if (!e) return { status: "failed", summary: `no emote ${want}; some: ${list.slice(0, 30).map((x) => x.name).join(", ")}` };
  if (e.pair && !target) return { status: "failed", summary: `${e.name} is for two: give a target` };
  const seconds = typeof args.seconds === "number" ? args.seconds : e.loop ? 8 : undefined;
  const [o] = yield* ctx.body.settle(ctx.body.act([{ control: "emote", name: e.name, ...(e.pair ? { target } : {}), ...(seconds ? { seconds } : {}) }], `emote ${e.name}`), ((e.seconds ?? 2) + 6) * 1000);
  if (o?.status !== "completed") return { status: "failed", summary: `${e.name}: ${o?.code ?? o?.status ?? "no answer"}` };
  const invited = (o.detail as { invited?: string } | undefined)?.invited;
  return { status: "done", summary: invited ? `asked ${invited} for a ${e.name}: it begins if they answer` : `${e.name}${e.loop ? ` for ${seconds}s` : ""}`, data: { name: e.name } };
}

// --- The idle and the answers --------------------------------------------------------------------------------------

export interface IdleContext {
  belief: Belief;
  owners: readonly string[];
  /** A task has the body (the idle waits), or danger is about (it does nothing showy). */
  busy: boolean;
  danger: boolean;
  /** Whether the small glances and fun moves run (off in tests unless asked). */
  lively: boolean;
  act(actions: Action[], why: string): void;
  /** Starts a routine as a task. */
  perform(routine: string, target: string | null): void;
  trace(kind: string, data: Record<string, unknown>): void;
}

/** Times, ms. */
const GLANCE = [2500, 8500] as const;
const REPLY_COOLDOWN = 45_000;
const RECENT = 4;

export class Idle {
  readonly persona: Persona;
  private readonly rng: Rng;
  private glanceAt = 0;
  private moveAt = 0;
  private eventsSeen = 0;
  private readonly answered = new Map<string, number>();
  private readonly greeted = new Map<string, number>();
  private readonly recent: string[] = [];
  /** When the character last had something to do, and when something good last happened (a kill, a build). */
  private busySince = 0;
  private freeSince = 0;
  private wonAt = -Infinity;

  constructor(persona: Persona, seed = 1) {
    this.persona = persona;
    this.rng = new Rng(seed);
  }

  /** One tick: answers to others' emotes (always), and, lively and free, the idle's own. */
  tick(c: IdleContext): void {
    const b = c.belief;
    if (c.busy) this.busySince = b.now;
    else if (this.busySince >= this.freeSince) this.freeSince = b.now;
    this.answer(c);
    if (!c.lively || c.busy || !b.self) return;
    this.wander(c);
  }

  private get t(): Persona["traits"] {
    return this.persona.traits;
  }

  /** The events since last seen: invites, others' emotes, a win. */
  private answer(c: IdleContext): void {
    const b = c.belief, t = this.t;
    const events = b.events;
    const fresh = events.slice(Math.max(0, events.length - (b.eventCount - this.eventsSeen)));
    this.eventsSeen = b.eventCount;
    for (const e of fresh) {
      if (e.kind === "struck" && e.data.killed) this.wonAt = b.now;
      if (e.kind === "built") this.wonAt = b.now;
      if (e.kind === "invited") {
        const from = String(e.data.from ?? ""), name = String(e.data.with ?? e.data.name ?? "");
        const who = b.things.get(from);
        const owner = !!who?.name && c.owners.includes(who.name);
        const hostile = who?.disposition === "hostile";
        // An owner is always answered; anyone else as the persona is: a shy one says no to the close ones.
        const close = /hug|chest/.test(name);
        const yes = !c.busy && !c.danger && !hostile && (owner || (t.social >= 0.35 && !(close && t.shy > 0.5) && this.rng.next() < 0.4 + t.social * 0.6));
        c.trace("answer", { to: from, invite: name, yes, why: owner ? "owner" : hostile ? "hostile" : `social ${t.social}, shy ${t.shy}` });
        if (yes) c.act([{ control: "look", yaw: who ? wrap(b.yawTo(who.pos)) : (b.self?.yaw ?? 0) }, { control: "emote", name, target: from }], `answer ${name}`);
        else if (who && t.menacing > 0.5) c.act([{ control: "emote", name: emoteFor(b.emotes ?? [], ["taunt", "disapproval"], this.recent, this.rng)?.name ?? "head_shake" }], "refuse");
        continue;
      }
      if (e.kind === "emoted" && !c.busy && !c.danger) {
        const who = b.things.get(String(e.data.who ?? ""));
        const spec = b.emotes?.find((x) => x.name === e.data.name);
        // A pair's side played with this character is the pair itself, not something to answer.
        if (!who || !spec || spec.pair || who.kind !== "player" || b.distance(who.pos) > 14) continue;
        if ((this.answered.get(who.id) ?? -Infinity) + REPLY_COOLDOWN > b.now) continue;
        const reply = this.reply(spec, who, c);
        if (!reply) continue;
        this.answered.set(who.id, b.now);
        c.trace("answer", { to: who.id, their: spec.name, reply: reply.control === "emote" ? (reply.name ?? `join ${who.id}`) : reply.control });
        c.act([{ control: "look", yaw: wrap(b.yawTo(who.pos)) }, reply], `answer ${spec.name}`);
      }
    }
  }

  /** What to answer someone's emote with, as the persona is: a wave back, joining a dance, a cower at a roar. */
  private reply(spec: EmoteSpec, who: Remembered, c: IdleContext): Action | null {
    const list = c.belief.emotes ?? [], t = this.t, r = this.rng.next();
    const owner = !!who.name && c.owners.includes(who.name);
    if (spec.tags.includes("greeting") && (owner || r < t.social)) {
      const e = t.menacing > 0.6 && !owner ? emoteFor(list, ["taunt", "scary"], this.recent, this.rng) : t.shy > 0.6 ? emoteFor(list, "nod") : emoteFor(list, spec.name === "salute" ? "salute" : ["greeting"], [], this.rng);
      return e ? { control: "emote", name: e.name } : null;
    }
    if (spec.group && spec.tags.includes("dance") && r < t.playful) return { control: "emote", join: who.id };
    if (spec.tags.includes("scary") && !owner) {
      const e = t.shy > 0.5 ? emoteFor(list, ["scared", "reaction"]) : t.menacing > 0.5 ? emoteFor(list, ["scary"], this.recent, this.rng) : r < 0.5 ? emoteFor(list, "laugh") : null;
      return e ? { control: "emote", name: e.name, ...(e.loop ? { seconds: 3 } : {}) } : null;
    }
    if (spec.tags.includes("taunt") && t.menacing > 0.4 && !owner) {
      const e = emoteFor(list, ["taunt"], this.recent, this.rng);
      return e ? { control: "emote", name: e.name } : null;
    }
    if ((spec.tags.includes("victory") || spec.tags.includes("approval")) && r < t.social * 0.6) {
      const e = emoteFor(list, ["approval"], this.recent, this.rng);
      return e ? { control: "emote", name: e.name } : null;
    }
    return null;
  }

  /** The idle's own: glances as ever, and every so often a move that fits who is about. */
  private wander(c: IdleContext): void {
    const b = c.belief, self = b.self!;
    const about = b.find((x) => b.distance(x.pos) < 25 && b.age(x.seen) < 5000);
    const people = about.filter((x) => x.kind === "player").sort((p, q) => b.distance(p.pos) - b.distance(q.pos));
    if (b.now >= this.glanceAt) {
      this.glanceAt = b.now + GLANCE[0] + this.rng.next() * (GLANCE[1] - GLANCE[0]);
      const roll = this.rng.next();
      const at = roll < 0.4 && people.length ? people[0]! : roll < 0.75 && about.length ? about[Math.floor(this.rng.next() * about.length)]! : null;
      const yaw = at ? b.yawTo(at.pos) : self.yaw + (this.rng.next() - 0.5) * 1.6;
      const step = roll > 0.92 && !c.danger;
      c.act([{ control: "look", yaw: wrap(yaw), pitch: (this.rng.next() - 0.5) * 0.15 }, ...(step ? [{ control: "move" as const, forward: 0, strafe: this.rng.next() < 0.5 ? -1 : 1, duration_ms: 350 }] : [])], "idle");
    }
    const list = b.emotes ?? [];
    if (c.danger || !list.length) return;
    if (!this.moveAt) this.moveAt = b.now + this.gap();
    if (b.now < this.moveAt) return;
    this.moveAt = b.now + this.gap();
    const choice = this.choose(c, people);
    if (!choice) return;
    c.trace("idle", { persona: this.persona.name, ...choice.why });
    if ("routine" in choice) {
      c.perform(choice.routine, choice.target);
      return;
    }
    this.recent.unshift(choice.emote.name);
    this.recent.length = Math.min(this.recent.length, RECENT);
    const face = choice.target ? [{ control: "look" as const, yaw: wrap(b.yawTo(choice.target.pos)) }] : [];
    const seconds = choice.emote.loop ? Math.round(6 + this.rng.next() * (choice.long ? 40 : 10)) : undefined;
    c.act([...face, { control: "emote", name: choice.emote.name, ...(seconds ? { seconds } : {}) }], `idle ${choice.emote.name}`);
  }

  /** Between the idle's moves: an energetic one moves more often, and a long wait less so. */
  private gap(): number {
    const e = this.t.energetic;
    return (40_000 - 25_000 * e) * (0.6 + this.rng.next() * 0.8);
  }

  private choose(c: IdleContext, people: Remembered[]): { emote: EmoteSpec; target: Remembered | null; long?: boolean; why: Record<string, unknown> } | { routine: string; target: string | null; why: Record<string, unknown> } | null {
    const b = c.belief, t = this.t, list = b.emotes ?? [], rng = this.rng;
    const pick = (tags: string[], target: Remembered | null, why: string, long = false) => {
      const e = emoteFor(list, tags, this.recent, rng);
      return e ? { emote: e, target, long, why: { why, tags } } : null;
    };
    const routine = (r: Routine | undefined, target: Remembered | null, why: string) => (r && (r.needs === "none" || target) ? { routine: r.name, target: target?.id ?? null, why: { why, routine: r.name } } : null);
    // Just won: a victory move, or the lap.
    if (b.now - this.wonAt < 20_000 && rng.next() < 0.5 + t.showoff * 0.5) {
      this.wonAt = -Infinity;
      return rng.next() < t.showoff ? routine(ROUTINE.get("victory_lap"), null, "won") : pick(["victory"], null, "won");
    }
    const owner = people.find((p) => p.name && c.owners.includes(p.name));
    const stranger = people.find((p) => !(p.name && c.owners.includes(p.name)) && p.disposition !== "own");
    // Its own people, near: greeted once in a while, warmly or not as the persona is.
    if (owner && b.distance(owner.pos) < 14 && (this.greeted.get(owner.id) ?? -Infinity) + 300_000 < b.now) {
      this.greeted.set(owner.id, b.now);
      return pick(t.social > 0.6 ? ["greeting", "friendly"] : ["answer"], owner, "own person near");
    }
    // A stranger near: as the persona meets one.
    if (stranger && b.distance(stranger.pos) < 16) {
      const r = rng.next();
      if (t.shy > 0.6) return r < 0.5 ? routine(ROUTINE.get("shy_retreat"), stranger, "stranger, shy") : pick(["scared", "reaction"], stranger, "stranger, shy");
      if (t.menacing > 0.5) return r < 0.3 ? routine(ROUTINE.get(rng.next() < 0.5 ? "spooky_stalk" : "zombie_walk"), stranger, "stranger, menacing") : pick(["scary", "taunt"], stranger, "stranger, menacing");
      if (t.showoff > 0.6 && r < 0.4) return pick(["showoff", "dance"], stranger, "stranger, showing off");
      if (r < t.social) return pick(["greeting", "friendly"], stranger, "stranger, friendly");
      return null;
    }
    // Nobody near: by the persona, and by how long it has waited.
    const waited = b.now - this.freeSince;
    const r = rng.next();
    if (waited > 120_000 && r < 0.4) return rng.next() < 0.5 ? routine(ROUTINE.get("wait_bored"), null, "long wait") : pick(["rest"], null, "long wait", true);
    if (r < t.playful * 0.6) return t.showoff > 0.7 && rng.next() < 0.3 ? routine(ROUTINE.get("showoff_set"), null, "alone, playful") : pick(["dance", "silly", "fun"], null, "alone, playful");
    if (r < t.playful * 0.6 + t.energetic * 0.3) return rng.next() < 0.3 ? routine(ROUTINE.get("workout"), null, "alone, energetic") : pick(["exercise", "showoff"], null, "alone, energetic");
    if (r < 0.85) return pick(t.menacing > 0.6 ? ["scary", "idle"] : ["idle", "rest"], null, "alone");
    return null;
  }
}
