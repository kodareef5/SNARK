import { expect, test } from "bun:test";
import { BitWriter } from "../../shared/net/codec.ts";
import { SentView, ViewRing, VIEW_RING, writeViewDelta } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { packVehicleDrive, packVehiclePose, packVehicleRide, quantVehicleWheel } from "../../shared/sim/vehicle-body.ts";
import { packVehicleSystems } from "../../shared/sim/vehicle-presentation.ts";
import { writeViewDeltaBefore } from "../fixtures/view-before.ts";

const CARS = 60;
const PEOPLE = 40;
const CREATURES = 300;
const TICKS = 1200;

/** A car and the one who drives it: parked, entered, driven, braking to a stop, and left, each for a while. */
interface Car {
  e: number;
  phase: number;
  left: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  pitch: number;
  roll: number;
  wheel: number;
  rpm: number;
  gear: number;
  fuel: number;
  doors: number;
  driver: number;
}

/** One client of each writer: its ring, what it last acknowledged, and the snapshots it has yet to receive. */
interface Reader {
  ring: ViewRing<SentView>;
  rotate: number;
  acked: number;
  flying: { tick: number; at: number }[];
}

test("snapshots of cars moving, stopping, entered and left are the bytes they were", () => {
  const rng = new Rng(4242);
  const store = new EntityStore({ chunksX: 8, chunksZ: 8 }, 1024);
  const cars: Car[] = [];
  for (let k = 0; k < CARS; k++) {
    const e = store.create(1, 0, 0, 0, 0);
    cars.push({ e, phase: k % 5, left: 1 + rng.int(90), x: rng.range(10, 500), z: rng.range(10, 500), yaw: rng.range(0, 6.28), speed: 0, steer: 0, pitch: 0, roll: 0, wheel: 0, rpm: 800, gear: 0, fuel: 60, doors: 0, driver: -1 });
  }
  const people: number[] = [];
  for (let k = 0; k < PEOPLE; k++) {
    const e = store.create(2, 0, 0, 0, 0);
    store.setLook(e, 1 + k, null, `p${k}`);
    people.push(e);
  }
  const herd = Array.from({ length: CREATURES }, () => ({ e: store.create(3, 0, 0, 0, 0), x: rng.range(0, 512), z: rng.range(0, 512), yaw: 0, walking: false }));
  const walkers = people.map(() => ({ x: rng.range(0, 512), z: rng.range(0, 512), yaw: 0 }));

  const readers = (): Reader[] => [0, 1, 2].map(() => ({ ring: new ViewRing(() => new SentView()), rotate: 0, acked: 0, flying: [] }));
  const now = readers(), before = readers();
  // A roomy budget, one a crowd overflows, and one under a view cap with its own body left out.
  const budgets = [60000, 3000, 9000];
  const wNow = new BitWriter(16384), wBefore = new BitWriter(16384);
  let compared = 0, carParts = 0, deferred = 0;

  for (let tick = 1; tick <= TICKS; tick++) {
    for (const car of cars) {
      if (--car.left <= 0) {
        car.phase = (car.phase + 1) % 5;
        car.left = 20 + rng.int(120);
        if (car.phase === 1) {
          car.driver = people[rng.int(PEOPLE)]!;
          if (store.seat[car.driver] !== 0) car.driver = -1;
          else store.setSeat(car.driver, car.e, 0);
          car.doors = 0x3f;
        }
        if (car.phase === 4) {
          if (car.driver >= 0) store.setSeat(car.driver, -1);
          car.driver = -1;
          car.doors = 0x3f;
        }
      }
      if (car.phase === 2) {
        car.doors = 0;
        car.speed = Math.min(30, car.speed + rng.range(0, 1.2));
        car.steer = Math.max(-0.5, Math.min(0.5, car.steer + rng.range(-0.08, 0.08)));
        car.gear = 1 + Math.min(4, Math.floor(car.speed / 7));
        car.rpm = 900 + (car.speed % 7) * 600;
        car.fuel -= 0.002;
      } else if (car.phase === 3) {
        car.speed = Math.max(0, car.speed - 1.5);
        if (car.speed === 0) car.steer = 0;
        car.rpm = car.speed > 0 ? 900 + car.speed * 40 : 800;
        car.gear = car.speed > 0 ? 1 : 0;
      } else if (car.phase !== 1) car.doors = car.phase === 0 ? 0 : car.doors;
      car.yaw += car.steer * car.speed * 0.002;
      car.x += Math.sin(car.yaw) * car.speed / 30;
      car.z += Math.cos(car.yaw) * car.speed / 30;
      car.pitch = car.speed > 0 ? rng.range(-0.03, 0.03) : 0;
      car.roll = car.speed > 0 ? car.steer * car.speed * 0.004 : 0;
      car.wheel = (car.wheel + car.speed / 30 / 0.35) % (Math.PI * 2);
    }
    for (const c of herd) {
      if (rng.int(60) === 0) c.walking = !c.walking;
      if (c.walking) {
        c.yaw += rng.range(-0.1, 0.1);
        c.x += Math.sin(c.yaw) * 0.05;
        c.z += Math.cos(c.yaw) * 0.05;
      }
      // Now and then one dies and another is born at its index, a new generation.
      if (rng.int(4000) === 0) {
        store.destroy(c.e);
        c.e = store.create(3, 0, 0, 0, 0);
      }
    }
    walkers.forEach((p, k) => {
      if (store.seat[people[k]!] !== 0) return;
      p.yaw += rng.range(-0.2, 0.2);
      p.x += Math.sin(p.yaw) * 0.15;
      p.z += Math.cos(p.yaw) * 0.15;
    });

    for (const car of cars) if (car.speed > 0) carParts++;
    // The true view, ascending by index as the server's is.
    const rows: (() => void)[] = [];
    const cur = new SentView();
    cur.tick = tick;
    const byIndex = new Map<number, () => void>();
    for (const car of cars) {
      const moving = car.speed > 0;
      byIndex.set(car.e, () => {
        cur.push(car.e, store.gen[car.e]!, 1, Math.round(car.x * 256), 64 * 256, Math.round(car.z * 256), Math.floor(((car.yaw % 6.283) + 6.283) % 6.283 / 6.283 * 1024) & 1023, 0, 0, store.rev[car.e]!, 0,
          packVehiclePose(car.pitch, car.roll, car.steer), quantVehicleWheel(car.wheel), packVehicleRide(car.pitch * 0.5, car.roll * 0.5, moving ? 0.07 : 0.06, true), car.doors,
          packVehicleDrive(car.gear, car.rpm, car.phase === 2 && car.left % 37 === 0, car.phase === 0 ? 0 : 1, 0), 0, packVehicleSystems(car.fuel, 60, 1, 1, car.phase >= 1 && car.phase <= 3),
          moving ? (tick * 2654435761) >>> 0 : 7, moving ? (tick * 40503) >>> 0 : 9, 0);
        cur.urgent[cur.count - 1] = car.driver >= 0 ? 1 : 0;
      });
    }
    people.forEach((e, k) => byIndex.set(e, () => {
      const p = walkers[k]!;
      cur.push(e, store.gen[e]!, 2, Math.round(p.x * 256), 64 * 256, Math.round(p.z * 256), Math.floor(((p.yaw % 6.283) + 6.283) % 6.283 / 6.283 * 1024) & 1023, 0, store.seat[e] ? 3 : 1, store.rev[e]!, 0);
      cur.urgent[cur.count - 1] = 1;
    }));
    for (const c of herd) byIndex.set(c.e, () => cur.push(c.e, store.gen[c.e]!, 3, Math.round(c.x * 256), 64 * 256, Math.round(c.z * 256), Math.floor(((c.yaw % 6.283) + 6.283) % 6.283 / 6.283 * 1024) & 1023, 0, c.walking ? 1 : 0, store.rev[c.e]!, 0));
    for (const e of [...byIndex.keys()].sort((a, b) => a - b)) rows.push(byIndex.get(e)!);
    for (const row of rows) row();
    const rank = Uint16Array.from({ length: cur.count }, (_, k) => (k * 7919) % cur.count);

    for (let r = 0; r < 3; r++) {
      const a = now[r]!, b = before[r]!;
      // Both clients of a pair hear the same: each snapshot takes 3 to 8 ticks to come back acknowledged, and one in ten is lost.
      for (const reader of [a, b]) {
        const back = reader.flying.filter((f) => f.at <= tick);
        reader.flying = reader.flying.filter((f) => f.at > tick);
        for (const f of back) if (f.tick > reader.acked) reader.acked = f.tick;
      }
      const baseOf = (reader: Reader): SentView | null => (reader.acked > 0 && tick - reader.acked < VIEW_RING ? reader.ring.find(reader.acked) : null);
      const baseA = baseOf(a), baseB = baseOf(b);
      const nextA = a.ring.alloc(tick), nextB = b.ring.alloc(tick);
      wNow.reset();
      wBefore.reset();
      const skip = r === 2 ? people[0]! : -1;
      const limit = r === 2 ? 256 : 2048;
      a.rotate = writeViewDelta(wNow, baseA, cur, nextA, budgets[r]!, a.rotate, store, skip, r === 2 ? rank : null, limit, a.ring);
      b.rotate = writeViewDeltaBefore(wBefore, baseB, cur, nextB, budgets[r]!, b.rotate, store, skip, r === 2 ? rank : null, limit, b.ring);
      expect(wNow.overflow).toBe(wBefore.overflow);
      expect(a.rotate).toBe(b.rotate);
      expect(Buffer.from(wNow.bytes()).equals(Buffer.from(wBefore.bytes()))).toBe(true);
      expect(nextA.count).toBe(nextB.count);
      compared++;
      if (a.rotate !== 0) deferred++;
      const lost = rng.int(10) === 0;
      const at = tick + 3 + rng.int(6);
      if (!lost && !wNow.overflow) {
        a.flying.push({ tick, at });
        b.flying.push({ tick, at });
      }
    }
  }
  expect(compared).toBe(TICKS * 3);
  // Some snapshots were full and put entities off, and many cars were moving.
  expect(deferred).toBeGreaterThan(TICKS / 2);
  expect(carParts).toBeGreaterThan(TICKS * 10);
});
