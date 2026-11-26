// Which survivors draw a slot at its finest level: the nearest few on each tier, by its finestBodies, and the viewer always.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_SKINNED, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import type { OwnBody } from "../../client/core/render/scene.ts";
import { SLOT_COUNT, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { LOOK_BYTES, defaultLook } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const ID = 500;
const OWN = 7;

/** A crowd of `count` survivors from 2.5 m, 0.2 m apart in depth, on `tier`; its levels by id and slot after `frames`. */
function crowd(tier: string, count: number, opts: { own?: boolean; order?: (n: number) => number; frames?: number; view?: ReturnType<typeof provingView> } = {}) {
  const view = opts.view ?? provingView(320, 180);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 1080;
  if (scene.assets.tier.lit) asTextured(scene);
  [cam.yaw, cam.pitch] = [Math.PI, -0.04];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  const kind = reg.index.get("core:survivor")!;
  remote.count = count;
  for (let n = 0; n < count; n++) {
    const d = 2.5 + (opts.order ? opts.order(n) : n) * 0.2;
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [ID + n, kind, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x + ((n % 5) - 2) * 0.9, cam.z - d];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(defaultLook(), n * LOOK_BYTES);
  }
  if (opts.own) {
    const own: OwnBody = { kind, x: cam.x + 1, y: hf.heightAt(cam.x + 1, cam.z - 1.5), z: cam.z - 1.5, yaw: Math.PI, state: new AnimState(), tick: 0, firstPerson: false, colors: new Uint8Array(6), look: defaultLook(), gear: new Uint16Array(6), id: OWN };
    scene.own = own;
  } else scene.own = null;
  let p = scene.build(cam, remote);
  for (let f = 0; f < (opts.frames ?? 4); f++) p = scene.build(cam, remote);
  const { table } = scene.assets;
  const slotOf = new Map<number, number>();
  for (const sex of ["m", "f"]) SLOT_NAMES.forEach((name, s) => slotOf.set(table.find(`core:human_${sex}/${name}`), s));
  const levels = new Map<number, number[]>();
  for (let d = 0; d < p.drawCount; d++) {
    const slot = slotOf.get(p.drawMesh[d]!);
    if (slot === undefined || p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const id = p.transientIds[i]!;
      const row = levels.get(id) ?? Array<number>(SLOT_COUNT).fill(-1);
      row[slot] = p.drawLod[d]!;
      levels.set(id, row);
    }
  }
  // The ids nearest the camera first.
  const nearest = Array.from({ length: count }, (_, n) => n).sort((a, b) => Math.hypot(remote.x[a]! - cam.x, remote.y[a]! - cam.y, remote.z[a]! - cam.z) - Math.hypot(remote.x[b]! - cam.x, remote.y[b]! - cam.y, remote.z[b]! - cam.z)).map((n) => ID + n);
  return { levels, view, nearest };
}

/** The ids of the bodies with slot `slot` at level 0. */
const finest = (levels: Map<number, number[]>, slot: number): number[] => [...levels].filter(([, row]) => row[slot] === 0).map(([id]) => id).sort((a, b) => a - b);

test("each lit tier draws every slot at its finest for its nearest survivors alone", () => {
  for (const [tier, n] of [["medium", 8], ["high", 8], ["ultra", 16]] as const) {
    expect(tierOf(tier).finestBodies).toEqual([n, n, n, n, n]);
    const { levels, nearest } = crowd(tier, n + 3);
    const near = nearest.slice(0, n).sort((a, b) => a - b);
    for (let s = 0; s < SLOT_COUNT; s++) expect(finest(levels, s)).toEqual(near);
    for (const id of nearest.slice(n)) expect(Math.min(...levels.get(id)!)).toBe(1);
  }
});

test("a head goes to its next level nearer than its body, by its own error", () => {
  // 6 m off on medium the body is still at its finest, its head not.
  const { levels } = crowd("medium", 1, { order: () => 17.5 });
  expect(levels.get(ID)).toEqual([1, 0, 0, 0, 0]);
});

test("low poly is untouched: no survivor finer than its first flat level", () => {
  const { levels, view } = crowd("lowpoly", 12);
  const flat = view.scene.assets.table.flat[view.scene.assets.table.find("core:human_m/torso")]!;
  for (const row of levels.values()) expect(Math.min(...row)).toBeGreaterThanOrEqual(flat);
});

test("the viewer's own body is never held back, and takes none of the places", () => {
  const { levels } = crowd("medium", 12, { own: true });
  expect(levels.get(OWN)).toEqual([0, 0, 0, 0, 0]);
  expect(finest(levels, SLOT_HEAD).filter((id) => id !== OWN)).toHaveLength(8);
});

test("a body keeps its place among the nearest until another is clearly nearer", () => {
  // The ninth comes a little nearer than the eighth: not enough to take its place.
  const first = crowd("medium", 9);
  expect(finest(first.levels, SLOT_HEAD)).not.toContain(ID + 8);
  const { levels } = crowd("medium", 9, { view: first.view, order: (n) => (n === 8 ? 6 : n) });
  expect(finest(levels, SLOT_HEAD)).toContain(ID + 7);
  expect(finest(levels, SLOT_HEAD)).not.toContain(ID + 8);
  // Much nearer, it does.
  const swapped = crowd("medium", 9, { view: first.view, order: (n) => (n === 8 ? 0.5 : n) });
  expect(finest(swapped.levels, SLOT_HEAD)).toContain(ID + 8);
});
