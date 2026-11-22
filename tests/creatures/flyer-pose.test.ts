// A flyer's pose on a running server and its clients (planning/reference/flyers-plan.md, FL4): the pteranodon
// ridden through a whole flight, posed by the server for its hit zones, drawn by two other clients from what they are
// sent and by its rider's own client from what it predicts.

import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { advanceCreature, creaturePose } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { AnimState, CLIMB_DIVE, CLIMB_UP, CUE_LAND, CUE_ROLL, CUE_TAKEOFF, bodySeed } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { flyCourse, mounted, type Mounted } from "../fixtures/flyer/course.ts";
import { FLYER, clipTurns, turnBetween } from "../fixtures/flyer/flyer.ts";
import { artTest } from "../fixtures/needs-art.ts";

/** The server's pose state and cues of `e` after each tick it steps, by tick. */
function watch(h: Mounted["h"], e: number): Map<number, [number, number]> {
  const seen = new Map<number, [number, number]>();
  const step = h.server.tick.bind(h.server);
  h.server.tick = () => {
    step();
    seen.set(h.world.tick, [h.world.ents.anim[e]!, h.world.ents.cue[e]!]);
  };
  return seen;
}

artTest("through a whole ridden flight other clients are sent the flyer's pose state as the server poses it, and draw it with their gaits smoothly, settling on the server's pose to the bit", () => {
  const m = mounted(60, ["bea", "cy"]);
  const { h, e } = m;
  const anim = h.world.anims[h.reg.index.get(FLYER)!]!;
  const rig = anim.rig;
  const seen = watch(h, e);
  const own = clipTurns(rig);
  const sample = new RemoteSample();
  const st = new AnimState();
  const server = new AnimState();
  const parts = new Set<string>();
  const kinds = new Set<string>();
  let part = "";
  let compared = 0;
  let settled = 0;
  let worst = 0;
  /** Each watcher's gait, the pose it last drew and when, and since when what it is sent has stayed the same. */
  const watchers = m.others.map(() => ({ gait: new Gait(), was: new Solved(rig.bones), tick: -1, word: -1, since: 0 }));
  const drawn = new Solved(rig.bones);
  const mark = (name: string): void => {
    part = name;
    parts.add(name);
  };
  flyCourse(m, mark, () => {
    m.others.forEach((s, w) => {
      s.sampleRemote(sample);
      const i = Array.from(sample.id.subarray(0, sample.count)).indexOf(e);
      if (i < 0) return;
      const tick = sample.tick;
      const at = Math.round(tick);
      const sent = seen.get(at);
      if (!sent) return;
      // What it drew from is the server's own state at the nearer tick, so it poses it as the server does.
      expect([part, at, sample.anim[i], sample.cue[i]]).toEqual([part, at, sent[0], sent[1]]);
      st.unpack(sample.anim[i]!, sample.cue[i]!);
      st.seed = bodySeed(sample.id[i]!);
      server.unpack(sent[0], sent[1]);
      server.seed = bodySeed(e);
      kinds.add(st.mode === MODE_FLYER ? `climb ${st.climb}` : `on foot`);
      kinds.add(`cue ${st.cue}`);
      if (st.mode === MODE_FLYER) kinds.add(st.speed === 0 ? "hovering" : st.speed <= 3 ? "flying" : "fast");
      compared++;
      // Drawn with its gait, as the renderer draws it.
      const v = watchers[w]!;
      if (v.word !== sent[0]) [v.word, v.since] = [sent[0], at];
      advanceCreature(anim, v.gait, st, tick, sample.x[i]!, sample.z[i]!, sample.yaw[i]!, 1);
      creaturePose(anim, st, tick, rig.a, v.gait);
      solve(rig, rig.a, drawn);
      const dt = tick - v.tick;
      if (dt > 0 && dt <= 1) for (let b = 0; b < rig.bones; b++) worst = Math.max(worst, (turnBetween(drawn.rot, v.was.rot, b) - own[b]! * dt) / dt);
      v.tick = tick;
      v.was.rot.set(drawn.rot);
      // In flight, what it is sent the same for a second, its drawing is the server's pose to the bit.
      if (st.mode !== MODE_FLYER || at - v.since < 30) return;
      creaturePose(anim, server, tick, rig.a);
      solve(rig, rig.a, rig.solved);
      expect([part, at, Array.from(drawn.pos)]).toEqual([part, at, Array.from(rig.solved.pos)]);
      settled++;
    });
  });
  expect(parts.size).toBe(16);
  expect([compared > 4000, settled > 300]).toEqual([true, true]);
  // It hovered, flew and flew fast, climbed and dived, took off, rolled and landed.
  for (const k of ["hovering", "flying", "fast", `climb ${CLIMB_UP}`, `climb ${CLIMB_DIVE}`, "on foot", `cue ${CUE_TAKEOFF}`, `cue ${CUE_ROLL}`, `cue ${CUE_LAND}`]) expect([k, kinds.has(k)]).toEqual([k, true]);
  // No bone turned in a tick 15 degrees more than the most any clip turns it in a frame: the most is the legs swinging down
  // from the glide as it skims in to land.
  expect(worst).toBeLessThan(15);
});

test("the rider's own client poses its mount from what it predicts as the server poses it from what it steps, with nothing corrected", () => {
  const m = mounted(60, [], true);
  const { h, e, ada } = m;
  const seen = watch(h, e);
  const body = (m.app as unknown as { body: { state: AnimState } }).body;
  const own = new Map<number, number>();
  const corrections = ada.stats.corrections;
  let last = ada.simTick;
  flyCourse(
    m,
    () => {},
    () => {
      // On a frame that stepped its prediction, the look it drew with is the one it sent for that tick.
      if (ada.driving === e && ada.simTick !== last) own.set(ada.simTick, body.state.pack());
      last = ada.simTick;
    },
  );
  // Its speed, bank or way of standing, climb and look as the server has them.
  let flying = 0;
  let compared = 0;
  for (const [tick, word] of own) {
    const sent = seen.get(tick);
    if (!sent) continue;
    expect([tick, word & 0x3ffff]).toEqual([tick, sent[0] & 0x3ffff]);
    if (((word >>> 8) & 3) === 3) flying++;
    compared++;
  }
  expect([compared > 1000, flying > 800, ada.stats.corrections - corrections]).toEqual([true, true, 0]);
});
