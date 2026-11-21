// Cast in the server: the world as the engine asks for it (ground, water, buildings, who can see where, the players), and
// bodies as the stage asks for them (civilians made, walked, turned, emoting and speaking through the creature systems,
// the emotes and the chat). The host makes one, steps it each tick and hears every line survivors say.

import { Cast } from "./engine.ts";
import { CastStage, type CastBodies, type StagePlayer } from "./stage.ts";
import type { CastPlace, CastWorld } from "./world.ts";
import type { Chat } from "../chat.ts";
import type { Creatures } from "../creatures.ts";
import type { Emotes } from "../emote.ts";
import { EMOTE_PLAY, EMOTE_STOP } from "../emote.ts";
import type { GameServer } from "../game.ts";
import type { Items } from "../items.ts";
import { placeFree } from "../place.ts";
import type { Records } from "../records.ts";
import type { Urban } from "../urban.ts";
import { worldHour, type ServerWorld } from "../world.ts";
import { GOAL_NONE, TEMPER_DEFENDS } from "../behavior.ts";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import type { Archetype, Capability } from "../../shared/cast/catalogue.ts";
import type { CastSettings, Character } from "../../shared/cast/state.ts";
import { DEFAULT_SETTINGS } from "../../shared/cast/state.ts";
import { EMOTES, EMOTE_NUMBER } from "../../shared/anim/emotes.ts";
import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE } from "../../shared/sim/entities.ts";
import { groundUnder } from "../../shared/world/collide.ts";

/** The rec.extra component a Cast body carries: the id of the person it is (server/persist/codec.ts lists it). */
export const COMP_CAST = 90;
/** What the engine can do in this build: a scene needing more waits (driving and weapons come in their phases). */
export const CAST_CAN: readonly Capability[] = ["walk", "emote", "speech", "queue", "drive"];

export interface CastHostContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  creatures: Creatures;
  emotes: Emotes;
  chat: Chat;
  items: Items;
  urban: Urban;
  /** Parks a vehicle of a species at (x, z) facing yaw (radians), nobody's; its entity, or -1 (the host's own). */
  park: (id: string, x: number, z: number, yaw: number) => number;
  /** Named places on the map beside its spawn points (its landmarks). */
  places: readonly CastPlace[];
  seed: number;
  settings?: Partial<CastSettings>;
}

export class CastHost {
  readonly cast: Cast;
  readonly stage: CastStage;
  private readonly ctx: CastHostContext;
  private readonly kind: number;
  private readonly players: StagePlayer[] = [];

  constructor(ctx: CastHostContext) {
    this.ctx = ctx;
    const kind = ctx.world.reg.index.get("core:civilian");
    if (kind === undefined) throw new Error("cast: the content has no core:civilian");
    this.kind = kind;
    this.cast = new Cast(this.worldView(), CAST_CATALOGUE, ctx.seed, CAST_CAN, { ...DEFAULT_SETTINGS, ...ctx.settings });
    this.stage = new CastStage(this.cast, this.bodyView(), ctx.seed ^ 0x2545f491);
    this.cast.stage = this.stage;
    ctx.chat.listeners.push((speaker, _channel, x, z, text) => this.stage.hear(speaker, x, z, text));
    this.sweep();
  }

  /** Bodies a save kept of a run before: Cast's stories begin again, so its old bodies go (none is ever kept twice). */
  sweep(): number {
    const { records, creatures } = this.ctx;
    let n = 0;
    for (const rec of [...records.byPid.values()]) {
      if (!rec.extra.has(COMP_CAST)) continue;
      const e = records.entOf.get(rec.pid);
      if (e !== undefined) creatures.remove(e);
      records.delete(rec.pid);
      n++;
    }
    return n;
  }

  step(): void {
    if (!this.cast.settings.enabled) return;
    this.cast.step();
    this.stage.step(this.livePlayers());
  }

  /** The survivors in the world now, where each looks and what emote it plays. */
  private livePlayers(): StagePlayer[] {
    const { game, world, emotes } = this.ctx, ents = world.ents;
    this.players.length = 0;
    for (const c of game.clients) {
      if (!c?.active || c.closed || c.ent < 0 || (ents.flags[c.ent]! & F_ALIVE) === 0) continue;
      const n = emotes.playingOf(c.ent);
      this.players.push({ name: c.name, x: c.body.x, z: c.body.z, yaw: (ents.yaw[c.ent]! / 65536) * Math.PI * 2, ...(n ? { emote: EMOTES[n - 1]!.id } : {}) });
    }
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
        const e = creatures.spawn(this.kind, x, z, 1, "cast");
        if (e < 0) return -1;
        const rec = records.byPid.get(ents.pid[e]!)!;
        rec.name = c.name;
        rec.extra.set(COMP_CAST, new TextEncoder().encode(c.id));
        const look = CAST_CATALOGUE.looks.find((l) => l.id === c.look);
        if (look?.colors && rec.genome) look.colors.forEach((col, i) => void (i < rec.genome!.colors.length && (rec.genome!.colors[i] = col)));
        // What it wears, in its gear slots; and what it carries.
        const inv = items.inv(rec);
        for (const w of look?.wear ?? []) {
          const item = reg.index.get(w), slot = item === undefined ? -1 : reg.wearSlot[item]!;
          if (item !== undefined && slot >= 0 && inv.armor >= 0) items.mint(rec, item, 1, 0, 0, inv.armor + slot, "cast");
        }
        for (const [id, n] of Object.entries(a.items ?? {})) {
          const item = reg.index.get(id);
          if (item !== undefined) items.mint(rec, item, n, 0, 0, -1, "cast");
        }
        ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
        ents.yaw[e] = Math.round((yaw / (Math.PI * 2)) * 65536) & 0xffff;
        if (a.temper === "defends") mind.temperOf[e] = TEMPER_DEFENDS;
        emotes.people.add(e);
        return rec.pid;
      },
      remove: (pid) => {
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
        const e = ent(car);
        if (e >= 0) creatures.remove(e);
        records.delete(car);
      },
      door: (car) => {
        const e = ent(car), def = e >= 0 ? reg.vehicle[ents.kind[e]!] : undefined;
        const seat = def?.seats.find((s) => s.driver);
        if (!seat) return null;
        const out = [0, 0, 0];
        this.ctx.urban.door(e, seat, reg.move[this.kind]!.radius, out);
        return { x: out[0]!, z: out[2]! };
      },
      board: (pid, car) => {
        const e = ent(pid), v = ent(car), def = v >= 0 ? reg.vehicle[ents.kind[v]!] : undefined;
        const seat = def?.seats.find((s) => s.driver);
        return e >= 0 && !!seat && this.ctx.urban.seatNpc(e, v, seat.id) === RESULT_OK;
      },
      seated: (pid) => {
        const e = ent(pid);
        return e >= 0 && this.ctx.urban.seatedNpc(e);
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
    };
  }
}
