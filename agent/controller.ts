// The hands on the controls. One task at a time is walked, aimed and swung as a player would do it, a tick at a time: the
// controller only decides which way to look and which buttons are down, and the session sends that like any client's input.

import { ownIndex, type ClientSession, type RemoteSample } from "../client/core/session.ts";
import { CUE_DEAD, CUE_OUT } from "../shared/anim/pose.ts";
import type { ItemDef, NodeDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { PI, TAU } from "../shared/math/scalar.ts";
import { BOX_SELF, CHOOSE_ARRIVED, CHOOSE_DIED, CMD_CLOSE, CMD_MOVE, CMD_SELECT, CMD_STRUCT, RESULT_OK, SESSION_ALIVE, SESSION_DEAD } from "../shared/net/protocol.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_PRIMARY, BTN_SECONDARY, BTN_SPRINT, BTN_USE, MF_NO_JUMP, MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, MODE_FLYER, MODE_SWIM, STAMINA_UNITS, stanceEye, type MoveParams } from "../shared/sim/character.ts";
import { CHUNK_SIZE } from "../shared/coords.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import { LayeredFinder } from "../shared/world/layers.ts";
import { vehiclePoint } from "../shared/sim/vehicle-frame.ts";
import { V_HEALTH, V_OXYGEN } from "../shared/sim/vitals.ts";
import { ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_RELOAD, W_GUN, W_MELEE, W_THROWN } from "../shared/sim/weapon.ts";
import { GROUND_FREE, GROUND_SOLID, PATH_FOUND, PATH_LEG, PATH_NONE, PATH_SHORT, PathFinder, groundAt } from "../shared/world/path.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { NO_PIN, STRUCT_NAME, STRUCT_PIN, STRUCT_USE } from "../shared/world/upkeep.ts";
import { resultWords, type Commands } from "./commands.ts";
import type { Answer } from "./mcp.ts";
import { VIEW_PLAYER, VIEW_PROP, compass, shortName } from "./observe.ts";

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

/** What a "use" task waits for once the use button is pressed: null while it waits, "" when it is done, else why it failed. */
export type Until = (now: number) => string | null;

interface Task {
  kind: "go_to" | "harvest" | "open" | "attack" | "act" | "use";
  target: Target;
  phase: Phase;
  /** Where it walks to, and how near that it stops. The target's middle, unless a place to stand by it was chosen. */
  gx: number;
  gz: number;
  stop: number;
  stood: boolean;
  /** Harvest: the item to count and how many more of it to gather (0 for until the node is gone), and the tool to take in hand. */
  item: number;
  count: number;
  tool: number;
  /** Attack: it ends once the body is knocked out, not only once it is gone. */
  out: boolean;
  /** Open: the PIN to give. Act: the STRUCT_ action, and the name it sends. */
  pin: number;
  action: number;
  words: string;
  /** A step within the phase, for the phases that are a few things in a row. */
  step: number;
  tries: number;
  /** The command a step waits on, and the time before which it sends no other. */
  seq: number;
  hold: number;
  /** When the phase began, and when the task did. */
  since: number;
  began: number;
  /** Attack with a bow, a sling or a gun: how far off it shoots from, shots loosed and hits told, and the target as last seen. */
  ranged: boolean;
  range: number;
  shots: number;
  hits: number;
  seenX: number;
  seenY: number;
  seenZ: number;
  seenTick: number;
  /** Use: what it waits for once the button is down. */
  until: Until | null;
  /** Driving: which way the wheel is turned while it backs off, -1 to 1. */
  wheel: number;
  /** Going on a flyer: whether to fly, and to land at the end. */
  fly: boolean;
  land: boolean;
}

/** Radians a second it turns, and how nearly it must face its heading before it walks. */
const TURN = 6;
const ALIGNED = 0.5;
/** A point of the way this near is reached. */
const PASS = 0.35;
/** The most it walks straight at a target from the end of a way: as far as a way's end may lie from its goal, and a little. */
const LAST_STEPS = 4;
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
/** A body or a thing whose foot is this far above the ground under it is on a floor, and its way is found by the climbing search. */
const RAISED = 1;
/** Metres within which a goal on a floor is searched for by the climbing search; further, the ground's legs walk toward it. */
const CLIMB_NEAR = 80;
/** Nodes the climbing search expands a tick, so a long one is spread over many and the body's inputs keep going out. */
const SEARCH_SLICE = 1500;
/** Flying and driving give up after this long, and say where they got to. */
const FLIGHT_MS = 300000;
/** Metres a flyer keeps over the ground, water and skyline ahead, and how high over the place it comes in. */
const CRUISE_UP = 20;
const LAND_UP = 10;
/** The body the way for a car is found for: wider than its hull's half width, on ground a car climbs. */
const CAR_WALKER = { radius: 1.3, height: 1.5, slopeCos: 0.85, stepUp: 0.25 };
/** Metres a second a car keeps to on a straight. */
const CAR_SPEED = 10;
/** After a shot is pressed or loosed, it waits this long for the body to show it before doing more. */
const SHOT_MS = 250;

/** Metres a ranged weapon is shot from: near enough to hit with what it fires, far enough to keep out of reach. */
export function rangeOf(reg: Registry, weapon: number): number {
  const w = reg.weapon[weapon];
  if (!w) return 2;
  if (w.kind === W_THROWN) return 9;
  const def = reg.defs[weapon] as ItemDef;
  const ammo = reg.index.get(def.weapon?.ammo?.[0] ?? "") ?? 0;
  // A shotgun's pellets do nothing past 40 m and all they can within 10; a sling's stone flies slowly.
  if (reg.ammoPellets[ammo]! > 1) return 8;
  const speed = reg.ammoSpeed[ammo]!;
  return speed === 0 ? 25 : speed < 50 ? 12 : 18;
}

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
  /** Tasks begun, so a caller can tell whether one began since it looked. */
  started = 0;
  /** Walking and riding sprint while this is set and stamina lasts. */
  sprint = false;
  /** A flyer left in the air keeps its jump held, and hovers. */
  hover = false;

  private readonly session: ClientSession;
  private readonly remote: RemoteSample;
  private readonly commands: Commands;
  private task: Task | null = null;
  private finder: PathFinder | null = null;
  private carFinder: PathFinder | null = null;
  private layers: LayeredFinder | null = null;
  /** Whether the way walked is the climbing search's, whether that search is still running, and the height of its goal. */
  private climbing = false;
  private searching = false;
  private goalY = NaN;
  /** Per chunk, the top of the map's own pieces in it. */
  private readonly tops = new Map<number, number>();
  /** Ways may swim. */
  swim = true;
  /** Places the running task's ways keep off, found anew with each way. */
  private kept: readonly (readonly [number, number])[] = [];
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
  private stuckFar = Infinity;
  private nearest = 0;
  // Gathering.
  private readonly had = new Map<number, number>();
  private carried = 0;
  private gainAt = 0;
  private readonly dir = [0, 0, 0];
  private readonly at = [0, 0, 0];
  // Dangers. Each is told once, when it begins.
  private watchAt = 0;
  private readonly hunters = new Map<number, string>();
  private readonly health = new Float64Array(HURT_MS / WATCH_MS);
  private healthAt = -1;
  private hurt = false;
  private hurtAt = 0;
  private gasping = false;
  private dead = false;

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
      const field = s.nodeField;
      if (!t || !field) return `${id} is too far away to see`;
      const kind = slot < t.high ? field.standing(chunk, slot) : 0;
      if (kind === 0) return `${id} is used up, or was never there`;
      // A node stands on its origin, and its boxes reach up from it.
      const form = t.kind[slot]!;
      return { ...blank, x: t.x[slot]!, y: t.y[slot]!, z: t.z[slot]!, half: Math.max(field.forms.halfX[form]!, field.forms.halfZ[form]!), up: field.forms.halfY[form]!, down: 0, kind, chunk, slot };
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
        if (r.id[i] !== entity || entity === ownIndex(s) || entity === s.driving) continue;
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

  /**
   * Starts going: walking, or riding, flying or driving what is steered. `near` is how close to come: to the place, or to the
   * thing's side. On a flyer `fly` flies there, and `land` sets down at the end.
   */
  walkTo(now: number, target: Target, near: number, fly = true, land = true): void {
    const own = this.session.registry.move[this.session.bodyKind]!.radius;
    this.begin(now, { kind: "go_to", target, stop: target.id === "" ? near : near + target.half + own, fly, land });
  }

  /** Starts gathering from a node, until `count` more of `item` are carried, or with 0 until the node is gone. `tool` is an item to take in hand first, or 0. */
  harvest(now: number, target: Target, item: number, count: number, tool: number): void {
    this.begin(now, { kind: "harvest", target, item, count, tool, phase: "waiting" });
  }

  /**
   * Starts striking a body with `tool` in hand, or with what is held, or bare hands: a creature until it is gone from
   * sight (dead, most often) or, with `out`, knocked out; a dead one until it is used up, or `count` more of `item` are carried.
   */
  attack(now: number, target: Target, item: number, count: number, tool: number, out: boolean): void {
    const w = tool !== 0 ? this.session.registry.weapon[tool] : null;
    const ranged = w !== null && w !== undefined && w.kind !== W_MELEE && this.session.driving < 0;
    this.begin(now, { kind: "attack", target, item, count, tool, out, phase: "waiting", ranged, range: ranged ? rangeOf(this.session.registry, tool) : 0 });
  }

  /**
   * Walks up to a body and presses the use button looking at it, then waits for `until`: getting on a mount or into a car. With
   * no target it presses where it stands, looking down: getting off, or drinking the water it stands in.
   */
  useOn(now: number, target: Target | null, until: Until, stand?: readonly [number, number], keepOff: readonly (readonly [number, number])[] = []): void {
    if (target && stand) {
      this.begin(now, { kind: "use", target, until, gx: stand[0], gz: stand[1], stop: 0.3, stood: true });
      // What the way finder does not see, such as a car's hull, is walked round.
      for (const [x, z] of keepOff) {
        this.finder?.avoid(x, z);
        this.layers?.avoid(x, z);
      }
      this.kept = keepOff;
    }
    else if (target) this.begin(now, { kind: "use", target, until, stop: target.half + 1.6 });
    else this.begin(now, { kind: "use", target: this.place(this.session.own.x, this.session.own.z), until, phase: "using" });
  }

  /** Starts opening a box, a door or a bag. `pin` is NO_PIN for none. */
  open(now: number, target: Target, pin: number): void {
    this.toBuilt(now, { kind: "open", target, pin });
  }

  /** Starts walking to a thing built and doing a STRUCT_ action on it, such as naming a bed or travelling from it. */
  act(now: number, target: Target, action: number, words = "", pin = NO_PIN): void {
    this.toBuilt(now, { kind: "act", target, action, words, pin });
  }

  private toBuilt(now: number, task: Partial<Task> & Pick<Task, "kind" | "target">): void {
    const reg = this.session.registry;
    const target = task.target;
    // The server measures from the eye to the middle of a thing built, and along the look to a body.
    const reach = target.ref >= 0 ? Math.hypot(reg.halfX[target.kind]!, reg.halfZ[target.kind]!) + 2 : target.half + 1.8;
    // Nothing opens through a wall, so the walk is to somewhere the thing can be seen from, if there is such a place.
    const stand = this.standBy(target, reach);
    if (stand) this.begin(now, { ...task, gx: stand[0], gz: stand[1], stop: 0.4, stood: true });
    else this.begin(now, { ...task, stop: reach });
  }

  /** The place nearest the body, within `reach` of a thing, where a body can stand with nothing between its eye and the thing's middle. */
  private standBy(g: Target, reach: number): [number, number] | null {
    const s = this.session;
    const world = s.world!;
    const move = this.move();
    const b = s.own;
    const ay = g.entity >= 0 ? g.y + g.up / 2 : g.y;
    const seen = (x: number, z: number): boolean => {
      if (groundAt(world, move, x, z) !== GROUND_FREE) return false;
      const ey = world.hf.heightAt(x, z) + move.eyeHeight;
      const far = Math.hypot(g.x - x, ay - ey, g.z - z);
      const hit = castWorld(world, x, ey, z, (g.x - x) / far, (ay - ey) / far, (g.z - z) / far, far);
      return hit === HIT_NONE || (hit === HIT_STRUCTURE && rayHit.ref === g.ref);
    };
    if (Math.hypot(g.x - b.x, g.z - b.z) <= reach && seen(b.x, b.z)) return [b.x, b.z];
    let best: [number, number] | null = null;
    let least = Infinity;
    for (const share of [0.5, 0.85]) {
      for (let k = 0; k < 16; k++) {
        const x = g.x + Math.sin((k * TAU) / 16) * reach * share;
        const z = g.z + Math.cos((k * TAU) / 16) * reach * share;
        const far = Math.hypot(x - b.x, z - b.z);
        if (far >= least || !seen(x, z)) continue;
        least = far;
        best = [x, z];
      }
    }
    return best;
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
    return { task: t.kind, doing: t.phase, left_m: Math.round(Math.max(0, Math.hypot(t.gx - b.x, t.gz - b.z) - t.stop) * 10) / 10, ...(t.ranged ? { shots: t.shots, hits: t.hits } : {}), ...(t.kind === "harvest" || t.kind === "attack" ? { gathered: this.gathered() } : {}) };
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
      const fought = this.task?.kind === "attack" ? `(${this.task.target.id})` : null;
      // A fight is not ended by the thing fought being near, nor by a blow taken while two thirds of health are left.
      const stop = fought === null ? fresh : fresh.filter((w) => !w.includes(fought) && !(w.startsWith("your health is falling") && this.healthLeft() > 2 / 3));
      if (stop.length > 0 && this.task) this.end({ state: "danger", reason: stop.join("; ") });
    }
    const t = this.task;
    // Travelling from a bed leaves the body, and its answer comes with the leaving.
    if (t?.kind === "act" && t.step === 1 && s.sessionState !== SESSION_ALIVE) return this.actOn(now, t);
    // With nothing to do, a flyer kept in the air hovers, and a car stands on its handbrake. A rotor's jump is its
    // collective and a jet's its climb, so an aircraft is left alone, holding where it is.
    const flown = s.registry.vehicle[s.bodyKind]?.movement;
    if (!t && s.driving >= 0 && ((this.hover && s.own.mode === MODE_FLYER) || (s.own.vehicle && flown !== "rotor" && flown !== "jet"))) this.buttons |= BTN_JUMP;
    if (!t || s.sessionState !== SESSION_ALIVE) return;
    const b = s.own;
    if ((b.mflags & MF_OUT) !== 0) return this.end({ state: "danger", reason: "you are knocked out" });
    if (t.target.entity >= 0 && !(t.kind === "use" && t.phase === "using") && !this.follow(t.target)) return this.end(t.kind === "attack" && t.phase === "swinging" ? { state: "done", target: "gone" } : { state: "blocked", reason: `${t.target.id} is no longer in sight` });
    if (!t.stood) {
      t.gx = t.target.x;
      t.gz = t.target.z;
    }
    if (t.phase === "waiting") this.ready(now, t);
    else if (t.phase === "walking" && t.kind === "go_to" && s.driving >= 0 && b.vehicle) this.drive(now, dt, t);
    else if (t.phase === "walking" && t.kind === "go_to" && this.flies() && (t.fly || b.mode === MODE_FLYER)) this.fly(now, dt, t);
    else if (t.phase === "walking") this.walk(now, dt, t);
    else if (t.phase === "approaching") this.approach(now, dt, t);
    else if (t.phase === "facing") this.face(now, dt, t);
    else if (t.phase === "swinging") this.swing(now, dt, t);
    else this.use(now, t);
    if (now < this.jumpUntil) this.buttons |= BTN_JUMP;
  }

  private begin(now: number, task: Partial<Task> & Pick<Task, "kind" | "target">): void {
    this.started++;
    this.task = { phase: "walking", gx: task.target.x, gz: task.target.z, stop: 0, stood: false, item: 0, count: 0, tool: 0, out: false, pin: NO_PIN, action: 0, words: "", step: 0, tries: 0, seq: 0, hold: 0, since: now, began: now, ranged: false, range: 0, shots: 0, hits: 0, seenX: task.target.x, seenY: task.target.y, seenZ: task.target.z, seenTick: -1, until: null, wheel: 0, fly: false, land: true, ...task };
    this.hover = false;
    this.ended = null;
    this.planned = false;
    this.plans = this.replans = this.stuck = 0;
    this.stuckFar = Infinity;
    this.jumped = false;
    this.finder?.forget();
    this.layers?.forget();
    this.carFinder?.forget();
    this.kept = [];
    this.had.clear();
    const inv = this.session.inventory;
    for (let k = 0; inv && k < inv.cap; k++) if (inv.item[k] !== 0) this.had.set(inv.item[k]!, (this.had.get(inv.item[k]!) ?? 0) + inv.count[k]!);
    this.searching = false;
    this.goalY = this.goalHeight(this.task);
  }

  /** Whether the body stands at the goal's height: on its floor, for a goal above the ground; anywhere for one on it. */
  private atHeight(): boolean {
    return Number.isNaN(this.goalY) || Math.abs(this.session.own.y - this.goalY) < 1.5;
  }

  private end(answer: Answer): void {
    const t = this.task;
    if (!t) return;
    const b = this.session.own;
    this.task = null;
    this.ended = { ...answer, task: t.kind, at: [Math.round(b.x * 10) / 10, Math.round(b.z * 10) / 10], ...(t.ranged ? { shots: t.shots, hits: t.hits } : {}), ...(t.kind === "harvest" || t.kind === "attack" ? { gathered: this.gathered() } : {}) };
  }

  /** A hit the server told of, where it landed. It counts for a ranged attack when it lands on or by the target. */
  hit(x: number, z: number): void {
    const t = this.task;
    if (t?.ranged && Math.hypot(x - t.target.x, z - t.target.z) < t.target.half + 2) t.hits++;
  }

  private phase(now: number, t: Task, phase: Phase): void {
    t.phase = phase;
    t.step = 0;
    t.since = now;
  }

  /** How the body moves: a ridden creature by its tamed numbers, which stand on gentler slopes. */
  private move(): MoveParams {
    const s = this.session;
    return (s.driving >= 0 ? s.registry.tamedMove[s.bodyKind] : null) ?? s.registry.move[s.bodyKind]!;
  }

  /** Whether the body steered is a flyer. */
  private flies(): boolean {
    return this.session.driving >= 0 && this.session.registry.flies[this.session.bodyKind] === 1;
  }

  /** Whether a body is knocked out, by its cue, or by what the server tells of the creature looked at: torpor only while it is out. */
  out(entity: number, cue: number): boolean {
    const looked = this.session.looked;
    return (cue & CUE_OUT) !== 0 || (looked !== null && looked.id === entity && looked.torpor >= 0);
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

  /** Finds what has become dangerous since it last looked. A death is told once its places to rise at have come. */
  private watch(now: number): string[] {
    const s = this.session;
    const reg = s.registry;
    const b = s.own;
    const fresh: string[] = [];
    if (s.sessionState === SESSION_DEAD) {
      if (!this.dead && s.respawnPoints.length > 0) {
        this.dead = true;
        if (s.choosing === CHOOSE_DIED) {
          this.deaths++;
          fresh.push("you died");
        } else if (s.choosing === CHOOSE_ARRIVED) fresh.push("you arrived: choose where to rise");
      }
      this.hunters.clear();
      return fresh;
    }
    this.dead = false;

    const r = this.remote;
    const own = ownIndex(s);
    const seen = new Set<number>();
    for (let i = 0; i < r.count; i++) {
      const id = r.id[i]!;
      const kind = r.kind[i]!;
      // A hunter knocked out, dead or tamed is no danger.
      if (reg.temper[kind] !== 2 || (r.flags[i]! & (VIEW_PLAYER | VIEW_PROP)) !== 0 || id === own || id === s.driving || r.team[i] !== 0 || (r.cue[i]! & (CUE_OUT | CUE_DEAD)) !== 0) continue;
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

  /**
   * Turns toward (x, z), and walks once nearly facing it. A mount turns toward the look at its own rate and walks the way its
   * body faces, so the look is set on the heading at once and the walking waits for the body.
   */
  private steer(dt: number, x: number, z: number): void {
    const s = this.session;
    const b = s.own;
    this.pitch = 0;
    const heading = Math.atan2(x - b.x, z - b.z);
    const off = s.driving >= 0 ? ((this.yaw = wrap(heading)), wrap(heading - (b.yaw / 65536) * TAU)) : this.turn(dt, heading);
    if (Math.abs(off) < ALIGNED) {
      this.moveZ = 1;
      this.pushed += dt * 1000;
      if (this.sprint && b.stamina > 0.3 * b.staminaMax * STAMINA_UNITS && (b.mflags & (MF_NO_SPRINT | MF_WINDED)) === 0) this.buttons |= BTN_SPRINT;
    }
  }

  /**
   * Finds the way from where the body is. On the ground, to a goal on the ground, the ground's finder answers at once. Off the
   * ground, in water, to a goal on a floor, or where the ground has no way, a search that climbs and swims is begun, and run a
   * slice a tick by `walk`. False if there is no way.
   */
  private plan(now: number, t: Task): boolean {
    const s = this.session;
    const b = s.own;
    const w = s.world!;
    const p = this.move();
    this.plans++;
    this.planned = true;
    this.next = 1;
    this.planX = t.gx;
    this.planZ = t.gz;
    this.check(now);
    this.goalY = this.goalHeight(t);
    if (!this.finder || !this.layers) {
      this.finder = new PathFinder(w, p);
      this.layers = new LayeredFinder(w, p);
      this.finder.doorways = this.layers.doorways = s.registry.doorway;
      for (const [x, z] of this.kept) {
        this.finder.avoid(x, z);
        this.layers.avoid(x, z);
      }
    }
    this.keepOffCars();
    const raised = b.y - groundUnder(w.hf, b.x, b.z, p.radius) > RAISED || b.mode === MODE_SWIM;
    // A floor far off is walked toward in legs on the ground, and climbed to once it is near.
    const far = Math.hypot(t.gx - b.x, t.gz - b.z) > CLIMB_NEAR;
    if (!raised && (Number.isNaN(this.goalY) || far)) {
      this.finder.body = p;
      this.status = this.finder.find(b.x, b.z, t.gx, t.gz);
      this.climbing = false;
      if (this.status === PATH_FOUND || this.status === PATH_LEG) return true;
    }
    // Up a stair, over a bridge, across water, or round what the ground's finder could not find a way round.
    this.layers.body = p;
    this.layers.swim = this.swim && !this.flies();
    this.climbing = true;
    if (!this.layers.begin(b.x, b.y, b.z, t.gx, this.goalY, t.gz)) {
      this.status = PATH_NONE;
      return false;
    }
    this.searching = true;
    return true;
  }

  /** The way finders do not see bodies, and a parked car is as big as a wall: every car in view, and a body's width round it, is kept off. */
  private keepOffCars(): void {
    const s = this.session;
    const reg = s.registry;
    const r = this.remote;
    for (let i = 0; i < r.count; i++) {
      const car = reg.vehicle[r.kind[i]!];
      if (!car || r.id[i] === s.driving) continue;
      const frame = { x: r.x[i]!, y: r.y[i]!, z: r.z[i]!, yaw: r.yaw[i]!, pitch: 0, roll: 0 };
      const wide = car.spec.halfWidth + 0.3;
      const long = car.spec.halfLength + 0.3;
      for (let lx = -wide; lx <= wide + 1e-6; lx += 0.5) {
        for (let lz = -long; lz <= long + 1e-6; lz += 0.5) {
          vehiclePoint(frame, [lx, 0, lz], this.at);
          this.finder?.avoid(this.at[0]!, this.at[2]!);
          this.layers?.avoid(this.at[0]!, this.at[2]!);
        }
      }
    }
  }

  /** The height of the floor a goal stands on, where that is above the ground; NaN for a goal on the ground. */
  private goalHeight(t: Task): number {
    const g = t.target;
    // A shot is taken from wherever it can be: a flyer in the air is shot at from the ground.
    if (t.ranged) return NaN;
    const foot = g.ref >= 0 ? g.y - g.down : g.y;
    const w = this.session.world!;
    const ground = groundUnder(w.hf, t.gx, t.gz, this.move().radius);
    if (foot - ground <= RAISED) return NaN;
    // A body with nothing under its feet is flying or falling, and is gone to from below.
    if (g.entity >= 0 && capsuleFree(w, g.x, foot - 0.3, g.z, 0.3, 0.3)) return NaN;
    return foot;
  }

  /** The way being walked, whichever finder found it. */
  private wayCount(): number {
    return this.climbing ? this.layers!.count : this.finder!.count;
  }

  private wayX(k: number): number {
    return this.climbing ? this.layers!.x[k]! : this.finder!.x[k]!;
  }

  private wayZ(k: number): number {
    return this.climbing ? this.layers!.z[k]! : this.finder!.z[k]!;
  }

  /** Whether a waypoint is on the body's storey: always, for a way on the ground. */
  private level(k: number): boolean {
    return !this.climbing || Math.abs(this.session.own.y - this.layers!.y[k]!) < 1.2;
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
    const far = Math.hypot(t.gx - b.x, t.gz - b.z);
    if (far <= t.stop && this.atHeight()) return this.reached(now, t);
    if ((b.mflags & MF_ROOTED) !== 0) return this.end({ state: "blocked", reason: "you carry too much to move" });
    // In the water on a way found for the ground, a way that swims is found from where it is.
    if (b.mode === MODE_SWIM && this.planned && !this.climbing) this.planned = false;
    const none: Answer = { state: "blocked", reason: this.swim ? "there is no way there on foot or swimming" : "there is no way there on foot" };
    if (!this.planned && !this.plan(now, t)) return this.end(none);
    if (this.searching) {
      // It stands while the search runs, a slice a tick.
      this.check(now);
      if (!this.layers!.run(SEARCH_SLICE)) return;
      this.searching = false;
      this.status = this.layers!.finish();
      this.next = 1;
      if (this.status === PATH_NONE) return this.end(none);
    }
    // Swimming, jump keeps it at the surface.
    if (b.mode === MODE_SWIM && !this.flies()) this.buttons |= BTN_JUMP;
    if (now >= this.checkAt) {
      const gained = Math.hypot(b.x - this.markX, b.z - this.markZ);
      const stuck = gained < STUCK_M && this.pushed > CHECK_MS * 0.7;
      // Two metres nearer the goal than where the trouble began, and the trouble is behind it. Stepping aside is not that.
      if (far < this.stuckFar - 2) {
        this.stuck = 0;
        this.jumped = false;
        this.stuckFar = Infinity;
      }
      // A goal on a floor, walked toward on the ground, is climbed to once it is near.
      let again = this.status === PATH_LEG || Math.hypot(t.gx - this.planX, t.gz - this.planZ) > 1 || (!this.climbing && !Number.isNaN(this.goalY) && far <= CLIMB_NEAR);
      if (stuck && !this.jumped) {
        // First it tries to hop over whatever it is. A flyer's jump would take off, so it does not.
        this.jumped = true;
        if (!this.flies()) this.jumpUntil = now + JUMP_MS;
        if (this.stuck === 0) this.stuckFar = far;
      } else if (stuck) {
        if (++this.stuck === STUCK_PLANS) return this.end({ state: "blocked", reason: "stuck: something that cannot be walked round is in the way", short_m: Math.round(far * 10) / 10 });
        this.jumped = false;
        const ax = b.x + Math.sin(this.yaw);
        const az = b.z + Math.cos(this.yaw);
        this.finder?.avoid(ax, az);
        this.layers?.avoid(ax, az);
        this.replans++;
        again = true;
      } else if (this.climbing ? !this.layers!.holds(this.next, b.x, b.y, b.z) : !this.finder!.holds(this.next, b.x, b.z)) {
        this.replans++;
        again = true;
      }
      this.check(now);
      if (again && !this.plan(now, t)) return this.end({ state: "blocked", reason: "the way is shut and there is no other", short_m: Math.round(far * 10) / 10 });
      if (this.searching) return;
    }
    // The point to make for is the first not yet reached or passed, on the storey the body is on.
    const n = this.wayCount();
    while (this.next < n) {
      const wx = this.wayX(this.next);
      const wz = this.wayZ(this.next);
      const passed = (wx - this.wayX(this.next - 1)) * (wx - b.x) + (wz - this.wayZ(this.next - 1)) * (wz - b.z) <= 0;
      if ((!passed && Math.hypot(wx - b.x, wz - b.z) > PASS) || !this.level(this.next)) break;
      this.next++;
    }
    if (this.next < n) return this.steer(dt, this.wayX(this.next), this.wayZ(this.next));
    // A leg walked to its end is followed by the next.
    if (this.status === PATH_LEG) return this.plan(now, t) ? undefined : this.end(none);
    if (this.status === PATH_SHORT || far - t.stop > LAST_STEPS) return this.short(now, t, "there is no way through to it");
    // The way ends at the nearest place to stand, and the rest is straight ahead.
    this.nearest = far;
    this.check(now);
    this.phase(now, t, "approaching");
  }

  /**
   * Flying a ridden flyer there: it takes off holding jump, climbs to cruise over the ground, water and skyline ahead, flies
   * at its heading, slows near the place, brakes to a hover over it, and lets go of jump to set down where a body may stand
   * dry, as the wild flyers land.
   */
  private fly(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const dx = t.gx - b.x;
    const dz = t.gz - b.z;
    const flat = Math.hypot(dx, dz);
    const speed = Math.hypot(b.vx, b.vz);
    const heading = flat > 0.5 ? Math.atan2(dx, dz) : this.yaw;
    if (b.mode !== MODE_FLYER) {
      // Down: landed, or not yet up.
      if (t.step === 2) return this.end({ state: "done", landed: true });
      if ((b.mflags & (MF_WINDED | MF_NO_JUMP | MF_ROOTED)) !== 0) return this.end({ state: "blocked", reason: (b.mflags & MF_WINDED) !== 0 ? "it is out of stamina: let it rest on the ground" : "it carries too much to take off" });
      if (now - t.since > 4000) return this.end({ state: "blocked", reason: "it would not take off" });
      this.yaw = wrap(heading);
      this.buttons |= BTN_JUMP;
      return;
    }
    if (t.step === 2) {
      // Coming down with jump let go. On a slope or a roof it cannot stand on, it stays up: it is held up again and tries elsewhere.
      if (now - t.since < 8000) return;
      t.step = 1;
      t.tries++;
      if (t.tries > 4) return this.end({ state: "blocked", reason: "it found nowhere to set down near there" });
    }
    this.buttons |= BTN_JUMP;
    if (now - t.began > FLIGHT_MS) return this.end({ state: "blocked", reason: "five minutes have passed: go_to again from here" });
    const near = flat < Math.max(0.8, t.stop);
    if (!near) {
      const floor = this.floorAhead(b.x, b.z, heading, Math.max(12, 2.5 * speed));
      const slow = flat < 15;
      const ty = slow ? Math.max(floor + 4, this.groundTop(t.gx, t.gz) + LAND_UP) : floor + CRUISE_UP;
      this.yaw = wrap(heading);
      this.pitch = within(Math.atan2(ty - b.y, Math.max(6, 1.2 * speed)), 0.87);
      if (this.pitch < -0.61) this.pitch = -0.61;
      // Something tall close ahead: it climbs nearly straight up, as the wish follows the look, and goes over it.
      if (b.y < this.floorAhead(b.x, b.z, heading, 10) + 4) this.pitch = 1.4;
      this.moveZ = slow ? 0.5 : 1;
      if (flat > 80 && b.stamina > 0.4 * b.staminaMax * STAMINA_UNITS && (b.mflags & (MF_NO_SPRINT | MF_WINDED)) === 0) this.buttons |= BTN_SPRINT;
      return;
    }
    // Over the place: brake to a hover.
    this.pitch = 0;
    if (speed > 0.3) {
      this.buttons |= BTN_BRAKE;
      return;
    }
    if (!t.land) {
      this.hover = true;
      return this.end({ state: "done", hovering: true });
    }
    // Where it hovers, if it may set down there; else over the nearest place it may.
    if (!this.landable(b.x, b.z)) {
      const spot = this.landing(t.gx, t.gz);
      if (!spot) return this.end({ state: "blocked", reason: "there is nowhere dry and level to set down within 20 m of there" });
      t.gx = spot[0];
      t.gz = spot[1];
      t.stood = true;
      t.stop = 0.5;
      return;
    }
    // Let go of jump: it comes down at 12 m/s and sets down unhurt.
    this.buttons &= ~BTN_JUMP;
    t.step = 2;
    t.since = now;
  }

  /** The top of what is under (x, z) and three points ahead along `yaw`: the ground, water and what is built or grows. */
  private floorAhead(x: number, z: number, yaw: number, ahead: number): number {
    const w = this.session.world!;
    let top = w.hf.seaLevel;
    for (let k = 0; k <= 3; k++) top = Math.max(top, this.groundTop(x + (Math.sin(yaw) * ahead * k) / 3, z + (Math.cos(yaw) * ahead * k) / 3));
    return top;
  }

  /** The top of the ground, the water and whatever stands in the 16 m square about (x, z). */
  private groundTop(x: number, z: number): number {
    const w = this.session.world!;
    const x0 = Math.floor(x / 16) * 16;
    const z0 = Math.floor(z / 16) * 16;
    return Math.max(groundUnder(w.hf, x, z, 0.75), w.hf.waterAt(x, z), w.structs.topIn(x0, z0, x0 + 15.99, z0 + 15.99), w.nodes?.topIn(x0, z0, x0 + 15.99, z0 + 15.99) ?? -Infinity, this.cityTop(x, z));
  }

  /** The tallest of the map's own pieces in the chunk holding (x, z), which a client knows from the map file wherever it is. */
  private cityTop(x: number, z: number): number {
    const city = this.session.world!.city?.statics;
    if (!city) return -Infinity;
    const dims = city.dims;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) return -Infinity;
    const c = cz * dims.chunksX + cx;
    let top = this.tops.get(c);
    if (top === undefined) {
      top = -Infinity;
      const t = city.rows(c);
      for (let i = t?.from(c) ?? 0; t && i < t.to(c); i++) top = Math.max(top, t.y[i]! + city.halfY[t.kind[i]!]!);
      this.tops.set(c, top);
    }
    return top;
  }

  /** Where nearest (x, z), within 20 m, a flyer may set down: dry ground it stands on there and round it, open to the sky. */
  private landing(x: number, z: number): [number, number] | null {
    if (this.landable(x, z)) return [x, z];
    for (let r = 2; r <= 20; r += 2) {
      for (let k = 0; k < 16; k++) {
        const px = x + Math.sin((k * TAU) / 16) * r;
        const pz = z + Math.cos((k * TAU) / 16) * r;
        if (this.landable(px, pz)) return [px, pz];
      }
    }
    return null;
  }

  /** Whether a flyer coming straight down at (x, z) sets down dry on ground it stands on, with nothing over it. */
  private landable(x: number, z: number): boolean {
    const w = this.session.world!;
    const p = this.move();
    const y = groundUnder(w.hf, x, z, p.radius);
    if (y < w.hf.waterAt(x, z) + 0.3 || !capsuleFree(w, x, y + 0.05, z, p.radius, Math.max(p.height, this.session.own.y - y))) return false;
    for (let k = 0; k < 5; k++) if (groundAt(w, p, x + (k === 1 ? 0.5 : k === 2 ? -0.5 : 0), z + (k === 3 ? 0.5 : k === 4 ? -0.5 : 0)) !== GROUND_FREE) return false;
    return true;
  }

  /**
   * Driving a car there: the way is found for a body as wide as the car on ground it can climb, and followed by steering at
   * a point some metres along it, slowing for bends and the end, braking with the throttle against the motion, backing off
   * what it runs into, and standing on the handbrake once there.
   */
  private drive(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const yaw = b.vehicleYaw;
    const v = b.vx * Math.sin(yaw) + b.vz * Math.cos(yaw);
    const far = Math.hypot(t.gx - b.x, t.gz - b.z);
    if (now - t.began > FLIGHT_MS) return this.end({ state: "blocked", reason: "five minutes have passed: go_to again from here" });
    if (far <= Math.max(t.stop, 3)) {
      // There: the throttle against the motion brakes, and the handbrake holds it.
      this.buttons |= BTN_JUMP;
      if (Math.abs(v) > 0.4) this.moveZ = v > 0 ? -1 : 1;
      else return this.end({ state: "done" });
      return;
    }
    if (b.fuel <= 0) return this.end({ state: "blocked", reason: "the car is out of fuel" });
    // Backing off: the wheel turned against the bend, for a second and a half.
    if (now < t.hold) {
      this.moveZ = -1;
      this.moveX = t.wheel;
      return;
    }
    if (!this.planned || now >= this.checkAt) {
      const gained = Math.hypot(b.x - this.markX, b.z - this.markZ);
      if (this.planned && gained < 0.5 && this.pushed > 1500) {
        if (++this.stuck >= STUCK_PLANS * 2) return this.end({ state: "blocked", reason: "stuck: the car cannot get through", short_m: Math.round(far * 10) / 10 });
        this.carFinder?.avoid(b.x + Math.sin(yaw) * 2.5, b.z + Math.cos(yaw) * 2.5);
        t.hold = now + 1500;
        t.wheel = this.moveX > 0 ? -1 : 1;
        this.planned = false;
        return;
      }
      const w = s.world!;
      this.carFinder ??= new PathFinder(w, CAR_WALKER);
      const status = this.carFinder.find(b.x, b.z, t.gx, t.gz);
      this.plans++;
      if (status === PATH_NONE) return this.end({ state: "blocked", reason: "there is no way there a car can drive" });
      this.planned = true;
      this.next = 1;
      this.checkAt = now + 2000;
      this.markX = b.x;
      this.markZ = b.z;
      this.pushed = 0;
    }
    const f = this.carFinder!;
    // The point to steer at: the first of the way at least a few metres off, further the faster it goes.
    const look = Math.max(5, 1.2 * Math.abs(v));
    let px = f.x[f.count - 1]!;
    let pz = f.z[f.count - 1]!;
    for (let k = this.next; k < f.count; k++) {
      if (Math.hypot(f.x[k]! - b.x, f.z[k]! - b.z) >= look) {
        px = f.x[k]!;
        pz = f.z[k]!;
        this.next = k;
        break;
      }
    }
    const err = wrap(Math.atan2(px - b.x, pz - b.z) - yaw);
    // Facing away, slow, it backs round first: the wheel turned the other way swings the nose toward the way.
    if (Math.abs(err) > 2 && Math.abs(v) < 3 && t.tries++ < 4) {
      t.hold = now + 2500;
      t.wheel = err > 0 ? 1 : -1;
      return;
    }
    this.moveX = within(-2 * err, 1);
    // Slower in bends and near the end; the throttle against the motion is the brake.
    const want = Math.min(CAR_SPEED, Math.max(3, CAR_SPEED - 14 * Math.abs(err)), Math.max(2, far * 0.6));
    this.moveZ = v < want ? within(0.3 + (want - v) * 0.4, 1) : v > want + 1.5 ? -0.6 : 0.1;
    if (this.moveZ > 0) this.pushed += dt * 1000;
  }

  /** The last steps, straight at the target, for as long as they bring it nearer. */
  private approach(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const far = Math.hypot(t.gx - b.x, t.gz - b.z);
    if (far <= t.stop && this.atHeight()) return this.reached(now, t);
    // It does not walk off into water, onto a slope or off a floor for the sake of the last metre.
    const ax = b.x + ((t.gx - b.x) / far) * 0.6;
    const az = b.z + ((t.gz - b.z) / far) * 0.6;
    if (this.climbing) {
      const y = this.layers!.walk(b.x, b.y, b.z, ax, az);
      if (Number.isNaN(y) || this.layers!.fell || (this.layers!.swam && b.mode !== MODE_SWIM)) return this.short(now, t, "the floor between cannot be walked");
    } else {
      const ahead = groundAt(s.world!, this.move(), ax, az);
      if (ahead !== GROUND_FREE && ahead !== GROUND_SOLID) return this.short(now, t, "the ground between cannot be walked");
    }
    this.steer(dt, t.gx, t.gz);
    if (now < this.checkAt) return;
    this.checkAt = now + CHECK_MS;
    if (this.nearest - far < STUCK_M) return this.short(now, t, "something is in the way");
    this.nearest = far;
  }

  /** It can get no nearer. Walking ends short. Gathering and opening try from where it stands. */
  private short(now: number, t: Task, reason: string): void {
    const b = this.session.own;
    if (t.kind !== "go_to") return this.phase(now, t, "facing");
    this.end({ state: "blocked", reason, short_m: Math.round((Math.hypot(t.gx - b.x, t.gz - b.z) - t.stop) * 10) / 10 });
  }

  private reached(now: number, t: Task): void {
    if (t.kind === "go_to") return this.end({ state: "done" });
    this.phase(now, t, "facing");
  }

  /** Before gathering: the tool is taken in hand, or a weapon that is no tool is put away, and how near to stand is worked out. */
  private ready(now: number, t: Task): void {
    const s = this.session;
    const reg = s.registry;
    const inv = s.inventory;
    const held = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.item[inv.hotbar + s.held]! : 0;
    // Riding, the mount's jaws fight, and nothing is taken in hand.
    const wrong = s.driving >= 0 ? false : t.tool !== 0 ? held !== t.tool : held !== 0 && reg.weapon[held] !== null && reg.weapon[held]!.kind !== W_MELEE;
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
    // A bush is picked with the use button. A tree, a rock or a body is struck, from as far as what is in hand reaches.
    const byHand = t.kind !== "attack" && (reg.defs[t.target.kind] as NodeDef).material === undefined;
    t.stop = t.ranged ? t.range : t.target.half + (byHand ? 1.5 : this.reach() - 1.1);
    this.phase(now, t, "walking");
  }

  /** Metres from the eye a swing reaches: the melee weapon in hand, if it is not worn out, or else bare hands. As the server works it out. */
  private reach(): number {
    const s = this.session;
    const reg = s.registry;
    const inv = s.inventory;
    const slot = inv && inv.hotbar >= 0 && s.held >= 0 ? inv.hotbar + s.held : -1;
    const item = slot >= 0 && s.driving < 0 ? inv!.item[slot]! : 0;
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
    if (t.kind === "open" || t.kind === "act" || t.kind === "use") return this.phase(now, t, "using");
    if (t.kind === "attack") return this.phase(now, t, "swinging");
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

  /** The share of its health the survivor has left. 1 before its vitals are known. */
  private healthLeft(): number {
    const s = this.session;
    return s.hasVitals && s.vitals.max[V_HEALTH]! > 0 ? s.vitals.at(V_HEALTH, s.serverTick) / s.vitals.max[V_HEALTH]! : 1;
  }

  /** Striking a body: it keeps facing it, goes after it when it moves off, and stops once it is out, or enough has been gathered. */
  private strike(now: number, dt: number, t: Task): void {
    const s = this.session;
    const b = s.own;
    const g = t.target;
    const r = this.remote;
    let cue = 0;
    for (let i = 0; i < r.count; i++) if (r.id[i] === g.entity) cue = r.cue[i]!;
    if (t.out && this.out(g.entity, cue)) return this.end({ state: "done", target: "knocked out" });
    if (t.count > 0 && (s.inventory?.total(t.item) ?? 0) - (this.had.get(t.item) ?? 0) >= t.count) return this.end({ state: "done", target: "still there" });
    if (now - t.began > HARVEST_MS) return this.end({ state: "blocked", reason: "a minute has passed" });
    const flat = Math.hypot(g.x - b.x, g.z - b.z);
    if (flat > t.stop + 0.6) {
      this.planned = false;
      return this.phase(now, t, "walking");
    }
    // Riding, the bite goes where the mount faces, which turns toward the look at its own rate.
    const heading = Math.atan2(g.x - b.x, g.z - b.z);
    const left = s.driving >= 0 ? ((this.yaw = wrap(heading)), wrap(heading - (b.yaw / 65536) * TAU)) : flat < 0.05 ? 0 : this.turn(dt, heading);
    const want = within(Math.atan2(g.y + g.up / 2 - (b.y + stanceEye(this.move(), b.stance)), Math.max(flat, 0.05)), 1.5);
    this.pitch += within(want - this.pitch, TURN * dt);
    if (Math.abs(left) < 0.2) this.buttons |= BTN_PRIMARY;
  }

  /**
   * Shooting a body from range: standing still and aiming down the sights, it leads a flying round by its flight and lifts it
   * for its drop, and puts a hitscan round straight on what it sees, as the server judges a shot by what its client drew.
   */
  private shoot(now: number, dt: number, t: Task): void {
    const s = this.session;
    const reg = s.registry;
    const b = s.own;
    const g = t.target;
    const r = this.remote;
    let cue = 0;
    for (let i = 0; i < r.count; i++) if (r.id[i] === g.entity) cue = r.cue[i]!;
    if (t.out && this.out(g.entity, cue)) return this.end({ state: "done", target: "knocked out" });
    if ((cue & CUE_DEAD) !== 0) return this.end({ state: "done", target: "dead" });
    if (now - t.began > HARVEST_MS) return this.end({ state: "blocked", reason: "a minute has passed" });
    const w = reg.weapon[t.tool];
    if (!w || b.held !== t.tool) {
      // Put away or swapped meanwhile: take it in hand again.
      this.phase(now, t, "waiting");
      return;
    }
    if (b.rounds === 0 && b.reloadTo === 0 && b.act !== ACT_RELOAD && b.act !== ACT_EQUIP && now - t.since > 1500) return this.end({ state: "blocked", reason: `the ${shortName(reg.ids[t.tool])} has no ammunition you carry` });
    const flat = Math.hypot(g.x - b.x, g.z - b.z);
    const eye = b.y + stanceEye(this.move(), b.stance);
    const my = g.y + g.up / 2;
    // Too far, or something stands between: nearer, and in sight.
    const far = Math.hypot(flat, my - eye);
    lookDirection(Math.round((Math.atan2(g.x - b.x, g.z - b.z) / TAU) * 65536) & 0xffff, Math.round((Math.atan2(my - eye, Math.max(flat, 0.05)) / (PI / 2)) * 16384), this.dir);
    const hidden = castWorld(s.world!, b.x, eye, b.z, this.dir[0]!, this.dir[1]!, this.dir[2]!, far) !== HIT_NONE && rayHit.t < far - g.half;
    if (flat > t.range + 4 || (hidden && flat > 3)) {
      t.stop = hidden ? Math.max(2, flat - 4) : t.range;
      this.planned = false;
      return this.phase(now, t, "walking");
    }
    // The target's speed, from where it was seen a moment ago.
    let ux = 0, uy = 0, uz = 0;
    if (t.seenTick >= 0 && r.tick > t.seenTick) {
      const sec = (r.tick - t.seenTick) / 30;
      ux = (g.x - t.seenX) / sec;
      uy = (g.y - t.seenY) / sec;
      uz = (g.z - t.seenZ) / sec;
    }
    if (t.seenTick < 0 || r.tick - t.seenTick >= 3) {
      t.seenX = g.x;
      t.seenY = g.y;
      t.seenZ = g.z;
      t.seenTick = r.tick;
    }
    const ammo = s.inventory && s.held >= 0 ? s.inventory.ammo[s.inventory.hotbar + s.held]! : 0;
    const speed = w.kind === W_THROWN ? reg.ammoSpeed[t.tool]! : ammo !== 0 ? reg.ammoSpeed[ammo]! : 0;
    const gravity = w.kind === W_THROWN ? reg.ammoGravity[t.tool]! : ammo !== 0 ? reg.ammoGravity[ammo]! : 0;
    let ax = g.x, ay = my, az = g.z;
    if (speed > 0) {
      let fly = Math.hypot(ax - b.x, ay - eye, az - b.z) / speed;
      for (let k = 0; k < 6; k++) {
        ax = g.x + ux * fly;
        ay = my + uy * fly + 0.5 * gravity * fly * fly;
        az = g.z + uz * fly;
        fly = Math.hypot(ax - b.x, ay - eye, az - b.z) / speed;
      }
    }
    const left = this.turn(dt, Math.atan2(ax - b.x, az - b.z));
    const want = within(Math.atan2(ay - eye, Math.max(Math.hypot(ax - b.x, az - b.z), 0.05)), 1.5);
    this.pitch += within(want - this.pitch, TURN * dt);
    this.buttons |= BTN_SECONDARY;
    const on = Math.abs(left) < 0.01 && Math.abs(want - this.pitch) < 0.01;
    // A press or a release reaches the body a tick later, so for a moment after either it does nothing more.
    if (now < t.hold) return;
    if (w.kind === W_GUN) {
      // One press a shot, once the last has settled.
      if (on && b.act === ACT_NONE && b.rounds > 0 && b.kick === 0) {
        this.buttons |= BTN_PRIMARY;
        t.hold = now + SHOT_MS;
        t.shots++;
      }
      return;
    }
    // A bow, a sling or a bola is drawn and held, and loosed once it is drawn full and on the mark.
    if (b.act === ACT_HOLD && on) {
      t.hold = now + SHOT_MS;
      t.shots++;
      return;
    }
    if (b.act === ACT_NONE ? b.rounds > 0 || w.kind === W_THROWN : b.act === ACT_DRAW || b.act === ACT_HOLD) this.buttons |= BTN_PRIMARY;
  }

  private swing(now: number, dt: number, t: Task): void {
    if (t.kind === "attack") return t.ranged ? this.shoot(now, dt, t) : this.strike(now, dt, t);
    const s = this.session;
    const g = t.target;
    const inv = s.inventory;
    if ((s.nodeField?.standing(g.chunk, g.slot) ?? 0) === 0) return this.end({ state: "done", node: "gone" });
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

  /** Acting on a thing built: the action is sent, and the server's answer is waited for. */
  private actOn(now: number, t: Task): void {
    if (now - t.since > 4000) return this.end({ state: "blocked", reason: "the server did not answer" });
    if (t.step === 0) {
      t.seq = this.commands.send(CMD_STRUCT, (w) => {
        w.u32(t.target.ref);
        w.u8(t.action);
        if (t.action === STRUCT_NAME) w.string(t.words);
        if (t.action === STRUCT_PIN || t.action === STRUCT_USE) w.u16(t.pin);
      });
      if (t.seq !== 0) t.step = 1;
      return;
    }
    const code = this.commands.take(t.seq);
    if (code < 0) return;
    this.end(code === RESULT_OK ? { state: "done" } : { state: "blocked", reason: resultWords(code) });
  }

  /** The use button, held for three ticks so one of them is sure to carry it, then what the task waits for. */
  private press(now: number, t: Task): void {
    if (t.step === 0) {
      t.step = 1;
      t.since = now;
      // Where it stands, it looks down, at the ground or the water, and not at whatever is beside it.
      if (t.target.id === "") this.pitch = -1.2;
    }
    if (now - t.since < 100) {
      this.buttons |= BTN_USE;
      return;
    }
    const why = t.until!(now);
    if (why === null && now - t.since < 3000) return;
    this.end(why === "" ? { state: "done" } : { state: "blocked", reason: why ?? "nothing came of it" });
  }

  /** Opening: what is open is shut, then the thing is used, then the server's answer is waited for. */
  private use(now: number, t: Task): void {
    if (t.kind === "act") return this.actOn(now, t);
    if (t.kind === "use") return this.press(now, t);
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
    if (s.open) return this.end({ state: "done", opened: s.open.name });
    if (g.entity >= 0 && this.commands.news > 0) this.end({ state: "blocked", reason: resultWords(this.commands.news) });
  }
}
