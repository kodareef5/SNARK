// Seat geometry at the sample's explicit presentation clock. No camera cache and no predicted carrier extrapolation.
import type { Registry } from "../../shared/content/registry.ts";
import { creatureAnims } from "../../shared/anim/creature.ts";
import { HumanAnim, AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { OccupantBody, clipSeatEye, createOccupantSeat, occupantSeat } from "../../shared/anim/occupant.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { saddleSeat, seatOn, SEAT_FLOATS } from "../../shared/anim/seat.ts";
import { zoneHit } from "../../shared/anim/skeleton.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { rayVehicle } from "../../shared/sim/vehicle-frame.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { RemoteSample } from "./session.ts";

export class SeatedAim {
  private readonly reg: Registry;
  private readonly human: HumanAnim;
  private readonly creatures;
  private readonly body: OccupantBody;
  private readonly seat = createOccupantSeat();
  private readonly frame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1, steering: 0 };
  private readonly saddle = new Float64Array(SEAT_FLOATS);
  private readonly st = new AnimState();
  private readonly hostState = new AnimState();
  private readonly look = new Uint8Array(LOOK_BYTES);

  constructor(reg: Registry, pack: Pack) {
    this.reg = reg;
    this.human = new HumanAnim(pack.clips);
    const rigs = buildRigs(pack.header.rigs, pack.clips);
    this.creatures = creatureAnims(reg, d => rigs.get(d.mesh));
    this.body = new OccupantBody(pack.header.rigs, pack.header.meshes);
  }

  private carrier(r: RemoteSample, i: number): void {
    const f = this.frame;
    f.x = r.x[i]!; f.y = r.y[i]!; f.z = r.z[i]!; f.yaw = r.yaw[i]!;
    f.pitch = r.vehiclePitch[i]!; f.roll = r.vehicleRoll[i]!; f.steering = r.steering[i]!;
    f.qx = r.vehicleQx[i]!; f.qy = r.vehicleQy[i]!; f.qz = r.vehicleQz[i]!; f.qw = r.vehicleQw[i]!;
  }

  /** The own pose is current prediction; its carrier is exactly the remote sample that the input reports seeing. */
  pose(r: RemoteSample, kind: number, parent: number, generation: number, slot: number, look: Uint8Array | null, st: AnimState, yaw: number, poseTick: number): boolean {
    if (!parent || !slot) return false;
    let host = -1;
    for (let i = 0; i < r.count; i++) if (r.id[i] === parent - 1 && r.gen[i] === generation) { host = i; break; }
    if (host < 0) return false;
    const def = this.reg.defs[kind], rest = this.body.rest(def?.type === "species" ? def.mesh : "human", look);
    const vehicle = this.reg.vehicle[r.kind[host]!];
    if (vehicle) {
      const seat = vehicle.seats[slot - 1];
      if (!seat) return false;
      this.carrier(r, host);
      occupantSeat(vehicle, seat, this.frame, yaw, this.seat);
      this.body.vehicle(this.human, st, poseTick, this.seat, rest, look);
    } else {
      const seat = saddleSeat(this.reg, r.gear[host * GEAR_COUNT + GEAR_WORN]!, slot);
      if (!seat) return false;
      const ms = this.hostState; ms.unpack(r.anim[host]!, r.cue[host]!); ms.seed = bodySeed(r.id[host]!);
      seatOn(this.creatures[r.kind[host]!] ?? null, seat, ms, r.tick, r.x[host]!, r.y[host]!, r.z[host]!, r.yaw[host]!, this.saddle);
      this.body.saddle(this.human, st, poseTick, this.saddle, seat.driver === true, yaw, rest, look);
    }
    return true;
  }

  eye(world: CollisionWorld, out: Float64Array, clip = true): void {
    this.body.eye(out);
    if (clip) clipSeatEye(world, this.body.anchor, out);
  }

  private remote(r: RemoteSample, i: number): boolean {
    const st = this.st; st.unpack(r.anim[i]!, r.cue[i]!); st.seed = bodySeed(r.id[i]!);
    const look = r.hasLook[i] ? this.look : null;
    if (look) for (let n = 0; n < LOOK_BYTES; n++) look[n] = r.look[i * LOOK_BYTES + n]!;
    return this.pose(r, r.kind[i]!, r.seat[i]!, r.seatGen[i]!, r.seatSlot[i]!, look, st, r.yaw[i]!, r.tick);
  }

  remoteEye(world: CollisionWorld, r: RemoteSample, i: number, out: Float64Array): boolean {
    if (!this.remote(r, i)) return false;
    this.eye(world, out); return true;
  }

  /** null means an ordinary unseated target; Infinity means a posed seated/vehicle target was missed. */
  ray(r: RemoteSample, i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number | null {
    const vehicle = this.reg.vehicle[r.kind[i]!];
    if (vehicle) {
      this.carrier(r, i);
      return rayVehicle(vehicle, this.frame.x, this.frame.y, this.frame.z, this.frame.yaw, ox, oy, oz, dx, dy, dz, vehicle.beltline, this.frame);
    }
    if (!this.remote(r, i)) return null;
    return this.body.ray(ox, oy, oz, dx, dy, dz, maxT) ? zoneHit.t : Infinity;
  }
}
