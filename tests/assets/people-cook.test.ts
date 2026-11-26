// The human cook as it ships: a bare body is four levels, the finer two drawn with materials and blended by up to four
// bones, the coarser two flat; its hands and feet follow one bone a vertex at every level; every level goes by skin
// zone; and the soles and grips are calibrated on every worn foot and hand.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOT_NAMES } from "../../shared/anim/human.ts";
import { SEX_IDS } from "../../shared/anim/look.ts";
import { SKIN_ZONE_SLOT } from "../../shared/anim/skin-zones.ts";
import { SKIN_BYTES, VERTEX_BYTES, lodSkin, lodVertices, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { SOURCE } from "../../tools/art/source.ts";
import { artTest, fromArt } from "../fixtures/needs-art.ts";

const pack = fromArt((): Pack => parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/humans/human-bodies/human-bodies.snpk")))));
const mesh = (id: string) => pack.header.meshes[pack.meshIndex.get(id)!]!;

artTest("a bare body is four levels, two with materials and two flat, to its budgets", () => {
  for (const sex of SEX_IDS) {
    const totals = [0, 0, 0, 0];
    for (const slot of SLOT_NAMES) {
      const m = mesh(`core:human_${sex}/${slot}`);
      expect(m.lods.length).toBe(4);
      expect(m.flat).toBe(2);
      m.lods.forEach((l, level) => {
        totals[level]! += l.indexCount / 3;
        expect(l.surfaceOffset !== undefined).toBe(level < 2);
        expect((l.sections?.length ?? 0) / 3).toBeLessThanOrEqual(3);
      });
    }
    // MakeHuman's body at 26,000 and 3,400 with materials; the first flat level is under the old flat body's 1,492, and the
    // coarsest is about what the boot file held before.
    expect(totals[0]).toBeGreaterThan(20_000);
    expect(totals[0]).toBeLessThanOrEqual(26_000);
    expect(totals[1]).toBeLessThanOrEqual(3_400);
    expect(totals[2]).toBeLessThanOrEqual(1_480);
    expect(totals[3]).toBeLessThanOrEqual(420);
    expect(totals[3]).toBeGreaterThan(380);
  }
});

artTest("a body's arms, legs and head blend bones; its hands and feet follow one a vertex at every level", () => {
  for (const sex of SEX_IDS) {
    for (const slot of SLOT_NAMES) {
      const m = mesh(`core:human_${sex}/${slot}`);
      const rigid = slot === "hands" || slot === "feet";
      if (!rigid) expect(m.lods[0]!.skinOffset).toBeDefined();
      for (const lod of m.lods) {
        const skin = lodSkin(pack, lod);
        if (rigid) expect(skin).toBeNull();
        if (!skin) continue;
        // A vertex's first bone is the one it follows where it is drawn flat.
        const verts = lodVertices(pack, lod);
        for (let v = 0; v < lod.vertexCount; v++) expect(skin[v * SKIN_BYTES]).toBe(verts[v * VERTEX_BYTES + 7]!);
      }
    }
  }
});

artTest("every level of a bare body goes by skin zone, each zone in its own slot's mesh", () => {
  for (const sex of SEX_IDS) {
    SLOT_NAMES.forEach((slot, s) => {
      for (const lod of mesh(`core:human_${sex}/${slot}`).lods) {
        expect(lod.zones).toBeDefined();
        for (let k = 0; k < lod.zones!.length; k += 3) expect(SKIN_ZONE_SLOT[lod.zones![k]!]).toBe(s);
      }
    });
  }
});

artTest("hair and worn sets are drawn with materials near and flat far", () => {
  for (const id of ["core:human_m/hair/long", "core:human_f/beard/full", "core:human_m/armor/cloth/torso", "core:human_f/armor/hide/legs"]) {
    const m = mesh(id);
    expect(m.lods.length).toBe(4);
    // The hide set's pictures are cut too fine to come down to its second level's budget, so it is flat from there.
    expect(m.flat).toBe(id.includes("/hide/") ? 1 : 2);
  }
});

artTest("every worn foot keeps its soles and every worn hand its grips, for both sexes", () => {
  for (const sex of SEX_IDS) {
    const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
    for (const set of ["", "armor/cloth/", "armor/hide/", "armor/meridian/"]) {
      expect(rig.soles!.find((s) => s.mesh === `core:human_${sex}/${set}feet`)!.points.length).toBe(12);
      expect(rig.grips!.some((g) => g.mesh === `core:human_${sex}/${set}hands`)).toBe(true);
    }
  }
});

artTest("a body's five slot meshes share one box, so their seams land on the same points", () => {
  for (const sex of SEX_IDS) {
    const boxes = SLOT_NAMES.map((slot) => JSON.stringify([mesh(`core:human_${sex}/${slot}`).center, mesh(`core:human_${sex}/${slot}`).half]));
    expect(new Set(boxes).size).toBe(1);
  }
});

artTest("a section's zones go from the trunk outward, left and right side by side", () => {
  const order = [0, 1, 2, 3, 4, 7, 5, 8, 6, 9, 10, 11, 12, 13, 16, 14, 17, 15, 18, 19, 20];
  for (const sex of SEX_IDS) for (const slot of SLOT_NAMES) for (const lod of mesh(`core:human_${sex}/${slot}`).lods) {
    const runs = lod.zones!;
    for (let k = 3; k < runs.length; k += 3) {
      const sameSection = !lod.sections || lod.sections.some((_, s) => s % 3 === 0 && runs[k - 2]! >= lod.sections![s + 1]! && runs[k + 1]! < lod.sections![s + 1]! + lod.sections![s + 2]!);
      if (sameSection) expect(order.indexOf(runs[k]!)).toBeGreaterThan(order.indexOf(runs[k - 3]!));
    }
  }
});
