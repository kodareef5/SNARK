// What survivors are heard doing, the player's own body and every other survivor in view, found from what the client
// already has: the predicted body for the player, and the pose word of the others' snapshots. A step is heard each
// stride of ground covered, a jump as the feet leave going up, a landing as they meet the ground again, and water as a
// body goes in, swims and comes out. The player's own voice and steps play at the ear, close and unplaced, so turning
// the camera never swings them round; everyone else's are placed where they are.

import { LOOK_BYTES, LOOK_SEX } from "../../../shared/anim/look.ts";
import { AnimState, bodySeed } from "../../../shared/anim/pose.ts";
import { MODE_SWIM, MF_OUT, MF_WINDED, STANCE_CROUCH, STANCE_PRONE } from "../../../shared/sim/character.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { RemoteSample } from "../session.ts";
import { GROUND_NAMES, groundAt } from "./ground.ts";

/** Metres of ground a stride covers, by stance: a step is heard at each. */
const STRIDE = 1.4;
const STRIDE_CROUCH = 0.9;
const STRIDE_PRONE = 0.7;
/** Metres of water a stroke covers. */
const STROKE = 1.6;
/** Metres a second of falling that makes a landing heard, and that hurts enough to be heard in the voice. */
const LAND_SPEED = 3;
const LAND_HURT_SPEED = 9;
/** Metres a step is heard to at most, whatever its sound says. */
const STEP_REACH = 25;

const STEP = GROUND_NAMES.map((g) => cueKey(`step/${g}`));
const LAND = GROUND_NAMES.map((g) => cueKey(`land/${g}`));
const SPLASH_IN = cueKey("splash/in");
const SPLASH_OUT = cueKey("splash/out");
const SWIM = cueKey("swim");
const VOICE = (sex: string, n: string): number => cueKey(`voice/${sex}/${n}`);
const JUMP = [VOICE("male", "jump"), VOICE("female", "jump")];
const LAND_VOICE = [VOICE("male", "land"), VOICE("female", "land")];
const WINDED = [VOICE("male", "winded"), VOICE("female", "winded")];
const KNOCKED = [VOICE("male", "knocked_out"), VOICE("female", "knocked_out")];
const WAKE = [VOICE("male", "wake"), VOICE("female", "wake")];

/** Hands an occasion to be heard: `owner` an owner number of the resolver, `key` a cue key, `entity` -1 for none, `flat` at the ear. */
export type Hear = (owner: number, key: number, entity: number, x: number, y: number, z: number, lift: number, level: number, flat: boolean, delay?: number) => void;

/** What is kept of a body between frames. */
class Walker {
  seen = 0;
  x = 0;
  y = 0;
  z = 0;
  /** Ground covered since the last step, or water since the last stroke. */
  stride = 0;
  grounded = true;
  swimming = false;
  /** The fastest it fell since it last stood. */
  fall = 0;
  out = false;
  winded = false;
}

/** The parts of the player's predicted body heard here. */
export interface OwnBody {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  mode: number;
  stance: number;
  mflags: number;
}

export class BodySounds {
  readonly walkers = new Map<number, Walker>();
  private readonly own = new Walker();
  private ownKnown = false;
  private frame = 0;
  private readonly st = new AnimState();

  /**
   * One frame. `survivor` is the owner number of the survivor species and `isSurvivor` says which kinds are survivors;
   * `sex` gives 0 (male) or 1 (female) for a body's look. `self` is the player's body, or null while it has none.
   */
  update(dt: number, remote: RemoteSample, hf: Heightfield, ex: number, ey: number, ez: number, ownId: number, self: OwnBody | null, selfFemale: boolean, survivor: number, isSurvivor: (kind: number) => boolean, hear: Hear): void {
    const frame = ++this.frame;
    const st = this.st;
    for (let i = 0; i < remote.count; i++) {
      const id = remote.id[i]!;
      if (id === ownId || !isSurvivor(remote.kind[i]!) || (remote.flags[i]! & 8) !== 0) continue;
      const x = remote.x[i]!;
      const y = remote.y[i]!;
      const z = remote.z[i]!;
      // One on a mount, or held, goes where it is carried and is heard afresh once on its own feet.
      if (remote.seat[i] !== 0 || Math.hypot(x - ex, y - ey, z - ez) > STEP_REACH * 2) {
        this.walkers.delete(id);
        continue;
      }
      st.unpack(remote.anim[i]!, remote.cue[i]!);
      st.seed = bodySeed(id);
      let w = this.walkers.get(id);
      if (!w) {
        this.walkers.set(id, (w = new Walker()));
        w.x = x;
        w.y = y;
        w.z = z;
        w.grounded = st.grounded;
        w.swimming = st.mode === MODE_SWIM;
      }
      w.seen = frame;
      const vy = dt > 0 ? (y - w.y) / dt : 0;
      this.move(w, x, y, z, vy, st.grounded, st.mode === MODE_SWIM, st.stance, false, hf, survivor, id, remote.look[i * LOOK_BYTES + LOOK_SEX] === 1 ? 1 : 0, false, hear);
    }
    for (const [id, w] of this.walkers) if (w.seen !== frame) this.walkers.delete(id);
    if (!self) {
      this.ownKnown = false;
      return;
    }
    const w = this.own;
    const sex = selfFemale ? 1 : 0;
    if (!this.ownKnown) {
      this.ownKnown = true;
      w.x = self.x;
      w.y = self.y;
      w.z = self.z;
      w.grounded = self.grounded;
      w.swimming = self.mode === MODE_SWIM;
      w.out = (self.mflags & MF_OUT) !== 0;
      w.winded = (self.mflags & MF_WINDED) !== 0;
    }
    const out = (self.mflags & MF_OUT) !== 0;
    if (out !== w.out) hear(survivor, out ? KNOCKED[sex]! : WAKE[sex]!, -1, 0, 0, 0, 0, 1, true);
    w.out = out;
    const winded = (self.mflags & MF_WINDED) !== 0;
    if (winded && !w.winded) hear(survivor, WINDED[sex]!, -1, 0, 0, 0, 0, 0.8, true);
    w.winded = winded;
    this.move(w, self.x, self.y, self.z, self.vy, self.grounded, self.mode === MODE_SWIM, self.stance, out, hf, survivor, -1, sex, true, hear);
  }

  /** The body moved to (x, y, z): its steps, strokes, jumps and landings. */
  private move(w: Walker, x: number, y: number, z: number, vy: number, grounded: boolean, swimming: boolean, stance: number, out: boolean, hf: Heightfield, survivor: number, entity: number, sex: number, flat: boolean, hear: Hear): void {
    const covered = Math.hypot(x - w.x, z - w.z);
    // A jump, a teleport or a respawn is no stride.
    const moved = covered < 3 ? covered : 0;
    const lift = flat ? 0 : 0.05;
    if (swimming !== w.swimming) {
      hear(survivor, swimming ? SPLASH_IN : SPLASH_OUT, entity, x, y, z, lift, 1, flat);
      w.stride = 0;
    } else if (swimming) {
      w.stride += moved;
      if (w.stride >= STROKE) {
        w.stride -= STROKE;
        hear(survivor, SWIM, entity, x, y, z, lift, 0.8, flat);
      }
    } else if (grounded && !w.grounded) {
      // Landing: heard by how fast it fell.
      if (w.fall >= LAND_SPEED) {
        const g = groundAt(hf, x, y, z);
        hear(survivor, LAND[g]!, entity, x, y, z, lift, Math.min(1, w.fall / LAND_HURT_SPEED), flat);
        if (w.fall >= LAND_HURT_SPEED) hear(survivor, LAND_VOICE[sex]!, entity, x, y, z, 1.6, 1, flat);
      }
      w.stride = 0;
    } else if (!grounded && w.grounded && vy > 0.5) {
      hear(survivor, JUMP[sex]!, entity, x, y, z, flat ? 0 : 1.6, 0.7, flat);
    } else if (grounded && !out) {
      w.stride += moved;
      const stride = stance === STANCE_PRONE ? STRIDE_PRONE : stance === STANCE_CROUCH ? STRIDE_CROUCH : STRIDE;
      if (w.stride >= stride) {
        w.stride -= stride;
        const g = groundAt(hf, x, y, z);
        // Crouched and prone steps are softer; the player's own are a little quieter than another's would be at the ear.
        hear(survivor, STEP[g]!, entity, x, y, z, lift, (flat ? 0.6 : 0.9) * (stance === STANCE_CROUCH || stance === STANCE_PRONE ? 0.55 : 1), flat);
      }
    }
    w.fall = grounded ? 0 : Math.max(w.fall, -vy);
    w.grounded = grounded;
    w.swimming = swimming;
    w.x = x;
    w.y = y;
    w.z = z;
  }
}
