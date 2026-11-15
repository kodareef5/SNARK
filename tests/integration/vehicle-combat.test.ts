// A car in a fight: its shell stops what hits it below the belt line, the open cabin lets a shot reach whoever sits
// there, and the car its shooter sits in is never in the way, as a mount is not in its rider's.
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

function setup(names: string[]) {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], entityStart: 3 });
  const sessions = names.map((n) => h.join(n));
  h.run(1200);
  for (const s of sessions) h.say(s, "enablecheats");
  const gunner = sessions[sessions.length - 1]!;
  h.say(gunner, "kit pistol");
  h.run(500);
  takeInHand(h, gunner, h.reg.index.get("core:pistol")!);
  h.run(6000);
  return { h, sessions };
}

function fire(h: Harness, index: number, times: number): void {
  for (let k = 0; k < times; k++) {
    h.pilots[index]!.buttons = BTN_PRIMARY | BTN_SECONDARY;
    h.run(100);
    h.pilots[index]!.buttons = BTN_SECONDARY;
    h.run(900);
  }
}

test("a passenger shooting out of the window does not hit the car it sits in", () => {
  const { h, sessions: [driver, passenger] } = setup(["driver", "passenger"]);
  try {
    const x = h.world.spawn.x, z = h.world.spawn.z - 8;
    h.say(driver!, `tp ${x + 1.6} ${z + 0.12}`);
    h.say(passenger!, `tp ${x - 1.6} ${z + 0.12}`);
    h.run(300);
    const car = h.host.spawnVehicle("core:compact", x, z, 0, 0), a = h.client(driver!)!, b = h.client(passenger!)!;
    expect(h.host.urban.mount(a, car)).toBe(RESULT_OK);
    expect(h.host.urban.mount(b, car)).toBe(RESULT_OK);
    h.run(1200);
    const carRec = h.host.records.byPid.get(h.world.ents.pid[car]!)!, before = h.host.survival.value(carRec, V_HEALTH);
    // The passenger's seat is on the car's right (-x); aim level out of that window, and a little down at the door.
    h.pilots[1]!.yaw = -Math.PI / 2;
    for (const pitch of [0, -0.3]) {
      h.pilots[1]!.pitch = pitch;
      fire(h, 1, 2);
    }
    expect(h.world.ents.rounds[b.ent]).toBeLessThan(h.reg.weapon[h.reg.index.get("core:pistol")!]!.clip);
    expect(h.host.survival.value(carRec, V_HEALTH)).toBe(before);
  } finally {
    h.host.shutdown();
  }
}, 60000);

test("a shot through the open cabin reaches the passenger, and one at the door hits the car", () => {
  const { h, sessions: [driver, passenger, shooter] } = setup(["driver", "passenger", "shooter"]);
  try {
    const x = h.world.spawn.x, z = h.world.spawn.z - 8;
    h.say(driver!, `tp ${x + 1.6} ${z + 0.12}`);
    h.say(passenger!, `tp ${x - 1.6} ${z + 0.12}`);
    h.say(shooter!, `tp ${x - 6} ${z + 0.12}`);
    h.run(300);
    const car = h.host.spawnVehicle("core:compact", x, z, 0, 0), a = h.client(driver!)!, b = h.client(passenger!)!, c = h.client(shooter!)!;
    expect(h.host.urban.mount(a, car)).toBe(RESULT_OK);
    expect(h.host.urban.mount(b, car)).toBe(RESULT_OK);
    h.run(1200);
    const ents = h.world.ents, carRec = h.host.records.byPid.get(ents.pid[car]!)!, pRec = h.host.records.byPid.get(b.pid)!;
    const eye = ents.y[c.ent]! + stanceEye(h.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
    const aim = (tx: number, ty: number, tz: number): void => {
      const dx = tx - ents.x[c.ent]!, dz = tz - ents.z[c.ent]!;
      h.pilots[2]!.yaw = Math.atan2(dx, dz);
      h.pilots[2]!.pitch = Math.atan2(ty - eye, Math.hypot(dx, dz));
    };
    const health = (): number[] => [h.host.survival.value(pRec, V_HEALTH), h.host.survival.value(carRec, V_HEALTH)];
    const [person, shell] = health();
    // At the passenger's head, above the door sill.
    aim(ents.x[b.ent]!, ents.y[b.ent]! + stanceEye(h.reg.move[ents.kind[b.ent]!]!, ents.stance[b.ent]!), ents.z[b.ent]!);
    fire(h, 2, 1);
    expect(health()[0]).toBeLessThan(person!);
    expect(health()[1]).toBe(shell);
    // At the door below the sill, by the boot: the car's shell, nose to tail.
    aim(ents.x[car]! - 0.9, ents.y[car]! + 0.5, ents.z[car]! - 1.7);
    fire(h, 2, 1);
    expect(health()[1]).toBeLessThan(shell!);
  } finally {
    h.host.shutdown();
  }
}, 60000);
