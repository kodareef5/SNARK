import { expect, test } from "bun:test";
import { OpenWallPick } from "../../client/core/tek-wall-pick.ts";
import { actionsOf, structName } from "../../client/core/ui/structure.ts";
import { tekWallKinds } from "../../shared/world/lattice/tek-walls.ts";
import { STRUCT_TEK_DOOR, STRUCT_TEK_SOLID } from "../../shared/world/upkeep.ts";
import { flatWorld } from "../fixtures/world.ts";

test("a wall menu offers the other mode and identifies a configured panel", () => {
  const { reg } = flatWorld(), kinds = tekWallKinds(reg.index);
  expect(actionsOf(reg, kinds.solid)[0]).toBe(STRUCT_TEK_DOOR);
  for (const k of [kinds.door, kinds.open]) {
    expect(actionsOf(reg, k)[0]).toBe(STRUCT_TEK_SOLID);
    expect(structName(reg, k)).toBe("Tek wall · door mode");
  }
  expect(actionsOf(reg, reg.index.get("core:wall_metal")!)).not.toContain(STRUCT_TEK_DOOR);
});

test("only the owner's management cursor can select the clear aperture", () => {
  const w = flatWorld(4), kinds = tekWallKinds(w.reg.index), pick = new OpenWallPick(w.reg);
  const ref = w.structs.add(kinds.open, 40, 2, 40, 16384, 12, 20);
  const aim = (owner: number, reach: number) => pick.at(w.structs, owner, 37, 2, 39.4, [1, 0, 0], reach);
  expect(aim(12, 4)).toBe(ref);
  expect(aim(3, 4)).toBe(-1);
  expect(aim(12, 2)).toBe(-1);
  w.structs.swap(ref, kinds.door);
  expect(aim(12, 4)).toBe(-1);
});
