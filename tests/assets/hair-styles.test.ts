// Hair and beards as the cook makes them on the MakeHuman head (assets/source/core/humans/hair/): each style is four
// levels to its budgets, its cut-out cards only on the finest and never in a shadow, no more than three cards deep over
// the solid hair or the skin, and an under-hat form pressed to the scalp above a hat's brim.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { B_HEAD } from "../../shared/anim/human.ts";
import { BEARD_STYLES, HAIR_STYLES, SEX_IDS } from "../../shared/anim/look.ts";
import { MATERIAL_CUTOUT, MATERIAL_SHADOWLESS, MATERIAL_TWO_SIDED, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { SOURCE } from "../../tools/art/source.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { HAIR_BUDGETS, UNDER_HAT } from "../../assets/source/core/humans/hair/hair.ts";
import { cardCell } from "../../assets/source/core/humans/hair/sheet.ts";
import { CENTRE } from "../../assets/source/core/humans/hair/head.ts";
import { BRIM, GAP, PRESSED } from "../../assets/source/core/humans/hair/styles.ts";
import { artTest, fromArt } from "../fixtures/needs-art.ts";

const pack = fromArt((): Pack => parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/humans/human-bodies/human-bodies.snpk")))));
const meshes = fromArt(() => new Map(unpackMeshes(pack).map((m) => [m.id, m])));
const mesh = (id: string): SourceMesh => {
  const m = meshes.get(id);
  if (!m) throw new Error(`the pack has no ${id}`);
  return m;
};
const hairIds = (sex: string, under: boolean): string[] => HAIR_STYLES.filter((s) => s.drawn).map((s) => `core:human_${sex}/hair/${s.id}${under ? `/${UNDER_HAT}` : ""}`);
const beardIds = (sex: string): string[] => BEARD_STYLES.filter((s) => s.drawn).map((s) => `core:human_${sex}/beard/${s.id}`);
const every = (sex: string): string[] => [...hairIds(sex, false), ...hairIds(sex, true), ...beardIds(sex)];

artTest("every style has its hair, under-hat form and beard on both sexes", () => {
  for (const sex of SEX_IDS) for (const id of every(sex)) expect(meshes.has(id)).toBe(true);
});

artTest("a style is four levels to its budgets, the last two flat", () => {
  for (const sex of SEX_IDS) for (const id of every(sex)) {
    const m = mesh(id);
    expect(m.flat).toBe(HAIR_BUDGETS.flat);
    expect(m.lods.map((l) => l.indices.length / 3).every((n, k) => n > 0 && n <= HAIR_BUDGETS.levels[k]!)).toBe(true);
    expect(m.lods.length).toBe(HAIR_BUDGETS.levels.length);
  }
});

artTest("cards are cut out, two-sided and shadowless; the core casts", () => {
  for (const sex of SEX_IDS) for (const id of every(sex)) {
    const m = mesh(id);
    const cards = m.materials!.find((x) => x.id.endsWith("hair_cards"))!, core = m.materials!.find((x) => x.id.endsWith("hair_core"));
    expect(cards.flags & (MATERIAL_CUTOUT | MATERIAL_SHADOWLESS | MATERIAL_TWO_SIDED)).toBe(MATERIAL_CUTOUT | MATERIAL_SHADOWLESS | MATERIAL_TWO_SIDED);
    // Stubble is cards all through.
    if (core) expect(core.flags & (MATERIAL_CUTOUT | MATERIAL_SHADOWLESS)).toBe(0);
  }
});

artTest("past the finest level only stubble is cards: other cards are near only", () => {
  const [u0, u1] = cardCell("stubble");
  for (const sex of SEX_IDS) for (const id of every(sex)) {
    const m = mesh(id), cards = m.materials!.findIndex((x) => x.id.endsWith("hair_cards"));
    expect(m.lods[0]!.sections!.some((s) => s === cards)).toBe(true);
    const lod = m.lods[1]!;
    for (let t = 0; t < lod.indices.length / 3; t++) if (lod.sections![t] === cards) for (let k = 0; k < 3; k++) {
      const u = lod.uvs![lod.indices[t * 3 + k]! * 2]!;
      expect(u >= u0 - 1e-3 && u <= u1 + 1e-3).toBe(true);
    }
  }
});

/** A ray's hits with a mesh's triangles that `keep` keeps: distance, and whether the triangle is a card. */
function hits(m: { positions: ArrayLike<number>; indices: ArrayLike<number> }, card: (t: number) => boolean, o: readonly number[], d: readonly number[], out: [number, boolean][], keep: (t: number) => boolean = () => true): void {
  const p = m.positions, idx = m.indices;
  for (let t = 0; t < idx.length / 3; t++) {
    if (!keep(t)) continue;
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
    const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
    const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) continue;
    const sx = o[0]! - p[a]!, sy = o[1]! - p[a + 1]!, sz = o[2]! - p[a + 2]!;
    const u = (sx * hx + sy * hy + sz * hz) / det;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
    if (v < 0 || u + v > 1) continue;
    const at = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (at > 0) out.push([at, card(t)]);
  }
}

/** Metres over a surface that cards stacked on it reach: past the outermost layer's lift. */
const OVER = 0.016;

artTest("no point of the hair or the skin has more than three cards over it", () => {
  for (const sex of SEX_IDS) {
    const head = mesh(`core:human_${sex}/head`).lods[0]!;
    const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
    const centre = [0, 1, 2].map((a) => rig.rest[B_HEAD * 3 + a]! + CENTRE[a]!);
    for (const id of [...hairIds(sex, false), ...hairIds(sex, true), ...beardIds(sex)]) {
      const m = mesh(id), lod = m.lods[0]!;
      const cards = m.materials!.findIndex((x) => x.id.endsWith("hair_cards"));
      const core = m.materials!.findIndex((x) => x.id.endsWith("hair_core"));
      const isCard = (t: number): boolean => lod.sections![t] === cards;
      // Out along the normal of every vertex of the solid hair, and of the bare head under it.
      const from: { p: number[]; n: number[] }[] = [];
      for (let t = 0; t < lod.indices.length / 3; t++) if (lod.sections![t] === core) for (let k = 0; k < 3; k++) {
        const v = lod.indices[t * 3 + k]!;
        from.push({ p: [0, 1, 2].map((a) => lod.positions[v * 3 + a]!), n: [0, 1, 2].map((a) => lod.normals![v * 3 + a]!) });
      }
      // Skin that faces away from the skull's middle, as an ear's back, looks along the scalp, not out of it.
      for (let v = 0; v < head.positions.length / 3; v += 3) {
        const p = [0, 1, 2].map((a) => head.positions[v * 3 + a]!), n = [0, 1, 2].map((a) => head.normals![v * 3 + a]!);
        const out = p.map((x, a) => x - centre[a]!), r = Math.hypot(...out);
        if (n.reduce((t, x, a) => t + x * out[a]!, 0) > 0.4 * r) from.push({ p, n });
      }
      let deepest = 0;
      const found: [number, boolean][] = [];
      for (const { p, n } of from) {
        found.length = 0;
        hits(lod, isCard, p.map((x, a) => x + n[a]! * 1e-4), n, found, isCard);
        // A ray through an edge two cards share meets both: one layer.
        const at = found.map(([d]) => d).filter((d) => d < OVER).sort((a, b) => a - b);
        deepest = Math.max(deepest, at.filter((d, k) => k === 0 || d - at[k - 1]! > 2e-4).length);
      }
      expect([id, deepest <= 3]).toEqual([id, true]);
    }
  }
});

artTest("an under-hat form lies within a few millimetres of the skin above the brim", () => {
  for (const sex of SEX_IDS) {
    const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
    const centre = [0, 1, 2].map((a) => rig.rest[B_HEAD * 3 + a]! + CENTRE[a]!);
    const head = mesh(`core:human_${sex}/head`).lods[0]!;
    for (const id of hairIds(sex, true)) {
      const lod = mesh(id).lods[0]!;
      let most = 0;
      const found: [number, boolean][] = [];
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const p = [0, 1, 2].map((a) => lod.positions[v * 3 + a]! - centre[a]!), r = Math.hypot(...p);
        const theta = (Math.acos(p[1]! / r) * 180) / Math.PI, phi = Math.abs((Math.atan2(p[0]!, p[2]!) * 180) / Math.PI);
        if (theta > BRIM(phi) - 4) continue;
        found.length = 0;
        hits(head, () => false, centre, p.map((x) => x / r), found);
        // Under the jaw a ray from the skull's middle leaves through the neck, which is not the head's mesh.
        if (found.length === 0) continue;
        most = Math.max(most, r - Math.max(...found.map(([at]) => at)));
      }
      expect([id, most < GAP + PRESSED + 0.002]).toEqual([id, true]);
    }
  }
});
