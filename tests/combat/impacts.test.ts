// Where a blow lands, every client near is told (EVENT_IMPACT, server/combat.ts): the body, the bone of it struck, the way
// the blow went and how hard, and its draw snaps back from it and settles (client/core/render/impact-springs.ts).
import { expect, test } from "bun:test";
import { ImpactSprings } from "../../client/core/render/impact-springs.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { IMPACT_MELEE } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a punch on a dummy tells the puncher and a bystander which bone it struck, the way it went and how hard", () => {
  const h = new Harness({}, 3, 60, { dev: true, wild: false, map: writeMap(flatMap(4)) });
  try {
    const ada = h.join("ada"), bo = h.join("bo");
    h.run(800);
    const ents = h.world.ents, a = h.client(ada)!.ent, b = h.client(bo)!.ent;
    ents.setPosition(a, 100, 0, 100);
    ents.setPosition(b, 104, 0, 100);
    h.world.history.discontinuity(a);
    h.world.history.discontinuity(b);
    const e = h.host.spawnCreature("core:dummy", 100, 101.2, 1);
    ents.yaw[e] = h.host.records.byPid.get(ents.pid[e]!)!.yaw = 32768;
    const pilot = h.pilots[0]!;
    pilot.yaw = 0;
    pilot.pitch = Math.atan2(1.25 - 1.62, 1.2);
    h.run(600);
    bo.impacts.length = ada.impacts.length = 0;
    const hits = h.host.combat.hits;
    pilot.buttons = BTN_PRIMARY;
    h.run(300);
    pilot.buttons = 0;
    h.run(800);
    expect(h.host.combat.hits).toBe(hits + 1);
    expect(ada.strike?.node).toBe(0);
    expect(bo.strike).toBeNull();
    for (const who of [ada, bo]) {
      const seen = who.impacts.filter((im) => im.id === e);
      expect(seen.length).toBe(1);
      const im = seen[0]!;
      // A bone of its chest, struck going north, level, by a blow of some strength.
      expect(im.bone).toBeGreaterThanOrEqual(0);
      expect(im.bone).toBeLessThan(HUMAN.bones);
      expect(im.dz).toBeGreaterThan(0.9);
      expect(im.strength).toBeGreaterThan(0);
      expect(im.kind).toBe(IMPACT_MELEE);
    }
  } finally { h.host.shutdown(); }
});

test("a body struck turns away from the blow at once, a heavy one less, and settles back within half a second", () => {
  const springs = new ImpactSprings();
  const pose = new Pose(HUMAN.bones), solved = new Solved(HUMAN.bones);
  const angleOf = (rot: Float32Array, b: number): number => 2 * Math.acos(Math.min(1, Math.abs(rot[b * 4 + 3]!)));
  // A chest bone: the third from the root is in the spine.
  const chest = 3;
  springs.hit(1, HUMAN, 0, chest, 0, 0, 1, 1, 80);
  springs.hit(2, HUMAN, 0, chest, 0, 0, 1, 1, 8000);
  let most = [0, 0];
  for (let t = 0; t < 6; t++) {
    springs.step(TICK_DT);
    for (const [k, id] of [[0, 1], [1, 2]] as const) {
      pose.rot.fill(0);
      for (let b = 0; b < HUMAN.bones; b++) pose.rot[b * 4 + 3] = 1;
      springs.apply(id, HUMAN, pose, solved);
      most[k] = Math.max(most[k]!, angleOf(pose.rot, chest));
    }
  }
  // A survivor's chest snaps back some tens of degrees; a rex's barely.
  expect(most[0]).toBeGreaterThan(0.15);
  expect(most[1]).toBeLessThan(most[0]! * 0.2);
  expect(springs.active(1)).toBe(true);
  for (let t = 0; t < 15; t++) springs.step(TICK_DT);
  expect(springs.active(1)).toBe(false);
  expect(springs.active(2)).toBe(false);
  solve(HUMAN, pose, solved);
});
