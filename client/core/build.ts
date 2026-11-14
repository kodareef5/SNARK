// Works out each frame where the building piece in hand would go (shared/world/snap.ts) and whether it may,
// so a ghost can show it. The server checks all of it again when asked.

import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, RESULT_FAR, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, ON_TOP, ROLE_THING, makeAim, obstructed, pickSnap, poseAt, freePose, restPose, tooHigh, turnsOf, type Pose } from "../../shared/world/snap.ts";
import { Support } from "../../shared/world/support.ts";
import type { ClientSession } from "./session.ts";

const NO_TARGET = 0xffffffff;
/** Holding Q this long toggles free placement. */
const HOLD_MS = 350;
/** Palette indices for the ghost. */
export const GHOST_OK = 16;
export const GHOST_BAD = 8;

/** Keyed by the RESULT_ code from the local check or the server. */
export const BUILD_REASONS: Readonly<Record<number, string>> = {
  [RESULT_OBSTRUCTED]: "Something is in the way",
  [RESULT_TOO_HIGH]: "Too far above the ground",
  [RESULT_NO_SUPPORT]: "Nothing would hold it up",
  [RESULT_ENEMY_NEAR]: "Too near another tribe's foundation",
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_NO_SNAP]: "It must join something built",
  [RESULT_FAR]: "Too far away",
};

export class Builder {
  /** A building piece is in hand. */
  active = false;
  /** The structure kind the piece would become, and its pose. problem is 0 if it may go there, else a RESULT_ code. */
  kind = 0;
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  problem = 0;
  /** The server's last refusal for a moment, else the current problem. */
  notice = "";
  /** cycle picks among the nearest places. free means the piece joins nothing. */
  variant = 0;
  turn = 0;
  cycle = 0;
  free = false;
  lift = 0;
  private target = -1;
  private socket = 0;
  /** The piece sits on top of the target at the free point, not in one of its places. */
  private onTop = false;
  private freeX = 0;
  private freeZ = 0;
  private freeYaw = 0;
  private item = 0;
  private readonly aim = makeAim();
  private support: Support | null = null;
  private supportOf: unknown = null;
  private qDownAt = -1;
  private refusal = "";
  private refusalUntil = 0;
  private asked = 0;

  /** The eye is at (ox, oy, oz), looking along the unit direction (dx, dy, dz). `yaw` is the body's facing in radians. */
  update(session: ClientSession, world: CollisionWorld, reg: Registry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number, nowMs: number): void {
    const inv = session.inventory;
    const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    const item = slot >= 0 && inv!.count[slot]! > 0 ? inv!.item[slot]! : 0;
    const forms = reg.places[item] ?? null;
    this.active = forms !== null;
    if (!forms) {
      this.item = 0;
      this.notice = "";
      return;
    }
    if (item !== this.item) {
      this.item = item;
      this.variant = this.turn = this.cycle = this.lift = 0;
      this.free = false;
    }
    if (this.qDownAt >= 0 && nowMs - this.qDownAt >= HOLD_MS) {
      this.free = !this.free;
      this.qDownAt = -2;
    }
    const kind = forms[this.variant % forms.length]!;
    this.kind = kind;
    const structs = world.structs;
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    const looked = hit === HIT_STRUCTURE ? rayHit.ref : -1;
    const aim = this.aim;
    pickSnap(structs, reg, kind, ox, oy, oz, dx, dy, dz, looked, rayHit.t, hit === HIT_TERRAIN, aim);
    let problem = 0;
    this.target = -1;
    this.onTop = false;
    // The free point is where the look ends, facing as the builder does, turned by quarters. Open ground and a thing on a floor use it.
    this.freeX = Math.round(aim.px * STRUCT_UNITS);
    this.freeZ = Math.round(aim.pz * STRUCT_UNITS);
    this.freeYaw = (Math.round((yaw / (2 * Math.PI)) * YAW_UNITS) + this.turn * (YAW_UNITS / 4)) & (YAW_UNITS - 1);
    if (reg.role[kind] === ROLE_THING && looked >= 0) {
      // A thing aimed at a structure rests on top of it where the look is, if it is a floor of the builder's tribe.
      this.target = looked;
      this.onTop = true;
      const t = structs.chunks[Math.floor(looked / 65536)]!;
      if (!restPose(structs, reg, looked, kind, aim.px, aim.pz, this.freeYaw, this.pose)) problem = RESULT_NO_SNAP;
      else if (t.owner[looked & 0xffff] !== session.tribe.team || session.tribe.team === 0) problem = RESULT_NOT_YOURS;
    } else if (!this.free && aim.target >= 0) {
      this.target = aim.target;
      this.socket = aim.order[this.cycle % aim.count]!;
      const t = structs.chunks[Math.floor(aim.target / 65536)]!;
      if (!poseAt(structs, reg, aim.target, kind, this.socket, this.turn, this.pose)) problem = RESULT_NO_SNAP;
      else if (t.owner[aim.target & 0xffff] !== session.tribe.team || session.tribe.team === 0) problem = RESULT_NOT_YOURS;
    } else {
      if (!aim.ground || !freePose((x, z) => world.hf.heightAt(x, z), reg, kind, aim.px, aim.pz, this.freeYaw, this.lift, this.pose)) problem = RESULT_NO_SNAP;
    }
    const p = this.pose;
    if (problem === 0) {
      const px = p.x / STRUCT_UNITS;
      const py = p.y / STRUCT_UNITS;
      const pz = p.z / STRUCT_UNITS;
      if (tooHigh((x, z) => world.hf.heightAt(x, z), reg, kind, p)) problem = RESULT_TOO_HIGH;
      else if (obstructed(structs, reg.parts, kind, px, py, pz, p.yaw)) problem = RESULT_OBSTRUCTED;
      else {
        if (this.supportOf !== structs) {
          this.supportOf = structs;
          this.support = new Support(structs, reg, (x, z) => world.hf.heightAt(x, z));
        }
        if (!this.support!.stands(kind, p.x, p.y, p.z, p.yaw)) problem = RESULT_NO_SUPPORT;
      }
    }
    this.problem = problem;
    this.notice = nowMs < this.refusalUntil ? this.refusal : (BUILD_REASONS[problem] ?? "");
  }

  /** Returns true if building took the key. */
  key(code: string, down: boolean, repeat: boolean, nowMs: number, reg: Registry): boolean {
    if (!this.active) return false;
    if (code === "KeyQ") {
      if (down && !repeat) this.qDownAt = nowMs;
      // Released before it counted as held, so it picks the next nearest place.
      else if (!down && this.qDownAt >= 0) this.cycle++;
      if (!down) this.qDownAt = -1;
      return true;
    }
    if (code !== "KeyE" && code !== "KeyR" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if (!down) return true;
    if (code === "KeyE" && !repeat) {
      // In a place the piece turns as many ways as its role allows. On open ground it turns by quarters.
      const ways = this.target >= 0 && !this.onTop ? turnsOf(reg.role[this.kind]!) : 4;
      this.turn = (this.turn + 1) % ways;
    } else if (code === "KeyR" && !repeat) {
      this.variant++;
      this.turn = 0;
    } else if (code === "ArrowUp") this.lift = Math.min(LIFT_MAX, this.lift + 1);
    else if (code === "ArrowDown") this.lift = Math.max(LIFT_MIN, this.lift - 1);
    return true;
  }

  /** Returns the command's sequence number, or 0 if nothing was sent. */
  place(session: ClientSession, reg: Registry): number {
    if (!this.active || this.problem === RESULT_NO_SNAP) return 0;
    const forms = reg.places[this.item]!;
    const variant = this.variant % forms.length;
    const target = this.target;
    this.asked = session.command(CMD_PLACE, (w: BitWriter) => {
      w.u8(variant);
      if (target >= 0) {
        w.u32(target);
        w.u8(this.onTop ? ON_TOP : this.socket);
        if (this.onTop) {
          w.sbits(this.freeX, 32);
          w.sbits(this.freeZ, 32);
          w.u16(this.freeYaw);
        }
      } else {
        w.u32(NO_TARGET);
        w.sbits(this.freeX, 32);
        w.sbits(this.freeZ, 32);
        w.u16(this.freeYaw);
        w.sbits(this.lift, 8);
      }
      w.u8(this.turn);
    });
    return this.asked;
  }

  /** A refusal of the piece last asked for shows its reason for a while. */
  result(seq: number, code: number, nowMs: number): void {
    if (seq !== this.asked || seq === 0) return;
    this.asked = 0;
    if (code === RESULT_OK) {
      // The next piece starts from the nearest place again.
      this.cycle = 0;
      return;
    }
    this.refusal = BUILD_REASONS[code] ?? "It cannot be built there";
    this.refusalUntil = nowMs + 2500;
  }
}
