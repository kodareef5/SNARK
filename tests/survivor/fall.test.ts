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
    h.pilots[0]!.moveZ = 127;
    h.pilots[0]!.yaw = Math.PI;
    let lay = 0, low = Infinity, rose: number[] = [];
    h.run(5000, () => {
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
