// A worn piece's covers (WearFacet.covers) and a drawn garment's join the body's hide mask (characters.ts `hideOf`), so a
// body in them draws as the same body with those zones hidden by hand.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_RANGED, DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LOOK_BYTES, LOOK_SEX, defaultLook } from "../../shared/anim/look.ts";
import { SKIN_ABDOMEN, SKIN_CHEST, SKIN_FOREARM_L, SKIN_FOREARM_R } from "../../shared/anim/skin-zones.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { GEAR_COUNT, GEAR_WORN, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView } from "../../tools/snap.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { test } from "../fixtures/needs-art.ts";

const FOREARMS = (1 << SKIN_FOREARM_L) | (1 << SKIN_FOREARM_R);
const TOP = (1 << SKIN_CHEST) | (1 << SKIN_ABDOMEN);
const EXTRA: Def[] = [
  { type: "item", class: "armor", id: "test:long_gloves", stack: 1, color: 1, wear: { slot: "hands", armor: 1, uses: 1, set: "cloth", colors: [1, 15, 225], covers: [SKIN_FOREARM_L, SKIN_FOREARM_R] } },
  { type: "item", class: "garment", id: "test:cut_tee", stack: 1, color: 15, garment: { slot: "top", covers: [SKIN_CHEST, SKIN_ABDOMEN], cut: "test:cut_tee" } },
] as Def[];

interface Dress {
  gloves: string;
  hide?: number;
  garment?: string;
}

/** Two survivors near the camera on medium, a man and a woman, in `dress`; the bodies' draws and instances hashed. */
function drawn(dress: Dress): { hash: number; triangles: number } {
  const reg = withContent(compileContent(CORE_CONTENT).registry!, EXTRA);
  const view = provingView(320, 180, undefined, undefined, undefined, { reg, pack: corePackBytes() });
  const { scene, cam, remote, hf } = view;
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  asTextured(scene);
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.1, (70 * Math.PI) / 180, 16 / 9];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = 2;
  for (let n = 0; n < 2; n++) {
    const look = defaultLook();
    look[LOOK_SEX] = n;
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [2000 + n, reg.index.get("core:survivor")!, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x - 0.6 + 1.2 * n, cam.z - 4];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(look, n * LOOK_BYTES);
    remote.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
    remote.gear[n * GEAR_COUNT + GEAR_WORN + 2] = reg.index.get(dress.gloves)!;
  }
  const ch = scene.characters;
  if (dress.hide !== undefined) ch.skinHidden = () => dress.hide!;
  const tee = dress.garment ? reg.index.get(dress.garment)! : 0;
  if (tee) ch.wardrobe = (_id, out) => (out.fill(0, 0, WORN_LENGTH), (out[0] = tee), true);
  let p: FramePacket = scene.build(cam, remote);
  for (let f = 0; f < 6; f++) p = scene.build(cam, remote);
  let h = 0, triangles = 0;
  const add = (a: ArrayBufferView & { BYTES_PER_ELEMENT: number }, d: number): void => void (h = hashBytes(new Uint8Array(a.buffer, a.byteOffset + d * a.BYTES_PER_ELEMENT, a.BYTES_PER_ELEMENT), h));
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    const ranged = (p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
    for (const a of [p.drawMesh, p.drawLod, p.drawFlags, p.drawInstances]) add(a, d);
    if (ranged) for (const a of [p.drawFirstIndex, p.drawIndexCount]) add(a, d);
    triangles += (ranged ? p.drawIndexCount[d]! / 3 : scene.assets.table.tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]!;
  }
  return { hash: h >>> 0, triangles };
}

test("gloves that cover the forearms draw as gloves with forearms hidden", () => {
  const plain = drawn({ gloves: "core:cloth_gloves" }), long = drawn({ gloves: "test:long_gloves" });
  expect(long.triangles).toBeLessThan(plain.triangles);
  expect(long).toEqual(drawn({ gloves: "core:cloth_gloves", hide: FOREARMS }));
});

test("a garment hides what it covers only once its cut is drawn", () => {
  const plain = drawn({ gloves: "core:cloth_gloves" });
  expect(drawn({ gloves: "core:cloth_gloves", garment: "core:plain_tee" })).toEqual(plain);
  const cut = drawn({ gloves: "core:cloth_gloves", garment: "test:cut_tee" });
  expect(cut.triangles).toBeLessThan(plain.triangles);
  expect(cut).toEqual(drawn({ gloves: "core:cloth_gloves", hide: TOP }));
});
