// The view of the own survivor knocked down or dying. Knocked down, the eye rides the ragdoll's head, the look held within
// LOOK_REACH of where the head faces. Getting up, or toppled, the eye goes with the head as the body's reaction poses it,
// as every machine poses it (shared/anim/reactions.ts), from the ragdoll's as the body is handed over to the standing
// eye as it stands; the look stays the player's. Behind, the camera follows the hips. Dying, the eye stays with the head
// of the body it leaves as that falls, or where it last was if that body is not in view, while the edges go red and
// close in and then all goes black (DYING_MS). A part of the app's frame between the own body and the camera's place
// (place.ts); the HUD draws its red and black (hud/fallen.ts).

import { Pose } from "../../../shared/anim/clip.ts";
import { B_HEAD, B_HIPS, HUMAN, SOCKET_EYE } from "../../../shared/anim/human.ts";
import { CUE_DEAD, humanPose } from "../../../shared/anim/pose.ts";
import { lyingShare } from "../../../shared/anim/reactions.ts";
import { boneToModel, Solved, solve } from "../../../shared/anim/skeleton.ts";
import { SESSION_ALIVE, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import { survivorKind } from "../../../shared/sim/blockers.ts";
import { MF_DOWN } from "../../../shared/sim/character.ts";
import { quatRotate } from "../../../shared/math/quat.ts";
import { TAU } from "../../../shared/math/scalar.ts";
import type { AppFrame, FramePart } from "../frame.ts";
import type { HumanFall } from "../ragdoll.ts";

/** What the view hands the camera and the HUD each frame. */
export interface FallenShown {
  /** The camera's pivot is (x, y, z): the ragdoll's eye from the eye, its hips from behind. */
  on: boolean;
  x: number;
  y: number;
  z: number;
  /** The red edge's strength and how far in it reaches, as shares of half the screen, and the black over all; each 0 to 1. */
  red: number;
  reach: number;
  black: number;
}

export function fallenShown(): FallenShown {
  return { on: false, x: 0, y: 0, z: 0, red: 0, reach: 0, black: 0 };
}

/** Milliseconds from death to black. */
export const DYING_MS = 1500;
/** Milliseconds the eye takes to follow the head, critically damped, so the solver's shiver does not show. */
const FOLLOW_MS = 80;
/** Radians the look may turn from where the head faces. */
const LOOK_REACH = Math.PI / 3;
/** The red edge of a body lying knocked down. */
const DOWN_RED = 0.45;
const DOWN_REACH = 0.22;
/** Metres above the hips the camera looks at from behind. */
const HIPS_UP = 0.3;
/** Metres from where the body died its own body may come in the view. */
const CORPSE_NEAR = 3;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The red and black `ms` after death: the edges redden and close in, and black comes over them by DYING_MS. */
export function dying(ms: number, out: FallenShown): void {
  const t = Math.max(0, ms) / DYING_MS;
  out.red = smooth(t / 0.4);
  out.reach = 0.2 + 0.8 * smooth(t / 0.8);
  out.black = smooth((t - 0.4) / 0.6);
}

/** Writes to `out` the world point of the eye of fall `h`, and returns the head's facing as [yaw, pitch] in `look`. */
export function headEye(h: HumanFall, out: Float64Array, look: Float64Array): void {
  const p = h.solved, s = Math.sin(h.yaw), c = Math.cos(h.yaw);
  boneToModel(p, B_HEAD, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, out);
  const mx = out[0]!, mz = out[2]!;
  out[0] = h.x + c * mx + s * mz;
  out[1] = h.y + out[1]!;
  out[2] = h.z - s * mx + c * mz;
  // Where the face points, and the top of the head, which says the way ahead for a face turned up or down.
  quatRotate(p.rot, B_HEAD * 4, 0, 0, 1, look, 0);
  const fx = look[0]!, fy = look[1]!, fz = look[2]!;
  quatRotate(p.rot, B_HEAD * 4, 0, 1, 0, look, 0);
  const w = Math.abs(fy), hx = fx + look[0]! * w, hz = fz + look[2]! * w;
  look[0] = Math.atan2(c * hx + s * hz, -s * hx + c * hz);
  look[1] = Math.asin(Math.max(-1, Math.min(1, fy)));
}

export class FallenView implements FramePart {
  /** The followed pivot and its speed, and the head's facing as followed. */
  private readonly at = new Float64Array(3);
  private readonly speed = new Float64Array(3);
  private readonly head = new Float64Array(2);
  private readonly headSpeed = new Float64Array(2);
  private placed = false;
  /** The own body was alive since the last welcome, the time it died (-1 alive), where, and the entity its body is (-1 not found). */
  private lived = false;
  private diedAt = -1;
  private readonly diedPlace = new Float64Array(3);
  private corpse = -1;
  private corpseGen = 0;
  private readonly eye = new Float64Array(3);
  private readonly look = new Float64Array(2);
  /** Last frame held the look to the head. */
  private wasHeld = false;
  /** Where the own body was last frame, while it lived, which the eye goes along with on its feet. */
  private readonly was = new Float64Array(3);
  private wasKnown = false;
  /** The own body as its reaction poses it, and where that puts the eye. */
  private readonly pose = new Pose(HUMAN.bones);
  private readonly solved = new Solved(HUMAN.bones);
  private readonly posed = new Float64Array(3);

  step(f: AppFrame): void {
    const out = f.fallen, s = f.session, ch = f.scene.characters, c = f.controls;
    out.on = false; out.red = out.reach = out.black = 0;
    f.scene.headless = -1;
    const alive = f.alive && !f.riding;
    if (s.sessionState === SESSION_ALIVE) {
      this.lived = true; this.diedAt = -1; this.corpse = -1;
    } else if (s.sessionState === SESSION_DEAD && this.lived && this.diedAt < 0) {
      this.diedAt = f.nowMs;
      this.diedPlace[0] = this.at[0]!; this.diedPlace[1] = this.at[1]!; this.diedPlace[2] = this.at[2]!;
    } else if (s.sessionState !== SESSION_DEAD) this.lived = false;
    const dead = this.diedAt >= 0, down = alive && (s.own.mflags & MF_DOWN) !== 0;
    let h: HumanFall | undefined;
    if (alive) h = ch.humanFall(f.body.id);
    else if (dead) {
      if (this.corpse < 0) this.findCorpse(f);
      if (this.corpse >= 0) h = this.corpseFall(f);
    }
    const third = !dead && (f.third || f.orbiting);
    // Where the camera would be standing, which a knock starts from and getting up goes back to; toppled or getting up,
    // where the body's reaction has its eye, toward the standing eye as it stands.
    let nx = f.bx, ny = f.by + f.eye, nz = f.bz;
    const lies = alive ? this.reacted(f, third) : 0;
    if (lies > 0) {
      nx += (this.posed[0]! - nx) * lies;
      ny += (this.posed[1]! - ny) * lies;
      nz += (this.posed[2]! - nz) * lies;
    }
    let tx = nx, ty = ny, tz = nz, held = false;
    if (h) {
      headEye(h, this.eye, this.look);
      if (third) { this.eye[0] = h.x; this.eye[1] = h.y + HIPS_UP; this.eye[2] = h.z; }
      const k = h.down || dead ? 0 : smooth(h.risen);
      tx = this.eye[0]! + (nx - this.eye[0]!) * k;
      ty = this.eye[1]! + (ny - this.eye[1]!) * k;
      tz = this.eye[2]! + (nz - this.eye[2]!) * k;
      held = (h.down || dead) && !third;
    } else if (dead || down) {
      // Its fall not come yet, or its body not in view: the eye stays where it was.
      tx = this.at[0]!; ty = this.at[1]!; tz = this.at[2]!;
    }
    const following = h !== undefined || dead || down || lies > 0;
    if (!this.placed || !following) {
      // Standing, it keeps to the standing eye, so a fall eases from there.
      this.at[0] = tx; this.at[1] = ty; this.at[2] = tz;
      this.speed.fill(0);
      this.placed = true;
    } else {
      // On its feet again, the eye goes along with the body as it moves and follows only what its pose does, so walking
      // off as it gets up leaves the eye no way behind.
      if (alive && !down && !h?.down && this.wasKnown) {
        this.at[0] = this.at[0]! + f.bx - this.was[0]!;
        this.at[1] = this.at[1]! + f.by - this.was[1]!;
        this.at[2] = this.at[2]! + f.bz - this.was[2]!;
      }
      follow(this.at, this.speed, 0, tx, f.dt);
      follow(this.at, this.speed, 1, ty, f.dt);
      follow(this.at, this.speed, 2, tz, f.dt);
    }
    this.was[0] = f.bx; this.was[1] = f.by; this.was[2] = f.bz;
    this.wasKnown = alive;
    if (h && held) {
      // The head's facing is followed as the eye is; the look is kept within reach of it.
      if (!this.wasHeld) { this.head[0] = this.look[0]!; this.head[1] = this.look[1]!; this.headSpeed.fill(0); }
      else {
        follow(this.head, this.headSpeed, 0, this.head[0]! + angle(this.look[0]! - this.head[0]!), f.dt);
        follow(this.head, this.headSpeed, 1, this.look[1]!, f.dt);
      }
      const turn = angle(c.yaw - this.head[0]!);
      if (turn > LOOK_REACH) c.yaw += LOOK_REACH - turn;
      else if (turn < -LOOK_REACH) c.yaw += -LOOK_REACH - turn;
      c.pitch = Math.max(Math.max(-1.5, this.head[1]! - LOOK_REACH), Math.min(Math.min(1.5, this.head[1]! + LOOK_REACH), c.pitch));
      f.lookYaw = c.yaw;
      f.lookPitch = c.pitch;
    }
    this.wasHeld = held;
    if (following) {
      out.on = true;
      out.x = this.at[0]!; out.y = this.at[1]!; out.z = this.at[2]!;
    }
    if (dead) {
      dying(f.nowMs - this.diedAt, out);
      if (this.corpse >= 0 && h) f.scene.headless = this.corpse;
    } else if (alive) {
      out.red = DOWN_RED * (down ? 1 : h && !h.down ? 1 - smooth(h.risen) : 0);
      out.reach = DOWN_REACH;
    }
  }

  /**
   * How far down the own body's reaction lays it now, 0 standing; and into `posed` where that puts its eye, or its hips
   * from behind, as every machine poses it.
   */
  private reacted(f: AppFrame, third: boolean): number {
    const body = f.body, st = body.state, lies = lyingShare(st.react, body.tick);
    if (lies <= 0) return 0;
    st.facing = body.yaw / TAU;
    humanPose(f.scene.characters.anim, st, body.tick, this.pose);
    solve(HUMAN, this.pose, this.solved);
    if (third) {
      boneToModel(this.solved, B_HIPS, 0, 0, 0, this.posed);
      this.posed[1] = this.posed[1]! + HIPS_UP;
    } else boneToModel(this.solved, B_HEAD, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, this.posed);
    const s = Math.sin(body.yaw), c = Math.cos(body.yaw), mx = this.posed[0]!, mz = this.posed[2]!;
    this.posed[0] = body.x + c * mx + s * mz;
    this.posed[1] = body.y + this.posed[1]!;
    this.posed[2] = body.z - s * mx + c * mz;
    return lies;
  }

  /** The own body's body: a survivor's, dead, come in the view near where it died, its own name's first. */
  private findCorpse(f: AppFrame): void {
    const r = f.remote, reg = f.reg, name = f.session.name, p = this.diedPlace;
    let best = CORPSE_NEAR * CORPSE_NEAR, named = false;
    for (let i = 0; i < r.count; i++) {
      if ((r.cue[i]! & CUE_DEAD) === 0 || !survivorKind(reg, r.kind[i]!)) continue;
      const far = (r.x[i]! - p[0]!) ** 2 + (r.z[i]! - p[2]!) ** 2, mine = r.name[i] === name;
      if (far >= CORPSE_NEAR * CORPSE_NEAR || (named && !mine) || (far >= best && mine === named)) continue;
      best = far; named = mine;
      this.corpse = r.id[i]!; this.corpseGen = r.gen[i]!;
    }
  }

  /** The fall the own body's body lies as, while it is in view as the same entity. */
  private corpseFall(f: AppFrame): HumanFall | undefined {
    const r = f.remote;
    for (let i = 0; i < r.count; i++) if (r.id[i] === this.corpse) return r.gen[i] === this.corpseGen ? f.scene.characters.humanFall(this.corpse) : undefined;
    return undefined;
  }
}

/** One frame of `dt` ms of a critically damped follow of channel `i` of `x`, at speed `v`, toward `to`. */
function follow(x: Float64Array, v: Float64Array, i: number, to: number, dt: number): void {
  const w = 2000 / FOLLOW_MS, sec = Math.min(dt, 100) / 1000, t = w * sec;
  const e = 1 / (1 + t + 0.48 * t * t + 0.235 * t * t * t);
  const change = x[i]! - to, step = (v[i]! + w * change) * sec;
  v[i] = (v[i]! - w * step) * e;
  x[i] = to + (change + step) * e;
}
