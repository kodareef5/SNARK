import { expect, test } from "bun:test";
import { creaturePose, rayCreature } from "../../shared/anim/creature.ts";
import { ZONE_ARM_L, ZONE_ARM_R, ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_NONE, ZONE_TORSO } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { RIG_CLIPS, buildRigs } from "../../shared/anim/rigs.ts";
import { boneToModel, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { lodIndices, lodVertices, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = corePack();
const rigs = buildRigs(pack.header.rigs, pack.clips);
const reg = coreRegistry();

test("the pack carries each creature as a rig that is a whole skeleton, one mesh on it with every vertex on one bone, and its clips", () => {
  expect([...rigs.keys()]).toEqual(["core:parasaur", "core:raptor"]);
  for (const [id, rig] of rigs) {
    const raw = pack.header.rigs.find((r) => r.id === id)!;
    expect([raw.skeleton, rig.bones, rig.names[0], rig.parent[0]]).toEqual(["dino", 28, "Body", -1]);
    for (let b = 1; b < rig.bones; b++) {
      expect(rig.parent[b]!).toBeGreaterThanOrEqual(0);
      expect(rig.parent[b]!).toBeLessThan(b);
    }
    expect(rig.names.some((n) => /_end$|^root$/.test(n))).toBe(false);
    // A hind foot is parented to its lower leg. In the source model it hung on a root that never moved.
    for (const side of ["L", "R"]) {
      const foot = rig.names.indexOf(`BackFoot.${side}`);
      expect(rig.names[rig.parent[foot]!]).toBe(`BackLowLeg.${side}`);
    }
    // Its left is at +X and it faces +Z.
    const at = (name: string): number[] => Array.from(rig.rest.subarray(rig.names.indexOf(name) * 3, rig.names.indexOf(name) * 3 + 3));
    expect(at("Head")[2]!).toBeGreaterThan(at("Tail5")[2]! + 1);
    expect(at("BackFoot.L")[0]!).toBeGreaterThan(0);
    expect(at("BackFoot.R")[0]!).toBeLessThan(0);
    expect(Math.abs(at("BackFoot.L")[1]!)).toBeLessThan(0.1);
    // Nine capsules: a head, a neck, a body, two of tail and four legs.
    const zones = Array.from(rig.zone).filter((z) => z !== 0).sort((a, b) => a - b);
    expect(zones).toEqual([ZONE_HEAD, ZONE_TORSO, ZONE_TORSO, ZONE_TORSO, ZONE_TORSO, ZONE_ARM_L, ZONE_ARM_R, ZONE_LEG_L, ZONE_LEG_R].sort((a, b) => a - b));
    for (let b = 0; b < rig.bones; b++) if (rig.zone[b] !== 0) expect(rig.capR[b]!).toBeGreaterThan(0.03);
    expect([...rig.sockets.keys()].sort()).toEqual(["mouth", "seat"]);
    for (const name of RIG_CLIPS) expect([name, rig[name]?.bones, rig[name]!.frames > 10]).toEqual([name, 28, true]);
    expect([rig.idle!.loop, rig.walk!.loop, rig.run!.loop, rig.attack!.loop, rig.death!.loop]).toEqual([true, true, true, false, false]);

    const mesh = pack.header.meshes[pack.meshIndex.get(id)!]!;
    expect([mesh.skeleton, pack.header.rigs[mesh.rig!]!.id]).toEqual(["dino", id]);
    const verts = lodVertices(pack, mesh.lods[0]!);
    for (let v = 0; v < mesh.lods[0]!.vertexCount; v++) expect(verts[v * VERTEX_BYTES + 7]!).toBeLessThan(rig.bones);
    const triangles = lodIndices(pack, mesh.lods[0]!).length / 6;
    expect(triangles).toBeGreaterThan(1000);
    expect(triangles).toBeLessThan(2000);
  }
  const long = (id: string): number => {
    const m = pack.header.meshes[pack.meshIndex.get(id)!]!;
    return m.half[2] * 2;
  };
  expect(long("core:parasaur")).toBeGreaterThan(7);
  expect(long("core:parasaur")).toBeLessThan(8.5);
  expect(long("core:raptor")).toBeGreaterThan(3.3);
  expect(long("core:raptor")).toBeLessThan(4.2);
  for (const id of rigs.keys()) expect(reg.defs[reg.index.get(id)!]).toMatchObject({ type: "species", class: "creature", mesh: id, skeleton: "dino" });
});

test("a creature stands, walks, runs and strikes on its clips: its feet stay by the ground and its head stays ahead of it", () => {
  const st = new AnimState();
  for (const rig of rigs.values()) {
    const scale = rig.mid;
    const footL = rig.names.indexOf("BackFoot.L");
    const footR = rig.names.indexOf("BackFoot.R");
    const head = rig.names.indexOf("Head");
    for (const [speed, strike] of [[0, false], [3, false], [13, false], [0, true]] as const) {
      let low = Infinity;
      let high = -Infinity;
      let apart = 0;
      for (let tick = 200; tick < 320; tick += 1.5) {
        st.speed = speed;
        st.seed = 11;
        st.setAction(strike ? ACT_SWING : ACT_NONE, HOLD_HANDS, 205);
        creaturePose(rig, st, tick, 4, rig.a);
        solve(rig, rig.a, rig.solved);
        const pos = rig.solved.pos;
        for (let k = 0; k < pos.length; k++) expect(Number.isFinite(pos[k]!)).toBe(true);
        const lower = Math.min(pos[footL * 3 + 1]!, pos[footR * 3 + 1]!);
        if (lower < low) low = lower;
        if (lower > high) high = lower;
        apart = Math.max(apart, Math.abs(pos[footL * 3 + 2]! - pos[footR * 3 + 2]!));
        expect(pos[head * 3 + 2]!).toBeGreaterThan(pos[2]!);
        expect(pos[head * 3 + 1]!).toBeGreaterThan(scale * 0.5);
      }
      const where = `${rig.id} speed ${speed} strike ${strike}`;
      expect(low, where).toBeGreaterThan(-0.25 * scale);
      expect(high, where).toBeLessThan(0.45 * scale);
      if (speed > 0) expect(apart, where).toBeGreaterThan(0.3 * scale);
    }
    // Below walking speed the pose is a blend of standing and walking.
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    st.speed = 1;
    creaturePose(rig, st, 50, 4, rig.a);
    const blended = rig.a.rot.slice();
    st.speed = 0;
    creaturePose(rig, st, 50, 4, rig.a);
    const still = rig.a.rot.slice();
    st.speed = 3;
    creaturePose(rig, st, 50, 4, rig.a);
    let between = 0;
    for (let k = 0; k < blended.length; k++) if (Math.abs(blended[k]! - still[k]!) > 1e-4 && Math.abs(blended[k]! - rig.a.rot[k]!) > 1e-4) between++;
    expect(between).toBeGreaterThan(10);
  }
});

test("a creature is hit where it is: its head from in front, its body from the side, a leg low down, and nothing where it is not", () => {
  const st = new AnimState();
  st.setAction(ACT_NONE, HOLD_HANDS, 0);
  for (const rig of rigs.values()) {
    creaturePose(rig, st, 0, 4, rig.a);
    solve(rig, rig.a, rig.solved);
    const out = [0, 0, 0];
    const head = rig.names.indexOf("Head");
    const body = rig.names.indexOf("Body");
    // The middle of a bone's capsule, in model space.
    const middle = (b: number): number[] => {
      boneToModel(rig.solved, b, (rig.capA[b * 3]! + rig.capB[b * 3]!) / 2, (rig.capA[b * 3 + 1]! + rig.capB[b * 3 + 1]!) / 2, (rig.capA[b * 3 + 2]! + rig.capB[b * 3 + 2]!) / 2, out);
      return [...out];
    };
    const h = middle(head);
    const m = middle(body);
    const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw = 0, bx = 0, bz = 0): number => rayCreature(rig, st, 0, 4, bx, 0, bz, yaw, ox, oy, oz, dx, dy, dz, 80);
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1)).toBe(ZONE_HEAD);
    expect(zoneHit.t).toBeLessThan(40 - h[2]!);
    expect(ray(-30, m[1]!, m[2]!, 1, 0, 0)).toBe(ZONE_TORSO);
    expect(ray(0, 40, m[2]!, 0, -1, 0)).toBe(ZONE_TORSO);
    const foot = rig.names.indexOf("BackUpLeg.L");
    const leg = middle(foot);
    expect(ray(30, leg[1]!, leg[2]!, -1, 0, 0)).toBe(ZONE_LEG_L);
    expect(ray(-30, leg[1]!, leg[2]!, 1, 0, 0)).toBe(ZONE_LEG_R);
    expect(ray(-30, rig.mid * 4, 0, 1, 0, 0)).toBe(ZONE_NONE);
    expect(ray(-30, h[1]!, h[2]! + rig.mid * 2, 1, 0, 0)).toBe(ZONE_NONE);
    // Turned a quarter and moved, it is hit by the same ray turned and moved with it, and not by the old ray.
    expect(ray(100 + 40, h[1]!, 50 - h[0]!, -1, 0, 0, 16384, 100, 50)).toBe(ZONE_HEAD);
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1, 16384, 100, 50)).toBe(ZONE_NONE);
  }
});
