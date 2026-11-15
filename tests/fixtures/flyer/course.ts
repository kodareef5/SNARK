// A ridden flight on the block-out pteranodon over the proving ground, through everything its pose shows: taking off from
// a crouch, hovering, flapping off, a turn, a climb, a sprint, a hard turn, a dive, braking to a hover, a barrel roll, a
// glide, skimming in to land, and setting down again from high up. The look moves as a hand on a mouse moves it.

import { App } from "../../../client/core/app.ts";
import type { ClientSession } from "../../../client/core/session.ts";
import { RESULT_OK } from "../../../shared/net/protocol.ts";
import { parsePack } from "../../../shared/pack/pack.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_ROLL, BTN_SPRINT } from "../../../shared/sim/character.ts";
import { Harness } from "../net.ts";
import { FLYER, flyerHost, flyerPackBytes, flyerRegistry } from "./flyer.ts";

export interface Mounted {
  h: Harness;
  /** Ada, who rides it, and any others named, standing by. */
  ada: ClientSession;
  others: ClientSession[];
  /** The pteranodon's entity. */
  e: number;
  /** Ada's whole client, where she was given one, which `run` draws a frame of each client frame. */
  app: App | null;
  run(ms: number, each?: (now: number) => void): void;
}

/**
 * Ada on a `latencyMs` link and the others on the proving ground's plaza, Ada on a saddled pteranodon of her tribe with
 * full stamina; with `app`, Ada is a whole client drawing the block-out.
 */
export function mounted(latencyMs = 60, others: string[] = [], app = false): Mounted {
  const reg = flyerRegistry();
  const host = flyerHost();
  const h = new Harness({}, 1, 60, { dev: true, clips: host.clips, rigs: host.rigs }, reg);
  const ada = h.join("ada", { latencyMs }, { manual: app });
  const whole = app ? new App(ada, reg, parsePack(flyerPackBytes())) : null;
  const run = (ms: number, each?: (now: number) => void): void =>
    h.run(ms, (now) => {
      whole?.frame(now, 640, 360);
      each?.(now);
    });
  const more = others.map((name) => h.join(name));
  run(500);
  ada.text("enablecheats");
  run(300);
  ada.text("tp 256 244");
  for (const [i, s] of more.entries()) {
    s.text("enablecheats");
    run(300);
    s.text(`tp ${250 - i * 3} 236`);
  }
  run(300);
  const ents = h.world.ents;
  const c = h.client(ada)!;
  const me = h.host.records.byPid.get(c.pid)!;
  const e = h.host.spawnCreature(FLYER, 256, 248, 1);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = reg.index.get("core:saddle_pteranodon")!;
  h.host.refreshBody(rec);
  run(300);
  if (h.host.riding.mount(c, e) !== RESULT_OK) throw new Error("Ada could not get on");
  run(7000);
  return { h, ada, others: more, e, app: whole, run };
}

/** What a hand on the keys and the mouse does: the look, and the keys held. */
interface Hand {
  yaw: number;
  pitch: number;
  hold(keys: { up?: boolean; forward?: boolean; sprint?: boolean; brake?: boolean; roll?: boolean }): void;
}

/** Ada's hand: her whole client's keys and look where she has one, else her pilot's inputs. */
function handOf(m: Mounted): Hand {
  const pilot = m.h.pilots[m.h.sessions.indexOf(m.ada)]!;
  const app = m.app;
  if (!app) {
    return {
      get yaw() {
        return pilot.yaw;
      },
      set yaw(v) {
        pilot.yaw = v;
      },
      get pitch() {
        return pilot.pitch;
      },
      set pitch(v) {
        pilot.pitch = v;
      },
      hold(k) {
        pilot.moveZ = k.forward ? 1 : 0;
        pilot.buttons = (k.up ? BTN_JUMP : 0) | (k.sprint ? BTN_SPRINT : 0) | (k.brake ? BTN_BRAKE : 0) | (k.roll ? BTN_ROLL : 0);
      },
    };
  }
  const c = app.controls;
  return {
    get yaw() {
      return c.yaw;
    },
    set yaw(v) {
      c.yaw = v;
    },
    get pitch() {
      return c.pitch;
    },
    set pitch(v) {
      c.pitch = v;
    },
    hold(k) {
      // Space toggles its wings (D503): tapped when they are not as wanted.
      if (c.wing !== (k.up === true)) {
        app.key("Space", true);
        m.run(50);
        app.key("Space", false);
      }
      app.key("KeyW", k.forward === true);
      app.key("ShiftLeft", k.sprint === true);
      app.key("KeyX", k.brake === true);
      app.key("KeyC", k.roll === true);
    },
  };
}

/** Flies the course, telling `mark` the name of each part as it begins. `each` is told of each client frame. */
export function flyCourse(m: Mounted, mark: (part: string) => void, each?: (now: number) => void): void {
  const hand = handOf(m);
  const run = (ms: number): void => m.run(ms, each);
  /** Moves the look to (yaw, pitch) over `ms`, then holds it `hold` ms. */
  const look = (yaw: number, pitch: number, ms: number, hold: number): void => {
    const [y0, p0] = [hand.yaw, hand.pitch];
    for (let t = 50; t <= ms; t += 50) {
      hand.yaw = y0 + ((yaw - y0) * t) / ms;
      hand.pitch = p0 + ((pitch - p0) * t) / ms;
      run(50);
    }
    run(hold);
  };
  mark("taking off");
  hand.hold({ up: true });
  run(2000);
  mark("flying off");
  hand.hold({ up: true, forward: true });
  run(2000);
  mark("turning left");
  look(hand.yaw + 2.4, 0, 2000, 500);
  mark("climbing");
  look(hand.yaw, 0.5, 500, 1500);
  mark("sprinting");
  look(hand.yaw, 0, 500, 0);
  hand.hold({ up: true, forward: true, sprint: true });
  run(2500);
  mark("turning hard");
  look(hand.yaw - 1.6, 0, 1000, 300);
  mark("diving");
  hand.hold({ up: true, forward: true });
  look(hand.yaw, -1, 500, 1000);
  mark("levelling");
  look(hand.yaw, 0, 500, 1000);
  mark("braking");
  hand.hold({ up: true, brake: true });
  run(1500);
  mark("rolling");
  hand.hold({ up: true, forward: true });
  run(500);
  hand.hold({ up: true, forward: true, roll: true });
  run(150);
  hand.hold({ up: true, forward: true });
  run(1500);
  mark("gliding");
  look(hand.yaw, -0.3, 500, 1500);
  mark("skimming in");
  look(hand.yaw, 0, 300, 0);
  hand.hold({});
  run(4000);
  mark("up again");
  hand.hold({ up: true });
  run(1500);
  hand.hold({ up: true, forward: true });
  look(hand.yaw, 0.8, 500, 2500);
  mark("hovering high");
  look(hand.yaw, 0, 300, 0);
  hand.hold({ up: true });
  run(1500);
  mark("setting down");
  hand.hold({});
  run(6000);
  mark("down");
}
