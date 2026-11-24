// The city's eight materials (content/breaks/materials.ts), and the material and health each ruin kind has of its shape's
// family, its size and its finish.

import { expect, test } from "bun:test";
import { familyOf, shapeBreaks } from "../../content/breaks/families.ts";
import { CITY_MATERIALS, PANE_HEALTH, cityMaterial, materialOf, pieceHealth, type CityMaterial } from "../../content/breaks/materials.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_FINISHES, RUIN_SHAPES, finished, ruinKind, ruinMaterial, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import type { MaterialDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { DAMAGE_TYPES, DMG_BULLET, DMG_EXPLOSIVE, DMG_MELEE, harm, hit, resetHit, resolveDamage } from "../../shared/sim/damage.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const EIGHT: readonly CityMaterial[] = ["concrete", "block", "steel", "sheet", "timber", "tile", "plaster", "glass"];
const kind = (shape: RuinShape, finish: RuinFinish): number => reg.index.get(ruinKind(shape, finish))!;
const def = (shape: RuinShape, finish: RuinFinish): StructureDef => reg.defs[kind(shape, finish)] as StructureDef;
const material = (name: CityMaterial): MaterialDef => reg.defs[reg.index.get(cityMaterial(name))!] as MaterialDef;
const everyKind = (Object.keys(RUIN_SHAPES) as RuinShape[]).flatMap((shape) => (Object.keys(RUIN_FINISHES) as RuinFinish[]).filter((f) => finished(shape, f)).map((finish) => [shape, finish] as const));

/** What a hit of `base` of a damage type does to a kind, by the game's own damage function. */
function dealt(k: number, type: number, base: number): number {
  resetHit();
  hit.base = base;
  hit.type = type;
  hit.takes = reg.structTakes[k]![type]!;
  resolveDamage();
  return harm.health;
}

test("the eight materials take what the plan says: tools, bullets, fire, explosives", () => {
  expect(CITY_MATERIALS.map((m) => m.id)).toEqual(EIGHT.map(cityMaterial));
  const takes = (name: CityMaterial): number[] => (["melee", "bullet", "fire", "explosive"] as const).map((t) => material(name).takes[t] ?? 0);
  expect(EIGHT.map(takes)).toEqual([[0, 0, 0, 2.33], [0, 0, 0, 3.5], [0, 0, 0, 0.3], [0.25, 0, 0, 1.5], [0.5, 0, 3, 1], [0.3, 0, 0.5, 2.5], [0.5, 0.1, 1, 4], [1, 1, 0, 6]]);
  // No material names a damage type the game has not, and none takes a pierce.
  for (const m of CITY_MATERIALS) for (const type of Object.keys(m.takes)) expect(DAMAGE_TYPES.includes(type as (typeof DAMAGE_TYPES)[number]) && type !== "pierce").toBe(true);
});

test("each has a half's health, the energy that rams through a half, and what its heap gives", () => {
  expect(EIGHT.map((n) => material(n).health)).toEqual([7800, 5000, 12000, 1500, 2500, 3000, 1200, 150]);
  // In joules. Nothing rams through steel.
  expect(EIGHT.map((n) => material(n).ram)).toEqual([1_500_000, 180_000, undefined, 40_000, 30_000, 30_000, 15_000, 8000]);
  expect(EIGHT.map((n) => (material(n).heap ?? []).map((y) => y.item))).toEqual([["core:stone", "core:flint", "core:ore"], ["core:stone"], ["core:ore"], ["core:ore"], ["core:wood"], ["core:stone", "core:wood"], ["core:wood"], []]);
  // The registry holds them by the material's index, which a structure's column names.
  const sheet = reg.structMaterial[kind("wall8", "rustsheet")]!;
  expect(reg.ids[sheet]).toBe(cityMaterial("sheet"));
  expect([reg.halfHealth[sheet], reg.ramEnergy[sheet]]).toEqual([1500, 40_000]);
  expect(reg.heapYield[sheet]!.map((y) => [reg.ids[y.item], y.count])).toEqual([["core:ore", 8]]);
  expect(reg.ramEnergy[reg.index.get(cityMaterial("steel"))!]).toBe(0);
  expect(reg.heapYield[reg.index.get(cityMaterial("glass"))!]).toBeNull();
  // A car at 54 km/h carries 174 kJ: through glass, plaster, sheet and timber, and not through block or concrete.
  const car = 0.5 * 1550 * 15 * 15;
  expect(EIGHT.filter((n) => material(n).ram !== undefined && car >= material(n).ram!)).toEqual(["sheet", "timber", "tile", "plaster", "glass"]);
});

test("every ruin kind is built of one of the eight, by its shape's family and its finish", () => {
  const ids = new Set(EIGHT.map(cityMaterial));
  for (const [shape, finish] of everyKind) {
    const d = def(shape, finish);
    expect([d.id, ids.has(d.material!)]).toEqual([d.id, true]);
    expect([d.id, d.material]).toEqual([d.id, cityMaterial(ruinMaterial(shape, finish))]);
  }
  // A sheet recipe is sheet, in any colour; painted steel is steel.
  expect(["steelsheet", "rustsheet", "limesheet", "claysheet"].map((f) => ruinMaterial("wall8", f as RuinFinish))).toEqual(["sheet", "sheet", "sheet", "sheet"]);
  expect(ruinMaterial("zpitch8", "seam")).toBe("sheet");
  expect(["steel", "rust", "blue"].map((f) => ruinMaterial("zcurt", f as RuinFinish))).toEqual(["steel", "steel", "steel"]);
  // Clay is tile on a pitched roof and block on a wall.
  expect([ruinMaterial("zpitch8", "clay"), ruinMaterial("wall8", "clay")]).toEqual(["tile", "block"]);
  // A partition or a fixture is plaster whatever it is painted.
  expect(["concrete", "steel", "rustsheet", "mintstucco"].map((f) => ruinMaterial("zpartition", f as RuinFinish))).toEqual(["plaster", "plaster", "plaster", "plaster"]);
  expect(ruinMaterial("zcounter", "concrete")).toBe("plaster");
  expect([ruinMaterial("floor8", "concrete"), ruinMaterial("floor8", "tar"), ruinMaterial("zstub", "fracture")]).toEqual(["concrete", "concrete", "concrete"]);
  // Every other painted, stucco, render or block finish is block.
  expect(["limestone", "rose", "mint", "rosestucco", "limerender", "greyblock", "mintblock"].map((f) => ruinMaterial("wall8", f as RuinFinish))).toEqual(Array(7).fill("block"));
  // A plant on a ruin is timber.
  expect(def("zshrub", "concrete").material).toBe(cityMaterial("timber"));
  expect(materialOf("none", "concrete")).toBe("concrete");
});

test("a ruin kind's health is its material's for a half, times its halves and its family's toughness", () => {
  for (const [shape, finish] of everyKind) {
    const d = def(shape, finish), { halves, tough } = shapeBreaks(shape, RUIN_SHAPES[shape]);
    // A plant is no part of a building, and keeps the little health it had.
    const plant = ["zshrub", "zrooftree", "zivy1", "zivy2", "zivy3"].includes(shape);
    expect([d.id, d.hp]).toEqual([d.id, plant ? 500 : material(ruinMaterial(shape, finish)).health! * halves * tough]);
    expect(reg.maxHp[kind(shape, finish)]).toBe(d.hp);
  }
  // A concrete panel of two halves, which bears nothing: the plan's 15,600.
  expect(def("zpanel8", "concrete").hp).toBe(15600);
  // Structure is tougher: a pier three times, a beam twice, a slab and a bearing wall half as much again.
  expect([def("pier8", "concrete").hp, def("beam8", "concrete").hp, def("floor8", "concrete").hp, def("wall8", "concrete").hp]).toEqual([46800, 31200, 23400, 23400]);
  // Size: a 4 m wall is one half, a parapet half as tough as a wall of its size, a shell four storeys in one.
  expect([def("wall4", "mintblock").hp, def("wall8", "mintblock").hp, def("zparapet8", "mintblock").hp]).toEqual([7500, 15000, 5000]);
  expect(def("zshaft16", "concrete").hp).toBe(pieceHealth("concrete", "zshaft16", RUIN_SHAPES.zshaft16));
  expect(def("zshaft16", "concrete").hp).toBe(7800 * 2 * 4);
});

test("a tool harms a wall of sheet and does nothing to one of concrete or block", () => {
  // A metal hatchet's 40.
  expect(dealt(kind("wall8", "rustsheet"), DMG_MELEE, 40)).toBeCloseTo(10, 6);
  expect(dealt(kind("wall8", "concrete"), DMG_MELEE, 40)).toBe(0);
  expect(dealt(kind("wall8", "limestucco"), DMG_MELEE, 40)).toBe(0);
  // A partition is plaster: tools and bullets both mark it, and a rifle round does a tenth.
  expect(dealt(kind("zpartition", "concrete"), DMG_MELEE, 40)).toBeCloseTo(20, 6);
  expect(dealt(kind("zpartition", "concrete"), DMG_BULLET, 280)).toBeCloseTo(28, 4);
  // An explosive harms all three walls, block the most for its health.
  expect(dealt(kind("wall8", "concrete"), DMG_EXPLOSIVE, 1000)).toBeCloseTo(2330, 3);
  expect(dealt(kind("wall8", "limestucco"), DMG_EXPLOSIVE, 1000)).toBeCloseTo(3500, 3);
  expect(dealt(kind("wall8", "rustsheet"), DMG_EXPLOSIVE, 1000)).toBeCloseTo(1500, 3);
});

test("a glazed piece has its panes' health for each half that has one, and no other piece has any", () => {
  expect(PANE_HEALTH).toBe(150);
  const glass = (shape: RuinShape, finish: RuinFinish = "concrete"): number => reg.glassHp[kind(shape, finish)]!;
  expect([glass("zwin"), glass("zcurt"), glass("zstore"), glass("zclad"), glass("zwin4")]).toEqual([300, 300, 300, 300, 300]);
  // Louvres are no panes, and a plain wall has none.
  expect([glass("zcladl"), glass("zplant"), glass("wall8"), glass("floor8"), glass("zshaft16")]).toEqual([0, 0, 0, 0, 0]);
  // It is the same in every finish, and a shape that never breaks has none.
  expect(glass("zwin", "rustsheet")).toBe(300);
  for (const [shape, finish] of everyKind) if (familyOf(shape) === "none") expect([shape, glass(shape, finish)]).toEqual([shape, 0]);
});
