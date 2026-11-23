import { expect, test } from "bun:test";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";

test("the packed street deck fits the ride and has textured and distant levels", async () => {
  const asset = (await findAssets()).find(a => a.id === "core:skateboard");
  expect(asset).toBeDefined();
  const pack = parsePack(await Bun.file(asset!.file).bytes());
  const mesh = pack.header.meshes.find(m => m.id === asset!.id)!;
  expect(mesh.half[0]).toBeCloseTo(BOARD.spec.halfWidth, 2);
  expect(mesh.half[2]).toBeCloseTo(BOARD.spec.halfLength, 3);
  expect(mesh.center[1] + mesh.half[1]).toBeCloseTo(BOARD.spec.height, 2);
  expect(mesh.center[1] - mesh.half[1]).toBeCloseTo(0, 3);
  expect(mesh.flat).toBeGreaterThan(0);
  expect(mesh.lods.length).toBeGreaterThan(mesh.flat!);
  expect(pack.header.rigs[mesh.rig!]!.names).toEqual(["deck"]);
  expect(pack.header.textures?.map(t => t.role).sort()).toEqual(["base", "mro", "normal"]);
  expect(checkAsset(asset!, pack, true).faults).toEqual([]);
});
