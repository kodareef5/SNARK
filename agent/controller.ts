// The hands on the controls. One task at a time is walked, aimed and swung as a player would do it, a tick at a time: the
// controller only decides which way to look and which buttons are down, and the session sends that like any client's input.

import { ownIndex, type ClientSession, type RemoteSample } from "../client/core/session.ts";
import type { NodeDef } from "../shared/content/defs.ts";
import { PI, TAU } from "../shared/math/scalar.ts";
import { BOX_SELF, CMD_CLOSE, CMD_MOVE, CMD_RESPAWN, CMD_SELECT, CMD_STRUCT, RESULT_OK, SESSION_ALIVE, SESSION_DEAD } from "../shared/net/protocol.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_USE, MF_OUT, MF_ROOTED, MODE_SWIM, stanceEye, type MoveParams } from "../shared/sim/character.ts";
import { V_HEALTH, V_OXYGEN } from "../shared/sim/vitals.ts";
import { W_MELEE } from "../shared/sim/weapon.ts";
import { GROUND_FREE, GROUND_SOLID, PATH_LEG, PATH_NONE, PATH_SHORT, PathFinder, groundAt } from "../shared/world/path.ts";
import { HIT_NODE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { NO_PIN, STRUCT_USE } from "../shared/world/upkeep.ts";
import { resultWords, type Commands } from "./commands.ts";
import type { Answer } from "./mcp.ts";
import { compass, shortName } from "./observe.ts";

export type Phase = "waiting" | "walking" | "approaching" | "facing" | "swinging" | "using";

/** A place to go, or a thing to go to. */
export interface Target {
  /** "" for a place. */
  id: string;
  /** Its middle. For a body, its feet. */
  x: number;
  y: number;
  z: number;
  /** From its middle to its side, on the ground. */
  half: number;
  /** How tall it stands above `y`, and how far below. */
  up: number;
  down: number;
  /** Content index, or 0 for a place. */
  kind: number;
  /** What it is: a node (chunk and slot), something built (ref) or a body (entity index, with its replicated flags). */
  chunk: number;
  slot: number;
  ref: number;
  entity: number;
  flags: number;
}

interface Task {
  kind: "walk_to" | "harvest" | "open";
  target: Target;
  phase: Phase;
  /** Walking ends this near the target's middle. */
  stop: number;
  /** Harvest: the item to count and how many more of it to gather (0 for until the node is gone), and the tool to take in hand. */
  item: number;
  count: number;
  tool: number;
  /** Open: the PIN to give. */
  pin: number;
  /** A step within the phase, for the phases that are a few things in a row. */
  step: number;
  tries: number;
  /** The command a step waits on, and the time before which it sends no other. */
  seq: number;
  hold: number;
  /** When the phase began. */
  since: number;
}

/** Radians a second it turns, and how nearly it must face its heading before it walks. */
const TURN = 6;
const ALIGNED = 0.5;
/** A point of the way this near is reached. */
const PASS = 0.35;
/** The way is looked over this often. Less than STUCK_M gained in that time, while walking, is being stuck. */
const CHECK_MS = 1000;
const STUCK_M = 0.3;
const JUMP_MS = 200;
const STUCK_PLANS = 3;
const HARVEST_MS = 60000;
/** Nothing new in the bag for this long while gathering means there is no more to be had. */
const BARREN_MS = 5000;
/** A hunter this near is a danger, until it is this far again. */
const HUNTER_M = 15;
const HUNTER_GONE_M = 20;
/** This share of health lost within HURT_MS is a danger, until none has been lost for QUIET_MS. */
const HURT_SHARE = 0.05;
const HURT_MS = 2000;
const QUIET_MS = 5000;
const WATCH_MS = 100;
const BREATH_LOW = 0.3;
const BREATH_BACK = 0.4;
/** Metres from the eye the use button reaches, as the server has it. */
const USE_REACH = 3.5;
/** A thing whose foot is this far above the ground under it is on another floor. */
const FLOOR_UP = 1.5;
const VIEW_PLAYER = 4;
export const VIEW_PROP = 8;

const wrap = (a: number): number => (a > PI ? a - TAU : a <= -PI ? a + TAU : a);
const within = (v: number, most: number): number => (v > most ? most : v < -most ? -most : v);

export class Controller {
  /** What the session's next update is given. */
  moveX = 0;
  moveZ = 0;
  yaw = 0;
  pitch = 0;
  buttons = 0;
  /** How the last task ended. Null while one runs and before the first. */
  ended: Answer | null = null;
  /** Ways found for the running task, and how many of them because the way had stopped holding or the body was stuck. */
  plans = 0;
  replans = 0;
  deaths = 0;

  private readonly session: ClientSession;
  private readonly remote: RemoteSample;
  private readonly commands: Commands;
  private task: Task | null = null;
  private finder: PathFinder | null = null;
  private last = -1;
  private faced = false;

  // The way being walked.
  private status = PATH_NONE;
  private next = 0;
  private planned = false;
  private planX = 0;
  private planZ = 0;
  private checkAt = 0;
  private markX = 0;
  private markZ = 0;
  private pushed = 0;
  private jumped = false;
  private jumpUntil = 0;
  private stuck = 0;
  private nearest = 0;
  // Gathering.
  private readonly had = new Map<number, number>();
  private carried = 0;
  private gainAt = 0;
  private readonly dir = [0, 0, 0];
  // Dangers. Each is told once, when it begins.
  private watchAt = 0;
  private readonly hunters = new Map<number, string>();
  private readonly health = new Float64Array(HURT_MS / WATCH_MS);
  private healthAt = -1;
  private hurt = false;
  private hurtAt = 0;
  private gasping = false;
  private dead = false;
  private wakeAt = 0;

  constructor(session: ClientSession, remote: RemoteSample, commands: Commands) {
    this.session = session;
    this.remote = remote;
    this.commands = commands;
  }

  /** The name of the task that is running, or null. */
  get busy(): string | null {
    return this.task?.kind ?? null;
  }

  /** What an id names, or a line saying why it names nothing. */
  locate(id: string): Target | string {
    const s = this.session;
    const world = s.world!;
    const reg = s.registry;
    const blank = { id, kind: 0, chunk: -1, slot: -1, ref: -1, entity: -1, flags: 0 };
    const node = /^n(\d+)\.(\d+)$/.exec(id);
    if (node) {
      const chunk = Number(node[1]);
      const slot = Number(node[2]);
      const t = world.nodes?.chunks[chunk];
      if (!t) return `${id} is too far away to see`;
      const kind = slot < t.high ? t.kind[slot]! : 0;
      if (kind === 0) return `${id} is used up, or was never there`;
      return { ...blank, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, half: Math.max(reg.halfX[kind]!, reg.halfZ[kind]!), up: reg.halfY[kind]!, down: reg.halfY[kind]!, kind, chunk, slot };
    }
    const built = /^s(\d+)$/.exec(id);
    if (built) {
      const ref = Number(built[1]);
      const t = world.structs.chunks[Math.floor(ref / 65536)];
      const slot = ref & 0xffff;
      const kind = t && slot < t.high ? t.kind[slot]! : 0;
      if (kind === 0) return `${id} is not there, or is too far away to see`;
      return { ...blank, x: t!.x[slot]!, y: t!.y[slot]!, z: t!.z[slot]!, half: Math.max(reg.halfX[kind]!, reg.halfZ[kind]!), up: reg.halfY[kind]!, down: reg.halfY[kind]!, kind, ref };
    }
    const body = /^e(\d+)$/.exec(id);
    if (body) {
      const entity = Number(body[1]);
      const r = this.remote;
      for (let i = 0; i < r.count; i++) {
        if (r.id[i] !== entity || entity === ownIndex(s)) continue;
        return { ...blank, x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, half: reg.bodyRadius[r.kind[i]!]!, up: reg.bodyHeight[r.kind[i]!]!, down: 0, kind: r.kind[i]!, entity, flags: r.flags[i]! };
      }
      return `${id} is not in sight`;
    }
    return `${id} is not an id: ids look like n12.3, s65539 or e7`;
  }

  /** A place on the ground. */
  place(x: number, z: number): Target {
    return { id: "", x, y: this.session.world!.hf.heightAt(x, z), z, half: 0, up: 0, down: 0, kind: 0, chunk: -1, slot: -1, ref: -1, entity: -1, flags: 0 };
  }

  /** Starts walking. `near` is how close to come: to the place, or to the thing's side. */
  walkTo(now: number, target: Target, near: number): void {
    const own = this.session.registry.move[this.session.bodyKind]!.radius;
    this.begin(now, { kind: "walk_to", target, stop: target.id === "" ? near : near + target.half + own });
  }

  /** Starts gathering from a node, until `count` more of `item` are carried, or with 0 until the node is gone. `tool` is an item to take in hand first, or 0. */
  harvest(now: number, target: Target, item: number, count: number, tool: number): void {
    this.begin(now, { kind: "harvest", target, item, count, tool, phase: "waiting" });
  }

  /** Starts opening a box, a door or a bag. `pin` is NO_PIN for none. */
  open(now: number, target: Target, pin: number): void {
    const reg = this.session.registry;
    // The server measures from the eye to the middle of a thing built, and along the look to a body.
    const stop = target.ref >= 0 ? Math.hypot(reg.halfX[target.kind]!, reg.halfZ[target.kind]!) + 2 : target.half + 1.8;
    this.begin(now, { kind: "open", target, stop, pin });
  }

  /** Stops the running task. Returns its name, or null if there was none. */
  cancel(): string | null {
    const kind = this.busy;
    if (kind) this.end({ state: "blocked", reason: "cancelled" });
    return kind;
  }

  /** Where the running task has got to. */
  progress(): Record<string, unknown> {
    const t = this.task;
    if (!t) return {};
    const b = this.session.own;
    return { task: t.kind, doing: t.phase, left_m: Math.round(Math.max(0, Math.hypot(t.target.x - b.x, t.target.z - b.z) - t.stop) * 10) / 10, ...(t.kind === "harvest" ? { gathered: this.gathered() } : {}) };
  }

  /** What threatens the survivor now, in words. */
  dangers(): string[] {
    const out = [...this.hunters.values()];
    if (this.hurt) out.push("your health is falling");
    if (this.gasping) out.push("you are running out of breath");
    return out;
  }

  /** Call once a tick, before the session's update, with the time in milliseconds. */
  step(now: number): void {
    const s = this.session;
    const dt = this.last < 0 ? 0 : Math.min(250, now - this.last) / 1000;
    this.last = now;
    this.moveX = this.moveZ = 0;
    this.buttons = 0;
    if (s.state !== "active" || !s.world) return;
    if (!this.faced) {
      this.yaw = wrap(s.ownYaw);
      this.faced = true;
    }
    if (now >= this.watchAt) {
      this.watchAt = now + WATCH_MS;
      const fresh = this.watch(now);
      if (fresh.length > 0 && this.task) this.end({ state: "danger", reason: fresh.join("; ") });
    }
    const t = this.task;
    if (!t || s.sessionState !== SESSION_ALIVE) return;
    const b = s.own;
    if ((b.mflags & MF_OUT) !== 0) return this.end({ state: "danger", reason: "you are knocked out" });
    if (t.target.entity >= 0 && !this.follow(t.target)) return this.end({ state: "blocked", reason: `${t.target.id} is no longer in sight` });
    if (t.phase === "waiting") this.ready(now, t);
    else if (t.phase === "walking") this.walk(now, dt, t);
    else if (t.phase === "approaching") this.approach(now, dt, t);
    else if (t.phase === "facing") this.face(now, dt, t);
    else if (t.phase === "swinging") this.swing(now, t);
    else this.use(now, t);
    if (now < this.jumpUntil) this.buttons |= BTN_JUMP;
  }

  private begin(now: number, task: Partial<Task> & Pick<Task, "kind" | "target">): void {
    this.task = { phase: "walking", stop: 0, item: 0, count: 0, tool: 0, pin: NO_PIN, step: 0, tries: 0, seq: 0, hold: 0, since: now, ...task };
    this.ended = null;
    this.planned = false;
    this.plans = this.replans = this.stuck = 0;
    this.jumped = false;
    this.finder?.forget();
    this.had.clear();
    const inv = this.session.inventory;
    for (let k = 0; inv && k < inv.cap; k++) if (inv.item[k] !== 0) this.had.set(inv.item[k]!, (this.had.get(inv.item[k]!) ?? 0) + inv.count[k]!);
    const t = this.task.target;
    if (t.id !== "" && t.y - t.down > this.session.world!.hf.heightAt(t.x, t.z) + FLOOR_UP) this.end({ state: "blocked", reason: `${t.id} is on a floor above the ground, and this walks the ground floor only` });
  }

  private end(answer: Answer): void {
    const t = this.task;
    if (!t) return;
    const b = this.session.own;
    this.task = null;
    this.ended = { ...answer, task: t.kind, at: [Math.round(b.x * 10) / 10, Math.round(b.z * 10) / 10], ...(t.kind === "harvest" ? { gathered: this.gathered() } : {}) };
  }

  private phase(now: number, t: Task, phase: Phase): void {
    t.phase = phase;
    t.step = 0;
    t.since = now;
  }

  private move(): MoveParams {
    return this.session.registry.move[this.session.bodyKind]!;
  }

  /** What has been added to the inventory since the task began, by name. */
  private gathered(): Record<string, number> {
    const now = new Map<number, number>();
    const inv = this.session.inventory;
    for (let k = 0; inv && k < inv.cap; k++) if (inv.item[k] !== 0) now.set(inv.item[k]!, (now.get(inv.item[k]!) ?? 0) + inv.count[k]!);
    const out: Record<string, number> = {};
    for (const [item, n] of now) if (n > (this.had.get(item) ?? 0)) out[shortName(this.session.registry.ids[item])] = n - (this.had.get(item) ?? 0);
    return out;
  }

  /** Moves a target that is a body to where the body is now. False if it has gone from view. */
  private follow(target: Target): boolean {
    const r = this.remote;
    for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== target.entity) continue;
      target.x = r.x[i]!;
      target.y = r.y[i]!;
      target.z = r.z[i]!;
      return true;
    }
    return false;
  }

  /** Finds what has become dangerous since it last looked, and wakes a survivor that has died. */
  private watch(now: number): string[] {
    const s = this.session;
    const reg = s.registry;
    const b = s.own;
    const fresh: string[] = [];
    if (s.sessionState === SESSION_DEAD) {
      if (!this.dead) {
        this.dead = true;
        this.deaths++;
        this.wakeAt = now + CHECK_MS;
        fresh.push("you died");
      } else if (now >= this.wakeAt && s.respawnPoints.length > 0) {
        // It wakes at the first place that is ready, as a player who presses the first button would.
        const ready = s.respawnPoints.findIndex((p) => p.wait === 0);
        this.commands.send(CMD_RESPAWN, (w) => w.u8(ready < 0 ? 0 : ready));
        this.wakeAt = now + CHECK_MS;
      }
      this.hunters.clear();
      return fresh;
    }
    this.dead = false;

    const r = this.remote;
    const own = ownIndex(s);
    const team = s.tribe.team;
    const seen = new Set<number>();
    for (let i = 0; i < r.count; i++) {
      const id = r.id[i]!;
      const kind = r.kind[i]!;
      if (reg.temper[kind] !== 2 || (r.flags[i]! & (VIEW_PLAYER | VIEW_PROP)) !== 0 || id === own || (team !== 0 && r.team[i] === team)) continue;
      const far = Math.hypot(r.x[i]! - b.x, r.z[i]! - b.z);
      if (far > (this.hunters.has(id) ? HUNTER_GONE_M : HUNTER_M)) continue;
      const words = `a ${shortName(reg.ids[kind])} (e${id}) is ${Math.round(far)} m to the ${compass(Math.atan2(r.x[i]! - b.x, r.z[i]! - b.z))}`;
      if (!this.hunters.has(id)) fresh.push(words);
      this.hunters.set(id, words);
      seen.add(id);
    }
    for (const id of this.hunters.keys()) if (!seen.has(id)) this.hunters.delete(id);

    if (s.hasVitals) {
      const v = s.vitals;
      const hp = v.at(V_HEALTH, s.serverTick);
      const max = v.max[V_HEALTH]!;
      // The most it has been within HURT_MS, a look every WATCH_MS.
      if (this.healthAt < 0) this.health.fill(hp);
      this.healthAt = (this.healthAt + 1) % this.health.length;
      this.health[this.healthAt] = hp;
      let most = hp;
      for (const was of this.health) if (was > most) most = was;
      if (most - hp >= HURT_SHARE * max) {
        if (!this.hurt) fresh.push(`your health is falling: ${Math.round(hp / 1e6)} of ${Math.round(max / 1e6)}`);
        this.hurt = true;
        this.hurtAt = now;
        this.health.fill(hp);
      } else if (this.hurt && now - this.hurtAt > QUIET_MS) this.hurt = false;
      const breath = v.max[V_OXYGEN]! > 0 ? v.at(V_OXYGEN, s.serverTick) / v.max[V_OXYGEN]! : 1;
      if (breath < BREATH_LOW) {
        if (!this.gasping) fresh.push(`you are running out of breath: ${Math.round(breath * 100)}% left`);
        this.gasping = true;
      } else if (breath > BREATH_BACK) this.gasping = false;
    }
    return fresh;
  }

  /** Turns toward a facing by no more than the turn rate. Returns what is left to turn. */
  private turn(dt: number, want: number): number {
    const off = wrap(want - this.yaw);
    const by = within(off, TURN * dt);
    this.yaw = wrap(this.yaw + by);
    return off - by;
  }

  /** Turns toward (x, z), and walks once nearly facing it. */
  private steer(dt: number, x: number, z: number): void {
    const b = this.session.own;
    this.pitch = 0;
    if (Math.abs(this.turn(dt, Math.atan2(x - b.x, z - b.z))) < ALIGNED) {
      this.moveZ = 1;
      this.pushed += dt * 1000;
    }
  }

  /** Finds the way from where the body is. False if there is none. */
  private plan(now: number, t: Task): boolean {
    const s = this.session;
    const b = s.own;
    this.finder ??= new PathFinder(s.world!, this.move());
    this.finder.body = this.move();
    this.status = this.finder.find(b.x, b.z, t.target.x, t.target.z);
    this.plans++;
    this.planned = true;
    this.next = 1;
    this.planX = t.target.x;
    this.planZ = t.target.z;
    this.check(now);
    return this.status !== PATH_NONE;
  }

  /** Starts the second over which the way is next looked over and progress is measured. */
  private check(now: number): void {
    const b = this.session.own;
    this.checkAt = now + CHECK_MS;
    this.markX = b.x;
    this.markZ = b.z;
    this.pushed = 0;
  }

  private walk(now: number, dt: number, t: Task): void {
    const b = this.session.own;
    const g = t.target;
    const far = Math.hypot(g.x - b.x, g.z - b.z);
    if (far <= t.stop) return this.reached(now, t);
    if ((b.mflags & MF_ROOTED) !== 0) return this.end({ state: "blocked", reason: "you carry too much to move" });
    if (b.mode === MODE_SWIM) {
      // Out of its depth it swims for the goal at the surface, and finds its way again when it stands.
      this.steer(dt, g.x, g.z);
      this.buttons |= BTN_JUMP;
      this.planned = false;
      return;
    }
    if (!this.planned && !this.plan(now, t)) return this.end({ state: "blocked", reason: "there is no way there on foot" });
    const f = this.finder!;
    if (now >= this.checkAt) {
      const gained = Math.hypot(b.x - this.markX, b.z - this.markZ);
      const stuck = gained < STUCK_M && this.pushed > CHECK_MS * 0.7;
      if (gained > 1) {
        this.stuck = 0;
        this.jumped = false;
      }
      let again = this.status === PATH_LEG || Math.hypot(g.x - this.planX, g.z - this.planZ) > 1;
      if (stuck && !this.jumped) {
        // First it tries to hop over whatever it is.
        this.jumped = true;
        this.jumpUntil = now + JUMP_MS;
      } else if (stuck) {
        if (++this.stuck === STUCK_PLANS) return this.end({ state: "blocked", reason: "stuck: something that cannot be walked round is in the way", short_m: Math.round(far * 10) / 10 });
        this.jumped = false;
        f.avoid(b.x + Math.sin(this.yaw), b.z + Math.cos(this.yaw));
        this.replans++;
        again = true;
      } else if (!f.holds(this.next, b.x, b.z)) {
        this.replans++;
        again = true;
      }
      this.check(now);
      if (again && !this.plan(now, t)) return this.end({ state: "blocked", reason: "the way is shut and there is no other", short_m: Math.round(far * 10) / 10 });
    }
    // The point to make for is the first not yet reached or passed.
    while (this.next < f.count) {
      const wx = f.x[this.next]!;
      const wz = f.z[this.next]!;
      const passed = (wx - f.x[this.next - 1]!) * (wx - b.x) + (wz - f.z[this.next - 1]!) * (wz - b.z) <= 0;
      if (!passed && Math.hypot(wx - b.x, wz - b.z) > PASS) break;
      this.next++;
    }
    if (this.next < f.count) return this.steer(dt, f.x[this.next]!, f.z[this.next]!);
    if (this.status === PATH_LEG) return void this.plan(now, t);
    if (this.status === PATH_SHORT) return this.short(now, t, "there is no way through to it");
    // The way ends at the nearest place to stand, and the rest is straight ahead.
    this.nearest = far;
    this.check(now);
    this.phase(now, t, "approaching");
  }

  /** The last steps, straight at the target, for as long as they bring it nearer. */
  private approach(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const g = t.target;
    const far = Math.hypot(g.x - b.x, g.z - b.z);
    if (far <= t.stop) return this.reached(now, t);
    // It does not walk off into water or onto a slope for the sake of the last metre.
    const ahead = groundAt(s.world!, this.move(), b.x + ((g.x - b.x) / far) * 0.6, b.z + ((g.z - b.z) / far) * 0.6);
    if (ahead !== GROUND_FREE && ahead !== GROUND_SOLID) return this.short(now, t, "the ground between cannot be walked");
    this.steer(dt, g.x, g.z);
    if (now < this.checkAt) return;
    this.checkAt = now + CHECK_MS;
    if (this.nearest - far < STUCK_M) return this.short(now, t, "something is in the way");
    this.nearest = far;
  }

  /** It can get no nearer. Walking ends short. Gathering and opening try from where it stands. */
  private short(now: number, t: Task, reason: string): void {
    const b = this.session.own;
    if (t.kind !== "walk_to") return this.phase(now, t, "facing");
    this.end({ state: "blocked", reason, short_m: Math.round((Math.hypot(t.target.x - b.x, t.target.z - b.z) - t.stop) * 10) / 10 });
  }

  private reached(now: number, t: Task): void {
    if (t.kind === "walk_to") return this.end({ state: "done" });
    this.phase(now, t, "facing");
  }

  /** Before gathering: the tool is taken in hand, or a weapon that is no tool is put away, and how near to stand is worked out. */
  private ready(now: number, t: Task): void {
    const s = this.session;
    const reg = s.registry;
    const inv = s.inventory;
    const held = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
    const wrong = t.tool !== 0 ? held !== t.tool : held !== 0 && reg.weapon[held] !== null && reg.weapon[held]!.kind !== W_MELEE;
    if (wrong && inv && inv.hotbar >= 0) {
      if (now - t.since > 3000) return this.end({ state: "blocked", reason: `could not take the ${shortName(reg.ids[t.tool])} in hand` });
      // One command, then a moment for what it changed to arrive: into the hotbar if it is in the bag, then into the hand.
      if (now < t.hold) return;
      t.hold = now + 250;
      const from = t.tool !== 0 ? inv.item.indexOf(t.tool) : -1;
      if (t.tool !== 0 && from < 0) return this.end({ state: "blocked", reason: `you no longer carry a ${shortName(reg.ids[t.tool])}` });
      if (t.tool === 0) this.commands.send(CMD_SELECT, (w) => w.u8(255));
      else if (from >= inv.hotbar && from < inv.hotbar + 10) this.commands.send(CMD_SELECT, (w) => w.u8(from - inv.hotbar));
      else {
        let to = inv.hotbar;
        for (let k = 9; k >= 0; k--) if (inv.item[inv.hotbar + k] === 0) to = inv.hotbar + k;
        this.commands.send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(t.tool)));
      }
      return;
    }
    // A bush is picked with the use button. A tree or a rock is struck, from as far as what is in hand reaches.
    const byHand = (reg.defs[t.target.kind] as NodeDef).material === undefined;
    t.stop = t.target.half + (byHand ? 1.5 : this.reach() - 1.1);
    this.phase(now, t, "walking");
  }

  /** Metres from the eye a swing reaches: the melee weapon in hand, if it is not worn out, or else bare hands. As the server works it out. */
  private reach(): number {
    const s = this.session;
    const reg = s.registry;
    const inv = s.inventory;
    const slot = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.hotbar + s.held : -1;
    const item = slot >= 0 ? inv!.item[slot]! : 0;
    const swung = item !== 0 && reg.weapon[item]?.kind === W_MELEE && !(reg.uses[item]! > 0 && inv!.dur[slot] === 0);
    return reg.reach[swung ? item : s.bodyKind]!;
  }

  /** Turns to look at the thing. Once it does, it acts. */
  private face(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const g = t.target;
    const eye = b.y + stanceEye(this.move(), b.stance);
    // A node is looked at level where it is tall enough, a body at its middle, and anything else at its own.
    const low = g.y - g.down + 0.15;
    const high = g.y + g.up - 0.15;
    const ay = g.chunk >= 0 ? (eye < low ? low : eye > high ? high : eye) : g.entity >= 0 ? g.y + g.up / 2 : g.y;
    const flat = Math.hypot(g.x - b.x, g.z - b.z);
    const left = flat < 0.05 ? 0 : this.turn(dt, Math.atan2(g.x - b.x, g.z - b.z));
    const want = within(Math.atan2(ay - eye, Math.max(flat, 0.05)), 1.5);
    this.pitch += within(want - this.pitch, TURN * dt);
    if (Math.abs(left) > 0.005 || Math.abs(want - this.pitch) > 0.005) return;
    if (t.kind === "open") return this.phase(now, t, "using");
    // The same ray the server will cast, from the same eye.
    const byHand = (s.registry.defs[g.kind] as NodeDef).material === undefined;
    lookDirection(Math.round((this.yaw / TAU) * 65536) & 0xffff, Math.round((this.pitch / (PI / 2)) * 16384), this.dir);
    const hit = castWorld(s.world!, b.x, eye, b.z, this.dir[0]!, this.dir[1]!, this.dir[2]!, byHand ? USE_REACH : this.reach());
    if (hit === HIT_NODE && rayHit.ref === g.chunk * 65536 + g.slot) {
      this.carried = -1;
      this.gainAt = now;
      return this.phase(now, t, "swinging");
    }
    if (t.tries++ < 2 && flat > 0.6) {
      // A little nearer, and it looks again.
      t.stop = flat - 0.4;
      this.nearest = flat;
      this.check(now);
      return this.phase(now, t, "approaching");
    }
    this.end({ state: "blocked", reason: hit === HIT_NODE ? "another tree, rock or bush is in the way of it" : "it cannot be reached from here" });
  }

  private swing(now: number, t: Task): void {
    const s = this.session;
    const g = t.target;
    const inv = s.inventory;
    const table = s.world!.nodes?.chunks[g.chunk];
    if (!table || table.kind[g.slot] === 0) return this.end({ state: "done", node: "gone" });
    if (t.count > 0 && (inv?.total(t.item) ?? 0) - (this.had.get(t.item) ?? 0) >= t.count) return this.end({ state: "done", node: "standing" });
    if (now - t.since > HARVEST_MS) return this.end({ state: "blocked", reason: "a minute has passed" });
    let carried = 0;
    for (let k = 0; inv && k < inv.bag; k++) carried += inv.count[k]!;
    if (carried !== this.carried) {
      this.carried = carried;
      this.gainAt = now;
    } else if (now - this.gainAt > BARREN_MS) return this.end({ state: "blocked", reason: "nothing more comes of it: the bag may be full" });
    // A pick is one press of the use button, twice a second. A strike repeats while the button is held.
    if ((s.registry.defs[g.kind] as NodeDef).material !== undefined) this.buttons |= BTN_PRIMARY;
    else if ((now - t.since) % 500 < 100) this.buttons |= BTN_USE;
  }

  /** Opening: what is open is shut, then the thing is used, then the server's answer is waited for. */
  private use(now: number, t: Task): void {
    const s = this.session;
    const reg = s.registry;
    const g = t.target;
    if (now - t.since > 4000) return this.end({ state: "blocked", reason: "it did not open" });
    if (t.step === 0) {
      // Using the box that is open would shut it, so nothing is left open first.
      if (s.open) {
        if (t.seq === 0) t.seq = this.commands.send(CMD_CLOSE);
        return;
      }
      t.seq = 0;
      t.step = 1;
      t.since = now;
      this.commands.news = -1;
    }
    if (t.step === 1) {
      if (g.ref >= 0) {
        t.seq = this.commands.send(CMD_STRUCT, (w) => (w.u32(g.ref), w.u8(STRUCT_USE), w.u16(t.pin)));
        if (t.seq === 0) return;
      } else {
        // A bag is opened with the use button, held for three ticks so one of them is sure to carry it.
        this.buttons |= BTN_USE;
        if (now - t.since < 100) return;
      }
      t.step = 2;
      return;
    }
    const table = g.ref >= 0 ? s.world!.structs.chunks[Math.floor(g.ref / 65536)] : null;
    if (t.step === 2 && g.ref >= 0) {
      const code = this.commands.take(t.seq);
      if (code < 0) return;
      if (code !== RESULT_OK) return this.end({ state: "blocked", reason: resultWords(code) });
      t.step = 3;
    }
    if (g.ref >= 0 && reg.structSlots[g.kind] === 0) {
      // A door is another kind of thing once it has swung.
      const kind = table?.kind[g.ref & 0xffff] ?? 0;
      if (kind !== g.kind) this.end({ state: "done", now: shortName(reg.ids[kind]) });
      return;
    }
    if (s.open) return this.end({ state: "done", box: s.open.name });
    if (g.entity >= 0 && this.commands.news > 0) this.end({ state: "blocked", reason: resultWords(this.commands.news) });
  }
}
