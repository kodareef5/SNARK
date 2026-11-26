// Hide masks on survivors (characters.ts `skinHidden`): a body leaves the skin zones its mask names undrawn, by drawing
// only its level's other runs of indices (PackLod.zones), still instanced with every body of the same mesh, level and mask.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_RANGED, DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_THUMB_L, B_THUMB_R } from "../../shared/anim/human.ts";
import { HAIR_STYLES, LOOK_BEARD, LOOK_BYTES, LOOK_HAIR, LOOK_SEX, LOOK_SKIN, defaultLook } from "../../shared/anim/look.ts";
import { SKIN_FOREARM_L, SKIN_FOREARM_R, SKIN_HAND_L, SKIN_HAND_R } from "../../shared/anim/skin-zones.ts";
import { hashBytes } from "../../shared/hash.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { PICK_ENTITY } from "../../tools/snap/raster.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const ARMS = (1 << SKIN_FOREARM_L) | (1 << SKIN_FOREARM_R) | (1 << SKIN_HAND_L) | (1 << SKIN_HAND_R);
const FIRST_ID = 1000;
/** Two bodies in each four, a man and a woman, take the mask. */
const masked = (id: number): boolean => ((id - FIRST_ID) & 2) === 0;

/** Forty survivors at 8 to 25 m ahead of the camera, men and women by turns, on `tier`, drawn with materials where it is lit. */
function crowd(tier: string, hide: ((id: number) => number) | null, width = 320, height = 180): ProvingView {
  const view = provingView(width, height);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 1080;
  if (scene.assets.tier.lit) asTextured(scene);
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.04, (70 * Math.PI) / 180, 16 / 9];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = 0;
  for (let k = 0; k < 40; k++) {
    const n = remote.count++;
    const d = 8 + (17 * k) / 39, a = ((k * 7) % 40) / 40 - 0.5;
    const look = defaultLook();
    [look[LOOK_SEX], look[LOOK_HAIR], look[LOOK_BEARD], look[LOOK_SKIN]] = [k % 2, k % HAIR_STYLES.length, k % 4 === 0 ? 1 : 0, k % 10];
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n]] = [FIRST_ID + k, reg.index.get("core:survivor")!, 1, 0, 1];
    [remote.x[n], remote.z[n], remote.yaw[n]] = [cam.x + Math.sin(Math.PI + a) * d, cam.z + Math.cos(Math.PI + a) * d, a];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(look, n * LOOK_BYTES);
  }
  scene.characters.skinHidden = hide;
  return view;
}

function settled(view: ProvingView): FramePacket {
  let p = view.scene.build(view.cam, view.remote);
  for (let f = 0; f < 6; f++) p = view.scene.build(view.cam, view.remote);
  return p;
}

const bodyDraws = (p: FramePacket): number[] => [...Array(p.drawCount).keys()].filter((d) => p.drawBuffer[d] === TRANSIENT_BUFFER && (p.drawFlags[d]! & DRAW_SKINNED) !== 0);

/** The bodies' draws and their instances, hashed. */
function bodyHash(p: FramePacket): number {
  let h = 0;
  const add = (a: ArrayBufferView & { BYTES_PER_ELEMENT: number }, d: number): void => void (h = hashBytes(new Uint8Array(a.buffer, a.byteOffset + d * a.BYTES_PER_ELEMENT, a.BYTES_PER_ELEMENT), h));
  for (const d of bodyDraws(p)) {
    for (const a of [p.drawMesh, p.drawLod, p.drawFlags, p.drawInstances, p.drawFirst, p.drawJoined]) add(a, d);
    if ((p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0) for (const a of [p.drawFirstIndex, p.drawIndexCount, p.drawMaterial]) add(a, d);
  }
  return hashBytes(p.transient.subarray(0, p.transientCount * 20), h);
}

for (const tier of ["lowpoly", "medium"]) {
  test(`on ${tier}, a mask of zones no level holds draws what no mask draws`, () => {
    const bare = bodyHash(settled(crowd(tier, null)));
    expect(bodyHash(settled(crowd(tier, () => 0)))).toBe(bare);
    expect(bodyHash(settled(crowd(tier, () => 1 << 30)))).toBe(bare);
  });

  test(`on ${tier}, hiding forearms and hands of 20 of 40 bodies adds one call a mesh and level`, () => {
    const view = crowd(tier, (id) => (masked(id) ? ARMS : 0));
    const p = settled(view), bare = settled(crowd(tier, null));
    const { zones, tris } = view.scene.assets.table;
    const ids = (q: FramePacket, d: number): number[] => Array.from(q.transientIds.subarray(q.drawFirst[d]!, q.drawFirst[d]! + q.drawInstances[d]!));
    /** Rows and calls (rows not joined to the one before) of each mesh and level, and the bodies' triangles. */
    const tally = (q: FramePacket) => {
      const rows = new Map<string, [number, number]>();
      let triangles = 0;
      for (const d of bodyDraws(q)) {
        const key = `${q.drawMesh[d]}:${q.drawLod[d]}`, [r, c] = rows.get(key) ?? [0, 0];
        rows.set(key, [r + 1, c + (q.drawJoined[d] === 1 ? 0 : 1)]);
        triangles += ((q.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? q.drawIndexCount[d]! / 3 : tris[q.drawMesh[d]!]![q.drawLod[d]!]!) * q.drawInstances[d]!;
      }
      return { rows, triangles };
    };
    const [after, before] = [tally(p), tally(bare)];
    let hidden = 0;
    for (const d of bodyDraws(bare)) {
      const runs = zones[bare.drawMesh[d]!]![bare.drawLod[d]!]!;
      if (runs.length === 0) continue;
      const from = (bare.drawFlags[d]! & DRAW_TEXTURED) !== 0 ? bare.drawFirstIndex[d]! : 0;
      const to = (bare.drawFlags[d]! & DRAW_TEXTURED) !== 0 ? from + bare.drawIndexCount[d]! : runs.at(-2)! + runs.at(-1)!;
      let gone = 0;
      for (let z = 0; z < runs.length; z += 3) if (((ARMS >>> runs[z]!) & 1) !== 0) gone += Math.max(0, Math.min(to, runs[z + 1]! + runs[z + 2]!) - Math.max(from, runs[z + 1]!)) / 3;
      hidden += gone * ids(bare, d).filter(masked).length;
    }
    expect(hidden).toBeGreaterThan(0);
    // The triangles left out are those of the hidden zones of the masked bodies' levels, and no others.
    expect(before.triangles - after.triangles).toBe(hidden);
    for (const [key, [rows, calls]] of after.rows) {
      const [r, c] = before.rows.get(key) ?? [0, 0];
      expect(calls - c, key).toBeLessThanOrEqual(1);
      expect(rows - r, key).toBeLessThanOrEqual(2);
    }
    // A draw of a level that holds a hidden zone holds masked bodies alone or none, and a masked one touches no index of it.
    for (const d of bodyDraws(p)) {
      const runs = zones[p.drawMesh[d]!]![p.drawLod[d]!]!;
      let holds = false;
      for (let z = 0; z < runs.length; z += 3) holds ||= ((ARMS >>> runs[z]!) & 1) !== 0;
      if (!holds) continue;
      const who = ids(p, d).map(masked);
      expect(new Set(who).size).toBe(1);
      if (!who[0]) continue;
      const ranged = (p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
      expect(ranged).toBe(true);
      if (tier === "lowpoly") expect(p.drawFlags[d]! & DRAW_RANGED).toBe(DRAW_RANGED);
      const [from, to] = [p.drawFirstIndex[d]!, p.drawFirstIndex[d]! + p.drawIndexCount[d]!];
      for (let z = 0; z < runs.length; z += 3) if (((ARMS >>> runs[z]!) & 1) !== 0) expect(Math.min(to, runs[z + 1]! + runs[z + 2]!) <= Math.max(from, runs[z + 1]!)).toBe(true);
    }
  });
}

test("the rasterizer draws no hand and few forearm pixels of a body that hides them", () => {
  const HANDS = new Set([B_HAND_L, B_HAND_R, B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_THUMB_L, B_THUMB_R]);
  const FOREARMS = new Set([B_LOWER_ARM_L, B_LOWER_ARM_R]);
  for (const tier of ["lowpoly", "medium"]) {
    const counts = [null, () => ARMS].map((hide) => {
      const view = provingView(240, 320);
      const { scene, cam, remote, reg, hf } = view;
      scene.assets.tier = tierOf(tier);
      [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.3, 0.9, 0.75];
      cam.y = hf.heightAt(cam.x, cam.z) + 1.3;
      remote.count = 1;
      [remote.id[0], remote.kind[0], remote.flags[0], remote.anim[0], remote.hasLook[0], remote.yaw[0]] = [FIRST_ID, reg.index.get("core:survivor")!, 1, 0, 1, 0];
      [remote.x[0], remote.z[0]] = [cam.x, cam.z - 2.2];
      remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
      remote.look.set(defaultLook(), 0);
      scene.characters.skinHidden = hide;
      for (let f = 0; f < 4; f++) view.render();
      const r = view.raster;
      let hands = 0, forearms = 0;
      for (let at = 0; at < r.pickBone.length; at++) {
        if (r.pickKind[at] !== PICK_ENTITY || r.pickBone[at] === 0) continue;
        if (HANDS.has(r.pickBone[at]! - 1)) hands++;
        if (FOREARMS.has(r.pickBone[at]! - 1)) forearms++;
      }
      return [hands, forearms];
    });
    const [[hands, forearms], [handsHidden, forearmsHidden]] = counts as [number[], number[]];
    expect(hands, tier).toBeGreaterThan(50);
    expect(forearms, tier).toBeGreaterThan(50);
    expect(handsHidden, tier).toBe(0);
    // A pixel is told by its triangle's last corner's bone, and some of the upper arm's at the elbow have it on the forearm.
    expect(forearmsHidden, tier).toBeLessThan(forearms / 3);
  }
});
