// Cast in the server: the world as the engine asks for it (ground, water, buildings, who can see where, the players), and
// bodies as the stage asks for them (civilians made, walked, turned, emoting and speaking through the creature systems,
// the emotes and the chat). The host makes one, steps it each tick and hears every line survivors say.

import { DecisionLog } from "./decide.ts";
import { Cast } from "./engine.ts";
import type { PlayerView } from "./intent.ts";
import { ModelGate, openRouter, type Ask } from "./model.ts";
import { Planner } from "./planner.ts";
import { castBody, keepOf, type CastStore, type Worn } from "./people.ts";
import { CastStage, type CastBodies, type IncidentKind, type StagePlayer } from "./stage.ts";
import type { CastPlace, CastWorld } from "./world.ts";
import type { Chat } from "../chat.ts";
import type { Creatures } from "../creatures.ts";
import type { Emotes } from "../emote.ts";
import { EMOTE_PLAY, EMOTE_STOP } from "../emote.ts";
import type { GameServer } from "../game.ts";
import type { Items } from "../items.ts";
import { placeFree } from "../place.ts";
import type { Records } from "../records.ts";
import type { Rules } from "../settings/rules.ts";
import type { Urban } from "../urban.ts";
import type { Bus } from "../events/bus.ts";
import type { PeopleStore } from "../people/store.ts";
import type { EntityRecord } from "../records.ts";
import { worldHour, type ServerWorld } from "../world.ts";
import { GOAL_NONE, TEMPER_DEFENDS } from "../behavior.ts";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import type { Archetype, Capability } from "../../shared/cast/catalogue.ts";
import type { CastSettings, Character, KeptPerson } from "../../shared/cast/state.ts";
import { DEFAULT_SETTINGS } from "../../shared/cast/state.ts";
import { EMOTES, EMOTE_NUMBER } from "../../shared/anim/emotes.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { RESULT_OK, TEXT_LOCAL } from "../../shared/net/protocol.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, GEAR_HELD } from "../../shared/sim/entities.ts";
import { WARDROBE_SLOTS } from "../../shared/sim/items.ts";
import type { Bodies, Revision, RevisedKind } from "../../shared/people/doc.ts";
import { W_GUN } from "../../shared/sim/weapon.ts";
import { groundUnder } from "../../shared/world/collide.ts";

/** The rec.extra component a Cast body carries: the id of the person it is (server/persist/codec.ts lists it). */
export const COMP_CAST = 90;
/** What the engine can do in this build: a scene needing more waits (driving and weapons come in their phases). */
export const CAST_CAN: readonly Capability[] = ["walk", "emote", "speech", "queue", "drive", "weapon"];
/** Seconds a survivor's local line is kept for the planner. */
const SAID_KEPT_S = 120;
/** Metres from a survivor's own building it counts as home, where no scene starts a fight with it. */
const HOME_M = 60;

export interface CastHostContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  creatures: Creatures;
  emotes: Emotes;
  chat: Chat;
  items: Items;
  urban: Urban;
  bus: Bus;
  /** Puts a record's held item and worn pieces on its body (the host's refreshBody). */
  refresh: (rec: EntityRecord) => void;
  /** Parks a vehicle of a species at (x, z) facing yaw (radians), nobody's; its entity, or -1 (the host's own). */
  park: (id: string, x: number, z: number, yaw: number) => number;
  /** Named places on the map beside its spawn points (its landmarks). */
  places: readonly CastPlace[];
  seed: number;
  /** The server's settings, read again every few seconds (live); `settings` are laid over them (tests). */
  rules?: Rules | null;
  settings?: Partial<CastSettings>;
  /** The planner's model, when there is a key: an OpenRouter key (or a stand-in for tests). None keeps Cast on rules. */
  ask?: Ask | null;
  /** Folder of the decision log; none keeps it in memory. */
  logDir?: string | null;
  /** The cluster's people store: admin populations, outfits and named people. None draws everyone from the content. */
  people?: PeopleStore | null;
}

export class CastHost {
  readonly cast: Cast;
  readonly stage: CastStage;
  readonly planner: Planner;
  readonly gate: ModelGate;
  readonly log: DecisionLog;
  private readonly ctx: CastHostContext;
  /** Each survivor's last few lines said in local chat, with the tick, for the planner's read of what it is up to. */
  private readonly said = new Map<string, { text: string; t: number }[]>();
  private readonly kind: number;
  private readonly players: StagePlayer[] = [];
  private readonly pool: StagePlayer[] = [];
  /** The store as Cast reads it, or null. */
  readonly store: CastStore | null;
  /** The body each person in the world was drawn as, by character id, kept on it should it be made featured. */
  private readonly shown = new Map<string, KeptPerson>();

  constructor(ctx: CastHostContext) {
    this.ctx = ctx;
    const people = ctx.people ?? null;
    this.store = people ? {
      latest: <K extends RevisedKind>(kind: K, id: number) => (people.held().records[kind] as ReadonlyMap<number, readonly Revision<Bodies[K]>[]>).get(id)?.at(-1),
      population: (id, rev) => people.population(id, rev),
    } : null;
    const kind = ctx.world.reg.index.get("core:civilian");
    if (kind === undefined) throw new Error("cast: the content has no core:civilian");
    this.kind = kind;
    this.cast = new Cast(this.worldView(), CAST_CATALOGUE, ctx.seed, CAST_CAN, this.settingsNow());
    this.stage = new CastStage(this.cast, this.bodyView(), ctx.seed ^ 0x2545f491);
    this.cast.stage = this.stage;
    this.cast.personName = (id) => this.store?.latest("person", id)?.body.name ?? null;
    // Met or featured, a person keeps the body players saw.
    this.cast.people.onPromote = (c) => void (c.kept ??= this.shown.get(c.id));
    // People hear what is said near them, as anyone standing there would: local chat only, never a tribe's or global, and
    // nothing while Cast is off. A line is kept two minutes at most for the planner's read of the speaker.
    ctx.chat.listeners.push((speaker, channel, x, z, text) => {
      if (channel !== TEXT_LOCAL || !this.cast.settings.enabled) return;
      this.stage.hear(speaker, x, z, text);
      const lines = (this.said.get(speaker) ?? []).filter((l) => ctx.world.tick - l.t < SAID_KEPT_S * TICK_RATE);
      lines.push({ text, t: ctx.world.tick });
      if (lines.length > 3) lines.shift();
      this.said.set(speaker, lines);
    });
    const settings = this.cast.settings;
    this.gate = new ModelGate(null, { callsPerHour: settings.callsPerHour, tokensPerHour: settings.callsPerHour * 6000 });
    this.modelFor(settings);
    this.log = new DecisionLog(ctx.logDir ?? null);
    this.planner = new Planner(this.cast, this.gate, this.log, () => Date.now());
    this.planner.model = settings.model;
    this.planner.views = () => this.views();
    // A blow on one of Cast's people is an attack it answers. Any blow, shot, blast or death that a survivor or one of
    // Cast's people is in is trouble to everyone near it (the creatures' own fights far from anyone are not).
    const nameOf = (pid: unknown) => (typeof pid === "number" && pid !== 0 ? ctx.records.byPid.get(pid)?.name || null : null);
    // Shots and blasts come from what is heard (heard(), every one, hit or miss); a blow, an arrow or fire from the hurt.
    const KIND: Record<string, IncidentKind> = { pierce: "fight", melee: "fight", fire: "fight" };
    ctx.bus.on("cast", "damaged", (e) => {
      const d = e.data as { target: string; victim: number; byPid: number; type: string; killed: boolean };
      if (d.target !== "body" || !this.cast.settings.enabled) return;
      const victim = ctx.records.byPid.get(d.victim), attacker = d.byPid ? ctx.records.byPid.get(d.byPid) : undefined;
      const by = nameOf(d.byPid);
      const ours = (r: EntityRecord | undefined) => !!r && (r.extra.has(COMP_CAST) || r.keyHash !== null);
      if (victim?.extra.has(COMP_CAST)) this.stage.attacked(d.victim, attacker?.keyHash !== null ? by : null, this.livePlayers());
      if (!ours(victim) && !ours(attacker)) return;
      const at = ctx.records.entOf.get(d.victim);
      if (at === undefined) return;
      const x = ctx.world.ents.x[at]!, z = ctx.world.ents.z[at]!;
      const who = attacker?.keyHash !== null ? by : null;
      const kind = KIND[d.type];
      if (kind) this.stage.incident(x, z, kind, who);
      if (d.killed) this.stage.incident(x, z, "death", who);
    });
    // A survivor who has just risen is spared hostile scenes for a while.
    ctx.bus.on("cast", "session.spawn", (e) => {
      const name = nameOf((e.data as { pid: number }).pid);
      if (name) this.cast.rose(name, ctx.world.tick);
    });
    this.sweep();
  }

  /** Bodies a save kept of a run before: Cast's stories begin again, so its old bodies go (none is ever kept twice). */
  sweep(): number {
    const { records, creatures } = this.ctx;
    let n = 0;
    for (const rec of [...records.byPid.values()]) {
      if (!rec.extra.has(COMP_CAST)) continue;
      // What it wore and carried goes with it, through the ledger.
      if (rec.inv) this.ctx.items.burnAll(rec);
      const e = records.entOf.get(rec.pid);
      if (e !== undefined) creatures.remove(e);
      records.delete(rec.pid);
      n++;
    }
    return n;
  }

  /**
   * A shot or a blast, hit or miss: a gun's shot is a gunshot to everyone within hearing, a silenced one or a bow's only
   * trouble to those who see it close, a blast an explosion.
   */
  heard(kind: "shot" | "blast", x: number, z: number, by: string | null, silenced: boolean): void {
    if (!this.cast.settings.enabled) return;
    if (kind === "blast") return this.stage.incident(x, z, "explosion", by);
    const { game, world } = this.ctx;
    const c = by ? game.clients.find((q) => q?.active && q.name === by) : undefined;
    const held = c && c.ent >= 0 ? world.ents.gears.get(c.ent)?.[GEAR_HELD] ?? 0 : 0;
    const gun = world.reg.weapon[held]?.kind === W_GUN;
    this.stage.incident(x, z, gun && !silenced ? "gunshot" : "fight", by);
  }

  /** Kept in the world's save beside its records, a minute at a time (server/persist: a sidecar). */
  readonly saved = { dirty: false, serialize: (): string => this.cast.save() };

  /** The settings now: the server's Cast rows, then what the host was given over them. */
  settingsNow(): CastSettings {
    const r = this.ctx.rules;
    const fromRules: Partial<CastSettings> = r ? {
      enabled: r.on("CastEnabled"), size: r.num("CastSize"), activity: r.num("CastActivity"), spikiness: r.num("CastSpikiness"),
      maxBodies: r.num("CastMaxBodies"), maxPerPlayer: r.num("CastMaxPerPlayer"), crowdMax: r.num("CastCrowdMax"), hostility: r.num("CastHostility"),
      hostileCooldown: r.num("CastHostileCooldown"), model: r.text("CastModel"), callsPerHour: r.num("CastCallsPerHour"), hourlyBatch: r.num("CastHourlyBatch"),
    } : {};
    return { ...DEFAULT_SETTINGS, ...fromRules, ...this.ctx.settings };
  }

  /** The planner's model for the settings: the host's stand-in, else OpenRouter with the setting's key or the
   * environment's; none without a key or a model. */
  private modelFor(s: CastSettings): void {
    if (this.ctx.ask !== undefined) {
      this.gate.ask = this.ctx.ask;
      return;
    }
    const key = this.ctx.rules?.text("CastModelKey") || process.env.OPENROUTER_API_KEY || "";
    const id = `${key ? key.slice(-6) : ""}:${s.model}`;
    if (id === this.modelId) return;
    this.modelId = id;
    this.gate.ask = key && s.model ? openRouter(key, s.model) : null;
  }
  private modelId = "";

  /** Settings changed live take hold within five seconds; everything stops at once when Cast is turned off. */
  private retune(): void {
    const s = this.settingsNow(), was = this.cast.settings.enabled;
    this.cast.settings = s;
    this.planner.model = s.model;
    this.gate.budget = { callsPerHour: s.callsPerHour, tokensPerHour: s.callsPerHour * 6000 };
    this.modelFor(s);
    if (was && !s.enabled) for (const st of [...this.cast.stories.values()]) if (st.phase !== "planned") this.cast.finish(st, this.ctx.world.tick);
  }

  step(): void {
    if (this.ctx.world.tick % (5 * TICK_RATE) === 0) {
      this.retune();
      this.saved.dirty = true;
      this.forgetSaid();
      // A body that died is never removed through the stage: what it was drawn as goes once it is off the stage.
      for (const id of this.shown.keys()) if (!this.stage.has(id)) this.shown.delete(id);
    }
    if (!this.cast.settings.enabled) {
      // Turned off: the people still about walk off where no one sees, then nothing more happens.
      if (this.stage.count) this.stage.step(this.livePlayers());
      return;
    }
    if (this.ctx.world.tick % (5 * TICK_RATE) === 0) this.homes();
    this.cast.step();
    this.stage.step(this.livePlayers());
    this.planner.step();
  }

  /** The survivors as the planner reads them: speed, whether driving, the classes of what they carry, their last lines. */
  private views(): PlayerView[] {
    const { game, world, records } = this.ctx, ents = world.ents, reg = world.reg;
    const out: PlayerView[] = [];
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0) continue;
      const carries: Record<string, number> = {};
      const inv = records.byPid.get(c.pid)?.inv;
      if (inv) for (let k = 0; k < inv.cap; k++) {
        const item = inv.item[k]!;
        if (!item) continue;
        const cls = (reg.defs[item] as { class?: string } | undefined)?.class ?? "item";
        carries[cls] = (carries[cls] ?? 0) + inv.count[k]!;
      }
      const e = c.drive >= 0 ? c.drive : c.ent;
      out.push({ name: c.name, speed: Math.hypot(ents.vx[e]!, ents.vz[e]!), driving: c.drive >= 0, carries, said: (this.said.get(c.name) ?? []).filter((l) => world.tick - l.t < SAID_KEPT_S * TICK_RATE).map((l) => l.text) });
    }
    return out;
  }

  /** Lines older than two minutes are forgotten, and a speaker with none left is forgotten too. */
  private forgetSaid(): void {
    const old = this.ctx.world.tick - SAID_KEPT_S * TICK_RATE;
    for (const [speaker, lines] of this.said) {
      const kept = lines.filter((l) => l.t >= old);
      if (kept.length) this.said.set(speaker, kept);
      else this.said.delete(speaker);
    }
  }

  /** How many survivors' lines Cast holds now (for a test of its forgetting). */
  get remembered(): number {
    return this.said.size;
  }

  /** Which survivors are home: near a building of their own or their tribe's. */
  private homes(): void {
    const { game, world, records } = this.ctx, { dims, structs } = world;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      const team = records.byPid.get(c.pid)?.team ?? 0;
      let home = false;
      const { x, z } = c.body;
      for (let cz = Math.max(0, Math.floor((z - HOME_M) / CHUNK_SIZE)); !home && cz <= Math.min(dims.chunksZ - 1, Math.floor((z + HOME_M) / CHUNK_SIZE)); cz++) {
        for (let cx = Math.max(0, Math.floor((x - HOME_M) / CHUNK_SIZE)); !home && cx <= Math.min(dims.chunksX - 1, Math.floor((x + HOME_M) / CHUNK_SIZE)); cx++) {
          const t = structs.chunks[cz * dims.chunksX + cx];
          if (!t || t.live === 0) continue;
          for (let k = 0; k < t.high && !home; k++) if (t.kind[k] !== 0 && t.owner[k] !== 0 && (t.owner[k] === team || t.owner[k] === c.pid) && Math.hypot(t.x[k]! - x, t.z[k]! - z) < HOME_M) home = true;
        }
      }
      this.cast.player(c.name).safe = home;
    }
  }

  /** The survivors in the world now, where each looks and what emote it plays. */
  private livePlayers(): StagePlayer[] {
    const { game, world, emotes } = this.ctx, ents = world.ents;
    let count = 0;
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0 || (ents.flags[c.ent]! & F_ALIVE) === 0) continue;
      const n = emotes.playingOf(c.ent);
      // The same objects each tick: nothing keeps one past the call it was given to.
      const p = (this.pool[count] ??= { name: "", x: 0, z: 0, yaw: 0, emote: undefined });
      p.name = c.name;
      p.x = c.body.x;
      p.z = c.body.z;
      p.yaw = (ents.yaw[c.ent]! / 65536) * Math.PI * 2;
      p.emote = n ? EMOTES[n - 1]!.id : undefined;
      this.players[count++] = p;
    }
    this.players.length = count;
    return this.players;
  }

  private worldView(): CastWorld {
    const { world, game } = this.ctx, hf = world.hf;
    const self = this;
    return {
      rate: TICK_RATE,
      sizeX: hf.sizeX,
      sizeZ: hf.sizeZ,
      tick: () => world.tick,
      hour: () => worldHour(world),
      players: () => (self.players.length ? self.players : self.livePlayers()),
      ground: (x, z) => (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ ? -1 : hf.groundClassAt(x, z)),
      water: (x, z) => (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ ? 0 : hf.waterAt(x, z) - hf.heightAt(x, z)),
      blocked: (x, z, r = 0.35) => x < 1 || z < 1 || x >= hf.sizeX - 1 || z >= hf.sizeZ - 1 || !placeFree(world, x, groundUnder(hf, x, z, r) + 0.3, z, r, 1.5),
      seen: (x, z) => {
        const w = world.dims.chunksX, reach = game.opts.entityRadius + 1;
        const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
        for (const c of game.clients) {
          if (!c?.active || c.closed) continue;
          if (Math.abs((c.chunk % w) - cx) <= reach && Math.abs(Math.floor(c.chunk / w) - cz) <= reach) return true;
        }
        return false;
      },
      places: () => [...world.spawns.map((s) => ({ name: s.name, kind: "spawn", x: s.x, z: s.z })), ...this.ctx.places],
    };
  }

  private bodyView(): CastBodies {
    const { world, records, creatures, emotes, chat, items } = this.ctx, ents = world.ents, reg = world.reg, mind = creatures.mind;
    const ent = (pid: number): number => records.entOf.get(pid) ?? -1;
    return {
      spawn: (c: Character, a: Archetype, x: number, z: number, yaw: number): number => {
        // Not inside a parked car or another body.
        if (!this.ctx.urban.roomFor(this.kind, x, z)) return -1;
        const e = creatures.spawn(this.kind, x, z, 1, "cast");
        if (e < 0) return -1;
        const rec = records.byPid.get(ents.pid[e]!)!;
        rec.name = c.name;
        rec.extra.set(COMP_CAST, new TextEncoder().encode(c.id));
        const look = CAST_CATALOGUE.looks.find((l) => l.id === c.look);
        if (look?.colors && rec.genome) look.colors.forEach((col, i) => void (i < rec.genome!.colors.length && (rec.genome!.colors[i] = col)));
        // Its body is a person of its look's population, sent as the seed it was drawn from, or the one it keeps.
        const body = castBody(c, look, CAST_CATALOGUE, reg, this.store, this.cast.casting.looks[c.look]);
        if (body) ents.setBodyLook(e, body.look, body.born);
        // What it wears, in its gear slots and its wardrobe; and what it carries.
        const inv = items.inv(rec);
        /** Makes an item in its bag and moves it to `to`, a gear slot, if one is given. */
        const put = (item: number, n: number, to: number) => {
          if (items.mint(rec, item, n, 0, 0, -1, "cast") === 0 || to < 0) return;
          for (let k = 0; k < inv.hotbar; k++) if (inv.item[k] === item) return void items.move(rec, k, rec, to, n);
        };
        const slotOf = (item: number) => (reg.wearSlot[item]! >= 0 && inv.armor >= 0 ? inv.armor + reg.wearSlot[item]! : reg.garmentSlot[item]! >= 0 && inv.wardrobe >= 0 ? inv.wardrobe + reg.garmentSlot[item]! : -1);
        // Garments go through the items' own restyle, which takes only an edition the store holds of that garment.
        for (const [k, w] of (body?.wardrobe ?? []).entries()) {
          const item = w ? reg.index.get(w[0]) : undefined;
          if (!w || item === undefined || inv.wardrobe < 0 || reg.garmentSlot[item] !== k) continue;
          const s = inv.wardrobe + k;
          if (inv.item[s] !== item) {
            if (inv.item[s] !== 0) continue;
            put(item, 1, s);
          }
          if (inv.item[s] === item && (w[1] !== 0 || w[2] !== 0)) void (items.restyle(rec, s, w[1], w[2]) || items.restyle(rec, s, w[1], 0) || items.restyle(rec, s, 0, w[2]));
        }
        // What the role wears fills the slots its wardrobe left.
        for (const w of body?.wear ?? look?.wear ?? []) {
          const item = reg.index.get(w), slot = item === undefined ? -1 : slotOf(item);
          if (item !== undefined && slot >= 0 && inv.item[slot] === 0) put(item, 1, slot);
        }
        if (body && !body.kept) {
          const worn: (Worn | null)[] = [];
          for (let k = 0; k < WARDROBE_SLOTS; k++) {
            const s = inv.wardrobe + k, item = inv.wardrobe >= 0 ? inv.item[s]! : 0;
            worn.push(item !== 0 ? [reg.defs[item]!.id, inv.editionOf(s), inv.dyeOf(s)] : null);
          }
          const kept = keepOf(body, worn);
          if (c.tier === "featured" || c.person !== undefined) c.kept = kept;
          else this.shown.set(c.id, kept);
        }
        // A weapon goes on its hotbar, ready to be drawn; the rest in its bag.
        let bar = 0;
        for (const [id, n] of Object.entries(a.items ?? {})) {
          const item = reg.index.get(id);
          if (item !== undefined) put(item, n, reg.weapon[item] && inv.hotbar >= 0 && n === 1 ? inv.hotbar + bar++ : -1);
        }
        this.ctx.refresh(rec);
        ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
        ents.yaw[e] = Math.round((yaw / (Math.PI * 2)) * 65536) & 0xffff;
        if (a.temper === "defends") mind.temperOf[e] = TEMPER_DEFENDS;
        emotes.people.add(e);
        return rec.pid;
      },
      remove: (pid) => {
        const rec = records.byPid.get(pid), id = rec?.extra.get(COMP_CAST);
        if (id) this.shown.delete(new TextDecoder().decode(id));
        if (rec?.inv) items.burnAll(rec);
        const e = ent(pid);
        if (e >= 0) {
          if (emotes.playingOf(e)) emotes.request(e, EMOTE_STOP, 0);
          emotes.people.delete(e);
          creatures.remove(e);
        }
        records.delete(pid);
      },
      alive: (pid) => {
        const e = ent(pid);
        return e >= 0 && (ents.flags[e]! & F_ALIVE) !== 0 && !records.byPid.get(pid)?.dead;
      },
      at: (pid) => {
        const e = ent(pid);
        return e < 0 ? null : { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]! };
      },
      awake: (pid) => {
        const e = ent(pid);
        return e >= 0 && (ents.flags[e]! & F_AWAKE) !== 0;
      },
      place: (pid, x, z) => {
        const e = ent(pid);
        if (e < 0) return;
        ents.setPosition(e, x, groundUnder(world.hf, x, z, 0.3), z);
        creatures.settle(e);
      },
      goTo: (pid, x, z, pace) => {
        const e = ent(pid);
        if (e >= 0) mind.goTo(e, x, z, pace);
      },
      arrived: (pid, r) => {
        const e = ent(pid);
        return e >= 0 && mind.goalPace[e] !== GOAL_NONE ? mind.arrived(e, r) : false;
      },
      face: (pid, x, z) => {
        const e = ent(pid);
        if (e >= 0) mind.face(e, x, z);
      },
      emote: (pid, id) => {
        const e = ent(pid), n = EMOTE_NUMBER.get(id);
        return e >= 0 && n !== undefined && emotes.request(e, EMOTE_PLAY, n) === RESULT_OK;
      },
      stopEmote: (pid) => {
        const e = ent(pid);
        if (e >= 0 && emotes.playingOf(e)) emotes.request(e, EMOTE_STOP, 0);
      },
      say: (pid, name, text) => {
        const e = ent(pid);
        if (e >= 0) chat.npcSay(name, ents.x[e]!, ents.y[e]!, ents.z[e]!, text);
      },
      spawnCar: (kind, x, z, yaw) => {
        const e = this.ctx.park(kind, x, z, yaw);
        if (e < 0) return -1;
        const rec = records.byPid.get(ents.pid[e]!)!;
        rec.extra.set(COMP_CAST, new TextEncoder().encode("car"));
        return rec.pid;
      },
      removeCar: (car) => {
        const rec = records.byPid.get(car);
        if (rec?.inv) items.burnAll(rec);
        const e = ent(car);
        if (e >= 0) creatures.remove(e);
        records.delete(car);
      },
      door: (car, which = "driver") => {
        const e = ent(car), def = e >= 0 ? reg.vehicle[ents.kind[e]!] : undefined;
        const seat = def?.seats.find((s) => (which === "driver" ? s.driver : !s.driver));
        if (!seat) return null;
        const out = [0, 0, 0];
        this.ctx.urban.door(e, seat, reg.move[this.kind]!.radius, out);
        return { x: out[0]!, z: out[2]! };
      },
      board: (pid, car, which = "driver") => {
        const e = ent(pid), v = ent(car), def = v >= 0 ? reg.vehicle[ents.kind[v]!] : undefined;
        const seat = def?.seats.find((s) => (which === "driver" ? s.driver : !s.driver));
        return e >= 0 && !!seat && this.ctx.urban.seatNpc(e, v, seat.id) === RESULT_OK;
      },
      seated: (pid) => {
        const e = ent(pid);
        return e >= 0 && this.ctx.urban.seatedNpc(e);
      },
      boarding: (pid) => {
        const e = ent(pid);
        return e >= 0 && this.ctx.urban.boardingNpc(e);
      },
      alight: (pid) => {
        const e = ent(pid);
        return e >= 0 && this.ctx.urban.alightNpc(e) === RESULT_OK;
      },
      car: (car) => {
        const e = ent(car);
        if (e < 0 || ents.vrow[e]! < 0) return null;
        return { x: ents.x[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[ents.vrow[e]!]!, speed: Math.hypot(ents.vx[e]!, ents.vz[e]!) };
      },
      drive: (car, moveX, moveZ, handbrake) => {
        const e = ent(car);
        if (e >= 0) this.ctx.urban.drive(e, moveX, moveZ, handbrake ? BTN_JUMP : 0);
      },
      hold: (pid, item) => {
        const rec = records.byPid.get(pid), inv = rec?.inv;
        if (!rec || !inv || inv.hotbar < 0) return;
        const want = item === null ? -1 : reg.index.get(item) ?? -1;
        let slot = -1;
        for (let k = 0; want >= 0 && k < inv.cap - inv.hotbar && inv.hotbar + k < inv.armor; k++) if (inv.item[inv.hotbar + k] === want) slot = k;
        rec.held = slot;
        records.dirty.add(pid);
        this.ctx.refresh(rec);
      },
      attack: (pid, target) => {
        const e = ent(pid);
        let prey = -1;
        if ("pid" in target) prey = ent(target.pid);
        else for (const c of this.ctx.game.clients) if (c?.active && c.name === target.player && c.ent >= 0) prey = c.ent;
        if (e < 0 || prey < 0) return false;
        mind.attack(e, prey);
        return mind.targetOf(e) === prey;
      },
      calm: (pid) => {
        const e = ent(pid);
        if (e >= 0 && mind.targetOf(e) >= 0) mind.stay(e, 0);
      },
      fighting: (pid) => {
        const e = ent(pid);
        return e >= 0 && mind.targetOf(e) >= 0;
      },
    };
  }
}
