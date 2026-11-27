// Forced-choice labels on the real lab world (tools/decide/setups.ts, label.ts) with a small point of the test's own:
// four headings, asked once, a leg along the one chosen and then on to the goal 20 m east.
import { expect, test } from "bun:test";
import { COST_RING, type Ask, type Point } from "../../server/decide/decide.ts";
import { GOAL_WALK, type Behavior } from "../../server/behavior.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { answer } from "../../shared/decide/forward.ts";
import { PROFILES, RING_FAR } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { emptyManifest, encode, meanCosts, targetOf } from "../../tools/decide/dataset.ts";
import { labelScene } from "../../tools/decide/label.ts";
import type { Scene } from "../../tools/decide/random.ts";
import { build, gameReplayer, play, type Built, type Installer } from "../../tools/decide/setups.ts";

const EAST = 1, WEST = 3;

/** Headings north, east, south and west; the rule likes the one toward the goal. */
class Four implements Point {
  readonly name = "test.four";
  readonly cost = COST_RING;
  readonly horizon = 0;
  readonly table = tableFor(RING_FAR, 4);
  readonly tables = [{ profile: RING_FAR, table: this.table }];
  legUntil = 0;
  private readonly b: Built;
  private readonly mind: Behavior;
  constructor(b: Built) {
    this.b = b;
    this.mind = b.lab.host.creatures.mind;
  }
  still(): boolean {
    return true;
  }
  answer(e: number, _tick: number, _rung: number, ask: Ask): number {
    const t = this.table, ents = this.b.lab.world.ents, w = RING_FAR.columns.length;
    t.clear(4);
    const toGoal = Math.atan2(this.b.goal.x - ents.x[e]!, this.b.goal.z - ents.z[e]!);
    for (let i = 0; i < 4; i++) t.rows[i * w + RING_FAR.c.goal] = Math.cos((i * Math.PI) / 2 - toGoal);
    return answer("choice", t, ask(RING_FAR, t));
  }
  apply(e: number, tick: number, _rung: number, pick: number): void {
    const ents = this.b.lab.world.ents, a = (pick * Math.PI) / 2;
    this.mind.goTo(e, ents.x[e]! + Math.sin(a) * 8, ents.z[e]! + Math.cos(a) * 8, GOAL_WALK);
    this.legUntil = tick + 4 * TICK_RATE;
  }
}

/** Asks once, ten ticks in, and sends the mover on to its goal when the leg is done. */
const installer: Installer = (b, name) => {
  if (name !== "test.four") return null;
  const d = b.lab.host.decide, p = new Four(b), id = d.add(p);
  let ticks = 0;
  return { id, before: (tick) => {
    if (ticks++ === 10) d.put(id, b.mover, 2);
    if (p.legUntil > 0 && tick >= p.legUntil) {
      p.legUntil = 0;
      b.lab.host.creatures.mind.goTo(b.mover, b.goal.x, b.goal.z, GOAL_WALK);
    }
  } };
};

const scene: Scene = { family: "trees", map: "flat", seed: 4, kind: "core:raptor", start: { x: 100, z: 128, yaw: 0 }, goal: { x: 120, z: 128 }, horizon: 30 * TICK_RATE, pieces: [], standers: [] };
const rp = gameReplayer("test.four", { policy: "rule", models: [], extra: installer });

test("a replay forced to a heading walks that way, and the world matches at the decision", () => {
  const answers = rp.survey(scene);
  expect(answers.length).toBe(1);
  expect(answers[0]!.pick).toBe(EAST);
  for (const c of [0, EAST, 2, WEST]) expect(rp.replay(scene, 0, c, 1)!.hash).toBe(answers[0]!.hash);
  // Played by hand, forced west: a second after the decision it is west of where it stood.
  const b = build(scene), ents = b.lab.world.ents;
  let x0 = NaN, at = -1;
  play(b, { point: "test.four", policy: "rule", extra: installer, answered: (_n, tick) => ((x0 = ents.x[b.mover]!), (at = tick), WEST), stop: (tick) => at >= 0 && tick - at >= TICK_RATE });
  expect(x0 - ents.x[b.mover]!).toBeGreaterThan(1);
  b.lab.host.shutdown();
});

test("labels prefer the heading toward the goal and come out the same bytes twice", () => {
  const key = { seed: scene.seed, family: scene.family, map: scene.map };
  const a = labelScene(rp, scene, key, { kind: "choice", seeds: 3, today: true }), b = labelScene(rp, scene, key, { kind: "choice", seeds: 3, today: true });
  expect([a.thrown, a.runs > 4]).toEqual([0, true]);
  const d = a.decision!;
  const cost = meanCosts(d, 2);
  expect(Array.from(targetOf(d, 2))[EAST]).toBe(1);
  expect(cost[EAST]!).toBeLessThan(cost[WEST]! - 2 * TICK_RATE);
  // Without a reseed in the movement code each seed would play alike, so one is run and counted.
  const w = build(scene), reseeds = "reseed" in w.lab.host.creatures.mind;
  w.lab.host.shutdown();
  expect(a.noReseed).toBe(reseeds ? 0 : a.runs - 1);
  expect(encode(a.decision!, emptyManifest("test.four", "choice"), PROFILES)).toEqual(encode(b.decision!, emptyManifest("test.four", "choice"), PROFILES));
});
