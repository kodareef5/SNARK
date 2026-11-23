// A survivor reels from a blow (server/reactions.ts): a car at walking pace or a heavy blow staggers them, every client
// draws the same reaction the server judges shots against, and a shove the survivor brought on itself never staggers.
import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { B_CHEST, B_HEAD, HUMAN } from "../../shared/anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { packReact, react, reactAge, reactDir, reactFrames, reactHeight, reactKind, reactStart, reactStrength, REACT_CHEST, REACT_HEAD, REACT_HEAVY, REACT_STAGGER } from "../../shared/anim/reactions.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { rayBody } from "../../shared/anim/zones.ts";
import { REACT_RULES, TIER_BUMP, TIER_FALL, TIER_NONE, TIER_STAGGER, deltaV, dirOf, tierOf } from "../../shared/sim/react.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

test("a reaction word keeps its class, start, way, height and strength", () => {
  const w = packReact(REACT_HEAVY, 300, 13, REACT_HEAD, 2);
  expect([reactKind(w), reactStart(w), reactDir(w), reactHeight(w), reactStrength(w)]).toEqual([REACT_HEAVY, 300 & 255, 13, REACT_HEAD, 2]);
  expect(reactAge(w, 302.5)).toBe(2.5);
  // The start's low byte wraps, and the age with it.
  expect(reactAge(packReact(REACT_STAGGER, 255, 0, 0, 0), 257)).toBe(2);
});

test("a push is counted in sixteenths toward the body's left", () => {
  // Facing +Z: pushed along +Z is straight ahead, along +X its left, along -X its right.
  expect([dirOf(0, 0, 1), dirOf(0, 1, 0), dirOf(0, 0, -1), dirOf(0, -1, 0)]).toEqual([0, 4, 8, 12]);
  // Facing +X a quarter turn on: pushed along +X is ahead.
  expect(dirOf(16384, 1, 0)).toBe(0);
});

test("only a blow someone dealt staggers or fells; one the body brought on itself is a bump", () => {
  expect(tierOf(0.5, true)).toBe(TIER_NONE);
  expect(tierOf(1.5, true)).toBe(TIER_BUMP);
  expect(tierOf(3, true)).toBe(TIER_STAGGER);
  expect(tierOf(7, true)).toBe(TIER_FALL);
  // A sprint into a wall: all of the sprint, but its own.
  expect(tierOf(deltaV(7.2, 80, Infinity), false)).toBe(TIER_BUMP);
  // A rifle round's push is nothing.
  expect(tierOf(deltaV(900, 80, 0.01), true, REACT_RULES)).toBe(TIER_NONE);
});

test("a staggered pose turns the chest and head, then settles to the plain pose", () => {
  const anim = new HumanAnim(NO_CLIPS), st = new AnimState(), plain = new Pose(HUMAN.bones), hit = new Pose(HUMAN.bones);
  humanPose(anim, st, 100, plain);
  st.react = packReact(REACT_STAGGER, 100, 8, REACT_CHEST, 3);
  const turned = (a: Pose, b: Pose, bone: number) => {
    const dot = Math.abs(a.rot[bone * 4]! * b.rot[bone * 4]! + a.rot[bone * 4 + 1]! * b.rot[bone * 4 + 1]! + a.rot[bone * 4 + 2]! * b.rot[bone * 4 + 2]! + a.rot[bone * 4 + 3]! * b.rot[bone * 4 + 3]!);
    return 2 * Math.acos(Math.min(1, dot));
  };
  let peak = 0;
  for (let t = 100; t < 100 + reactFrames(st.react); t += 0.5) {
    humanPose(anim, st, t, hit);
    peak = Math.max(peak, turned(plain, hit, B_CHEST), turned(plain, hit, B_HEAD));
  }
  expect(peak).toBeGreaterThan(0.12);
  humanPose(anim, st, 100 + reactFrames(st.react), hit);
  expect(turned(plain, hit, B_CHEST)).toBe(0);
  expect(turned(plain, hit, B_HEAD)).toBe(0);
});

test("a shot is judged against the reeling pose that is drawn", () => {
  const anim = new HumanAnim(NO_CLIPS), st = new AnimState(), pose = new Pose(HUMAN.bones), solved = new Solved(HUMAN.bones);
  st.react = packReact(REACT_HEAVY, 0, 8, REACT_HEAD, 3);
  // The head as a client draws it at tick 5, pushed back by a blow to the face.
  humanPose(anim, st, 5, pose);
  solve(HUMAN, pose, solved);
  const head = new Float64Array(3), plainHead = new Float64Array(3);
  boneToModel(solved, B_HEAD, 0, 0.1, 0, head);
  const still = new AnimState(), stillPose = new Pose(HUMAN.bones), stillSolved = new Solved(HUMAN.bones);
  humanPose(anim, still, 5, stillPose);
  solve(HUMAN, stillPose, stillSolved);
  boneToModel(stillSolved, B_HEAD, 0, 0.1, 0, plainHead);
  const moved = Math.hypot(head[0]! - plainHead[0]!, head[2]! - plainHead[2]!);
  expect(moved).toBeGreaterThan(0.05);
  // A ray across the drawn head, from the side, hits the head on the server too.
  const fire = (at: Float64Array, s: AnimState) => rayBody(anim, s, 5, 0, 0, 0, 0, -2, at[1]!, at[2]!, 1, 0, 0, 4);
  expect(fire(head, st)).toBe(ZONE_HEAD);
  expect(react).toBeDefined();
});

/** A walker standing in the road and a watcher by it, with a car and its driver some way back. */
function road() {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  h.host.setSetting("Knockdowns", "true");
  const s = h.join("walker", { latencyMs: 75 }), w = h.join("watcher");
  h.run(600);
  const a = h.world.ents, c = h.client(s)!, seen = h.client(w)!;
  const car = h.host.spawnVehicle("core:compact", 100, 60, 0);
  const driver = h.host.spawnCreature("core:civilian", 101.5, 60, 1);
  // Driven by one of the watcher's tribe, so it may shove the walker.
  const team = h.host.records.byPid.get(a.pid[seen.ent]!)!.team;
  h.host.records.byPid.get(a.pid[driver]!)!.team = team;
  a.setTeam(driver, team);
  expect(h.host.urban.seatNpc(driver, car, "driver")).toBe(0);
  h.run(1500);
  a.setPosition(c.ent, 100, 0, 72);
  h.world.history.discontinuity(c.ent);
  a.setPosition(seen.ent, 96, 0, 76);
  h.world.history.discontinuity(seen.ent);
  h.run(1000);
  return { h, s, w, a, c, car };
}

test("a car at a walking pace staggers a survivor, who keeps their feet and their client keeps up", () => {
  const { h, s, w, a, c, car } = road();
  try {
    const remote = new RemoteSample();
    let word = 0, drawn = 0, ownSaw = 0, hit = false;
    const before = s.stats.corrections;
    h.run(4000, () => {
      // Rolls at walking pace until it touches them, then stops.
      if (!hit) { a.vz[car] = 4; a.vx[car] = 0; }
      if (a.react[c.ent] !== 0 && word === 0) { word = a.react[c.ent]!; hit = true; a.vz[car] = 0; }
      if (s.own.react !== 0) ownSaw = s.own.react;
      w.sampleRemote(remote);
      for (let i = 0; i < remote.count; i++) if (remote.id[i] === c.ent && remote.react[i] !== 0) drawn = remote.react[i]!;
    });
    expect(word).not.toBe(0);
    expect([REACT_STAGGER, REACT_HEAVY]).toContain(reactKind(word));
    expect(h.host.falls.stats.fell).toBe(0);
    // Every machine has the server's word: the watcher draws it, the walker's own client predicted it.
    expect(drawn).toBe(word);
    expect(ownSaw).toBe(word);
    // Over by now, on the server and in prediction alike.
    expect([a.react[c.ent], s.own.react]).toEqual([0, 0]);
    // Told of the shove once; the rest was stepped alike on both sides.
    expect(s.stats.corrections - before).toBeLessThanOrEqual(2);
  } finally { h.host.shutdown(); }
});

test("a second heavy blow while still reeling knocks the survivor down, and a calm one only bumps", () => {
  const { h, c } = road();
  try {
    const r = h.host.reactions;
    // A heavy blow from the front, at the chest.
    expect(r.shove(c.ent, 4, 0, -1, 1.3, true)).toBe(TIER_STAGGER);
    h.run(200);
    expect(r.shove(c.ent, 4, 0, -1, 1.3, true)).toBe(TIER_FALL);
    // Once it has ended, the body is calm for a while: another blow is only a bump.
    const { h: h2, c: c2 } = road();
    try {
      const r2 = h2.host.reactions;
      expect(r2.shove(c2.ent, 4, 0, -1, 1.3, true)).toBe(TIER_STAGGER);
      h2.run(1500);
      expect(r2.shove(c2.ent, 4, 0, -1, 1.3, true)).toBe(TIER_BUMP);
    } finally { h2.host.shutdown(); }
  } finally { h.host.shutdown(); }
});
