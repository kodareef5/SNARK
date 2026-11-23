import { expect, test } from "bun:test";
import { CUE_DOWN } from "../../shared/anim/pose.ts";
import { HUMAN_RAGDOLL } from "../../shared/anim/human.ts";
import { rayBody } from "../../shared/anim/zones.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

function scene() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 20, 20);
  h.host.survival.gods.add(h.client(ada)!.pid);
  h.say(ada, `tp ${(g.x + 10).toFixed(3)} ${(g.z + 10).toFixed(3)}`, 300);
  return { h, ada, e: h.ent(ada), g };
}

test("a knocked survivor lies where its ragdoll goes, deaf to its keys, and gets up", () => {
  const { h, e } = scene();
  try {
    const ents = h.world.ents, x = ents.x[e]!, z = ents.z[e]!;
    expect(h.host.falls.knock(e, 0, 1, 4, 3, 0, 0)).toBe(true);
    expect([h.host.falls.count, h.host.falls.moving]).toEqual([1, 1]);
    h.pilots[0]!.moveZ = 127;
    h.pilots[0]!.yaw = Math.PI;
    let lay = 0, low = Infinity, rose: number[] = [];
    h.run(5000, () => {
      expect(h.host.falls.moving).toBeLessThanOrEqual(h.host.falls.count);
      if (h.host.falls.isDown(e)) lay++;
      else if (lay > 0 && rose.length === 0) rose = [ents.x[e]!, ents.z[e]!];
      low = Math.min(low, ents.y[e]! - h.world.hf.heightAt(ents.x[e]!, ents.z[e]!));
    });
    // Thrown toward +Z, it went that way and not where its keys asked; it lay its while, low down, then stood.
    expect(rose[1]! - z).toBeGreaterThan(0.5);
    expect(Math.abs(rose[0]! - x)).toBeLessThan(1);
    expect(lay >= 36 && lay <= 120 * 2).toBe(true);
    expect(low).toBeLessThan(0.4);
    expect([h.host.falls.isDown(e), (ents.cue[e]! & CUE_DOWN) !== 0, h.host.falls.stats.rose]).toEqual([false, false, 1]);
  } finally {
    h.host.shutdown();
  }
});

test("a survivor lying down is hit where it lies, not where it stood", () => {
  const { h, e } = scene();
  try {
    const ents = h.world.ents;
    h.host.falls.knock(e, 0, 0, 0.5, 0, 0, 0);
    h.run(1000);
    const pose = h.host.falls.poseOf(e)!, st = new AnimState();
    const [x, y, z, yaw] = [ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.yaw[e]!];
    const ray = (oy: number) => rayBody(h.world.anim, st, h.world.tick, x, y, z, yaw, x, oy, z - 5, 0, 0, 1, 10, 0, false, pose);
    // Along the ground through the hips it meets the body; at chest height where it stood there is nothing.
    expect(ray(y + 0.05)).not.toBe(ZONE_NONE);
    expect(ray(y + 1.3)).toBe(ZONE_NONE);
    expect(HUMAN_RAGDOLL.bone.length).toBe(11);
  } finally {
    h.host.shutdown();
  }
});

test("a survivor who dies leaves a body that falls limp where it stood, carrying nothing", () => {
  const { h, ada, e } = scene();
  try {
    const ents = h.world.ents, [x, z] = [ents.x[e]!, ents.z[e]!], bodies = h.host.corpses.count;
    h.host.survival.gods.delete(h.client(ada)!.pid);
    h.say(ada, "suicide");
    h.run(3000);
    expect(h.host.corpses.count).toBe(bodies + 1);
    let body = -1;
    for (let j = 0; j < ents.flags.length; j++) if (h.host.corpses.at(j) && ents.kind[j] === h.reg.index.get("core:survivor")) body = j;
    expect(body).toBeGreaterThanOrEqual(0);
    // It lies near where it stood, low to the ground, its ragdoll at rest.
    expect(Math.hypot(ents.x[body]! - x, ents.z[body]! - z)).toBeLessThan(1.5);
    expect(ents.y[body]! - h.world.hf.heightAt(ents.x[body]!, ents.z[body]!)).toBeLessThan(0.4);
    expect(h.host.corpses.falling).toBe(0);
  } finally {
    h.host.shutdown();
  }
});

test("a shot judged in the past meets the body as it lay then", () => {
  const { h, e } = scene();
  try {
    h.host.falls.knock(e, 0, 1, 4, 3, 0, 0);
    h.run(200);
    const then = h.world.tick, was = h.host.falls.poseOf(e)!.pos.slice();
    h.run(5 * 1000 / 60);
    // It has moved on since, but the pose kept for that tick is the one it had.
    expect(h.host.falls.poseOf(e)!.pos).not.toEqual(was);
    expect(h.host.falls.poseAt(e, then)!.pos).toEqual(was);
  } finally {
    h.host.shutdown();
  }
});

test("a shot judged in a fall is judged the same once the survivor is knocked down again", () => {
  const { h, e } = scene();
  try {
    h.host.falls.knock(e, 0, 1, 4, 3, 0, 0);
    // Lying until it gets up: the last tick it lay, and a ray through its head then.
    let then = -1;
    for (let t = 0; t < 120 && h.host.falls.isDown(e); t++) h.run(50, () => { if (h.host.falls.isDown(e)) then = h.world.tick; });
    expect(h.host.falls.isDown(e)).toBe(false);
    const ents = h.world.ents, head = h.host.falls.poseAt(e, then)!.pos.slice(), st = new AnimState(), at = ents.x[e]!, z = ents.z[e]!;
    const shot = () => {
      const pose = h.host.falls.poseAt(e, then)!, hx = pose.pos[3 * 2]!, hy = pose.pos[3 * 2 + 1]!, hz = pose.pos[3 * 2 + 2]!;
      st.cue = CUE_DOWN;
      return [pose.pos.slice(), rayBody(h.world.anim!, st, then, at, ents.y[e]!, z, 0, at + hx, ents.y[e]! + hy + 2, z + hz, 0, -1, 0, 4, 0, false, pose)] as const;
    };
    const [before, zone] = shot();
    expect(before).toEqual(head);
    expect(zone).not.toBe(ZONE_NONE);
    // Down again a moment later: the fall before still answers for the ticks it lay.
    expect(h.host.falls.knock(e, 0, 1, -4, -3, 0, 0)).toBe(true);
    h.run(100);
    expect(h.host.falls.isDown(e)).toBe(true);
    const [after, again] = shot();
    expect(after).toEqual(head);
    expect(again).toBe(zone);
  } finally {
    h.host.shutdown();
  }
});

test("a survivor who dies knocked down goes on lying as it fell, never standing up", () => {
  const { h, ada, e } = scene();
  try {
    const ents = h.world.ents;
    h.host.falls.knock(e, 0, 1, 4, 3, 0, 0);
    h.run(600);
    h.host.survival.gods.delete(h.client(ada)!.pid);
    h.say(ada, "suicide");
    // From the knock to its body's rest the hips never rise as a standing body's would, some 0.9 m up.
    let high = 0, body = -1;
    h.run(3000, () => {
      body = -1;
      for (let j = 0; j < ents.flags.length; j++) if (h.host.corpses.at(j) && ents.kind[j] === ents.kind[e]) body = j;
      if (body >= 0) high = Math.max(high, ents.y[body]! - h.world.hf.heightAt(ents.x[body]!, ents.z[body]!));
    });
    expect(body).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(0.5);
  } finally {
    h.host.shutdown();
  }
});
