// Two players on delayed, jittery links play a car together through the ordinary inputs: one drives with the other
// beside them, the passenger gets out, walks round and pulls the driver out, the driver gets back in beside them, and
// the new driver drives off. Every client predicts all of it: none is corrected.
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_JUMP, BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";
import { flatGround } from "../fixtures/arena.ts";

const LINK = { latencyMs: 70, jitterMs: 10, loss: 0.02 };

function aimAt(h: Harness, index: number, x: number, y: number, z: number): void {
  const c = h.client(h.sessions[index]!)!, ents = h.world.ents, pilot = h.pilots[index]!;
  const dx = x - ents.x[c.ent]!, dz = z - ents.z[c.ent]!;
  const eye = ents.y[c.ent]! + stanceEye(h.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(y - eye, Math.hypot(dx, dz));
}

/** Presses E looking at the car, as a player does. */
function use(h: Harness, index: number, car: number): void {
  const ents = h.world.ents, pilot = h.pilots[index]!;
  aimAt(h, index, ents.x[car]!, ents.y[car]! + 0.8, ents.z[car]!);
  h.run(100);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(900);
}

/** Walks a survivor to (x, z) on its own legs. */
function walk(h: Harness, index: number, x: number, z: number): void {
  const c = h.client(h.sessions[index]!)!, ents = h.world.ents, pilot = h.pilots[index]!;
  for (let t = 0; t < 400 && Math.hypot(x - ents.x[c.ent]!, z - ents.z[c.ent]!) > 0.15; t++) {
    pilot.yaw = Math.atan2(x - ents.x[c.ent]!, z - ents.z[c.ent]!);
    pilot.moveZ = Math.hypot(x - ents.x[c.ent]!, z - ents.z[c.ent]!) > 1 ? 127 : 40;
    h.run(50);
  }
  pilot.moveZ = 0;
  h.run(300);
}

function stop(h: Harness, index: number, car: number): void {
  const ents = h.world.ents, pilot = h.pilots[index]!;
  pilot.moveZ = 0;
  pilot.moveX = 0;
  pilot.buttons = BTN_JUMP;
  for (let t = 0; t < 100 && Math.hypot(ents.vx[car]!, ents.vz[car]!) > 0.02; t++) h.run(100);
  pilot.buttons = 0;
  h.run(300);
}

test("two players drive, pull each other out and ride together, and neither client is ever corrected", () => {
  const h = new Harness({}, 3, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const ada = h.join("ada", LINK), bob = h.join("bob", LINK);
    h.run(1200);
    const ground = flatGround(h, 40, 60), x = ground.x + 20, z = ground.z + 12;
    h.say(ada, "enablecheats");
    h.say(bob, "enablecheats");
    h.say(ada, `tp ${x + 2} ${z}`);
    h.say(bob, `tp ${x - 2} ${z}`);
    h.run(1500);
    const car = h.host.spawnVehicle("core:compact", x, z, 0, 0), ents = h.world.ents;
    const a = h.client(ada)!, b = h.client(bob)!;
    h.run(500);
    const sessions: ClientSession[] = [ada, bob];
    const before = sessions.map((s) => s.stats.corrections);

    use(h, 0, car);
    expect(ada.driving).toBe(car);
    use(h, 1, car);
    expect(bob.own.seatSlot).toBe(2);
    h.pilots[0]!.moveZ = 127;
    h.run(2000);
    h.pilots[0]!.moveX = 60;
    h.run(1000);
    stop(h, 0, car);
    expect(Math.hypot(ents.x[car]! - x, ents.z[car]! - z)).toBeGreaterThan(8);

    // Bob gets out on his side, walks round the back of the car, clear of its hull (a walker brushing a parked car is
    // stopped by the server and corrected: clients do not predict cars as obstacles), and pulls Ada out of the driver's seat.
    use(h, 1, car);
    expect(bob.own.seatSlot).toBe(0);
    const yaw = ents.vehicleYaw[car]!, side = [Math.cos(yaw), -Math.sin(yaw)], back = [-Math.sin(yaw), -Math.cos(yaw)];
    const at = (s: number, f: number): [number, number] => [ents.x[car]! + side[0]! * s + back[0]! * f, ents.z[car]! + side[1]! * s + back[1]! * f];
    walk(h, 1, ...at(-2, 3.4));
    walk(h, 1, ...at(2, 3.4));
    walk(h, 1, ...at(1.9, -0.1));
    use(h, 1, car);
    expect(bob.driving).toBe(car);
    expect(ada.driving).toBe(-1);
    expect(h.host.urban.incidents.at(-1)).toMatchObject({ offender: b.pid, victim: a.pid });

    // Ada, set down by the driver's door, walks round to the other and rides with him.
    walk(h, 0, ...at(2, 3.4));
    walk(h, 0, ...at(-2, 3.4));
    walk(h, 0, ...at(-1.9, -0.1));
    use(h, 0, car);
    expect(ada.own.seatSlot).toBe(2);
    h.pilots[1]!.moveZ = 127;
    h.pilots[1]!.moveX = -50;
    h.run(2500);
    stop(h, 1, car);
    expect(bob.driving).toBe(car);

    const after = sessions.map((s, i) => s.stats.corrections - before[i]!);
    expect(after).toEqual([0, 0]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
