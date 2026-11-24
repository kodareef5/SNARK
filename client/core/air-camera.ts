import { TICK_RATE } from "../../shared/coords.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import { droneLookPitch, droneLookYaw, droneMove, droneStep, type DroneMotion, type DroneTravel } from "../../shared/sim/air-drone.ts";
import type { AirSupportView } from "../../shared/sim/air-support.ts";
import type { InputBuffer } from "../../shared/net/protocol.ts";

const RING = 128, MASK = RING - 1;
const travel: DroneTravel = { dx: 0, dy: 0, dz: 0, length: 0 };
const bearing = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * The operator's own drone, predicted from their inputs as their body is, and set right from the server's row for it:
 * the camera answers the mouse on the next frame however far away the server is.
 */
export class AirCamera {
  private flight = 0;
  private launched = 0;
  private readonly tune = { speed: 0, turn: 0 };
  private readonly ring: DroneMotion[] = Array.from({ length: RING }, () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }));
  private readonly ringTick = new Int32Array(RING).fill(-1);
  private top = -1;
  /** Fraction of the way from the newest predicted tick's predecessor to it: the session's own. */
  alphaOf: () => number = () => 1;
  /** Ticks replayed after the server set the drone right, and how far it moved it then. */
  readonly stats = { replays: 0, error: 0 };
  private readonly shown = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0 };

  get id(): number { return this.flight; }

  /** The server's view at `view.tick`: the start of a flight, or the truth to replay the newer predicted ticks from. */
  receive(view: AirSupportView, inputs: InputBuffer, newest: number): void {
    const drone = view.flight ? view.drones.find(row => row.id === view.flight) : null;
    if (!drone) { this.flight = 0; this.top = -1; return; }
    const i = view.tick & MASK;
    if (drone.id !== this.flight) {
      this.flight = drone.id; this.launched = drone.launched; this.ringTick.fill(-1); this.top = view.tick;
    } else if (this.ringTick[i] === view.tick) {
      const p = this.ring[i]!;
      const error = Math.hypot(p.x - drone.x, p.y - drone.y, p.z - drone.z);
      if (error < 1e-4 && Math.abs(p.yaw - drone.yaw) < 1e-5 && Math.abs(p.pitch - drone.pitch) < 1e-5) return;
      this.stats.error = error;
    } else if (view.tick < this.top - MASK) return;
    this.tune.speed = drone.speed; this.tune.turn = drone.turn;
    const p = this.ring[i]!;
    p.x = drone.x; p.y = drone.y; p.z = drone.z; p.yaw = drone.yaw; p.pitch = drone.pitch; this.ringTick[i] = view.tick;
    // Every tick up to the page's newest is flown again from the server's, with the inputs that were sent for them.
    this.top = view.tick;
    let yaw = 0, pitch = 0, buttons = 0, known = false;
    for (let t = view.tick + 1; t <= newest; t++) {
      const k = t & inputs.mask;
      if (inputs.has(t)) { yaw = inputs.yaw[k]!; pitch = inputs.pitch[k]!; buttons = inputs.buttons[k]!; known = true; }
      if (!known) break;
      this.advance(t, yaw, pitch, buttons);
      this.stats.replays++;
    }
  }

  /** Predicts tick `t` from tick `t - 1` with that tick's look and boost. */
  step(t: number, yaw: number, pitch: number, buttons: number): void {
    if (!this.flight) return;
    this.advance(t, yaw, pitch, buttons);
  }

  private advance(t: number, yaw: number, pitch: number, buttons: number): void {
    const from = (t - 1) & MASK;
    if (this.ringTick[from] !== t - 1) return;
    const to = t & MASK, p = this.ring[to]!;
    Object.assign(p, this.ring[from]!);
    const age = t - this.launched;
    if (age > 0) {
      droneStep(p, age, droneLookYaw(yaw), droneLookPitch(pitch), (buttons & BTN_SPRINT) !== 0, this.tune, travel);
      droneMove(p, travel, travel.length);
    }
    this.ringTick[to] = t;
    if (t > this.top) this.top = t;
  }

  /** The camera between the two newest predicted ticks. Null with no flight. */
  sample(_clock?: number): typeof this.shown | null {
    if (!this.flight || this.top < 0) return null;
    const b = this.ring[this.top & MASK]!, prior = this.ringTick[(this.top - 1) & MASK] === this.top - 1 ? this.ring[(this.top - 1) & MASK]! : b;
    const t = Math.max(0, Math.min(1, this.alphaOf())), s = this.shown;
    s.x = prior.x + (b.x - prior.x) * t; s.y = prior.y + (b.y - prior.y) * t; s.z = prior.z + (b.z - prior.z) * t;
    s.yaw = prior.yaw + bearing(prior.yaw, b.yaw) * t;
    s.pitch = prior.pitch + (b.pitch - prior.pitch) * t;
    s.vx = (b.x - prior.x) * TICK_RATE; s.vz = (b.z - prior.z) * TICK_RATE;
    return s;
  }
}
