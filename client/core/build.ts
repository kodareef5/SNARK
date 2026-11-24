// Works out each frame where the building piece in hand would go (shared/world/snap.ts) and whether it may,
// so a ghost can show it. The server checks all of it again when asked.

import { G_BUILD, type KeyContext, type KeyRow } from "./key-row.ts";
import { T_CANCEL, T_FOLLOW_ONE, T_LOWER, T_RAISE, T_RELOAD, T_SNAP } from "./touch.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { handleIndex } from "../../shared/ids.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_FAR, RESULT_FULL, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import { HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { capsuleKind, type CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, ON_TOP, ROLE_THING, enemyGap, enemyGapFound, makeAim, obstructed, obstruction, pickSnap, poseAt, freePose, restPose, tooHigh, turnsOf, type Pose } from "../../shared/world/snap.ts";
import { Support } from "../../shared/world/support.ts";
import type { ClientSession } from "./session.ts";
import { structName } from "./ui/structure.ts";

const NO_TARGET = 0xffffffff;
/** Holding Q this long toggles free placement. */
const HOLD_MS = 350;
/** A piece put away is hidden at once, and shown again if the server has not agreed by then. */
const AWAY_MS = 1000;
/** Metres. These match the server's REACH, BODY_SLACK, ENEMY_FOUNDATION and ENEMY_PILLAR (server/build.ts). */
export const PLACE_REACH = BUILD_REACH + 3;
const BODY_SLACK = 0.1;
export const ENEMY_FOUNDATION = 50;
export const ENEMY_PILLAR = 10;
/** Palette indices for the ghost. */
export const GHOST_OK = 16;
export const GHOST_BAD = 8;

/** Keyed by the RESULT_ code from the local check or the server: what is said where no cause is known. */
export const BUILD_REASONS: Readonly<Record<number, string>> = {
  [RESULT_OBSTRUCTED]: "Something is in the way",
  [RESULT_BODY]: "Someone is in the way",
  [RESULT_TOO_HIGH]: "Too far above the ground",
  [RESULT_NO_SUPPORT]: "Nothing would hold it up",
  [RESULT_ENEMY_NEAR]: "Too near another tribe's foundation",
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_NO_SNAP]: "It must join something built",
  [RESULT_FAR]: "Too far away",
  [RESULT_SHORT]: "You have none left",
  [RESULT_FULL]: "This area holds no more pieces",
};

/** What stands in a piece's way, as S_PLACED tells it and the preview finds it: a PLACED_ detail and its numbers. */
export interface Blocker {
  detail: number;
  a: number;
  b: number;
}

/**
 * Why a piece may not go where it was asked, naming the cause where one is known: the piece or the body in the way, or
 * the metres to another tribe's foundation. `nameOf` gives a body's name by its entity index, "" for one not in view.
 */
export function buildReason(reg: Registry, session: ClientSession, code: number, by: Blocker, nameOf?: (entity: number) => string): string {
  if (code === RESULT_OBSTRUCTED && by.detail === PLACED_STRUCTURE) {
    const t = session.world?.structs.chunks[Math.floor(by.a / 65536)];
    const kind = t && (by.a & 0xffff) < t.high ? t.kind[by.a & 0xffff]! : 0;
    if (kind !== 0) return `Blocked by ${structName(reg, kind)}`;
  }
  if (code === RESULT_BODY && by.detail === PLACED_ENTITY) {
    if (by.a === handleIndex(session.ownHandle)) return "You are standing in the way";
    const name = nameOf?.(by.a) ?? "";
    if (name !== "") return `Blocked by ${name}`;
  }
  if (code === RESULT_ENEMY_NEAR && by.detail === PLACED_METRES) return `${by.a} m from another tribe's ${by.b <= ENEMY_PILLAR ? "pillar" : "foundation"}; ${by.b} needed`;
  return BUILD_REASONS[code] ?? "It cannot be built there";
}

export class Builder {
  /** A building piece is in hand. */
  active = false;
  /** The structure kind the piece would become, and its pose. problem is 0 if it may go there, else a RESULT_ code. */
  kind = 0;
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  problem = 0;
  /** The server's last refusal for a moment, else the current problem. */
  notice = "";
  /** What is in the way of the piece where it is shown, for `problem`. */
  readonly by: Blocker = { detail: PLACED_NONE, a: 0, b: 0 };
  /** How many of an item have been set down and not yet taken from the inventory (PredictBuild.pending). */
  pending: ((item: number) => number) | null = null;
  /** The item in hand that places a piece, or 0. */
  get inHand(): number { return this.item; }
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
  /** The last question support was asked (kind, pose, the store's shapes) and its answer, 1 if it stands. */
  private readonly stood = new Float64Array(7).fill(-1);
  /** The same for the other tribes' foundations near: the place, the team and the store's shapes, then 1 if one is too near, its metres and what it needs. */
  private readonly near = new Float64Array(7).fill(-1);
  /** The problem and its cause the notice was last worded for. */
  private readonly worded = [-1, -1, -1, -1];
  private words = "";
  private qDownAt = -1;
  /** The structure the look is on within BUILD_REACH, or -1: what a pick takes. */
  looked = -1;
  /** The hotbar slot put away and when, until the server agrees. */
  private awaySlot = -1;
  private awayAt = 0;
  /** The form a pick asked for, taken once its item is in hand. */
  private wantItem = 0;
  private wantVariant = 0;
  /** Wheel travel not yet a whole notch. */
  private wheel = 0;
  private refusal = "";
  private refusalUntil = 0;
  private asked = 0;

  /** The eye is at (ox, oy, oz), looking along the unit direction (dx, dy, dz). `yaw` is the body's facing in radians. */
  update(session: ClientSession, world: CollisionWorld, reg: Registry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number, nowMs: number): void {
    const inv = session.inventory;
    const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    const item = slot >= 0 && inv!.count[slot]! > 0 ? inv!.item[slot]! : 0;
    if (this.awaySlot >= 0 && (session.held !== this.awaySlot || nowMs - this.awayAt >= AWAY_MS)) this.awaySlot = -1;
    const forms = this.awaySlot >= 0 ? null : (reg.places[item] ?? null);
    this.active = forms !== null;
    if (!forms) {
      this.item = 0;
      this.notice = "";
      this.looked = -1;
      return;
    }
    if (item !== this.item) {
      this.item = item;
      this.variant = this.turn = this.cycle = this.lift = 0;
      this.free = false;
      if (item === this.wantItem) this.variant = this.wantVariant;
      this.wantItem = 0;
    }
    if (this.qDownAt >= 0 && nowMs - this.qDownAt >= HOLD_MS) {
      this.free = !this.free;
      this.qDownAt = -2;
    }
    const kind = forms[this.variant % forms.length]!;
    this.kind = kind;
    const structs = world.structs;
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    const looked = (this.looked = hit === HIT_STRUCTURE ? rayHit.ref : -1);
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
      // A bed is set only on a floor.
      if (!aim.ground || (reg.defs[kind] as StructureDef).floor === true || !freePose((x, z) => world.hf.heightAt(x, z), reg, kind, aim.px, aim.pz, this.freeYaw, this.lift, this.pose)) problem = RESULT_NO_SNAP;
    }
    const p = this.pose;
    const by = this.by;
    by.detail = PLACED_NONE;
    if (problem === 0) {
      const px = p.x / STRUCT_UNITS;
      const py = p.y / STRUCT_UNITS;
      const pz = p.z / STRUCT_UNITS;
      const own = session.own;
      // In the server's order, so the first thing wrong here is the one it would name.
      if ((px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2 > PLACE_REACH * PLACE_REACH) problem = RESULT_FAR;
      else if (tooHigh((x, z) => world.hf.heightAt(x, z), reg, kind, p)) problem = RESULT_TOO_HIGH;
      else if (obstructed(structs, reg.parts, kind, px, py, pz, p.yaw)) {
        problem = RESULT_OBSTRUCTED;
        [by.detail, by.a] = [PLACED_STRUCTURE, obstruction.ref];
      } else if (capsuleKind(reg.parts, kind, px, py, pz, p.yaw, own.x, own.y, own.z, reg.bodyRadius[session.ownKind]!, reg.bodyHeight[session.ownKind]!, BODY_SLACK)) {
        problem = RESULT_BODY;
        [by.detail, by.a] = [PLACED_ENTITY, handleIndex(session.ownHandle)];
      } else if (this.enemyNear(structs, reg, session.tribe.team, px, pz)) {
        problem = RESULT_ENEMY_NEAR;
        [by.detail, by.a, by.b] = [PLACED_METRES, Math.floor(this.near[5]!), this.near[6]!];
      } else {
        if (this.supportOf !== structs) {
          this.supportOf = structs;
          this.support = new Support(structs, reg, (x, z) => world.hf.heightAt(x, z));
          this.stood[5] = -1;
        }
        // Asked again only when the piece, its pose or any piece's place has changed.
        const s = this.stood;
        if (s[0] !== kind || s[1] !== p.x || s[2] !== p.y || s[3] !== p.z || s[4] !== p.yaw || s[5] !== structs.shapes) {
          s.set([kind, p.x, p.y, p.z, p.yaw, structs.shapes]);
          s[6] = this.support!.stands(kind, p.x, p.y, p.z, p.yaw) ? 1 : 0;
        }
        if (s[6] === 0) problem = RESULT_NO_SUPPORT;
      }
    }
    // Every one carried is already on its way down.
    if (problem !== RESULT_NO_SNAP && inv!.count[slot]! - (this.pending?.(item) ?? 0) <= 0) problem = RESULT_SHORT;
    this.problem = problem;
    const w = this.worded;
    if (w[0] !== problem || w[1] !== by.detail || w[2] !== by.a || w[3] !== by.b) {
      [w[0], w[1], w[2], w[3]] = [problem, by.detail, by.a, by.b];
      this.words = problem === 0 ? "" : buildReason(reg, session, problem, by);
    }
    this.notice = nowMs < this.refusalUntil ? this.refusal : this.words;
  }

  /** Whether another tribe's foundation or pillar stands too near (x, z), asked again only when the place or any piece's has changed. */
  private enemyNear(structs: CollisionWorld["structs"], reg: Registry, team: number, x: number, z: number): boolean {
    const n = this.near;
    if (n[0] !== x || n[1] !== z || n[2] !== team || n[3] !== structs.shapes) {
      n[0] = x; n[1] = z; n[2] = team; n[3] = structs.shapes;
      n[4] = enemyGap(structs, reg.role, team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR) ? 1 : 0;
      n[5] = enemyGapFound.metres;
      n[6] = enemyGapFound.needs;
    }
    return n[4] === 1;
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
    if (code !== "KeyR" && code !== "KeyT" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if (!down) return true;
    if (code === "KeyR" && !repeat) this.rotate(1, reg);
    else if (code === "KeyT" && !repeat) {
      this.variant++;
      this.turn = 0;
    } else if (code === "ArrowUp") this.lift = Math.min(LIFT_MAX, this.lift + 1);
    else if (code === "ArrowDown") this.lift = Math.max(LIFT_MIN, this.lift - 1);
    return true;
  }

  /** Turns the piece `by` steps: in a place as many ways as its role allows, on open ground by quarters. */
  rotate(by: number, reg: Registry): void {
    const ways = this.target >= 0 && !this.onTop ? turnsOf(reg.role[this.kind]!) : 4;
    this.turn = (((this.turn + by) % ways) + ways) % ways;
  }

  /** The mouse wheel's notches, which turn the piece one step a whole notch. */
  scroll(notches: number, reg: Registry): void {
    this.wheel += notches;
    const steps = Math.trunc(this.wheel);
    if (steps === 0) return;
    this.wheel -= steps;
    this.rotate(steps, reg);
  }

  /** Puts the piece in hand away, as the held slot's own key does. */
  putAway(session: ClientSession, nowMs: number): void {
    if (!this.active || session.held < 0) return;
    if (session.command(CMD_SELECT, (w: BitWriter) => w.u8(255)) === 0) return;
    this.awaySlot = session.held;
    this.awayAt = nowMs;
    this.active = false;
  }

  /**
   * Takes in hand the item that places the built piece `ref`, in that piece's form: from the hotbar, else from the bag
   * into the held slot. False if it is no piece or none is carried.
   */
  pick(session: ClientSession, reg: Registry, ref = this.looked): boolean {
    const inv = session.inventory;
    const t = ref >= 0 ? session.world?.structs.chunks[Math.floor(ref / 65536)] : undefined;
    if (!this.active || !inv || !t || inv.hotbar < 0 || session.held < 0) return false;
    const kind = t.kind[ref & 0xffff]!;
    const item = reg.pieceItem[kind]!;
    const variant = item !== 0 ? reg.places[item]!.indexOf(kind) : -1;
    if (variant < 0) return false;
    if (item === this.item) {
      [this.variant, this.turn] = [variant, 0];
      return true;
    }
    const held = inv.hotbar + session.held;
    let from = -1;
    for (let k = 0; k < inv.cap && from < 0; k++) if (inv.item[k] === item && inv.count[k]! > 0 && k >= inv.hotbar && k < inv.hotbar + HOTBAR_SLOTS) from = k;
    if (from >= 0) session.command(CMD_SELECT, (w: BitWriter) => w.u8(from - inv.hotbar));
    else {
      for (let k = 0; k < inv.cap && from < 0; k++) if (inv.item[k] === item && inv.count[k]! > 0) from = k;
      if (from < 0) return false;
      session.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(held), w.u16(0), w.u16(item)));
    }
    [this.wantItem, this.wantVariant] = [item, variant];
    return true;
  }

  /** Returns the command's sequence number, or 0 if nothing was sent. */
  place(session: ClientSession, reg: Registry): number {
    if (!this.active || this.problem === RESULT_NO_SNAP || this.problem === RESULT_SHORT) return 0;
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
    this.say(BUILD_REASONS[code] ?? "It cannot be built there", nowMs);
  }

  /** The server's own answer to placement `seq` (S_PLACED), which names what stopped it. The result that follows then says nothing more. */
  answered(seq: number, code: number, reason: string, nowMs: number): void {
    if (seq === this.asked) {
      this.asked = 0;
      if (code === RESULT_OK) this.cycle = 0;
    }
    if (code !== RESULT_OK) this.say(reason, nowMs);
  }

  /** Words under the crosshair for a moment, in place of the preview's own. */
  say(words: string, nowMs: number): void {
    this.refusal = words;
    this.refusalUntil = nowMs + 2500;
  }
}

/** With a piece in hand and on foot, in play: when building's rows apply. */
const building = (c: KeyContext): boolean => c.builder.active && c.session.driving < 0 && c.ui.wantsPointerLock;

// Before any screen has the key: Z takes the last piece back, where it else opens the emotes; and a finger's Cancel, which
// presses Escape, puts the piece away. The keyboard's Escape goes on to the menu.
export const BUILD_FIRST_KEYS: readonly KeyRow[] = [{
  name: "build cancel",
  keys: ["Escape", "KeyZ"],
  touch: { Escape: T_CANCEL },
  guide: [{ code: "KeyZ", group: G_BUILD, title: "Undo", detail: "Take back the piece you set down last, while it can still be picked up.", sheet: G_BUILD }],
  when: (c) => building(c) && !c.ui.emotes.open,
  press(c, code, down, repeat, source) {
    if (code === "KeyZ") {
      if (down && !repeat) c.undo();
      return true;
    }
    if (source !== 2) return undefined;
    if (down && !repeat) c.builder.putAway(c.session, c.nowMs);
    return true;
  },
}];

// While a piece is being placed its keys are the builder's (Builder.key). The guide's Build tab is these words.
export const BUILD_KEYS: readonly KeyRow[] = [{
  name: "build",
  keys: ["KeyQ", "KeyR", "KeyT", "KeyX", "ArrowUp", "ArrowDown"],
  touch: { KeyR: T_RELOAD, KeyT: T_FOLLOW_ONE, KeyQ: T_SNAP, ArrowUp: T_RAISE, ArrowDown: T_LOWER },
  pad: { KeyX: 1, KeyT: 3, KeyQ: 14, ArrowUp: 12, ArrowDown: 13 },
  guide: [
    { code: "KeyQ", group: G_BUILD, title: "Next snap point / thruster flip", detail: "Tap to cycle snaps. Hold to toggle free placement. At the wheel of a thruster car (the Zephyr), on or just off the ground, flip: hold W for a front flip, S for a back flip, A or D for a barrel roll, or nothing for a kickflip; its nozzles catch it on its wheels. G flips too." },
    { code: "KeyQ", group: G_BUILD, title: "Next snap point", detail: "Tap to cycle snaps. Hold to toggle free placement.", sheet: G_BUILD },
    { code: "KeyR", group: G_BUILD, title: "Rotate", detail: "Rotate the active building preview. The mouse wheel turns it either way.", sheet: G_BUILD },
    { code: "KeyT", group: G_BUILD, title: "Next form", detail: "Cycle the piece in hand through its forms: wall, doorframe, windowframe.", sheet: G_BUILD },
    { code: "KeyX", group: G_BUILD, title: "Put away", detail: "Put the piece in hand away. The right mouse button does too.", sheet: G_BUILD },
    { code: "KeyE", group: G_BUILD, title: "Use / piece menu", detail: "Tap to use what you look at. Hold on a built piece to mend it, take it back or take it down.", sheet: G_BUILD },
    { code: "ArrowUp", group: G_BUILD, title: "Raise preview", sheet: G_BUILD },
    { code: "ArrowDown", group: G_BUILD, title: "Lower preview", sheet: G_BUILD },
    { code: "Mouse0", group: G_BUILD, title: "Place", sheet: G_BUILD },
    { code: "Mouse1", group: G_BUILD, title: "Pick piece", detail: "Take in hand the piece that builds what you look at, if you carry one.", sheet: G_BUILD },
    { code: "Mouse2", group: G_BUILD, title: "Put away", sheet: G_BUILD },
  ],
  when: (c) => building(c),
  press(c, code, down, repeat) {
    if (code !== "KeyX") return c.builder.key(code, down, repeat, c.nowMs, c.reg) || undefined;
    if (down && !repeat) c.builder.putAway(c.session, c.nowMs);
    return true;
  },
}];
