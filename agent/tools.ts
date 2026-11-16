// The tools an agent plays through, each a thing a player can do. An Agent drives one session: `tick` it at the frame rate,
// and `call` a tool by name. A call resolves from inside a later tick, so the clock that ticks it is the only clock.

import { RemoteSample, type ClientSession, type TextLine } from "../client/core/session.ts";
import type { EngramDef, ItemDef, PropDef, SpeciesDef } from "../shared/content/defs.ts";
import { find } from "../shared/content/find.ts";
import { STRUCT_UNITS, TICK_RATE, YAW_UNITS } from "../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CARRY_DROP, CARRY_PICK_UP, CARRY_THROW, CHOOSE_ARRIVED, CHOOSE_DIED, CHOOSE_TRAVEL, CMD_ATTACH, CMD_CARRY, CMD_CRAFT, CMD_CRAFT_AT, CMD_DROP, CMD_FEED, CMD_LEARN, CMD_LOAD, CMD_MOVE, CMD_NAME, CMD_OPEN, CMD_ORDER, CMD_PLACE, CMD_RESPAWN, CMD_SELECT, CMD_SPEND, CMD_TAKE, CMD_USE, EVENT_HIT, EVENT_HURT, EVENT_KILL, EVENT_TAMED, MAX_CHAT_CHARS, MAX_NAME_BYTES, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_LAND, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_UNSADDLE, ORDER_WANDER, ORDER_YOURS, RESULT_BUSY, RESULT_OK, SESSION_ALIVE, SESSION_DEAD, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import { CUE_DEAD } from "../shared/anim/pose.ts";
import { makeHandle } from "../shared/ids.ts";
import { STAMINA_UNITS } from "../shared/sim/character.ts";
import { STAT_NAMES } from "../shared/sim/genome.ts";
import type { Inventory } from "../shared/sim/items.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../shared/sim/vitals.ts";
import { vehiclePoint } from "../shared/sim/vehicle-frame.ts";
import { W_MELEE } from "../shared/sim/weapon.ts";
import { latOf, lonOf, xOfLon, zOfLat } from "../shared/world/coords.ts";
import { ON_TOP, ROLE_FOUNDATION, ROLE_THING, makeSockets, poseAt, socketsOf, type Pose } from "../shared/world/snap.ts";
import { Found } from "../shared/world/structures.ts";
import { NO_PIN, STRUCT_DEMOLISH, STRUCT_LIGHT, STRUCT_LOCK, STRUCT_NAME, STRUCT_PICKUP, STRUCT_PIN, STRUCT_REPAIR, STRUCT_TRAVEL, STRUCT_UNLOCK } from "../shared/world/upkeep.ts";
import { Commands, resultWords } from "./commands.ts";
import { Controller, type Target } from "./controller.ts";
import { toolDefs } from "./defs.ts";
import { GUIDE } from "./guide.ts";
import { RESOURCES, readResource } from "./lookup.ts";
import type { Answer, CallContext, ResourceDef, ToolDef, ToolHost } from "./mcp.ts";
import { VIEW_PLAYER, VIEW_PROP, compass, observe, shortName, type FarLayer } from "./observe.ts";

export { INSTRUCTIONS, toolDefs } from "./defs.ts";

/** Chat lines a survivor may say at once, and the milliseconds that earn another, as server/chat.ts counts them. */
const CHAT_BURST = 5;
const CHAT_EARN_MS = 2000;
const CONSOLE_GAP_MS = 250;
/** What an order is called, and its code. The three stances follow ORDER_STANCE. */
const ORDERS: Record<string, number> = { stay: ORDER_STAY, follow: ORDER_FOLLOW, wander: ORDER_WANDER, passive: ORDER_STANCE, neutral: ORDER_STANCE + 1, aggressive: ORDER_STANCE + 2, attack_my_target: ORDER_YOURS, attack: ORDER_ATTACK, land: ORDER_LAND, mate: ORDER_MATE, no_mating: ORDER_UNMATE, unsaddle: ORDER_UNSADDLE, level: ORDER_LEVEL };
/** A command the server has not answered after this long is given up on. */
const ANSWER_MS = 3000;
const CHANNELS: Record<string, number> = { global: TEXT_GLOBAL, local: TEXT_LOCAL, tribe: TEXT_TRIBE };
const CHANNEL_WORDS: Record<number, string> = { [TEXT_GLOBAL]: "global", [TEXT_LOCAL]: "local", [TEXT_TRIBE]: "tribe", [TEXT_NOTICE]: "notice" };
/** A place command's target for open ground, as server/build.ts reads it. */
const OPEN_GROUND = 0xffffffff;
/** Why a survivor without a body chooses, in words. */
const CHOOSE_WORDS: Record<number, string> = { [CHOOSE_DIED]: "died", [CHOOSE_ARRIVED]: "arrived", [CHOOSE_TRAVEL]: "travelling from a bed" };
const WORN = ["head", "torso", "hands", "legs", "feet"];
/** The structure actions by name. Lighting and putting out are one action, which changes a fire to the other. */
const ACTIONS: Record<string, number> = { light: STRUCT_LIGHT, put_out: STRUCT_LIGHT, lock: STRUCT_LOCK, unlock: STRUCT_UNLOCK, pin: STRUCT_PIN, pick_up: STRUCT_PICKUP, demolish: STRUCT_DEMOLISH, repair: STRUCT_REPAIR, name: STRUCT_NAME, travel: STRUCT_TRAVEL };
/** Combat news kept for status, newest last. */
const NEWS_KEPT = 12;

/** Thrown by the argument readers. The call is then refused with the message. */
class Bad extends Error {}

function text(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v !== "string" || v === "") throw new Bad(`${key} must be text`);
  return v;
}

function whole(a: Record<string, unknown>, key: string, lo: number, hi: number, or?: number): number {
  const v = a[key] ?? or;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new Bad(`${key} must be a whole number from ${lo} to ${hi}`);
  return v;
}

function amount(a: Record<string, unknown>, key: string, lo: number, hi: number, or: number): number {
  const v = a[key] ?? or;
  if (typeof v !== "number" || !(v >= lo && v <= hi)) throw new Bad(`${key} must be a number from ${lo} to ${hi}`);
  return v;
}

const refused = (reason: string): Answer => ({ state: "refused", reason });
const round1 = (v: number): number => Math.round(v * 10) / 10;
/** A call no client is listening to. */
const QUIET: CallContext = { progress: () => {}, signal: new AbortController().signal };
const progressText = (p: Record<string, unknown>): string => Object.entries(p).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ");

export interface AgentOptions {
  /** Offer the console tool. */
  console?: boolean;
  /** What observe shows beyond the chunks the server sends. */
  far?: FarLayer;
}

export class Agent implements ToolHost {
  readonly session: ClientSession;
  readonly commands: Commands;
  /** Everyone else in view, as of the last tick. */
  readonly remote = new RemoteSample();
  readonly controller: Controller;
  private readonly withConsole: boolean;
  private readonly far: FarLayer | undefined;
  private readonly run: Record<string, (a: Record<string, unknown>, ctx: CallContext) => Answer | Promise<Answer>>;
  /** Each returns true once it has resolved its promise. */
  private readonly waiting: ((now: number) => boolean)[] = [];
  private now = 0;
  private chatLines = CHAT_BURST;
  private chatAt = 0;
  private consoleAt = -CONSOLE_GAP_MS;
  /** `session.logVersion` when status last told what was heard. */
  private heardTo = 0;
  /** Hits, kills, wounds and tames since status last told them. */
  private readonly news: string[] = [];
  /** The calls not yet answered. They are answered when the session closes, so none is left waiting on a server that has gone. */
  private readonly pending = new Set<(a: Answer) => void>();
  private readonly found = new Found();
  private readonly sockets = makeSockets();
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly at = [0, 0, 0];

  constructor(session: ClientSession, opts: AgentOptions = {}) {
    this.session = session;
    this.commands = new Commands(session);
    this.controller = new Controller(session, this.remote, this.commands);
    this.withConsole = opts.console ?? false;
    this.far = opts.far;
    this.run = {
      observe: (a) => {
        const cell = a.cell ?? 2;
        if (cell !== 1 && cell !== 2 && cell !== 4) throw new Bad("cell must be 1, 2 or 4");
        return observe(this.session, this.remote, amount(a, "radius", 8, 96, 32), cell, this.far, whole(a, "list", 1, 40, 10)) as Answer;
      },
      status: (a) => this.status(a),
      go_to: (a, ctx) => this.goTo(a, ctx),
      harvest: (a, ctx) => this.harvest(a, ctx),
      attack: (a, ctx) => this.attack(a, ctx),
      open: (a, ctx) => this.open(a, ctx),
      move_item: (a) => this.moveItem(a),
      craft: (a, ctx) => this.craft(a, ctx),
      use_item: (a, ctx) => this.useItem(a, ctx),
      mount: (a, ctx) => this.mount(a, ctx),
      carry: (a, ctx) => this.carry(a, ctx),
      order: (a) => this.order(a),
      place: (a, ctx) => this.put(a, ctx),
      structure: (a, ctx) => this.structure(a, ctx),
      rise: (a) => this.rise(a),
      level_up: (a) => this.levelUp(a),
      say: (a) => this.say(a),
      cancel: () => ({ state: "done", cancelled: this.controller.cancel() }),
      console: (a) => this.typed(a),
    };
  }

  /** Call at the frame rate with the time in milliseconds. It steps the session. */
  tick(now: number): void {
    this.now = now;
    this.commands.step(now);
    const s = this.session;
    if (s.state === "closed") {
      for (const answer of this.pending) answer(this.down());
      return this.pending.clear();
    }
    if (s.state === "active") s.sampleRemote(this.remote);
    this.absorb();
    const c = this.controller;
    c.step(now);
    s.update(now, c.moveX, c.moveZ, c.yaw, c.pitch, c.buttons);
    for (let i = 0; i < this.waiting.length; ) {
      if (this.waiting[i]!(now)) this.waiting.splice(i, 1);
      else i++;
    }
  }

  /** Takes the session's combat events, which no picture takes here: hits count for the running attack, and all are news. */
  private absorb(): void {
    const s = this.session;
    for (const ev of s.events) {
      if (ev.kind === EVENT_HIT) {
        this.controller.hit(ev.x, ev.z);
        if (ev.damage > 0) this.tell(`you hit for ${Math.round(ev.damage)}${ev.kill ? ", and killed it" : ""}`);
      } else if (ev.kind === EVENT_KILL) this.tell(`you killed ${ev.name} (level ${ev.level})`);
      else if (ev.kind === EVENT_HURT) this.tell(`you were hurt for ${Math.round(ev.damage)}${ev.side ? `, from the ${compass((ev.bearing / 256) * Math.PI * 2 + s.ownYaw)}` : ""}`);
      else if (ev.kind === EVENT_TAMED) this.tell(`you tamed ${ev.name || "a creature"}`);
    }
    s.events.length = 0;
    // The naming prompt a browser shows when a tame is done: the agent names with order.
    for (const t of s.tamed) this.tell(`tamed: a level ${t.level} ${this.nameOf(t.kind)} (e${t.handle & 0xfffff}) is yours; order name names it`);
    s.tamed.length = 0;
  }

  private tell(line: string): void {
    this.news.push(line);
    if (this.news.length > NEWS_KEPT) this.news.shift();
  }

  list(): ToolDef[] {
    return toolDefs(this.withConsole);
  }

  resources(): ResourceDef[] {
    return RESOURCES;
  }

  read(uri: string): string | null {
    return readResource(this.session, uri, GUIDE);
  }

  call(name: string, args: Record<string, unknown>, ctx: CallContext = QUIET): Promise<Answer> | null {
    const run = this.list().some((d) => d.name === name) ? this.run[name] : undefined;
    if (!run) return null;
    if (this.session.state !== "active") return Promise.resolve(this.down());
    const bad = (err: unknown): Answer => {
      if (err instanceof Bad) return refused(err.message);
      throw err;
    };
    // Whatever was asked, the answer says what threatens the survivor.
    const warned = (answer: Answer): Answer => {
      const dangers = this.controller.dangers();
      return dangers.length > 0 && answer.state !== "refused" ? { ...answer, dangers } : answer;
    };
    // The tool starts now, in this turn, so whoever ticks next finds it under way.
    let running: Answer | Promise<Answer>;
    const task = this.controller.started;
    try {
      running = run(args, ctx);
    } catch (err) {
      return Promise.resolve(bad(err));
    }
    // A cancelled call stops any task it started, as cancel does. While it waits no other call can start one.
    ctx.signal.addEventListener("abort", () => void (this.controller.started > task && this.controller.cancel()), { once: true });
    return new Promise((resolve, reject) => {
      this.pending.add(resolve);
      void Promise.resolve(running)
        .then(warned, bad)
        .then(resolve, reject)
        .finally(() => this.pending.delete(resolve));
    });
  }

  private down(): Answer {
    return refused(this.session.state === "closed" ? `not connected (reason ${this.session.closeReason})` : "still connecting");
  }

  /** Resolves with the first value `poll` gives that is not null. It is asked once a tick. */
  private until<T>(poll: (now: number) => T | null): Promise<T> {
    return new Promise((resolve) => {
      this.waiting.push((now) => {
        const got = poll(now);
        if (got === null) return false;
        resolve(got);
        return true;
      });
    });
  }

  /** The RESULT_ code the server gives command `seq`, or -1 if it gives none in time. */
  private result(seq: number): Promise<number> {
    const by = this.now + ANSWER_MS;
    return this.until((now) => {
      const code = this.commands.take(seq);
      return code >= 0 ? code : now > by ? -1 : null;
    });
  }

  private pause(ms: number): Promise<true> {
    const by = this.now + ms;
    return this.until((now) => (now >= by ? true : null));
  }

  /** Sends a command and waits for its result, as an answer: done with `done`, or blocked with the server's reason. */
  private async send(op: number, args: Parameters<Commands["send"]>[1], done: Record<string, unknown> = {}): Promise<Answer> {
    const seq = this.commands.send(op, args);
    return this.outcome(seq, seq === 0 ? 0 : await this.result(seq), done);
  }

  /** What the server answered a command with, as an Answer. */
  private outcome(seq: number, code: number, done: Record<string, unknown>): Answer {
    if (seq === 0) return refused("too many commands at once: ten a second is the pace");
    if (code === RESULT_OK) return { state: "done", ...done };
    return { state: "blocked", reason: code < 0 ? "the server did not answer" : resultWords(code) };
  }

  /** The content index of the item `name` means. Spaces may stand for underscores. */
  private item(name: string): number {
    const reg = this.session.registry;
    for (const word of [name, name.trim().replace(/\s+/g, "_")]) {
      const found = find(reg, word, "item");
      if (found.kinds.length === 1) return found.kinds[0]!;
      if (found.could.length > 0) throw new Bad(`${name} could be ${found.could.map(shortName).join(" or ")}`);
    }
    // A label as the game shows it, such as "stone arrow".
    const want = name.trim().toLowerCase();
    const byLabel = reg.defs.findIndex((d) => d?.type === "item" && (d as ItemDef).label?.toLowerCase() === want);
    if (byLabel > 0) return byLabel;
    throw new Bad(`there is no item called ${name}`);
  }

  private nameOf(kind: number): string {
    return shortName(this.session.registry.ids[kind]);
  }

  /** Every filled slot as [slot, item, count], with what is left of a thing that wears out and what a weapon has loaded. */
  private slots(inv: Inventory, from = 0, to = inv.cap): unknown[] {
    const reg = this.session.registry;
    const out: unknown[] = [];
    for (let s = from; s < to; s++) {
      if (inv.item[s] === 0) continue;
      const row: unknown[] = [s, this.nameOf(inv.item[s]!), inv.count[s]!];
      if (reg.uses[inv.item[s]!]! > 0) row.push(`${inv.dur[s]} uses left`);
      // A vessel keeps its water as its durability.
      else if ((reg.defs[inv.item[s]!] as ItemDef).use?.holds) row.push(`${inv.dur[s]} water`);
      if (reg.weapon[inv.item[s]!] && reg.weapon[inv.item[s]!]!.kind !== W_MELEE && inv.ammo[s] !== 0) row.push(`${inv.loaded[s]} ${this.nameOf(inv.ammo[s]!)} loaded`);
      out.push(row);
    }
    return out;
  }

  private self(): Record<string, unknown> {
    const s = this.session;
    const b = s.own;
    const hf = s.world!.hf;
    const v = s.vitals;
    const vital = (i: number): number[] => [Math.round(v.at(i, s.serverTick) / 1e6), Math.round(v.max[i]! / 1e6)];
    const inv = s.inventory;
    const held = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
    const up = b.y - hf.heightAt(b.x, b.z);
    const torpor = s.hasVitals ? v.at(V_TORPOR, s.serverTick) / 1e6 : 0;
    return {
      x: round1(b.x),
      z: round1(b.z),
      y: round1(b.y),
      lat: round1(latOf(hf, b.z)),
      lon: round1(lonOf(hf, b.x)),
      ...(up > 1.5 ? { above_ground: round1(up) } : {}),
      facing: compass(s.ownYaw),
      alive: s.sessionState === SESSION_ALIVE,
      ...(s.hasVitals ? { health: vital(V_HEALTH), food: vital(V_FOOD), water: vital(V_WATER), oxygen: vital(V_OXYGEN) } : {}),
      ...(torpor >= 1 ? { torpor: Math.round(torpor) } : {}),
      stamina: [Math.round(b.stamina / STAMINA_UNITS), b.staminaMax],
      level: s.progress.level,
      engram_points: s.progress.engramPoints,
      ...(s.progress.statPoints > 0 ? { level_points: s.progress.statPoints } : {}),
      held: held !== 0 ? this.nameOf(held) : null,
      ...this.riding(),
    };
  }

  /** What the survivor rides or sits in, if anything. */
  private riding(): Record<string, unknown> {
    const s = this.session;
    const on = s.driving >= 0 ? s.driving : s.own.seat !== 0 ? s.own.seat - 1 : -1;
    if (on < 0) return {};
    const r = this.remote;
    for (let i = 0; i < r.count; i++) if (r.id[i] === on) return { riding: `${r.name[i] || this.nameOf(r.kind[i]!)} (e${on})`, steering: s.driving >= 0 };
    return { riding: s.driving >= 0 ? `${this.nameOf(s.bodyKind)} (e${on})` : `e${on}`, steering: s.driving >= 0 };
  }

  /** Lines of chat and notices that arrived since this was last asked, oldest first. */
  private heard(): string[] {
    const s = this.session;
    const fresh = Math.min(s.log.length, s.logVersion - this.heardTo);
    this.heardTo = s.logVersion;
    const lines = fresh > 0 ? s.log.slice(-fresh) : [];
    return lines.filter((l) => CHANNEL_WORDS[l.channel] !== undefined).map((l) => `[${CHANNEL_WORDS[l.channel]}] ${l.text}`);
  }

  /** Resolves when the running task ends, or after `seconds` with how far it has got, telling the progress each second meanwhile. */
  private finish(seconds: number, ctx: CallContext = QUIET): Promise<Answer> {
    const c = this.controller;
    const began = this.now;
    const by = began + seconds * 1000;
    let told = began;
    return this.until((now) => {
      if (c.ended) return c.ended;
      if (now >= by) return { state: "running", ...c.progress() };
      if (now - told >= 1000) {
        told = now;
        ctx.progress((now - began) / 1000, seconds, progressText(c.progress()));
      }
      return null;
    });
  }

  private idle(): void {
    const busy = this.controller.busy;
    if (busy) throw new Bad(`${busy} is still running: cancel it, or wait for it with status`);
  }

  /** What `id` names, if no task is in the way of starting one. */
  private target(a: Record<string, unknown>, key = "id"): Target {
    this.idle();
    const found = this.controller.locate(text(a, key));
    if (typeof found === "string") throw new Bad(found);
    return found;
  }

  /** The cue bits of a body in view, or -1 if it is not in view. */
  private cueOf(entity: number): number {
    const r = this.remote;
    for (let i = 0; i < r.count; i++) if (r.id[i] === entity) return r.cue[i]!;
    return -1;
  }

  private teamOf(entity: number): number {
    const r = this.remote;
    for (let i = 0; i < r.count; i++) if (r.id[i] === entity) return r.team[i]!;
    return 0;
  }

  /** x and z from x and z, or from lat and lon. */
  private where(a: Record<string, unknown>): [number, number] | null {
    const hf = this.session.world!.hf;
    if (a.lat !== undefined || a.lon !== undefined) {
      if (a.lat === undefined || a.lon === undefined) throw new Bad("give lat and lon together");
      return [xOfLon(hf, amount(a, "lon", 0, 100, 0)), zOfLat(hf, amount(a, "lat", 0, 100, 0))];
    }
    if (a.x === undefined && a.z === undefined) return null;
    if (a.x === undefined || a.z === undefined) throw new Bad("give x and z together");
    return [amount(a, "x", 0, hf.sizeX, 0), amount(a, "z", 0, hf.sizeZ, 0)];
  }

  private goTo(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const c = this.controller;
    const near = amount(a, "within", 0.3, 50, 0.6);
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const at = this.where(a);
    if (a.id === undefined && !at) throw new Bad("give x and z, lat and lon, or an id");
    const reg = this.session.registry;
    if (this.session.driving >= 0 && reg.vehicle[this.session.bodyKind]?.movement === "rotor") return Promise.resolve(refused("flying a helicopter is not one of your ways yet: land it and mount with off"));
    let target = a.id !== undefined ? this.target(a) : c.place(at![0], at![1]);
    this.idle();
    // A floor, a slab or a foundation is gone onto, not up to.
    if (target.ref >= 0 && reg.halfY[target.kind]! <= 0.3 && Math.min(reg.halfX[target.kind]!, reg.halfZ[target.kind]!) >= 0.9) {
      const top = target.y + reg.halfY[target.kind]!;
      target = c.place(target.x, target.z);
      target.y = top;
    }
    if (a.y !== undefined) target.y = amount(a, "y", -1000, 5000, 0);
    c.sprint = a.run === true;
    c.swim = a.swim !== false;
    const vehicle = this.session.driving >= 0 && this.session.own.vehicle;
    c.walkTo(this.now, target, a.within === undefined && (vehicle || this.flying()) ? 4 : near, a.fly !== false, a.land !== false);
    return this.finish(seconds, ctx);
  }

  /** Whether what is steered is a flyer. */
  private flying(): boolean {
    const s = this.session;
    return s.driving >= 0 && s.registry.flies[s.bodyKind] === 1;
  }

  private harvest(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    let item = 0;
    let count = 0;
    if (a.until !== undefined) {
      if (typeof a.until !== "object" || a.until === null) throw new Bad("until must be an item and a count");
      item = this.item(text(a.until as Record<string, unknown>, "item"));
      count = whole(a.until as Record<string, unknown>, "count", 1, 10000);
    }
    const tool = a.tool === undefined ? 0 : this.item(text(a, "tool"));
    if (tool !== 0 && (s.inventory?.total(tool) ?? 0) === 0) return Promise.resolve(refused(`you carry no ${this.nameOf(tool)}`));
    const target = this.target(a);
    if (target.entity >= 0 && this.dead(target)) this.controller.attack(this.now, target, item, count, tool, false);
    else if (target.chunk < 0) throw new Bad("only a tree, a rock, a bush or a dead body can be harvested: attack is for a living one");
    else this.controller.harvest(this.now, target, item, count, tool);
    return this.finish(seconds, ctx);
  }

  /** Whether a body is a dead creature's. */
  private dead(target: Target): boolean {
    const cue = this.cueOf(target.entity);
    return cue >= 0 && (cue & CUE_DEAD) !== 0;
  }

  /** The item in hand, or 0. */
  private held(): number {
    const s = this.session;
    const inv = s.inventory;
    return inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
  }

  private async attack(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    let item = 0;
    let count = 0;
    if (typeof a.until === "object" && a.until !== null) {
      item = this.item(text(a.until as Record<string, unknown>, "item"));
      count = whole(a.until as Record<string, unknown>, "count", 1, 10000);
    } else if (a.until !== undefined && a.until !== "out" && a.until !== "dead") throw new Bad("until is out, dead, or an item and a count");
    const held = this.held();
    const ranged = (k: number): boolean => k !== 0 && reg.weapon[k] !== null && reg.weapon[k]!.kind !== W_MELEE;
    const tool = a.with !== undefined ? this.item(text(a, "with")) : s.driving < 0 && ranged(held) ? held : 0;
    const inv = s.inventory;
    if (tool !== 0 && (inv?.total(tool) ?? 0) === 0) return refused(`you carry no ${this.nameOf(tool)}`);
    if (tool !== 0 && reg.weapon[tool] === null) throw new Bad(`${this.nameOf(tool)} is not a weapon`);
    const target = this.target(a);
    const lying = (target.flags & VIEW_PROP) !== 0 && !this.dead(target);
    if (target.entity < 0 || lying) throw new Bad("only a creature, a player or a dead body can be attacked: harvest is for a tree, a rock or a bush");
    if (ranged(tool) && s.driving >= 0) throw new Bad("riding, your mount fights with its jaws: leave with out, or get off first to shoot");
    // The ammunition asked for is chosen before the fight: what is loaded of another kind goes back to the bag, and the next reload takes it.
    if (ranged(tool) && reg.weapon[tool]!.clip > 0) {
      const takes = (reg.defs[tool] as ItemDef).weapon?.ammo ?? [];
      const slot = inv!.item.indexOf(tool);
      const ammo = a.ammo !== undefined ? this.item(text(a, "ammo")) : 0;
      if (ammo !== 0 && !takes.includes(reg.ids[ammo]!)) throw new Bad(`the ${this.nameOf(tool)} takes ${takes.map(shortName).join(", ")}`);
      if (ammo !== 0 && inv!.total(ammo) === 0 && !(inv!.ammo[slot] === ammo && inv!.loaded[slot]! > 0)) return refused(`you carry no ${this.nameOf(ammo)}`);
      const carried = takes.some((id) => inv!.total(reg.index.get(id) ?? 0) > 0) || inv!.loaded[slot]! > 0;
      if (!carried) return refused(`you carry nothing the ${this.nameOf(tool)} fires: it takes ${takes.map(shortName).join(", ")}`);
      if (ammo !== 0 && inv!.ammo[slot] !== ammo) {
        const loaded = await this.send(CMD_LOAD, (w) => (w.varint(slot), w.u16(ammo)));
        if (loaded.state !== "done") return { ...loaded, reason: `could not load ${this.nameOf(ammo)}: ${String(loaded.reason)}` };
      }
    }
    this.controller.attack(this.now, target, item, count, tool, a.until === "out");
    return this.finish(seconds, ctx);
  }

  private async carry(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    if (a.put !== undefined) {
      if (a.put !== "down" && a.put !== "throw") throw new Bad("put is down or throw");
      const thrown = a.put === "throw";
      return this.send(CMD_CARRY, (w) => w.u8(thrown ? CARRY_THROW : CARRY_DROP), thrown ? { threw: true } : { set_down: true });
    }
    if (a.id === undefined) throw new Bad("give the id of a small creature or an egg, or put");
    const reg = this.session.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const target = this.target(a);
    const egg = (target.flags & VIEW_PROP) !== 0 && (reg.defs[target.kind] as PropDef).class === "egg";
    if (target.entity < 0 || ((target.flags & VIEW_PROP) !== 0 && !egg)) throw new Bad("only a small creature or an egg can be carried: open is for a bag");
    this.controller.walkTo(this.now, target, 0.9);
    const walked = await this.finish(seconds, ctx);
    if (walked.state !== "done") return walked;
    return egg ? this.send(CMD_TAKE, (w) => w.u32(target.entity), { took: this.nameOf(target.kind) }) : this.send(CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(target.entity)), { holding: this.nameOf(target.kind) });
  }

  /** The entity index of a creature or player that `id` names. */
  private body(id: string): Target {
    const found = this.controller.locate(id);
    if (typeof found === "string") throw new Bad(found);
    if (found.entity < 0 || (found.flags & VIEW_PROP) !== 0) throw new Bad(`${id} is not a creature or a player`);
    return found;
  }

  private async order(a: Record<string, unknown>): Promise<Answer> {
    const what = text(a, "order");
    const code = ORDERS[what];
    if (code === undefined && what !== "name") throw new Bad(`order is one of ${[...Object.keys(ORDERS), "name"].join(", ")}`);
    const all = a.id === undefined || a.id === "all";
    if (all && ["wander", "mate", "no_mating", "unsaddle", "name", "level"].includes(what)) throw new Bad(`${what} needs the id of one creature`);
    if (what === "name") {
      const it = this.body(text(a, "id"));
      const name = text(a, "name");
      if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) throw new Bad(`a name is at most ${MAX_NAME_BYTES} letters`);
      let gen = 0;
      for (let i = 0; i < this.remote.count; i++) if (this.remote.id[i] === it.entity) gen = this.remote.gen[i]!;
      return this.send(CMD_NAME, (w) => (w.u32(makeHandle(it.entity, gen)), w.string(name)), { named: name, who: a.id });
    }
    let order = code!;
    if (what === "level") {
      const stat = STAT_NAMES.indexOf(text(a, "stat") as (typeof STAT_NAMES)[number]);
      if (stat < 0) throw new Bad(`stat is one of ${STAT_NAMES.join(", ")}`);
      order = ORDER_LEVEL + stat;
    }
    const who = all ? ORDER_ALL : this.body(text(a, "id")).entity;
    const at = code === ORDER_ATTACK ? this.body(text(a, "target")).entity : -1;
    return this.send(
      CMD_ORDER,
      (w) => {
        w.u32(who >>> 0);
        w.u8(order);
        if (at >= 0) w.u32(at >>> 0);
      },
      { ordered: what, who: all ? "every tribe creature in earshot" : a.id },
    );
  }

  private async open(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const pin = a.pin === undefined ? NO_PIN : whole(a, "pin", 0, 9999);
    const target = this.target(a);
    const creature = target.entity >= 0 && (target.flags & (VIEW_PROP | VIEW_PLAYER)) === 0;
    if (creature) return this.openCreature(target, seconds, ctx);
    // Of bodies only a bag or a cache.
    const can = target.ref >= 0 ? reg.structSlots[target.kind]! > 0 || reg.opens[target.kind] !== 0 : target.entity >= 0 && (target.flags & VIEW_PROP) !== 0 && (reg.defs[target.kind] as PropDef).class === "container";
    if (!can) throw new Bad("only a box, a bag, a station, a door or a creature can be opened");
    this.controller.open(this.now, target, pin);
    const answer = await this.finish(seconds, ctx);
    if (answer.state !== "done" || !s.open) return answer;
    // What it holds follows the news that it is open.
    await this.pause(3000 / TICK_RATE);
    return s.open ? { ...answer, ...this.opened() } : answer;
  }

  /**
   * A creature's inventory: one knocked out is opened with the use button, as anyone may; one of the tribe's by the command
   * a player's inventory key sends, since the use button would ride or carry it.
   */
  private async openCreature(target: Target, seconds: number, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    if (s.subject && s.subject.id === target.entity) return { state: "done", ...this.opened() };
    const cue = this.cueOf(target.entity);
    const out = cue >= 0 && this.controller.out(target.entity, cue);
    const ours = s.tribe.team !== 0 && this.teamOf(target.entity) === s.tribe.team;
    // Only a body drawn from a skeleton shows it is out; any other is told only to who looks at it, so it is tried.
    const shows = (s.registry.defs[target.kind] as SpeciesDef | null)?.skeleton !== undefined;
    if (!out && !ours && shows) return refused(`${target.id} is awake and not your tribe's: knock it out first (attack with until out)`);
    if (!ours) {
      this.controller.open(this.now, target, NO_PIN);
      const answer = await this.finish(seconds, ctx);
      if (answer.state !== "done") return answer.reason === "it did not open" ? { ...answer, reason: `${target.id} did not open: a wild creature opens only knocked out` } : answer;
    } else {
      this.controller.walkTo(this.now, target, 1.5);
      const walked = await this.finish(seconds, ctx);
      if (walked.state !== "done") return walked;
      const opened = await this.send(CMD_OPEN, (w) => w.u32(target.entity));
      if (opened.state !== "done") return opened;
    }
    await this.until((now) => (s.subject?.id === target.entity || now > this.now + ANSWER_MS ? true : null));
    await this.pause(3000 / TICK_RATE);
    return s.open ? { state: "done", task: "open", ...this.opened() } : { state: "blocked", reason: "it did not open" };
  }

  /** What is open: its slots, and for a station its fire and queue, for a creature how its taming goes. */
  private opened(): Record<string, unknown> {
    const s = this.session;
    const open = s.open;
    if (!open) return {};
    const out: Record<string, unknown> = { box: { name: open.name, size: open.inventory.cap, slots: this.slots(open.inventory) } };
    const st = s.station;
    if (st) {
      const tick = s.serverTick;
      const secs = (at: number): number => Math.max(0, Math.ceil((at - tick) / TICK_RATE));
      out.station = {
        kind: this.nameOf(st.kind),
        fire: st.out === 0 ? (s.registry.lights[st.kind] !== 0 || s.registry.burning[st.kind] ? "out" : "none") : `burning, ${secs(st.out)} s of fuel`,
        ...(st.lanes.length > 0 ? { firing: st.lanes.map((l) => [this.nameOf(l.item), l.doneAt === 0 ? "waits" : `${secs(l.doneAt)} s`]) } : {}),
        ...(st.jobs.length > 0 ? { queue: st.jobs.map((j) => [this.nameOf(j.item), j.left, j.rest > 0 ? "paused: the fire is out" : `${secs(j.doneAt)} s to the next`]) } : {}),
      };
    }
    const c = s.subject;
    if (c) {
      const pct = (v: number): number => Math.round(v * 100);
      out.creature = {
        level: c.level,
        ...(c.taming ? { taming: `${pct(c.progress)}%`, effectiveness: `${pct(c.te)}%`, torpor: `${pct(c.torpor)}%` } : {}),
        food: `${pct(c.food)}%`,
        yours: c.owned,
        saddled: c.saddled,
        ...(c.points > 0 ? { level_points: c.points } : {}),
      };
    }
    return out;
  }

  private async status(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const c = this.controller;
    const task: Answer = c.busy ? await this.finish(amount(a, "wait_s", 0, 50, 0)) : (c.ended ?? { state: "done", task: null });
    const inv = s.inventory;
    const jobs = s.progress.jobs.map((j) => [this.nameOf(j.item), j.left]);
    const worn: Record<string, string> = {};
    for (let k = 0; inv && inv.armor >= 0 && k < WORN.length; k++) if (inv.item[inv.armor + k] !== 0) worn[WORN[k]!] = this.nameOf(inv.item[inv.armor + k]!);
    const buffs = s.buffs.map((b) => this.nameOf(b.buff));
    const news = this.news.splice(0);
    return {
      ...task,
      self: this.self(),
      ...(s.sessionState === SESSION_DEAD ? { choosing: this.choosing() } : {}),
      ...(inv ? { inventory: this.slots(inv, 0, inv.armor >= 0 ? inv.armor : inv.cap), hotbar_slots: [inv.hotbar, inv.hotbar + 9] } : {}),
      ...(Object.keys(worn).length > 0 ? { worn } : {}),
      ...(buffs.length > 0 ? { buffs } : {}),
      ...this.opened(),
      ...(jobs.length > 0 ? { making: jobs } : {}),
      ...(news.length > 0 ? { news } : {}),
      heard: this.heard(),
    };
  }

  /** While it has no body: why, and every place it may rise at as [number, name, what it is, x, z, seconds it still waits]. */
  private choosing(): Record<string, unknown> {
    const s = this.session;
    const places = s.respawnPoints.map((p, i) => [i, p.name, p.kind === 0 ? "spawn point" : this.nameOf(p.kind), round1(p.x), round1(p.z), p.readyAt > s.serverTick ? Math.ceil((p.readyAt - s.serverTick) / TICK_RATE) : 0]);
    return { why: CHOOSE_WORDS[s.choosing] ?? "died", places };
  }

  /** Rises at a place `status` lists under choosing, by its number or its name. */
  private async rise(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    if (s.sessionState !== SESSION_DEAD) return refused("you have a body: rise is for choosing where to come back, after a death or while travelling from a bed");
    const points = s.respawnPoints;
    if (points.length === 0) return refused("the places to rise at have not come yet: ask again in a moment");
    const want = a.place;
    const i = typeof want === "number" ? want : typeof want === "string" ? points.findIndex((p) => p.name.toLowerCase() === want.trim().toLowerCase()) : -1;
    if (!Number.isInteger(i) || i < 0 || i >= points.length) throw new Bad("place must be a number or a name that status lists under choosing");
    const list = s.placesList;
    const name = points[i]!.name;
    const rose = await this.send(CMD_RESPAWN, (w) => (w.u8(i), w.u8(list)));
    if (rose.state !== "done") return rose;
    // The body comes with the next snapshot.
    await this.until(() => (s.sessionState === SESSION_ALIVE ? true : null));
    return { state: "done", rose_at: name, self: this.self() };
  }

  private async levelUp(a: Record<string, unknown>): Promise<Answer> {
    const stat = STAT_NAMES.indexOf(text(a, "stat") as (typeof STAT_NAMES)[number]);
    if (stat < 0) throw new Bad(`stat is one of ${STAT_NAMES.join(", ")}`);
    if (this.session.progress.statPoints < 1) return refused("you have no level points to spend: they come with each level");
    return this.send(CMD_SPEND, (w) => w.u8(stat), { raised: STAT_NAMES[stat] });
  }

  /** Takes `item` into the hands: into the hotbar if it is in the bag, then chosen. */
  private async inHand(item: number): Promise<Answer> {
    const s = this.session;
    const inv = s.inventory;
    if (!inv || inv.total(item) === 0) return refused(`you carry no ${this.nameOf(item)}`);
    let slot = inv.item.indexOf(item);
    if (slot < inv.hotbar || slot >= inv.hotbar + 10) {
      let to = -1;
      for (let k = 9; k >= 0; k--) if (inv.item[inv.hotbar + k] === 0) to = inv.hotbar + k;
      if (to < 0) return refused("the hotbar is full: move something out of it first");
      const from = slot;
      const moved = await this.send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(item)));
      if (moved.state !== "done") return moved;
      slot = to;
    }
    if (s.held === slot - inv.hotbar) return { state: "done" };
    const held = slot - inv.hotbar;
    return this.send(CMD_SELECT, (w) => w.u8(held));
  }

  /**
   * Sets down a building piece or a thing from what is carried: a foundation or a thing that stands by itself on the ground or
   * on a floor, or a joined piece on a side of one of the tribe's. It walks near, takes the piece in hand, and places it as the
   * build button does, then finds the new piece where it predicted it.
   */
  private async put(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const world = s.world!;
    const item = this.item(text(a, "item"));
    const forms = reg.places[item];
    if (!forms || forms.length === 0) throw new Bad(`${this.nameOf(item)} is not something built`);
    const variant = typeof a.as === "string" ? forms.findIndex((k) => this.nameOf(k).startsWith(String(a.as))) : 0;
    if (variant < 0) throw new Bad(`a ${this.nameOf(item)} is set down as ${[...forms].map((k) => this.nameOf(k)).join(" or ")}`);
    const kind = forms[Math.max(0, variant)]!;
    const role = reg.role[kind]!;
    const free = role === ROLE_FOUNDATION || role === ROLE_THING;
    const on = a.on === undefined ? null : this.target({ id: a.on });
    this.idle();
    if (on && on.ref < 0) throw new Bad(`${on.id} is not something built`);
    if (!on && !free) throw new Bad(`a ${this.nameOf(kind)} joins a piece of your tribe's: give on, the piece, and side`);
    const inv = s.inventory;
    if (!inv || inv.total(item) === 0) return refused(`you carry no ${this.nameOf(item)}`);
    // Where it goes: a socket of the piece it joins, or on its top, or on open ground.
    let socket = -1;
    let x = 0, z = 0, y = 0;
    if (on && role !== ROLE_THING) {
      const want = a.side === undefined ? "" : text(a, "side");
      const picked = this.socket(on.ref, kind, want);
      if (typeof picked === "string") return refused(picked);
      socket = picked;
      poseAt(world.structs, reg, on.ref, kind, socket, 0, this.pose);
      [x, y, z] = [this.pose.x / STRUCT_UNITS, this.pose.y / STRUCT_UNITS, this.pose.z / STRUCT_UNITS];
    } else {
      const at = this.where(a);
      [x, z] = at ?? (on ? [on.x, on.z] : [s.own.x, s.own.z + 3]);
      y = on ? on.y : world.hf.heightAt(x, z);
    }
    const yaw = Math.round((amount(a, "facing", 0, 360, 0) / 360) * YAW_UNITS) & (YAW_UNITS - 1);
    // Near enough that the eye is in reach, and not in its way: three metres from where it goes, on the side it stands.
    const away = Math.hypot(s.own.x - x, s.own.z - z);
    if (away < 2.4 || away > 6 || Math.abs(s.own.y - y) > 4) {
      const dx = away > 0.1 ? (s.own.x - x) / away : 0;
      const dz = away > 0.1 ? (s.own.z - z) / away : -1;
      this.controller.walkTo(this.now, this.controller.place(x + dx * 3.2, z + dz * 3.2), 0.8);
      const walked = await this.finish(amount(a, "wait_s", 0, 50, 25), ctx);
      if (walked.state !== "done") return walked;
    }
    const held = await this.inHand(item);
    if (held.state !== "done") return held;
    const before = new Set(this.builtNear(kind, x, z));
    const seq = this.commands.send(CMD_PLACE, (w) => {
      w.u8(Math.max(0, variant));
      if (socket >= 0) {
        w.u32(on!.ref);
        w.u8(socket);
        w.u8(0);
        return;
      }
      w.u32(on ? on.ref : OPEN_GROUND);
      if (on) w.u8(ON_TOP);
      w.sbits(Math.round(x * STRUCT_UNITS), 32);
      w.sbits(Math.round(z * STRUCT_UNITS), 32);
      w.u16(yaw);
      if (!on) w.sbits(0, 8);
      w.u8(0);
    });
    const code = seq === 0 ? 0 : await this.result(seq);
    if (code !== RESULT_OK) return this.outcome(seq, code, {});
    // The new row comes with the chunk's next news.
    const ref = await this.until((now) => this.builtNear(kind, x, z).find((r) => !before.has(r)) ?? (now > this.now + ANSWER_MS ? -1 : null));
    return ref >= 0 ? { state: "done", placed: this.nameOf(kind), id: `s${ref}` } : { state: "done", placed: this.nameOf(kind) };
  }

  /**
   * The socket of piece `ref` that a `kind` takes on side `side`: by the compass, from the piece's middle to where the new one
   * would stand; top for one above, bottom below; for a ceiling on a wall, over the floor the wall stands on.
   */
  private socket(ref: number, kind: number, asked: string): number | string {
    let side = asked;
    const s = this.session;
    const reg = s.registry;
    const structs = s.world!.structs;
    const n = socketsOf(structs, reg, ref, kind, this.sockets);
    if (n === 0) return `a ${this.nameOf(kind)} does not join a ${this.nameOf(structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!)}`;
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    const tx = t.x[slot]!, ty = t.y[slot]!, tz = t.z[slot]!;
    const named: string[] = [];
    let best = -1;
    for (let k = 0; k < n; k++) {
      poseAt(structs, reg, ref, kind, k, 0, this.pose);
      const dx = this.pose.x / STRUCT_UNITS - tx;
      const dy = this.pose.y / STRUCT_UNITS - ty;
      const dz = this.pose.z / STRUCT_UNITS - tz;
      const flat = Math.hypot(dx, dz);
      const word = flat < 0.3 ? (dy > 0 ? "top" : "bottom") : (["north", "west", "south", "east"][((Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) % 4) + 4) % 4]!);
      named.push(word);
      if (word === side && best < 0) best = k;
    }
    // No side asked: its only place, else on top.
    if (side === "") {
      if (n === 1) return 0;
      side = "top";
      best = named.indexOf("top");
    }
    // A ceiling on a wall goes over the room: the side the wall's foundation is on.
    if (best < 0 && side === "top" && reg.role[t.kind[slot]!] === 1) best = this.overRoom(ref, kind, n);
    if (best >= 0) return best;
    return `a ${this.nameOf(kind)} goes on the ${[...new Set(named)].join(", ")} of ${`s${ref}`}, not the ${side}`;
  }

  /** Of a wall's sockets for a ceiling, the one above a floor of the tribe's, else the first. */
  private overRoom(ref: number, kind: number, n: number): number {
    const structs = this.session.world!.structs;
    const reg = this.session.registry;
    for (let k = 0; k < n; k++) {
      poseAt(structs, reg, ref, kind, k, 0, this.pose);
      const x = this.pose.x / STRUCT_UNITS;
      const z = this.pose.z / STRUCT_UNITS;
      const m = structs.query(x - 0.2, z - 0.2, x + 0.2, z + 0.2, this.found);
      for (let i = 0; i < m; i++) {
        const r = this.found.refs[i]!;
        const t = structs.chunks[Math.floor(r / 65536)]!;
        const kd = t.kind[r & 0xffff]!;
        // A floor the ceiling would stand straight over, centre on centre.
        if ((reg.role[kd] === ROLE_FOUNDATION || reg.role[kd] === 2) && Math.hypot(t.x[r & 0xffff]! - x, t.z[r & 0xffff]! - z) < 0.3) return k;
      }
    }
    return 0;
  }

  /** Refs of the things of `kind` standing within a metre and a half of (x, z), as this client has them. */
  private builtNear(kind: number, x: number, z: number): number[] {
    const structs = this.session.world!.structs;
    const out: number[] = [];
    const n = structs.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      if (t.kind[ref & 0xffff] === kind && Math.hypot(t.x[ref & 0xffff]! - x, t.z[ref & 0xffff]! - z) < 1.5) out.push(ref);
    }
    return out;
  }

  /** Walks to something built and acts on it, as a player's radial menu on it does. */
  private structure(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const reg = this.session.registry;
    const what = text(a, "do");
    const action = ACTIONS[what];
    if (action === undefined) throw new Bad(`do is one of ${Object.keys(ACTIONS).join(", ")}`);
    const words = what === "name" ? text(a, "name") : "";
    if (new TextEncoder().encode(words).length > MAX_NAME_BYTES) throw new Bad(`a name is at most ${MAX_NAME_BYTES} letters`);
    const target = this.target(a);
    if (target.ref < 0) throw new Bad(`${target.id} is not something built`);
    if ((what === "name" || what === "travel") && reg.isBed[target.kind] !== 1) throw new Bad(`${target.id} is not a bed`);
    const fire = reg.lights[target.kind] !== 0;
    if ((what === "light" || what === "put_out") && !fire) throw new Bad(`${target.id} is not something that burns`);
    // A fire is lit and put out by one action, which changes it to its other kind: asked for what it already is, it is left so.
    if (fire && (what === "light") === (reg.burning[target.kind] === 1)) return Promise.resolve({ state: "done", already: what === "light" ? "burning" : "out" });
    const pin = what === "pin" ? whole(a, "pin", 0, 9999) : NO_PIN;
    this.controller.act(this.now, target, action, words, pin);
    return this.finish(amount(a, "wait_s", 0, 50, 25), ctx);
  }

  private async say(a: Record<string, unknown>): Promise<Answer> {
    const channel = CHANNELS[text(a, "channel")];
    const words = text(a, "text");
    if (channel === undefined) throw new Bad("channel must be global, local or tribe");
    if (words.length > MAX_CHAT_CHARS) throw new Bad(`text must be at most ${MAX_CHAT_CHARS} characters`);
    const earned = Math.floor((this.now - this.chatAt) / CHAT_EARN_MS);
    if (earned > 0) {
      this.chatLines = Math.min(CHAT_BURST, this.chatLines + earned);
      this.chatAt = this.chatLines === CHAT_BURST ? this.now : this.chatAt + earned * CHAT_EARN_MS;
    }
    if (this.chatLines === 0) return refused("you are saying too much at once: wait two seconds");
    if (!this.commands.allow()) return this.outcome(0, 0, {});
    if (this.chatLines === CHAT_BURST) this.chatAt = this.now;
    this.chatLines--;
    const before = this.session.logVersion;
    const seq = this.session.chat(channel, words);
    const answer = this.outcome(seq, await this.result(seq), { said: words });
    // The server says why it would not pass a line on.
    const why = this.since(before).find((l) => l.channel === TEXT_NOTICE);
    return why && answer.state === "blocked" ? { ...answer, reason: why.text } : answer;
  }

  private since(logVersion: number): TextLine[] {
    const fresh = Math.min(this.session.log.length, this.session.logVersion - logVersion);
    return fresh > 0 ? this.session.log.slice(-fresh) : [];
  }

  private async typed(a: Record<string, unknown>): Promise<Answer> {
    const line = text(a, "line");
    for (let tries = 0; ; tries++) {
      // The server takes a line every 200 ms by its own clock. A line asked sooner waits its turn, in the order asked, and one
      // that still arrives too soon is sent again.
      const at = Math.max(this.now, this.consoleAt + CONSOLE_GAP_MS);
      this.consoleAt = at;
      if (at > this.now) await this.pause(at - this.now);
      if (!this.commands.allow()) return this.outcome(0, 0, {});
      const before = this.session.logVersion;
      const seq = this.session.text(line);
      const code = await this.result(seq);
      // What a command prints arrives before its result.
      if (code !== RESULT_BUSY || tries === 2) return this.outcome(seq, code, { lines: this.since(before).map((l) => l.text) });
    }
  }

  /** Eats, drinks, wears, takes in hand, loads or fits what is carried; with `on`, gives it to a creature. */
  private async useItem(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const inv = s.inventory;
    if (!inv) return refused("you carry nothing");
    const name = text(a, "item");
    if (a.on !== undefined) return this.give(a, ctx);
    if (name.trim().toLowerCase() === "water") return this.drink(ctx);
    const item = this.item(name);
    const def = reg.defs[item] as ItemDef;
    const slot = inv.item.indexOf(item);
    if (slot < 0) return refused(`you carry no ${this.nameOf(item)}`);
    const w = reg.weapon[item];
    if (w || def.tool) {
      const held = await this.inHand(item);
      return held.state === "done" ? { ...held, used: this.nameOf(item), held: this.nameOf(item) } : held;
    }
    if (def.class === "ammo" || def.attachment) {
      // Into or onto the weapon in hand, or else the first carried that takes it.
      const fits = (k: number): boolean => {
        const wd = (reg.defs[k] as ItemDef | null)?.weapon;
        return !!wd && (def.attachment ? (wd.fits ?? []).includes(def.id) : (wd.ammo ?? []).includes(def.id));
      };
      const hand = this.held();
      let weapon = hand !== 0 && fits(hand) ? inv.hotbar + s.held : -1;
      for (let k = 0; weapon < 0 && k < inv.cap; k++) if (inv.item[k] !== 0 && fits(inv.item[k]!)) weapon = k;
      if (weapon < 0) return refused(`you carry nothing that ${def.attachment ? "takes" : "fires"} ${this.nameOf(item)}`);
      const into = weapon;
      if (def.attachment) return this.send(CMD_ATTACH, (wr) => (wr.varint(into), wr.varint(slot)), { used: this.nameOf(item), on: this.nameOf(inv.item[into]!) });
      return this.send(CMD_LOAD, (wr) => (wr.varint(into), wr.u16(item)), { used: this.nameOf(item), loads_into: this.nameOf(inv.item[into]!), note: "it goes in at the next reload, which an empty weapon starts by itself" });
    }
    if (def.class === "saddle") return refused(`a saddle is put on a creature: give on, the creature's id`);
    // Food, a drink, a dose, armour and a vessel are used from where they lie, as a click in the inventory does.
    const was = s.hasVitals ? [s.vitals.at(V_FOOD, s.serverTick), s.vitals.at(V_WATER, s.serverTick)] : [0, 0];
    const used = await this.send(CMD_USE, (wr) => (wr.varint(slot), wr.u16(item)), { used: this.nameOf(item) });
    if (used.state !== "done") return used;
    // The vitals and slots follow the result by a tick or two.
    await this.pause(3000 / TICK_RATE);
    const worn = reg.wearSlot[item]! >= 0 && inv.armor >= 0 && inv.item[inv.armor + reg.wearSlot[item]!] === item;
    const ate = s.hasVitals && (s.vitals.at(V_FOOD, s.serverTick) > was[0]! + 1e5 || s.vitals.at(V_WATER, s.serverTick) > was[1]! + 1e5);
    return { ...used, ...(worn ? { worn: WORN[reg.wearSlot[item]!] } : {}), ...(ate || def.eat ? { self: this.self() } : {}) };
  }

  /** A drink from the water it stands or swims in: the use button with nothing to use, as ARK's E is. */
  private async drink(ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const b = s.own;
    if (!(b.y < s.world!.hf.waterAt(b.x, b.z))) return refused("you are not in water: walk into a lake or the sea, or use a filled water skin; observe shows deep water as ~");
    this.idle();
    const was = s.vitals.at(V_WATER, s.serverTick);
    this.controller.useOn(this.now, null, () => (s.vitals.at(V_WATER, s.serverTick) > was + 1e5 ? "" : null));
    const answer = await this.finish(10, ctx);
    return answer.state === "done" ? { state: "done", used: "water", self: this.self() } : answer;
  }

  /** Food or a narcotic into a knocked-out creature, or a saddle onto a tame: it opens the creature, moves the item in, and feeds or saddles. */
  private async give(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const item = this.item(text(a, "item"));
    const inv = s.inventory!;
    if (inv.total(item) === 0) return refused(`you carry no ${this.nameOf(item)}`);
    const target = this.target(a, "on");
    if (target.entity < 0 || (target.flags & (VIEW_PROP | VIEW_PLAYER)) !== 0) throw new Bad(`${target.id} is not a creature`);
    const saddle = reg.saddleFits[item] !== 0;
    const dose = reg.doseTorpor[item]! > 0;
    if (saddle && reg.saddleFits[item] !== target.kind) throw new Bad(`a ${this.nameOf(item)} fits a ${this.nameOf(reg.saddleFits[item]!)}, not a ${this.nameOf(target.kind)}`);
    const opened = await this.openCreature(target, amount(a, "wait_s", 0, 50, 25), ctx);
    if (opened.state !== "done") return opened;
    const want = saddle || (dose && a.count === undefined) ? 1 : a.count === undefined ? inv.total(item) : whole(a, "count", 1, 65535);
    let left = Math.min(want, inv.total(item));
    while (left > 0) {
      const from = inv.item.indexOf(item);
      const box = s.open?.inventory;
      if (from < 0 || !box) break;
      const n = Math.min(left, inv.count[from]!);
      let to = -1;
      for (let k = 0; k < box.bag && to < 0; k++) if (box.item[k] === item && box.count[k]! + n <= reg.stack[item]!) to = k;
      if (to < 0) to = box.free();
      if (to < 0) return { state: "blocked", reason: "its inventory is full", ...this.opened() };
      const moved = await this.send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_OPEN, 1), w.varint(to), w.u16(n === inv.count[from] ? 0 : n), w.u16(item)));
      if (moved.state !== "done") return moved;
      await this.pause(3000 / TICK_RATE);
      left -= n;
    }
    if (saddle || dose) {
      const box = s.open?.inventory;
      const at = box ? box.item.indexOf(item) : -1;
      if (at < 0) return { state: "blocked", reason: `the ${this.nameOf(item)} did not reach its inventory` };
      const fed = await this.send(CMD_FEED, (w) => (w.varint(at), w.u16(item)), { used: this.nameOf(item), on: target.id });
      await this.pause(3000 / TICK_RATE);
      return fed.state === "done" ? { ...fed, ...this.opened() } : fed;
    }
    return { state: "done", used: this.nameOf(item), gave: want - left, on: target.id, ...this.opened(), note: "it eats what lies in its inventory by itself; status shows how its taming goes while it is open" };
  }

  /** Gets on a saddled tame or into a car, or off or out. */
  private async mount(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const seated = (): boolean => s.driving >= 0 || s.own.seat !== 0;
    if (a.off === true) {
      if (!seated()) return refused("you ride nothing");
      this.idle();
      const before = s.logVersion;
      this.commands.news = -1;
      // The server says why it will not let a rider off: no room beside, or a drop too far.
      this.controller.useOn(this.now, null, () => (!seated() ? "" : this.since(before).find((l) => l.channel === TEXT_NOTICE)?.text ?? (this.commands.news > 0 ? resultWords(this.commands.news) : null)));
      const answer = await this.finish(seconds, ctx);
      return answer.state === "done" ? { state: "done", task: "mount", off: true, self: this.self() } : answer;
    }
    if (a.id === undefined) throw new Bad("give the id of a saddled creature or a car, or off");
    if (seated()) return refused("you already ride something: mount with off first");
    const target = this.target(a);
    const car = reg.vehicle[target.kind] !== null && reg.vehicle[target.kind] !== undefined;
    if (target.entity < 0 || (target.flags & (VIEW_PROP | VIEW_PLAYER)) !== 0) throw new Bad(`${target.id} is not a creature or a car`);
    if (!car && (s.tribe.team === 0 || this.teamOf(target.entity) !== s.tribe.team)) return refused(`${target.id} is not your tribe's: tame it first`);
    const before = s.logVersion;
    // A car is got into at its driver's door, on its side, not at its middle.
    let door: [number, number] | undefined;
    const hull: [number, number][] = [];
    const def = reg.vehicle[target.kind];
    const seat = def?.seats.find((st) => st.driver);
    if (def && seat) {
      const r = this.remote;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== target.entity) continue;
        const side = Math.sign(seat.entry[0]) * Math.max(Math.abs(seat.entry[0]), def.spec.halfWidth + reg.move[s.ownKind]!.radius + 0.08);
        vehiclePoint({ x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]!, pitch: r.vehiclePitch[i]!, roll: r.vehicleRoll[i]! }, [side, 0, seat.entry[2]], this.at);
        door = [this.at[0]!, this.at[2]!];
        // The hull, and a body's width round it, is kept off on the way to the door.
        const frame = { x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]!, pitch: 0, roll: 0 };
        const wide = def.spec.halfWidth + 0.4;
        const long = def.spec.halfLength + 0.4;
        for (let lx = -wide; lx <= wide + 1e-6; lx += 0.5) {
          for (let lz = -long; lz <= long + 1e-6; lz += 0.5) {
            vehiclePoint(frame, [lx, 0, lz], this.at);
            hull.push([this.at[0]!, this.at[2]!]);
          }
        }
      }
    }
    this.controller.useOn(this.now, target, () => (seated() ? "" : this.since(before).find((l) => l.channel === TEXT_NOTICE)?.text ?? (this.commands.news > 0 ? resultWords(this.commands.news) : null)), door, hull);
    this.commands.news = -1;
    const answer = await this.finish(seconds, ctx);
    if (answer.state === "blocked" && answer.reason === "nothing came of it" && !car) return { ...answer, reason: `${target.id} would not take you: it needs a saddle on (use_item its saddle on it), to be grown and awake` };
    return answer.state === "done" ? { state: "done", task: "mount", ...this.riding(), self: this.self() } : answer;
  }

  private async craft(a: Record<string, unknown>, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const item = this.item(text(a, "recipe"));
    const count = whole(a, "count", 1, 100, 1);
    const waitMs = amount(a, "wait_s", 0, 50, 20) * 1000;
    const needs = reg.recipeOf[item];
    if (!needs) return refused(`${this.nameOf(item)} cannot be made`);
    const recipe: Record<string, number> = {};
    for (let k = 0; k + 1 < needs.length; k += 2) recipe[this.nameOf(needs[k]!)] = needs[k + 1]!;
    const at = reg.craftAt[item]!;
    const def = reg.defs[item] as ItemDef;
    if (def.craft?.fired) return refused(`${this.nameOf(item)} is not crafted: a lit ${this.nameOf(at)} makes it by itself from ${Object.keys(recipe).join(" and ")} lying in it. Open the ${this.nameOf(at)}, move them in, and light it with structure`);
    if (at === 0 && a.at !== undefined) return refused(`${this.nameOf(item)} is made in the hands, not at a station`);
    const engram = reg.defs.findIndex((d) => d?.type === "engram" && (d as EngramDef).item === reg.ids[item]);
    if (engram >= 0 && !s.progress.engrams.includes(engram)) {
      const e = reg.defs[engram] as EngramDef;
      if (a.learn !== true) return refused(`you have not learned ${this.nameOf(item)}: it takes level ${e.level} and ${e.cost} engram points, and learn: true spends them`);
      const learned = await this.send(CMD_LEARN, (w) => w.u16(engram));
      if (learned.state !== "done") return { ...learned, reason: `could not learn ${this.nameOf(item)} (level ${e.level}, ${e.cost} points): ${String(learned.reason)}` };
    }
    if (at !== 0) return this.craftAt(a, item, count, at, recipe, waitMs, ctx);
    const had = s.inventory?.total(item) ?? 0;
    const queued = await this.send(CMD_CRAFT, (w) => (w.u16(item), w.u8(count)));
    if (queued.state !== "done") return { ...queued, needs: recipe };
    const by = this.now + waitMs;
    const want = count * (reg.recipeMakes[item]! || 1);
    const made = (): number => (s.inventory?.total(item) ?? 0) - had;
    // The server drops a job it cannot go on with, so a list that fills and then empties short of the count means that.
    let begun = false;
    const state = await this.until((now) => {
      begun ||= s.progress.jobs.length > 0;
      return made() >= want ? "done" : begun && s.progress.jobs.length === 0 ? "blocked" : now >= by ? "running" : null;
    });
    if (state === "blocked") await this.pause(3000 / TICK_RATE);
    const answer: Answer = { state: made() >= want ? "done" : state, item: this.nameOf(item), made: made() };
    if (answer.state === "blocked") return { ...answer, reason: "the ingredients ran out", needs: recipe };
    return answer.state === "running" ? { ...answer, making: s.progress.jobs.map((j) => [this.nameOf(j.item), j.left]) } : answer;
  }

  /** The nearest station of `kind` (lit or out) of the tribe's in sight, as an id, or null. */
  private stationNear(kind: number): string | null {
    const s = this.session;
    const reg = s.registry;
    const structs = s.world!.structs;
    let best: string | null = null;
    let least = Infinity;
    structs.chunks.forEach((t, chunk) => {
      for (let slot = 0; t && slot < t.high; slot++) {
        const k = t.kind[slot]!;
        if (k === 0 || (k !== kind && reg.stationBase[k] !== kind)) continue;
        const far = Math.hypot(t.x[slot]! - s.own.x, t.z[slot]! - s.own.z);
        if (far < least) [least, best] = [far, `s${chunk * 65536 + slot}`];
      }
    });
    return best;
  }

  /** Crafting at a station: it walks there and opens it, queues the job, and waits for what is made to lie in the station. */
  private async craftAt(a: Record<string, unknown>, item: number, count: number, kind: number, recipe: Record<string, number>, waitMs: number, ctx: CallContext): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const id = a.at !== undefined ? text(a, "at") : this.stationNear(kind);
    if (!id) return refused(`${this.nameOf(item)} is made at a ${this.nameOf(kind)}, and none is in sight: build one, or give at`);
    const station = this.target({ id });
    if (station.ref < 0 || (station.kind !== kind && reg.stationBase[station.kind] !== kind)) return refused(`${this.nameOf(item)} is made at a ${this.nameOf(kind)}, and ${id} is a ${this.nameOf(station.kind)}`);
    if (s.station?.ref !== station.ref) {
      this.controller.open(this.now, station, NO_PIN);
      const opened = await this.finish(amount(a, "wait_s", 0, 50, 20), ctx);
      if (opened.state !== "done") return opened;
      await this.until((now) => (s.station?.ref === station.ref || now > this.now + ANSWER_MS ? true : null));
    }
    const box = (): Inventory | null => (s.station?.ref === station.ref ? (s.open?.inventory ?? null) : null);
    const had = box()?.total(item) ?? 0;
    const before = s.logVersion;
    const queued = await this.send(CMD_CRAFT_AT, (w) => (w.u16(item), w.u8(count)));
    if (queued.state !== "done") {
      const why = this.since(before).find((l) => l.channel === TEXT_NOTICE)?.text;
      return { ...queued, ...(why ? { reason: why } : {}), needs: recipe, note: "what a station makes comes from what lies in it", ...this.opened() };
    }
    const by = this.now + waitMs;
    const want = count * (reg.recipeMakes[item]! || 1);
    const made = (): number => (box()?.total(item) ?? had) - had;
    let begun = false;
    const state = await this.until((now) => {
      const jobs = s.station?.jobs.length ?? 0;
      begun ||= jobs > 0;
      return made() >= want ? "done" : !box() ? "blocked" : begun && jobs === 0 ? "blocked" : now >= by ? "running" : null;
    });
    await this.pause(3000 / TICK_RATE);
    const answer: Answer = { state: made() >= want ? "done" : state, item: this.nameOf(item), made: made(), at: id, ...this.opened() };
    if (answer.state === "blocked") return { ...answer, reason: box() ? "the ingredients ran out" : "the station was shut", needs: recipe };
    return answer.state === "done" ? { ...answer, note: "what is made lies in the station: move_item from box takes it" } : answer;
  }

  private async moveItem(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const box = (key: string, ground: boolean): number => {
      const v = a[key];
      if (v === "ground" && ground) return -1;
      if (v !== "self" && v !== "box") throw new Bad(`${key} must be self or box${ground ? ", or ground" : ""}`);
      return v === "self" ? BOX_SELF : BOX_OPEN;
    };
    const fromBox = box("from", false);
    const toBox = box("to", true);
    const invOf = (b: number): Inventory | null => (b === BOX_SELF ? s.inventory : (s.open?.inventory ?? null));
    const src = invOf(fromBox);
    const dst = toBox < 0 ? null : invOf(toBox);
    if (!src || (toBox >= 0 && !dst)) return refused("you have no box open: open one first");
    let slot: number;
    if (a.item !== undefined) {
      const want = this.item(text(a, "item"));
      slot = src.item.indexOf(want);
      if (slot < 0) return refused(`there is no ${this.nameOf(want)} there`);
    } else slot = whole(a, "slot", 0, src.cap - 1);
    const item = src.item[slot]!;
    if (item === 0) return refused(`slot ${slot} is empty`);
    const count = whole(a, "count", 0, 65535, 0);
    if (count > src.count[slot]!) return refused(`slot ${slot} holds only ${src.count[slot]}`);
    if (toBox < 0) {
      if (fromBox !== BOX_SELF) return refused("only what you carry can be dropped: move it to self first");
      const dropped = await this.send(CMD_DROP, (w) => (w.varint(slot), w.u16(count), w.u16(item)), { dropped: this.nameOf(item), count: count || src.count[slot] });
      return dropped;
    }
    let to: number;
    if (a.to_slot !== undefined) to = whole(a, "to_slot", 0, dst!.cap - 1);
    else {
      if (src === dst) return refused("to_slot is needed to move within one inventory");
      // Onto a stack of the same item with room, else into the first empty slot.
      const stack = reg.stack[item]!;
      to = -1;
      for (let k = 0; k < dst!.bag && to < 0; k++) if (dst!.item[k] === item && dst!.quality[k] === src.quality[slot] && dst!.flags[k] === src.flags[slot] && dst!.flags[k] === 0 && dst!.count[k]! < stack) to = k;
      if (to < 0) to = dst!.free();
      if (to < 0) return refused("there is no room there");
    }
    const into = to;
    const seq = this.commands.send(CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.varint(slot);
      w.bits(toBox, 1);
      w.varint(into);
      w.u16(count);
      w.u16(item);
    });
    const code = seq === 0 ? 0 : await this.result(seq);
    if (code === RESULT_OK) await this.pause(3000 / TICK_RATE);
    // A bag emptied is gone, and with it what was open.
    const now = invOf(fromBox);
    return this.outcome(seq, code, { moved: this.nameOf(item), to_slot: into, left: now === src && src.item[slot] === item ? src.count[slot]! : 0 });
  }
}
