import { expect, test } from "bun:test";
import { DinosaurSelfcheck } from "../../client/core/activity-selfcheck.ts";
import type { App } from "../../client/core/app.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";

test("the browser ride exercise waits for the previous use input to reach authority before retrying", () => {
  const own = { x: 0, y: 0, z: 0, kind: 0, act: ACT_NONE, vx: 0, vz: 0, creatureMode: 0 };
  const session = { state: "active", ownHandle: 1, driving: -1, simTick: 50, latestSnapshot: 45,
    registry: { ids: ["core:stego"], bodyHeight: [4.13], combat: [] }, own, stats: { corrections: 0 } };
  const use: boolean[] = [];
  const app = { session, remote: { count: 1, kind: [0], id: [8], x: [0], y: [0], z: [2] },
    hud: { prompt: "ride Stego" }, controls: { key(k: string, down: boolean) { if (k === "KeyE") use.push(down); },
      mouseButton() {}, release() {}, yaw: 0, pitch: 0 } } as unknown as App;
  const ride = new DinosaurSelfcheck("stego");
  ride.step(app, 1000);
  session.simTick = 92; session.latestSnapshot = 51; ride.step(app, 2400);
  session.simTick = 96; session.latestSnapshot = 60; ride.step(app, 2500);
  expect(use).toEqual([true, false]);
  session.latestSnapshot = 93; ride.step(app, 2550);
  expect(use).toEqual([true, false, true]);
  session.driving = 8; ride.step(app, 2600);
  expect(ride.data.mounted).toBe(true);
  expect(use.at(-1)).toBe(false);
  session.driving = -1; ride.step(app, 2650);
  expect(ride.data.lostMount).toBe(true); expect(ride.data.finished).toBe(true);
  expect(ride.data.attempts).toBe(2);
});
