import { TICK_RATE } from "../../shared/coords.ts";
import type { AirDrone, AirSupportView } from "../../shared/sim/air-support.ts";

const bearing = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** The camera follows consecutive server poses even between network frames. */
export class AirCamera {
  private latest: AirDrone | null = null;
  private stamp = 0;
  private started = 0;
  private span = 1;
  private origin = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private shown = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };

  get id(): number { return this.latest?.id ?? 0; }

  receive(view: AirSupportView, clock: number): void {
    const drone = view.flight ? view.drones.find(row => row.id === view.flight) : null;
    if (!drone) {
      this.latest = null;
      return;
    }
    if (this.latest?.id === drone.id) {
      if (view.tick <= this.stamp) return;
      this.sample(clock);
      Object.assign(this.origin, this.shown);
      this.span = Math.max(1, Math.min(6, view.tick - this.stamp));
      this.shown.vx = (drone.x - this.latest.x) * TICK_RATE / (view.tick - this.stamp);
      this.shown.vz = (drone.z - this.latest.z) * TICK_RATE / (view.tick - this.stamp);
    } else {
      Object.assign(this.origin, drone);
      this.span = 1;
      this.shown.vx = this.shown.vz = 0;
    }
    this.latest = drone;
    this.stamp = view.tick;
    this.started = clock;
    this.sample(clock);
  }

  sample(clock: number): typeof this.shown | null {
    const d = this.latest;
    if (!d) return null;
    const t = Math.min(1.5, Math.max(0, (clock - this.started) / this.span));
    const a = this.origin, p = this.shown;
    p.x = a.x + (d.x - a.x) * t; p.y = a.y + (d.y - a.y) * t; p.z = a.z + (d.z - a.z) * t;
    p.yaw = a.yaw + bearing(a.yaw, d.yaw) * t;
    p.pitch = a.pitch + (d.pitch - a.pitch) * t;
    return p;
  }
}
