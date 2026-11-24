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
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_FAR, RESULT_FULL, RESULT_LIMIT, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_RATE, RESULT_SHORT, RESULT_TERRAIN, RESULT_TOO_HIGH, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { capsuleKind, type CollisionWorld } from "../../shared/world/collide.ts";
import { levelY, worldOf, yawOf } from "../../shared/world/lattice/basis.ts";
import { HALF_SIDE_M } from "../../shared/world/lattice/forms.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { SIDE, elementCorners, keyAnchor, keyCls, keyDir, keyLvl } from "../../shared/world/lattice/module.ts";
import { PLACE_REACH, candidates, choose, makeCandidates, makeVerdict, validate, validateFree, type Site } from "../../shared/world/lattice/place.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, ROLE_THING, enemyGap, enemyGapFound, freePose, restPose, type Pose } from "../../shared/world/snap.ts";
import { STABILITY, Support } from "../../shared/world/support.ts";
import { BuildView, PROVISIONAL } from "./build-view.ts";
import { ASKED, type Asking, type PredictBuild } from "./predict-build.ts";
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
/** The view of the rows is let go this long after the piece was put away. */
const VIEW_IDLE_MS = 10000;
/** Metres round the builder that the view must hold whole before the preview asks it. */
const VIEW_NEED = PLACE_REACH + 20;
/** Metres from a slot within which a piece not yet answered for may be what offers it or holds it up. */
const ON_REACH = 1.75 * SIDE * HALF_SIDE_M;
/** Pieces not yet answered for that may stand one on another: a third waits for the first's answer. */
const UNSURE_MOST = 2;
/** Palette indices for the ghost: fine, fine and at the last step that stands, refused; and for a slot's outline. */
export const GHOST_OK = 16;
export const GHOST_WARN = 3;
export const GHOST_BAD = 8;
export const GHOST_SLOT = 10;
/** Under this stability a piece that stands is shown in the warning colour: nothing more hangs far off it. */
export const STABLE_FROM = 2;
/** Other free slots marked at most, how many of the look's candidates are gone through for them, and how many are judged anew in one frame. */
export const OTHERS_MOST = 8;
const OTHERS_SEEN = 16;
const OTHERS_A_FRAME = 1;
/** How see-through the other slots' marks are, 0 to 1. */
export const OTHERS_FADE = 0.55;

/** A slot's outline: its class (a CLS_ of the lattice, -1 for none), its middle in metres and its turn in wire units. */
export interface SlotMark {
  cls: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const corners = new Int32Array(16);
const anchor = new Int32Array(4);
const point = new Int32Array(2);

/** The outline of the slot (k0, k1) of frame `f`, to `out`. A triangle is marked at its middle as a corner is. */
function slotMarkOf(f: Frame, k0: number, k1: number, out: SlotMark): void {
  const cls = keyCls(k0);
  keyAnchor(k0, k1, anchor, 0);
  const n = elementCorners(cls, anchor, 0, keyDir(k1), corners, 0);
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    worldOf(f.basis, f.ox, f.oz, corners, 4 * i, point, 0);
    x += point[0]! / n;
    z += point[1]! / n;
  }
  out.cls = n === 3 ? 0 : cls;
  out.x = x / STRUCT_UNITS;
  out.z = z / STRUCT_UNITS;
  out.y = levelY(f.oy, keyLvl(k1)) / STRUCT_UNITS;
  out.yaw = yawOf(f.yaw, keyDir(k1));
}

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
  // The preview's own: a piece under it is two answers away.
  [RESULT_WAIT]: "Waiting for the piece it joins",
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
export function buildReason(reg: Registry, session: ClientSession, code: number, by: Blocker, nameOf?: (entity: number) => string, structs = session.world?.structs): string {
  if (code === RESULT_OBSTRUCTED && by.detail === PLACED_STRUCTURE) {
    const t = structs?.chunks[Math.floor(by.a / 65536)];
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

/** What the shared checks ask of this client about a place in one store, and that store's support. */
interface Asked {
  readonly site: Site;
  readonly support: Support;
  /** The same checks for a place the builder does not stand at or reach from. */
  readonly bare: Site;
}

const NO_PIECES: readonly never[] = [];

export class Builder {
  /** A building piece is in hand. */
  active = false;
  /** The structure kind the piece would become, and its pose. problem is 0 if it may go there, else a RESULT_ code. */
  kind = 0;
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Its turn class in its base: 0, or 1 or 2 for a slot 30 or 60 degrees round. A free pose has none. */
  tw = 0;
  problem = 0;
  /** The server's last refusal for a moment, else the current problem. */
  notice = "";
  /** How well the piece shown would stand, from its material's most down to 0; -2 where that is not said: a thing, a piece refused. */
  stability = -2;
  stabilityMost = STABILITY;
  /** The slot the piece shown would go in, for its outline. */
  readonly slotMark: SlotMark = { cls: -1, x: 0, y: 0, z: 0, yaw: 0 };
  /** The other free slots near the look that the piece may go in, the first `others` of them: the places Q steps through. */
  readonly otherMarks: SlotMark[] = Array.from({ length: OTHERS_MOST }, () => ({ cls: -1, x: 0, y: 0, z: 0, yaw: 0 }));
  others = 0;
  /** Whether the other slots are marked (Settings.buildSlots). */
  showOthers = true;
  /** What is in the way of the piece where it is shown, for `problem`. */
  readonly by: Blocker = { detail: PLACED_NONE, a: 0, b: 0 };
  /** How many of an item have been set down and not yet taken from the inventory (PredictBuild.pending). */
  pending: ((item: number) => number) | null = null;
  /** The pieces set down that are not rows yet. With them the preview sees those pieces and may build on them. */
  predict: PredictBuild | null = null;
  /** The item in hand that places a piece, or 0. */
  get inHand(): number { return this.item; }
  /** The palette colour the piece is shown in: fine, at the last step that stands or waiting, or refused. */
  get color(): number {
    if (this.problem === RESULT_WAIT) return GHOST_WARN;
    if (this.problem !== 0) return GHOST_BAD;
    return this.stability >= 0 && this.stability < STABLE_FROM ? GHOST_WARN : GHOST_OK;
  }
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
  private readonly alone = makeVerdict();
  /** What the shared checks ask of this client about a place, for each store asked, and the session and registry it answers from. */
  private readonly sites: Asked[] = [];
  private session: ClientSession | null = null;
  private reg: Registry | null = null;
  /** The rows as the preview sees them, with the pieces that are not rows yet; and when a piece was last in hand. */
  private view: BuildView | null = null;
  private activeAt = 0;
  /** The world last asked: the view's, or the session's own while the view is not whole. */
  private seen: CollisionWorld | null = null;
  /** The pieces not yet answered for that the piece shown joins or stands on. */
  private readonly on: number[] = [];
  private readonly off: number[] = [];
  /** Whether `offered` is of the look as it is now. */
  private joining = false;
  /** Slots judged for their marks: what they were judged for, then each one's frame and key, whether it is fine, and its pose. */
  private readonly judgedFor = [-1, -1, -1, -1];
  private judgedN = 0;
  private readonly judged = { fr: new Uint32Array(32), k0: new Uint32Array(32), k1: new Uint32Array(32), ok: new Uint8Array(32), x: new Float64Array(32), y: new Float64Array(32), z: new Float64Array(32), yaw: new Uint16Array(32), tw: new Uint8Array(32) };
  /** What the preview was last worked out from. While none of it changes, it stands. */
  private readonly from = new Float64Array(20).fill(NaN);
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
  private siteFor(world: CollisionWorld): Asked {
    for (const a of this.sites) if (a.site.structs === world.structs) return a;
    const structs = world.structs;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    const support = new Support(structs, this.reg!, heightAt);
    const stood = new Float64Array(7).fill(-1);
    const near = new Float64Array(7).fill(-1);
    const site: Site = {
      structs,
      tables: this.reg!,
      heightAt,
      body: (kind, x, y, z, yaw, tw) => {
        const session = this.session!;
        const reg = this.reg!;
        const own = session.own;
        return capsuleKind(reg.parts, kind, x, y, z, yaw, tw, own.x, own.y, own.z, reg.bodyRadius[session.ownKind]!, reg.bodyHeight[session.ownKind]!, BODY_SLACK) ? handleIndex(session.ownHandle) : -1;
      },
      enemy: (x, z, out) => {
        if (!this.enemyNear(structs, near, this.reg!, this.session!.tribe.team, x, z)) return false;
        [out.detail, out.a, out.b] = [PLACED_METRES, Math.floor(near[5]!), near[6]!];
        return true;
      },
      // Asked again only when the piece, its pose or any piece's place has changed.
      stands: (kind, x, y, z, yaw) => {
        if (stood[0] !== kind || stood[1] !== x || stood[2] !== y || stood[3] !== z || stood[4] !== yaw || stood[5] !== structs.shapes) {
          stood.set([kind, x, y, z, yaw, structs.shapes]);
          stood[6] = support.stands(kind, x, y, z, yaw) ? 1 : 0;
        }
        return stood[6] === 1;
      },
    };
    // The session's own store and the view's: a world left behind is forgotten with its first.
    if (this.sites.length >= 2) this.sites.shift();
    const made = { site, support, bare: { ...site, body: undefined } };
    this.sites.push(made);
    return made;
  }

  /**
   * The world the preview asks: the view of the rows with the pieces not yet rows laid over them, brought up to date, or
   * the session's own while the view round the builder is still being read.
   */
  private look(world: CollisionWorld, reg: Registry, x: number, z: number, team: number): CollisionWorld {
    if (!this.view?.of(world)) {
      this.view = new BuildView(world, reg.halfX, reg.halfY, reg.halfZ);
      this.sites.length = 0;
    }
    const view = this.view;
    view.update(x, z, this.predict?.live ?? NO_PIECES, this.predict?.stamp ?? 0, team, this.predict?.taken);
    return view.ready(x - VIEW_NEED, z - VIEW_NEED, x + VIEW_NEED, z + VIEW_NEED) ? view.world : world;
  }

  /** The eye is at (ox, oy, oz), looking along the unit direction (dx, dy, dz). `yaw` is the body's facing in radians. */
  update(session: ClientSession, world: CollisionWorld, reg: Registry, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number, nowMs: number): void {
    const inv = session.inventory;
    const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    const item = slot >= 0 && inv!.count[slot]! > 0 ? inv!.item[slot]! : 0;
    if (this.awaySlot >= 0 && (session.held !== this.awaySlot || nowMs - this.awayAt >= AWAY_MS)) this.awaySlot = -1;
    // While the hand is changing the slot in it is the one being left: nothing is shown or set down by it.
    const forms = this.awaySlot >= 0 || session.handChanging ? null : (reg.places[item] ?? null);
    this.active = forms !== null;
    if (!forms) {
      this.item = 0;
      this.notice = "";
      this.looked = -1;
      this.from[0] = NaN;
      if (this.view && nowMs - this.activeAt >= VIEW_IDLE_MS) {
        this.view = null;
        this.sites.length = 0;
      }
      return;
    }
    this.activeAt = nowMs;
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
    const team = session.tribe.team;
    const seen = (this.seen = this.look(world, reg, ox, oz, team));
    const have = inv!.count[slot]! - (this.predict ? this.predict.pending(item) : (this.pending?.(item) ?? 0));
    // Nothing the preview is worked out from has changed: it stands as it is.
    const from = this.from;
    const now = [ox, oy, oz, dx, dy, dz, yaw, kind, this.turn, this.free ? 1 : 0, this.lift, seen === world ? 0 : 1, seen.structs.shapes, world.structs.shapes, this.predict?.stamp ?? 0, team, have, item, this.view!.version];
    let same = this.next === 0 && this.raise === 0;
    for (let i = 0; same && i < now.length; i++) same = from[i] === now[i];
    if (!same) {
      this.work(session, seen, world, reg, kind, team, have, ox, oy, oz, dx, dy, dz, yaw);
      // What it asked may have turned the view's rows over and back.
      now[12] = seen.structs.shapes;
      from.set(now);
    }
    this.markOthers(session, seen, world, reg, kind, team);
    this.notice = nowMs < this.refusalUntil ? this.refusal : this.words;
  }

  /** Works the preview out: where the piece would go in the world `seen`, and what is wrong with it there. */
  private work(session: ClientSession, seen: CollisionWorld, world: CollisionWorld, reg: Registry, kind: number, team: number, have: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw: number): void {
    const structs = seen.structs;
    const { site, support } = this.siteFor(seen);
    const view = seen === world ? null : this.view!;
    this.stability = -2;
    this.stabilityMost = reg.stabilityCap[kind] || STABILITY;
    this.slotMark.cls = -1;
    this.joining = false;
    this.tw = 0;
    const hit = castWorld(seen, ox, oy, oz, dx, dy, dz, BUILD_REACH);
    const looked = hit === HIT_STRUCTURE ? rayHit.ref : -1;
    // A piece that is no row yet is not one to pick, mend or rest a thing on.
    const unbuilt = looked >= 0 && view !== null && view.idAt(looked) !== 0;
    this.looked = unbuilt ? -1 : looked;
    const reach = rayHit.t;
    const verdict = this.verdict;
    const p = this.pose;
    let problem = 0;
    this.mode = -1;
    this.on.length = 0;
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
      // The floor is no row yet, so the command has no ref to name it by.
      else if (unbuilt) problem = RESULT_WAIT;
      else problem = validateFree(site, kind, p, ox, oy, oz, verdict);
      if (problem !== RESULT_NO_SNAP && problem !== RESULT_WAIT) this.mode = PLACE_REST;
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
      this.tw = verdict.pose.tw;
      this.joining = true;
      slotMarkOf(structs.frames.get(at.fr)!, at.k0, at.k1, this.slotMark);
      if (problem === 0) this.stability = support.stabilityAt(kind, at.fr, at.k0, this.keyed(reg));
      if (problem === 0 && view && this.unsure(view, site, kind, team, ox, oy, oz)) problem = RESULT_WAIT;
    } else {
      // A bed is set only on a floor.
      if (hit !== HIT_TERRAIN || (reg.defs[kind] as StructureDef).floor === true || !freePose(site.heightAt, reg, kind, this.freeX / STRUCT_UNITS, this.freeZ / STRUCT_UNITS, this.freeYaw, this.lift, p)) problem = unbuilt && reg.role[kind] === ROLE_THING ? RESULT_WAIT : RESULT_NO_SNAP;
      else {
        this.mode = PLACE_NEW;
        problem = validateFree(site, kind, p, ox, oy, oz, verdict);
        // A base's first piece stands by itself.
        if (problem === 0 && reg.forms.cls[kind]! >= 0) this.stability = this.stabilityMost;
      }
    }
    this.next = this.raise = 0;
    if (this.mode !== PLACE_JOIN) this.pinned = false;
    const by = this.by;
    by.detail = PLACED_NONE;
    if (problem !== 0 && problem !== RESULT_WAIT && this.mode >= 0) [by.detail, by.a, by.b] = [verdict.detail, verdict.a, verdict.b];
    // Every one carried is already on its way down.
    if (problem !== RESULT_NO_SNAP && have <= 0) problem = RESULT_SHORT;
    this.problem = problem;
    const w = this.worded;
    if (w[0] !== problem || w[1] !== by.detail || w[2] !== by.a || w[3] !== by.b) {
      [w[0], w[1], w[2], w[3]] = [problem, by.detail, by.a, by.b];
      this.words = problem === 0 ? "" : buildReason(reg, session, problem, by, undefined, structs);
    }
  }

  /**
   * Marks the other slots the look offers that the piece may go in, the nearest first: each judged once as the server
   * would judge it from anywhere, a few new ones a frame, and left out while the builder's own body stands in it.
   */
  private markOthers(session: ClientSession, seen: CollisionWorld, world: CollisionWorld, reg: Registry, kind: number, team: number): void {
    this.others = 0;
    if (!this.showOthers || !this.joining || this.mode !== PLACE_JOIN) return;
    const c = this.offered;
    const at = this.slot;
    const j = this.judged;
    const forWhat = this.judgedFor;
    const stamp = [kind, this.turn, this.view?.version ?? 0, seen === world ? world.structs.shapes : -1];
    if (forWhat[0] !== stamp[0] || forWhat[1] !== stamp[1] || forWhat[2] !== stamp[2] || forWhat[3] !== stamp[3]) {
      [forWhat[0], forWhat[1], forWhat[2], forWhat[3]] = [stamp[0]!, stamp[1]!, stamp[2]!, stamp[3]!];
      this.judgedN = 0;
    }
    const own = session.own;
    const structs = seen.structs;
    let anew = OTHERS_A_FRAME;
    for (let k = 0; k < c.n && k < OTHERS_SEEN && this.others < OTHERS_MOST; k++) {
      const [fr, k0, k1] = [c.fr[k]!, c.k0[k]!, c.k1[k]!];
      if (fr === at.fr && k0 === at.k0 && k1 === at.k1) continue;
      let i = 0;
      while (i < this.judgedN && (j.fr[i] !== fr || j.k0[i] !== k0 || j.k1[i] !== k1)) i++;
      if (i === this.judgedN) {
        if (anew === 0 || i === j.fr.length) continue;
        anew--;
        this.judgedN++;
        const turns = reg.forms.turns[kind]!;
        const code = validate(this.siteFor(seen).bare, kind, team, fr, k0, (k1 | ((((this.turn % turns) + turns) % turns) << 26)) >>> 0, NaN, NaN, NaN, this.alone);
        const q = this.alone.pose;
        [j.fr[i], j.k0[i], j.k1[i], j.ok[i]] = [fr, k0, k1, code === RESULT_OK ? 1 : 0];
        [j.x[i], j.y[i], j.z[i], j.yaw[i], j.tw[i]] = [q.x / STRUCT_UNITS, q.y / STRUCT_UNITS, q.z / STRUCT_UNITS, q.yaw, q.tw];
      }
      if (j.ok[i] !== 1) continue;
      if (capsuleKind(reg.parts, kind, j.x[i]!, j.y[i]!, j.z[i]!, j.yaw[i]!, j.tw[i]!, own.x, own.y, own.z, reg.bodyRadius[session.ownKind]!, reg.bodyHeight[session.ownKind]!, BODY_SLACK)) continue;
      slotMarkOf(structs.frames.get(fr)!, k0, k1, this.otherMarks[this.others++]!);
    }
  }

  /**
   * Fills `on` with pieces not yet answered for that the piece shown, fine in the view, needs: the fewest of those near
   * it, the deepest left out first. True if one of them itself stands on such a piece: then this one waits for an answer.
   */
  private unsure(view: BuildView, site: Site, kind: number, team: number, ox: number, oy: number, oz: number): boolean {
    const predict = this.predict;
    const on = this.on;
    if (!predict) return false;
    const at = this.slot;
    const p = this.pose;
    for (const e of predict.entries) {
      if (e.state !== ASKED || !e.drawn || e.over.mode < 0 || e.over.fr !== at.fr) continue;
      const far = Math.hypot(e.x - p.x / STRUCT_UNITS, e.y - p.y / STRUCT_UNITS, e.z - p.z / STRUCT_UNITS);
      if (far <= ON_REACH) on.push(e.id);
    }
    if (on.length === 0) return false;
    on.sort((a, b) => predict.unsure(b) - predict.unsure(a));
    const k1 = this.keyed(this.reg!);
    const off = this.off;
    off.length = 0;
    for (const id of on) {
      off.push(id);
      if (view.without(off, predict.live, team, () => validate(site, kind, team, at.fr, at.k0, k1, ox, oy, oz, this.alone)) !== RESULT_OK) off.pop();
    }
    let kept = 0;
    for (const id of on) if (!off.includes(id)) on[kept++] = id;
    on.length = kept;
    for (const id of on) if (predict.unsure(id) >= UNSURE_MOST) return true;
    return false;
  }

  /** What the hotbar's line says of the piece shown: how well it would stand. "" with nothing to say. */
  says(): string {
    return this.problem === 0 && this.stability >= 0 ? `Stability ${this.stability} of ${this.stabilityMost}` : "";
  }

  /** The shown slot's second word with the piece's turn in it: as many turns as its form has. */
  private keyed(reg: Registry): number {
    const turns = reg.forms.turns[this.kind]!;
    return (this.slot.k1 | ((((this.turn % turns) + turns) % turns) << 26)) >>> 0;
  }

  /** Whether another tribe's foundation or pillar stands too near (x, z), asked again only when the place or any piece's has changed. */
  private enemyNear(structs: CollisionWorld["structs"], n: Float64Array, reg: Registry, team: number, x: number, z: number): boolean {
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

  /**
   * Sets down what the preview shows, as a click does. The command is sent, or held back for a base whose frame the server
   * has yet to say; a piece the preview finds nothing wrong with goes to `predict`, to be drawn at once. A place already
   * asked for, or blocked by a piece of the builder's own that is no row yet, is not asked for again. Returns the
   * command's sequence number, -1 for one held back, 0 if nothing was asked.
   */
  setDown(session: ClientSession, reg: Registry, nowMs: number): number {
    const predict = this.predict;
    const p = this.pose;
    const x = p.x / STRUCT_UNITS, y = p.y / STRUCT_UNITS, z = p.z / STRUCT_UNITS;
    if (!this.active || this.mode < 0 || (predict !== null && predict.covers(x, y, z))) return 0;
    const view = this.view !== null && this.seen === this.view.world ? this.view : null;
    if (this.problem === RESULT_OBSTRUCTED && this.by.detail === PLACED_STRUCTURE && view !== null && view.idAt(this.by.a) !== 0) return 0;
    const fine = this.problem === 0;
    const held = this.mode === PLACE_JOIN && this.slot.fr >= PROVISIONAL;
    if (held && (!fine || !predict)) return 0;
    const seq = held ? 0 : this.place(session, reg);
    if (!held && seq === 0) return 0;
    if (fine && predict) {
      const at: Asking = { mode: this.mode, variant: this.variant % reg.places[this.item]!.length, fr: this.slot.fr, k0: this.slot.k0, k1: this.keyed(reg), on: this.on, index: 0, count: 1, step: 0, tw: this.tw };
      if (!predict.add(seq, this.kind, this.item, x, y, z, p.yaw, nowMs, view ? at : null) && held) return 0;
    }
    return held ? -1 : seq;
  }

  /** Returns the command's sequence number, or 0 if nothing was sent. */
  place(session: ClientSession, reg: Registry): number {
    if (!this.active || this.mode < 0 || this.problem === RESULT_NO_SNAP || this.problem === RESULT_SHORT || this.problem === RESULT_WAIT) return 0;
    // A base the server has not answered for has no frame a command can name.
    if (this.mode === PLACE_JOIN && this.slot.fr >= PROVISIONAL) return 0;
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
