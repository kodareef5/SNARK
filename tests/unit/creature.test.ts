// Every creature found under assets/source, held to what its asset.ts says of it. A new creature is tested without being named here.
import { expect, test } from "bun:test";
import { CreatureAnim, creaturePose, rayCreature } from "../../shared/anim/creature.ts";
import { ZONE_HEAD, ZONE_NONE } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { boneToModel, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { lodVertices, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import { ZONES } from "../../tools/art/spec.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = corePack();
const rigs = buildRigs(pack.header.rigs, pack.clips);
const reg = coreRegistry();

test("the pack carries each creature as its asset describes it: a rig that is a whole skeleton, one mesh on it with every vertex on one bone, and its clips", () => {
  expect(CREATURE_ASSETS.length).toBeGreaterThan(0);
  expect([...rigs.keys()].sort()).toEqual(CREATURE_ASSETS.map((a) => a.id).sort());
  for (const { id, spec } of CREATURE_ASSETS) {
    const raw = pack.header.rigs.find((r) => r.id === id)!;
    const rig = rigs.get(id)!;
    expect([id, raw.skeleton, rig.names[0], rig.parent[0]]).toEqual([id, spec.skeleton.id, spec.skeleton.root, -1]);
    for (let b = 1; b < rig.bones; b++) {
      expect(rig.parent[b]!).toBeGreaterThanOrEqual(0);
      expect(rig.parent[b]!).toBeLessThan(b);
    }
    // What the asset drops is gone, and what it hangs elsewhere hangs there.
    expect(rig.names.filter((n) => spec.skeleton.drop?.test(n))).toEqual([]);
    for (const [bone, parent] of Object.entries(spec.skeleton.reparent ?? {})) expect([bone, rig.names[rig.parent[rig.names.indexOf(bone)]!]]).toEqual([bone, parent]);
    // It stands on its feet, its left is at +X and it faces +Z.
    const at = (name: string): number[] => Array.from(rig.rest.subarray(rig.names.indexOf(name) * 3, rig.names.indexOf(name) * 3 + 3));
    for (const foot of spec.feet) {
      expect([foot, Math.abs(at(foot)[1]!) < rig.mid * 0.2]).toEqual([foot, true]);
      if (/[._]L$/i.test(foot)) expect(at(foot)[0]!).toBeGreaterThan(0);
      if (/[._]R$/i.test(foot)) expect(at(foot)[0]!).toBeLessThan(0);
    }
    const head = spec.zones.find((z) => z.zone === "head");
    if (head) expect(at(head.on)[2]!).toBeGreaterThan(at(spec.skeleton.root)[2]!);
    // A capsule for each zone the asset lists, a socket for each it names, and each of its clips.
    expect(Array.from(rig.zone).filter((z) => z !== 0).sort()).toEqual(spec.zones.map((z) => ZONES[z.zone]).sort());
    for (const z of spec.zones) expect([z.on, rig.zone[rig.names.indexOf(z.on)], rig.capR[rig.names.indexOf(z.on)]! > 0]).toEqual([z.on, ZONES[z.zone], true]);
    expect([...rig.sockets.keys()].sort()).toEqual(spec.sockets.map((s) => s.name).sort());
    for (const c of spec.clips) {
      const clip = pack.clips.clips[pack.clips.index.get(`${id}/${c.name}`)!]!;
      expect([c.name, clip.bones, clip.loop, clip.frames > 1]).toEqual([c.name, rig.bones, c.loop, true]);
    }

    const mesh = pack.header.meshes[pack.meshIndex.get(id)!]!;
    expect([mesh.skeleton, pack.header.rigs[mesh.rig!]!.id]).toEqual([spec.skeleton.id, id]);
    for (const lod of mesh.lods) {
      const verts = lodVertices(pack, lod);
      for (let v = 0; v < lod.vertexCount; v++) expect(verts[v * VERTEX_BYTES + 7]!).toBeLessThan(rig.bones);
    }
    expect(mesh.lods.length).toBeLessThanOrEqual(spec.budgets.triangles.length);
    mesh.lods.forEach((lod, l) => expect([l, lod.indexCount / 3 <= spec.budgets.triangles[l]!]).toEqual([l, true]));
    // Each coarser level has fewer triangles and lies further from the finest.
    for (let l = 1; l < mesh.lods.length; l++) {
      expect(mesh.lods[l]!.indexCount).toBeLessThan(mesh.lods[l - 1]!.indexCount);
      expect(mesh.lods[l]!.error).toBeGreaterThan(mesh.lods[l - 1]!.error);
    }
  }
  // A species that is drawn on a skeleton of its own has that rig in the pack.
  for (const d of reg.defs) {
    if (d?.type !== "species" || d.class !== "creature" || d.skeleton === undefined) continue;
    expect([d.id, pack.header.rigs.find((r) => r.id === d.mesh)?.skeleton]).toEqual([d.id, d.skeleton]);
  }
});

test("a creature stands, walks, runs and strikes on its clips: its feet stay by the ground and its head stays ahead of it", () => {
  const st = new AnimState();
  for (const { id, spec } of CREATURE_ASSETS) {
    const rig = rigs.get(id)!;
    const a = new CreatureAnim(rig, 4, 0);
    const scale = rig.mid;
    const feet = spec.feet.map((name) => rig.names.indexOf(name));
    const headZone = spec.zones.find((z) => z.zone === "head");
    const head = headZone ? rig.names.indexOf(headZone.on) : -1;
    for (const [speed, strike] of [[0, false], [3, false], [13, false], [0, true]] as const) {
      let low = Infinity;
      let high = -Infinity;
      let apart = 0;
      for (let tick = 200; tick < 320; tick += 1.5) {
        st.speed = speed;
        st.seed = 11;
        st.setAction(strike ? ACT_SWING : ACT_NONE, HOLD_HANDS, 205);
        creaturePose(a, st, tick, rig.a);
        solve(rig, rig.a, rig.solved);
        const pos = rig.solved.pos;
        for (let k = 0; k < pos.length; k++) expect(Number.isFinite(pos[k]!)).toBe(true);
        // The lower of its feet.
        const lower = Math.min(...feet.map((b) => pos[b * 3 + 1]!));
        if (lower < low) low = lower;
        if (lower > high) high = lower;
        if (feet.length > 1) apart = Math.max(apart, Math.abs(pos[feet[0]! * 3 + 2]! - pos[feet[1]! * 3 + 2]!));
        if (head >= 0) {
          expect(pos[head * 3 + 2]!).toBeGreaterThan(pos[2]!);
          expect(pos[head * 3 + 1]!).toBeGreaterThan(scale * 0.5);
        }
      }
      const where = `${id} speed ${speed} strike ${strike}`;
      if (feet.length > 0) {
        expect(low, where).toBeGreaterThan(-0.25 * scale);
        expect(high, where).toBeLessThan(0.45 * scale);
      }
      if (speed > 0 && feet.length > 1 && a.walk) expect(apart, where).toBeGreaterThan(0.3 * scale);
    }
    // Below walking speed the pose is a blend of standing and walking.
    if (!a.idle || !a.walk) continue;
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    st.speed = 1;
    creaturePose(a, st, 50, rig.a);
    const blended = rig.a.rot.slice();
    st.speed = 0;
    creaturePose(a, st, 50, rig.a);
    const still = rig.a.rot.slice();
    st.speed = 3;
    creaturePose(a, st, 50, rig.a);
    let between = 0;
    for (let k = 0; k < blended.length; k++) if (Math.abs(blended[k]! - still[k]!) > 1e-4 && Math.abs(blended[k]! - rig.a.rot[k]!) > 1e-4) between++;
    expect(between, id).toBeGreaterThan(10);
  }
});

test("a creature is hit where it is: its head from in front, every zone from some side, and nothing where it is not", () => {
  const st = new AnimState();
  st.setAction(ACT_NONE, HOLD_HANDS, 0);
  for (const { id, spec } of CREATURE_ASSETS) {
    const rig = rigs.get(id)!;
    const a = new CreatureAnim(rig, 4, 0);
    creaturePose(a, st, 0, rig.a);
    solve(rig, rig.a, rig.solved);
    const out = [0, 0, 0];
    // The middle of a bone's capsule, in model space.
    const middle = (b: number): number[] => {
      boneToModel(rig.solved, b, (rig.capA[b * 3]! + rig.capB[b * 3]!) / 2, (rig.capA[b * 3 + 1]! + rig.capB[b * 3 + 1]!) / 2, (rig.capA[b * 3 + 2]! + rig.capB[b * 3 + 2]!) / 2, out);
      return [...out];
    };
    const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw = 0, bx = 0, bz = 0): number => rayCreature(a, st, 0, bx, 0, bz, yaw, ox, oy, oz, dx, dy, dz, 80);
    // Every zone it has can be hit: a ray along some axis, at the middle of one of the zone's capsules, hits that zone first.
    const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (const zone of new Set(spec.zones.map((z) => z.zone))) {
      const first = spec.zones.filter((z) => z.zone === zone).flatMap((z) => {
        const m = middle(rig.names.indexOf(z.on));
        return sides.filter(([dx, dy, dz]) => ray(m[0]! - dx * 40, m[1]! - dy * 40, m[2]! - dz * 40, dx, dy, dz) === ZONES[zone]);
      });
      expect([id, zone, first.length > 0]).toEqual([id, zone, true]);
    }
    expect(ray(-30, rig.mid * 4, 0, 1, 0, 0)).toBe(ZONE_NONE);
    const headZone = spec.zones.find((z) => z.zone === "head");
    if (!headZone) continue;
    const h = middle(rig.names.indexOf(headZone.on));
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1)).toBe(ZONE_HEAD);
    expect(zoneHit.t).toBeLessThan(40 - h[2]!);
    expect(ray(-30, h[1]!, h[2]! + rig.mid * 2, 1, 0, 0)).toBe(ZONE_NONE);
    // Turned a quarter and moved, it is hit by the same ray turned and moved with it, and not by the old ray.
    expect(ray(100 + 40, h[1]!, 50 - h[0]!, -1, 0, 0, 16384, 100, 50)).toBe(ZONE_HEAD);
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1, 16384, 100, 50)).toBe(ZONE_NONE);
  }
});
