// Cast's stage: the bodies of the stories players can see. A woken story's people come in from where no player is
// looking (outside every player's ring, the side away from them), walk to the scene and play their scripts (go, wait,
// face, emote, say, queue, serve, wait for each other), answer players by their reaction tables (step aside, wave back,
// say something, run), and leave toward where no one is, going from the world only once no player can see them. A body
// no player is near sleeps in the creature systems; the stage walks it itself then, in a straight line at its pace,
// since nobody is there to see it. Rules only, a few bodies a tick: never a model call here.

import type { Archetype, Catalogue, Response, Scene, Step, Stimulus, Target } from "../../shared/cast/catalogue.ts";
import { Queue } from "../../shared/cast/queue.ts";
import type { Character, Part, Story } from "../../shared/cast/state.ts";
import { Rng } from "../../shared/rng.ts";
import { keys, route, type CarState, type Route } from "./drive.ts";
import type { Cast, Stage } from "./engine.ts";
import type { CastPlayer, CastWorld } from "./world.ts";

/** Paces, as the body systems take them (server/behavior.ts GOAL_), and metres a second a sleeping body is walked at. */
export const PACE = { none: 0, stroll: 1, walk: 2, run: 3 } as const;
const SPEED = [0, 1.3, 2.5, 5.5];
/** Ticks between a body's turns: each body is looked at every third tick, a third of them each tick. */
const TURN = 3;
/** Seconds a step may take at most before it is let go (a goal it cannot reach, a partner who never came). */
const STEP_MOST = 120, SYNC_MOST = 45, QUEUE_MOST = 240;
/** Metres a player is noticed within, and the closeness that is "near". */
const NOTICE_M = 15, NEAR_M = 3;
/** Seconds between a body's reactions, and between the same reaction to the same player. */
const REACT_GAP = 4, REACT_AGAIN = 25;
/** Radians a player's look may be off a body and still be a stare, and the seconds it takes. */
const STARE_RAD = 0.2, STARE_S = 2;
const WAVES = new Set(["wave", "wave_big", "beckon", "salute", "thumbs_up"]);
/** Seconds a fight lasts at most, and metres a player gets away to end it: a scene's fight breaks off, never hounds. */
const FIGHT_MOST = 25, FIGHT_AWAY = 40;
/** Metres a gunshot is heard within, and a cop comes from when called. */
const GUNSHOT_M = 45, COP_M = 140;

/** What the stage asks of the bodies in the world. The server's is server/cast/host.ts; a body is known by its pid. */
export interface CastBodies {
  /** A new body for a person at (x, z) facing yaw; its pid, or -1 if there is no room there. */
  spawn(c: Character, a: Archetype, x: number, z: number, yaw: number): number;
  remove(pid: number): void;
  alive(pid: number): boolean;
  at(pid: number): { x: number; y: number; z: number } | null;
  /** The creature systems step it (a player is near); otherwise the stage moves it. */
  awake(pid: number): boolean;
  /** Puts a sleeping body at (x, z), on the ground. */
  place(pid: number, x: number, z: number): void;
  goTo(pid: number, x: number, z: number, pace: number): void;
  arrived(pid: number, r: number): boolean;
  face(pid: number, x: number, z: number): void;
  emote(pid: number, id: string): boolean;
  stopEmote(pid: number): void;
  say(pid: number, name: string, text: string): void;
  /** A vehicle of a species at (x, z) facing yaw, nobody's; its pid, or -1. */
  spawnCar(kind: string, x: number, z: number, yaw: number): number;
  removeCar(car: number): void;
  /** Where its driver's door is. */
  door(car: number): { x: number; z: number } | null;
  /** Begins getting in at the wheel; false if it cannot. */
  board(pid: number, car: number): boolean;
  seated(pid: number): boolean;
  alight(pid: number): boolean;
  car(car: number): CarState | null;
  drive(car: number, moveX: number, moveZ: number, handbrake: boolean): void;
  /** Takes an item it carries into its hand, or puts away what it holds (null). */
  hold(pid: number, item: string | null): void;
  /** Goes for a body (one of the stage's, by pid) or a survivor (by name), as a creature hunts. */
  attack(pid: number, target: { pid: number } | { player: string }): boolean;
  /** Stops a fight. */
  calm(pid: number): void;
  fighting(pid: number): boolean;
}

/** A player as the stage sees it: where it is, where it looks (radians, along (sin, cos)), the emote it plays. */
export interface StagePlayer extends CastPlayer {
  yaw?: number;
  emote?: string;
}

interface Body {
  pid: number;
  c: Character;
  story: Story | null;
  part: Part | null;
  /** The step's work was begun (its goal given, its emote asked for). */
  begun: boolean;
  /** Tick the current step is done waiting. */
  until: number;
  /** Where the current step goes, once worked out. */
  tx: number;
  tz: number;
  /** Seconds the stage walked it while it slept, carried between turns. */
  outX: number;
  outZ: number;
  out: boolean;
  /** A reaction under way: the step goes on after it. */
  aside: number;
  lastReact: number;
  reacted: Map<string, number>;
  stareSince: Map<string, number>;
  served: boolean;
  /** Its car, while it has one, and the route it drives with where on it it is; and where it was a moment ago, to
   * know when it is stuck. */
  car: number;
  route: Route | null;
  next: number;
  boarding: boolean;
  lastX: number;
  lastZ: number;
  lastT: number;
  backUntil: number;
}

export class CastStage implements Stage {
  private readonly cast: Cast;
  private readonly bodies: CastBodies;
  private readonly world: CastWorld;
  private readonly cat: Catalogue;
  private readonly byPid = new Map<number, Body>();
  private readonly stories = new Set<Story>();
  private readonly queues = new Map<number, Queue>();
  private readonly synced = new Map<string, Set<string>>();
  private readonly heard: { speaker: string; x: number; z: number; text: string; t: number }[] = [];
  private readonly rng: Rng;
  /** Counts for the admin page and tests: bodies brought in, sent away, reactions, lines said; and every place a
   * body came into or left the world, with whether a player could see it (a test checks none could). */
  readonly counts = { entered: 0, left: 0, reactions: 0, said: 0, slept: 0, cars: 0, arrived: 0 };
  readonly log: { pid: number; what: "in" | "out"; x: number; z: number; seen: boolean; t: number }[] = [];
  /** Keep the log of comings and goings (tests); off in a server. */
  logging = false;

  constructor(cast: Cast, bodies: CastBodies, seed: number) {
    this.cast = cast;
    this.bodies = bodies;
    this.world = cast.world;
    this.cat = cast.cat;
    this.rng = new Rng(seed);
  }

  get count(): number {
    return this.byPid.size;
  }

  /** Bodies in the world now, with whose they are, for the admin page. */
  list(): { pid: number; character: string; story: string | null; step: string }[] {
    return [...this.byPid.values()].map((b) => ({ pid: b.pid, character: b.c.id, story: b.story?.id ?? null, step: b.story && b.part ? (this.stepOf(b)?.do ?? "") : "leaving" }));
  }

  enter(story: Story): void {
    this.stories.add(story);
  }

  end(story: Story): void {
    this.stories.delete(story);
    for (const b of this.byPid.values()) if (b.story === story) this.release(b);
    for (const k of [...this.synced.keys()]) if (k.startsWith(`${story.id}:`)) this.synced.delete(k);
  }

  /** A survivor said a line: people near it, or named in it, hear it (a talk stimulus). */
  hear(speaker: string, x: number, z: number, text: string): void {
    this.heard.push({ speaker, x, z, text, t: this.world.tick() });
    if (this.heard.length > 32) this.heard.shift();
  }

  /** Called every tick: brings in the people of woken stories, then works a third of the bodies. */
  step(players: readonly StagePlayer[]): void {
    const tick = this.world.tick();
    for (const s of this.stories) this.bringIn(s, tick, players);
    for (const b of [...this.byPid.values()]) {
      if ((b.pid + tick) % TURN !== 0) continue;
      if (!this.bodies.alive(b.pid)) {
        this.died(b, tick);
        continue;
      }
      if (b.story && b.part) this.react(b, tick, players);
      this.work(b, tick, players);
    }
    const old = tick - 5 * this.world.rate;
    while (this.heard.length && this.heard[0]!.t < old) this.heard.shift();
  }

  // --- Coming and going ---------------------------------------------------------------------------------------------

  /** A woken story's people who have no body yet get one, a few a tick, each where no player can see. */
  private bringIn(s: Story, tick: number, players: readonly StagePlayer[]): void {
    let made = 0;
    const sc = this.cast.scenes.get(s.scene)!;
    const entries = new Map<string, { x: number; z: number }>();
    for (const part of s.parts) {
      if (part.pid !== undefined || part.gone || made >= 4) continue;
      const c = this.cast.people.byId.get(part.character);
      const a = c && this.cast.people.archetype(c.archetype);
      if (!c || !a) {
        part.gone = true;
        continue;
      }
      // A role comes in together, from one place.
      let at = entries.get(part.role);
      if (!at) {
        const drives = sc.script[part.role]![this.next(sc, s, part.role, -1)]!.do === "drive";
        const found = this.hidden(s.x, s.z, players, drives ? 3 : 0.35);
        if (!found) return;
        entries.set(part.role, (at = found));
      }
      const k = s.parts.indexOf(part);
      const first = sc.script[part.role]![this.next(sc, s, part.role, -1)]!;
      // One that drives comes in its car: the car out of sight, the person at its door, getting in.
      let car = -1;
      if (first.do === "drive") {
        const kinds = sc.vehicles?.length ? sc.vehicles : ["core:compact"];
        const yaw = Math.atan2(s.x - at.x, s.z - at.z);
        car = this.bodies.spawnCar(kinds[this.rng.int(kinds.length)]!, at.x + k * 7 * Math.cos(yaw), at.z - k * 7 * Math.sin(yaw), yaw);
        if (car < 0) {
          if (tick - s.since > STEP_MOST * this.world.rate) part.gone = true;
          continue;
        }
        this.counts.cars++;
      }
      const door = car >= 0 ? this.bodies.door(car) : null;
      let x = door ? door.x : at.x + (k % 3) * 0.9, z = door ? door.z : at.z + (Math.floor(k / 3) % 3) * 0.9;
      let pid = this.bodies.spawn(c, a, x, z, Math.atan2(s.x - x, s.z - z));
      // No room just there (a bin, a parked car): a few metres about, still out of sight.
      for (let tries = 0; pid < 0 && tries < 4; tries++) {
        const jx = at.x + this.rng.range(-6, 6), jz = at.z + this.rng.range(-6, 6);
        if (this.world.seen(jx, jz)) continue;
        x = jx;
        z = jz;
        pid = this.bodies.spawn(c, a, x, z, Math.atan2(s.x - x, s.z - z));
      }
      if (pid < 0) {
        if (car >= 0) this.bodies.removeCar(car);
        if (tick - s.since > STEP_MOST * this.world.rate) part.gone = true;
        continue;
      }
      made++;
      part.pid = pid;
      part.since = tick;
      part.step = this.next(sc, s, part.role, -1);
      if (car >= 0) this.bodies.board(pid, car);
      this.byPid.set(pid, { pid, c, story: s, part, begun: false, until: 0, tx: 0, tz: 0, outX: 0, outZ: 0, out: false, aside: 0, lastReact: -Infinity, reacted: new Map(), stareSince: new Map(), served: false, car, route: null, next: 0, boarding: car >= 0, lastX: x, lastZ: z, lastT: tick, backUntil: 0 });
      this.counts.entered++;
      if (this.logging) this.log.push({ pid, what: "in", x, z, seen: this.world.seen(x, z), t: tick });
    }
    if (s.phase === "entering" && s.parts.every((p) => p.pid !== undefined || p.gone)) {
      s.phase = "active";
      s.since = tick;
    }
  }

  /** The nearest dry, open place from (x, z) that no player can see, searched outward, the side away from players
   * first; null if there is none within a kilometre. */
  hidden(x: number, z: number, players: readonly CastPlayer[], room = 0.35): { x: number; z: number } | null {
    let ax = 0, az = 0;
    for (const p of players) {
      const d = Math.hypot(x - p.x, z - p.z) || 1;
      ax += (x - p.x) / d;
      az += (z - p.z) / d;
    }
    const away = ax === 0 && az === 0 ? this.rng.float() * Math.PI * 2 : Math.atan2(ax, az);
    const w = this.world;
    for (let r = 40; r <= 1000; r += 24) {
      for (let k = 0; k < 12; k++) {
        const a = away + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (px < 4 || pz < 4 || px > w.sizeX - 4 || pz > w.sizeZ - 4) continue;
        if (w.seen(px, pz) || w.ground(px, pz) < 0 || w.water(px, pz) > 0.2 || w.blocked(px, pz, room)) continue;
        return { x: px, z: pz };
      }
    }
    return null;
  }

  /** The body has nothing more to do here: it leaves toward where no one is. */
  private release(b: Body): void {
    b.story = null;
    b.part = null;
    b.begun = false;
    b.out = false;
  }

  private gone(b: Body, tick: number): void {
    const at = this.bodies.at(b.pid);
    if (this.logging && at) this.log.push({ pid: b.pid, what: "out", x: at.x, z: at.z, seen: this.world.seen(at.x, at.z), t: tick });
    this.bodies.remove(b.pid);
    if (b.car >= 0) this.bodies.removeCar(b.car);
    this.byPid.delete(b.pid);
    for (const q of this.queues.values()) q.leave(b.c.id);
    if (b.part) {
      b.part.gone = true;
      delete b.part.pid;
    }
    this.counts.left++;
    if (b.story && b.story.parts.every((p) => p.gone)) this.cast.finish(b.story, tick);
  }

  private died(b: Body, tick: number): void {
    b.c.dead = true;
    this.cast.people.remember(b.c, `died at tick ${tick}`, tick, true);
    this.byPid.delete(b.pid);
    for (const q of this.queues.values()) q.leave(b.c.id);
    if (b.part) {
      b.part.gone = true;
      delete b.part.pid;
    }
    if (b.story) {
      b.story.importance = Math.min(1, b.story.importance + 0.5);
      b.story.history.push(`${b.c.name} died`);
      if (b.story.parts.every((p) => p.gone)) this.cast.finish(b.story, tick);
    }
  }

  // --- Scripts ------------------------------------------------------------------------------------------------------

  /** The index of the role's next step after `from` that its story's choices allow. */
  private next(sc: Scene, s: Story, role: string, from: number): number {
    const steps = sc.script[role]!;
    for (let i = from + 1; i < steps.length; i++) {
      const w = steps[i]!.when;
      if (!w || Object.entries(w).every(([k, v]) => s.choices[k] === v)) return i;
    }
    return steps.length - 1;
  }

  private stepOf(b: Body): Step | null {
    if (!b.story || !b.part) return null;
    return this.cast.scenes.get(b.story.scene)!.script[b.part.role]![b.part.step] ?? null;
  }

  private advance(b: Body, tick: number): void {
    const s = b.story!, part = b.part!, sc = this.cast.scenes.get(s.scene)!;
    part.step = this.next(sc, s, part.role, part.step);
    part.since = tick;
    b.begun = false;
    b.until = 0;
    if (s.phase === "active" && s.parts.every((p) => p.gone || sc.script[p.role]![p.step]!.do === "leave")) {
      s.phase = "leaving";
      s.since = tick;
    }
  }

  private work(b: Body, tick: number, players: readonly StagePlayer[]): void {
    if (b.aside > tick) return;
    if (b.aside !== 0) {
      b.aside = 0;
      b.begun = false;
      if (this.bodies.fighting(b.pid)) this.bodies.calm(b.pid);
    }
    const st = this.stepOf(b);
    if (!st || st.do === "leave") return this.leave(b, tick, players, st?.do === "leave" ? st.pace : undefined);
    const s = b.story!, part = b.part!;
    const age = (tick - part.since) / this.world.rate;
    if (age > (st.do === "queue" ? QUEUE_MOST : st.do === "sync" ? SYNC_MOST : STEP_MOST)) return this.advance(b, tick);
    switch (st.do) {
      case "goto": {
        const live = typeof st.to === "object" && "role" in st.to || st.to === "player";
        if (!b.begun || (live && age % 1 < TURN / this.world.rate)) {
          const t = this.target(b, st.to, players);
          b.tx = t.x;
          b.tz = t.z;
          this.walk(b, PACE[st.pace ?? "walk"]);
          b.begun = true;
        }
        if (this.there(b, live ? 2.5 : 1.2)) this.advance(b, tick);
        else this.carry(b, PACE[st.pace ?? "walk"]);
        return;
      }
      case "wait":
        if (!b.begun) this.hold(b, tick, this.rng.range(st.s[0], st.s[1]));
        if (tick >= b.until) this.advance(b, tick);
        return;
      case "face":
        if (!b.begun) {
          const t = this.target(b, st.to, players);
          this.stand(b);
          this.bodies.face(b.pid, t.x, t.z);
          b.until = tick + Math.round(0.6 * this.world.rate);
          b.begun = true;
        }
        if (tick >= b.until) this.advance(b, tick);
        return;
      case "emote":
        if (!b.begun) {
          this.stand(b);
          if (!this.bodies.emote(b.pid, st.emote) && age < 3) return;
          b.until = tick + Math.round((st.s ? this.rng.range(st.s[0], st.s[1]) : 3) * this.world.rate);
          b.begun = true;
        }
        if (tick >= b.until) {
          this.bodies.stopEmote(b.pid);
          this.advance(b, tick);
        }
        return;
      case "say":
        if (!b.begun) {
          this.speak(b, st.line);
          b.until = tick + Math.round(1.2 * this.world.rate);
          b.begun = true;
        }
        if (tick >= b.until) this.advance(b, tick);
        return;
      case "queue": {
        const q = this.queueAt(s);
        if (!b.begun) {
          q.join(b.c.id);
          b.served = false;
          b.begun = true;
        }
        if (b.served || q.place(b.c.id) < 0) return this.advance(b, tick);
        const slot = q.slot(q.place(b.c.id));
        if (Math.abs(slot.x - b.tx) + Math.abs(slot.z - b.tz) > 0.3) {
          b.tx = slot.x;
          b.tz = slot.z;
          this.walk(b, PACE.walk);
        }
        this.carry(b, PACE.walk);
        return;
      }
      case "serve": {
        const q = this.queueAt(s), spot = this.cast.spots.all[s.spot]!;
        if (!b.begun) {
          this.hold(b, tick, this.rng.range(st.s[0], st.s[1]));
          b.tx = tick;
          b.begun = true;
        }
        const every = (spot.queue?.serve ?? 8) * this.world.rate;
        if (tick - b.tx >= every && q.length) {
          b.tx = tick;
          const head = q.serve();
          for (const o of this.byPid.values()) if (o.c.id === head) o.served = true;
        }
        if (tick >= b.until) this.advance(b, tick);
        return;
      }
      case "sync": {
        const key = `${s.id}:${st.name}`;
        let got = this.synced.get(key);
        if (!got) this.synced.set(key, (got = new Set()));
        if (!b.begun) {
          got.add(b.c.id);
          this.stand(b);
          b.begun = true;
        }
        const waiting = s.parts.filter((p) => !p.gone && !got!.has(p.character));
        if (!waiting.length) this.advance(b, tick);
        return;
      }
      case "drive":
        return this.driveTo(b, tick, players, this.target(b, st.to, players), true);
      case "hold":
        if (!b.begun) {
          this.bodies.hold(b.pid, st.item);
          b.until = tick + Math.round(0.8 * this.world.rate);
          b.begun = true;
        }
        if (tick >= b.until) this.advance(b, tick);
        return;
      case "attack":
        return this.fight(b, tick, players, st.target);
      default:
        return this.advance(b, tick);
    }
  }

  /**
   * A scripted fight: goes for another role's body or the story's player (only at hostility 2, the scene having been
   * cast for it), until the target is down or out of reach, or the fight has run its time; then the script goes on.
   */
  private fight(b: Body, tick: number, players: readonly StagePlayer[], t: Target): void {
    const s = b.story!;
    if (!b.begun) {
      let target: { pid: number } | { player: string } | null = null;
      if (t === "player") {
        if (this.cast.settings.hostility >= 2) {
          const at = this.bodies.at(b.pid);
          let best: StagePlayer | null = null;
          for (const p of players) if (s.for.includes(p.name) && at && (!best || Math.hypot(p.x - at.x, p.z - at.z) < Math.hypot(best.x - at.x, best.z - at.z))) best = p;
          if (best) target = { player: best.name };
        }
      } else if (typeof t === "object" && "role" in t) {
        const o = s.parts.find((p) => p.role === t.role && p.pid !== undefined && !p.gone);
        if (o) target = { pid: o.pid! };
      }
      if (!target || !this.bodies.attack(b.pid, target)) return this.advance(b, tick);
      s.history.push(`${b.c.name} went for ${"player" in target ? target.player : "a rival"}`);
      s.importance = Math.min(1, s.importance + 0.3);
      b.begun = true;
      b.tx = tick;
      return;
    }
    const at = this.bodies.at(b.pid);
    const away = t === "player" && at && !players.some((p) => s.for.includes(p.name) && Math.hypot(p.x - at.x, p.z - at.z) < FIGHT_AWAY);
    if (!this.bodies.fighting(b.pid) || away || tick - b.tx > FIGHT_MOST * this.world.rate) {
      this.bodies.calm(b.pid);
      this.advance(b, tick);
    }
  }

  /** One of the stage's people was hurt, by a survivor (by name) or not: it reacts by its table. */
  attacked(pid: number, by: string | null, players: readonly StagePlayer[]): void {
    const b = this.byPid.get(pid);
    if (!b || !b.story || !b.part) return;
    const tick = this.world.tick();
    const p = (by && players.find((q) => q.name === by)) || null;
    if (p) {
      this.cast.people.met(b.c, p.name, -0.6, `${p.name} attacked me`, tick);
      this.cast.people.remember(b.c, `${p.name} attacked me`, tick, true);
      if (!b.story.engaged.includes(p.name)) b.story.engaged.push(p.name);
      b.story.importance = 1;
      this.cast.engaged(b.story);
    }
    const at = this.bodies.at(pid);
    if (at) this.respond(b, "attacked", p ?? { name: "", x: at.x, z: at.z }, tick, at, true);
  }

  /** A shot near: everyone of the stage within hearing reacts by its table. */
  gunshot(x: number, z: number, by: string | null, players: readonly StagePlayer[]): void {
    const tick = this.world.tick();
    const p = (by && players.find((q) => q.name === by)) || { name: by ?? "", x, z };
    for (const b of this.byPid.values()) {
      if (!b.story || !b.part || this.bodies.fighting(b.pid)) continue;
      const at = this.bodies.at(b.pid);
      if (at && Math.hypot(at.x - x, at.z - z) < GUNSHOT_M) this.respond(b, "gunshot", p, tick, at, true);
    }
  }

  /** Leaves toward where no player is; gone from the world once no player can see it. */
  private leave(b: Body, tick: number, players: readonly StagePlayer[], pace?: string): void {
    const at = this.bodies.at(b.pid);
    if (!at) return this.gone(b, tick);
    // Out by car where it has one: back to it, in, and away; gone once the car is out of every player's sight.
    const car = b.car >= 0 ? this.bodies.car(b.car) : null;
    if (car) {
      if (!this.world.seen(car.x, car.z) && (this.bodies.seated(b.pid) || !this.world.seen(at.x, at.z))) return this.gone(b, tick);
      if (!b.out) {
        const out = this.hidden(car.x, car.z, players, 3) ?? { x: car.x, z: car.z };
        b.tx = out.x;
        b.tz = out.z;
        b.out = true;
        b.route = null;
      }
      this.driveTo(b, tick, players, { x: b.tx, z: b.tz }, false);
      return;
    }
    if (!this.world.seen(at.x, at.z)) return this.gone(b, tick);
    if (!b.out) {
      const out = this.hidden(at.x, at.z, players) ?? { x: at.x, z: at.z };
      b.tx = out.x;
      b.tz = out.z;
      b.out = true;
      this.walk(b, pace === "run" ? PACE.run : pace === "stroll" ? PACE.stroll : PACE.walk);
    }
    // Arrived and still seen (a player followed it): it goes on, further out.
    if (this.there(b, 2)) b.out = false;
    else this.carry(b, pace === "run" ? PACE.run : PACE.walk);
  }

  /**
   * Drives its car to a point: to the car and in first if it is out of it, then along a route with a driver's keys, out
   * of the car at the end when `alight`. A car stuck (barely moved for two seconds) backs off a moment and finds its way
   * again. With no car it walks.
   */
  private driveTo(b: Body, tick: number, players: readonly StagePlayer[], t: { x: number; z: number }, alight: boolean): void {
    const car = b.car >= 0 ? this.bodies.car(b.car) : null;
    if (!car) {
      if (!b.begun) {
        b.tx = t.x;
        b.tz = t.z;
        this.walk(b, PACE.walk);
        b.begun = true;
      }
      if (this.there(b, 1.5)) this.advance(b, tick);
      else this.carry(b, PACE.walk);
      return;
    }
    if (!this.bodies.seated(b.pid)) {
      if (b.boarding) return;
      // Out of it: walk to its door and get in.
      const door = this.bodies.door(b.car);
      const at = this.bodies.at(b.pid);
      if (door && at && Math.hypot(door.x - at.x, door.z - at.z) < 2.5) {
        b.boarding = this.bodies.board(b.pid, b.car);
        return;
      }
      if (door) this.bodies.goTo(b.pid, door.x, door.z, PACE.walk);
      return;
    }
    b.boarding = false;
    if (!b.route) {
      b.route = route(this.world, car.x, car.z, t.x, t.z);
      b.next = 0;
      b.lastX = car.x;
      b.lastZ = car.z;
      b.lastT = tick;
      if (!b.route) {
        // No way by road: it gets out and goes on foot.
        if (alight && this.bodies.alight(b.pid)) this.advance(b, tick);
        return;
      }
    }
    if (tick < b.backUntil) {
      this.bodies.drive(b.car, 60, -70, false);
      return;
    }
    const k = keys(car, b.route, b.next, this.ahead(b, car, players));
    b.next = k.next;
    if (k.done) {
      this.bodies.drive(b.car, 0, 0, true);
      if (!alight) return;
      this.counts.arrived++;
      if (this.bodies.alight(b.pid) || !this.bodies.seated(b.pid)) {
        b.route = null;
        this.advance(b, tick);
      }
      return;
    }
    this.bodies.drive(b.car, k.moveX, k.moveZ, k.handbrake);
    if (tick - b.lastT >= 2 * this.world.rate) {
      const moved = Math.hypot(car.x - b.lastX, car.z - b.lastZ);
      if (moved < 0.6 && k.moveZ > 20) {
        b.backUntil = tick + Math.round(1.2 * this.world.rate);
        b.route = null;
      }
      b.lastX = car.x;
      b.lastZ = car.z;
      b.lastT = tick;
    }
  }

  /** Someone, or another of the stage's bodies, in front of the car within its stopping distance. */
  private ahead(b: Body, car: CarState, players: readonly StagePlayer[]): boolean {
    const reach = 4 + car.speed * 1.2;
    const near = (x: number, z: number) => {
      const dx = x - car.x, dz = z - car.z, d = Math.hypot(dx, dz);
      return d > 1 && d < reach && Math.abs(angle(Math.atan2(dx, dz) - car.yaw)) < 0.45;
    };
    for (const p of players) if (near(p.x, p.z)) return true;
    for (const o of this.byPid.values()) {
      if (o === b || (o.car >= 0 && o.car === b.car) || this.bodies.seated(o.pid)) continue;
      const at = this.bodies.at(o.pid);
      if (at && near(at.x, at.z)) return true;
    }
    return false;
  }

  private walk(b: Body, pace: number): void {
    this.bodies.stopEmote(b.pid);
    this.bodies.goTo(b.pid, b.tx, b.tz, pace);
  }

  /** A sleeping body is walked by the stage, straight, at its pace: nobody is there to see it. */
  private carry(b: Body, pace: number): void {
    if (this.bodies.awake(b.pid) || (b.car >= 0 && this.bodies.seated(b.pid))) return;
    const at = this.bodies.at(b.pid);
    if (!at) return;
    const dx = b.tx - at.x, dz = b.tz - at.z, d = Math.hypot(dx, dz);
    if (d < 0.5) return;
    const step = Math.min(d, (SPEED[pace] ?? 2.5) * (TURN / this.world.rate));
    this.bodies.place(b.pid, at.x + (dx / d) * step, at.z + (dz / d) * step);
    this.counts.slept++;
  }

  private there(b: Body, r: number): boolean {
    const at = this.bodies.at(b.pid);
    return !!at && Math.hypot(at.x - b.tx, at.z - b.tz) <= r;
  }

  private stand(b: Body): void {
    const at = this.bodies.at(b.pid);
    if (at) this.bodies.goTo(b.pid, at.x, at.z, PACE.none);
  }

  private hold(b: Body, tick: number, seconds: number): void {
    this.stand(b);
    b.until = tick + Math.round(seconds * this.world.rate);
    b.begun = true;
  }

  private queueAt(s: Story): Queue {
    let q = this.queues.get(s.spot);
    if (!q) {
      const spot = this.cast.spots.all[s.spot]!;
      q = new Queue({ x: spot.x, z: spot.z, yaw: spot.queue?.yaw ?? 0, spacing: spot.queue?.spacing ?? 0.9 }, 24);
      this.queues.set(s.spot, q);
    }
    return q;
  }

  /** Where a target is for this body: the scene's place (each a little apart), a free slot about it, the nearest of
   * the story's players, another role's first body, a spot of a kind nearby, or the way out. */
  private target(b: Body, t: Target, players: readonly CastPlayer[]): { x: number; z: number } {
    const s = b.story!;
    const k = s.parts.indexOf(b.part!);
    const at = this.bodies.at(b.pid) ?? { x: s.x, z: s.z };
    if (t === "place") return k === 0 ? { x: s.x, z: s.z } : { x: s.x + Math.sin(k * 2.4) * 1.3, z: s.z + Math.cos(k * 2.4) * 1.3 };
    if (t === "slot") {
      const r = 1.6 * Math.sqrt(k + 1);
      return { x: s.x + Math.sin(k * 2.39996) * r, z: s.z + Math.cos(k * 2.39996) * r };
    }
    if (t === "player") {
      let best: CastPlayer | null = null;
      for (const p of players) if ((s.for.includes(p.name) || s.engaged.includes(p.name)) && (!best || Math.hypot(p.x - at.x, p.z - at.z) < Math.hypot(best.x - at.x, best.z - at.z))) best = p;
      if (!best) return { x: s.x, z: s.z };
      const d = Math.hypot(at.x - best.x, at.z - best.z) || 1;
      return { x: best.x + ((at.x - best.x) / d) * 2.5, z: best.z + ((at.z - best.z) / d) * 2.5 };
    }
    if (t === "out") return this.hidden(at.x, at.z, players) ?? at;
    if ("role" in t) {
      for (const p of s.parts) {
        if (p.role !== t.role || p.pid === undefined) continue;
        const o = this.bodies.at(p.pid);
        if (o) return { x: o.x + 1.2, z: o.z };
      }
      return { x: s.x, z: s.z };
    }
    const spots = this.cast.spots.tagged(s.region, [t.spot]);
    let best = -1, bestD = Infinity;
    for (const i of spots) {
      const sp = this.cast.spots.all[i]!, d = Math.hypot(sp.x - at.x, sp.z - at.z);
      if (d > 8 && d < bestD) (best = i), (bestD = d);
    }
    return best >= 0 ? this.cast.spots.all[best]! : { x: s.x, z: s.z };
  }

  /** Says a line of a kind: the planner's own for this story if it wrote one, else one of the archetype's or the scene's. */
  private speak(b: Body, key: string): boolean {
    const a = this.cast.people.archetype(b.c.archetype)!;
    const sc = b.story ? this.cast.scenes.get(b.story.scene) : undefined;
    const own = b.story?.slots[`line.${key}`];
    const pool = [...(a.lines[key] ?? []), ...(sc?.lines?.[key] ?? [])];
    const text = own ?? pool[this.rng.int(pool.length)];
    if (!text) return false;
    this.bodies.say(b.pid, b.c.name, text);
    this.counts.said++;
    return true;
  }

  // --- Reactions ----------------------------------------------------------------------------------------------------

  private react(b: Body, tick: number, players: readonly StagePlayer[]): void {
    if (tick - b.lastReact < REACT_GAP * this.world.rate || b.aside > tick) return;
    const at = this.bodies.at(b.pid);
    if (!at) return;
    const firstName = b.c.name.split(" ").at(-1)!.toLowerCase();
    for (const p of players) {
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      let on: Stimulus | null = null;
      const talk = this.heard.find((h) => h.speaker === p.name && (Math.hypot(h.x - at.x, h.z - at.z) <= NOTICE_M || h.text.toLowerCase().includes(firstName)));
      if (talk) on = "talk";
      else if (d > NOTICE_M) {
        b.stareSince.delete(p.name);
        continue;
      } else if (p.emote && WAVES.has(p.emote)) on = "wave";
      else {
        const looking = p.yaw !== undefined && Math.abs(angle(p.yaw - Math.atan2(at.x - p.x, at.z - p.z))) < STARE_RAD;
        if (looking) {
          const since = b.stareSince.get(p.name) ?? tick;
          b.stareSince.set(p.name, since);
          if (tick - since >= STARE_S * this.world.rate) on = "stare";
        } else b.stareSince.delete(p.name);
        if (!on && d <= NEAR_M) on = "near";
      }
      if (!on) continue;
      const key = `${p.name}:${on}`;
      if (tick - (b.reacted.get(key) ?? -Infinity) < REACT_AGAIN * this.world.rate) continue;
      b.reacted.set(key, tick);
      if (talk) this.heard.splice(this.heard.indexOf(talk), 1);
      this.respond(b, on, p, tick, at);
      return;
    }
  }

  private respond(b: Body, on: Stimulus, p: StagePlayer, tick: number, at: { x: number; z: number }, urgent = false): void {
    if (urgent) b.lastReact = -Infinity;
    const a = this.cast.people.archetype(b.c.archetype)!;
    const table = this.cat.reactions.find((t) => t.id === a.reactions);
    const row = table?.rows.find((r) => r.on === on && traitsFit(b.c, r.if) && (r.chance === undefined || this.rng.float() < r.chance));
    if (!row) return;
    b.lastReact = tick;
    this.counts.reactions++;
    const s = b.story!;
    // Engaging a person makes it someone: featured, and it remembers the player.
    if (on === "talk" || on === "wave" || on === "stare") {
      const warmth = on === "stare" ? -0.02 : 0.05;
      this.cast.people.met(b.c, p.name, warmth, `${p.name} ${on === "talk" ? "spoke to me" : on === "wave" ? "waved" : "stared"}; I ${describe(row.do)}`, tick);
      if (!s.engaged.includes(p.name)) s.engaged.push(p.name);
      s.importance = Math.min(1, s.importance + 0.1);
      this.cast.engaged(s);
    }
    this.act(b, row.do, row.line, p, tick, at);
  }

  private act(b: Body, r: Response, line: string | undefined, p: StagePlayer, tick: number, at: { x: number; z: number }): void {
    const aside = (s: number) => (b.aside = tick + Math.round(s * this.world.rate));
    switch (r) {
      case "ignore":
        return;
      case "glance":
        this.stand(b);
        this.bodies.face(b.pid, p.x, p.z);
        aside(1.5);
        break;
      case "wave":
        this.stand(b);
        this.bodies.face(b.pid, p.x, p.z);
        this.bodies.emote(b.pid, "wave");
        aside(2.5);
        break;
      case "say":
        this.stand(b);
        this.bodies.face(b.pid, p.x, p.z);
        aside(2);
        break;
      case "step_aside": {
        const dx = at.x - p.x, dz = at.z - p.z, d = Math.hypot(dx, dz) || 1;
        // Out of the player's way, to its side.
        this.bodies.goTo(b.pid, at.x + (-dz / d) * 1.8 + (dx / d) * 0.6, at.z + (dx / d) * 1.8 + (dz / d) * 0.6, PACE.walk);
        aside(2);
        break;
      }
      case "cower":
        this.stand(b);
        this.bodies.emote(b.pid, "cower");
        aside(4);
        break;
      case "fight":
        // Fights back the one who did it, unless the server wants no fights at all; a fight breaks off as a scene's does.
        if (this.cast.settings.hostility >= 1 && p.name && this.bodies.attack(b.pid, { player: p.name })) {
          aside(FIGHT_MOST);
          break;
        }
        this.run(b, tick, p);
        break;
      case "call_cop": {
        // The nearest officer of the stage's comes for whoever did it; the caller runs.
        let cop: Body | null = null, best = COP_M;
        for (const o of this.byPid.values()) {
          if (o === b || o.c.archetype !== "cast:cop") continue;
          const oa = this.bodies.at(o.pid);
          const d = oa ? Math.hypot(oa.x - at.x, oa.z - at.z) : Infinity;
          if (d < best) (cop = o), (best = d);
        }
        if (cop && p.name && this.cast.settings.hostility >= 1 && this.bodies.attack(cop.pid, { player: p.name })) {
          cop.aside = tick + Math.round(FIGHT_MOST * this.world.rate);
          this.cast.people.remember(cop.c, `came when ${b.c.name} called about ${p.name}`, tick, true);
        }
        this.run(b, tick, p);
        break;
      }
      case "flee":
        this.run(b, tick, p);
        break;
    }
    if (line) this.speak(b, line);
  }

  /** Runs from trouble: straight to its script's end, leaving at a run. */
  private run(b: Body, tick: number, p: StagePlayer): void {
    b.part!.step = this.cast.scenes.get(b.story!.scene)!.script[b.part!.role]!.length - 1;
    b.begun = false;
    b.out = false;
    this.leave(b, tick, [p], "run");
  }
}

/** Whether a person's traits meet a row's condition: at least the number, or below it if negative. */
function traitsFit(c: Character, cond?: Partial<Record<string, number>>): boolean {
  if (!cond) return true;
  for (const [k, v] of Object.entries(cond)) {
    const t = c.traits[k as keyof Character["traits"]];
    if (v! >= 0 ? t < v! : t >= -v!) return false;
  }
  return true;
}

function angle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function describe(r: Response): string {
  return { ignore: "ignored them", glance: "looked over", wave: "waved back", step_aside: "stepped aside", say: "answered", flee: "ran", cower: "cowered", fight: "squared up", call_cop: "called the police" }[r];
}
