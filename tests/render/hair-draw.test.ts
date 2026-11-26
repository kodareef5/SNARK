// Hair as the scene draws it (client/core/render/characters.ts): each style at the stage it has grown to, its form under
// a hat under open headgear and none under sealed, long hair near the eye on guide rows with its hair made to read them,
// and the bones that costs.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FACE_SLOTS } from "../../client/core/render/faces.ts";
import { HAIR_ROWS } from "../../client/core/render/hair-motion.ts";
import { MAX_BONES, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { HUMAN_BONES, SLOT_HEAD } from "../../shared/anim/human.ts";
import { HAIR_STYLES, LOOK_BYTES, LOOK_HAIR, LOOK_HAIR_LENGTH, LOOK_SEX, defaultLook } from "../../shared/anim/look.ts";
import { FACE_ROWS } from "../../shared/people/faces.ts";
import { HAIR_RATE_MOST, HAIR_STAGES, HAIR_TICK } from "../../shared/people/hair.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView, type ProvingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const ID = 700;
const style = (id: string): number => HAIR_STYLES.findIndex((s) => s.id === id);

/** `count` survivors in rows from 2.5 m on `tier`, each in `look` (its index given) and wearing `hat` on its head, drawn `frames` times. */
function crowd(tier: string, count: number, look: (n: number) => Uint8Array, hat = "", frames = 12, spacing = 0.9): { view: ProvingView; p: ReturnType<ProvingView["scene"]["build"]> } {
  const view = provingView(320, 180);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 1080;
  if (scene.assets.tier.lit) asTextured(scene);
  [cam.yaw, cam.pitch] = [Math.PI, -0.04];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  const kind = reg.index.get("core:survivor")!, worn = hat ? reg.index.get(hat)! : 0;
  remote.count = count;
  for (let n = 0; n < count; n++) {
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [ID + n, kind, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x + ((n % 16) - 7.5) * spacing, cam.z - 2.5 - Math.floor(n / 16) * spacing];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(look(n), n * LOOK_BYTES);
    remote.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    remote.gear[n * GEAR_COUNT + GEAR_WORN + SLOT_HEAD] = worn;
  }
  scene.own = null;
  let p = scene.build(cam, remote);
  for (let f = 0; f < frames; f++) p = scene.build(cam, remote);
  return { view, p };
}

const styled = (id: string, length = 0, sex = 0) => (): Uint8Array => {
  const look = defaultLook();
  look[LOOK_SEX] = sex;
  look[LOOK_HAIR] = style(id);
  look[LOOK_HAIR_LENGTH] = length;
  return look;
};

/** The meshes drawn, by id, and how many instances each. */
function drawn(view: ProvingView, p: ReturnType<ProvingView["scene"]["build"]>): Map<string, number> {
  const out = new Map<string, number>(), meshes = view.scene.assets.manifest.meshes;
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER) continue;
    const id = meshes[p.drawMesh[d]!]!.id;
    out.set(id, (out.get(id) ?? 0) + p.drawInstances[d]!);
  }
  return out;
}

const hairDrawn = (m: Map<string, number>): string[] => [...m.keys()].filter((id) => id.includes("/hair/")).sort();

test("hair is drawn at the stage it has grown to", () => {
  HAIR_STAGES.forEach((length, stage) => {
    const { view, p } = crowd("medium", 2, styled("parted", length));
    expect(hairDrawn(drawn(view, p))).toEqual([stage === 0 ? "core:human_m/hair/parted" : `core:human_m/hair/parted/stage-${stage}`]);
  });
  // Between stages, the last one reached.
  const { view, p } = crowd("medium", 2, styled("parted", HAIR_STAGES[1]! + 10));
  expect(hairDrawn(drawn(view, p))).toEqual(["core:human_m/hair/parted/stage-1"]);
});

test("hair is drawn as long as its clock has grown it by the tick drawn", () => {
  const { view } = crowd("medium", 1, styled("parted"));
  const { scene, cam, remote } = view;
  const at = (tick: number): string[] => {
    remote.tick = tick;
    remote.hairFrom[0] = 0;
    remote.hairRate = HAIR_RATE_MOST;
    let p = scene.build(cam, remote);
    for (let f = 0; f < 3; f++) p = scene.build(cam, remote);
    return hairDrawn(drawn(view, p));
  };
  expect(at(0)).toEqual(["core:human_m/hair/parted"]);
  // The fastest rate grows 25 a clock step: the second stage in eight steps.
  expect(at(8 * HAIR_TICK)).toEqual(["core:human_m/hair/parted/stage-2"]);
});

test("open headgear draws the style's form under a hat, sealed headgear none", () => {
  const hat = crowd("medium", 2, styled("long", HAIR_STAGES[2]!), "core:cloth_hat");
  expect(hairDrawn(drawn(hat.view, hat.p))).toEqual(["core:human_m/hair/long/under-hat"]);
  const sealed = crowd("medium", 2, styled("long"), "core:meridian_hat");
  expect(hairDrawn(drawn(sealed.view, sealed.p))).toEqual([]);
});

test("long hair near the eye takes guide rows and draws hair made to read them", () => {
  const { view, p } = crowd("high", 12, styled("long", 0, 1), "", 40);
  const ch = view.scene.characters;
  expect(ch.faced).toBe(8);
  expect(ch.groomed).toBe(8);
  const meshes = view.scene.assets.manifest.meshes, firstBone = (i: number): number => p.transient[i * 20 + 12]! | (p.transient[i * 20 + 13]! << 8);
  const firsts = new Set<number>(), made = new Set<number>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) firsts.add(firstBone(i));
  }
  const sorted = [...firsts].sort((a, b) => a - b);
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || !meshes[p.drawMesh[d]!]!.id.includes("/hair/") || !(p.drawSlot[d]! >= FACE_SLOTS && p.drawSlot[d]! < FACE_SLOTS + 4096)) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      made.add(p.transientIds[i]!);
      const first = firstBone(i), next = sorted.find((f) => f > first) ?? p.boneCount;
      // No made hair reads past its body's block.
      expect(next - first).toBeGreaterThanOrEqual(HUMAN_BONES + FACE_ROWS + HAIR_ROWS);
    }
  }
  expect(made.size).toBe(8);
  // A buzz cut takes no guide rows.
  const buzz = crowd("high", 12, styled("buzzed"), "", 40);
  expect(buzz.view.scene.characters.groomed).toBe(0);
  expect(buzz.p.boneCount).toBeLessThan(p.boneCount);
});

test("the 512-body frame on medium leaves no more bodies on one bone with long hair", () => {
  const counts = ["buzzed", "long"].map((s) => {
    const { view, p } = crowd("medium", 512, styled(s), "", 3, 0.6);
    return { posed: view.scene.characters.posed, dropped: p.dropped, bones: p.boneCount };
  });
  expect(counts[1]!.posed).toBe(counts[0]!.posed);
  expect(counts[1]!.dropped).toBe(counts[0]!.dropped);
  expect(counts[1]!.bones).toBeLessThanOrEqual(Math.min(tierOf("medium").bones, MAX_BONES));
});

test("bodies on a shared pose leave face and hair rows for the nearest two", () => {
  const { view } = crowd("high", 5, styled("long", 0, 1), "", 40, 0.15);
  const { scene, cam, remote } = view;
  const bones = 2 * (HUMAN_BONES + FACE_ROWS + HAIR_ROWS) + HUMAN_BONES + 3;
  scene.assets.tier = { ...scene.assets.tier, bones };
  const p = scene.build(cam, remote);
  expect([scene.characters.posed, scene.characters.groomed, p.boneCount, p.dropped]).toEqual([2, 2, bones, 0]);
  const posed = new Set<number>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawSlot[d]! < FACE_SLOTS || p.drawSlot[d]! >= FACE_SLOTS + 4096) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) posed.add(p.transientIds[i]!);
  }
  expect([...posed].sort()).toEqual([ID + 3, ID + 4]);
});

test("2,048 bodies with the most face and hair rows any tier allows fit in 65,536 bones", () => {
  const most = Math.max(...(["lowpoly", "medium", "high", "ultra"] as const).map((t) => tierOf(t).finestBodies[SLOT_HEAD]!));
  // The viewer's own body may be one more.
  expect(2048 * HUMAN_BONES + (most + 1) * (FACE_ROWS + HAIR_ROWS)).toBeLessThan(MAX_BONES);
});
