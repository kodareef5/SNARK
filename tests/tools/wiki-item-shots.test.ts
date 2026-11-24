import { expect, test } from "bun:test";
import type { ManifestMesh } from "../../shared/pack/manifest.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { buildCatalogue, itemPortraitEntries } from "../../tools/wiki/catalogue.ts";
import { groupVanity, ITEM_CUTOUT, itemShots, swatchCutout, vanity } from "../../tools/wiki/item-shots.ts";

const meshes = new Set(["core:club", "core:arrow", "core:egg_s", "core:saddle_raptor/worn",
  "core:human_m/armor/cloth/head", "core:foundation_wood", "core:crystal_rock"]);
const entries = buildCatalogue({ meshes, landmarks: [] });
const shots = itemShots(entries, CORE_CONTENT, meshes);
const subjects = new Map(shots.subjects.map((s) => [s.key, s]));
const item = (id: string) => subjects.get(shots.byItem.get(`core:${id}`)!)!;

test("every item and item category receives a reproducible picture", () => {
  const all = entries.filter((e) => e.kind === "items");
  expect([...shots.byItem.keys()]).toEqual(all.map((e) => e.id));
  expect([...shots.groups.keys()].sort()).toEqual([...new Set(all.map((e) => e.group))].sort());
  for (const [category, shot] of shots.groups) {
    expect(shot.members.length).toBeGreaterThan(0);
    expect(shot.members.every((e) => e.group === category)).toBe(true);
    expect(subjects.get(shot.key)!.group!.members.map((e) => e.key)).toEqual(shot.members.map((e) => shots.byItem.get(e.id)!));
  }
  expect(itemShots(entries, CORE_CONTENT, meshes)).toEqual(shots);
});

test("modeled portraits reuse held, flying, worn and placed assets", () => {
  expect(item("club").meshes).toEqual(["core:club"]);
  expect(item("arrow_stone").meshes).toEqual(["core:arrow"]);
  expect(item("raptor_egg_fertile").meshes).toEqual(["core:egg_s"]);
  expect(item("saddle_raptor").meshes).toEqual(["core:saddle_raptor/worn"]);
  expect(item("cloth_hat").meshes).toEqual(["core:human_m/armor/cloth/head"]);
  expect(item("piece_foundation_wood").meshes).toEqual(["core:foundation_wood"]);
});

test("unmodeled items retain the inventory swatch and compose on a shared stage", () => {
  const swatch = item("gps").item!.swatch!;
  expect(shots.swatches.has("core:gps")).toBe(true);
  expect(swatch.text).toBe("GPS");
  const palette = new Uint8Array(256 * 4);
  palette.set([127, 45, 90, 255], swatch.color * 4);
  const cut = swatchCutout(palette, swatch);
  expect(cut.rgba.length).toBe(ITEM_CUTOUT * ITEM_CUTOUT * 4);
  const at = (310 * ITEM_CUTOUT + 155) * 4;
  expect([...cut.rgba.subarray(at, at + 4)]).toEqual([127, 45, 90, 255]);
  expect(cut.rgba[3]).toBe(0);
  const portrait = vanity(cut, item("gps").item!);
  expect(portrait.width).toBe(portrait.height);
  expect(portrait.rgba[3]).toBe(255);
  const group = subjects.get(shots.groups.get("Instrument")!.key)!.group!;
  const assembled = groupVanity(group.members.map(() => cut), group);
  expect(assembled.width).toBeGreaterThan(assembled.height);
  expect(assembled.rgba[3]).toBe(255);
});

test("a catalogue resource carries the node's actual palette color", () => {
  const d = CORE_CONTENT.find((def) => def.id === "core:crystal_rock");
  expect(d?.type).toBe("node");
  expect(entries.find((e) => e.id === "core:crystal_rock")!.picture!.colors).toEqual([d?.type === "node" ? d.color : -1]);
});

test("a bare station box uses an authored lit variant or a labeled swatch", () => {
  const art = new Set(["core:campfire", "core:campfire_lit"]);
  const assets = buildCatalogue({ meshes: art, landmarks: [] });
  const mesh = (id: string, tris: number) => ({ id, levels: [{ tris }] }) as ManifestMesh;
  const campfire = mesh("core:campfire", 12);
  const lit = mesh("core:campfire_lit", 48);
  const shown = itemPortraitEntries(assets, CORE_CONTENT, [campfire, lit]).find((e) => e.id === "core:piece_campfire");
  expect(shown?.picture?.meshes).toEqual(["core:campfire_lit"]);
  const bare = itemPortraitEntries(assets, CORE_CONTENT, [campfire]);
  expect(itemShots(bare, CORE_CONTENT, art).swatches.has("core:piece_campfire")).toBe(true);
  expect(assets.find((e) => e.id === "core:piece_campfire")?.picture?.meshes).toEqual(["core:campfire"]);
});
