// The world's sounds for one client, each frame. What is heard is found by the producers, each reading what the client
// already has: creatures.ts (creatures), bodies.ts (survivors' steps, jumps, landings and water), actions.ts (fighting
// and the player's own state), build.ts (building and nodes) and world.ts (beds, shore, wind). Each hands an occasion of
// an owner to `hear`, which finds its sound through the catalogue (resolve.ts, shared/sound/cues.ts). The sounds near
// enough are held (library.ts), each heard one gets a voice or is dropped (mixer.ts), and what the device must do goes
// out as a packet (packet.ts). Only an app with a sound sink makes one of these, so a client without audio does none of it.

import type { CreatureAnim } from "../../../shared/anim/creature.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import { Rng } from "../../../shared/rng.ts";
import { KEYS, type CueKind } from "../../../shared/sound/cues.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { AssetPort } from "../assets/port.ts";
import type { RemoteSample } from "../session.ts";
import { ActionSounds, type OwnState } from "./actions.ts";
import { BodySounds, type OwnBody } from "./bodies.ts";
import { BuildSounds } from "./build.ts";
import { CreatureSounds } from "./creatures.ts";
import { InlineDecoder, SOUND_BUDGET, SOUND_BUDGET_TOUCH, SoundLibrary, type SoundDecoder } from "./library.ts";
import { FLAT, KIND_NAMES, KIND_VOCAL, LOOP, Mixer, spread, type Ear } from "./mixer.ts";
import { SoundPacket, type SoundSink } from "./packet.ts";
import { earAxes, semitones } from "./place.ts";
import { Resolver } from "./resolve.ts";
import { WorldSounds } from "./world.ts";

interface Pending {
  sound: number;
  key: number;
  owner: number;
  kind: number;
  weight: number;
  entity: number;
  x: number;
  y: number;
  z: number;
  lift: number;
  level: number;
  rate: number;
  delay: number;
  flags: number;
}

/** Where the ear is and which way it faces: a camera. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  /** Radians. Yaw 0 faces +Z, and positive pitch looks up. */
  yaw: number;
  pitch: number;
}

/** The volumes the player set: over everything, and of each bus. */
export interface Volumes {
  master: number;
  effects: number;
  ambience: number;
  music: number;
  interface: number;
}

/** What the producers read of the player each frame (view.ts makes it from the session). Null while there is none. */
export interface SoundView {
  ownId: number;
  /** The predicted body, or null while there is no living one. */
  body: OwnBody | null;
  own: OwnState;
  hour: number;
  /** Trees within `r` metres of (x, z), for the beds. */
  trees: (x: number, z: number, r: number) => number;
}

/** What became of an occasion asked for: the sound board and the in-game log read these. */
export const HEARD_PLAYED = 0;
export const HEARD_DROPPED = 1;
export const HEARD_WAITING = 2;
export const HEARD_MISSING = 3;
const HEARD_WORDS = ["played", "dropped", "not held yet", "no sound"];
const LOG_LINES = 20;

/** How much each kind of occasion weighs when voices are short, where its producer does not say. */
const KIND_WEIGHT: Readonly<Record<CueKind, number>> = { vocal: 0.8, step: 0.25, hit: 0.6, weapon: 0.85, build: 0.6, item: 0.4, ui: 1, bed: 1, music: 1 };
/** Milliseconds a looping sound takes to fade in or out. */
const FADE_MS = 1500;

interface Looping {
  owner: number;
  key: number;
  sound: number;
  serial: number;
  level: number;
  target: number;
  x: number;
  y: number;
  z: number;
  flat: boolean;
}

export class Sounds {
  readonly packet = new SoundPacket();
  readonly library: SoundLibrary;
  readonly mixer = new Mixer();
  readonly resolver: Resolver;
  readonly creatures: CreatureSounds;
  readonly bodies = new BodySounds();
  readonly actions: ActionSounds;
  readonly build: BuildSounds;
  readonly world = new WorldSounds();
  /** Plays only the takes made by this (a take's `from`, as "moss"), where a sound has any, or "" for every take. */
  from = "";
  /** The last occasions asked for, newest last: key, owner, sound (-1 for none) and what became of it. */
  readonly log: { key: number; owner: number; sound: number; heard: number }[] = [];
  readonly ui: number;
  readonly survivor: number;
  private readonly isSurvivor: (kind: number) => boolean;
  private readonly ear: Ear = { x: 0, y: 0, z: 0 };
  private readonly rng = new Rng(11);
  /** The take of each sound played last, so the next is another. */
  private readonly last: Int32Array;
  private readonly pending: Pending[] = [];
  private readonly crowd = new Map<number, number>();
  private readonly loops = new Map<number, Looping>();
  private readonly asked: { sound: number; x: number; y: number; z: number; untilMs: number }[] = [];
  private lastMs = -1;
  private readonly emit = (sound: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number): void => {
    this.push({ sound, key: -1, owner: -1, kind, weight, entity, x, y, z, lift, level, rate, delay, flags: 0 });
  };
  private readonly want = (sound: number, metres: number): void => this.library.want(sound, this.library.sounds[sound]!.range / Math.max(1, metres));
  private readonly locate = (entity: number, out: number[]): boolean => {
    const b = this.creatures.bodies.get(entity) ?? this.bodies.walkers.get(entity);
    if (!b) return false;
    out[0] = b.x;
    out[1] = b.y;
    out[2] = b.z;
    return true;
  };
  /** Hears occasion `key` of `owner` (bodies.ts Hear). */
  readonly hear = (owner: number, key: number, entity: number, x: number, y: number, z: number, lift: number, level: number, flat: boolean, delay = 0): void => {
    const s = this.resolver.find(owner, key);
    if (s < 0) {
      this.note(key, owner, -1, HEARD_MISSING);
      return;
    }
    const cue = KEYS[key]!.cue;
    if (!flat) this.want(s, Math.hypot(x - this.ear.x, y - this.ear.y, z - this.ear.z));
    else this.library.want(s, 10);
    this.push({ sound: s, key, owner, kind: KIND_NAMES.indexOf(cue.kind), weight: KIND_WEIGHT[cue.kind], entity, x, y, z, lift, level, rate: this.resolver.rate(owner, key), delay, flags: flat || cue.space === "ear" ? FLAT : 0 });
  };

  /**
   * `animOf` gives what a kind of creature plays, as it is drawn. A touch-first device keeps less sound. `decoder`
   * decodes away from the frame: in the browser, client/sound's worker.
   */
  constructor(manifest: Pick<Manifest, "sounds">, port: AssetPort | null, reg: Registry, animOf: (kind: number) => CreatureAnim | null, touch = false, decoder: SoundDecoder = new InlineDecoder()) {
    this.library = new SoundLibrary(manifest, port, decoder);
    this.library.budget = touch ? SOUND_BUDGET_TOUCH : SOUND_BUDGET;
    this.resolver = new Resolver(this.library.index);
    this.creatures = new CreatureSounds(reg, this.library, this.resolver, animOf);
    this.actions = new ActionSounds(reg);
    this.build = new BuildSounds(reg, (id) => this.resolver.owner(id));
    this.last = new Int32Array(this.library.sounds.length).fill(-1);
    this.ui = this.resolver.owner("core:ui");
    const survivor = reg.defs.find((d) => d?.type === "species" && (d as { class?: string }).class === "survivor");
    this.survivor = this.resolver.owner(survivor?.id ?? "core:survivor");
    this.isSurvivor = (kind) => (reg.defs[kind] as { class?: string } | null)?.class === "survivor" && reg.defs[kind]?.type === "species";
    // The start set: the interface and the player's own body, held from the start so that they are never late.
    for (let s = 0; s < this.library.sounds.length; s++) {
      const id = this.library.sounds[s]!.id;
      if (id.startsWith("core:ui/") || id.startsWith(`${this.resolver.owners[this.survivor]}/`) || id.startsWith("core:surface/sound/step/")) this.library.pin(s);
    }
  }

  /** Copies what the session queued since the last frame, before the hit marks and tracers take it. */
  absorb(events: Parameters<ActionSounds["absorb"]>[0], fired: Parameters<ActionSounds["absorb"]>[1], tamed: number): void {
    this.actions.absorb(events, fired, tamed);
  }

  /** One frame: what everything did is heard by `ear` at `volumes`, and the device is told in one packet. */
  frame(sink: SoundSink, nowMs: number, remote: RemoteSample, hf: Heightfield, ear: Listener, volumes: Volumes, view: SoundView | null = null): void {
    const p = this.packet;
    p.clear();
    const dt = this.lastMs < 0 ? 0 : Math.min(0.25, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    const lib = this.library;
    lib.begin(nowMs, p);
    this.mixer.expire(nowMs);
    this.ear.x = ear.x;
    this.ear.y = ear.y;
    this.ear.z = ear.z;
    earAxes(ear.yaw, ear.pitch, p.ear);
    p.volume = volumes.master;
    p.buses[0] = volumes.effects;
    p.buses[1] = volumes.ambience;
    p.buses[2] = volumes.music;
    p.buses[3] = volumes.interface;
    // What was heard since the last frame (the interface hears between frames) is kept until it is played below.
    for (const l of this.loops.values()) l.target = 0;
    this.creatures.update(remote, hf, ear.x, ear.y, ear.z, this.emit, this.want);
    if (view) {
      this.bodies.update(dt, remote, hf, ear.x, ear.y, ear.z, view.ownId, view.body, view.own.female, this.survivor, this.isSurvivor, this.hear);
      this.actions.update(remote, ear.x, ear.y, ear.z, view.own, view.ownId, this.ui, this.survivor, this.isSurvivor, this.hear, (id, owner, key, level, on) => this.loop(id, owner, key, 0, 0, 0, level, on, true));
      this.world.update(nowMs, hf, ear.x, ear.y, ear.z, view.hour, view.trees, (id, key, level, on) => this.loop(id, this.resolver.owner("core:world"), key, 0, 0, 0, level, on, true), (key) => this.hear(this.resolver.owner("core:world"), key, -1, 0, 0, 0, 0, 1, true));
    }
    this.build.update(ear.x, ear.y, ear.z, this.hear, (id, owner, key, x, y, z, on) => this.loop(1000 + id, owner < 0 ? this.ui : owner, key, x, y, z, 1, on, false));
    for (const a of this.asked) {
      lib.want(a.sound, Infinity);
      if (lib.ready(a.sound)) this.push({ sound: a.sound, key: -1, owner: -1, kind: KIND_VOCAL, weight: 2, entity: -1, x: a.x, y: a.y, z: a.z, lift: 0, level: 1, rate: 1, delay: 0, flags: 0 });
    }
    for (let k = this.asked.length - 1; k >= 0; k--) if (lib.ready(this.asked[k]!.sound) || this.asked[k]!.untilMs < nowMs) this.asked.splice(k, 1);
    // Nothing starts before the device plays, or it would all play at once when it did.
    const running = sink.running && volumes.master > 0;
    for (const e of this.pending) {
      const heard = running ? this.start(e, nowMs) : HEARD_DROPPED;
      if (e.key >= 0) this.note(e.key, e.owner, e.sound, heard);
    }
    this.pending.length = 0;
    this.crowd.clear();
    this.fade(dt, running, nowMs);
    this.mixer.follow(p, this.ear, this.locate);
    lib.end(p);
    sink.apply(p);
  }

  /**
   * Keeps a looping sound `id` playing while it is asked for each frame with `on`, fading in to `level`; one not asked
   * for, or asked for with `on` false, fades out and stops.
   */
  loop(id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean): void {
    let l = this.loops.get(id);
    if (!on) {
      if (l) l.target = 0;
      return;
    }
    const s = this.resolver.peek(owner, key);
    if (s < 0) return;
    this.library.want(s, flat ? 5 : this.library.sounds[s]!.range / Math.max(1, Math.hypot(x - this.ear.x, y - this.ear.y, z - this.ear.z)));
    if (!l || l.sound !== s) {
      if (l && l.serial !== 0) this.mixer.end(l.serial, this.packet);
      this.loops.set(id, (l = { owner, key, sound: s, serial: 0, level: 0, target: level, x, y, z, flat }));
    }
    l.target = Math.max(0.001, level);
    l.x = x;
    l.y = y;
    l.z = z;
  }

  private fade(dt: number, running: boolean, nowMs: number): void {
    const step = (dt * 1000) / FADE_MS;
    for (const [id, l] of this.loops) {
      l.level += Math.max(-step, Math.min(step, l.target - l.level));
      if (l.serial === 0 && l.target > 0 && running && this.library.ready(l.sound)) {
        const sound = this.library.sounds[l.sound]!;
        const take = this.library.first[l.sound]! + this.rng.int(sound.takes.length);
        const kind = KIND_NAMES.indexOf(KEYS[l.key]!.cue.kind);
        l.serial = this.mixer.play(this.packet, this.ear, nowMs, l.sound, take, this.library.seconds[take]!, sound.range, kind, 1, -1, l.x, l.y, l.z, 0, Math.max(0.001, l.level), 1, 0, LOOP | (l.flat ? FLAT : 0));
        if (l.serial !== 0) this.library.played(l.sound);
      } else if (l.serial !== 0) {
        this.library.played(l.sound);
        if (!this.mixer.gain(l.serial, l.level)) l.serial = 0;
      }
      if (l.target === 0 && l.level <= 0.001) {
        if (l.serial !== 0) this.mixer.end(l.serial, this.packet);
        this.loops.delete(id);
      }
    }
  }

  /** Plays a sound at (x, y, z) as soon as it is held, or not at all if that takes more than five seconds. */
  ask(sound: number, x: number, y: number, z: number, nowMs: number): void {
    this.asked.push({ sound, x, y, z, untilMs: nowMs + 5000 });
  }

  /** Hears an occasion of the interface: a click, a panel, a craft. Never placed. */
  hearUi(key: number): void {
    this.hear(this.ui, key, -1, 0, 0, 0, 0, 1, true);
  }

  private push(e: Pending): void {
    this.pending.push(e);
    this.crowd.set(e.sound, (this.crowd.get(e.sound) ?? 0) + 1);
  }

  private note(key: number, owner: number, sound: number, heard: number): void {
    this.log.push({ key, owner, sound, heard });
    if (this.log.length > LOG_LINES) this.log.shift();
  }

  private start(e: Pending, nowMs: number): number {
    const lib = this.library;
    if (!lib.ready(e.sound)) return HEARD_WAITING;
    const sound = lib.sounds[e.sound]!;
    // Another take than last time, of those made by `from` if it has any.
    const takes = sound.takes.map((_, k) => k).filter((k) => this.from === "" || sound.takes[k]!.from === this.from);
    const pool = takes.length > 0 ? takes : sound.takes.map((_, k) => k);
    const others = pool.length > 1 ? pool.filter((k) => k !== this.last[e.sound]) : pool;
    const take = others[this.rng.int(others.length)]!;
    this.last[e.sound] = take;
    const buffer = lib.first[e.sound]! + take;
    const rate = e.rate * semitones(sound.vary * this.rng.range(-1, 1));
    const delay = e.delay + spread(this.rng, this.crowd.get(e.sound) ?? 1);
    const serial = this.mixer.play(this.packet, this.ear, nowMs, e.sound, buffer, lib.seconds[buffer]!, sound.range, e.kind, e.weight, e.entity, e.x, e.y, e.z, e.lift, e.level, rate, delay, e.flags);
    if (serial === 0) return HEARD_DROPPED;
    lib.played(e.sound);
    return HEARD_PLAYED;
  }

  /** The sounds in a line, for a developer's eye. */
  line(): string {
    const m = this.mixer;
    let missing = 0;
    for (const n of this.resolver.missed) missing += n > 0 ? 1 : 0;
    return `${this.library.line()}, ${m.playing} playing, ${this.loops.size} looping, ${m.stats.started} started, ${m.stats.dropped} dropped, ${m.stats.stolen} taken over, ${missing} cues silent`;
  }

  /** The log in lines, newest first: the console's `sound log`. */
  logLines(): string[] {
    return this.log
      .slice()
      .reverse()
      .map((l) => `${KEYS[l.key]!.key} of ${this.resolver.owners[l.owner] ?? "?"}: ${l.sound >= 0 ? this.library.sounds[l.sound]!.id : "-"} (${HEARD_WORDS[l.heard]})`);
  }
}
