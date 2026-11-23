import { expect, test } from "bun:test";
import { ClientSession, RemoteSample } from "../../client/core/session.ts";
import { Past } from "../../server/history.ts";
import type { Solved } from "../../shared/anim/skeleton.ts";
import { CUE_DOWN } from "../../shared/anim/pose.ts";
import { REACT_CREATURE_DOWN } from "../../shared/anim/reactions.ts";
import { EntityView, POS_UNITS, ViewRing } from "../../shared/net/view.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("replayed origins stay with their poses as survivors and dodos fall and rise", () => {
  const h = new Harness({}, 7, 60, { wild: false, map: writeMap(flatMap(4)) });
  try {
    const watcher = h.join("watcher"), actor = h.join("actor");
    h.run(600);
    const observer = h.ent(watcher), human = h.ent(actor), a = h.world.ents;
    a.setPosition(observer, 91, 0, 94);
    a.setPosition(human, 100, 0, 98);
    const bird = h.host.spawnCreature("core:dodo", 106, 98, 200);
    h.run(250);
    const remote = new RemoteSample(), from = new Past(), to = new Past(), shot = new Past();
    const down = (e: number, cue: number, reaction: number) => e === human ? (cue & CUE_DOWN) !== 0 : reaction === REACT_CREATURE_DOWN;
    const edges = new Map([[human, 0], [bird, 0]]);
    const calls: number[] = [];
    let used: Solved | null = null;
    const downPose = h.host.combat.downPose;
    h.host.combat.downPose = (e, tick) => { calls.push(tick); used = downPose(e, tick); return used; };
    for (const e of [human, bird]) expect(h.host.falls.knock(e, 0, 1, 4, 3, 0, 0)).toBe(true);
    let checked = 0;
    h.run(6000, () => {
      const tick = watcher.latestSnapshot;
      if (tick === checked) return;
      checked = tick;
      for (const e of [human, bird]) {
        if (edges.get(e) === 2) continue;
        if (!h.world.history.at(tick - 1, e, from) || !h.world.history.at(tick, e, to)) continue;
        const laid = down(e, from.cue, from.react);
        if (laid === down(e, to.cue, to.react)) continue;
        if (!laid && e === human) expect(to.y - from.y).toBeGreaterThan(.7);
        edges.set(e, edges.get(e)! + 1);
        for (const k of [.25, .5, .75, .999, 1]) {
          const at = tick - 1 + k, expected = k < 1 ? from : to;
          expect(h.world.history.sample(at, e, shot)).toBe(true);
          expect([shot.x, shot.y, shot.z, shot.cue, shot.react]).toEqual([expected.x, expected.y, expected.z, expected.cue, expected.react]);
          watcher.sampleRemote(remote, watcher.renderClock - at);
          const i = remote.id.subarray(0, remote.count).indexOf(e);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(down(e, remote.cue[i]!, remote.react[i]!)).toBe(down(e, expected.cue, expected.react));
          expect(Math.hypot(remote.x[i]! - shot.x, remote.y[i]! - shot.y, remote.z[i]! - shot.z)).toBeLessThan(.004);
          calls.length = 0;
          h.host.combat.castBodies(observer, shot.x, shot.y + 2, shot.z, 0, -1, 0, 4, 0, at);
          if (down(e, expected.cue, expected.react)) expect(calls).toContain(Math.floor(at));
          else if (!laid && k < 1) expect(calls).toEqual([]);
        }
        if (laid) {
          const last = h.host.falls.poseAt(e, tick - 1)!;
          expect(h.host.falls.knock(e, 0, 1, -4, -3, 0, 0)).toBe(true);
          expect(last).not.toBe(h.host.falls.poseOf(e));
          used = null;
          expect(h.host.combat.castBodies(observer, from.x, from.y + 2, from.z, 0, -1, 0, 4, 0, tick - .25)).toBe(e);
          expect(used).toBe(last);
        }
      }
    });
    expect([...edges.values()]).toEqual([2, 2]);
  } finally { h.host.shutdown(); }
});

test("a creature's mating bit keeps its origin moving between snapshots", () => {
  const h = new Harness({}, 1, 60, { wild: false, map: writeMap(flatMap(2)) });
  try {
    const kind = h.reg.index.get("core:raptor")!, e = h.host.spawnCreature("core:raptor", 40, 40, 5);
    h.world.history.track(e);
    const session = new ClientSession({ send() {}, close() {}, open: true, onMessage: null, onClose: null },
      { name: "spectator", key: new Uint8Array(32), registry: h.reg, spectate: true, resolveMap: () => null });
    const views = (session as unknown as { drawn: ViewRing<EntityView> }).drawn;
    for (const [tick, x, cue] of [[80, 40, 0], [81, 42, CUE_DOWN]] as const) {
      const a = h.world.ents;
      a.setPosition(e, x, 0, 40); a.cue[e] = cue; h.world.history.cued(e);
      h.world.history.record(tick, h.world);
      const view = views.alloc(tick);
      view.push(e, a.gen[e]!, kind, x * POS_UNITS, 0, 0, 0, 0, 0, 0, cue);
    }
    const shot = new Past(), remote = new RemoteSample();
    expect(h.world.history.sample(80.75, e, shot)).toBe(true);
    session.renderClock = 80.75; session.sampleRemote(remote, 0);
    expect([shot.x, shot.cue, remote.x[0], remote.cue[0]]).toEqual([41.5, CUE_DOWN, 41.5, CUE_DOWN]);
  } finally { h.host.shutdown(); }
});
