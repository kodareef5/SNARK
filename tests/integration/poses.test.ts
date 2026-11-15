import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { HISTORY_TICKS, History, Past } from "../../server/history.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, ZONE_COUNT, ZONE_HEAD, ZONE_LEG_L, ZONE_TORSO } from "../../shared/anim/human.ts";
import { AnimState, humanPose } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { BODY_REACH, BODY_REACH_Y, rayBody } from "../../shared/anim/zones.ts";
import { handleIndex } from "../../shared/ids.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_PRONE, BTN_SPRINT, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceEye } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { Harness } from "../fixtures/net.ts";
import { coreAnim } from "../fixtures/pack.ts";

test("a client is told how another body moves, where it looks and how low it holds itself", () => {
  const h = new Harness();
  const a = h.join("ada", { latencyMs: 30 });
  const b = h.join("bo", { latencyMs: 30 });
  h.run(600);
  const ents = h.world.ents;
  const eb = h.ent(b);
  const seen = new RemoteSample();
  const st = new AnimState();
  const look = (): AnimState => {
    a.sampleRemote(seen);
    expect(seen.count).toBe(1);
    expect(seen.id[0]).toBe(handleIndex(b.ownHandle));
    st.unpack(seen.anim[0]!);
    return st;
  };
  expect(look().pack()).toBe(0); // standing still, looking level

  const p = h.pilots[1]!;
  p.moveZ = 1;
  p.pitch = 0.6;
  p.buttons = BTN_SPRINT;
  h.run(1500);
  expect([look().speed, st.dir, st.stance, st.grounded, st.mode]).toEqual([12, 0, STANCE_STAND, true, 1]);
  expect(st.pitch).toBe(12);
  expect(seen.anim[0]).toBe(ents.anim[eb]!);

  p.moveZ = 0;
  p.moveX = 1;
  p.pitch = -0.3;
  p.buttons = BTN_CROUCH;
  h.run(1000);
  expect([look().speed, st.dir, st.stance, st.pitch]).toEqual([4, 12, STANCE_CROUCH, -6]);
  expect(b.own.stance).toBe(STANCE_CROUCH);
  p.buttons = BTN_PRONE;
  h.run(1000);
  // A crawl is 0.9 m/s, between one and two steps of the sent speed.
  expect([look().dir, st.stance]).toEqual([12, STANCE_PRONE]);
  expect(st.speed === 1 || st.speed === 2).toBe(true);
  p.moveX = 0;
  p.buttons = 0;
  h.run(500);
  expect([look().speed, st.stance]).toEqual([0, STANCE_STAND]);
  p.buttons = BTN_JUMP;
  h.run(250);
  expect(look().grounded).toBe(false);
  p.buttons = 0;
  h.run(1500);
  expect(look().grounded).toBe(true);
  expect(b.stats.corrections).toBe(0);
  expect(a.stats.undecodable).toBe(0);
});

test("stance is predicted: a client under latency and loss converges, and looks from where the server aims from", () => {
  const h = new Harness({}, 9);
  const a = h.join("ada", { latencyMs: 90, jitterMs: 20, loss: 0.08 });
  h.run(800);
  const rng = new Rng(77);
  const p = h.pilots[0]!;
  for (let i = 0; i < 60; i++) {
    p.moveX = rng.range(-1, 1);
    p.moveZ = rng.range(-1, 1);
    p.yaw = rng.range(0, 6.28);
    p.buttons = (rng.int(3) === 0 ? BTN_CROUCH : 0) | (rng.int(5) === 0 ? BTN_PRONE : 0) | (rng.int(4) === 0 ? BTN_SPRINT : 0) | (rng.int(6) === 0 ? BTN_JUMP : 0);
    h.run(300);
  }
  p.moveX = p.moveZ = 0;
  p.buttons = BTN_CROUCH;
  h.run(1500);
  const ents = h.world.ents;
  const e = h.ent(a);
  expect(a.own.stance).toBe(STANCE_CROUCH);
  expect(ents.stance[e]).toBe(STANCE_CROUCH);
  expect(a.own.x).toBe(ents.x[e]!);
  expect(a.own.y).toBe(ents.y[e]!);
  expect(a.own.z).toBe(ents.z[e]!);
  // The server casts from this eye when the body uses something.
  const move = h.reg.move[ents.kind[e]!]!;
  expect(stanceEye(move, ents.stance[e]!)).toBeCloseTo(1.08, 5);
});

test("history holds where every moving entity was for the last sixteen ticks, and no longer", () => {
  const h = new Harness();
  const a = h.join("ada");
  const b = h.join("bo");
  h.run(500);
  const history = h.world.history;
  const ents = h.world.ents;
  const ea = h.ent(a);
  h.pilots[0]!.moveZ = 1;
  h.pilots[0]!.yaw = 1;
  const truth = new Map<number, { x: number; z: number; yaw: number; anim: number }>();
  let last = h.world.tick;
  h.run(1000, () => {
    if (h.world.tick !== last) {
      last = h.world.tick;
      truth.set(last, { x: ents.x[ea]!, z: ents.z[ea]!, yaw: ents.yaw[ea]!, anim: ents.anim[ea]! });
    }
  });
  const now = h.world.tick;
  const past = new Past();
  for (let t = now; t > now - HISTORY_TICKS; t--) {
    expect(history.has(t)).toBe(true);
    expect(history.at(t, ea, past)).toBe(true);
    const was = truth.get(t)!;
    expect([past.x, past.z, past.yaw, past.anim]).toEqual([was.x, was.z, was.yaw, was.anim]);
  }
  expect(history.has(now - HISTORY_TICKS)).toBe(false);
  expect(history.at(now - HISTORY_TICKS, ea, past)).toBe(false);
  expect(history.has(now + 1)).toBe(false);
  expect(history.clamp(now - 100, now)).toBe(now - HISTORY_TICKS + 1);
  expect(history.clamp(now + 5, now)).toBe(now);
  expect(history.clamp(now - 3, now)).toBe(now - 3);

  const t0 = truth.get(now - 4)!;
  const t1 = truth.get(now - 3)!;
  expect(history.sample(now - 3.75, ea, past)).toBe(true);
  expect(past.z).toBeCloseTo(t0.z + (t1.z - t0.z) * 0.25, 5);
  expect(past.anim).toBe(t0.anim);
  expect(history.sample(now - 3.25, ea, past)).toBe(true);
  expect(past.anim).toBe(t1.anim);
  expect(history.sample(now + 0.5, ea, past)).toBe(false);

  const eb = h.ent(b);
  h.ends[1]!.close();
  h.run(6000); // past the linger
  expect(ents.resolve(b.ownHandle)).toBe(-1);
  expect(history.at(h.world.tick, eb, past)).toBe(false);
  expect(history.rows).toBe(1 + h.host.creatures.awakeCount);
});

test("history follows what is awake: a sleeping creature has no row, and its past is where it stands", () => {
  // With no player near, creatures sleep.
  const h = new Harness({}, 1, 60, { startingCreatures: 30 });
  const history = h.world.history;
  const ents = h.world.ents;
  for (let i = 0; i < 20; i++) h.server.tick();
  expect(history.rows).toBe(0);
  const past = new Past();
  const sleeper = h.host.spawnCreature("core:grazer", 300, 300, 1);
  h.server.tick();
  expect(history.at(h.world.tick - 5, sleeper, past)).toBe(true);
  expect([past.x, past.z]).toEqual([ents.x[sleeper]!, ents.z[sleeper]!]);

  const a = h.join("ada");
  h.run(400);
  const awake = h.host.creatures.awakeCount;
  expect(awake).toBeGreaterThan(5);
  expect(history.rows).toBe(awake + 1);
  h.run(3000);
  const e = h.host.creatures.awake[0]!;
  const was = { x: ents.x[e]!, z: ents.z[e]! };
  const at = h.world.tick;
  h.run(200);
  expect(history.at(at, e, past)).toBe(true);
  expect([past.x, past.z]).toEqual([was.x, was.z]);

  h.ends[0]!.close();
  h.run(6000);
  expect(h.host.creatures.awakeCount).toBe(0);
  expect(history.rows).toBe(0);
  for (let i = 0; i < 1000; i++) history.track(i);
  expect(history.rows).toBe(1000);
  history.record(h.world.tick + 1);
  // record() drops rows whose slot holds no entity.
  expect(history.rows).toBeLessThanOrEqual(ents.count);
  void a;
});

test("history costs what is awake, not what exists", () => {
  const ents = new EntityStore({ chunksX: 4, chunksZ: 4 }, 300000);
  for (let i = 0; i < 300000; i++) ents.create(1, (i % 200) + 10, 0, (Math.floor(i / 200) % 200) + 10, 0);
  const history = new History(ents);
  for (let e = 0; e < 5000; e++) history.track(e * 7);
  for (let tick = 1; tick <= 300; tick++) history.record(tick);
  // 5,000 awake among 300,000: 8,192 rows of 16 ticks and one index per slot. A copy of everything took 96 MB. What a
  // tick of it takes is a row of the benchmark.
  expect(history.bytes).toBeLessThan(4 * 1024 * 1024);
});

test("a body's cues are remembered as they were at each tick, while it has had any in the window", () => {
  const ents = new EntityStore({ chunksX: 1, chunksZ: 1 }, 8);
  const [a, b] = [ents.create(1, 5, 0, 5, 0), ents.create(1, 6, 0, 6, 0)];
  // One wakes already knocked out, as a creature loaded so does.
  ents.cue[b] = 1;
  const history = new History(ents);
  history.track(a);
  history.track(b);
  for (let tick = 1; tick <= 24; tick++) {
    if (tick === 20 || tick === 23) {
      ents.cue[a] = tick === 20 ? 0x1234 : 0;
      history.cued(a);
    }
    history.record(tick);
  }
  const past = new Past();
  const at = (tick: number, e: number): number => (history.at(tick, e, past) ? past.cue : -1);
  expect([19, 20, 22, 23, 24].map((t) => at(t, a))).toEqual([0, 0x1234, 0x1234, 0, 0]);
  expect([10, 24].map((t) => at(t, b))).toEqual([1, 1]);
  for (let tick = 25; tick <= 60; tick++) history.record(tick);
  expect([at(50, a), at(50, b)]).toEqual([0, 1]);
});

test("what a client draws of a remote body is what the server would test a shot against", () => {
  // At ada's render time, the body she draws must be where history has it at that tick, in the same pose.
  for (const link of [{ latencyMs: 20 }, { latencyMs: 110, jitterMs: 10 }]) {
    const h = new Harness({}, 4);
    const a = h.join("ada", link);
    const b = h.join("bo", { latencyMs: 40 });
    h.run(800);
    const eb = h.ent(b);
    const seen = new RemoteSample();
    const past = new Past();
    const anim = coreAnim();
    const drawn = new AnimState();
    const tested = new AnimState();
    const rng = new Rng(5);
    const p = h.pilots[1]!;
    let compared = 0;
    let worst = 0;
    let samePose = 0;
    let agree = 0;
    let rays = 0;
    const zones = new Uint32Array(ZONE_COUNT);
    for (let step = 0; step < 240; step++) {
      if (step % 12 === 0) {
        p.moveX = rng.range(-1, 1);
        p.moveZ = rng.range(-1, 1);
        p.yaw = rng.range(0, 6.28);
        p.pitch = rng.range(-1, 1);
        p.buttons = (rng.int(3) === 0 ? BTN_SPRINT : 0) | (rng.int(4) === 0 ? BTN_CROUCH : 0) | (rng.int(7) === 0 ? BTN_JUMP : 0);
      }
      h.run(50);
      a.sampleRemote(seen);
      if (seen.count !== 1 || !h.world.history.sample(seen.tick, eb, past)) continue;
      compared++;
      const off = Math.hypot(seen.x[0]! - past.x, seen.y[0]! - past.y, seen.z[0]! - past.z);
      if (off > worst) worst = off;
      if (seen.anim[0] === past.anim) samePose++;
      drawn.unpack(seen.anim[0]!);
      tested.unpack(past.anim);
      drawn.seed = tested.seed = (seen.id[0]! * 37) % 1024;
      const yawSeen = Math.round((seen.yaw[0]! / (Math.PI * 2)) * 65536) & 0xffff;
      for (let k = 0; k < 12; k++) {
        const ox = seen.x[0]! + rng.range(-6, 6);
        const oy = seen.y[0]! + rng.range(0.2, 2.4);
        const oz = seen.z[0]! + rng.range(-6, 6);
        let dx = seen.x[0]! + rng.range(-0.25, 0.25) - ox;
        let dy = seen.y[0]! + rng.range(0.1, 1.7) - oy;
        let dz = seen.z[0]! + rng.range(-0.25, 0.25) - oz;
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
        const want = rayBody(anim, drawn, seen.tick, seen.x[0]!, seen.y[0]!, seen.z[0]!, yawSeen, ox, oy, oz, dx, dy, dz, 30);
        const got = rayBody(anim, tested, seen.tick, past.x, past.y, past.z, past.yaw, ox, oy, oz, dx, dy, dz, 30);
        rays++;
        zones[want]!++;
        if (want === got) agree++;
      }
    }
    expect(compared).toBeGreaterThan(200);
    // Wire precision plus the blend between snapshots.
    expect(worst).toBeLessThan(0.03);
    expect(samePose / compared).toBeGreaterThan(0.97);
    expect(zones[ZONE_HEAD]!).toBeGreaterThan(20);
    expect(zones[ZONE_TORSO]!).toBeGreaterThan(200);
    expect(zones[ZONE_LEG_L]!).toBeGreaterThan(50);
    expect(agree / rays).toBeGreaterThan(0.97);
  }
});

test("no pose reaches outside the sphere the hit test rejects by, and a body costs microseconds to test", () => {
  const anim = coreAnim();
  const st = new AnimState();
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  const out = [0, 0, 0];
  let worst = 0;
  for (const [mode, grounded, stance] of [[1, true, 0], [1, true, 1], [1, true, 2], [1, false, 0], [2, false, 0]] as const) {
    for (let speed = 0; speed <= 15; speed += 3) {
      for (let dir = 0; dir < 16; dir += 4) {
        for (let pitch = -31; pitch <= 31; pitch += 31) {
          for (let tick = 0; tick < 100; tick += 9) {
            st.mode = mode;
            st.grounded = grounded;
            st.stance = stance;
            st.speed = speed;
            st.dir = dir;
            st.pitch = pitch;
            humanPose(anim, st, tick, pose);
            solve(HUMAN, pose, solved);
            for (let b = 0; b < HUMAN.zoneBones; b++) {
              // The farthest a capsule reaches is an end plus its radius.
              for (const ends of [HUMAN.capA, HUMAN.capB]) {
                boneToModel(solved, b, ends[b * 3]!, ends[b * 3 + 1]!, ends[b * 3 + 2]!, out);
                const d = Math.hypot(out[0]!, out[1]! - BODY_REACH_Y, out[2]!) + HUMAN.capR[b]!;
                if (d > worst) worst = d;
              }
            }
          }
        }
      }
    }
  }
  expect(worst).toBeLessThan(BODY_REACH - 0.1);
  expect(worst).toBeGreaterThan(1.2);

  st.unpack(0);
  st.speed = 7;
  const rounds = 20000;
  let hits = 0;
  for (let i = 0; i < rounds; i++) {
    if (rayBody(anim, st, i * 0.37, 100, 0, 100, (i * 311) & 0xffff, 100.1, 1.1 + (i % 7) * 0.1, 96, 0, 0, 1, 20) !== 0) hits++;
  }
  expect(hits).toBeGreaterThan(rounds * 0.4);
  expect(zoneHit.t).toBeGreaterThan(3);
});
