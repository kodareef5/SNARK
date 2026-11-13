// Building: setting pieces down.
//
// A survivor holding a building piece asks to set it down: on open ground, or
// joined to a piece already built. The client says which piece it joins and
// which of that piece's places; where that puts the new piece is worked out
// here, from the server's own rows, with the same arithmetic the client used
// to show it (shared/world/snap.ts). Every rule is judged here: that the
// place exists, that it is within reach, that what it joins is the builder's
// tribe's, that a foundation is not left in the air, that nothing built and
// nobody is in the way. A refusal says which, so the screen can.

import { STRUCT_UNITS } from "../shared/coords.ts";
import type { StructureDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { RESULT_DENIED, RESULT_ENEMY_NEAR, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TOO_HIGH, SESSION_ALIVE } from "../shared/net/protocol.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { capsuleKind } from "../shared/world/collide.ts";
import { BUILD_REACH, ROLE_FOUNDATION, ROLE_PILLAR, freePose, obstructed, poseAt, tooHigh, type Pose } from "../shared/world/snap.ts";
import { Collapse } from "../shared/world/collapse.ts";
import { GONE_FELL } from "../shared/world/structures.ts";
import { Support } from "../shared/world/support.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** A target of this in a place command means open ground. */
export const NO_TARGET = 0xffffffff;
/** How far the middle of a piece may be from the eye of whoever sets it down: reach, and the piece's own size. */
const REACH = BUILD_REACH + 3;
/** A body this far into where a piece would stand is in its way. */
const BODY_SLACK = 0.1;
/** Nothing is built this near a foundation another tribe laid, or this near a pillar it stood on the ground: metres. */
export const ENEMY_FOUNDATION = 50;
export const ENEMY_PILLAR = 10;
/**
 * Work a collapse may do in one tick, in the units shared/world/collapse.ts
 * counts: about a millisecond. A greater collapse takes more ticks.
 */
const COLLAPSE_WORK = 16000;

export interface BuildContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly tribes: Tribes;
}

export class Build {
  /** Pieces set down, requests refused, and pieces that fell when what held them went. */
  placed = 0;
  refused = 0;
  fallen = 0;
  /** Where the last piece set down is: its ref. */
  last = -1;
  /** What holds what up, asked of the rows: for a piece about to be built. */
  readonly support: Support;
  /** What comes down when something that held it goes. */
  readonly collapse: Collapse;
  private readonly ctx: BuildContext;
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(ctx: BuildContext) {
    this.ctx = ctx;
    const world = ctx.world;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.support = new Support(structs, world.reg, heightAt);
    this.collapse = new Collapse(structs, world.reg, heightAt);
    // Whatever is taken away, by whatever means: what it held may have nothing left to stand on.
    // (What falls is the collapse's own doing, and it knows.)
    structs.onRemove = (ref, cause) => {
      if (cause !== GONE_FELL) this.collapse.gone(ref);
    };
  }

  /** Pieces whose support is still to be looked at. */
  get pending(): number {
    return this.collapse.pending;
  }

  /** Once a tick: a little more of whatever collapse is under way. */
  step(): void {
    if (this.collapse.busy) this.fallen += this.collapse.step(COLLAPSE_WORK, this.ctx.world.tick);
  }

  /** Whether a piece at (x, z) would be too near what another team has founded. */
  private enemyNear(team: number, x: number, z: number): boolean {
    const world = this.ctx.world;
    const structs = world.structs;
    const role = world.reg.role;
    const dims = world.dims;
    const cx0 = Math.max(0, Math.floor((x - ENEMY_FOUNDATION) / 64));
    const cx1 = Math.min(dims.chunksX - 1, Math.floor((x + ENEMY_FOUNDATION) / 64));
    const cz0 = Math.max(0, Math.floor((z - ENEMY_FOUNDATION) / 64));
    const cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + ENEMY_FOUNDATION) / 64));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const t = structs.chunks[cz * dims.chunksX + cx];
        if (!t) continue;
        for (let s = 0; s < t.high; s++) {
          const owner = t.owner[s]!;
          if (owner === 0 || owner === team) continue;
          const r = role[t.kind[s]!]!;
          if (r !== ROLE_FOUNDATION && r !== ROLE_PILLAR) continue;
          const reach = r === ROLE_FOUNDATION ? ENEMY_FOUNDATION : ENEMY_PILLAR;
          const dx = t.x[s]! - x;
          const dz = t.z[s]! - z;
          if (dx * dx + dz * dz < reach * reach) return true;
        }
      }
    }
    return false;
  }

  /** A session asks to set down the piece in its hands. Returns a result code. */
  place(c: Client, r: BitReader): number {
    const variant = r.u8();
    const target = r.u32();
    let socket = 0;
    let x = 0;
    let z = 0;
    let yaw = 0;
    let lift = 0;
    if (target === NO_TARGET) {
      x = r.sbits(32);
      z = r.sbits(32);
      yaw = r.u16();
      lift = r.sbits(8);
    } else socket = r.u8();
    const turn = r.u8();
    if (r.overflow) return RESULT_INVALID;
    const code = this.set(c, variant, target, socket, turn, x, z, yaw, lift);
    if (code === RESULT_OK) this.placed++;
    else this.refused++;
    return code;
  }

  /** Judge a request and, if nothing is against it, build the piece and take it from the builder's hands. */
  set(c: Client, variant: number, target: number, socket: number, turn: number, x: number, z: number, yaw: number, lift: number): number {
    const { world, records, items, tribes } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out) return RESULT_DENIED;
    // What is in its hands, and the form of it asked for.
    const inv = items.inv(rec);
    const slot = rec.held >= 0 ? inv.hotbar + rec.held : -1;
    const forms = slot >= 0 && inv.count[slot]! > 0 ? reg.places[inv.item[slot]!] : null;
    if (!forms || variant >= forms.length) return RESULT_INVALID;
    const kind = forms[variant]!;
    const structs = world.structs;
    const pose = this.pose;
    if (target === NO_TARGET) {
      // Open ground: only what stands on the ground by itself, and only on the map.
      const px = x / STRUCT_UNITS;
      const pz = z / STRUCT_UNITS;
      if (!(px > 2 && pz > 2 && px < world.hf.sizeX - 2 && pz < world.hf.sizeZ - 2)) return RESULT_INVALID;
      if (!freePose((gx, gz) => world.hf.heightAt(gx, gz), reg, kind, px, pz, yaw, lift, pose)) return RESULT_NO_SNAP;
    } else {
      const t = structs.chunks[Math.floor(target / 65536)];
      const ts = target & 0xffff;
      if (!t || ts >= t.high || t.kind[ts] === 0) return RESULT_NO_SNAP;
      // A piece joins only what its builder's tribe built.
      if (!tribes.may(rec, t.owner[ts]!)) return RESULT_NOT_YOURS;
      if (!poseAt(structs, reg, target, kind, socket, turn, pose)) return RESULT_NO_SNAP;
    }
    const px = pose.x / STRUCT_UNITS;
    const py = pose.y / STRUCT_UNITS;
    const pz = pose.z / STRUCT_UNITS;
    // Within reach of the eye the server has for this survivor, whatever the client's was.
    const e = c.ent;
    const ex = ents.x[e]! - px;
    const ey = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!) - py;
    const ez = ents.z[e]! - pz;
    if (ex * ex + ey * ey + ez * ez > REACH * REACH) return RESULT_FAR;
    if (tooHigh((gx, gz) => world.hf.heightAt(gx, gz), reg, kind, pose)) return RESULT_TOO_HIGH;
    if (obstructed(structs, reg.parts, kind, px, py, pz, pose.yaw) || this.bodyIn(kind, px, py, pz, pose.yaw)) return RESULT_OBSTRUCTED;
    if (this.enemyNear(rec.team, px, pz)) return RESULT_ENEMY_NEAR;
    if (!this.support.stands(kind, pose.x, pose.y, pose.z, pose.yaw)) return RESULT_NO_SUPPORT;
    const def = reg.defs[kind] as StructureDef;
    const ref = structs.add(kind, px, py, pz, pose.yaw, rec.team, def.hp);
    if (ref < 0) return RESULT_FULL;
    // One fewer in the hand.
    items.burn(rec, slot, 1);
    this.last = ref;
    this.collapse.built();
    this.onPlaced?.(rec, ref);
    return RESULT_OK;
  }

  /** Called with each piece set down and who set it. */
  onPlaced: ((by: EntityRecord, ref: number) => void) | null = null;

  /** Whether anything alive stands where a piece of `kind` at this pose would be. */
  private bodyIn(kind: number, x: number, y: number, z: number, yaw: number): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    const cx = Math.floor(x / 64);
    const cz = Math.floor(z / 64);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (cx + ox < 0 || cz + oz < 0 || cx + ox >= dims.chunksX || cz + oz >= dims.chunksZ) continue;
        for (let i = ents.chunkHead[(cz + oz) * dims.chunksX + cx + ox]!; i >= 0; i = ents.next[i]!) {
          if ((ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
          const k = ents.kind[i]!;
          if (capsuleKind(reg.parts, kind, x, y, z, yaw, ents.x[i]!, ents.y[i]!, ents.z[i]!, reg.bodyRadius[k]!, reg.bodyHeight[k]!, BODY_SLACK)) return true;
        }
      }
    }
    return false;
  }
}
