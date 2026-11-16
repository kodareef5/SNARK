// The music director: which track plays and which of its layers is heard, from what the player is going through. A
// track is two minutes of one piece in layers by intensity (calm, tense, combat, climax: tools/sound/music.py), all
// keeping one set of bars, so the director moves between layers on a bar line and the piece goes on. The track follows
// the place, the hour and the danger; the layer follows how near the danger is and how the player fares. When nothing
// threatens, a track plays a pass and the music rests a while, as ARK's does. client/sound plays what this decides,
// streaming each layer and fading as told.

import type { Rng } from "../../../shared/rng.ts";

/** A track as music.json lists it (tools/sound/music_export.py). */
export interface MusicTrack {
  id: string;
  bpm: number;
  seconds: number;
  /** Its layers from calmest to most intense, by name. */
  layers: readonly string[];
  /** Played once and not looped: a death, a theme. */
  once?: boolean;
}

/** What the player is going through, as the producers see it each frame. */
export interface MusicState {
  alive: boolean;
  /** The place the beds were chosen for (world.ts), and whether it is night. */
  place: "beach" | "jungle" | "grass" | "sea" | "under" | "ruins";
  night: boolean;
  /** Hunters within sight that move, and those running at the ear: how many. A big hunter (an apex) counts apart. */
  hunters: number;
  chasers: number;
  apex: boolean;
  /** Seconds since the player was last hurt or last struck something; Infinity for never. */
  sinceHurt: number;
  sinceFight: number;
  /** Health as a share of its most. */
  health: number;
  /** A lit fire of the player's camp within reach. */
  home: boolean;
}

/** What client/sound should play: a track and each of its layers' gain (0 to 1), faded over `fade` seconds. */
export class MusicPlan {
  track = "";
  /** Its layers' names, as their files are named (assets/music/<track>/<layer>.opus), and each one's gain. */
  layers: readonly string[] = [];
  readonly gains: number[] = [];
  fade = 2;
  /** Whether the track loops. */
  loop = true;
}

/** Danger thresholds of the layers above calm, and how long danger must be gone before the music steps down one. */
const TENSE = 1;
const COMBAT = 2;
const CLIMAX = 3;
const STEP_DOWN_S = 12;
/** Seconds the music rests between calm passes, at random within these. */
const REST: readonly [number, number] = [60, 150];
/** The intensity each layer stands for, by name; a layer named otherwise (a theme, a lament) stands for its place. */
const LEVEL_OF: Readonly<Record<string, number>> = { calm: 0, tense: 1, combat: 2, climax: 3 };

/** The layer of `t` for intensity `level`: the most intense of its layers not above it, or its first. */
export function layerFor(t: MusicTrack, level: number): number {
  let best = 0;
  t.layers.forEach((name, k) => {
    if ((LEVEL_OF[name] ?? k) <= level) best = k;
  });
  return best;
}

/** Seconds a fight or a wound keeps the music up. */
const FIGHT_S = 8;
/** Seconds two tracks take to cross. */
const CROSS_S = 4;

export class MusicDirector {
  readonly tracks: ReadonlyMap<string, MusicTrack>;
  readonly plan = new MusicPlan();
  private readonly rng: Rng;
  /** The track playing, when it began (ms), its layer now, and the layer the music is moving to. */
  private track: MusicTrack | null = null;
  private startMs = 0;
  private layer = 0;
  private want = 0;
  private calmSinceMs = 0;
  /** While resting, when the music may start again. */
  private restUntilMs = 0;
  private wasAlive = false;
  private greeted = false;

  constructor(tracks: readonly MusicTrack[], rng: Rng) {
    this.tracks = new Map(tracks.map((t) => [t.id, t]));
    this.rng = rng;
  }

  /** How intense things are, 0 (calm) to 3 (climax). */
  static intensity(s: MusicState): number {
    const fighting = s.sinceHurt < FIGHT_S || s.sinceFight < FIGHT_S;
    let level = s.hunters > 0 ? TENSE : 0;
    if (s.chasers > 0 || fighting) level = COMBAT;
    if (level === COMBAT && (s.health < 0.3 || (s.apex && s.chasers > 0))) level = CLIMAX;
    return level;
  }

  /** The track for what the player is going through, or "" for none. */
  choose(s: MusicState, level: number): string {
    const has = (id: string): string => (this.tracks.has(id) ? id : "");
    if (!s.alive) return has("last_breath");
    if (s.place === "under") return has("deep");
    if (level >= TENSE && s.apex) return has("apex") || has("dread");
    if (s.chasers > 0) return has("hunted") || has("dread");
    if (level >= TENSE) return s.night ? has("nightfall") || has("dread") : s.place === "ruins" ? has("ruins") || has("dread") : has("dread");
    if (s.home) return has("hearth");
    if (s.night) return has("nightfall");
    if (s.place === "beach" || s.place === "sea") return has("shoreline") || has("primeval");
    if (s.place === "ruins") return has("ruins");
    return has("primeval");
  }

  update(nowMs: number, s: MusicState): MusicPlan {
    const level = MusicDirector.intensity(s);
    // The theme greets the player once, as they first come to life; a death is mourned once.
    if (s.alive && !this.wasAlive && !this.greeted && this.tracks.has("dawn")) {
      this.greeted = true;
      this.begin("dawn", nowMs, 0);
    } else if (!s.alive && this.wasAlive && this.tracks.has("last_breath")) this.begin("last_breath", nowMs, 0);
    this.wasAlive = s.alive;
    let t = this.track;
    const passed = t !== null && nowMs - this.startMs >= t.seconds * 1000;
    if (t?.once) {
      // The greeting gives way to danger; a lament plays to its end.
      if (!passed && !(level > 0 && s.alive)) return this.fill();
      this.rest(nowMs);
      t = null;
    }
    if (level > 0) this.restUntilMs = 0;
    const id = s.alive ? this.choose(s, level) : "";
    if (id === "") return this.silence();
    if (!t) {
      if (level === 0 && nowMs < this.restUntilMs) return this.silence();
      this.begin(id, nowMs, level);
    } else if (t.id !== id && (level > 0 || passed)) {
      // Danger changes the track at once; calm lets a pass end first.
      if (level === 0) {
        this.rest(nowMs);
        return this.silence();
      }
      this.begin(id, nowMs, level);
    } else if (level === 0 && passed && this.want === 0) {
      this.rest(nowMs);
      return this.silence();
    }
    // The layer rises at once to what danger asks and steps down one at a time; either way it changes on a bar line.
    const asked = layerFor(this.track!, level);
    if (asked >= this.want) {
      this.want = asked;
      this.calmSinceMs = nowMs;
    } else if (nowMs - this.calmSinceMs > STEP_DOWN_S * 1000) {
      this.want--;
      this.calmSinceMs = nowMs;
    }
    if (this.want !== this.layer && this.onBar(nowMs)) this.layer = this.want;
    return this.fill();
  }

  private rest(nowMs: number): void {
    this.restUntilMs = nowMs + this.rng.range(REST[0], REST[1]) * 1000;
  }

  /** Whether `nowMs` is within a frame of a bar line of the track playing. */
  private onBar(nowMs: number): boolean {
    const t = this.track;
    if (!t) return true;
    const bar = (4 * 60) / t.bpm;
    const into = ((nowMs - this.startMs) / 1000) % bar;
    return into < 0.06 || bar - into < 0.01;
  }

  private begin(id: string, nowMs: number, level: number): void {
    const t = this.tracks.get(id) ?? null;
    this.track = t;
    this.startMs = nowMs;
    this.calmSinceMs = nowMs;
    this.layer = this.want = t ? layerFor(t, level) : 0;
  }

  private fill(): MusicPlan {
    const plan = this.plan;
    const t = this.track!;
    if (plan.track !== t.id) plan.fade = CROSS_S;
    else plan.fade = (4 * 60) / t.bpm / 2;
    plan.track = t.id;
    plan.layers = t.layers;
    plan.loop = !t.once;
    plan.gains.length = t.layers.length;
    for (let k = 0; k < t.layers.length; k++) plan.gains[k] = k === this.layer ? 1 : 0;
    return plan;
  }

  private silence(): MusicPlan {
    this.plan.track = "";
    this.plan.layers = [];
    this.plan.gains.length = 0;
    this.plan.fade = CROSS_S;
    this.track = null;
    return this.plan;
  }
}
