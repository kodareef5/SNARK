// A near door which comes off finishes its fall on its existing bone.
import { TICK_RATE } from "../../../shared/coords.ts";
import type { VehiclePanel } from "../../../shared/sim/vehicle.ts";
import { BONE_FLOATS, type FramePacket } from "./packet.ts";

const RANGE = 32;
const CARS = 32;
const DURATION = .48;

class DoorTrail {
  readonly previous = new Float64Array(4 * BONE_FLOATS);
  readonly start = new Float64Array(4).fill(-Infinity);
  readonly dx = new Float32Array(4);
  readonly dz = new Float32Array(4);
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  readonly speed = new Float32Array(4 * 3);
  id = -1;
  kind = -1;
  frame = -1;
  tick = -1;
  missing = 0;
}

export class FallingDoors {
  private readonly cars = new Map<number, DoorTrail>();
  private readonly pool: DoorTrail[] = [];

  begin(frame: number): void {
    for (const car of this.cars.values()) if (frame - car.frame > 2) {
      this.cars.delete(car.id);
      this.pool.push(car);
    }
  }

  draw(p: FramePacket, first: number, panels: readonly VehiclePanel[], bones: Int16Array,
    doorBones: Int16Array, id: number, kind: number, frame: number, tick: number, missing: number,
    x: number, y: number, z: number): void {
    if (x*x + y*y + z*z > RANGE*RANGE) return;
    let car = this.cars.get(id);
    if (!car) {
      if (this.cars.size >= CARS) return;
      car = this.pool.pop() ?? new DoorTrail();
      car.frame = -1;
      this.cars.set(id, car);
    }
    const next = frame - car.frame === 1 && car.kind === kind && car.id === id &&
      tick >= car.tick && tick - car.tick < TICK_RATE / 4;
    if (!next) car.start.fill(-Infinity);
    const rows = p.bones, wx = p.camX + x, wy = p.camY + y, wz = p.camZ + z;
    if (next && tick > car.tick) {
      const hz = TICK_RATE / (tick - car.tick);
      car.vx = (wx - car.x) * hz; car.vy = (wy - car.y) * hz; car.vz = (wz - car.z) * hz;
    } else if (!next) car.vx = car.vy = car.vz = 0;
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]!, door = panel.door, bone = bones[i]!;
      if (door === undefined || bone < 0 || doorBones[door] !== bone) continue;
      const row = (first + bone) * BONE_FLOATS, at = door * BONE_FLOATS;
      if (!(missing & (1 << i))) {
        for (let k = 0; k < BONE_FLOATS; k++) car.previous[at + k] = rows[row + k]!;
        car.previous[at + 3]! += p.camX; car.previous[at + 7]! += p.camY; car.previous[at + 11]! += p.camZ;
        const side = Math.sign(panel.hinge![0]);
        car.dx[door] = side * rows[first * BONE_FLOATS]!;
        car.dz[door] = side * rows[first * BONE_FLOATS + 8]!;
        continue;
      }
      if (next && !(car.missing & (1 << i))) {
        car.start[door] = tick;
        car.speed[door * 3] = car.vx; car.speed[door * 3 + 1] = car.vy; car.speed[door * 3 + 2] = car.vz;
      }
      const dt = (tick - car.start[door]!) / TICK_RATE;
      if (dt < 0 || dt >= DURATION) continue;
      const pivot = panel.hinge!, angle = Math.sign(pivot[0]) * dt * 3;
      const shrink = Math.min(1, (DURATION - dt) * 8);
      const c = Math.cos(angle)*shrink, s = Math.sin(angle)*shrink;
      for (let axis = 0; axis < 3; axis++) {
        const orig = at + axis * 4, out = row + axis * 4;
        const a = car.previous[orig]!, b = car.previous[orig + 1]!, d = car.previous[orig + 2]!;
        rows[out] = a*c + b*s; rows[out + 1] = b*c - a*s; rows[out + 2] = d*shrink;
        const shove = axis === 0 ? 1.8 * car.dx[door]! : axis === 2 ? 1.8 * car.dz[door]! : .25 - 4.9*dt;
        const camera = axis === 0 ? p.camX : axis === 1 ? p.camY : p.camZ;
        rows[out + 3] = car.previous[orig + 3]! - camera + (a - rows[out]!) * pivot[0] +
          (b - rows[out+1]!) * pivot[1] + (d - rows[out+2]!) * pivot[2] + (shove + car.speed[door*3+axis]!) * dt;
      }
    }
    car.id = id; car.kind = kind; car.frame = frame; car.tick = tick; car.missing = missing;
    car.x = wx; car.y = wy; car.z = wz;
  }
}
