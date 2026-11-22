// Cast's engine: keeps a few hundred stories planned about the map (weighted by where players spend their time), wakes
// the ones players come near, casts their roles from the people it keeps or new extras, paces each region, and runs
// stories no one is near by the clock. It never touches a body: the stage (server/cast/stage.ts) does that for the
// stories players can see. Everything here is rules and seeded chance; the planner (server/cast/planner.ts) may change a
// story's choices and fill its slots before it begins, and nothing waits on it.

import type { Capability, Catalogue, Scene, SceneTag, Step } from "../../shared/cast/catalogue.ts";
import { DEFAULT_SETTINGS, type CastSettings, type Character, type Pace, type Part, type Region, type Spot, type Story } from "../../shared/cast/state.ts";
import { Rng } from "../../shared/rng.ts";
import { People } from "./people.ts";
import { PACE_STORIES, Regions } from "./regions.ts";
import { REGION_SIZE, Spots } from "./spots.ts";
import type { CastPlayer, CastWorld } from "./world.ts";

/** Seconds between the engine's thinking (planning, waking, pacing): cheap, and it is never per tick. */
export const THINK_S = 5;
/** Stories planned in one think, at most, so a big map fills over a minute or two and no think is long. */
const PLAN_PER_THINK = 12;
/** Metres from a player within which a planned story may wake for it, and beyond which a woken one no longer counts as
 * its (and runs on by the clock). */
export const WAKE_M = 300, AWAY_M = 600;
/** Metres from a player a story made for it on the spot is put: in its sight, but not on top of it. */
const FILL_NEAR = 60, FILL_FAR = 220;
/** Seconds a planned story waits for players before it is let go and planned again elsewhere. */
const PLANNED_S = 3 * 3600;
/** Metres about trouble where no new everyday scene starts, and seconds it stays so; the scene police come in. */
const ALARM_M = 120, ALARM_S = 90;
export const POLICE = "cast:police_response";
/** Seconds police take to come, least and most, and metres and seconds within which one response covers new trouble. */
const POLICE_DELAY: [number, number] = [20, 40], POLICE_M = 300, POLICE_S = 180;
/** Seconds a player is spared hostile scenes after rising. */
export const RISE_GRACE_S = 600;

/** How well a scene's kind suits a region's pace: calm fills the quiet, tense and crowds make the peaks. */
const FIT: Record<Pace, Partial<Record<SceneTag, number>>> = {
  relax: { calm: 1.5, social: 1.2, tense: 0.2, hostile: 0.1, crowd: 0.5, comic: 0.6, sad: 0.8, busy: 1, vehicle: 1 },
  build: { calm: 1, social: 1, tense: 0.8, hostile: 0.5, crowd: 1, comic: 1, sad: 1, busy: 1, vehicle: 1 },
  peak: { calm: 0.4, social: 0.8, tense: 2, hostile: 1.5, crowd: 2, comic: 1.5, sad: 0.6, busy: 1.2, vehicle: 1.2 },
  fade: { calm: 1.5, social: 1, tense: 0.3, hostile: 0.2, crowd: 0.6, comic: 0.8, sad: 1, busy: 0.8, vehicle: 1 },
};

/** A player as the engine knows it beyond the world's view: when it rose, and whether it is home (near its own base). */
export interface PlayerState {
  rose: number;
  safe: boolean;
  /** Tick a hostile scene may next start for it. */
  hostileAt: number;
  /** Scene id → tick it last saw one start. */
  seen: Record<string, number>;
}

export interface Stage {
  /** Its bodies in the world now, walking off from stories already over among them. */
  readonly count: number;
  /** A story wakes for players: its people should come in from where no one is. */
  enter(story: Story): void;
  /** A story is over or let go: any bodies still in it leave. */
  end(story: Story): void;
}

export class Cast {
  readonly world: CastWorld;
  readonly cat: Catalogue;
  readonly scenes: Map<string, Scene>;
  settings: CastSettings;
  readonly people: People;
  readonly regions: Regions;
  readonly spots: Spots;
  readonly stories = new Map<string, Story>();
  readonly players = new Map<string, PlayerState>();
  /** What the engine can do now: a scene needing more is never cast. */
  readonly can: Set<Capability>;
  stage: Stage | null = null;
  /** Trouble about the map: where, and the tick it is over. */
  readonly alarms: { x: number; z: number; until: number }[] = [];
  /** Stories a player engaged with since the planner last looked: it takes them first (server/cast/planner.ts). */
  readonly wakes = new Set<string>();
  /** Counts for the admin page and tests. */
  readonly counts = { planned: 0, woken: 0, filled: 0, done: 0, letGo: 0 };
  private nextStory = 1;
  private lastThink = -Infinity;
  private readonly rng: Rng;

  constructor(world: CastWorld, cat: Catalogue, seed: number, can: Iterable<Capability>, settings: CastSettings = DEFAULT_SETTINGS) {
    this.world = world;
    this.cat = cat;
    this.scenes = new Map(cat.scenes.map((s) => [s.id, s]));
    this.settings = { ...settings };
    this.people = new People(cat);
    this.regions = new Regions(seed ^ 0x9e3779b9);
    this.spots = new Spots(world);
    this.can = new Set(can);
    this.rng = new Rng(seed);
  }

  /** Called every tick; thinks once every THINK_S. */
  step(): void {
    const tick = this.world.tick();
    if (!this.settings.enabled || tick - this.lastThink < THINK_S * this.world.rate) return;
    const dt = this.lastThink === -Infinity ? THINK_S : (tick - this.lastThink) / this.world.rate;
    this.lastThink = tick;
    this.think(tick, dt);
  }

  /** A player rose (or joined): it is spared hostile scenes for a while. */
  rose(name: string, tick: number): void {
    const p = this.player(name);
    p.rose = tick;
  }

  player(name: string): PlayerState {
    let p = this.players.get(name);
    if (!p) this.players.set(name, (p = { rose: -Infinity, safe: false, hostileAt: 0, seen: {} }));
    return p;
  }

  think(tick: number, dt: number): void {
    const players = this.world.players();
    const counts = new Map<number, number>();
    for (const p of players) counts.set(this.spots.regionAt(p.x, p.z), (counts.get(this.spots.regionAt(p.x, p.z)) ?? 0) + 1);
    this.regions.warm(counts, dt, tick);
    this.regions.pace(tick, this.world.rate, this.settings.spikiness);
    this.regions.tidy(tick);
    while (this.alarms.length && this.alarms[0]!.until <= tick) this.alarms.shift();
    this.runTimed(tick, players);
    this.wakeDue(tick, players);
    this.plan(tick, players);
    for (const p of players) this.wakeFor(p, tick, players);
  }

  /** Bodies in the world (the stage's, those walking off from stories already over among them) and those stories are
   * still to bring in. */
  bodies(): number {
    let n = this.stage ? this.stage.count : 0;
    for (const s of this.stories.values()) {
      if (s.phase !== "entering" && s.phase !== "active" && s.phase !== "leaving") continue;
      for (const p of s.parts) if (!p.gone && (!this.stage || p.pid === undefined)) n++;
    }
    return n;
  }

  /** Bodies about a player: those of the stories that are its, in the world or still to come. */
  bodiesFor(name: string): number {
    let n = 0;
    for (const s of this.stories.values()) {
      if ((s.phase === "entering" || s.phase === "active" || s.phase === "leaving") && s.for.includes(name)) for (const p of s.parts) if (!p.gone) n++;
    }
    return n;
  }

  /** A player who must not be set on: just risen, or at home. Hostile scenes start for another never go for it. */
  spared(name: string, tick: number): boolean {
    const p = this.player(name);
    return tick - p.rose < RISE_GRACE_S * this.world.rate || p.safe;
  }

  /** The woken stories that count as a player's: made for it and still near it. */
  storiesFor(p: CastPlayer): Story[] {
    const out: Story[] = [];
    for (const s of this.stories.values()) {
      if (s.phase === "planned" || s.phase === "done") continue;
      if (Math.hypot(s.x - p.x, s.z - p.z) < AWAY_M && s.for.includes(p.name)) out.push(s);
    }
    return out;
  }

  /** Keeps up to `size` stories planned about the map, a few more each think, where players have been most. */
  private plan(tick: number, players: readonly CastPlayer[]): void {
    const room = Math.min(PLAN_PER_THINK, this.settings.size - this.stories.size);
    if (room <= 0) return;
    // Regions to plan in: hot ones by their heat, the ones about each player, and now and then one at random, so the
    // whole map has something waiting and the busy parts most.
    const weights: [number, number][] = [];
    for (const [i, r] of this.regions.byIndex) weights.push([i, 0.2 + r.heat]);
    for (const p of players) {
      const c = this.spots.regionAt(p.x, p.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const i = c + dz * this.spots.cols + dx;
        if (i >= 0 && i < this.spots.cols * this.spots.rows) weights.push([i, 1]);
      }
    }
    for (let n = 0; n < room; n++) {
      const region = weights.length && this.rng.float() < 0.85 ? weighted(this.rng, weights) : this.rng.int(this.spots.cols * this.spots.rows);
      this.make(region, tick, null);
    }
  }

  /** A planned story in a region (or near a point), of a scene that suits the region's pace, at a spot that fits it. */
  private make(region: number, tick: number, near: { x: number; z: number; player: string } | null): Story | null {
    const r = this.regions.get(region, tick);
    const hour = this.world.hour();
    const options: [Scene, number][] = [];
    for (const sc of this.scenes.values()) {
      if (sc.weight <= 0 || !sc.needs.every((n) => this.can.has(n))) continue;
      if (sc.hours && !sc.hours.some(([a, b]) => hour >= a && hour < b)) continue;
      if ((r.cooldowns[sc.id] ?? 0) > tick) continue;
      if (sc.hostile && this.settings.hostility === 0) continue;
      if (near) {
        const p = this.player(near.player);
        if ((p.seen[sc.id] ?? -Infinity) + sc.cooldown * this.world.rate > tick) continue;
        if (sc.hostile && !this.hostileFor(near.player, tick)) continue;
      }
      const fit = sc.tags.reduce((a, t) => a + (FIT[r.pace][t] ?? 1), 0) / sc.tags.length;
      options.push([sc, sc.weight * fit]);
    }
    // The best few by weight, one of them by chance: never always the same thing (The Sims' rule).
    options.sort((a, b) => b[1] - a[1]);
    const top = options.slice(0, 5);
    while (top.length) {
      const k = weightedIndex(this.rng, top.map((o) => o[1]));
      const sc = top[k]![0];
      top.splice(k, 1);
      const spot = this.spotFor(sc, region, near);
      if (spot < 0) continue;
      const at = this.spots.all[spot]!;
      const choices: Record<string, string> = {};
      for (const [name, opts] of Object.entries(sc.choices ?? {})) {
        const allowed = opts.filter((o) => this.settings.hostility >= 2 || !attacksPlayer(sc, name, o));
        choices[name] = allowed.length ? allowed[this.rng.int(allowed.length)]! : opts[0]!;
      }
      const story: Story = {
        id: `s${this.nextStory++}`, scene: sc.id, spot, x: at.x, z: at.z, region: this.spots.regionAt(at.x, at.z), phase: "planned", parts: [],
        choices, slots: {}, for: [], engaged: [], importance: 0, made: tick, since: tick, planned: -Infinity, history: [],
      };
      this.stories.set(story.id, story);
      this.counts.planned++;
      return story;
    }
    return null;
  }

  /** A spot of the scene's tags in the region; near a player, one in its sight but not on top of it. */
  private spotFor(sc: Scene, region: number, near: { x: number; z: number } | null): number {
    const regions = near ? this.around(near.x, near.z) : [region];
    const heat = this.regions.get(region, this.world.tick()).heat;
    const tags = sc.place.tags.filter((t) => t !== "quiet" && t !== "busy");
    if (sc.place.tags.includes("quiet") && heat > 1.5) return -1;
    let found: number[] = [];
    for (const r of regions) {
      for (const i of this.spots.tagged(r, tags.length ? tags : sc.place.tags)) {
        const s = this.spots.all[i]!;
        if (near) {
          const d = Math.hypot(s.x - near.x, s.z - near.z);
          if (d < FILL_NEAR || d > FILL_FAR) continue;
        }
        if (this.alarmed(s.x, s.z)) continue;
        found.push(i);
      }
    }
    // A spot one story already has is not taken again while it runs.
    if (found.length) {
      const taken = new Set<number>();
      for (const s of this.stories.values()) if (s.phase !== "done") taken.add(s.spot);
      found = found.filter((i) => !taken.has(i));
    }
    return found.length ? found[this.rng.int(found.length)]! : -1;
  }

  private around(x: number, z: number): number[] {
    const out: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx * REGION_SIZE, pz = z + dz * REGION_SIZE;
      if (px < 0 || pz < 0 || px >= this.world.sizeX || pz >= this.world.sizeZ) continue;
      out.push(this.spots.regionAt(px, pz));
    }
    return [...new Set(out)];
  }

  /** Whether a hostile scene may start for a player now: allowed, its cooldown over, not just risen, not at home. */
  hostileFor(name: string, tick: number): boolean {
    if (this.settings.hostility < 1) return false;
    const p = this.player(name);
    return tick >= p.hostileAt && tick - p.rose >= RISE_GRACE_S * this.world.rate && !p.safe;
  }

  /** Wakes stories for a player who has fewer than its region's pace wants: a planned one near it, or one made now. */
  private wakeFor(p: CastPlayer, tick: number, players: readonly CastPlayer[]): void {
    const r = this.regions.get(this.spots.regionAt(p.x, p.z), tick);
    const want = Math.round(PACE_STORIES[r.pace] * this.settings.activity);
    const mine = this.storiesFor(p);
    if (mine.length >= want) return;
    if (this.bodiesFor(p.name) >= this.settings.maxPerPlayer || this.bodies() >= this.settings.maxBodies) return;
    let best: Story | null = null, bestD = Infinity;
    const ps = this.player(p.name);
    for (const s of this.stories.values()) {
      if (s.phase !== "planned" || s.due !== undefined) continue;
      const sc = this.scenes.get(s.scene)!;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > WAKE_M || d >= bestD || this.alarmed(s.x, s.z)) continue;
      if ((ps.seen[sc.id] ?? -Infinity) + sc.cooldown * this.world.rate > tick) continue;
      if (sc.hostile && !this.hostileFor(p.name, tick)) continue;
      best = s;
      bestD = d;
    }
    if (!best) {
      // At its size, the oldest planned story makes room (first in, first out).
      if (this.stories.size >= this.settings.size) {
        let oldest: Story | null = null;
        for (const s of this.stories.values()) if (s.phase === "planned" && (!oldest || s.made < oldest.made)) oldest = s;
        if (!oldest) return;
        this.forget(oldest);
        this.counts.letGo++;
      }
      best = this.make(this.spots.regionAt(p.x, p.z), tick, { x: p.x, z: p.z, player: p.name });
      if (best) this.counts.filled++;
    }
    if (best) this.wake(best, tick, players);
  }

  /** A story wakes: its roles are cast, it is the players' near it, and the stage brings its people in. */
  wake(s: Story, tick: number, players: readonly CastPlayer[]): void {
    const sc = this.scenes.get(s.scene)!;
    const near = players.filter((p) => Math.hypot(p.x - s.x, p.z - s.z) < AWAY_M).map((p) => p.name);
    // Room: within the server's bodies, and (but for a crowd, which keeps to its own cap) each player's near it.
    let room = Math.max(0, this.settings.maxBodies - this.bodies());
    // A crowd keeps to its own cap, and police coming to trouble to the server's alone.
    if (!sc.tags.includes("crowd") && s.due === undefined) for (const name of near) room = Math.min(room, Math.max(0, this.settings.maxPerPlayer - this.bodiesFor(name)));
    const parts = this.castRoles(sc, s, tick, room, near);
    if (!parts.length) return;
    s.parts = parts;
    s.for = near;
    s.phase = "entering";
    s.since = tick;
    this.counts.woken++;
    const r = this.regions.get(s.region, tick);
    r.cooldowns[sc.id] = tick + sc.cooldown * this.world.rate;
    for (const name of s.for) {
      const p = this.player(name);
      p.seen[sc.id] = tick;
      if (sc.hostile) p.hostileAt = tick + this.settings.hostileCooldown * this.world.rate;
    }
    s.history.push(`began at tick ${tick} for ${s.for.join(", ") || "nobody"}`);
    if (this.stage) this.stage.enter(s);
    else s.phase = "active";
  }

  /**
   * Who plays each role, all of them or none: featured people free near the region first (regulars come back, those who
   * know a player near before others; a featured one of an everyday kind, met once, comes back now and then), else new
   * people. A crowd's size follows activity and the region's heat, within the crowd and body caps. Nobody is cast twice,
   * and a cast that cannot be filled takes nobody and leaves no one new behind.
   */
  private castRoles(sc: Scene, s: Story, tick: number, room: number, players: readonly string[]): Part[] {
    const parts: Part[] = [];
    const chosen = new Set<string>(), minted: string[] = [];
    const heat = this.regions.get(s.region, tick).heat;
    const cols = this.spots.cols;
    const near = (h: number) => Math.abs((h % cols) - (s.region % cols)) <= 2 && Math.abs(Math.floor(h / cols) - Math.floor(s.region / cols)) <= 2;
    const undo = (): Part[] => {
      for (const id of minted) this.people.byId.delete(id);
      return [];
    };
    for (const role of sc.roles) {
      const [lo, hi] = role.count;
      let n = lo + this.rng.int(hi - lo + 1);
      if (sc.tags.includes("crowd")) n = Math.round(lo + (hi - lo) * Math.min(1, (0.3 + heat * 0.25) * this.settings.activity * (0.6 + this.rng.float() * 0.4)));
      n = Math.min(n, sc.tags.includes("crowd") ? this.settings.crowdMax : n, room - parts.length);
      if (n < lo) return undo();
      for (let k = 0; k < n; k++) {
        const kind = role.archetypes[this.rng.int(role.archetypes.length)]!;
        const a = this.people.archetype(kind)!;
        // A featured kind always looks for its regulars; an everyday kind's featured ones (met by a player) half the time.
        const look = a.tier === "featured" || this.rng.float() < 0.5;
        let c = look ? this.people.free(role.archetypes, s.region, near, chosen, players) : null;
        if (!c) {
          c = this.people.mint(kind, s.region, this.rng.u32(), tick);
          minted.push(c.id);
        }
        chosen.add(c.id);
        parts.push({ character: c.id, role: role.role, step: 0, since: tick });
      }
    }
    for (const id of chosen) this.people.byId.get(id)!.story = s.id;
    return parts;
  }

  /** Stories no player is near run by the clock: a woken one with nobody left about it ends after its length; one
   * planned too long is let go; a done one is cleared. */
  private runTimed(tick: number, players: readonly CastPlayer[]): void {
    for (const s of [...this.stories.values()]) {
      const sc = this.scenes.get(s.scene)!;
      const age = (tick - s.since) / this.world.rate;
      if (s.phase === "planned") {
        if (age > PLANNED_S) (this.forget(s), this.counts.letGo++);
        continue;
      }
      if (s.phase === "done") {
        this.forget(s);
        continue;
      }
      const watched = players.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < AWAY_M);
      // With no stage, or nobody near any longer, the clock runs it: it ends after its length.
      if ((!this.stage || !watched) && age > Math.min(sc.most, timedLength(sc))) this.finish(s, tick);
      else if (age > sc.most) this.finish(s, tick);
    }
  }

  /** Whether trouble near a point is still fresh: the street there stays quiet a while. */
  alarmed(x: number, z: number): boolean {
    return this.alarms.some((a) => Math.hypot(a.x - x, a.z - z) < ALARM_M);
  }

  /** Trouble at a point: no new everyday scene starts near it for a while, and its region's pace falls to fading. */
  alarm(x: number, z: number, tick: number): void {
    const until = tick + ALARM_S * this.world.rate;
    const near = this.alarms.find((a) => Math.hypot(a.x - x, a.z - z) < 20);
    if (near) near.until = until;
    else this.alarms.push({ x, z, until });
    const r = this.regions.get(this.spots.regionAt(x, z), tick);
    r.pace = "fade";
    r.next = tick + 2 * ALARM_S * this.world.rate;
  }

  /**
   * Police come to trouble: a response planned at the place, waking in 20 to 40 seconds, unless one is already coming
   * or came near lately. It goes after whoever started it when there is a survivor to go for and the server allows
   * fighting back; otherwise it secures the place. Returns the story, or null.
   */
  respond(x: number, z: number, culprit: string | null, tick: number): Story | null {
    const sc = this.scenes.get(POLICE);
    if (!sc || !sc.needs.every((n) => this.can.has(n))) return null;
    for (const s of this.stories.values()) if (s.scene === POLICE && Math.hypot(s.x - x, s.z - z) < POLICE_M && tick - s.made < POLICE_S * this.world.rate) return null;
    const spot = this.spots.add({ x, z, tags: ["plaza"], cap: 12 });
    const pursue = !!culprit && this.settings.hostility >= 1;
    const story: Story = {
      id: `s${this.nextStory++}`, scene: POLICE, spot, x, z, region: this.spots.regionAt(x, z), phase: "planned", parts: [],
      choices: { mood: pursue ? "pursue" : "secure" }, slots: culprit ? { culprit } : {}, for: [], engaged: [], importance: 0.8,
      made: tick, since: tick, planned: -Infinity, history: [`called to trouble${culprit ? ` ${culprit} started` : ""}`],
      due: tick + Math.round(this.rng.range(POLICE_DELAY[0], POLICE_DELAY[1]) * this.world.rate),
    };
    this.stories.set(story.id, story);
    return story;
  }

  /** Stories due now wake whatever the pace, within the body caps; one that cannot in two minutes is let go. */
  private wakeDue(tick: number, players: readonly CastPlayer[]): void {
    for (const s of [...this.stories.values()]) {
      if (s.phase !== "planned" || s.due === undefined || s.due > tick) continue;
      this.wake(s, tick, players);
      if (s.phase === "planned" && tick - s.due > 120 * this.world.rate) (this.forget(s), this.counts.letGo++);
    }
  }

  /** A player engaged with one of a story's people. */
  engaged(s: Story): void {
    this.wakes.add(s.id);
  }

  /** A story is over: its people are free again, and the stage sends any still about away. */
  finish(s: Story, tick: number): void {
    if (s.phase === "done") return;
    s.phase = "done";
    s.since = tick;
    s.history.push(`ended at tick ${tick}`);
    this.counts.done++;
    this.stage?.end(s);
    // Its people are free again, but for those whose bodies are still walking off: the stage frees them once gone.
    for (const part of s.parts) {
      const c = this.people.byId.get(part.character);
      if (c && c.story === s.id && (part.pid === undefined || part.gone || !this.stage)) delete c.story;
    }
  }

  save(): string {
    const data: CastSave = {
      v: 1,
      // An extra nobody met is a seed and is made again when wanted; the rest is kept.
      people: [...this.people.byId.values()].filter((c) => c.tier === "featured" || c.facts.length || Object.keys(c.relations).length),
      // A story keeps its place by where and what it is: a spot's number means nothing to the next run.
      stories: [...this.stories.values()].filter((s) => s.phase === "planned").map((s) => ({ ...s, at: this.spots.all[s.spot] })),
      regions: [...this.regions.byIndex.entries()],
      players: [...this.players.entries()].map(([n, p]) => [n, { hostileAt: p.hostileAt }]),
      next: this.nextStory,
    };
    return JSON.stringify(data);
  }

  /** Restores a save; a world tick before it (a fresh world) moves its ticks so cooldowns and ages hold. */
  load(text: string | null): void {
    if (!text) return;
    let data: CastSave;
    try {
      data = JSON.parse(text) as CastSave;
    } catch {
      return;
    }
    if (data.v !== 1) return;
    for (const c of data.people) delete c.story;
    this.people.load(data.people);
    for (const saved of data.stories) {
      const { at, ...s } = saved;
      if (!at || !this.scenes.has(s.scene)) continue;
      s.spot = this.spots.add(at);
      // JSON has no -Infinity: a story the planner never looked at comes back as one it never looked at.
      if (typeof s.planned !== "number") s.planned = -Infinity;
      s.parts = [];
      this.stories.set(s.id, s);
    }
    for (const [i, r] of data.regions) this.regions.byIndex.set(i, r);
    for (const [n, p] of data.players) this.player(n).hostileAt = p.hostileAt;
    this.nextStory = Math.max(this.nextStory, data.next);
  }

  private forget(s: Story): void {
    for (const part of s.parts) {
      const c = this.people.byId.get(part.character);
      if (c && c.story === s.id) delete c.story;
    }
    this.stories.delete(s.id);
  }
}

/** What of Cast is saved: its people, the stories still only planned (bodies are never saved: a start sweeps them, and a
 * story under way ends), the regions' heat and cooldowns, players' hostile cooldowns, and its counters. */
export interface CastSave {
  v: 1;
  people: Character[];
  stories: (Story & { at?: Spot })[];
  regions: [number, Region][];
  players: [string, { hostileAt: number }][];
  next: number;
}

/** Whether a choice's option makes a role attack the player (allowed only at hostility 2). */
export function attacksPlayer(sc: Scene, choice: string, option: string): boolean {
  return Object.values(sc.script).some((steps) => steps.some((st) => st.do === "attack" && st.target === "player" && st.when?.[choice] === option));
}

/** About how long a scene runs unseen: its waits and emotes at their middle, a minute of walking, capped by its most. */
export function timedLength(sc: Scene): number {
  let longest = 0;
  for (const steps of Object.values(sc.script)) {
    let t = 60;
    for (const st of steps as Step[]) if ("s" in st && st.s) t += (st.s[0] + st.s[1]) / 2;
    longest = Math.max(longest, t);
  }
  return Math.min(sc.most, longest);
}

function weightedIndex(rng: Rng, ws: readonly number[]): number {
  let total = 0;
  for (const w of ws) total += Math.max(0, w);
  let x = rng.float() * total;
  for (let i = 0; i < ws.length; i++) if ((x -= Math.max(0, ws[i]!)) < 0) return i;
  return ws.length - 1;
}

function weighted(rng: Rng, items: readonly [number, number][]): number {
  return items[weightedIndex(rng, items.map((i) => i[1]))]![0];
}
