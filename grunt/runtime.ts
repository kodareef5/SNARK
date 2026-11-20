// The runtime: one character's mind below the Director. It holds the session, the belief, the body, the tasks, the
// monitors and the arbiter, and runs them on its own tick (10 a second). The Director (Pi's conversation) starts
// tasks and hears reports; it never sends controls.

import { CREATURES, WEAPONS } from "./know.ts";
import { Belief, compass, side } from "./belief.ts";
import { Body, type Run, type Wait } from "./body.ts";
import { MONITORS, type Monitor, type Signal } from "./monitors.ts";
import { type DecisionPolicy, RulesPolicy } from "./policy.ts";
import type { ChannelRequest, GameEvent, Observation, Outcome } from "./protocol.ts";
import { type Clock, type Session, systemClock } from "./session.ts";
import { SKILLS, type Skill, type SkillContext, type SkillResult } from "./skills.ts";
import { Trace } from "./trace.ts";

export const TICK_MS = 100;

export const SUBSCRIPTION: ChannelRequest = {
  self: { hz: 10 }, entities: { hz: 5, radius: 120, max: 60 }, focus: { hz: 10 }, inventory: { hz: 2 }, chat: {}, terrain: { hz: 1, radius: 12 },
};

export type TaskStatus = "running" | "suspended" | "done" | "blocked" | "failed" | "cancelled";

export interface Task {
  id: string;
  skill: string;
  args: Record<string, unknown>;
  status: TaskStatus;
  progress: Record<string, unknown>;
  result?: SkillResult;
  /** Who started it: the Director, or the arbiter answering a signal. */
  by: "director" | "arbiter";
  started: number;
  ended?: number;
}

export interface Report {
  kind: "task" | "danger" | "clear" | "addressed" | "need" | "critical" | "note" | "connection";
  text: string;
  data?: Record<string, unknown>;
  t: number;
}

interface Running {
  task: Task;
  gen: Run<SkillResult>;
  wait: Wait | null;
  waitFrom: number;
}

export interface RuntimeOptions {
  session: Session;
  clock?: Clock;
  policy?: DecisionPolicy;
  /** The policy the arbiter asks; its questions must be answered at once, so rules by default. */
  arbiterPolicy?: DecisionPolicy;
  trace?: Trace;
  skills?: Record<string, Skill>;
  monitors?: Monitor[];
  owners?: string[];
  onReport?: (r: Report) => void;
}

export class Runtime {
  readonly belief = new Belief();
  readonly body: Body;
  readonly trace: Trace;
  readonly tasks: Task[] = [];
  readonly reports: Report[] = [];
  name = "";
  /** What the character remembers of its fights: a player's own experience of what it can beat. */
  readonly fights: { foe: string; won: boolean; swings: number; weapon: string | null; health_lost: number }[] = [];
  private readonly session: Session;
  private readonly clock: Clock;
  private readonly policy: DecisionPolicy;
  private readonly arbiterPolicy: DecisionPolicy;
  private readonly skills: Record<string, Skill>;
  private readonly monitors: Monitor[];
  private readonly owners: string[];
  private readonly onReport: (r: Report) => void;
  private active: Running | null = null;
  private side: Running[] = [];
  private suspended: Task[] = [];
  private stopLoop: (() => void) | null = null;
  private lastSaid = new Map<string, number>();
  private n = 0;
  /** Set while the arbiter swaps one of its own tasks for another, so the swap does not bring back what was put aside. */
  private swapping = false;
  /** When the arbiter's task is over: what was put aside comes back once the character has caught its breath. */
  private restingSince: number | null = null;
  private dead = false;
  /** A task a dead danger blocked, to take up again on the next tick if nothing of the Director's is running. */
  private freed: { id: string; danger: string } | null = null;

  constructor(o: RuntimeOptions) {
    this.session = o.session;
    this.clock = o.clock ?? systemClock;
    this.policy = o.policy ?? new RulesPolicy();
    this.arbiterPolicy = o.arbiterPolicy ?? new RulesPolicy();
    this.trace = o.trace ?? new Trace();
    this.trace.gameTime = () => this.belief.now;
    this.skills = o.skills ?? SKILLS;
    this.monitors = o.monitors ?? MONITORS;
    this.owners = o.owners ?? [];
    this.onReport = o.onReport ?? (() => {});
    this.body = new Body(this.session, this.belief, this.trace);
    this.session.on("observation", (m: Observation) => {
      this.belief.observe(m);
      this.trace.record("observation", { seq: m.seq, channels: Object.keys(m.channels) });
    });
    this.session.on("event", (e: GameEvent) => {
      const was = typeof e.data.id === "string" ? this.belief.dangers.get(e.data.id) : undefined;
      this.belief.event(e);
      this.trace.record("event", { seq: e.seq, event: e.kind, data: e.data });
      // A danger that is gone frees what it blocked: the Director hears so, with the tasks it can take up again.
      if (was && e.kind === "notice" && !this.belief.dangers.has(String(e.data.id))) {
        const freed = this.tasks.filter((t) => t.status === "blocked" && (t.result?.data?.danger as { id?: string } | undefined)?.id === e.data.id);
        // What the danger blocked goes on by itself when nothing else of the Director's is running.
        // (A fight with the very creature that just died is over, whoever started it.)
        const busy = (t: Task | null) => !!t && t.by === "director" && !(t.skill === "fight" && t.args.target === e.data.id);
        const goes = freed.length && !busy(this.current) ? freed.at(-1)! : null;
        const others = freed.filter((t) => t !== goes);
        this.report({ kind: "clear", text: `the ${was.type} is dead${goes ? `; ${goes.skill} ${goes.id} goes on by itself` : ""}${others.length ? `; also free to go on: ${others.map((t) => `game_do {"resume": "${t.id}"} for the ${t.skill}`).join(", ")}` : ""}`, data: { id: e.data.id, freed: freed.map((t) => t.id) } });
        if (goes) this.freed = { id: goes.id, danger: String(e.data.id) };
      }
    });
    this.session.on("outcome", (o: Outcome) => this.trace.record("outcome", { command: o.command, index: o.index, status: o.status, by: o.by, code: o.code, detail: o.detail }));
  }

  /** Joins the game as `name` and subscribes to what the character perceives. */
  async connect(name: string): Promise<void> {
    const w = await this.session.hello(name);
    this.name = w.character.name;
    this.trace.record("connected", { game: w.game, character: w.character, limits: w.limits });
    // A game with a map screen: it is read now and then (under fog it grows as the character explores), and the ground
    // about the character more often, wider, since finding ways depends on it.
    const hasMap = w.capabilities.channels.includes("map");
    // The ground about the character as far as it sees it well (40 m), 2 m a letter: as fine as the nav map.
    const near = { radius: 40, cell: 2 };
    await this.session.subscribe(hasMap ? { ...SUBSCRIPTION, terrain: { hz: 2, ...near }, map: { hz: 0.2, cell: 4 } } : SUBSCRIPTION, ["*"]);
    if (hasMap) await this.session.observe({ map: { cell: 4 }, terrain: near }).then((o) => this.belief.observe(o));
    await this.session.observe({ self: {}, inventory: {}, entities: { radius: 120, max: 60 }, focus: {} }).then((o) => this.belief.observe(o));
  }

  /** Runs the tick on the runtime's clock until `halt`. */
  run(): void {
    this.stopLoop ??= this.clock.every(TICK_MS, () => this.tick());
  }

  halt(): void {
    this.stopLoop?.();
    this.stopLoop = null;
  }

  // --- Tasks ------------------------------------------------------------------------------------------------------

  /** Starts a skill as a task. A task that drives the body replaces the one driving it now. */
  start(skill: string, args: Record<string, unknown> = {}, by: Task["by"] = "director"): Task {
    const s = this.skills[skill];
    if (!s) throw new Error(`no skill ${skill}: ${Object.keys(this.skills).join(", ")}`);
    // The Director asking for what a reflex already does joins it: replacing it would drop what the reflex put aside.
    const a = this.active?.task;
    if (by === "director" && a?.by === "arbiter" && a.skill === skill && (skill === "flee" || a.args.target === args.target)) return a;
    const unknown = Object.keys(args).filter((k) => !(k in s.params));
    if (unknown.length) throw new Error(`${skill} takes ${Object.keys(s.params).join(", ") || "no arguments"}, not ${unknown.join(", ")}: ${JSON.stringify(s.params)}`);
    const task: Task = { id: `t${++this.n}`, skill, args, status: "running", progress: {}, by, started: this.belief.now };
    this.tasks.push(task);
    if (s.body) {
      if (this.active) {
        this.swapping = by === "arbiter";
        this.end(this.active, "cancelled", { status: "failed", summary: `replaced by ${skill}` });
        this.swapping = false;
      }
      this.restingSince = null;
      if (by === "director") for (const t of this.suspended.splice(0)) this.close(t, "cancelled", { status: "failed", summary: `replaced by ${skill}` });
      this.active = this.running(task);
    } else this.side.push(this.running(task));
    this.trace.record("task", { task: task.id, skill, args, status: "started", by });
    this.advanceAll();
    return task;
  }

  /** Takes up an earlier task where it was: same skill, arguments and progress (a harvest keeps the place it works). */
  retake(id: string): Task {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`no task ${id}`);
    if (task.status === "running") return task;
    if (task.status === "done") throw new Error(`${id} (${task.skill}) is done: ${task.result?.summary ?? ""}`);
    this.suspended = this.suspended.filter((t) => t !== task);
    if (this.skills[task.skill]!.body) {
      if (this.active) this.end(this.active, "cancelled", { status: "failed", summary: `replaced by ${task.skill}` });
      this.restingSince = null;
    }
    task.status = "running";
    delete task.result;
    delete task.ended;
    const r = this.running(task);
    if (this.skills[task.skill]!.body) this.active = r;
    else this.side.push(r);
    this.trace.record("task", { task: task.id, skill: task.skill, status: "retaken" });
    this.advanceAll();
    return task;
  }

  cancel(id?: string): Task | undefined {
    const r = id ? [this.active, ...this.side].find((x) => x?.task.id === id) : this.active;
    if (r) {
      this.end(r, "cancelled", { status: "failed", summary: "cancelled" });
      return r.task;
    }
    const s = this.suspended.find((t) => t.id === id);
    if (s) {
      this.suspended = this.suspended.filter((t) => t !== s);
      this.close(s, "cancelled", { status: "failed", summary: "cancelled" });
    }
    return s;
  }

  get current(): Task | null {
    return this.active?.task ?? null;
  }

  get waiting(): Task[] {
    return [...this.suspended];
  }

  private running(task: Task): Running {
    return { task, gen: this.skills[task.skill]!.run(this.context(task), task.args), wait: null, waitFrom: this.clock.now() };
  }

  private context(task: Task): SkillContext {
    return {
      belief: this.belief, body: this.body, progress: task.progress,
      decide: (point, candidates, state) => this.decideRun(point, candidates, state, task),
      note: (text, data) => this.report({ kind: "note", text, data: { task: task.id, ...data } }),
    };
  }

  private *decideRun(point: string, candidates: string[], state: Record<string, unknown>, task: Task): Run<string> {
    const t0 = this.clock.now();
    const r = this.policy.decide({ point, candidates, state });
    let choice = r instanceof Promise ? undefined : r;
    if (r instanceof Promise) {
      r.then((c) => (choice = c), () => (choice = { choice: candidates[0]!, why: "the policy failed" }));
      yield { until: () => choice !== undefined, ms: 20000 };
      choice ??= { choice: candidates[0]!, why: "the policy did not answer in time" };
    }
    const c = choice!;
    this.trace.record("decision", { task: task.id, point, candidates, state, choice: c.choice, scores: c.scores, why: c.why, policy: this.policy.name, ms: this.clock.now() - t0 });
    return candidates.includes(c.choice) ? c.choice : candidates[0]!;
  }

  private end(r: Running, status: TaskStatus, result: SkillResult): void {
    if (r === this.active) this.active = null;
    this.side = this.side.filter((x) => x !== r);
    try {
      r.gen.return(result);
    } catch {
      // a skill that throws on return has nothing left to do
    }
    this.close(r.task, status, result);
  }

  private close(task: Task, status: TaskStatus, result: SkillResult): void {
    task.status = status;
    task.result = result;
    task.ended = this.belief.now;
    this.trace.record("task", { task: task.id, skill: task.skill, status, result });
    if (task.skill === "fight" && result.data?.foe) this.fights.push({ foe: String(result.data.foe), won: !!result.data.won, swings: Number(result.data.swings ?? 0), weapon: (result.data.weapon as string | null) ?? null, health_lost: Number(result.data.health_lost ?? 0) });
    // A task the Director replaced or cancelled itself is no news to it: a note, not a report that wakes it.
    const known = status === "cancelled" && (result.summary === "cancelled" || result.summary.startsWith("replaced by"));
    // A reflex over with nothing put aside to come back: what next is the Director's, and it is told so.
    const resumes = task.by === "arbiter" && !this.swapping && !this.active && this.suspended.length > 0;
    const idle = task.by === "arbiter" && !this.swapping && !this.active && !this.suspended.length ? " Nothing was put aside: what next is yours." : "";
    if (status !== "cancelled" || task.by === "director") this.report({ kind: known ? "note" : "task", text: `${task.skill} ${task.id} ${status}: ${result.summary}${this.options(task, result)}${idle}`, data: { task: task.id, skill: task.skill, status, by: task.by, resumes, ...result.data } });
    // The arbiter's own task over, what it put aside comes back once the character has caught its breath (tick).
    if (task.by === "arbiter" && !this.swapping && !this.active && this.suspended.length) this.restingSince = this.belief.now;
  }

  /** What the Director can do about a blocked task, spelled out, so the choice is between real moves. */
  private options(task: Task, result: SkillResult): string {
    if (task.status !== "blocked") return "";
    const d = result.data?.danger as { id?: string; type?: string } | undefined;
    if (result.data?.reason === "danger" && d?.id) {
      const it = this.belief.things.get(d.id);
      const won = this.fights.filter((f) => f.foe === d.type && f.won);
      const health = it?.health !== undefined ? `, ${Math.round(it.health * 100)}% health` : "";
      return `. Options: fight it to clear the way (game_do fight {"target": "${d.id}"}${health}${won.length ? `; you have beaten ${won.length} ${d.type} before, losing ${won.at(-1)!.health_lost} health` : ""}), harvest somewhere else, or wait and game_do {"resume": "${task.id}"}.`;
    }
    if (result.data?.reason === "weight") return ". Options: craft something from the materials, or put things in a box.";
    if (result.data?.reason === "materials") return `. Options: game_do gather {"items": ${JSON.stringify(result.data.bill ?? {})}} gathers the whole list in one task; then game_do {"resume": "${task.id}"}.`;
    return "";
  }

  private suspend(): void {
    const r = this.active;
    if (!r) return;
    this.active = null;
    try {
      r.gen.return({ status: "done", summary: "suspended" });
    } catch {
      // nothing to clean
    }
    r.task.status = "suspended";
    this.suspended.push(r.task);
    this.body.stop("suspend");
    this.trace.record("task", { task: r.task.id, skill: r.task.skill, status: "suspended" });
  }

  private resume(): void {
    const task = this.suspended.pop()!;
    task.status = "running";
    this.active = this.running(task);
    this.trace.record("task", { task: task.id, skill: task.skill, status: "resumed" });
    this.report({ kind: "note", text: `back to ${task.skill}`, data: { task: task.id } });
  }

  // --- The tick ---------------------------------------------------------------------------------------------------

  tick(): void {
    if (!this.session.welcome) return;
    if (this.belief.self && !this.belief.self.alive) {
      if (!this.dead) {
        this.dead = true;
        const why = this.belief.since(-Infinity, "died").at(-1)?.data;
        for (const r of [this.active, ...this.side]) if (r) this.end(r, "failed", { status: "failed", summary: "I died" });
        for (const t of this.suspended.splice(0)) this.close(t, "failed", { status: "failed", summary: "I died" });
        this.restingSince = null;
        this.report({ kind: "critical", text: `I died${why?.by ? ` (${String(why.by)})` : ""}`, data: { ...why } });
      }
      return;
    }
    this.dead = false;
    if (this.freed) {
      const f = this.freed, cur = this.current;
      const over = !cur || !(cur.by === "director" && !(cur.skill === "fight" && cur.args.target === f.danger));
      if (over && this.tasks.find((t) => t.id === f.id)?.status === "blocked") {
        this.freed = null;
        this.retake(f.id);
      } else if (!over || this.tasks.find((t) => t.id === f.id)?.status !== "blocked") this.freed = null;
    }
    const signals = this.monitors.flatMap((m) => m(this.belief, { name: this.name, owners: this.owners }));
    this.arbitrate(signals);
    if (this.restingSince !== null && !this.active && this.suspended.length) {
      const calm = !signals.some((x) => x.kind === "danger" && x.urgency >= 0.4);
      if (calm && (this.belief.vital("stamina") >= 0.6 || this.belief.now - this.restingSince > 15000)) {
        this.restingSince = null;
        this.resume();
      }
    }
    this.advanceAll();
  }

  private advanceAll(): void {
    if (this.active) this.advance(this.active);
    for (const r of [...this.side]) this.advance(r);
  }

  private advance(r: Running): void {
    for (let i = 0; i < 64; i++) {
      if (r.wait) {
        const elapsed = this.clock.now() - r.waitFrom;
        const ready = "until" in r.wait ? r.wait.until() || (r.wait.ms !== undefined && elapsed >= r.wait.ms) : elapsed >= r.wait.ms;
        if (!ready) return;
      }
      let step: IteratorResult<Wait, SkillResult>;
      try {
        step = r.gen.next();
      } catch (err) {
        this.end(r, "failed", { status: "failed", summary: `the skill broke: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      if (step.done) {
        this.end(r, step.value.status, step.value);
        return;
      }
      r.wait = step.value;
      r.waitFrom = this.clock.now();
      if (r !== this.active && !this.side.includes(r)) return;
    }
  }

  /** What signals do: the ladder, then a decision point for what it leaves open. */
  private arbitrate(signals: Signal[]): void {
    const danger = signals.filter((s) => s.kind === "danger").sort((a, b) => b.urgency - a.urgency)[0];
    const doing = this.active?.task.skill;
    // Fleeing, the question comes again only when it is on the character; fighting, the fight decides for itself.
    const ask = danger && doing !== "fight" && (doing !== "flee" || danger.urgency >= 0.9);
    if (danger && ask) {
      const state = { signal: danger.kind, urgency: danger.urgency, ...danger.detail, task: doing ?? null };
      let go = doing === "flee";
      if (!go) {
        const d = this.arbiterPolicy.decide({ point: "arbiter.interrupt", candidates: ["interrupt", "continue"], state });
        const c = d instanceof Promise ? { choice: danger.urgency >= 0.6 ? "interrupt" : "continue", why: "an arbiter policy must answer at once" } : d;
        if (c.choice === "interrupt") this.trace.record("decision", { point: "arbiter.interrupt", candidates: ["interrupt", "continue"], state, choice: c.choice, scores: c.scores, why: c.why, policy: this.arbiterPolicy.name, ms: 0 });
        go = c.choice === "interrupt";
      }
      if (go) this.respond(danger, doing);
    }
    for (const s of signals) {
      if (s.kind === "addressed") {
        const who = this.belief.find((t) => t.kind === "player" && t.name === s.detail.from)[0];
        const where = who ? `${who.id}, ${s.detail.owner ? "an owner, " : ""}${Math.round(this.belief.distance(who.pos))} m ${compass(this.belief.yawTo(who.pos))}` : s.detail.owner ? "an owner, not in sight" : "not in sight";
        this.report({ kind: "addressed", text: `${s.detail.from} (${where}): "${s.detail.text}"`, data: { ...s.detail, ...(who ? { id: who.id } : {}) } });
      }
      else if (s.kind === "critical") this.once(`critical`, 30000, { kind: "critical", text: `badly hurt (${Math.round(Number(s.detail.health) * 100)}% health)`, data: s.detail });
      else if (s.kind === "need") this.once(`need:${s.detail.need}`, 600000, { kind: "need", text: `I need to ${s.detail.need}`, data: s.detail });
    }
  }

  /** Flee or fight: asked when a danger interrupts, and again while fleeing when it is on the character. */
  private respond(danger: Signal, doing: string | undefined): void {
    const b = this.belief;
    const it = danger.about ? b.things.get(danger.about) : undefined;
    const held = b.self?.held?.item ?? "";
    const armed = WEAPONS.includes(held) || WEAPONS.some((w) => b.slotOf(w) !== null);
    // How often this very creature has had the character running, and whether such a fight is known to be won.
    const chased = it ? this.tasks.filter((t) => t.skill === "flee" && t.by === "arbiter" && t.args.from === it.id).length : 0;
    const had = it ? this.fights.filter((f) => f.foe === it.type) : [];
    const beatable = had.length ? had.some((f) => f.won) : !!(it && CREATURES[it.type]?.beatable);
    const candidates = it ? ["flee", "fight", "ignore"] : ["flee", "ignore"];
    const state = {
      health: Math.round(b.vital("health") * 100) / 100, stamina: Math.round(b.vital("stamina") * 100) / 100, armed,
      distance: it ? Math.round(b.distance(it.pos) * 10) / 10 : (danger.detail.distance ?? null), its_health: it?.health ?? null, what: it?.type ?? danger.detail.heard ?? null, doing: doing ?? null, chased, beatable,
    };
    const r = this.arbiterPolicy.decide({ point: "threat.respond", candidates, state });
    const c = r instanceof Promise ? { choice: "flee", why: "an arbiter policy must answer at once" } : r;
    const choice = candidates.includes(c.choice) ? c.choice : "flee";
    if (choice === doing) return;
    this.trace.record("decision", { point: "threat.respond", candidates, state, choice, why: c.why, policy: this.arbiterPolicy.name, ms: 0 });
    if (choice === "ignore") return;
    const what = String(state.what ?? "something");
    const where = it ? `, ${compass(b.yawTo(it.pos))}` : danger.yaw !== undefined ? `, heard to the ${compass(danger.yaw)}` : "";
    const aside = () => {
      const t = this.suspended.at(-1) ?? null;
      return t ? `; ${t.skill} ${t.id} is put aside and comes back by itself once it is safe` : "";
    };
    if (choice === "fight") {
      if (doing !== "flee") this.suspend();
      const t = this.start("fight", { target: danger.about }, "arbiter");
      this.report({ kind: "danger", text: `${what} ${state.distance ?? "?"} m off${where} ${c.why ? `: ${c.why}` : ""} — handled: fighting (fight ${t.id})${aside()}.`, data: { ...danger.detail, ...state, handled: true } });
      return;
    }
    this.suspend();
    const t = this.start("flee", { ...(danger.about ? { from: danger.about } : {}), ...(danger.yaw !== undefined ? { yaw: danger.yaw } : {}) }, "arbiter");
    this.report({ kind: "danger", text: `${what} ${state.distance ?? "?"} m off${where} — handled: running (flee ${t.id})${aside()}. Nothing for you to do unless you want something else.`, data: { ...danger.detail, ...state, handled: true } });
  }

  private once(key: string, every: number, r: Omit<Report, "t">): void {
    if (this.belief.now - (this.lastSaid.get(key) ?? -Infinity) < every) return;
    this.lastSaid.set(key, this.belief.now);
    this.report(r);
  }

  private report(r: Omit<Report, "t">): void {
    const full = { ...r, t: this.belief.now };
    this.reports.push(full);
    this.trace.record("report", { report: full });
    this.onReport(full);
  }

  /** The character as the Director should know it: one compact view. */
  /** How a fight with a creature of this kind would go, as the character knows: its own fights first, else lore. */
  odds(type: string): string {
    const had = this.fights.filter((f) => f.foe === type);
    if (had.length) {
      const won = had.filter((f) => f.won);
      const lost = Math.round(had.reduce((n, f) => n + f.health_lost, 0) / had.length);
      return `you won ${won.length} of ${had.length} such fights, losing about ${lost} health each`;
    }
    const lore = CREATURES[type];
    if (!lore) return "unknown: you have never fought one";
    const armed = WEAPONS.some((w) => this.belief.count(w) > 0);
    return `${armed ? lore.armed : lore.unarmed} (what players know; you have not fought one)`;
  }

  summary(): Record<string, unknown> {
    const b = this.belief, s = b.self;
    // What matters first (the hostile, people, rides, boxes), then the nearest of the rest: the senses reach far now.
    const rank = (t: { disposition?: string; kind: string; tags?: string[] }) => (t.disposition === "hostile" ? 0 : t.kind === "player" ? 1 : t.tags?.includes("rideable") ? 2 : t.kind === "container" ? 3 : 4);
    const all = b.find(() => true);
    const near = [...all.filter((t) => rank(t) < 4), ...all.filter((t) => rank(t) === 4).slice(0, 12)].slice(0, 24).map((t) => ({
      id: t.id, type: t.type, ...(t.name ? { name: t.name } : {}), distance: Math.round(b.distance(t.pos) * 10) / 10,
      dir: compass(b.yawTo(t.pos)), side: side(b.bearingTo(t.pos)), ...(t.disposition ? { disposition: t.disposition } : {}),
      ...(t.kind === "creature" && t.health !== undefined ? { health: `${Math.round(t.health * 100)}%` } : {}),
      ...(t.tags?.includes("hunting") ? { hunting: true } : {}),
      ...(t.kind === "creature" && t.disposition === "hostile" ? { fight: this.odds(t.type) } : {}),
      ...(b.age(t.seen) > 3000 ? { seen_s_ago: Math.round(b.age(t.seen) / 1000) } : {}),
    }));
    return {
      name: this.name, alive: s?.alive ?? null, axes: "pos is [x, height, z]: x grows to the east, z to the south (north is -z)",
      pos: s ? s.pos.map((v) => Math.round(v * 10) / 10) : null, yaw: s ? Math.round(s.yaw * 100) / 100 : null,
      vitals: s ? Object.fromEntries(Object.entries(s.vitals).map(([k, v]) => [k, `${Math.round(v[0])}/${v[1]}`])) : null,
      held: s?.held?.item ?? null,
      inventory: (b.inventory?.slots ?? []).map((x) => `${x.item}×${x.count}`),
      can_craft: (b.inventory?.craftable ?? []).filter((r) => r.can > 0).map((r) => `${r.item} (${r.can})`),
      near,
      doing: this.current ? { task: this.current.id, skill: this.current.skill, by: this.current.by === "arbiter" ? "reflex" : "you", args: this.current.args, progress: this.current.progress } : null,
      put_aside: this.suspended.map((t) => ({ task: t.id, skill: t.skill })),
      blocked: this.tasks.filter((t) => t.status === "blocked").slice(-3).map((t) => ({ task: t.id, skill: t.skill, why: t.result?.summary })),
      remembers: { fights: this.fights.slice(-5) },
    };
  }
}
