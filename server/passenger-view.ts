import { SentView, dequantX, dequantY } from "../shared/net/view.ts";
import { unpackVehicleSteering } from "../shared/sim/vehicle-body.ts";
import { unpackVehicleQuaternion } from "../shared/sim/vehicle-presentation.ts";
import { Past } from "./history.ts";
import type { ServerWorld } from "./world.ts";

const rotation = new Float64Array(4);

/** The seat that accompanied this recipient's snapshot, with the carrier as encoded under its byte budget. */
export class PassengerView extends SentView {
  passenger?: Past;
  riderEpoch = 0;

  recordSeat(world: ServerWorld, e: number, driving: boolean): void {
    if (this.passenger) this.passenger.seat = 0;
    const ents = world.ents;
    if (e < 0 || driving || !ents.seat[e]) return;
    const host = ents.seat[e]! - 1;
    for (let i = 0; i < this.count; i++) {
      if (this.id[i] !== host || this.gen[i] !== ents.seatGen[e]) continue;
      const p = this.passenger ??= new Past();
      p.seatFrom(ents, e);
      if (!p.seat) return;
      this.riderEpoch = world.history.motionEpoch(e);
      p.hostEpoch = world.history.motionEpoch(host);
      p.hostX = dequantX(this.qx[i]!); p.hostY = dequantY(this.qy[i]!); p.hostZ = dequantX(this.qz[i]!);
      p.hostYaw = this.yaw[i]! * 64;
      p.hostAnim = this.anim[i]!; p.hostCue = this.cue[i]!;
      unpackVehicleQuaternion(this.vehicleAttitudeA[i]!, this.vehicleAttitudeB[i]!, rotation);
      p.hostQx = rotation[0]!; p.hostQy = rotation[1]!; p.hostQz = rotation[2]!; p.hostQw = rotation[3]!;
      p.hostSteering = unpackVehicleSteering(this.vehiclePose[i]!);
      return;
    }
  }
}
