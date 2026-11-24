// Works out each frame where the building piece in hand would go (shared/world/lattice/place.ts) and whether it may,
// so a ghost can show it. The server checks all of it again when asked.

import { G_BUILD, type KeyContext, type KeyRow } from "./key-row.ts";
import { T_CANCEL, T_FOLLOW_ONE, T_LOWER, T_RAISE, T_RELOAD, T_SNAP } from "./touch.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { handleIndex } from "../../shared/ids.ts";
import { PLACE_JOIN, PLACE_NEW, PLACE_REST, writeJoin, writeNew, writeRest } from "../../shared/net/place.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_FAR, RESULT_FULL, RESULT_LIMIT, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_RATE, RESULT_SHORT, RESULT_TERRAIN, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import { HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { capsuleKind, type CollisionWorld } from "../../shared/world/collide.ts";
import { keyLvl } from "../../shared/world/lattice/module.ts";
import { PLACE_REACH, candidates, choose, makeCandidates, makeVerdict, validate, validateFree, type Site } from "../../shared/world/lattice/place.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, ROLE_THING, enemyGap, enemyGapFound, freePose, restPose, type Pose } from "../../shared/world/snap.ts";
import { Support } from "../../shared/world/support.ts";
import type { ClientSession } from "./session.ts";
import { structName } from "./ui/structure.ts";

export { PLACE_REACH };
/** Holding Q this long toggles free placement. */
const HOLD_MS = 350;
/** A piece put away is hidden at once, and shown again if the server has not agreed by then. */
const AWAY_MS = 1000;
/** Metres. These match the server's BODY_SLACK, ENEMY_FOUNDATION and ENEMY_PILLAR (server/build.ts). */
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
  [RESULT_TERRAIN]: "The ground is in the way",
  [RESULT_RATE]: "Slow down",
  [RESULT_NO_SUPPORT]: "Nothing would hold it up",
  [RESULT_ENEMY_NEAR]: "Too near another tribe's foundation",
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_NO_SNAP]: "It must join something built",
  [RESULT_FAR]: "Too far away",
  [RESULT_SHORT]: "You have none left",
  [RESULT_FULL]: "This area holds no more pieces",
  [RESULT_LIMIT]: "No more structures may stand here",
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
  if (code === RESULT_LIMIT && by.detail === PLACED_COUNTS) return `${by.a.toLocaleString("en-US")} of ${by.b.toLocaleString("en-US")} structures here`;
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
  /** free means the piece joins nothing. `turn` is its turn in a slot, or quarter turns on open ground. */
  variant = 0;
  turn = 0;
  free = false;
  lift = 0;
  /** How the piece would go on, a PLACE_ mode, or -1 while it has no place. */
  mode = -1;
  /** The slot shown: its frame and its key with no turn. `pinned` once Q or a level key chose it, so no nearer slot takes its place. */
  private readonly slot = { fr: 0, k0: 0, k1: 0 };
  private pinned = false;
  /** Slots Q has asked to step on, and levels the arrows have, since the last frame. */
  private next = 0;
  private raise = 0;
  /** The floor a thing would rest on. */
  private floor = 0;
  private freeX = 0;
  private freeZ = 0;
  private freeYaw = 0;
  private item = 0;
  private readonly offered = makeCandidates();
  private readonly verdict = makeVerdict();
  /** What the shared checks ask of this client about a place, and the session and registry it answers from. */
  private site: Site | null = null;
  private session: ClientSession | null = null;
  private reg: Registry | null = null;
  private support: Support | null = null;
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

  /** The checks of a place that are this client's to answer: its own body, the other tribes it has been sent, what holds a piece up. The cap is the server's. */
  private siteFor(world: CollisionWorld): Site {
    if (this.site?.structs === world.structs) return this.site;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.support = new Support(structs, this.reg!, heightAt);
    this.stood[5] = -1;
    return (this.site = {
      structs,
      tables: this.reg!,
      heightAt,
      body: (kind, x, y, z, yaw) => {
        const session = this.session!;
        const reg = this.reg!;
        const own = session.own;
        return capsuleKind(reg.parts, kind, x, y, z, yaw, own.x, own.y, own.z, reg.bodyRadius[session.ownKind]!, reg.bodyHeight[session.ownKind]!, BODY_SLACK) ? handleIndex(session.ownHandle) : -1;
      },
      enemy: (x, z, out) => {
        if (!this.enemyNear(structs, this.reg!, this.session!.tribe.team, x, z)) return false;
        [out.detail, out.a, out.b] = [PLACED_METRES, Math.floor(this.near[5]!), this.near[6]!];
        return true;
      },
      // Asked again only when the piece, its pose or any piece's place has changed.
      stands: (kind, x, y, z, yaw) => {
        const s = this.stood;
        if (s[0] !== kind || s[1] !== x || s[2] !== y || s[3] !== z || s[4] !== yaw || s[5] !== structs.shapes) {
          s.set([kind, x, y, z, yaw, structs.shapes]);
          s[6] = this.support!.stands(kind, x, y, z, yaw) ? 1 : 0;
        }
        return s[6] === 1;
      },
    });
  }

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
      this.variant = this.turn = this.lift = this.next = this.raise = 0;
      this.free = this.pinned = false;
      if (item === this.wantItem) this.variant = this.wantVariant;
      this.wantItem = 0;
    }
    if (this.qDownAt >= 0 && nowMs - this.qDownAt >= HOLD_MS) {
      this.free = !this.free;
      this.qDownAt = -2;
    }
    const kind = forms[this.variant % forms.length]!;
    this.kind = kind;
    this.session = session;
    this.reg = reg;
    const structs = world.structs;
    const site = this.siteFor(world);
    const team = session.tribe.team;
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    const looked = (this.looked = hit === HIT_STRUCTURE ? rayHit.ref : -1);
    const reach = rayHit.t;
    const verdict = this.verdict;
    const p = this.pose;
    let problem = 0;
    this.mode = -1;
    // The free point is where the look ends, facing as the builder does, turned by quarters. Open ground and a thing on a floor use it.
    this.freeX = Math.round((ox + dx * reach) * STRUCT_UNITS);
    this.freeZ = Math.round((oz + dz * reach) * STRUCT_UNITS);
    this.freeYaw = (Math.round((yaw / (2 * Math.PI)) * YAW_UNITS) + this.turn * (YAW_UNITS / 4)) & (YAW_UNITS - 1);
    if (reg.role[kind] === ROLE_THING && looked >= 0) {
      // A thing aimed at a structure rests on top of it where the look is, if it is a floor of the builder's tribe.
      this.floor = looked;
      const t = structs.chunks[Math.floor(looked / 65536)]!;
      if (!restPose(structs, reg, looked, kind, this.freeX / STRUCT_UNITS, this.freeZ / STRUCT_UNITS, this.freeYaw, p)) problem = RESULT_NO_SNAP;
      else if (t.owner[looked & 0xffff] !== team || team === 0) problem = RESULT_NOT_YOURS;
      else problem = validateFree(site, kind, p, ox, oy, oz, verdict);
      if (problem !== RESULT_NO_SNAP) this.mode = PLACE_REST;
    } else if (!this.free && candidates(site, kind, team, ox, oy, oz, dx, dy, dz, reach, this.offered) > 0) {
      const c = this.offered;
      const at = this.slot;
      let i = choose(c, at.fr, at.k0, at.k1);
      // A slot chosen by a key is kept while it is offered at all.
      if (this.pinned) for (let k = 0; k < c.n; k++) if (c.fr[k] === at.fr && c.k0[k] === at.k0 && c.k1[k] === at.k1) i = k;
      if (this.pinned && (c.fr[i] !== at.fr || c.k0[i] !== at.k0 || c.k1[i] !== at.k1)) this.pinned = false;
      if (this.next !== 0) {
        i = (((i + this.next) % c.n) + c.n) % c.n;
        this.pinned = true;
      }
      // The same slot a level up or down, where one is offered: a foundation's terrace.
      for (let way = Math.sign(this.raise), left = Math.abs(this.raise); left > 0; left--) {
        let best = -1;
        for (let k = 0; k < c.n; k++) {
          const by = (keyLvl(c.k1[k]!) - keyLvl(c.k1[i]!)) * way;
          if (c.fr[k] !== c.fr[i] || c.k0[k] !== c.k0[i] || ((c.k1[k]! ^ c.k1[i]!) & ~(511 << 10)) !== 0 || by <= 0) continue;
          if (best < 0 || by < (keyLvl(c.k1[best]!) - keyLvl(c.k1[i]!)) * way) best = k;
        }
        if (best < 0) break;
        i = best;
        this.pinned = true;
      }
      [at.fr, at.k0, at.k1] = [c.fr[i]!, c.k0[i]!, c.k1[i]!];
      this.mode = PLACE_JOIN;
      problem = validate(site, kind, team, at.fr, at.k0, this.keyed(reg), ox, oy, oz, verdict);
      [p.x, p.y, p.z, p.yaw] = [verdict.pose.x, verdict.pose.y, verdict.pose.z, verdict.pose.yaw];
    } else {
      // A bed is set only on a floor.
      if (hit !== HIT_TERRAIN || (reg.defs[kind] as StructureDef).floor === true || !freePose(site.heightAt, reg, kind, this.freeX / STRUCT_UNITS, this.freeZ / STRUCT_UNITS, this.freeYaw, this.lift, p)) problem = RESULT_NO_SNAP;
      else {
        this.mode = PLACE_NEW;
        problem = validateFree(site, kind, p, ox, oy, oz, verdict);
      }
    }
    this.next = this.raise = 0;
    if (this.mode !== PLACE_JOIN) this.pinned = false;
    const by = this.by;
    by.detail = PLACED_NONE;
    if (problem !== 0 && this.mode >= 0) [by.detail, by.a, by.b] = [verdict.detail, verdict.a, verdict.b];
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

  /** The shown slot's second word with the piece's turn in it: as many turns as its form has. */
  private keyed(reg: Registry): number {
    const turns = reg.forms.turns[this.kind]!;
    return (this.slot.k1 | ((((this.turn % turns) + turns) % turns) << 26)) >>> 0;
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
      // Released before it counted as held, so it steps to the next place offered.
      else if (!down && this.qDownAt >= 0) this.next++;
      if (!down) this.qDownAt = -1;
      return true;
    }
    if (code !== "KeyR" && code !== "KeyT" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if (!down) return true;
    if (code === "KeyR" && !repeat) this.rotate(1, reg);
    else if (code === "KeyT" && !repeat) {
      this.variant++;
      this.turn = 0;
    } else if (this.mode === PLACE_JOIN) this.raise += code === "ArrowUp" ? 1 : -1;
    else if (code === "ArrowUp") this.lift = Math.min(LIFT_MAX, this.lift + 1);
    else this.lift = Math.max(LIFT_MIN, this.lift - 1);
    return true;
  }

  /** Steps to the next place the look offers, as a tap of Q does. */
  step(by = 1): void {
    this.next += by;
  }

  /** Turns the piece `by` steps: in a slot as many ways as its form has, on open ground by quarters. */
  rotate(by: number, reg: Registry): void {
    const ways = this.mode === PLACE_JOIN ? reg.forms.turns[this.kind]! : 4;
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
    if (!this.active || this.mode < 0 || this.problem === RESULT_NO_SNAP || this.problem === RESULT_SHORT) return 0;
    const variant = this.variant % reg.places[this.item]!.length;
    const mode = this.mode;
    const { fr, k0 } = this.slot;
    const k1 = this.keyed(reg);
    this.asked = session.command(CMD_PLACE, (w: BitWriter) => {
      if (mode === PLACE_JOIN) writeJoin(w, variant, fr, k0, k1);
      else if (mode === PLACE_REST) writeRest(w, variant, this.floor, this.freeX, this.freeZ, this.freeYaw);
      else writeNew(w, variant, this.freeX, this.freeZ, this.freeYaw, this.lift);
    });
    return this.asked;
  }

  /** A refusal of the piece last asked for shows its reason for a while. */
  result(seq: number, code: number, nowMs: number): void {
    if (seq !== this.asked || seq === 0) return;
    this.asked = 0;
    if (code === RESULT_OK) {
      // The next piece starts from the nearest place again.
      this.pinned = false;
      return;
    }
    this.say(BUILD_REASONS[code] ?? "It cannot be built there", nowMs);
  }

  /** The server's own answer to placement `seq` (S_PLACED), which names what stopped it. The result that follows then says nothing more. */
  answered(seq: number, code: number, reason: string, nowMs: number): void {
    if (seq === this.asked) {
      this.asked = 0;
      if (code === RESULT_OK) this.pinned = false;
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
