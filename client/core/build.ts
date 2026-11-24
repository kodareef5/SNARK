// Works out each frame where the building piece in hand would go (shared/world/lattice/place.ts) and whether it may,
// so a ghost can show it. The server checks all of it again when asked.

import { G_BUILD, type KeyContext, type KeyRow } from "./key-row.ts";
import { T_CANCEL, T_FOLLOW_ONE, T_LOWER, T_RAISE, T_RELOAD, T_SNAP } from "./touch.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { handleIndex } from "../../shared/ids.ts";
import { PLACE_JOIN, PLACE_NEW, PLACE_PLAN, PLACE_REST, PLACE_RUN_MOST, writeFill, writeJoin, writeNew, writeRest } from "../../shared/net/place.ts";
import { BOX_SELF, CMD_MOVE, CMD_PLACE, CMD_SELECT, PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_FAR, RESULT_FULL, RESULT_LIMIT, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_ENEMY_NEAR, RESULT_OBSTRUCTED, RESULT_OK, RESULT_RATE, RESULT_SHORT, RESULT_TERRAIN, RESULT_TOO_HIGH, RESULT_WAIT } from "../../shared/net/protocol.ts";
import { HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { capsuleKind, type CollisionWorld } from "../../shared/world/collide.ts";
import { dirVector, levelY, twOf, worldOf, yawOf } from "../../shared/world/lattice/basis.ts";
import { FORM_LAYERS, HALF_SIDE_M } from "../../shared/world/lattice/forms.ts";
import type { Frame, LatticeKey } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, SIDE, dirTurn, elementCorners, keyAnchor, keyCls, keyDir, keyLvl } from "../../shared/world/lattice/module.ts";
import { PLACE_REACH, SWITCH_MARGIN, candidates, choose, makeCandidates, makeVerdict, runKey, validate, validateFree, type Site } from "../../shared/world/lattice/place.ts";
import { HIT_STRUCTURE, HIT_TERRAIN, castWorld, rayHit } from "../../shared/world/ray.ts";
import { BUILD_REACH, LIFT_MAX, LIFT_MIN, ROLE_THING, enemyGap, enemyGapFound, freePose, restPose, type Pose } from "../../shared/world/snap.ts";
import { STABILITY, Support } from "../../shared/world/support.ts";
import { BuildView, PROVISIONAL, type Overlaid } from "./build-view.ts";
import { ASKED, PREDICT_MOST, type Asking, type PredictBuild } from "./predict-build.ts";
import type { ClientSession } from "./session.ts";
import { structName } from "./ui/structure.ts";
import { plansOf, type PlanSlot } from "./plans.ts";

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
/** The share of the structure cap past which the preview says how many structures stand in range. */
export const CAP_SAID_FROM = 0.8;
/** A piece that would fall is drawn over itself this see-through, this many metres toward the eye so it is not hidden by itself. */
export const FALL_FADE = 0.3;
export const FALL_NEAR = 0.04;

/** Pieces one row may have, and how many of a row are judged anew in one frame. */
export const ROW_MOST = PLACE_RUN_MOST;
const ROW_A_FRAME = 8;
/** Metres along the look that a row is swept to at most, and metres round a row's piece that the view must hold. */
const ROW_LOOK = 110;
const ROW_NEED = 16;
/** The layers whose pieces go down in rows: floors and foundations, walls, and what a fence stands on. */
const ROW_LAYERS: readonly number[] = [FORM_LAYERS.indexOf("slab"), FORM_LAYERS.indexOf("wall"), FORM_LAYERS.indexOf("footing")];
const stepKey: LatticeKey = { fr: 0, k0: 0, k1: 0 };

/** Pixels of the look's movement from the wheel's middle before it chooses, and the most it remembers. */
const WHEEL_DEAD = 18;
const WHEEL_REACH = 70;

/** What a form is called on the wheel: its kind's own words, as "doorframe" of core:doorframe_wood. */
export function formName(reg: Registry, kind: number): string {
  const id = reg.ids[kind] ?? "";
  // The id less its namespace and its material: "half wall" of core:half_wall_wood.
  return id.slice(id.indexOf(":") + 1, id.lastIndexOf("_")).replace(/_open$/, "").replaceAll("_", " ").replaceAll("-", " ");
}

/** A slot's outline: its class (a CLS_ of the lattice, -1 for none), its middle in metres (a triangle's first corner), its turn in wire units and its turn class in its base. */
export interface SlotMark {
  cls: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tw: number;
}

const corners = new Int32Array(16);
const anchor = new Int32Array(4);
const point = new Int32Array(2);

/** The outline of the slot (k0, k1) of frame `f`, to `out`. A triangle is marked from its first corner, as its pieces are placed. */
function slotMarkOf(f: Frame, k0: number, k1: number, out: SlotMark): void {
  const cls = keyCls(k0);
  keyAnchor(k0, k1, anchor, 0);
  const n = cls === CLS_TRIANGLE ? 1 : elementCorners(cls, anchor, 0, keyDir(k1), corners, 0);
  if (cls === CLS_TRIANGLE) corners.set(anchor, 0);
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    worldOf(f.basis, f.ox, f.oz, corners, 4 * i, point, 0);
    x += point[0]! / n;
    z += point[1]! / n;
  }
  out.cls = cls;
  out.tw = twOf(keyDir(k1));
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
  readonly slotMark: SlotMark = { cls: -1, x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  /** The other free slots near the look that the piece may go in, the first `others` of them: the places Q steps through. */
  readonly otherMarks: SlotMark[] = Array.from({ length: OTHERS_MOST }, () => ({ cls: -1, x: 0, y: 0, z: 0, yaw: 0, tw: 0 }));
  others = 0;
  /** Whether the other slots are marked (Settings.buildSlots). */
  showOthers = true;
  /** What is in the way of the piece where it is shown, for `problem`. */
  readonly by: Blocker = { detail: PLACED_NONE, a: 0, b: 0 };
  /** How many of an item have been set down and not yet taken from the inventory (PredictBuild.pending). */
  pending: ((item: number) => number) | null = null;
  /** The pieces set down that are not rows yet. With them the preview sees those pieces and may build on them. */
  predict: PredictBuild | null = null;
  /** The hologram of a plan the look is on that one of the forms in hand would fill, judged, or null (plans.ts PlanSlots). */
  planSlot: ((forms: ArrayLike<number>, team: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number) => PlanSlot | null) | null = null;
  /** The plan and the piece of it shown, while the mode is PLACE_PLAN. */
  private planId = 0;
  private planIndex = 0;
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
  /**
   * The row being dragged out from the slot the place button went down on: its first slot with its turn, the direction it
   * runs, the `n` pieces the sweep asks for and the `ok` of them that would stand, each one's pose and stability. `code`
   * is why piece `ok` would not, and its pose is there too. `have` is how many of the piece are carried and not yet spent.
   */
  readonly row = { on: false, fr: 0, k0: 0, k1: 0, kind: 0, item: 0, variant: 0, dir: 0, n: 1, ok: 0, code: 0, have: 0, x: new Float64Array(ROW_MOST + 1), y: new Float64Array(ROW_MOST + 1), z: new Float64Array(ROW_MOST + 1), yaw: new Uint16Array(ROW_MOST + 1), tw: new Uint8Array(ROW_MOST + 1), stab: new Int8Array(ROW_MOST + 1), k0s: new Uint32Array(ROW_MOST + 1), k1s: new Uint32Array(ROW_MOST + 1) };
  /** The directions the row may run, what its pieces stand on that is not answered for, and what it was last judged for: its direction, the world's shapes and the predicted pieces' stamp. */
  private readonly rowDirs: number[] = [];
  private readonly rowOn: number[] = [];
  private readonly rowFor = [-1, -1, -1];
  /** The row's pieces that would stand, as the view is shown them, so each next one is judged with those before it. */
  private readonly trial: Overlaid[] = Array.from({ length: ROW_MOST }, (_, i) => ({ id: -1 - i, kind: 0, mode: PLACE_JOIN, fr: 0, k0: 0, k1: 0, x: 0, y: 0, z: 0, yaw: 0 }));
  /** What the view is shown over the rows, when it was last put together and from what. */
  private readonly over: Overlaid[] = [];
  private overStamp = 0;
  private readonly overFor = [-1, -1, -1];
  private rowGen = 0;
  /**
   * The wheel of the forms of the item in hand, open while the form key is held past a tap: the forms' names in the
   * order the item places them, and the one the wheel is on, which the preview shows.
   */
  wheelOpen = false;
  wheelAt = 0;
  readonly wheelNames: string[] = [];
  private tDownAt = -1;
  private wheelX = 0;
  private wheelY = 0;
  /** The built piece last asked how it stands, the store's shapes then, and the answer. */
  private readonly standing = [-1, -1, -2];
  /** Whether `offered` is of the look as it is now. */
  private joining = false;
  /** Slots judged for their marks: what they were judged for, then each one's frame and key, whether it is fine, and its pose. */
  private readonly judgedFor = [-1, -1, -1, -1];
  private judgedN = 0;
  private readonly judged = { fr: new Uint32Array(32), k0: new Uint32Array(32), k1: new Uint32Array(32), ok: new Uint8Array(32), x: new Float64Array(32), y: new Float64Array(32), z: new Float64Array(32), yaw: new Uint16Array(32), tw: new Uint8Array(32) };
  /** What the preview was last worked out from. While none of it changes, it stands. */
  private readonly from = new Float64Array(24).fill(NaN);
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
    const slotted = new Float64Array(6).fill(-1);
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
          stood[6] = support.stands(kind, x, y, z) ? 1 : 0;
        }
        return stood[6] === 1;
      },
      // A piece in a slot is asked about by its key.
      standsAt: (kind, fr, k0, k1) => {
        if (slotted[0] !== kind || slotted[1] !== fr || slotted[2] !== k0 || slotted[3] !== k1 || slotted[4] !== structs.shapes) {
          slotted.set([kind, fr, k0, k1, structs.shapes]);
          slotted[5] = support.standsAt(kind, fr, k0, k1) ? 1 : 0;
        }
        return slotted[5] === 1;
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
    // Over the rows: the pieces set down that are not rows yet, then a dragged row's pieces that would stand.
    const live = this.predict?.live ?? NO_PIECES;
    const r = this.row;
    const trial = r.on ? r.ok : 0;
    const f = this.overFor;
    if (f[0] !== (this.predict?.stamp ?? 0) || f[1] !== trial || f[2] !== this.rowGen) {
      [f[0], f[1], f[2]] = [this.predict?.stamp ?? 0, trial, this.rowGen];
      this.over.length = 0;
      for (const o of live) this.over.push(o);
      for (let i = 0; i < trial; i++) {
        const t = this.trial[i]!;
        [t.kind, t.fr, t.k0, t.k1] = [r.kind, r.fr, r.k0s[i]!, r.k1s[i]!];
        this.over.push(t);
      }
      this.overStamp++;
    }
    view.update(x, z, this.over, this.overStamp, team, this.predict?.taken);
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
      this.row.on = this.wheelOpen = false;
      this.tDownAt = -1;
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
      // The wheel's names are the forms' own: what each kind is called before its material.
      this.wheelNames.length = 0;
      for (const form of forms) this.wheelNames.push(formName(reg, form));
      this.wheelOpen = false;
    }
    if (this.tDownAt >= 0 && !this.wheelOpen && nowMs - this.tDownAt >= HOLD_MS && forms.length > 1) {
      [this.wheelOpen, this.wheelAt, this.wheelX, this.wheelY] = [true, this.variant % forms.length, 0, 0];
    }
    if (this.qDownAt >= 0 && nowMs - this.qDownAt >= HOLD_MS) {
      this.free = !this.free;
      this.qDownAt = -2;
    }
    const kind = forms[(this.wheelOpen ? this.wheelAt : this.variant) % forms.length]!;
    this.kind = kind;
    this.session = session;
    this.reg = reg;
    const team = session.tribe.team;
    const seen = (this.seen = this.look(world, reg, ox, oz, team));
    const have = inv!.count[slot]! - (this.predict ? this.predict.pending(item) : (this.pending?.(item) ?? 0));
    const r = this.row;
    if (r.on && (r.item !== item || r.kind !== kind)) this.cancel();
    if (r.on) {
      // A row is being dragged: its first slot is kept, and the look says how far it runs and which way.
      r.have = have;
      this.others = 0;
      this.drag(session, seen, world, reg, team, ox, oy, oz, dx, dy, dz);
      this.notice = nowMs < this.refusalUntil ? this.refusal : this.words;
      return;
    }
    // Nothing the preview is worked out from has changed: it stands as it is.
    const from = this.from;
    const now = [ox, oy, oz, dx, dy, dz, yaw, kind, this.turn, this.free ? 1 : 0, this.lift, seen === world ? 0 : 1, seen.structs.shapes, world.structs.shapes, this.predict?.stamp ?? 0, team, have, item, this.view!.version, this.planSlot ? plansOf(session).revision : 0];
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
    const planned = this.free ? null : (this.planSlot?.(reg.places[this.item]!, team, ox, oy, oz, dx, dy, dz, BUILD_REACH) ?? null);
    if (planned) {
      // A plan's hologram the piece in hand fills: its own slot and form, whatever is built round it.
      [this.mode, this.planId, this.planIndex, this.kind] = [PLACE_PLAN, planned.plan, planned.index, planned.kind];
      problem = planned.problem;
      [verdict.detail, verdict.a, verdict.b] = [planned.verdict.detail, planned.verdict.a, planned.verdict.b];
      [p.x, p.y, p.z, p.yaw] = [planned.verdict.pose.x, planned.verdict.pose.y, planned.verdict.pose.z, planned.verdict.pose.yaw];
      this.tw = planned.verdict.pose.tw;
    } else if (reg.role[kind] === ROLE_THING && looked >= 0) {
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

  /** Whether pieces of `kind` go down in rows: whole pieces of one cell on a side or a square, of a layer that runs. */
  private runs(reg: Registry, kind: number): boolean {
    const forms = reg.forms;
    const cls = forms.cls[kind]!;
    return (cls === CLS_EDGE || cls === CLS_SQUARE) && forms.size[kind] === SIDE && forms.def[kind]!.cells === undefined && ROW_LAYERS.includes(forms.layer[kind]!);
  }

  /**
   * The place button went down. A piece that goes down in rows, fine where it is shown, begins a row there, which
   * `release` sends; any other is set down at once, as `setDown` does. Returns what `setDown` does, or -1 for a row begun.
   */
  press(session: ClientSession, reg: Registry, nowMs: number): number {
    const predict = this.predict;
    const p = this.pose;
    const view = this.view !== null && this.seen === this.view.world ? this.view : null;
    if (!this.active || this.mode !== PLACE_JOIN || this.problem !== 0 || !view || !predict || !this.runs(reg, this.kind) || predict.covers(p.x / STRUCT_UNITS, p.y / STRUCT_UNITS, p.z / STRUCT_UNITS)) return this.setDown(session, reg, nowMs);
    const r = this.row;
    const k1 = this.keyed(reg);
    [r.on, r.fr, r.k0, r.k1, r.kind, r.item, r.variant] = [true, this.slot.fr, this.slot.k0, k1, this.kind, this.item, this.variant % reg.places[this.item]!.length];
    [r.n, r.ok, r.code, r.dir] = [1, 1, 0, keyDir(k1)];
    [r.x[0], r.y[0], r.z[0], r.yaw[0], r.tw[0], r.stab[0], r.k0s[0], r.k1s[0]] = [p.x / STRUCT_UNITS, p.y / STRUCT_UNITS, p.z / STRUCT_UNITS, p.yaw, this.tw, this.stability, r.k0, k1];
    // A side's pieces run along it either way; a square's along either of its sides, either way.
    this.rowDirs.length = 0;
    for (let q = 0; q < 12; q += keyCls(r.k0) === CLS_EDGE ? 6 : 3) this.rowDirs.push(dirTurn(r.dir, q));
    this.rowOn.length = 0;
    this.rowOn.push(...this.on);
    [this.rowFor[0], this.rowFor[1], this.rowFor[2]] = [r.dir, session.world?.structs.shapes ?? -1, predict.stamp];
    this.rowGen++;
    return -1;
  }

  /** Gives up the row being dragged. False if there was none. */
  cancel(): boolean {
    if (!this.row.on) return false;
    this.row.on = false;
    this.rowGen++;
    this.from[0] = NaN;
    return true;
  }

  /**
   * The place button came up: the row dragged out goes as one command, its pieces that would stand, and each is handed to
   * `predict` to be drawn at once. Returns the command's sequence number, -1 for one held back, 0 if nothing was asked.
   */
  release(session: ClientSession, reg: Registry, nowMs: number): number {
    const r = this.row;
    const predict = this.predict;
    if (!this.cancel() || !predict) return 0;
    if (r.ok === 0) {
      if (this.words !== "") this.say(this.words, nowMs);
      return 0;
    }
    const held = r.fr >= PROVISIONAL;
    const { variant, fr, k0, k1, ok, dir } = r;
    const seq = held ? 0 : (this.asked = session.command(CMD_PLACE, (w: BitWriter) => writeJoin(w, variant, fr, k0, k1, ok, dir)));
    if (!held && seq === 0) return 0;
    for (let i = 0; i < ok; i++) {
      const at: Asking = { mode: PLACE_JOIN, variant, fr, k0: r.k0s[i]!, k1: r.k1s[i]!, on: this.rowOn, index: i, count: ok, step: dir, tw: r.tw[i]! };
      predict.add(seq, r.kind, r.item, r.x[i]!, r.y[i]!, r.z[i]!, r.yaw[i]!, nowMs, at);
    }
    return held ? -1 : seq;
  }

  /**
   * A frame of the row being dragged: the look, met with the first slot's level, says which way the row runs and how many
   * pieces; each is judged in order as the server will judge it, with those before it in place, a few a frame. The way and
   * the count are kept until the look has gone past the next by the margin a slot is kept by.
   */
  private drag(session: ClientSession, seen: CollisionWorld, world: CollisionWorld, reg: Registry, team: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    const r = this.row;
    const view = this.view!;
    const predict = this.predict!;
    // While the view is being read the row stands as it was.
    if (seen === world) return;
    const f = seen.structs.frames.get(r.fr);
    if (!f) {
      [r.ok, r.code, this.problem] = [0, RESULT_NO_SNAP, RESULT_NO_SNAP];
      this.words = BUILD_REASONS[RESULT_NO_SNAP]!;
      return;
    }
    const at = this.slotMark;
    slotMarkOf(f, r.k0, r.k1, at);
    // Where the look meets the slot's level, from above it or from under it; a look that never does runs the row far out.
    let t = Math.abs(dy) > 1e-4 ? (at.y - oy) / dy : ROW_LOOK;
    if (!(t > 0 && t < ROW_LOOK)) t = ROW_LOOK;
    const px = ox + dx * t - at.x;
    const pz = oz + dz * t - at.z;
    const side = SIDE * HALF_SIDE_M;
    let best = r.dir;
    let most = -Infinity;
    let along = 0;
    let ux = 0;
    let uz = 0;
    for (const d of this.rowDirs) {
      dirVector(f.basis, d, point, 0);
      const len = Math.hypot(point[0]!, point[1]!);
      const a = (px * point[0]! + pz * point[1]!) / len;
      if (d === r.dir) [along, ux, uz] = [a, point[0]! / len, point[1]! / len];
      if (a > most) [most, best] = [a, d];
    }
    if (best !== r.dir && most > along + SWITCH_MARGIN) {
      dirVector(f.basis, best, point, 0);
      const len = Math.hypot(point[0]!, point[1]!);
      [r.dir, along, ux, uz, r.n] = [best, most, point[0]! / len, point[1]! / len, 1];
    }
    // One more piece once the look is past the next slot's near edge by the margin, one fewer once it is back past it by as much.
    const more = 1 + Math.floor((along + side / 2 - SWITCH_MARGIN) / side);
    const fewer = 1 + Math.floor((along + side / 2 + SWITCH_MARGIN) / side);
    const n = more > r.n ? more : fewer < r.n ? fewer : r.n;
    r.n = Math.max(1, Math.min(ROW_MOST, r.have, PREDICT_MOST - predict.entries.length, n));
    const judgedFor = this.rowFor;
    const shapes = world.structs.shapes;
    if (judgedFor[0] !== r.dir || judgedFor[1] !== shapes || judgedFor[2] !== predict.stamp) {
      [judgedFor[0], judgedFor[1], judgedFor[2]] = [r.dir, shapes, predict.stamp];
      [r.ok, r.code] = [0, 0];
      this.rowGen++;
    }
    if (r.ok >= r.n) [r.ok, r.code] = [r.n, 0];
    const by = this.by;
    for (let left = ROW_A_FRAME; r.ok < r.n && r.code === 0 && left > 0; left--) {
      const i = r.ok;
      // The pieces before it lie in the view while it is judged, and the view holds whole the ground it stands on.
      const mx = at.x + ux * side * i;
      const mz = at.z + uz * side * i;
      view.reach(mx - ROW_NEED, mz - ROW_NEED, mx + ROW_NEED, mz + ROW_NEED);
      if (this.look(world, reg, ox, oz, team) === world || !view.ready(mx - ROW_NEED, mz - ROW_NEED, mx + ROW_NEED, mz + ROW_NEED)) break;
      const { site, support } = this.siteFor(seen);
      const code = runKey(r.k0, r.k1, r.dir, i, stepKey) ? validate(site, r.kind, team, r.fr, stepKey.k0, stepKey.k1, i === 0 ? ox : NaN, oy, oz, this.verdict) : RESULT_NO_SNAP;
      const q = this.verdict.pose;
      [r.x[i], r.y[i], r.z[i], r.yaw[i], r.tw[i], r.k0s[i], r.k1s[i]] = [q.x / STRUCT_UNITS, q.y / STRUCT_UNITS, q.z / STRUCT_UNITS, q.yaw, q.tw, stepKey.k0, stepKey.k1];
      if (code !== RESULT_OK) {
        r.code = code;
        [by.detail, by.a, by.b] = code === RESULT_NO_SNAP ? [PLACED_NONE, 0, 0] : [this.verdict.detail, this.verdict.a, this.verdict.b];
        break;
      }
      r.stab[i] = support.stabilityAt(r.kind, r.fr, stepKey.k0, stepKey.k1);
      r.ok++;
    }
    this.problem = r.ok === 0 ? r.code : 0;
    this.words = r.code === 0 ? "" : buildReason(reg, session, r.code, by, undefined, seen.structs);
    if (r.ok > 0) this.stability = r.stab[0]!;
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

  /**
   * How well the built piece `ref` of `world` stands, for the words under the crosshair with a piece in hand: its
   * stability, or -2 for none to say. Asked again only when another piece is looked at or one has been set down or gone.
   */
  stabilityOf(world: CollisionWorld, ref: number): number {
    if (!this.active || !this.reg) return -2;
    const s = this.standing;
    if (s[0] !== ref || s[1] !== world.structs.shapes) {
      [s[0], s[1]] = [ref, world.structs.shapes];
      s[2] = world.structs.frameAt(ref) !== 0 ? this.siteFor(world).support.stability(ref) : -2;
    }
    return s[2]!;
  }

  /** What the hotbar's line says of the piece shown: how well it would stand. "" with nothing to say. */
  says(): string {
    const r = this.row;
    const s = this.session;
    // Past four fifths of the most structures that may stand here, how many do: first, so a narrow line keeps it.
    const room = s !== null && s.structuresCap > 0 && s.structuresNear >= s.structuresCap * CAP_SAID_FROM ? `${s.structuresNear.toLocaleString("en-US")} of ${s.structuresCap.toLocaleString("en-US")} structures here` : "";
    let stands = this.problem === 0 && this.stability >= 0 ? `Stability ${this.stability} of ${this.stabilityMost}` : "";
    if (r.on && r.ok > 0) {
      let least = this.stabilityMost;
      for (let i = 0; i < r.ok; i++) least = Math.min(least, r.stab[i]!);
      stands = `Row of ${r.ok}, of ${r.have} carried   Stability ${least} of ${this.stabilityMost} at least`;
    }
    return room !== "" && stands !== "" ? `${room}   ${stands}` : room || stands;
  }

  /** The palette colour a piece of stability `stab` that stands is shown in. */
  colorOf(stab: number): number {
    return stab >= 0 && stab < STABLE_FROM ? GHOST_WARN : GHOST_OK;
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
    if (code === "KeyT") {
      if (down && !repeat) this.tDownAt = nowMs;
      else if (!down) {
        // Let go on the wheel, the form it was on is taken. Let go before the wheel opened, it was a tap: the next form.
        if (this.wheelOpen) this.variant = this.wheelAt;
        else if (this.tDownAt >= 0) this.variant++;
        if (this.wheelOpen || this.tDownAt >= 0) this.turn = 0;
        this.wheelOpen = false;
        this.tDownAt = -1;
      }
      return true;
    }
    if (code !== "KeyR" && code !== "ArrowUp" && code !== "ArrowDown") return false;
    if (!down) return true;
    if (code === "KeyR" && !repeat) this.rotate(1, reg);
    else if (code === "KeyR") return true;
    else if (this.mode === PLACE_JOIN) this.raise += code === "ArrowUp" ? 1 : -1;
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

  /** The look's movement while the forms' wheel is open, in pixels as a mouse moves: the wheel goes to the form that way from its middle. */
  turnWheel(dx: number, dy: number): void {
    const n = this.wheelNames.length;
    if (!this.wheelOpen || n === 0) return;
    this.wheelX += dx;
    this.wheelY += dy;
    const far = Math.hypot(this.wheelX, this.wheelY);
    if (far > WHEEL_REACH) [this.wheelX, this.wheelY] = [(this.wheelX / far) * WHEEL_REACH, (this.wheelY / far) * WHEEL_REACH];
    if (far < WHEEL_DEAD) return;
    // The first form is straight up, and the rest follow round to the right.
    const turn = Math.atan2(this.wheelX, -this.wheelY) / ((2 * Math.PI) / n);
    this.wheelAt = ((Math.round(turn) % n) + n) % n;
  }

  /** The mouse wheel's notches, which turn the piece one step a whole notch, or with the forms' wheel open step through the forms. */
  scroll(notches: number, reg: Registry): void {
    this.wheel += notches;
    const steps = Math.trunc(this.wheel);
    if (steps === 0) return;
    this.wheel -= steps;
    const n = this.wheelNames.length;
    if (this.wheelOpen && n > 0) {
      this.wheelAt = (((this.wheelAt + steps) % n) + n) % n;
      this.wheelX = this.wheelY = 0;
      return;
    }
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
    // A piece standing in another state than it was set down in, a door opened, is picked as the form that was set down.
    const stands = t.kind[ref & 0xffff]!;
    const item = reg.pieceItem[stands]!;
    const kind = item !== 0 && !reg.places[item]!.includes(stands) && reg.opens[stands] !== 0 ? reg.opens[stands]! : stands;
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
      // A plan's piece is drawn at once and no more: the view shows the preview a piece by its slot or its own pose.
      if (!predict.add(seq, this.kind, this.item, x, y, z, p.yaw, nowMs, view && this.mode !== PLACE_PLAN ? at : null) && held) return 0;
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
      if (mode === PLACE_PLAN) writeFill(w, this.planId, this.planIndex);
      else if (mode === PLACE_JOIN) writeJoin(w, variant, fr, k0, k1);
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
    if (down && !repeat && !c.builder.cancel()) c.builder.putAway(c.session, c.nowMs);
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
    { code: "KeyT", group: G_BUILD, title: "Next form / form wheel", detail: "Tap for the next form of the piece in hand: wall, doorframe, windowframe. Hold for a wheel of them, move the look or scroll to one, and let go.", sheet: G_BUILD },
    { code: "KeyX", group: G_BUILD, title: "Put away", detail: "Put the piece in hand away. The right mouse button does too.", sheet: G_BUILD },
    { code: "KeyE", group: G_BUILD, title: "Use / piece menu", detail: "Tap to use what you look at. Hold on a built piece to mend it, take it back or take it down.", sheet: G_BUILD },
    { code: "ArrowUp", group: G_BUILD, title: "Raise preview", sheet: G_BUILD },
    { code: "ArrowDown", group: G_BUILD, title: "Lower preview", sheet: G_BUILD },
    { code: "Mouse0", group: G_BUILD, title: "Place / drag a row", detail: "Click to set the piece down. Hold and sweep the look to lay floors, foundations or walls in a row of up to 32, set down when you let go. X or the right button gives the row up.", sheet: G_BUILD },
    { code: "Mouse1", group: G_BUILD, title: "Pick piece", detail: "Take in hand the piece that builds what you look at, if you carry one.", sheet: G_BUILD },
    { code: "Mouse2", group: G_BUILD, title: "Put away", sheet: G_BUILD },
  ],
  when: (c) => building(c),
  press(c, code, down, repeat) {
    if (code !== "KeyX") return c.builder.key(code, down, repeat, c.nowMs, c.reg) || undefined;
    // A row being dragged is given up; with none, the piece is put away.
    if (down && !repeat && !c.builder.cancel()) c.builder.putAway(c.session, c.nowMs);
    return true;
  },
}];
