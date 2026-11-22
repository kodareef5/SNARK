// Survivors' emotes (shared/anim/emotes.ts): what each plays and since when, sent as its emote word beside its pose
// (EntityStore.emote, AnimState.packEmote). A body plays an emote standing or crouched on the ground, its hands free; a
// whole-body one ends as it moves, any ends as it swims, falls, rides, carries or attacks, a one-shot at its clip's end,
// a loop with a time when that is up. A pair begins only when both ask: one asks with the other as its target (an
// invite, told to the other), and the other answers with the pair's other side (or the same) within INVITE_TICKS. The
// two are then stood `apart` metres face to face about the point between them and begin on one tick, and each keeps
// facing the other until it ends; either moving ends both. Joining a dance plays it from the same first tick as the
// one joined, so they are in step.

import { EMOTES, EMOTE_NUMBER, emoteOf, type EmoteDef } from "../shared/anim/emotes.ts";
import { AnimState, EMOTE_LEAD, EMOTE_PARTNER, EMOTE_SOLO } from "../shared/anim/pose.ts";
import { TAU, detAtan2 } from "../shared/math/scalar.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OK, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { MODE_WALK, STANCE_PRONE } from "../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED, F_PLAYER } from "../shared/sim/entities.ts";
import { ACT_NONE, HOLD_CARRY } from "../shared/sim/weapon.ts";
import { groundUnder } from "../shared/world/collide.ts";
import type { Client, GameServer } from "./game.ts";
import { placeFree } from "./place.ts";
import type { ServerWorld } from "./world.ts";

/** CMD_EMOTE's ops: play an emote (an invite, with a target and a pair), stop the one playing, join another's. */
export const EMOTE_PLAY = 0;
export const EMOTE_STOP = 1;
export const EMOTE_JOIN = 2;
/** An answer to an invite must come within 8 seconds, from within INVITE_RANGE metres. */
const INVITE_TICKS = 240;
const INVITE_RANGE = 4;
/** A dance is joined from within 15 metres. */
const JOIN_RANGE = 15;
/** Ticks between one survivor's emotes. */
const EMOTE_GAP = 10;

interface Playing {
  e: number;
  gen: number;
  n: number;
  /** The full first tick, and the last (Infinity for a loop with no time). */
  start: number;
  end: number;
  /** A pair's other body and the yaw it holds facing it, or -1. */
  partner: number;
  yaw: number;
}

export interface EmoteContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
}

export class Emotes {
  readonly ctx: EmoteContext;
  played = 0;
  paired = 0;
  private readonly playing = new Map<number, Playing>();
  /** Bodies that are not survivors but may emote: Cast's people (server/cast/stage.ts), by entity index. */
  readonly people = new Set<number>();
  /** Invites by the body invited: from whom, which emote, until when. */
  private readonly invites = new Map<number, { from: number; gen: number; n: number; until: number }>();
  private readonly lastAt = new Map<number, number>();
  private readonly st = new AnimState();

  constructor(ctx: EmoteContext) {
    this.ctx = ctx;
  }

  /** The emote entity `e` is playing (its number), or 0. */
  playingOf(e: number): number {
    return this.playing.get(e)?.n ?? 0;
  }

  /** Who has invited `e` to a pair and to which emote, or null. */
  inviteOf(e: number): { from: number; n: number } | null {
    const i = this.invites.get(e);
    return i && i.until > this.ctx.world.tick ? { from: i.from, n: i.n } : null;
  }

  /** CMD_EMOTE: op 2 bits, the emote's number u16, and the target entity plus one (0 for none) as a varint. */
  command(c: Client, r: BitReader): number {
    const op = r.bits(2);
    const n = r.u16();
    const target = r.varint() - 1;
    if (r.overflow || c.ent < 0) return RESULT_INVALID;
    return this.request(c.ent, op, n, target);
  }

  /** What a survivor asks: play `n` (at `target` for a pair), stop, or join `target`'s dance. */
  request(e: number, op: number, n: number, target = -1): number {
    const world = this.ctx.world, ents = world.ents;
    if (op === EMOTE_STOP) {
      this.stop(e);
      return RESULT_OK;
    }
    const tick = world.tick;
    if ((this.lastAt.get(e) ?? -Infinity) + EMOTE_GAP > tick) return RESULT_BUSY;
    if (op === EMOTE_JOIN) {
      const leader = this.playing.get(target);
      const def = leader ? emoteOf(leader.n) : null;
      if (!leader || !def?.group) return RESULT_INVALID;
      if (this.distance(e, target) > JOIN_RANGE) return RESULT_FAR;
      if (!this.free(e, def)) return RESULT_DENIED;
      this.lastAt.set(e, tick);
      this.begin(e, leader.n, leader.start, EMOTE_SOLO, -1, 0);
      return RESULT_OK;
    }
    const def = emoteOf(n);
    if (!def || !this.ctx.world.anim.emotes[n]) return RESULT_INVALID;
    if (!this.free(e, def)) return RESULT_DENIED;
    this.lastAt.set(e, tick);
    if (!def.pair) {
      this.begin(e, n, tick, EMOTE_SOLO, -1, 0);
      return RESULT_OK;
    }
    // A pair: an answer to an invite begins it; anything else is an invite.
    if (target < 0 || target === e || (ents.flags[target]! & (F_ALIVE | F_PLAYER)) !== (F_ALIVE | F_PLAYER)) return RESULT_INVALID;
    if (this.distance(e, target) > INVITE_RANGE) return RESULT_FAR;
    const asked = this.invites.get(e);
    if (asked && asked.from === target && asked.until > tick && ents.gen[target] === asked.gen) {
      const theirs = emoteOf(asked.n)!;
      if (n === asked.n || theirs.pair?.with === def.id) {
        this.invites.delete(e);
        return this.pair(target, asked.n, e) ? RESULT_OK : RESULT_DENIED;
      }
    }
    if (!this.free(target, def)) return RESULT_DENIED;
    this.invites.set(target, { from: e, gen: ents.gen[e]!, n, until: tick + INVITE_TICKS });
    const them = this.clientOf(target), me = this.clientOf(e);
    if (them) this.ctx.game.sendText(them, TEXT_NOTICE, `${me?.name || "Someone"} would like a ${def.name.toLowerCase()} with you: emote ${EMOTES[EMOTE_NUMBER.get(def.pair.with)! - 1]!.id} back to them to join in`);
    return RESULT_OK;
  }

  /** Ends what `e` plays, and its partner's. */
  stop(e: number): void {
    const p = this.playing.get(e);
    if (!p) return;
    this.playing.delete(e);
    this.ctx.world.ents.emote[e] = 0;
    if (p.partner >= 0 && this.playing.get(p.partner)?.partner === e) this.stop(p.partner);
  }

  /** Each tick, after movement: ends what may no longer play, and holds a pair facing each other. */
  step(): void {
    const world = this.ctx.world, ents = world.ents, tick = world.tick;
    for (const [to, i] of this.invites) if (i.until <= tick) this.invites.delete(to);
    for (const p of [...this.playing.values()]) {
      const e = p.e;
      const def = emoteOf(p.n)!;
      if (ents.gen[e] !== p.gen || !this.free(e, def, true) || tick > p.end) {
        this.stop(e);
        continue;
      }
      if (p.partner >= 0 && ents.yaw[e] !== p.yaw) ents.yaw[e] = p.yaw;
    }
  }

  // --- Within -------------------------------------------------------------------------------------------------------

  /** Whether `e` may play `def` now: alive, on the ground, not swimming, riding, carrying or acting; still, unless it may move. */
  private free(e: number, def: EmoteDef, playing = false): boolean {
    const ents = this.ctx.world.ents;
    if ((ents.flags[e]! & (F_ALIVE | F_GROUNDED)) !== (F_ALIVE | F_GROUNDED)) return false;
    if ((ents.flags[e]! & F_PLAYER) === 0 && !this.people.has(e)) return false;
    if (ents.mode[e] !== MODE_WALK || ents.seat[e] !== 0 || ents.stance[e] === STANCE_PRONE || ents.hold[e] === HOLD_CARRY) return false;
    if (ents.act[e] !== ACT_NONE) return false;
    if (!def.moving) {
      const speed = Math.sqrt(ents.vx[e]! * ents.vx[e]! + ents.vz[e]! * ents.vz[e]!);
      if (speed > (playing ? 0.6 : 0.3)) return false;
    }
    return true;
  }

  private begin(e: number, n: number, start: number, role: number, partner: number, yaw: number): void {
    const ents = this.ctx.world.ents;
    const def = emoteOf(n)!;
    const clip = this.ctx.world.anim.emotes[n]!;
    const end = def.loop ? (def.seconds > 0 ? start + def.seconds * 30 : Infinity) : start + clip.frames;
    this.playing.set(e, { e, gen: ents.gen[e]!, n, start, end, partner, yaw });
    const st = this.st;
    st.emote = n;
    st.emoteStart = start & 0xffff;
    st.emoteRole = role;
    st.emoteMirror = false;
    ents.emote[e] = st.packEmote();
    this.played++;
  }

  /** Stands the two face to face about the point between them, `apart` metres, and begins both on one tick. */
  private pair(a: number, n: number, b: number): boolean {
    const world = this.ctx.world, ents = world.ents;
    const def = emoteOf(n)!;
    const other = EMOTE_NUMBER.get(def.pair!.with) ?? n;
    const [ax, az, bx, bz] = [ents.x[a]!, ents.z[a]!, ents.x[b]!, ents.z[b]!];
    let dx = bx - ax, dz = bz - az;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) (dx = 0), (dz = 1);
    else (dx /= d), (dz /= d);
    const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
    const half = def.pair!.apart / 2;
    const spots: [number, number, number][] = [[a, mx - dx * half, mz - dz * half], [b, mx + dx * half, mz + dz * half]];
    for (const [e, x, z] of spots) {
      const p = world.reg.move[ents.kind[e]!]!;
      if (!placeFree(world, x, groundUnder(world.hf, x, z, p.radius), z, p.radius, p.height)) return false;
    }
    for (const [e, x, z] of spots) {
      const p = world.reg.move[ents.kind[e]!]!;
      ents.setPosition(e, x, groundUnder(world.hf, x, z, p.radius), z);
      world.history.discontinuity(e);
      ents.vx[e] = ents.vz[e] = 0;
    }
    // Each faces the other: a body's +Z is (sin yaw, cos yaw).
    const units = (rad: number): number => Math.round((rad / TAU) * 65536) & 0xffff;
    const yawA = units(detAtan2(dx, dz)), yawB = units(detAtan2(-dx, -dz));
    ents.yaw[a] = yawA;
    ents.yaw[b] = yawB;
    const start = world.tick + 1;
    this.begin(a, n, start, EMOTE_LEAD, b, yawA);
    this.begin(b, other, start, EMOTE_PARTNER, a, yawB);
    this.paired++;
    return true;
  }

  private distance(a: number, b: number): number {
    const ents = this.ctx.world.ents;
    const dx = ents.x[a]! - ents.x[b]!, dz = ents.z[a]! - ents.z[b]!;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private clientOf(e: number): Client | null {
    for (const c of this.ctx.game.clients) if (c && c.ent === e) return c;
    return null;
  }
}
