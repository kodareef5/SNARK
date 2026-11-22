// The level-distance grid held to the slow answer on every modelled mesh there is (tools/pack/error.ts). It grows with
// every asset, so it runs before a merge; error.test.ts holds it on made shapes on every change.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { isNode } from "../../tools/art/assets.ts";
import { filesUnder } from "../../tools/art/source.ts";
import { SLOW_MOST, slowSurfaceError, surfaceError } from "../../tools/pack/error.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { ASSETS } from "../fixtures/assets.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { tubeMesh } from "../fixtures/textured.ts";

artTest("the distance between two levels is exactly what trying every triangle gives, on the meshes there are", () => {
  // Every modelled mesh small enough to try the slow way: the building pieces, the bodies, the examples and the creatures'
  // coarser levels. A node pack's crowns and cards are tried by `bun run art -- <id> --check`: they are many, and more
  // with every tree, plant or rock.
  const packs = [...ASSETS.filter((a) => !isNode(a)).map((a) => a.file), ...filesUnder(join(import.meta.dir, "../../tools/blender/example"), ".snpk")];
  const meshes = [...packs.flatMap((file) => unpackMeshes(parsePack(new Uint8Array(readFileSync(file))))), tubeMesh()];
  let pairs = 0;
  for (const mesh of meshes) {
    for (let level = 1; level < mesh.lods.length; level++) {
      const [fine, coarse] = [mesh.lods[level - 1]!, mesh.lods[level]!];
      if (fine.indices.length / 3 > SLOW_MOST) continue;
      expect([mesh.id, level, surfaceError(fine, coarse)]).toEqual([mesh.id, level, slowSurfaceError(fine, coarse)]);
      pairs++;
    }
  }
  expect(pairs).toBeGreaterThan(20);
});
