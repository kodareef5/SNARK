// What a supply drop is heard by (planning/workstreams/supply.md). Nothing is sent for its sounds: each client hears a
// drop from the list it is told and the pose every party works out from its ticks (shared/sim/supply.ts), so what is
// heard keeps time with what is seen, and a client that joins while one is in the air hears the rest of it.
//
// The shaft hums where it stands, nearest the ear along its height. The sender's strike is heard as late as its
// distance makes it. The capsule is heard passing, its jets light, burn and cut, it lands, its louvres open, and a
// chime sounds for each step of its tier: the count a collar and a pulse say, said once more.

import { POSE_BRAKING, POSE_FLYING, POSE_LANDED, POSE_LEAVING, SHUTTERS_AFTER, SHUTTERS_TAKE, newPose, supplyPose, type SupplyList } from "../../../shared/sim/supply.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { Hear } from "./bodies.ts";

const K = {
  call: cueKey("supply/call"),
  shaft: cueKey("supply/shaft"),
  release: cueKey("supply/release"),
  pass: cueKey("supply/pass"),
  ignite: cueKey("supply/ignite"),
  jet: cueKey("supply/jet"),
  cut: cueKey("supply/cut"),
  land: cueKey("supply/land"),
  settle: cueKey("supply/settle"),
  count: cueKey("supply/count"),
  open: cueKey("supply/open"),
  gone: cueKey("supply/gone"),
};

/** The first of the loops' numbers that are the drops': two a drop, its shaft's and its jets'. */
export const SUPPLY_LOOPS = 800000;
/** Metres a second sound travels: how late a sender's strike is heard. */
export const SOUND_SPEED = 343;
/** Seconds at the most a strike is held back, however far its sender. */
export const STRIKE_LATEST = 14;
/** How far along its flight a capsule is when it is heard passing. */
export const PASS_AT = 0.86;
/** Seconds between the chimes of the count, which begin as the louvres are half open. */
export const COUNT_EVERY = 0.45;
/** Seconds a drop may have been called for its call still to be heard by a client that has just been told of it. */
const CALL_FRESH = 3;

type Loop = (id: number, key: number, x: number, y: number, z: number, level: number, on: boolean) => void;

interface Heard {
  state: number;
  passed: boolean;
  opened: boolean;
}

export class SupplySounds {
  private readonly heard = new Map<number, Heard>();
  private readonly pose = newPose();

  /** One frame: the drops of `list` at `tick`, heard from (ex, ey, ez). `owner` is the capsule's number among the sounds' owners. */
  update(list: SupplyList, tick: number, rate: number, ex: number, ey: number, ez: number, owner: number, hear: Hear, loop: Loop): void {
    const pose = this.pose;
    if (this.heard.size > list.rows.length) for (const id of this.heard.keys()) if (!list.rows.some((r) => r.id === id)) this.heard.delete(id);
    for (const row of list.rows) {
      supplyPose(row, tick, rate, pose);
      let was = this.heard.get(row.id);
      if (!was) {
        // Just told of it: its call is heard if it was only now called, and nothing it did before is.
        was = { state: pose.state, passed: pose.state > POSE_FLYING || pose.along > PASS_AT, opened: row.opened };
        this.heard.set(row.id, was);
        if (tick - row.called < CALL_FRESH * rate) hear(owner, K.call, -1, row.x, row.y + 2, row.z, 0, 1, false);
      }
      const count = list.tiers[row.tier]?.count ?? 1;
      if (was.state < POSE_FLYING && pose.state >= POSE_FLYING && pose.state < POSE_LANDED) {
        // The sender's strike, as late as its distance makes it.
        const far = Math.hypot(row.ox - ex, row.oy - ey, row.oz - ez);
        hear(owner, K.release, -1, row.ox, row.oy, row.oz, 0, 1, false, Math.min(STRIKE_LATEST, far / SOUND_SPEED));
      }
      if (pose.state === POSE_FLYING && !was.passed && pose.along > PASS_AT) {
        was.passed = true;
        hear(owner, K.pass, -1, pose.x, pose.y, pose.z, 0, 1, false);
      }
      if (was.state !== POSE_BRAKING && pose.state === POSE_BRAKING) hear(owner, K.ignite, -1, pose.x, pose.y, pose.z, 0, 1, false);
      if (was.state !== POSE_LANDED && was.state < POSE_LANDED && pose.state === POSE_LANDED && pose.since < 1) {
        hear(owner, K.cut, -1, row.x, row.y + 0.4, row.z, 0, 1, false);
        hear(owner, K.land, -1, row.x, row.y, row.z, 0, 1, false);
        hear(owner, K.settle, -1, row.x, row.y + 1.6, row.z, 0, 1, false, SHUTTERS_AFTER);
        for (let k = 0; k < count; k++) hear(owner, K.count, -1, row.x, row.y + 2.1, row.z, 0, 1, false, SHUTTERS_AFTER + SHUTTERS_TAKE / 2 + k * COUNT_EVERY);
      }
      if (row.opened && !was.opened) hear(owner, K.open, -1, row.x, row.y + 0.8, row.z, 0, 1, false);
      if (was.state !== POSE_LEAVING && was.state <= POSE_LANDED && pose.state === POSE_LEAVING) hear(owner, K.gone, -1, row.x, row.y + 1, row.z, 0, 1, false);
      was.state = pose.state;
      was.opened = row.opened;
      // The shaft hums nearest the ear along its height; the jets burn where the capsule is.
      loop(SUPPLY_LOOPS + row.id * 2, K.shaft, row.x, Math.max(row.y + 1, Math.min(row.y + 400, ey)), row.z, 0.9 * pose.shaft, pose.shaft > 0.1);
      loop(SUPPLY_LOOPS + row.id * 2 + 1, K.jet, pose.x, pose.y, pose.z, pose.thrust, pose.thrust > 0.03);
    }
  }
}
