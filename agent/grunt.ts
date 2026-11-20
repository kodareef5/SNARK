// A SNARK survivor as a grunt protocol world (grunt/protocol.md, grunt/endpoint.ts): what the survivor perceives as the
// protocol's channels, and the protocol's controls as the inputs and commands a browser sends, through the headless
// client an Agent drives (agent/tools.ts). It has no powers a player lacks: the server decides what the client is sent,
// and every control is a player's. The assists are the Agent's own tasks (its attack walks up and strikes, or keeps its
// distance and aims ahead with a bow), worked a tick at a time with the inputs a player has.
//
// SNARK's frame has x growing west and z north, and a yaw that falls turning east; the protocol's has x east, z south
// and a yaw that rises turning east. Positions and yaws are turned here, both ways.

import type { GameWorld, WorldEvent } from "../grunt/endpoint.ts";
import type {
  Action, Building, Capabilities, ChatLine, Craftable, FormSpec, Plan, EntitiesChannel, Entity, FocusChannel, Interruption, InventoryChannel, MapChannel,
  RejectCode, SelfChannel, Slot, TerrainChannel,
} from "../grunt/protocol.ts";
import { ownIndex } from "../client/core/session.ts";
import type { ItemDef } from "../shared/content/defs.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_PRIMARY, BTN_SECONDARY, BTN_SPRINT, STAMINA_UNITS } from "../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_WATER } from "../shared/sim/vitals.ts";
import type { Answer } from "./mcp.ts";
import { observe, shortName } from "./observe.ts";
import { Planner } from "./plan.ts";
import type { Agent } from "./tools.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../shared/coords.ts";
import { Found } from "../shared/world/structures.ts";
import { Support } from "../shared/world/support.ts";

/** SNARK's position to the protocol's, and back. */
const toG = (x: number, z: number): [number, number] => [-x, -z];
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

const CHANNEL_OF: Record<number, string> = { [TEXT_GLOBAL]: "global", [TEXT_LOCAL]: "local", [TEXT_TRIBE]: "group" };

/** What a letter of the agent's floor picture is, by the names grunt's navigation knows (grunt/nav.ts). */
const LEGEND: Record<string, string> = {
  ".": "walkable", "#": "blocked", "^": "blocked", "~": "deep_water", T: "tree", R: "rock", b: "bush", c: "creature", P: "player",
  B: "container", "@": "self", "?": "unknown", " ": "blocked", "-": "walkable", "+": "walkable",
};

/** What the agent's lists of things are, as protocol entity kinds. */
const KIND_OF_LIST: Record<string, Entity["kind"]> = {
  terminal: "structure", station: "structure", box: "container", bed: "structure", door: "structure", stairs: "structure",
  creature: "creature", car: "vehicle", body: "item", egg: "item", player: "player",
};

interface Running {
  command: string;
  index: number;
  action: Action;
  started: number;
  until: number;
  done: Record<string, unknown>;
}

export class SnarkWorld implements GameWorld {
  tick = 0;
  t = 0;
  readonly heardChat: ChatLine[] = [];
  readonly me: { id: string; name: string; alive: boolean };
  readonly agent: Agent;
  /** The first step's time: the clock counts from it (a test steps on virtual time). */
  private start = -1;
  private readonly listeners: ((e: WorldEvent) => void)[] = [];
  private readonly instants: WorldEvent[] = [];
  /** Held controls: a move, a look, a jump, a press of a hand, each until its time. */
  private readonly held = new Map<string, Running>();
  /** The one task the Agent runs for an action (a skill's hands): its command and index, ended when another starts. */
  private task: { command: string; index: number; id: number } | null = null;
  private tasks = 0;
  private crouching = false;
  private logSeen = 0;
  private wasAlive = true;
  /** The container the character opened last (the session does not name it). */
  private openedId: string | null = null;
  private readonly planner: Planner;
  private buildingCache: Building | undefined;
  private readonly found = new Found();
  /** Each of the tribe's pieces' health as last seen, for damage told as it happens. */
  private readonly hpSeen = new Map<number, number>();
  private damageAt = 0;
  /** Waits by the world's clock (a test steps it on virtual time). */
  private readonly sleepers: { at: number; wake: () => void }[] = [];

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((wake) => this.sleepers.push({ at: this.t + ms, wake }));
  }

  constructor(agent: Agent, name: string) {
    this.agent = agent;
    this.me = { id: "", name, alive: true };
    agent.onEvent = (ev) => this.combat(ev);
    this.planner = new Planner(agent.session);
  }

  on(fn: (e: WorldEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: WorldEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private event(kind: string, data: Record<string, unknown>): void {
    this.emit({ type: "event", kind, data });
  }

  private get s() {
    return this.agent.session;
  }

  // --- The clock -------------------------------------------------------------------------------------------------

  /** At the frame rate: the held controls as the survivor's inputs, the session stepped, what happened told. */
  step(now: number): void {
    if (this.start < 0) this.start = now;
    this.t = Math.round(now - this.start);
    this.tick++;
    const s = this.s;
    if (s.state === "active" && s.world) this.me.id = `e${this.ownId()}`;
    this.me.alive = s.sessionState === SESSION_ALIVE;
    // Held controls run out; their outcomes are told.
    for (const [key, r] of [...this.held]) {
      if (key === "look") {
        const off = Math.abs(wrap(Number(r.done.want) - this.agent.controller.yaw));
        if (off < 0.02 || this.t >= r.until) {
          this.held.delete(key);
          this.outcome({ ...r, done: {} }, off < 0.02 ? "completed" : "interrupted", { yaw: wrap(-this.agent.controller.yaw) });
        }
        continue;
      }
      if (this.t >= r.until) {
        this.held.delete(key);
        if (key === "move") {
          const moved = Math.round(Math.hypot(s.own.x - Number(r.done.x0), s.own.z - Number(r.done.z0)) * 10) / 10;
          this.outcome({ ...r, done: { moved_m: moved } }, "completed");
        } else this.outcome(r, "completed");
      }
    }
    this.agent.manual = this.inputs();
    this.agent.tick(now);
    this.hear();
    this.watchDamage();
    for (let i = this.sleepers.length - 1; i >= 0; i--) if (this.t >= this.sleepers[i]!.at) this.sleepers.splice(i, 1)[0]!.wake();
    if (this.wasAlive && !this.me.alive) this.event("died", { by: null, pos: this.selfChannel().pos });
    this.wasAlive = this.me.alive;
  }

  /** The inputs the held controls make: a move relative to the facing, the look, the buttons held. */
  private inputs(): Agent["manual"] {
    const m = this.held.get("move")?.action, l = this.held.get("look")?.action;
    const jump = this.held.has("jump"), hand = this.held.get("hands")?.action;
    if (!m && !l && !jump && !hand && !this.crouching) return null;
    const c = this.agent.controller;
    // The look turns the body at a player's rate: a step of at most 6 rad/s toward the wanted yaw.
    let yaw = c.yaw;
    const want = this.held.get("look")?.done.want;
    if (l && typeof want === "number") yaw = c.yaw + Math.sign(wrap(want - c.yaw)) * Math.min(Math.abs(wrap(want - c.yaw)), 6 / 60);
    let buttons = 0;
    if (m?.control === "move" && m.sprint) buttons |= BTN_SPRINT;
    if (jump) buttons |= BTN_JUMP;
    if (this.crouching) buttons |= BTN_CROUCH;
    if (hand?.control === "use") buttons |= hand.hand === "secondary" ? BTN_SECONDARY : BTN_PRIMARY;
    return { moveX: m?.control === "move" ? m.strafe : 0, moveZ: m?.control === "move" ? m.forward : 0, yaw, pitch: l?.control === "look" && typeof l.pitch === "number" ? -l.pitch : 0, buttons };
  }

  private ownId(): number {
    return ownIndex(this.s);
  }

  /** Chat and notices since last heard: "Name: line" split, the speaker found by name among the players in view. */
  private hear(): void {
    const s = this.s;
    const fresh = Math.min(s.log.length, s.logVersion - this.logSeen);
    this.logSeen = s.logVersion;
    for (const l of fresh > 0 ? s.log.slice(-fresh) : []) {
      if (l.channel === TEXT_NOTICE) {
        this.event("notice", { text: l.text, level: "info" });
        continue;
      }
      const channel = CHANNEL_OF[l.channel];
      if (!channel) continue;
      const at = l.text.indexOf(": ");
      const from = at > 0 ? l.text.slice(0, at) : "?";
      const text = at > 0 ? l.text.slice(at + 2) : l.text;
      const r = this.agent.remote;
      let from_id: string | undefined;
      for (let i = 0; i < r.count; i++) if (r.name[i] === from) from_id = `e${r.id[i]}`;
      const line: ChatLine = { channel, from, ...(from_id ? { from_id } : {}), text, t: this.t };
      this.heardChat.push(line);
      if (this.heardChat.length > 500) this.heardChat.shift();
      this.event("chat", { ...line });
    }
  }

  /** A combat event from the session: hurt as the protocol's hurt, a hit or a kill as struck and notice. */
  private combat(ev: Agent["session"]["events"][number]): void {
    const e = ev as unknown as { kind: number; damage?: number; kill?: boolean; name?: string; bearing?: number; side?: boolean };
    const health = this.vital(V_HEALTH);
    // Kinds by the shape of the event: a hurt carries a bearing; a hit, a kill flag.
    if (typeof e.bearing === "number" && e.damage !== undefined) this.event("hurt", { amount: Math.round(e.damage), health: health ? Math.round(health[0]) : null, by: null, kind: "melee", bearing: e.side ? -((e.bearing / 256) * Math.PI * 2) : null });
    else if (e.kill !== undefined && (e.damage ?? 0) > 0) this.event("struck", { damage: Math.round(e.damage!), killed: !!e.kill });
    else if (e.name) this.event("notice", { text: `you killed ${e.name}`, level: "info" });
  }

  // --- Acting ----------------------------------------------------------------------------------------------------

  act(command: string, index: number, a: Action): RejectCode | null {
    const s = this.s;
    if (s.state !== "active") return "no_body";
    if (!this.me.alive && a.control !== "chat" && a.control !== "stop") return "no_body";
    const hold = "duration_ms" in a ? a.duration_ms : "hold_ms" in a ? a.hold_ms : undefined;
    if (hold !== undefined && (hold < 0 || hold > 2000)) return "too_long";
    const instant = (detail: Record<string, unknown> = {}) => {
      this.instants.push({ type: "outcome", command, index, status: "completed", detail });
      return null;
    };
    const held = (key: string, ms: number, done: Record<string, unknown> = {}) => {
      const was = this.held.get(key);
      if (was) this.outcome(was, "interrupted", {}, "replaced");
      this.endTask("replaced");
      this.held.set(key, { command, index, action: a, started: this.t, until: this.t + ms, done });
      return null;
    };
    switch (a.control) {
      case "move":
        return held("move", a.duration_ms, { x0: s.own.x, z0: s.own.z });
      case "look": {
        const want = typeof a.yaw === "number" ? -a.yaw : this.agent.controller.yaw - (a.yaw_delta ?? 0);
        return held("look", 3000, { want: wrap(want) });
      }
      case "jump":
        return held("jump", a.hold_ms ?? 100);
      case "crouch":
        this.crouching = a.on;
        return instant({ on: a.on });
      case "use":
        return held("hands", a.hold_ms ?? 300);
      case "stop":
        this.releaseAll("stop");
        return instant();
      case "chat":
        return this.call(command, index, "say", { channel: a.channel === "group" ? "tribe" : a.channel, text: a.text });
      case "craft":
        return this.call(command, index, "craft", { recipe: a.item, count: a.count, learn: true, wait_s: 50 });
      case "select": {
        // Taking a slot in hand is using what is in it (a weapon or a tool is taken in hand).
        const item = this.itemAt(a.slot);
        return item ? this.call(command, index, "use_item", { item }) : "missing_items";
      }
      case "interact": {
        if (a.verb === "open") return this.call(command, index, "open", { id: a.target, wait_s: 50 }, () => (this.openedId = a.target));
        if (a.verb === "harvest") return this.call(command, index, "harvest", { id: a.target, wait_s: 50 });
        if (a.verb === "mount") return this.call(command, index, "mount", { id: a.target, wait_s: 50 });
        if (a.verb === "dismount") return this.call(command, index, "mount", { off: true, wait_s: 25 });
        if (a.verb === "close") return (this.openedId = null), instant();
        if (a.verb === "lock" || a.verb === "unlock") return this.call(command, index, "structure", { id: a.target, do: a.verb, wait_s: 25 });
        return "not_permitted";
      }
      case "items":
        if (a.op === "transfer") return this.transfer(command, index, a);
        if (a.op === "move") return this.call(command, index, "move_item", { from: a.from === "open" ? "box" : "self", slot: a.slot, to: a.to === "open" ? "box" : a.to ?? "self", ...(a.count ? { count: a.count } : {}) });
        if (a.op === "drop") return this.call(command, index, "move_item", { from: "self", slot: a.slot, to: "ground", ...(a.count ? { count: a.count } : {}) });
        if (a.op === "consume") {
          const item = this.itemAt(a.slot);
          return item ? this.call(command, index, "use_item", { item }) : "missing_items";
        }
        return "not_permitted";
      case "assist": {
        if (a.kind === "attack") return this.call(command, index, "attack", { id: a.target, until: "dead", wait_s: 50 }, undefined, true);
        if (a.kind === "harvest") {
          // The right tool for what it is, if carried: a pick for stone (flint comes only so), a hatchet for wood.
          const want = this.material(a.target) === "rock" ? ["metal_pick", "pick", "metal_hatchet", "hatchet"] : ["metal_hatchet", "hatchet", "metal_pick", "pick"];
          const tool = want.find((t) => (this.s.inventory?.total(this.s.registry.index.get(`core:${t}`) ?? -1) ?? 0) > 0);
          return this.call(command, index, "harvest", { id: a.target, ...(tool ? { tool } : {}), wait_s: 50 }, undefined, true);
        }
        if (a.kind === "follow") return this.follow(command, index, a);
        if (a.kind === "repair") return this.repairBase(command, index, a.target);
        return "unknown_control";
      }
      case "plan":
        return this.plan(command, index, a, instant);
      default:
        return "unknown_control";
    }
  }

  /** The item in a slot of the bag, by the name the protocol uses. */
  private itemAt(slot: number): string | null {
    const inv = this.s.inventory;
    const k = inv && slot >= 0 && slot < inv.cap ? inv.item[slot]! : 0;
    return k ? shortName(this.s.registry.ids[k]) : null;
  }

  /** A protocol action done by one of the Agent's tools: its answer, waited for to the end, is the outcome. */
  private call(command: string, index: number, tool: string, args: Record<string, unknown>, onDone?: () => void, task = false): RejectCode | null {
    if (task) this.endTask("replaced");
    const id = ++this.tasks;
    if (task) this.task = { command, index, id };
    const first = this.agent.call(tool, args);
    if (!first) return "unknown_control";
    void (async () => {
      let a: Answer = await first;
      // A long task answers "running" at its wait; it is waited on until it ends.
      while (a.state === "running" && (!task || this.task?.id === id)) a = (await this.agent.call("status", { wait_s: 50 })) ?? { state: "blocked", reason: "no status" };
      if (task && this.task?.id !== id) return;
      if (task) this.task = null;
      // A node already used up is done with, not in the way.
      if (a.state !== "done" && /used up|never there/.test(String(a.reason ?? ""))) a = { state: "done", node: "gone", gained: {} };
      const { state, ...rest } = a;
      if (state === "done") onDone?.();
      this.emit({
        type: "outcome", command, index, status: state === "done" ? "completed" : "failed",
        ...(state === "done" ? {} : { code: state === "refused" ? "not_permitted" : "blocked" }),
        // The agent says "gathered"; the protocol, "gained".
        detail: { ...rest, ...(rest.gathered ? { gained: rest.gathered } : {}), ...(task ? { result: resultOf(tool, state, rest) } : {}) },
      });
    })();
    return null;
  }

  /** "Transfer all" with a filter: each matching stack moved, one move_item after another. */
  private transfer(command: string, index: number, a: Extract<Action, { control: "items"; op: "transfer" }>): RejectCode | null {
    const s = this.s;
    const from = a.from === "self" ? s.inventory : s.open?.inventory;
    if (!from || !s.open) return "not_permitted";
    const reg = s.registry;
    const kept = new Map(Object.entries(a.keep ?? {}));
    const moves: { slot: number; item: string; count: number }[] = [];
    for (let slot = 0; slot < from.cap; slot++) {
      const kind = from.item[slot]!;
      if (kind === 0) continue;
      const item = shortName(reg.ids[kind]);
      if (a.items && !a.items.includes(item)) continue;
      if (a.kinds && !a.kinds.includes(kindOf(reg.defs[kind] as ItemDef | null))) continue;
      let count = from.count[slot]!;
      const keep = kept.get(item) ?? 0;
      if (keep > 0) {
        const k = Math.min(keep, count);
        kept.set(item, keep - k);
        count -= k;
      }
      if (count > 0) moves.push({ slot, item, count });
    }
    void (async () => {
      const moved: Record<string, number> = {};
      let reason: string | null = null;
      // From the highest slot down, so a stack moved does not shift the next one's slot.
      for (const m of moves.sort((x, y) => y.slot - x.slot)) {
        const r = await this.agent.call("move_item", { from: a.from === "self" ? "self" : "box", slot: m.slot, to: a.to === "self" ? "self" : "box", count: m.count });
        if (!r || r.state !== "done") {
          reason = r?.state === "refused" && /full|room|weight|heavy/i.test(String(r.reason)) ? "full" : String(r?.reason ?? "refused");
          break;
        }
        moved[m.item] = (moved[m.item] ?? 0) + m.count;
      }
      this.emit({ type: "outcome", command, index, status: "completed", detail: { moved, reason } });
    })();
    return null;
  }

  /** Following: go_to the target, again and again, as long as asked; a little variation in how near it keeps. */
  private follow(command: string, index: number, a: Extract<Action, { control: "assist" }>): RejectCode | null {
    this.endTask("replaced");
    const id = ++this.tasks;
    this.task = { command, index, id };
    const [near, far] = a.range ?? [2.5, 6];
    const until = this.t + (a.until?.seconds ?? 600) * 1000;
    void (async () => {
      let result = "seconds";
      while (this.task?.id === id && this.t < until) {
        const within = near + Math.random() * (far - near);
        const r = (await this.agent.call("go_to", { id: a.target, within, run: true, wait_s: 10 })) ?? { state: "blocked" };
        if (r.state === "refused" || (r.state === "blocked" && /sight|gone/.test(String(r.reason)))) {
          result = "lost";
          break;
        }
        // Waiting: a moment before following on.
        await this.sleep(600 + Math.random() * 1200);
      }
      if (this.task?.id !== id) return;
      this.task = null;
      this.emit({ type: "outcome", command, index, status: result === "seconds" ? "completed" : "failed", ...(result === "seconds" ? {} : { code: "blocked" as const }), detail: { result } });
    })();
    return null;
  }

  // --- Building ---------------------------------------------------------------------------------------------------

  /** The capabilities, with the building this server's content has (agent/plan.ts). */
  capabilities(base: Capabilities): Capabilities {
    return { ...base, building: (this.buildingCache ??= this.planner.building()) };
  }

  private specs(): Map<string, FormSpec> {
    return new Map((this.capabilities({} as Capabilities).building!.forms ?? []).map((f) => [f.form, f]));
  }

  /** The plan control: check a whole plan at once; build it piece by piece; take pieces down. */
  private plan(command: string, index: number, a: Extract<Action, { control: "plan" }>, instant: (d: Record<string, unknown>) => null): RejectCode | null {
    if (!a.plan?.anchor || !Array.isArray(a.plan.pieces) || a.plan.pieces.length > 400) return "bad_arguments";
    if (a.op === "upgrade") return "not_permitted";
    if (a.op === "check") {
      const { verdicts, base } = this.planner.check(a.plan, this.specs());
      const s = this.s;
      const need: Record<string, number> = {};
      a.plan.pieces.forEach((p, k) => verdicts[k]!.status !== "built" && (need[p.item] = (need[p.item] ?? 0) + 1));
      const have = Object.fromEntries(Object.keys(need).map((i) => [i, s.inventory?.total(s.registry.index.get(`core:${i}`) ?? -1) ?? 0]));
      return instant({ verdicts, base, need, have });
    }
    if (a.op === "remove") return this.removePieces(command, index, a);
    this.endTask("replaced");
    const id = ++this.tasks;
    this.task = { command, index, id };
    void this.buildPlan(command, index, id, a.plan, Math.max(0, a.from ?? 0), Math.min(a.plan.pieces.length - 1, a.to ?? a.plan.pieces.length - 1));
    return null;
  }

  /** Places a plan's pieces from `from` to `to`, each judged against what stands now, at the advertised pace. */
  private async buildPlan(command: string, index: number, id: number, plan: Plan, from: number, to: number): Promise<void> {
    const specs = this.specs(), pl = this.planner, s = this.s;
    const f = pl.frame(plan);
    const done = { placed: 0, ids: [] as string[], at: from } as Record<string, unknown> & { placed: number; ids: string[]; at: number };
    const end = (status: "completed" | "failed", extra: Record<string, unknown> = {}) => {
      if (this.task?.id !== id) return;
      this.task = null;
      this.emit({ type: "outcome", command, index, status, ...(status === "failed" ? { code: extra.reason === "missing_items" ? "missing_items" : "blocked" } : {}), detail: { ...done, ...(typeof f !== "string" && f.base >= 0 ? { base: `s${f.base}` } : {}), ...extra } });
    };
    if (typeof f === "string") return end("failed", { reason: "blocked", fix: f });
    for (let k = from; k <= to; k++) {
      if (this.task?.id !== id) return;
      done.at = k;
      const p = plan.pieces[k]!;
      const live = s.world!.structs;
      const { verdict, res } = pl.judge(live, f, p, specs.get(p.form), new Support(live, s.registry, (x, z) => s.world!.hf.heightAt(x, z)));
      if (verdict.status === "built") {
        if (Number.isNaN(f.y) && res && s.registry.role[res.kind] === 0) (f.y = res.pose.y / STRUCT_UNITS), (f.base = Number(String(verdict.by).slice(1)));
        continue;
      }
      if ((verdict.status !== "ok" && !(verdict.status === "blocked" && verdict.by === "you")) || !res) return end("failed", { reason: verdict.status, ...(verdict.by ? { by: verdict.by } : {}), ...(verdict.fix ? { fix: verdict.fix } : {}) });
      const [x, z] = [res.pose.x / STRUCT_UNITS, res.pose.z / STRUCT_UNITS];
      const facing = ((res.pose.yaw / YAW_UNITS) * 360 + 360) % 360;
      const asForm = shortName(s.registry.ids[res.kind]).replace(/_[a-z]+$/, "");
      const args: Record<string, unknown> = res.how === "socket" ? { item: p.item, as: asForm, on: `s${res.target}`, socket: res.socket, turn: res.turn }
        : res.how === "top" ? { item: p.item, on: `s${res.target}`, x, z, facing } : { item: p.item, as: asForm, x, z, facing, lift: res.lift / 8 };
      const t0 = this.t;
      // In reach, it builds from where it stands; in the piece's way, it steps off first.
      const ans = (await this.agent.call("place", { ...args, stay: verdict.by !== "you", wait_s: 25 })) ?? { state: "refused", reason: "no place tool" };
      if (this.task?.id !== id) return;
      if (ans.state !== "done") return end("failed", { reason: verdictOf(String(ans.reason ?? "")), said: ans.reason });
      done.placed++;
      if (typeof ans.id === "string") {
        done.ids.push(ans.id);
        if (Number.isNaN(f.y) && s.registry.role[res.kind] === 0) (f.y = res.pose.y / STRUCT_UNITS), (f.base = Number(ans.id.slice(1)));
        this.event("built", { id: ans.id, form: p.form, item: p.item, ...(f.base >= 0 ? { base: `s${f.base}` } : {}) });
      }
      // The helper's pace: a piece every half second at most, by the world's clock.
      await this.sleep(500 - (this.t - t0));
    }
    end("completed");
  }

  /** Takes pieces down: picked up whole while the game allows (a full refund), else demolished (part back). */
  private removePieces(command: string, index: number, a: Extract<Action, { control: "plan" }>): RejectCode | null {
    const ids = a.ids ?? [];
    if (!ids.length) return "bad_arguments";
    this.endTask("replaced");
    const id = ++this.tasks;
    this.task = { command, index, id };
    void (async () => {
      const removed: string[] = [], refused: Record<string, string> = {};
      for (const target of ids) {
        if (this.task?.id !== id) return;
        let r = await this.agent.call("structure", { id: target, do: "pick_up", wait_s: 25 });
        if (r?.state !== "done") r = await this.agent.call("structure", { id: target, do: "demolish", wait_s: 25 });
        if (r?.state === "done") removed.push(target);
        else refused[target] = String(r?.reason ?? "refused");
      }
      if (this.task?.id !== id) return;
      this.task = null;
      this.emit({ type: "outcome", command, index, status: Object.keys(refused).length ? "failed" : "completed", ...(Object.keys(refused).length ? { code: "blocked" as const } : {}), detail: { removed, refused } });
    })();
    return null;
  }

  /** The repair assist on a base: each of its damaged pieces in turn, at the game's cost, until none is or the bag runs short. */
  private repairBase(command: string, index: number, base: string): RejectCode | null {
    const s = this.s;
    const ref = Number(base.replace(/^s/, ""));
    const t = s.world?.structs.chunks[Math.floor(ref / 65536)];
    if (!t || t.kind[ref & 0xffff] === 0) return "unknown_target";
    this.endTask("replaced");
    const id = ++this.tasks;
    this.task = { command, index, id };
    const [bx, bz] = [t.x[ref & 0xffff]!, t.z[ref & 0xffff]!];
    void (async () => {
      let repaired = 0, result = "whole";
      const waited = new Set<number>();
      for (let round = 0; round < 200 && this.task?.id === id; round++) {
        const hurt = this.damagedNear(bx, bz).filter((r) => !waited.has(r));
        if (!hurt.length) break;
        const r = await this.agent.call("structure", { id: `s${hurt[0]}`, do: "repair", wait_s: 25 });
        if (r?.state === "done") (repaired++, this.event("repaired", { id: `s${hurt[0]}`, base }));
        else if (/wait|soon|recently|cooldown/i.test(String(r?.reason))) waited.add(hurt[0]!), (result = "waiting");
        else if (/short|missing|ingredient|need/i.test(String(r?.reason))) {
          result = "materials";
          break;
        } else waited.add(hurt[0]!);
      }
      if (this.task?.id !== id) return;
      this.task = null;
      this.emit({ type: "outcome", command, index, status: result === "materials" ? "failed" : "completed", ...(result === "materials" ? { code: "missing_items" as const } : {}), detail: { result, repaired, left: this.damagedNear(bx, bz).length } });
    })();
    return null;
  }

  /** The tribe's damaged pieces within 40 m of a point, nearest first. */
  private damagedNear(x: number, z: number): number[] {
    const s = this.s, structs = s.world!.structs, reg = s.registry;
    const n = structs.query(x - 40, z - 40, x + 40, z + 40, this.found);
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      if (t.owner[slot] !== s.tribe.team || t.kind[slot] === 0) continue;
      if (t.hp[slot]! < (reg.maxHp[t.kind[slot]!] ?? 0) - 0.5) out.push([ref, Math.hypot(t.x[slot]! - s.own.x, t.z[slot]! - s.own.z)]);
    }
    return out.sort((a, b) => a[1] - b[1]).map(([r]) => r);
  }

  /** Damage to the tribe's pieces about the survivor, told once each time it changes (and mended when it is whole). */
  private watchDamage(): void {
    const s = this.s;
    if (!s.world || this.t < this.damageAt) return;
    this.damageAt = this.t + 2000;
    const structs = s.world.structs, reg = s.registry;
    const n = structs.query(s.own.x - 60, s.own.z - 60, s.own.x + 60, s.own.z + 60, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      if (t.owner[slot] !== s.tribe.team || t.kind[slot] === 0) continue;
      const max = reg.maxHp[t.kind[slot]!] ?? 0, hp = t.hp[slot]!;
      const was = this.hpSeen.get(ref);
      this.hpSeen.set(ref, hp);
      if (was === undefined || Math.abs(was - hp) < 0.5) continue;
      const [x, z] = toG(t.x[slot]!, t.z[slot]!);
      const form = shortName(reg.ids[t.kind[slot]!]).replace(/_[a-z]+$/, "");
      if (hp < was) this.event("damaged", { id: `s${ref}`, base: `s${this.baseOf(t.x[slot]!, t.z[slot]!)}`, form, pos: [x, t.y[slot]!, z], health: max ? hp / max : 0 });
      else if (hp >= max - 0.5) this.event("repaired", { id: `s${ref}` });
    }
  }

  /** The base a piece is of: the nearest of the tribe's foundations. */
  private baseOf(x: number, z: number): number {
    const s = this.s, structs = s.world!.structs;
    const n = structs.query(x - 30, z - 30, x + 30, z + 30, this.found);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      if (t.owner[slot] !== s.tribe.team || s.registry.role[t.kind[slot]!] !== 0) continue;
      const d = Math.hypot(t.x[slot]! - x, t.z[slot]! - z);
      if (d < bestD) (bestD = d), (best = ref);
    }
    return best;
  }

  /** The running task ends (replaced or stopped): the Agent's controller is told to cancel it. */
  private endTask(by: Interruption): void {
    if (!this.task) return;
    const t = this.task;
    this.task = null;
    this.agent.controller.cancel();
    this.emit({ type: "outcome", command: t.command, index: t.index, status: "interrupted", by });
  }

  private outcome(r: Running, status: "completed" | "interrupted", extra: Record<string, unknown> = {}, by?: Interruption): void {
    this.emit({ type: "outcome", command: r.command, index: r.index, status, ...(by ? { by } : {}), detail: { ...r.done, ...extra } });
  }

  flush(): void {
    for (const e of this.instants.splice(0)) this.emit(e);
  }

  releaseAll(by: Interruption): void {
    for (const [key, r] of [...this.held]) {
      this.held.delete(key);
      this.outcome(r, "interrupted", {}, by);
    }
    this.endTask(by);
    this.crouching = false;
    this.agent.manual = null;
  }

  // --- The senses ------------------------------------------------------------------------------------------------

  private vital(i: number): [number, number] | null {
    const s = this.s;
    if (!s.hasVitals) return null;
    return [s.vitals.at(i, s.serverTick) / 1e6, s.vitals.max[i]! / 1e6];
  }

  selfChannel(): SelfChannel {
    const s = this.s, b = s.own;
    const [x, z] = toG(b.x, b.z);
    const inv = s.inventory;
    const heldItem = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
    const v = (i: number) => this.vital(i) ?? [100, 100];
    const ride = s.driving >= 0 ? s.driving : b.seat !== 0 ? b.seat - 1 : -1;
    return {
      id: this.me.id, name: this.me.name, alive: this.me.alive, pos: [x, b.y, z], yaw: wrap(-s.ownYaw), pitch: 0, vel: [0, 0, 0],
      on: ride >= 0 ? "mount" : b.y - (s.world?.hf.heightAt(b.x, b.z) ?? b.y) > 1.5 ? "air" : "ground",
      held: heldItem ? { item: shortName(s.registry.ids[heldItem]), slot: s.held } : null,
      mount: ride >= 0 ? `e${ride}` : null, status: [],
      vitals: { health: v(V_HEALTH), stamina: [b.stamina / STAMINA_UNITS, b.staminaMax], food: v(V_FOOD), water: v(V_WATER) },
    } as unknown as SelfChannel;
  }

  /** The things about, from the agent's own view of them (agent/observe.ts), as protocol entities. */
  entitiesChannel(radius = 60, max = 40): EntitiesChannel {
    const s = this.s, b = s.own;
    const seen = observe(s, this.agent.remote, Math.min(96, Math.max(8, radius)), 4, undefined, Math.min(40, max)) as Record<string, unknown>;
    const items: Entity[] = [];
    for (const [list, rows] of Object.entries(seen)) {
      if (!Array.isArray(rows) || list === "grid") continue;
      const kind = KIND_OF_LIST[list] ?? "resource";
      for (const row of rows as unknown[][]) {
        // [id, name?, x, z, metres away, direction, ...what else]: a node has no name.
        const named = typeof row[1] === "string";
        const [id, name, sx, sz, far] = named ? (row as [string, string, number, number, number]) : ([row[0], list, row[1], row[2], row[3]] as [string, string, number, number, number]);
        const more = row.slice(named ? 6 : 5).map(String);
        const [x, z] = toG(sx, sz);
        const yaw = Math.atan2(x - -b.x, -(z - -b.z));
        // A resource is a tree, a rock or a bush by what it gives (its material), and keeps its own name.
        const material = kind === "resource" ? this.material(id) : null;
        const hostile = kind === "creature" && more.includes("hunts");
        const own = more.includes("yours");
        const hurt = more.find((m) => /hurt|near death/.test(m));
        items.push({
          id, kind, type: kind === "resource" ? material! : name, ...(kind === "resource" ? { name: list } : named ? { name } : {}),
          pos: [x, 0, z], distance: far, bearing: wrap(yaw - wrap(-s.ownYaw)),
          ...(kind === "creature" ? { disposition: hostile ? "hostile" : own ? "own" : "neutral", health: hurt === "near death" ? 0.1 : hurt === "badly hurt" ? 0.35 : hurt === "hurt" ? 0.7 : 1, tags: more } : {}),
          ...(kind === "player" ? { disposition: "neutral" as const } : {}),
          ...(kind === "vehicle" ? { disposition: more.includes("yours") ? "own" : "neutral", tags: ["car", "rideable", ...more] } : {}),
          ...(own && kind === "creature" && more.includes("saddled") ? { tags: [...more, "mount", "rideable"] } : {}),
          affords: kind === "container" || kind === "structure" ? ["open"] : kind === "resource" ? ["harvest"] : own && more.includes("saddled") ? ["mount", "open"] : [],
        } as Entity);
      }
    }
    items.sort((p, q) => p.distance - q.distance);
    return { items: items.slice(0, max), more: Math.max(0, items.length - max) } as EntitiesChannel;
  }

  /** A node's kind by what it gives: wood is a tree, stone or metal a rock, nothing hard a bush. */
  private material(id: string): string {
    const m = /^n(\d+)\.(\d+)$/.exec(id);
    const s = this.s;
    if (!m || !s.nodeField) return "bush";
    const def = s.registry.defs[s.nodeField.standing(Number(m[1]), Number(m[2]))] as { material?: string } | null;
    return def?.material === undefined ? "bush" : def.material === "wood" ? "tree" : "rock";
  }

  /** The floor about the survivor, from the agent's picture of it, north up: turned into the protocol's frame. */
  terrainChannel(radius = 32, cell = 2): TerrainChannel {
    const c = cell <= 1 ? 1 : cell <= 2 ? 2 : 4;
    const seen = observe(this.s, this.agent.remote, Math.min(96, Math.max(8, radius)), c, undefined, 1) as { grid: string[]; map: string };
    const m = /top left one is centred on x (-?[\d.]+), z (-?[\d.]+)/.exec(seen.map);
    const [sx, sz] = m ? [Number(m[1]), Number(m[2])] : [this.s.own.x, this.s.own.z];
    // North up and east right is the protocol's own orientation: the rows stay; the corner's position turns.
    const [ox, oz] = toG(sx, sz);
    return { cell: c, origin: [ox, oz], size: [seen.grid[0]?.length ?? 0, seen.grid.length], rows: seen.grid, heights: null, legend: LEGEND } as TerrainChannel;
  }

  mapChannel(): MapChannel | null {
    return null;
  }

  inventoryChannel(): InventoryChannel {
    const s = this.s, reg = s.registry;
    const slotsOf = (inv: NonNullable<typeof s.inventory>, to = inv.cap): Slot[] => {
      const out: Slot[] = [];
      for (let i = 0; i < to; i++) {
        const k = inv.item[i]!;
        if (k) out.push({ slot: i, item: shortName(reg.ids[k]), count: inv.count[i]!, kind: kindOf(reg.defs[k] as ItemDef | null) });
      }
      return out;
    };
    const inv = s.inventory;
    const slots = inv ? slotsOf(inv, inv.armor >= 0 ? inv.armor : inv.cap) : [];
    const count = (k: number) => inv?.total(k) ?? 0;
    // What the hands can make, of what the survivor knows: each with what it needs and how many could be made now.
    const craftable: Craftable[] = [];
    for (let k = 1; k < reg.recipeOf.length; k++) {
      const r = reg.recipeOf[k];
      if (!r || reg.craftAt[k] !== 0) continue;
      // Known, or learnable at this level (crafting learns it first, with engram points); one for a later level is
      // listed with that level, and none can be made of it yet.
      const engram = reg.defs.findIndex((d) => d?.type === "engram" && (d as { item?: string }).item === reg.ids[k]);
      const later = engram >= 0 && !s.progress.engrams.includes(engram) && (reg.defs[engram] as { level: number }).level > s.progress.level ? (reg.defs[engram] as { level: number }).level : 0;
      const needs: Record<string, number> = {};
      let can = Infinity;
      for (let j = 0; j + 1 < r.length; j += 2) {
        needs[shortName(reg.ids[r[j]!])] = r[j + 1]!;
        can = Math.min(can, Math.floor(count(r[j]!) / r[j + 1]!));
      }
      craftable.push({ item: shortName(reg.ids[k]), needs, seconds: 5, at: null, can: later || can === Infinity ? 0 : can, ...(later ? { level: later } : {}) });
    }
    let weight = 0;
    for (const sl of slots) weight += (reg.weight[reg.index.get(`core:${sl.item}`) ?? 0] ?? 0) * sl.count;
    return {
      slots, capacity: inv?.cap ?? 0, weight: [Math.round(weight * 10) / 10, 1e9],
      hotbar: Array.from({ length: 10 }, (_, i) => (inv && inv.hotbar >= 0 ? inv.hotbar + i : null)),
      open: s.open ? { id: this.openedId ?? "open", slots: slotsOf(s.open.inventory), capacity: s.open.inventory.cap, name: s.open.name } : null,
      craftable, crafting: s.progress.jobs.map((j) => ({ item: shortName(reg.ids[j.item]), left: j.left, ready_in_s: 0 })),
    } as InventoryChannel;
  }

  focusChannel(): FocusChannel {
    return { target: null };
  }

  named(name: string): void {
    this.me.name = name;
  }
}

/** An item's kind, as the protocol sorts them, from the game's own class of it (shared/content/defs.ts). */
function kindOf(def: ItemDef | null): string {
  if (!def) return "resource";
  switch (def.class) {
    case "consumable":
      return "food";
    case "weapon":
      // A hatchet, a pick or a sickle is a weapon to the game and a tool to a player.
      return /hatchet|pick|sickle|axe/.test(def.id) ? "tool" : "weapon";
    case "ammo":
      return "ammo";
    case "armor":
    case "shield":
    case "costume":
      return "armor";
    case "structure":
      return "structure";
    case "saddle":
      return "saddle";
    default:
      return /element|gasoline/.test(def.id) ? "fuel" : "resource";
  }
}

/** What an assist's end was, from the tool's answer. */
function resultOf(tool: string, state: string, a: Record<string, unknown>): string {
  if (state === "done") return tool === "attack" ? (a.target === "gone" ? "gone" : "killed") : "gone";
  const why = String(a.reason ?? "");
  if (/sight|gone/.test(why)) return "lost";
  if (/ammo|arrow/.test(why)) return "ammo";
  if (/health|hurt|danger/.test(why)) return "health";
  return "obstructed";
}

/** The protocol's verdict for what the place tool said when the server refused a piece (agent/commands.ts words). */
function verdictOf(reason: string): string {
  if (/in the way|obstruct/i.test(reason)) return "blocked";
  if (/too high|ground/i.test(reason)) return "too_high";
  if (/support|hold/i.test(reason)) return "no_support";
  if (/enemy|another tribe/i.test(reason)) return "enemy_near";
  if (/far|reach/i.test(reason)) return "too_far";
  if (/carry no|ingredient|short/i.test(reason)) return "missing_items";
  if (/not yours|tribe/i.test(reason)) return "occupied";
  return "blocked";
}
