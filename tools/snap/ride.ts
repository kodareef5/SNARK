// Riding, for pictures, through the whole client as a player sees it (server/riding.ts, client/core/viewpoint.ts):
// `bun run snap -- --ride SPECIES --moment MOMENT` puts the survivor on a saddled tame of hers on the proving ground and
// draws her riding camera at that moment. With `--watch` Bob rides and the picture is what she sees of him from 9 m off
// his right; with `--passenger` Bob steers and she sits behind him on a saddle of three seats (THREE_SEATS, the test's).
// Moments: `ground` (got on, at rest), `run` (sprinting), and for a flyer `air` (level flight), `bank` (turning hard) and
// `dive`.

import type { App } from "../../client/core/app.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";
import type { Seat } from "../../shared/sim/seats.ts";
import type { ClipSet } from "../../shared/anim/clip.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import type { Harness } from "../../tests/fixtures/net.ts";

export const RIDE_MOMENTS = ["ground", "run", "air", "bank", "dive"] as const;
export type RideMoment = (typeof RIDE_MOMENTS)[number];

/** A large mount's passenger saddle: the rider steers, two sit behind on no socket of their own. */
export const THREE_SEATS: Seat[] = [
  { id: "rider", driver: true, socket: "seat", anchor: [0, 2.57, 0.7], entry: [1.7, 0, 0.7] },
  { id: "passenger_left", anchor: [0.35, 2.45, -0.15], entry: [1.7, 0, -0.15] },
  { id: "passenger_right", anchor: [-0.35, 2.45, -0.15], entry: [-1.7, 0, -0.15] },
];

/** Content, a pack, and the server's clips and rigs, in place of the core's. */
export interface Game {
  readonly reg?: Registry;
  readonly pack?: Uint8Array;
  readonly host?: { clips: ClipSet; rigs: PackRig[] };
}

/** What `species` is ridden in: with `passenger`, the core content with its saddle given THREE_SEATS. */
export function rideGame(species: string, passenger: boolean): Game | undefined {
  if (passenger) {
    const content = CORE_CONTENT.map((d) => (d.type === "item" && d.id === `core:saddle_${species}` ? { ...d, saddle: { ...d.saddle!, seats: THREE_SEATS } } : d));
    const { registry, errors } = compileContent(content);
    if (!registry) throw new Error(errors.join("\n"));
    return { reg: registry };
  }
  return undefined;
}

/** The setup for clientPicture (tools/snap.ts): someone gets on `species` and rides it to `moment`. */
export function rideScene(app: App, run: (ms: number) => void, h: Harness, species: string, moment: RideMoment, watch: boolean, passenger: boolean): void {
  const s = app.session;
  const ents = h.world.ents;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 60, 60);
  const [x, z] = [g.x + 30, g.z + 10];
  s.text(`tp ${(x - 2.5).toFixed(3)} ${(z + 1.2).toFixed(3)}`);
  run(300);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const e = h.host.spawnCreature(`core:${species}`, x, z, 30);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  ents.yaw[e] = 0;
  h.host.creatures.claimed(e);
  h.host.creatures.mind.stay(e, 0xffffffff);
  // Bob, of her tribe, steers when she is a passenger or is watched; else she does, by her keys.
  const bob = watch || passenger ? h.join("bob") : null;
  const pilot = bob ? h.pilots[h.sessions.indexOf(bob)]! : null;
  if (bob) {
    // Her session is the picture's, framed by `run`; Bob's the harness's.
    const say = (who: typeof s, line: string): void => {
      who.text(line);
      run(300);
    };
    run(600);
    say(bob, "enablecheats");
    say(bob, `tp ${(x - 2.5).toFixed(3)} ${(z - 1.2).toFixed(3)}`);
    // An invitation is made face to face.
    say(s, "tribe create Riders");
    say(s, "tribe invite bob");
    say(bob, "tribe accept");
  }
  rec.team = me.team;
  rec.saddle = h.reg.index.get(`core:saddle_${species}`)!;
  h.host.refreshBody(rec);
  const c = app.controls;
  c.yaw = 0;
  c.pitch = -0.1;
  const got = bob ? h.host.riding.mount(h.client(bob)!, e) : 0;
  if (got !== 0) throw new Error(`Bob could not get on (result ${got})`);
  run(400);
  if (!watch) h.host.riding.mount(h.client(s)!, e);
  run(1200);
  const steer = (forward: boolean, sprint: boolean, up: boolean, yaw: number, pitch: number): void => {
    if (pilot) {
      pilot.moveZ = forward ? 127 : 0;
      pilot.buttons = (sprint ? BTN_SPRINT : 0) | (up ? BTN_JUMP : 0);
      pilot.yaw = yaw;
      pilot.pitch = pitch;
      if (passenger) {
        // Sitting behind him, she looks off to one side and a little down, as a passenger looking about does.
        c.yaw = yaw + 0.7;
        c.pitch = -0.2;
      }
      return;
    }
    app.key("KeyW", forward);
    app.key("ShiftLeft", sprint);
    c.yaw = yaw;
    c.pitch = pitch;
  };
  const flies = h.reg.flies[ents.kind[e]!] === 1;
  if (flies && moment !== "ground" && moment !== "run") {
    if (pilot) pilot.buttons = BTN_JUMP;
    else {
      app.key("Space", true);
      run(50);
      app.key("Space", false);
    }
    run(1500);
    steer(true, false, true, 0, 0.45);
    run(5000);
    steer(true, true, true, 0, 0);
    run(2500);
    if (moment === "bank") for (let t = 0; t < 900; t += 50) {
      steer(true, true, true, 0.06 * (t / 50 + 1), 0);
      run(50);
    }
    if (moment === "dive") {
      steer(true, true, true, 0, -0.85);
      run(900);
    }
  } else if (moment !== "ground") {
    steer(true, true, false, 0, -0.1);
    run(2500);
  } else {
    if (!pilot) c.yaw = 0.5;
    c.pitch = -0.2;
    run(600);
  }
  if (watch) {
    // She stands 9 m off his right and looks at him; in the air, as an admin flying, 2.5 m over him.
    const aloft = flies && moment !== "ground" && moment !== "run";
    if (aloft) {
      s.text("fly");
      run(100);
    }
    const [mx, my, mz, a] = [ents.x[e]!, ents.y[e]!, ents.z[e]!, (ents.yaw[e]! / 65536) * Math.PI * 2];
    const [bx, bz] = [mx - Math.cos(a) * 9, mz + Math.sin(a) * 9];
    const by = Math.max(h.world.hf.heightAt(bx, bz), my + (aloft ? 2.5 : 0));
    ents.setPosition(h.ent(s), bx, by, bz);
    run(100);
    c.yaw = Math.atan2(ents.x[e]! - bx, ents.z[e]! - bz);
    c.pitch = Math.atan2(ents.y[e]! + 1.4 - by - 1.6, 9);
  }
}
