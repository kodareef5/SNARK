// The world's sounds for one client, each frame: what is heard is found (creatures.ts), the sounds near enough are
// held (library.ts), each heard one gets a voice or is dropped (mixer.ts), and what the device must do goes out as a
// packet (packet.ts). Only an app with a sound sink makes one of these, so a client without audio does none of it.

import type { CreatureAnim } from "../../../shared/anim/creature.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import { Rng } from "../../../shared/rng.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { AssetPort } from "../assets/port.ts";
import type { RemoteSample } from "../session.ts";
import { CreatureSounds } from "./creatures.ts";
import { SOUND_BUDGET, SOUND_BUDGET_TOUCH, SoundLibrary } from "./library.ts";
import { KIND_VOCAL, Mixer, spread, type Ear } from "./mixer.ts";
import { SoundPacket, type SoundSink } from "./packet.ts";
import { earAxes, semitones } from "./place.ts";

interface Pending {
  sound: number;
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

export class Sounds {
  readonly packet = new SoundPacket();
  readonly library: SoundLibrary;
  readonly mixer = new Mixer();
  readonly creatures: CreatureSounds;
  /** Plays only the takes made by this (a take's `from`, as "moss"), where a sound has any, or "" for every take. */
  from = "";
  private readonly ear: Ear = { x: 0, y: 0, z: 0 };
  private readonly rng = new Rng(11);
  /** The take of each sound played last, so the next is another. */
  private readonly last: Int32Array;
  private readonly pending: Pending[] = [];
  private readonly crowd = new Map<number, number>();
  private readonly asked: { sound: number; x: number; y: number; z: number; untilMs: number }[] = [];
  private readonly emit = (sound: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number): void => {
    this.pending.push({ sound, kind, weight, entity, x, y, z, lift, level, rate, delay });
    this.crowd.set(sound, (this.crowd.get(sound) ?? 0) + 1);
  };
  private readonly want = (sound: number, metres: number): void => this.library.want(sound, this.library.sounds[sound]!.range / Math.max(1, metres));
  private readonly locate = (entity: number, out: number[]): boolean => {
    const b = this.creatures.bodies.get(entity);
    if (!b) return false;
    out[0] = b.x;
    out[1] = b.y;
    out[2] = b.z;
    return true;
  };

  /** `animOf` gives what a kind of creature plays, as it is drawn. A touch-first device keeps less sound. */
  constructor(manifest: Pick<Manifest, "sounds">, port: AssetPort | null, reg: Registry, animOf: (kind: number) => CreatureAnim | null, touch = false) {
    this.library = new SoundLibrary(manifest, port);
    this.library.budget = touch ? SOUND_BUDGET_TOUCH : SOUND_BUDGET;
    this.creatures = new CreatureSounds(reg, this.library, animOf);
    this.last = new Int32Array(this.library.sounds.length).fill(-1);
  }

  /** One frame: what the bodies of `remote` did is heard by `ear` at `volume`, and the device is told in one packet. */
  frame(sink: SoundSink, nowMs: number, remote: RemoteSample, hf: Heightfield, ear: Listener, volume: number): void {
    const p = this.packet;
    p.clear();
    const lib = this.library;
    lib.begin(nowMs, p);
    this.mixer.expire(nowMs);
    this.ear.x = ear.x;
    this.ear.y = ear.y;
    this.ear.z = ear.z;
    earAxes(ear.yaw, ear.pitch, p.ear);
    p.volume = volume;
    this.pending.length = 0;
    this.crowd.clear();
    this.creatures.update(remote, hf, ear.x, ear.y, ear.z, this.emit, this.want);
    for (const a of this.asked) {
      lib.want(a.sound, Infinity);
      if (lib.ready(a.sound)) this.pending.push({ sound: a.sound, kind: KIND_VOCAL, weight: 2, entity: -1, x: a.x, y: a.y, z: a.z, lift: 0, level: 1, rate: 1, delay: 0 });
    }
    for (let k = this.asked.length - 1; k >= 0; k--) if (lib.ready(this.asked[k]!.sound) || this.asked[k]!.untilMs < nowMs) this.asked.splice(k, 1);
    // Nothing starts before the device plays, or it would all play at once when it did.
    if (sink.running && volume > 0) for (const e of this.pending) this.start(e, nowMs);
    this.mixer.follow(p, this.ear, this.locate);
    lib.end(p);
    sink.apply(p);
  }

  /** Plays a sound at (x, y, z) as soon as it is held, or not at all if that takes more than five seconds. */
  ask(sound: number, x: number, y: number, z: number, nowMs: number): void {
    this.asked.push({ sound, x, y, z, untilMs: nowMs + 5000 });
  }

  private start(e: Pending, nowMs: number): boolean {
    const lib = this.library;
    if (!lib.ready(e.sound)) return false;
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
    const ok = this.mixer.play(this.packet, this.ear, nowMs, e.sound, buffer, lib.seconds[buffer]!, sound.range, e.kind, e.weight, e.entity, e.x, e.y, e.z, e.lift, e.level, rate, delay);
    if (ok) lib.played(e.sound);
    return ok;
  }

  /** The sounds in a line, for a developer's eye. */
  line(): string {
    const m = this.mixer;
    return `${this.library.line()}, ${m.playing} playing, ${m.stats.started} started, ${m.stats.dropped} dropped, ${m.stats.stolen} taken over`;
  }

}
