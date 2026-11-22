// A creature's hurt stage on a running server: set by a blow at once, by mending and by harm that is no blow within a
// sweep, a quarter of its health wide whatever its health, and sent to whoever sees it, one who joins later too.

import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { SWEEP_TICKS } from "../../server/hurt.ts";
import { AnimState, hurtStage } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { camp, clearing } from "../kit/kit.ts";

const stageOf = (cue: number): number => {
  const st = new AnimState();
  st.unpackCue(cue);
  return st.hurt;
};

test("a dodo's hurt stage follows its health down at each blow and back up as it mends, a quarter at a time, and one who joins later sees it", () => {
  const { h, at } = camp({ place: clearing(), god: true });
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 1.2, 30);
  const ents = h.world.ents;
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  // Knocked out, it lies still to be struck.
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(3000);
  const max = rec.vitals!.max[V_HEALTH]! / 1e6;
  const health = (): number => h.host.survival.value(rec, V_HEALTH);
  expect(stageOf(ents.cue[e]!)).toBe(0);

  // Every tick from here: its health after the tick, and the stage its cue word carries.
  const seen: [number, number][] = [];
  const step = h.server.tick.bind(h.server);
  h.server.tick = () => {
    step();
    seen.push([health(), stageOf(ents.cue[e]!)]);
  };
  const pilot = h.pilots[0]!;
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(h.world.hf.heightAt(at.x, at.z + 1.2) + 0.15 - (h.world.hf.heightAt(at.x, at.z) + 1.62), 1.2);
  while (health() > max * 0.15 && seen.length < 60 * TICK_RATE) {
    pilot.buttons |= BTN_PRIMARY;
    h.run(500);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(200);
  }
  // A blow lands on a tick, and the stage it leaves is in the cue word that same tick.
  const blows = seen.filter(([hp], k) => k > 0 && hp < seen[k - 1]![0] - 0.5);
  expect(blows.length).toBeGreaterThan(2);
  for (const [hp, stage] of blows) expect(stage).toBe(hurtStage(hp, max));
  expect(new Set(seen.map(([, stage]) => stage))).toEqual(new Set([0, 1, 2, 3]));
  // Never finer than a quarter: the stage changes only where the quarter its health is in changes.
  for (let k = 1; k < seen.length; k++) if (seen[k]![1] !== seen[k - 1]![1]) expect(hurtStage(seen[k]![0], max)).not.toBe(hurtStage(seen[k - 1]![0], max));

  // Bo arrives now and sees it as hurt as Ada does.
  const bo = h.join("bo");
  h.run(1500);
  h.say(bo, "enablecheats");
  h.say(bo, `tp ${(at.x + 1).toFixed(3)} ${at.z.toFixed(3)}`);
  h.run(1000);
  const sample = new RemoteSample();
  bo.sampleRemote(sample);
  const dodo = h.reg.index.get("core:dodo")!;
  const i = sample.kind.subarray(0, sample.count).indexOf(dodo);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(stageOf(sample.cue[i]!)).toBe(3);

  // Mended to full, which is no blow, it is unhurt again within a sweep; harm that is no blow is found the same way.
  h.host.survival.add(rec, V_HEALTH, max);
  h.run(((SWEEP_TICKS + 2) * 1000) / TICK_RATE);
  expect(stageOf(ents.cue[e]!)).toBe(0);
  h.host.survival.hurt(rec, max * 0.6, 0);
  h.run(((SWEEP_TICKS + 2) * 1000) / TICK_RATE);
  expect(stageOf(ents.cue[e]!)).toBe(hurtStage(health(), max));
  expect(stageOf(ents.cue[e]!)).toBe(2);
  bo.sampleRemote(sample);
  expect(stageOf(sample.cue[sample.kind.subarray(0, sample.count).indexOf(dodo)]!)).toBe(2);
});
