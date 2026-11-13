// Building, as the one doing it sees it: where the piece in hand would go.
//
// While a survivor holds a building piece, this works out every frame what
// its look chooses (shared/world/snap.ts: the piece looked at, or the nearest
// with a place for it, or open ground), where that puts the piece, and
// whether anything is against it, so that the piece can be shown there before
// it is built and the reason said if it cannot be. The server works all of it
// out again when asked; what is shown here is a promise of nothing.
//
// E turns the piece in its place. Q takes the next nearest place; held, it
// lets go of other pieces altogether and sets the piece on open ground. R
// changes its form (a wall, a doorframe, a windowframe). The arrow keys raise
// and lower a foundation set on open ground.

import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, RESULT_FAR, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, makeAim, obstructed, pickSnap, poseAt, freePose, tooHigh, turnsOf, type Pose } from "../../shared/world/snap.ts";
import type { ClientSession } from "./session.ts";

const NO_TARGET = 0xffffffff;
/** How long Q is held before it means "no snapping", in milliseconds. */
const HOLD_MS = 350;
/** The piece is shown in one of these palette colours: where it may go, and where it may not. */
export const GHOST_OK = 16;
export const GHOST_BAD = 8;

/** What to say when a piece cannot be set down, by the code the check or the server gives. */
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
  /** The structure the piece would become, where, and whether it may: 0 if so, else why not (a RESULT_ code). */
  kind = 0;
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  problem = 0;
  /** What is said under the crosshair: the last refusal for a moment, or what is against the piece now. */
  notice = "";
  /** Which form of the piece, how it is turned, which of the nearest places, whether it joins nothing, and how far it is raised. */
  variant = 0;
  turn = 0;
  cycle = 0;
  free = false;
  lift = 0;
  private target = -1;
  private socket = 0;
  private freeX = 0;
  private freeZ = 0;
  private freeYaw = 0;
  private item = 0;
  private readonly aim = makeAim();
  private qDownAt = -1;
  private refusal = "";
  private refusalUntil = 0;
  private asked = 0;

  /**
   * Work out where the piece in hand would go, for an eye at (ox, oy, oz)
   * looking along the unit direction (dx, dy, dz) with the body facing `yaw`
   * (radians).
   */
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
      // Another piece in hand: it starts as itself, unturned.
      this.item = item;
      this.variant = this.turn = this.cycle = this.lift = 0;
      this.free = false;
    }
    // Q held long enough lets go of other pieces.
    if (this.qDownAt >= 0 && nowMs - this.qDownAt >= HOLD_MS) {
      this.free = !this.free;
      this.qDownAt = -2;
    }
    const kind = forms[this.variant % forms.length]!;
    this.kind = kind;
    const structs = world.structs;
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    const aim = this.aim;
    pickSnap(structs, reg, kind, ox, oy, oz, dx, dy, dz, hit === HIT_STRUCTURE ? rayHit.ref : -1, rayHit.t, hit === HIT_TERRAIN, aim);
    let problem = 0;
    this.target = -1;
    if (!this.free && aim.target >= 0) {
      this.target = aim.target;
      this.socket = aim.order[this.cycle % aim.count]!;
      const t = structs.chunks[Math.floor(aim.target / 65536)]!;
      if (!poseAt(structs, reg, aim.target, kind, this.socket, this.turn, this.pose)) problem = RESULT_NO_SNAP;
      else if (t.owner[aim.target & 0xffff] !== session.tribe.team || session.tribe.team === 0) problem = RESULT_NOT_YOURS;
    } else {
      // Open ground, where the look meets it, facing the way the builder does and turned by quarters.
      this.freeX = Math.round(aim.px * STRUCT_UNITS);
      this.freeZ = Math.round(aim.pz * STRUCT_UNITS);
      this.freeYaw = (Math.round((yaw / (2 * Math.PI)) * YAW_UNITS) + this.turn * (YAW_UNITS / 4)) & (YAW_UNITS - 1);
      if (!aim.ground || !freePose((x, z) => world.hf.heightAt(x, z), reg, kind, aim.px, aim.pz, this.freeYaw, this.lift, this.pose)) problem = RESULT_NO_SNAP;
    }
    const p = this.pose;
    if (problem === 0) {
      const px = p.x / STRUCT_UNITS;
      const py = p.y / STRUCT_UNITS;
      const pz = p.z / STRUCT_UNITS;
      if (tooHigh((x, z) => world.hf.heightAt(x, z), reg, kind, p)) problem = RESULT_TOO_HIGH;
      else if (obstructed(structs, reg.parts, kind, px, py, pz, p.yaw)) problem = RESULT_OBSTRUCTED;
    }
    this.problem = problem;
    this.notice = nowMs < this.refusalUntil ? this.refusal : (BUILD_REASONS[problem] ?? "");
  }

  /** A key while a piece is in hand. Returns true if it was one of building's. */
  key(code: string, down: boolean, repeat: boolean, nowMs: number, reg: Registry): boolean {
    if (!this.active) return false;
    if (code === "KeyQ") {
      if (down && !repeat) this.qDownAt = nowMs;
      // Let go before it counted as held: the next nearest place.
      else if (!down && this.qDownAt >= 0) this.cycle++;
      if (!down) this.qDownAt = -1;
      return true;
    }
    if (code !== "KeyE" && code !== "KeyR" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if (!down) return true;
    if (code === "KeyE" && !repeat) {
      // In a place, as many ways as the piece has; on open ground, a quarter at a time.
      const ways = this.target >= 0 ? turnsOf(reg.role[this.kind]!) : 4;
      this.turn = (this.turn + 1) % ways;
    } else if (code === "KeyR" && !repeat) {
      this.variant++;
      this.turn = 0;
    } else if (code === "ArrowUp") this.lift = Math.min(LIFT_MAX, this.lift + 1);
    else if (code === "ArrowDown") this.lift = Math.max(LIFT_MIN, this.lift - 1);
    return true;
  }

  /** The primary button: ask the server to set the piece down where it is shown. Returns the command's number, or 0 if nothing was asked. */
  place(session: ClientSession, reg: Registry): number {
    if (!this.active || this.problem === RESULT_NO_SNAP) return 0;
    const forms = reg.places[this.item]!;
    const variant = this.variant % forms.length;
    const target = this.target;
    this.asked = session.command(CMD_PLACE, (w: BitWriter) => {
      w.u8(variant);
      if (target >= 0) {
        w.u32(target);
        w.u8(this.socket);
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

  /** The server answered a command. If it was a refusal of the piece last asked for, the reason is shown for a while. */
  result(seq: number, code: number, nowMs: number): void {
    if (seq !== this.asked || seq === 0) return;
    this.asked = 0;
    if (code === RESULT_OK) {
      // Set down: the next piece starts from the nearest place again.
      this.cycle = 0;
      return;
    }
    this.refusal = BUILD_REASONS[code] ?? "It cannot be built there";
    this.refusalUntil = nowMs + 2500;
  }
}
