// The laser attachment's dot (planning/reference/weapons-plan.md, M10): "a red dot where the weapon is pointed" (ark.wiki.gg
// Laser Attachment), drawn for the holder and for everyone who sees a body whose laser is on. It decides nothing: "the
// cosmetic alignment does not affect where the laser beam points", and no shot goes by it. It needs no light: the dot is
// drawn over the view where the beam meets the world or a body (client/core/ui/hud.ts), faint far off by day, as "the
// Laser Attachment is not visible at long distances during the day time".
//
// The holder's dot lies along its own view, which turns with the kick and the sway, so it is where the next shot is
// pointed. Another body's lies along the look its pose carries: its facing to 1024ths of a turn and its pitch to
// 31 steps of a right angle, so it is near where that body aims and not exact.

import type { Registry } from "../../../shared/content/registry.ts";
import { AnimState, PITCH_STEPS } from "../../../shared/anim/pose.ts";
import { saddleSeat } from "../../../shared/anim/seat.ts";
import { TAU } from "../../../shared/math/scalar.ts";
import { stanceEye } from "../../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../../shared/sim/entities.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../../shared/world/ray.ts";
import type { SeatedAim } from "../seated-aim.ts";
import type { RemoteSample } from "../session.ts";

/** Metres the beam reaches. Ours: the page gives none. */
export const LASER_REACH = 300;
/** By day the dot is whole to LASER_DAY_NEAR metres and gone at LASER_DAY_FAR (ours: "not visible at long distances during the day time"). */
export const LASER_DAY_NEAR = 15;
export const LASER_DAY_FAR = 80;
/** The most dots drawn at once. */
export const MAX_DOTS = 16;
/** A dot stands this far back from what it meets, so it is not drawn inside it. */
const STAND_OFF = 0.02;

/** How much it is day at `hour` (0 to 24): 0 at night, 1 from an hour after sunrise to an hour before sunset. */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h <= 5 || h >= 19) return 0;
  if (h >= 7 && h <= 17) return 1;
  return h < 7 ? (h - 5) / 2 : (19 - h) / 2;
}

/** How strongly a dot `far` metres from its laser shows, with `day` from `daylight`. */
export function dotAlpha(far: number, day: number): number {
  const fade = far <= LASER_DAY_NEAR ? 0 : far >= LASER_DAY_FAR ? 1 : (far - LASER_DAY_NEAR) / (LASER_DAY_FAR - LASER_DAY_NEAR);
  return 1 - day * fade;
}

export interface Dot {
  x: number;
  y: number;
  z: number;
  /** 0 to 1. */
  alpha: number;
  /** The body the laser is on: 0 for the holder's own, else the remote body's id. */
  id: number;
}

export class Lasers {
  /** Only the first `count` are current. */
  readonly dots: Dot[] = [];
  count = 0;
  private readonly st = new AnimState();
  private readonly dir = [0, 0, 0];
  private readonly eye = new Float64Array(3);

  /** Forgets last frame's dots. */
  clear(): void {
    this.count = 0;
  }

  /**
   * The dot of a laser at (ox, oy, oz) pointing along unit (dx, dy, dz): where the beam first meets the world or a body of
   * `remote` other than `skip` (its own), within LASER_REACH. Nothing is added if it meets nothing.
   */
  cast(reg: Registry, world: CollisionWorld, remote: RemoteSample | null, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, day: number, id: number, skip: number, seats?: SeatedAim, carrier = -1, carrierGen = 0): void {
    if (this.count >= MAX_DOTS) return;
    let t = castWorld(world, ox, oy, oz, dx, dy, dz, LASER_REACH) === HIT_NONE ? Infinity : rayHit.t;
    for (let i = 0; carrier < 0 && remote && i < remote.count; i++) if (remote.id[i] === skip) { carrier = remote.seat[i]! - 1; carrierGen = remote.seatGen[i]!; break; }
    for (let i = 0; remote && i < remote.count; i++) {
      if (remote.id[i] === skip || (remote.id[i] === carrier && remote.gen[i] === carrierGen && !reg.vehicle[remote.kind[i]!]?.breakablePanels)) continue;
      const kind = remote.kind[i]!;
      const r = reg.bodyRadius[kind]!;
      if (reg.move[kind] === null || !(r > 0)) continue;
      const posed = seats?.ray(remote, i, ox, oy, oz, dx, dy, dz, t);
      const at = posed ?? rayBox(ox, oy, oz, dx, dy, dz, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + reg.bodyHeight[kind]!, remote.z[i]! + r);
      if (at > 0 && at < t) t = at;
    }
    if (!(t <= LASER_REACH)) return;
    const back = t > STAND_OFF ? t - STAND_OFF : 0;
    const dot = (this.dots[this.count++] ??= { x: 0, y: 0, z: 0, alpha: 0, id: 0 });
    dot.x = ox + dx * back;
    dot.y = oy + dy * back;
    dot.z = oz + dz * back;
    dot.alpha = dotAlpha(t, day);
    dot.id = id;
  }

  /** The dots of every body in `remote` whose laser is on (RemoteSample.on), from its eye along the look its pose carries. */
  remotes(reg: Registry, world: CollisionWorld, remote: RemoteSample, day: number, seats?: SeatedAim): void {
    const st = this.st;
    const d = this.dir;
    for (let i = 0; i < remote.count && this.count < MAX_DOTS; i++) {
      if (remote.on[i] === 0) continue;
      if (remote.seat[i] && remote.seatSlot[i]) {
        let allowed = false;
        for (let host = 0; host < remote.count; host++) if (remote.id[host] === remote.seat[i]! - 1 && remote.gen[host] === remote.seatGen[i]) {
          const seat = reg.vehicle[remote.kind[host]!]?.seats[remote.seatSlot[i]! - 1] ?? saddleSeat(reg, remote.gear[host * GEAR_COUNT + GEAR_WORN]!, remote.seatSlot[i]!);
          allowed = !!seat && !seat.driver && seat.weapons !== false; break;
        }
        if (!allowed) continue;
      }
      const move = reg.move[remote.kind[i]!];
      if (!move) continue;
      st.unpack(remote.anim[i]!);
      lookDirection((remote.yaw[i]! / TAU) * 65536, (st.pitch / PITCH_STEPS) * 16384, d);
      const eye = this.eye;
      eye[0] = remote.x[i]!; eye[1] = remote.y[i]! + stanceEye(move, st.stance); eye[2] = remote.z[i]!;
      seats?.remoteEye(world, remote, i, eye);
      this.cast(reg, world, remote, eye[0]!, eye[1]!, eye[2]!, d[0]!, d[1]!, d[2]!, day, remote.id[i]!, remote.id[i]!, seats);
    }
  }
}
