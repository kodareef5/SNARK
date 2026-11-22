// Where a blow lands, the body snaps back from it (EVENT_IMPACT, server/combat.ts): the bone struck and the few above it
// toward the root are turned away from the blow by damped springs, then settle back to the animation in about a third of
// a second, a shoulder shot snapping the shoulder back and the chest after it. It is drawn only: the server's hit shapes
// are the animation's (server/combat.ts), and the turn is at most a few tens of degrees for a moment.
//
// The springs act on the pose before it is solved, as a turn about a level axis square to the blow, in the model's
// space, carried into each bone's own space through its parent as last solved. A body heavier than SPRING_MASS turns less
// in proportion, so a rifle round rocks a survivor and barely moves a rex. Bodies are taken up to MOST; a blow to one
// more is not drawn, decided as it comes, and a spring once started always runs its course.

import type { Pose } from "../../../shared/anim/clip.ts";
import type { Skeleton, Solved } from "../../../shared/anim/skeleton.ts";

/** Bodies whose springs run at once. */
export const SPRINGS_MOST = 48;
/** Bones from the one struck toward the root that turn, and the share of the turn each takes. */
const CHAIN = [1, 0.6, 0.35, 0.2];
/** Radians a second the springs ring at, and their damping ratio: a quick snap and a little overshoot. */
const OMEGA = 18;
const ZETA = 0.55;
/** Radians a second of spin a blow of full strength starts in the bone it struck. */
const KICK = 11;
/** Kilograms a blow is drawn at full for; heavier bodies turn less, down to LEAST of it. */
const SPRING_MASS = 120;
const LEAST = 0.12;
/** Below this many radians and radians a second a spring is done. */
const REST = 0.002;
const MOST_ANGLE = 0.7;
/** Bones a body keeps springs on. */
const BONES = 8;

class Body {
  id = -1;
  n = 0;
  readonly bone = new Int16Array(BONES);
  /** Per spring, its turn as a vector in the model's space (axis times angle) and its spin. */
  readonly turn = new Float64Array(BONES * 3);
  readonly spin = new Float64Array(BONES * 3);
}

const q = new Float64Array(4);
const p = new Float64Array(4);
const t = new Float64Array(4);

/** a * b into out (quaternions as x, y, z, w). */
function mul(out: Float64Array, ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number): void {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

export class ImpactSprings {
  private readonly bodies: Body[] = Array.from({ length: SPRINGS_MOST }, () => new Body());
  private readonly byId = new Map<number, Body>();
  /** Blows not drawn for want of a free body, since the start. */
  dropped = 0;

  /** Whether body `id` has springs running: it is posed every frame while it has. */
  active(id: number): boolean {
    return this.byId.has(id);
  }

  get count(): number {
    return this.byId.size;
  }

  /**
   * A blow on body `id`, of skeleton `skel` facing `yaw` radians, struck at `bone` (-1: its root's child chain from the
   * middle of it), going the unit way (dx, dy, dz) in the world, `strength` 0 to 1, the body weighing `mass` kg.
   */
  hit(id: number, skel: Skeleton, yaw: number, bone: number, dx: number, dy: number, dz: number, strength: number, mass: number): void {
    let b = this.byId.get(id);
    if (!b) {
      b = this.bodies.find((x) => x.id < 0);
      if (!b) {
        this.dropped++;
        return;
      }
      b.id = id;
      b.n = 0;
      this.byId.set(id, b);
    }
    // The blow's way in the model's space: the world's turned back by the body's yaw.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const mx = c * dx - s * dz, mz = s * dx + c * dz;
    // Turned about the level axis square to the blow, so what was struck goes the way the blow went: up x way.
    let ax = mz, az = -mx;
    const al = Math.sqrt(ax * ax + az * az);
    if (al < 1e-6) return;
    ax /= al;
    az /= al;
    const weight = mass > SPRING_MASS ? Math.max(LEAST, SPRING_MASS / mass) : 1;
    const kick = KICK * (0.35 + 0.65 * strength) * weight;
    // Struck nowhere in particular, the blow takes the body's middle: the first bone a third of the way down its list.
    let at = bone >= 0 && bone < skel.bones ? bone : Math.max(0, Math.min(skel.bones - 1, Math.floor(skel.bones / 3)));
    for (let k = 0; k < CHAIN.length && at >= 0; k++, at = skel.parent[at]!) {
      // The root moves the whole body, which its own motion already does.
      if (skel.parent[at]! < 0) break;
      let j = 0;
      while (j < b.n && b.bone[j] !== at) j++;
      if (j === b.n) {
        if (b.n === BONES) break;
        b.bone[j] = at;
        b.turn[j * 3] = b.turn[j * 3 + 1] = b.turn[j * 3 + 2] = 0;
        b.spin[j * 3] = b.spin[j * 3 + 1] = b.spin[j * 3 + 2] = 0;
        b.n++;
      }
      b.spin[j * 3]! += ax * kick * CHAIN[k]!;
      b.spin[j * 3 + 2]! += az * kick * CHAIN[k]!;
    }
  }

  /** Moves every spring on by `dt` seconds, and lets go of the bodies whose springs are done. */
  step(dt: number): void {
    if (this.byId.size === 0) return;
    // Exactly integrated over a step at most a sixtieth of a second, a few steps for a long frame.
    const steps = Math.min(8, Math.max(1, Math.ceil(dt * 60)));
    const h = dt / steps;
    for (const b of this.byId.values()) {
      let moving = false;
      for (let j = 0; j < b.n; j++) {
        for (let a = 0; a < 3; a++) {
          const i = j * 3 + a;
          let x = b.turn[i]!, v = b.spin[i]!;
          for (let k = 0; k < steps; k++) {
            v += (-OMEGA * OMEGA * x - 2 * ZETA * OMEGA * v) * h;
            x += v * h;
          }
          if (x > MOST_ANGLE) x = MOST_ANGLE;
          else if (x < -MOST_ANGLE) x = -MOST_ANGLE;
          b.turn[i] = x;
          b.spin[i] = v;
          if (Math.abs(x) > REST || Math.abs(v) > REST * OMEGA) moving = true;
        }
      }
      if (!moving) {
        this.byId.delete(b.id);
        b.id = -1;
        b.n = 0;
      }
    }
  }

  /**
   * Turns `pose` of body `id` (skeleton `skel`) by its springs, before it is solved. `last` is its pose as last solved, whose
   * parents carry each turn from the model's space into the bone's own; null, the turn is taken as the bone's own.
   */
  apply(id: number, skel: Skeleton, pose: Pose, last: Solved | null): void {
    const b = this.byId.get(id);
    if (!b) return;
    const rot = pose.rot;
    for (let j = 0; j < b.n; j++) {
      const bone = b.bone[j]!;
      const tx = b.turn[j * 3]!, ty = b.turn[j * 3 + 1]!, tz = b.turn[j * 3 + 2]!;
      const angle = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (angle < 1e-6) continue;
      const s = Math.sin(angle / 2) / angle;
      q[0] = tx * s; q[1] = ty * s; q[2] = tz * s; q[3] = Math.cos(angle / 2);
      const parent = skel.parent[bone]!;
      // The parent's turn in the model's space as last solved, P: the bone's own turn becomes conj(P) q P before its own.
      const o0 = parent * 4;
      // A pose never solved yet (all zeros) has no parent turn to carry it through: the turn is taken as the bone's own.
      if (last && parent >= 0 && last.rot[o0]! ** 2 + last.rot[o0 + 1]! ** 2 + last.rot[o0 + 2]! ** 2 + last.rot[o0 + 3]! ** 2 > 0.5) {
        const px = last.rot[o0]!, py = last.rot[o0 + 1]!, pz = last.rot[o0 + 2]!, pw = last.rot[o0 + 3]!;
        mul(t, q[0]!, q[1]!, q[2]!, q[3]!, px, py, pz, pw);
        mul(p, -px, -py, -pz, pw, t[0]!, t[1]!, t[2]!, t[3]!);
      } else p.set(q);
      const o = bone * 4;
      mul(t, p[0]!, p[1]!, p[2]!, p[3]!, rot[o]!, rot[o + 1]!, rot[o + 2]!, rot[o + 3]!);
      rot[o] = t[0]!; rot[o + 1] = t[1]!; rot[o + 2] = t[2]!; rot[o + 3] = t[3]!;
    }
  }
}
