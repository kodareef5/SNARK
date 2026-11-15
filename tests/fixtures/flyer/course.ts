// A ridden flight on the block-out pteranodon over the proving ground, through everything its pose shows: taking off from
// a crouch, hovering, flapping off, a turn, a climb, a sprint, a dive, braking to a hover, a barrel roll, a glide, skimming
// in to land, and setting down again from high up. The look moves as a hand on a mouse moves it.

import { RESULT_OK } from "../../../shared/net/protocol.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_ROLL, BTN_SPRINT } from "../../../shared/sim/character.ts";
import type { ClientSession } from "../../../client/core/session.ts";
import { Harness } from "../net.ts";
import { FLYER, flyerHost, flyerRegistry } from "./flyer.ts";

export interface Mounted {
  h: Harness;
  /** Ada, who rides it, and any others named, standing by. */
  ada: ClientSession;
  others: ClientSession[];
  /** The pteranodon's entity. */
  e: number;
}

/** Ada on a `latencyMs` link and the others on the proving ground's plaza, Ada on a saddled pteranodon of her tribe with full stamina. */
export function mounted(latencyMs = 60, others: string[] = []): Mounted {
  const reg = flyerRegistry();
  const host = flyerHost();
  const h = new Harness({}, 1, 60, { dev: true, clips: host.clips, rigs: host.rigs }, reg);
  const ada = h.join("ada", { latencyMs });
  const more = others.map((name) => h.join(name));
  h.run(500);
  ada.text("enablecheats");
  h.run(300);
  ada.text("tp 256 244");
  for (const [i, s] of more.entries()) {
    s.text("enablecheats");
    h.run(300);
    s.text(`tp ${250 - i * 3} 236`);
  }
  h.run(300);
  const ents = h.world.ents;
  const c = h.client(ada)!;
  const me = h.host.records.byPid.get(c.pid)!;
  const e = h.host.spawnCreature(FLYER, 256, 248, 1);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = reg.index.get("core:saddle_pteranodon")!;
  h.host.refreshBody(rec);
  h.run(300);
  if (h.host.riding.mount(c, e) !== RESULT_OK) throw new Error("Ada could not get on");
  h.run(7000);
  return { h, ada, others: more, e };
}

/** Flies the course, telling `mark` the name of each part as it begins. `each` is told of each client frame. */
export function flyCourse(m: Mounted, mark: (part: string) => void, each?: (now: number) => void): void {
  const { h } = m;
  const pilot = h.pilots[h.sessions.indexOf(m.ada)]!;
  const run = (ms: number): void => h.run(ms, each);
  /** Moves the look to (yaw, pitch) over `ms`, then holds it `hold` ms. */
  const look = (yaw: number, pitch: number, ms: number, hold: number): void => {
    const [y0, p0] = [pilot.yaw, pilot.pitch];
    for (let t = 50; t <= ms; t += 50) {
      pilot.yaw = y0 + ((yaw - y0) * t) / ms;
      pilot.pitch = p0 + ((pitch - p0) * t) / ms;
      run(50);
    }
    run(hold);
  };
  mark("taking off");
  pilot.buttons = BTN_JUMP;
  run(2000);
  mark("flying off");
  pilot.moveZ = 1;
  run(2000);
  mark("turning left");
  look(pilot.yaw + 2.4, 0, 2000, 500);
  mark("climbing");
  look(pilot.yaw, 0.5, 500, 1500);
  mark("sprinting");
  look(pilot.yaw, 0, 500, 0);
  pilot.buttons = BTN_JUMP | BTN_SPRINT;
  run(2500);
  mark("turning hard");
  look(pilot.yaw - 1.6, 0, 1000, 300);
  mark("diving");
  pilot.buttons = BTN_JUMP;
  look(pilot.yaw, -1, 500, 1000);
  mark("levelling");
  look(pilot.yaw, 0, 500, 1000);
  mark("braking");
  pilot.buttons = BTN_JUMP | BTN_BRAKE;
  pilot.moveZ = 0;
  run(1500);
  mark("rolling");
  pilot.buttons = BTN_JUMP;
  pilot.moveZ = 1;
  run(500);
  pilot.buttons = BTN_JUMP | BTN_ROLL;
  run(150);
  pilot.buttons = BTN_JUMP;
  run(1500);
  mark("gliding");
  look(pilot.yaw, -0.3, 500, 1500);
  mark("skimming in");
  look(pilot.yaw, 0, 300, 0);
  pilot.moveZ = 0;
  pilot.buttons = 0;
  run(4000);
  mark("up again");
  pilot.buttons = BTN_JUMP;
  run(1500);
  pilot.moveZ = 1;
  look(pilot.yaw, 0.8, 500, 2500);
  mark("hovering high");
  look(pilot.yaw, 0, 300, 0);
  pilot.moveZ = 0;
  run(1500);
  mark("setting down");
  pilot.buttons = 0;
  run(6000);
  mark("down");
}
