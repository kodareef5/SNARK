// Face rows: a survivor whose head is drawn at its finest level takes five bone rows past its thirty, and only those
// survivors draw a made head (client/core/render/faces.ts), which reads them. No body reads past its bone block.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FACE_SLOTS } from "../../client/core/render/faces.ts";
import { MAX_BONES, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { HUMAN_BONES, SLOT_HEAD } from "../../shared/anim/human.ts";
import { FACE_COUNT, LOOK_BYTES, defaultLook, setFace } from "../../shared/anim/look.ts";
import { FACE_ROWS } from "../../shared/people/faces.ts";
import { Rng } from "../../shared/rng.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const ID = 500;

/** A crowd of `count` survivors from 2.5 m, each its own face, on `tier`, drawn `frames` times. */
function crowd(tier: string, count: number, frames = 12, net = false) {
  const view = net ? provingView(320, 180, {}) : provingView(320, 180);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 1080;
  if (scene.assets.tier.lit) asTextured(scene);
  [cam.yaw, cam.pitch] = [Math.PI, -0.04];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  const kind = reg.index.get("core:survivor")!;
  const rng = new Rng(9);
  remote.count = count;
  for (let n = 0; n < count; n++) {
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [ID + n, kind, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x + ((n % 5) - 2) * 0.9, cam.z - 2.5 - n * 0.2];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    const look = defaultLook();
    for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, rng.range(-0.6, 0.6));
    remote.look.set(look, n * LOOK_BYTES);
  }
  scene.own = null;
  let p = scene.build(cam, remote);
  // Then on until the faces have nothing left to read or make, a share a frame.
  for (let f = 0; f < frames || (!scene.characters.faces.idle && f < 4000); f++) p = scene.build(cam, remote);
  return { p, view };
}

/** A transient instance's first bone. */
const firstBone = (p: { transient: Uint8Array }, i: number): number => p.transient[i * 20 + 12]! | (p.transient[i * 20 + 13]! << 8);

test("survivors with a finest head take face rows and draw made heads", () => {
  for (const [tier, n] of [["medium", 8], ["high", 8]] as const) {
    const { p, view } = crowd(tier, n + 4);
    const ch = view.scene.characters;
    expect(ch.faced).toBe(n);
    expect(ch.faces.count).toBeGreaterThan(0);
    // Each body's block: from its first bone to the next body's.
    const firsts = new Set<number>();
    const madeIds = new Set<number>();
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawBuffer[d] !== TRANSIENT_BUFFER) continue;
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
        firsts.add(firstBone(p, i));
        if (p.drawSlot[d]! >= FACE_SLOTS && p.drawSlot[d]! < FACE_SLOTS + 4096) madeIds.add(p.transientIds[i]!);
      }
    }
    expect(madeIds.size).toBe(n);
    const sorted = [...firsts].sort((a, b) => a - b);
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawBuffer[d] !== TRANSIENT_BUFFER || !(p.drawSlot[d]! >= FACE_SLOTS && p.drawSlot[d]! < FACE_SLOTS + 4096)) continue;
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
        const first = firstBone(p, i), next = sorted.find((f) => f > first) ?? p.boneCount;
        expect(next - first).toBeGreaterThanOrEqual(HUMAN_BONES + FACE_ROWS);
      }
    }
  }
});

test("a body past its finest level takes thirty bones and draws the pack's head", () => {
  const { p, view } = crowd("medium", 12);
  const head = view.scene.assets.table.find("core:human_m/head");
  let packHeads = 0;
  for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === head && p.drawSlot[d]! < FACE_SLOTS) packHeads += p.drawInstances[d]!;
  expect(packHeads).toBeGreaterThan(0);
  expect(p.boneCount).toBeLessThanOrEqual(12 * HUMAN_BONES + view.scene.characters.faced * FACE_ROWS + 64);
});

test("2,048 bodies with the most face rows any tier allows fit in 65,536 bones", () => {
  const most = Math.max(...(["lowpoly", "medium", "high", "ultra"] as const).map((t) => tierOf(t).finestBodies[SLOT_HEAD]!));
  // The viewer's own body may be one more.
  expect(2048 * HUMAN_BONES + (most + 1) * FACE_ROWS).toBeLessThan(MAX_BONES);
});

test("a made head the card refuses is let go and the card's ledger stays a number", () => {
  const { p, view } = crowd("high", 8);
  const { scene, cam, remote } = view, r = scene.assets.residency;
  let slot = -1;
  for (let d = 0; d < p.drawCount && slot < 0; d++) if (p.drawSlot[d]! >= FACE_SLOTS && p.drawSlot[d]! < FACE_SLOTS + 4096) slot = p.drawSlot[d]!;
  expect(slot).toBeGreaterThan(0);
  const before = r.ledger;
  scene.refused(slot);
  scene.refused(slot + 1);
  let q = p;
  for (let f = 0; f < 5; f++) q = scene.build(cam, remote);
  // Made heads are not the ledger's, so a refusal takes nothing from it; the pack's own parts may still be streaming in.
  expect(r.ledger).toBeGreaterThanOrEqual(before);
  for (let d = 0; d < q.drawCount; d++) expect(q.drawSlot[d] === slot).toBe(false);
});

test("after a made mesh is refused the card's budget still lets go of what is least lately drawn", () => {
  // Over a port, which the budget evicts to.
  const { view } = crowd("high", 8, 0, true);
  const { scene, cam, remote } = view, r = scene.assets.residency;
  const step = (): void => {
    scene.now += 1000 / 60;
    view.port?.advance(scene.now);
    scene.build(cam, remote);
  };
  for (let f = 0; f < 120; f++) step();
  scene.refused(FACE_SLOTS);
  scene.refused(FACE_SLOTS + 1);
  for (let f = 0; f < 5; f++) step();
  expect(Number.isFinite(r.ledger)).toBe(true);
  const evicted = r.stats.evicted;
  scene.assets.tier = { ...scene.assets.tier, gpuBytes: r.ledger * 0.25 };
  for (let f = 0; f < 5; f++) step();
  expect(r.stats.evicted).toBeGreaterThan(evicted);
});
