// The world's sounds for one client, each frame. What is heard is found by the producers, each reading what the client
// already has: creatures.ts (creatures), bodies.ts (survivors' steps, jumps, landings and water), actions.ts (fighting
// and the player's own state), build.ts (building and nodes) and world.ts (beds, shore, wind). Each hands an occasion of
// an owner to `hear`, which finds its sound through the catalogue (resolve.ts, shared/sound/cues.ts). The sounds near
// enough are held (library.ts), each heard one gets a voice or is dropped (mixer.ts), and what the device must do goes
// out as a packet (packet.ts). Only an app with a sound sink makes one of these, so a client without audio does none of it.

import type { Corpse } from "../ragdoll.ts";
import type { CreatureAnim } from "../../../shared/anim/creature.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { DetailSheet } from "../../../shared/pack/details.ts";
import { Rng } from "../../../shared/rng.ts";
import { KEYS, vehicleFamilies, type CueKind } from "../../../shared/sound/cues.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { AssetPort } from "../assets/port.ts";
import type { RemoteSample } from "../session.ts";
import { ActionSounds, type OwnState } from "./actions.ts";
import { BodySounds, type Hear, type OwnBody } from "./bodies.ts";
import { BuildSounds, type Lit } from "./build.ts";
import { CreatureSounds } from "./creatures.ts";
import { InlineDecoder, SoundLibrary, type SoundDecoder } from "./library.ts";
import { FLAT, KIND_NAMES, KIND_STEP, KIND_VOCAL, LOOP, Mixer, spread, type Ear } from "./mixer.ts";
import { SoundPacket, type SoundSink } from "./packet.ts";
import { earAxes, semitones } from "./place.ts";
import { MusicDirector, type MusicState, type MusicTrack } from "./music.ts";
import { paved } from "./ground.ts";
import { V_HEALTH } from "../../../shared/sim/vitals.ts";
import { Resolver } from "./resolve.ts";
import { VehicleSounds } from "./vehicles.ts";
import { WorldSounds } from "./world.ts";
import type { AirSupportView } from "../../../shared/sim/air-support.ts";
import { AirSounds } from "./air-support.ts";
import { SupplySounds } from "./supply.ts";
import { OrbSounds } from "./orb.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { ZONE_NONE } from "../../../shared/anim/human.ts";
import { EVENT_HIT } from "../../../shared/net/protocol.ts";
import type { SupplyList } from "../../../shared/sim/supply.ts";
import type { OrbSite } from "../../../shared/world/orb.ts";

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
  /** The hour moved since the last frame by a setting or a turn of the sundial, not by the clock. */
  turned?: boolean;
  /** Trees within `r` metres of (x, z), for the beds. */
  trees: (x: number, z: number, r: number) => number;
  /** The structures that burn near (x, z), for their crackle. */
  lit?: Lit;
  /** The vehicle the player sits in, or -1. */
  vehicle?: number;
  /** The supply drops the session is told of, and the tick they are heard at (supply.ts). */
  airSupport?: AirSupportView;
  supply?: { list: SupplyList; tick: number };
  /** The map's orbs, for their hum (orb.ts). */
  orbs?: readonly OrbSite[];
}

/** A looping sound kept playing while it is asked for each frame (Sounds.loop), by its owner's number. */
export type OwnedLoop = (id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean) => void;

/** What a late file hears each frame after the rest (mapevent-late.ts): given the ear, owners' numbers by id, hear and loop. */
export interface SoundProducer {
  update(ear: Readonly<Ear>, owner: (id: string) => number, hear: Hear, loop: OwnedLoop): void;
}

/** What became of an occasion asked for: the sound board and the in-game log read these. */
export const HEARD_PLAYED = 0;
export const HEARD_DROPPED = 1;
export const HEARD_WAITING = 2;
export const HEARD_MISSING = 3;
const HEARD_WORDS = ["played", "dropped", "not held yet", "no sound"];
const LOG_LINES = 20;

/** How much each kind of occasion weighs when voices are short, where its producer does not say. */
const KIND_WEIGHT: Readonly<Record<CueKind, number>> = { vocal: 0.8, step: 0.25, hit: 0.6, weapon: 0.85, build: 0.6, item: 0.4, ui: 1, bed: 1, music: 1, vehicle: 0.75 };
/** Semitones a body's own voice sits above or below its kind's, by its id, at most; its steps and blows a third of that. */
const VOICE_SPREAD = 1.2;
/** dB a play may be louder or quieter than its sound, at random. */
const LEVEL_JITTER = 1.5;
/** Of one sound, at most this many start within CROWD_MS; more are dropped (steps more, being many and short). */
const CROWD_STARTS = 3;
const CROWD_STEP_STARTS = 6;
const CROWD_MS = 250;
/** Milliseconds a looping sound takes to fade in or out. */
const FADE_MS = 1500;
/** What is wanted ahead of time (the start set, the music, what the hand and a near vehicle may make) waits until the asset library has nothing coming, or this long after the first frame. */
const AHEAD_MS = 5000;

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
  /** Milliseconds it takes to fade in or out. */
  fade: number;
}

export class Sounds {
  readonly packet = new SoundPacket();
  /** Each bus's volume this frame, in bus order. */
  private readonly busLevels = [0, 0, 0, 0];
  readonly library: SoundLibrary;
  readonly mixer = new Mixer();
  readonly resolver: Resolver;
  readonly creatures: CreatureSounds;
  readonly bodies = new BodySounds();
  readonly actions: ActionSounds;
  readonly build: BuildSounds;
  readonly world = new WorldSounds();
  readonly vehicles: VehicleSounds;
  /** The music director, once the build's music.json has come (setMusic); null for none. */
  music: MusicDirector | null = null;
  private readonly musicState: MusicState = { alive: false, place: "grass", night: false, hunters: 0, chasers: 0, apex: false, sinceHurt: Infinity, sinceFight: Infinity, health: 1, home: false };
  /** Plays only the takes made by this (a take's `from`, as "moss"), where a sound has any, or "" for every take. */
  from = "";
  /** The last occasions asked for, newest last: key, owner, sound (-1 for none) and what became of it. */
  readonly log: { key: number; owner: number; sound: number; heard: number }[] = [];
  readonly ui: number;
  readonly survivor: number;
  private readonly isSurvivor: (kind: number) => boolean;
  private readonly ear: Ear = { x: 0, y: 0, z: 0 };
  private readonly rng = new Rng(11);
  /** The last two takes of each sound played, so the next is another. */
  private readonly lastTakes = new Map<number, number[]>();
  /** When each sound last started, for the crowd's limit. */
  private readonly started = new Map<number, number[]>();
  private readonly pending: Pending[] = [];
  private readonly crowd = new Map<number, number>();
  private readonly loops = new Map<number, Looping>();
  /** What the supply drops are heard by, and the capsule's number among the owners. */
  private readonly airLoop = (id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean, fadeMs?: number): void => this.loop(id, owner, key, x, y, z, level, on, flat, fadeMs);
  private readonly airSounds = new AirSounds();
  private readonly helicopter: number;
  private readonly supply = new SupplySounds();
  private readonly capsule: number;
  private readonly orbs = new OrbSounds();
  private readonly orb: number;
  /** What late files add to be heard each frame (SoundProducer). */
  readonly producers: SoundProducer[] = [];
  private readonly ownerOf = (id: string): number => this.resolver.owner(id);
  private readonly asked: { sound: number; x: number; y: number; z: number; untilMs: number }[] = [];
  private lastMs = -1;
  private firstMs = -1;
  /** Whether the asset library has nothing coming, as the app sets it each frame; without one, nothing is. */
  assetsIdle = true;
  private early = true;
  /** The start set: the interface, the player's own body but its voice, and the shared steps. */
  private readonly startSet: number[] = [];
  private pinnedSex = "";
  private yaw = NaN;
  private pitch = NaN;
  private readonly emit = (sound: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number): void => {
    this.push({ sound, key: -1, owner: -1, kind, weight, entity, x, y, z, lift, level, rate, delay, flags: 0 });
  };
  private readonly want = (sound: number, metres: number): void => this.library.want(sound, this.library.sounds[sound]!.range / Math.max(1, metres));
  /** Wants what `owner` makes for `key` before it is heard, once nothing else waits for the network; from afar, least urgently. */
  private readonly ahead = (owner: number, key: number, metres = Infinity): void => {
    const s = this.early ? -1 : this.resolver.peek(owner, key);
    if (s >= 0) this.want(s, metres);
  };
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
   * `animOf` gives what a kind of creature plays, as it is drawn. `decoder` decodes away from the frame: in the browser,
   * client/sound's worker.
   */
  constructor(manifest: Pick<Manifest, "sounds">, port: AssetPort | null, reg: Registry, animOf: (kind: number) => CreatureAnim | null, decoder: SoundDecoder = new InlineDecoder(), sheets: readonly DetailSheet[] = []) {
    this.library = new SoundLibrary(manifest, port, decoder);
    // A vehicle falls back to its family's sounds (a helicopter's, a boat's) before the shared car's, whoever asks first.
    this.resolver = new Resolver(this.library.index, (id) => {
      const kind = reg.index.get(id);
      const d = kind !== undefined && reg.vehicle[kind] ? reg.defs[kind] : null;
      return d ? vehicleFamilies(id, "aliases" in d ? (d.aliases ?? []) : []) : [];
    });
    this.creatures = new CreatureSounds(reg, this.library, this.resolver, animOf, sheets);
    this.actions = new ActionSounds(reg, (id) => this.resolver.owner(id));
    this.build = new BuildSounds(reg, (id) => this.resolver.owner(id));
    this.vehicles = new VehicleSounds(reg, (id) => this.resolver.owner(id));
    this.ui = this.resolver.owner("core:ui");
    this.helicopter = this.resolver.owner("core:helicopter");
    this.capsule = this.resolver.owner("core:supply_capsule");
    this.orb = this.resolver.owner("core:orb");
    const survivor = reg.defs.find((d) => d?.type === "species" && (d as { class?: string }).class === "survivor");
    this.survivor = this.resolver.owner(survivor?.id ?? "core:survivor");
    this.isSurvivor = (kind) => (reg.defs[kind] as { class?: string } | null)?.class === "survivor" && reg.defs[kind]?.type === "species";
    // Held so that they are never late, with the voice of the player's own sex (pinVoice).
    const own = `${this.resolver.owners[this.survivor]}/sound/`;
    for (let s = 0; s < this.library.sounds.length; s++) {
      const id = this.library.sounds[s]!.id;
      if (!id.startsWith(`${own}voice/`) && (id.startsWith("core:ui/") || id.startsWith(own) || id.startsWith("core:surface/sound/step/"))) this.startSet.push(s);
    }
  }

  /** Holds the voice of the player's own sex once it is known. */
  private pinVoice(female: boolean): void {
    const sex = female ? "female" : "male";
    if (sex === this.pinnedSex) return;
    this.pinnedSex = sex;
    const voice = `${this.resolver.owners[this.survivor]}/sound/voice/${sex}/`;
    for (let s = 0; s < this.library.sounds.length; s++) if (this.library.sounds[s]!.id.startsWith(voice)) this.library.pin(s);
  }

  /** Copies what the session queued since the last frame, before the hit marks and tracers take it. */
  absorb(events: Parameters<ActionSounds["absorb"]>[0], fired: Parameters<ActionSounds["absorb"]>[1], tamed: number): void {
    this.actions.absorb(events, fired, tamed);
    for (const e of events) if (e.kind === EVENT_HIT && e.zone === ZONE_NONE && !e.kill && e.struck) this.build.struck(e.struck, e.x, e.y, e.z, e.damage);
  }

  /** One frame: what everything did is heard by `ear` at `volumes`, and the device is told in one packet. */
  frame(sink: SoundSink, nowMs: number, remote: RemoteSample, hf: Heightfield, ear: Listener, volumes: Volumes, view: SoundView | null = null, corpses?: readonly Corpse[]): void {
    const p = this.packet;
    p.clear();
    const dt = this.lastMs < 0 ? 0 : Math.min(0.25, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    if (this.firstMs < 0) this.firstMs = nowMs;
    const lib = this.library;
    if (this.early && (this.assetsIdle || nowMs - this.firstMs >= AHEAD_MS)) {
      this.early = false;
      for (const s of this.startSet) lib.pin(s);
    }
    lib.begin(nowMs, p);
    // What was heard between frames (a click) is wanted again: begin forgets the last frame's wants.
    for (const e of this.pending) lib.want(e.sound, 10);
    this.mixer.expire(nowMs);
    this.ear.x = ear.x;
    this.ear.y = ear.y;
    this.ear.z = ear.z;
    p.turned = ear.yaw !== this.yaw || ear.pitch !== this.pitch;
    this.yaw = ear.yaw;
    this.pitch = ear.pitch;
    earAxes(ear.yaw, ear.pitch, p.ear);
    const buses = this.busLevels;
    buses[0] = volumes.effects;
    buses[1] = volumes.ambience;
    buses[2] = volumes.music;
    buses[3] = volumes.interface;
    p.mix(volumes.master, buses);
    // What was heard since the last frame (the interface hears between frames) is kept until it is played below.
    for (const l of this.loops.values()) l.target = 0;
    this.creatures.update(remote, hf, ear.x, ear.y, ear.z, this.emit, this.want, corpses);
    this.vehicles.update(remote, hf, ear.x, ear.y, ear.z, view?.vehicle ?? -1, this.hear, (id, owner, key, x, y, z, level, on, flat) => this.loop(id, owner, key, x, y, z, level, on, flat), this.ahead);
    if (view) {
      if (!this.early) this.pinVoice(view.own.female);
      if (view.own.alive) this.actions.ahead(view.own, this.ui, this.survivor, this.ahead);
      this.bodies.update(dt, remote, hf, ear.x, ear.y, ear.z, view.ownId, view.body, view.own.female, this.survivor, this.isSurvivor, this.hear);
      this.actions.update(remote, ear.x, ear.y, ear.z, view.own, view.ownId, this.ui, this.survivor, this.isSurvivor, this.hear, (id, owner, key, level, on) => this.loop(id, owner, key, 0, 0, 0, level, on, true), this.airLoop);
      this.world.update(nowMs, hf, ear.x, ear.y, ear.z, view.hour, view.trees, (id, key, level, on) => this.loop(id, this.resolver.owner("core:world"), key, 0, 0, 0, level, on, true), (key) => this.hear(this.resolver.owner("core:world"), key, -1, 0, 0, 0, 0, 1, true), view.turned ?? false, view.body && view.body.glide !== 0 ? Math.hypot(view.body.vx, view.body.vy, view.body.vz) : 0);
    }
    if (view?.airSupport) this.airSounds.update(view.airSupport, this.helicopter, this.capsule, this.hear, this.airLoop, ear);
    if (view?.supply) this.supply.update(view.supply.list, view.supply.tick, TICK_RATE, ear.x, ear.y, ear.z, this.capsule, this.hear, (id, key, x, y, z, level, on) => this.loop(id, this.capsule, key, x, y, z, level, on, false));
    this.orbs.update(view?.orbs, ear.x, ear.y, ear.z, (id, key, x, y, z, level, on) => this.loop(id, this.orb, key, x, y, z, level, on, false));
    for (let i = 0; i < this.producers.length; i++) this.producers[i]!.update(this.ear, this.ownerOf, this.hear, this.airLoop);
    this.actions.nowMs = nowMs;
    this.build.update(ear.x, ear.y, ear.z, this.hear, (id, owner, key, x, y, z, on) => this.loop(1000 + id, owner < 0 ? this.ui : owner, key, x, y, z, 1, on, false), view?.lit ?? null);
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
    // Music that would not be heard (muted, or its volume at nothing) is not streamed, and its director waits.
    p.music = this.music && view && !this.early && volumes.master > 0 && volumes.music > 0 ? this.music.update(nowMs, this.hearing(view, hf, ear, nowMs)) : null;
    this.mixer.follow(p, this.ear, this.locate);
    lib.end(p);
    sink.apply(p);
  }

  /**
   * Keeps a looping sound `id` playing while it is asked for each frame with `on`, fading in to `level`; one not asked
   * for, or asked for with `on` false, fades out and stops. `fadeMs` is how long its fades take, for one that must be quick.
   */
  loop(id: number, owner: number, key: number, x: number, y: number, z: number, level: number, on: boolean, flat: boolean, fadeMs = FADE_MS): void {
    let l = this.loops.get(id);
    if (!on) {
      if (l) l.target = 0;
      return;
    }
    const s = this.resolver.peek(owner, key);
    if (s < 0) return;
    const d = flat ? 0 : Math.hypot(x - this.ear.x, y - this.ear.y, z - this.ear.z);
    // Past its range it is not heard, so it is not held either.
    if (d >= this.library.sounds[s]!.range) {
      if (l) l.target = 0;
      return;
    }
    this.library.want(s, flat ? 5 : this.library.sounds[s]!.range / Math.max(1, d));
    if (!l || l.sound !== s) {
      if (l && l.serial !== 0) this.mixer.end(l.serial, this.packet);
      this.loops.set(id, (l = { owner, key, sound: s, serial: 0, level: 0, target: level, x, y, z, flat, fade: fadeMs }));
    }
    l.target = Math.max(0.001, level);
    l.x = x;
    l.y = y;
    l.z = z;
  }

  private fade(dt: number, running: boolean, nowMs: number): void {
    for (const [id, l] of this.loops) {
      const step = (dt * 1000) / l.fade;
      l.level += Math.max(-step, Math.min(step, l.target - l.level));
      if (l.serial === 0 && l.target > 0 && running && this.library.ready(l.sound)) {
        const sound = this.library.sounds[l.sound]!;
        const take = this.library.first[l.sound]! + this.rng.int(this.library.takes(l.sound));
        const kind = KIND_NAMES.indexOf(KEYS[l.key]!.cue.kind);
        l.serial = this.mixer.play(this.packet, this.ear, nowMs, l.sound, take, this.library.seconds[take]!, sound.range, kind, 1, -1, l.x, l.y, l.z, 0, Math.max(0.001, l.level), this.resolver.rate(l.owner, l.key), 0, LOOP | (l.flat ? FLAT : 0));
        if (l.serial !== 0) this.library.played(l.sound);
      } else if (l.serial !== 0) {
        this.library.played(l.sound);
        if (!this.mixer.gain(l.serial, l.level, l)) l.serial = 0;
      }
      if (l.target === 0 && l.level <= 0.001) {
        if (l.serial !== 0) this.mixer.end(l.serial, this.packet);
        this.loops.delete(id);
      }
    }
  }

  /**
   * Stops every voice and every loop at once: the world is gone, as when the session closes. The volume falls silent with
   * them, so the world's sounds rise from silence when it comes back.
   */
  hush(sink: SoundSink): void {
    if (this.loops.size === 0 && this.mixer.playing === 0) return;
    const p = this.packet;
    p.clear();
    this.mixer.silence(p);
    p.fallSilent();
    this.loops.clear();
    this.pending.length = 0;
    sink.apply(p);
  }

  /** Starts the music director on the tracks the build lists. */
  setMusic(tracks: readonly MusicTrack[]): void {
    this.music = new MusicDirector(tracks, new Rng(23));
  }

  /** What the player is going through, for the music, from what the producers saw this frame. */
  private hearing(view: SoundView, hf: Heightfield, ear: Listener, nowMs: number): MusicState {
    const m = this.musicState;
    const w = this.world;
    m.alive = view.own.alive;
    m.place = w.under ? "under" : w.openSea ? "sea" : paved(hf, ear.x, ear.z) ? "ruins" : (["beach", "jungle", "grass"] as const)[w.biome] ?? "grass";
    m.night = w.night;
    m.hunters = this.creatures.hunters;
    m.chasers = this.creatures.chasers;
    m.apex = this.creatures.apex;
    m.sinceHurt = (nowMs - this.actions.hurtAtMs) / 1000;
    m.sinceFight = (nowMs - this.actions.fightAtMs) / 1000;
    const v = view.own.vitals;
    m.health = v ? v.at(V_HEALTH, view.own.tick) / (v.max[V_HEALTH] || 1) : 1;
    m.home = this.build.fireNear;
    return m;
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
    // Each body has a voice of its own: two raptors calling together are two raptors, not one twice.
    if (e.entity >= 0) e.rate *= semitones(voiceOf(e.entity) * (e.kind === KIND_VOCAL ? VOICE_SPREAD : VOICE_SPREAD / 3));
    this.pending.push(e);
    this.crowd.set(e.sound, (this.crowd.get(e.sound) ?? 0) + 1);
  }

  private note(key: number, owner: number, sound: number, heard: number): void {
    this.log.push({ key, owner, sound, heard });
    if (this.log.length > LOG_LINES) this.log.shift();
  }

  private start(e: Pending, nowMs: number): number {
    const lib = this.library;
    const held = lib.takes(e.sound);
    if (held === 0) return HEARD_WAITING;
    const sound = lib.sounds[e.sound]!;
    // A crowd is not a chorus: of one sound, only a few start together.
    const recent = (this.started.get(e.sound) ?? []).filter((ms) => nowMs - ms < CROWD_MS);
    if (recent.length >= (e.kind === KIND_STEP ? CROWD_STEP_STARTS : CROWD_STARTS)) return HEARD_DROPPED;
    // A take neither playing now nor among the last two, of those held and made by `from` if it has any.
    const all = Array.from({ length: held }, (_, k) => k);
    const takes = all.filter((k) => this.from === "" || sound.takes[k]!.from === this.from);
    const pool = takes.length > 0 ? takes : all;
    const first = lib.first[e.sound]!;
    const last = this.lastTakes.get(e.sound) ?? [];
    const free = pool.filter((k) => !this.mixer.playingTake(first + k));
    const unheld = this.from !== "" && takes.length === 0 && sound.takes.some((t) => t.from === this.from);
    // No take plays twice at once, and no other maker's stands in for `from`'s, while the sound has more to hold.
    if ((free.length === 0 || unheld) && held < sound.takes.length) {
      lib.grow(e.sound);
      return HEARD_WAITING;
    }
    let others = free.filter((k) => !last.includes(k));
    if (others.length === 0) others = pool.filter((k) => k !== last[0]);
    if (others.length === 0) others = pool;
    const take = others[this.rng.int(others.length)]!;
    this.lastTakes.set(e.sound, [take, last[0] ?? -1]);
    const buffer = first + take;
    const rate = e.rate * semitones(sound.vary * this.rng.range(-1, 1));
    const level = e.level * 10 ** (this.rng.range(-LEVEL_JITTER, LEVEL_JITTER) / 20);
    const delay = e.delay + spread(this.rng, this.crowd.get(e.sound) ?? 1);
    const serial = this.mixer.play(this.packet, this.ear, nowMs, e.sound, buffer, lib.seconds[buffer]!, sound.range, e.kind, e.weight, e.entity, e.x, e.y, e.z, e.lift, level, rate, delay, e.flags);
    if (serial === 0) return HEARD_DROPPED;
    recent.push(nowMs);
    this.started.set(e.sound, recent);
    lib.played(e.sound);
    lib.grow(e.sound);
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

/** A body's own voice, from its id: a fixed number from -1 to 1 that stays with it. */
export function voiceOf(entity: number): number {
  let h = (entity + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x80000000 - 1;
}
