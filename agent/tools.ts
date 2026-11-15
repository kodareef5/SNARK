// The tools an agent plays through, each a thing a player can do. An Agent drives one session: `tick` it at the frame rate,
// and `call` a tool by name. A call resolves from inside a later tick, so the clock that ticks it is the only clock.

import { RemoteSample, type ClientSession, type TextLine } from "../client/core/session.ts";
import type { ItemDef, PropDef } from "../shared/content/defs.ts";
import { find } from "../shared/content/find.ts";
import { STRUCT_UNITS, TICK_RATE, YAW_UNITS } from "../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CARRY_DROP, CARRY_PICK_UP, CARRY_THROW, CHOOSE_ARRIVED, CHOOSE_DIED, CHOOSE_TRAVEL, CMD_CARRY, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_ORDER, CMD_PLACE, CMD_RESPAWN, CMD_SELECT, CMD_TAKE, CMD_USE, MAX_CHAT_CHARS, MAX_NAME_BYTES, SESSION_DEAD, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_WANDER, ORDER_YOURS, RESULT_BUSY, RESULT_OK, SESSION_ALIVE, TEXT_GLOBAL, TEXT_LOCAL, TEXT_NOTICE, TEXT_TRIBE } from "../shared/net/protocol.ts";
import { STAMINA_UNITS } from "../shared/sim/character.ts";
import type { Inventory } from "../shared/sim/items.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_WATER } from "../shared/sim/vitals.ts";
import { NO_PIN, STRUCT_NAME, STRUCT_TRAVEL } from "../shared/world/upkeep.ts";
import { ON_TOP, ROLE_FOUNDATION, ROLE_THING } from "../shared/world/snap.ts";
import { Found } from "../shared/world/structures.ts";
import { Commands, resultWords } from "./commands.ts";
import { Controller, type Target } from "./controller.ts";
import type { Answer, ToolDef, ToolHost } from "./mcp.ts";
import { CUE_DEAD } from "../shared/anim/pose.ts";
import { VIEW_PROP, compass, observe, shortName, type FarLayer } from "./observe.ts";

export const INSTRUCTIONS =
  "You play one survivor in SNARK, a survival game, through these tools. You can do what a player can and no more. " +
  "Positions are x and z in metres: north is +z and east is -x. Things have ids: n12.3 is a tree, rock or bush, s65539 is something built, e7 is a creature, a player, a dead creature, an egg or a bag. " +
  "Every answer has a state: done, running (still going; ask status), blocked (it stopped short, and reason says why), danger (it stopped because you are in danger) or refused (nothing was done). " +
  "walk_to, harvest, attack, open, pick_up, place and bed take time and only one of them runs at once. An answer lists dangers while there are any: a hunter near, health falling, breath running out. " +
  "With no body, after a death or travelling from a bed, status lists under choosing where you may rise, and rise takes you there.";

/** Chat lines a survivor may say at once, and the milliseconds that earn another, as server/chat.ts counts them. */
const CHAT_BURST = 5;
const CHAT_EARN_MS = 2000;
const CONSOLE_GAP_MS = 250;
/** What an order is called, and its code. The three stances follow ORDER_STANCE. */
const ORDERS: Record<string, number> = { stay: ORDER_STAY, follow: ORDER_FOLLOW, wander: ORDER_WANDER, passive: ORDER_STANCE, neutral: ORDER_STANCE + 1, aggressive: ORDER_STANCE + 2, attack_my_target: ORDER_YOURS, attack: ORDER_ATTACK, mate: ORDER_MATE, no_mating: ORDER_UNMATE };
/** A command the server has not answered after this long is given up on. */
const ANSWER_MS = 3000;
const CHANNELS: Record<string, number> = { global: TEXT_GLOBAL, local: TEXT_LOCAL, tribe: TEXT_TRIBE };
const CHANNEL_WORDS: Record<number, string> = { [TEXT_GLOBAL]: "global", [TEXT_LOCAL]: "local", [TEXT_TRIBE]: "tribe", [TEXT_NOTICE]: "notice" };
/** A place command's target for open ground, as server/build.ts reads it. */
const OPEN_GROUND = 0xffffffff;
/** Why a survivor without a body chooses, in words. */
const CHOOSE_WORDS: Record<number, string> = { [CHOOSE_DIED]: "died", [CHOOSE_ARRIVED]: "arrived", [CHOOSE_TRAVEL]: "travelling from a bed" };

const wait = { type: "number", description: "Seconds to wait for it to finish before answering running, 0 to 50." };
const thing = { type: "string", description: "An id from observe." };
const DEFS: ToolDef[] = [
  { name: "observe", description: "Look around: a map of the ground about you in letters, north up, and the nearest trees, rocks, bushes, boxes, doors, creatures and players with their ids. Use it before walking anywhere.", inputSchema: { type: "object", properties: { radius: { type: "number", description: "Metres each way, 8 to 96. Default 32." }, cell: { type: "integer", enum: [1, 2, 4], description: "Metres a letter covers. Default 2. A letter shows the most solid thing in its square, so a doorway may only show at 1. A letter of 1 m shows at most 32 m each way, and one of 2 m at most 64." } } } },
  { name: "walk_to", description: "Walk to a place, or up to a thing, round whatever is in between. Give x and z, or an id. Ground floor only: it climbs no stairs, and it swims only to get out of water.", inputSchema: { type: "object", properties: { x: { type: "number" }, z: { type: "number" }, id: thing, within: { type: "number", description: "How near to come, in metres: to the place, or to the thing's side. Default 0.6." }, wait_s: { ...wait, description: `${wait.description} Default 25.` } } } },
  { name: "harvest", description: "Gather from a tree, a rock or a bush: walk to it, then strike it, or pick it, until it is used up or you have enough. It stops after a minute.", inputSchema: { type: "object", properties: { id: thing, until: { type: "object", description: "Stop once this many more of an item are carried. Left out: when the node is used up.", properties: { item: { type: "string" }, count: { type: "integer" } }, required: ["item", "count"] }, tool: { type: "string", description: "An item you carry to take in hand first, such as hatchet for wood or pick for stone." }, wait_s: { ...wait, description: `${wait.description} Default 25.` } }, required: ["id"] } },
  { name: "open", description: "Open a box or a bag, or swing a door: walk to it and use it. What a box holds is in the answer and in status, and move_item moves things in and out of it. It shuts when you walk away.", inputSchema: { type: "object", properties: { id: thing, pin: { type: "integer", description: "The PIN of a locked thing that is not your tribe's, 0 to 9999." }, wait_s: { ...wait, description: `${wait.description} Default 25.` } }, required: ["id"] } },
  { name: "attack", description: "Strike a creature or a player with what you hold, or bare hands: walk up to it, keep after it, and hit it until it is gone from sight (dead, most often), or with until out until it is knocked out, ready to tame. A dead creature is harvested the same way, or with harvest. It stops after a minute, for a new danger, or when your health is under two thirds and still falling.", inputSchema: { type: "object", properties: { id: { type: "string", description: "A creature, a player or a dead creature, as observe lists them." }, with: { type: "string", description: "An item you carry to take in hand first, such as club. Left out: what you hold, or bare hands." }, until: { description: "\"out\" for knocked out, \"dead\" (the default), or an item and a count to gather from a dead creature.", oneOf: [{ type: "string", enum: ["out", "dead"] }, { type: "object", properties: { item: { type: "string" }, count: { type: "integer" } }, required: ["item", "count"] }] }, wait_s: { type: "number", description: "Seconds to wait for it before answering running. 25 if left out." } }, required: ["id"] } },
  { name: "pick_up", description: "Walk to a small creature, wild or your tribe's, and take it in your arms, or to an egg and take it into your inventory. While you hold a creature your hands are full.", inputSchema: { type: "object", properties: { id: { type: "string", description: "A creature or an egg, as observe lists them." }, wait_s: { type: "number", description: "Seconds to wait for the walk before answering running. 25 if left out." } }, required: ["id"] } },
  { name: "put_down", description: "Set down the creature you hold, or throw it where you look.", inputSchema: { type: "object", properties: { throw: { type: "boolean", description: "True to throw it." } } } },
  { name: "order", description: "Order a tamed creature of your tribe, or with no id every one within earshot, as a whistle does.", inputSchema: { type: "object", properties: { id: { type: "string", description: "A creature. Left out, or all: every tribe creature in earshot." }, order: { type: "string", enum: ["follow", "stay", "wander", "passive", "neutral", "aggressive", "attack_my_target", "attack", "mate", "no_mating"], description: "attack needs a target. wander, mate and no_mating need an id." }, target: { type: "string", description: "For attack: the creature or player to go for." } }, required: ["order"] } },
  { name: "move_item", description: "Move a stack between slots of your inventory (self) and the box you have open (box). Slots are numbered as status lists them.", inputSchema: { type: "object", properties: { from: { type: "string", enum: ["self", "box"] }, slot: { type: "integer" }, to: { type: "string", enum: ["self", "box"] }, to_slot: { type: "integer", description: "Left out: onto a stack of the same item, else the first empty slot." }, count: { type: "integer", description: "Left out: the whole stack." } }, required: ["from", "slot", "to"] } },
  { name: "craft", description: "Make an item you know the engram for, from what you carry.", inputSchema: { type: "object", properties: { recipe: { type: "string", description: "The item, such as hatchet." }, count: { type: "integer", description: "1 to 100. Default 1." }, learn: { type: "boolean", description: "Spend engram points to learn it first if you do not know it." }, wait_s: { ...wait, description: `${wait.description} Default 20.` } }, required: ["recipe"] } },
  { name: "eat", description: "Eat or drink something you carry.", inputSchema: { type: "object", properties: { item: { type: "string", description: "Left out: the first thing you carry that can be eaten." } } } },
  { name: "say", description: "Say a line of chat. Five at once, then one every two seconds.", inputSchema: { type: "object", properties: { channel: { type: "string", enum: ["global", "local", "tribe"], description: "Everyone, those within 60 m, or your tribe." }, text: { type: "string", description: `At most ${MAX_CHAT_CHARS} characters.` } }, required: ["channel", "text"] } },
  { name: "place", description: "Set down a foundation, or a thing built that stands by itself, such as a bed, a sleeping bag, a box or a campfire, from what you carry: on the ground at x and z, or on a floor or foundation of your tribe's given by its id. A simple bed goes only on a floor or foundation. You walk to stand three metres south of the place first. The answer gives the new thing's id.", inputSchema: { type: "object", properties: { item: { type: "string", description: "What you carry to set down, such as simple bed." }, x: { type: "number" }, z: { type: "number" }, on: { type: "string", description: "A floor or foundation of your tribe's to set it on. Without x and z, its middle." }, facing: { type: "number", description: "Degrees, 0 to 360. Default 0." }, wait_s: { ...wait, description: `${wait.description} Default 25.` } }, required: ["item"] } },
  { name: "bed", description: "Walk to a bed or sleeping bag of your tribe and name it (as your tribe sees it when choosing where to rise), or travel from it to another of your tribe's beds: you leave your body there and choose where to rise with rise.", inputSchema: { type: "object", properties: { id: thing, do: { type: "string", enum: ["name", "travel"] }, name: { type: "string", description: `For name: at most ${MAX_NAME_BYTES} letters.` }, wait_s: { ...wait, description: `${wait.description} Default 25.` } }, required: ["id", "do"] } },
  { name: "rise", description: "While you have no body, after a death or travelling from a bed: rise at one of the places status lists under choosing, by its number or its name. A place that still waits refuses until it is ready.", inputSchema: { type: "object", properties: { place: { description: "A number or a name from status's choosing.", oneOf: [{ type: "integer" }, { type: "string" }] } }, required: ["place"] } },
  { name: "status", description: "How you are and how the running task is doing: place, vitals, what you carry, the box you have open, what you are making, and chat heard since you last asked.", inputSchema: { type: "object", properties: { wait_s: { ...wait, description: "Seconds to wait for the running task to end before answering, 0 to 50. Default 0." } } } },
  { name: "cancel", description: "Stop the running task where it is.", inputSchema: { type: "object", properties: {} } },
  { name: "console", description: "Type a line at the server's console, as a player does with the backquote key. Most commands need admin rights.", inputSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] } },
];

/** The tools on offer. `console` is among them only if asked for. */
export function toolDefs(withConsole: boolean): ToolDef[] {
  return DEFS.filter((d) => withConsole || d.name !== "console");
}

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
  private readonly run: Record<string, (a: Record<string, unknown>) => Answer | Promise<Answer>>;
  /** Each returns true once it has resolved its promise. */
  private readonly waiting: ((now: number) => boolean)[] = [];
  private now = 0;
  private chatLines = CHAT_BURST;
  private chatAt = 0;
  private consoleAt = -CONSOLE_GAP_MS;
  /** `session.logVersion` when status last told what was heard. */
  private heardTo = 0;
  /** The calls not yet answered. They are answered when the session closes, so none is left waiting on a server that has gone. */
  private readonly pending = new Set<(a: Answer) => void>();
  private readonly found = new Found();

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
        return observe(this.session, this.remote, amount(a, "radius", 8, 96, 32), cell, this.far) as Answer;
      },
      walk_to: (a) => this.walkTo(a),
      harvest: (a) => this.harvest(a),
      open: (a) => this.open(a),
      attack: (a) => this.attack(a),
      pick_up: (a) => this.pickUp(a),
      put_down: (a) => this.putDown(a),
      order: (a) => this.order(a),
      move_item: (a) => this.moveItem(a),
      craft: (a) => this.craft(a),
      eat: (a) => this.eat(a),
      say: (a) => this.say(a),
      place: (a) => this.put(a),
      bed: (a) => this.bed(a),
      rise: (a) => this.rise(a),
      status: (a) => this.status(a),
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
    const c = this.controller;
    c.step(now);
    s.update(now, c.moveX, c.moveZ, c.yaw, c.pitch, c.buttons);
    for (let i = 0; i < this.waiting.length; ) {
      if (this.waiting[i]!(now)) this.waiting.splice(i, 1);
      else i++;
    }
  }

  list(): ToolDef[] {
    return toolDefs(this.withConsole);
  }

  call(name: string, args: Record<string, unknown>): Promise<Answer> | null {
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
    try {
      running = run(args);
    } catch (err) {
      return Promise.resolve(bad(err));
    }
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

  /** What the server answered a command with, as an Answer. */
  private outcome(seq: number, code: number, done: Record<string, unknown>): Answer {
    if (seq === 0) return refused("too many commands at once: ten a second is the pace");
    if (code === RESULT_OK) return { state: "done", ...done };
    return { state: "blocked", reason: code < 0 ? "the server did not answer" : resultWords(code) };
  }

  /** The content index of the item `name` means. */
  private item(name: string): number {
    const found = find(this.session.registry, name, "item");
    if (found.kinds.length === 1) return found.kinds[0]!;
    throw new Bad(found.could.length > 0 ? `${name} could be ${found.could.join(" or ")}` : `there is no item called ${name}`);
  }

  private nameOf(kind: number): string {
    return shortName(this.session.registry.ids[kind]);
  }

  /** Every filled slot as [slot, item, count], with what is left of a thing that wears out. */
  private slots(inv: Inventory): unknown[] {
    const reg = this.session.registry;
    const out: unknown[] = [];
    for (let s = 0; s < inv.cap; s++) {
      if (inv.item[s] === 0) continue;
      const row: unknown[] = [s, this.nameOf(inv.item[s]!), inv.count[s]!];
      if (reg.uses[inv.item[s]!]! > 0) row.push(`${inv.dur[s]} uses left`);
      out.push(row);
    }
    return out;
  }

  private self(): Record<string, unknown> {
    const s = this.session;
    const b = s.own;
    const v = s.vitals;
    const vital = (i: number): number[] => [Math.round(v.at(i, s.serverTick) / 1e6), Math.round(v.max[i]! / 1e6)];
    const inv = s.inventory;
    const held = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
    return {
      x: round1(b.x),
      z: round1(b.z),
      y: round1(b.y),
      facing: compass(s.ownYaw),
      alive: s.sessionState === SESSION_ALIVE,
      ...(s.hasVitals ? { health: vital(V_HEALTH), food: vital(V_FOOD), water: vital(V_WATER), oxygen: vital(V_OXYGEN) } : {}),
      stamina: [Math.round(b.stamina / STAMINA_UNITS), b.staminaMax],
      level: s.progress.level,
      engram_points: s.progress.engramPoints,
      held: held !== 0 ? this.nameOf(held) : null,
    };
  }

  /** Lines of chat and notices that arrived since this was last asked, oldest first. */
  private heard(): string[] {
    const s = this.session;
    const fresh = Math.min(s.log.length, s.logVersion - this.heardTo);
    this.heardTo = s.logVersion;
    const lines = fresh > 0 ? s.log.slice(-fresh) : [];
    return lines.filter((l) => CHANNEL_WORDS[l.channel] !== undefined).map((l) => `[${CHANNEL_WORDS[l.channel]}] ${l.text}`);
  }

  /** Resolves when the running task ends, or after `seconds` with how far it has got. */
  private finish(seconds: number): Promise<Answer> {
    const c = this.controller;
    const by = this.now + seconds * 1000;
    return this.until((now) => c.ended ?? (now >= by ? { state: "running", ...c.progress() } : null));
  }

  /** What `id` names, if no task is in the way of starting one. */
  private target(a: Record<string, unknown>): Target {
    const busy = this.controller.busy;
    if (busy) throw new Bad(`${busy} is still running: cancel it, or wait for it with status`);
    const found = this.controller.locate(text(a, "id"));
    if (typeof found === "string") throw new Bad(found);
    return found;
  }

  private walkTo(a: Record<string, unknown>): Promise<Answer> {
    const hf = this.session.world!.hf;
    const c = this.controller;
    const near = amount(a, "within", 0.3, 50, 0.6);
    const seconds = amount(a, "wait_s", 0, 50, 25);
    // Latitude and longitude will be a third way to name a place, once shared/world/coords.ts has them.
    if (a.id === undefined && (a.x === undefined || a.z === undefined)) throw new Bad("give x and z, or an id");
    const target = a.id !== undefined ? this.target(a) : c.place(amount(a, "x", 0, hf.sizeX, 0), amount(a, "z", 0, hf.sizeZ, 0));
    if (c.busy) throw new Bad(`${c.busy} is still running: cancel it, or wait for it with status`);
    c.walkTo(this.now, target, near);
    return this.finish(seconds);
  }

  private harvest(a: Record<string, unknown>): Promise<Answer> {
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
    else if (target.chunk < 0) throw new Bad("only a tree, a rock, a bush or a dead creature can be harvested: attack is for a living one");
    else this.controller.harvest(this.now, target, item, count, tool);
    return this.finish(seconds);
  }

  /** Whether a body is a dead creature's. */
  private dead(target: Target): boolean {
    const r = this.remote;
    for (let i = 0; i < r.count; i++) if (r.id[i] === target.entity) return (r.cue[i]! & CUE_DEAD) !== 0;
    return false;
  }

  private attack(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    let item = 0;
    let count = 0;
    if (typeof a.until === "object" && a.until !== null) {
      item = this.item(text(a.until as Record<string, unknown>, "item"));
      count = whole(a.until as Record<string, unknown>, "count", 1, 10000);
    } else if (a.until !== undefined && a.until !== "out" && a.until !== "dead") throw new Bad("until is out, dead, or an item and a count");
    const tool = a.with === undefined ? 0 : this.item(text(a, "with"));
    if (tool !== 0 && (s.inventory?.total(tool) ?? 0) === 0) return Promise.resolve(refused(`you carry no ${this.nameOf(tool)}`));
    const target = this.target(a);
    const lying = (target.flags & VIEW_PROP) !== 0 && !this.dead(target);
    if (target.entity < 0 || lying) throw new Bad("only a creature, a player or a dead creature can be attacked: harvest is for a tree, a rock or a bush");
    this.controller.attack(this.now, target, item, count, tool, a.until === "out");
    return this.finish(seconds);
  }

  private async pickUp(a: Record<string, unknown>): Promise<Answer> {
    const reg = this.session.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const target = this.target(a);
    const egg = (target.flags & VIEW_PROP) !== 0 && (reg.defs[target.kind] as PropDef).class === "egg";
    if (target.entity < 0 || ((target.flags & VIEW_PROP) !== 0 && !egg)) throw new Bad("only a small creature or an egg can be picked up: open is for a bag");
    this.controller.walkTo(this.now, target, 0.9);
    const walked = await this.finish(seconds);
    if (walked.state !== "done") return walked;
    const seq = egg ? this.commands.send(CMD_TAKE, (w) => w.u32(target.entity)) : this.commands.send(CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(target.entity)));
    return this.outcome(seq, seq === 0 ? 0 : await this.result(seq), egg ? { took: this.nameOf(target.kind) } : { holding: this.nameOf(target.kind) });
  }

  private async putDown(a: Record<string, unknown>): Promise<Answer> {
    const thrown = a.throw === true;
    const seq = this.commands.send(CMD_CARRY, (w) => w.u8(thrown ? CARRY_THROW : CARRY_DROP));
    return this.outcome(seq, seq === 0 ? 0 : await this.result(seq), thrown ? { threw: true } : { set_down: true });
  }

  private async order(a: Record<string, unknown>): Promise<Answer> {
    const what = text(a, "order");
    const code = ORDERS[what];
    if (code === undefined) throw new Bad(`order is one of ${Object.keys(ORDERS).join(", ")}`);
    const body = (id: string): number => {
      const found = this.controller.locate(id);
      if (typeof found === "string") throw new Bad(found);
      if (found.entity < 0 || (found.flags & VIEW_PROP) !== 0) throw new Bad(`${id} is not a creature or a player`);
      return found.entity;
    };
    const all = a.id === undefined || a.id === "all";
    const who = all ? ORDER_ALL : body(text(a, "id"));
    const at = code === ORDER_ATTACK ? body(text(a, "target")) : -1;
    const seq = this.commands.send(CMD_ORDER, (w) => {
      w.u32(who >>> 0);
      w.u8(code);
      if (at >= 0) w.u32(at >>> 0);
    });
    return this.outcome(seq, seq === 0 ? 0 : await this.result(seq), { ordered: what, who: all ? "every tribe creature in earshot" : a.id });
  }

  private async open(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const seconds = amount(a, "wait_s", 0, 50, 25);
    const pin = a.pin === undefined ? NO_PIN : whole(a, "pin", 0, 9999);
    const target = this.target(a);
    // Of bodies only a bag or a cache: the use button on a creature would climb onto it.
    const can = target.ref >= 0 ? reg.structSlots[target.kind]! > 0 || reg.opens[target.kind] !== 0 : target.entity >= 0 && (target.flags & VIEW_PROP) !== 0 && (reg.defs[target.kind] as PropDef).class === "container";
    if (!can) throw new Bad("only a box, a bag or a door can be opened");
    this.controller.open(this.now, target, pin);
    const answer = await this.finish(seconds);
    if (answer.state !== "done" || !s.open) return answer;
    // What it holds follows the news that it is open.
    await this.pause(3000 / TICK_RATE);
    return s.open ? { ...answer, box: this.box() } : answer;
  }

  private box(): Record<string, unknown> {
    const open = this.session.open!;
    return { name: open.name, size: open.inventory.cap, slots: this.slots(open.inventory) };
  }

  private async status(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const c = this.controller;
    const task: Answer = c.busy ? await this.finish(amount(a, "wait_s", 0, 50, 0)) : (c.ended ?? { state: "done", task: null });
    const inv = s.inventory;
    const jobs = s.progress.jobs.map((j) => [this.nameOf(j.item), j.left]);
    return {
      ...task,
      self: this.self(),
      ...(s.sessionState === SESSION_DEAD ? { choosing: this.choosing() } : {}),
      ...(inv ? { inventory: this.slots(inv), hotbar_slots: [inv.hotbar, inv.hotbar + 9] } : {}),
      ...(s.open ? { box: this.box() } : {}),
      ...(jobs.length > 0 ? { making: jobs } : {}),
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
    const seq = this.commands.send(CMD_RESPAWN, (w) => (w.u8(i), w.u8(list)));
    const code = seq === 0 ? 0 : await this.result(seq);
    if (code !== RESULT_OK) return this.outcome(seq, code, {});
    // The body comes with the next snapshot.
    await this.until(() => (s.sessionState === SESSION_ALIVE ? true : null));
    return { state: "done", rose_at: name, self: this.self() };
  }

  /**
   * Sets down a thing built that stands by itself (a bed, a sleeping bag, a box, a campfire) from what is carried: on the
   * ground at x and z, or on a floor of the tribe's. It walks near, takes the item in hand from the hotbar, and places it as
   * the build button does.
   */
  private async put(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const world = s.world!;
    const item = this.item(text(a, "item"));
    const forms = reg.places[item];
    if (!forms || forms.length === 0) throw new Bad(`${this.nameOf(item)} is not something built`);
    const kind = forms[0]!;
    const ground = reg.role[kind] === ROLE_FOUNDATION;
    if (reg.role[kind] !== ROLE_THING && !ground) throw new Bad(`${this.nameOf(item)} joins other pieces, and only a foundation or a thing that stands by itself can be placed with this`);
    const floor = a.on === undefined ? null : this.target({ id: a.on });
    if (floor && (floor.ref < 0 || ground)) throw new Bad(ground ? "a foundation goes on open ground: give x and z" : `${floor.id} is not something built`);
    const x = floor && a.x === undefined ? floor.x : amount(a, "x", 0, world.hf.sizeX, 0);
    const z = floor && a.z === undefined ? floor.z : amount(a, "z", 0, world.hf.sizeZ, 0);
    const yaw = Math.round((amount(a, "facing", 0, 360, 0) / 360) * YAW_UNITS) & (YAW_UNITS - 1);
    if (this.controller.busy) throw new Bad(`${this.controller.busy} is still running: cancel it, or wait for it with status`);
    const inv = s.inventory;
    if (!inv || inv.total(item) === 0) return refused(`you carry no ${this.nameOf(item)}`);
    // Near enough that the place is in reach of the eye, and not in its way: three metres south of it.
    const away = Math.hypot(s.own.x - x, s.own.z - z);
    if (away < 2.4 || away > 4.5) {
      this.controller.walkTo(this.now, this.controller.place(x, z - 3), 0.6);
      const walked = await this.finish(amount(a, "wait_s", 0, 50, 25));
      if (walked.state !== "done") return walked;
    }
    // Into the hotbar, and into the hands.
    let slot = inv.item.indexOf(item);
    if (slot < inv.hotbar || slot >= inv.hotbar + 10) {
      let to = -1;
      for (let k = 9; k >= 0; k--) if (inv.item[inv.hotbar + k] === 0) to = inv.hotbar + k;
      if (to < 0) return refused("the hotbar is full: move something out of it first");
      const from = slot;
      const seq = this.commands.send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(item)));
      const code = seq === 0 ? 0 : await this.result(seq);
      if (code !== RESULT_OK) return this.outcome(seq, code, {});
      slot = to;
    }
    const held = slot - inv.hotbar;
    const chose = this.commands.send(CMD_SELECT, (w) => w.u8(held));
    const picked = chose === 0 ? 0 : await this.result(chose);
    if (picked !== RESULT_OK) return this.outcome(chose, picked, {});
    const before = new Set(this.builtNear(kind, x, z));
    const seq = this.commands.send(CMD_PLACE, (w) => {
      w.u8(0);
      w.u32(floor ? floor.ref : OPEN_GROUND);
      if (floor) w.u8(ON_TOP);
      w.sbits(Math.round(x * STRUCT_UNITS), 32);
      w.sbits(Math.round(z * STRUCT_UNITS), 32);
      w.u16(yaw);
      if (!floor) w.sbits(0, 8);
      w.u8(0);
    });
    const code = seq === 0 ? 0 : await this.result(seq);
    if (code !== RESULT_OK) return this.outcome(seq, code, {});
    // The new row comes with the chunk's next news.
    const ref = await this.until((now) => this.builtNear(kind, x, z).find((r) => !before.has(r)) ?? (now > this.now + ANSWER_MS ? -1 : null));
    return ref >= 0 ? { state: "done", placed: this.nameOf(kind), id: `s${ref}` } : { state: "done", placed: this.nameOf(kind) };
  }

  /** Refs of the things of `kind` standing within a metre of (x, z), as this client has them. */
  private builtNear(kind: number, x: number, z: number): number[] {
    const structs = this.session.world!.structs;
    const out: number[] = [];
    const n = structs.query(x - 1, z - 1, x + 1, z + 1, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      if (t.kind[ref & 0xffff] === kind && Math.hypot(t.x[ref & 0xffff]! - x, t.z[ref & 0xffff]! - z) < 1) out.push(ref);
    }
    return out;
  }

  /** Walks to a bed of the tribe and names it, or travels from it to another. */
  private bed(a: Record<string, unknown>): Promise<Answer> {
    const reg = this.session.registry;
    const what = text(a, "do");
    if (what !== "name" && what !== "travel") throw new Bad("do is name or travel");
    const words = what === "name" ? text(a, "name") : "";
    if (words.length > MAX_NAME_BYTES) throw new Bad(`a name is at most ${MAX_NAME_BYTES} letters`);
    const target = this.target(a);
    if (target.ref < 0 || reg.isBed[target.kind] !== 1) throw new Bad(`${target.id} is not a bed`);
    this.controller.act(this.now, target, what === "name" ? STRUCT_NAME : STRUCT_TRAVEL, words);
    return this.finish(amount(a, "wait_s", 0, 50, 25));
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

  private async eat(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const inv = s.inventory;
    if (!inv) return refused("you carry nothing");
    const reg = s.registry;
    const wanted = a.item === undefined ? 0 : this.item(text(a, "item"));
    let slot = -1;
    for (let k = 0; k < inv.cap && slot < 0; k++) {
      const item = inv.item[k]!;
      if (item !== 0 && (wanted !== 0 ? item === wanted : (reg.defs[item] as ItemDef).eat !== undefined)) slot = k;
    }
    if (slot < 0) return refused(wanted !== 0 ? `you carry no ${this.nameOf(wanted)}` : "you carry nothing to eat");
    const item = inv.item[slot]!;
    const seq = this.commands.send(CMD_USE, (w) => (w.varint(slot), w.u16(item)));
    const code = await this.result(seq);
    // The vitals follow the result by a tick or two.
    if (code === RESULT_OK) await this.pause(3000 / TICK_RATE);
    return this.outcome(seq, code, { ate: this.nameOf(item), self: this.self() });
  }

  private async craft(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const reg = s.registry;
    const item = this.item(text(a, "recipe"));
    const count = whole(a, "count", 1, 100, 1);
    const waitMs = amount(a, "wait_s", 0, 50, 20) * 1000;
    const needs = reg.recipeOf[item];
    if (!needs) return refused(`${this.nameOf(item)} cannot be made`);
    // What is made at a station is made from what lies in it, never in the hands.
    if (reg.craftAt[item] !== 0) return refused(`${this.nameOf(item)} is made at a ${this.nameOf(reg.craftAt[item]!)}, from what lies in it, not in the hands`);
    const recipe: Record<string, number> = {};
    for (let k = 0; k + 1 < needs.length; k += 2) recipe[this.nameOf(needs[k]!)] = needs[k + 1]!;
    const engram = reg.defs.findIndex((d) => d?.type === "engram" && d.item === reg.ids[item]);
    if (engram >= 0 && !s.progress.engrams.includes(engram)) {
      const def = reg.defs[engram] as { level: number; cost: number };
      if (a.learn !== true) return refused(`you have not learned ${this.nameOf(item)}: it takes level ${def.level} and ${def.cost} engram points, and learn: true spends them`);
      const seq = this.commands.send(CMD_LEARN, (w) => w.u16(engram));
      const learned = this.outcome(seq, await this.result(seq), {});
      if (learned.state !== "done") return { ...learned, reason: `could not learn ${this.nameOf(item)} (level ${def.level}, ${def.cost} points): ${String(learned.reason)}` };
    }
    const had = s.inventory?.total(item) ?? 0;
    const seq = this.commands.send(CMD_CRAFT, (w) => (w.u16(item), w.u8(count)));
    const queued = this.outcome(seq, await this.result(seq), {});
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

  private async moveItem(a: Record<string, unknown>): Promise<Answer> {
    const s = this.session;
    const box = (key: string): number => {
      const v = a[key];
      if (v !== "self" && v !== "box") throw new Bad(`${key} must be self or box`);
      return v === "self" ? BOX_SELF : BOX_OPEN;
    };
    const fromBox = box("from");
    const toBox = box("to");
    const invOf = (b: number): Inventory | null => (b === BOX_SELF ? s.inventory : (s.open?.inventory ?? null));
    const src = invOf(fromBox);
    const dst = invOf(toBox);
    if (!src || !dst) return refused("you have no box open: open one first");
    const slot = whole(a, "slot", 0, src.cap - 1);
    const item = src.item[slot]!;
    if (item === 0) return refused(`slot ${slot} is empty`);
    const count = whole(a, "count", 0, 65535, 0);
    if (count > src.count[slot]!) return refused(`slot ${slot} holds only ${src.count[slot]}`);
    let to: number;
    if (a.to_slot !== undefined) to = whole(a, "to_slot", 0, dst.cap - 1);
    else {
      if (src === dst) return refused("to_slot is needed to move within one inventory");
      // Onto a stack of the same item with room, else into the first empty slot.
      const stack = s.registry.stack[item]!;
      to = -1;
      for (let k = 0; k < dst.bag && to < 0; k++) if (dst.item[k] === item && dst.quality[k] === src.quality[slot] && dst.flags[k] === src.flags[slot] && dst.flags[k] === 0 && dst.count[k]! < stack) to = k;
      if (to < 0) to = dst.free();
      if (to < 0) return refused("there is no room there");
    }
    const seq = this.commands.send(CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.varint(slot);
      w.bits(toBox, 1);
      w.varint(to);
      w.u16(count);
      w.u16(item);
    });
    const code = await this.result(seq);
    if (code === RESULT_OK) await this.pause(3000 / TICK_RATE);
    // A bag emptied is gone, and with it what was open.
    const now = invOf(fromBox);
    return this.outcome(seq, code, { moved: this.nameOf(item), to_slot: to, left: now === src && src.item[slot] === item ? src.count[slot]! : 0 });
  }
}
